// Монтажка — таймлайн сведения: дорожки по персонажам, реплики двигаются и выделяются мышью.
// Щелчок — выбрать реплику; Ctrl/Shift+щелчок — добавить или убрать; протяжка по пустому месту — рамка;
// щелчок по имени дорожки — все реплики персонажа. Правый щелчок (или клавиша меню, Shift+F10) — меню:
// эффект, громкость, сдвиг, выделение, отмена. Тянуть реплику — пауза перед ней (всё дальше едет следом);
// с Alt или при нескольких выбранных — двигаются только они. Колёсико — масштаб, Shift+колёсико или
// Alt+протяжка — прокрутка, мини-карта снизу — весь спектакль. «На весь экран» — таймлайн во весь монитор.
// Использует S, $, esc, fmt, charName, colorOf, cssVar, saveEdits, remixSoon, voiceIds, TP, tpTime, tpSeek,
// tpPlay, tpPause из app.js; histPush, histUndo, histRedo, histUi, tlFlash из history.js; C — ядро.
const TL = { HEAD: 150, RULER: 22, PAD: 6, MAX_ZOOM: 400, OV: 30 };
function tlState() {
  if (!S.tl) S.tl = { zoom: 0, scroll: 0, sel: new Set(), own: false, drag: null, pan: null, scrub: false, band: null, row: 40, full: false, ovDrag: false };
  if (!(S.tl.sel instanceof Set)) S.tl.sel = new Set(S.tl.sel ? [S.tl.sel] : []);
  return S.tl;
}
/** Дорожки: персонажи по порядку сценария, потом ремарки, звуки, фон; клипы — строки раскладки. */
function tlTracks(r) {
  const tracks = [], byKey = new Map(), placedOf = new Map(r.lay.placed.map(p => [p.cue.id, p]));
  const add = (key, name, cls, voice) => { const t = { key, name, cls, voice, clips: [] }; tracks.push(t); byKey.set(key, t); return t; };
  for (const c of S.P.chars) if (r.lay.rows.some(row => row.cue.type === 'line' && row.cue.spk === c.key)) add(c.key, c.name, colorOf(c.key), c.key);
  r.lay.rows.forEach((row, idx) => {
    let tr, kind;
    if (row.bed) { tr = byKey.get('фон') || add('фон', 'Фон', 'ghost'); kind = 'bed'; }
    else if (row.sound) { tr = byKey.get('звуки') || add('звуки', 'Звуки', 'ghost'); kind = 'sound'; }
    else { const c = row.cue, voice = c.type === 'line' ? c.spk : 'ремарки'; tr = byKey.get(voice) || add(voice, c.type === 'line' ? charName(voice) : 'Ремарки', c.type === 'line' ? colorOf(voice) : 'ghost', voice); kind = row.recorded ? 'line' : 'pause'; }
    const p = placedOf.get(row.cue.id); let peaks = null;
    if (p && p.audio && p.audio.length) { const n = Math.max(8, Math.min(240, Math.ceil(row.dur * 30))), b = Math.ceil(p.audio.length / n); peaks = new Float32Array(n); for (let k = 0; k < n; k++) { let m = 0; const e = Math.min(p.audio.length, (k + 1) * b); for (let i = k * b; i < e; i += 4) { const a = Math.abs(p.audio[i]); if (a > m) m = a; } peaks[k] = m; } }
    const it = S.result.byId && S.result.byId.get(row.cue.id);
    tr.clips.push({ row, idx, kind, peaks, fx: it && it.fxKey ? it.fxKey : null });
  });
  if (r.amb && r.amb.length) { const t = add('фон сцен', 'Фон сцен', 'ghost'); for (const a of r.amb) { const n = Math.max(8, Math.min(400, Math.ceil(a.dur * 2))), b = Math.ceil(a.audio.length / n), peaks = new Float32Array(n); let mx = 1e-9; for (let k = 0; k < n; k++) { let m = 0; for (let i = k * b; i < Math.min(a.audio.length, (k + 1) * b); i += 64) m = Math.max(m, Math.abs(a.audio[i])); peaks[k] = m; mx = Math.max(mx, m); } for (let k = 0; k < n; k++) peaks[k] /= mx * 1.6; t.clips.push({ row: { cue: { id: 'amb' + a.n, text: a.name, type: 'amb' }, at: a.at, dur: a.dur, sound: a.name }, idx: -1, kind: 'bed', peaks, fixed: true }); } }
  return tracks;
}
const tlAllClips = () => (S.tlTracks || []).flatMap(t => t.clips);
function tlText(row) { const c = row.cue; return row.sound ? row.sound : c.text.replace(/^[—\-]\s*/, ''); }
function tlX(st, t) { return TL.HEAD + (t - st.scroll) * st.zoom; }
function tlT(st, x) { return st.scroll + (x - TL.HEAD) / st.zoom; }
const tlColor = tr => tr.cls === 'ghost' ? [cssVar('--none'), cssVar('--none-soft')] : [cssVar('--' + tr.cls), cssVar('--' + tr.cls + 's')];
function drawTimeline() {
  const cv = $('#tl-cv'), r = S.result; if (!cv || !r || !r.lay) return;
  const st = tlState(), tracks = S.tlTracks || (S.tlTracks = tlTracks(r));
  // высота дорожки: обычно 40; на весь экран — чтобы дорожки заполнили экран (34…96)
  if (st.full) { const area = cv.parentElement.clientHeight || 600; st.row = Math.max(34, Math.min(96, Math.floor((area - TL.RULER - TL.PAD) / Math.max(1, tracks.length)))); } else st.row = 40;
  const ROW = st.row, W = Math.max(360, Math.floor(cv.clientWidth || 800)), H = TL.RULER + tracks.length * ROW + TL.PAD, dpr = window.devicePixelRatio || 1;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const total = r.lay.total, areaW = W - TL.HEAD, minZoom = areaW / total;
  if (!st.zoom) st.zoom = minZoom;
  st.zoom = Math.max(minZoom, Math.min(TL.MAX_ZOOM, st.zoom));
  st.scroll = Math.max(0, Math.min(Math.max(0, total - areaW / st.zoom), st.scroll));
  const ink = cssVar('--ink'), muted = cssVar('--muted'), line = cssVar('--line'), line2 = cssVar('--line2'), bg = cssVar('--bg'), surface = cssVar('--surface'), accent = cssVar('--accent');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  tracks.forEach((tr, i) => {
    const y = TL.RULER + i * ROW, [col, soft] = tlColor(tr), allSel = tr.clips.length && tr.clips.every(c => c.fixed || st.sel.has(c.row.cue.id));
    g.fillStyle = i % 2 ? bg : surface; g.fillRect(TL.HEAD, y, areaW, ROW);
    g.strokeStyle = line2; g.beginPath(); g.moveTo(0, y + ROW + 0.5); g.lineTo(W, y + ROW + 0.5); g.stroke();
    const ph = Math.min(26, ROW - 14);
    g.fillStyle = allSel ? col : soft; g.globalAlpha = allSel ? 0.3 : 1; g.beginPath(); g.roundRect(6, y + (ROW - ph) / 2, TL.HEAD - 14, ph, 10); g.fill(); g.globalAlpha = 1;
    g.fillStyle = col; g.font = '600 12px ' + cssVar('--sans'); g.textBaseline = 'middle'; g.textAlign = 'left';
    g.save(); g.beginPath(); g.rect(6, y, TL.HEAD - 14, ROW); g.clip(); g.fillText(tr.name, 14, y + ROW / 2 + 0.5); g.restore();
    if (tr.voice && S.fxVoice && S.fxVoice[tr.voice] && S.fxVoice[tr.voice] !== 'none') { g.fillStyle = accent; g.beginPath(); g.arc(TL.HEAD - 14, y + ROW / 2 - ph / 2 + 4, 3.2, 0, Math.PI * 2); g.fill(); }
  });
  g.fillStyle = surface; g.fillRect(TL.HEAD, 0, areaW, TL.RULER); g.strokeStyle = line; g.beginPath(); g.moveTo(TL.HEAD, TL.RULER + 0.5); g.lineTo(W, TL.RULER + 0.5); g.stroke();
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600], step = steps.find(s => s * st.zoom >= 70) || 600;
  g.font = '11px ' + cssVar('--mono'); g.fillStyle = muted; g.textAlign = 'left';
  for (let t = Math.floor(st.scroll / step) * step; t <= st.scroll + areaW / st.zoom; t += step) {
    const x = tlX(st, t); if (x < TL.HEAD) continue;
    g.strokeStyle = line2; g.beginPath(); g.moveTo(x + 0.5, TL.RULER - 6); g.lineTo(x + 0.5, H); g.stroke();
    g.fillText(C.ts(t), x + 3, 9);
  }
  g.fillStyle = muted; g.font = '600 10px ' + cssVar('--mono');
  for (const sc of r.lay.scenes || []) { const x = tlX(st, sc.start); if (x < TL.HEAD - 2 || x > W) continue; g.strokeStyle = muted; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); g.setLineDash([]); g.fillText('СЦЕНА ' + sc.n, x + 4, TL.RULER + 7); }
  const drag = st.drag, multi = drag && drag.moved && drag.group;
  const shift = clip => !drag || !drag.moved ? 0 : multi ? (drag.group.has(clip.row.cue.id) ? drag.delta : 0) : (drag.own ? clip.idx === drag.clip.idx : clip.idx >= drag.clip.idx) ? drag.delta : 0;
  g.save(); g.beginPath(); g.rect(TL.HEAD, TL.RULER, areaW, H - TL.RULER); g.clip();
  const pad = Math.max(5, Math.round(ROW * 0.14));
  tracks.forEach((tr, i) => {
    const y = TL.RULER + i * ROW + pad, h = ROW - 2 * pad, [col, soft] = tlColor(tr);
    for (const clip of tr.clips) {
      const at = clip.row.at + shift(clip), x0 = tlX(st, at), w = Math.max(3, clip.row.dur * st.zoom);
      if (x0 + w < TL.HEAD || x0 > W) continue;
      const sel = st.sel.has(clip.row.cue.id), menu = st.menuIds && st.menuIds.has(clip.row.cue.id);
      g.beginPath(); g.roundRect(x0, y, w, h, 5);
      if (clip.kind === 'pause') { g.setLineDash([4, 3]); g.strokeStyle = sel ? ink : col; g.lineWidth = sel ? 2 : 1; g.stroke(); g.setLineDash([]); g.lineWidth = 1; }
      else { g.fillStyle = sel ? col : soft; g.globalAlpha = clip.kind === 'bed' ? 0.55 : sel ? 0.35 : 1; g.fill(); g.globalAlpha = 1; g.strokeStyle = sel || menu ? ink : col; g.lineWidth = sel ? 2 : 1; g.stroke(); g.lineWidth = 1; }
      if (clip.peaks && w >= 24) {
        g.strokeStyle = col; g.globalAlpha = 0.55; g.beginPath();
        const n = clip.peaks.length, mid = y + h / 2;
        for (let k = 0; k < n; k++) { const xx = x0 + 2 + k * (w - 4) / n, a = clip.peaks[k] * (h / 2 - 3); if (xx > W) break; g.moveTo(xx, mid - a); g.lineTo(xx, mid + a + 0.5); }
        g.stroke(); g.globalAlpha = 1;
      }
      if (clip.fx && w >= 12) { g.fillStyle = accent; g.beginPath(); g.arc(x0 + w - 6, y + 6, 3.2, 0, Math.PI * 2); g.fill(); }
      if (w >= 44) { g.save(); g.beginPath(); g.rect(x0 + 2, y, w - 12, h); g.clip(); g.fillStyle = ink; g.font = (clip.kind === 'pause' ? '' : '500 ') + (ROW >= 60 ? '12px ' : '11px ') + cssVar('--sans'); g.textBaseline = 'middle'; g.fillText((clip.kind === 'pause' ? '⏸ ' : '') + tlText(clip.row), x0 + 5, y + h / 2 + 0.5); g.restore(); }
    }
  });
  g.restore();
  if (st.band) { const b = st.band, x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1); g.fillStyle = accent; g.globalAlpha = 0.12; g.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0)); g.globalAlpha = 1; g.strokeStyle = accent; g.setLineDash([4, 3]); g.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0)); g.setLineDash([]); }
  if (S.result.out) { const x = tlX(st, tpTime()); if (x >= TL.HEAD && x <= W) { g.strokeStyle = cssVar('--bad'); g.lineWidth = 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.lineWidth = 1; g.fillStyle = cssVar('--bad'); g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 7); g.closePath(); g.fill(); } }
  if (drag && drag.moved) { g.fillStyle = ink; g.font = '600 12px ' + cssVar('--mono'); g.textAlign = 'right'; g.fillText(`${drag.delta > 0 ? '+' : ''}${drag.delta.toFixed(2)} с${drag.group ? ` (${drag.group.size} реплик)` : drag.own ? ' (только эта)' : ''}`, W - 8, 9); g.textAlign = 'left'; }
  st.W = W; st.H = H;
  drawOverview();
}
/** Мини-карта: весь спектакль, дорожки тонкими полосками, рамка — что видно сейчас. */
function drawOverview() {
  const cv = $('#tl-ov'), r = S.result; if (!cv || !r || !r.lay) return;
  const st = tlState(), tracks = S.tlTracks || [], W = Math.max(360, Math.floor(cv.clientWidth || 800)), H = TL.OV, dpr = window.devicePixelRatio || 1;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const total = r.lay.total, x = t => TL.HEAD + t / total * (W - TL.HEAD), lane = Math.max(1, (H - 6) / Math.max(1, tracks.length));
  g.fillStyle = cssVar('--surface'); g.fillRect(0, 0, W, H);
  g.fillStyle = cssVar('--muted'); g.font = '600 10px ' + cssVar('--mono'); g.textBaseline = 'middle'; g.fillText('ВЕСЬ СПЕКТАКЛЬ', 8, H / 2);
  tracks.forEach((tr, i) => { const [col] = tlColor(tr); g.fillStyle = col; g.globalAlpha = 0.75; for (const c of tr.clips) if (c.kind !== 'pause') g.fillRect(x(c.row.at), 3 + i * lane, Math.max(1, c.row.dur / total * (W - TL.HEAD)), Math.max(1, lane - 0.5)); });
  g.globalAlpha = 1;
  for (const sc of r.lay.scenes || []) { g.fillStyle = cssVar('--line'); g.fillRect(x(sc.start), 0, 1, H); }
  const vx0 = x(st.scroll), vx1 = x(Math.min(total, st.scroll + ((st.W || W) - TL.HEAD) / st.zoom));
  g.fillStyle = cssVar('--accent'); g.globalAlpha = 0.14; g.fillRect(vx0, 0, Math.max(3, vx1 - vx0), H); g.globalAlpha = 1;
  g.strokeStyle = cssVar('--accent'); g.lineWidth = 1.5; g.strokeRect(vx0 + 0.5, 1, Math.max(3, vx1 - vx0) - 1, H - 2); g.lineWidth = 1;
  if (r.out) { const px = x(tpTime()); g.fillStyle = cssVar('--bad'); g.fillRect(px - 1, 0, 2, H); }
}
function tlPos(e) { const r = $('#tl-cv').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
/** Что под курсором: {clip, track} | {ruler} | {head, track} | {empty}. */
function tlHit(e) {
  const st = tlState(), { x, y } = tlPos(e), tracks = S.tlTracks || [];
  if (y < TL.RULER) return { ruler: true, t: tlT(st, x) };
  const ti = Math.floor((y - TL.RULER) / st.row), tr = tracks[ti];
  if (x < TL.HEAD) return tr ? { head: true, track: tr } : null;
  if (!tr) return { empty: true, t: tlT(st, x) };
  const t = tlT(st, x); let best = null;
  for (const clip of tr.clips) { const w = Math.max(3 / st.zoom, clip.row.dur); if (t >= clip.row.at && t <= clip.row.at + w) best = clip; }
  return best && !best.fixed ? { clip: best, track: tr, t } : { empty: true, t, track: tr };
}
function tlInBand(b) {
  const st = tlState(), x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1), out = [];
  (S.tlTracks || []).forEach((tr, i) => {
    const ty0 = TL.RULER + i * st.row + 6, ty1 = ty0 + st.row - 12; if (ty1 < y0 || ty0 > y1) return;
    for (const c of tr.clips) { if (c.fixed) continue; const cx0 = tlX(st, c.row.at), cx1 = cx0 + Math.max(3, c.row.dur * st.zoom); if (cx1 >= x0 && cx0 <= x1) out.push(c); }
  });
  return out;
}
function tlMinDelta(clip, own) {
  const rows = S.result.lay.rows; let prev = null;
  for (let i = clip.idx - 1; i >= 0; i--) { const rw = rows[i]; if (!rw.bed && (own || !rw.sound)) { prev = rw; break; } }
  return prev ? (prev.at + 0.1) - clip.row.at : -clip.row.at;
}
function tlShift(id, delta, own) {
  const tmg = S.timing[id] || (S.timing[id] = { before: 0, own: 0 });
  if (own) tmg.own = +((tmg.own || 0) + delta).toFixed(2); else tmg.before = +((tmg.before || 0) + delta).toFixed(2);
  if (!tmg.before && !tmg.own) delete S.timing[id];
}
const nReplik = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'реплики' : 'реплик'}`;
function tlCommit(clips, delta, own) {
  if (!clips.length) return;
  histPush(`сдвиг ${clips.length > 1 ? nReplik(clips.length) : 'реплики ' + clips[0].row.cue.id} на ${delta > 0 ? '+' : ''}${delta.toFixed(2)} с`);
  for (const c of clips) tlShift(c.row.cue.id, delta, own); saveEdits(); remixSoon('layout');
}
function tlSeek(t, play = false) { tpSeek(Math.max(0, t), play ? true : null); drawTimeline(); }
const tlItems = ids => [...ids].map(id => S.result.byId && S.result.byId.get(id)).filter(Boolean);
function tlSelItems() { return tlItems(tlState().sel); }
// ------------------------------------------------------------------ правки (все — через историю)
function tlApplyFx(ids, key) {
  const items = tlItems(ids); if (!items.length) return;
  histPush(`${key ? `эффект «${FX_PRESETS[key].name}»` : 'эффект как у персонажа'} у ${items.length > 1 ? nReplik(items.length) : 'реплики ' + items[0].id}`);
  for (const it of items) { if (key) S.fxLine[it.id] = key; else delete S.fxLine[it.id]; }
  saveEdits(); remixSoon('lines', items.map(it => it.id)); tlRefreshInfo();
}
function tlApplyGain(ids, d) {
  const items = tlItems(ids); if (!items.length) return;
  histPush(`громкость ${d == null ? '0 дБ' : (d > 0 ? '+' : '') + d + ' дБ'} у ${items.length > 1 ? nReplik(items.length) : 'реплики ' + items[0].id}`);
  for (const it of items) { const v = d == null ? 0 : (S.gains[it.id] || 0) + d; if (v) S.gains[it.id] = v; else delete S.gains[it.id]; }
  saveEdits(); remixSoon('lines', items.map(it => it.id)); tlRefreshInfo();
}
function tlResetShift(ids) {
  const list = [...ids].filter(id => S.timing[id]); if (!list.length) return;
  histPush(`сброс сдвига у ${list.length > 1 ? nReplik(list.length) : 'реплики ' + list[0]}`);
  for (const id of list) delete S.timing[id]; saveEdits(); remixSoon('layout');
}
function tlVoiceFx(voice, key) {
  histPush(`эффект персонажа ${charName(voice)}: ${key ? FX_PRESETS[key].name : 'как по пометкам'}`);
  if (key) S.fxVoice[voice] = key; else delete S.fxVoice[voice];
  saveEdits(); remixSoon('lines', voiceIds(voice)); renderMix();
}
function tlVoiceGain(voice, d) {
  histPush(`громкость персонажа ${charName(voice)} ${d == null ? '0 дБ' : (d > 0 ? '+' : '') + d + ' дБ'}`);
  const v = d == null ? 0 : Math.max(-12, Math.min(6, (S.voiceGains[voice] || 0) + d)); if (v) S.voiceGains[voice] = v; else delete S.voiceGains[voice];
  saveEdits(); remixSoon('lines', voiceIds(voice)); renderMix();
}
// ------------------------------------------------------------------ панели
function tlInfoHtml() {
  const st = tlState(), r = S.result; if (!r || !st.sel.size) return '<span class="muted">Щёлкните реплику · Ctrl или Shift+щелчок — добавить · протяжка по пустому месту — рамка · щелчок по имени дорожки — все реплики персонажа · <b>правый щелчок — меню</b> · тянуть реплику — двигать, с Alt — только её · колёсико — масштаб · пробел — играть · Ctrl+Z — отменить</span>';
  const fxSel = (cur, auto) => `<label>эффект <select data-act="tl-fx"><option value="">${auto || 'как у персонажа'}</option>${Object.entries(FX_PRESETS).map(([k, p]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${p.name}</option>`).join('')}</select></label>`;
  const gainBtns = `<span class="gain">громкость <button class="icon" data-act="tl-g-" aria-label="Тише на 1 дБ">−</button><button class="icon" data-act="tl-g+" aria-label="Громче на 1 дБ">+</button></span>`;
  if (st.sel.size > 1) {
    const items = tlSelItems(), by = new Map(); for (const id of st.sel) { const row = r.lay.rows.find(x => x.cue.id === id); if (!row) continue; const k = row.sound ? 'звуки' : row.cue.type === 'line' ? charName(row.cue.spk) : 'ремарки'; by.set(k, (by.get(k) || 0) + 1); }
    const fxs = new Set(items.map(it => S.fxLine[it.id] || '')), shifted = [...st.sel].filter(id => S.timing[id]).length;
    return `<b>Выбрано ${st.sel.size}</b><span class="muted">${[...by].map(([k, n]) => `${esc(k)} ${n}`).join(', ')}</span>
      ${items.length ? fxSel(fxs.size === 1 ? [...fxs][0] : '', fxs.size === 1 ? '' : 'разные — выберите для всех') + gainBtns : ''}
      <button class="ghost-b tiny" data-act="tl-play">▶ с первой</button>${shifted ? `<button class="ghost-b tiny" data-act="tl-reset">сбросить сдвиги (${shifted})</button>` : ''}<button class="ghost-b tiny" data-act="tl-clear">снять выделение</button>`;
  }
  const id = [...st.sel][0], row = r.lay.rows.find(x => x.cue.id === id); if (!row) return '';
  const c = row.cue, tmg = S.timing[c.id] || {}, who = row.sound ? 'звук' : c.type === 'line' ? charName(c.spk) : 'ремарка';
  const it = r.byId && r.byId.get(c.id), auto = it ? (S.fxLine[c.id] ? null : fxOfLine(c, it.voice)) : null, g = S.gains[c.id] || 0;
  return `<span class="num">${esc(c.id)}</span><b>${esc(who)}</b><span class="tl-txt">«${esc(tlText(row).slice(0, 90))}»</span>
    <span>начало <b>${C.ts(row.at)}</b></span>${row.gap != null ? `<span>пауза перед <b>${row.gap.toFixed(2)} с</b></span>` : ''}
    ${tmg.before ? `<span>сдвиг <b>${tmg.before > 0 ? '+' : ''}${tmg.before.toFixed(2)} с</b></span>` : ''}${tmg.own ? `<span>только эта <b>${tmg.own > 0 ? '+' : ''}${tmg.own.toFixed(2)} с</b></span>` : ''}
    <button class="ghost-b tiny" data-act="tl-play">▶ отсюда</button>${tmg.before || tmg.own ? '<button class="ghost-b tiny" data-act="tl-reset">сбросить сдвиг</button>' : ''}
    ${it ? fxSel(S.fxLine[c.id] || '', auto && auto.key !== 'none' ? `сам: ${FX_PRESETS[auto.key].name} (${auto.why})` : 'без эффекта') + gainBtns + (g ? `<span><b>${g > 0 ? '+' : ''}${g} дБ</b></span>` : '') : ''}`;
}
function tlBarHtml() {
  const st = tlState(), n = Object.keys(S.timing).length, total = S.result && S.result.out ? S.result.out.length / C.SR : 0;
  return `<div class="tl-group tl-tp"><button class="play tp-play-btn" data-act="tp-play" aria-label="${TP.playing ? 'Пауза' : 'Играть'}" title="Играть и пауза (пробел)">${TP.playing ? ICON_PAUSE : ICON_PLAY}</button><span class="tp-time-txt">${fmt(tpTime())} / ${fmt(total)}</span></div>
    <div class="tl-group"><button class="icon-b" data-act="tl-undo" aria-label="Отменить">↶</button><button class="icon-b" data-act="tl-redo" aria-label="Повторить">↷</button></div>
    <div class="tl-group"><button class="icon-b" data-act="tl-zoom-" title="Мельче (−)" aria-label="Уменьшить масштаб">−</button><button class="ghost-b tiny" data-act="tl-fit" title="Весь спектакль (0)">весь</button><button class="icon-b" data-act="tl-zoom+" title="Крупнее (+)" aria-label="Увеличить масштаб">+</button></div>
    <div class="tl-group"><button class="ghost-b tiny ${st.own ? 'on' : ''}" data-act="tl-own" title="Двигать только выбранную реплику, не сдвигая остальные" aria-pressed="${st.own}">только эта реплика</button>${n ? `<button class="ghost-b tiny" data-act="tl-reset-all">сбросить все сдвиги (${n})</button>` : ''}</div>
    <button class="ghost-b tl-fullbtn" data-act="tl-full" title="${st.full ? 'Свернуть (Esc)' : 'Таймлайн на весь экран (F)'}">${st.full ? '✕ Свернуть' : '⛶ На весь экран'}</button>`;
}
function tlRefreshInfo() { const el = $('#tl-info'); if (el) el.innerHTML = tlInfoHtml(); drawTimeline(); }
function tlRefreshBar() { const el = $('.tl-bar'); if (el) el.innerHTML = tlBarHtml(); histUi(); }
function tlSelect(ids, add = false) { const st = tlState(); if (!add) st.sel.clear(); for (const id of ids) st.sel.add(id); tlRefreshInfo(); }
let tlTimer = null;
function tlFollow() {                                  // курсор плеера ведёт вид
  clearTimeout(tlTimer);
  const st = tlState(); drawTimeline();
  const total = S.result && S.result.out ? S.result.out.length / C.SR : 0;
  document.querySelectorAll('#tp-time, .tp-time-txt').forEach(el => { el.textContent = `${fmt(tpTime())} / ${fmt(total)}`; });
  const sk = $('#tp-seek'); if (sk && !sk.matches(':active')) sk.value = tpTime();
  if (!TP.playing) return;
  const x = tlX(st, tpTime()), W = st.W || 800; if (x > W - 40 || x < TL.HEAD) st.scroll = Math.max(0, tpTime() - (W - TL.HEAD) / st.zoom * 0.15);
  tlTimer = setTimeout(tlFollow, 80);
}
// ------------------------------------------------------------------ на весь экран
function tlSetFull(on) {
  const st = tlState(), el = $('#mix-out .tl'); if (!el) return;
  st.full = on; el.classList.toggle('full', on); document.body.classList.toggle('tl-full-open', on);
  if (on && el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  tlRefreshBar(); requestAnimationFrame(() => { drawTimeline(); $('#tl-cv').focus(); });
}
// ------------------------------------------------------------------ контекстное меню
const kbd = t => `<kbd>${t}</kbd>`;
function tlMenuHtml(ctx) {
  const st = tlState(), fx = (cur, attr) => `<div class="m-fx">${Object.entries(FX_PRESETS).map(([k, p]) => `<button role="menuitemradio" aria-checked="${cur === k}" class="${cur === k ? 'on' : ''}" data-m="${attr}" data-v="${k}">${p.name}</button>`).join('')}<button role="menuitemradio" aria-checked="${!cur}" class="${!cur ? 'on' : ''}" data-m="${attr}" data-v="">${attr === 'fx' ? 'как у персонажа' : 'по пометкам'}</button></div>`;
  const gains = attr => `<div class="m-row">${[-3, -1, 1, 3].map(d => `<button role="menuitem" data-m="${attr}" data-v="${d}">${d > 0 ? '+' : '−'}${Math.abs(d)} дБ</button>`).join('')}<button role="menuitem" data-m="${attr}" data-v="0">0</button></div>`;
  const undo = HIST.undo[HIST.undo.length - 1], redo = HIST.redo[HIST.redo.length - 1];
  const hist = `<div class="m-sep"></div><button role="menuitem" data-m="undo" ${undo ? '' : 'disabled'}><span>↶ Отменить${undo ? ': ' + esc(undo.label) : ''}</span>${kbd('Ctrl+Z')}</button><button role="menuitem" data-m="redo" ${redo ? '' : 'disabled'}><span>↷ Повторить${redo ? ': ' + esc(redo.label) : ''}</span>${kbd('Ctrl+Shift+Z')}</button>`;
  if (ctx.track) {
    const tr = ctx.track, v = tr.voice, cur = v ? S.fxVoice[v] || '' : '', g = v ? S.voiceGains[v] || 0 : 0;
    return `<div class="m-head"><span class="chip ${tr.cls}">${esc(tr.name)}</span><span>${tr.clips.filter(c => !c.fixed).length} на дорожке</span></div>
      <button role="menuitem" data-m="seltrack"><span>Выделить все реплики</span>${kbd('щелчок по имени')}</button>
      ${v && v !== 'ремарки' ? `<div class="m-lbl">Эффект персонажа</div>${fx(cur, 'vfx')}<div class="m-lbl">Громкость персонажа <b>${g > 0 ? '+' : ''}${g} дБ</b></div>${gains('vg')}` : ''}${hist}`;
  }
  const ids = ctx.ids, n = ids.size, items = tlItems(ids), first = [...ids][0], row = n ? S.result.lay.rows.find(x => x.cue.id === first) : null;
  const head = n > 1 ? `<b>Выбрано ${n}</b>` : row ? `<span class="num">${esc(row.cue.id)}</span><b>${esc(row.sound ? 'звук' : row.cue.type === 'line' ? charName(row.cue.spk) : 'ремарка')}</b><span class="m-txt">«${esc(tlText(row).slice(0, 48))}»</span>` : '<b>Таймлайн</b>';
  const fxs = new Set(items.map(it => S.fxLine[it.id] || '')), cur = fxs.size === 1 ? [...fxs][0] : null, shifted = [...ids].some(id => S.timing[id]);
  const voice = n === 1 && row && row.cue.type === 'line' ? row.cue.spk : null;
  return `<div class="m-head">${head}</div>
    ${ctx.t != null ? `<button role="menuitem" data-m="play" data-v="${ctx.t}"><span>▶ Слушать ${n ? 'с реплики' : 'отсюда'}</span>${kbd(n ? 'двойной щелчок' : 'пробел')}</button>` : ''}
    ${items.length ? `<div class="m-lbl">Эффект${n > 1 ? ' для всех выбранных' : ''}</div>${fx(cur === null ? '—' : cur, 'fx')}<div class="m-lbl">Громкость${n > 1 ? ' выбранных' : ''}</div>${gains('g')}` : ''}
    ${n ? `<div class="m-lbl">Время</div><div class="m-row"><button role="menuitem" data-m="nudge" data-v="-0.5">← 0,5 с</button><button role="menuitem" data-m="nudge" data-v="-0.1">← 0,1 с</button><button role="menuitem" data-m="nudge" data-v="0.1">0,1 с →</button><button role="menuitem" data-m="nudge" data-v="0.5">0,5 с →</button></div>${shifted ? `<button role="menuitem" data-m="reset"><span>Сбросить сдвиг</span></button>` : ''}` : ''}
    <div class="m-sep"></div>
    ${voice ? `<button role="menuitem" data-m="selvoice" data-v="${esc(voice)}"><span>Выделить все реплики: ${esc(charName(voice))}</span></button>` : ''}
    <button role="menuitem" data-m="selall"><span>Выделить всё</span>${kbd('Ctrl+A')}</button>
    ${n ? `<button role="menuitem" data-m="clear"><span>Снять выделение</span>${kbd('Esc')}</button>` : ''}
    <button role="menuitem" data-m="full"><span>${tlState().full ? 'Свернуть таймлайн' : 'Таймлайн на весь экран'}</span>${kbd(tlState().full ? 'Esc' : 'F')}</button>${hist}`;
}
function tlMenuOpen(cx, cy, ctx) {
  const st = tlState(), m = $('#tl-menu'); if (!m) return;
  st.menu = ctx; st.menuIds = ctx.ids || null;
  m.innerHTML = tlMenuHtml(ctx); m.hidden = false;
  const r = m.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
  m.style.left = Math.max(8, Math.min(cx, vw - r.width - 8)) + 'px'; m.style.top = Math.max(8, Math.min(cy, vh - r.height - 8)) + 'px';
  drawTimeline();
  const f = m.querySelector('button:not([disabled])'); if (f) f.focus();
}
function tlMenuClose(refocus = true) { const st = tlState(), m = $('#tl-menu'); if (!m || m.hidden) return; m.hidden = true; st.menu = null; st.menuIds = null; drawTimeline(); if (refocus) $('#tl-cv')?.focus(); }
function tlMenuAct(b) {
  const st = tlState(), ctx = st.menu, a = b.dataset.m, v = b.dataset.v; if (!ctx) return;
  const ids = ctx.ids || new Set(), keep = ['fx', 'g', 'vfx', 'vg', 'nudge'].includes(a);
  if (a === 'play') { tlSeek(+v, true); }
  else if (a === 'fx') tlApplyFx(ids, v || null);
  else if (a === 'g') tlApplyGain(ids, +v === 0 ? null : +v);
  else if (a === 'nudge') { const clips = tlAllClips().filter(c => ids.has(c.row.cue.id)), own = clips.length > 1 || st.own; if (clips.length) tlCommit(clips, Math.max(Math.max(...clips.map(c => tlMinDelta(c, own))), +v), own); }
  else if (a === 'reset') tlResetShift(ids);
  else if (a === 'vfx') tlVoiceFx(ctx.track.voice, v || null);
  else if (a === 'vg') tlVoiceGain(ctx.track.voice, +v === 0 ? null : +v);
  else if (a === 'seltrack') tlSelect(ctx.track.clips.filter(c => !c.fixed).map(c => c.row.cue.id));
  else if (a === 'selvoice') tlSelect(tlAllClips().filter(c => !c.fixed && c.row.cue.type === 'line' && c.row.cue.spk === v).map(c => c.row.cue.id));
  else if (a === 'selall') tlSelect(tlAllClips().filter(c => !c.fixed).map(c => c.row.cue.id));
  else if (a === 'clear') tlSelect([]);
  else if (a === 'full') { tlMenuClose(false); tlSetFull(!st.full); return; }
  else if (a === 'undo') histUndo();
  else if (a === 'redo') histRedo();
  if (keep && st.menu) { const sc = $('#tl-menu').scrollTop; tlMenuOpen(parseFloat($('#tl-menu').style.left), parseFloat($('#tl-menu').style.top), st.menu); $('#tl-menu').scrollTop = sc; const again = $('#tl-menu').querySelector(`[data-m="${a}"][data-v="${CSS.escape(v || '')}"]`); if (again) again.focus(); }
  else tlMenuClose();
}
/** Меню с клавиатуры: у выбранной реплики или в начале видимой части. */
function tlMenuFromKeys() {
  const st = tlState(), cv = $('#tl-cv'), r = cv.getBoundingClientRect(), clips = tlAllClips().filter(c => st.sel.has(c.row.cue.id));
  if (clips.length) { const c = clips[0], ti = (S.tlTracks || []).findIndex(t => t.clips.includes(c)); tlMenuOpen(r.left + Math.max(TL.HEAD, tlX(st, c.row.at)) + 10, r.top + TL.RULER + ti * st.row + st.row, { ids: new Set(st.sel), t: c.row.at }); }
  else tlMenuOpen(r.left + TL.HEAD + 20, r.top + TL.RULER + 10, { ids: new Set(), t: st.scroll });
}
function tlZoom(k, cx = null) { const st = tlState(), W = st.W || 800, mx = cx ?? (TL.HEAD + (W - TL.HEAD) / 2), t = tlT(st, mx); st.zoom = Math.max((W - TL.HEAD) / S.result.lay.total, Math.min(TL.MAX_ZOOM, st.zoom * k)); st.scroll = t - (mx - TL.HEAD) / st.zoom; drawTimeline(); }
function bindTimeline() {
  const host = $('#mix-out');
  host.addEventListener('contextmenu', e => {
    if (e.target.id !== 'tl-cv') return; e.preventDefault();
    const st = tlState(), hit = tlHit(e); if (!hit) return;
    if (hit.head) { tlMenuOpen(e.clientX, e.clientY, { track: hit.track }); return; }
    if (hit.clip) { const id = hit.clip.row.cue.id; if (!st.sel.has(id)) tlSelect([id]); tlMenuOpen(e.clientX, e.clientY, { ids: new Set(st.sel), t: hit.clip.row.at }); return; }
    tlMenuOpen(e.clientX, e.clientY, { ids: new Set(st.sel), t: hit.t != null ? Math.max(0, hit.t) : null });
  });
  host.addEventListener('pointerdown', e => {
    if (e.target.id === 'tl-ov') { const st = tlState(); st.ovDrag = true; tlOvSeek(e); try { e.target.setPointerCapture(e.pointerId); } catch {} return; }
    if (e.target.id !== 'tl-cv' || e.button === 2) return;
    tlMenuClose(false);
    const st = tlState(), hit = tlHit(e), add = e.ctrlKey || e.metaKey || e.shiftKey, pos = tlPos(e); e.target.focus();
    if (!hit) return;
    if (e.button === 1 || (e.altKey && !hit.clip)) st.pan = { x0: e.clientX, scroll0: st.scroll };
    else if (hit.ruler) { st.scrub = true; tlSeek(hit.t); }
    else if (hit.head) { const ids = hit.track.clips.filter(c => !c.fixed).map(c => c.row.cue.id); tlSelect(ids, add); }
    else if (hit.clip && add) { st.band = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y, add: true, base: new Set(st.sel), toggle: hit.clip.row.cue.id }; }
    else if (hit.clip) {
      const id = hit.clip.row.cue.id, inGroup = st.sel.size > 1 && st.sel.has(id);
      const group = inGroup ? new Set(st.sel) : null, own = e.altKey || st.own || !!group;
      const clips = group ? tlAllClips().filter(c => group.has(c.row.cue.id)) : [hit.clip];
      const min = Math.max(...clips.map(c => tlMinDelta(c, own)));
      st.drag = { clip: hit.clip, x0: e.clientX, delta: 0, own, moved: false, min, group, clips };
    }
    else st.band = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y, add, base: new Set(add ? st.sel : []) };
    try { e.target.setPointerCapture(e.pointerId); } catch {}
  });
  host.addEventListener('pointermove', e => {
    if (e.target.id === 'tl-ov') { if (tlState().ovDrag) tlOvSeek(e); return; }
    if (e.target.id !== 'tl-cv') return;
    const st = tlState();
    if (st.drag) { const d = (e.clientX - st.drag.x0) / st.zoom; if (Math.abs(e.clientX - st.drag.x0) > 3) st.drag.moved = true; st.drag.delta = Math.max(st.drag.min, Math.min(60, d)); drawTimeline(); }
    else if (st.band) {
      const p = tlPos(e); st.band.x1 = p.x; st.band.y1 = p.y;
      const inside = tlInBand(st.band).map(c => c.row.cue.id); st.sel = new Set(st.band.base); for (const id of inside) st.sel.add(id);
      if (p.x > (st.W || 800) - 20) st.scroll += 8 / st.zoom; else if (p.x < TL.HEAD + 10) st.scroll -= 8 / st.zoom;
      drawTimeline();
    }
    else if (st.pan) { st.scroll = st.pan.scroll0 - (e.clientX - st.pan.x0) / st.zoom; drawTimeline(); }
    else if (st.scrub) { const hit = tlHit(e); if (hit && hit.t != null) tlSeek(hit.t); }
    else { const hit = tlHit(e); e.target.style.cursor = hit && hit.clip ? 'grab' : hit && hit.ruler ? 'col-resize' : hit && hit.head ? 'pointer' : 'crosshair'; }
  });
  const up = () => {
    const st = tlState(); st.ovDrag = false;
    if (st.drag) {
      const d = st.drag; st.drag = null;
      if (d.moved && Math.abs(d.delta) >= 0.01) { if (!d.group) st.sel = new Set([d.clip.row.cue.id]); tlCommit(d.clips, d.delta, d.own); }
      else tlSelect([d.clip.row.cue.id]);
    }
    if (st.band) {
      const b = st.band; st.band = null;
      if (Math.abs(b.x1 - b.x0) < 4 && Math.abs(b.y1 - b.y0) < 4) { if (b.toggle) { if (b.base.has(b.toggle)) st.sel.delete(b.toggle); else st.sel.add(b.toggle); } else if (!b.add) st.sel.clear(); }
      tlRefreshInfo();
    }
    st.pan = null; st.scrub = false; drawTimeline();
  };
  host.addEventListener('pointerup', e => { if (e.target.id === 'tl-cv' || e.target.id === 'tl-ov') up(); });
  host.addEventListener('pointercancel', e => { if (e.target.id === 'tl-cv' || e.target.id === 'tl-ov') up(); });
  host.addEventListener('dblclick', e => { if (e.target.id !== 'tl-cv') return; const hit = tlHit(e); if (hit && hit.clip) tlSeek(hit.clip.row.at, true); });
  host.addEventListener('wheel', e => {
    if (e.target.id !== 'tl-cv' && e.target.id !== 'tl-ov') return; e.preventDefault();
    const st = tlState(), mx = e.target.id === 'tl-cv' ? tlPos(e).x : null;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.target.id === 'tl-ov') { st.scroll += (e.deltaX || e.deltaY) / st.zoom; drawTimeline(); }
    else tlZoom(Math.pow(1.25, -e.deltaY / 100), mx);
  }, { passive: false });
  host.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('#tl-menu')) {         // меню: стрелки, Enter, Esc
      const items = [...$('#tl-menu').querySelectorAll('button:not([disabled])')], i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); tlMenuClose(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      return;
    }
    if (e.target.id !== 'tl-cv' || !S.result) return; const st = tlState();
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); tlMenuFromKeys(); return; }
    if (e.key === 'Escape') { if (st.sel.size) tlSelect([]); else if (st.full) tlSetFull(false); return; }
    if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') { if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); tlSetFull(!st.full); return; } }
    if (e.key === '+' || e.key === '=') { tlZoom(1.5); return; }
    if (e.key === '-' || e.key === '_') { tlZoom(1 / 1.5); return; }
    if (e.key === '0') { st.zoom = 0; st.scroll = 0; drawTimeline(); return; }
    if (e.key === 'Home') { tlSeek(0); st.scroll = 0; drawTimeline(); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') { e.preventDefault(); tlSelect(tlAllClips().filter(c => !c.fixed).map(c => c.row.cue.id)); return; }
    if (!st.sel.size || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return; e.preventDefault();
    const clips = tlAllClips().filter(c => st.sel.has(c.row.cue.id)); if (!clips.length) return;
    const own = e.altKey || st.own || clips.length > 1, step = (e.shiftKey ? 0.5 : 0.05) * (e.key === 'ArrowLeft' ? -1 : 1);
    tlCommit(clips, Math.max(Math.max(...clips.map(c => tlMinDelta(c, own))), step), own);
  });
  host.addEventListener('click', e => {
    const mb = e.target.closest('#tl-menu button'); if (mb) { tlMenuAct(mb); return; }
    const b = e.target.closest('button'); if (!b || !b.dataset.act) return; const st = tlState(), a = b.dataset.act;
    if (a === 'tl-fit') { st.zoom = 0; st.scroll = 0; drawTimeline(); }
    else if (a === 'tl-zoom+') tlZoom(1.5);
    else if (a === 'tl-zoom-') tlZoom(1 / 1.5);
    else if (a === 'tl-full') tlSetFull(!st.full);
    else if (a === 'tl-undo') histUndo();
    else if (a === 'tl-redo') histRedo();
    else if (a === 'tl-own') { st.own = !st.own; b.classList.toggle('on', st.own); b.setAttribute('aria-pressed', st.own); }
    else if (a === 'tl-reset-all') { histPush('сброс всех сдвигов'); S.timing = {}; saveEdits(); remixSoon('layout'); }
    else if (a === 'tl-clear') tlSelect([]);
    else if (a === 'tl-play') { const rows = S.result.lay.rows.filter(x => st.sel.has(x.cue.id)); if (rows.length) tlSeek(Math.min(...rows.map(x => x.at)), true); }
    else if (a === 'tl-reset') tlResetShift(st.sel);
    else if (a === 'tl-g+' || a === 'tl-g-') tlApplyGain(st.sel, a === 'tl-g+' ? 1 : -1);
  });
  host.addEventListener('change', e => { const x = e.target; if (x.dataset.act !== 'tl-fx') return; tlApplyFx(tlState().sel, x.value || null); });
  document.addEventListener('pointerdown', e => { const m = $('#tl-menu'); if (m && !m.hidden && !m.contains(e.target) && e.target.id !== 'tl-cv') tlMenuClose(false); });
  document.addEventListener('fullscreenchange', () => { const st = tlState(); if (!document.fullscreenElement && st.full) tlSetFull(false); else drawTimeline(); });
  window.addEventListener('resize', () => drawTimeline());
}
function tlOvSeek(e) {                                 // мини-карта: щелчок и протяжка — сюда вид
  const cv = $('#tl-ov'), st = tlState(), r = cv.getBoundingClientRect(), W = r.width, total = S.result.lay.total;
  const t = (e.clientX - r.left - TL.HEAD) / (W - TL.HEAD) * total, span = ((st.W || W) - TL.HEAD) / st.zoom;
  st.scroll = Math.max(0, t - span / 2); drawTimeline();
}
