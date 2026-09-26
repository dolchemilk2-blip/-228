// Монтажка — эффекты голоса, обработка: пресеты, реверберация, эхо, «телефонная» полоса.
// Без DOM: крутится и на странице, и в фоновых потоках (по реплике на поток).
import { SR, lineLoudness } from './core.js';
import { biquad, filt } from './dsp.js';

export const FX_DEFS = {
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
/** Freeverb, моно: восемь гребенчатых фильтров с демпфированием и четыре фазовых — за один проход по сигналу. */
function freeverb(x, { room = 0.5, damp = 0.5, pre = 0.01 } = {}, tail = 2.5) {
  const sc = SR / 44100, T = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(v => Math.round(v * sc)), A = [556, 441, 341, 225].map(v => Math.round(v * sc));
  const fb = 0.7 + 0.28 * room, d1 = 0.15 + 0.5 * damp, d2 = 1 - d1, pd = Math.round(pre * SR), n = x.length + pd + Math.round(tail * SR), xl = x.length;
  const c0 = new Float32Array(T[0]), c1 = new Float32Array(T[1]), c2 = new Float32Array(T[2]), c3 = new Float32Array(T[3]), c4 = new Float32Array(T[4]), c5 = new Float32Array(T[5]), c6 = new Float32Array(T[6]), c7 = new Float32Array(T[7]);
  const a0 = new Float32Array(A[0]), a1 = new Float32Array(A[1]), a2 = new Float32Array(A[2]), a3 = new Float32Array(A[3]);
  let i0 = 0, i1 = 0, i2 = 0, i3 = 0, i4 = 0, i5 = 0, i6 = 0, i7 = 0, j0 = 0, j1 = 0, j2 = 0, j3 = 0;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0, s7 = 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = i - pd, inp = k >= 0 && k < xl ? x[k] * 0.015 : 0;
    let o, acc = 0;
    o = c0[i0]; s0 = o * d2 + s0 * d1 + 1e-20; c0[i0] = inp + s0 * fb; acc += o; if (++i0 >= T[0]) i0 = 0;
    o = c1[i1]; s1 = o * d2 + s1 * d1 + 1e-20; c1[i1] = inp + s1 * fb; acc += o; if (++i1 >= T[1]) i1 = 0;
    o = c2[i2]; s2 = o * d2 + s2 * d1 + 1e-20; c2[i2] = inp + s2 * fb; acc += o; if (++i2 >= T[2]) i2 = 0;
    o = c3[i3]; s3 = o * d2 + s3 * d1 + 1e-20; c3[i3] = inp + s3 * fb; acc += o; if (++i3 >= T[3]) i3 = 0;
    o = c4[i4]; s4 = o * d2 + s4 * d1 + 1e-20; c4[i4] = inp + s4 * fb; acc += o; if (++i4 >= T[4]) i4 = 0;
    o = c5[i5]; s5 = o * d2 + s5 * d1 + 1e-20; c5[i5] = inp + s5 * fb; acc += o; if (++i5 >= T[5]) i5 = 0;
    o = c6[i6]; s6 = o * d2 + s6 * d1 + 1e-20; c6[i6] = inp + s6 * fb; acc += o; if (++i6 >= T[6]) i6 = 0;
    o = c7[i7]; s7 = o * d2 + s7 * d1 + 1e-20; c7[i7] = inp + s7 * fb; acc += o; if (++i7 >= T[7]) i7 = 0;
    let b = a0[j0]; a0[j0] = acc + b * 0.5; acc = b - acc; if (++j0 >= A[0]) j0 = 0;
    b = a1[j1]; a1[j1] = acc + b * 0.5; acc = b - acc; if (++j1 >= A[1]) j1 = 0;
    b = a2[j2]; a2[j2] = acc + b * 0.5; acc = b - acc; if (++j2 >= A[2]) j2 = 0;
    b = a3[j3]; a3[j3] = acc + b * 0.5; acc = b - acc; if (++j3 >= A[3]) j3 = 0;
    out[i] = acc;
  }
  const nf = Math.round(0.4 * SR); for (let i = 0; i < nf; i++) out[n - 1 - i] *= i / nf;   // хвост не обрывается
  return out;
}
function fxRender(x, P) {
  let y = x;
  for (const [type, f, q, g] of P.chain || []) y = filt(y, biquad(type, f, q || 0.707, g || 0));
  if (P.drive) { const d = P.drive, k = Math.tanh(d); let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); const s = pk > 1e-6 ? 0.7 / pk : 1; y = y.map(v => Math.tanh(v * s * d) / k / s); }
  const tailSec = P.verb ? 1.2 + 2.3 * P.verb.room : P.echo ? 1.5 : 0, n = x.length + Math.round(tailSec * SR) + (P.verb ? Math.round(P.verb.pre * SR) : 0);
  const out = new Float32Array(n), dryG = Math.pow(10, (P.dry || 0) / 20);
  for (let i = 0; i < y.length; i++) out[i] = y[i] * dryG;
  if (P.double) { const dl = Math.round(P.double[0] * SR), g = Math.pow(10, P.double[1] / 20); for (let i = 0; i < y.length && i + dl < n; i++) out[i + dl] += y[i] * g; }
  if (P.echo) { const [dt, gdb, fbk] = P.echo, dl = Math.round(dt * SR), g = Math.pow(10, gdb / 20); let gain = g; for (let k = 1; k <= 6 && gain > 0.01; k++, gain *= fbk) for (let i = 0; i < y.length && i + k * dl < n; i++) out[i + k * dl] += y[i] * gain; }
  if (P.verb) { const w = freeverb(y, P.verb, tailSec); const g = P.verb.wet * 3; for (let i = 0; i < w.length && i < n; i++) out[i] += w[i] * g; }
  return out;
}
/**
 * Эффект реплики: громкость сухой части — как у входа (плюс поправка пресета), хвост — сверху.
 * Линейно по громкости входа (перегруз считается от пика), поэтому результат можно масштабировать.
 */
export function fxProcess(x, key) {
  const P = FX_DEFS[key]; if (!P || key === 'none') return x;
  const y = fxRender(x, P), L0 = lineLoudness(x), L1 = lineLoudness(y.subarray(0, x.length));
  const g = (isFinite(L0) && isFinite(L1) && L0 > -69 && L1 > -69 ? Math.pow(10, (L0 - L1) / 20) : 1) * Math.pow(10, (P.level || 0) / 20);
  for (let i = 0; i < y.length; i++) y[i] *= g;
  return y;
}
