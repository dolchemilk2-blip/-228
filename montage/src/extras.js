// Монтажка — дубли, дозапись, стемы для монтажной программы, главы.
// Использует S, $, esc, fmt, charName, colorOf, notify, progress, download, sourceOf, statusOf, wav16 из app.js; C — ядро.

// ------------------------------------------------------------------ дубли
/**
 * Актёр перечитал реплику: второй кусок с тем же текстом остался неиспользованным. Для каждой найденной
 * реплики ищутся такие куски (один или два подряд) в записях того же персонажа; лучший дубль — ближе
 * к тексту, без клиппинга, при равенстве — последний (перечитывают обычно, когда первый не понравился).
 */
function computeTakes() {
  S.takes = new Map(); if (!S.P || !S.matches.size) return;
  const cueById = new Map(S.P.cues.map(c => [c.id, c])), lineT = new Map();
  for (const id of S.matches.keys()) { const c = cueById.get(id); if (c) lineT.set(id, C.norm(c.text)); }
  const segAt = (fi, p) => { const f = S.files[fi]; if (!f || !f.segs) return null; let best = null, bo = 0; for (const s of f.segs) { const o = Math.min(s.b, p.b) - Math.max(s.a, p.a); if (o > bo) { bo = o; best = s; } } return best && bo >= 0.7 * Math.min(p.b - p.a, best.b - best.a) ? best : null; };
  const grams = t => { const g = new Set(); for (let i = 0; i + 1 < t.length; i++) g.add(t.slice(i, i + 2)); return g; };
  const contained = (a, b) => { const A = grams(a), B = grams(b); if (!A.size) return 0; let k = 0; for (const x of A) if (B.has(x)) k++; return k / A.size; };
  const strongOther = (id, st) => { for (const [oid, m] of S.matches) { if (oid === id || !(m.how === 'text' || m.how === 'moved') || (m.sim || 0) < 0.4) continue; const t = lineT.get(oid); if (t && t.length >= 10 && C.dice(st, t) >= 0.6) return oid; } return null; };
  // чужие куски: догадка «по порядку» или край общей группы, чей текст явно другой найденной реплики, — это её дубль
  for (const [id, m] of [...S.matches]) {
    const own = lineT.get(id) || '', guess = m.how === 'order' || (m.sim || 0) < 0.3, keep = [];
    m.pieces.forEach((p, i) => {
      const sg = segAt(m.file, p), st = sg && sg.text ? C.norm(C.cleanAsr(sg.text)) : '';
      const edge = m.pieces.length > 1 && (i === 0 || i === m.pieces.length - 1);
      if (st.length >= 10 && (guess || edge) && C.dice(st, own) < 0.3 && contained(st, own) < 0.5 && strongOther(id, st)) return;
      keep.push(p);
    });
    if (keep.length === m.pieces.length) continue;
    if (keep.length) m.pieces = keep; else S.matches.delete(id);
  }
  const used = S.files.map(() => []);
  for (const m of S.matches.values()) for (const p of m.pieces) if (used[m.file]) used[m.file].push([p.a, p.b]);
  const isUsed = (fi, s) => used[fi].some(([a, b]) => a < s.b - 0.05 && b > s.a + 0.05);
  const free = [];                                    // неиспользованные куски и пары соседних
  S.files.forEach((f, fi) => {
    if (!f.segs) return;
    const segs = f.segs.map((s, j) => ({ s, j })).filter(x => x.s.text && !C.isNoiseText(x.s.text) && !isUsed(fi, x.s));
    for (let k = 0; k < segs.length; k++) {
      const a = segs[k]; free.push({ fi, pieces: [{ a: a.s.a, b: a.s.b }], text: a.s.text, t: C.norm(C.cleanAsr(a.s.text)), key: fi + ':' + a.j });
      const b = segs[k + 1]; if (b && b.j === a.j + 1 && b.s.a - a.s.b < 1.2) free.push({ fi, pieces: [{ a: a.s.a, b: a.s.b }, { a: b.s.a, b: b.s.b }], text: a.s.text + ' ' + b.s.text, t: C.norm(C.cleanAsr(a.s.text + ' ' + b.s.text)), key: fi + ':' + a.j + '+' + b.j });
    }
  });
  if (!free.length) return;
  const best = new Map();                             // кусок → лучшая для него реплика (один кусок — один дубль)
  for (const [id, m] of S.matches) {
    const cue = cueById.get(id); if (!cue) continue;
    const t = C.norm(cue.text); if (t.length < 10) continue;
    for (const fr of free) {
      const f = S.files[fr.fi]; if (cue.type === 'line' ? !f.chars.has(cue.spk) : fr.fi !== m.file) continue;   // озвученная ремарка — дубль из того же файла
      const sim = C.dice(fr.t, t); if (sim < 0.6) continue;
      const cur = best.get(fr.key); if (!cur || sim > cur.sim) best.set(fr.key, { id, sim, fr });
    }
  }
  const byId = new Map();
  for (const x of best.values()) { if (!byId.has(x.id)) byId.set(x.id, []); byId.get(x.id).push(x); }
  const clipOf = (fi, pieces) => { const f = S.files[fi]; let n = 0, c = 0; for (const p of pieces) { const y = f.y48.subarray(Math.round(p.a * C.SR), Math.round(p.b * C.SR)); for (let i = 0; i < y.length; i += 2) { n++; if (Math.abs(y[i]) > 0.98) c++; } } return n ? c / n : 0; };
  for (const [id, alts] of byId) {
    const m = S.matches.get(id), seen = new Set(), list = [{ file: m.file, pieces: m.pieces.map(p => ({ a: p.a, b: p.b })), sim: m.sim || 0, text: m.text, main: true }];
    for (const x of alts.sort((a, b) => b.sim - a.sim)) { if (x.fr.pieces.some(p => seen.has(x.fr.fi + ':' + p.a))) continue; x.fr.pieces.forEach(p => seen.add(x.fr.fi + ':' + p.a)); list.push({ file: x.fr.fi, pieces: x.fr.pieces, sim: x.sim, text: x.fr.text }); }
    if (list.length < 2) continue;
    list.sort((a, b) => a.file - b.file || a.pieces[0].a - b.pieces[0].a);          // по порядку записи: дубль 1, 2, 3
    // перегруз — штраф по доле: 0,25 % пиков у потолка ≈ −1; при равенстве — последний дубль
    list.forEach((tk, i) => { tk.clip = clipOf(tk.file, tk.pieces); tk.score = 3 * tk.sim - Math.min(4, tk.clip * 400) + 0.12 * i; });
    let bi = 0; list.forEach((tk, i) => { if (tk.score > list[bi].score) bi = i; });
    S.takes.set(id, { list, best: bi });
  }
}
/** Какой дубль звучит: выбранный руками или лучший. */
function takeOf(id) { const tk = S.takes && S.takes.get(id); if (!tk) return null; const i = S.takePick[id] ?? tk.best; return { i: Math.min(i, tk.list.length - 1), n: tk.list.length, t: tk.list[Math.min(i, tk.list.length - 1)], best: tk.best }; }

// ------------------------------------------------------------------ дозапись
/** Что дозаписать: реплики без записи и реплики, где услышано совсем не то. */
function rerecList() {
  const out = new Map(); if (!S.P) return out;
  const lines = S.P.cues.filter(c => c.type === 'line');
  for (const c of lines) {
    const st = statusOf(c), src = sourceOf(c); let why = null;
    if (st.k === 'miss') why = 'нет записи';
    else if (st.k === 'check' && src && src.kind !== 'upload' && src.kind !== 'manual' && (src.sim ?? 1) < 0.45) why = `проверить: услышано «${(src.text || '').trim().slice(0, 80)}»`;
    else { const d = slipOf(c); if (d && d.errs >= 2) why = `оговорка: услышано «${(src.text || '').trim().slice(0, 80)}»`; }
    if (!why) continue;
    if (!out.has(c.spk)) out.set(c.spk, []);
    out.get(c.spk).push({ cue: c, why });
  }
  return out;
}
// ------------------------------------------------------------------ оговорки: распознанное против сценария, по словам
const slipNorm = w => w.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
function slipWords(s) { return String(s || '').split(/\s+/).map(raw => ({ raw, n: slipNorm(raw) })).filter(w => w.n); }
/** Похожесть слов 0…1: расстояние Левенштейна к длине. «пошёл» и «пошел», «сделал» и «сделала» — одно слово. */
function slipSim(a, b) {
  if (a === b) return 1; const n = a.length, m = b.length; if (!n || !m) return 0;
  let prev = Array.from({ length: m + 1 }, (_, j) => j), cur = new Array(m + 1);
  for (let i = 1; i <= n; i++) { cur[0] = i; for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [prev, cur] = [cur, prev]; }
  return 1 - prev[m] / Math.max(n, m);
}
/**
 * Пословное выравнивание сценария и услышанного: same / miss (пропущено) / add (лишнее) / sub (сказано иначе).
 * Короткие служебные слова («и», «а», «ну», «же») в счёт оговорок не идут — распознавание их часто теряет.
 */
function slipDiff(script, heard) {
  const A = slipWords(script), B = slipWords(heard), n = A.length, m = B.length;
  if (!n || !m) return null;
  const same = (i, j) => slipSim(A[i].n, B[j].n) >= 0.72;
  const D = Array.from({ length: n + 1 }, (_, i) => { const r = new Float32Array(m + 1); r[0] = i; return r; });
  for (let j = 1; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (same(i - 1, j - 1) ? 0 : 1.2));
  const ops = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (same(i - 1, j - 1) ? 0 : 1.2)) { ops.push(same(i - 1, j - 1) ? { t: 'same', a: A[i - 1].raw } : { t: 'sub', a: A[i - 1].raw, b: B[j - 1].raw }); i--; j--; }
    else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { ops.push({ t: 'miss', a: A[i - 1].raw }); i--; }
    else { ops.push({ t: 'add', b: B[j - 1].raw }); j--; }
  }
  ops.reverse();
  const content = w => slipNorm(w || '').length >= 3;
  const errs = ops.filter(o => o.t !== 'same' && (content(o.a) || content(o.b))).length;
  return { ops, errs, same: ops.filter(o => o.t === 'same').length, total: n };
}
/** Оговорка — когда услышанное в целом то же (больше половины слов на месте), но есть расхождения по существу. */
function slipOf(cue) {
  if (!cue || cue.type !== 'line') return null;
  const src = sourceOf(cue); if (!src || src.kind === 'upload' || !src.text || src.group > 1) return null;   // общий кусок на две реплики — не оговорка
  const d = slipDiff(cue.text, C.cleanAsr(src.text)); if (!d || !d.errs) return null;
  const adds = d.ops.filter(o => o.t === 'add').length;
  return d.same / d.total >= 0.5 && adds <= Math.max(2, d.total * 0.5) ? d : null;
}
function slipHtml(d) {
  return d.ops.map(o => o.t === 'same' ? esc(o.a) : o.t === 'miss' ? `<del title="пропущено">${esc(o.a)}</del>` : o.t === 'add' ? `<ins title="лишнее">${esc(o.b)}</ins>` : `<del title="в сценарии">${esc(o.a)}</del><ins title="сказано">${esc(o.b)}</ins>`).join(' ');
}
function rerecText(spk) {
  const all = rerecList(), keys = spk ? [spk] : [...all.keys()], cues = S.P.cues, lines = [];
  let sceneOf = new Map(), sc = '1'; for (const c of cues) { if (c.type === 'scene') sc = c.n; else sceneOf.set(c.id, sc); }
  const near = (c, d) => { let i = cues.indexOf(c) + d; while (i >= 0 && i < cues.length && cues[i].type !== 'line') i += d; return cues[i] && cues[i].type === 'line' ? cues[i] : null; };
  lines.push(spk ? `Дозапись: ${charName(spk)}` : 'Дозапись — все роли', 'Номер — как в сценарии и в разметке. «До» и «после» — соседние реплики, чтобы попасть в интонацию.', 'Каждую реплику лучше записать отдельным файлом или с паузой в секунду; файл назвать номером (например, «' + (all.get(keys[0])?.[0]?.cue.id || 'd12') + '.wav») — его можно подложить кнопкой «Своя запись».', '');
  for (const k of keys) {
    const list = all.get(k) || []; if (!list.length) continue;
    const hasFile = S.files.some(f => f.chars.has(k));
    lines.push(`${charName(k).toUpperCase()} — ${list.length} ${list.length === 1 ? 'реплика' : list.length < 5 ? 'реплики' : 'реплик'}${hasFile ? '' : ' (записей этой роли нет совсем)'}`);
    for (const { cue, why } of list) {
      const p = near(cue, -1), n = near(cue, 1);
      lines.push('', `  [${cue.id}] сцена ${sceneOf.get(cue.id)} · ${why}`);
      if (p) lines.push(`      до:    ${charName(p.spk)}: ${p.text.slice(0, 100)}`);
      lines.push(`   >> ${charName(cue.spk)}${cue.note ? ` (${cue.note})` : ''}: ${cue.text}`);
      if (n) lines.push(`      после: ${charName(n.spk)}: ${n.text.slice(0, 100)}`);
    }
    lines.push('', '');
  }
  return lines.join('\n') + '\n';
}
function rerecHtml() {
  const all = rerecList(); if (!all.size) return '';
  const total = [...all.values()].reduce((s, l) => s + l.length, 0);
  return `<div class="rerec"><b>Дозапись</b><span class="muted small">по актёру: реплики без записи и те, где услышано не то, с соседними репликами для интонации</span>
    <div class="chips">${[...all].map(([k, l]) => `<span class="rr"><button class="chip ${colorOf(k)} as-btn" data-act="rerec" data-spk="${esc(k)}" title="Список для актёра (.txt)">${esc(charName(k))} <i data-num="rr:${esc(k)}">${l.length}</i> ${ic('download')}</button><button class="icon xs rr-mic" data-act="rec-spk" data-spk="${esc(k)}" title="Записать реплики ${esc(charName(k))} здесь, с суфлёром" aria-label="Записать реплики ${esc(charName(k))} здесь">${ic('mic')}</button></span>`).join('')}
    <button class="ghost-b tiny" data-act="rerec" data-spk="">все одним файлом (${total})</button></div></div>`;
}

// ------------------------------------------------------------------ ZIP без сжатия
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {                           // files: [{name, data: Uint8Array}] → Blob
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(), tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, tm, true); h.setUint16(12, dt, true);
    h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, tm, true); c.setUint16(14, dt, true);
    c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(c.buffer, name);
    off += 30 + name.length + f.data.length;
    if (off > 0xFFFFFFF0) throw new Error('слишком большой архив (больше 4 ГБ)');
  }
  const cdSize = central.reduce((s, p) => s + p.byteLength, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}

// ------------------------------------------------------------------ стемы
/** Дорожки по персонажам (мелкие роли — вместе), звуки, фон: полная длина, та же громкость, что в сведении, без лимитера. */
function buildStems() {
  const r = S.result, g = Math.pow(10, r.master.gainDb / 20), n = r.out.length, groups = new Map();
  const counts = new Map(); for (const p of r.lay.placed) if (p.item) counts.set(p.item.voice, (counts.get(p.item.voice) || 0) + 1);
  const nameOf = p => p.item ? (counts.get(p.item.voice) <= 3 ? 'остальные голоса' : charName(p.item.voice)) : p.bed ? 'звуки фоном' : 'звуки';
  for (const p of r.lay.placed) { const k = nameOf(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const order = [...S.P.chars.map(c => charName(c.key)), 'остальные голоса', 'звуки', 'звуки фоном'].filter(k => groups.has(k));
  for (const k of groups.keys()) if (!order.includes(k)) order.push(k);
  // стерео (мизансцена, музыка): у реплик p.sp — как они легли в каналы, у фона и музыки — audioR и множитель
  const put = (y, yR, list) => { for (const p of list) { const i0 = Math.round(p.at * C.SR);
    if (yR && p.sp) C.spAdd(p.sp, y, yR, i0, 0, Math.max(0, Math.min(C.spLen(p.sp), n - i0)), g);
    else for (let i = 0; i < p.audio.length && i0 + i < n; i++) y[i0 + i] += p.audio[i] * g; } };
  const clip = (y, yR, list) => { for (const a of list) { const i0 = Math.round(a.at * C.SR), k = (a.g || 1) * g, aR = a.audioR || a.audio;
    for (let i = 0; i < a.audio.length && i0 + i < n; i++) { y[i0 + i] += a.audio[i] * k; if (yR) yR[i0 + i] += aR[i] * k; } } };
  const stems = order.map(k => ({ name: k, fill: (y, yR) => put(y, yR, groups.get(k)) }));
  if (r.room && r.room.length) stems.push({ name: 'комнатный тон', fill: (y, yR) => clip(y, yR, r.room) });
  if (r.amb && r.amb.length) stems.push({ name: 'фон сцен', fill: (y, yR) => clip(y, yR, r.amb) });
  if (r.mus && r.mus.length) stems.push({ name: 'музыка', fill: (y, yR) => clip(y, yR, r.mus) });
  return { stems, n };
}
function rppText(names, dur, scenes) {
  const q = s => '"' + String(s).replace(/"/g, "'") + '"';
  const out = ['<REAPER_PROJECT 0.1 "6.0" 0', '  SAMPLERATE 48000 0 0', '  TEMPO 120 4 4'];
  scenes.forEach((sc, i) => out.push(`  MARKER ${i + 1} ${sc.start.toFixed(3)} ${q('Сцена ' + sc.n + (sc.desc ? ' — ' + sc.desc : ''))} 0 0 1`));
  names.forEach(nm => out.push('  <TRACK', `    NAME ${q(nm)}`, '    <ITEM', '      POSITION 0', `      LENGTH ${dur.toFixed(3)}`, `      NAME ${q(nm)}`, '      <SOURCE WAVE', `        FILE ${q('stems/' + nm + '.wav')}`, '      >', '    >', '  >'));
  out.push('>');
  return out.join('\n') + '\n';
}
async function exportStems() {
  const r = S.result; if (!r) return;
  const { stems, n } = buildStems(), files = [], names = [], enc = new TextEncoder();
  const scenes = (r.lay.scenes || []).map(sc => ({ ...sc, desc: typeof sceneDesc === 'function' && sc.cue ? sceneDesc(sc.cue).slice(0, 60) : '' }));
  const mb = (n * 2 * (r.outR ? 2 : 1) * stems.length / 1e6).toFixed(0);
  for (let i = 0; i < stems.length; i++) {
    progress(`Стемы: ${stems[i].name} (${i + 1} из ${stems.length}, всего около ${mb} МБ)…`, i / stems.length);
    await new Promise(res => setTimeout(res, 20));
    const y = new Float32Array(n), yR = r.outR ? new Float32Array(n) : null; stems[i].fill(y, yR);
    const nm = String(i + 1).padStart(2, '0') + ' ' + stems[i].name.replace(/[\\/:*?"<>|]/g, '_');
    files.push({ name: 'stems/' + nm + '.wav', data: new Uint8Array(wav16(y, yR)) }); names.push(nm);
  }
  files.push({ name: 'проект.rpp', data: enc.encode(rppText(names, n / C.SR, scenes)) });
  files.push({ name: 'разметка.csv', data: enc.encode(reportCsv()) });
  files.push({ name: 'главы.txt', data: enc.encode(chaptersText()) });
  files.push({ name: 'ПРОЧТИ.txt', data: enc.encode(['Стемы сведения: каждая дорожка — полная длина спектакля, все начинаются с нуля, поэтому совпадают по времени.',
    'Громкость — как в сведении, но без итогового лимитера: сумма дорожек почти равна сведению, пики могут быть чуть выше.',
    'Reaper: открыть проект.rpp — дорожки по персонажам и маркеры сцен.', 'Audacity: Файл → Импорт → Аудио, выбрать все файлы из stems.', ''].join('\r\n')) });
  progress('Упаковываю…', 0.98); await new Promise(res => setTimeout(res, 20));
  const zip = zipStore(files); progress('', 0);
  return zip;
}

// ------------------------------------------------------------------ главы
function chapterList() {
  const r = S.result; if (!r || !r.lay.scenes) return [];
  return r.lay.scenes.map((sc, i) => ({ start: i ? sc.start : 0, end: sc.end, title: `Сцена ${sc.n}` + (typeof sceneDesc === 'function' && sc.cue && sceneDesc(sc.cue) ? ' — ' + sceneDesc(sc.cue).split(' · ')[0].slice(0, 50) : '') }));
}
/** Для описания на YouTube: «00:00 Сцена 1 — кабинет». */
function chaptersText() {
  const hms = t => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0'); };
  return chapterList().map(c => `${hms(c.start)} ${c.title}`).join('\n') + '\n';
}
/** ID3v2.4 с главами (CHAP + CTOC) — плееры подкастов и VLC показывают сцены. */
function id3Chapters(title) {
  const enc = new TextEncoder(), chs = chapterList(); if (!chs.length) return new Uint8Array(0);
  const ss = n => [(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127];
  const frame = (id, body) => { const h = new Uint8Array(10 + body.length); h.set(enc.encode(id), 0); h.set(ss(body.length), 4); h.set(body, 10); return h; };
  const cat = arrs => { const n = arrs.reduce((s, a) => s + a.length, 0), o = new Uint8Array(n); let k = 0; for (const a of arrs) { o.set(a, k); k += a.length; } return o; };
  const tit2 = t => frame('TIT2', cat([new Uint8Array([3]), enc.encode(t)]));
  const be = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const chaps = chs.map((c, i) => frame('CHAP', cat([enc.encode('ch' + i), new Uint8Array([0]), new Uint8Array([...be(Math.round(c.start * 1000)), ...be(Math.round(c.end * 1000)), 255, 255, 255, 255, 255, 255, 255, 255]), tit2(c.title)])));
  const ctoc = frame('CTOC', cat([enc.encode('toc'), new Uint8Array([0, 3, chs.length]), ...chs.map((c, i) => cat([enc.encode('ch' + i), new Uint8Array([0])])), tit2('Сцены')]));
  const body = cat([tit2(title), ctoc, ...chaps]);
  return cat([enc.encode('ID3'), new Uint8Array([4, 0, 0, ...ss(body.length)]), body]);
}
