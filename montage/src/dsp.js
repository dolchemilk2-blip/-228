// Монтажка — чистка звука: модули в духе iZotope RX (гул, шум, эхо, щелчки, взрывные, свист,
// эквалайзер, подгон под другой голос, компрессор, громкость). Без DOM: проверяется в Node.
// Все модули сохраняют длину и положение звука во времени: фильтры причинные (задержка
// меньше миллисекунды), спектральная обработка — с симметричным дополнением, FIR — с
// компенсацией задержки.
import { SR, integratedLufs } from './core.js';

// ------------------------------------------------------------------ БПФ
const TW = new Map();
function tw(n) {
  let t = TW.get(n);
  if (!t) { const c = new Float64Array(n / 2), s = new Float64Array(n / 2); for (let i = 0; i < n / 2; i++) { c[i] = Math.cos(2 * Math.PI * i / n); s[i] = Math.sin(2 * Math.PI * i / n); } t = { c, s }; TW.set(n, t); }
  return t;
}
/** БПФ на месте, n — степень двойки. inv — обратное (с делением на n). */
export function fft(re, im, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  const { c, s } = tw(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < half; k++) {
      const wr = c[k * step], wi = inv ? s[k * step] : -s[k * step];
      const a = i + k, b = a + half, xr = re[b], xi = im[b];
      const vr = xr * wr - xi * wi, vi = xr * wi + xi * wr;
      re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
const hann = n => { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); return w; };
const dB = p => 10 * Math.log10(p + 1e-14);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ фильтры (RBJ cookbook)
export function biquad(type, f0, Q = 0.707, gainDb = 0, sr = SR) {
  const A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * clamp(f0, 1, sr / 2 - 1) / sr;
  const cs = Math.cos(w0), sn = Math.sin(w0), al = sn / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lp': b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
    case 'hp': b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
    case 'bp': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
    case 'notch': b0 = 1; b1 = -2 * cs; b2 = 1; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
    case 'peak': b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; break;
    case 'lowshelf': { const sq = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cs + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - sq); a0 = (A + 1) + (A - 1) * cs + sq; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - sq; break; }
    case 'highshelf': { const sq = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cs + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - sq); a0 = (A + 1) - (A - 1) * cs + sq; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - sq; break; }
    default: throw new Error('фильтр ' + type);
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
/** Причинный фильтр (как в реальном эквалайзере): задержка меньше миллисекунды. */
export function filt(x, c, out = null) {
  const y = out || new Float32Array(x.length); const [b0, b1, b2, a1, a2] = c;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i], v = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const cascade = (x, coefs) => coefs.reduce((y, c) => filt(y, c), x);

// ------------------------------------------------------------------ огибающие
/** Уровень по окнам, дБ: окно win, шаг hop (в отсчётах). */
export function envDb(x, win, hop) {
  const n = Math.max(0, Math.floor((x.length - win) / hop) + 1), e = new Float32Array(n);
  const cs = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) cs[i + 1] = cs[i] + x[i] * x[i];
  for (let k = 0; k < n; k++) e[k] = dB((cs[k * hop + win] - cs[k * hop]) / win);
  return e;
}
function prc(arr, p) {
  if (!arr.length) return -140;
  const a = Float32Array.from(arr).sort();
  const x = (a.length - 1) * p / 100, lo = Math.floor(x), hi = Math.ceil(x);
  return a[lo] + (a[hi] - a[lo]) * (x - lo);
}
const speechDb = x => { const e = envDb(x, 960, 480); return e.length ? prc(e, 90) : -99; };
const floorDb = x => { const e = envDb(x, 960, 480); if (!e.length) return -99; const thr = prc(e, 30), q = Array.from(e).filter(v => v < thr); return q.length ? prc(q, 50) : prc(e, 0); };
/** Плавная кривая усиления (дБ на шаг hop) → умножение сигнала с линейной интерполяцией. */
function applyCurveDb(x, gdb, hop, attack, release) {
  const n = gdb.length, sm = new Float32Array(n);
  const aA = Math.exp(-hop / (attack * SR)), aR = Math.exp(-hop / (release * SR));
  let v = gdb[0];
  for (let i = 0; i < n; i++) { const t = gdb[i], c = t < v ? aA : aR; v = t + c * (v - t); sm[i] = v; }   // вниз быстро, вверх медленно
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const p = (i - hop / 2) / hop, k = clamp(Math.floor(p), 0, n - 1), f = clamp(p - k, 0, 1);
    const g = k + 1 < n ? sm[k] + (sm[k + 1] - sm[k]) * f : sm[k];
    y[i] = x[i] * Math.pow(10, g / 20);
  }
  return y;
}

// ------------------------------------------------------------------ гул
/** Ищет сетевой гул: 50 или 60 Гц и гармоники. Возвращает {base, peaks:[{f, prom}]} или null. */
export function detectHum(x) {
  const N = 32768; if (x.length < N * 2) return null;
  const win = hann(N), re = new Float64Array(N), im = new Float64Array(N), P = new Float64Array(N / 2 + 1);
  const K = Math.min(12, Math.floor(x.length / N)); const stride = Math.floor((x.length - N) / Math.max(1, K - 1));
  for (let k = 0; k < K; k++) { const o = k * stride; for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; } fft(re, im); for (let i = 0; i <= N / 2; i++) P[i] += re[i] * re[i] + im[i] * im[i]; }
  const hz = SR / N, at = f => Math.round(f / hz);
  const prom = f => {
    const c = at(f); let pk = 0; for (let i = c - 1; i <= c + 1; i++) pk = Math.max(pk, P[i]);
    const side = []; for (let i = at(f - 9); i <= at(f - 3); i++) side.push(P[i]); for (let i = at(f + 3); i <= at(f + 9); i++) side.push(P[i]);
    return dB(pk) - dB(prc(side, 50));
  };
  let best = null;
  for (const base of [50, 60]) {
    const p1 = prom(base), p2 = prom(2 * base);
    if (p1 < 8 && p2 < 8) continue;                    // основной или второй гармоники нет — гула нет
    const peaks = []; for (let k = 1; k <= 8; k++) { const f = base * k; if (f > 1000) break; const p = prom(f); if (p > (k <= 2 ? 8 : 12)) peaks.push({ f, prom: +p.toFixed(1) }); }
    const score = Math.max(p1, 0) + Math.max(p2, 0);
    if (peaks.length && (!best || score > best.score)) best = { base, peaks, score };
  }
  return best && best.peaks.length ? { base: best.base, peaks: best.peaks } : null;
}
export function dehum(x, { base = 'auto', harmonics = 6, depth = 30 } = {}) {
  let hum = detectHum(x);
  if (base !== 'auto') hum = hum && hum.base === base ? hum : { base, peaks: Array.from({ length: harmonics }, (_, k) => ({ f: base * (k + 1), prom: 12 })) };
  if (!hum) return { y: x, cut: [] };
  const coefs = hum.peaks.slice(0, harmonics).map(p => biquad('peak', p.f, 30, -clamp(p.prom + 3, 10, depth)));
  return { y: cascade(x, coefs), cut: hum.peaks.slice(0, harmonics).map(p => p.f) };
}
export const highpass = (x, fc = 70) => filt(x, biquad('hp', fc, 0.707));

// ------------------------------------------------------------------ щелчки
/** Одиночные щелчки: выброс, которого нет в соседних отсчётах, заменяется плавной вставкой. */
export function declick(x, { sens = 1 } = {}) {
  const y = Float32Array.from(x), n = x.length;
  const d = new Float32Array(n);                     // остаток после сглаживания: щелчки в нём торчат
  for (let i = 2; i < n - 2; i++) d[i] = x[i] - (x[i - 2] + x[i - 1] + x[i + 1] + x[i + 2]) / 4;
  const W = 960, e = envDb(d, W, W);                  // локальный масштаб остатка, шаг 20 мс
  const k = 14 / Math.max(0.3, sens), maxRun = Math.round(0.003 * SR); let fixed = 0;
  for (let i = 2; i < n - 2; i++) {
    const scale = Math.pow(10, e[Math.min(e.length - 1, Math.floor(i / W))] / 20);
    if (Math.abs(d[i]) <= k * (scale + 1e-4)) continue;
    let a = i, b = i;
    while (b < n - 2 && b - a < maxRun && Math.abs(d[b + 1]) > 0.35 * k * (scale + 1e-4)) b++;
    if (b - a >= maxRun) { i = b; continue; }
    const l = Math.max(1, a - 2), r = Math.min(n - 2, b + 2);
    for (let q = l; q <= r; q++) { const f = (q - l + 1) / (r - l + 2); y[q] = y[l - 1] + (y[r + 1] - y[l - 1]) * (3 * f * f - 2 * f * f * f); }
    fixed++; i = r;
  }
  return { y, fixed };
}

// ------------------------------------------------------------------ спектральная обработка
const N_STFT = 2048, HOP = 512;
/**
 * Кадр за кадром: fn(re, im, t, state) правит спектр на месте. Симметричное дополнение и
 * окно Ханна с шагом N/4 — сумма квадратов окон постоянна, сигнал восстанавливается без сдвига.
 */
function stftMap(x, fn, onProgress, N = N_STFT, hop = HOP) {
  const L = x.length, xp = new Float32Array(L + 2 * N); xp.set(x, N);
  const win = hann(N), nF = Math.floor((xp.length - N) / hop) + 1;
  const out = new Float32Array(xp.length), re = new Float64Array(N), im = new Float64Array(N), state = {};
  let norm = 0; for (let k = 0; k < N / hop; k++) norm += win[k * hop] * win[k * hop];
  for (let t = 0; t < nF; t++) {
    const o = t * hop;
    for (let i = 0; i < N; i++) { re[i] = xp[o + i] * win[i]; im[i] = 0; }
    fft(re, im); fn(re, im, t, state); fft(re, im, true);
    for (let i = 0; i < N; i++) out[o + i] += re[i] * win[i];
    if (onProgress && (t & 255) === 0) onProgress(t / nF);
  }
  const y = new Float32Array(L); for (let i = 0; i < L; i++) y[i] = out[N + i] / norm;
  return y;
}
const applyGain = (re, im, g, N) => { for (let k = 0; k <= N / 2; k++) { re[k] *= g[k]; im[k] *= g[k]; if (k && k < N / 2) { re[N - k] *= g[k]; im[N - k] *= g[k]; } } };
function smoothFreq(g, r = 2) { const n = g.length, o = new Float32Array(n); for (let k = 0; k < n; k++) { let s = 0, c = 0; for (let q = Math.max(0, k - r); q <= Math.min(n - 1, k + r); q++) { s += g[q]; c++; } o[k] = s / c; } return o; }

/**
 * Профиль шума: средняя мощность по частотам в самых тихих кадрах файла (но не в цифровой
 * тишине). Если тихих кадров нет — 10-й процентиль по каждой частоте по всему файлу.
 */
export function noiseProfile(x, N = N_STFT, hop = HOP) {
  const win = hann(N), nF = Math.floor((x.length - N) / hop) + 1;
  if (nF < 10) return null;
  const e = envDb(x, N, hop);
  const idx = []; for (let t = 0; t < nF; t++) if (e[t] > -85) idx.push(t);
  if (!idx.length) return null;
  idx.sort((a, b) => e[a] - e[b]);
  let pick = idx.slice(0, Math.max(20, Math.floor(idx.length * 0.2)));
  const quiet = e[pick[pick.length - 1]] < prc(e, 90) - 20;   // тихие кадры действительно тихие?
  if (!quiet) { pick = []; for (let t = 0; t < nF; t += Math.max(1, Math.floor(nF / 600))) pick.push(t); }
  if (pick.length > 400) { const s = pick.length / 400; pick = Array.from({ length: 400 }, (_, i) => pick[Math.floor(i * s)]); }
  const re = new Float64Array(N), im = new Float64Array(N), acc = [];
  for (const t of pick) { const o = t * hop; for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; } fft(re, im); const P = new Float32Array(N / 2 + 1); for (let k = 0; k <= N / 2; k++) P[k] = re[k] * re[k] + im[k] * im[k]; acc.push(P); }
  const prof = new Float32Array(N / 2 + 1);
  if (quiet) { for (const P of acc) for (let k = 0; k <= N / 2; k++) prof[k] += P[k] / acc.length; }
  else { const col = new Float32Array(acc.length); for (let k = 0; k <= N / 2; k++) { for (let i = 0; i < acc.length; i++) col[i] = acc[i][k]; prof[k] = prc(col, 10); } }
  return { prof, level: quiet ? e[pick[Math.floor(pick.length / 2)]] : null };
}
/** Шум: спектральное вычитание с мягкой маской, сглаживанием по частоте и времени. */
export function denoise(x, { amount = 12, sens = 1.5, profile = null } = {}, onProgress) {
  const np = profile || noiseProfile(x); if (!np) return { y: x, applied: false };
  const N = N_STFT, floor = Math.pow(10, -amount / 20), prof = np.prof;
  const y = stftMap(x, (re, im, t, st) => {
    const g = new Float32Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) { const P = re[k] * re[k] + im[k] * im[k], snr = P / (sens * prof[k] + 1e-12); g[k] = snr > 1 ? Math.max(floor, Math.sqrt(1 - 1 / snr)) : floor; }
    const gs = smoothFreq(g, 2);
    if (!st.prev) st.prev = gs; else for (let k = 0; k <= N / 2; k++) { const p = st.prev[k], v = gs[k]; st.prev[k] = v > p ? p + (v - p) * 0.7 : p + (v - p) * 0.3; }
    applyGain(re, im, st.prev, N);
  }, onProgress);
  return { y, applied: true };
}
/**
 * Эхо спектрально (по Лебару): поздняя реверберация оценивается как затухающая сумма
 * прошлых кадров (T60), и вычитается. Сильнее сушит, чем работа с огибающей, но при больших
 * значениях делает голос «водянистым» — слушать.
 */
export function dereverbSpectral(x, { amount = 0.5, t60 = 0.5 } = {}, onProgress) {
  const N = N_STFT, hop = HOP, d = Math.max(2, Math.round(0.05 * SR / hop)), w = Math.pow(10, -6 * hop / SR / t60), wd = Math.pow(w, d);
  const beta = 0.3 + 1.7 * amount, floor = Math.pow(10, -(8 + 12 * amount) / 20);
  const y = stftMap(x, (re, im, t, st) => {
    if (!st.R) { st.R = new Float64Array(N / 2 + 1); st.hist = []; st.prev = null; }
    const P = new Float64Array(N / 2 + 1); for (let k = 0; k <= N / 2; k++) P[k] = re[k] * re[k] + im[k] * im[k];
    const old = st.hist.length >= d ? st.hist.shift() : null;
    for (let k = 0; k <= N / 2; k++) st.R[k] = w * st.R[k] + (old ? wd * old[k] : 0);
    st.hist.push(P);
    const g = new Float32Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) { const r = beta * st.R[k]; g[k] = P[k] > r ? Math.max(floor, Math.sqrt((P[k] - r) / P[k])) : floor; }
    const gs = smoothFreq(g, 1);
    if (!st.prev) st.prev = gs; else for (let k = 0; k <= N / 2; k++) { const p = st.prev[k], v = gs[k]; st.prev[k] = v > p ? p + (v - p) * 0.8 : p + (v - p) * 0.4; }
    applyGain(re, im, st.prev, N);
  }, onProgress);
  return y;
}
/** Хвосты после слогов (объём комнаты): всё, что ниже локального пика, придавливается. Пики не трогаются. */
export function dryUp(x, amount = 0.45, maxDb = 12) {
  if (amount <= 0) return x;
  const h = Math.round(0.005 * SR), env = envDb(x, h, h); if (env.length < 10) return x;
  const ref = new Float32Array(env.length), aR = Math.exp(-h / (0.35 * SR)); let v = env[0];
  for (let i = 0; i < env.length; i++) { const t = env[i]; v = t > v ? t : t + aR * (v - t); ref[i] = v; }
  const g = new Float32Array(env.length); for (let i = 0; i < env.length; i++) g[i] = clamp(amount * (env[i] - ref[i]), -maxDb, 0);
  return applyCurveDb(x, g, h, 0.008, 0.05);
}
/** Паузы и дыхание: где речи нет, уровень опускается на depth дБ. Порог считается от речи и фона файла. */
export function gatePauses(x, { depth = 12, margin = 9 } = {}) {
  if (depth <= 0 || x.length < SR) return { y: x, quiet: 0 };
  const w = 960, h = 240, e = envDb(x, w, h); if (!e.length) return { y: x, quiet: 0 };
  const sp = prc(e, 90), fl = floorDb(x);
  let thr = Math.min(sp - 28, fl + margin); if (thr <= fl + 1) thr = fl + margin;
  const hold = Math.round(0.12 * SR / h), g = new Float32Array(e.length); let cnt = 0, open = 0;
  for (let i = 0; i < e.length; i++) { if (e[i] > thr) cnt = hold; else if (cnt > 0) cnt--; g[i] = cnt > 0 ? 0 : -depth; if (cnt > 0) open++; }
  return { y: applyCurveDb(x, g, h, 0.006, 0.18), quiet: 100 * (1 - open / e.length) };
}

// ------------------------------------------------------------------ свист и взрывные
/** Де-эссер: полоса 4,5–9 кГц придавливается там, где она громче обычного для этой записи. */
export function deess(x, { amount = 0.5 } = {}) {
  if (amount <= 0) return x;
  const band = cascade(x, [biquad('hp', 4500, 0.7), biquad('hp', 4500, 0.7), biquad('lp', 9000, 0.7)]);
  const h = Math.round(0.002 * SR), e = envDb(band, Math.round(0.006 * SR), h); if (e.length < 10) return x;
  const all = envDb(x, Math.round(0.006 * SR), h), sp = prc(all, 90);
  const inSpeech = []; for (let i = 0; i < e.length && i < all.length; i++) if (all[i] > sp - 25) inSpeech.push(e[i]);
  const thr = prc(inSpeech, 72);
  const g = new Float32Array(e.length), k = 0.4 + 0.6 * amount;
  for (let i = 0; i < e.length; i++) g[i] = e[i] > thr ? -Math.min(14, (e[i] - thr) * k) : 0;
  const cut = applyCurveDb(band, g, h, 0.001, 0.04);
  const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] - band[i] + cut[i];
  return y;
}
/** Взрывные «п» и «б»: низ ниже 150 Гц придавливается там, где он выстреливает над речью. */
export function deplosive(x, { amount = 0.6 } = {}) {
  if (amount <= 0) return x;
  const low = cascade(x, [biquad('lp', 150, 0.7), biquad('lp', 150, 0.7)]);
  const h = Math.round(0.005 * SR), el = envDb(low, Math.round(0.02 * SR), h), ea = envDb(x, Math.round(0.02 * SR), h);
  const n = Math.min(el.length, ea.length); if (n < 10) return x;
  const sp = prc(ea, 90), ratio = []; for (let i = 0; i < n; i++) if (ea[i] > sp - 25) ratio.push(el[i] - ea[i]);
  const typ = prc(ratio, 60), g = new Float32Array(n);
  for (let i = 0; i < n; i++) { const r = el[i] - ea[i]; g[i] = (ea[i] > sp - 25 && r > typ + 4) ? -Math.min(15, (r - typ - 4) * (1 + amount) + 3 * amount) : 0; }
  const cut = applyCurveDb(low, g, h, 0.004, 0.06);
  const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] - low[i] + cut[i];
  return y;
}

// ------------------------------------------------------------------ тембр
export const TONE_REF = { 63: 0.5, 125: 8.0, 250: 11.0, 500: 10.5 };
/** Спектр речи по октавам относительно 1 кГц (кадры с речью). */
export function octaves(x) {
  const N = 2048, win = hann(N), e = envDb(x, N, N / 2); if (e.length < 8) return null;
  const thr = prc(e, 90) - 12, re = new Float64Array(N), im = new Float64Array(N), P = new Float64Array(N / 2 + 1);
  let cnt = 0; for (let t = 0; t < e.length && cnt < 800; t++) { if (e[t] <= thr) continue; const o = t * N / 2; for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; } fft(re, im); for (let k = 0; k <= N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; cnt++; }
  if (!cnt) return null;
  const hz = SR / N, band = fc => { let s = 0; for (let k = Math.ceil(fc / Math.SQRT2 / hz); k < fc * Math.SQRT2 / hz && k <= N / 2; k++) s += P[k]; return dB(s); };
  const ref = band(1000), out = {}; for (const fc of [63, 125, 250, 500, 1000, 2000, 4000, 8000]) out[fc] = band(fc) - ref;
  return out;
}
/** Гулкость: где низ торчит над спектром нормальной речи, там и режем (только вниз, только до 500 Гц). */
export function deboom(x, strength = 1, maxDb = 8) {
  const got = octaves(x); if (!got || strength <= 0) return { y: x, cuts: {} };
  const coefs = [], cuts = {};
  for (const [fc, ref] of Object.entries(TONE_REF)) { const d = Math.max(-maxDb, Math.min(0, ref + 2 - got[fc]) * strength); if (d > -0.5) continue; cuts[fc] = +d.toFixed(1); coefs.push(biquad('peak', +fc, 1.0, d)); }
  return { y: coefs.length ? cascade(x, coefs) : x, cuts };
}
export const THIRDS = [50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000];
/** Спектр речи по третьоктавам, нормирован по ядру 300–3000 Гц. */
export function ltas(x, stride = 1) {
  const N = 2048, hop = 480 * stride, win = hann(N), e = envDb(x, N, hop); if (e.length < 8) return null;
  const thr = prc(e, 90) - 12, re = new Float64Array(N), im = new Float64Array(N), P = new Float64Array(N / 2 + 1);
  let cnt = 0; for (let t = 0; t < e.length && cnt < 1500; t++) { if (e[t] <= thr) continue; const o = t * hop; for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; } fft(re, im); for (let k = 0; k <= N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; cnt++; }
  if (!cnt) return null;
  const hz = SR / N, out = {};
  for (const fc of THIRDS) { let s = 0, any = false; for (let k = Math.ceil(fc / Math.pow(2, 1 / 6) / hz); k < fc * Math.pow(2, 1 / 6) / hz && k <= N / 2; k++) { s += P[k]; any = true; } out[fc] = any ? dB(s) : -200; }
  const core = THIRDS.filter(f => f >= 300 && f <= 3000 && out[f] > -150).map(f => out[f]);
  const anchor = core.length ? core.reduce((a, b) => a + b, 0) / core.length : 0;
  for (const f of THIRDS) out[f] -= anchor;
  return out;
}
/** Свёртка с длинным FIR через БПФ (перекрытие с накоплением), задержка фильтра снимается. */
function firApply(x, h) {
  const M = h.length, B = 16384, L = B - M + 1, n = x.length, out = new Float32Array(n + M);
  const hr = new Float64Array(B), hi = new Float64Array(B); hr.set(h); fft(hr, hi);
  const re = new Float64Array(B), im = new Float64Array(B);
  for (let o = 0; o < n; o += L) {
    re.fill(0); im.fill(0); for (let i = 0; i < L && o + i < n; i++) re[i] = x[o + i];
    fft(re, im);
    for (let k = 0; k < B; k++) { const a = re[k], b = im[k]; re[k] = a * hr[k] - b * hi[k]; im[k] = a * hi[k] + b * hr[k]; }
    fft(re, im, true);
    for (let i = 0; i < B && o + i < out.length; i++) out[o + i] += re[i];
  }
  const d = (M - 1) >> 1, y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = out[i + d];
  return y;
}
/** Подгон тембра под другую запись: разница третьоктавных спектров → линейно-фазовый FIR. */
export function matchTone(x, refLtas, { strength = 1, maxDb = 18 } = {}) {
  const a = ltas(x, 2); if (!a || !refLtas) return { y: x, curve: null };
  const fcs = THIRDS.filter(f => f < SR / 2 * 0.92 && a[f] > -150 && refLtas[f] > -150);
  let d = fcs.map(f => clamp((refLtas[f] - a[f]) * strength, -maxDb, maxDb));
  d = d.map((v, i) => 0.25 * d[Math.max(0, i - 1)] + 0.5 * v + 0.25 * d[Math.min(d.length - 1, i + 1)]);
  const core = fcs.map((f, i) => (f >= 300 && f <= 3000 ? d[i] : null)).filter(v => v != null);
  const mean = core.length ? core.reduce((s, v) => s + v, 0) / core.length : 0; d = d.map(v => v - mean);
  const N = 4096, H = new Float64Array(N), Hi = new Float64Array(N), lf = fcs.map(f => Math.log(f));
  for (let k = 0; k <= N / 2; k++) {
    const f = k * SR / N; let g;
    if (f <= fcs[0]) g = d[0]; else if (f >= fcs[fcs.length - 1]) g = d[d.length - 1];
    else { const L = Math.log(f); let i = 0; while (lf[i + 1] < L) i++; const t = (L - lf[i]) / (lf[i + 1] - lf[i]); g = d[i] + (d[i + 1] - d[i]) * t; }
    H[k] = Math.pow(10, g / 20); if (k && k < N / 2) H[N - k] = H[k];
  }
  fft(H, Hi, true);                                  // импульсная характеристика (циклическая)
  const h = new Float32Array(N + 1), w = hann(N + 1);
  for (let i = 0; i <= N; i++) h[i] = H[(i - N / 2 + N) % N] * w[i];
  return { y: firApply(x, h), curve: Object.fromEntries(fcs.map((f, i) => [f, +d[i].toFixed(1)])) };
}
/** Эквалайзер: полосы {type, f, q, gain}. */
export function eq(x, bands) {
  const coefs = bands.filter(b => b && Math.abs(b.gain) >= 0.1).map(b => biquad(b.type, b.f, b.q || 0.9, b.gain));
  return coefs.length ? cascade(x, coefs) : x;
}

// ------------------------------------------------------------------ динамика
/** Компрессор: ровнее без потери характера. amount 0..1 → порог и степень. */
export function compress(x, { amount = 0.5 } = {}) {
  if (amount <= 0) return x;
  const h = Math.round(0.005 * SR), e = envDb(x, Math.round(0.01 * SR), h); if (e.length < 10) return x;
  const sp = prc(e, 90), thr = sp - 6 - 8 * amount, ratio = 1.5 + 2.5 * amount, knee = 4;
  const g = new Float32Array(e.length); let sum = 0, cnt = 0;
  for (let i = 0; i < e.length; i++) {
    const over = e[i] - thr; let gr = 0;
    if (over > knee / 2) gr = over * (1 - 1 / ratio); else if (over > -knee / 2) gr = (1 - 1 / ratio) * Math.pow(over + knee / 2, 2) / (2 * knee);
    g[i] = -gr; if (e[i] > sp - 25) { sum += gr; cnt++; }
  }
  const makeup = cnt ? sum / cnt : 0; for (let i = 0; i < g.length; i++) g[i] += makeup;
  return applyCurveDb(x, g, h, 0.005, 0.08);
}
export function normalize(x, { lufs = -20, ceilDb = -1.5 } = {}) {
  const L = integratedLufs(x); let g = isFinite(L) && L > -69 ? Math.pow(10, (lufs - L) / 20) : 1;
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
  const ceil = Math.pow(10, ceilDb / 20); if (pk * g > ceil) g = ceil / pk;
  const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
  return { y, gainDb: 20 * Math.log10(g) };
}

// ------------------------------------------------------------------ разбор и картинка
/** Что с записью: уровни, гул, низ, комната. Для подсказок и заголовка панели. */
export function analyze(x) {
  const oc = octaves(x), hum = detectHum(x);
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
  // спад огибающей после слогов, дБ/с: близкий микрофон ≈140, комната 120 и ниже
  const bp = cascade(x, [biquad('hp', 500, 0.7), biquad('lp', 4000, 0.7)]);
  const e = envDb(bp, Math.round(0.01 * SR), Math.round(0.01 * SR)), sl = [];
  if (e.length > 30) { const p85 = prc(e, 85); for (let i = 2; i < e.length - 12; i++) if (e[i] > p85 && e[i] > e[i - 1] && e[i] > e[i + 1] && e[i + 12] < e[i] - 3) sl.push((e[i] - e[i + 12]) / 0.12); }
  return {
    dur: x.length / SR, lufs: integratedLufs(x), peakDb: 20 * Math.log10(pk + 1e-12), speechDb: speechDb(x), floorDb: floorDb(x),
    hum, octaves: oc, boom: oc ? +Math.max(0, oc[125] - TONE_REF[125]).toFixed(1) : 0, decay: sl.length ? +prc(sl, 50).toFixed(0) : null,
  };
}
/** Спектрограмма для показа: строки — частота (логарифмически, fmin..fmax), столбцы — время. */
export function spectrogram(x, { cols = 600, rows = 160, fmin = 60, fmax = 16000 } = {}) {
  const N = 1024, hop = Math.max(64, Math.floor(x.length / cols)), win = hann(N), nF = Math.max(1, Math.floor((x.length - N) / hop) + 1);
  const re = new Float64Array(N), im = new Float64Array(N), data = new Float32Array(rows * nF), hz = SR / N;
  const lo = new Int32Array(rows), hi = new Int32Array(rows);
  for (let r = 0; r < rows; r++) { const f0 = fmin * Math.pow(fmax / fmin, r / rows), f1 = fmin * Math.pow(fmax / fmin, (r + 1) / rows); lo[r] = Math.max(1, Math.floor(f0 / hz)); hi[r] = Math.max(lo[r] + 1, Math.ceil(f1 / hz)); }
  let mx = -200;
  for (let t = 0; t < nF; t++) {
    const o = t * hop; for (let i = 0; i < N; i++) { re[i] = (o + i < x.length ? x[o + i] : 0) * win[i]; im[i] = 0; } fft(re, im);
    for (let r = 0; r < rows; r++) { let s = 0; for (let k = lo[r]; k < hi[r] && k <= N / 2; k++) s = Math.max(s, re[k] * re[k] + im[k] * im[k]); const v = dB(s); data[(rows - 1 - r) * nF + t] = v; if (v > mx) mx = v; }
  }
  return { rows, cols: nF, data, max: mx, min: mx - 80 };
}

// ------------------------------------------------------------------ цепочка
export const CHAIN_ORDER = ['dehum', 'hp', 'declick', 'denoise', 'dereverb', 'deplosive', 'deess', 'eq', 'tone', 'comp', 'loud'];
export const CLEAN_PRESETS = {
  soft:   { dehum: 1, hp: 70, denoise: [6, 1.3], dereverb: [0.2, 0.3, 6], tone: 0, deess: 0, deplosive: 0, declick: 0 },
  normal: { dehum: 1, hp: 70, denoise: [10, 1.5], dereverb: [0.4, 0.4, 10], tone: 0, deess: 0, deplosive: 0, declick: 0 },
  strong: { dehum: 1, hp: 80, denoise: [16, 2], dereverb: [0.7, 0.6, 14], tone: 1, deess: 1, deplosive: 1, declick: 1 },
  hum:    { dehum: 1, hp: 70, denoise: null, dereverb: null, tone: 0, deess: 0, deplosive: 0, declick: 0 },
  none:   { dehum: 0, hp: 0, denoise: null, dereverb: null, tone: 0, deess: 0, deplosive: 0, declick: 0 },
};
export function defaultChain(preset = 'normal', hints = {}) {
  const P = CLEAN_PRESETS[preset] || CLEAN_PRESETS.normal;
  return {
    dehum: { on: !!P.dehum, base: 'auto' }, hp: { on: !!P.hp, fc: P.hp || 70 }, declick: { on: !!P.declick, sens: 1 },
    denoise: { on: !!P.denoise, amount: P.denoise ? P.denoise[0] : 10, sens: P.denoise ? P.denoise[1] : 1.5 },
    dereverb: { on: !!P.dereverb, spectral: P.dereverb ? P.dereverb[0] : 0.4, t60: 0.5, tails: P.dereverb ? P.dereverb[1] : 0.4, pauses: P.dereverb ? P.dereverb[2] : 10 },
    deplosive: { on: !!P.deplosive, amount: 0.6 }, deess: { on: !!P.deess, amount: 0.5 },
    eq: { on: false, bands: [{ type: 'lowshelf', f: 120, q: 0.7, gain: 0 }, { type: 'peak', f: 250, q: 1, gain: 0 }, { type: 'peak', f: 1000, q: 1, gain: 0 }, { type: 'peak', f: 3000, q: 1, gain: 0 }, { type: 'highshelf', f: 8000, q: 0.7, gain: 0 }] },
    tone: { on: !!P.tone || !!(hints.boom >= 4 && preset !== 'none' && preset !== 'hum'), mode: 'auto', strength: 1, ref: null },
    comp: { on: false, amount: 0.4 }, loud: { on: preset !== 'none', lufs: -20 },
  };
}
/** Выполняет цепочку по порядку. aux: {noise: профиль шума файла, refLtas: спектр записи-образца}. */
export function runChain(x, chain, aux = {}, onProgress = null) {
  const log = []; let y = x; const steps = CHAIN_ORDER.filter(k => chain[k] && chain[k].on); let done = 0;
  const prog = (f) => onProgress && onProgress((done + f) / Math.max(1, steps.length));
  for (const k of steps) {
    const p = chain[k];
    if (k === 'dehum') { const r = dehum(y, p); y = r.y; log.push(r.cut.length ? `гул: вырезано ${r.cut.join(', ')} Гц` : 'гул: не найден'); }
    else if (k === 'hp') { y = highpass(y, p.fc); log.push(`низ срезан ниже ${p.fc} Гц`); }
    else if (k === 'declick') { const r = declick(y, p); y = r.y; log.push(`щелчки: исправлено ${r.fixed}`); }
    else if (k === 'denoise') { const r = denoise(y, { ...p, profile: aux.noise || null }, prog); y = r.y; log.push(r.applied ? `шум: до −${p.amount} дБ` : 'шум: профиль не построить'); }
    else if (k === 'dereverb') {
      if (p.spectral > 0) { y = dereverbSpectral(y, { amount: p.spectral, t60: p.t60 }, prog); log.push(`эхо спектрально: ${Math.round(p.spectral * 100)} %`); }
      if (p.tails > 0) { y = dryUp(y, p.tails); log.push(`хвосты после слогов: ${Math.round(p.tails * 100)} %`); }
      if (p.pauses > 0) { const r = gatePauses(y, { depth: p.pauses }); y = r.y; log.push(`паузы тише на ${p.pauses} дБ (${r.quiet.toFixed(0)} % файла)`); }
    }
    else if (k === 'deplosive') { y = deplosive(y, p); log.push('взрывные придавлены'); }
    else if (k === 'deess') { y = deess(y, p); log.push('свист придавлен'); }
    else if (k === 'eq') { y = eq(y, p.bands); log.push('эквалайзер: ' + p.bands.filter(b => Math.abs(b.gain) >= 0.1).map(b => `${b.f} Гц ${b.gain > 0 ? '+' : ''}${b.gain}`).join(', ')); }
    else if (k === 'tone') {
      if (p.mode === 'match' && aux.refLtas) { const r = matchTone(y, aux.refLtas, { strength: p.strength }); y = r.y; log.push('тембр подогнан под образец'); }
      else { const r = deboom(y, p.strength); y = r.y; log.push(Object.keys(r.cuts).length ? 'гулкость: ' + Object.entries(r.cuts).map(([f, d]) => `${f} Гц ${d} дБ`).join(', ') : 'гулкость: низ в норме'); }
    }
    else if (k === 'comp') { y = compress(y, p); log.push(`компрессор ${Math.round(p.amount * 100)} %`); }
    else if (k === 'loud') { const r = normalize(y, { lufs: p.lufs }); y = r.y; log.push(`громкость ${p.lufs} LUFS (${r.gainDb > 0 ? '+' : ''}${r.gainDb.toFixed(1)} дБ)`); }
    done++; prog(0);
  }
  return { y, log };
}
