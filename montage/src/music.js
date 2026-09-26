// Монтажка — музыка: заставка до первой реплики, отбивки между сценами, финал и подложки под сцены.
// Треки — свои файлы или свободная музыка из Openverse (Jamendo и др., только CC0 и CC BY — их можно
// в любом выпуске, с CC BY — указав автора). Музыка стерео, поэтому с ней сведение тоже становится стерео.
// Под речью музыка приглушается сама (как фон сцен); длина заставки, отбивок и финала раздвигает спектакль.
// Использует S, $, esc, fmt, notify, progress, playing, stop, audioCtx, audioOut, saveEdits, remixSoon, download
// из app.js; ambScenes, duckCurve из amb.js; dbv из sounds.js; C — ядро.

const OV_API = 'https://api.openverse.org/v1/audio/';
const MUS_MAX = 240;                                  // секунд трека храним не больше: на подложку хватит петли, а память — не резиновая
const MUS_SLOTS = [
  ['intro', 'Заставка', 'в начале; голос вступает поверх, музыка уходит под него и затихает'],
  ['sting', 'Отбивки между сценами', 'короткая музыка в паузе между сценами — пауза растягивается под неё'],
  ['outro', 'Финал', 'после последней реплики, с затуханием в конце'],
];
// база ищет все слова сразу — у настроений по одному слову, с которым есть что выбрать
const MUS_MOODS = [
  ['спокойная', 'peaceful'], ['грустная', 'sad'], ['тревожная', 'dark'], ['таинственная', 'mystery'], ['страшная', 'horror'],
  ['сказочная', 'magic'], ['торжественная', 'epic'], ['приключения', 'adventure'], ['романтичная', 'romantic'], ['весёлая', 'happy'], ['детская', 'children'], ['как в кино', 'cinematic'],
];
const MUS_RU = { спокой: 'calm', тих: 'calm', нежн: 'gentle', грус: 'sad', печал: 'sad', тревож: 'suspense', напряж: 'tension', страш: 'horror', жут: 'dark',
  мрачн: 'dark', тайн: 'mystery', таин: 'mystery', загад: 'mystery', сказ: 'whimsical', волшеб: 'magic', торжеств: 'epic', эпич: 'epic', геро: 'heroic',
  весел: 'happy', весёл: 'happy', радост: 'happy', детск: 'children', романт: 'romantic', любов: 'love', приключ: 'adventure', ночь: 'night', ночн: 'night',
  пианино: 'piano', рояль: 'piano', гитар: 'guitar', скрипк: 'violin', оркестр: 'orchestral', эмбиент: 'ambient', электрон: 'electronic', джаз: 'jazz',
  классик: 'classical', рок: 'rock', космос: 'space', космич: 'space', дожд: 'rain', осен: 'autumn', зим: 'winter', утр: 'morning', финал: 'ending', заставк: 'intro' };
function musicState() {
  if (!S.music) S.music = { lib: [], intro: { id: null, on: false, len: 14, lead: 6, gain: -2 }, sting: { id: null, on: false, len: 5, gain: -3 }, outro: { id: null, on: false, len: 20, gain: -2 }, beds: {}, duck: 10 };
  const m = S.music; if (!m.lib) m.lib = []; if (!m.beds) m.beds = {};
  if (!m.ui) Object.defineProperty(m, 'ui', { value: { q: '', res: [], busy: false, shownQ: '', total: 0, restoring: false }, writable: true, enumerable: false });
  return m;
}
const musTrack = id => (S.music && id ? S.music.lib.find(t => t.id === id) : null) || null;
const musReady = id => { const t = musTrack(id); return !!(t && t.pcm); };
/** Есть ли в сведении музыка — тогда оно стерео. */
function musicOn() {
  const m = S.music; if (!m) return false;
  return MUS_SLOTS.some(([k]) => m[k] && m[k].on && musReady(m[k].id)) || Object.values(m.beds).some(b => b && b.on && musReady(b.id));
}
/** Что музыка добавляет к раскладке: вступление до первой реплики, паузы между сценами, хвост под финал. */
function musicLayout() {
  const m = S.music; if (!m) return {};
  const on = k => m[k] && m[k].on && musReady(m[k].id);
  return { lead: on('intro') ? Math.max(0, +m.intro.lead || 0) : 0, sceneGap: on('sting') ? (+m.sting.len || 5) + 0.6 : 0, tail: on('outro') ? Math.max(0, 0.6 + (+m.outro.len || 20) - 1.5) : 0 };
}
/** Для сохранения: настройки и откуда треки (свои — по имени файла, из базы — ссылкой, звук скачается сам). */
const musicSaved = () => { const m = musicState(); return { lib: m.lib.map(t => ({ id: t.id, name: t.name, src: t.src, meta: t.meta || null, dur: t.dur })), intro: m.intro, sting: m.sting, outro: m.outro, beds: m.beds, duck: m.duck }; };
function musicLoad(v) {
  // библиотека — не часть сценария: уже скачанные и загруженные треки остаются, даже если сценарий сменился
  const old = S.music ? S.music.lib : [], ui = S.music ? S.music.ui : null; S.music = null;
  const m = musicState(); if (ui) m.ui = ui;
  if (v && typeof v === 'object') {
    for (const k of ['intro', 'sting', 'outro']) if (v[k]) Object.assign(m[k], v[k]);
    m.beds = v.beds || {}; m.duck = v.duck ?? 10;
    m.lib = (v.lib || []).filter(t => t && t.id).map(t => { const o = old.find(x => x.id === t.id); return o || { id: t.id, name: t.name, src: t.src, meta: t.meta || null, dur: t.dur, pcm: null }; });
  }
  for (const o of old) if (o.pcm && !m.lib.some(t => t.id === o.id)) m.lib.push(o);
  if (!old.length && !m.lib.length && !(v && typeof v === 'object')) S.music = null;
}
/** Для сводки сведения: «заставка, 4 отбивки, финал, подложки в 2 сценах». */
function musicStat(clips) {
  const n = k => clips.filter(c => c.kind === k).length, out = [];
  if (n('intro')) out.push('заставка'); if (n('sting')) out.push(`${n('sting')} ${n('sting') === 1 ? 'отбивка' : n('sting') < 5 ? 'отбивки' : 'отбивок'}`); if (n('outro')) out.push('финал'); if (n('bed')) out.push(`подложки в ${n('bed')} сц.`);
  return out.join(', ');
}

// ------------------------------------------------------------------ звук треков
const i16 = a => { const s = new Int16Array(a.length); for (let i = 0; i < a.length; i++) { const v = a[i]; s[i] = v >= 1 ? 32767 : v <= -1 ? -32767 : Math.round(v * 32767); } return s; };
/** Декодировать в 48 кГц стерео (моно — в оба канала), не длиннее MUS_MAX; храним в 16 битах. */
async function musDecode(buf) {
  const ctx = new OfflineAudioContext(2, 1, C.SR), ab = await ctx.decodeAudioData(buf), n = Math.min(ab.length, MUS_MAX * C.SR);
  const L = ab.getChannelData(0).subarray(0, n), R = ab.numberOfChannels > 1 ? ab.getChannelData(1).subarray(0, n) : null;
  return { pcm: [i16(L), R ? i16(R) : null], dur: n / C.SR, full: ab.length / C.SR };
}
/** Громкость трека (LUFS, стерео) — один раз на трек. */
function musLufs(t) {
  if (t._lufs != null) return t._lufs;
  // куски через один буфер: измеритель помнит своё состояние между push, индексы ему не важны
  const [L, R] = t.pcm, RR = R || L, n = L.length, m = C.loudnessMeter2(n, 0.4, 0.1), CH = 1 << 16, a = new Float32Array(CH), b = new Float32Array(CH);
  for (let o = 0; o < n; o += CH) { const e = Math.min(CH, n - o); for (let i = 0; i < e; i++) { a[i] = L[o + i] / 32767; b[i] = RR[o + i] / 32767; } m.push(a, b, 0, e); }
  const v = m.result();
  Object.defineProperty(t, '_lufs', { value: isFinite(v) && v > -69 ? v : -20, writable: true, configurable: true, enumerable: false });
  return t._lufs;
}
/**
 * Кусок трека нужной длины в двух каналах (Float32): с позиции from; если трек кончился — петля с перекрёстным
 * переходом 2 с (для подложек) или тишина. Громкость приведена к −20 LUFS и поправке gain (дБ).
 */
function musPiece(t, n, { from = 0, loop = false, gain = 0 } = {}) {
  const [L, R] = t.pcm, len = L.length, g = Math.pow(10, (-20 - musLufs(t) + gain) / 20) / 32767, xf = Math.min(Math.round(2 * C.SR), len >> 2);
  const oL = new Float32Array(n), oR = new Float32Array(n), RR = R || L;
  if (!loop) { const e = Math.min(n, len - from); for (let i = 0; i < e; i++) { oL[i] = L[from + i] * g; oR[i] = RR[from + i] * g; } return [oL, oR]; }
  let o = 0, first = true;
  while (o < n) {
    const st = first ? from : 0, seg = Math.min(len - st, n - o);
    for (let i = 0; i < seg; i++) {
      let w = 1; if (!first && i < xf) w = Math.sin(Math.PI / 2 * i / xf);
      if (o + seg < n && i >= seg - xf) w *= Math.cos(Math.PI / 2 * (i - (seg - xf)) / xf);
      oL[o + i] += L[st + i] * g * w; oR[o + i] += RR[st + i] * g * w;
    }
    o += seg - (o + seg < n ? xf : 0); first = false; if (seg <= xf) break;
  }
  return [oL, oR];
}
/** Плавные края: вход fin и выход fout секунд. */
function musFade(L, R, fin, fout) {
  const n = L.length, a = Math.min(n >> 1, Math.round(fin * C.SR)), b = Math.min(n >> 1, Math.round(fout * C.SR));
  for (let i = 0; i < a; i++) { const w = i / a; L[i] *= w; R[i] *= w; }
  for (let i = 0; i < b; i++) { const w = Math.sin(Math.PI / 2 * i / b); L[n - 1 - i] *= w; R[n - 1 - i] *= w; }
}
/** Вся музыка в сведение (стерео), с приглушением под речью. Возвращает клипы — для таймлайна, стемов и пересчёта кусков. */
function* musicMixSteps(mix, mixR, lay) {
  const m = S.music; if (!m || !mixR) return [];
  const N = mix.length, SR = C.SR, clips = [], { lin, hop } = duckCurve(lay, N, m.duck ?? 10);
  const add = (kind, t, at, dur, opt, fin, fout, extra = {}) => {
    const i0 = Math.round(at * SR), n = Math.min(Math.round(dur * SR), N - i0); if (n < SR * 0.3) return;
    const [L, R] = musPiece(t, n, opt); musFade(L, R, fin, fout);
    for (let i = 0; i < n; i++) { const d = lin[((i0 + i) / hop) | 0]; L[i] *= d; R[i] *= d; mix[i0 + i] += L[i]; mixR[i0 + i] += R[i]; }
    clips.push({ kind, at, dur: n / SR, name: t.name, audio: L, audioR: R, g: 1, ...extra });
  };
  const slot = k => m[k] && m[k].on && musReady(m[k].id) ? musTrack(m[k].id) : null;
  let t;
  if ((t = slot('intro'))) { add('intro', t, 0, Math.min(t.dur, Math.max(2, +m.intro.len || 14)), { gain: m.intro.gain }, 0.05, 3); yield; }
  if ((t = slot('sting'))) for (const sc of (lay.scenes || []).slice(1)) { add('sting', t, sc.start + 0.3, Math.min(t.dur, Math.max(1, +m.sting.len || 5)), { gain: m.sting.gain }, 0.05, 1.5, { n: sc.n }); yield; }
  if ((t = slot('outro'))) { add('outro', t, lay.end + 0.6, Math.min(t.dur, Math.max(2, +m.outro.len || 20)), { gain: m.outro.gain }, 0.5, 4); yield; }
  for (const sc of lay.scenes || []) {
    const b = m.beds[sc.n]; if (!b || !b.on || !musReady(b.id)) continue;
    add('bed', musTrack(b.id), sc.start, sc.end - sc.start, { loop: true, gain: b.gain ?? -12 }, 1.5, 2, { n: sc.n }); yield;
  }
  return clips;
}

// ------------------------------------------------------------------ прослушивание
let musAudio = null;
function musStopPreview() { if (musAudio) { musAudio.pause(); musAudio = null; } }
/** Слушать трек из библиотеки: 25 секунд с начала, стерео, через общий выход. */
function musPlay(t, btn, from = 0) {
  if (playing && playing.btn === btn) { stop(); return; }
  stop(); if (!t || !t.pcm) return;
  const ctx = audioCtx(); ctx.resume();
  const n = Math.min(t.pcm[0].length - from, 25 * C.SR); if (n <= 0) return;
  const b = ctx.createBuffer(2, n, C.SR), [L, R] = musPiece(t, n, { from }); musFade(L, R, 0.02, 1);
  b.copyToChannel(L, 0); b.copyToChannel(R, 1);
  const src = ctx.createBufferSource(); src.buffer = b; src.connect(audioOut()); src.start();
  playing = { src, btn }; if (btn) btn.classList.add('on');
  src.onended = () => { if (playing && playing.src === src) stop(); };
}
/** Слушать найденное в базе — сразу, потоком (ничего не скачиваем, пока не взяли). */
function musPlayUrl(url, btn) {
  if (playing && playing.btn === btn) { stop(); return; }
  stop(); const a = new Audio(url); a.volume = 0.9; musAudio = a;
  a.play().catch(() => { notify('Не проигрывается — проверьте интернет.'); btn.classList.remove('on'); });
  playing = { src: { stop: () => { a.pause(); if (musAudio === a) musAudio = null; } }, btn }; btn.classList.add('on');
  a.onended = () => { if (playing && playing.btn === btn) stop(); };
}

// ------------------------------------------------------------------ база свободной музыки (Openverse)
/** Русские слова → английские для поиска (по основе слова), остальное — как есть. */
function musQuery(q) {
  const words = q.toLowerCase().replace(/ё/g, 'е').split(/[\s,;]+/).filter(Boolean), out = [];
  for (const w of words) { const hit = Object.entries(MUS_RU).find(([ru]) => w.startsWith(ru.replace(/ё/g, 'е'))); out.push(hit ? hit[1] : w); }
  return [...new Set(out)].join(' ');
}
const musLicense = r => r.license === 'cc0' ? 'CC0' : `CC ${String(r.license).toUpperCase()} ${r.lv || ''}`.trim();
async function musSearch(q) {
  const m = musicState(), u = m.ui; u.q = q; const eq = musQuery(q.trim()); if (!eq) return;
  u.busy = true; u.shownQ = eq; renderSounds();
  const one = async q => {
    const r = await fetch(OV_API + '?' + new URLSearchParams({ q, license: 'cc0,by', category: 'music', page_size: '20', mature: 'false' })); if (!r.ok) throw new Error('база ответила ' + r.status);
    return r.json();
  };
  try {
    let d = await one(eq), list = d.results || [], total = d.result_count || 0;
    const words = eq.split(' ');
    if (!list.length && words.length > 1) {              // все слова сразу не нашлись — по каждому слову отдельно
      const seen = new Set();
      for (const w of words) { const x = await one(w); total += x.result_count || 0; for (const it of x.results || []) if (!seen.has(it.id)) { seen.add(it.id); list.push(it); } }
      u.shownQ = words.join(' или ');
    }
    u.total = total;
    // под речь нужна музыка без слов: инструментальные — выше, с голосом — ниже и с пометкой
    const tagsOf = x => (x.tags || []).map(t => String(t.name).toLowerCase());
    const voc = x => { const t = tagsOf(x); return !t.includes('instrumental') && t.some(n => /^(vocal|vocals|male|female|singer|song|lyrics)$/.test(n)); };
    u.res = list.filter(x => x.url && (x.duration || 0) >= 15000).sort((a, b) => voc(a) - voc(b)).slice(0, 20).map(x => ({ ovid: x.id, title: x.title || 'без названия', creator: x.creator || 'автор не указан', license: x.license, lv: x.license_version, lurl: x.license_url, url: x.url, page: x.foreign_landing_url, dur: (x.duration || 0) / 1000, source: x.source, voc: voc(x), tags: tagsOf(x).filter(n => !/^(speed_|vocal|male|female|instrumental|neutral)/.test(n)).slice(0, 3) }));
  } catch (e) { notify('База музыки не ответила: ' + e.message); u.res = []; }
  finally { u.busy = false; renderSounds(); }
}
/** Взять трек из базы: скачать, декодировать, в библиотеку. */
async function musAdd(res) {
  const m = musicState(), id = 'ov:' + res.ovid, have = musTrack(id); if (have && have.pcm) return have;
  const r = await fetch(res.url); if (!r.ok) throw new Error('не скачался (' + r.status + ')');
  const dec = await musDecode(await r.arrayBuffer());
  const meta = { title: res.title, creator: res.creator, license: res.license, lv: res.lv, lurl: res.lurl, page: res.page, url: res.url, source: res.source };
  const t = have || { id, name: `${res.title} — ${res.creator}`, src: 'ov', meta, dur: dec.dur };
  t.pcm = dec.pcm; t.dur = dec.dur; if (!have) m.lib.push(t);
  return t;
}
/** Новый трек — в первое пустое место (заставка, отбивки, финал) и сразу звучит. */
function musAutoSlot(t) { const m = musicState(); for (const [k] of MUS_SLOTS) if (!m[k].id) { m[k].id = t.id; m[k].on = true; return k; } return null; }
async function musAddFiles(list) {
  const m = musicState();
  for (const file of [...list]) {
    const id = 'own:' + file.name, have = musTrack(id);
    try {
      progress(`Читаю ${file.name}…`, 0.3); const dec = await musDecode(await file.arrayBuffer());
      const t = have || { id, name: file.name.replace(/\.[^.]+$/, ''), src: 'own', meta: null };
      t.pcm = dec.pcm; t.dur = dec.dur; if (!have) { m.lib.push(t); musAutoSlot(t); }
      if (dec.full > MUS_MAX + 1) notify(`«${t.name}» длиннее ${MUS_MAX / 60} минут — взяты первые ${MUS_MAX / 60}.`);
    } catch { notify('Не удалось прочитать ' + file.name); }
  }
  progress('', 0); musChanged(true);
}
/** Треки из базы после открытия проекта или перезагрузки — докачать; свои файлы — ждут, когда их добавят. */
async function musRestore() {
  const m = musicState(); if (m.ui.restoring) return;
  const need = m.lib.filter(t => !t.pcm && t.src === 'ov' && t.meta && t.meta.url); if (!need.length) return;
  m.ui.restoring = true;
  try {
    for (const t of need) { try { const r = await fetch(t.meta.url); if (!r.ok) continue; const dec = await musDecode(await r.arrayBuffer()); t.pcm = dec.pcm; t.dur = dec.dur; } catch {} }
  } finally { m.ui.restoring = false; }
  musChanged(true);
}
/** Авторы музыки — для описания выпуска (CC BY требует указать автора). */
function musCredits() {
  const m = musicState(), used = new Set([...MUS_SLOTS.map(([k]) => m[k].on && m[k].id), ...Object.values(m.beds).map(b => b && b.on && b.id)].filter(Boolean));
  const list = m.lib.filter(t => used.has(t.id));
  if (!list.length) return '';
  const lines = ['Музыка:'];
  for (const t of list) {
    if (t.src === 'ov' && t.meta) lines.push(`«${t.meta.title}» — ${t.meta.creator} (${musLicense(t.meta)}${t.meta.lurl ? ', ' + t.meta.lurl : ''})${t.meta.page ? ' ' + t.meta.page : ''}`);
    else lines.push(`«${t.name}» (свой файл — права проверьте сами)`);
  }
  return lines.join('\n') + '\n';
}
function musChanged(render = false) {
  saveEdits(); if (render) renderSounds();
  if (S.result && S.result.out && typeof remixSoon === 'function') remixSoon('layout'); else if (typeof renderMix === 'function') renderMix();
}

// ------------------------------------------------------------------ вкладка «Звуки»: блок «Музыка»
function musOpts(cur, empty = '— нет —') {
  const m = musicState();
  return `<option value="">${empty}</option>` + m.lib.map(t => `<option value="${esc(t.id)}" ${cur === t.id ? 'selected' : ''}>${esc(t.name.slice(0, 60))}${t.pcm ? ' · ' + fmt(t.dur) : t.src === 'own' ? ' — добавьте файл снова' : ' — качаю…'}</option>`).join('');
}
function musicHtml() {
  const m = musicState(), u = m.ui, has = m.lib.length > 0, scenes = typeof ambScenes === 'function' ? ambScenes() : [];
  if (!u.restoring && m.lib.some(t => !t.pcm && t.src === 'ov')) setTimeout(musRestore, 0);
  const missing = m.lib.filter(t => !t.pcm && t.src === 'own');
  const onN = MUS_SLOTS.filter(([k]) => m[k].on && musReady(m[k].id)).length + Object.values(m.beds).filter(b => b && b.on && musReady(b.id)).length;
  const slot = ([k, name, hint]) => {
    const c = m[k], len = k === 'intro' ? [4, 60] : k === 'sting' ? [1, 15] : [4, 90];
    return `<div class="mrow ${c.on && musReady(c.id) ? 'on' : ''}" data-slot="${k}">
      <label class="mini"><input type="checkbox" data-p="on" ${c.on && c.id ? 'checked' : ''} ${c.id ? '' : 'disabled'} aria-label="${name}"></label>
      <div class="stext"><b>${name}</b><div class="small muted">${hint}</div></div>
      <select data-p="id" aria-label="трек: ${name}" ${has ? '' : 'disabled'}>${musOpts(c.id)}</select>
      <label class="num-in"><span>длина</span><input type="number" data-p="len" min="${len[0]}" max="${len[1]}" step="1" value="${c.len}" aria-label="длина, секунд"> с</label>
      ${k === 'intro' ? `<label class="num-in"><span>голос через</span><input type="number" data-p="lead" min="0" max="40" step="0.5" value="${c.lead}" aria-label="голос вступает через, секунд"> с</label>` : '<span class="num-in ph" aria-hidden="true"></span>'}
      <label class="gain"><input type="range" data-p="gain" min="-24" max="6" step="1" value="${c.gain}" aria-label="громкость: ${name}"><span class="gv" data-num="mus:${k}">${dbv(c.gain)}</span></label>
      <button class="play" data-act="mus-slot-play" ${musReady(c.id) ? '' : 'disabled'} aria-label="Слушать">▶</button>
    </div>`;
  };
  const beds = scenes.map(sc => { const b = m.beds[sc.n] || {}; return `<div class="mrow bedrow ${b.on && musReady(b.id) ? 'on' : ''}" data-n="${esc(sc.n)}">
      <label class="mini"><input type="checkbox" data-p="on" ${b.on && b.id ? 'checked' : ''} ${b.id ? '' : 'disabled'} aria-label="подложка сцены ${esc(sc.n)}"></label>
      <div class="stext"><b>Сцена ${esc(sc.n)}</b> <span class="muted">${esc((sc.desc || '').slice(0, 60))}</span></div>
      <select data-p="id" aria-label="подложка сцены ${esc(sc.n)}" ${has ? '' : 'disabled'}>${musOpts(b.id)}</select>
      <label class="gain"><input type="range" data-p="gain" min="-30" max="0" step="1" value="${b.gain ?? -12}" aria-label="громкость подложки"><span class="gv" data-num="musb:${esc(sc.n)}">${dbv(b.gain ?? -12)}</span></label>
    </div>`; }).join('');
  const res = u.res.map((r, i) => `<div class="dbrow"><button class="play" data-act="mus-prev" data-i="${i}" aria-label="Слушать">▶</button><span class="dbtext">${esc(r.title)} <i>${esc(r.creator)} · ${fmt(r.dur)} · ${esc(musLicense(r))}${r.tags.length ? ' · ' + esc(r.tags.join(', ')) : ''}</i>${r.voc ? ' <span class="pill none">с голосом</span>' : ''}</span><button class="ghost-b tiny" data-act="mus-add" data-i="${i}" ${musReady('ov:' + r.ovid) ? 'disabled' : ''}>${musReady('ov:' + r.ovid) ? 'в библиотеке' : 'взять'}</button></div>`).join('');
  const lib = m.lib.map(t => `<span class="chip ghost ${t.pcm ? '' : 'wait'}">${esc(t.name.slice(0, 48))} <i>${t.pcm ? fmt(t.dur) : t.src === 'own' ? 'нет файла' : 'качаю…'}</i>${t.meta ? ` <i>${esc(musLicense(t.meta))}</i>` : ''} <button class="icon xs" data-act="mus-lib-play" data-id="${esc(t.id)}" ${t.pcm ? '' : 'disabled'} aria-label="Слушать">${ic('play')}</button><button class="icon xs" data-act="mus-lib-rm" data-id="${esc(t.id)}" aria-label="Убрать">${ic('close')}</button></span>`).join('');
  const cr = musCredits();
  return `<div class="musbox">
    <div class="dbline"><b>Музыка</b><span class="pill ${onN ? 'ok' : 'none'}">${onN ? 'в спектакле: ' + onN : 'выключена'}</span>
      <label class="ghost-b file-b">${ic('plus')}Загрузить свою музыку<input type="file" id="mus-add" accept="audio/*,.m4a,.opus,.flac" multiple hidden></label>
      <label class="gain duck"><span>под речью тише на <b id="mduck-v" data-num="mduck">${m.duck} дБ</b></span><input type="range" id="mus-duck" min="0" max="24" step="1" value="${m.duck}"></label></div>
    <p class="muted small">Заставка, отбивки и финал раздвигают спектакль на свою длину. Под голосом музыка сама уходит вниз. С музыкой сведение становится стерео.</p>
    ${missing.length ? `<p class="small warn">Добавьте снова свои файлы: ${missing.map(t => '«' + esc(t.name) + '»').join(', ')} — звук своих файлов не хранится в проекте.</p>` : ''}
    <div class="mrows">${MUS_SLOTS.map(slot).join('')}</div>
    ${scenes.length ? `<details class="mbeds" ${Object.values(m.beds).some(b => b && b.on) ? 'open' : ''}><summary>Подложки под сцены</summary><p class="muted small">Музыка под всей сценой, по кругу, если трек короче; под речью приглушается.</p><div class="mrows">${beds}</div></details>` : ''}
    <div class="dbline mus-search">
      <input id="mus-q" type="search" placeholder="Поиск свободной музыки: тревожная, пианино, calm, epic…" value="${esc(u.q)}" aria-label="Поиск музыки">
      <button class="ghost-b" data-act="mus-go" ${u.busy ? 'disabled' : ''}>Найти</button>
    </div>
    <div class="chips mus-moods">${MUS_MOODS.map(([ru, en]) => `<button class="chip ghost" data-act="mus-mood" data-q="${esc(en)}" data-ru="${esc(ru)}">${esc(ru)}</button>`).join('')}</div>
    <p class="muted small">Свободная музыка из <a href="https://openverse.org" target="_blank" rel="noopener">Openverse</a> (в основном Jamendo): только CC0 и CC BY — их можно использовать в любом выпуске; для CC BY укажите автора (список — кнопкой ниже).</p>
    ${u.busy && !u.res.length ? '<p class="muted small">Ищу…</p>' : ''}
    ${u.res.length ? `<div class="dbrows">${res}</div><p class="muted small">найдено ${u.total}${u.shownQ ? `, искал «${esc(u.shownQ)}»` : ''}; показаны первые ${u.res.length}</p>` : u.shownQ && !u.busy ? '<p class="muted small">Ничего не нашлось — попробуйте другое слово.</p>' : ''}
    ${lib ? `<div class="chips mus-lib">${lib}</div>` : ''}
    ${cr ? `<div class="mus-cr"><button class="ghost-b tiny" data-act="mus-credits">Авторы музыки (.txt)</button><span class="muted small">для описания выпуска</span></div>` : ''}
  </div>`;
}
function bindMusic(el) {
  el.addEventListener('keydown', e => { if (e.target.id === 'mus-q' && e.key === 'Enter') { e.preventDefault(); musSearch(e.target.value); } });
  el.addEventListener('input', e => {
    const x = e.target;
    if (x.id === 'mus-q') { musicState().ui.q = x.value; return; }
    if (x.id === 'mus-duck') { $('#mduck-v').textContent = x.value + ' дБ'; return; }
    if ((x.closest('.mrow')) && x.dataset.p === 'gain') x.closest('.gain').querySelector('.gv').textContent = dbv(+x.value);
  });
  el.addEventListener('change', e => {
    const x = e.target, m = musicState();
    if (x.id === 'mus-add') { musAddFiles(x.files); x.value = ''; return; }
    if (x.id === 'mus-duck') { m.duck = +x.value; musChanged(); return; }
    const row = x.closest('.mrow'); if (!row) return;
    const c = row.dataset.slot ? m[row.dataset.slot] : (m.beds[row.dataset.n] || (m.beds[row.dataset.n] = { id: null, on: false, gain: -12 })), p = x.dataset.p;
    if (p === 'on') c.on = x.checked;
    else if (p === 'id') { c.id = x.value || null; c.on = !!c.id; }
    else if (p === 'gain') c.gain = +x.value;
    else if (p === 'len' || p === 'lead') { const v = +x.value; if (isFinite(v)) c[p] = Math.max(+x.min, Math.min(+x.max, v)); }
    musChanged(p === 'on' || p === 'id');
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const a = b.dataset.act, m = musicState();
    if (!a || !a.startsWith('mus-')) return;
    if (a === 'mus-go') { musSearch($('#mus-q').value); return; }
    if (a === 'mus-mood') { const q = b.dataset.q; m.ui.q = b.dataset.ru; musSearch(q); return; }
    if (a === 'mus-prev') { const r = m.ui.res[+b.dataset.i]; if (r) musPlayUrl(r.url, b); return; }
    if (a === 'mus-add') { const r = m.ui.res[+b.dataset.i]; if (!r) return; b.disabled = true; if (typeof swapText === 'function') swapText(b, 'качаю…'); else b.textContent = 'качаю…';
      musAdd(r).then(t => { const k = musAutoSlot(t); notify(`«${r.title}» в библиотеке${k ? ' и в спектакле: ' + MUS_SLOTS.find(x => x[0] === k)[1].toLowerCase() : ''}. Поменять — в строках выше.`); musChanged(true); })
        .catch(err => { notify('Не скачался: ' + err.message); renderSounds(); }); return; }
    if (a === 'mus-lib-play') { musPlay(musTrack(b.dataset.id), b); return; }
    if (a === 'mus-lib-rm') { const id = b.dataset.id; m.lib = m.lib.filter(t => t.id !== id); for (const [k] of MUS_SLOTS) if (m[k].id === id) { m[k].id = null; m[k].on = false; } for (const bd of Object.values(m.beds)) if (bd && bd.id === id) { bd.id = null; bd.on = false; } musChanged(true); return; }
    if (a === 'mus-slot-play') { const k = b.closest('.mrow').dataset.slot, t = musTrack(m[k].id); musPlay(t, b); return; }
    if (a === 'mus-credits') { download(new Blob([musCredits()], { type: 'text/plain;charset=utf-8' }), 'музыка — авторы.txt'); return; }
  });
}
