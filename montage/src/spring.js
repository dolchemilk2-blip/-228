// Монтажка — пружины в духе Apple (WWDC 2018 «Designing Fluid Interfaces», скилл apple-design).
// Параметры как у Apple: затухание (1 — без перелёта, 0,8 — лёгкий перелёт) и отклик в секундах.
// Движение всегда начинается с текущего значения и сохраняет скорость, поэтому его можно
// перехватить и развернуть на лету. Один цикл requestAnimationFrame на все пружины, только пока
// что-то движется. springEase() превращает ту же пружину в CSS linear() для переходов и WAAPI.
// Поверх — отклик на касание (кнопки сжимаются в момент нажатия и отпружинивают), лёгкая тяга
// к курсору у значков, наклон карточек к курсору с бликом (transitions.dev: card tilt), FLIP.
// prefers-reduced-motion: всё встаёт на место сразу. Использует MOTION из motion.js.
const SPRING = { live: new Set(), dirty: new Set(), raf: 0, t: 0 };
const sprReduced = () => typeof MOTION !== 'undefined' && MOTION.reduce;
/** Значение на пружине. eps — точность, при которой пружина считается улёгшейся. */
function mv(v = 0, eps = 0.01, owner = null) { return { v, vel: 0, to: v, k: 0, c: 0, eps, owner }; }
function mvTo(m, to, { damping = 1, response = 0.4, velocity } = {}) {
  if (velocity != null) m.vel = velocity;
  m.to = to;
  if (sprReduced()) { mvSet(m, to); return; }
  const w = 2 * Math.PI / response; m.k = w * w; m.c = 2 * damping * w;
  SPRING.live.add(m); sprKick();
}
function mvSet(m, v) { m.v = v; m.to = v; m.vel = 0; SPRING.live.delete(m); if (m.owner) { SPRING.dirty.add(m.owner); sprKick(); } }
function sprKick() { if (!SPRING.raf) { SPRING.t = performance.now(); SPRING.raf = requestAnimationFrame(sprTick); } }
function sprTick(now) {
  SPRING.raf = 0;
  let dt = Math.min(0.05, Math.max(0.001, (now - SPRING.t) / 1000)); SPRING.t = now;
  const steps = Math.ceil(dt / (1 / 240)), h = dt / steps;
  for (const m of SPRING.live) {
    for (let i = 0; i < steps; i++) { const a = -m.k * (m.v - m.to) - m.c * m.vel; m.vel += a * h; m.v += m.vel * h; }
    if (Math.abs(m.v - m.to) < m.eps && Math.abs(m.vel) < m.eps * 10) { m.v = m.to; m.vel = 0; SPRING.live.delete(m); }
    if (m.owner) SPRING.dirty.add(m.owner);
  }
  for (const o of SPRING.dirty) o.render(); SPRING.dirty.clear();
  if (SPRING.live.size) SPRING.raf = requestAnimationFrame(sprTick);
}
/** Пружина как CSS linear(): одна и та же физика для JS и для переходов. Кэшируется. */
const SPR_EASE = new Map();
function springEase(damping = 1, response = 0.4) {
  const key = damping + '|' + response; if (SPR_EASE.has(key)) return SPR_EASE.get(key);
  const w = 2 * Math.PI / response, k = w * w, c = 2 * damping * w, h = 1 / 600, pts = [];
  let x = 0, v = 0, t = 0, settled = 0;
  while (t < 3) { const a = -k * (x - 1) - c * v; v += a * h; x += v * h; t += h; pts.push(x); if (Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) { if (++settled > 30) break; } else settled = 0; }
  const n = 44, out = []; for (let i = 0; i <= n; i++) out.push(+pts[Math.min(pts.length - 1, Math.round(i / n * (pts.length - 1)))].toFixed(4));
  out[n] = 1;
  const res = { easing: `linear(${out.join(', ')})`, duration: Math.round(t * 1000) };
  SPR_EASE.set(key, res); return res;
}
/** Трансформ элемента из пружин: сдвиг, масштаб, наклон. В покое трансформ снимается совсем. */
function tform(el) {
  if (el._tf) return el._tf;
  const T = { el, render() {
    const x = T.x.v, y = T.y.v, s = T.s.v, rx = T.rx.v, ry = T.ry.v;
    const idle = Math.abs(x) < 0.01 && Math.abs(y) < 0.01 && Math.abs(s - 1) < 0.0005 && Math.abs(rx) < 0.01 && Math.abs(ry) < 0.01;
    el.style.transform = idle ? '' : `${rx || ry ? 'perspective(700px) ' : ''}translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)${rx || ry ? ` rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)` : ''} scale(${s.toFixed(4)})`;
  } };
  T.x = mv(0, 0.02, T); T.y = mv(0, 0.02, T); T.s = mv(1, 0.0004, T); T.rx = mv(0, 0.02, T); T.ry = mv(0, 0.02, T);
  el._tf = T; return T;
}
/** Куда долетит брошенное (Apple: проекция импульса). v — px/с. */
const project = (v, rate = 0.99) => (v / 1000) * rate / (1 - rate);
/** Резиновый край: чем дальше за границу, тем меньше идёт следом. */
const rubber = (over, dim = 200, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
/** Скорость в момент отпускания по последним точкам указателя: [{t, x, y}] → px/с.
 *  Считается от «сейчас», а не от последнего движения: палец остановился и потом отпустил — броска нет. */
function velocityOf(hist, now = performance.now()) {
  const pts = hist.filter(p => now - p.t < 100);
  if (pts.length < 2) return { x: 0, y: 0 };
  const a = pts[0], b = pts[pts.length - 1], dt = Math.max(1, b.t - a.t);
  return { x: (b.x - a.x) / dt * 1000, y: (b.y - a.y) / dt * 1000 };
}
// ------------------------------------------------------------------ касание: сжатие в момент нажатия
const PRESS_SEL = '.primary, .ghost-b, .icon, .icon-b, .play, .chip.as-btn, .filters button, .ftab, .tog, .m-fx button, .m-row button, .theme-b, .acc-head, .tabs button, .rail a, .models label, .tl-menu > button, .pick-files';
const LEAN_SEL = '.icon, .icon-b, .play, .theme-b, .primary, .ghost-b, .ftab';
let pressed = null;
function pressScale(el) { const w = el.offsetWidth; return w < 48 ? 0.9 : w < 140 ? 0.95 : w < 320 ? 0.97 : 0.985; }   // большое — тяжелее
function initTouch() {
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || sprReduced()) return;
    const el = e.target.closest(PRESS_SEL); if (!el || el.disabled || el.matches(':disabled, [aria-disabled="true"]') || el.querySelector(':scope > input:disabled')) return;
    const T = tform(el), r = el.getBoundingClientRect();
    if (Math.abs(T.s.v - 1) < 0.002) el.style.transformOrigin = `${((e.clientX - r.left) / r.width * 100).toFixed(1)}% ${((e.clientY - r.top) / r.height * 100).toFixed(1)}%`;   // сжимается к пальцу
    mvTo(T.s, pressScale(el), { damping: 1, response: 0.16 });
    pressed = { el, r };
  }, true);
  const release = () => { if (!pressed) return; const T = tform(pressed.el); mvTo(T.s, 1, { damping: 0.58, response: 0.42 }); pressed = null; };
  document.addEventListener('pointerup', release, true); document.addEventListener('pointercancel', release, true);
  document.addEventListener('pointermove', e => {                 // увели палец с кнопки — отпускает, как в iOS
    if (!pressed) return; const r = pressed.r, pad = 14;
    if (e.clientX < r.left - pad || e.clientX > r.right + pad || e.clientY < r.top - pad || e.clientY > r.bottom + pad) release();
  }, { passive: true });
  // тяга к курсору: значки и кнопки чуть идут навстречу мыши и мягко возвращаются
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let lean = null, raf = 0, last = null;
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return; last = e;
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0; if (sprReduced()) return;
      const el = last.target.closest && last.target.closest(LEAN_SEL);
      if (lean && lean !== el) { const T = tform(lean); mvTo(T.x, 0, { damping: 0.55, response: 0.5 }); mvTo(T.y, 0, { damping: 0.55, response: 0.5 }); lean = null; }
      if (!el || el.disabled || el.closest('.tl-menu')) return;
      const r = el.getBoundingClientRect(), L = r.width < 48 ? 2.5 : r.width < 160 ? 1.6 : 1;
      const dx = Math.max(-1, Math.min(1, (last.clientX - r.left - r.width / 2) / (r.width / 2))), dy = Math.max(-1, Math.min(1, (last.clientY - r.top - r.height / 2) / (r.height / 2)));
      const T = tform(el); mvTo(T.x, dx * L, { damping: 1, response: 0.22 }); mvTo(T.y, dy * L, { damping: 1, response: 0.22 }); lean = el;
    });
  }, { passive: true });
  document.addEventListener('pointerleave', () => { if (lean) { const T = tform(lean); mvTo(T.x, 0, { damping: 0.55, response: 0.5 }); mvTo(T.y, 0, { damping: 0.55, response: 0.5 }); lean = null; } });
}
// ------------------------------------------------------------------ наклон карточек к курсору с бликом
function initTilt(sel, max = 7) {
  const host = document.querySelector(sel); if (!host) return;
  host.classList.add('tilt-host');
  let cur = null;
  const flat = el => { if (!el) return; const T = tform(el); mvTo(T.rx, 0, { damping: 0.6, response: 0.55 }); mvTo(T.ry, 0, { damping: 0.6, response: 0.55 }); el.classList.remove('tilting'); };
  host.addEventListener('pointermove', e => {
    if (sprReduced()) return;
    // считаем по раскладке (offset*), а не по наклонённому прямоугольнику — край не «уезжает» из-под курсора
    const hr = host.getBoundingClientRect(), px = e.clientX - hr.left, py = e.clientY - hr.top;
    const el = [...host.children].find(c => px >= c.offsetLeft && px <= c.offsetLeft + c.offsetWidth && py >= c.offsetTop && py <= c.offsetTop + c.offsetHeight);
    if (cur !== el) { flat(cur); cur = el; }
    if (!el) return;
    const u = (px - el.offsetLeft) / el.offsetWidth, v = (py - el.offsetTop) / el.offsetHeight, T = tform(el);
    mvTo(T.ry, (u - 0.5) * max, { damping: 1, response: 0.18 }); mvTo(T.rx, (0.5 - v) * max * 0.8, { damping: 1, response: 0.18 });
    el.style.setProperty('--gx', (u * 100).toFixed(1) + '%'); el.style.setProperty('--gy', (v * 100).toFixed(1) + '%'); el.classList.add('tilting');
  });
  host.addEventListener('pointerleave', () => { flat(cur); cur = null; });
}
// ------------------------------------------------------------------ FLIP: элементы доезжают до новых мест на пружинах
function flipRecord(sel, key) { const m = new Map(); document.querySelectorAll(sel).forEach(el => { const r = el.getBoundingClientRect(); m.set(key(el), { x: r.left, y: r.top }); }); return m; }
function flipPlay(before, sel, key, opt = { damping: 0.82, response: 0.38 }) {
  if (sprReduced()) return;
  document.querySelectorAll(sel).forEach(el => {
    const was = before.get(key(el)); if (was == null) return;
    const r = el.getBoundingClientRect(), dx = was.x - r.left, dy = was.y - r.top; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const T = tform(el); if (Math.abs(dx) >= 1) { mvSet(T.x, dx); mvTo(T.x, 0, opt); } if (Math.abs(dy) >= 1) { mvSet(T.y, dy); mvTo(T.y, 0, opt); }
  });
}
