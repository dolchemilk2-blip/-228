// Монтажка — интерфейс: файлы, распознавание (в воркере), проверка, сведение, выгрузка.
import * as C from './core.js';

const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
const LAME = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
// «Обычно» — каждый кусок распознаётся отдельно: текст точно принадлежит своему куску.
// «Черновик» — кусками по 28 с: втрое быстрее, но изредка путает соседние короткие реплики.
const PRESETS = {
  draft:  { model: 'onnx-community/whisper-base',  pack: true },
  normal: { model: 'onnx-community/whisper-base',  pack: false },
  best:   { model: 'onnx-community/whisper-small', pack: false },
};
const DEBUG = new URLSearchParams(location.search).has('debug');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const S = {
  scriptText: '', P: null, files: [], matches: new Map(),
  edits: {}, gains: {}, voiced: {}, voiceGains: {}, timing: {}, tempo: 1, fxVoice: {}, fxLine: {}, takePick: {}, amb: null, uploads: new Map(),
  preset: 'normal', result: null, busy: false, filter: 'all', showDirs: false,
  tab: location.hash === '#clean' ? 'clean' : 'build', cleanFile: null,
};
const PALETTE = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
const colorOf = key => { const i = S.P ? S.P.chars.findIndex(c => c.key === key) : -1; return PALETTE[(i < 0 ? 0 : i) % PALETTE.length]; };
const charName = key => (S.P && S.P.chars.find(c => c.key === key) || { name: key }).name;

// ------------------------------------------------------------------ состояние правок
const editsKey = () => 'montage:' + hash(S.scriptText);
function saveEdits() { store.set(editsKey(), { edits: S.edits, gains: S.gains, voiced: S.voiced, voiceGains: S.voiceGains, timing: S.timing, tempo: S.tempo, fxVoice: S.fxVoice, fxLine: S.fxLine, amb: ambSaved(), takes: S.takePick, sfx: S.sfxSaved || {} }); }
function loadEdits() { const v = store.get(editsKey()); S.edits = v?.edits || {}; S.gains = v?.gains || {}; S.voiced = v?.voiced || {}; S.voiceGains = v?.voiceGains || {}; S.timing = v?.timing || {}; S.tempo = v?.tempo || 1; S.fxVoice = v?.fxVoice || {}; S.fxLine = v?.fxLine || {}; S.amb = v?.amb ? { duck: 8, scenes: {}, cands: {}, ...v.amb } : null; S.takePick = v?.takes || {}; S.sfxSaved = v?.sfx || {}; sfxState().cues = JSON.parse(JSON.stringify(S.sfxSaved)); }

// ------------------------------------------------------------------ звук
let actx = null, playing = null;
function audioCtx() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); return actx; }
/** Общий выход: всё, что звучит, проходит через анализатор — по нему дышит «эфир» в шапке. */
let outNode = null, analyser = null, levelBuf = null;
function audioOut() {
  const ctx = audioCtx();
  if (!outNode) { analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.6; outNode = ctx.createGain(); outNode.connect(analyser); analyser.connect(ctx.destination); levelBuf = new Float32Array(analyser.fftSize); }
  if (typeof deckKick === 'function') deckKick();
  return outNode;
}
function audioLevel() {
  if (!analyser || (!playing && !TP.playing && !(typeof ab !== 'undefined' && ab))) return 0;
  analyser.getFloatTimeDomainData(levelBuf); let s = 0; for (const v of levelBuf) s += v * v; return Math.sqrt(s / levelBuf.length);
}
function play(samples, btn) {
  stop();
  const ctx = audioCtx(); ctx.resume();
  const b = ctx.createBuffer(1, samples.length, C.SR); b.copyToChannel(samples, 0);
  const src = ctx.createBufferSource(); src.buffer = b; src.connect(audioOut()); src.start();
  playing = { src, btn }; if (btn) btn.classList.add('on');
  src.onended = () => { if (playing && playing.src === src) stop(); };
}
function stop() { if (playing) { try { playing.src.stop(); } catch {} playing.btn?.classList.remove('on'); playing = null; } if (typeof abStop === 'function') abStop(); if (typeof tpPause === 'function') tpPause(); }

async function decodeFile(file) {
  const buf = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, C.SR);
  const ab = await ctx.decodeAudioData(buf);
  const n = ab.length, y = new Float32Array(n);
  for (let ch = 0; ch < ab.numberOfChannels; ch++) { const d = ab.getChannelData(ch); for (let i = 0; i < n; i++) y[i] += d[i] / ab.numberOfChannels; }
  return y;
}
const slice = (f, a, b) => f.y48.subarray(Math.max(0, Math.round(a * C.SR)), Math.min(f.y48.length, Math.round(b * C.SR)));

// ------------------------------------------------------------------ кэш распознавания (IndexedDB)
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('montage', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('asr');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { try { const db = await open(); return await new Promise((res, rej) => { const t = db.transaction('asr', mode); const q = fn(t.objectStore('asr')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); } catch { return undefined; } };
  return { get: k => tx('readonly', s => s.get(k)), put: (k, v) => tx('readwrite', s => s.put(v, k)) };
})();

// ------------------------------------------------------------------ распознавание в воркере
const WORKER_SRC = `
let pipe = null;
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      const T = await import(m.url);
      T.env.allowLocalModels = false;
      const opt = m.device === 'webgpu'
        ? { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } }
        : { device: 'wasm', dtype: 'q8' };
      pipe = await T.pipeline('automatic-speech-recognition', m.model, {
        ...opt, progress_callback: p => { if (p.status === 'progress') self.postMessage({ type: 'dl', file: p.file, loaded: p.loaded, total: p.total }); } });
      // пустой отрезок (два штампа времени подряд, смена языка без текста) — у библиотеки это ошибка
      // «token_ids must be a non-empty array», а для нас просто пустой текст
      const tok = pipe.tokenizer, dec = tok.decode.bind(tok);
      tok.decode = (ids, args) => Array.isArray(ids) && !ids.length ? '' : dec(ids, args);
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'run') {
      const out = await pipe(m.audio, { language: 'russian', task: 'transcribe', return_timestamps: m.stamps,
                                        chunk_length_s: 30, stride_length_s: 5, no_repeat_ngram_size: 4 });
      self.postMessage({ type: 'text', id: m.id, text: out.text, chunks: out.chunks || [] });
    }
  } catch (err) { self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) }); }
};`;
let worker = null, workerModel = null, workerDevice = null;
async function getWorker(modelId, onDl) {
  if (worker && workerModel === modelId) return worker;
  if (worker) worker.terminate();
  const tryDevice = async device => {
    const w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })), { type: 'module' });
    await new Promise((res, rej) => {
      w.onmessage = e => { const m = e.data; if (m.type === 'dl') onDl(m); else if (m.type === 'ready') res(); else if (m.type === 'error') rej(new Error(m.message)); };
      w.onerror = e => rej(new Error(e.message || 'воркер не запустился'));
      w.postMessage({ type: 'load', url: TJS, model: modelId, device });
    });
    return w;
  };
  let w = null;
  if (navigator.gpu && !new URLSearchParams(location.search).has('cpu')) {
    try { w = await tryDevice('webgpu'); workerDevice = 'видеокарта'; } catch { w = null; }
  }
  if (!w) { w = await tryDevice('wasm'); workerDevice = 'процессор'; }
  worker = w; workerModel = modelId; return w;
}
/**
 * Распознаватель: в фоновом воркере (страница не подвисает), а если воркер не запускается —
 * так бывает, когда страница открыта с диска (file://), — прямо на странице.
 */
let rec = null;
async function getRecognizer(modelId, onDl) {
  if (rec && rec.model === modelId) return rec;
  try {
    const w = await getWorker(modelId, onDl);
    rec = { model: modelId, run: (audio, stamps) => transcribe(w, audio, stamps) };
    return rec;
  } catch (err) { console.warn('воркер недоступен, распознаю на странице:', err.message); }
  const T = await import(TJS);
  T.env.allowLocalModels = false;
  const dl = p => { if (p.status === 'progress') onDl({ file: p.file, loaded: p.loaded, total: p.total }); };
  let pipe = null;
  if (navigator.gpu && !new URLSearchParams(location.search).has('cpu')) {
    try { pipe = await T.pipeline('automatic-speech-recognition', modelId, { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback: dl }); workerDevice = 'видеокарта'; }
    catch { pipe = null; }
  }
  if (!pipe) { pipe = await T.pipeline('automatic-speech-recognition', modelId, { device: 'wasm', dtype: 'q8', progress_callback: dl }); workerDevice = 'процессор'; }
  { const tok = pipe.tokenizer, dec = tok.decode.bind(tok); tok.decode = (ids, args) => Array.isArray(ids) && !ids.length ? '' : dec(ids, args); }
  rec = { model: modelId, run: async (audio, stamps) => {
    await new Promise(r => setTimeout(r, 0));          // дать странице отрисовать прогресс
    const out = await pipe(audio, { language: 'russian', task: 'transcribe', return_timestamps: stamps, chunk_length_s: 30, stride_length_s: 5, no_repeat_ngram_size: 4 });
    return { text: out.text, chunks: out.chunks || [] };
  } };
  return rec;
}
function transcribe(w, audio, stamps = true) {
  return new Promise((res, rej) => {
    const id = Math.random().toString(36).slice(2);
    w.onmessage = e => { const m = e.data; if (m.id !== id) return; m.type === 'error' ? rej(new Error(m.message)) : res(m); };
    w.postMessage({ type: 'run', id, audio, stamps }, [audio.buffer]);
  });
}

/**
 * Куски пакуются в окна до 28 с с паузами 1,2 с между ними: распознаватель всегда считает
 * окно в 30 с, и короткие реплики по одной обходятся в разы дороже. Текст возвращается к
 * кускам по отметкам времени.
 */
function pack(segs, y16) {
  const GAP = 1.2, MAX = 28, wins = [];
  let cur = null;
  for (const s of segs) {
    const d = s.b - s.a;
    if (!cur || cur.len + GAP + d > MAX) { cur = { parts: [], len: 0 }; wins.push(cur); }
    const off = cur.parts.length ? cur.len + GAP : 0;
    cur.parts.push({ seg: s, off, d }); cur.len = off + d;
  }
  return wins.map(w => {
    const buf = new Float32Array(Math.ceil((w.len + 0.2) * C.ASR_SR));
    for (const p of w.parts) buf.set(y16.subarray(Math.round(p.seg.a * C.ASR_SR), Math.round(p.seg.b * C.ASR_SR)), Math.round(p.off * C.ASR_SR));
    return { ...w, buf };
  });
}
// ------------------------------------------------------------------ разбор записей
async function analyze() {
  if (S.busy) return;
  if (!S.P) return notify('Сначала вставьте сценарий.');
  const files = S.files.filter(f => f.chars.size);
  if (!files.length) return notify('Добавьте записи и отметьте, кто в них говорит.');
  S.busy = true; render();
  try {
    for (const f of files) {
      if (!f.y48) { progress(`Читаю ${f.name}…`, 0); f.y48 = await decodeFile(f.file); f.dur = f.y48.length / C.SR; }
      if (!f.y16) { f.y16 = C.to16k(f.y48); f.env16 = envelope10(f.y16); }
      if (!f.segs) f.segs = C.segmentSpeech(f.y16).segs.map(s => ({ ...s, text: null }));
    }
    const preset = PRESETS[S.preset], model = preset.model, PACK = preset.pack;
    const ck = s => `${s.a}|${s.b}|${model}|${PACK ? 'p' : 's'}`;
    const need = [];
    for (const f of files) for (const s of f.segs) {
      if (s.text != null && s.by === S.preset) continue;
      s.text = null;
      const cached = await idb.get(`${f.fkey}|${ck(s)}`);
      if (cached != null) { s.text = cached; s.by = S.preset; } else need.push({ f, s });
    }
    let failed = 0;
    if (need.length) {
      progress('Загружаю распознавание речи — один раз, дальше из кэша браузера…', 0);
      const w = await getRecognizer(model, m => { if (m.total) progress(`Загружаю распознавание речи: ${m.file.split('/').pop()} — ${(m.loaded / 1e6).toFixed(0)} из ${(m.total / 1e6).toFixed(0)} МБ`, m.loaded / m.total); });
      const total = need.reduce((s, x) => s + x.s.b - x.s.a, 0); let done = 0; const t0 = performance.now();
      // кусок, на котором распознаватель упал (редкие сбои декодера), пробуется ещё раз, потом остаётся пустым — разбор идёт дальше
      const runSafe = async (buf, stamps) => {
        try { return await w.run(buf, stamps); }
        catch (e1) { console.warn('кусок не распознался, пробую ещё раз:', e1.message);
          try { return await w.run(buf, !stamps); } catch (e2) { if (++failed > 8) throw e2; return { text: '', chunks: [], failed: true }; } }
      };
      for (const f of files) {
        const mine = need.filter(x => x.f === f).map(x => x.s);
        const wins = PACK ? pack(mine, f.y16) : mine.map(sg => ({ parts: [{ seg: sg, off: 0, d: sg.b - sg.a }], len: sg.b - sg.a,
          buf: f.y16.slice(Math.round(sg.a * C.ASR_SR), Math.round(sg.b * C.ASR_SR)) }));
        for (const win of wins) {
          const out = await runSafe(win.buf, PACK);
          if (DEBUG) (S.debug = S.debug || []).push({ file: f.name, parts: win.parts.map(p => ({ a: p.seg.a, b: p.seg.b, off: p.off, d: p.d })), chunks: out.chunks, text: out.text });
          const texts = PACK ? C.unpackWindow(win, out.chunks.length ? out.chunks : [{ timestamp: [0, win.len], text: out.text }]) : [out.text];
          // окно испорчено (зацикливание съело конец) или кусок остался без текста — такие
          // куски распознаются заново по одному: зацикливание тогда портит только сам кусок
          const looped = C.isLooped(out.text);
          for (let i = 0; i < win.parts.length; i++) {
            const p = win.parts[i];
            if (PACK && (looped || !texts[i] || C.isLooped(texts[i]))) {
              if (p.d >= 0.25) {
                const one = f.y16.slice(Math.round(p.seg.a * C.ASR_SR), Math.round(p.seg.b * C.ASR_SR));
                const r = await runSafe(one, false);
                texts[i] = r.text; if (r.failed) out.failed = true;
              }
            }
            p.seg.text = C.tameLoop((texts[i] || '').trim()); p.seg.by = S.preset;
            if (!out.failed) idb.put(`${f.fkey}|${ck(p.seg)}`, p.seg.text);   // сбойный кусок не кэшируется — в следующий раз попробуется снова
          }
          done += win.parts.reduce((s, p) => s + p.d, 0);
          const el = (performance.now() - t0) / 1000, left = el / done * (total - done);
          progress(`Распознаю речь (${workerDevice}): ${f.name} — ${Math.round(100 * done / total)} %, осталось ≈ ${left > 90 ? Math.round(left / 60) + ' мин' : Math.round(left) + ' с'}`, done / total);
        }
      }
    }
    progress('Сопоставляю со сценарием…', 1);
    matchAll();
    progress('', 0);
    if (failed) notify(`${failed} ${failed === 1 ? 'кусок остался' : 'кусков остались'} без текста: распознаватель на них сбоил. Запустите разбор ещё раз — они попробуются снова.`);
  } catch (err) {
    console.error(err);
    notify('Не получилось: ' + err.message + '. Если это ошибка загрузки — проверьте интернет и попробуйте ещё раз; уже распознанное сохранилось.');
  } finally { S.busy = false; render(); }
}
function envelope10(y) {
  const w = 320, h = 160, n = Math.max(0, 1 + Math.floor((y.length - w) / h)), cs = new Float64Array(y.length + 1);
  for (let i = 0; i < y.length; i++) cs[i + 1] = cs[i] + y[i] * y[i];
  const e = new Float32Array(n); for (let k = 0; k < n; k++) e[k] = 10 * Math.log10((cs[k * h + w] - cs[k * h]) / w + 1e-14);
  return e;
}

function matchAll() {
  const cues = S.P.cues;
  const dirs = cues.filter(c => c.type === 'dir').map(c => ({ key: c.id, t: C.norm(c.text), raw: c.text, ci: c.ci }));
  const per = S.files.map(f => {
    if (!f.segs || !f.chars.size || f.segs.some(s => s.text == null)) return new Map();
    const segs = f.segs.map(s => { const noise = C.isNoiseText(s.text); return { ...s, noise, t: noise ? '' : C.norm(C.cleanAsr(s.text)) }; });
    const lines = cues.filter(c => c.type === 'line' && f.chars.has(c.spk))
      .map(c => ({ key: c.id, t: C.norm(c.text), raw: c.text, ci: c.ci, sound: C.isSoundOnly(c.text) }));
    const m = C.matchFile(lines, dirs, segs, { env: f.env16 });
    for (const v of m.values()) v.voice = [...f.chars][0];
    return m;
  });
  S.matches = C.mergeMatches(per);
  for (const [k, v] of S.matches) {                  // озвученные ремарки: по умолчанию берём уверенные
    if (!k.startsWith('d') || k in S.voiced) continue;
    const cue = cues.find(c => c.id === k);
    v.defaultOn = (v.how === 'text' && v.sim >= 0.6) || (v.how === 'order' && C.isSoundOnly(cue.text));
  }
  if (typeof computeTakes === 'function') computeTakes();
}

// что звучит в реплике: своя запись > ручной выбор > автоматика
function sourceOf(cue) {
  if (S.uploads.has(cue.id)) return { kind: 'upload', ...S.uploads.get(cue.id) };
  const e = S.edits[cue.id];
  if (e && e.none) return null;
  if (e && e.pieces) {
    const pieces = e.pieces.map(p => ({ ...p, f: S.files.find(f => f.name === p.file) })).filter(p => p.f && p.f.y48);
    return pieces.length ? { kind: 'manual', pieces } : null;
  }
  const m = S.matches.get(cue.id);
  if (!m) return null;
  const tk = typeof takeOf === 'function' ? takeOf(cue.id) : null;
  if (tk && !tk.t.main) { const tf = S.files[tk.t.file]; if (tf && tf.y48) return { kind: 'take', sim: tk.t.sim, text: tk.t.text, take: tk.i, takes: tk.n, auto: tk.i === tk.best && S.takePick[cue.id] == null, pieces: tk.t.pieces.map(p => ({ ...p, f: tf, file: tf.name })) }; }
  const f = S.files[m.file];
  return f && f.y48 ? { kind: m.how, sim: m.sim, group: m.group, text: m.text, take: tk ? tk.i : null, takes: tk ? tk.n : 0, pieces: m.pieces.map(p => ({ ...p, f, file: f.name })) } : null;
}
function isVoicedDir(cue) {
  if (cue.type !== 'dir') return false;
  if (S.uploads.has(cue.id) || S.edits[cue.id]?.pieces) return true;
  if (cue.id in S.voiced) return S.voiced[cue.id] && !!S.matches.get(cue.id);
  return !!S.matches.get(cue.id)?.defaultOn;
}
function audioOfSource(src) {
  if (!src) return null;
  if (src.kind === 'upload') return src.y48;
  const parts = [];
  src.pieces.forEach((p, n) => {
    if (n) { const nat = p.a - src.pieces[n - 1].b; parts.push(new Float32Array(Math.round(Math.min(Math.max(nat, 0.2), 1.0) * C.SR))); }
    parts.push(C.fade(slice(p.f, p.a, p.b)));
  });
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function statusOf(cue) {
  const src = sourceOf(cue);
  if (!src) return (S.edits[cue.id]?.none) ? { k: 'none', t: 'без записи' } : { k: 'miss', t: 'нет записи' };
  if (src.kind === 'upload') return { k: 'own', t: 'своя запись' };
  if (src.kind === 'manual') return { k: 'ok', t: 'выбрано вручную' };
  if (src.kind === 'take') return src.sim >= 0.6 ? { k: 'ok', t: `дубль ${src.take + 1} из ${src.takes}${src.auto ? ' — лучший' : ''}` } : { k: 'check', t: `дубль ${src.take + 1} из ${src.takes} — проверить` };
  if (src.kind === 'order') return { k: 'check', t: 'по порядку — проверить' };
  if (src.kind === 'moved') return src.sim >= 0.7 ? { k: 'ok', t: 'найдено не по порядку' } : { k: 'check', t: 'не по порядку — проверить' };
  if (src.group > 1) return { k: 'check', t: 'в общем куске — проверить' };
  if (src.sim < 0.5) return { k: 'check', t: 'похоже — проверить' };
  return { k: 'ok', t: 'найдено' };
}

// ------------------------------------------------------------------ сведение
async function mixdown() {
  if (S.busy) return;
  S.busy = true; render(); progress('Свожу…', 0.1);
  await new Promise(r => setTimeout(r, 30));
  try {
    if (typeof dbRestore === 'function') await dbRestore();      // звуки из базы, которых ещё нет (проект открыт на другом компьютере)
    const strength = +$('#lvl').value, target = +$('#lufs').value;
    const items = [];
    const voiceOf = cue => cue.type === 'line' ? cue.spk : (S.matches.get(cue.id)?.voice || 'ремарки');
    for (const cue of S.P.cues) {
      if (cue.type === 'scene' || (cue.type === 'dir' && !isVoicedDir(cue))) continue;
      const y = audioOfSource(sourceOf(cue));
      if (y) items.push({ id: cue.id, cue, voice: voiceOf(cue), text: cue.text, note: cue.note || '', audio: y });
    }
    if (!items.length && !(S.sfx && Object.values(S.sfx.cues).some(c => c.on && c.src))) throw new Error('нет ни одной реплики с записью');
    C.levelLines(items, { strength, manual: S.gains });
    for (const it of items) { it.audio0 = it.audio; it.fix0 = it.fix; it.levelAfter0 = it.levelAfter; it.man0 = S.gains[it.id] || 0; }   // выровненный звук — основа для регуляторов персонажей
    const byId = new Map(items.map(it => [it.id, it]));
    if (S.result && S.result.url) URL.revokeObjectURL(S.result.url);
    S.result = { items, byId, strength, target, at: new Date() };
    progress('Свожу: громкость и лимитер…', 0.6);
    await new Promise(r => setTimeout(r, 30));
    if (typeof fxPool === 'function') fxPool();          // потоки эффектов прогреваются заранее
    await remix('full');
    progress('', 0);
  } catch (err) { console.error(err); notify('Свести не получилось: ' + err.message); }
  finally { S.busy = false; render(); }
}
/** Звук реплики в дорожку: эффект (из кэша) × громкость персонажа × ручная поправка после выравнивания. */
function itemAudio(it) {
  const vg = (S.voiceGains[it.voice] || 0) + ((S.gains[it.id] || 0) - (it.man0 || 0)), g = Math.pow(10, vg / 20);
  it.fix = it.fix0 + vg; it.levelAfter = it.levelAfter0 + vg;
  const fx = it.fxKey && it._fx && it._fx.k === it.fxKey ? it._fx : null;
  const base = fx ? fx.y : it.audio0;
  it.core = fx ? fx.core : null;
  if (it._out && it._out.base === base && it._out.vg === vg) { it.audio = it._out.y; return; }
  it.audio = vg ? base.map(v => v * g) : base;
  it._out = { base, vg, y: it.audio };
}
/**
 * Сведение по частям. 'full' — точно: раскладка, сумма, фон, мастер с измерением громкости (как при скачивании).
 * 'layout' — сдвиги, темп, фон: раскладка и сумма заново, общее усиление прежнее, лимитер только у пиков.
 * 'lines' — эффект или громкость у части реплик: пересчитываются только их куски дорожки.
 */
async function remix(mode = 'full', ids = null) {
  const r = S.result; if (!r) return;
  const T = [performance.now()], lap = k => { T.push(performance.now()); if (DEBUG) console.info(`сведение (${mode}): ${k} ${((T.at(-1) - T.at(-2)) / 1000).toFixed(2)} с`); };
  if (mode !== 'full' && (!r.lay || !r.out || r.gain == null)) mode = 'full';
  const items = mode === 'lines' && ids ? r.items.filter(it => ids.has(it.id)) : r.items;
  const fxN = typeof ensureFx === 'function' ? await ensureFx(items) : 0;
  lap(`эффекты (${fxN} реплик)`);
  const before = new Map(); if (mode === 'lines') for (const p of r.lay.placed) if (p.item && ids.has(p.item.id)) before.set(p.item.id, p.audio.length);
  for (const it of items) itemAudio(it);
  lap('громкость');
  if (mode === 'lines') { if (remixLines(r, ids, before)) { lap('куски дорожки'); r.approx = true; S.tlTracks = null; return; } mode = 'layout'; }
  const lay = C.layout(S.P.cues, cue => { const it = r.byId.get(cue.id); if (it) return it.core != null ? { audio: it.audio, core: it.core } : it.audio; return cue.type === 'dir' && sfxIsSeq(cue) ? sfxAudio(cue.id) : null; },
    cue => isVoicedDir(cue) || sfxIsSeq(cue), sfxBed, { tempo: S.tempo || 1, timing: S.timing });
  lay.placed.forEach(p => { p.item = r.byId.get(p.cue.id); });
  r.lay = lay; S.tlTracks = null;
  lap('раскладка');
  const N = Math.ceil(lay.total * C.SR);                // буфер дорожки переиспользуется, с запасом в минуту: выделять 200 МБ на каждую правку — долго
  if (!r.mixBuf || r.mixBuf.length < N || r.mixBuf.length > N + 120 * C.SR) { r.out = null; r.mixBuf = null; r.mixBuf = new Float32Array(N + 60 * C.SR); }
  const mix = r.mixBuf.subarray(0, N); mix.fill(0);
  for (const p of lay.placed) { const i0 = Math.round(p.at * C.SR), n = Math.min(p.audio.length, Math.max(0, mix.length - i0)); for (let i = 0; i < n; i++) mix[i0 + i] += p.audio[i]; }   // всё суммой: реплики могут наезжать друг на друга
  lap('сумма');
  r.amb = typeof ambMix === 'function' ? ambMix(mix, lay) : [];
  lap('фон');
  if (mode === 'full') { const m = C.master(mix, lay.placed, { targetLufs: r.target }); r.out = m.out; r.master = m; r.gain = Math.pow(10, m.gainDb / 20); r.approx = false; }
  else { for (let i = 0; i < mix.length; i++) mix[i] *= r.gain; r.out = C.limit(mix, 0.84, true); r.approx = true; }
  lap('мастер');
  tpLoad(r.out);
  lap('плеер');
}
/** Пересчёт кусков дорожки под изменившимися репликами. false — изменений слишком много, проще целиком. */
function remixLines(r, ids, before) {
  TP.hold = true;
  try { return remixLinesInner(r, ids, before); } finally { TP.hold = false; if (TP.dirty) { TP.dirty = false; if (TP.playing) tpPlay(tpTime()); } }
}
function remixLinesInner(r, ids, before) {
  const SR = C.SR, n = r.out.length, spans = [];
  for (const p of r.lay.placed) {
    if (!p.item || !ids.has(p.item.id)) continue;
    const old = before.get(p.item.id) || 0; p.audio = p.item.audio;
    const a = Math.round(p.at * SR), b = a + Math.max(old, p.audio.length); spans.push([a, Math.min(n, b)]);
  }
  if (!spans.length) return true;
  spans.sort((x, y) => x[0] - y[0]);
  const la = Math.round(0.02 * SR), settle = Math.round(0.6 * SR), merged = [];
  for (const [a, b] of spans) { const A = Math.max(0, a - la), B = Math.min(n, b + settle); const m = merged[merged.length - 1]; if (m && A <= m[1]) m[1] = Math.max(m[1], B); else merged.push([A, B]); }
  if (merged.reduce((s, [a, b]) => s + b - a, 0) > 0.6 * n) return false;
  const ceil = 0.84, lim = ceil / r.gain;
  const pre = (a, b) => {                              // сумма всего, что звучит на [a, b), до мастера
    const y = new Float32Array(b - a);
    for (const p of r.lay.placed) { const i0 = Math.round(p.at * SR), s0 = Math.max(a, i0), s1 = Math.min(b, i0 + p.audio.length); for (let i = s0; i < s1; i++) y[i - a] += p.audio[i - i0]; }
    for (const c of r.amb || []) { const i0 = Math.round(c.at * SR), s0 = Math.max(a, i0), s1 = Math.min(b, i0 + c.audio.length); for (let i = s0; i < s1; i++) y[i - a] += c.audio[i - i0]; }
    return y;
  };
  for (let [a, b] of merged) {
    // границы — где лимитер точно отпущен: пиков нет за 0,6 с до начала и на 20 мс после конца
    for (let guard = 0; guard < 20 && a > 0; guard++) { const w = pre(Math.max(0, a - settle), a); let hit = -1; for (let i = w.length - 1; i >= 0; i--) if (w[i] > lim || w[i] < -lim) { hit = i; break; } if (hit < 0) break; a = Math.max(0, a - settle + hit - la); }
    for (let guard = 0; guard < 20 && b < n; guard++) { const w = pre(b, Math.min(n, b + la)); let hit = false; for (const v of w) if (v > lim || v < -lim) { hit = true; break; } if (!hit) break; b = Math.min(n, b + settle); }
    const y = pre(a, b); for (let i = 0; i < y.length; i++) y[i] *= r.gain;
    C.limit(y, ceil, true); r.out.set(y, a); tpUpdate(a, b);
  }
  return true;
}
// ------------------------------------------------------------------ плеер из памяти: без сборки WAV, правки слышны сразу
const TP = { buf: null, src: null, startAt: 0, offset: 0, playing: false, len: 0, hold: false, dirty: false };
/** Буфер плеера с запасом в минуту: сдвиги меняют длину дорожки, а новый буфер на 200 МБ — это секунда. */
function tpLoad(out) {
  const ctx = audioCtx(); TP.len = out.length;
  if (!TP.buf || TP.buf.length < out.length || TP.buf.length > out.length + 120 * C.SR) TP.buf = ctx.createBuffer(1, out.length + 60 * C.SR, C.SR);
  TP.buf.copyToChannel(out, 0);
  if (TP.buf.length > out.length) TP.buf.getChannelData(0).fill(0, out.length);
  TP.offset = Math.min(TP.offset, out.length / C.SR);
  if (TP.playing) tpPlay(tpTime());
}
function tpUpdate(a, b) { if (!TP.buf) return; TP.buf.copyToChannel(S.result.out.subarray(a, b), 0, a); if (TP.playing && (b / C.SR) > tpTime()) { if (TP.hold) TP.dirty = true; else tpPlay(tpTime()); } }
function tpTime() { return TP.playing ? Math.min(TP.len / C.SR, audioCtx().currentTime - TP.startAt) : TP.offset; }
function tpPlay(t = tpTime()) {
  if (!TP.buf) return; const ctx = audioCtx(); if (ctx.state === 'suspended') ctx.resume();
  if (TP.src) { TP.src.onended = null; try { TP.src.stop(); } catch {} }
  if (playing) { try { playing.src.stop(); } catch {} playing.btn?.classList.remove('on'); playing = null; }
  t = Math.max(0, Math.min(t, TP.len / C.SR - 0.01));
  const src = ctx.createBufferSource(); src.buffer = TP.buf; src.connect(audioOut()); src.start(0, t, TP.len / C.SR - t);
  src.onended = () => { if (TP.src === src) { TP.playing = false; TP.offset = 0; tpUi(); } };
  TP.src = src; TP.startAt = ctx.currentTime - t; TP.playing = true; tpUi(); if (typeof tlFollow === 'function') tlFollow();
}
function tpPause() { if (!TP.playing) return; TP.offset = tpTime(); TP.playing = false; if (TP.src) { TP.src.onended = null; try { TP.src.stop(); } catch {} TP.src = null; } tpUi(); }
function tpSeek(t, play = null) { if (play === true || (play == null && TP.playing)) tpPlay(t); else { TP.offset = Math.max(0, Math.min(t, TP.len / C.SR)); tpUi(); } }
function tpUi() {
  document.querySelectorAll('#tp-play, .tp-play-btn').forEach(b => { const sw = b.querySelector('.swap'); if (sw) sw.dataset.state = TP.playing ? 'b' : 'a'; else b.innerHTML = tpIcon(TP.playing); b.classList.toggle('on', TP.playing); b.setAttribute('aria-label', TP.playing ? 'Пауза' : 'Играть'); b.title = (TP.playing ? 'Пауза' : 'Играть') + ' (пробел)'; });
  if (S.result && S.result.out) document.querySelectorAll('#tp-time, .tp-time-txt').forEach(tt => { tt.textContent = `${fmt(tpTime())} / ${fmt(S.result.out.length / C.SR)}`; });
  const sk = $('#tp-seek'); if (sk && !sk.matches(':active')) sk.value = tpTime();
  if (typeof drawTimeline === 'function') drawTimeline();
}
/** Перед скачиванием — точная громкость, если были быстрые правки. */
async function exactResult() {
  const r = S.result; if (!r || !r.approx) return;
  progress('Уточняю итоговую громкость…', 0.5); await new Promise(res => setTimeout(res, 20));
  await remix('full'); progress('', 0); renderMix();
}
const REMIX_RANK = { lines: 1, layout: 2, full: 3 };
let remixTimer = null, remixReq = null, remixRunning = null;
/** Пересчёт после правки. kind: 'lines' (с набором реплик), 'layout' или 'full'; запросы за 120 мс складываются. */
function remixSoon(kind = 'layout', ids = null) {
  if (!remixReq) remixReq = { kind, ids: new Set() };
  else if (REMIX_RANK[kind] > REMIX_RANK[remixReq.kind]) remixReq.kind = kind;
  if (ids) for (const id of ids) remixReq.ids.add(id);
  clearTimeout(remixTimer);
  const note = $('#vg-note'); if (note) note.textContent = 'пересчитываю…';
  remixTimer = setTimeout(runRemix, 120);
}
async function runRemix() {
  if (remixRunning) { await remixRunning; }
  if (!remixReq || !S.result || S.busy) return;
  const req = remixReq; remixReq = null;
  const t0 = performance.now();
  remixRunning = remix(req.kind, req.kind === 'lines' ? req.ids : null).catch(err => { console.error(err); notify('Пересчёт не удался: ' + err.message); });
  await remixRunning; remixRunning = null;
  S.lastRemixMs = performance.now() - t0;
  if (remixReq) { runRemix(); return; }
  refreshMix();
}
function mixStatusHtml(r) { return `${r.approx ? '<span class="muted small" title="После быстрых правок общее усиление прежнее; при скачивании громкость пересчитается точно">громкость уточнится при скачивании</span> ' : ''}${S.lastRemixMs ? `<span class="muted small">пересчёт ${(S.lastRemixMs / 1000).toFixed(1)} с</span>` : ''}`; }
function mixStatHtml(r) {
  const sounds = r.lay.rows.filter(x => x.sound).length, recorded = r.lay.placed.length - sounds, paused = r.lay.sheet.filter(s => s.cue).length, voices = new Set(r.items.map(it => it.voice));
  return `${fmt(r.out.length / C.SR)} · реплик со звуком ${recorded}${sounds ? ` · звуков ${sounds}` : ''} · пауз под незаписанное ${paused} · громкость ${r.target} LUFS${r.master.held ? ` · у ${r.master.held} реплик подъём придержан, чтобы не упирались в лимитер` : ''}${r.items.filter(it => it.fxKey).length ? ` · с эффектом ${r.items.filter(it => it.fxKey).length}` : ''}${r.amb && r.amb.length ? ` · фон в ${r.amb.length} сценах` : ''}${Object.keys(S.timing).length ? ` · сдвинуто ${Object.keys(S.timing).length}` : ''}${Object.keys(S.voiceGains).filter(v => voices.has(v)).length ? ' · поправки: ' + Object.entries(S.voiceGains).filter(([v]) => voices.has(v)).map(([v, g]) => `${charName(v)} ${g > 0 ? '+' : ''}${g} дБ`).join(', ') : ''}`;
}
/** После быстрого пересчёта — только то, что поменялось: таймлайн, сводка, плеер. Выделение и фокус остаются. */
function refreshMix() {
  const r = S.result, out = $('#mix-out'); if (!r || !r.out || !out.querySelector('#tl-cv')) return renderMix();
  S.tlTracks = null;
  const st = out.querySelector('.stat'); if (st) st.innerHTML = mixStatHtml(r);
  const ms = $('#mix-status'); if (ms) ms.innerHTML = mixStatusHtml(r);
  const sk = $('#tp-seek'); if (sk) sk.max = (r.out.length / C.SR).toFixed(1);
  if ($('#tl-info')) $('#tl-info').innerHTML = tlInfoHtml(); tlRefreshBar();
  const note = $('#vg-note'); if (note) note.textContent = '';
  tpUi();
}
/** Реплики персонажа — для пересчёта только их. */
const voiceIds = v => new Set(S.result ? S.result.items.filter(it => it.voice === v).map(it => it.id) : []);

function wav16(x) {
  const n = x.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, C.SR, true); v.setUint32(28, C.SR * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  const d = new Int16Array(buf, 44); for (let i = 0; i < n; i++) d[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767)));
  return buf;
}
function encodeMp3(x, kbps) {
  const src = `importScripts('${LAME}');
  self.onmessage = e => {
    const { pcm, sr, kbps } = e.data, enc = new lamejs.Mp3Encoder(1, sr, kbps), out = [], B = 1152 * 20;
    const s = new Int16Array(pcm.length); for (let i = 0; i < pcm.length; i++) s[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
    for (let i = 0; i < s.length; i += B) { const b = enc.encodeBuffer(s.subarray(i, i + B)); if (b.length) out.push(new Uint8Array(b)); if ((i / B) % 40 === 0) self.postMessage({ p: i / s.length }); }
    const f = enc.flush(); if (f.length) out.push(new Uint8Array(f));
    self.postMessage({ done: true, blob: new Blob(out, { type: 'audio/mpeg' }) });
  };`;
  return new Promise((res, rej) => {
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = e => { if (e.data.done) { res(e.data.blob); w.terminate(); } else progress('Кодирую MP3…', e.data.p); };
    w.onerror = e => rej(new Error(e.message || 'кодировщик MP3 не загрузился'));
    w.postMessage({ pcm: x, sr: C.SR, kbps });
  });
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function reportPauses() {
  const r = S.result, lines = ['Паузы под реплики, которых нет в записях', 'Время — по сведённой дорожке (мин:сек), в скобках — длина паузы.', ''];
  for (const s of r.lay.sheet) {
    if (s.scene != null) { lines.push('', `СЦЕНА ${s.scene} — ${C.ts(s.at)}`); continue; }
    const c = s.cue, who = c.type === 'line' ? charName(c.spk) : 'ремарка';
    lines.push(`  ${C.ts(s.at)}  [${c.id}] ${who}: ${c.text.replace(/^[—\-]\s*/, '')}  (${s.dur.toFixed(1)} с)`);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
function reportCsv() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['номер', 'сцена', 'кто', 'текст', 'откуда взято', 'как найдено', 'позиция в сведении', 'длительность, с', 'громкость до, LUFS', 'поправка, дБ'];
  const rows = S.result.lay.rows.map(r => {
    const c = r.cue, src = sourceOf(c), it = S.result.byId.get(c.id);
    if (r.sound) return [c.id, r.scene, 'звук', c.text, r.sound, S.sfx.cues[c.id].mode === 'bed' ? 'фоном' : 'между репликами', C.ts(r.at), r.dur.toFixed(2), '', ''];
    const from = !src ? '— пауза —' : src.kind === 'upload' ? 'своя запись: ' + src.name : src.pieces.map(p => `${p.file} ${p.a.toFixed(2)}-${p.b.toFixed(2)}`).join(' + ');
    return [c.id, r.scene, c.type === 'line' ? charName(c.spk) : 'ремарка', c.text, from, statusOf(c).t, C.ts(r.at), r.dur.toFixed(2),
            it ? it.level.toFixed(1) : '', it && Math.abs(it.fix) >= 0.05 ? (it.fix > 0 ? '+' : '') + it.fix.toFixed(1) : ''];
  });
  return '﻿' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n');
}
function projectJson() {
  return JSON.stringify({ app: 'montage', v: 1, script: S.scriptText,
    files: S.files.map(f => ({ name: f.name, size: f.size, chars: [...f.chars] })),
    edits: S.edits, gains: S.gains, voiced: S.voiced, voiceGains: S.voiceGains, timing: S.timing, tempo: S.tempo, fxVoice: S.fxVoice, fxLine: S.fxLine, amb: ambSaved(), takes: S.takePick, sfx: S.sfxSaved || {}, sfxLib: (S.sfx ? S.sfx.lib : []).map(f => f.db ? { name: f.name, db: f.db, text: f.text || '' } : f.name),
    cleanup: S.files.filter(f => f.clean && f.clean.chain).map(f => ({ name: f.name, chain: f.clean.chain, preset: f.clean.preset, applied: !!f.raw48 })) }, null, 1);
}

// ------------------------------------------------------------------ ввод
function setScript(text) {
  S.scriptText = text; S.P = text.trim() ? C.parseScript(text) : null;
  loadEdits(); S.matches = new Map(); S.result = null;
  for (const f of S.files) autoAssign(f);
  if (S.files.some(f => f.segs && f.segs.every(s => s.text != null))) matchAll();
  render();
}
function guessChars(name) {
  const n = C.nameKey(name.replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' '));
  const set = new Set();
  if (!S.P) return set;
  for (const c of S.P.chars) {
    const k = c.key, stem = k.split(' ').pop();
    if (n.includes(k) || (stem.length >= 3 && n.includes(stem.slice(0, Math.max(3, stem.length - 1))) && k.split(' ').length === 1)) set.add(k);
  }
  for (const c of S.P.chars) for (const k of [...set]) if (c.key !== k && c.key.includes(k)) set.add(c.key);   // «голос в голове кэфи» — с кэфи
  return set;
}
function autoAssign(f) { if (!f.manualChars) f.chars = guessChars(f.name); }
async function addFiles(list) {
  const audio = [...list].filter(f => /^audio\//.test(f.type) || /\.(wav|mp3|m4a|aac|flac|ogg|opus|aif|aiff|webm)$/i.test(f.name));
  const texts = [...list].filter(f => /\.(txt|md)$/i.test(f.name));
  if (texts.length) { setScript(await texts[0].text()); $('#script').value = S.scriptText; }
  for (const file of audio) {
    if (S.files.some(f => f.name === file.name && f.size === file.size)) continue;
    const f = { id: Math.random().toString(36).slice(2), file, name: file.name, size: file.size, fkey: `${file.name}|${file.size}|${file.lastModified}`, chars: new Set() };
    autoAssign(f); S.files.push(f);
  }
  render();
  for (const f of S.files) if (!f.y48) {
    try { f.y48 = await decodeFile(f.file); f.dur = f.y48.length / C.SR; } catch { f.error = 'не удалось прочитать файл — формат не поддерживается браузером'; }
    if (S.pendingChars && S.pendingChars.has(f.name)) { f.chars = new Set(S.pendingChars.get(f.name)); f.manualChars = true; }
    render();
    if (f.y48 && S.pendingClean && S.pendingClean.has(f.name)) restoreClean(f);
  }
}
async function uploadFor(id, file) {
  try {
    const y = C.trimSilence(await decodeFile(file));
    S.uploads.set(id, { name: file.name, y48: Float32Array.from(y) });
    S.result = null; render();
  } catch { notify('Не удалось прочитать ' + file.name); }
}

// ------------------------------------------------------------------ отрисовка
let msgTimer = null;
function notify(t) { const el = $('#msg'); el.textContent = t; el.hidden = !t; clearTimeout(msgTimer); if (t) msgTimer = setTimeout(() => { typeof motionHide === 'function' ? motionHide(el) : (el.hidden = true); }, 9000); }
function progress(t, p) {
  const el = $('#prog');
  if (!t && !el.hidden && typeof motionGhostOut === 'function') motionGhostOut(el, { transform: 'translateY(12px) scale(0.98)', filter: 'blur(2px)' }, 250);
  el.hidden = !t;
  $('#prog-t').textContent = t; $('#prog-t').dataset.text = t; $('#prog-b').style.setProperty('--p', Math.max(0, Math.min(1, p || 0)).toFixed(3));
}
let shownTab = null;
function render() {
  if (shownTab && shownTab !== S.tab && typeof motionTab === 'function') motionTab(shownTab, S.tab);
  document.querySelectorAll('.tabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === S.tab); b.setAttribute('aria-selected', b.dataset.tab === S.tab); });
  if (shownTab !== S.tab && typeof tabIndicator === 'function') tabIndicator(!shownTab);
  document.querySelectorAll('[data-tabpane]').forEach(el => { el.hidden = el.dataset.tabpane !== S.tab; });
  shownTab = S.tab;
  renderScript(); renderFiles(); renderRun(); renderReview(); renderMix(); renderCleanup(); renderSounds();
  if (typeof motionSteps === 'function') motionSteps();
}
function renderScript() {
  const el = $('#script-sum');
  if (!S.P) { el.innerHTML = '<p class="muted">Вставьте текст или перетащите .txt сюда.</p>'; return; }
  const nLines = S.P.cues.filter(c => c.type === 'line').length, nDirs = S.P.cues.filter(c => c.type === 'dir').length;
  el.innerHTML = `<p class="stat"><b>${S.P.nScenes || '—'}</b> сцен · <b>${nLines}</b> реплик · <b>${nDirs}</b> ремарок</p>
    <div class="chips">${S.P.chars.map(c => `<span class="chip ${colorOf(c.key)}">${esc(c.name)} <i>${c.count}</i></span>`).join('')}</div>`;
}
function renderFiles() {
  const el = $('#files');
  if (!S.files.length) { el.innerHTML = '<p class="muted">Файлов пока нет. Можно сразу все: wav, mp3, m4a, flac, ogg.</p>'; }
  else el.innerHTML = S.files.map((f, i) => `
    <div class="file" data-i="${i}">
      <div class="fhead">
        <span class="fname">${esc(f.name)}</span>
        <span class="fmeta">${f.error ? `<span class="bad">${esc(f.error)}</span>` : f.dur ? fmt(f.dur) : 'читаю…'}${f.segs ? ` · кусков ${f.segs.length}` : ''}${f.raw48 ? ' · <span class="okt">очищено</span>' : ''}</span>
        <span class="fbtn">
          <button class="icon" data-act="up" title="Выше" ${i ? '' : 'disabled'} aria-label="Выше">${ic('up')}</button>
          <button class="icon" data-act="down" title="Ниже" ${i < S.files.length - 1 ? '' : 'disabled'} aria-label="Ниже">${ic('down')}</button>
          <button class="icon" data-act="rm" title="Убрать" aria-label="Убрать">${ic('close')}</button>
        </span>
      </div>
      <div class="who">${S.P ? S.P.chars.map(c => `<label class="tog ${colorOf(c.key)} ${f.chars.has(c.key) ? 'on' : ''}"><input type="checkbox" data-act="char" data-k="${esc(c.key)}" ${f.chars.has(c.key) ? 'checked' : ''}>${esc(c.name)}</label>`).join('') : '<span class="muted">кто говорит — после сценария</span>'}</div>
    </div>`).join('');
  const lonely = S.P ? S.P.chars.filter(c => !S.files.some(f => f.chars.has(c.key))) : [];
  $('#lonely').innerHTML = lonely.length ? `Без записей, будут паузы: ${lonely.map(c => esc(c.name)).join(', ')}.` : '';
}
function renderRun() {
  $('#go').disabled = S.busy || !S.P || !S.files.some(f => f.chars.size);
  $('#go').textContent = S.matches.size ? 'Разобрать заново' : 'Разобрать записи';
  document.querySelectorAll('input[name=preset]').forEach(r => { r.checked = r.value === S.preset; r.disabled = S.busy; });
}
function counts() {
  const c = { ok: 0, check: 0, miss: 0, own: 0, none: 0 };
  if (!S.P) return c;
  for (const cue of S.P.cues) if (cue.type === 'line') {
    const hasFile = S.files.some(f => f.chars.has(cue.spk));
    const st = statusOf(cue).k;
    if (st === 'miss' && !hasFile) c.none++; else c[st] = (c[st] || 0) + 1;
  }
  return c;
}
function renderReview() {
  const sec = $('#review'), ready = S.matches.size > 0 || S.uploads.size > 0;
  sec.hidden = !ready; if (!ready) return;
  const c = counts();
  $('#rv-sum').innerHTML = `
    <span class="pill ok" data-n="${c.ok + c.own}">найдено <b>${c.ok + c.own}</b></span>
    <span class="pill check" data-n="${c.check}">проверить <b>${c.check}</b></span>
    <span class="pill miss" data-n="${c.miss}">нет записи <b>${c.miss}</b></span>
    ${c.none ? `<span class="pill none" data-n="${c.none}">роли без записей <b>${c.none}</b></span>` : ''}`;
  if (typeof motionCount === 'function') $('#rv-sum').querySelectorAll('.pill').forEach(p => motionCount(p, p.classList[1]));
  if ($('#rv-rerec')) $('#rv-rerec').innerHTML = typeof rerecHtml === 'function' ? rerecHtml() : '';
  document.querySelectorAll('#rv-filter button').forEach(b => b.classList.toggle('on', b.dataset.f === S.filter));
  $('#dirs-t').checked = S.showDirs;
  const rows = [];
  let scene = null;
  for (const cue of S.P.cues) {
    if (cue.type === 'scene') { scene = cue; continue; }
    const voiced = cue.type === 'dir' && (S.matches.get(cue.id) || S.uploads.has(cue.id) || S.edits[cue.id]?.pieces);
    if (cue.type === 'dir' && !voiced) {
      if (S.showDirs && S.filter === 'all') rows.push(`<div class="dir">${esc(cue.text)}</div>`);
      continue;
    }
    const st = statusOf(cue);
    const hasFile = cue.type === 'dir' || S.files.some(f => f.chars.has(cue.spk));
    if (S.filter === 'check' && st.k !== 'check') continue;
    if (S.filter === 'miss' && !(st.k === 'miss' && hasFile)) continue;
    if (S.filter === 'dirs' && cue.type !== 'dir') continue;
    if (scene) { rows.push(`<div class="scene">${esc(scene.text)}</div>`); scene = null; }
    rows.push(rowHtml(cue, st, hasFile));
  }
  $('#rv-list').dataset.v = `${S.filter}|${S.showDirs}|${S.matches.size}`;
  $('#rv-list').innerHTML = rows.join('') || '<p class="muted pad">Здесь пусто — под этот фильтр ничего не подходит.</p>';
}
function rowHtml(cue, st, hasFile) {
  const src = sourceOf(cue), isDir = cue.type === 'dir';
  const who = isDir ? `<span class="chip ghost">ремарка</span>` : `<span class="chip ${colorOf(cue.spk)}">${esc(charName(cue.spk))}</span>`;
  const on = isDir ? isVoicedDir(cue) : true;
  const where = !src ? '' : src.kind === 'upload' ? esc(src.name) : src.pieces.map(p => `${esc(p.file)} ${fmt(p.a)}–${fmt(p.b)}`).join(' + ');
  const heard = src && src.text ? `<div class="heard">услышано: «${esc(src.text.slice(0, 140))}»</div>` : '';
  const g = S.gains[cue.id] || 0;
  return `<div class="row st-${!hasFile && st.k === 'miss' ? 'none' : st.k}${on ? '' : ' off'}" data-id="${cue.id}">
    <div class="num">${esc(cue.id)}</div>
    <div class="body">
      <div class="line1">${who}${cue.note ? `<span class="note">(${esc(cue.note)})</span>` : ''}<span class="txt">${esc(cue.text)}</span></div>
      <div class="line2"><span class="st">${!hasFile && st.k === 'miss' ? 'роль без записей — пауза' : st.t}</span>${where ? `<span class="where">${where}</span>` : ''}</div>
      ${heard}
      <div class="picker" hidden></div>
    </div>
    <div class="acts">
      ${src ? `<button class="play" data-act="play" aria-label="Слушать">▶</button>` : ''}
      ${src && src.takes > 1 ? `<button class="ghost-b" data-act="take-next" title="Актёр прочёл реплику ${src.takes} раза; сначала стоит лучший">дубль ${src.take + 1}/${src.takes} ${ic('next')}</button>` : ''}
      ${isDir ? `<label class="mini"><input type="checkbox" data-act="voiced" ${on ? 'checked' : ''}> в дорожку</label>` : ''}
      <button class="ghost-b" data-act="pick">${src ? 'Другой кусок' : 'Найти'}</button>
      <label class="ghost-b file-b">Своя запись<input type="file" accept="audio/*" data-act="own" hidden></label>
      ${src ? `<button class="ghost-b" data-act="none">Без записи</button>` : ''}
      ${S.edits[cue.id] || S.uploads.has(cue.id) ? `<button class="ghost-b" data-act="reset">Как было</button>` : ''}
      <span class="gain"><button class="icon" data-act="g-" aria-label="Тише на 1 дБ">${ic('minus')}</button><span>${g ? (g > 0 ? '+' : '') + g + ' дБ' : '0 дБ'}</span><button class="icon" data-act="g+" aria-label="Громче на 1 дБ">${ic('plus')}</button></span>
    </div>
  </div>`;
}
function openPicker(row, cue) {
  const box = row.querySelector('.picker');
  if (!box.hidden) { box.hidden = true; return; }
  const spk = cue.type === 'line' ? cue.spk : null;
  const t = C.norm(cue.text);
  const cands = [];
  S.files.forEach((f, fi) => {
    if (!f.segs || (spk && !f.chars.has(spk))) return;
    f.segs.forEach((s, j) => { const st = C.norm(C.cleanAsr(s.text || '')); cands.push({ f, fi, s, j, sim: C.dice(st, t) }); });
  });
  cands.sort((a, b) => b.sim - a.sim);
  const top = cands.slice(0, 10);
  box.innerHTML = top.length ? `<p class="muted">Куски из записей${spk ? ' ' + esc(charName(spk)) : ''}, самые похожие по тексту:</p>` + top.map(c => `
    <div class="cand" data-f="${c.fi}" data-a="${c.s.a}" data-b="${c.s.b}">
      <button class="play" data-act="cplay" aria-label="Слушать кусок">▶</button>
      <span class="ctime">${esc(c.f.name)} ${fmt(c.s.a)}–${fmt(c.s.b)}</span>
      <span class="ctext">«${esc((c.s.text || '…').slice(0, 90))}»</span>
      <span class="csim">${Math.round(c.sim * 100)} %</span>
      <button class="ghost-b" data-act="take">Взять</button>
      <button class="ghost-b" data-act="add">Добавить</button>
    </div>`).join('') : '<p class="muted">Нет разобранных записей для этой роли.</p>';
  box.hidden = false;
}
function renderMix() {
  const sec = $('#mix'); sec.hidden = !(S.matches.size || S.uploads.size || (S.P && S.sfx && Object.values(S.sfx.cues).some(c => c.on && c.src)));
  $('#mixgo').disabled = S.busy;
  $('#lvl-v').textContent = (+$('#lvl').value).toFixed(2).replace(/0$/, '');
  if ($('#tempo')) { $('#tempo').value = S.tempo || 1; $('#tempo-v').textContent = (S.tempo || 1).toFixed(2).replace(/0$/, '') + '×'; }
  const r = S.result, out = $('#mix-out');
  if (!r || !r.out) { if (tlState().full) tlSetFull(false); out.innerHTML = ''; if (typeof tpPause === 'function') tpPause(); return; }
  if (!out.querySelector('#mix-tl')) out.innerHTML = '<div id="mix-top"></div><div id="mix-tl"></div><div id="mix-rest"></div>';
  const voices = new Map();
  for (const it of r.items) { if (!voices.has(it.voice)) voices.set(it.voice, []); voices.get(it.voice).push(it); }
  const spread = list => { const a = list.map(x => x.levelAfter).sort((x, y) => x - y), b = list.map(x => x.level).sort((x, y) => x - y); const p = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(q * (arr.length - 1)))]; return [p(b, 0.9) - p(b, 0.1), p(a, 0.9) - p(a, 0.1)]; };
  $('#mix-top').innerHTML = `
    <div class="tp"><button class="play big" id="tp-play" data-act="tp-play" aria-label="${TP.playing ? 'Пауза' : 'Играть'}" title="Играть и пауза (пробел)">${tpIcon(TP.playing)}</button>
      <input type="range" id="tp-seek" min="0" max="${(r.out.length / C.SR).toFixed(1)}" step="0.1" value="${tpTime()}" aria-label="Позиция"><span class="tp-time" id="tp-time">${fmt(tpTime())} / ${fmt(r.out.length / C.SR)}</span>
      <span id="mix-status">${mixStatusHtml(r)}</span></div>
`;
  if (!$('#mix-tl .tl')) $('#mix-tl').innerHTML = `<div class="tl ${tlState().full ? 'full' : ''}" role="region" aria-label="Таймлайн сведения">
      <div class="tl-bar">${tlBarHtml()}</div>
      <div class="tl-canvas"><canvas id="tl-cv" tabindex="0" aria-label="Таймлайн: стрелки двигают выбранное, клавиша меню — действия, F — на весь экран"></canvas></div>
      <canvas id="tl-ov" aria-label="Весь спектакль: щелчок — перейти"></canvas>
      <div class="tl-info" id="tl-info">${tlInfoHtml()}</div>
      <div id="tl-menu" class="tl-menu" role="menu" aria-label="Действия" hidden></div>
      <div class="tl-flash" role="status" aria-live="polite"></div></div>`;
  else { tlRefreshBar(); tlRefreshInfo(); }
  $('#mix-rest').innerHTML = `
    <p class="stat">${mixStatHtml(r)}</p>
    <div class="levels">${[...voices].map(([v, list]) => { const [b, a] = spread(list); return `<div><span class="chip ${S.P.chars.some(c => c.key === v) ? colorOf(v) : 'ghost'}">${esc(charName(v))}</span> разброс громкости ${b.toFixed(1)} → <b>${a.toFixed(1)} дБ</b></div>`; }).join('')}</div>
    <div class="vgains">
      <div class="vg-head"><b>Персонажи: громкость и эффект</b><span class="muted small">поправка ко всем репликам персонажа поверх выравнивания; эффект — «голос в голове», телефон, мегафон, за дверью… Пометки в сценарии («в микрофон», «из другого угла») срабатывают сами. Применяется сразу, плеер продолжает с того же места</span><span class="muted small" id="vg-note"></span></div>
      ${[...voices.keys()].map(v => { const g = S.voiceGains[v] || 0; return `<label class="vg"><span class="chip ${S.P.chars.some(c => c.key === v) ? colorOf(v) : 'ghost'}">${esc(charName(v))}</span><input type="range" data-voice="${esc(v)}" min="-12" max="6" step="0.5" value="${g}" aria-label="громкость ${esc(charName(v))}"><b>${g > 0 ? '+' : ''}${g} дБ</b><button class="icon xs" data-act="vg0" data-voice="${esc(v)}" title="Сбросить в 0" aria-label="Сбросить">0</button>${typeof FX_PRESETS !== 'undefined' ? (() => { const cur = fxOfVoice(v); return `<select data-fxvoice="${esc(v)}" aria-label="эффект ${esc(charName(v))}"><option value="">${cur && !S.fxVoice[v] ? 'сам: ' + FX_PRESETS[cur.key].name : 'без эффекта'}</option>${Object.entries(FX_PRESETS).filter(([k]) => k !== 'none' || (cur && !S.fxVoice[v])).map(([k, p]) => `<option value="${k}" ${S.fxVoice[v] === k ? 'selected' : ''}>${p.name}</option>`).join('')}</select>`; })() : ''}</label>`; }).join('')}
    </div>
    <div class="dl">
      <button class="primary" data-act="mp3">${ic('download')}Скачать MP3</button>
      <button class="ghost-b" data-act="wav">WAV 24 бит</button>
      <button class="ghost-b" data-act="pauses">Паузы (.txt)</button>
      <button class="ghost-b" data-act="csv">Разметка (.csv)</button>
      <button class="ghost-b" data-act="proj">Проект (.json)</button>
      <button class="ghost-b" data-act="stems" title="Дорожки по персонажам, звуки и фон отдельными WAV плюс проект для Reaper">Стемы для Reaper, Audacity (.zip${typeof buildStems === 'function' ? ', ≈ ' + Math.round(buildStems().stems.length * r.out.length * 2 / 1e6) + ' МБ' : ''})</button>
      ${r.lay.scenes && r.lay.scenes.length > 1 ? '<button class="ghost-b" data-act="chapters" title="Строки вида «00:00 Сцена 1 — кабинет» для описания на YouTube">Главы (.txt)</button>' : ''}
    </div>
    ${r.lay.scenes && r.lay.scenes.length > 1 ? '<p class="muted small">В MP3 сцены записаны главами: в плеерах подкастов и VLC по ним можно прыгать.</p>' : ''}`;
  histUi();
  requestAnimationFrame(drawTimeline);
}

// ------------------------------------------------------------------ события
function bind() {
  $('.tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.tab = b.dataset.tab; stop(); history.replaceState(null, '', S.tab === 'clean' ? '#clean' : location.pathname); render(); });
  bindCleanup(); bindSounds();
  const drop = (zone, fn) => {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); fn(e.dataTransfer.files); });
  };
  let t = null;
  $('#script').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => setScript(e.target.value), 300); });
  $('#script-file').addEventListener('change', async e => { const f = e.target.files[0]; if (f) { $('#script').value = await f.text(); setScript($('#script').value); } });
  $('#audio-in').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  $('#proj-in').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      $('#script').value = p.script || ''; setScript(p.script || '');
      S.edits = p.edits || {}; S.gains = p.gains || {}; S.voiced = p.voiced || {}; S.voiceGains = p.voiceGains || {}; S.timing = p.timing || {}; S.tempo = p.tempo || 1; S.fxVoice = p.fxVoice || {}; S.fxLine = p.fxLine || {}; S.amb = p.amb ? { duck: 8, scenes: {}, cands: {}, ...p.amb } : null; S.takePick = p.takes || {}; saveEdits();
      S.pendingChars = new Map((p.files || []).map(x => [x.name, x.chars]));
      for (const f of S.files) if (S.pendingChars.has(f.name)) { f.chars = new Set(S.pendingChars.get(f.name)); f.manualChars = true; }
      S.sfxSaved = p.sfx || {}; sfxState().cues = JSON.parse(JSON.stringify(S.sfxSaved)); saveEdits();
      S.sfxPendingDb = (p.sfxLib || []).filter(e => e && typeof e === 'object' && e.db);
      S.pendingClean = new Map((p.cleanup || []).map(x => [x.name, x]));
      for (const f of S.files) if (f.y48) restoreClean(f);
      notify('Проект открыт. Добавьте те же файлы записей — роли подставятся сами.'); render();
    } catch { notify('Это не файл проекта Монтажки.'); if (typeof motionShake === 'function') motionShake(e.target.closest('label')); }
    e.target.value = '';
  });
  drop($('#s1'), fs => addFiles(fs));
  drop($('#s2'), fs => addFiles(fs));
  $('#files').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +b.closest('.file').dataset.i, a = b.dataset.act;
    if (a === 'rm') S.files.splice(i, 1);
    if (a === 'up' && i) [S.files[i - 1], S.files[i]] = [S.files[i], S.files[i - 1]];
    if (a === 'down' && i < S.files.length - 1) [S.files[i + 1], S.files[i]] = [S.files[i], S.files[i + 1]];
    if (S.matches.size) matchAll();
    S.result = null; render();
  });
  $('#files').addEventListener('change', e => {
    const x = e.target; if (x.dataset.act !== 'char') return;
    const f = S.files[+x.closest('.file').dataset.i]; f.manualChars = true;
    x.checked ? f.chars.add(x.dataset.k) : f.chars.delete(x.dataset.k);
    if (S.matches.size && f.segs && f.segs.every(s => s.text != null)) matchAll();
    S.result = null; render();
  });
  document.querySelectorAll('input[name=preset]').forEach(r => r.addEventListener('change', () => { S.preset = r.value; render(); }));
  $('#go').addEventListener('click', analyze);
  $('#rv-filter').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.filter = b.dataset.f; renderReview(); } });
  $('#dirs-t').addEventListener('change', e => { S.showDirs = e.target.checked; renderReview(); });
  $('#rv-rerec').addEventListener('click', e => { const b = e.target.closest('button[data-act=rerec]'); if (!b) return; const spk = b.dataset.spk || null;
    download(new Blob([rerecText(spk)], { type: 'text/plain;charset=utf-8' }), `дозапись${spk ? '-' + charName(spk) : ''}.txt`); });
  $('#rv-list').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const row = b.closest('.row'); if (!row) return;
    const cue = S.P.cues.find(c => c.id === row.dataset.id), a = b.dataset.act;
    if (a === 'play') { if (playing && playing.btn === b) return stop(); const y = audioOfSource(sourceOf(cue)); if (y) play(y, b); return; }
    if (a === 'pick') return openPicker(row, cue);
    if (a === 'cplay') { if (playing && playing.btn === b) return stop(); const cd = b.closest('.cand'); play(slice(S.files[+cd.dataset.f], +cd.dataset.a, +cd.dataset.b), b); return; }
    if (a === 'take' || a === 'add') {
      const cd = b.closest('.cand'), piece = { file: S.files[+cd.dataset.f].name, a: +cd.dataset.a, b: +cd.dataset.b };
      const cur = sourceOf(cue);
      const base = a === 'add' && cur && cur.pieces ? cur.pieces.map(p => ({ file: p.file, a: p.a, b: p.b })) : [];
      S.edits[cue.id] = { pieces: [...base, piece].sort((x, y) => x.file === y.file ? x.a - y.a : 0) };
      if (cue.type === 'dir') S.voiced[cue.id] = true;
    }
    if (a === 'take-next') { const tk = takeOf(cue.id); if (tk) { const nx = (tk.i + 1) % tk.n; if (nx === tk.best) delete S.takePick[cue.id]; else S.takePick[cue.id] = nx; } }
    if (a === 'none') S.edits[cue.id] = { none: true };
    if (a === 'reset') { delete S.edits[cue.id]; S.uploads.delete(cue.id); }
    if (a === 'g+' || a === 'g-') { S.gains[cue.id] = (S.gains[cue.id] || 0) + (a === 'g+' ? 1 : -1); if (!S.gains[cue.id]) delete S.gains[cue.id]; }
    saveEdits(); S.result = null; renderReview(); renderMix();
  });
  $('#rv-list').addEventListener('change', e => {
    const x = e.target, row = x.closest('.row'); if (!row) return;
    if (x.dataset.act === 'own' && x.files[0]) uploadFor(row.dataset.id, x.files[0]);
    if (x.dataset.act === 'voiced') { S.voiced[row.dataset.id] = x.checked; saveEdits(); S.result = null; renderReview(); renderMix(); }
  });
  $('#lvl').addEventListener('input', () => { $('#lvl-v').textContent = (+$('#lvl').value).toFixed(2).replace(/0$/, ''); });
  $('#tempo').addEventListener('input', () => { $('#tempo-v').textContent = (+$('#tempo').value).toFixed(2).replace(/0$/, '') + '×'; });
  $('#tempo').addEventListener('change', () => { if (+$('#tempo').value === (S.tempo || 1)) return; histPush(`темп пауз ${(+$('#tempo').value).toFixed(2)}×`); S.tempo = +$('#tempo').value; saveEdits(); if (S.result) remixSoon('layout'); });
  if (typeof bindTimeline === 'function') bindTimeline();
  $('#mixgo').addEventListener('click', mixdown);
  $('#mix-out').addEventListener('input', e => { const x = e.target; if (x.dataset.voice == null) return; x.nextElementSibling.textContent = `${+x.value > 0 ? '+' : ''}${+x.value} дБ`; });
  $('#mix-out').addEventListener('change', e => { const x = e.target;
    if (x.dataset.fxvoice != null) { if ((x.value || undefined) === S.fxVoice[x.dataset.fxvoice]) return; histPush(`эффект персонажа ${charName(x.dataset.fxvoice)}: ${x.value ? FX_PRESETS[x.value].name : 'как по пометкам'}`); if (x.value) S.fxVoice[x.dataset.fxvoice] = x.value; else delete S.fxVoice[x.dataset.fxvoice]; saveEdits(); remixSoon('lines', voiceIds(x.dataset.fxvoice)); drawTimeline(); return; }
    if (x.dataset.voice == null) return; const v = +x.value; if (v === (S.voiceGains[x.dataset.voice] || 0)) return; histPush(`громкость персонажа ${charName(x.dataset.voice)} ${v > 0 ? '+' : ''}${v} дБ`); if (v) S.voiceGains[x.dataset.voice] = v; else delete S.voiceGains[x.dataset.voice]; saveEdits(); remixSoon('lines', voiceIds(x.dataset.voice)); });
  $('#mix-out').addEventListener('input', e => { if (e.target.id === 'tp-seek') { TP.offset = +e.target.value; if (TP.playing) tpPlay(+e.target.value); else tpUi(); } });
  document.addEventListener('keydown', e => {                 // Ctrl+Z — отменить, Ctrl+Shift+Z или Ctrl+Y — повторить (в текстовых полях — их собственная отмена)
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !S.result || S.tab !== 'build') return;
    if (/TEXTAREA/.test(e.target.tagName) || (e.target.tagName === 'INPUT' && /text|search|number/.test(e.target.type))) return;
    if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); histUndo(); }
    else if ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY') { e.preventDefault(); histRedo(); }
  });
  document.addEventListener('keydown', e => {                 // пробел — играть / пауза, если не пишем в поле
    if (e.code !== 'Space' || e.repeat || !S.result || !S.result.out || S.tab !== 'build' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    e.preventDefault(); TP.playing ? tpPause() : tpPlay();
  });
  $('#mix-out').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b || !S.result) return;
    const stamp = S.result.at.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
    const a = b.dataset.act;
    try {
      if (a === 'tp-play') { TP.playing ? tpPause() : tpPlay(); return; }
      if (a === 'vg0') { histPush(`громкость персонажа ${charName(b.dataset.voice)} 0 дБ`); delete S.voiceGains[b.dataset.voice]; saveEdits(); const sl = $('#mix-out').querySelector(`input[data-voice="${CSS.escape(b.dataset.voice)}"]`); if (sl) { sl.value = 0; sl.nextElementSibling.textContent = '0 дБ'; } remixSoon('lines', voiceIds(b.dataset.voice)); return; }
      if (['mp3', 'wav', 'stems'].includes(a) && S.result.approx) { b.disabled = true; await exactResult(); b.disabled = false; }
      if (a === 'mp3') { b.disabled = true; const blob = await encodeMp3(S.result.out, +$('#kbps').value); progress('', 0); const tag = typeof id3Chapters === 'function' ? id3Chapters((S.P.title || 'Радиоспектакль')) : null; download(tag && tag.length ? new Blob([tag, blob], { type: 'audio/mpeg' }) : blob, `сведение-${stamp}.mp3`); b.disabled = false; }
      if (a === 'stems') { b.disabled = true; try { const z = await exportStems(); if (z) download(z, `стемы-${stamp}.zip`); } catch (err) { progress('', 0); notify('Стемы не получились: ' + err.message); } b.disabled = false; }
      if (a === 'chapters') download(new Blob([chaptersText()], { type: 'text/plain;charset=utf-8' }), `главы-${stamp}.txt`);
      if (a === 'wav') download(new Blob([C.wav24(S.result.out)], { type: 'audio/wav' }), `сведение-${stamp}.wav`);
      if (a === 'pauses') download(new Blob([reportPauses()], { type: 'text/plain;charset=utf-8' }), `паузы-${stamp}.txt`);
      if (a === 'csv') download(new Blob([reportCsv()], { type: 'text/csv;charset=utf-8' }), `разметка-${stamp}.csv`);
      if (a === 'proj') download(new Blob([projectJson()], { type: 'application/json' }), `проект-${stamp}.json`);
    } catch (err) { b.disabled = false; progress('', 0); notify('Не получилось: ' + err.message); }
  });
}

// для проверки из консоли и автотестов
window.montage = { S, C, PRESETS, play: (y, btn) => play(y, btn), stop: () => stop(), DECK: typeof DECK !== 'undefined' ? DECK : null, MOTION: typeof MOTION !== 'undefined' ? MOTION : null, audioLevel: () => audioLevel(), projectJson, remix, renderMix, HIST, histUndo: () => histUndo(), histRedo: () => histRedo(), tlSetFull: on => tlSetFull(on), tlMenuOpen: (x, y, c) => tlMenuOpen(x, y, c), refreshMix: () => refreshMix(), tlSelect: (ids, add) => tlSelect(ids, add), TP, tpPlay: t => tpPlay(t), tpPause: () => tpPause(), tpTime: () => tpTime(), remixSoon: (k, ids) => remixSoon(k, ids), computeTakes: () => computeTakes(), takeOf: id => takeOf(id), rerecText: s => rerecText(s), rerecList: () => rerecList(), exportStems: () => exportStems(), chaptersText: () => chaptersText(), id3Chapters: t => id3Chapters(t), ambAutoAll: () => ambAutoAll(), ambState: () => ambState(), fxOfLine: (c, v) => fxOfLine(c, v), drawTimeline: () => drawTimeline(), tlState: () => tlState(), sfxAudio, sfxAuto, renderSounds, dbSearch, dbRun, dbAutoAll, dbQuery, dbPick, dbState, dbRestore, workerSrc: () => (typeof DSP_WORKER_SRC === 'undefined' ? null : DSP_WORKER_SRC), render, renderCleanup, analyzeFile, applyFile, preview, analyze, mixdown, setScript, addFiles, matchAll, sourceOf, statusOf, reportCsv, reportPauses };
bind(); render();
if (typeof motionInit === 'function') motionInit();
if (typeof initDeck === 'function') initDeck();
if (typeof initTheme === 'function') initTheme();
