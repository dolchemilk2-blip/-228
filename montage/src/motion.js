// Монтажка — движение интерфейса (GSAP). Правила — из greensock/gsap-skills и lottiefiles/motion-design-skill:
// одна подпись-кривая (power3.out ≈ cubic-bezier(0.2, 0, 0, 1)), три длительности 0,12 / 0,28 / 0,48 с,
// вход — подъём 16px + проявление лесенкой ≤ 0,4 с, выход — на 30 % короче, только transform и opacity,
// в длинных списках — только первые видимые строки. prefers-reduced-motion — без движения, мгновенно.
// Использует S из app.js. Без GSAP (не загрузился) всё работает, просто без анимации.
const MOTION = { g: null, reduce: false, lastKeys: new Map(), counts: new Map() };
const MOT = { q: 0.12, s: 0.28, l: 0.48, ease: 'power3.out', emph: 'expo.out', exit: 'power2.in', stag: 0.045 };
const mOK = () => MOTION.g && !MOTION.reduce;
function motionInit() {
  MOTION.g = window.gsap || null;
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)'); MOTION.reduce = mq.matches;
  mq.addEventListener('change', () => { MOTION.reduce = mq.matches; });
  if (!MOTION.g) return;
  const gsap = MOTION.g; gsap.defaults({ ease: MOT.ease, duration: MOT.s });
  splitMark();
  tabIndicator(true);
  // подложка меряется по ширине кнопки — после загрузки шрифта ширина другая
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => tabIndicator(true));
  const tabs = document.querySelector('.tabs'); if (tabs && window.ResizeObserver) new ResizeObserver(() => tabIndicator(true)).observe(tabs);
  if (mOK()) intro();
  // появление скрытых блоков: секции, прогресс, сообщения, меню, выбор кусков
  new MutationObserver(list => { for (const m of list) if (m.attributeName === 'hidden' && !m.target.hidden) appear(m.target); })
    .observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  // новые файлы, строки реплик, модули чистки, звуки, результат сведения
  const watch = (sel, fn) => { const el = document.querySelector(sel); if (el) new MutationObserver(() => fn(el)).observe(el, { childList: true }); };
  watch('#files', el => staggerNew(el.querySelectorAll('.file:not([data-m])'), 'y'));
  watch('#rv-list', el => { const key = el.dataset.v || ''; if (MOTION.lastKeys.get('rv') === key) return; MOTION.lastKeys.set('rv', key); staggerList([...el.children].slice(0, 16)); });
  watch('#cl-body', el => { const key = (S.cleanFile && S.cleanFile.name) || ''; if (MOTION.lastKeys.get('cl') === key || !el.querySelector('.mods')) return; MOTION.lastKeys.set('cl', key); staggerList([el.querySelector('.cl-head'), ...el.querySelectorAll('.mod')].filter(Boolean).slice(0, 14), 0.035); });
  watch('#sfx-body', el => { if (MOTION.lastKeys.get('sfx') || !el.querySelector('.srow, .arow')) return; MOTION.lastKeys.set('sfx', 1); staggerList([...el.querySelectorAll('.ambbox, .dbbox, .arow, .srow')].slice(0, 16), 0.035); });
  watch('#mix-out', el => { if (MOTION.lastKeys.get('mix') === (S.result && S.result.at) || !el.querySelector('#mix-top')) return; MOTION.lastKeys.set('mix', S.result && S.result.at); staggerList([el.querySelector('#mix-top'), el.querySelector('#mix-tl'), ...el.querySelectorAll('#mix-rest > *')].filter(Boolean), 0.06); });
  // таймлайн на весь экран
  new MutationObserver(list => { for (const m of list) if (m.target.classList && m.target.classList.contains('tl') && m.target.classList.contains('full') && !(m.oldValue || '').includes('full')) fullIn(m.target); })
    .observe(document.body, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
}
/** Логотип по буквам — для входа. Читалки видят целое слово. */
function splitMark() {
  const m = document.querySelector('.mark'); if (!m || m.dataset.split) return;
  m.setAttribute('aria-label', m.textContent.trim()); m.dataset.split = '1';
  const wrap = (txt, cls) => [...txt].map(ch => `<span class="ch${cls ? ' ' + cls : ''}" aria-hidden="true">${ch}</span>`).join('');
  m.innerHTML = [...m.childNodes].map(n => n.nodeType === 3 ? wrap(n.textContent) : `<span class="acc">${wrap(n.textContent)}</span>`).join('');
}
function intro() {
  const gsap = MOTION.g, tl = gsap.timeline({ defaults: { ease: MOT.ease } });
  const cards = [...document.querySelectorAll('.pane:not([hidden]) > section.card:not([hidden]), .pane:not([hidden]) > .grid2 > section.card')];
  tl.from('.mark .ch', { yPercent: 115, opacity: 0, rotate: 6, stagger: 0.032, duration: 0.62, ease: MOT.emph })
    .from('.hero .eyebrow, .hero .lede, .hero .privacy, .hero .hero-tools', { y: 12, opacity: 0, stagger: 0.06, duration: 0.42 }, '-=0.42')
    .from('.tabs', { y: 10, opacity: 0, duration: 0.34 }, '-=0.5')
    .from(cards, { y: 18, opacity: 0, stagger: 0.06, duration: 0.46, clearProps: 'transform,opacity,visibility' }, '-=0.25');
}
function appear(el) {
  if (!mOK()) return; const gsap = MOTION.g;
  if (el.id === 'prog') { gsap.fromTo(el, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: MOT.s, clearProps: 'transform' }); return; }
  if (el.id === 'msg') { gsap.fromTo(el, { y: 18, scale: 0.96, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.34, ease: 'back.out(1.3)', clearProps: 'scale' }); return; }
  if (el.id === 'tl-menu') { gsap.fromTo(el, { scale: 0.96, y: -4, opacity: 0, transformOrigin: 'top left' }, { scale: 1, y: 0, opacity: 1, duration: 0.2, clearProps: 'transform' }); gsap.from(el.querySelectorAll('.m-lbl, .m-fx, .m-row, :scope > button'), { y: 4, opacity: 0, stagger: 0.012, duration: 0.18, delay: 0.04, clearProps: 'all' }); return; }
  if (el.classList.contains('picker')) { gsap.fromTo(el, { y: -6, opacity: 0 }, { y: 0, opacity: 1, duration: MOT.s, clearProps: 'transform' }); staggerList([...el.children].slice(0, 12), 0.03); return; }
  if (el.matches('section.card')) { gsap.fromTo(el, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: MOT.l, clearProps: 'transform,opacity,visibility' }); return; }
  if (el.matches('[data-tabpane]')) { paneIn(el); return; }
}
function staggerList(els, each = MOT.stag) {
  if (!mOK() || !els.length) return;
  MOTION.g.fromTo(els, { y: 14, opacity: 0 }, { y: 0, opacity: 1, stagger: { each, amount: Math.min(0.36, each * els.length) }, duration: MOT.s, clearProps: 'transform,opacity,visibility' });
}
function staggerNew(els) { els.forEach(e => e.dataset.m = '1'); staggerList([...els]); }
let paneDir = 1;
function paneIn(pane) {
  if (!mOK()) return;
  const kids = [...pane.querySelectorAll(':scope > section.card:not([hidden]), :scope > .grid2 > section.card, :scope > section.card')].filter((v, i, a) => a.indexOf(v) === i && !v.hidden).slice(0, 6);
  MOTION.g.fromTo(kids, { x: 26 * paneDir, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.05, duration: 0.4, clearProps: 'transform,opacity,visibility' });
}
/** Вкладки: подложка едет к выбранной, новая вкладка приходит со стороны, куда нажали. */
function motionTab(prev, next) {
  const order = ['build', 'clean', 'sfx'], a = order.indexOf(prev), b = order.indexOf(next); paneDir = b >= a ? 1 : -1;
  tabIndicator(false);
}
function tabIndicator(instant) {
  const tabs = document.querySelector('.tabs'); if (!tabs) return;
  let ind = tabs.querySelector('.tab-ind'); if (!ind) { ind = document.createElement('span'); ind.className = 'tab-ind'; ind.setAttribute('aria-hidden', 'true'); tabs.prepend(ind); }
  const on = tabs.querySelector('button.on'); if (!on) return;
  const x = on.offsetLeft, w = on.offsetWidth;
  if (!MOTION.g) { ind.style.transform = `translateX(${x}px)`; ind.style.width = w + 'px'; return; }
  if (instant || MOTION.reduce) { MOTION.g.killTweensOf(ind); MOTION.g.set(ind, { x, width: w }); return; }
  MOTION.g.to(ind, { x, width: w, duration: 0.34, ease: 'power3.inOut' });
}
/** Число в плашке считается до нового значения. */
function motionCount(el, key) {
  const to = +el.dataset.n; if (!isFinite(to)) return;
  const from = MOTION.counts.has(key) ? MOTION.counts.get(key) : 0; MOTION.counts.set(key, to);
  const out = el.querySelector('b') || el; if (!mOK() || from === to) { out.textContent = to; return; }
  const o = { v: from }; MOTION.g.to(o, { v: to, duration: 0.6, ease: 'power2.out', onUpdate: () => { out.textContent = Math.round(o.v); } });
  if (to !== from) MOTION.g.fromTo(el, { scale: 1.08 }, { scale: 1, duration: 0.4, ease: 'back.out(2)', clearProps: 'scale' });
}
/** Сообщение уходит вниз и тает, потом скрывается. */
function motionHide(el, done) {
  if (!mOK() || el.hidden) { el.hidden = true; done && done(); return; }
  MOTION.g.to(el, { y: 12, autoAlpha: 0, duration: 0.2, ease: MOT.exit, onComplete: () => { el.hidden = true; MOTION.g.set(el, { clearProps: 'all' }); done && done(); } });
}
function fullIn(tl) {
  if (!mOK()) return;
  MOTION.g.fromTo(tl.querySelectorAll('.tl-bar, .tl-canvas, #tl-ov, .tl-info'), { y: 14, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.05, duration: 0.36, clearProps: 'transform,opacity,visibility' });
}
/** Плавный масштаб и прокрутка таймлайна (кнопки, клавиши, мини-карта); колёсико и протяжка — мгновенно. */
function motionView(st, zoom, scroll, draw) {
  if (!mOK()) { st.zoom = zoom; st.scroll = scroll; draw(); return; }
  MOTION.g.to(st, { zoom, scroll, duration: 0.32, ease: 'power3.out', overwrite: true, onUpdate: draw });
}
/** Шаг выполнен: номер превращается в галочку. */
function motionSteps() {
  const done = {
    s1: !!(S.P && S.P.cues && S.P.cues.length),
    s2: S.files.some(f => f.y48),
    s3: !!(S.matches && S.matches.size),
    review: !!(S.result),
    mix: !!(S.result && S.result.out),
  };
  for (const [id, ok] of Object.entries(done)) { const b = document.querySelector(`#${id} .step b`); if (b) b.classList.toggle('done', ok); }
}
// ------------------------------------------------------------------ тема: авто → светлая → тёмная, смена кругом из кнопки
const THEME_KEY = 'montage:theme', THEME_NAMES = { auto: 'авто', light: 'светлая', dark: 'тёмная' };
function themeMode() { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; } }
function themeApply(mode) {
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = mode;
  const b = document.getElementById('theme-b'); if (b) { b.dataset.mode = mode; b.querySelector('.theme-l').textContent = THEME_NAMES[mode]; b.setAttribute('aria-label', `Тема: ${THEME_NAMES[mode]} — сменить`); }
}
function initTheme() {
  const b = document.getElementById('theme-b'); themeApply(themeMode()); if (!b) return;
  b.addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'], next = order[(order.indexOf(themeMode()) + 1) % 3];
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    const swap = () => { themeApply(next); render(); if (typeof drawTimeline === 'function') drawTimeline(); };
    if (!document.startViewTransition || MOTION.reduce) { swap(); return; }
    const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const vt = document.startViewTransition(swap);
    vt.ready.then(() => document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`] }, { duration: 560, easing: 'cubic-bezier(.2, 0, 0, 1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {});
  });
}
