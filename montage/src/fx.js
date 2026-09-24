// Монтажка — эффекты голоса: «голос в голове», телефон, мегафон, колонки зала, за дверью, издалека, комната,
// зал, эхо. Эффект выбирается у реплики, по пометке в сценарии («(в микрофон)», «(из другого угла)»),
// у персонажа или сам по имени («Голос в голове Кэфи»). Громкость сухой части сохраняется, хвост
// реверберации ложится поверх паузы и следующая реплика его не ждёт.
// Использует S, charName; C — ядро.

const FX_PRESETS = C.FX_DEFS;
/** Правила по пометке в скобках или тексту озвученной ремарки. */
const FX_RULES = [
  [/мёртв|мертв|не в микрофон|без микрофона/i, 'none'],
  [/в голове|мысленно|про себя|в мыслях|внутренн/i, 'thought'],
  [/телефон|в трубку|по видеосвяз|голосов[оа]е/i, 'phone'],
  [/мегафон|рупор/i, 'megaphone'],
  [/по радио|из динамик|из колонок|по громкой|в рацию|по рации/i, 'radio'],
  [/в микрофон/i, 'pa'],
  [/за двер|за стен|из-за двер|из-за стен|сквозь двер/i, 'wall'],
  [/издалек|вдалеке|из другого угла|из коридора|с другого конца|кричит из|снизу|сверху/i, 'far'],
  [/эхом|с эхом/i, 'echo'],
];
const FX_VOICE_RULES = [[/голос в голове|мысли|внутренний голос/i, 'thought'], [/диктор|радио|динамик/i, 'radio'], [/телефон/i, 'phone']];
/** Эффект по пометке или тексту ремарки: {key, why} или null. */
function fxFromNote(cue) {
  const src = cue.type === 'line' ? (cue.note || '') : cue.text;
  for (const [re, key] of FX_RULES) { const m = re.exec(src); if (m) return { key, why: `пометка «${m[0]}»` }; }
  return null;
}
/** Эффект персонажа: выбранный руками или по имени. */
function fxOfVoice(voice) {
  if (S.fxVoice[voice]) return { key: S.fxVoice[voice], why: 'у персонажа' };
  const name = charName(voice) || voice;
  for (const [re, key] of FX_VOICE_RULES) if (re.test(name)) return { key, why: 'по имени персонажа' };
  return null;
}
/** Какой эффект у реплики: {key, why}; порядок — реплика, пометка, персонаж. */
function fxOfLine(cue, voice) {
  if (S.fxLine[cue.id]) return { key: S.fxLine[cue.id], why: 'выбрано у реплики' };
  return fxFromNote(cue) || fxOfVoice(voice) || { key: 'none', why: '' };
}
function lineFx(it) { const k = fxOfLine(it.cue, it.voice).key; return k && k !== 'none' && FX_PRESETS[k] ? k : null; }

// ------------------------------------------------------------------ обработка в фоновых потоках
let fxWorkers = null;
function fxPool() {
  if (fxWorkers) return fxWorkers;
  fxWorkers = [];
  if (typeof DSP_WORKER_SRC === 'undefined') return fxWorkers;
  const K = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
  try {
    const url = URL.createObjectURL(new Blob([DSP_WORKER_SRC], { type: 'text/javascript' }));
    for (let k = 0; k < K; k++) { const w = new Worker(url); w.busy = 0; w.wait = new Map(); w.onmessage = e => { const m = e.data, cb = w.wait.get(m.id); if (!cb) return; w.wait.delete(m.id); w.busy--; m.type === 'error' ? cb.rej(new Error(m.message)) : cb.res(m.y); }; w.onerror = () => { for (const cb of w.wait.values()) cb.rej(new Error('поток эффектов не запустился')); w.wait.clear(); w.dead = true; }; fxWorkers.push(w); }
  } catch { fxWorkers = []; }
  return fxWorkers;
}
let fxSeq = 0;
function fxInWorker(x, key) {
  const pool = fxPool().filter(w => !w.dead);
  if (!pool.length) return Promise.resolve(C.fxProcess(x, key));
  const w = pool.reduce((a, b) => (b.busy < a.busy ? b : a)), id = ++fxSeq, y = x.slice();
  w.busy++;
  return new Promise((res, rej) => { w.wait.set(id, { res, rej }); w.postMessage({ type: 'fx', id, key, y }, [y.buffer]); }).catch(() => C.fxProcess(x, key));
}
/** Эффекты реплик, которых нет в кэше: параллельно во всех потоках. Кэш — по исходному звуку и эффекту, без громкости персонажа. */
async function ensureFx(items) {
  const todo = [];
  for (const it of items) {
    const key = lineFx(it); it.fxKey = key;
    if (!key) continue;
    if (it._fx && it._fx.k === key && it._fx.src === it.audio0) continue;
    todo.push(it);
  }
  if (!todo.length) return 0;
  await Promise.all(todo.map(it => fxInWorker(it.audio0, it.fxKey).then(y => { it._fx = { k: it.fxKey, src: it.audio0, y, core: it.audio0.length / C.SR }; })));
  return todo.length;
}
