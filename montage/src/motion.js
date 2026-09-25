// Монтажка — движение интерфейса. Без библиотек: CSS-переходы и Web Animations — они идут на композиторе
// и не дёргаются, когда основной поток занят распознаванием или сведением.
// Правила (emilkowalski/skills, transitions.dev, impeccable):
// - шкала токенов transitions.dev: 150 мс — закрыть, 250 мс — открыть/переключить, 350–400 мс — панели,
//   500 мс — отметка «готово»; кривая открытия cubic-bezier(0.22, 1, 0.36, 1);
// - уход быстрее входа; всё, что вызвано с клавиатуры, — мгновенно; частое — тише редкого;
// - меню растёт из точки щелчка, тост и прогресс поднимаются снизу с лёгким размытием, вкладки съезжают на 8 px;
// - при закрытии логика не ждёт анимацию: уходит «призрак» — копия, а настоящий элемент скрыт сразу;
// - prefers-reduced-motion: только прозрачность, без сдвигов, масштаба и размытия.
// Использует S, render, counts, fmt, $, C из app.js и drawTimeline из timeline.js.
const MOTION = { reduce: false, kbd: 0, ready: false, lastKeys: new Map(), counts: new Map(), done: new Map(), view: 0, pinStep: null, railCur: null };
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const mOK = () => !MOTION.reduce && typeof Element.prototype.animate === 'function';
/** Вход: из «до» в покой. В режиме без движения — только прозрачность. */
function mIn(el, from, ms = 250, extra = {}) {
  if (!el || typeof el.animate !== 'function') return null;
  if (MOTION.reduce) from = { opacity: 0 };
  const to = {}; for (const k of Object.keys(from)) to[k] = k === 'opacity' ? 1 : k === 'filter' ? 'blur(0px)' : extra.rest && extra.rest[k] != null ? extra.rest[k] : 'none';
  if (MOTION.reduce && extra.rest) Object.assign(from, extra.rest), Object.assign(to, extra.rest), from.opacity = 0;
  return el.animate([from, to], { duration: MOTION.reduce ? 150 : ms, easing: EASE, fill: 'backwards', delay: extra.delay || 0 });
}
function motionInit() {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)'); MOTION.reduce = mq.matches;
  mq.addEventListener('change', () => { MOTION.reduce = mq.matches; });
  // высота деки — для липких заголовков
  const deck = document.querySelector('.deck');
  if (deck && window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--deck-h', (deck.getBoundingClientRect().height - (parseFloat(getComputedStyle(deck).paddingTop) || 0)) + 'px')).observe(deck);
  tabIndicator(true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { tabIndicator(true); railIndicator(true); });
  const tabs = document.querySelector('.tabs'); if (tabs && window.ResizeObserver) new ResizeObserver(() => tabIndicator(true)).observe(tabs);
  initRail(); initAccordions();
  // появление скрытых блоков: секции, вкладки, прогресс, сообщение, меню, выбор кусков
  new MutationObserver(list => { for (const m of list) if (m.attributeName === 'hidden' && !m.target.hidden && m.oldValue != null) appear(m.target); })
    .observe(document.body, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true, subtree: true });
  // новые списки: файлы, строки проверки, модули чистки, звуки, результат сведения
  const watch = (sel, fn) => { const el = document.querySelector(sel); if (el) new MutationObserver(() => fn(el)).observe(el, { childList: true }); };
  watch('#files', el => staggerList([...el.querySelectorAll('.file')].filter(x => !MOTION.lastKeys.has('f:' + x.dataset.i + ':' + (x.querySelector('.fname') || {}).textContent)).map(x => (MOTION.lastKeys.set('f:' + x.dataset.i + ':' + (x.querySelector('.fname') || {}).textContent, 1), x))));
  watch('#rv-list', el => { const key = el.dataset.v || ''; const prev = MOTION.lastKeys.get('rv'); if (prev === key) return; MOTION.lastKeys.set('rv', key);
    // первый показ и новый разбор — лесенкой; смена фильтра (часто) — только быстрая проявка
    if (prev == null || prev.split('|')[2] !== key.split('|')[2]) staggerList([...el.children].slice(0, 10)); else fadeList(el); });
  watch('#cl-body', el => { const key = (S.cleanFile && S.cleanFile.name) || ''; if (MOTION.lastKeys.get('cl') === key || !el.querySelector('.mods')) return; MOTION.lastKeys.set('cl', key); staggerList([el.querySelector('.cl-head'), ...el.querySelectorAll('.mod')].filter(Boolean).slice(0, 10)); });
  watch('#sfx-body', el => { if (MOTION.lastKeys.get('sfx') || !el.querySelector('.srow, .arow')) return; MOTION.lastKeys.set('sfx', 1); staggerList([...el.querySelectorAll('.ambbox, .dbbox, .srow')].slice(0, 10)); });
  watch('#mix-out', el => { const tl = el.querySelector('.tl'); if (!tl || tl.dataset.m) return; tl.dataset.m = '1'; splice(tl); staggerList([el.querySelector('#mix-top'), el.querySelector('#mix-rest')].filter(Boolean), 60); });
  requestAnimationFrame(() => requestAnimationFrame(() => { MOTION.ready = true; }));
}
function appear(el) {
  if (el.id === 'prog' || el.id === 'msg') { cancelGhost(el); mIn(el, { opacity: 0, transform: 'translate(-50%, 16px) scale(0.97)', filter: 'blur(2px)' }, 350, { rest: { transform: 'translate(-50%, 0px) scale(1)' } }); return; }
  if (el.id === 'tl-menu') { if (performance.now() - MOTION.kbd < 150) return; mIn(el, { opacity: 0, transform: 'scale(0.97)' }, 250); return; }
  if (el.classList.contains('picker')) { mIn(el, { opacity: 0, transform: 'translateY(-4px)', filter: 'blur(2px)' }, 250); return; }
  if (el.matches('section.card')) { if (MOTION.ready) mIn(el, { opacity: 0, transform: 'translateY(12px)', filter: 'blur(3px)' }, 400); return; }
  if (el.matches('[data-tabpane]')) { paneIn(el); return; }
}
/** Уход без ожидания: копия уходит, настоящий элемент уже скрыт. Вызывать до того, как элемент спрятан. */
function motionGhostOut(el, to, ms = 150) {
  if (!mOK() || !el || el.hidden || !el.isConnected) return;
  const r = el.getBoundingClientRect(); if (!r.width) return;
  const g = el.cloneNode(true); g.removeAttribute('id'); g.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
  g.inert = true; g.setAttribute('aria-hidden', 'true'); g.removeAttribute('role'); g.dataset.ghost = el.id || '1';
  Object.assign(g.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', pointerEvents: 'none', transform: 'none', bottom: 'auto', right: 'auto', zIndex: 90, maxHeight: 'none' });
  (el.parentNode || document.body).appendChild(g);
  const a = g.animate([{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, ...to }], { duration: ms, easing: EASE, fill: 'forwards' });
  a.onfinish = a.oncancel = () => g.remove();
}
function cancelGhost(el) { document.querySelectorAll(`[data-ghost="${el.id}"]`).forEach(g => g.remove()); }
/** Сообщение: уходит вниз за 250 мс, потом скрывается. */
function motionHide(el, done) {
  if (!mOK() || el.hidden) { el.hidden = true; done && done(); return; }
  const a = el.animate([{ opacity: 1, transform: 'translate(-50%, 0px) scale(1)', filter: 'blur(0px)' }, { opacity: 0, transform: 'translate(-50%, 16px) scale(0.97)', filter: 'blur(2px)' }], { duration: 250, easing: EASE, fill: 'forwards' });
  a.onfinish = () => { el.hidden = true; a.cancel(); done && done(); };
}
/** Список: лесенка по 40 мс, не больше 10 строк, всего ≤ 400 мс. Во время лесенки всё уже кликабельно. */
function staggerList(els, each = 40) {
  if (!els.length || typeof els[0].animate !== 'function' || !MOTION.ready) return;
  els.forEach((el, i) => mIn(el, { opacity: 0, transform: 'translateY(8px)' }, 300, { delay: Math.min(i, 9) * each }));
}
function fadeList(el) { if (typeof el.animate === 'function') el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' }); }
/** Вкладка: новая приходит на 8 px со стороны, куда нажали, с размытием 3 px (transitions.dev: page side-by-side). */
let paneDir = 1;
function paneIn(pane) { if (MOTION.ready) mIn(pane, { opacity: 0, transform: `translateX(${8 * paneDir}px)`, filter: 'blur(3px)' }, 250); }
function motionTab(prev, next) {
  const order = ['build', 'clean', 'sfx'], a = order.indexOf(prev), b = order.indexOf(next); paneDir = b >= a ? 1 : -1;
  tabIndicator(false);
}
/** Подложка вкладок: JS пишет положение, CSS ведёт переход; первый раз и при смене размеров — без перехода. */
function tabIndicator(instant) {
  const tabs = document.querySelector('.tabs'); if (!tabs) return;
  const ind = tabs.querySelector('.tab-ind'), on = tabs.querySelector('button.on'); if (!ind || !on) return;
  const set = () => { ind.style.transform = `translateX(${on.offsetLeft}px)`; ind.style.width = on.offsetWidth + 'px'; };
  if (instant) { ind.style.transition = 'none'; set(); void ind.offsetWidth; ind.style.transition = ''; } else set();
}
// ------------------------------------------------------------------ монтажный лист: шаги слева
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
  const li = a.parentElement, set = () => { ind.style.transform = `translateY(${li.offsetTop}px)`; ind.style.height = a.offsetHeight + 'px'; ind.classList.add('on'); };
  if (instant) { ind.style.transition = 'none'; set(); void ind.offsetWidth; ind.style.transition = ''; } else set();
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
    const m = a.querySelector('.m'); if (m && m.textContent !== meta) m.textContent = meta;
  }
  const intro = document.getElementById('intro'); if (intro) intro.hidden = !!(S.P || S.files.length);
}
function replay(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); clearTimeout(el._rt); el._rt = setTimeout(() => el.classList.remove(cls), 700); }
const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };
/** Число в плашке: изменившиеся цифры въезжают снизу (transitions.dev: number pop-in). */
function motionCount(el, key) {
  const to = +el.dataset.n; if (!isFinite(to)) return;
  const had = MOTION.counts.has(key), from = MOTION.counts.get(key); MOTION.counts.set(key, to);
  const out = el.querySelector('b') || el;
  out.classList.add('digits'); out.innerHTML = [...String(to)].map(ch => `<span class="digit">${ch}</span>`).join('');
  if (had && from !== to && !MOTION.reduce) replay(out, 'pop');
}
/** Раскрывашка (transitions.dev: accordion): высота через grid-rows 0fr → 1fr, шеврон переворачивается. */
function initAccordions() {
  document.addEventListener('click', e => {
    const h = e.target.closest('.acc-head'); if (!h) return;
    const acc = h.closest('.acc'), open = acc.dataset.open !== 'true';
    acc.dataset.open = String(open); h.setAttribute('aria-expanded', String(open));
  });
}
/** Плавный масштаб и прокрутка таймлайна — только для кнопок и мини-карты; клавиши и колёсико — мгновенно. */
function motionView(st, zoom, scroll, draw) {
  cancelAnimationFrame(MOTION.view);
  if (!mOK()) { st.zoom = zoom; st.scroll = scroll; draw(); return; }
  const z0 = st.zoom, s0 = st.scroll, t0 = performance.now(), T = 250, ease = x => 1 - Math.pow(1 - x, 4);
  const step = now => { const k = Math.min(1, (now - t0) / T), e = ease(k); st.zoom = z0 + (zoom - z0) * e; st.scroll = s0 + (scroll - s0) * e; draw(); if (k < 1) MOTION.view = requestAnimationFrame(step); };
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
// ------------------------------------------------------------------ тема: авто → светлая → тёмная, новая расходится кругом из кнопки
const THEME_KEY = 'montage:theme', THEME_NAMES = { auto: 'авто', light: 'светлая', dark: 'тёмная' };
function themeMode() { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; } }
function themeApply(mode) {
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = mode;
  const b = document.getElementById('theme-b'); if (b) { b.dataset.mode = mode; b.querySelector('.theme-l').textContent = THEME_NAMES[mode]; b.setAttribute('aria-label', `Тема: ${THEME_NAMES[mode]} — сменить`); }
}
function initTheme() {
  const b = document.getElementById('theme-b'); themeApply(themeMode()); if (!b) return;
  b.addEventListener('click', e => {
    const order = ['auto', 'light', 'dark'], next = order[(order.indexOf(themeMode()) + 1) % 3];
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    const swap = () => { themeApply(next); render(); if (typeof drawTimeline === 'function') drawTimeline(); };
    if (!document.startViewTransition || MOTION.reduce || e.detail === 0) { swap(); return; }   // с клавиатуры — сразу
    const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const vt = document.startViewTransition(swap);
    vt.ready.then(() => document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`] }, { duration: 500, easing: EASE, pseudoElement: '::view-transition-new(root)' })).catch(() => {});
  });
}
