#!/usr/bin/env python3
"""
Сборка аудиопилота по сценарию из отдельных записей актёров.

    python build.py                 # берёт очищенные исходники, если они есть
    python build.py --raw           # только оригиналы из sources/
    python build.py --level 0       # не выравнивать реплики между собой
    python build.py --wav           # ещё и мастер без сжатия

Результат в out/:
    пилот_сведение.mp3   — готовая дорожка
    пилот_паузы.txt      — где стоят паузы под незаписанные реплики (с номерами)
    разметка.csv         — каждая реплика: откуда взята, уровень, поправка, где стоит
    громкость.txt        — что выровнялось и какие реплики поправлены сильнее всего

Чистка голоса (эхо комнаты, гул, шум) — отдельный шаг: python clean.py, см. CLEAN.md.
Остальные подробности — в CLAUDE.md.
"""
import argparse, csv, json, re, subprocess, sys
from pathlib import Path

import numpy as np
import soundfile as sf
import pyloudnorm as pyln

ROOT = Path(__file__).resolve().parent
SR = 48000

# ------------------------------------------------------------------ настройки
SOURCES = {                       # файлы лежат в sources/
    "E": "энер.wav",
    "X": "энер_правки_и_последняя_сцена.wav",
    "K": "кэфи.mp3",
    "F": "флур-enhanced-v2.wav",  # версия после Adobe Enhance; тайминги 1:1 с исходным флур.m4a
}
CHAR = {"E": "ENER", "X": "ENER", "K": "KEFI", "F": "FLUR"}
# порог (dBFS) для уточнения границ реплик по огибающей громкости.
# для необработанного флур.m4a использовался -56
THR = {"E": -58.0, "X": -58.0, "K": -60.0, "F": -66.0}

SCRIPT = ROOT / "script" / "пилот__2_.txt"
SRC_DIR = ROOT / "sources"
CLEAN_DIR = SRC_DIR / "чисто"          # сюда clean.py кладёт очищенные исходники
EXTRA_DIR = ROOT / "extra"
OUT = ROOT / "out"

CHAR_LUFS = -20.0       # громкость каждого голоса до мастеринга
MASTER_LUFS = -16.0     # итоговая громкость
MP3_BITRATE = "160k"

# Выравнивание отдельных реплик внутри голоса: чтобы одна не перекрикивала другую,
# но и не превратилась в ровный бубнёж. 0 — ничего не трогать, 1 — все реплики в один уровень.
LEVEL_STRENGTH = 0.6
LEVEL_MAX_UP = 6.0      # насколько максимум поднимать тихую реплику, дБ
LEVEL_MAX_DOWN = 8.0    # насколько максимум придавливать громкую, дБ
LEVEL_FILE = "громкость.txt"   # ручные поправки: "242 -3" или "Кэфи -1" (лежит в extra/)
QUIET_RE = re.compile(r"шёпот|шепот|тихо", re.I)      # ремарки у имени: играть тихо
LOUD_RE = re.compile(r"громк|крич|орёт|орет|вопит", re.I)
AUDIO_EXT = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".opus", ".aif", ".aiff"}

NAME = {"KEFI": "Кэфи", "ENER": "Энер", "FLUR": "Флур", "ORG": "Организатор",
        "TEACHER": "Учитель", "ADULT1": "Взрослый в зале", "ADULT2": "Второй взрослый",
        "EXTRA": "Массовка"}

# ------------------------------------------------------------------ разбор сценария
SPEAKERS = {"кэфи": "KEFI", "энер": "ENER", "флур": "FLUR", "организатор": "ORG",
            "учитель": "TEACHER", "взрослый": "ADULT1", "первый": "ADULT1",
            "второй взрослый": "ADULT2"}
INNER = {"голос в голове кэфи": "KEFI", "голос в голове флура": "FLUR"}
LABEL_RE = re.compile(r"^(?P<name>[А-Яа-яЁё ]+?)\s*(\((?P<note>[^)]*)\))?\s*:?\s*$")

def classify_label(s):
    """Кто говорит и что написано в скобках рядом с именем («шёпотом», «слишком громко»)."""
    low = s.lower().rstrip(":").strip()
    if low in INNER:
        return INNER[low], ""
    m = LABEL_RE.match(s)
    if m and m.group("name").strip().lower() in SPEAKERS:
        return SPEAKERS[m.group("name").strip().lower()], (m.group("note") or "")
    return None, ""

def parse_script():
    lines = SCRIPT.read_text(encoding="utf-8").split("\n")
    cues, i = [], 0
    while i < len(lines):
        s = lines[i].strip()
        if not s:
            i += 1; continue
        m = re.match(r"^СЦЕНА\s+(\d+)", s)
        if m:
            cues.append({"type": "scene", "n": int(m.group(1))}); i += 1; continue
        spk, note = classify_label(s)
        if spk:
            j = i + 1; content = []
            while j < len(lines) and lines[j].strip():
                content.append(lines[j].strip()); j += 1
            if content:
                cues.append({"type": "line", "spk": spk, "text": " ".join(content), "note": note})
            i = j; continue
        cues.append({"type": "dir", "text": s}); i += 1
    return cues

# ------------------------------------------------------------------ разметка реплик
# Номер реплики = порядковый номер реплики в сценарии (0..336), как в out/разметка.csv.
# Значение: (источник, начало, конец) в секундах исходного файла; список — реплика из
# нескольких кусков; None — записи нет (будет пауза). Реплики организатора, учителя и
# взрослых в зале сюда не входят — для них всегда пауза, пока нет файла в extra/.
E = lambda a, b: ("E", a, b)
X = lambda a, b: ("X", a, b)
K = lambda a, b: ("K", a, b)
F = lambda a, b: ("F", a, b)

MAP = {
 0: K(21.18,32.42), 1: None, 2: K(36.51,45.64), 3: K(47.49,51.62), 4: K(55.87,56.74),
 8: K(58.2,60.1), 10: K(61.58,63.14), 12: K(65.19,66.41),
 14: K(67.87,69.54), 15: E(1.31,4.36), 16: None, 17: E(5.35,9.86), 18: K(70.56,74.02),
 19: E(10.94,12.29), 20: K(75.45,75.94), 21: E(13.88,14.57), 22: K(77.31,78.41),
 23: [E(29.44,38.89), E(41.92,42.92)], 24: K(79.6,81.16), 25: E(44.41,45.32),
 26: F(0.2,15.01), 27: K(83.07,84.55), 28: F(16.28,17.73), 29: E(47.45,47.94),
 30: K(85.99,86.98), 31: E(48.80,72.71), 32: F(18.91,20.04), 33: E(75.87,77.41),
 34: K(88.19,89.86), 35: F(20.86,40.61), 36: K(91.36,92.61), 37: K(93.69,95.21),
 38: E(81.76,82.69), 39: K(96.16,98.41), 40: None, 41: E(85.63,89.09),
 42: K(100.38,102.31), 43: F(45.98,47.91),
 44: F(52.24,62.31), 45: E(100.89,102.60), 46: F(63.10,63.91), 47: E(103.58,106.50),
 48: F(64.83,66.95), 49: E(107.13,108.97), 50: F(67.64,69.83), 52: F(70.88,72.01),
 54: E(114.36,114.79), 57: F(72.67,74.66), 59: F(75.61,76.20), 61: F(77.34,78.53),
 63: K(113.69,114.63), 65: E(121.05,122.37), 68: F(79.61,80.65), 70: K(115.76,118.66),
 73: F(82.01,83.69), 74: E(126.84,128.61), 75: F(84.64,86.12), 76: E(129.47,130.63),
 77: F(87.04,87.88), 78: K(120.2,122.15), 79: F(88.86,89.54), 80: K(123.61,126.79),
 81: E(142.05,143.4), 82: F(90.91,93.09), 83: E(144.86,146.66), 84: F(94.59,95.21),
 85: K(128.48,129.00), 86: F(96.48,101.54), 87: K(130.04,131.05), 88: K(132.43,133.83),
 89: E(148.76,149.22), 90: F(102.24,103.01), 91: E(150.78,151.40), 92: F(103.71,108.07),
 93: E(153.50,154.85), 94: F(108.76,113.22), 95: E(157.31,158.50), 96: F(113.99,115.01),
 97: E(160.8,161.2), 98: F(115.93,116.49), 99: E(163.58,164.71), 100: F(117.47,118.15),
 101: E(166.6,168.87), 102: F(119.07,121.77), 103: K(135.55,136.58), 104: F(122.24,123.21),
 105: E(170.3,171.0), 106: F(124.22,125.13), 107: None, 108: F(126.30,130.15),
 109: E(172.76,174.34), 110: F(131.00,132.74), 111: E(175.64,177.80), 112: F(134.62,135.49),
 113: E(180.86,181.86), 114: F(137.28,141.19), 115: E(184.32,185.16), 116: K(137.88,140.36),
 117: E(186.27,186.92), 118: K(141.66,143.56), 119: F(141.85,142.85), 120: K(144.90,146.12),
 121: F(143.71,145.93), 122: E(188.16,189.89), 123: E(190.81,194.31), 124: F(146.65,148.10),
 125: F(148.51,149.48), 126: None, 127: F(150.56,151.43), 128: E(195.20,198.57),
 129: F(152.83,154.15), 130: E(200.06,207.01), 131: K(148.32,148.97), 132: E(209.0,209.55),
 133: K(150.08,150.92), 134: E(210.88,212.55), 135: K(152.32,153.00), 136: E(214.94,218.85),
 137: K(154.62,155.27), 138: E(220.67,221.67), 139: F(155.32,159.91), 140: E(224.44,225.45),
 141: F(160.92,162.02), 142: E(227.10,229.03), 143: F(163.23,164.10), 144: F(164.73,165.29),
 145: K(156.19,157.32), 146: E(230.33,230.98), 147: F(166.49,168.01), 148: E(232.00,233.13),
 149: F(169.47,170.25), 150: E(233.82,234.85), 151: F(171.45,172.58), 152: E(236.19,238.12),
 153: F(174.04,185.13), 154: E(239.48,240.26), 155: F(185.92,187.17), 156: E(241.53,242.18),
 157: F(187.87,189.89), 158: E(243.13,244.45), 159: F(189.9,192.10), 160: E(246.3,246.76),
 161: E(248.41,250.63), 162: F(193.28,193.93), 163: E(251.84,253.13), 164: F(195.07,196.42),
 165: E(254.01,255.72), 166: K(158.17,158.98), 167: E(257.0,258.60), 168: F(196.76,197.64),
 169: K(160.38,161.51), 170: None, 171: K(162.68,163.65), 172: E(260.5,261.22),
 173: K(164.92,165.86), 174: K(167.36,168.23), 175: K(170.65,171.46), 176: F(198.59,201.41),
 177: E(262.5,263.45), 178: F(202.52,203.33), 179: E(264.12,265.54), 180: K(173.05,176.04),
 181: E(266.33,268.17), 182: K(177.46,178.18), 183: F(204.24,206.37), 184: E(271.09,272.74),
 185: K(179.29,187.6), 186: F(207.16,207.78), 187: K(189.15,191.62), 188: E(273.88,274.66),
 189: K(192.60,193.89), 190: F(208.12,210.95), 191: K(195.29,196.39), 192: F(212.1,212.9),
 193: K(197.85,198.57), 194: F(213.37,214.89),
 195: F(215.6,216.3), 196: E(283.5,283.9), 197: F(216.86,217.67), 198: E(284.89,285.32),
 199: F(218.43,220.61), 200: K(199.3,200.2), 201: E(287.00,287.91), 202: F(220.99,223.21),
 203: E(289.72,293.80), 204: F(223.93,224.81), 205: E(296.22,298.21), 206: F(225.50,226.28),
 207: E(300.09,300.90), 208: F(226.68,227.49), 209: E(302.65,304.04), 210: K(200.95,202.63),
 211: F(228.06,231.27), 212: E(307.10,308.81), 213: F(231.93,234.15), 214: E(311.87,313.93),
 215: F(234.81,238.15), 216: E(316.89,317.67), 217: F(238.72,240.71), 218: E(318.65,319.88),
 219: F(241.56,242.12), 220: E(321.05,334.21), 221: F(242.97,244.04), 222: E(335.71,336.42),
 223: F(244.70,245.51), 224: K(204.19,205.48), 225: F(245.56,246.82), 226: K(206.43,207.91),
 227: F(247.36,248.65), 228: K(209.72,214.09), 229: F(249.85,261.09), 230: K(216.2,216.81),
 231: F(262.01,262.73), 232: K(219.90,220.81), 233: F(263.23,265.86), 234: K(222.85,223.65),
 235: F(266.78,267.78), 236: E(338.78,339.43), 237: F(269.24,270.25), 238: F(271.49,273.25),
 239: E(341.1,342.0), 240: F(274.52,275.14), 241: E(343.32,345.99),
 242: X(1.25,2.21), 243: K(226.30,227.65), 244: F(275.80,277.38), 245: X(2.78,4.20),
 246: F(278.68,279.78), 247: F(281.08,281.86), 248: F(282.6,283.75), 249: None,
 250: E(356.12,357.83), 251: E(359.52,366.05), 252: E(367.04,367.65), 253: None,
 254: E(373.88,374.82), 255: K(229.24,230.47), 256: E(376.16,377.09), 257: K(232.76,233.67),
 258: E(378.55,379.65), 259: K(235.45,235.95), 260: K(237.05,239.88), 261: F(283.8,287.14),
 262: E(381.8,383.56), 263: F(288.35,289.57), 264: E(384.76,386.53), 265: F(291.02,292.74),
 266: E(389.50,391.11), 267: F(294.24,295.17), 268: E(392.51,395.11), 269: F(296.44,297.29),
 270: E(398.24,398.60), 271: F(298.20,299.65), 272: E(401.05,401.86), 273: F(306.36,308.45),
 274: F(309.08,310.09), 275: F(310.36,310.79), 276: E(407.39,408.87), 277: E(410.94,413.35),
 278: K(241.82,242.35), 279: E(416.4,417.80), 280: K(244.73,245.35), 281: E(430.4,431.14),
 282: K(247.40,248.29), 283: E(436.5,438.05), 284: E(441.85,444.35), 285: E(447.00,448.55),
 286: F(311.96,315.97), 287: E(450.56,451.81), 288: K(251.77,253.22), 289: E(457.24,459.49),
 290: K(254.36,255.72), 291: F(316.83,318.34), 292: E(461.75,463.35), 293: K(257.95,258.85),
 294: E(465.05,466.44), 295: F(318.95,323.37), 296: K(262.25,262.76), 297: F(324.76,325.48),
 298: E(470.05,470.6), 299: K(265.53,266.15), 300: E(472.25,473.13), 301: None,
 302: E(474.75,479.3), 303: K(269.05,270.12), 304: E(480.09,481.57), 305: K(271.3,272.23),
 306: F(326.75,328.77), 307: K(273.76,275.01), 308: F(329.92,331.30), 309: K(276.03,277.73),
 313: E(483.3,484.8), 314: F(332.06,333.48), 315: None, 316: F(333.98,335.05),
 317: E(486.27,486.76), 318: K(279.20,280.42), 319: E(490.95,493.0), 320: K(281.50,283.24),
 321: E(494.7,497.1), 322: E(498.17,498.53),
 323: F(336.41,337.54), 324: X(5.75,7.6), 325: F(338.72,339.65), 326: X(8.75,10.25),
 327: F(340.64,341.35), 328: X(11.6,12.25), 329: F(342.08,343.05), 330: F(343.77,344.74),
 331: K(285.76,286.63), 332: F(346.17,347.33), 333: K(287.84,289.73), 334: F(349.31,351.14),
 335: K(291.52,293.03), 336: X(19.95,22.1),
}

# Ремарки, которые превращаются в звук или паузу (ключ — номер элемента сценария).
SPECIAL_DIR = {
    8:   ("KEFI", "они сказали «мы, наверное, не пойдём»… они всегда слышат в моём «ну ладно» то, что им удобно.", K(4.55, 19.72)),
    20:  ("KEFI", "не смотреть.", K(33.55, 35.6)),
    47:  ("KEFI", "…бля.", K(53.45, 54.60)),
    101: ("FLUR", "[смех]", F(41.3, 45.3)),
    378: ("ENER", "[смех]", E(275.0, 281.1)),
    527: ("EXTRA", "зритель: «это комедия или чего?»", None),
    592: ("EXTRA", "зритель: «ой»", None),
    641: ("EXTRA", "голос в мегафон: «спокойно! это пробки!»", None),
}
CONSUMED_DIR = {7, 9, 10, 11, 12, 19}


# ------------------------------------------------------------------ аудио-утилиты
def decode(path):
    # берём первый канал (у стерео-исходников каналы одинаковые; простое сведение в моно
    # у ffmpeg поднимает уровень на 3 дБ и сбивает пороги THR)
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-af", "pan=mono|c0=c0",
           "-f", "f32le", "-ar", str(SR), "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()

HOP = 0.01

def envelope(x):
    w = int(0.02 * SR); h = int(HOP * SR)
    n = 1 + (len(x) - w) // h
    cs = np.concatenate([[0.0], np.cumsum(x.astype(np.float64) ** 2)])
    st = np.arange(n) * h
    return 10 * np.log10((cs[st + w] - cs[st]) / w + 1e-14)

def auto_thr(env):
    """Порог для refine() по самому файлу: ниже речи, но заведомо выше фона."""
    sp = float(np.percentile(env, 90))                       # типичный уровень речи
    low = env[env < np.percentile(env, 30)]
    fl = float(np.median(low)) if len(low) else sp - 40.0    # фон
    return round(min(sp - 12.0, max(sp - 25.0, fl + 6.0)), 1)

def level_db(y):
    """Насколько громко звучит реплика: уровень её речевой части, дБ."""
    w = int(0.02 * SR)
    n = len(y) // w
    if n < 2:
        return 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9)
    e = 10 * np.log10(np.mean(y[:n * w].reshape(n, w) ** 2, axis=1) + 1e-14)
    sel = e > e.max() - 25
    return float(np.percentile(e[sel], 60)) if sel.any() else float(e.max())

def read_level_file(path):
    """extra/громкость.txt: ручные поправки по номеру реплики или по имени персонажа."""
    fixes = {}
    if not path.exists():
        return fixes
    by_name = {v.lower(): k for k, v in NAME.items()}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.replace("\t", " ").rsplit(None, 1)
        if len(parts) != 2:
            continue
        key, val = parts[0].strip(), parts[1].replace(",", ".").replace("дБ", "").strip()
        try:
            db = float(val)
        except ValueError:
            continue
        fixes[by_name.get(key.lower(), key)] = db
    return fixes

def refine(env, thr, a, b, total):
    """Уточняет границы реплики: захватывает мягкие начала/хвосты, отрезает тишину."""
    above = env > thr
    ia, ib = int(a / HOP), min(int(b / HOP), len(env) - 1)
    if above[ia]:
        i = j = ia; gap = 0
        while i > max(0, ia - 80):
            i -= 1
            if above[i]: j = i; gap = 0
            else:
                gap += 1
                if gap >= 12: break
        si = j
    else:
        c = np.nonzero(above[ia:ib])[0]; si = ia + (c[0] if len(c) else 0)
    if above[ib]:
        i = j = ib; gap = 0
        while i < min(len(env) - 1, ib + 60):
            i += 1
            if above[i]: j = i; gap = 0
            else:
                gap += 1
                if gap >= 12: break
        ei = j
    else:
        c = np.nonzero(above[si:ib + 1])[0]; ei = si + (c[-1] if len(c) else ib - si)
    return max(0.0, si * HOP - 0.04), min(total, ei * HOP + 0.12)

def fade(y, fin=0.010, fout=0.030):
    y = y.copy()
    n1 = min(len(y), int(fin * SR)); n2 = min(len(y), int(fout * SR))
    if n1: y[:n1] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n1))
    if n2: y[-n2:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, n2))
    return y

def trim_silence(y):
    w = int(0.01 * SR); n = len(y) // w
    if n == 0: return y
    e = 20 * np.log10(np.sqrt(np.mean(y[:n * w].reshape(n, w) ** 2, axis=1)) + 1e-9)
    idx = np.nonzero(e > max(e.max() - 45, -60))[0]
    if not len(idx): return y
    return y[max(0, idx[0] * w - int(0.06 * SR)):min(len(y), (idx[-1] + 1) * w + int(0.12 * SR))]

def gain_to(y, target):
    if len(y) >= int(0.45 * SR):
        L = pyln.Meter(SR).integrated_loudness(y)
        if np.isfinite(L): return 10 ** ((target - L) / 20)
    rms = 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9)
    return 10 ** ((target - (rms - 1.0)) / 20)

def find_extra(item_id):
    """extra/016.wav, extra/016_флур_мы.m4a, extra/d527.wav и т.п."""
    if not EXTRA_DIR.exists(): return None
    for p in sorted(EXTRA_DIR.iterdir()):
        if p.suffix.lower() in AUDIO_EXT and re.match(rf"^{re.escape(item_id)}(\b|[_\-\s.]|$)", p.stem):
            return p
    return None

def est_duration(text):
    t = re.sub(r"\([^)]*\)", " ", text)
    t = re.sub(r"[—\-«»\"…]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return max(0.6, 0.4 + len(t) / 13.0 + 0.7 * text.count("(пауза)"))

def ts(t):
    return f"{int(t // 60):02d}:{t % 60:04.1f}"

# ------------------------------------------------------------------ сборка
def resolve_sources(use_clean):
    """Для каждого источника: очищенная версия из sources/чисто/, иначе оригинал."""
    paths, cleaned = {}, {}
    for k, f in SOURCES.items():
        clean = CLEAN_DIR / (Path(f).stem + ".wav")
        if use_clean and clean.exists():
            paths[k], cleaned[k] = clean, True
        else:
            paths[k], cleaned[k] = SRC_DIR / f, False
    return paths, cleaned

def main():
    ap = argparse.ArgumentParser(description="сборка пилота по сценарию")
    ap.add_argument("--raw", action="store_true", help="игнорировать sources/чисто/, брать оригиналы")
    ap.add_argument("--level", type=float, default=LEVEL_STRENGTH,
                    help="выравнивание реплик между собой: 0 — выключить, 1 — под одну гребёнку")
    ap.add_argument("--wav", action="store_true", help="дополнительно сохранить мастер в WAV")
    ap.add_argument("--mp3", default=MP3_BITRATE, help=f"битрейт mp3 (по умолчанию {MP3_BITRATE})")
    ap.add_argument("--thr", choices=("auto", "fixed"), default=None,
                    help="пороги нарезки: auto — считать по файлу, fixed — из таблицы THR")
    args = ap.parse_args()

    paths, cleaned = resolve_sources(not args.raw)
    missing = [str(p) for p in paths.values() if not p.exists()]
    if missing:
        sys.exit("Нет исходников: " + ", ".join(missing))
    OUT.mkdir(exist_ok=True)
    print("декодирую исходники…")
    src = {k: decode(p) for k, p in paths.items()}
    env = {k: envelope(v) for k, v in src.items()}

    # пороги нарезки: у очищенных файлов фон другой, поэтому для них порог считается сам
    thr = {}
    for k in SOURCES:
        auto = auto_thr(env[k])
        use_auto = (args.thr == "auto") or (args.thr is None and cleaned[k])
        thr[k] = auto if use_auto else THR[k]
        print(f"  {paths[k].name:42s} {'очищённый' if cleaned[k] else 'оригинал':10s} "
              f"порог {thr[k]:+.1f} дБ {'(посчитан)' if use_auto else '(из таблицы)'}"
              + ("" if use_auto else f", сам посчитал бы {auto:+.1f}"))

    cues = parse_script()
    items, k = [], 0
    pend = {"extra": 0.0, "generic": 0.0, "scene": None}
    def take_gap():
        g = dict(pend); pend.update({"extra": 0.0, "generic": 0.0, "scene": None}); return g
    for ci, c in enumerate(cues):
        if c["type"] == "scene":
            pend["scene"] = c["n"]; continue
        if c["type"] == "dir":
            if ci in CONSUMED_DIR: continue
            if ci in SPECIAL_DIR:
                spk, text, part = SPECIAL_DIR[ci]
                items.append({"id": f"d{ci}", "gap": take_gap(), "spk": spk, "text": text,
                              "parts": [part] if part else None}); continue
            t = c["text"].lower()
            if "долгая пауза" in t: pend["extra"] += 1.5
            elif t.startswith("пауза") or t == "(пауза)": pend["extra"] += 0.7
            elif t.startswith("тишина"): pend["extra"] += 1.0
            else: pend["generic"] = min(1.2, pend["generic"] + 0.15)
            continue
        spk = c["spk"]
        if spk in ("ENER", "KEFI", "FLUR"):
            if k not in MAP:
                sys.exit(f"Реплика {k:03d} ({spk}: {c['text'][:40]}) не размечена в MAP — "
                         "похоже, сценарий изменился; см. CLAUDE.md")
            m = MAP[k]; parts = m if isinstance(m, list) else ([m] if m else None)
        else:
            parts = None
        items.append({"id": f"{k:03d}", "gap": take_gap(), "spk": spk, "text": c["text"],
                      "note": c.get("note", ""), "parts": parts})
        k += 1
    if k != len([c for c in cues if c["type"] == "line"]):
        sys.exit("ошибка разбора сценария")

    # вырезаем куски
    for it in items:
        ex = find_extra(it["id"])
        if ex:
            y = trim_silence(decode(ex))
            it["audio"] = fade(y * gain_to(y, CHAR_LUFS)); it["source"] = f"extra/{ex.name}"
            continue
        if it["parts"]:
            segs = []
            for (s, a, b) in it["parts"]:
                aa, bb = refine(env[s], thr[s], a, b, len(src[s]) / SR)
                segs.append((s, aa, bb))
            it["segs"] = segs; it["char"] = CHAR[segs[0][0]]
            it["source"] = " + ".join(f"{SOURCES[s]} {a:.2f}-{b:.2f}" for s, a, b in segs)

    # ---------------------------------------------------------- громкость
    # шаг 1: общий уровень каждого голоса (интегральная громкость всех его реплик)
    meter = pyln.Meter(SR); gains = {}
    for ch in ("ENER", "KEFI", "FLUR"):
        buf = [src[s][int(a * SR):int(b * SR)] for it in items if it.get("char") == ch
               for (s, a, b) in it["segs"]]
        if buf:
            L = meter.integrated_loudness(np.concatenate(buf))
            gains[ch] = 10 ** ((CHAR_LUFS - L) / 20)

    # шаг 2: собираем звук каждой реплики и меряем, насколько громко она прочитана
    for it in items:
        if "audio" in it or not it.get("segs"):
            continue
        pieces = []
        for n, (s, a, b) in enumerate(it["segs"]):
            if n:
                nat = a - it["segs"][n - 1][2]
                pieces.append(np.zeros(int(min(max(nat, 0.2), 1.0) * SR), np.float32))
            pieces.append(fade(src[s][int(a * SR):int(b * SR)] * gains[it["char"]]))
        it["audio"] = np.concatenate(pieces)
    for it in items:
        if "audio" in it:
            it["level"] = level_db(it["audio"])

    # шаг 3: подтягиваем голоса друг к другу и реплики внутри голоса — чтобы никто
    # не перекрикивал соседа, но живая разница между шёпотом и криком осталась
    by_voice = {}
    for it in items:
        if "level" in it:
            by_voice.setdefault(it.get("char") or it["spk"], []).append(it["level"])
    med = {k: float(np.median(v)) for k, v in by_voice.items()}
    # общий ориентир — медиана по голосам, а не по всем репликам: голос с сотней реплик
    # не должен перетягивать на себя тот уровень, к которому подтягиваются остальные
    common = float(np.median(list(med.values()))) if med else CHAR_LUFS
    voice_fix = {k: float(np.clip(args.level * (common - m), -4.0, 4.0)) for k, m in med.items()}
    manual = read_level_file(EXTRA_DIR / LEVEL_FILE)
    if manual:
        print("ручные поправки из extra/" + LEVEL_FILE + ": "
              + ", ".join(f"{k} {v:+g} дБ" for k, v in manual.items()))
    for it in items:
        if "level" not in it:
            continue
        who = it.get("char") or it["spk"]
        note = it.get("note", "")
        up = 2.0 if QUIET_RE.search(note) else LEVEL_MAX_UP      # шёпот не вытягиваем до крика
        down = 3.0 if LOUD_RE.search(note) else LEVEL_MAX_DOWN   # крик оставляем криком
        line_fix = float(np.clip(args.level * (med.get(who, common) - it["level"]), -down, up))
        fix = voice_fix.get(who, 0.0) + line_fix + manual.get(it["id"], 0.0) + manual.get(who, 0.0)
        it["fix"] = fix
        if abs(fix) > 0.01:
            it["audio"] = (it["audio"] * 10 ** (fix / 20)).astype(np.float32)
        it["level_after"] = it["level"] + fix
    for k in sorted(by_voice):
        before = np.array(by_voice[k])
        after = np.array([it["level_after"] for it in items
                          if "level_after" in it and (it.get("char") or it["spk"]) == k])
        print(f"  {NAME.get(k, k):16s} реплик {len(before):3d}   разброс "
              f"{before.max() - before.min():4.1f} → {after.max() - after.min():4.1f} дБ   "
              f"поправка голоса {voice_fix.get(k, 0.0):+.1f} дБ")

    # раскладка по времени
    placed, rows, sheet = [], [], []
    t = 0.6; prev = ""; scene = 1
    for it in items:
        g = it["gap"]
        if g["scene"] is not None:
            scene = g["scene"]; gap = 2.6 if scene > 1 else 0.0
            sheet.append(("", f"СЦЕНА {scene} — {ts(t + gap)}"))
        else:
            gap = (0.08 if prev.rstrip().endswith(("—", "-")) else 0.35) + g["generic"] + g["extra"]
        t += gap
        y = it.get("audio")
        if y is not None:
            placed.append((t, y)); dur = len(y) / SR
        else:
            dur = est_duration(it["text"])
            who = it["text"].split(": ", 1)[0].capitalize() if it["spk"] == "EXTRA" else NAME[it["spk"]]
            txt = it["text"].split(": ", 1)[1] if it["spk"] == "EXTRA" else re.sub(r"^[—\-]\s*", "", it["text"])
            tag = "НЕТ ЗАПИСИ — " if it["spk"] in ("ENER", "KEFI", "FLUR") else ""
            sheet.append((it["id"], f"  {ts(t)}  [{it['id']}] {tag}{who}: {txt}  ({dur:.1f} с)"))
            it["source"] = "— пауза —"
        rows.append([it["id"], scene, NAME.get(it["spk"], it["spk"]), it["text"],
                     it.get("source", ""), ts(t), f"{dur:.2f}",
                     f"{it['level']:.1f}" if "level" in it else "",
                     f"{it['fix']:+.1f}" if it.get("fix") else ""])
        t += dur; prev = it["text"]
    t += 1.5
    mix = np.zeros(int(t * SR) + SR, np.float32)
    for st, y in placed:
        i = int(st * SR); mix[i:i + len(y)] += y
    mix = mix[:int(t * SR)]

    # мастеринг
    raw, comp = OUT / "_mix_raw.wav", OUT / "_mix_comp.wav"
    mp3 = OUT / "пилот_сведение.mp3"
    sf.write(raw, mix, SR, subtype="FLOAT")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af",
                    "acompressor=threshold=0.1:ratio=2:attack=10:release=250:knee=4",
                    "-c:a", "pcm_f32le", str(comp)], check=True)
    x, _ = sf.read(comp, dtype="float32")
    g = MASTER_LUFS - pyln.Meter(SR).integrated_loudness(x)
    master_af = (f"volume={g:.2f}dB,alimiter=limit=0.84:level=false:attack=5:release=60,"
                 "aresample=44100")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(comp), "-af", master_af,
                    "-ac", "2", "-c:a", "libmp3lame", "-b:a", args.mp3, "-id3v2_version", "3",
                    "-metadata", "title=Пилот — сведение", str(mp3)], check=True)
    if args.wav:
        wav = OUT / "пилот_сведение.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(comp), "-af", master_af,
                        "-ac", "2", "-c:a", "pcm_s24le", str(wav)], check=True)
        print(f"мастер без сжатия: {wav.relative_to(ROOT)}")
    raw.unlink(); comp.unlink()

    # отчёты
    head = ["Пилот — паузы под реплики, которых нет в записях",
            "Время — по файлу пилот_сведение.mp3 (мин:сек), в скобках — длина паузы.",
            "В квадратных скобках — номер реплики: запись для неё кладётся в extra/ под этим именем",
            "(например extra/051.wav), после чего сборка запускается заново.", ""]
    body = []
    for _, line in sheet:
        if line.startswith("СЦЕНА"): body += ["", line]
        else: body.append(line)
    (OUT / "пилот_паузы.txt").write_text("\n".join(head + body).strip() + "\n", encoding="utf-8")
    with open(OUT / "разметка.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["номер", "сцена", "кто", "текст", "откуда взято", "позиция в сведении",
                    "длительность, с", "уровень, дБ", "поправка, дБ"])
        w.writerows(rows)

    # отчёт по громкости: что подтянули и какие реплики стоит послушать
    lv = ["Громкость — что выровнялось",
          f"Сила выравнивания: {args.level:g} (0 — выключено, 1 — все реплики под одну гребёнку).",
          f"Поправку можно задать руками в extra/{LEVEL_FILE}: строка «242 -3» — тише реплику 242",
          "на 3 дБ, строка «Кэфи -1» — весь голос на 1 дБ. Плюс громче, минус тише.", ""]
    for k in sorted(by_voice):
        before = np.array(by_voice[k])
        after = np.array([it["level_after"] for it in items
                          if "level_after" in it and (it.get("char") or it["spk"]) == k])
        lv.append(f"{NAME.get(k, k)}: реплик {len(before)}, разброс "
                  f"{before.max() - before.min():.1f} → {after.max() - after.min():.1f} дБ, "
                  f"весь голос {voice_fix.get(k, 0.0):+.1f} дБ")
    lv += ["", "Сильнее всего поправлено (проверить на слух):"]
    strong = sorted((it for it in items if abs(it.get("fix", 0.0)) > 0.05),
                    key=lambda it: -abs(it["fix"]))[:15]
    for it in strong:
        short = re.sub(r"\s+", " ", it["text"])[:58]
        lv.append(f"  [{it['id']}] {NAME.get(it['spk'], it['spk'])}: {short}  {it['fix']:+.1f} дБ"
                  + ("  (была громче остальных)" if it["fix"] < 0 else "  (была тише остальных)"))
    (OUT / "громкость.txt").write_text("\n".join(lv) + "\n", encoding="utf-8")
    n_p = sum(1 for i, _ in sheet if i)
    print(f"готово: {mp3.relative_to(ROOT)} — {t / 60:.1f} мин, {len(placed)} реплик, {n_p} пауз")
    print("отчёты: out/разметка.csv, out/пилот_паузы.txt, out/громкость.txt")

if __name__ == "__main__":
    main()
