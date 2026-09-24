// Монтажка — таймлайн сведения: дорожки по персонажам, реплики двигаются мышью. Сдвиг реплики — это
// пауза перед ней (всё дальше едет следом); с Alt или в режиме «только эта» двигается одна реплика.
// Колёсико — масштаб вокруг курсора, Shift+колёсико — прокрутка, линейка — перемотка плеера.
// Использует S, $, esc, fmt, charName, colorOf, cssVar, saveEdits, remixSoon, notify из app.js; C — ядро.
const TL = { ROW: 40, HEAD: 150, RULER: 22, PAD: 6, MAX_ZOOM: 400 };
function tlState() { if (!S.tl) S.tl = { zoom: 0, scroll: 0, sel: null, own: false, drag: null, pan: null, scrub: false }; return S.tl; }
/** Дорожки: персонажи по порядку сценария, потом ремарки, звуки, фон; клипы — строки раскладки. */
function tlTracks(r) {
  const tracks = [], byKey = new Map(), placedOf = new Map(r.lay.placed.map(p => [p.cue.id, p]));
  const add = (key, name, cls) => { const t = { key, name, cls, clips: [] }; tracks.push(t); byKey.set(key, t); return t; };
  for (const c of S.P.chars) if (r.lay.rows.some(row => row.cue.type === 'line' && row.cue.spk === c.key)) add(c.key, c.name, colorOf(c.key));
  r.lay.rows.forEach((row, idx) => {
    let tr, kind;
    if (row.bed) { tr = byKey.get('фон') || add('фон', 'Фон', 'ghost'); kind = 'bed'; }
    else if (row.sound) { tr = byKey.get('звуки') || add('звуки', 'Звуки', 'ghost'); kind = 'sound'; }
    else { const c = row.cue, voice = c.type === 'line' ? c.spk : 'ремарки'; tr = byKey.get(voice) || add(voice, c.type === 'line' ? charName(voice) : 'Ремарки', c.type === 'line' ? colorOf(voice) : 'ghost'); kind = row.recorded ? 'line' : 'pause'; }
    const p = placedOf.get(row.cue.id); let peaks = null;
    if (p && p.audio && p.audio.length) { const n = Math.max(8, Math.min(240, Math.ceil(row.dur * 30))), b = Math.ceil(p.audio.length / n); peaks = new Float32Array(n); for (let k = 0; k < n; k++) { let m = 0; const e = Math.min(p.audio.length, (k + 1) * b); for (let i = k * b; i < e; i += 4) { const a = Math.abs(p.audio[i]); if (a > m) m = a; } peaks[k] = m; } }
    tr.clips.push({ row, idx, kind, peaks });
  });
  if (r.amb && r.amb.length) { const t = add('фон сцен', 'Фон сцен', 'ghost'); for (const a of r.amb) { const n = Math.max(8, Math.min(400, Math.ceil(a.dur * 2))), b = Math.ceil(a.audio.length / n), peaks = new Float32Array(n); let mx = 1e-9; for (let k = 0; k < n; k++) { let m = 0; for (let i = k * b; i < Math.min(a.audio.length, (k + 1) * b); i += 64) m = Math.max(m, Math.abs(a.audio[i])); peaks[k] = m; mx = Math.max(mx, m); } for (let k = 0; k < n; k++) peaks[k] /= mx * 1.6; t.clips.push({ row: { cue: { id: 'amb' + a.n, text: a.name, type: 'amb' }, at: a.at, dur: a.dur, sound: a.name }, idx: -1, kind: 'bed', peaks, fixed: true }); } }
  return tracks;
}
function tlText(row) { const c = row.cue; return row.sound ? row.sound : c.text.replace(/^[—\-]\s*/, ''); }
/** Секунды → x на холсте и обратно. */
function tlX(st, t) { return TL.HEAD + (t - st.scroll) * st.zoom; }
function tlT(st, x) { return st.scroll + (x - TL.HEAD) / st.zoom; }
function drawTimeline() {
  const cv = $('#tl-cv'), r = S.result; if (!cv || !r || !r.lay) return;
  const st = tlState(), tracks = S.tlTracks || (S.tlTracks = tlTracks(r));
  const W = Math.max(360, Math.floor(cv.clientWidth || 800)), H = TL.RULER + tracks.length * TL.ROW + TL.PAD, dpr = window.devicePixelRatio || 1;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const total = r.lay.total, areaW = W - TL.HEAD, minZoom = areaW / total;
  if (!st.zoom) st.zoom = minZoom;
  st.zoom = Math.max(minZoom, Math.min(TL.MAX_ZOOM, st.zoom));
  st.scroll = Math.max(0, Math.min(Math.max(0, total - areaW / st.zoom), st.scroll));
  const ink = cssVar('--ink'), muted = cssVar('--muted'), line = cssVar('--line'), line2 = cssVar('--line2'), bg = cssVar('--bg'), surface = cssVar('--surface'), accent = cssVar('--accent');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // дорожки и подписи
  tracks.forEach((tr, i) => {
    const y = TL.RULER + i * TL.ROW;
    g.fillStyle = i % 2 ? bg : surface; g.fillRect(TL.HEAD, y, areaW, TL.ROW);
    g.strokeStyle = line2; g.beginPath(); g.moveTo(0, y + TL.ROW + 0.5); g.lineTo(W, y + TL.ROW + 0.5); g.stroke();
    const col = tr.cls === 'ghost' ? cssVar('--none') : cssVar('--' + tr.cls), soft = tr.cls === 'ghost' ? cssVar('--none-soft') : cssVar('--' + tr.cls + 's');
    g.fillStyle = soft; g.beginPath(); g.roundRect(6, y + 10, TL.HEAD - 14, TL.ROW - 20, 10); g.fill();
    g.fillStyle = col; g.font = '600 12px ' + cssVar('--sans'); g.textBaseline = 'middle'; g.textAlign = 'left';
    g.save(); g.beginPath(); g.rect(6, y, TL.HEAD - 14, TL.ROW); g.clip(); g.fillText(tr.name, 14, y + TL.ROW / 2 + 0.5); g.restore();
  });
  // линейка
  g.fillStyle = surface; g.fillRect(TL.HEAD, 0, areaW, TL.RULER); g.strokeStyle = line; g.beginPath(); g.moveTo(TL.HEAD, TL.RULER + 0.5); g.lineTo(W, TL.RULER + 0.5); g.stroke();
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]; let step = steps.find(s => s * st.zoom >= 70) || 600;
  g.font = '11px ' + cssVar('--mono'); g.fillStyle = muted; g.textAlign = 'left';
  for (let t = Math.floor(st.scroll / step) * step; t <= st.scroll + areaW / st.zoom; t += step) {
    const x = tlX(st, t); if (x < TL.HEAD) continue;
    g.strokeStyle = line2; g.beginPath(); g.moveTo(x + 0.5, TL.RULER - 6); g.lineTo(x + 0.5, H); g.stroke();
    g.fillText(C.ts(t), x + 3, 9);
  }
  // сцены
  g.fillStyle = muted; g.font = '600 10px ' + cssVar('--mono');
  for (const sc of r.lay.scenes || []) { const x = tlX(st, sc.start); if (x < TL.HEAD - 2 || x > W) continue; g.strokeStyle = muted; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); g.setLineDash([]); g.fillText('СЦЕНА ' + sc.n, x + 4, TL.RULER + 7); }
  // клипы
  const drag = st.drag, shift = clip => (drag && drag.moved && (drag.own ? clip.idx === drag.clip.idx : clip.idx >= drag.clip.idx)) ? drag.delta : 0;
  g.save(); g.beginPath(); g.rect(TL.HEAD, TL.RULER, areaW, H - TL.RULER); g.clip();
  tracks.forEach((tr, i) => {
    const y = TL.RULER + i * TL.ROW + 6, h = TL.ROW - 12;
    const col = tr.cls === 'ghost' ? cssVar('--none') : cssVar('--' + tr.cls), soft = tr.cls === 'ghost' ? cssVar('--none-soft') : cssVar('--' + tr.cls + 's');
    for (const clip of tr.clips) {
      const at = clip.row.at + shift(clip), x0 = tlX(st, at), w = Math.max(3, clip.row.dur * st.zoom);
      if (x0 + w < TL.HEAD || x0 > W) continue;
      const sel = st.sel === clip.row.cue.id;
      g.beginPath(); g.roundRect(x0, y, w, h, 5);
      if (clip.kind === 'pause') { g.setLineDash([4, 3]); g.strokeStyle = col; g.lineWidth = 1; g.stroke(); g.setLineDash([]); }
      else { g.fillStyle = clip.kind === 'bed' ? soft : soft; g.globalAlpha = clip.kind === 'bed' ? 0.55 : 1; g.fill(); g.globalAlpha = 1; g.strokeStyle = sel ? ink : col; g.lineWidth = sel ? 2 : 1; g.stroke(); g.lineWidth = 1; }
      if (clip.peaks && w >= 24) {
        g.strokeStyle = col; g.globalAlpha = 0.55; g.beginPath();
        const n = clip.peaks.length, mid = y + h / 2, px = Math.max(1, Math.floor(w / n));
        for (let k = 0; k < n; k++) { const xx = x0 + 2 + k * (w - 4) / n, a = clip.peaks[k] * (h / 2 - 3); if (xx > W) break; g.moveTo(xx, mid - a); g.lineTo(xx, mid + a + 0.5); }
        g.stroke(); g.globalAlpha = 1; void px;
      }
      if (w >= 44) { g.save(); g.beginPath(); g.rect(x0 + 2, y, w - 4, h); g.clip(); g.fillStyle = ink; g.font = (clip.kind === 'pause' ? '' : '500 ') + '11px ' + cssVar('--sans'); g.textBaseline = 'middle'; g.fillText((clip.kind === 'pause' ? '⏸ ' : '') + tlText(clip.row), x0 + 5, y + h / 2 + 0.5); g.restore(); }
    }
  });
  g.restore();
  // курсор плеера
  const a = $('#mix-out audio'); if (a && a.duration) { const x = tlX(st, a.currentTime); if (x >= TL.HEAD && x <= W) { g.strokeStyle = cssVar('--bad'); g.lineWidth = 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.lineWidth = 1; g.fillStyle = cssVar('--bad'); g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 7); g.closePath(); g.fill(); } }
  if (drag && drag.moved) { g.fillStyle = ink; g.font = '600 12px ' + cssVar('--mono'); g.textAlign = 'right'; g.fillText(`${drag.delta > 0 ? '+' : ''}${drag.delta.toFixed(2)} с${drag.own ? ' (только эта)' : ''}`, W - 8, 9); g.textAlign = 'left'; }
  st.W = W; st.H = H;
}
/** Что под курсором: {clip, track} | {ruler: true} | null. */
function tlHit(e) {
  const cv = $('#tl-cv'), st = tlState(), r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (y < TL.RULER) return { ruler: true, t: tlT(st, x) };
  if (x < TL.HEAD) return null;
  const tracks = S.tlTracks || [], ti = Math.floor((y - TL.RULER) / TL.ROW), tr = tracks[ti]; if (!tr) return { empty: true, t: tlT(st, x) };
  const t = tlT(st, x); let best = null;
  for (const clip of tr.clips) { const w = Math.max(3 / st.zoom, clip.row.dur); if (t >= clip.row.at && t <= clip.row.at + w) best = clip; }
  return best && !best.fixed ? { clip: best, track: tr, t } : { empty: true, t };
}
/** Насколько можно сдвинуть реплику назад: не раньше начала предыдущей строки (+0,1 с). */
function tlMinDelta(clip, own) {
  const rows = S.result.lay.rows; let prev = null;
  for (let i = clip.idx - 1; i >= 0; i--) { const rw = rows[i]; if (!rw.bed && (own || !rw.sound)) { prev = rw; break; } }
  return prev ? (prev.at + 0.1) - clip.row.at : -clip.row.at;
}
function tlCommit(clip, delta, own) {
  const id = clip.row.cue.id, tmg = S.timing[id] || (S.timing[id] = { before: 0, own: 0 });
  if (own) tmg.own = +((tmg.own || 0) + delta).toFixed(2); else tmg.before = +((tmg.before || 0) + delta).toFixed(2);
  if (!tmg.before && !tmg.own) delete S.timing[id];
  saveEdits(); tlState().sel = id; remixSoon();
}
function tlSeek(t, play = false) { const a = $('#mix-out audio'); if (!a) return; a.currentTime = Math.max(0, Math.min(a.duration || t, t)); if (play) a.play().catch(() => {}); drawTimeline(); }
function tlInfoHtml() {
  const st = tlState(), r = S.result; if (!r || !st.sel) return '<span class="muted">Щёлкните реплику: сдвиг, пауза перед ней, эффект. Тянуть — двигать (всё дальше едет следом), с Alt — только её. Колёсико — масштаб, Shift+колёсико — прокрутка, двойной щелчок — слушать отсюда.</span>';
  const row = r.lay.rows.find(x => x.cue.id === st.sel); if (!row) return '';
  const c = row.cue, tmg = S.timing[c.id] || {}, who = row.sound ? 'звук' : c.type === 'line' ? charName(c.spk) : 'ремарка';
  const it = r.byId && r.byId.get(c.id), auto = it && typeof fxOfLine === 'function' ? (S.fxLine[c.id] ? null : fxOfLine(c, it.voice)) : null;
  const fx = it && typeof FX_PRESETS !== 'undefined' ? `<label>эффект <select data-act="tl-fx"><option value="">${auto && auto.key !== 'none' ? `сам: ${FX_PRESETS[auto.key].name} (${auto.why})` : 'без эффекта'}</option>${Object.entries(FX_PRESETS).map(([k, p]) => `<option value="${k}" ${S.fxLine[c.id] === k ? 'selected' : ''}>${p.name}</option>`).join('')}</select></label>` : '';
  return `<span class="num">${esc(c.id)}</span><b>${esc(who)}</b><span class="tl-txt">«${esc(tlText(row).slice(0, 90))}»</span>
    <span>начало <b>${C.ts(row.at)}</b></span>${row.gap != null ? `<span>пауза перед <b>${row.gap.toFixed(2)} с</b></span>` : ''}
    ${tmg.before ? `<span>сдвиг <b>${tmg.before > 0 ? '+' : ''}${tmg.before.toFixed(2)} с</b></span>` : ''}${tmg.own ? `<span>только эта <b>${tmg.own > 0 ? '+' : ''}${tmg.own.toFixed(2)} с</b></span>` : ''}
    <button class="ghost-b tiny" data-act="tl-play">▶ отсюда</button>${tmg.before || tmg.own ? '<button class="ghost-b tiny" data-act="tl-reset">сбросить сдвиг</button>' : ''}${fx}`;
}
function tlBarHtml() {
  const st = tlState(), n = Object.keys(S.timing).length;
  return `<button class="ghost-b tiny" data-act="tl-fit">Весь спектакль</button><button class="ghost-b tiny ${st.own ? 'on' : ''}" data-act="tl-own" title="Двигать только выбранную реплику, не сдвигая остальные">только эта реплика</button>
    ${n ? `<button class="ghost-b tiny" data-act="tl-reset-all">сбросить все сдвиги (${n})</button>` : ''}<span>тянуть реплику — двигать, колёсико — масштаб</span>`;
}
function bindTimeline() {
  const host = $('#mix-out'); let raf = null;
  const tick = () => { drawTimeline(); const a = host.querySelector('audio'); const st = tlState(); if (a && !a.paused && !a.ended) { const x = tlX(st, a.currentTime), W = st.W || 800; if (x > W - 40 || x < TL.HEAD) { st.scroll = Math.max(0, a.currentTime - (W - TL.HEAD) / st.zoom * 0.15); } raf = setTimeout(tick, 100); } else raf = null; };
  host.addEventListener('play', () => { if (!raf) tick(); }, true);
  host.addEventListener('pause', () => drawTimeline(), true); host.addEventListener('seeked', () => drawTimeline(), true);
  host.addEventListener('pointerdown', e => {
    if (e.target.id !== 'tl-cv') return;
    const st = tlState(), hit = tlHit(e); e.target.focus();
    if (!hit) return;
    if (hit.ruler) { st.scrub = true; tlSeek(hit.t); }
    else if (hit.clip) { st.drag = { clip: hit.clip, x0: e.clientX, delta: 0, own: e.altKey || st.own, moved: false, min: tlMinDelta(hit.clip, e.altKey || st.own) }; }
    else st.pan = { x0: e.clientX, scroll0: st.scroll };
    try { e.target.setPointerCapture(e.pointerId); } catch {}
  });
  host.addEventListener('pointermove', e => {
    if (e.target.id !== 'tl-cv') return;
    const st = tlState();
    if (st.drag) { const d = (e.clientX - st.drag.x0) / st.zoom; if (Math.abs(e.clientX - st.drag.x0) > 3) st.drag.moved = true; st.drag.delta = Math.max(st.drag.min, Math.min(60, d)); drawTimeline(); }
    else if (st.pan) { st.scroll = st.pan.scroll0 - (e.clientX - st.pan.x0) / st.zoom; drawTimeline(); }
    else if (st.scrub) { const hit = tlHit(e); if (hit && hit.t != null) tlSeek(hit.t); }
    else { const hit = tlHit(e); e.target.style.cursor = hit && hit.clip ? 'grab' : hit && hit.ruler ? 'col-resize' : 'default'; }
  });
  const up = e => {
    const st = tlState();
    if (st.drag) { const d = st.drag; st.drag = null; if (d.moved && Math.abs(d.delta) >= 0.01) tlCommit(d.clip, d.delta, d.own); else { st.sel = d.clip.row.cue.id; $('#tl-info').innerHTML = tlInfoHtml(); } drawTimeline(); }
    st.pan = null; st.scrub = false;
  };
  host.addEventListener('pointerup', e => { if (e.target.id === 'tl-cv') up(e); });
  host.addEventListener('pointercancel', e => { if (e.target.id === 'tl-cv') up(e); });
  host.addEventListener('dblclick', e => { if (e.target.id !== 'tl-cv') return; const hit = tlHit(e); if (hit && hit.clip) tlSeek(hit.clip.row.at, true); });
  host.addEventListener('wheel', e => {
    if (e.target.id !== 'tl-cv') return; e.preventDefault();
    const st = tlState(), r = e.target.getBoundingClientRect(), mx = e.clientX - r.left;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { st.scroll += (e.deltaX || e.deltaY) / st.zoom; }
    else { const t = tlT(st, mx); st.zoom *= Math.pow(1.25, -e.deltaY / 100); st.zoom = Math.max((st.W - TL.HEAD) / S.result.lay.total, Math.min(TL.MAX_ZOOM, st.zoom)); st.scroll = t - (mx - TL.HEAD) / st.zoom; }
    drawTimeline();
  }, { passive: false });
  host.addEventListener('keydown', e => {
    if (e.target.id !== 'tl-cv') return; const st = tlState(); if (!st.sel || !S.result) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault();
    const clip = (S.tlTracks || []).flatMap(t => t.clips).find(c => c.row.cue.id === st.sel); if (!clip) return;
    const step = (e.shiftKey ? 0.5 : 0.05) * (e.key === 'ArrowLeft' ? -1 : 1), own = e.altKey || st.own;
    tlCommit(clip, Math.max(tlMinDelta(clip, own), step), own);
  });
  host.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const st = tlState(), a = b.dataset.act;
    if (a === 'tl-fit') { st.zoom = 0; st.scroll = 0; drawTimeline(); }
    else if (a === 'tl-own') { st.own = !st.own; b.classList.toggle('on', st.own); }
    else if (a === 'tl-reset-all') { S.timing = {}; saveEdits(); remixSoon(); }
    else if (a === 'tl-play') { const row = S.result.lay.rows.find(x => x.cue.id === st.sel); if (row) tlSeek(row.at, true); }
    else if (a === 'tl-reset') { delete S.timing[st.sel]; saveEdits(); remixSoon(); }
  });
  host.addEventListener('change', e => {
    const x = e.target; if (x.dataset.act !== 'tl-fx') return; const st = tlState(); if (!st.sel) return;
    if (x.value) S.fxLine[st.sel] = x.value; else delete S.fxLine[st.sel]; saveEdits(); remixSoon();
  });
  window.addEventListener('resize', () => drawTimeline());
}
