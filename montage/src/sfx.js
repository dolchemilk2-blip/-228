// Монтажка — звуки по сценарию: какие ремарки звучат, встроенные синтезированные звуки-заглушки,
// подбор файлов из библиотеки пользователя по имени. Без DOM.
import { SR, norm, dice } from './core.js';
import { biquad, filt } from './dsp.js';

// ------------------------------------------------------------------ синтез (заглушки, заменяются файлами)
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); }; }
const sec = t => Math.round(t * SR);
const noise = (n, r) => { const y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = r() * 2 - 1; return y; };
const env = (y, a, d, from = 0) => { const na = sec(a), nd = sec(d); for (let i = 0; i < y.length; i++) { const t = i - from; if (t < 0) continue; y[i] *= t < na ? t / na : Math.exp(-(t - na) / nd); } return y; };
const add = (dst, src, at, g = 1) => { const o = sec(at); for (let i = 0; i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * g; return dst; };
const lp = (y, f, q = 0.707) => filt(y, biquad('lp', f, q)), hp = (y, f, q = 0.707) => filt(y, biquad('hp', f, q)), bp = (y, f, q) => filt(y, biquad('bp', f, q));
const tone = (n, f, r = null, fm = 0) => { const y = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const ff = typeof f === 'function' ? f(i / n) : f; ph += 2 * Math.PI * (ff * (1 + (r ? (r() - 0.5) * fm : 0))) / SR; y[i] = Math.sin(ph); } return y; };
const peakTo = (y, peak = 0.5) => { let m = 0; for (const v of y) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < y.length; i++) y[i] *= peak / m; return y; };

function thump(r, f0 = 90, d = 0.18) {                // глухой удар
  const n = sec(d + 0.1), y = tone(n, t => f0 * (1.6 - 0.6 * t)); env(y, 0.002, d / 3);
  add(y, env(lp(noise(n, r), 900), 0.001, 0.02), 0, 0.6); return y;
}
function click(r, bright = 1) { const n = sec(0.03), y = env(hp(noise(n, r), 1500 * bright), 0.0005, 0.004); return y; }
const SYNTH = {
  knock:     { name: 'стук в дверь', make: r => { const y = new Float32Array(sec(1.2)); [0, 0.32, 0.6].forEach(t => { add(y, thump(r, 110, 0.12), t, 1); add(y, click(r, 0.6), t, 0.5); }); return peakTo(y); } },
  door_open: { name: 'дверь открывается', make: r => { const n = sec(1.1), y = new Float32Array(n);
      const creak = tone(sec(0.75), t => 620 + 260 * Math.sin(t * 9) + 140 * t, r, 0.06); for (let i = 0; i < creak.length; i++) creak[i] = Math.sign(creak[i]) * Math.pow(Math.abs(creak[i]), 0.4);
      add(y, env(bp(creak, 900, 2), 0.05, 0.5), 0.05, 0.35); add(y, env(bp(noise(sec(0.8), r), 1400, 1), 0.05, 0.4), 0.05, 0.25);
      add(y, click(r, 1), 0.02, 0.5); add(y, thump(r, 70, 0.08), 0.85, 0.35); return peakTo(y, 0.45); } },
  door_slam: { name: 'дверь хлопает', make: r => { const n = sec(0.9), y = new Float32Array(n); add(y, thump(r, 60, 0.35), 0, 1); add(y, env(lp(noise(sec(0.4), r), 2500), 0.001, 0.05), 0, 0.9); add(y, click(r, 1.2), 0.0, 0.6);
      add(y, env(bp(noise(sec(0.5), r), 3000, 1.5), 0.01, 0.12), 0.03, 0.25); return peakTo(y, 0.7); } },
  steps:     { name: 'шаги', make: r => { const y = new Float32Array(sec(3.2)); for (let k = 0; k < 6; k++) { const t = 0.1 + k * 0.52 + (r() - 0.5) * 0.04; add(y, env(lp(noise(sec(0.12), r), 700 + r() * 400), 0.003, 0.03), t, 0.8); add(y, thump(r, 80 + r() * 30, 0.05), t, 0.45); } return peakTo(y, 0.4); } },
  steps_run: { name: 'бег', make: r => { const y = new Float32Array(sec(2.6)); for (let k = 0; k < 9; k++) { const t = 0.05 + k * 0.27 + (r() - 0.5) * 0.03; add(y, env(lp(noise(sec(0.1), r), 900 + r() * 500), 0.002, 0.025), t, 0.9); add(y, thump(r, 90 + r() * 30, 0.05), t, 0.5); } return peakTo(y, 0.45); } },
  crash:     { name: 'грохот', make: r => { const n = sec(1.8), y = new Float32Array(n); add(y, thump(r, 55, 0.5), 0, 1.2); add(y, env(lp(noise(sec(1.2), r), 1800), 0.005, 0.25), 0, 0.9);
      for (let k = 0; k < 7; k++) add(y, env(bp(noise(sec(0.25), r), 1500 + r() * 3000, 3), 0.002, 0.05), 0.05 + r() * 0.7, 0.35); return peakTo(y, 0.75); } },
  drip:      { name: 'капает кран', make: r => { const y = new Float32Array(sec(4)); for (let k = 0; k < 5; k++) { const t = 0.2 + k * 0.75 + (r() - 0.5) * 0.2, d = env(tone(sec(0.12), tt => 1600 * (1 + 0.8 * Math.exp(-tt * 12))), 0.001, 0.03); add(y, d, t, 0.6); } return peakTo(y, 0.35); } },
  bell:      { name: 'школьный звонок', make: r => { const n = sec(2.2), y = tone(n, 1150, r, 0.002); for (let i = 0; i < n; i++) y[i] = (y[i] > 0 ? 1 : -1) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 22 * i / SR)); env(y, 0.01, 0.9); return peakTo(lp(y, 4000), 0.4); } },
  phone:     { name: 'телефон звонит', make: r => { const y = new Float32Array(sec(4.2)); for (const t of [0.1, 2.3]) { const ring = tone(sec(1.0), 425); for (let i = 0; i < ring.length; i++) ring[i] *= 0.6 + 0.4 * Math.sin(2 * Math.PI * 25 * i / SR); add(y, env(ring, 0.01, 1.5), t, 1); } return peakTo(y, 0.35); } },
  crowd:     { name: 'гул зала', make: r => { const n = sec(6), y = lp(noise(n, r), 600, 0.5); const m = lp(noise(n, r), 3); let mx = 0; for (const v of m) mx = Math.max(mx, Math.abs(v)); for (let i = 0; i < n; i++) y[i] *= 0.6 + 0.4 * m[i] / (mx || 1);
      for (let k = 0; k < 40; k++) { const t = r() * 5.5, v = env(bp(noise(sec(0.3), r), 300 + r() * 900, 4), 0.03, 0.08); add(y, v, t, 0.5); } env(y, 0.4, 5, 0); return peakTo(y, 0.3); } },
  applause:  { name: 'аплодисменты', make: r => { const n = sec(4.5), y = new Float32Array(n); for (let k = 0; k < 220; k++) { const t = Math.pow(r(), 0.7) * 4.2, c = env(bp(noise(sec(0.03), r), 1500 + r() * 2500, 2), 0.001, 0.008); add(y, c, t, 0.5 + r() * 0.5); } env(y, 0.3, 2.5, 0); return peakTo(y, 0.45); } },
  switch:    { name: 'щелчок выключателя', make: r => { const y = new Float32Array(sec(0.25)); add(y, click(r, 1.5), 0.01, 1); add(y, click(r, 0.8), 0.06, 0.6); add(y, thump(r, 400, 0.02), 0.01, 0.3); return peakTo(y, 0.5); } },
  curtain:   { name: 'занавес', make: r => { const n = sec(2.5), y = bp(noise(n, r), 2200, 0.8); for (let i = 0; i < n; i++) { const t = i / n; y[i] *= Math.sin(Math.PI * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 6 * t * 2.5)); } return peakTo(y, 0.3); } },
  wind:      { name: 'ветер', make: r => { const n = sec(7), y = bp(noise(n, r), 500, 0.6); const m = lp(noise(n, r), 0.4); let mx = 0; for (const v of m) mx = Math.max(mx, Math.abs(v)); for (let i = 0; i < n; i++) y[i] *= 0.4 + 0.6 * (0.5 + 0.5 * m[i] / (mx || 1)); env(y, 0.6, 6, 0); return peakTo(y, 0.35); } },
  rain:      { name: 'дождь', make: r => { const n = sec(7), y = hp(noise(n, r), 2500); for (let k = 0; k < 300; k++) add(y, env(hp(noise(sec(0.01), r), 4000), 0.0005, 0.003), r() * 6.9, 1.5); env(y, 0.5, 6, 0); return peakTo(y, 0.3); } },
  thunder:   { name: 'гром', make: r => { const n = sec(4), y = lp(noise(n, r), 120, 0.6); for (let i = 0; i < n; i++) { const t = i / SR; y[i] *= Math.exp(-t * 1.2) * (1 + 0.6 * Math.sin(t * 17)); } add(y, env(lp(noise(sec(0.5), r), 400), 0.02, 0.15), 0.15, 0.8); return peakTo(y, 0.6); } },
  clock:     { name: 'часы тикают', make: r => { const y = new Float32Array(sec(6)); for (let k = 0; k < 6; k++) { add(y, click(r, 0.9), 0.1 + k, 1); add(y, thump(r, 900, 0.01), 0.1 + k, 0.25); } return peakTo(y, 0.3); } },
  whistle:   { name: 'свист', make: r => { const y = env(tone(sec(0.7), t => 1800 + 900 * Math.sin(Math.PI * t)), 0.03, 0.4); return peakTo(y, 0.3); } },
  keys:      { name: 'ключи', make: r => { const y = new Float32Array(sec(1.2)); for (let k = 0; k < 9; k++) add(y, env(tone(sec(0.15), 3500 + r() * 4000), 0.001, 0.02), r() * 1.0, 0.5); return peakTo(y, 0.3); } },
  creak:     { name: 'скрип', make: r => { const y = tone(sec(0.55), t => 2600 + 700 * Math.sin(t * 25), r, 0.05); for (let i = 0; i < y.length; i++) y[i] = Math.sign(y[i]) * Math.pow(Math.abs(y[i]), 0.5); env(y, 0.03, 0.2); return peakTo(bp(y, 2800, 1.5), 0.25); } },
  room:      { name: 'тишина помещения', make: r => { const n = sec(12), y = lp(noise(n, r), 1200, 0.5); const m = lp(noise(n, r), 0.3); let mx = 0; for (const v of m) mx = Math.max(mx, Math.abs(v)); for (let i = 0; i < n; i++) y[i] *= 0.8 + 0.2 * m[i] / (mx || 1); add(y, lp(noise(n, r), 120, 0.7), 0, 0.6); return peakTo(y, 0.2); } },
  cough:     { name: 'кашель', make: r => { const y = new Float32Array(sec(0.9)); [0, 0.28].forEach((t, k) => add(y, env(bp(noise(sec(0.25), r), 700 + k * 200, 0.8), 0.01, 0.06), t, 1)); return peakTo(y, 0.4); } },
};
export const SFX_KEYS = Object.keys(SYNTH);
export const sfxName = k => SYNTH[k] ? SYNTH[k].name : k;
const cache = new Map();
/** Встроенный звук по ключу, 48 кГц, всегда одинаковый (сид фиксирован). */
export function synthSound(key) {
  if (!SYNTH[key]) return null;
  if (!cache.has(key)) cache.set(key, SYNTH[key].make(rng(key.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7))));
  return cache.get(key);
}

// ------------------------------------------------------------------ какие ремарки звучат
// [шаблон, ключ встроенного звука, уверенно ли (сразу в дорожку) ]
const RULES = [
  [/\bХЛОП\b|хлопает дверь|дверь хлоп|захлоп|дверь закрыва/i, 'door_slam', true],
  [/дверь распах|дверь открыва|дверь (класса )?открыт|открывает дверь|распахивает/i, 'door_open', true],
  [/стучит|стук\b|стуки|\bтук\b/i, 'knock', true],
  [/скрип мела/i, 'creak', true], [/скрип/i, 'creak', true],
  [/грохот|с грохотом|разбива|обруш/i, 'crash', true],
  [/\bпадает\b|упал\b|упала\b|роняет/i, 'crash', false],
  [/капает|кран\b/i, 'drip', true],
  [/аплодис|хлопают|овац/i, 'applause', true],
  [/телефон звон|звонит телефон|телефон зазвон/i, 'phone', true],
  [/звонок\b|звенит|зазвен/i, 'bell', true],
  [/гул зала|шум зала|зал гудит|зал шумит|толпа|гомон/i, 'crowd', true],
  [/(свет|прожектор|лампа|фонар|люстра|половина|мигает)[^.]{0,40}гаснет|гаснет[^.]{0,20}(свет|прожектор)|выключает свет|включает свет|щелч|выключател/i, 'switch', true],
  [/занавес открыва|занавес закрыва|занавес поднима|занавес опуска|занавес раздвига/i, 'curtain', true],
  [/ветер/i, 'wind', true], [/дожд/i, 'rain', true], [/гром\b|гремит/i, 'thunder', true],
  [/часы тикают|тикает|тиканье/i, 'clock', true], [/свист(ит|ок|\b)/i, 'whistle', true], [/ключ|замок/i, 'keys', false],
  [/кашля/i, 'cough', true],
  [/бежит|бегут|подбегает|отбегают|вылетает|убегает|топот/i, 'steps_run', false],
  [/шаг(и|ает|ом)?\b|входят|входит|выходит|уходит|идёт к|идет к|идёт боком|подходит/i, 'steps', false],
];
/**
 * Ремарки, похожие на звук: {id, text, key, strong}. strong — по умолчанию в дорожке;
 * остальные предлагаются, но выключены (мимика, движение без звука).
 */
export function soundCues(cues) {
  const out = [];
  for (const c of cues) {
    if (c.type !== 'dir') continue;
    const t = c.text.toLowerCase();
    if (/^\(?(долгая )?пауза\)?\.?$/.test(t.trim())) continue;
    for (const [re, key, strong] of RULES) if (re.test(c.text)) { out.push({ id: c.id, text: c.text, key, strong }); break; }
  }
  return out;
}
/** Подбор файла из библиотеки по имени: сначала к названию найденного звука («дверь открывается»), потом — строго к тексту ремарки. */
export function matchLibrary(text, names, key = null, min = 0.5) {
  const nw = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  const t = nw(text), kn = key && SYNTH[key] ? nw(SYNTH[key].name) : '';
  const stemOf = w => w.slice(0, Math.max(3, Math.min(5, w.length - 1)));
  const words = s => s.split(/\s+/).filter(w => w.length >= 3);
  const hits = (ws, target) => ws.length ? ws.filter(w => target.includes(stemOf(w))).length / ws.length : 0;
  const kw = words(kn); let best = null, bs = min;
  for (const name of names) {
    const stem = nw(name.replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ')), sw = words(stem);
    if (!sw.length) continue;
    const hk = hits(sw, kn), hs = hits(kw, stem), dk = kn ? dice(norm(stem), norm(kn)) : 0;   // одна из сторон покрыта целиком — иначе «дверь хлопает» ≠ «дверь открывается»
    const byKey = Math.max(hk === 1 || hs === 1 ? (hk + hs) / 2 : 0, dk >= 0.75 ? dk : 0);
    const dt = dice(norm(stem), norm(t)), byText = hits(sw, t) === 1 && sw.length >= 2 ? 0.8 : dt >= 0.8 ? dt : 0;
    const s = Math.max(byKey, byText);
    if (s > bs) { bs = s; best = name; }
  }
  return best;
}
