// Монтажка — мастеринг и реставрация: резонансы (в духе Soothe), стоячие призвуки, транзиент-шейпер,
// эксайтер (верх выше среза кодека или микрофона), ленточное насыщение, громкость с true-peak лимитером.
// Без DOM: проверяется в Node. Как и dsp.js, ничего не сдвигает во времени.
import { SR, integratedLufs } from './core.js';
import { fft, biquad, filt, cascade, envDb, prc, hann, dB, clamp, stftMap, applyGain, smoothFreq, firApply, firFromCurve } from './dsp.js';

// ------------------------------------------------------------------ передискретизация
/** Линейно-фазовый ФНЧ: окно Ханна × sinc; fc — доля частоты дискретизации (0…0,5). */
function lpFir(taps, fc) {
  const h = new Float32Array(taps), m = (taps - 1) / 2; let s = 0;
  for (let i = 0; i < taps; i++) { const t = i - m, w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (taps - 1)); h[i] = (t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t)) * w; s += h[i]; }
  for (let i = 0; i < taps; i++) h[i] /= s;
  return h;
}
const HB2 = lpFir(63, 0.25), HB4 = lpFir(95, 0.125);
/** fn(v) на удвоенной частоте дискретизации — насыщение без алиасинга. Кусками, без удвоенной копии сигнала в памяти. */
export function os2(x, fn) {
  const h = HB2, D = h.length - 1, n = x.length, y = new Float32Array(n), C = 16384, mb = D >> 1, ma = D;
  const u = new Float32Array(2 * (C + mb + ma)), v = new Float32Array(2 * (C + mb + ma));
  for (let o = 0; o < n; o += C) {
    const cnt = Math.min(C, n - o), L = cnt + mb + ma, L2 = 2 * L;
    u.fill(0); for (let i = 0; i < L; i++) { const j = o - mb + i; u[2 * i] = j >= 0 && j < n ? 2 * x[j] : 0; }
    for (let m = 0; m < L2; m++) { let s = 0; for (let k = m & 1, kk = Math.min(m, D); k <= kk; k += 2) s += h[k] * u[m - k]; v[m] = fn(s); }
    for (let i = 0; i < cnt; i++) { const m = 2 * (i + mb) + D; let s = 0; for (let k = 0; k <= D; k++) { const q = m - k; if (q < L2) s += h[k] * v[q]; } y[o + i] = s; }
  }
  return y;
}
/** Огибающая межотсчётных пиков (×4): для каждого отсчёта — наибольшее из четырёх значений интерполяции рядом с ним. */
export function truePeakEnv(x) {
  const h = HB4, D = h.length - 1, n = x.length, env = new Float32Array(n), d4 = D >> 2;
  for (let m = 0; m < 4 * n + D; m++) {
    let s = 0; for (let k = m & 3, kk = Math.min(m, D); k <= kk; k += 4) { const j = (m - k) >> 2; if (j < n) s += h[k] * x[j]; }
    s = Math.abs(4 * s); const i = (m >> 2) - d4; if (i >= 0 && i < n && s > env[i]) env[i] = s; if (i + 1 >= 0 && i + 1 < n && s > env[i + 1]) env[i + 1] = s;
  }
  return env;
}
/** Пик с учётом межотсчётных значений (×4), линейный. */
export function truePeak(x) { let pk = 0; for (const v of truePeakEnv(x)) if (v > pk) pk = v; return pk; }
/** Лимитер по true peak: плавное снижение усиления с упреждением, без жёсткого среза. */
export function limitTruePeak(x, ceil) {
  const n = x.length, tp = truePeakEnv(x), need = new Float32Array(n); let over = 0;
  for (let i = 0; i < n; i++) { need[i] = tp[i] > ceil ? ceil / tp[i] : 1; if (tp[i] > ceil) over++; }
  if (!over) return { y: x, hits: 0 };
  const la = Math.round(0.004 * SR), minAhead = new Float32Array(n), dq = new Int32Array(n); let h = 0, tl = 0;
  for (let i = n - 1; i >= 0; i--) { while (tl > h && need[dq[tl - 1]] >= need[i]) tl--; dq[tl++] = i; while (dq[h] > i + la) h++; minAhead[i] = need[dq[h]]; }
  const aAtt = 1 - Math.exp(-1 / (0.0008 * SR)), aRel = 1 - Math.exp(-1 / (0.08 * SR)), y = new Float32Array(n); let env = 1;
  for (let i = 0; i < n; i++) { const tg = minAhead[i]; env += (tg - env) * (tg < env ? aAtt : aRel); y[i] = x[i] * env; }
  return { y, hits: over };
}
const rms = x => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / Math.max(1, x.length)); };

// ------------------------------------------------------------------ спектр: срез кодека
/**
 * Где кончается верх записи: обрыв спектра (кодек, плохой микрофон) — падение ≥ 18 дБ за треть октавы,
 * после которого уровень уже не возвращается. {f, drop} или null, если верх спадает плавно (живая запись).
 */
export function detectCutoff(x) {
  const N = 4096, hop = 4096, win = hann(N), e = envDb(x, N, hop); if (e.length < 8) return null;
  const thr = prc(e, 90) - 15, loud = []; for (let t = 0; t < e.length; t++) if (e[t] > thr) loud.push(t);
  if (!loud.length) return null;
  const step = Math.max(1, Math.floor(loud.length / 600)), re = new Float64Array(N), im = new Float64Array(N), P = new Float64Array(N / 2 + 1);
  for (let q = 0; q < loud.length; q += step) { const o = loud[q] * hop; for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; } fft(re, im); for (let k = 0; k <= N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; }
  const hz = SR / N, F = [], Lv = [];
  for (let f = 2000; f * Math.pow(2, 1 / 12) <= 22000; f *= Math.pow(2, 1 / 12)) { let s = 0, c = 0; for (let k = Math.ceil(f / hz); k < f * Math.pow(2, 1 / 12) / hz; k++) { s += P[k]; c++; } F.push(f); Lv.push(c ? dB(s / c) : -200); }
  let ref = 0, rc = 0; for (let b = 0; b < F.length; b++) if (F[b] >= 3000 && F[b] <= 6000) { ref += Lv[b]; rc++; } ref /= Math.max(1, rc);
  let floorLv = Infinity; for (const v of Lv) floorLv = Math.min(floorLv, v);
  let best = null;
  for (let b = 2; b < F.length - 3; b++) {
    if (F[b] < 6000 || F[b] > 19500) continue;
    const before = (Lv[b - 2] + Lv[b - 1]) / 2, after = (Lv[b + 1] + Lv[b + 2]) / 2, drop = before - after;
    if (drop < 18 || before < floorLv + 10 || before < ref - 45) continue;
    let rest = 0, rn = 0; for (let q = b + 1; q < F.length; q++) { rest += Lv[q]; rn++; }
    if (rest / rn > before - 15) continue;                      // верх после обрыва возвращается — это не срез
    if (!best || drop > best.drop) best = { f: Math.round(F[b]), drop: +drop.toFixed(1) };
  }
  return best;
}

// ------------------------------------------------------------------ стоячие призвуки
/**
 * Узкие пики, которые торчат над соседями и держатся почти во всём файле (свист монитора, звон кодека,
 * электрика): голос так себя не ведёт — его гармоники ходят. [{f, prom, width, presence}].
 */
export function detectTones(x, { lo = 1500, hi = 12000, sens = 1 } = {}) {
  const N = 16384; if (x.length < N * 4) return [];
  const K = Math.min(32, Math.floor(x.length / N)), stride = Math.floor((x.length - N) / Math.max(1, K - 1)), win = hann(N);
  const hz = SR / N, kLo = Math.max(2, Math.floor(lo / hz)), kHi = Math.min(N / 2 - 2, Math.ceil(hi / hz)), R = Math.round(250 / hz), G = Math.round(15 / hz);
  const re = new Float64Array(N), im = new Float64Array(N), P = new Float64Array(N / 2 + 1), pres = new Uint16Array(N / 2 + 1), Ldb = new Float32Array(N / 2 + 1), cs = new Float64Array(N / 2 + 2);
  const localMean = k => { const a = Math.max(0, k - R), b = Math.min(N / 2, k + R), g0 = Math.max(0, k - G), g1 = Math.min(N / 2, k + G); const sum = cs[b + 1] - cs[a] - (cs[g1 + 1] - cs[g0]); return sum / Math.max(1, (b - a + 1) - (g1 - g0 + 1)); };
  for (let q = 0; q < K; q++) {
    const o = q * stride; for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; } fft(re, im);
    for (let k = 0; k <= N / 2; k++) { const p = re[k] * re[k] + im[k] * im[k]; P[k] += p; Ldb[k] = dB(p); cs[k + 1] = cs[k] + Ldb[k]; }
    for (let k = kLo; k <= kHi; k++) if (Ldb[k] - localMean(k) > 6) pres[k]++;
  }
  for (let k = 0; k <= N / 2; k++) { Ldb[k] = dB(P[k] / K); cs[k + 1] = cs[k] + Ldb[k]; }
  const thr = 9 / sens, found = [];
  for (let k = kLo; k <= kHi; k++) {
    if (Ldb[k] < Ldb[k - 1] || Ldb[k] < Ldb[k + 1]) continue;
    const prom = Ldb[k] - localMean(k); if (prom < thr) continue;
    let a = k, b = k; while (a > 1 && Ldb[a - 1] > Ldb[k] - 6) a--; while (b < N / 2 && Ldb[b + 1] > Ldb[k] - 6) b++;
    const width = (b - a + 1) * hz; if (width > 80) continue;
    let present = 0; for (let q = a; q <= b; q++) present = Math.max(present, pres[q]);
    if (present < K * 0.5) continue;
    found.push({ f: Math.round(k * hz), prom: +prom.toFixed(1), width: Math.round(width), presence: +(present / K).toFixed(2) });
  }
  found.sort((p, q) => q.prom - p.prom);
  const out = []; for (const t of found) { if (out.some(u => Math.abs(u.f - t.f) < 40)) continue; out.push(t); if (out.length >= 8) break; }
  return out.sort((p, q) => p.f - q.f);
}
export function detones(x, opts = {}) {
  const tones = detectTones(x, opts); if (!tones.length) return { y: x, cut: [] };
  const coefs = tones.map(t => biquad('peak', t.f, clamp(t.f / Math.max(40, 2 * t.width), 10, 120), -clamp(t.prom + 1, 8, 30)));
  return { y: cascade(x, coefs), cut: tones.map(t => t.f) };
}

// ------------------------------------------------------------------ резонансы (в духе Soothe)
/**
 * Резкие пики верха придавливаются только там и тогда, где они торчат над сглаженным спектром кадра:
 * спектр — сглаженный спектр (¼ октавы) — порог → снижение до depth дБ, с плавным краем полосы и инерцией.
 */
export function soothe(x, { lo = 5000, hi = 12000, depth = 3, sens = 1 } = {}, onProgress) {
  const N = 2048, hop = 512, hz = SR / N, thr = 1 / sens, e = envDb(x, N, hop), loud = e.length ? prc(e, 90) - 20 : -60;
  const w = new Float32Array(N / 2 + 1); let k0 = N / 2, k1 = 0;
  for (let k = 1; k <= N / 2; k++) { const f = k * hz; const v = f < lo / 1.26 || f > hi * 1.26 ? 0 : f < lo ? Math.log(f / (lo / 1.26)) / Math.log(1.26) : f > hi ? Math.log(hi * 1.26 / f) / Math.log(1.26) : 1; w[k] = v; if (v > 0) { k0 = Math.min(k0, k); k1 = Math.max(k1, k); } }
  const cs = new Float64Array(N / 2 + 2), gd = new Float32Array(N / 2 + 1), g = new Float32Array(N / 2 + 1);
  let sumRed = 0, cntRed = 0;
  const y = stftMap(x, (re, im, t, st) => {
    for (let k = 0; k <= N / 2; k++) cs[k + 1] = cs[k] + re[k] * re[k] + im[k] * im[k];
    gd.fill(0);
    // средняя мощность в узком окне (±1/20 октавы — прячет гармоники голоса) против широкого (±1/3 октавы — общий наклон); резонанс — разница
    for (let k = k0; k <= k1; k++) {
      const rn = Math.max(1, Math.round(k * 0.035)), rw = Math.max(4, Math.round(k * 0.26));
      const an = Math.max(0, k - rn), bn = Math.min(N / 2, k + rn), aw = Math.max(0, k - rw), bw = Math.min(N / 2, k + rw);
      const ex = dB((cs[bn + 1] - cs[an]) / (bn - an + 1)) - dB((cs[bw + 1] - cs[aw]) / (bw - aw + 1)) - thr;
      gd[k] = ex > 0 ? -Math.min(depth, ex * 1.5) * w[k] : 0;
    }
    const gs = smoothFreq(gd, 2);
    if (!st.prev) st.prev = Float32Array.from(gs); else for (let k = 0; k <= N / 2; k++) { const p = st.prev[k], v = gs[k]; st.prev[k] = v < p ? p + (v - p) * 0.7 : p + (v - p) * 0.25; }
    const ei = Math.min(e.length - 1, Math.max(0, t - N / hop));
    if (e.length && e[ei] > loud) { let s = 0, c = 0; for (let k = k0; k <= k1; k++) if (w[k] >= 0.99) { s -= st.prev[k]; c++; } if (c) { sumRed += s / c; cntRed++; } }
    for (let k = 0; k <= N / 2; k++) g[k] = Math.pow(10, st.prev[k] / 20);
    applyGain(re, im, g, N);
  }, onProgress, N, hop);
  return { y, avgDb: cntRed ? +(sumRed / cntRed).toFixed(2) : 0 };
}

// ------------------------------------------------------------------ транзиент-шейпер
/** Атаки чётче (+) или мягче (−), хвосты короче (−) или длиннее (+): быстрая огибающая против медленной. */
export function transients(x, { attack = 1.5, sustain = 0 } = {}) {
  if (!attack && !sustain) return x;
  const n = x.length, hop = Math.round(0.001 * SR), nH = Math.ceil(n / hop) + 1, gd = new Float32Array(nH);
  const aF = 1 - Math.exp(-1 / (0.0005 * SR)), rF = 1 - Math.exp(-1 / (0.02 * SR)), aS = 1 - Math.exp(-1 / (0.008 * SR)), rS = 1 - Math.exp(-1 / (0.2 * SR));
  let ef = 0, es = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(x[i]) + 1e-12; ef += (a - ef) * (a > ef ? aF : rF); es += (a - es) * (a > es ? aS : rS);
    if (i % hop === 0) { const d = 20 * Math.log10((ef + 1e-7) / (es + 1e-7)); gd[i / hop] = d > 0 ? attack * clamp(d / 6, 0, 1) : sustain * clamp(-d / 6, 0, 1); }
  }
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i / hop, k = Math.floor(p), f = p - k, g = gd[k] + (gd[Math.min(k + 1, nH - 1)] - gd[k]) * f; y[i] = x[i] * Math.pow(10, g / 20); }
  return y;
}

// ------------------------------------------------------------------ эксайтер: верх выше среза
/** Средний спектр мощности (на бин, N = 4096) по кадрам, равномерно разбросанным по файлу. */
export function avgSpec(x, N = 4096) {
  const win = hann(N), nF = Math.max(1, Math.floor((x.length - N) / N) + 1), step = Math.max(1, Math.floor(nF / 400));
  const re = new Float64Array(N), im = new Float64Array(N), P = new Float64Array(N / 2 + 1); let c = 0;
  for (let t = 0; t < nF; t += step) { const o = t * N; for (let i = 0; i < N; i++) { re[i] = o + i < x.length ? x[o + i] * win[i] : 0; im[i] = 0; } fft(re, im); for (let k = 0; k <= N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; c++; }
  for (let k = 0; k <= N / 2; k++) P[k] /= c;
  return P;
}
/** Средняя мощность на бин в полосе [fa, fb) по спектру avgSpec. */
export function bandMean(P, fa, fb, N = 4096) { const hz = SR / N, ka = Math.max(1, Math.ceil(fa / hz)), kb = Math.min(N / 2, Math.floor(fb / hz)); let s = 0, c = 0; for (let k = ka; k < kb; k++) { s += P[k]; c++; } return c ? s / c : 0; }
export const bandPower = (x, fa, fb) => bandMean(avgSpec(x), fa, fb);
/**
 * Верх выше среза (кодека или микрофона) достраивается чётными гармониками октавы под срезом: квадрат сигнала
 * даёт только вторую гармонику и суммарные тоны (в самой полосе-источнике — ничего), полоса-источник не выше 12 кГц — алиасинга нет. Уровень задаётся
 * на стыке: первая треть октавы над срезом = последняя треть под срезом минус 12…3 дБ (amount 0…1), дальше
 * спад: «лента» −12 дБ/окт и круче, «лампа» −6 дБ/окт. Огибающая следует за источником линейно.
 */
export function exciter(x, { amount = 0.5, from = 'auto', mode = 'tape' } = {}, cutoff = undefined) {
  if (amount <= 0) return { y: x, from: null };
  const det = from === 'auto' ? (cutoff === undefined ? detectCutoff(x) : cutoff) : null;
  const f0 = from === 'auto' ? (det ? det.f : 10000) : +from;
  const top = Math.min(f0, 12000), bot = Math.max(2000, top / 2);
  const src = cascade(x, [biquad('hp', bot, 0.7), biquad('hp', bot, 0.7), biquad('lp', top, 0.7), biquad('lp', top, 0.7)]);
  const aA = 1 - Math.exp(-1 / (0.002 * SR)), aR = 1 - Math.exp(-1 / (0.03 * SR)), floor = rms(src) * 0.05 + 1e-6;
  const gen = new Float32Array(x.length); let env = 0;
  for (let i = 0; i < x.length; i++) { const v = src[i], a = Math.abs(v) + 1e-12; env += (a - env) * (a > env ? aA : aR); gen[i] = v * v / (env + floor); }   // v² — только чётные: вторая гармоника и суммарные тоны, ничего в своей полосе
  const g0 = cascade(gen, [biquad('hp', f0, 0.7), biquad('hp', f0, 0.7)]);
  // спектр сгенерированного выравнивается FIR под цель: на стыке = последняя треть октавы под срезом − 12…3 дБ,
  // дальше спад «лента» −12 дБ/окт, «лампа» −6 дБ/окт; ниже среза — глухо
  const Px = avgSpec(x), Pg = avgSpec(g0), below = bandMean(Px, f0 / 1.26, f0); if (below < 1e-18) return { y: x, from: f0, detected: !!det, levelDb: 0 };
  const levelDb = -(12 - 9 * amount), slope = mode === 'tube' ? 6 : 12, seam = dB(below) + levelDb, st = Math.pow(2, 1 / 12);
  const fcs = [], d = [];
  for (let f = f0 / st; f < 21000; f *= st) {                                   // сетка 1/12 октавы, граница ровно на срезе
    const fc = f * Math.sqrt(st), pw = bandMean(Pg, f, Math.min(21500, f * st));
    fcs.push(fc); d.push(fc < f0 ? -60 : pw > 1e-18 ? clamp(seam - slope * Math.log2(fc / f0) - dB(pw), -60, 40) : -60);
  }
  const g = firApply(g0, firFromCurve(fcs, d, 2048));
  const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] + g[i];
  return { y, from: f0, detected: !!det, levelDb };
}

// ------------------------------------------------------------------ лента
/**
 * Мягкое ленточное насыщение с двукратной передискретизацией: tanh с небольшой чётной составляющей (тепло),
 * скругляет пики; чуть подъёма в низу (головка) и мягче самый верх. Речь нормируется к −12 dBFS перед
 * насыщением, чтобы тихий и громкий файл «ехали» одинаково; громкость на выходе возвращается к входной.
 */
export function tape(x, { amount = 0.3 } = {}) {
  if (amount <= 0) return x;
  const drive = 1 + 2 * amount, even = 0.12 * amount;
  const e = envDb(x, 960, 480), ref = e.length ? Math.pow(10, prc(e, 95) / 20) : 0.25, s = ref > 1e-6 ? 0.25 / ref : 1;
  const xin = new Float32Array(x.length); for (let i = 0; i < x.length; i++) xin[i] = x[i] * s;
  let y = os2(xin, v => { const u = v * drive; return Math.tanh(u + even * u * u) / drive; });
  y = cascade(y, [biquad('hp', 10, 0.7), biquad('lowshelf', 80, 0.7, 1.0 * amount), biquad('highshelf', 12000, 0.7, -1.5 * amount)]);
  const L0 = integratedLufs(x), L1 = integratedLufs(y), k = isFinite(L0) && isFinite(L1) && L0 > -69 && L1 > -69 ? Math.pow(10, (L0 - L1) / 20) : 1 / s;
  for (let i = 0; i < y.length; i++) y[i] *= k;
  return y;
}

// ------------------------------------------------------------------ громкость с true-peak лимитером
/**
 * К целевой громкости. mode 'gain' — только усиление, пики (true peak) не выше потолка, громкость может
 * не дотянуть; 'limit' — максимайзер: громкость достигается, пики выше потолка прижимает лимитер.
 */
export function loudness(x, { lufs = -20, ceilDb = -1.5, mode = 'gain' } = {}) {
  const L = integratedLufs(x); let g = isFinite(L) && L > -69 ? Math.pow(10, (lufs - L) / 20) : 1;
  const ceil = Math.pow(10, ceilDb / 20); let tp = truePeak(x), limited = 0;
  if (mode !== 'limit') {
    if (tp * g > ceil) g = ceil / tp;
    const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
    return { y, gainDb: 20 * Math.log10(g), tpDb: 20 * Math.log10(tp * g + 1e-12), limited };
  }
  let y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
  tp *= g;
  if (tp > ceil) { const r1 = limitTruePeak(y, ceil * 0.97); y = r1.y; limited = r1.hits; const r2 = limitTruePeak(y, ceil); y = r2.y; tp = truePeak(y); }
  return { y, gainDb: 20 * Math.log10(g), tpDb: 20 * Math.log10(tp + 1e-12), limited, lufsOut: integratedLufs(y) };
}
