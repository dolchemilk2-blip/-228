#!/usr/bin/env python3
"""
Чистка голосовых дорожек: убирает эхо комнаты, гул и шум, выравнивает уровень.

    python clean.py                 # все файлы из sources/ → sources/чисто/
    python clean.py --list          # какие движки видны в системе
    python clean.py --chain deecho,speech --sample 45
    python clean.py sources/кэфи.mp3 --chain dereverb

Главное правило: длительность НЕ меняется. Выход всегда ровно такой же длины и без сдвига,
поэтому тайминги в MAP из build.py остаются верными — можно чистить исходники и не
переразмечать реплики. Сдвиг и длина проверяются после каждого прогона (см. out/чистка.txt).

Что установить (само не ставится, чтобы не тянуть 3 ГБ без спроса):
    pip install "audio-separator[cpu]"   # движки deecho / dereverb / denoise (модели качаются сами)
    pip install clearvoice               # движок speech (MossFormer2_SE_48K, 48 кГц)
Подробности и что выбрать — в CLEAN.md.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, time
from pathlib import Path

import numpy as np
import soundfile as sf
import pyloudnorm as pyln

ROOT = Path(__file__).resolve().parent
SRC_DIR = ROOT / "sources"
CLEAN_DIR = SRC_DIR / "чисто"
OUT = ROOT / "out"
SR = 48000
TARGET_LUFS = -20.0          # к какому уровню приводится очищенный исходник

# ------------------------------------------------------------------ движки
# separator — модели UVR через пакет audio-separator (ставятся с HuggingFace при первом запуске);
# clearvoice — речевые модели ClearerVoice-Studio (MossFormer2).
ENGINES = {
    "deecho":     {"kind": "separator", "model": "UVR-De-Echo-Normal.pth",
                   "about": "снимает эхо и «комнату», щадящий — рабочий вариант по умолчанию"},
    "deecho+":    {"kind": "separator", "model": "UVR-De-Echo-Aggressive.pth",
                   "about": "то же, но жёстче: для сильного эха, может съедать хвосты слов"},
    "dereverb":   {"kind": "separator", "model": "UVR-DeEcho-DeReverb.pth",
                   "about": "эхо + реверберация, сильнее сушит"},
    "denoise":    {"kind": "separator", "model": "UVR-DeNoise.pth",
                   "about": "шум тракта и фон, на эхо не влияет"},
    "speech":     {"kind": "clearvoice", "model": "MossFormer2_SE_48K",
                   "about": "речевая модель 48 кГц: шум, гул, часть комнаты; быстрая"},
}
DEFAULT_CHAIN = "deecho,speech"
STEM_OK = re.compile(r"\(\s*(no[_ ]?reverb|noreverb|no[_ ]?echo|noecho|no[_ ]?noise|nonoise|"
                     r"dry|vocals)\s*\)", re.I)

# ------------------------------------------------------------------ ввод-вывод
def have_ffmpeg():
    return shutil.which("ffmpeg") is not None

def decode(path, sr=SR):
    """Моно float32 на sr Гц. Берём первый канал: сведение в моно у ffmpeg поднимает уровень."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-af", "pan=mono|c0=c0",
           "-f", "f32le", "-ar", str(sr), "-"]
    return np.frombuffer(subprocess.run(cmd, check=True, capture_output=True).stdout,
                         np.float32).copy()

def write_wav(path, y, sr=SR, subtype="PCM_24"):
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, np.clip(y, -1.0, 1.0), sr, subtype=subtype)

# ------------------------------------------------------------------ измерения
def frames(x, w=960, h=480):
    k = max(0, (len(x) - w) // h)
    return x[np.arange(w)[None, :] + h * np.arange(k)[:, None]] if k else x[None, :]

def frame_db(x, w=960, h=480):
    return 10 * np.log10((frames(x, w, h) ** 2).mean(1) + 1e-14)

def speech_db(x):
    """Типичная громкость речи: 90-й процентиль кадров (на паузы не смотрит)."""
    e = frame_db(x)
    return float(np.percentile(e, 90)) if len(e) else -99.0

def floor_db(x):
    """Уровень фона: медиана самых тихих кадров."""
    e = frame_db(x)
    if not len(e): return -99.0
    q = e[e < np.percentile(e, 30)]
    return float(np.median(q)) if len(q) else float(np.min(e))

def lufs(y, sr=SR):
    if len(y) < int(0.45 * sr): return float("nan")
    v = pyln.Meter(sr).integrated_loudness(y)
    return v if np.isfinite(v) else float("nan")

def find_lag(a, b, max_ms=250, sr=SR):
    """Сдвиг a относительно b в отсчётах (по взаимной корреляции на первых секундах)."""
    n = int(sr * max_ms / 1000)
    m = min(len(a), len(b), sr * 20)
    if m < sr: return 0
    A = np.fft.rfft(a[:m].astype(np.float64), m * 2)
    B = np.fft.rfft(b[:m].astype(np.float64), m * 2)
    c = np.fft.irfft(A * np.conj(B))
    return int(np.argmax(np.concatenate([c[-n:], c[:n]])) - n)

# ------------------------------------------------------------------ движки: запуск
def python_for(mod):
    """Интерпретатор, в котором виден модуль mod (текущий или указанный в переменной среды)."""
    cands = [os.environ.get(f"{mod.upper()}_PYTHON"), sys.executable]
    for c in cands:
        if c and subprocess.run([c, "-c", f"import {mod}"], capture_output=True).returncode == 0:
            return c
    return None

def separator_cmd():
    exe = os.environ.get("AUDIO_SEPARATOR") or shutil.which("audio-separator")
    if exe: return [exe]
    py = python_for("audio_separator")
    return [py, "-m", "audio_separator.utils.cli"] if py else None

def run_separator(model, inp, workdir):
    cmd = separator_cmd()
    if not cmd:
        raise RuntimeError("не найден audio-separator (pip install \"audio-separator[cpu]\")")
    subprocess.run(cmd + [str(inp), "--model_filename", model, "--output_dir", str(workdir),
                          "--output_format", "WAV", "--log_level", "error"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    got = [p for p in workdir.iterdir() if p.suffix.lower() == ".wav" and STEM_OK.search(p.name)]
    if not got:
        raise RuntimeError(f"{model}: не нашёл очищенную дорожку среди "
                           + ", ".join(p.name for p in workdir.iterdir()))
    return max(got, key=lambda p: p.stat().st_size)

def run_clearvoice(model, inp, workdir):
    py = python_for("clearvoice")
    if not py:
        raise RuntimeError("не найден clearvoice (pip install clearvoice)")
    out = workdir / "cv.wav"
    code = ("import sys\nfrom clearvoice import ClearVoice\n"
            "cv = ClearVoice(task='speech_enhancement', model_names=[sys.argv[1]])\n"
            "cv.write(cv(input_path=sys.argv[2], online_write=False), output_path=sys.argv[3])\n")
    subprocess.run([py, "-c", code, model, str(inp), str(out)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not out.exists():
        raise RuntimeError(f"{model}: файл не создан")
    return out

def engine_available(name):
    kind = ENGINES[name]["kind"]
    return bool(separator_cmd()) if kind == "separator" else bool(python_for("clearvoice"))

# ------------------------------------------------------------------ доводка
def highpass(y, fc=65.0, sr=SR):
    """Убирает подгул и инфраниз (одноро́дный фильтр 2-го порядка, два прохода)."""
    import math
    w = math.tan(math.pi * fc / sr); q = 0.707
    n = 1 / (1 + w / q + w * w)
    b = np.array([n, -2 * n, n])
    a = np.array([1.0, 2 * (w * w - 1) * n, (1 - w / q + w * w) * n])
    def once(x):
        out = np.zeros_like(x); z1 = z2 = 0.0
        for i in range(len(x)):
            v = x[i] - a[1] * z1 - a[2] * z2
            out[i] = b[0] * v + b[1] * z1 + b[2] * z2
            z2, z1 = z1, v
        return out
    try:
        from scipy.signal import sosfiltfilt, butter
        return sosfiltfilt(butter(2, fc, "hp", fs=sr, output="sos"), y).astype(np.float32)
    except Exception:
        return once(y).astype(np.float32)

def dehum(y, sr=SR, base=50.0, harmonics=4, thresh_db=8.0):
    """Режет сетевой гул 50/100/150 Гц, только если он реально торчит над соседями."""
    try:
        from scipy.signal import iirnotch, filtfilt
    except Exception:
        return y, []
    n = min(len(y), sr * 30)
    spec = np.abs(np.fft.rfft(y[:n] * np.hanning(n)))
    f = np.fft.rfftfreq(n, 1 / sr)
    cut = []
    for k in range(1, harmonics + 1):
        fc = base * k
        if fc >= sr / 2 - 10: break
        peak = spec[(f > fc - 1.5) & (f < fc + 1.5)]
        side = spec[((f > fc - 12) & (f < fc - 4)) | ((f > fc + 4) & (f < fc + 12))]
        if len(peak) and len(side) and 20 * np.log10(peak.max() / (np.median(side) + 1e-12)) > thresh_db:
            b, a = iirnotch(fc, 30.0, sr)
            y = filtfilt(b, a, y).astype(np.float32); cut.append(fc)
    return y, cut

def gate_pauses(y, sr=SR, depth_db=14.0, margin_db=9.0, attack=0.006, release=0.18, hold=0.12):
    """
    Дожимает хвост комнаты В ПАУЗАХ: там, где речи нет, уровень опускается на depth_db.
    Речь не трогает вовсе (порог считается от реального фона файла), поэтому не «глотает» слова.
    """
    if depth_db <= 0 or len(y) < sr: return y, 0.0
    h = 240                                            # шаг огибающей, 5 мс
    w = 960
    e = frame_db(y, w, h)
    if not len(e): return y, 0.0
    sp, fl = speech_db(y), floor_db(y)
    thr = min(sp - 28.0, fl + margin_db)               # ниже речи и чуть выше фона
    if thr <= fl + 1.0: thr = fl + margin_db
    open_ = e > thr
    n_hold = int(hold * sr / h)
    held = open_.copy()                                # удержание после речи
    cnt = 0
    for i in range(len(open_)):
        if open_[i]: cnt = n_hold
        elif cnt > 0: held[i] = True; cnt -= 1
    g = np.where(held, 1.0, 10 ** (-depth_db / 20))
    a_at = np.exp(-h / (attack * sr)); a_rl = np.exp(-h / (release * sr))
    sm = np.empty_like(g); v = g[0]
    for i, t in enumerate(g):                          # сглаживание: быстро вверх, медленно вниз
        c = a_at if t > v else a_rl
        v = t + c * (v - t); sm[i] = v
    env = np.interp(np.arange(len(y)), np.arange(len(sm)) * h + w // 2, sm,
                    left=sm[0], right=sm[-1]).astype(np.float32)
    return (y * env).astype(np.float32), float(100.0 * (1.0 - held.mean()))

def normalize(y, target=TARGET_LUFS, peak_ceiling_db=-1.5):
    L = lufs(y)
    g = 10 ** ((target - L) / 20) if np.isfinite(L) else 1.0
    y = (y * g).astype(np.float32)
    pk = float(np.abs(y).max() + 1e-12)
    ceil = 10 ** (peak_ceiling_db / 20)
    if pk > ceil: y = (y * (ceil / pk)).astype(np.float32)
    return y, (20 * np.log10(g) if g > 0 else 0.0)

# ------------------------------------------------------------------ один файл
def clean_file(path, chain, args, report):
    t0 = time.time()
    orig = decode(path)
    n0 = len(orig)
    info = {"файл": path.name, "длина, с": round(n0 / SR, 3),
            "громкость до, LUFS": round(lufs(orig), 1), "фон до, дБ": round(floor_db(orig), 1),
            "речь до, дБ": round(speech_db(orig), 1), "цепочка": ",".join(chain), "шаги": []}
    print(f"\n{path.name}  ({n0 / SR:.1f} c)")

    cur = path
    tmp = Path(tempfile.mkdtemp(prefix="clean_", dir=args.tmp or None))
    try:
        for i, name in enumerate(chain):
            eng = ENGINES[name]
            step_dir = tmp / f"{i}_{name}"; step_dir.mkdir(parents=True)
            ts = time.time()
            print(f"  {name} ({eng['model']}) …", end="", flush=True)
            if eng["kind"] == "separator":
                res = run_separator(eng["model"], cur, step_dir)
            else:
                res = run_clearvoice(eng["model"], cur, step_dir)
            cur = res
            print(f" {time.time() - ts:.0f} c")
            info["шаги"].append({"движок": name, "модель": eng["model"],
                                 "секунд": round(time.time() - ts, 1)})
        y = decode(cur)
    finally:
        if args.keep_steps and Path(cur).exists():
            OUT.mkdir(exist_ok=True)
            shutil.copy(cur, OUT / f"_без_доводки_{path.stem}.wav")
        shutil.rmtree(tmp, ignore_errors=True)

    # --- тайминги: длина и сдвиг обязаны совпасть с оригиналом
    lag = find_lag(y, orig)
    if lag > 0:   y = y[lag:]
    elif lag < 0: y = np.concatenate([np.zeros(-lag, np.float32), y])
    if len(y) < n0: y = np.concatenate([y, np.zeros(n0 - len(y), np.float32)])
    y = y[:n0]
    info["сдвиг, мс"] = round(lag / SR * 1000, 1)
    if abs(lag) > 0.05 * SR:
        print(f"  ВНИМАНИЕ: движок сдвинул дорожку на {lag / SR * 1000:+.0f} мс — сдвиг возвращён "
              "назад, но результат стоит проверить на слух")

    # --- доводка
    if not args.no_polish:
        y = highpass(y, args.hpf)
        y, cut = dehum(y)
        if cut: info["вырезан гул, Гц"] = cut
        y, quiet = gate_pauses(y, depth_db=args.gate)
        info["пауз в файле, %"] = round(quiet, 1)
    y, g = normalize(y, args.lufs)
    info["поправка уровня, дБ"] = round(g, 1)
    info["громкость после, LUFS"] = round(lufs(y), 1)
    info["фон после, дБ"] = round(floor_db(y), 1)
    info["речь после, дБ"] = round(speech_db(y), 1)
    info["фон тише на, дБ"] = round((info["речь после, дБ"] - info["фон после, дБ"])
                                    - (info["речь до, дБ"] - info["фон до, дБ"]), 1)
    info["порог THR для build.py"] = round(info["речь после, дБ"] - 22.0, 1)

    dst = CLEAN_DIR / (path.stem + ".wav")
    write_wav(dst, y)
    info["куда"] = str(dst.relative_to(ROOT))
    info["всего секунд"] = round(time.time() - t0, 1)
    print(f"  → {dst.relative_to(ROOT)}   фон тише на {info['фон тише на, дБ']:+.1f} дБ, "
          f"сдвиг {info['сдвиг, мс']:+.1f} мс, {info['всего секунд']:.0f} c")
    report.append(info)
    return dst, orig, y

# ------------------------------------------------------------------ образец до/после
def make_sample(pairs, seconds, name="образец_до_после.mp3"):
    """Склеивает «было → стало» по каждому файлу, чтобы можно было сравнить на слух."""
    if not have_ffmpeg() or not pairs: return None
    chunks = []
    for title, before, after in pairs:
        e = frame_db(before)
        start = int(max(0, (np.argmax(e > np.percentile(e, 90) - 10) * 480 - SR)))
        seg = slice(start, start + int(seconds * SR))
        b, a = before[seg], after[seg]
        if len(b) < SR: continue
        b = b * 10 ** ((TARGET_LUFS - (lufs(b) if np.isfinite(lufs(b)) else TARGET_LUFS)) / 20)
        pause = np.zeros(int(0.7 * SR), np.float32)
        chunks += [b.astype(np.float32), pause, a.astype(np.float32), np.zeros(int(1.2 * SR), np.float32)]
    if not chunks: return None
    raw = OUT / "_sample.wav"; write_wav(raw, np.clip(np.concatenate(chunks), -1, 1), subtype="FLOAT")
    dst = OUT / name
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-ac", "1",
                    "-c:a", "libmp3lame", "-b:a", "160k", str(dst)], check=True)
    raw.unlink()
    return dst

# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description="чистка голоса: эхо комнаты, гул, шум")
    ap.add_argument("files", nargs="*", help="файлы (по умолчанию — всё из sources/)")
    ap.add_argument("--chain", default=DEFAULT_CHAIN, help=f"движки через запятую (по умолчанию {DEFAULT_CHAIN})")
    ap.add_argument("--list", action="store_true", help="показать движки и выйти")
    ap.add_argument("--lufs", type=float, default=TARGET_LUFS, help="целевая громкость файла")
    ap.add_argument("--gate", type=float, default=14.0, help="на сколько дБ дожимать паузы (0 — не трогать)")
    ap.add_argument("--hpf", type=float, default=65.0, help="частота среза низов, Гц")
    ap.add_argument("--no-polish", action="store_true", help="без фильтров и работы с паузами")
    ap.add_argument("--sample", type=float, default=0, help="сделать образец до/после на N секунд")
    ap.add_argument("--keep-steps", action="store_true", help="сохранить промежуточные файлы в out/")
    ap.add_argument("--tmp", default=None, help="где держать временные файлы")
    args = ap.parse_args()

    if args.list:
        print("движки (чем левее в цепочке, тем раньше применяется):\n")
        for k, v in ENGINES.items():
            ok = "есть" if engine_available(k) else "НЕ УСТАНОВЛЕН"
            print(f"  {k:10s} {v['model']:30s} [{ok}]\n             {v['about']}")
        print(f"\nпо умолчанию: --chain {DEFAULT_CHAIN}")
        print("ставится так:  pip install \"audio-separator[cpu]\"   и   pip install clearvoice")
        return

    if not have_ffmpeg(): sys.exit("нужен ffmpeg")
    chain = [c.strip() for c in args.chain.split(",") if c.strip()]
    for c in chain:
        if c not in ENGINES: sys.exit(f"неизвестный движок {c}; см. python clean.py --list")
    missing = [c for c in chain if not engine_available(c)]
    if missing and args.chain == DEFAULT_CHAIN:      # цепочку не задавали руками — работаем тем, что есть
        chain = [c for c in chain if c not in missing]
        print("не установлено: " + ", ".join(missing) + " — работаю цепочкой " +
              (",".join(chain) if chain else "(пусто)"))
        missing = [] if chain else missing
    if missing or not chain:
        sys.exit("нужно поставить: " + " и ".join(sorted({
            "pip install \"audio-separator[cpu]\"" if ENGINES[c]["kind"] == "separator"
            else "pip install clearvoice" for c in (missing or chain)})))

    if args.files:
        files = [Path(f) for f in args.files]
    else:
        files = sorted(p for p in SRC_DIR.iterdir()
                       if p.is_file() and p.suffix.lower() in
                       {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".opus", ".aif", ".aiff"})
    if not files: sys.exit(f"нет файлов в {SRC_DIR}")

    OUT.mkdir(exist_ok=True)
    report, pairs = [], []
    for p in files:
        dst, before, after = clean_file(p, chain, args, report)
        pairs.append((p.name, before, after))

    if args.sample:
        s = make_sample(pairs, args.sample)
        if s: print(f"\nобразец до/после: {s.relative_to(ROOT)}")

    txt = ["Чистка исходников — отчёт", f"цепочка: {','.join(chain)}", ""]
    for r in report:
        txt.append(f"{r['файл']}  →  {r['куда']}")
        txt.append(f"  длина {r['длина, с']} c, сдвиг {r['сдвиг, мс']:+} мс "
                   f"(0 — тайминги реплик не поехали)")
        txt.append(f"  громкость {r['громкость до, LUFS']} → {r['громкость после, LUFS']} LUFS")
        txt.append(f"  фон {r['фон до, дБ']} → {r['фон после, дБ']} дБ, "
                   f"речь над фоном стала чище на {r['фон тише на, дБ']:+} дБ")
        if r.get("вырезан гул, Гц"): txt.append(f"  вырезан гул: {r['вырезан гул, Гц']} Гц")
        txt.append(f"  THR для build.py: {r['порог THR для build.py']}")
        txt.append("")
    (OUT / "чистка.txt").write_text("\n".join(txt), encoding="utf-8")
    (OUT / "чистка.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nотчёт: out/чистка.txt   очищенные файлы: {CLEAN_DIR.relative_to(ROOT)}/")
    print("дальше: python build.py  (он сам возьмёт очищенные версии)")

if __name__ == "__main__":
    main()
