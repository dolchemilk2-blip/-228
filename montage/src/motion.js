// Монтажка — движение интерфейса: пружины (spring.js), CSS-переходы и Web Animations, без библиотек.
// Правила (apple-design, emilkowalski/skills, transitions.dev, impeccable):
// - то, чего касаешься, отвечает сразу: кнопки сжимаются в момент нажатия, значки тянутся к курсору;
// - то, что тянешь, идёт за пальцем 1:1, у краёв — резиновое сопротивление, после броска — по инерции
//   (проекция импульса Apple) и на пружине с той же скоростью: подложка вкладок, уведомление, файлы;
// - любое движение можно перехватить: пружины стартуют с текущего значения;
// - открытие — пружина из точки вызова, уход — короче; всё, что вызвано с клавиатуры, — мгновенно;
// - прогресс — «остров» в деке: вырастает из пилюли и сворачивается обратно;
// - смена вкладок — View Transitions: старая уезжает, новая приезжает с той стороны, куда нажали;
// - prefers-reduced-motion: только проявления, пружины встают на место сразу.
// Использует S, render, counts, fmt, $, C, moveFile из app.js, drawTimeline из timeline.js, пружины из spring.js.
const MOTION = { reduce: false, kbd: 0, ready: false, vt: false, lastKeys: new Map(), counts: new Map(), done: new Map(), view: 0, pinStep: null, railCur: null };
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const mOK = () => !MOTION.reduce && typeof Element.prototype.animate === 'function';
/** Вход: из «до» в покой на пружине (или на кривой, если задана). В режиме без движения — только прозрачность. */
function mIn(el, from, spring = [0.86, 0.45], extra = {}) {
  if (!el || typeof el.animate !== 'function') return null;
  const to = {}; for (const k of Object.keys(from)) to[k] = k === 'opacity' ? 1 : k === 'filter' ? 'blur(0px)' : extra.rest && extra.rest[k] != null ? extra.rest[k] : 'none';
  if (MOTION.reduce) { const f = { opacity: 0 }, t = { opacity: 1 }; if (extra.rest) Object.assign(f, extra.rest), Object.assign(t, extra.rest); return el.animate([f, t], { duration: 150, easing: 'ease-out', fill: 'backwards', delay: extra.delay || 0 }); }
  const sp = springEase(spring[0], spring[1]);
  return el.animate([from, to], { duration: sp.duration, easing: sp.easing, fill: 'backwards', delay: extra.delay || 0 });
}
function motionInit() {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)'), forced = () => document.documentElement.dataset.motion === 'reduce';   // «Меньше» в «Оформлении»
  MOTION.reduce = mq.matches || forced();
  mq.addEventListener('change', () => { MOTION.reduce = mq.matches || forced(); });
  // пружины для CSS: переходы галочек, тумблеров, раскрывашки, значков
  const root = document.documentElement.style;
  for (const [name, d, r] of [['snappy', 0.72, 0.32], ['smooth', 1, 0.38], ['bouncy', 0.6, 0.42], ['pane', 0.9, 0.5]]) { const sp = springEase(d, r); root.setProperty(`--spring-${name}`, sp.easing); root.setProperty(`--spring-${name}-dur`, sp.duration + 'ms'); }
  const deck = document.querySelector('.deck');
  if (deck && window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--deck-h', (deck.getBoundingClientRect().height - (parseFloat(getComputedStyle(deck).paddingTop) || 0)) + 'px')).observe(deck);
  tabIndicator(true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { tabIndicator(true); railIndicator(true); });
  const tabs = document.querySelector('.tabs'); if (tabs && window.ResizeObserver) new ResizeObserver(() => tabIndicator(true)).observe(tabs);
  initRail(); initAccordions(); segInit(); initTabsDrag(); initToast(); initFileDrag();
  if (typeof initTouch === 'function') { initTouch(); initTilt('.models', 7); }
  new MutationObserver(list => { for (const m of list) if (m.attributeName === 'hidden' && !m.target.hidden && m.oldValue != null) appear(m.target); })
    .observe(document.body, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true, subtree: true });
  const watch = (sel, fn) => { const el = document.querySelector(sel); if (el) new MutationObserver(() => fn(el)).observe(el, { childList: true }); };
  watch('#files', el => staggerList([...el.querySelectorAll('.file')].filter(x => { const k = 'f:' + (x.querySelector('.fname') || {}).textContent; if (MOTION.lastKeys.has(k)) return false; MOTION.lastKeys.set(k, 1); return true; })));
  watch('#rv-list', el => { const key = el.dataset.v || ''; const prev = MOTION.lastKeys.get('rv'); if (prev === key) return; MOTION.lastKeys.set('rv', key);
    if (prev == null || prev.split('|')[2] !== key.split('|')[2]) staggerList([...el.children].slice(0, 10)); else fadeList(el); });
  watch('#cl-body', el => { const key = (S.cleanFile && S.cleanFile.name) || ''; if (MOTION.lastKeys.get('cl') === key || !el.querySelector('.mods')) return; MOTION.lastKeys.set('cl', key); staggerList([el.querySelector('.cl-head'), ...el.querySelectorAll('.mod')].filter(Boolean).slice(0, 10)); });
  watch('#sfx-body', el => { if (MOTION.lastKeys.get('sfx') || !el.querySelector('.srow, .arow')) return; MOTION.lastKeys.set('sfx', 1); staggerList([...el.querySelectorAll('.ambbox, .dbbox, .srow')].slice(0, 10)); });
  watch('#mix-out', el => { const top = el.querySelector('#mix-top'); if (!top || !top.firstElementChild || top.dataset.m) return; top.dataset.m = '1'; staggerList([top, el.querySelector('#mix-tlcard'), el.querySelector('#mix-rest')].filter(Boolean), 60); });
  watch('#mix-tl', el => { const tl = el.querySelector('.tl'); if (!tl || tl.dataset.m || !tl.getClientRects().length) return; tl.dataset.m = '1'; splice(tl); });
  requestAnimationFrame(() => requestAnimationFrame(() => { MOTION.ready = true; }));
}
const atTop = el => el.getBoundingClientRect().top < innerHeight / 2;
function appear(el) {
  if (el.id === 'prog') { cancelGhost(el); islandIn(el); return; }
  if (el.id === 'msg') { cancelGhost(el); toastReset(el); const dy = atTop(el) ? -22 : 22; mIn(el, { opacity: 0, transform: `translate(-50%, ${dy}px) scale(0.9)`, filter: 'blur(6px)' }, [0.7, 0.5], { rest: { transform: 'translate(-50%, 0px) scale(1)' } }); return; }
  if (el.classList.contains('sheetbox')) { sheetIn(el); return; }
  if (el.id === 'tl-menu') return;                                     // своё движение: кружок «+» вырастает в меню (timeline.js)
  if (el.classList.contains('picker')) { foldIn(el); staggerList([...el.children].slice(0, 8), 30); return; }   // раздвигает строки, а не прыгает
  if (el.matches('section.card')) { if (MOTION.ready) mIn(el, { opacity: 0, transform: 'translateY(14px) scale(0.99)' }, [0.88, 0.5]); return; }   // большие поверхности — без размытия
  if (el.matches('[data-tabpane]')) { paneIn(el); return; }
}
// ------------------------------------------------------------------ шторки снизу: дозапись и «другой кусок» на телефоне
// Выезжает снизу на пружине; за ручку или шапку тянется 1:1, вверх — резина; бросок вниз или дальше половины —
// уезжает с той же скоростью, иначе возвращается на пружине с лёгким перелётом. Затемнение следует за шторкой.
const phoneUI = () => matchMedia('(max-width: 720px)').matches;
const SHEET_IN = '.rec-in, .sheet-in';
function sheetIn(el) {
  cancelGhost(el); if (el._sheet) mvSet(el._sheet, 0);
  const inn = el.querySelector(SHEET_IN); if (!mOK() || !inn) return;
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
  if (phoneUI()) mIn(inn, { transform: 'translateY(100%)' }, [0.9, 0.42]); else mIn(inn, { opacity: 0, transform: 'translateY(48px) scale(0.97)' }, [0.84, 0.5]);
}
/** Закрытие кнопкой, Esc или щелчком по затемнению: уходит копия — вниз, откуда пришла; настоящая скрыта сразу. */
function sheetGhostOut(el) {
  const inn = el && el.querySelector(SHEET_IN); if (!mOK() || !inn || el.hidden) return;
  const tr = getComputedStyle(inn).transform, y0 = tr && tr !== 'none' ? new DOMMatrixReadOnly(tr).m42 : 0, bg = getComputedStyle(el).backgroundColor;
  const g = el.cloneNode(true); g.removeAttribute('id'); g.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
  g.inert = true; g.setAttribute('aria-hidden', 'true'); g.dataset.ghost = el.id; g.style.pointerEvents = 'none'; g.hidden = false;
  document.body.appendChild(g);
  const gi = g.querySelector(SHEET_IN), phone = phoneUI(), ms = phone ? 260 : 200;
  g.animate([{ backgroundColor: bg }, { backgroundColor: 'rgb(10 8 6 / 0)' }], { duration: ms, easing: 'ease-out', fill: 'forwards' });
  const a = gi.animate(phone ? [{ transform: `translateY(${y0}px)` }, { transform: `translateY(${inn.offsetHeight + 24}px)` }]
    : [{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'translateY(24px) scale(0.97)', filter: 'blur(3px)' }],
    { duration: ms, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' });
  a.onfinish = a.oncancel = () => g.remove();
}
/** Тянуть шторку. close(true) — её смахнули (уже за краем, копия не нужна). canClose() — можно ли закрыть сейчас. */
function sheetDrag(el, grabSel, close, canClose = () => true) {
  let d = null, out = false;
  const inner = () => el.querySelector(SHEET_IN);
  const owner = { render() {
    const inn = inner(), y = m.v, h = (inn && inn.offsetHeight) || 400;
    if (inn) inn.style.transform = Math.abs(y) < 0.05 ? '' : `translate3d(0, ${y.toFixed(2)}px, 0)`;
    if (y > 0.5) el.style.setProperty('--dim', Math.max(0, 1 - y / h).toFixed(3)); else el.style.removeProperty('--dim');
    if (out && !SPRING.live.has(m)) { out = false; el.style.pointerEvents = ''; close(true); mvSet(m, 0); }
  } };
  const m = mv(0, 0.3, owner); el._sheet = m;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || out || !e.target.closest(grabSel) || e.target.closest('button, input, select, a, label')) return;
    const inn = inner(); if (!inn) return;
    const tr = getComputedStyle(inn).transform, cur = tr && tr !== 'none' ? new DOMMatrixReadOnly(tr).m42 : 0;   // перехват на лету — с того места, где она сейчас
    inn.getAnimations().forEach(a => a.cancel()); mvSet(m, cur);
    d = { id: e.pointerId, y0: e.clientY - cur, hist: [{ t: performance.now(), x: 0, y: e.clientY }] };
    try { e.target.setPointerCapture(e.pointerId); } catch {}
  });
  el.addEventListener('pointermove', e => {
    if (!d || d.id !== e.pointerId) return;
    const y = e.clientY - d.y0; d.hist.push({ t: performance.now(), x: 0, y: e.clientY }); if (d.hist.length > 8) d.hist.shift();
    mvSet(m, y < 0 ? -rubber(-y, 90) : canClose() ? y : rubber(y, 140));
  });
  const up = e => {
    if (!d || d.id !== e.pointerId) return; const v = velocityOf(d.hist).y; d = null;
    const inn = inner(), h = (inn && inn.offsetHeight) || 400;
    // куда долетела бы (проекция Apple, как у прокрутки): дальше половины или бросок — закрыть
    if (canClose() && m.v > 0 && (m.v + project(v, 0.998) > h * 0.5 || v > 900)) { out = true; el.style.pointerEvents = 'none'; mvTo(m, h + 24, { damping: 1, response: 0.28, velocity: Math.max(v, 400) }); }
    else mvTo(m, 0, { damping: 0.8, response: 0.32, velocity: v });
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
/** Нижняя шторка общего вида: шапка, содержимое, свой обработчик щелчков. */
const SHEET = { back: null, onClick: null };
function sheetOpen(head, body, { label = '', onClick = null, id = '' } = {}) {
  let el = document.getElementById('sheet');
  if (!el) {
    el = document.createElement('div'); el.id = 'sheet'; el.className = 'sheetbox'; el.hidden = true; document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-sheet=close]')) sheetClose(); else if (SHEET.onClick) SHEET.onClick(e); });
    sheetDrag(el, '.sheet-grab, .sheet-top', () => sheetClose(true));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden) sheetClose(); });
  }
  if (el.hidden) SHEET.back = document.activeElement;
  SHEET.onClick = onClick; el.dataset.for = id;
  el.innerHTML = `<div class="sheet-in" role="dialog" aria-modal="true" aria-label="${label}"><div class="sheet-top"><div class="sheet-grab" aria-hidden="true"></div><div class="sheet-head">${head}<button class="icon" data-sheet="close" aria-label="Закрыть">${ic('close')}</button></div></div><div class="sheet-body">${body}</div></div>`;
  el.hidden = false; el.querySelector('[data-sheet=close]').focus({ preventScroll: true });
}
function sheetClose(swiped) {
  const el = document.getElementById('sheet'); if (!el || el.hidden) return;
  if (!swiped) sheetGhostOut(el);
  if (typeof playing !== 'undefined' && playing && playing.btn && el.contains(playing.btn)) stop();   // кусок, который слушали в шторке, замолкает с ней
  el.hidden = true; el.innerHTML = ''; SHEET.onClick = null;
  if (SHEET.back && SHEET.back.isConnected) SHEET.back.focus({ preventScroll: true }); SHEET.back = null;
}
// ------------------------------------------------------------------ остров: прогресс вырастает из пилюли
function islandIn(el) {
  if (!mOK()) return;
  const R = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 20, w = el.offsetWidth, pill = Math.max(0, w / 2 - 22);
  const sp = springEase(0.74, 0.55);
  el.animate([{ clipPath: `inset(0 ${pill}px round ${R}px)`, opacity: 0.4 }, { clipPath: `inset(0 0px round ${R}px)`, opacity: 1 }], { duration: sp.duration, easing: sp.easing });
  const inner = el.querySelector('.in'); if (inner) mIn(inner, { opacity: 0, transform: 'scale(0.96)', filter: 'blur(5px)' }, [1, 0.4], { delay: 90 });
}
function islandOut(el) {
  if (!mOK() || el.hidden || !el.isConnected) return;
  const R = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 20, pill = Math.max(0, el.offsetWidth / 2 - 22);
  motionGhostOut(el, { clipPath: `inset(0 ${pill}px round ${R}px)`, filter: 'blur(3px)' }, 300, { clipPath: `inset(0 0px round ${R}px)` });
}
/** Надпись прогресса: меняется «этап» — старая уходит вверх, новая приходит снизу (transitions.dev: text swap). */
function progText(el, t) {
  const phase = t.replace(/[\d.,]+\s*%?/g, '#').replace(/\s+/g, ' ').trim();
  if (MOTION.progPhase && phase !== MOTION.progPhase && t && mOK()) mIn(el, { opacity: 0, transform: 'translateY(5px)', filter: 'blur(2px)' }, [1, 0.3]);
  MOTION.progPhase = t ? phase : null;
}
/** Уход без ожидания: копия уходит, настоящий элемент уже скрыт. Вызывать до того, как элемент спрятан. */
function motionGhostOut(el, to, ms = 150, from = {}, host = null) {
  if (!mOK() || !el || el.hidden || !el.isConnected) return;
  const r = el.getBoundingClientRect(); if (!r.width) return;
  const g = el.cloneNode(true); g.removeAttribute('id'); g.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
  g.inert = true; g.setAttribute('aria-hidden', 'true'); g.removeAttribute('role'); g.dataset.ghost = el.id || '1';
  Object.assign(g.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', pointerEvents: 'none', transform: 'none', bottom: 'auto', right: 'auto', zIndex: 90, maxHeight: 'none', flex: 'none' });
  (host || el.parentNode || document.body).appendChild(g);   // host — если родителя сейчас перестроят вместе с копией
  const a = g.animate([{ opacity: 1, transform: 'none', filter: 'blur(0px)', ...from }, { opacity: 0, ...to }], { duration: ms, easing: EASE, fill: 'forwards' });
  a.onfinish = a.oncancel = () => g.remove();
}
function cancelGhost(el) { document.querySelectorAll(`[data-ghost="${el.id}"]`).forEach(g => g.remove()); }
// ------------------------------------------------------------------ уведомление: смахнуть пальцем, наведение держит
const TOAST = { drag: null, m: null };
function toastReset(el) { TOAST.drag = null; if (TOAST.m) mvSet(TOAST.m, 0); el.style.transform = ''; el.style.opacity = ''; }
/** Сообщение уходит туда, откуда пришло, и скрывается. */
function motionHide(el, done) {
  if (!mOK() || el.hidden) { el.hidden = true; done && done(); return; }
  const dy = atTop(el) ? -26 : 26;
  const a = el.animate([{ opacity: 1, transform: 'translate(-50%, 0px) scale(1)', filter: 'blur(0px)' }, { opacity: 0, transform: `translate(-50%, ${dy}px) scale(0.94)`, filter: 'blur(4px)' }], { duration: 220, easing: EASE, fill: 'forwards' });
  a.onfinish = () => { el.hidden = true; a.cancel(); done && done(); };
}
function initToast() {
  const el = document.getElementById('msg'); if (!el) return;
  const owner = { render() { el.style.transform = Math.abs(TOAST.m.v) < 0.05 && !SPRING.live.has(TOAST.m) ? '' : `translate(-50%, ${TOAST.m.v.toFixed(2)}px)`; el.style.opacity = TOAST.fade(TOAST.m.v); } };
  TOAST.m = mv(0, 0.05, owner);
  TOAST.fade = y => { const dir = atTop(el) ? -1 : 1, out = y * dir; return out > 0 ? String(Math.max(0.2, 1 - out / 120)) : ''; };
  el.addEventListener('pointerdown', e => {
    if (MOTION.reduce || e.button !== 0 || e.target.closest('button')) return;   // кнопка в сообщении нажимается, а не тянет его
    el.setPointerCapture(e.pointerId);
    TOAST.drag = { y0: e.clientY - TOAST.m.v, dir: atTop(el) ? -1 : 1, hist: [{ t: performance.now(), x: e.clientX, y: e.clientY }] };
  });
  el.addEventListener('pointermove', e => {
    const d = TOAST.drag; if (!d) return;
    d.hist.push({ t: performance.now(), x: e.clientX, y: e.clientY }); if (d.hist.length > 8) d.hist.shift();
    let y = e.clientY - d.y0; if (y * d.dir < 0) y = rubber(y, 80);           // против направления ухода — резина
    mvSet(TOAST.m, y);
  });
  const end = () => {
    const d = TOAST.drag; if (!d) return; TOAST.drag = null;
    const v = velocityOf(d.hist).y, y = TOAST.m.v, proj = y + project(v, 0.99);
    if (proj * d.dir > 60 || v * d.dir > 600) {                                   // бросили — улетает с той же скоростью
      const h = el.offsetHeight + 40, dist = Math.abs(d.dir * h - y), ms = Math.max(120, Math.min(320, dist / Math.max(0.6, Math.abs(v) / 1000)));
      const a = el.animate([{ transform: `translate(-50%, ${y}px)`, opacity: el.style.opacity || 1 }, { transform: `translate(-50%, ${d.dir * h}px)`, opacity: 0 }], { duration: ms, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' });
      a.onfinish = () => { el.hidden = true; a.cancel(); toastReset(el); };
    } else mvTo(TOAST.m, 0, { damping: 0.7, response: 0.4, velocity: v });        // не добросили — пружиной обратно
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
/** Список: лесенка по 40 мс на пружине, не больше 10 строк. Во время лесенки всё уже кликабельно. */
function staggerList(els, each = 40) {
  if (!els.length || typeof els[0].animate !== 'function' || !MOTION.ready) return;
  els.forEach((el, i) => mIn(el, { opacity: 0, transform: 'translateY(10px) scale(0.99)' }, [0.88, 0.42], { delay: Math.min(i, 9) * each }));
}
function fadeList(el) { if (typeof el.animate === 'function') el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' }); }
// ------------------------------------------------------------------ вкладки
let paneDir = 1;
function paneIn(pane) { if (MOTION.ready) mIn(pane, { opacity: 0, transform: `translateX(${12 * paneDir}px)` }, [0.92, 0.36]); }
function motionTab(prev, next) {
  const order = ['home', 'build', 'tl', 'clean', 'sfx'], a = order.indexOf(prev), b = order.indexOf(next); paneDir = b >= a ? 1 : -1;
  tabIndicator(false);
}
/** Смена вкладки через View Transitions: старая уезжает в сторону, новая приезжает с другой. */
// Смена вкладки — без View Transitions: снимок всей длинной страницы стоил сотни миллисекунд на слабых машинах.
// Новая вкладка просто приезжает с той стороны, куда нажали (paneIn: сдвиг и прозрачность — только композитор).
function motionTabSwitch(next, apply) {
  // высота страницы меняется вместе с вкладкой — подвал доезжает до нового места, а не прыгает
  const ft = document.querySelector('footer'), r0 = ft && MOTION.ready && !MOTION.reduce ? ft.getBoundingClientRect().top : null;
  apply();
  if (r0 != null && r0 < innerHeight) { const r1 = ft.getBoundingClientRect().top, dy = r0 - r1; if (Math.abs(dy) > 2 && r1 < innerHeight) { const T = tform(ft); mvSet(T.y, dy); mvTo(T.y, 0, { damping: 0.92, response: 0.4 }); } }
}
/** Подложка вкладок на пружине: при движении тянется в сторону хода, как капля; её можно схватить и протащить. */
const PILL = { drag: null, suppress: false };
PILL.render = () => {
  const ind = document.querySelector('.tab-ind'); if (!ind) return;
  const v = PILL.x.vel, st = PILL.drag ? 0 : Math.min(22, Math.abs(v) * 0.02), left = PILL.x.v - (v < 0 ? st : 0);
  ind.style.width = (PILL.w.v + st).toFixed(2) + 'px';
  ind.style.transform = `translateX(${left.toFixed(2)}px) scale(${PILL.drag ? 1.04 : 1}, ${(1 - st / 140).toFixed(4)})`;
  // подписи под подложкой — тёмные ровно по её краю (клон-маска), без смены цвета «рывком»
  const clip = ind.parentElement.querySelector('.tabs-clip');
  // размеры маски — из запомненных в tabsClipSync: чтение offsetLeft/scrollWidth здесь заставляло браузер
  // пересчитывать раскладку в каждом кадре пружины
  if (clip) { const x0 = left - (PILL.cx || 0), w = PILL.w.v + st, W = PILL.cw || clip.scrollWidth; clip.style.clipPath = `inset(0 ${(W - x0 - w).toFixed(2)}px 0 ${x0.toFixed(2)}px round 16px)`; }
};
function tabsClipSync() {
  const tabs = document.querySelector('.tabs'); if (!tabs) return;
  const list = [...tabs.querySelectorAll('button[data-tab]')]; if (!list.length) return;
  let clip = tabs.querySelector('.tabs-clip');
  if (!clip) { clip = document.createElement('div'); clip.className = 'tabs-clip'; clip.setAttribute('aria-hidden', 'true'); tabs.appendChild(clip); tabs.classList.add('clipped'); }
  clip.innerHTML = list.map(b => `<span style="width:${b.offsetWidth}px">${b.innerHTML}</span>`).join('');   // с разметкой: на телефоне часть подписи прячется
  clip.style.left = list[0].offsetLeft + 'px'; clip.style.top = list[0].offsetTop + 'px';
  PILL.cx = list[0].offsetLeft; PILL.cw = clip.scrollWidth;
}
PILL.x = mv(0, 0.05, PILL); PILL.w = mv(0, 0.05, PILL);
function tabIndicator(instant) {
  const tabs = document.querySelector('.tabs'); if (!tabs) return;
  const on = tabs.querySelector('button.on'); if (!on || PILL.drag) return;
  if (instant || !MOTION.ready) { tabsClipSync(); mvSet(PILL.x, on.offsetLeft); mvSet(PILL.w, on.offsetWidth); PILL.render(); return; }
  mvTo(PILL.x, on.offsetLeft, { damping: 0.74, response: 0.42 }); mvTo(PILL.w, on.offsetWidth, { damping: 0.9, response: 0.42 });
}
function initTabsDrag() {
  const tabs = document.querySelector('.tabs'); if (!tabs) return;
  const btns = () => [...tabs.querySelectorAll('button[data-tab]')];
  tabs.addEventListener('click', e => { if (PILL.suppress) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  tabs.addEventListener('pointerdown', e => {
    const b = e.target.closest('button'); if (!b || !b.classList.contains('on') || e.button !== 0 || MOTION.reduce) return;
    const r = tabs.getBoundingClientRect();
    PILL.drag = { x0: e.clientX, grab: e.clientX - r.left - tabs.clientLeft - PILL.x.v, moved: false, hist: [{ t: performance.now(), x: e.clientX, y: 0 }], id: e.pointerId };
  });
  tabs.addEventListener('pointermove', e => {
    const d = PILL.drag; if (!d) return;
    if (!d.moved) { if (Math.abs(e.clientX - d.x0) < 6) return; d.moved = true; try { tabs.setPointerCapture(d.id); } catch {} }
    d.hist.push({ t: performance.now(), x: e.clientX, y: 0 }); if (d.hist.length > 8) d.hist.shift();
    const list = btns(), r = tabs.getBoundingClientRect(), lo = list[0].offsetLeft, hi = list[list.length - 1].offsetLeft + list[list.length - 1].offsetWidth - PILL.w.v;
    let x = e.clientX - r.left - tabs.clientLeft - d.grab;
    if (x < lo) x = lo - rubber(lo - x, 60); else if (x > hi) x = hi + rubber(x - hi, 60);
    mvSet(PILL.x, x);
    const c = x + PILL.w.v / 2, near = list.reduce((a, b) => Math.abs(b.offsetLeft + b.offsetWidth / 2 - c) < Math.abs(a.offsetLeft + a.offsetWidth / 2 - c) ? b : a);
    mvTo(PILL.w, near.offsetWidth, { damping: 1, response: 0.25 });
    list.forEach(b => b.classList.toggle('near', b === near));
  });
  const end = () => {
    const d = PILL.drag; if (!d) return; PILL.drag = null;
    btns().forEach(b => b.classList.remove('near'));
    if (!d.moved) { PILL.render(); return; }
    const v = velocityOf(d.hist).x, c = PILL.x.v + PILL.w.v / 2 + project(v, 0.99) * 0.35;
    const list = btns(), near = list.reduce((a, b) => Math.abs(b.offsetLeft + b.offsetWidth / 2 - c) < Math.abs(a.offsetLeft + a.offsetWidth / 2 - c) ? b : a);
    PILL.x.vel = v;                                                   // скорость пальца переходит в пружину
    if (!near.classList.contains('on')) near.click(); else tabIndicator(false);
    PILL.suppress = true; setTimeout(() => { PILL.suppress = false; }, 0);
  };
  tabs.addEventListener('pointerup', end); tabs.addEventListener('pointercancel', end);
}
// ------------------------------------------------------------------ файлы: перетащить за ручку, соседи расступаются
function initFileDrag() {
  const box = document.getElementById('files'); if (!box) return;
  let d = null;
  box.addEventListener('pointerdown', e => {
    const g = e.target.closest('.grip'); if (!g || e.button !== 0) return;
    e.preventDefault(); g.setPointerCapture(e.pointerId);
    const cards = [...box.querySelectorAll('.file')], card = g.closest('.file'), idx = cards.indexOf(card);
    d = { g, card, idx, cards, rects: cards.map(c => c.getBoundingClientRect()), y0: e.clientY, target: idx, hist: [{ t: performance.now(), x: 0, y: e.clientY }] };
    card.classList.add('lift'); const T = tform(card); mvTo(T.s, 1.025, { damping: 0.8, response: 0.3 });
  });
  box.addEventListener('pointermove', e => {
    if (!d) return;
    d.hist.push({ t: performance.now(), x: 0, y: e.clientY }); if (d.hist.length > 8) d.hist.shift();
    const r = d.rects, me = r[d.idx], lo = r[0].top - me.top, hi = r[r.length - 1].bottom - me.bottom;
    let y = e.clientY - d.y0; if (y < lo) y = lo - rubber(lo - y, 80); else if (y > hi) y = hi + rubber(y - hi, 80);
    mvSet(tform(d.card).y, y);
    d.target = fileSlot(d, me.top + y + me.height / 2);
    fileMakeRoom(d);
  });
  const end = () => {
    if (!d) return; const s = d; d = null;
    const v = velocityOf(s.hist).y, me = s.rects[s.idx], T = tform(s.card);
    s.target = fileSlot(s, me.top + T.y.v + me.height / 2 + project(v, 0.99) * 0.25); fileMakeRoom(s);
    const to = fileOffset(s);
    mvTo(T.y, to, { damping: 0.82, response: 0.35, velocity: v }); mvTo(T.s, 1, { damping: 0.7, response: 0.35 });
    const finish = () => { s.card.classList.remove('lift'); s.cards.forEach(c => { const t = tform(c); mvSet(t.y, 0); mvSet(t.s, 1); }); if (s.target !== s.idx && typeof moveFile === 'function') moveFile(s.idx, s.target); };
    if (MOTION.reduce) finish(); else setTimeout(finish, 380);
  };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
}
function fileSlot(d, center) { let t = 0; d.rects.forEach((r, i) => { if (center > r.top + r.height / 2) t = i; }); return Math.max(0, Math.min(d.rects.length - 1, center < d.rects[0].top + d.rects[0].height / 2 ? 0 : t)); }
function fileOffset(d) { const r = d.rects, i = d.idx, t = d.target; if (t === i) return 0; return t > i ? r[t].bottom - r[i].bottom : r[t].top - r[i].top; }
function fileMakeRoom(d) {
  const h = d.rects[d.idx].height;
  d.cards.forEach((c, k) => { if (k === d.idx) return; const shift = d.target > d.idx && k > d.idx && k <= d.target ? -h : d.target < d.idx && k >= d.target && k < d.idx ? h : 0; const T = tform(c); if (T.y.to !== shift) mvTo(T.y, shift, { damping: 0.85, response: 0.32 }); });
}
// ------------------------------------------------------------------ монтажный лист: шаги слева
const RAIL = {}; RAIL.render = () => { const ind = document.querySelector('.rail-ind'); if (!ind) return; ind.style.transform = `translateY(${RAIL.y.v.toFixed(2)}px)`; ind.style.height = RAIL.h.v.toFixed(2) + 'px'; };
RAIL.y = mv(0, 0.05, RAIL); RAIL.h = mv(0, 0.05, RAIL);
function initRail() {
  const rail = document.querySelector('.rail'); if (!rail) return;
  rail.addEventListener('click', e => {
    const a = e.target.closest('a[data-step]'); if (!a) return; e.preventDefault();
    const sec = document.getElementById(a.dataset.step); if (!sec || sec.hidden) return;
    sec.scrollIntoView({ behavior: MOTION.reduce ? 'auto' : 'smooth', block: 'start' });
    MOTION.pinStep = a.dataset.step; railCurrent(a.dataset.step);
    clearTimeout(MOTION.pinT); MOTION.pinT = setTimeout(() => { MOTION.pinStep = null; }, 900);
  });
  const seen = new Map();
  const io = new IntersectionObserver(list => {
    for (const en of list) seen.set(en.target.id, en.isIntersecting ? en.intersectionRect.height : 0);
    if (MOTION.pinStep) return;
    let best = null, h = 0; for (const [id, v] of seen) if (v > h) { h = v; best = id; }
    if (best && best !== MOTION.railCur) railCurrent(best);
  }, { rootMargin: '-80px 0px -35% 0px', threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
  ['s1', 's2', 's3', 'review', 'mix'].forEach(id => { const el = document.getElementById(id); if (el) io.observe(el); });
  railCurrent('s1', true);
}
function railCurrent(id, instant) {
  const rail = document.querySelector('.rail'); if (!rail) return;
  rail.querySelectorAll('a[data-step]').forEach(a => { const on = a.dataset.step === id; a.classList.toggle('cur', on); if (on) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current'); });
  MOTION.railCur = id; railIndicator(instant);
  const ol = rail.querySelector('ol'), a = rail.querySelector('a.cur');
  if (a && ol && getComputedStyle(ol).display === 'flex') ol.scrollTo({ left: a.parentElement.offsetLeft - 20, behavior: instant || MOTION.reduce ? 'auto' : 'smooth' });
}
function railIndicator(instant) {
  const rail = document.querySelector('.rail'), ind = rail && rail.querySelector('.rail-ind'), a = rail && rail.querySelector('a.cur'); if (!ind || !a) return;
  const y = a.parentElement.offsetTop, h = a.offsetHeight; ind.classList.add('on');
  if (instant || !MOTION.ready) { mvSet(RAIL.y, y); mvSet(RAIL.h, h); RAIL.render(); return; }
  mvTo(RAIL.y, y, { damping: 0.8, response: 0.42 }); mvTo(RAIL.h, h, { damping: 1, response: 0.42 });
}
/** Шаги: номер превращается в галочку (transitions.dev: success check), в листе — короткая сводка. */
function motionSteps() {
  const nFiles = S.files.length, ready = S.files.filter(f => f.y48).length, c = typeof counts === 'function' && S.P ? counts() : null;
  const nLines = S.P ? S.P.cues.filter(q => q.type === 'line').length : 0, res = S.result && S.result.out ? S.result : null;
  const state = {
    s1: [!!(S.P && S.P.cues && S.P.cues.length), S.P ? `${S.P.nScenes || 0} ${plural(S.P.nScenes || 0, 'сцена', 'сцены', 'сцен')} · ${nLines} ${plural(nLines, 'реплика', 'реплики', 'реплик')}` : 'вставьте текст'],
    s2: [S.files.some(f => f.y48), nFiles ? `${nFiles} ${plural(nFiles, 'файл', 'файла', 'файлов')}${ready < nFiles ? ' · читаю' : ''}` : 'файлов нет'],
    s3: [!!(S.matches && S.matches.size), S.busy ? 'идёт разбор…' : S.matches && S.matches.size ? 'разобрано' : 'не начат'],
    review: [!!S.result, c && (S.matches.size || S.uploads.size) ? `найдено ${c.ok + c.own}${c.check ? ' · проверить ' + c.check : ''}` : 'после разбора'],
    mix: [!!res, res ? `${fmt(res.out.length / C.SR)} · ${$('#lufs') ? $('#lufs').value.replace('-', '−') : ''} LUFS` : 'после разбора'],
  };
  for (const [id, [ok, meta]] of Object.entries(state)) {
    const was = MOTION.done.get(id); MOTION.done.set(id, ok);
    const just = ok && was === false && MOTION.ready;
    const b = document.querySelector(`#${id} .step b`); if (b) { b.classList.toggle('done', ok); if (just) replay(b, 'just'); }
    const a = document.querySelector(`.rail a[data-step="${id}"]`); if (!a) continue;
    a.classList.toggle('done', ok); if (just) replay(a, 'just');
    const sec = document.getElementById(id); a.setAttribute('aria-disabled', sec && sec.hidden ? 'true' : 'false');
    // сводка шага: поменялись только числа — они въезжают (nums.js); поменялась сама фраза — она сменяется целиком
    const m = a.querySelector('.m'); if (m && m.textContent !== meta) { m.dataset.num = 'step:' + id; m.setAttribute('data-num-shape', ''); const swap = MOTION.ready && m.textContent && !MOTION.reduce && !(typeof numShape === 'function' && numShape(m.textContent, meta)); m.textContent = meta; if (swap) mIn(m, { opacity: 0, transform: 'translateY(4px)', filter: 'blur(2px)' }, [1, 0.3]); }
  }
  const intro = document.getElementById('intro'), hideIntro = !!(S.P || S.files.length);
  if (intro && intro.hidden !== hideIntro) { if (hideIntro) motionGhostOut(intro, { transform: 'translateY(-8px)', filter: 'blur(2px)' }, 200); intro.hidden = hideIntro; }   // приветствие тает, шаги подъезжают (render)
}
/** Блок-сообщение (предупреждение, «Дозапись»): появился — раскрывается по высоте, пропал — сворачивается, а не
 *  исчезает рывком; тот же текст не перестраивается. */
function softHtml(el, html) {
  if (!el || (el._html === html && (el.innerHTML !== '' || html === ''))) return;
  const was = !!el.innerHTML.trim(), now = !!html.trim(), anim = MOTION.ready && mOK();
  if (was && !now && anim) {
    el._html = html; const h = el.offsetHeight; el.style.overflow = 'hidden';
    const a = el.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 200, easing: EASE, fill: 'forwards' });
    a.onfinish = () => { if (el._html === html) el.innerHTML = html; el.style.overflow = ''; a.cancel(); };
    return;
  }
  el.getAnimations().forEach(a => a.cancel()); el.style.overflow = '';
  el._html = html; el.innerHTML = html; if (!was && now && anim) foldIn(el);
}
/** Сменить надпись с проявлением (transitions.dev: text swap): «стало» ↔ «стало — считаю…» и подобные. */
function swapText(el, text) {
  if (!el || el.textContent === text) return;
  const had = !!el.textContent; el.textContent = text;
  if (had && MOTION.ready && !MOTION.reduce) mIn(el, { opacity: 0, transform: 'translateY(3px)', filter: 'blur(2px)' }, [1, 0.28]);
}
function replay(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); clearTimeout(el._rt); el._rt = setTimeout(() => el.classList.remove(cls), 700); }
const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };
/** Число в плашке: изменившиеся цифры въезжают снизу (transitions.dev: number pop-in). */
function motionCount(el, key) { const out = el.querySelector('b') || el; out.dataset.num = 'pill:' + key; if (typeof numCheck === 'function') numCheck(out); }
/** Раскрыть блок (список реплик, «другой кусок»): высота, отступы и прозрачность растут на пружине до видимой части
 *  экрана (дальше — сразу, этого не видно), первые строки въезжают лесенкой. Соседи ниже отъезжают плавно, а не прыжком. */
function foldBox(el) { const cs = getComputedStyle(el); return { paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: cs.marginTop }; }
const FOLD0 = { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px' };
function foldIn(el, list) {
  el.hidden = false; el._closing = false; el.getAnimations().forEach(a => a.cancel()); if (!mOK()) return;
  const h = Math.min(el.offsetHeight, innerHeight * 0.85), sp = springEase(0.92, 0.46);
  el.style.overflow = 'hidden';
  const a = el.animate([{ ...FOLD0, opacity: 0.2 }, { ...foldBox(el), height: h + 'px', opacity: 1 }], { duration: sp.duration, easing: sp.easing });
  a.onfinish = a.oncancel = () => { el.style.overflow = ''; };
  if (list) staggerList([...list.querySelectorAll(':scope > .row, :scope > .scene')].slice(0, 9), 32);
}
/** Свернуть: уходит быстрее, чем приходил; логика не ждёт — блок уже закрыт, он только доигрывает. */
function foldOut(el) {
  if (!mOK() || el.hidden) { el.hidden = true; el._closing = false; return; }
  const h = Math.min(el.offsetHeight, innerHeight * 0.85); el._closing = true; el.style.overflow = 'hidden';
  const a = el.animate([{ ...foldBox(el), height: h + 'px', opacity: 1 }, { ...FOLD0, opacity: 0 }], { duration: 260, easing: EASE, fill: 'forwards' });
  a.onfinish = () => { if (el._closing) { el.hidden = true; el._closing = false; } el.style.overflow = ''; a.cancel(); };
}
/** Скользящая подложка переключателя (transitions.dev: sliding tabs). В покое выбранная кнопка рисует себя сама —
 *  ни замеров, ни слоёв. Щёлкнули другую — на время переезда появляется подложка: от места, где была прежняя
 *  кнопка в момент нажатия, к новой, на пружинах; доехала — убирается. Группу перерисовали посреди переезда —
 *  подложка продолжает в новой. С клавиатуры — сразу, без переезда. */
const SEG = new Map();
const segSel = on => on.dataset.f || on.dataset.preset || on.dataset.name || on.dataset.v || on.textContent;
function segRect(box, el) { const b = box.getBoundingClientRect(), o = el.getBoundingClientRect(); return { x: o.left - b.left - box.clientLeft, y: o.top - b.top - box.clientTop, w: o.width, h: o.height }; }
function segInit() {
  document.addEventListener('pointerdown', e => {
    const box = e.button > 0 ? null : e.target.closest && e.target.closest('[data-seg]'); if (!box) return;
    const on = box.querySelector(':scope > button.on'), s = SEG.get(box.dataset.seg); if (!on || !s) return;
    const run = s.run && s.run.live() ? s.run : null;
    s.from = { ...(run ? { x: run.x.v, y: run.y.v, w: run.w.v, h: run.h.v } : segRect(box, on)), r: getComputedStyle(on).borderTopLeftRadius, sel: run ? s.runSel : segSel(on), t: performance.now() };
  }, true);
}
function segAttach(box, run) {
  let ind = box.querySelector(':scope > .seg-ind');
  if (!ind) { ind = document.createElement('span'); ind.className = 'seg-ind'; ind.setAttribute('aria-hidden', 'true'); box.prepend(ind); }
  ind.style.borderRadius = run.r; box.classList.add('seg'); run.el = ind; run.box = box; run.owner.render();
}
function segInd(box, key) {
  if (!box) return; box.dataset.seg = key;
  let s = SEG.get(key); if (!s) SEG.set(key, s = {});
  s.box = box;                                                              // замер в кадре — по последней перерисовке
  const on = box.querySelector(':scope > button.on'), sel = on ? segSel(on) : null, live = s.run && s.run.live();
  if ((live || s.pending) && sel === s.runSel) { if (live) segAttach(box, s.run); return; }   // перерисовали посреди переезда
  const from = s.from; s.from = null;
  if (!on || !from || sel === from.sel || performance.now() - from.t > 1500 || !mOK() || !MOTION.ready) { if (live) segStop(s); s.pending = false; return; }
  s.runSel = sel; s.pending = true;
  requestAnimationFrame(() => {
    s.pending = false; const box = s.box, on = box.querySelector(':scope > button.on');
    if (!box.isConnected || !on || segSel(on) !== s.runSel || !on.getClientRects().length) return;
    const to = segRect(box, on);
    if (!s.run || !s.run.live()) {
      const run = { r: from.r }, owner = { render() {
        const el = run.el; if (!el || !el.isConnected) return;
        if (!run.live()) { el.remove(); segOff(run.box); if (s.run === run) s.run = null; return; }
        el.style.transform = `translate(${run.x.v.toFixed(2)}px, ${run.y.v.toFixed(2)}px)`; el.style.width = run.w.v.toFixed(2) + 'px'; el.style.height = run.h.v.toFixed(2) + 'px';
      } };
      run.owner = owner; run.x = mv(from.x, 0.05, owner); run.y = mv(from.y, 0.05, owner); run.w = mv(from.w, 0.05, owner); run.h = mv(from.h, 0.05, owner);
      run.live = () => SPRING.live.has(run.x) || SPRING.live.has(run.y) || SPRING.live.has(run.w) || SPRING.live.has(run.h);
      s.run = run;
    }
    const run = s.run; run.r = getComputedStyle(on).borderTopLeftRadius;
    mvTo(run.x, to.x, { damping: 0.78, response: 0.36 }); mvTo(run.y, to.y, { damping: 0.86, response: 0.36 }); mvTo(run.w, to.w, { damping: 0.9, response: 0.36 }); mvTo(run.h, to.h, { damping: 0.9, response: 0.36 });
    segAttach(box, run);
  });
}
function segStop(s) { const run = s.run; s.run = null; if (!run) return; for (const k of ['x', 'y', 'w', 'h']) mvSet(run[k], run[k].v); if (run.el) run.el.remove(); if (run.box) segOff(run.box); }
/** Подложка доехала — кнопка снова рисует себя сама, в тот же кадр и без перехода цвета (иначе фон мигнёт). */
function segOff(box) { box.classList.remove('seg'); box.classList.add('seg-off'); requestAnimationFrame(() => requestAnimationFrame(() => box.classList.remove('seg-off'))); }
/** Раскрывашка (transitions.dev: accordion): высота через grid-rows 0fr → 1fr на пружине, шеврон переворачивается. */
function initAccordions() {
  document.addEventListener('click', e => {
    const h = e.target.closest('.acc-head'); if (!h) return;
    const acc = h.closest('.acc'), open = acc.dataset.open !== 'true';
    acc.dataset.open = String(open); h.setAttribute('aria-expanded', String(open));
  });
}
/** Плавный масштаб и прокрутка таймлайна — для кнопок, мини-карты и перелистывания за плеером; клавиши — мгновенно. */
function motionView(st, zoom, scroll, draw, ms = 250) {
  cancelAnimationFrame(MOTION.view);
  if (!mOK()) { st.zoom = zoom; st.scroll = scroll; draw(); return; }
  const z0 = st.zoom, s0 = st.scroll, t0 = performance.now(), ease = x => 1 - Math.pow(1 - x, 4);
  const step = now => { const k = Math.min(1, (now - t0) / ms), e = ease(k); st.zoom = z0 + (zoom - z0) * e; st.scroll = s0 + (scroll - s0) * e; draw(); if (k < 1) MOTION.view = requestAnimationFrame(step); else MOTION.view = 0; };
  MOTION.view = requestAnimationFrame(step);
}
/** Новое сведение: лента «заправляется» — таймлайн открывается слева направо за янтарной кромкой. */
function splice(tl) {
  const box = tl.querySelector('.tl-canvas'); if (!box || MOTION.reduce || !MOTION.ready) return;
  box.style.setProperty('--splice-w', box.clientWidth + 'px');
  box.classList.remove('splice'); void box.offsetWidth; box.classList.add('splice');
  setTimeout(() => box.classList.remove('splice'), 800);
}
/** Ошибка: короткая дрожь (transitions.dev: error shake). */
function motionShake(el) {
  if (!mOK() || !el) return;
  el.animate([{ transform: 'none' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(2px)' }, { transform: 'none' }], { duration: 360, easing: EASE });
}
// ------------------------------------------------------------------ оформление: тема, палитра, контраст, движение
// Кнопка в деке открывает панель «Оформление». Всё применяется сразу и запоминается; до первой отрисовки его
// ставит маленький скрипт в <head>, дальше — themeApply. Смена темы или палитры расходится кругом от нажатой кнопки.
const THEME_KEY = 'montage:theme', THEME_NAMES = { auto: 'авто', light: 'светлая', dark: 'тёмная' };
/** Палитры: имя и цвета для превью (сами токены — в page.html, из одного описания). */
const PALETTES = {"amber": {"name": "Монтажная", "hint": "алюминий, янтарь", "light": {"bg": "#E4E6E1", "surface": "#F8F8F6", "deck": "#1A1613", "accent": "#EBA51C"}, "dark": {"bg": "#14110F", "surface": "#1D1916", "deck": "#0E0C0B", "accent": "#F2B233"}}, "studio": {"name": "Студия", "hint": "холодный графит, синий", "light": {"bg": "#E3E6EB", "surface": "#F7F8FA", "deck": "#11151B", "accent": "#2F6FEB"}, "dark": {"bg": "#0F1217", "surface": "#171B21", "deck": "#0A0D11", "accent": "#5B92F5"}}, "onair": {"name": "Эфир", "hint": "тёплый крем, красный", "light": {"bg": "#E9E4DE", "surface": "#FBF8F4", "deck": "#1C1211", "accent": "#CC3B26"}, "dark": {"bg": "#150F0E", "surface": "#1E1715", "deck": "#0F0A09", "accent": "#F0674F"}}, "garden": {"name": "Сад", "hint": "шалфей, зелёный", "light": {"bg": "#E2E7E1", "surface": "#F7F9F6", "deck": "#121712", "accent": "#2A7F4F"}, "dark": {"bg": "#0F130F", "surface": "#171C17", "deck": "#0A0D0A", "accent": "#4CC282"}}, "lilac": {"name": "Сирень", "hint": "лаванда, фиолетовый", "light": {"bg": "#E6E3EB", "surface": "#F9F8FB", "deck": "#16121C", "accent": "#7B4FD6"}, "dark": {"bg": "#121016", "surface": "#1A171F", "deck": "#0C0A0F", "accent": "#A585F0"}}};
const TH = {
  get: k => { try { return localStorage.getItem('montage:' + k); } catch { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem('montage:' + k); else localStorage.setItem('montage:' + k, v); } catch {} },
  mq: q => !!(window.matchMedia && matchMedia(q).matches),
};
function themeMode() { return TH.get('theme') || 'auto'; }
function themeState() {
  const p = TH.get('palette');
  return { mode: themeMode(), palette: PALETTES[p] ? p : 'amber', contrast: TH.get('contrast') || (TH.mq('(prefers-contrast: more)') ? 'more' : 'normal'), motion: TH.get('motion') === 'reduce' ? 'reduce' : 'system' };
}
function themeApply() {
  const d = document.documentElement, st = themeState();
  if (st.mode === 'auto') d.removeAttribute('data-theme'); else d.dataset.theme = st.mode;
  if (st.palette === 'amber') d.removeAttribute('data-palette'); else d.dataset.palette = st.palette;
  if (st.contrast === 'more') d.dataset.contrast = 'more'; else d.removeAttribute('data-contrast');
  if (st.motion === 'reduce') d.dataset.motion = 'reduce'; else d.removeAttribute('data-motion');
  const dark = st.mode === 'dark' || (st.mode !== 'light' && TH.mq('(prefers-color-scheme: dark)'));
  d.dataset.scheme = dark ? 'dark' : 'light';
  MOTION.reduce = TH.mq('(prefers-reduced-motion: reduce)') || st.motion === 'reduce';
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = PALETTES[st.palette][dark ? 'dark' : 'light'].deck;
  const b = document.getElementById('theme-b');
  if (b) {
    b.dataset.mode = st.mode; const l = b.querySelector('.theme-l'); if (l) l.textContent = THEME_NAMES[st.mode];
    b.setAttribute('aria-label', `Оформление: тема ${THEME_NAMES[st.mode]}, палитра «${PALETTES[st.palette].name}» — настроить`);
  }
  return st;
}
/** Сменить настройку. Тема, палитра и контраст расходятся кругом от нажатой кнопки; с клавиатуры и при «меньше
 *  движения» — сразу. Холсты (таймлайн, спектры, эквалайзер) перерисовываются в новых цветах. */
function themeSet(k, v, origin = null, ev = null) { TH.set(k === 'mode' ? 'theme' : k, v); themeSwap(origin, ev, k === 'motion'); }
function themeSwap(origin, ev, instant = false) {
  const swap = () => { themeApply(); if (typeof render === 'function') render(); if (typeof drawTimeline === 'function') drawTimeline(); themePanelSync(); };
  const kbd = ev && (ev.detail === 0 || ev.type === 'keydown');
  if (instant || kbd || !origin || !document.startViewTransition || MOTION.reduce) { swap(); return; }
  const r = origin.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const sp = springEase(1, 0.6), vt = document.startViewTransition(swap);
  vt.ready.then(() => document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`] }, { duration: sp.duration, easing: sp.easing, pseudoElement: '::view-transition-new(root)' })).catch(() => {});
}
// ---- панель «Оформление»
const TPOP = { el: null, open: false };
const TP_ICON = {
  auto: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"/><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1"/></g></svg>',
  dark: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 10.1A5.6 5.6 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3z" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 8.4l3 3 6.2-6.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
function themePanelHtml() {
  const st = themeState(), dark = document.documentElement.dataset.scheme === 'dark';
  const seg = (k, label, opts) => `<div class="tp-sec"><div class="tp-h" id="tp-h-${k}">${label}</div><div class="tp-seg" role="radiogroup" aria-labelledby="tp-h-${k}" data-k="${k}">${opts.map(([v, t, icon]) => `<button type="button" role="radio" data-v="${v}" aria-checked="${st[k] === v}" tabindex="${st[k] === v ? 0 : -1}" class="${st[k] === v ? 'on' : ''}">${icon || ''}${t}</button>`).join('')}</div></div>`;
  const sw = Object.entries(PALETTES).map(([k, p]) => { const c = p[dark ? 'dark' : 'light'], on = st.palette === k;
    return `<button type="button" class="tp-sw" role="radio" data-v="${k}" aria-checked="${on}" tabindex="${on ? 0 : -1}" title="${p.hint}" style="--pv-bg:${c.bg};--pv-surface:${c.surface};--pv-deck:${c.deck};--pv-accent:${c.accent};--pv-ink:${dark ? '#EEE' : '#111'}"><span class="tp-mini" aria-hidden="true"><b></b><em></em><i></i></span><span class="tp-n">${p.name}${TP_ICON.check}</span></button>`; }).join('');
  return `<h2>Оформление <small>сохраняется в этом браузере</small></h2>
    ${seg('mode', 'Тема', [['auto', 'Авто', TP_ICON.auto], ['light', 'Светлая', TP_ICON.light], ['dark', 'Тёмная', TP_ICON.dark]])}
    <div class="tp-sec"><div class="tp-h" id="tp-h-palette">Палитра</div><div class="tp-pal" role="radiogroup" aria-labelledby="tp-h-palette" data-k="palette">${sw}</div></div>
    ${seg('contrast', 'Контраст', [['normal', 'Обычный'], ['more', 'Высокий']])}
    ${seg('motion', 'Движение', [['system', 'Как в системе'], ['reduce', 'Меньше']])}
    <div class="tp-foot"><span class="muted">Авто — как в системе: день и ночь сами.</span><button type="button" class="ghost-b tiny" data-tp="reset">Сбросить</button></div>`;
}
/** Перерисовать содержимое открытой панели после смены (превью палитр зависят от светлой/тёмной). Фокус — на том же. */
function themePanelSync() {
  const el = TPOP.el; if (!el || el.hidden) return;
  const ae = document.activeElement, key = ae && el.contains(ae) ? (ae.closest('[data-k]') ? ae.closest('[data-k]').dataset.k + '|' + (ae.dataset.v || '') : ae.dataset.tp || '') : null;
  el.innerHTML = themePanelHtml();
  el.querySelectorAll('.tp-seg').forEach(g => { if (typeof segInd === 'function') segInd(g, 'tp-' + g.dataset.k); });
  if (key) { const [k, v] = key.split('|'); const n = v != null && k ? el.querySelector(`[data-k="${k}"] [data-v="${CSS.escape(v)}"]`) : el.querySelector(`[data-tp="${k}"]`); if (n) n.focus({ preventScroll: true }); }
}
function themePanelPlace() {
  const el = TPOP.el, b = document.getElementById('theme-b'); if (!el || !b) return;
  const r = b.getBoundingClientRect(), w = el.offsetWidth, right = Math.max(8, innerWidth - r.right), left = innerWidth - right - w;
  el.style.top = Math.round(r.bottom + 8) + 'px'; el.style.right = right + 'px';
  el.style.setProperty('--tp-origin', `${Math.round(Math.min(w, Math.max(0, r.left + r.width / 2 - left)))}px -8px`);
}
function themePanelOpen(fromKey) {
  let el = TPOP.el;
  if (!el) {
    el = TPOP.el = document.createElement('div'); el.className = 'theme-pop'; el.id = 'theme-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Оформление'); el.hidden = true;
    document.body.appendChild(el); themePanelBind(el);
  }
  el.getAnimations().forEach(a => a.cancel());
  el.innerHTML = themePanelHtml(); el.hidden = false; TPOP.open = true;
  const b = document.getElementById('theme-b'); if (b) b.setAttribute('aria-expanded', 'true');
  themePanelPlace();
  el.querySelectorAll('.tp-seg').forEach(g => { if (typeof segInd === 'function') segInd(g, 'tp-' + g.dataset.k); });
  if (!fromKey && mOK() && MOTION.ready) mIn(el, { opacity: 0, transform: 'translateY(-6px) scale(0.96)' }, [0.86, 0.3]);
  const first = el.querySelector('[data-k="mode"] [aria-checked="true"]'); if (first) first.focus({ preventScroll: true });
}
function themePanelClose(fromKey, refocus = false) {
  const el = TPOP.el; if (!el || el.hidden) return; TPOP.open = false;
  const b = document.getElementById('theme-b'); if (b) b.setAttribute('aria-expanded', 'false');
  if (refocus && b) b.focus({ preventScroll: true });
  if (fromKey || !mOK()) { el.hidden = true; return; }
  const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-4px) scale(0.98)' }], { duration: 150, easing: EASE, fill: 'forwards' });   // уход быстрее входа
  a.onfinish = () => { if (!TPOP.open) el.hidden = true; a.cancel(); };
}
function themePanelBind(el) {
  el.addEventListener('click', e => {
    const r = e.target.closest('[role="radio"]');
    if (r) { const k = r.closest('[data-k]').dataset.k, v = r.dataset.v; if (themeState()[k] !== v) themeSet(k, v, r, e); return; }
    if (e.target.closest('[data-tp="reset"]')) { for (const k of ['theme', 'palette', 'contrast', 'motion']) TH.set(k, null); themeSwap(e.target.closest('button'), e); }
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); themePanelClose(true, true); return; }
    const r = e.target.closest('[role="radio"]'); if (!r || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const g = r.closest('[data-k]'), all = [...g.querySelectorAll('[role="radio"]')], i = all.indexOf(r);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + all.length) % all.length;
    const n = all[j]; themeSet(g.dataset.k, n.dataset.v, n, e);                      // стрелки — выбор сразу (как у радиокнопок)
    const again = TPOP.el.querySelector(`[data-k="${g.dataset.k}"] [data-v="${CSS.escape(n.dataset.v)}"]`); if (again) again.focus({ preventScroll: true });
  });
}
function initTheme() {
  const b = document.getElementById('theme-b'); themeApply(); if (!b) return;
  b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'theme-pop');
  if (!b.querySelector('.theme-dot')) { const dot = document.createElement('span'); dot.className = 'theme-dot'; dot.setAttribute('aria-hidden', 'true'); b.appendChild(dot); }
  // подпись «авто» / «светлая» / «тёмная» разной ширины: без запаса по самой длинной стрелка уровня рядом дёргается
  const fit = () => { const l = b.querySelector('.theme-l'); if (!l || !l.offsetParent) return; const cur = l.textContent; l.style.minWidth = ''; let w = 0; for (const t of Object.values(THEME_NAMES)) { l.textContent = t; w = Math.max(w, l.getBoundingClientRect().width); } l.textContent = cur; l.style.minWidth = Math.ceil(w) + 'px'; };
  fit(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  b.addEventListener('click', e => { if (TPOP.open) themePanelClose(e.detail === 0); else themePanelOpen(e.detail === 0); });
  document.addEventListener('pointerdown', e => { if (TPOP.open && !e.target.closest('#theme-pop, #theme-b')) themePanelClose(false); }, true);
  addEventListener('resize', () => { if (TPOP.open) themePanelPlace(); });
  // система сменила день/ночь, контраст или движение — при «авто» подстраиваемся сразу, холсты перерисовываются
  for (const q of ['(prefers-color-scheme: dark)', '(prefers-contrast: more)', '(prefers-reduced-motion: reduce)']) {
    if (!window.matchMedia) break;
    matchMedia(q).addEventListener('change', () => { themeApply(); if (typeof render === 'function') render(); if (typeof drawTimeline === 'function') drawTimeline(); themePanelSync(); });
  }
}
