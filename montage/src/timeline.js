// Монтажка — таймлайн сведения: дорожки по персонажам, реплики двигаются и выделяются мышью.
// Щелчок — выбрать реплику; Ctrl/Shift+щелчок — добавить или убрать; протяжка по пустому месту — рамка;
// щелчок по имени дорожки — все реплики персонажа. Правый щелчок (или клавиша меню, Shift+F10) — меню:
// эффект, громкость, сдвиг, выделение, отмена. Тянуть реплику — пауза перед ней (всё дальше едет следом);
// с Alt или при нескольких выбранных — двигаются только они. Колёсико — масштаб, Shift+колёсико или
// Alt+протяжка — прокрутка, мини-карта снизу — весь спектакль. «На весь экран» — таймлайн во весь монитор.
// Щипок (тачпад или два пальца) — масштаб за пальцами, у пределов резина; линейку и курсор плеера тянут со звуком.
// Пальцем: по пустому — листать, короткое касание реплики — выбрать, долгое — поднять и двигать.
// Использует S, $, esc, fmt, charName, colorOf, cssVar, saveEdits, remixSoon, voiceIds, TP, tpTime, tpSeek,
// tpPlay, tpPause из app.js; histPush, histUndo, histRedo, histUi, tlFlash из history.js; C — ядро.
const TL = { HEAD: 150, RULER: 22, PAD: 6, MAX_ZOOM: 400, OV: 30 };
// Живые детали таймлайна на пружинах (spring.js): подъём взятой реплики, подсветка под курсором, пульс при
// приземлении и выделении, гаснущая рамка. Всё рисуется в drawTimeline, пружины просят перерисовку сами.
const TLFX = { liftIds: null, hoverId: null, pulse: null, band: null };
TLFX.owner = { render() { drawTimeline(); if (TLFX.pulse && !SPRING.live.has(TLFX.pulse.m)) TLFX.pulse = null; if (TLFX.band && !SPRING.live.has(TLFX.band.m)) TLFX.band = null; if (TLFX.liftIds && TLFX.lift.v < 0.003 && !SPRING.live.has(TLFX.lift)) TLFX.liftIds = null; } };
TLFX.lift = mv(0, 0.002, TLFX.owner); TLFX.hover = mv(0, 0.01, TLFX.owner);
function tlLiftUp(clips) { TLFX.liftIds = new Set(clips.map(c => c.row.cue.id)); mvTo(TLFX.lift, 1, { damping: 0.7, response: 0.22 }); try { navigator.vibrate && navigator.vibrate(5); } catch {} }
function tlPulse(ids) { if (!ids.size || ids.size > 60 || (typeof MOTION !== 'undefined' && (MOTION.reduce || !MOTION.ready))) return; TLFX.pulse = { ids: new Set(ids), m: mv(0, 0.004, TLFX.owner) }; mvTo(TLFX.pulse.m, 1, { damping: 1, response: 0.5 }); }
/** Прилипание при перетаскивании: край реплики тянется к краю соседней (на любой дорожке), к курсору плеера и к
 *  началу сцены, если до него меньше 7 px. Возвращает сдвиг с прилипанием и время, к которому прилипло. */
function tlSnap(st, d) {
  const dr = st.drag, c = dr.clip, tol = 7 / st.zoom, moving = x => dr.group ? dr.group.has(x.row.cue.id) : dr.own ? x === c : x.idx >= c.idx;
  const edges = [c.row.at, c.row.at + c.row.dur]; let best = null;
  const test = T => { for (const e of edges) { const diff = T - (e + d); if (Math.abs(diff) < tol && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, t: T }; } };
  test(tpTime()); for (const sc of (S.result && S.result.lay.scenes) || []) test(sc.start);
  const t0 = st.scroll - 5, t1 = st.scroll + ((st.W || 800) - TL.HEAD) / st.zoom + 5;
  for (const x of tlAllClips()) { if (x.fixed || x.idx < 0 || moving(x)) continue; const a = x.row.at, b = a + x.row.dur; if (b < t0 || a > t1) continue; test(a); test(b); }
  return best ? { d: d + best.diff, t: best.t } : { d, t: null };
}
let tlLastInput = 'pointer';                           // чем закрыли меню: с клавиатуры — без анимации
addEventListener('keydown', () => { tlLastInput = 'key'; }, true); addEventListener('pointerdown', () => { tlLastInput = 'pointer'; }, true);
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
  // во время щипка масштаб может зайти за предел (резина) — тогда и прокрутка отпускается, пока не отпружинит
  st.zoom = st.elastic ? Math.max(minZoom * 0.5, Math.min(TL.MAX_ZOOM * 2, st.zoom)) : Math.max(minZoom, Math.min(TL.MAX_ZOOM, st.zoom));
  const sMax = total - areaW / st.zoom;
  st.scroll = st.elastic ? Math.max(Math.min(0, sMax), Math.min(Math.max(0, sMax), st.scroll)) : Math.max(0, Math.min(Math.max(0, sMax), st.scroll));
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
  if (st.elastic) { const xa = tlX(st, 0), xb = tlX(st, total); g.fillStyle = cssVar('--well'); if (xa > TL.HEAD) g.fillRect(TL.HEAD, TL.RULER, xa - TL.HEAD, H); if (xb < W) g.fillRect(xb, TL.RULER, W - xb, H); }
  g.fillStyle = surface; g.fillRect(TL.HEAD, 0, areaW, TL.RULER); g.strokeStyle = line; g.beginPath(); g.moveTo(TL.HEAD, TL.RULER + 0.5); g.lineTo(W, TL.RULER + 0.5); g.stroke();
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600], step = steps.find(s => s * st.zoom >= 70) || 600;
  g.font = '11px ' + cssVar('--mono'); g.fillStyle = muted; g.textAlign = 'left';
  for (let t = Math.floor(st.scroll / step) * step; t <= st.scroll + areaW / st.zoom; t += step) {
    const x = tlX(st, t); if (x < TL.HEAD || t < 0 || t > total + 0.01) continue;
    g.strokeStyle = line2; g.beginPath(); g.moveTo(x + 0.5, TL.RULER - 6); g.lineTo(x + 0.5, H); g.stroke();
    g.fillText(C.ts(t), x + 3, 9);
  }
  g.fillStyle = muted; g.font = '600 10px ' + cssVar('--mono');
  for (const sc of r.lay.scenes || []) { const x = tlX(st, sc.start); if (x < TL.HEAD - 2 || x > W) continue; g.strokeStyle = muted; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); g.setLineDash([]); g.fillText('СЦЕНА ' + sc.n, x + 4, TL.RULER + 7); }
  const drag = st.drag, multi = drag && drag.moved && drag.group;
  const settle = st.settle && st.settle.m.v, sAt = clip => st.settle && (st.settle.ids ? st.settle.ids.has(clip.row.cue.id) : st.settle.own ? clip.idx === st.settle.idx : clip.idx >= st.settle.idx) ? settle : 0;
  const shift = clip => !drag || !drag.moved ? (settle ? sAt(clip) : 0) : multi ? (drag.group.has(clip.row.cue.id) ? drag.delta : 0) : (drag.own ? clip.idx === drag.clip.idx : clip.idx >= drag.clip.idx) ? drag.delta : 0;
  g.save(); g.beginPath(); g.rect(TL.HEAD, TL.RULER, areaW, H - TL.RULER); g.clip();
  const pad = Math.max(5, Math.round(ROW * 0.14)), FX = TLFX, lift = FX.lift.v, pk = FX.pulse ? FX.pulse.m.v : 0;
  tracks.forEach((tr, i) => {
    const y0 = TL.RULER + i * ROW + pad, h0 = ROW - 2 * pad, [col, soft] = tlColor(tr);
    for (const clip of tr.clips) {
      const at = clip.row.at + shift(clip), x0 = tlX(st, at), w = Math.max(3, clip.row.dur * st.zoom);
      if (x0 + w < TL.HEAD || x0 > W) continue;
      const id = clip.row.cue.id, sel = st.sel.has(id), menu = st.menuIds && st.menuIds.has(id);
      // взятая реплика приподнята: выше, чуть больше и с тенью; отпущенная — опускается на пружине
      const L = lift > 0.002 && FX.liftIds && FX.liftIds.has(id) ? lift : 0, y = y0 - 3 * L, h = h0 + 2 * L;
      if (L) { g.save(); g.shadowColor = `rgba(0,0,0,${(0.38 * L).toFixed(3)})`; g.shadowBlur = 16 * L; g.shadowOffsetY = 6 * L; }
      g.beginPath(); g.roundRect(x0, y, w, h, 5);
      if (clip.kind === 'pause') { if (L) g.restore(); g.setLineDash([4, 3]); g.strokeStyle = sel ? ink : col; g.lineWidth = sel ? 2 : 1; g.stroke(); g.setLineDash([]); g.lineWidth = 1; }
      else {
        if (L) { g.fillStyle = soft; g.fill(); g.restore(); }            // непрозрачная подложка отбрасывает тень, контур и выделение — уже без неё
        g.fillStyle = sel ? col : soft; g.globalAlpha = clip.kind === 'bed' ? 0.55 : sel ? 0.35 : 1; g.fill(); g.globalAlpha = 1;
        g.strokeStyle = sel || menu || L ? ink : col; g.lineWidth = sel || L ? 2 : 1; g.stroke(); g.lineWidth = 1;
      }
      if (FX.hoverId === id && FX.hover.v > 0.01 && !L) { g.fillStyle = ink; g.globalAlpha = 0.07 * FX.hover.v; g.fill(); g.globalAlpha = 0.5 * FX.hover.v; g.strokeStyle = ink; g.lineWidth = 1.5; g.stroke(); g.globalAlpha = 1; g.lineWidth = 1; }
      if (pk && FX.pulse.ids.has(id)) { const e = 7 * pk; g.beginPath(); g.roundRect(x0 - e, y - e, w + 2 * e, h + 2 * e, 5 + e); g.strokeStyle = accent; g.globalAlpha = (1 - pk) * 0.9; g.lineWidth = 2; g.stroke(); g.globalAlpha = 1; g.lineWidth = 1; }
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
  const bgh = TLFX.band; if (!st.band && bgh && bgh.m.v > 0.02) { g.globalAlpha = bgh.m.v; g.fillStyle = accent; g.globalAlpha = 0.12 * bgh.m.v; g.fillRect(bgh.x, bgh.y, bgh.w, bgh.h); g.globalAlpha = 0.8 * bgh.m.v; g.strokeStyle = accent; g.setLineDash([4, 3]); g.strokeRect(bgh.x + 0.5, bgh.y + 0.5, bgh.w, bgh.h); g.setLineDash([]); g.globalAlpha = 1; }   // рамка гаснет, а не пропадает
  if (st.band) { const b = st.band, x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1); g.fillStyle = accent; g.globalAlpha = 0.12; g.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0)); g.globalAlpha = 1; g.strokeStyle = accent; g.setLineDash([4, 3]); g.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0)); g.setLineDash([]); }
  tlHeadUpdate();
  if (drag && drag.moved) {
    // прилипание: пунктир там, к чему прилипло (край соседней реплики, курсор, начало сцены)
    if (drag.snapT != null) { const x = Math.round(tlX(st, drag.snapT)) + 0.5; g.save(); g.strokeStyle = accent; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(x, TL.RULER); g.lineTo(x, H); g.stroke(); g.setLineDash([]); g.fillStyle = accent; g.beginPath(); g.moveTo(x - 5, TL.RULER - 7); g.lineTo(x + 5, TL.RULER - 7); g.lineTo(x, TL.RULER); g.closePath(); g.fill(); g.restore(); }
    // бейдж сдвига — у самой реплики, а не в углу
    const c = drag.clip, ti = tracks.findIndex(t => t.clips.includes(c)), bx = tlX(st, c.row.at + drag.delta), by = TL.RULER + Math.max(0, ti) * ROW + pad - 3 * lift;
    const txt = `${drag.delta > 0.004 ? '+' : drag.delta < -0.004 ? '−' : ''}${Math.abs(drag.delta).toFixed(2).replace('.', ',')} с${drag.group ? ` · ${drag.group.size} реплик` : drag.own ? ' · только эта' : ''}${drag.snapT != null ? ' · прилипла' : ''}`;
    g.font = '600 11px ' + cssVar('--mono'); const tw = g.measureText(txt).width + 16, px = Math.max(TL.HEAD + 2, Math.min(W - tw - 2, bx)), py = by - 24 < TL.RULER + 2 ? by + (ROW - 2 * pad) + 6 : by - 24;
    g.globalAlpha = Math.min(1, 0.3 + lift); g.fillStyle = ink; g.beginPath(); g.roundRect(px, py, tw, 19, 9.5); g.fill(); g.fillStyle = surface; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(txt, px + 8, py + 10); g.globalAlpha = 1;
  }
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
  if (x >= TL.HEAD && TP.buf && S.result && S.result.out && Math.abs(x - tlX(st, tpTime())) <= (e.pointerType === 'touch' ? 10 : 4)) return { ruler: true, play: true, t: tlT(st, x) };   // за курсор плеера — как за линейку
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
  const st = tlState(), r = S.result; if (!r || !st.sel.size) return '<span class="muted">Щёлкните реплику · Ctrl или Shift+щелчок — добавить · протяжка по пустому месту — рамка · щелчок по имени дорожки — все реплики персонажа · <b>правый щелчок — меню</b> · тянуть реплику — двигать, с Alt — только её · колёсико или щипок — масштаб · тянуть по линейке или за курсор — слышно, где вы · пробел — играть · Ctrl+Z — отменить</span>';
  const fxSel = (cur, auto) => `<label>эффект <select data-act="tl-fx"><option value="">${auto || 'как у персонажа'}</option>${Object.entries(FX_PRESETS).map(([k, p]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${p.name}</option>`).join('')}</select></label>`;
  const gainBtns = `<span class="gain">громкость <button class="icon" data-act="tl-g-" aria-label="Тише на 1 дБ">${ic('minus')}</button><button class="icon" data-act="tl-g+" aria-label="Громче на 1 дБ">${ic('plus')}</button></span>`;
  if (st.sel.size > 1) {
    const items = tlSelItems(), by = new Map(); for (const id of st.sel) { const row = r.lay.rows.find(x => x.cue.id === id); if (!row) continue; const k = row.sound ? 'звуки' : row.cue.type === 'line' ? charName(row.cue.spk) : 'ремарки'; by.set(k, (by.get(k) || 0) + 1); }
    const fxs = new Set(items.map(it => S.fxLine[it.id] || '')), shifted = [...st.sel].filter(id => S.timing[id]).length;
    return `<b>Выбрано <span data-num="tli:n">${st.sel.size}</span></b><span class="muted">${[...by].map(([k, n]) => `${esc(k)} ${n}`).join(', ')}</span>
      ${items.length ? fxSel(fxs.size === 1 ? [...fxs][0] : '', fxs.size === 1 ? '' : 'разные — выберите для всех') + gainBtns : ''}
      <button class="ghost-b tiny" data-act="tl-play">${ic('play')}с первой</button>${shifted ? `<button class="ghost-b tiny" data-act="tl-reset">сбросить сдвиги (${shifted})</button>` : ''}<button class="ghost-b tiny" data-act="tl-clear">снять выделение</button>`;
  }
  const id = [...st.sel][0], row = r.lay.rows.find(x => x.cue.id === id); if (!row) return '';
  const c = row.cue, tmg = S.timing[c.id] || {}, who = row.sound ? 'звук' : c.type === 'line' ? charName(c.spk) : 'ремарка';
  const it = r.byId && r.byId.get(c.id), auto = it ? (S.fxLine[c.id] ? null : fxOfLine(c, it.voice)) : null, g = S.gains[c.id] || 0;
  return `<span class="num">${esc(c.id)}</span><b>${esc(who)}</b><span class="tl-txt">«${esc(tlText(row).slice(0, 90))}»</span>
    <span>начало <b data-num="tli:at">${C.ts(row.at)}</b></span>${row.gap != null ? `<span>пауза перед <b data-num="tli:gap">${row.gap.toFixed(2)} с</b></span>` : ''}
    ${tmg.before ? `<span>сдвиг <b>${tmg.before > 0 ? '+' : ''}${tmg.before.toFixed(2)} с</b></span>` : ''}${tmg.own ? `<span>только эта <b>${tmg.own > 0 ? '+' : ''}${tmg.own.toFixed(2)} с</b></span>` : ''}
    <button class="ghost-b tiny" data-act="tl-play">${ic('play')}отсюда</button>${tmg.before || tmg.own ? '<button class="ghost-b tiny" data-act="tl-reset">сбросить сдвиг</button>' : ''}
    ${it ? fxSel(S.fxLine[c.id] || '', auto && auto.key !== 'none' ? `сам: ${FX_PRESETS[auto.key].name} (${auto.why})` : 'без эффекта') + gainBtns + (g ? `<span><b>${g > 0 ? '+' : ''}${g} дБ</b></span>` : '') : ''}`;
}
function tlBarHtml() {
  const st = tlState(), n = Object.keys(S.timing).length, total = S.result && S.result.out ? S.result.out.length / C.SR : 0;
  return `<div class="tl-group tl-tp"><button class="play tp-play-btn" data-act="tp-play" aria-label="${TP.playing ? 'Пауза' : 'Играть'}" title="Играть и пауза (пробел)">${tpIcon(TP.playing)}</button><span class="tp-time-txt" data-num="tp2" data-num-quiet="play">${fmt(tpTime())} / ${fmt(total)}</span></div>
    <div class="tl-group"><button class="icon-b" data-act="tl-undo" aria-label="Отменить">${ic('undo')}</button><button class="icon-b" data-act="tl-redo" aria-label="Повторить">${ic('redo')}</button></div>
    <div class="tl-group"><button class="icon-b" data-act="tl-zoom-" title="Мельче (−)" aria-label="Уменьшить масштаб">${ic('minus')}</button><button class="ghost-b tiny" data-act="tl-fit" title="Весь спектакль (0)">весь</button><button class="icon-b" data-act="tl-zoom+" title="Крупнее (+)" aria-label="Увеличить масштаб">${ic('plus')}</button></div>
    <div class="tl-group"><button class="ghost-b tiny ${st.own ? 'on' : ''}" data-act="tl-own" title="Двигать только выбранную реплику, не сдвигая остальные" aria-pressed="${st.own}">только эта реплика</button>${n ? `<button class="ghost-b tiny" data-act="tl-reset-all">сбросить все сдвиги (${n})</button>` : ''}</div>
    <button class="ghost-b tl-fullbtn" data-act="tl-full" title="${st.full ? 'Свернуть (Esc)' : 'Таймлайн на весь экран (F)'}">${st.full ? ic('collapse') + 'Свернуть' : ic('expand') + 'На весь экран'}</button>`;
}
function tlRefreshInfo() {
  const el = $('#tl-info');
  if (el) { const html = tlInfoHtml(); if (el._html !== html) { const swap = el._html != null && !tlState().drag; el._html = html; el.innerHTML = html; if (swap && typeof mIn === 'function' && typeof MOTION !== 'undefined' && MOTION.ready) mIn(el, { opacity: 0.35, transform: 'translateY(3px)' }, [1, 0.26]); } }
  drawTimeline();
}
function tlRefreshBar() { const el = $('.tl-bar'); if (el) el.innerHTML = tlBarHtml(); histUi(); }
function tlSelect(ids, add = false) { const st = tlState(), was = new Set(st.sel); if (!add) st.sel.clear(); for (const id of ids) st.sel.add(id); tlPulse(new Set([...st.sel].filter(id => !was.has(id)))); tlRefreshInfo(); }
/** Курсор плеера — отдельный слой поверх холста: двигается каждый кадр, холст не перерисовывается. */
function tlHeadUpdate() {
  const el = $('#mix-out .tl-head'), st = tlState(); if (!el || !S.result || !S.result.out) return;
  const x = tlX(st, tpTime()), W = st.W || 800, show = x >= TL.HEAD - 1 && x <= W + 1;
  el.style.transform = `translate3d(${(x - 1).toFixed(2)}px, 0, 0)`; el.style.opacity = show ? '' : '0';
}
let tlRaf = 0, tlFrame = 0;
function tlFollow() {                                  // курсор плеера ведёт вид: каждый кадр, плавно
  cancelAnimationFrame(tlRaf); drawTimeline();
  const step = () => {
    tlRaf = 0; const st = tlState(), total = S.result && S.result.out ? S.result.out.length / C.SR : 0;
    tlHeadUpdate(); tlFrame++; if (typeof readTick === 'function') readTick();
    const txt = `${fmt(tpTime())} / ${fmt(total)}`;
    tpEls('tp-time', 'tp-time-txt').forEach(el => { if (el.textContent !== txt) el.textContent = txt; });
    const sk = $('#tp-seek'); if (sk && !sk.matches(':active') && tlFrame % 3 === 0) sk.value = tpTime();
    if (tlFrame % 8 === 0) drawOverview();
    if (!TP.playing) { drawTimeline(); return; }
    // дошёл до края — вид перелистывается плавно, не рывком
    const x = tlX(st, tpTime()), W = st.W || 800;
    if ((x > W - 40 || x < TL.HEAD) && !st.drag && !st.pan && !(typeof MOTION !== 'undefined' && MOTION.view)) {
      const to = Math.max(0, tpTime() - (W - TL.HEAD) / st.zoom * 0.15);
      if (typeof motionView === 'function' && x > TL.HEAD) motionView(st, st.zoom, to, drawTimeline, 420); else { st.scroll = to; drawTimeline(); }
    }
    tlRaf = requestAnimationFrame(step);
  };
  tlRaf = requestAnimationFrame(step);
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
  const hist = `<div class="m-sep"></div><button role="menuitem" data-m="undo" ${undo ? '' : 'disabled'}><span>${ic('undo')}Отменить${undo ? ': ' + esc(undo.label) : ''}</span>${kbd('Ctrl+Z')}</button><button role="menuitem" data-m="redo" ${redo ? '' : 'disabled'}><span>${ic('redo')}Повторить${redo ? ': ' + esc(redo.label) : ''}</span>${kbd('Ctrl+Shift+Z')}</button>`;
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
    ${ctx.t != null ? `<button role="menuitem" data-m="play" data-v="${ctx.t}"><span>${ic('play')}Слушать ${n ? 'с реплики' : 'отсюда'}</span>${kbd(n ? 'двойной щелчок' : 'пробел')}</button>` : ''}
    ${items.length ? `<div class="m-lbl">Эффект${n > 1 ? ' для всех выбранных' : ''}</div>${fx(cur === null ? '—' : cur, 'fx')}<div class="m-lbl">Громкость${n > 1 ? ' выбранных' : ''}</div>${gains('g')}` : ''}
    ${n ? `<div class="m-lbl">Время</div><div class="m-row"><button role="menuitem" data-m="nudge" data-v="-0.5" aria-label="раньше на 0,5 с">${ic('left')}0,5 с</button><button role="menuitem" data-m="nudge" data-v="-0.1" aria-label="раньше на 0,1 с">${ic('left')}0,1 с</button><button role="menuitem" data-m="nudge" data-v="0.1" aria-label="позже на 0,1 с">0,1 с${ic('right')}</button><button role="menuitem" data-m="nudge" data-v="0.5" aria-label="позже на 0,5 с">0,5 с${ic('right')}</button></div>${shifted ? `<button role="menuitem" data-m="reset"><span>Сбросить сдвиг</span></button>` : ''}` : ''}
    <div class="m-sep"></div>
    ${voice ? `<button role="menuitem" data-m="selvoice" data-v="${esc(voice)}"><span>Выделить все реплики: ${esc(charName(voice))}</span></button>` : ''}
    <button role="menuitem" data-m="selall"><span>Выделить всё</span>${kbd('Ctrl+A')}</button>
    ${n ? `<button role="menuitem" data-m="clear"><span>Снять выделение</span>${kbd('Esc')}</button>` : ''}
    <button role="menuitem" data-m="full"><span>${tlState().full ? 'Свернуть таймлайн' : 'Таймлайн на весь экран'}</span>${kbd(tlState().full ? 'Esc' : 'F')}</button>${hist}`;
}
/** Меню по правому щелчку (transitions.dev: plus to menu morph): у курсора появляется кружок «+», «+» уезжает внутрь
 *  и поворачивается в «×», а кружок вырастает в панель — в ту сторону, где есть место. Уже открытое меню при
 *  смене содержимого (эффект, громкость) только меняет размер. С клавиатуры и при «меньше движения» — сразу. */
function tlMenuOpen(cx, cy, ctx) {
  const st = tlState(), m = $('#tl-menu'); if (!m) return;
  const was = !m.hidden && m.dataset.open === 'true', sc = was ? (m.querySelector('.t-morph-menu') || {}).scrollTop || 0 : 0;
  st.menu = ctx; st.menuIds = ctx.ids || null; st.menuAt = { x: cx, y: cy };
  clearTimeout(m._hide); m.style.pointerEvents = '';
  const instant = tlLastInput === 'key' || (typeof MOTION !== 'undefined' && (MOTION.reduce || performance.now() - MOTION.kbd < 150));
  m.classList.add('t-morph'); m.classList.toggle('t-instant', instant && !was);
  if (!was) m.dataset.open = 'false';        // сначала кружок: замер ниже заодно закрепит его — отдельный перерасчёт не нужен
  m.innerHTML = `<div class="t-morph-menu">${tlMenuHtml(ctx)}</div><span class="t-morph-plus" aria-hidden="true">${ic('plus')}</span>`;
  m.hidden = false;
  // размер открытого меню — по содержимому; кружок стоит центром на курсоре, меню растёт туда, где есть место
  const inner = m.firstElementChild, vw = innerWidth, vh = innerHeight, W = Math.min(340, vw - 16);
  inner.style.width = W + 'px'; inner.style.height = 'auto'; const H = Math.min(inner.scrollHeight, vh - 16); inner.style.width = inner.style.height = '';
  const toL = cx - 20 + W > vw - 8, toT = cy - 20 + H > vh - 8;
  const ax = toL ? Math.min(vw - 8, Math.max(W + 8, cx + 20)) : Math.max(8, Math.min(vw - 8 - W, cx - 20)), ay = toT ? Math.min(vh - 8, Math.max(H + 8, cy + 20)) : Math.max(8, Math.min(vh - 8 - H, cy - 20));
  m.dataset.ax = toL ? 'r' : 'l'; m.dataset.ay = toT ? 'b' : 't';
  m.style.left = toL ? 'auto' : ax + 'px'; m.style.right = toL ? (vw - ax) + 'px' : 'auto'; m.style.top = toT ? 'auto' : ay + 'px'; m.style.bottom = toT ? (vh - ay) + 'px' : 'auto';
  m.style.setProperty('--mw', W + 'px'); m.style.setProperty('--mh', H + 'px'); m.dataset.open = 'true';
  if (sc) m.firstElementChild.scrollTop = sc;
  // выбор эффекта: подложка переезжает к новому (в только что открытом меню переезжать неоткуда — стоит сразу)
  if (typeof segInd === 'function') m.querySelectorAll('.m-fx').forEach((b, i) => segInd(b, 'm-fx' + i));
  drawTimeline();
  const f = m.querySelector('button:not([disabled])'); if (f) f.focus({ preventScroll: true });
}
/** Закрытие — обратно в кружок у курсора; логика не ждёт: меню уже закрыто, кружок только доигрывает. */
function tlMenuClose(refocus = true) {
  const st = tlState(), m = $('#tl-menu'); if (!m || m.hidden || m.dataset.open !== 'true') return;
  st.menu = null; st.menuIds = null; drawTimeline();
  const instant = tlLastInput === 'key' || (typeof MOTION !== 'undefined' && MOTION.reduce);
  m.classList.toggle('t-instant', instant); m.dataset.open = 'false'; m.style.pointerEvents = 'none';
  clearTimeout(m._hide); if (instant) m.hidden = true; else m._hide = setTimeout(() => { if (m.dataset.open !== 'true') { m.hidden = true; m.style.pointerEvents = ''; } }, 270);
  if (refocus) $('#tl-cv')?.focus();
}
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
  if (keep && st.menu) { tlMenuOpen(st.menuAt.x, st.menuAt.y, st.menu); const again = $('#tl-menu').querySelector(`[data-m="${a}"][data-v="${CSS.escape(v || '')}"]`); if (again) again.focus(); }
  else tlMenuClose();
}
/** Меню с клавиатуры: у выбранной реплики или в начале видимой части. */
function tlMenuFromKeys() {
  if (typeof MOTION !== 'undefined') MOTION.kbd = performance.now();
  const st = tlState(), cv = $('#tl-cv'), r = cv.getBoundingClientRect(), clips = tlAllClips().filter(c => st.sel.has(c.row.cue.id));
  if (clips.length) { const c = clips[0], ti = (S.tlTracks || []).findIndex(t => t.clips.includes(c)); tlMenuOpen(r.left + Math.max(TL.HEAD, tlX(st, c.row.at)) + 10, r.top + TL.RULER + ti * st.row + st.row, { ids: new Set(st.sel), t: c.row.at }); }
  else tlMenuOpen(r.left + TL.HEAD + 20, r.top + TL.RULER + 10, { ids: new Set(), t: st.scroll });
}
function tlZoom(k, cx = null, smooth = false) {
  const st = tlState(), W = st.W || 800, mx = cx ?? (TL.HEAD + (W - TL.HEAD) / 2), t = tlT(st, mx);
  const zoom = Math.max((W - TL.HEAD) / S.result.lay.total, Math.min(TL.MAX_ZOOM, st.zoom * k)), scroll = t - (mx - TL.HEAD) / zoom;
  if (smooth && typeof motionView === 'function') motionView(st, zoom, scroll, drawTimeline); else { st.zoom = zoom; st.scroll = scroll; drawTimeline(); }
}
function tlFit(smooth = true) { const st = tlState(), W = st.W || 800, z = (W - TL.HEAD) / S.result.lay.total; if (!smooth) { st.zoom = z; st.scroll = 0; drawTimeline(); return; } if (typeof motionView === 'function') motionView(st, z, 0, drawTimeline); else { st.zoom = 0; st.scroll = 0; drawTimeline(); } }
function bindTimeline() {
  const host = $('#mix-out');
  host.addEventListener('contextmenu', e => {
    if (e.target.id !== 'tl-cv') return; e.preventDefault();
    const st = tlState(), hit = tlHit(e); if (!hit) return;
    if (hit.head) { tlMenuOpen(e.clientX, e.clientY, { track: hit.track }); return; }
    if (hit.clip) { const id = hit.clip.row.cue.id; if (!st.sel.has(id)) tlSelect([id]); tlMenuOpen(e.clientX, e.clientY, { ids: new Set(st.sel), t: hit.clip.row.at }); return; }
    tlMenuOpen(e.clientX, e.clientY, { ids: new Set(st.sel), t: hit.t != null ? Math.max(0, hit.t) : null });
  });
  const touches = new Map();                           // пальцы на холсте: два — щипок
  const panFrom = x => ({ x0: x, scroll0: tlState().scroll, hist: [{ t: performance.now(), x, y: 0 }] });
  host.addEventListener('pointerdown', e => {
    if (e.target.id === 'tl-ov') { const st = tlState(); st.ovDrag = true; tlOvSeek(e); try { e.target.setPointerCapture(e.pointerId); } catch {} return; }
    if (e.target.id !== 'tl-cv' || e.button === 2) return;
    tlMenuClose(false);
    const st = tlState(), touch = e.pointerType === 'touch';
    tlZoomStop(st);                                    // коснулись — инерция и пружина масштаба останавливаются там, где были
    if (touch) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { e.target.setPointerCapture(e.pointerId); } catch {}
      if (touches.size === 2) { tlPinchBegin(st, [...touches.values()]); return; }
      if (touches.size > 2 || st.pinch || st.pinchRest) return;
    }
    const hit = tlHit(e), add = e.ctrlKey || e.metaKey || e.shiftKey, pos = tlPos(e); e.target.focus();
    if (!hit) return;
    if (e.button === 1 || (e.altKey && !hit.clip) || (touch && hit.empty)) st.pan = panFrom(e.clientX);   // пальцем по пустому — листать
    else if (hit.ruler) { st.scrub = true; tlSeek(hit.t); tlGrain(hit.t, true); }
    else if (hit.head) { const ids = hit.track.clips.filter(c => !c.fixed).map(c => c.row.cue.id); tlSelect(ids, add); }
    else if (hit.clip && touch) st.hold = { clip: hit.clip, x0: e.clientX, y0: e.clientY, x: e.clientX, timer: setTimeout(() => tlLift(st), 320) };   // пальцем: реплику берут долгим нажатием, иначе — листать
    else if (hit.clip && add) { st.band = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y, add: true, base: new Set(st.sel), toggle: hit.clip.row.cue.id }; }
    else if (hit.clip) st.drag = tlDragStart(hit.clip, e.clientX, e.altKey);
    else st.band = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y, add, base: new Set(add ? st.sel : []) };
    try { e.target.setPointerCapture(e.pointerId); } catch {}
  });
  host.addEventListener('pointermove', e => {
    if (e.target.id === 'tl-ov') { if (tlState().ovDrag) tlOvSeek(e); return; }
    if (e.target.id !== 'tl-cv') return;
    const st = tlState();
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (st.pinch) { tlPinchMove(st, [...touches.values()]); return; }
      if (st.pinchRest) return;
      if (st.hold) {
        st.hold.x = e.clientX;
        if (Math.hypot(e.clientX - st.hold.x0, e.clientY - st.hold.y0) < 8) return;
        clearTimeout(st.hold.timer); st.pan = panFrom(st.hold.x0); st.hold = null;
      }
    }
    if (st.drag) {
      const raw = (e.clientX - st.drag.x0) / st.zoom;
      if (!st.drag.moved && Math.abs(e.clientX - st.drag.x0) > 3) { st.drag.moved = true; if (!TLFX.liftIds) tlLiftUp(st.drag.clips); }
      // прилипание к краям соседних реплик, курсору и сценам; с Shift — свободно
      const sn = e.shiftKey ? { d: raw, t: null } : tlSnap(st, raw), d = sn.d;
      if (sn.t != null && sn.t !== st.drag.snapT) { try { navigator.vibrate && navigator.vibrate(4); } catch {} }
      st.drag.snapT = d < st.drag.min || d > 60 ? null : sn.t;
      // упёрлась в соседнюю или в предел — не стоп, а резина: чем дальше тянешь, тем меньше идёт
      const rb = over => (typeof rubber === 'function' ? rubber(over * st.zoom, 90) : 0) / st.zoom;
      st.drag.delta = d < st.drag.min ? st.drag.min - rb(st.drag.min - d) : d > 60 ? 60 + rb(d - 60) : d;
      drawTimeline();
    }
    else if (st.band) {
      const p = tlPos(e); st.band.x1 = p.x; st.band.y1 = p.y;
      const inside = tlInBand(st.band).map(c => c.row.cue.id); st.sel = new Set(st.band.base); for (const id of inside) st.sel.add(id);
      if (p.x > (st.W || 800) - 20) st.scroll += 8 / st.zoom; else if (p.x < TL.HEAD + 10) st.scroll -= 8 / st.zoom;
      drawTimeline();
    }
    else if (st.pan) { st.pan.hist.push({ t: performance.now(), x: e.clientX, y: 0 }); if (st.pan.hist.length > 8) st.pan.hist.shift(); st.scroll = st.pan.scroll0 - (e.clientX - st.pan.x0) / st.zoom; drawTimeline(); }
    else if (st.scrub) { const hit = tlHit(e); if (hit && hit.t != null) { tlSeek(hit.t); tlGrain(Math.max(0, hit.t)); } }
    else {
      const hit = tlHit(e); e.target.style.cursor = hit && hit.clip ? 'grab' : hit && hit.ruler ? 'col-resize' : hit && hit.head ? 'pointer' : 'crosshair';
      // реплика под курсором мягко подсвечивается (только мышь и не во время прокрутки)
      const hid = e.pointerType === 'mouse' && !(typeof scrolling === 'function' && scrolling()) && hit && hit.clip ? hit.clip.row.cue.id : null;
      if (hid !== TLFX.hoverId) { TLFX.hoverId = hid; mvSet(TLFX.hover, 0); if (hid) mvTo(TLFX.hover, 1, { damping: 1, response: 0.14 }); else drawTimeline(); }
    }
  });
  const up = () => {
    const st = tlState(); st.ovDrag = false;
    if (st.drag) {
      const d = st.drag; st.drag = null;
      const commit = Math.max(d.min, Math.min(60, d.delta)), over = d.delta - commit;
      mvTo(TLFX.lift, 0, { damping: 0.55, response: 0.34 });                       // опускается с лёгким отскоком
      if (d.moved && Math.abs(commit) >= 0.01 && TLFX.liftIds) tlPulse(TLFX.liftIds);  // и приземляется — кольцо расходится
      if (d.moved && Math.abs(over) > 0.005) tlSettle(d, over);
      if (d.moved && Math.abs(commit) >= 0.01) { if (!d.group) st.sel = new Set([d.clip.row.cue.id]); tlCommit(d.clips, commit, d.own); }
      else tlSelect([d.clip.row.cue.id]);
    }
    if (st.band) {
      const b = st.band; st.band = null;
      if (Math.abs(b.x1 - b.x0) >= 4 || Math.abs(b.y1 - b.y0) >= 4) { TLFX.band = { x: Math.min(b.x0, b.x1), y: Math.min(b.y0, b.y1), w: Math.abs(b.x1 - b.x0), h: Math.abs(b.y1 - b.y0), m: mv(1, 0.02, TLFX.owner) }; mvTo(TLFX.band.m, 0, { damping: 1, response: 0.2 }); }
      if (Math.abs(b.x1 - b.x0) < 4 && Math.abs(b.y1 - b.y0) < 4) { if (b.toggle) { if (b.base.has(b.toggle)) st.sel.delete(b.toggle); else st.sel.add(b.toggle); } else if (!b.add) st.sel.clear(); }
      tlRefreshInfo();
    }
    if (st.pan && typeof velocityOf === 'function') tlCoast(-velocityOf(st.pan.hist).x / st.zoom);
    st.pan = null; st.scrub = false; drawTimeline();
  };
  const end = e => {
    if (touches.has(e.pointerId)) {
      touches.delete(e.pointerId); const st = tlState();
      if (st.pinch) { tlPinchEnd(st); st.pinchRest = touches.size > 0; return; }
      if (st.pinchRest) { st.pinchRest = touches.size > 0; return; }
      if (st.hold) { clearTimeout(st.hold.timer); const id = st.hold.clip.row.cue.id; st.hold = null; if (e.type === 'pointerup') tlSelect([id]); return; }   // короткое касание — выбрать
    }
    if (e.target.id === 'tl-cv' || e.target.id === 'tl-ov') up();
  };
  host.addEventListener('pointerout', e => { if (e.target.id === 'tl-cv' && TLFX.hoverId) { TLFX.hoverId = null; drawTimeline(); } });
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', end);
  host.addEventListener('dblclick', e => { if (e.target.id !== 'tl-cv') return; const hit = tlHit(e); if (hit && hit.clip) tlSeek(hit.clip.row.at, true); });
  host.addEventListener('wheel', e => {
    if (e.target.id !== 'tl-cv' && e.target.id !== 'tl-ov') return; e.preventDefault();
    const st = tlState(), mx = e.target.id === 'tl-cv' ? tlPos(e).x : null;
    if (e.ctrlKey && mx != null && !e.shiftKey) { tlPinchWheel(st, e.deltaMode ? e.deltaY * 16 : e.deltaY, mx); return; }   // щипок на тачпаде приходит как Ctrl+колёсико
    if (!st.pinchW) tlZoomStop(st);
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.target.id === 'tl-ov') { st.scroll += (e.deltaX || e.deltaY) / st.zoom; drawTimeline(); }
    else tlZoom(Math.pow(1.25, -e.deltaY / 100), mx);
  }, { passive: false });
  // Safari на Mac: щипок приходит своими событиями жестов, со свойством scale
  host.addEventListener('gesturestart', e => { if (e.target.id !== 'tl-cv') return; e.preventDefault(); const st = tlState(); if (st.pinch) return; const mx = tlPos(e).x; tlZoomStop(st); st.pinchG = { z0: st.zoom, mx, t: tlT(st, mx) }; });
  host.addEventListener('gesturechange', e => { const st = tlState(), p = st.pinchG; if (!p) return; e.preventDefault(); tlPinchTo(st, p.z0 * e.scale, p.mx, p.t); });
  host.addEventListener('gestureend', e => { const st = tlState(), p = st.pinchG; if (!p) return; e.preventDefault(); st.pinchG = null; tlZoomSettle(p.mx, tlT(st, p.mx)); });
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
    if (e.key === '+' || e.key === '=') { tlZoom(1.5); return; }             // с клавиатуры — мгновенно
    if (e.key === '-' || e.key === '_') { tlZoom(1 / 1.5); return; }
    if (e.key === '0') { tlFit(false); return; }
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
    if (a === 'tl-fit') tlFit();
    else if (a === 'tl-zoom+') tlZoom(1.5, null, true);
    else if (a === 'tl-zoom-') tlZoom(1 / 1.5, null, true);
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
/** Инерция протяжки: вид катится дальше и тормозит, как прокрутка в iOS (замедление 0,998 за мс). */
let tlCoastRaf = 0;
function tlCoastStop() { cancelAnimationFrame(tlCoastRaf); tlCoastRaf = 0; }
function tlCoast(v) {                                  // v — секунды таймлайна в секунду
  tlCoastStop(); if (typeof MOTION !== 'undefined' && MOTION.reduce) return;
  if (Math.abs(v * tlState().zoom) < 60) return;
  let t0 = performance.now();
  const step = now => {
    const st = tlState(), dt = Math.min(40, now - t0); t0 = now;
    const before = st.scroll; st.scroll += v * dt / 1000; v *= Math.pow(0.996, dt); drawTimeline();
    if (Math.abs(v * st.zoom) < 12 || st.scroll === before) { tlCoastRaf = 0; return; }
    tlCoastRaf = requestAnimationFrame(step);
  };
  tlCoastRaf = requestAnimationFrame(step);
}
/** Реплику тянули за край: отпущенная, она отпружинивает к разрешённому месту. */
function tlSettle(d, over) {
  const st = tlState(); if (typeof mv !== 'function' || (typeof MOTION !== 'undefined' && MOTION.reduce)) return;
  const owner = { render() { if (!st.settle) return; drawTimeline(); if (!SPRING.live.has(st.settle.m)) st.settle = null; } };
  st.settle = { m: mv(over, 0.002, owner), ids: d.group ? new Set(d.group) : null, own: d.own, idx: d.clip.idx };
  mvTo(st.settle.m, 0, { damping: 0.62, response: 0.4 });
}
function tlDragStart(clip, x0, alt) {
  const st = tlState(), id = clip.row.cue.id, inGroup = st.sel.size > 1 && st.sel.has(id);
  const group = inGroup ? new Set(st.sel) : null, own = alt || st.own || !!group;
  const clips = group ? tlAllClips().filter(c => group.has(c.row.cue.id)) : [clip];
  return { clip, x0, delta: 0, own, moved: false, min: Math.max(...clips.map(c => tlMinDelta(c, own))), group, clips };
}
/** Долгое нажатие пальцем: реплика «поднимается» (выделяется, телефон коротко вздрагивает) и дальше идёт за пальцем. */
function tlLift(st) {
  const h = st.hold; if (!h) return; st.hold = null;
  st.drag = tlDragStart(h.clip, h.x, false); tlLiftUp(st.drag.clips);
  if (!st.sel.has(h.clip.row.cue.id)) tlSelect([h.clip.row.cue.id]); else drawTimeline();
  try { navigator.vibrate && navigator.vibrate(8); } catch {}
}
// ------------------------------------------------------------------ щипок: масштаб за пальцами, у пределов — резина
function tlZoomLimits(st) { return [((st.W || 800) - TL.HEAD) / S.result.lay.total, TL.MAX_ZOOM]; }
/** За пределом масштаб идёт всё неохотнее (резина в логарифме: край ощущается одинаково на любом масштабе). */
function tlElastic(st, raw) {
  const [lo, hi] = tlZoomLimits(st), rb = o => typeof rubber === 'function' ? rubber(o, 0.6) : 0;
  return raw < lo ? lo * Math.exp(-rb(Math.log(lo / raw))) : raw > hi ? hi * Math.exp(rb(Math.log(raw / hi))) : raw;
}
function tlZoomStop(st) {
  tlCoastStop();
  if (st.zSettle) { SPRING.live.delete(st.zSettle); st.zSettle = null; }
  if (typeof MOTION !== 'undefined' && MOTION.view) { cancelAnimationFrame(MOTION.view); MOTION.view = 0; }
}
/** Точка под пальцами (время t) остаётся под пальцами — вид растягивается вокруг неё и едет вместе с ними. */
function tlPinchTo(st, raw, mx, t) { st.elastic = true; st.zoom = tlElastic(st, raw); st.scroll = t - (mx - TL.HEAD) / st.zoom; drawTimeline(); }
const tlMid = pts => { const r = $('#tl-cv').getBoundingClientRect(); return { mx: (pts[0].x + pts[1].x) / 2 - r.left, d: Math.max(20, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) }; };
function tlPinchBegin(st, pts) {
  // второй палец: что начал первый — отменяется без следа (реплика не сдвигается, рамка не выделяет)
  if (st.hold) { clearTimeout(st.hold.timer); st.hold = null; }
  if (st.band) { st.sel = st.band.base; st.band = null; tlRefreshInfo(); }
  st.drag = null; st.pan = null; st.scrub = false; tlZoomStop(st);
  const { mx, d } = tlMid(pts);
  st.pinch = { d0: d, z0: st.zoom, t: tlT(st, mx), mx, hist: [{ t: performance.now(), x: mx, y: 0 }] };
  drawTimeline();
}
function tlPinchMove(st, pts) {
  const p = st.pinch, { mx, d } = tlMid(pts); p.mx = mx;
  p.hist.push({ t: performance.now(), x: mx, y: 0 }); if (p.hist.length > 8) p.hist.shift();
  tlPinchTo(st, p.z0 * d / p.d0, mx, p.t);
}
function tlPinchEnd(st) {
  const p = st.pinch; st.pinch = null; if (!p) return;
  const [lo, hi] = tlZoomLimits(st);
  if (st.zoom < lo * 0.999 || st.zoom > hi * 1.001) { tlZoomSettle(p.mx, tlT(st, p.mx)); return; }   // за пределом — отпружинит
  st.elastic = false; drawTimeline();
  if (typeof velocityOf === 'function') tlCoast(-velocityOf(p.hist).x / st.zoom);                     // отпустили на ходу — вид катится дальше
}
/** Щипок на тачпаде: поток Ctrl+колёсико. Конца жеста нет — считаем, что кончился, когда 160 мс тихо. */
function tlPinchWheel(st, dy, mx) {
  if (!st.pinchW || Math.abs(mx - st.pinchW.mx) > 40) { tlZoomStop(st); clearTimeout(st.pinchW && st.pinchW.timer); st.pinchW = { raw: st.zoom, mx, t: tlT(st, mx) }; }
  const p = st.pinchW, [lo, hi] = tlZoomLimits(st);
  p.raw = Math.max(lo * 0.25, Math.min(hi * 4, p.raw * Math.exp(-Math.max(-40, Math.min(40, dy)) * 0.01)));   // Chrome: exp(−deltaY/100) — ровно масштаб пальцев
  tlPinchTo(st, p.raw, mx, p.t);
  clearTimeout(p.timer); p.timer = setTimeout(() => { if (st.pinchW !== p) return; st.pinchW = null; tlZoomSettle(p.mx, tlT(st, p.mx)); }, 160);
}
/** Отпустили за пределом: масштаб возвращается на пружине, точка под пальцами — насколько позволяют края. */
function tlZoomSettle(mx, t) {
  const st = tlState(); if (!S.result || !S.result.lay) { st.elastic = false; return; }
  const [lo, hi] = tlZoomLimits(st), z1 = Math.max(lo, Math.min(hi, st.zoom)), span = ((st.W || 800) - TL.HEAD) / z1;
  const s1 = Math.max(0, Math.min(Math.max(0, S.result.lay.total - span), t - (mx - TL.HEAD) / z1)), t1 = s1 + (mx - TL.HEAD) / z1;
  const L0 = Math.log(st.zoom), L1 = Math.log(z1);
  if ((Math.abs(L1 - L0) < 0.002 && Math.abs(t1 - t) < 1e-3) || typeof mv !== 'function' || (typeof MOTION !== 'undefined' && MOTION.reduce)) { st.elastic = false; st.zoom = z1; st.scroll = s1; drawTimeline(); return; }
  const owner = { render() { const k = m.v; st.zoom = Math.exp(L0 + (L1 - L0) * k); st.scroll = t + (t1 - t) * k - (mx - TL.HEAD) / st.zoom; if (!SPRING.live.has(m)) { st.elastic = false; st.zSettle = null; } drawTimeline(); } };
  const m = mv(0, 0.001, owner); st.zSettle = m; mvTo(m, 1, { damping: 1, response: 0.36 });
}
// ------------------------------------------------------------------ звук при протяжке курсора
/** Пока плеер стоит, под курсором звучат короткие кусочки — как лента, которую качают руками у головки:
 *  тянешь быстрее — звучит быстрее и выше, назад — задом наперёд, остановился — тишина. */
const SCRUB = { at: 0, t: -1 };
function tlGrain(t, first = false) {
  if (!TP.buf || TP.playing || !S.result || !S.result.out) return;
  const now = performance.now(), dt = (now - SCRUB.at) / 1000;
  if (!first && dt < 0.035) return;
  const fresh = first || SCRUB.t < 0 || dt > 0.3, dir = fresh ? 1 : Math.sign(t - SCRUB.t), speed = fresh ? 1 : Math.abs(t - SCRUB.t) / dt;
  SCRUB.at = now; SCRUB.t = t;
  if (!dir || speed < 0.05) return;
  const rate = Math.max(0.5, Math.min(2.5, speed)), n = Math.round(0.07 * rate * C.SR), a = Math.round((dir < 0 ? t - 0.07 * rate : t) * C.SR);
  if (a < 0 || a + n > TP.len) return;
  const ctx = audioCtx(); if (ctx.state === 'suspended') ctx.resume();
  const all = TP.buf.getChannelData(0), buf = ctx.createBuffer(1, n, C.SR), y = buf.getChannelData(0), fade = Math.max(1, Math.min(n >> 2, Math.round(0.012 * rate * C.SR)));
  for (let i = 0; i < n; i++) { const v = all[dir < 0 ? a + n - 1 - i : a + i]; y[i] = i < fade ? v * i / fade : i > n - fade ? v * (n - i) / fade : v; }
  const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate; src.connect(audioOut()); src.start();
}
function tlOvSeek(e) {                                 // мини-карта: щелчок и протяжка — сюда вид
  const cv = $('#tl-ov'), st = tlState(), r = cv.getBoundingClientRect(), W = r.width, total = S.result.lay.total;
  const t = (e.clientX - r.left - TL.HEAD) / (W - TL.HEAD) * total, span = ((st.W || W) - TL.HEAD) / st.zoom;
  const to = Math.max(0, t - span / 2);
  if (e.type === 'pointerdown' && typeof motionView === 'function') motionView(st, st.zoom, to, drawTimeline); else { st.scroll = to; drawTimeline(); }
}
