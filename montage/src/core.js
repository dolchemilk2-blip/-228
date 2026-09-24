// Монтажка — ядро: разбор сценария, сопоставление записей с репликами, громкость, сведение.
// Без DOM и без браузерных API: этот файл проверяется в Node теми же тестами, что и в браузере.

export const SR = 48000;          // частота сведения
export const ASR_SR = 16000;      // частота для нарезки и распознавания

// ------------------------------------------------------------------ текст
const HALLU = /продолжение следует|субтитр|dimatorzok|спасибо за просмотр|редактор субтитров|подписывайтесь|ставьте лайк/i;
export const QUIET_RE = /шёпот|шепот|тихо/i;
export const LOUD_RE = /громк|крич|орёт|орет|вопит/i;
export const NONVERBAL_RE = /^[\s—–-]*[\[(][^\])]*[\])][\s.,…!?]*$/;

const ONES = ['ноль','один','два','три','четыре','пять','шесть','семь','восемь','девять','десять',
  'одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать',
  'восемнадцать','девятнадцать'];
const TENS = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
const HUND = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
function numWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return HUND[Math.floor(n / 100)] + (n % 100 ? ' ' + numWords(n % 100) : '');
  return String(n);
}

/** Текст для сравнения: только буквы и цифры, без ремарок в скобках, ё→е, цифры словами. */
export function norm(s) {
  s = String(s).toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/ё/g, 'е');
  s = s.replace(/\d{1,3}/g, d => ' ' + numWords(+d) + ' ');
  s = s.replace(/[^a-zа-я0-9]+/g, '');
  return s.replace(/(.)\1{2,}/g, '$1');           // «бляааааа» → «бля»: зацикливание распознавания
}
export function cleanAsr(t) { return HALLU.test(t) ? '' : t; }
/** Распознавание зациклилось: одна буква или слог тянутся десятки раз («бляаааааааа…»). */
export const isLooped = t => /(.)\1{9,}|(..)\2{7,}|(\S+\s+)\3{5,}/.test(String(t));
/** Распознанное — не речь: одно-два слова, повторённые много раз («смещая смещая смещая»), или «ха-ха». */
export function isNoiseText(t) {
  const s = String(t).toLowerCase(), w = s.split(/[^a-zа-яё]+/).filter(Boolean);
  if (/(?:ха|хи|хе|ah|ha){2,}/i.test(s.replace(/[\s-]/g, ''))) return true;
  if (w.length && w.length <= 3 && w.every(x => /^(смеют|смеёт|смеет|смех|вздох|вздых|кашл|плач|всхлип|laugh|sigh|cough)/.test(x))) return true;
  return w.length >= 5 && w.length / new Set(w).size >= 3;       // «смещая смещая смещая смещая…»
}
/** Реплика или ремарка — только звук без слов: «[смех]», «— (вздох)», «(кашляет)». «(пауза)» — не звук. */
const SOUND_RE = /сме[хяеёю]|хохо|хих|вздох|вздых|кашл|плач|всхлип|стон|крик|визг|хрип|рыда|шмыг|зева|чиха|хмык|laugh|sigh|cough/i;
export const isSoundOnly = text => NONVERBAL_RE.test(text) && SOUND_RE.test(text);

export function bigrams(s) {
  const m = new Map();
  if (s.length < 2) { if (s) m.set(s, 1); m.total = s ? 1 : 0; return m; }
  for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
  m.total = s.length - 1;
  return m;
}
export function diceMaps(A, B) {
  if (!A.total || !B.total) return 0;
  let inter = 0; const [s, l] = A.size < B.size ? [A, B] : [B, A];
  for (const [g, c] of s) { const d = l.get(g); if (d) inter += Math.min(c, d); }
  return 2 * inter / (A.total + B.total);
}
export const dice = (a, b) => diceMaps(bigrams(a), bigrams(b));

export function isShout(text) {
  const letters = [...String(text).replace(/\([^)]*\)/g, '')].filter(c => /\p{L}/u.test(c));
  return letters.length >= 4 && letters.filter(c => c !== c.toLowerCase()).length >= 0.6 * letters.length;
}
export function estDuration(text) {
  let t = text.replace(/\([^)]*\)/g, ' ').replace(/[—\-«»"…]/g, ' ').replace(/\s+/g, ' ').trim();
  return Math.max(0.6, 0.4 + t.length / 13 + 0.7 * (text.split('(пауза)').length - 1));
}

// ------------------------------------------------------------------ сценарий
const SCENE_RE = /^(сцена|scene|картина|действие|эпизод|часть)\s+([0-9]+|[IVXLC]+)\b/i;
const NAME_RE = /^([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9\- ]{0,31}?)\s*(?:\(([^)]*)\))?\s*(:?)\s*$/;
const INLINE_RE = /^([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9\- ]{0,31}?)\s*(?:\(([^)]*)\))?\s*:\s+(\S.*)$/;
export const nameKey = s => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const nWords = s => s.trim().split(/\s+/).length;

/**
 * Сценарий → элементы по порядку: сцены, реплики, ремарки.
 * Реплика: строка «Имя:» (или «Имя (ремарка):»), под ней текст до пустой строки; либо «Имя: текст».
 * Персонажем считается имя, которое хоть раз стоит отдельной строкой с двоеточием; дальше
 * узнаётся и без двоеточия. Номера реплик 000… и ремарок d<индекс> — как у build.py.
 */
export function parseScript(text) {
  const raw = String(text).replace(/\r/g, '').split('\n');
  const seen = new Map(), inlineSeen = new Map(), forms = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i].trim(), next = (raw[i + 1] || '').trim();
    let m = s.match(NAME_RE);
    if (m && m[3] === ':' && next && nWords(m[1]) <= 4) {
      const k = nameKey(m[1]); bump(seen, k);
      if (!forms.has(k)) forms.set(k, new Map()); bump(forms.get(k), m[1].trim());
      continue;
    }
    m = s.match(INLINE_RE);
    if (m && nWords(m[1]) <= 3) {
      const k = nameKey(m[1]); bump(inlineSeen, k);
      if (!forms.has(k)) forms.set(k, new Map()); bump(forms.get(k), m[1].trim());
    }
  }
  const speakers = new Set(seen.keys());
  for (const [k, c] of inlineSeen) if (c >= 2) speakers.add(k);

  const cues = [];
  let i = 0;
  while (i < raw.length) {
    const s = raw[i].trim();
    if (!s) { i++; continue; }
    const sc = s.match(SCENE_RE);
    if (sc) { cues.push({ type: 'scene', n: sc[2], text: s }); i++; continue; }
    let m = s.match(NAME_RE);
    if (m && speakers.has(nameKey(m[1])) && nWords(m[1]) <= 4) {
      let j = i + 1; const content = [];
      while (j < raw.length && raw[j].trim()) { content.push(raw[j].trim()); j++; }
      if (content.length) cues.push({ type: 'line', spk: nameKey(m[1]), note: m[2] || '', text: content.join(' ') });
      i = j; continue;
    }
    m = s.match(INLINE_RE);
    if (m && speakers.has(nameKey(m[1]))) {
      let j = i + 1; const content = [m[3]];
      while (j < raw.length && raw[j].trim() && !raw[j].trim().match(NAME_RE)) { content.push(raw[j].trim()); j++; }
      cues.push({ type: 'line', spk: nameKey(m[1]), note: m[2] || '', text: content.join(' ') });
      i = j; continue;
    }
    cues.push({ type: 'dir', text: s }); i++;
  }
  let k = 0;
  cues.forEach((c, ci) => {
    c.ci = ci;
    if (c.type === 'line') c.id = String(k++).padStart(3, '0');
    else if (c.type === 'dir') c.id = 'd' + ci;
  });
  const chars = new Map();
  for (const c of cues) if (c.type === 'line') {
    if (!chars.has(c.spk)) {
      const f = forms.get(c.spk);
      const name = f ? [...f.entries()].sort((a, b) => b[1] - a[1] || +(a[0] === a[0].toUpperCase()) - +(b[0] === b[0].toUpperCase()))[0][0] : c.spk;
      chars.set(c.spk, { key: c.spk, name: name[0].toUpperCase() + name.slice(1), count: 0 });
    }
    chars.get(c.spk).count++;
  }
  return { cues, chars: [...chars.values()], nScenes: cues.filter(c => c.type === 'scene').length };
}

// ------------------------------------------------------------------ звук: огибающая и нарезка
function envelopeDb(y, sr, win = 0.02, hop = 0.01) {
  const w = Math.round(win * sr), h = Math.round(hop * sr);
  const n = Math.max(0, 1 + Math.floor((y.length - w) / h));
  const cs = new Float64Array(y.length + 1);
  for (let i = 0; i < y.length; i++) cs[i + 1] = cs[i] + y[i] * y[i];
  const env = new Float32Array(n);
  for (let k = 0; k < n; k++) env[k] = 10 * Math.log10((cs[k * h + w] - cs[k * h]) / w + 1e-14);
  return env;
}
function percentile(arr, p) {
  if (!arr.length) return -140;
  const a = Float32Array.from(arr).sort();
  const x = (a.length - 1) * p / 100, lo = Math.floor(x), hi = Math.ceil(x);
  return a[lo] + (a[hi] - a[lo]) * (x - lo);
}

/** Куски речи (секунды). Порог — от уровня речи и фона самого файла; паузы короче gap склеиваются. */
export function segmentSpeech(y16, { gap = 0.35, minLen = 0.12, pre = 0.05, post = 0.15, thrShift = 0, from = 0, to = null } = {}) {
  const env = envelopeDb(y16, ASR_SR);
  const ls = percentile(env, 95), ln = Math.max(percentile(env, 10), -90);
  const thr = Math.max(ln + 10, ls - 35) + thrShift;
  const k0 = Math.floor(from / 0.01), k1 = to == null ? env.length : Math.min(env.length, Math.ceil(to / 0.01));
  const raw = [];
  for (let k = k0; k < k1; k++) {
    if (env[k] <= thr) continue;
    let j = k; while (j < k1 && env[j] > thr) j++;
    raw.push([k, j]); k = j;
  }
  const merged = [];
  for (const [a, b] of raw) {
    if (merged.length && (a - merged[merged.length - 1][1]) * 0.01 < gap) merged[merged.length - 1][1] = b;
    else merged.push([a, b]);
  }
  const dur = y16.length / ASR_SR, lo = from, hi = to == null ? dur : to;
  const out = [];
  for (const [a, b] of merged) {
    if ((b - a) * 0.01 < minLen) continue;
    out.push({ a: Math.max(lo, a * 0.01 - pre), b: Math.min(hi, b * 0.01 + 0.02 + post) });
  }
  for (let q = 1; q < out.length; q++) if (out[q].a < out[q - 1].b) {
    const mid = (out[q].a + out[q - 1].b) / 2; out[q - 1].b = mid; out[q].a = mid;
  }
  return { segs: out.map(s => ({ a: +s.a.toFixed(3), b: +s.b.toFixed(3) })), thr };
}

/** 48 кГц → 16 кГц: фильтр нижних частот (sinc с окном Блэкмана) и каждый третий отсчёт. */
export function to16k(y48) {
  const taps = 63, M = taps >> 1, fc = 7200 / SR;
  const h = new Float32Array(taps); let sum = 0;
  for (let i = 0; i < taps; i++) {
    const n = i - M, x = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (taps - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (taps - 1));
    h[i] = x * w; sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  const n = Math.floor(y48.length / 3), out = new Float32Array(n);
  for (let o = 0; o < n; o++) {
    const c = o * 3; let acc = 0;
    for (let i = 0; i < taps; i++) { const k = c + i - M; if (k >= 0 && k < y48.length) acc += h[i] * y48[k]; }
    out[o] = acc;
  }
  return out;
}

// ------------------------------------------------------------------ сопоставление
/**
 * Монотонное сопоставление: элементы сценария (реплики и ремарки по порядку) ↔ куски записи
 * (по порядку). Реплику может закрыть серия до R кусков; любую реплику и любой кусок можно
 * пропустить. Очко за совпадение — похожесть минус порог; при равенстве берётся более поздний
 * дубль. items: [{key, t (norm), tau}], segs: [{t (norm)}]. Ответ: key → {j, r, sim}.
 */
export function alignSequence(items, segs, { R = 6, junk = 0.01, Q = 1 } = {}) {
  const n = items.length, m = segs.length, NEG = -1e18;
  const W = m + 1;
  const best = new Float64Array((n + 1) * W).fill(NEG);
  const back = new Int32Array((n + 1) * W).fill(-1);    // код перехода
  const backR = new Int8Array((n + 1) * W);
  const backS = new Float32Array((n + 1) * W);
  const backE = new Int32Array((n + 1) * W);            // начало группы реплик (для кода 4)
  const itemMaps = items.map(it => bigrams(it.t));
  // группы: реплика i и следующие за ней реплики (ремарки между ними пропускаются) —
  // когда актёр прочёл несколько реплик подряд без паузы и они попали в один кусок
  const groups = items.map((it, i) => {
    if (it.dir || !it.t) return [];
    const out = []; let txt = it.t, cnt = 1;
    for (let e = i + 1; e < n && cnt < Q; e++) {
      if (items[e].dir) continue;
      if (!items[e].t) break;
      txt += items[e].t; cnt++;
      out.push({ e: e + 1, q: cnt, t: txt, m: bigrams(txt) });
    }
    return out;
  });
  const runCache = new Map();
  const runMap = (j, r) => {
    const key = j * 8 + r;
    let v = runCache.get(key);
    if (!v) { let s = ''; for (let q = j; q < j + r; q++) s += segs[q].t; v = { s, m: bigrams(s) }; runCache.set(key, v); }
    return v;
  };
  best[0] = 0;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    const v = best[i * W + j]; if (v === NEG) continue;
    if (i < n && v > best[(i + 1) * W + j]) { best[(i + 1) * W + j] = v; back[(i + 1) * W + j] = 1; }
    if (j < m && v - junk > best[i * W + j + 1]) { best[i * W + j + 1] = v - junk; back[i * W + j + 1] = 2; }
    if (i < n && items[i].t && j < m && segs[j].t) {     // с пустого куска совпадение не начинается
      const lt = items[i].t, tau = items[i].tau;
      for (let r = 1; r <= R && j + r <= m; r++) {
        if (r > 1 && !segs[j + r - 1].t) continue;       // пустой кусок в хвост серии не пришиваем
        const run = runMap(j, r);
        if (run.s.length > 2.2 * lt.length + 10) break;
        const s = diceMaps(run.m, itemMaps[i]);
        if (s < tau) continue;
        const sc = v + (s - tau) + 1e-5 * j - 0.002 * (r - 1);   // при равенстве — дубль позже, серия короче
        const idx = (i + 1) * W + j + r;
        if (sc > best[idx]) { best[idx] = sc; back[idx] = 3; backR[idx] = r; backS[idx] = s; }
      }
      for (const g of groups[i]) {
        for (let r = 1; r <= R && j + r <= m; r++) {
          const run = runMap(j, r);
          if (run.s.length > 2.2 * g.t.length + 10) break;
          const s = diceMaps(run.m, g.m);
          if (s < tau) continue;
          const sc = v + g.q * (s - tau) - 0.05 * (g.q - 1) + 1e-5 * (j + r);
          const idx = g.e * W + j + r;
          if (sc > best[idx]) { best[idx] = sc; back[idx] = 4; backR[idx] = r; backS[idx] = s; backE[idx] = i; }
        }
      }
    }
  }
  let j = 0; for (let q = 1; q <= m; q++) if (best[n * W + q] > best[n * W + j]) j = q;
  let i = n; const res = new Map();
  while (i > 0 || j > 0) {
    const idx = i * W + j, st = back[idx];
    if (st === -1) break;
    if (st === 1) i -= 1;
    else if (st === 2) j -= 1;
    else if (st === 3) { const r = backR[idx]; res.set(items[i - 1].key, { j: j - r, r, sim: backS[idx] }); i -= 1; j -= r; }
    else {
      const r = backR[idx], i0 = backE[idx];
      const keys = items.slice(i0, i).filter(it => !it.dir).map(it => it.key);
      keys.forEach((k, part) => res.set(k, { j: j - r, r, sim: backS[idx], group: keys, part }));
      i = i0; j -= r;
    }
  }
  return res;
}

/**
 * Реплика не нашлась по тексту, а соседи нашлись: актёр читал по порядку, значит она между ними.
 * Свободные куски в промежутке раздаются пропущенным репликам по порядку (sim = -1: «проверить»).
 */
export function fillGaps(lines, segs, res, used) {
  const order = lines.map(l => l.key), text = new Map(lines.map(l => [l.key, l.t])), raw = new Map(lines.map(l => [l.key, l.raw || '']));
  const taken = new Set(used);
  for (const v of res.values()) for (let q = v.j; q < v.j + v.r; q++) taken.add(q);
  const exp = k => 0.4 + (raw.get(k) || text.get(k)).length / 13;
  const lastOf = v => v.j + v.r, firstOf = v => v.j;
  const dur = j => segs[j].b - segs[j].a;
  let k = 0;
  while (k < order.length) {
    if (res.has(order[k])) { k++; continue; }
    let e = k; while (e < order.length && !res.has(order[e])) e++;
    // свободные куски сразу после предыдущей найденной реплики и сразу перед следующей:
    // при чтении по порядку это один и тот же промежуток, при чтении вразнобой — два разных
    const miss = order.slice(k, e);
    const freeSet = new Set();
    if (k > 0) { let j = lastOf(res.get(order[k - 1])); while (j < segs.length && !taken.has(j)) { freeSet.add(j); j++; } }
    if (e < order.length) { let j = firstOf(res.get(order[e])) - 1; while (j >= 0 && !taken.has(j)) { freeSet.add(j); j--; } }
    let free = [...freeSet].sort((x, y) => x - y);
    const sound = new Map(lines.map(l => [l.key, !!l.sound]));
    free = free.filter(j => miss.some(mk => {
      const q = dur(j) / exp(mk);
      if (sound.get(mk)) return segs[j].noise || (q >= 0.3 && q <= 3);
      return !segs[j].noise && q >= 0.3 && q <= 3;
    }));
    if (free.length && miss.length) {
      if (free.length <= miss.length) {
        let pos = 0;
        free.forEach((j, fi) => {
          let bq = pos, bs = -1;
          for (let q = pos; q <= miss.length - (free.length - fi); q++) {
            const fitsKind = !!segs[j].noise === !!sound.get(miss[q]);
            const s = dice(segs[j].t, text.get(miss[q])) + (fitsKind ? 1 : 0); if (s > bs) { bs = s; bq = q; }
          }
          res.set(miss[bq], { j, r: 1, sim: -1 }); taken.add(j); pos = bq + 1;
        });
      } else {
        let pos = 0;
        miss.forEach((mk, q) => {
          const cand = free.slice(pos, free.length - (miss.length - q - 1));
          let bj = cand[0], bs = -1;
          for (const j of cand) { const s = dice(segs[j].t, text.get(mk)) + 1e-3 * dur(j) + (!!segs[j].noise === !!sound.get(mk) ? 1 : 0); if (s > bs) { bs = s; bj = j; } }
          res.set(mk, { j: bj, r: 1, sim: -1 }); taken.add(bj); pos = free.indexOf(bj) + 1;
        });
      }
    }
    k = e;
  }
  return res;
}

/**
 * Актёр прочёл несколько реплик подряд без паузы — они попали в один кусок, а нашлась по тексту
 * только одна. Пропущенная соседняя реплика присоединяется к найденной, если её слова заметно
 * поднимают похожесть распознанного текста (на 0,08 и больше). Кусок потом режется между ними.
 */
export function extendGroups(lines, segs, res, { gain = 0.08, maxQ = 3 } = {}) {
  const order = lines.map(l => l.key), text = new Map(lines.map(l => [l.key, l.t]));
  for (let k = 0; k < order.length; k++) {
    const v = res.get(order[k]);
    if (!v || v.group) continue;
    let run = ''; for (let q = v.j; q < v.j + v.r; q++) run += segs[q].t;
    const R = bigrams(run);
    // слова реплики есть в той части распознанного, которую уже взятые реплики не объясняют
    const fits = (curText, add) => {
      const rest = new Map(R), used = bigrams(curText);
      for (const [g, c] of used) if (rest.has(g)) rest.set(g, Math.max(0, rest.get(g) - c));
      const nb = bigrams(add); let hit = 0;
      for (const [g, c] of nb) hit += Math.min(c, rest.get(g) || 0);
      return nb.total >= 3 && hit / nb.total >= 0.6;
    };
    let group = [order[k]], cur = text.get(order[k]), sim = diceMaps(R, bigrams(cur));
    for (let e = k + 1; e < order.length && group.length < maxQ && !res.has(order[e]); e++) {
      const add = text.get(order[e]), cand = cur + add, s = diceMaps(R, bigrams(cand));
      if (s < sim + gain && !(fits(cur, add) && s >= sim - 0.02)) break;
      group.push(order[e]); cur = cand; sim = s;
    }
    for (let e = k - 1; e >= 0 && group.length < maxQ && !res.has(order[e]); e--) {
      const add = text.get(order[e]), cand = add + cur, s = diceMaps(R, bigrams(cand));
      if (s < sim + gain && !(fits(cur, add) && s >= sim - 0.02)) break;
      group.unshift(order[e]); cur = cand; sim = s;
    }
    if (group.length > 1) group.forEach((g, part) => res.set(g, { j: v.j, r: v.r, sim, group, part, moved: v.moved }));
  }
  return res;
}

/**
 * Реплики, которые не нашлись по порядку, ищутся по всему файлу среди неиспользованных кусков:
 * актёр мог читать сцены вразнобой, а в файле с правками дубли часто идут не по сценарию.
 * Берётся только уверенное совпадение текста и только не слишком короткая реплика — «нет.»
 * встречается в сценарии много раз, её так не угадать. Из равных кусков берётся более поздний дубль.
 */
export function rescueOutOfOrder(lines, segs, res, used, { tau = 0.55, minLen = 6, R = 4 } = {}) {
  const taken = new Set(used);
  for (const v of res.values()) for (let q = v.j; q < v.j + v.r; q++) taken.add(q);
  const cands = [];
  for (const l of lines) {
    if (res.has(l.key) || l.sound || l.t.length < minLen) continue;
    const L = bigrams(l.t);
    for (let j = 0; j < segs.length; j++) {
      if (taken.has(j) || !segs[j].t) continue;
      let txt = '';
      for (let r = 1; r <= R && j + r <= segs.length; r++) {
        const q = j + r - 1;
        if (taken.has(q)) break;
        if (!segs[q].t) continue;
        txt += segs[q].t;
        if (txt.length > 2.2 * l.t.length + 10) break;
        const sim = diceMaps(bigrams(txt), L);
        if (sim >= tau) cands.push({ key: l.key, j, r, sim });
      }
    }
  }
  cands.sort((a, b) => b.sim - a.sim || b.j - a.j);
  for (const c of cands) {
    if (res.has(c.key)) continue;
    let free = true;
    for (let q = c.j; q < c.j + c.r; q++) if (taken.has(q)) { free = false; break; }
    if (!free) continue;
    res.set(c.key, { j: c.j, r: c.r, sim: c.sim, moved: true });
    for (let q = c.j; q < c.j + c.r; q++) taken.add(q);
  }
  return res;
}

/** Промежутки между найденными соседями, где реплика пропущена и свободных кусков нет. */
export function emptyGaps(lines, segs, res, used) {
  const order = lines.map(l => l.key), taken = new Set(used);
  for (const v of res.values()) for (let q = v.j; q < v.j + v.r; q++) taken.add(q);
  const out = []; let k = 0;
  while (k < order.length) {
    if (res.has(order[k])) { k++; continue; }
    let e = k; while (e < order.length && !res.has(order[e])) e++;
    if (k > 0 && e < order.length) {
      const pv = res.get(order[k - 1]), nx = res.get(order[e]);
      const a = segs[pv.j + pv.r - 1].b, b = segs[nx.j].a;
      let free = false; for (let j = pv.j + pv.r; j < nx.j; j++) if (!taken.has(j)) free = true;
      if (!free && b - a > 0.3 && b - a < 30) out.push({ keys: order.slice(k, e), a, b });
    }
    k = e;
  }
  return out;
}

/**
 * Разбор одного файла: какие реплики и озвученные ремарки в нём есть.
 * lines — реплики персонажей этого файла, dirs — все ремарки; оба в порядке сценария с полем ci.
 * Возвращает key → {pieces:[{a,b}], sim, how: 'text'|'order'|'quiet'}.
 */
/**
 * Кусок [A, B] с q репликами подряд: границы ставятся пропорционально длине текста и
 * подтягиваются к самому тихому месту рядом (env — огибающая файла, дБ, шаг 10 мс).
 */
export function splitRun(A, B, lens, env, runText = '', lineTexts = null) {
  const tot = lens.reduce((s, v) => s + v, 0) || 1, cuts = [A];
  // доли по распознанному тексту: где кончается k-я реплика среди распознанных букв
  let shares = null;
  if (runText && lineTexts && runText.length >= 4) {
    shares = []; let from = 0;
    for (let k = 0; k < lineTexts.length - 1; k++) {
      const left = lineTexts.slice(0, k + 1).join(''), right = lineTexts.slice(k + 1).join('');
      let bi = from, bs = -1;
      for (let x = from + 1; x < runText.length; x++) {
        const s = dice(runText.slice(0, x), left) + dice(runText.slice(x), right);
        if (s > bs) { bs = s; bi = x; }
      }
      shares.push(bi / runText.length); from = bi;
    }
  }
  let acc = 0;
  for (let k = 0; k < lens.length - 1; k++) {
    acc += lens[k];
    const frac = shares ? shares[k] : acc / tot;
    const t = A + (B - A) * frac, w = Math.max(0.3, 0.35 * (B - A) * Math.min(lens[k], lens[k + 1]) / tot);
    let bt = t, bv = Infinity;
    if (env) for (let f = Math.max(Math.ceil((t - w) / 0.01), Math.ceil((cuts[cuts.length - 1] + 0.1) / 0.01)); f <= Math.floor((t + w) / 0.01) && f < env.length; f++)
      if (env[f] < bv) { bv = env[f]; bt = f * 0.01 + 0.01; }
    cuts.push(Math.min(B - 0.1, Math.max(cuts[cuts.length - 1] + 0.1, bt)));
  }
  cuts.push(B);
  return cuts;
}

export function matchFile(lines, dirs, segs, { quietSegs = null, env = null } = {}) {
  const seq = [...lines.map(l => ({ ...l, tau: 0.35 })), ...dirs.filter(d => d.t.length >= 4).map(d => ({ ...d, tau: 0.5, dir: true }))]
    .sort((x, y) => x.ci - y.ci);
  const raw = alignSequence(seq, segs);
  const isDir = new Set(dirs.map(d => d.key));
  const res = new Map(), dirRes = new Map(), used = new Set();
  for (const [k, v] of raw) {
    if (isDir.has(k)) { dirRes.set(k, v); for (let q = v.j; q < v.j + v.r; q++) used.add(q); }
    else res.set(k, v);
  }
  extendGroups(lines, segs, res);
  rescueOutOfOrder(lines, segs, res, used);         // не по порядку — по всему файлу, только уверенное
  extendGroups(lines, segs, res);
  // звуковые ремарки («[смех]») не находятся по тексту — они участвуют только в раздаче промежутков
  const soundDirs = dirs.filter(d => isSoundOnly(d.raw || '')).map(d => ({ ...d, sound: true }));
  const gapItems = [...lines, ...soundDirs].sort((x, y) => x.ci - y.ci);
  fillGaps(gapItems, segs, res, used);
  const out = new Map();
  const lineText = new Map(lines.map(l => [l.key, l.t]));
  const put = (k, v, how) => {
    let pieces = segs.slice(v.j, v.j + v.r).map(s => ({ a: s.a, b: s.b }));
    if (v.group) {                                   // несколько реплик в одном куске — режем
      const A = pieces[0].a, B = pieces[pieces.length - 1].b;
      let runText = ''; for (let q = v.j; q < v.j + v.r; q++) runText += segs[q].t;
      const cuts = splitRun(A, B, v.group.map(g => Math.max(2, (lineText.get(g) || '').length)), env,
                            runText, v.group.map(g => lineText.get(g) || ''));
      const lo = cuts[v.part], hi = cuts[v.part + 1];
      const cut = pieces.map(p => ({ a: Math.max(p.a, lo), b: Math.min(p.b, hi) })).filter(p => p.b - p.a > 0.05);
      pieces = cut.length ? cut : [{ a: lo, b: Math.max(hi, lo + 0.1) }];
    }
    out.set(k, { pieces, sim: v.sim, how, group: v.group ? v.group.length : 1, text: segs.slice(v.j, v.j + v.r).map(s => s.text || '').join(' ').trim() });
  };
  for (const [k, v] of res) put(k, v, v.sim < 0 ? 'order' : v.moved ? 'moved' : 'text');
  const expOf = new Map(lines.map(l => [l.key, 0.4 + (l.raw || l.t).length / 13]));
  for (const [k, v] of dirRes) put(k, v, 'text');
  if (quietSegs) {                                   // тихие звуки в пустых промежутках (вздохи и т. п.)
    for (const g of emptyGaps(lines, segs, res, used)) {
      const q = quietSegs(g.a, g.b).filter(s => s.b - s.a >= 0.15);
      g.keys.slice(0, q.length).forEach((k, n) => {
        const ratio = (q[n].b - q[n].a) / (expOf.get(k) || 1);
        if (ratio >= 0.3 && ratio <= 3) out.set(k, { pieces: [q[n]], sim: -1, how: 'quiet', text: '' });
      });
    }
  }
  return out;
}

/** Результаты нескольких файлов: найденное по тексту важнее найденного по порядку; при равенстве — файл ниже в списке. */
export function mergeMatches(perFile) {
  const rank = h => (h === 'text' || h === 'moved' ? 2 : 1);
  const out = new Map();
  perFile.forEach((m, fi) => {
    for (const [k, v] of m) {
      const cur = out.get(k);
      if (!cur || rank(v.how) > rank(cur.how) || (rank(v.how) === rank(cur.how) && fi >= cur.file))
        out.set(k, { ...v, file: fi });
    }
  });
  return out;
}

// ------------------------------------------------------------------ текст окна → куски
/**
 * Режим «Черновик»: несколько кусков распознаются одним окном с тишиной между ними, а
 * распознаватель возвращает свои фразы, которые с кусками не совпадают. Слова фразы
 * раскладываются по её интервалу пропорционально длине, но только по времени, где звучит речь:
 * вставленная тишина из счёта исключена — мы точно знаем, где она.
 * win: {parts:[{off, d}], len}, chunks: [{timestamp:[a,b], text}] → текст каждого куска.
 */
export function unpackWindow(win, chunks) {
  const texts = win.parts.map(() => []);
  for (const ch of chunks) {
    const a = Math.max(0, ch.timestamp?.[0] ?? 0), b = Math.min(win.len + 0.2, ch.timestamp?.[1] ?? win.len);
    const spans = [];
    win.parts.forEach((p, i) => { const s0 = Math.max(a, p.off), s1 = Math.min(b, p.off + p.d); if (s1 - s0 > 0.02) spans.push({ i, d: s1 - s0 }); });
    const words = String(ch.text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    if (!spans.length) {                               // фраза целиком в тишине — к ближайшему куску
      const mid = (a + b) / 2; let bi = 0, bd = 1e9;
      win.parts.forEach((p, i) => { const d = Math.abs(p.off + p.d / 2 - mid); if (d < bd) { bd = d; bi = i; } });
      texts[bi].push(words.join(' ')); continue;
    }
    const T = spans.reduce((q, x) => q + x.d, 0), chars = words.reduce((q, w) => q + w.length + 1, 0);
    let pos = 0;
    for (const w of words) {
      const t = (pos + (w.length + 1) / 2) / chars * T;
      let acc = 0, k = 0;
      while (k < spans.length - 1 && acc + spans[k].d < t) { acc += spans[k].d; k++; }
      texts[spans[k].i].push(w); pos += w.length + 1;
    }
  }
  return texts.map(t => t.join(' ').replace(/\s+/g, ' ').trim());
}
/** Зацикленный текст приводится в порядок: «бляааааааа» → «бляаа». */
export const tameLoop = t => String(t).replace(/(.)\1{3,}/g, '$1$1').replace(/((?:\S+\s+){1,2}?)\1{2,}/g, '$1');

// ------------------------------------------------------------------ громкость (ITU-R BS.1770)
const KB1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], KA1 = [1, -1.69065929318241, 0.73248077421585];
const KB2 = [1, -2, 1], KA2 = [1, -1.99004745483398, 0.99007225036621];
/** Оба звена K-фильтра и энергии подблоков за один проход, без временных массивов размером с сигнал. */
function gatedLoudness(x, block, hop) {
  const w = Math.round(block * SR), h = Math.round(hop * SR), n = x.length;
  const b10 = KB1[0], b11 = KB1[1], b12 = KB1[2], a11 = KA1[1], a12 = KA1[2], b20 = KB2[0], b21 = KB2[1], b22 = KB2[2], a21 = KA2[1], a22 = KA2[2];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0;
  const nSub = Math.floor(n / h), sub = new Float64Array(Math.max(1, nSub)); let acc = 0, cnt = 0, k = 0, all = 0;
  for (let i = 0; i < n; i++) {
    // +1e-18: в паузах из чистых нулей состояние фильтра иначе уходит в денормализованные числа, на которых процессор в сто раз медленнее
    const xi = x[i], y = b10 * xi + b11 * x1 + b12 * x2 - a11 * y1 - a12 * y2 + 1e-18; x2 = x1; x1 = xi; y2 = y1; y1 = y;
    const z = b20 * y + b21 * u1 + b22 * u2 - a21 * z1 - a22 * z2 + 1e-18; u2 = u1; u1 = y; z2 = z1; z1 = z;
    const e = z * z; all += e; acc += e;
    if (++cnt === h) { if (k < nSub) sub[k++] = acc; acc = 0; cnt = 0; }
  }
  if (n < w) return 10 * Math.log10(all / Math.max(1, n) + 1e-14) - 0.691;
  const m = Math.round(w / h), nb = nSub - m + 1, p = []; let run = 0;
  for (let j = 0; j < m; j++) run += sub[j];
  for (let q = 0; q < nb; q++) { if (q) run += sub[q + m - 1] - sub[q - 1]; const e = run / w; if (10 * Math.log10(e + 1e-14) - 0.691 > -70) p.push(e); }
  if (!p.length) return -70;
  const rel = 10 * Math.log10(p.reduce((s, v) => s + v, 0) / p.length) - 0.691 - 10;
  const g = p.filter(e => 10 * Math.log10(e) - 0.691 > rel);
  return 10 * Math.log10(g.reduce((s, v) => s + v, 0) / g.length) - 0.691;
}
/** Интегральная громкость, LUFS (окна 400 мс, как в стандарте). */
export const integratedLufs = x => gatedLoudness(x, 0.4, 0.1);
/** Громкость реплики на слух: то же, но окна 100 мс — реплики бывают короче секунды. */
export const lineLoudness = x => gatedLoudness(x, 0.1, 0.025);

export function fade(y, fin = 0.010, fout = 0.030) {
  const out = Float32Array.from(y);
  const n1 = Math.min(out.length, Math.round(fin * SR)), n2 = Math.min(out.length, Math.round(fout * SR));
  for (let i = 0; i < n1; i++) out[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / n1);
  for (let i = 0; i < n2; i++) out[out.length - n2 + i] *= 0.5 + 0.5 * Math.cos(Math.PI * i / n2);
  return out;
}
/** Обрезка тишины по краям у дозаписанной реплики (как trim_silence в build.py). */
export function trimSilence(y) {
  const w = Math.round(0.01 * SR), n = Math.floor(y.length / w);
  if (!n) return y;
  const e = new Float32Array(n); let mx = -1e9;
  for (let k = 0; k < n; k++) { let s = 0; for (let i = k * w; i < (k + 1) * w; i++) s += y[i] * y[i]; e[k] = 20 * Math.log10(Math.sqrt(s / w) + 1e-9); mx = Math.max(mx, e[k]); }
  const thr = Math.max(mx - 45, -60); let a = -1, b = -1;
  for (let k = 0; k < n; k++) if (e[k] > thr) { if (a < 0) a = k; b = k; }
  if (a < 0) return y;
  return y.subarray(Math.max(0, a * w - Math.round(0.06 * SR)), Math.min(y.length, (b + 1) * w + Math.round(0.12 * SR)));
}

/**
 * Выравнивание громкости — только громкость: у реплики одно постоянное усиление.
 * items: [{id, voice, text, note, audio(Float32Array)}] → проставляет level, fix, audio (с усилением).
 */
export function levelLines(items, { charLufs = -20, strength = 0.75, voiceMax = 6, maxUp = 6, maxDown = 8, manual = {} } = {}) {
  const byVoice = new Map();
  for (const it of items) { if (!byVoice.has(it.voice)) byVoice.set(it.voice, []); byVoice.get(it.voice).push(it); }
  for (const [, list] of byVoice) {                  // шаг 1: голос целиком к charLufs
    const total = list.reduce((s, it) => s + it.audio.length, 0), cat = new Float32Array(total);
    let o = 0; for (const it of list) { cat.set(it.audio, o); o += it.audio.length; }
    const L = integratedLufs(cat), g = isFinite(L) && L > -69 ? Math.pow(10, (charLufs - L) / 20) : 1;
    for (const it of list) it.audio = it.audio.map(v => v * g);
  }
  const verbal = it => !NONVERBAL_RE.test(it.text);
  for (const it of items) it.level = lineLoudness(it.audio);
  const med = new Map();
  for (const [v, list] of byVoice) {
    const lv = list.filter(verbal).map(it => it.level).sort((a, b) => a - b);
    if (lv.length) med.set(v, lv.length % 2 ? lv[lv.length >> 1] : (lv[lv.length / 2 - 1] + lv[lv.length / 2]) / 2);
  }
  const meds = [...med.values()].sort((a, b) => a - b);
  const common = meds.length ? (meds.length % 2 ? meds[meds.length >> 1] : (meds[meds.length / 2 - 1] + meds[meds.length / 2]) / 2) : charLufs;
  const voiceFix = new Map([...med].map(([v, m]) => [v, Math.max(-voiceMax, Math.min(voiceMax, common - m))]));
  for (const it of items) {
    let up = QUIET_RE.test(it.note || '') ? 2 : maxUp;
    let down = (LOUD_RE.test(it.note || '') || isShout(it.text)) ? 3 : maxDown;
    if (!verbal(it)) up = down = 3;
    const lf = Math.max(-down, Math.min(up, strength * ((med.get(it.voice) ?? common) - it.level)));
    it.fix = (voiceFix.get(it.voice) || 0) + lf + (manual[it.id] || 0);
    const g = Math.pow(10, it.fix / 20);
    it.audio = it.audio.map(v => v * g);
    it.levelAfter = it.level + it.fix;
  }
  return { med, common, voiceFix };
}

/**
 * Раскладка по времени и паузы — как в build.py: 0,35 с между репликами, 0,08 после оборванной,
 * «пауза» +0,7, «долгая пауза» +1,5, «тишина» +1,0, прочие ремарки +0,15 (до +1,2), сцены 2,6 с.
 * cues — весь сценарий; audioOf(cue) → Float32Array | null. Незаписанная реплика — пауза.
 */
export function layout(cues, audioOf, isVoiced, bedOf = null, { tempo = 1, timing = {} } = {}) {
  const placed = [], sheet = [], rows = [], scenes = [];
  let pend = { extra: 0, generic: 0, scene: null, sceneCue: null }, t = 0.6, prev = '', scene = '1', first = true;
  const tm = id => timing[id] || {};
  for (const c of cues) {
    if (c.type === 'scene') { pend.scene = c.n; pend.sceneCue = c; continue; }
    const bed = c.type === 'dir' && bedOf ? bedOf(c) : null;
    if (bed) {                                        // звук фоном: ложится с этого места, реплики не ждут
      const at = Math.max(0, t + (pend.scene != null ? (first ? 0 : 2.6 * tempo) : 0) + (tm(c.id).before || 0) + (tm(c.id).own || 0));
      placed.push({ at, audio: bed.audio, cue: c, bed: true });
      rows.push({ cue: c, scene: pend.scene != null ? pend.scene : scene, at, dur: bed.audio.length / SR, recorded: true, sound: bed.name, bed: true });
      continue;
    }
    if (c.type === 'dir' && !isVoiced(c)) {
      const tl = c.text.toLowerCase();
      if (tl.includes('долгая пауза')) pend.extra += 1.5;
      else if (tl.startsWith('пауза') || tl === '(пауза)') pend.extra += 0.7;
      else if (tl.startsWith('тишина')) pend.extra += 1.0;
      else pend.generic = Math.min(1.2, pend.generic + 0.15);
      continue;
    }
    let gap;
    if (pend.scene != null) { scene = pend.scene; gap = first ? 0 : 2.6 * tempo; scenes.push({ n: scene, start: t, cue: pend.sceneCue }); sheet.push({ scene, at: t + gap }); }
    else if (/перебива/i.test(c.note || '')) gap = -0.25;                       // «(перебивая)»: реплика наезжает на предыдущую
    else gap = ((/[—-]\s*$/.test(prev) ? 0.08 : 0.35) + (/\?\s*$/.test(prev) ? 0.15 : 0) + pend.generic + pend.extra) * tempo;
    pend = { extra: 0, generic: 0, scene: null, sceneCue: null }; first = false;
    gap += tm(c.id).before || 0;
    t = Math.max(0, t + gap);
    const own = tm(c.id).own || 0, at = Math.max(0, t + own);
    const y = audioOf(c);
    let dur;
    if (y && y.audio) {                                // {audio, name} — звук; {audio, core} — реплика с хвостом эффекта, следующая ждёт только core
      placed.push({ at, audio: y.audio, cue: c }); dur = y.core != null ? y.core : y.audio.length / SR;
      rows.push({ cue: c, scene, at, dur, gap, recorded: true, sound: y.name }); t += dur; prev = c.text; continue;
    }
    if (y) { placed.push({ at, audio: y, cue: c }); dur = y.length / SR; }
    else { dur = estDuration(c.text); sheet.push({ cue: c, at, dur }); }
    rows.push({ cue: c, scene, at, dur, gap, recorded: !!y });
    t += dur; prev = c.text;
  }
  const total = t + 1.5;
  scenes.forEach((sc, i) => { sc.end = i + 1 < scenes.length ? scenes[i + 1].start : total; });
  return { placed, sheet, rows, scenes, total };
}

/** Пиковый лимитер с заглядыванием вперёд (5 мс) и восстановлением 60 мс. */
/** Лимитер на отрезке [a, b): упреждение 5 мс, атака 1,5 мс, отпускание 60 мс; усиление в начале — 1. */
const LIM_Q = 512, LIM_M = LIM_Q - 1, LIM_I = new Int32Array(LIM_Q), LIM_V = new Float32Array(LIM_Q);
function limitSpan(x, y, a, b, ceil) {
  const la = Math.round(0.005 * SR), qi = LIM_I, qv = LIM_V;   // очередь-кольцо: скользящий минимум нужного усиления на окне [i, i+la]
  const aAtt = 1 - Math.exp(-1 / (0.0015 * SR)), aRel = 1 - Math.exp(-1 / (0.06 * SR));
  let h = 0, tl = 0, env = 1;
  for (let j = a, e = Math.min(a + la, b); j < e; j++) {
    const v = x[j] < 0 ? -x[j] : x[j], nj = v > ceil ? ceil / v : 1;
    while (tl > h && qv[(tl - 1) & LIM_M] >= nj) tl--;
    qi[tl & LIM_M] = j; qv[tl & LIM_M] = nj; tl++;
  }
  for (let i = a; i < b; i++) {
    const j = i + la;
    if (j < b) { const v = x[j] < 0 ? -x[j] : x[j], nj = v > ceil ? ceil / v : 1; while (tl > h && qv[(tl - 1) & LIM_M] >= nj) tl--; qi[tl & LIM_M] = j; qv[tl & LIM_M] = nj; tl++; }
    while (qi[h & LIM_M] < i) h++;
    const tg = qv[h & LIM_M];
    env += (tg - env) * (tg < env ? aAtt : aRel);
    let v = x[i] * env;
    if (v > ceil) v = ceil; else if (v < -ceil) v = -ceil;
    y[i] = v;
  }
}
/**
 * Лимитер. Работает только там, где есть превышение: от 5 мс до пика и 0,5 с после последнего (за это время
 * отпускание возвращает усиление к 1 с точностью 0,03 %), остальное копируется как есть — в разы быстрее.
 */
export function limit(x, ceil = 0.84, inPlace = false) {
  const n = x.length, la = Math.round(0.005 * SR), settle = Math.round(0.5 * SR), y = inPlace ? x : x.slice();
  let a = -1, last = -Infinity;
  for (let k = 0; k < n; k++) {
    const v = x[k]; if (v <= ceil && v >= -ceil) continue;
    if (a < 0) a = Math.max(0, k - la);
    else if (k - last > settle + la) { limitSpan(x, y, a, Math.min(n, last + settle), ceil); a = Math.max(0, k - la); }
    last = k;
  }
  if (a >= 0) limitSpan(x, y, a, Math.min(n, last + settle), ceil);
  return y;
}

/** Мастеринг: подъём реплик, упёршихся в лимитер, забирается назад; общий уровень; лимитер. */
export function master(mix, placed, { targetLufs = -18, ceil = 0.84 } = {}) {
  let L = integratedLufs(mix), g = Math.pow(10, (targetLufs - L) / 20), held = 0;
  for (const p of placed) {
    let pk = 0; for (const v of p.audio) pk = Math.max(pk, Math.abs(v));
    const over = 20 * Math.log10(pk * g / ceil + 1e-12);
    const fix = p.item ? p.item.fix : 0;
    if (over > 1 && fix > 0) {
      const back = Math.min(over - 1, fix), k = Math.pow(10, -back / 20), i0 = Math.round(p.at * SR), heldAudio = new Float32Array(p.audio.length);
      for (let i = 0; i < p.audio.length; i++) { mix[i0 + i] -= p.audio[i] * (1 - k); heldAudio[i] = p.audio[i] * k; }
      p.audio = heldAudio;                             // исходный массив реплики не трогается — сведение можно пересчитать
      p.item.fix -= back; p.item.levelAfter -= back; held++;
    }
  }
  if (held) { L = integratedLufs(mix); g = Math.pow(10, (targetLufs - L) / 20); }   // без придержанных реплик громкость не менялась
  let pk = 0; for (const v of mix) pk = Math.max(pk, Math.abs(v));
  for (let i = 0; i < mix.length; i++) mix[i] *= g;   // на месте: mix — временный массив сведения
  return { out: limit(mix, ceil, true), gainDb: 20 * Math.log10(g), peakBefore: 20 * Math.log10(pk * g + 1e-12), held };
}

// ------------------------------------------------------------------ файлы
export function wav24(x, sr = SR) {
  const n = x.length, buf = new ArrayBuffer(44 + n * 3), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 3, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 3, true); v.setUint16(32, 3, true); v.setUint16(34, 24, true); str(36, 'data'); v.setUint32(40, n * 3, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, x[i])); s = Math.round(s * 8388607);
    v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255); o += 3;
  }
  return buf;
}
export const ts = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;
