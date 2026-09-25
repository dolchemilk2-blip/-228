// Монтажка — вкладка «Чистка звука». Использует S, $, esc, notify, progress, play, stop, fmt,
// download, audioCtx, addFiles, render из app.js (в сборке — один файл) и модули dsp.js через C.

const MODULES = [
  { k: 'dehum', name: 'Гул сети', desc: '50 или 60 Гц и гармоники — только если они действительно торчат',
    params: [{ k: 'base', type: 'select', opts: [['auto', 'найти самому'], [50, '50 Гц'], [60, '60 Гц']] }] },
  { k: 'hp', name: 'Низ', desc: 'срез ниже частоты: подгул, стук по столу, ветер; 24 дБ/окт — крутой срез инфраниза',
    params: [{ k: 'fc', min: 20, max: 160, step: 5, unit: 'Гц', label: 'срез' }, { k: 'slope', type: 'select', label: 'крутизна', opts: [[12, '12 дБ/окт'], [24, '24 дБ/окт']] }] },
  { k: 'declip', name: 'Клиппинг', desc: 'срезанные пики достраиваются кубической кривой — когда микрофон перегрузили', params: [] },
  { k: 'declick', name: 'Щелчки', desc: 'одиночные щелчки, тики, потрескивание',
    params: [{ k: 'sens', min: 0.3, max: 2, step: 0.1, label: 'чувствительность' }] },
  { k: 'denoise', name: 'Шум', desc: 'шипение, вентилятор, ровный фон; профиль шума берётся из тихих мест файла или из отрывка',
    params: [{ k: 'amount', min: 3, max: 24, step: 1, unit: 'дБ', label: 'сила' }, { k: 'sens', min: 1, max: 3, step: 0.1, label: 'чувствительность' }, { k: 'noise', type: 'noise' }] },
  { k: 'dereverb', name: 'Эхо и комната', desc: 'спектрально — сушит сильнее всего, при больших значениях голос «водянистый»; хвосты — тише спад после слогов; паузы — тише всё между фразами',
    params: [{ k: 'spectral', min: 0, max: 1, step: 0.05, pct: true, label: 'спектрально' }, { k: 't60', min: 0.2, max: 1.5, step: 0.05, unit: 'с', label: 'размер комнаты' },
             { k: 'tails', min: 0, max: 1, step: 0.05, pct: true, label: 'хвосты после слогов' }, { k: 'pauses', min: 0, max: 24, step: 1, unit: 'дБ', label: 'паузы и дыхание тише на' }] },
  { k: 'tones', name: 'Призвуки', desc: 'стоячие свисты и звенящие гармоники (монитор, кодек, электрика) в 1,5–12 кГц находятся сами и вырезаются узко; голос так себя не ведёт',
    params: [{ k: 'sens', min: 0.5, max: 2, step: 0.1, label: 'чувствительность' }] },
  { k: 'soothe', name: 'Резонансы', desc: 'резкие пики верха придавливаются только там и тогда, где они торчат над остальным спектром (в духе Soothe): металл, песок, звон',
    params: [{ k: 'lo', min: 2000, max: 8000, step: 250, unit: 'Гц', label: 'от' }, { k: 'hi', min: 8000, max: 16000, step: 250, unit: 'Гц', label: 'до' }, { k: 'depth', min: 1, max: 8, step: 0.5, unit: 'дБ', label: 'не глубже' }, { k: 'sens', min: 0.5, max: 2, step: 0.1, label: 'чувствительность' }] },
  { k: 'deplosive', name: 'Взрывные', desc: '«п» и «б» в микрофон: низ придавливается только там, где выстреливает',
    params: [{ k: 'amount', min: 0, max: 1, step: 0.05, pct: true, label: 'сила' }] },
  { k: 'deess', name: 'Свист', desc: 'резкие «с», «ш», «ц»: полоса придавливается там, где громче обычного; 6–7,5 кГц — под «плавающий» неестественный верх',
    params: [{ k: 'amount', min: 0, max: 1, step: 0.05, pct: true, label: 'сила' }, { k: 'band', type: 'select', label: 'полоса', opts: [['4500-9000', '4,5–9 кГц (обычно)'], ['6000-7500', '6–7,5 кГц'], ['3000-6000', '3–6 кГц']] }] },
  { k: 'eq5', name: 'Эквалайзер — пять полос', desc: 'простой: ползунки ±12 дБ, частоту можно поменять; работает вместе с графическим ниже', params: [] },
  { k: 'tone', name: 'Тембр', desc: 'снять гулкость (горб в низах) или подогнать спектр под другую запись, чтобы голоса звучали вместе',
    params: [{ k: 'mode', type: 'select', opts: [['auto', 'снять гулкость'], ['match', 'как у другой записи']] }, { k: 'ref', type: 'ref' }, { k: 'strength', min: 0, max: 1, step: 0.05, pct: true, label: 'насколько' }] },
  { k: 'transient', name: 'Атаки', desc: 'транзиент-шейпер: атаки чётче (+) или мягче (−) — артикуляция, удары; хвосты короче (−) или длиннее (+)',
    params: [{ k: 'attack', min: -6, max: 6, step: 0.5, unit: 'дБ', label: 'атаки' }, { k: 'sustain', min: -6, max: 6, step: 0.5, unit: 'дБ', label: 'хвосты' }] },
  { k: 'exciter', name: 'Воздух', desc: 'верх выше среза кодека или микрофона достраивается гармониками октавы под срезом (эксайтер); срез находится сам',
    params: [{ k: 'from', type: 'select', label: 'от', opts: [['auto', 'от среза (найти самому)'], [8000, '8 кГц'], [10000, '10 кГц'], [12000, '12 кГц'], [14000, '14 кГц'], [16000, '16 кГц']] }, { k: 'mode', type: 'select', label: 'характер', opts: [['tape', 'лента (мягче)'], ['tube', 'лампа (ярче)']] }, { k: 'amount', min: 0, max: 1, step: 0.05, pct: true, label: 'сколько' }] },
  { k: 'tape', name: 'Лента', desc: 'мягкое ленточное насыщение с передискретизацией: скругляет жёсткие пики, чуть тепла; громкость речи не меняется',
    params: [{ k: 'amount', min: 0, max: 1, step: 0.05, pct: true, label: 'сила' }] },
  { k: 'comp', name: 'Компрессор', desc: 'ровнее по громкости внутри реплик; поднимает и хвосты комнаты — включать после чистки',
    params: [{ k: 'amount', min: 0, max: 1, step: 0.05, pct: true, label: 'сила' }] },
  { k: 'loud', name: 'Громкость', desc: 'привести файл к уровню; «лимитер» — максимайзер: громкость достигается, пики выше потолка прижимаются по true peak',
    params: [{ k: 'lufs', type: 'select', label: 'уровень', opts: [[-14, '−14 LUFS'], [-16, '−16 LUFS'], [-18, '−18 LUFS'], [-20, '−20 LUFS'], [-23, '−23 LUFS']] }, { k: 'ceil', type: 'select', label: 'потолок', opts: [[-0.3, '−0,3 dBTP'], [-1, '−1 dBTP'], [-1.5, '−1,5 dBTP'], [-3, '−3 dBTP']] }, { k: 'mode', type: 'select', label: 'как', opts: [['gain', 'только уровень'], ['limit', 'лимитер']] }] },
];
const PRESET_NAMES = { soft: 'Мягко', normal: 'Обычно', strong: 'Сильно', hum: 'Только гул и низ', codec: 'После кодека', master: 'Мастеринг', none: 'Ничего' };
const EXCERPT = 12;
const BAND_TYPES = [['peak', 'колокол'], ['lowshelf', 'полка низ'], ['highshelf', 'полка верх'], ['hp', 'срез низа'], ['lp', 'срез верха'], ['notch', 'вырез']];
const NO_GAIN = new Set(['hp', 'lp', 'notch']);
const EQ_PRESETS = {
  reset:   { name: 'Сброс', bands: [] },
  clarity: { name: 'Разборчивость', bands: [{ type: 'peak', f: 250, q: 1.2, gain: -2 }, { type: 'peak', f: 3000, q: 1.2, gain: 2.5 }, { type: 'highshelf', f: 8000, q: 0.7, gain: 1 }] },
  warm:    { name: 'Теплее', bands: [{ type: 'lowshelf', f: 150, q: 0.7, gain: 2 }, { type: 'peak', f: 3500, q: 1, gain: -1.5 }] },
  mud:     { name: 'Убрать бубнёж', bands: [{ type: 'peak', f: 200, q: 1.4, gain: -3 }, { type: 'peak', f: 400, q: 1.4, gain: -2 }] },
  close:   { name: 'Ближе к микрофону', bands: [{ type: 'lowshelf', f: 120, q: 0.7, gain: 1.5 }, { type: 'peak', f: 2500, q: 1, gain: 1.5 }, { type: 'highshelf', f: 6000, q: 0.7, gain: 1 }] },
  air:     { name: 'Воздух', bands: [{ type: 'highshelf', f: 10000, q: 0.7, gain: 2.5 }] },
  phone:   { name: 'Телефон', bands: [{ type: 'hp', f: 300, q: 0.7, gain: 0 }, { type: 'lp', f: 3400, q: 0.7, gain: 0 }, { type: 'peak', f: 1500, q: 1, gain: 3 }] },
  radio:   { name: 'Радио в комнате', bands: [{ type: 'hp', f: 150, q: 0.7, gain: 0 }, { type: 'lp', f: 6000, q: 0.7, gain: 0 }, { type: 'peak', f: 800, q: 1, gain: 2 }] },
};
const EQ_FREQS = Array.from({ length: 240 }, (_, i) => 20 * Math.pow(1000, i / 239));   // 20 Гц … 20 кГц
const EQ_RANGE = 18;

// ------------------------------------------------------------------ воркер обработки
let dspWorker = null, dspSeq = 0; const dspWaiting = new Map();
function dsp() {
  if (dspWorker) return dspWorker;
  if (typeof DSP_WORKER_SRC === 'undefined') return null;
  try {
    dspWorker = new Worker(URL.createObjectURL(new Blob([DSP_WORKER_SRC], { type: 'text/javascript' })));
    dspWorker.onmessage = e => {
      const m = e.data, w = dspWaiting.get(m.id); if (!w) return;
      if (m.type === 'progress') { w.onProgress && w.onProgress(m.p); return; }
      dspWaiting.delete(m.id);
      m.type === 'error' ? w.rej(new Error(m.message)) : w.res(m);
    };
    dspWorker.onerror = () => { for (const w of dspWaiting.values()) w.rej(new Error('обработка в фоне не запустилась')); dspWaiting.clear(); dspWorker = null; };
  } catch { dspWorker = null; }
  return dspWorker;
}
function dspCall(msg, transfer, onProgress) {
  const w = dsp();
  if (!w) return Promise.resolve().then(() => {
    if (msg.type === 'analyze') return { A: C.analyze(msg.y), noise: C.noiseProfile(msg.y), ltas: msg.wantLtas ? C.ltas(msg.y, 2) : null };
    if (msg.type === 'preview') { const specBefore = C.avgSpectrum(msg.y, msg.freqs), lufsBefore = C.integratedLufs(msg.y), r = C.runChain(msg.y, msg.chain, msg.aux); return { y: r.y, log: r.log, specBefore, specAfter: C.avgSpectrum(r.y, msg.freqs), lufsBefore, lufsAfter: C.integratedLufs(r.y), sgAfter: msg.sg ? { ...C.spectrogram(r.y, msg.sg), w: msg.sg.cols } : null, sgBefore: msg.sg && msg.sgBefore ? { ...C.spectrogram(msg.y, msg.sg), w: msg.sg.cols } : null }; }
    if (msg.type === 'synth') return { y: C.synthSound(msg.key) };
    const r = C.runChain(msg.y, msg.chain, msg.aux, onProgress); return { y: r.y, log: r.log };
  });
  return new Promise((res, rej) => { const id = ++dspSeq; dspWaiting.set(id, { res, rej, onProgress }); w.postMessage({ ...msg, id }, transfer || []); });
}

// ------------------------------------------------------------------ состояние файла
function cl(f) {
  if (!f.clean) f.clean = { chain: null, preset: 'normal', A: null, noise: null, noiseOverride: null, ltas: null, at: null, before: null, after: null, busy: false, dirty: true, eqSel: -1 };
  return f.clean;
}
const srcOf = f => f.raw48 || f.y48;
const clone = o => JSON.parse(JSON.stringify(o));
function excerptStart(f) {
  const y = srcOf(f), n = Math.floor(y.length / C.SR), cs = new Float64Array(n + 1);
  for (let s = 0; s < n; s++) { let e = 0; const o = s * C.SR; for (let i = o; i < o + C.SR; i += 8) e += y[i] * y[i]; cs[s + 1] = cs[s] + e; }
  let best = 0, bv = -1; for (let s = 0; s + EXCERPT <= n; s++) { const v = cs[s + EXCERPT] - cs[s]; if (v > bv) { bv = v; best = s; } }
  return best;
}
function waveOf(f) {
  const c = cl(f); if (c.wave) return c.wave;
  const y = srcOf(f), cols = 1600, per = y.length / cols, mn = new Float32Array(cols), mx = new Float32Array(cols);
  for (let x = 0; x < cols; x++) { let lo = 0, hi = 0; const a = Math.floor(x * per), b = Math.floor((x + 1) * per); for (let i = a; i < b; i += 4) { const v = y[i]; if (v < lo) lo = v; if (v > hi) hi = v; } mn[x] = lo; mx[x] = hi; }
  let pk = 0; for (let x = 0; x < cols; x++) pk = Math.max(pk, -mn[x], mx[x]);
  return (c.wave = { mn, mx, pk: pk || 1 });
}
async function analyzeFile(f) {
  const c = cl(f); if (c.A) return c; if (c.pending) return c.pending;
  c.busy = true; renderCleanup();
  c.pending = (async () => {
    try {
      const y = srcOf(f).slice();
      const r = await dspCall({ type: 'analyze', y, wantLtas: false }, [y.buffer]);
      c.A = r.A; c.noise = r.noise;
      if (!c.chain) { const ap = autoPreset(r.A); c.preset = ap.preset; c.presetWhy = ap.why; c.chain = C.defaultChain(c.preset, { boom: r.A.boom }); }
      if (c.at == null) c.at = excerptStart(f);
    } catch (err) { notify('Не удалось разобрать файл: ' + err.message); }
    c.busy = false; c.dirty = true; c.pending = null; renderCleanup(); previewSoon(f);
    return c;
  })();
  return c.pending;
}
/** Пресет по разбору записи: сжатая — «После кодека», гулкая — «Сильно», чуть комнаты — «Обычно», сухая — «Мягко». */
function autoPreset(A) {
  if (A.cutoff && A.cutoff.f <= 14000) return { preset: 'codec', why: `верх обрезан на ${(A.cutoff.f / 1000).toFixed(1)} кГц` };
  if ((A.decay != null && A.decay < 100) || A.boom >= 4) return { preset: 'strong', why: A.decay != null && A.decay < 100 ? 'слышна комната' : 'гулкий низ' };
  if ((A.decay != null && A.decay < 125) || A.floorDb > -55) return { preset: 'normal', why: A.floorDb > -55 ? 'заметный фон' : 'немного комнаты' };
  return { preset: 'soft', why: 'запись сухая и тихая' };
}
async function refLtas(name) {
  const rf = S.files.find(x => x.name === name); if (!rf || !srcOf(rf)) return null;
  const c = cl(rf); if (c.ltas) return c.ltas;
  const y = rf.y48.slice();                          // образец — как он звучит сейчас (после его чистки, если она применена)
  const r = await dspCall({ type: 'analyze', y, wantLtas: true }, [y.buffer]);
  c.A = c.A || r.A; c.noise = c.noise || r.noise; c.ltas = r.ltas; return c.ltas;
}
async function auxFor(f) {
  const c = cl(f);
  return { noise: c.noiseOverride || c.noise, noiseFrom: !!c.noiseOverride,
           refLtas: c.chain.tone.on && c.chain.tone.mode === 'match' && c.chain.tone.ref ? await refLtas(c.chain.tone.ref) : null };
}
let previewTimer = null, previewRun = 0;
function previewSoon(f) { clearTimeout(previewTimer); previewTimer = setTimeout(() => preview(f), 350); }
async function preview(f) {
  const c = cl(f); if (!c.chain || !srcOf(f)) return;
  const run = ++previewRun, y = srcOf(f), a = Math.round(c.at * C.SR), b = Math.min(y.length, a + EXCERPT * C.SR);
  if (!(c.before && c.beforeKey === y && c.beforeAt === a)) { c.before = y.slice(a, b); c.beforeKey = y; c.beforeAt = a; c.sgBefore = null; }   // тот же отрывок — тот же массив: спектрограмма берётся из запомненной
  const seg = c.before.slice(), aux = await auxFor(f);
  try {
    // спектры и громкость «было/стало» считает фоновый поток вместе с обработкой: главный свободен для движения
    const sw = $('#cl-spec-b'), cols = Math.max(300, Math.floor((sw && sw.clientWidth) || 600));
    const r = await dspCall({ type: 'preview', y: seg, chain: c.chain, aux, freqs: EQ_FREQS, sg: { cols, rows: 150 }, sgBefore: !c.sgBefore }, [seg.buffer]);
    if (run !== previewRun) return;
    c.after = r.y; c.previewLog = r.log; c.dirty = false;
    c.specBefore = r.specBefore; c.specAfter = r.specAfter; c.lufsBefore = r.lufsBefore; c.lufsAfter = r.lufsAfter; c.sgAfter = r.sgAfter || null; if (r.sgBefore) c.sgBefore = r.sgBefore;
    if (ab && ab.f === f) abSwapAfter(c.after);
  } catch (err) { notify('Не получилось обработать отрывок: ' + err.message); }
  refreshPreviewUI(f);
}
async function applyFile(f, quiet = false) {
  const c = cl(f); if (!c.chain || c.busy) return;
  c.busy = true; renderCleanup(); S.busy = true;
  try {
    const src = srcOf(f).slice(), aux = await auxFor(f);
    progress(`Обрабатываю ${f.name}…`, 0);
    const r = await dspCall({ type: 'run', y: src, chain: c.chain, aux }, [src.buffer], p => progress(`Обрабатываю ${f.name}: ${Math.round(p * 100)} %`, p));
    if (!f.raw48) f.raw48 = f.y48;
    f.y48 = r.y; c.log = r.log; c.appliedChain = clone(c.chain); c.ltas = null;
    S.result = null; progress('', 0);
    if (!quiet) notify(`${f.name}: обработано. В сведение теперь идёт очищенная версия.`);
  } catch (err) { progress('', 0); notify('Не получилось: ' + err.message); }
  c.busy = false; S.busy = false; render();
}
/** Все записи — как эта: та же чистка и тембр, подогнанный под неё, чтобы голоса звучали из одного места. */
async function matchAllTo(f) {
  const c = cl(f), others = S.files.filter(x => x !== f && srcOf(x) && !x.error);
  if (!others.length) return notify('Других записей нет.');
  await applyFile(f, true);
  for (const o of others) {
    const oc = cl(o); await analyzeFile(o);
    oc.chain = clone(c.chain); oc.preset = c.preset;
    oc.chain.tone = { ...oc.chain.tone, on: true, mode: 'match', ref: f.name, strength: 0.8 };
    oc.dirty = true; await applyFile(o, true);
  }
  notify(`Готово: ${others.length} ${others.length === 1 ? 'запись подогнана' : 'записей подогнаны'} под «${f.name}» — та же чистка и тембр.`);
}
async function applyAll(f) {
  const c = cl(f), others = S.files.filter(x => x !== f && srcOf(x) && !x.error);
  await applyFile(f, true);
  for (const o of others) {
    const oc = cl(o); await analyzeFile(o);
    oc.chain = clone(c.chain); oc.preset = c.preset;
    if (oc.chain.tone.mode === 'match' && oc.chain.tone.ref === o.name) oc.chain.tone.ref = f.name;
    oc.dirty = true; await applyFile(o, true);
  }
  notify(`Обработано файлов: ${others.length + 1}. В сведение идут очищенные версии.`);
}
function revertFile(f) {
  const c = cl(f); if (!f.raw48) return;
  f.y48 = f.raw48; f.raw48 = null; c.log = null; c.appliedChain = null; S.result = null; render();
}
/** Настройки чистки из открытого проекта: та же цепочка, и если файл был обработан — обработать снова. */
async function restoreClean(f) {
  const p = S.pendingClean && S.pendingClean.get(f.name); if (!p) return;
  S.pendingClean.delete(f.name);
  const c = cl(f); c.chain = { ...C.defaultChain(p.preset || 'normal'), ...p.chain }; c.preset = p.preset || 'normal'; c.dirty = true;   // проекты старых версий без новых модулей
  await analyzeFile(f);
  if (p.applied) await applyFile(f, true);
}

// ------------------------------------------------------------------ A/B: оба варианта крутятся по кругу, слышен один
let ab = null;
function abPlay(f, which) {
  const c = cl(f); if (!c.before) return;
  if (ab && ab.f === f) { if (ab.which === which) return abStop(); abSwitch(which); return; }
  abStop(); stop();
  const ctx = audioCtx(); ctx.resume();
  const mk = buf => { const b = ctx.createBuffer(1, buf.length, C.SR); b.copyToChannel(buf, 0); const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; const g = ctx.createGain(); g.gain.value = 0; s.connect(g); g.connect(audioOut()); return { s, g }; };
  const t0 = ctx.currentTime + 0.03, A = mk(c.before), B = mk(c.after && !c.dirty ? c.after : c.before);
  A.s.start(t0); B.s.start(t0);
  ab = { f, A, B, t0, len: c.before.length / C.SR, which: null };
  abSwitch(which);
}
function abSwitch(which) {
  const t = audioCtx().currentTime;
  ab.A.g.gain.setTargetAtTime(which === 'before' ? 1 : 0, t, 0.004);
  ab.B.g.gain.setTargetAtTime(which === 'after' ? 1 : 0, t, 0.004);
  ab.which = which; abButtons();
}
function abSwapAfter(after) {                        // отрывок пересчитан во время прослушивания — подменяем на лету
  const ctx = audioCtx(), pos = (ctx.currentTime - ab.t0) % ab.len;
  try { ab.B.s.stop(); } catch {}
  const b = ctx.createBuffer(1, after.length, C.SR); b.copyToChannel(after, 0);
  const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.connect(ab.B.g); s.start(ctx.currentTime, Math.min(pos, after.length / C.SR - 0.01));
  ab.B.s = s;
}
function abStop() { if (!ab) return; try { ab.A.s.stop(); ab.B.s.stop(); } catch {} ab = null; abButtons(); }
function abButtons() {
  document.querySelectorAll('#cl-body .play.ab').forEach(b => b.classList.toggle('on', !!ab && ab.f === S.cleanFile && ab.which === b.dataset.act));
}

// ------------------------------------------------------------------ картинки
const CMAP = [[0, [14, 11, 9]], [0.22, [58, 26, 22]], [0.48, [150, 58, 30]], [0.74, [232, 150, 38]], [1, [252, 238, 196]]];   // тёплая: окись → янтарь → белый
function colorOfMap(v) {
  for (let i = 1; i < CMAP.length; i++) if (v <= CMAP[i][0]) { const [p0, c0] = CMAP[i - 1], [p1, c1] = CMAP[i], t = (v - p0) / (p1 - p0); return c0.map((a, k) => a + (c1[k] - a) * t); }
  return CMAP[CMAP.length - 1][1];
}
const CMAP_LUT = Array.from({ length: 256 }, (_, i) => colorOfMap(i / 255));   // готовые 256 цветов: без интерполяции на каждый пиксель
function color(v) {
  return CMAP_LUT[Math.round(v * 255)];
}
function drawSpec(canvas, y, ready) {
  if (!canvas) return;
  const W = Math.max(300, Math.floor(canvas.clientWidth || 600)), H = 150;
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  if (!y) { g.fillStyle = '#0e1220'; g.fillRect(0, 0, W, H); return; }
  const hit = SPEC_IMG.get(y); if (hit && hit.W === W) { g.putImageData(hit.img, 0, 0); return; }   // тот же отрывок — без нового БПФ
  const sp = ready && ready.w === W && ready.rows === H ? ready : C.spectrogram(y, { cols: W, rows: H }), img = g.createImageData(W, H), d = img.data;
  for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) {
    const col = Math.min(sp.cols - 1, Math.floor(x * sp.cols / W)), v = (sp.data[r * sp.cols + col] - sp.min) / (sp.max - sp.min), c = color(Math.max(0, Math.min(1, v)));
    const o = (r * W + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); SPEC_IMG.set(y, { W, img });
}
const SPEC_IMG = new WeakMap();
// Цвета и шрифты из CSS — с запоминанием: таймлайн и графики спрашивают их сотни раз за перерисовку, а каждый
// getComputedStyle может заставить браузер пересчитать стили. Сбрасывается при смене темы.
const CSSV = { map: new Map(), key: '', mq: window.matchMedia('(prefers-color-scheme: dark)') };
const cssVar = n => {
  const k = (document.documentElement.dataset.theme || '') + (CSSV.mq.matches ? 'd' : 'l'); if (k !== CSSV.key) { CSSV.map.clear(); CSSV.key = k; }
  let v = CSSV.map.get(n); if (v == null) { v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); CSSV.map.set(n, v); } return v;
};
function drawWave(canvas, f) {
  if (!canvas) return;
  const c = cl(f), w = waveOf(f), W = Math.max(300, Math.floor(canvas.clientWidth || 600)), H = 56, dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr);
  g.fillStyle = cssVar('--bg'); g.fillRect(0, 0, W, H);
  const dur = srcOf(f).length / C.SR, x0 = c.at / dur * W, x1 = Math.min(W, (c.at + EXCERPT) / dur * W);
  g.fillStyle = cssVar('--accent-soft'); g.fillRect(x0, 0, Math.max(2, x1 - x0), H);
  g.fillStyle = cssVar('--muted');
  for (let x = 0; x < W; x++) { const k = Math.floor(x * w.mn.length / W), lo = w.mn[k] / w.pk, hi = w.mx[k] / w.pk; g.fillRect(x, H / 2 - hi * H / 2 * 0.95, 1, Math.max(1, (hi - lo) * H / 2 * 0.95)); }
  g.strokeStyle = cssVar('--accent'); g.lineWidth = 2; g.strokeRect(x0 + 1, 1, Math.max(2, x1 - x0) - 2, H - 2);
}
const fx = (f, W) => Math.log(f / 20) / Math.log(1000) * W, fInv = (x, W) => 20 * Math.pow(1000, x / W);
const gy = (g, H) => H / 2 - g / EQ_RANGE * (H / 2), gInv = (y, H) => (H / 2 - y) / (H / 2) * EQ_RANGE;
function otherCoefs(c) {
  const out = [], ch = c.chain;
  if (ch.hp.on) { if (+ch.hp.slope === 24) out.push(C.biquad('hp', ch.hp.fc, 0.5412), C.biquad('hp', ch.hp.fc, 1.3066)); else out.push(C.biquad('hp', ch.hp.fc, 0.707)); }
  if (ch.tones && ch.tones.on && c.A && c.A.tones) for (const t of c.A.tones) out.push(C.biquad('peak', t.f, Math.max(10, Math.min(120, t.f / Math.max(40, 2 * t.width))), -Math.max(10, Math.min(30, t.prom + 3))));
  if (ch.dehum.on && c.A && c.A.hum) for (const p of c.A.hum.peaks.slice(0, 6)) out.push(C.biquad('peak', p.f, 30, -Math.max(10, Math.min(30, p.prom + 3))));
  if (ch.eq5 && ch.eq5.on) for (const b of C.eq5Bands(ch.eq5)) { const co = C.bandCoefs(b); if (co) out.push(co); }
  if (ch.tone.on && ch.tone.mode === 'auto' && c.A && c.A.octaves) for (const [fc, ref] of Object.entries(C.TONE_REF)) { const d = Math.max(-8, Math.min(0, ref + 2 - c.A.octaves[fc]) * ch.tone.strength); if (d <= -0.5) out.push(C.biquad('peak', +fc, 1.0, d)); }
  return out;
}
// ------------------------------------------------------------------ эквалайзер: экран-анализатор
// Экран всегда тёмный, как у анализатора: серым — спектр отрывка «было», зелёным — «стало», пунктиром — что делают
// другие модули, янтарём — кривая эквалайзера. У каждой полосы свой цвет — тот же у ручки и у карточки.
// Ручки на пружинах: под курсором подрастают, новая выскакивает, убранная сжимается; кривая перетекает при
// пресетах, смене типа, добавлении и удалении полосы. Над ручкой — подсказка с числами (nums.js).
const EQ_COL = ['#F2B233', '#8DB1E6', '#E59ABD', '#7ED0A8', '#B9A3EA', '#85CDE0', '#EDB072', '#C6D27C', '#DDAE8C', '#F07B6C'];
const EQ_SHAPE = { peak: 'M1.5 11h3c1.6 0 2-6.5 3.5-6.5S10 11 11.5 11h3', lowshelf: 'M1.5 5h3.5c2 0 3 6 5 6h4.5', highshelf: 'M1.5 11h4c2 0 3-6 5-6h4', hp: 'M2 14c1-7 2.2-9 5-9h7.5', lp: 'M1.5 5h7.5c2.8 0 4 2 5 9', notch: 'M1.5 5h4.5l2 7 2-7h4.5' };
const EQV = { hs: new WeakMap(), fresh: new WeakSet(), keys: new WeakMap(), n: 0, morph: null, hover: null, hoverI: -1, drag: -1, kbd: false, gone: [] };
EQV.owner = { render() { drawEq($('#eq-canvas'), S.cleanFile); } };
const eqCol = i => EQ_COL[i % EQ_COL.length];
const eqBandKey = b => { if (!EQV.keys.has(b)) EQV.keys.set(b, 'b' + (++EQV.n)); return EQV.keys.get(b); };
function eqHs(b) { if (!EQV.hs.has(b)) { const fresh = EQV.fresh.has(b), m = mv(fresh ? 0 : 1, 0.001, EQV.owner); EQV.hs.set(b, m); if (fresh) { EQV.fresh.delete(b); mvTo(m, 1, { damping: 0.55, response: 0.42 }); } } return EQV.hs.get(b); }
/** Перед изменением полос: кривая запомнит, откуда перетекать. */
function eqMorph(f) { const c = cl(f); if (!c._eqR || (typeof MOTION !== 'undefined' && MOTION.reduce)) { EQV.morph = null; return; } EQV.morph = { from: Float64Array.from(c._eqR), m: mv(0, 0.001, EQV.owner) }; mvTo(EQV.morph.m, 1, { damping: 1, response: 0.36 }); }
function eqGone(f, i) { const c = cl(f), b = c.chain.eq.bands[i]; if (!b || !c.eqW) return; const m = mv(eqHs(b).v, 0.01, EQV.owner); EQV.gone.push({ x: fx(b.f, c.eqW), y: gy(NO_GAIN.has(b.type) ? 0 : b.gain, c.eqH), col: eqCol(i), m }); mvTo(m, 0, { damping: 1, response: 0.2 }); }
const eqFmtF = f => f >= 1000 ? [(f / 1000).toFixed(f >= 10000 ? 1 : 2).replace('.', ','), 'кГц'] : [String(Math.round(f)), 'Гц'];
const eqFmtG = g => (g > 0 ? '+' : g < 0 ? '−' : '') + Math.abs(g).toFixed(1).replace('.', ',');
const eqFmtQ = q => q.toFixed(q < 10 ? 2 : 1).replace('.', ',');
function drawEq(canvas, f) {
  if (!canvas || !f) return;
  const c = cl(f), ch = c.chain, dpr = window.devicePixelRatio || 1;
  const W = Math.max(300, Math.floor(canvas.clientWidth || 700)), H = Math.max(180, Math.floor(canvas.clientHeight || 280));
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const mono = cssVar('--mono'), bands = ch.eq.bands, y0 = gy(0, H);
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1C1612'); bg.addColorStop(1, '#0E0B09'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // сетка: октавы тонко, подписи — снизу и слева
  g.lineWidth = 1;
  for (const fr of [20, 30, 40, 60, 70, 80, 90, 300, 400, 600, 700, 800, 900, 3000, 4000, 6000, 7000, 8000, 9000]) { const x = Math.round(fx(fr, W)) + 0.5; g.strokeStyle = 'rgba(239,233,226,0.035)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  g.font = '10px ' + mono; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  for (const fr of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = Math.round(fx(fr, W)) + 0.5; g.strokeStyle = 'rgba(239,233,226,0.08)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.fillStyle = 'rgba(239,233,226,0.42)'; g.fillText(fr >= 1000 ? fr / 1000 + 'к' : String(fr), x, H - 5); }
  g.textAlign = 'left';
  for (const db of [-12, -6, 0, 6, 12]) { const y = Math.round(gy(db, H)) + 0.5; g.strokeStyle = db ? 'rgba(239,233,226,0.07)' : 'rgba(239,233,226,0.2)'; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.fillStyle = 'rgba(239,233,226,0.42)'; g.fillText((db > 0 ? '+' : db < 0 ? '−' : '') + Math.abs(db), 6, y - 4); }
  // анализатор: было — заливкой, стало — линией (своя шкала: 70 дБ от максимума)
  const spec = (arr, top) => { g.beginPath(); for (let i = 0; i < EQ_FREQS.length; i++) { const x = fx(EQ_FREQS[i], W), y = Math.min(H, (top - arr[i]) / 70 * H); i ? g.lineTo(x, y) : g.moveTo(x, y); } };
  if (c.specBefore) {
    let top = -200; for (const v of c.specBefore) top = Math.max(top, v); top += 2;
    spec(c.specBefore, top); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fillStyle = 'rgba(171,161,151,0.15)'; g.fill();
    if (c.specAfter && !c.dirty) { spec(c.specAfter, top); g.strokeStyle = 'rgba(108,197,146,0.85)'; g.lineWidth = 1.4; g.stroke(); }
  }
  const curve = (r, close) => { g.beginPath(); for (let i = 0; i < r.length; i++) { const x = fx(EQ_FREQS[i], W), y = gy(Math.max(-EQ_RANGE, Math.min(EQ_RANGE, r[i])), H); i ? g.lineTo(x, y) : g.moveTo(x, y); } if (close) { g.lineTo(W, y0); g.lineTo(0, y0); g.closePath(); } };
  // остальная обработка пунктиром
  const other = otherCoefs(c);
  if (other.length) { g.setLineDash([4, 4]); g.strokeStyle = 'rgba(239,233,226,0.38)'; g.lineWidth = 1.2; curve(C.responseOf(other, EQ_FREQS)); g.stroke(); g.setLineDash([]); }
  // вклад полосы в фокусе — её цветом
  const focus = EQV.drag >= 0 ? EQV.drag : EQV.hoverI >= 0 ? EQV.hoverI : c.eqSel;
  if (focus >= 0 && bands[focus] && !bands[focus].off && ch.eq.on) { const col = eqCol(focus); curve(C.eqResponse([bands[focus]], EQ_FREQS), true); g.fillStyle = col + '30'; g.fill(); curve(C.eqResponse([bands[focus]], EQ_FREQS)); g.strokeStyle = col + '99'; g.lineWidth = 1; g.stroke(); }
  // кривая эквалайзера: перетекает из прежней, если полосы только что поменялись
  let r = C.eqResponse(bands, EQ_FREQS);
  const mo = EQV.morph; if (mo && mo.from.length === r.length) { const k = mo.m.v; r = r.map((v, i) => mo.from[i] + (v - mo.from[i]) * k); if (!SPRING.live.has(mo.m)) EQV.morph = null; }
  c._eqR = r;
  if (ch.eq.on) { const fill = g.createLinearGradient(0, 0, 0, H); fill.addColorStop(0, 'rgba(242,178,51,0.22)'); fill.addColorStop(0.5, 'rgba(242,178,51,0.04)'); fill.addColorStop(1, 'rgba(242,178,51,0.22)'); curve(r, true); g.fillStyle = fill; g.fill(); }
  curve(r); g.strokeStyle = ch.eq.on ? '#F2B233' : 'rgba(239,233,226,0.35)'; g.lineWidth = 2.4; g.lineJoin = 'round';
  if (ch.eq.on) { g.shadowColor = 'rgba(242,178,51,0.55)'; g.shadowBlur = 10; } g.stroke(); g.shadowBlur = 0;
  // убранные ручки сжимаются
  EQV.gone = EQV.gone.filter(q => { const s = q.m.v; if (s < 0.02) return false; g.beginPath(); g.arc(q.x, q.y, 7.5 * s, 0, Math.PI * 2); g.fillStyle = q.col; g.globalAlpha = s; g.fill(); g.globalAlpha = 1; return true; });
  // ручки полос: под курсором подрастают, в руке — ещё больше
  bands.forEach((b, i) => {
    const x = fx(b.f, W), y = gy(NO_GAIN.has(b.type) ? 0 : b.gain, H), col = eqCol(i), sel = i === c.eqSel, hs = eqHs(b);
    const want = EQV.drag === i ? 1.45 : EQV.hoverI === i ? 1.28 : 1; if (hs.to >= 0.99 && hs.to !== want) mvTo(hs, want, { damping: 0.62, response: 0.3 });
    const s = hs.v, R = 7.5 * s; if (s < 0.02) return;
    if (sel || EQV.hoverI === i || EQV.drag === i) { g.beginPath(); g.arc(x, y, R + 9, 0, Math.PI * 2); g.fillStyle = col + '26'; g.fill(); }
    if (sel) { g.beginPath(); g.arc(x, y, R + 4, 0, Math.PI * 2); g.strokeStyle = col; g.lineWidth = 1.6; g.stroke(); }
    g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2);
    if (b.off) { g.fillStyle = '#2A231E'; g.fill(); g.strokeStyle = col + '88'; g.lineWidth = 1.5; g.stroke(); } else { g.fillStyle = col; g.fill(); g.strokeStyle = '#120E0B'; g.lineWidth = 2; g.stroke(); }
    if (s > 0.6) { g.fillStyle = b.off ? col : '#1B1400'; g.font = `700 ${Math.round(10.5 * Math.min(1.25, s))}px ` + cssVar('--display'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x, y + 0.5); g.textBaseline = 'alphabetic'; g.textAlign = 'left'; }
  });
  // курсор по пустому месту: частота под ним и подсказка
  const hv = EQV.hover;
  if (hv && EQV.hoverI < 0 && EQV.drag < 0) {
    const x = Math.round(hv.x) + 0.5, [fv, fu] = eqFmtF(fInv(hv.x, W));
    g.strokeStyle = 'rgba(239,233,226,0.22)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H - 18); g.stroke();
    const t = `${fv} ${fu}`, tw = g.measureText(t).width + 14, lx = Math.max(2, Math.min(W - tw - 2, x - tw / 2));
    g.fillStyle = 'rgba(239,233,226,0.92)'; g.beginPath(); g.roundRect(lx, H - 19, tw, 16, 8); g.fill(); g.fillStyle = '#14100D'; g.font = '600 10px ' + mono; g.textAlign = 'center'; g.fillText(t, lx + tw / 2, H - 7.5); g.textAlign = 'left';
    if (bands.length < 10) { g.fillStyle = 'rgba(239,233,226,0.5)'; g.font = '11px ' + cssVar('--sans'); g.textAlign = 'right'; g.fillText('двойной щелчок — полоса здесь', W - 10, 16); g.textAlign = 'left'; }
  }
  c.eqW = W; c.eqH = H;
  eqTip(canvas, c, W, H);
}
/** Подсказка над ручкой: частота, усиление, добротность — числа въезжают (nums.js). */
function eqTip(canvas, c, W, H) {
  const tip = canvas.parentElement && canvas.parentElement.querySelector('.eq-tip'); if (!tip) return;
  const bands = c.chain.eq.bands, i = EQV.drag >= 0 ? EQV.drag : EQV.hoverI >= 0 ? EQV.hoverI : EQV.kbd ? c.eqSel : -1, b = bands[i];
  if (!b) { tip.classList.remove('on'); return; }
  const x = Math.max(96, Math.min(W - 96, fx(b.f, W))), y = gy(NO_GAIN.has(b.type) ? 0 : b.gain, H), [fv, fu] = eqFmtF(b.f);
  const set = (sel, t) => { const el = tip.querySelector(sel); if (el && el.textContent !== t) el.textContent = t; };
  set('.tf', fv); set('.tfu', fu); set('.tg', NO_GAIN.has(b.type) ? '—' : eqFmtG(b.gain)); set('.tq', eqFmtQ(b.q));
  tip.style.setProperty('--tc', eqCol(i)); tip.dataset.side = y < 70 ? 'below' : 'above';
  tip.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; tip.classList.add('on');
}

// ------------------------------------------------------------------ отрисовка
function hintChips(A) {
  if (!A) return '';
  const out = [];
  if (A.hum) out.push(`<span class="hint bad">гул ${A.hum.base} Гц, +${A.hum.peaks[0].prom} дБ</span>`); else out.push('<span class="hint ok">гула нет</span>');
  out.push(`<span class="hint ${A.floorDb > -50 ? 'bad' : A.floorDb > -60 ? 'mid' : 'ok'}">фон ${A.floorDb.toFixed(0)} дБ</span>`);
  if (A.boom >= 4) out.push(`<span class="hint bad">низ +${A.boom} дБ — гулко</span>`); else if (A.boom >= 2) out.push(`<span class="hint mid">низ +${A.boom} дБ</span>`);
  if (A.decay != null) out.push(`<span class="hint ${A.decay < 100 ? 'bad' : A.decay < 125 ? 'mid' : 'ok'}">спад ${A.decay} дБ/с — ${A.decay < 100 ? 'комната' : A.decay < 125 ? 'немного комнаты' : 'сухо'}</span>`);
  if (A.peakDb > -0.3) out.push('<span class="hint bad">пики у потолка — возможен клиппинг</span>');
  if (A.cutoff) out.push(`<span class="hint mid">верх обрезан на ${(A.cutoff.f / 1000).toFixed(1)} кГц — сжатая запись</span>`);
  if (A.tones && A.tones.length) out.push(`<span class="hint bad">призвук ${A.tones.slice(0, 3).map(t => t.f >= 1000 ? (t.f / 1000).toFixed(1) + ' кГц' : t.f + ' Гц').join(', ')}</span>`);
  out.push(`<span class="hint">${A.lufs.toFixed(1)} LUFS · пик ${A.peakDb.toFixed(1)} дБ</span>`);
  return out.join('');
}
function paramHtml(mod, p, c, f) {
  const chain = c.chain, v = chain[mod.k][p.k];
  if (p.type === 'select') return `<label class="prm"><span>${esc(p.label || '')}</span><select data-m="${mod.k}" data-p="${p.k}">${p.opts.map(([val, t]) => `<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
  if (p.type === 'ref') {
    if (chain.tone.mode !== 'match') return '';
    const others = S.files.filter(x => x !== f && srcOf(x));
    return `<label class="prm"><span>образец</span><select data-m="tone" data-p="ref">${others.length ? others.map(x => `<option value="${esc(x.name)}" ${chain.tone.ref === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('') : '<option value="">нет других записей</option>'}</select></label>`;
  }
  if (p.type === 'noise') return c.noiseOverride
    ? `<div class="prm"><span>профиль шума: из отрывка с ${fmt(c.noiseFrom)} <button class="ghost-b tiny" data-act="noise-reset">из всего файла</button></span></div>`
    : `<div class="prm"><span>профиль шума: из тихих мест файла <button class="ghost-b tiny" data-act="noise-here">взять из этого отрывка</button></span></div>`;
  const shown = p.pct ? `${Math.round(v * 100)} %` : `${v}${p.unit ? ' ' + p.unit : ''}`;
  return `<label class="prm"><span>${esc(p.label)} <b data-num="cl:${mod.k}.${p.k}">${shown}</b></span><input type="range" data-m="${mod.k}" data-p="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}"></label>`;
}
/** Число, которое тянут мышью или пальцем (влево-вниз — меньше, вправо-вверх — больше), щелчок — ввести с клавиатуры. */
function scrubHtml(m, i, p, label, v, unit, key, dis, short) {
  const lim = SCRUB_SPEC[m === 'eq5' ? 'f5' : p];
  return `<span class="scrub${dis ? ' dis' : ''}" role="spinbutton" tabindex="${dis ? -1 : 0}" data-m="${m}" data-b="${i}" data-p="${p}" aria-label="${esc(label)}" aria-valuemin="${lim.min}" aria-valuemax="${lim.max}" aria-valuenow="${v}"${dis ? ' aria-disabled="true"' : ''}>${short ? `<span class="sl">${esc(short)}</span>` : ''}<span class="sv-row"><span class="sv" data-num="${key}">${scrubText(p, v)[0]}</span><span class="su">${scrubText(p, v)[1] || unit}</span></span></span>`;
}
function scrubText(p, v) { return p === 'f' ? eqFmtF(v) : p === 'gain' ? [eqFmtG(v), 'дБ'] : [eqFmtQ(v), '']; }
function eq5Html(c) {
  const p = c.chain.eq5;
  return `<div class="eq5">${p.f.map((f, i) => `<div class="eqb"><b data-num="eq5:${i}">${eqFmtG(p.g[i])}</b><input type="range" class="v" data-m="eq5" data-b="${i}" data-p="g" min="-12" max="12" step="0.5" value="${p.g[i]}" aria-label="усиление полосы ${Math.round(f)} Гц">${scrubHtml('eq5', i, 'f', `частота полосы ${i + 1}`, f, '', 'eq5f:' + i)}</div>`).join('')}</div>`;
}
function bandsHtml(c) {
  const cards = c.chain.eq.bands.map((b, i) => { const k = eqBandKey(b), ng = NO_GAIN.has(b.type);
    return `<div class="bcard ${i === c.eqSel ? 'sel' : ''} ${b.off ? 'off' : ''}" data-b="${i}" data-k="${k}" style="--bc:${eqCol(i)}">
      <div class="bc-head"><span class="bc-n">${i + 1}</span>
        <label class="bc-type"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="${EQ_SHAPE[b.type] || EQ_SHAPE.peak}"/></svg><select data-m="eq" data-b="${i}" data-p="type" aria-label="тип полосы ${i + 1}">${BAND_TYPES.map(([t, n]) => `<option value="${t}" ${b.type === t ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button class="icon xs solo" data-act="band-solo" data-b="${i}" title="Слушать только эту полосу" aria-label="Слушать только полосу ${i + 1}">S</button>
        <button class="icon xs" data-act="band-off" data-b="${i}" title="${b.off ? 'Включить полосу' : 'Выключить полосу'}" aria-label="${b.off ? 'Включить' : 'Выключить'} полосу ${i + 1}" aria-pressed="${!b.off}">${ic(b.off ? 'off' : 'on')}</button>
        <button class="icon xs" data-act="band-rm" data-b="${i}" title="Убрать полосу" aria-label="Убрать полосу ${i + 1}">${ic('close')}</button></div>
      <div class="bc-vals">${scrubHtml('eq', i, 'f', `частота, полоса ${i + 1}`, b.f, '', `eqb:${k}.f`, false, 'частота')}${scrubHtml('eq', i, 'gain', `усиление, полоса ${i + 1}`, b.gain, 'дБ', `eqb:${k}.g`, ng, 'усиление')}${scrubHtml('eq', i, 'q', `ширина (Q), полоса ${i + 1}`, b.q, '', `eqb:${k}.q`, false, 'Q')}</div>
    </div>`; }).join('');
  return `<div class="bcards">${cards}${c.chain.eq.bands.length < 10 ? `<button class="bc-add" data-act="band-add">${ic('plus')}<span>полоса</span></button>` : ''}</div>
    <p class="muted small eq-hint">На экране: тянуть кружок — частота и усиление, колёсико — ширина, двойной щелчок по пустому — новая полоса, по кружку — убрать; стрелки и Tab — с клавиатуры. Числа в карточках тянут мышью или пальцем, щелчок — ввести.</p>`;
}
function eqModuleHtml(c) {
  const ch = c.chain;
  return `<div class="mod eq-mod ${ch.eq.on ? 'on' : ''}">
    <div class="eq-top"><label class="mhead"><input type="checkbox" data-m="eq" data-p="on" ${ch.eq.on ? 'checked' : ''}><b>Эквалайзер</b><span>до 10 полос; пресеты — отправная точка</span></label>
      <div class="eq-presets" role="group" aria-label="Пресеты эквалайзера">${Object.entries(EQ_PRESETS).map(([k, p]) => `<button class="ghost-b tiny" data-eqpreset="${k}">${p.name}</button>`).join('')}</div></div>
    <div class="eq-screen">
      <canvas id="eq-canvas" class="eqg" tabindex="0" aria-label="График эквалайзера: стрелки двигают выбранную полосу, Tab — следующая"></canvas>
      <div class="eq-tip" aria-hidden="true"><div class="eq-tip-in"><i></i><span><b class="tf" data-num="eqtip.f"></b> <span class="tfu"></span></span><span class="sep">·</span><span><b class="tg" data-num="eqtip.g"></b> дБ</span><span class="sep">·</span><span>Q <b class="tq" data-num="eqtip.q"></b></span></div></div>
      <div class="eq-legend" aria-hidden="true"><span><i class="lg-b"></i>было</span><span><i class="lg-a"></i>стало</span><span><i class="lg-o"></i>другие модули</span><span><i class="lg-e"></i>эквалайзер</span></div>
    </div>
    ${bandsHtml(c)}
  </div>`;
}
function renderCleanup() {
  const pane = $('#cl-body'); if (!pane) return;
  const files = S.files.filter(f => srcOf(f) && !f.error);
  if (!files.length) { pane.innerHTML = '<p class="muted">Добавьте записи — здесь же или на вкладке «Сборка». Чистить можно любой файл, не только тот, что идёт в спектакль.</p>'; return; }
  if (!S.cleanFile || !files.includes(S.cleanFile)) S.cleanFile = files[0];
  const f = S.cleanFile, c = cl(f);
  const tabs = `<div class="cl-files">${files.map(x => `<button class="ftab ${x === f ? 'on' : ''}" data-name="${esc(x.name)}">${esc(x.name)}${x.raw48 ? ` <i title="очищено">${ic('check')}</i>` : ''}</button>`).join('')}</div>`;
  if (!c.A) { pane.innerHTML = tabs + `<p class="muted">${c.busy ? 'Смотрю, что с записью…' : 'Разбираю…'}</p>`; if (typeof segInd === 'function') segInd(pane.querySelector('.cl-files'), 'cl-files'); if (!c.busy) analyzeFile(f); return; }
  const chain = c.chain, dur = srcOf(f).length / C.SR;
  const mods = MODULES.map(m => `
    <div class="mod ${chain[m.k].on ? 'on' : ''}">
      <label class="mhead"><input type="checkbox" data-m="${m.k}" data-p="on" ${chain[m.k].on ? 'checked' : ''}><b>${m.name}</b><span>${m.desc}</span></label>
      <div class="mprm">${m.k === 'eq5' ? eq5Html(c) : m.params.map(p => paramHtml(m, p, c, f)).join('')}</div>
    </div>`).join('');
  pane.innerHTML = tabs + `
    <div class="cl-head"><div class="hints">${hintChips(c.A)}</div>
      <div class="presets">${Object.entries(PRESET_NAMES).map(([k, n]) => `<button class="ghost-b ${c.preset === k ? 'on' : ''}" data-preset="${k}">${n}</button>`).join('')}${c.presetWhy ? `<span class="muted small">«${PRESET_NAMES[c.presetAuto || c.preset] || ''}» выбран сам: ${esc(c.presetWhy)}</span>` : ''}</div></div>
    <div class="mods">${mods}</div>
    ${eqModuleHtml(c)}
    <div class="cl-ab">
      <div class="wave-wrap"><canvas id="cl-wave" class="wave" aria-label="Обзор записи; щёлкните, чтобы выбрать отрывок"></canvas>
        <label class="prm"><span>Отрывок: с <b id="cl-at-t" data-num="clat">${fmt(c.at)}</b>, ${EXCERPT} с — щёлкните по волне или подвиньте</span><input type="range" id="cl-at" min="0" max="${Math.max(0, Math.floor(dur - EXCERPT))}" step="1" value="${c.at}"></label></div>
      <div class="ab-top">
        <button class="play ab" data-act="before" ${c.before ? '' : 'disabled'}>${ic('play')}Было</button>
        <button class="play ab" data-act="after" ${c.after && !c.dirty ? '' : 'disabled'}>${ic('play')}Стало</button>
        <span class="muted small">во время прослушивания переключается мгновенно, по кругу</span>
        <span class="lufs" id="cl-lufs" data-num="cllufs"></span>
      </div>
      <div class="specs"><div><span class="lbl">было</span><canvas id="cl-spec-a"></canvas></div><div><span class="lbl" id="cl-lbl-b">стало${c.dirty ? ' — считаю…' : ''}</span><canvas id="cl-spec-b"></canvas></div></div>
      <p class="muted small" id="cl-plog"></p>
    </div>
    <div class="cl-spec">
      <div class="specv-bar"><button class="ghost-b" data-act="spec-open">${c.specOpen ? 'Скрыть спектр файла' : 'Спектр всего файла'}</button>
        ${c.specOpen ? `<button class="ghost-b" data-act="spec-fit">Весь файл</button>${f.raw48 ? `<button class="ghost-b" data-act="spec-which">${c.specView.which === 'after' ? 'показано: стало' : 'показано: было'}</button>` : ''}<button class="play ab" data-act="spec-play">${ic('play')}8 с с курсора</button><span>колёсико — увеличить, тянуть — двигать, двойной щелчок — сюда отрывок</span><span id="spec-readout"></span>` : ''}</div>
      ${c.specOpen ? '<canvas id="spec-view" class="specv" aria-label="Спектрограмма всего файла"></canvas>' : ''}
    </div>
    <div class="cl-actions">
      <button class="primary" data-act="apply" ${c.busy ? 'disabled' : ''}>${f.raw48 ? 'Применить заново ко всему файлу' : 'Применить ко всему файлу'}</button>
      ${files.length > 1 ? `<button class="ghost-b" data-act="apply-all" ${c.busy ? 'disabled' : ''}>Ко всем файлам с этими настройками</button><button class="ghost-b" data-act="match-all" ${c.busy ? 'disabled' : ''} title="Та же чистка всем записям и тембр, подогнанный под эту">Все записи — как эта</button>` : ''}
      ${f.raw48 ? '<button class="ghost-b" data-act="revert">Вернуть оригинал</button><button class="ghost-b" data-act="wav">Скачать WAV</button>' : ''}
      <span class="muted small" id="cl-applied">${f.raw48 ? 'В сведение идёт обработанная версия. ' + (c.log ? c.log.join(' · ') : '') : 'Пока в сведение идёт оригинал.'}</span>
    </div>`;
  if (typeof segInd === 'function') { segInd(pane.querySelector('.presets'), 'cl-presets'); segInd(pane.querySelector('.cl-files'), 'cl-files'); }
  requestAnimationFrame(() => { drawWave($('#cl-wave'), f); if (c.before && (c.sgBefore || SPEC_IMG.has(c.before))) drawSpec($('#cl-spec-a'), c.before, c.sgBefore); refreshPreviewUI(f); abButtons(); if (c.specOpen) drawSpecView(f); });
}
// ------------------------------------------------------------------ спектр всего файла с зумом
function drawSpecView(f) {
  const cv = $('#spec-view'); if (!cv) return;
  const c = cl(f), v = c.specView, y = v.which === 'after' && f.raw48 ? f.y48 : srcOf(f), dur = y.length / C.SR;
  const W = Math.max(320, Math.floor(cv.clientWidth || 800)), H = 320, dpr = window.devicePixelRatio || 1;
  const span = dur / v.zoom; v.center = Math.max(span / 2, Math.min(dur - span / 2, v.center));
  const a = v.center - span / 2, b = v.center + span / 2;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const seg = y.subarray(Math.round(a * C.SR), Math.round(b * C.SR));
  const sp = C.spectrogram(seg, { cols: W, rows: H, fmin: 40, fmax: 20000 }), img = g.createImageData(W, H), d = img.data;
  for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) {
    const col = Math.min(sp.cols - 1, Math.floor(x * sp.cols / W)), val = (sp.data[r * sp.cols + col] - sp.min) / (sp.max - sp.min), cc = color(Math.max(0, Math.min(1, val)));
    const o = (r * W + x) * 4; d[o] = cc[0]; d[o + 1] = cc[1]; d[o + 2] = cc[2]; d[o + 3] = 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; tmp.getContext('2d').putImageData(img, 0, 0);
  g.drawImage(tmp, 0, 0, W, H);
  // оси: частота слева (логарифмическая 40–20000), время снизу
  g.font = '11px ' + cssVar('--mono'); g.fillStyle = 'rgba(255,255,255,.75)'; g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
  for (const fr of [100, 200, 500, 1000, 2000, 5000, 10000]) { const yy = H - Math.log(fr / 40) / Math.log(20000 / 40) * H; g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke(); g.fillText(fr >= 1000 ? fr / 1000 + 'к' : String(fr), 3, yy - 2); }
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120].find(s => span / s <= 12) || 300;
  g.textAlign = 'center';
  for (let t = Math.ceil(a / step) * step; t < b; t += step) { const x = (t - a) / span * W; g.beginPath(); g.moveTo(x, H - 14); g.lineTo(x, H); g.stroke(); g.fillText(fmt(t), x, H - 3); }
  g.textAlign = 'left';
  if (v.cursor != null && v.cursor >= a && v.cursor <= b) { const x = (v.cursor - a) / span * W; g.strokeStyle = cssVar('--accent'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  const ex = (c.at - a) / span * W, ew = EXCERPT / span * W;
  if (ex + ew > 0 && ex < W) { g.strokeStyle = 'rgba(255,255,255,.7)'; g.setLineDash([3, 3]); g.strokeRect(ex, 1, ew, H - 2); g.setLineDash([]); }
  v.a = a; v.b = b; v.W = W; v.H = H;
  const ro = $('#spec-readout'); if (ro) ro.innerHTML = `<b>${fmt(a)}–${fmt(b)}</b> · ×${v.zoom.toFixed(v.zoom < 10 ? 1 : 0)}`;
}
function specViewPos(e) { const cv = $('#spec-view'), r = cv.getBoundingClientRect(), v = cl(S.cleanFile).specView; const t = v.a + (e.clientX - r.left) / r.width * (v.b - v.a), fr = 40 * Math.pow(20000 / 40, 1 - (e.clientY - r.top) / r.height); return { t, fr }; }
let specDrag = null;
function bindSpecView(pane) {
  pane.addEventListener('wheel', e => {
    if (e.target.id !== 'spec-view') return; e.preventDefault();
    const f = S.cleanFile, v = cl(f).specView, { t } = specViewPos(e), dur = srcOf(f).length / C.SR;
    const z0 = v.zoom; v.zoom = Math.max(1, Math.min(200, v.zoom * (e.deltaY < 0 ? 1.3 : 1 / 1.3)));
    const span = dur / v.zoom, frac = (t - v.a) / (v.b - v.a);          // точка под курсором остаётся на месте
    v.center = t - (frac - 0.5) * span; if (v.zoom === z0) return;
    drawSpecView(f);
  }, { passive: false });
  pane.addEventListener('pointerdown', e => { if (e.target.id === 'spec-view') { const v = cl(S.cleanFile).specView; specDrag = { x: e.clientX, center: v.center, moved: false }; try { e.target.setPointerCapture(e.pointerId); } catch {} } });
  pane.addEventListener('pointermove', e => {
    if (e.target.id !== 'spec-view') return;
    const f = S.cleanFile, v = cl(f).specView, { t, fr } = specViewPos(e);
    const ro = $('#spec-readout'); if (ro) ro.innerHTML = `<b>${fmt(a2(t))}</b> · <b>${fr >= 1000 ? (fr / 1000).toFixed(2) + ' кГц' : Math.round(fr) + ' Гц'}</b> · ×${v.zoom.toFixed(v.zoom < 10 ? 1 : 0)}`;
    if (!specDrag) return;
    const dx = e.clientX - specDrag.x; if (Math.abs(dx) > 2) specDrag.moved = true;
    v.center = specDrag.center - dx / e.target.getBoundingClientRect().width * (v.b - v.a); drawSpecView(f);
  });
  pane.addEventListener('pointerup', e => { if (specDrag && e.target.id === 'spec-view') { if (!specDrag.moved) { const v = cl(S.cleanFile).specView; v.cursor = specViewPos(e).t; drawSpecView(S.cleanFile); } specDrag = null; } });
  pane.addEventListener('dblclick', e => { if (e.target.id === 'spec-view') { const f = S.cleanFile, c = cl(f), dur = srcOf(f).length / C.SR; c.at = Math.round(Math.max(0, Math.min(dur - EXCERPT, specViewPos(e).t - EXCERPT / 2))); $('#cl-at').value = c.at; $('#cl-at-t').textContent = fmt(c.at); drawWave($('#cl-wave'), f); drawSpecView(f); markDirty(f); } });
}
const a2 = t => Math.max(0, t);
/** После пересчёта отрывка: обновить только то, что зависит от результата, — без перестройки формы. */
function refreshPreviewUI(f) {
  const c = cl(f); if (S.cleanFile !== f) return;
  drawEq($('#eq-canvas'), f);
  drawSpec($('#cl-spec-b'), c.dirty ? null : c.after, c.sgAfter); if (c.before && c.sgBefore) drawSpec($('#cl-spec-a'), c.before, c.sgBefore);
  const lbl = $('#cl-lbl-b'); if (lbl) lbl.textContent = c.dirty ? 'стало — считаю…' : 'стало';
  const bA = $('#cl-body .play.ab[data-act=after]'); if (bA) bA.disabled = !(c.after && !c.dirty);
  const bB = $('#cl-body .play.ab[data-act=before]'); if (bB) bB.disabled = !c.before;
  const lu = $('#cl-lufs'); if (lu) lu.textContent = c.lufsBefore != null && !c.dirty ? `${c.lufsBefore.toFixed(1)} → ${c.lufsAfter.toFixed(1)} LUFS` : '';
  const pl = $('#cl-plog'); if (pl) pl.textContent = c.previewLog && !c.dirty ? c.previewLog.join(' · ') : '';
}
function markDirty(f) {
  const c = cl(f); c.dirty = true; const lbl = $('#cl-lbl-b'); if (lbl) lbl.textContent = 'стало — считаю…';
  const bA = $('#cl-body .play.ab[data-act=after]'); if (bA) bA.disabled = true;
  previewSoon(f);
}
function syncBandRow(c, i) {
  const b = c.chain.eq.bands[i], card = document.querySelector(`#cl-body .bcard[data-b="${i}"]`);
  if (b && card) for (const p of ['f', 'gain', 'q']) {
    const el = card.querySelector(`.scrub[data-p="${p}"]`); if (!el || el.classList.contains('edit')) continue;
    const [t, u] = scrubText(p, b[p]), sv = el.querySelector('.sv'), su = el.querySelector('.su');
    if (sv.textContent !== t) sv.textContent = t; if (su && su.textContent !== u) su.textContent = u; el.setAttribute('aria-valuenow', b[p]);
  }
  eqSelCards(c);
}
function eqSelCards(c) { document.querySelectorAll('#cl-body .bcard').forEach(r => r.classList.toggle('sel', +r.dataset.b === c.eqSel)); }
/** Перестроить вкладку после правки полос: карточки доезжают до новых мест, новые — выскакивают. */
function eqRerender(fresh) {
  const key = el => el.dataset.k, before = typeof flipRecord === 'function' ? flipRecord('#cl-body .bcard', key) : null;
  renderCleanup();
  if (before) flipPlay(before, '#cl-body .bcard', key, { damping: 0.8, response: 0.34 });
  if (fresh && typeof mIn === 'function') [...document.querySelectorAll('#cl-body .bcard')].filter(el => fresh.has(el.dataset.k)).forEach((el, n) => mIn(el, { opacity: 0, transform: 'translateY(8px) scale(0.94)' }, [0.72, 0.42], { delay: n * 40 }));
}
function eqNewBand(b) { EQV.fresh.add(b); return b; }
function bindCleanup() {
  const pane = $('#cl-body');
  pane.addEventListener('click', e => {
    const card = e.target.closest('.bcard');
    if (card && !e.target.closest('button, select, .scrub, label')) { const c = cl(S.cleanFile); c.eqSel = +card.dataset.b; eqSelCards(c); drawEq($('#eq-canvas'), S.cleanFile); return; }
    const b = e.target.closest('button'); if (!b) return;
    const f = S.cleanFile, c = f && cl(f);
    if (b.dataset.name) { S.cleanFile = S.files.find(x => x.name === b.dataset.name); abStop(); stop(); renderCleanup(); return; }
    if (b.dataset.preset) { c.presetWhy = null; c.preset = b.dataset.preset; const eqKeep = c.chain.eq, eq5Keep = c.chain.eq5; c.chain = C.defaultChain(c.preset, { boom: c.A.boom }); c.chain.eq = eqKeep; c.chain.eq5 = eq5Keep; c.dirty = true; renderCleanup(); previewSoon(f); return; }
    if (b.dataset.eqpreset) { eqMorph(f); c.chain.eq.bands.forEach((q, i) => eqGone(f, i)); const p = EQ_PRESETS[b.dataset.eqpreset]; c.chain.eq.bands = clone(p.bands).map(eqNewBand); if (p.bands.length) c.chain.eq.on = true; c.eqSel = -1; eqRerender(new Set(c.chain.eq.bands.map(eqBandKey))); markDirty(f); return; }
    const a = b.dataset.act;
    if (a === 'before' || a === 'after') return abPlay(f, a);
    if (a === 'apply') return applyFile(f);
    if (a === 'apply-all') return applyAll(f);
    if (a === 'match-all') return matchAllTo(f);
    if (a === 'revert') return revertFile(f);
    if (a === 'wav') return download(new Blob([C.wav24(f.y48)], { type: 'audio/wav' }), f.name.replace(/\.[^.]+$/, '') + '_чисто.wav');
    if (a === 'noise-here') { c.noiseOverride = C.noiseProfile(c.before); c.noiseFrom = c.at; if (!c.noiseOverride) return notify('В этом отрывке нет тихих мест, откуда взять профиль.'); renderCleanup(); markDirty(f); return; }
    if (a === 'noise-reset') { c.noiseOverride = null; renderCleanup(); markDirty(f); return; }
    if (a === 'band-add') { if (c.chain.eq.bands.length >= 10) return; eqMorph(f); const nb = eqNewBand({ type: 'peak', f: 1000, q: 1, gain: 0 }); c.chain.eq.bands.push(nb); c.chain.eq.on = true; c.eqSel = c.chain.eq.bands.length - 1; eqRerender(new Set([eqBandKey(nb)])); markDirty(f); return; }
    if (a === 'band-rm') { const i = +b.dataset.b, card = b.closest('.bcard'); eqMorph(f); eqGone(f, i); if (card && typeof motionGhostOut === 'function') motionGhostOut(card, { transform: 'scale(0.92)', filter: 'blur(2px)' }, 180); c.chain.eq.bands.splice(i, 1); c.eqSel = -1; EQV.hoverI = -1; eqRerender(); markDirty(f); return; }
    if (a === 'band-off') { eqMorph(f); const band = c.chain.eq.bands[+b.dataset.b]; band.off = !band.off; c.eqSel = +b.dataset.b; eqRerender(); markDirty(f); return; }
    if (a === 'band-solo') { if (playing && playing.btn === b) return stop(); const band = c.chain.eq.bands[+b.dataset.b]; if (!band || !c.before) return;
      // слышно только эту полосу: полосовой фильтр с её шириной; для срезов — сам срез
      const q = Math.max(0.7, band.q || 1), co = band.type === 'hp' || band.type === 'lp' ? C.biquad(band.type, band.f, q) : C.biquad('bp', band.f, q);
      let y = C.filt(c.before, co); if (band.type !== 'hp' && band.type !== 'lp') y = C.filt(y, co);
      const L = C.integratedLufs(y), g = isFinite(L) && L > -69 ? Math.pow(10, (-20 - L) / 20) : 1; y = y.map(v => v * g);
      abStop(); play(y, b); return; }
    if (a === 'spec-open') { c.specView = c.specView || { zoom: 1, center: srcOf(f).length / C.SR / 2, which: 'before' }; c.specOpen = !c.specOpen; renderCleanup(); return; }
    if (a === 'spec-which') { c.specView.which = c.specView.which === 'before' ? 'after' : 'before'; drawSpecView(f); return; }
    if (a === 'spec-fit') { c.specView.zoom = 1; c.specView.center = srcOf(f).length / C.SR / 2; drawSpecView(f); return; }
    if (a === 'spec-play') { const v = c.specView; if (playing && playing.btn === b) return stop(); const y = (v.which === 'after' && f.raw48 ? f.y48 : srcOf(f)), at = Math.round((v.cursor ?? v.center) * C.SR); abStop(); play(y.slice(at, at + 8 * C.SR), b); return; }
  });
  const onParam = e => {
    const x = e.target, f = S.cleanFile; if (!f || !x.dataset.m) return;
    const c = cl(f), m = x.dataset.m, p = x.dataset.p;
    if (m === 'eq5' && x.dataset.b != null) {
      const i = +x.dataset.b, v = +x.value; if (!isFinite(v)) return;
      if (p === 'g') { c.chain.eq5.g[i] = Math.max(-12, Math.min(12, v)); x.closest('.eqb').querySelector('b').textContent = eqFmtG(c.chain.eq5.g[i]); }
      drawEq($('#eq-canvas'), f); markDirty(f); return;
    }
    if (m === 'eq' && x.dataset.b != null) {
      const band = c.chain.eq.bands[+x.dataset.b]; if (!band) return;
      if (p === 'type') {                              // тип полосы: кривая перетекает, значок формы и «усиление» — на месте
        eqMorph(f); band.type = x.value; if (NO_GAIN.has(band.type)) band.gain = 0;
        const card = x.closest('.bcard'), gs = card && card.querySelector('.scrub[data-p=gain]'), ng = NO_GAIN.has(band.type);
        if (card) { card.querySelector('.bc-type path').setAttribute('d', EQ_SHAPE[band.type] || EQ_SHAPE.peak); gs.classList.toggle('dis', ng); gs.tabIndex = ng ? -1 : 0; gs.toggleAttribute('aria-disabled', ng); }
      }
      c.eqSel = +x.dataset.b; syncBandRow(c, c.eqSel); drawEq($('#eq-canvas'), f); markDirty(f); return;
    }
    if (p === 'on') { if (m === 'eq') eqMorph(f); c.chain[m].on = x.checked; x.closest('.mod').classList.toggle('on', x.checked); drawEq($('#eq-canvas'), f); markDirty(f); return; }
    if (x.tagName === 'SELECT') { const v = x.value; c.chain[m][p] = v === '' ? null : (p === 'ref' || p === 'band' || isNaN(+v)) ? v : +v; if (m === 'tone' && p === 'mode') renderCleanup(); if (m === 'hp' || m === 'tones') drawEq($('#eq-canvas'), f); markDirty(f); return; }
    c.chain[m][p] = +x.value;
    const lbl = x.closest('.prm') && x.closest('.prm').querySelector('span b');
    if (lbl) { const spec = MODULES.find(q => q.k === m).params.find(q => q.k === p); lbl.textContent = spec.pct ? `${Math.round(x.value * 100)} %` : `${x.value}${spec.unit ? ' ' + spec.unit : ''}`; }
    if (m === 'hp' || m === 'tone' || m === 'tones') drawEq($('#eq-canvas'), f);
    markDirty(f);
  };
  pane.addEventListener('input', e => {
    if (e.target.id === 'cl-at') { const f = S.cleanFile, c = cl(f); c.at = +e.target.value; $('#cl-at-t').textContent = fmt(c.at); drawWave($('#cl-wave'), f); markDirty(f); return; }
    if (e.target.type === 'number') return;          // числа — по change, чтобы не дёргать при наборе
    onParam(e);
  });
  pane.addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox' || e.target.type === 'number') onParam(e); });
  // обзор волны: щелчок или протяжка выбирает отрывок
  const waveAt = e => { const cv = $('#cl-wave'); if (!cv) return; const f = S.cleanFile, c = cl(f), r = cv.getBoundingClientRect(), dur = srcOf(f).length / C.SR;
    c.at = Math.round(Math.max(0, Math.min(dur - EXCERPT, (e.clientX - r.left) / r.width * dur - EXCERPT / 2))); $('#cl-at').value = c.at; $('#cl-at-t').textContent = fmt(c.at); drawWave(cv, f); };
  let waveDrag = false;
  pane.addEventListener('pointerdown', e => { const sc = e.target.closest('.scrub'); if (sc) { scrubDown(e, sc); return; } if (e.target.id === 'cl-wave') { waveDrag = true; waveAt(e); } if (e.target.id === 'eq-canvas') eqDown(e); });
  pane.addEventListener('pointermove', e => { if (scrubD) { scrubMove(e); return; } if (waveDrag && e.target.id === 'cl-wave') waveAt(e); if (eqDrag) eqMove(e); else if (e.target.id === 'eq-canvas' && e.pointerType === 'mouse' && !scrolling()) eqHover(e); });
  const up = e => { if (scrubD) { scrubUp(e); return; } if (waveDrag) { waveDrag = false; markDirty(S.cleanFile); } if (eqDrag) { eqDrag = null; EQV.drag = -1; const cv = $('#eq-canvas'); if (cv) cv.style.cursor = EQV.hoverI >= 0 ? 'grab' : 'crosshair'; drawEq(cv, S.cleanFile); markDirty(S.cleanFile); } };
  pane.addEventListener('pointerup', up); pane.addEventListener('pointercancel', up); pane.addEventListener('pointerleave', e => { if (e.target === pane) up(e); });
  // наведение: курсор на экране — частота под ним; на карточке — её ручка подсвечена
  pane.addEventListener('pointerout', e => { if (e.target.id === 'eq-canvas' && !eqDrag) { EQV.hover = null; EQV.hoverI = -1; drawEq(e.target, S.cleanFile); } const card = e.target.closest && e.target.closest('.bcard'); if (card && !card.contains(e.relatedTarget) && e.pointerType === 'mouse') { EQV.hoverI = -1; drawEq($('#eq-canvas'), S.cleanFile); } });
  pane.addEventListener('pointerover', e => { const card = e.target.closest && e.target.closest('.bcard'); if (card && e.pointerType === 'mouse' && !eqDrag && !scrolling()) { EQV.hoverI = +card.dataset.b; EQV.hover = null; drawEq($('#eq-canvas'), S.cleanFile); } });
  pane.addEventListener('dblclick', e => { if (e.target.id === 'eq-canvas') eqDouble(e); });
  pane.addEventListener('wheel', e => { const sc = e.target.closest('.scrub'); if (sc && !sc.classList.contains('dis') && !sc.classList.contains('edit')) { e.preventDefault(); scrubStep(sc, e.deltaY < 0 ? 1 : -1, e.shiftKey); return; } if (e.target.id === 'eq-canvas') eqWheel(e); }, { passive: false });
  pane.addEventListener('keydown', e => { const sc = e.target.classList && e.target.classList.contains('scrub') ? e.target : null; if (sc) { scrubKey(e, sc); return; } if (e.target.id === 'eq-canvas') eqKey(e); });
  $('#cl-add').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  bindSpecView(pane);
}
// ------------------------------------------------------------------ эквалайзер: мышь, палец и клавиатура
let eqDrag = null;
function eqHit(e) {
  const cv = $('#eq-canvas'), c = cl(S.cleanFile), r = cv.getBoundingClientRect(), W = c.eqW || r.width, H = c.eqH || r.height;
  const x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
  let best = -1, bd = e.pointerType === 'touch' ? 28 : 16;                 // пальцем — ручка «толще»
  c.chain.eq.bands.forEach((b, i) => { const d = Math.hypot(x - fx(b.f, W), y - gy(NO_GAIN.has(b.type) ? 0 : b.gain, H)); if (d < bd) { bd = d; best = i; } });
  return { x, y, W, H, i: best };
}
function eqDown(e) {
  const f = S.cleanFile, c = cl(f), h = eqHit(e); EQV.kbd = false; EQV.hover = null;
  c.eqSel = h.i;
  if (h.i >= 0) {                                        // берём там, где схватили, — ручка не прыгает под палец
    const b = c.chain.eq.bands[h.i]; eqDrag = { i: h.i, dx: h.x - fx(b.f, h.W), dy: h.y - gy(NO_GAIN.has(b.type) ? 0 : b.gain, h.H) }; EQV.drag = h.i; e.target.style.cursor = 'grabbing';
    try { e.target.setPointerCapture(e.pointerId); } catch {}
  }
  eqSelCards(c); drawEq($('#eq-canvas'), f); e.preventDefault();
}
function eqMove(e) {
  const f = S.cleanFile, c = cl(f), h = eqHit(e), b = c.chain.eq.bands[eqDrag.i]; if (!b) return;
  b.f = Math.round(Math.max(20, Math.min(20000, fInv(Math.max(0, Math.min(h.W, h.x - eqDrag.dx)), h.W))));
  if (!NO_GAIN.has(b.type)) b.gain = Math.round(Math.max(-EQ_RANGE, Math.min(EQ_RANGE, gInv(h.y - eqDrag.dy, h.H))) * 10) / 10;
  drawEq($('#eq-canvas'), f); syncBandRow(c, eqDrag.i);
}
function eqHover(e) {
  const h = eqHit(e); EQV.hover = { x: h.x, y: h.y };
  if (EQV.hoverI !== h.i) { EQV.hoverI = h.i; e.target.style.cursor = h.i >= 0 ? 'grab' : 'crosshair'; }
  drawEq(e.target, S.cleanFile);
}
function eqDouble(e) {
  const f = S.cleanFile, c = cl(f), h = eqHit(e); eqMorph(f);
  if (h.i >= 0) { eqGone(f, h.i); c.chain.eq.bands.splice(h.i, 1); c.eqSel = -1; EQV.hoverI = -1; eqRerender(); }
  else if (c.chain.eq.bands.length < 10) { const nb = eqNewBand({ type: 'peak', f: Math.round(fInv(h.x, h.W)), q: 1, gain: Math.round(gInv(h.y, h.H) * 2) / 2 }); c.chain.eq.bands.push(nb); c.chain.eq.on = true; c.eqSel = c.chain.eq.bands.length - 1; eqRerender(new Set([eqBandKey(nb)])); }
  markDirty(f);
}
function eqWheel(e) {
  const f = S.cleanFile, c = cl(f), h = eqHit(e), i = h.i >= 0 ? h.i : c.eqSel, b = c.chain.eq.bands[i]; if (!b) return;
  e.preventDefault(); b.q = Math.round(Math.max(0.3, Math.min(12, b.q * (e.deltaY < 0 ? 1.12 : 1 / 1.12))) * 100) / 100;
  c.eqSel = i; drawEq($('#eq-canvas'), f); syncBandRow(c, i); markDirty(f);
}
// ------------------------------------------------------------------ числа, которые тянут (карточки полос, частоты пяти полос)
const SCRUB_SPEC = { f: { min: 20, max: 20000, oct: 60 }, f5: { min: 30, max: 16000, oct: 60 }, gain: { min: -18, max: 18, per: 0.1, step: 0.5 }, q: { min: 0.3, max: 12, oct: 80 } };
let scrubD = null;
const scrubLim = el => SCRUB_SPEC[el.dataset.m === 'eq5' ? 'f5' : el.dataset.p];
function scrubVal(el) { const c = cl(S.cleanFile), i = +el.dataset.b; return el.dataset.m === 'eq5' ? c.chain.eq5.f[i] : (c.chain.eq.bands[i] || {})[el.dataset.p]; }
function scrubSet(el, v) {
  const f = S.cleanFile, c = cl(f), i = +el.dataset.b, p = el.dataset.p, lim = scrubLim(el); if (!isFinite(v)) return;
  v = Math.max(lim.min, Math.min(lim.max, v)); v = p === 'f' ? Math.round(v) : p === 'q' ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
  if (el.dataset.m === 'eq5') { c.chain.eq5.f[i] = v; const [t, u] = eqFmtF(v), sv = el.querySelector('.sv'); if (sv.textContent !== t) sv.textContent = t; el.querySelector('.su').textContent = u; el.setAttribute('aria-valuenow', v); }
  else { const b = c.chain.eq.bands[i]; if (!b || (p === 'gain' && NO_GAIN.has(b.type))) return; b[p] = v; c.eqSel = i; syncBandRow(c, i); }
  drawEq($('#eq-canvas'), f); markDirty(f);
}
function scrubDown(e, el) {
  if (el.classList.contains('dis') || el.classList.contains('edit') || e.button > 0) return;
  scrubD = { el, id: e.pointerId, x: e.clientX, y: e.clientY, v0: scrubVal(el), moved: false };
  try { el.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); el.focus({ preventScroll: true });
}
function scrubMove(e) {
  const d = scrubD; if (!d || d.id !== e.pointerId) return;
  const dist = (e.clientX - d.x) - (e.clientY - d.y); if (!d.moved && Math.abs(dist) < 4) return;
  if (!d.moved) { d.moved = true; d.el.classList.add('is-scrub'); document.body.classList.add('scrubbing'); }
  const lim = scrubLim(d.el), k = e.shiftKey ? 0.25 : 1;                          // Shift — точнее
  scrubSet(d.el, lim.oct ? d.v0 * Math.pow(2, dist * k / lim.oct) : d.v0 + dist * k * lim.per);
}
function scrubUp(e) { const d = scrubD; if (!d || d.id !== e.pointerId) return; scrubD = null; d.el.classList.remove('is-scrub'); document.body.classList.remove('scrubbing'); if (!d.moved && e.type === 'pointerup') scrubEdit(d.el); }
function scrubStep(el, dir, big) { const p = el.dataset.p, lim = scrubLim(el), v = scrubVal(el), n = big ? 5 : 1; scrubSet(el, lim.oct ? v * Math.pow(2, dir * n / (p === 'q' ? 8 : 12)) : v + dir * n * lim.step); }
function scrubKey(e, el) {
  if (el.classList.contains('dis')) return;
  const k = e.key, dir = k === 'ArrowUp' || k === 'ArrowRight' || k === 'PageUp' ? 1 : k === 'ArrowDown' || k === 'ArrowLeft' || k === 'PageDown' ? -1 : 0;
  if (dir) { e.preventDefault(); scrubStep(el, dir, e.shiftKey || k.startsWith('Page')); return; }
  if (k === 'Enter' || k === 'F2') { e.preventDefault(); scrubEdit(el); }
}
/** Ввод с клавиатуры: поле на месте числа; Enter или уход — принять, Esc — отменить. «3,5к» — это 3500 Гц. */
function scrubEdit(el) {
  if (el.classList.contains('dis') || el.classList.contains('edit')) return;
  const row = el.querySelector('.sv-row'), p = el.dataset.p, v = scrubVal(el), inp = document.createElement('input');
  inp.type = 'text'; inp.inputMode = 'decimal'; inp.className = 'scrub-in'; inp.value = p === 'f' ? String(Math.round(v)) : String(v).replace('.', ','); inp.setAttribute('aria-label', el.getAttribute('aria-label'));
  el.classList.add('edit'); row.hidden = true; el.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    const t = inp.value.trim().replace(/\s/g, '').replace(',', '.').replace('−', '-'), n = parseFloat(t) * (p !== 'gain' && /[кk]/i.test(t) ? 1000 : 1);
    inp.remove(); row.hidden = false; el.classList.remove('edit');
    if (ok && isFinite(n)) scrubSet(el, n); if (document.activeElement === document.body || !document.activeElement) el.focus({ preventScroll: true });
  };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); el.focus({ preventScroll: true }); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); el.focus({ preventScroll: true }); } });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('pointerdown', e => e.stopPropagation());
}
function eqKey(e) {
  const f = S.cleanFile, c = cl(f); EQV.kbd = true;
  const b = c.chain.eq.bands[c.eqSel]; if (!b && e.key !== 'Tab') return;
  const st = e.shiftKey ? 5 : 1; let used = true;
  if (e.key === 'ArrowLeft') b.f = Math.max(20, Math.round(b.f / Math.pow(2, st / 12)));
  else if (e.key === 'ArrowRight') b.f = Math.min(20000, Math.round(b.f * Math.pow(2, st / 12)));
  else if (e.key === 'ArrowUp' && !NO_GAIN.has(b.type)) b.gain = Math.min(EQ_RANGE, b.gain + 0.5 * st);
  else if (e.key === 'ArrowDown' && !NO_GAIN.has(b.type)) b.gain = Math.max(-EQ_RANGE, b.gain - 0.5 * st);
  else if (e.key === 'Tab' && !e.shiftKey && c.eqSel < c.chain.eq.bands.length - 1) { c.eqSel++; }   // на последней Tab уводит дальше по странице
  else used = false;
  if (!used) return;
  e.preventDefault(); drawEq($('#eq-canvas'), f); syncBandRow(c, c.eqSel); if (e.key !== 'Tab') markDirty(f);
}
