#!/usr/bin/env python3
"""
Распознаёт русскую речь с таймкодами — чтобы найти, где в длинной записи лежит нужная реплика.

    pip install sherpa-onnx
    python tools/recognize.py sources/кэфи.mp3            # печать «начало-конец  текст»
    python tools/recognize.py sources/кэфи.mp3 --json out/кэфи.json

При первом запуске скачивает модели (~170 МБ) в tools/models/:
  GigaAM v2 (русский, CTC) и Silero VAD — из релизов k2-fsa/sherpa-onnx на GitHub.
"""
import json, subprocess, sys, tarfile, urllib.request
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
REL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
ASR_NAME = "sherpa-onnx-nemo-ctc-giga-am-v2-russian-2025-04-19"
SR = 16000

def ensure_models():
    MODELS.mkdir(exist_ok=True)
    vad = MODELS / "silero_vad.onnx"
    if not vad.exists():
        print("скачиваю VAD…", file=sys.stderr)
        urllib.request.urlretrieve(REL + "silero_vad.onnx", vad)
    asr = MODELS / ASR_NAME
    if not asr.exists():
        print("скачиваю модель распознавания (~170 МБ)…", file=sys.stderr)
        tb = MODELS / (ASR_NAME + ".tar.bz2")
        urllib.request.urlretrieve(REL + ASR_NAME + ".tar.bz2", tb)
        with tarfile.open(tb) as t:
            t.extractall(MODELS)
        tb.unlink()
    return vad, asr

def decode16(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-af", "pan=mono|c0=c0",
                          "-f", "f32le", "-ar", str(SR), "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()

def main():
    import sherpa_onnx
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    out_json = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
    vad_path, asr_dir = ensure_models()
    rec = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
        model=str(asr_dir / "model.int8.onnx"), tokens=str(asr_dir / "tokens.txt"),
        num_threads=2, decoding_method="greedy_search")
    cfg = sherpa_onnx.VadModelConfig()
    cfg.silero_vad.model = str(vad_path)
    cfg.silero_vad.threshold = 0.45
    cfg.silero_vad.min_silence_duration = 0.25
    cfg.silero_vad.min_speech_duration = 0.1
    cfg.silero_vad.max_speech_duration = 30
    cfg.sample_rate = SR
    vad = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=120)
    x = decode16(path)
    segs, win = [], cfg.silero_vad.window_size
    def drain():
        while not vad.empty():
            s = vad.front; segs.append((s.start, s.start + len(s.samples))); vad.pop()
    for i in range(0, len(x), win):
        vad.accept_waveform(x[i:i + win]); drain()
    vad.flush(); drain()
    res = []
    for a, b in segs:
        st = rec.create_stream(); st.accept_waveform(SR, x[a:b]); rec.decode_stream(st)
        res.append({"start": round(a / SR, 2), "end": round(b / SR, 2), "text": st.result.text.strip()})
        print(f"{a / SR:8.2f}-{b / SR:8.2f}  {st.result.text.strip()}")
    if out_json:
        Path(out_json).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    # VAD иногда пропускает шёпот и крики и подрезает начала слов — границы стоит
    # проверять по огибающей громкости (build.py делает это сам через refine()).

if __name__ == "__main__":
    main()
