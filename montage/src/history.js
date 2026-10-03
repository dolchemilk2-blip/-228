// Монтажка — отмена и повтор правок сведения (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y).
// Перед каждой правкой запоминается снимок: сдвиги, эффекты, громкость реплик и персонажей, темп.
// Отмена возвращает снимок и пересчитывает только то, что в нём поменялось.
// Использует S, saveEdits, remixSoon, voiceIds, notify, renderMix из app.js.
const HIST = { undo: [], redo: [], max: 200 };
const HIST_KEYS = ['timing', 'fxLine', 'fxVoice', 'voiceGains', 'gains', 'tempo'];
const histSnap = () => JSON.stringify(Object.fromEntries(HIST_KEYS.map(k => [k, S[k]])));
/** Запомнить состояние до правки. label — что будет сделано («эффект «зал» у 12 реплик»). */
function histPush(label) {
  HIST.undo.push({ label, snap: histSnap() });
  if (HIST.undo.length > HIST.max) HIST.undo.shift();
  HIST.redo = [];
  histUi();
}
const histDiff = (a = {}, b = {}) => { const out = []; for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k); return out; };
function histApply(snap) {
  const prev = JSON.parse(histSnap()), next = JSON.parse(snap);
  for (const k of HIST_KEYS) S[k] = next[k] ?? (k === 'tempo' ? 1 : {});
  saveEdits();
  if (!S.result) return;
  const ids = new Set([...histDiff(prev.fxLine, next.fxLine), ...histDiff(prev.gains, next.gains)]);
  for (const v of [...histDiff(prev.fxVoice, next.fxVoice), ...histDiff(prev.voiceGains, next.voiceGains)]) for (const id of voiceIds(v)) ids.add(id);
  const layout = histDiff(prev.timing, next.timing).length || prev.tempo !== next.tempo;
  if (layout) remixSoon('layout');
  if (ids.size) remixSoon('lines', ids);
  const voiceUi = histDiff(prev.fxVoice, next.fxVoice).length || histDiff(prev.voiceGains, next.voiceGains).length || prev.tempo !== next.tempo;
  if (voiceUi) renderMix();                           // ползунки персонажей и темпа — к восстановленным значениям
}
function histUndo() {
  const e = HIST.undo.pop(); if (!e) { tlFlash('Отменять нечего'); return; }
  HIST.redo.push({ label: e.label, snap: histSnap() }); histApply(e.snap); tlFlash('Отменено: ' + e.label); histUi();
}
function histRedo() {
  const e = HIST.redo.pop(); if (!e) { tlFlash('Повторять нечего'); return; }
  HIST.undo.push({ label: e.label, snap: histSnap() }); histApply(e.snap); tlFlash('Повторено: ' + e.label); histUi();
}
function histUi() {
  document.querySelectorAll('[data-act=tl-undo]').forEach(b => { const e = HIST.undo[HIST.undo.length - 1]; b.disabled = !e; b.title = e ? `Отменить: ${e.label} (Ctrl+Z)` : 'Отменять нечего'; });
  document.querySelectorAll('[data-act=tl-redo]').forEach(b => { const e = HIST.redo[HIST.redo.length - 1]; b.disabled = !e; b.title = e ? `Повторить: ${e.label} (Ctrl+Shift+Z)` : 'Повторять нечего'; });
}
/** Короткое сообщение: и в таймлайне (виден на весь экран), и внизу страницы. */
let flashTimer = null;
function tlFlash(t) {
  const el = document.querySelector('.tl-flash');
  if (el) { el.textContent = t; el.classList.add('on'); clearTimeout(flashTimer); flashTimer = setTimeout(() => el.classList.remove('on'), 2200); }
  if (!document.fullscreenElement) notify(t);
}
