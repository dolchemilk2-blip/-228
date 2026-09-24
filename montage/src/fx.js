// Монтажка — эффекты голоса: «голос в голове», телефон, мегафон, колонки зала, за дверью, издалека, комната,
// зал, эхо. Эффект выбирается у реплики, по пометке в сценарии («(в микрофон)», «(из другого угла)»),
// у персонажа или сам по имени («Голос в голове Кэфи»). Громкость сухой части сохраняется, хвост
// реверберации ложится поверх паузы и следующая реплика его не ждёт.
// Использует S, charName; C — ядро.

const FX_PRESETS = {
  none:      { name: 'без эффекта' },
  thought:   { name: 'голос в голове', level: -1, chain: [['hp', 140], ['peak', 300, 1, -2], ['highshelf', 7000, 0.7, -2]], double: [0.014, -9], verb: { room: 0.35, damp: 0.45, wet: 0.2, pre: 0.012 } },
  phone:     { name: 'телефон', level: 0, chain: [['hp', 350], ['hp', 350], ['lp', 3400], ['lp', 3400], ['peak', 1800, 1, 4]], drive: 2 },
  megaphone: { name: 'мегафон', level: 0, chain: [['hp', 600], ['hp', 600], ['lp', 4200], ['lp', 4200], ['peak', 1500, 1.2, 8]], drive: 5, echo: [0.13, -13, 0.2], verb: { room: 0.6, damp: 0.5, wet: 0.12, pre: 0.02 } },
  radio:     { name: 'радио, динамик', level: 0, chain: [['hp', 180], ['lp', 7000], ['peak', 2500, 1, 2]], drive: 1.5 },
  pa:        { name: 'в микрофон (колонки зала)', level: 0, chain: [['hp', 140], ['lp', 9000], ['peak', 2200, 1, 2]], drive: 1.2, verb: { room: 0.85, damp: 0.35, wet: 0.28, pre: 0.03 } },
  wall:      { name: 'за дверью, за стеной', level: -8, chain: [['hp', 80], ['lp', 900], ['lp', 900]], verb: { room: 0.3, damp: 0.6, wet: 0.22, pre: 0.005 } },
  far:       { name: 'издалека', level: -6, chain: [['hp', 200], ['lp', 3800]], dry: -5, verb: { room: 0.8, damp: 0.4, wet: 0.45, pre: 0.02 } },
  room:      { name: 'маленькая комната', level: 0, chain: [], verb: { room: 0.3, damp: 0.5, wet: 0.18, pre: 0.006 } },
  hall:      { name: 'большой зал', level: 0, chain: [], verb: { room: 0.88, damp: 0.3, wet: 0.3, pre: 0.025 } },
  echo:      { name: 'эхо', level: 0, chain: [], echo: [0.28, -7, 0.4], verb: { room: 0.7, damp: 0.4, wet: 0.14, pre: 0.02 } },
};
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

// ------------------------------------------------------------------ обработка
/** Freeverb, моно: восемь гребенчатых фильтров с демпфированием и четыре фазовых. */
function freeverb(x, { room = 0.5, damp = 0.5, pre = 0.01 } = {}, tail = 2.5) {
  const sc = C.SR / 44100, combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(v => Math.round(v * sc)), apT = [556, 441, 341, 225].map(v => Math.round(v * sc));
  const fb = 0.7 + 0.28 * room, d1 = 0.15 + 0.5 * damp, d2 = 1 - d1, pd = Math.round(pre * C.SR), n = x.length + pd + Math.round(tail * C.SR);
  const inp = new Float32Array(n); for (let i = 0; i < x.length; i++) inp[i + pd] = x[i] * 0.015;
  const out = new Float32Array(n);
  for (const T of combT) { const buf = new Float32Array(T); let idx = 0, store = 0; for (let i = 0; i < n; i++) { const o = buf[idx]; store = o * d2 + store * d1 + 1e-20; buf[idx] = inp[i] + store * fb; out[i] += o; if (++idx >= T) idx = 0; } }
  for (const T of apT) { const buf = new Float32Array(T); let idx = 0; for (let i = 0; i < n; i++) { const b = buf[idx], v = out[i]; out[i] = -v + b; buf[idx] = v + b * 0.5; if (++idx >= T) idx = 0; } }
  const nf = Math.round(0.4 * C.SR); for (let i = 0; i < nf; i++) out[n - 1 - i] *= i / nf;   // хвост не обрывается
  return out;
}
function fxRender(x, P) {
  let y = x;
  for (const [type, f, q, g] of P.chain || []) y = C.filt(y, C.biquad(type, f, q || 0.707, g || 0));
  if (P.drive) { const d = P.drive, k = Math.tanh(d); let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); const s = pk > 1e-6 ? 0.7 / pk : 1; y = y.map(v => Math.tanh(v * s * d) / k / s); }
  const tailSec = P.verb ? 1.2 + 2.3 * P.verb.room : P.echo ? 1.5 : 0, n = x.length + Math.round(tailSec * C.SR) + (P.verb ? Math.round(P.verb.pre * C.SR) : 0);
  const out = new Float32Array(n), dryG = Math.pow(10, (P.dry || 0) / 20);
  for (let i = 0; i < y.length; i++) out[i] = y[i] * dryG;
  if (P.double) { const dl = Math.round(P.double[0] * C.SR), g = Math.pow(10, P.double[1] / 20); for (let i = 0; i < y.length && i + dl < n; i++) out[i + dl] += y[i] * g; }
  if (P.echo) { const [dt, gdb, fbk] = P.echo, dl = Math.round(dt * C.SR), g = Math.pow(10, gdb / 20); let src = y, gain = g; for (let k = 1; k <= 6 && gain > 0.01; k++, gain *= fbk) for (let i = 0; i < src.length && i + k * dl < n; i++) out[i + k * dl] += src[i] * gain; }
  if (P.verb) { const w = freeverb(y, P.verb, tailSec); const g = P.verb.wet * 3; for (let i = 0; i < w.length && i < n; i++) out[i] += w[i] * g; }
  return out;
}
/** Эффект реплики: {audio, core} — core, сек: сколько ждёт следующая реплика (длина сухого звука). */
function applyFx(it) {
  const key = it.fxKey, P = FX_PRESETS[key], src = it.audio;
  const ck = key + '|' + (S.voiceGains[it.voice] || 0);
  if (it._fx && it._fx.k === ck && it._fx.src === it.audio0) return it._fx.r;
  const y = fxRender(src, P), L0 = C.lineLoudness(src), L1 = C.lineLoudness(y.subarray(0, src.length));
  const g = (isFinite(L0) && isFinite(L1) && L0 > -69 && L1 > -69 ? Math.pow(10, (L0 - L1) / 20) : 1) * Math.pow(10, (P.level || 0) / 20);
  for (let i = 0; i < y.length; i++) y[i] *= g;
  const r = { audio: y, core: src.length / C.SR };
  it._fx = { k: ck, src: it.audio0, r };
  return r;
}
