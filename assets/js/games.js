/* Игры для двоих: причины, вопросы, скретч-карточка, колесо свиданий */

import { cloud, trackUnread } from './cloud.js';

const CFG = window.SITE_CONFIG;
const $ = (id) => document.getElementById(id);
const calm = () => App.reduceMotion();

App.init();

const meKey = App.getMe() || 'a';
document.addEventListener('me-changed', () => location.reload());

/* то, что можно переслать в чат */
const shareable = { reason: '', question: '', wheel: '' };

document.querySelectorAll('[data-share]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const kind = btn.getAttribute('data-share');
    const text = shareable[kind];
    if (!text) { App.toast('Сначала вытяните карточку'); return; }
    const prefix = { reason: '💘 ', question: '🃏 ', wheel: '🎡 ' }[kind] || '';
    await cloud.push('messages', { by: meKey, text: prefix + text, at: Date.now() });
    App.toast('Отправлено в чат');
  });
});

/* ============================================================
   1. Сто причин — колода: верхняя карточка улетает,
      следующая поднимается на её место
   ============================================================ */

const reasons = CFG.reasons || [];
let lastReason = null;

$('reason-count').textContent = reasons.length
  ? reasons.length + ' ' + App.plural(reasons.length, 'причина', 'причины', 'причин')
  : 'список пуст';

/* Верхнюю карточку можно смахнуть пальцем в любую сторону: она идёт
   за пальцем 1:1 и чуть поворачивается; отпустил — решает скорость
   и то, куда жест «докатился» бы. Не докинул — пружиной на место. */

const deck = $('deck');
const card = $('reason-card');
let cardAnim = null;
let cardX = 0;
let flying = false;

function placeCard(x) {
  cardX = x;
  const w = deck.clientWidth || 300;
  const rot = (x / w) * 12;
  card.style.transform = 'translateX(' + x.toFixed(1) + 'px) rotate(' + rot.toFixed(2) + 'deg)';
  card.style.opacity = String(Math.max(0, 1 - Math.max(0, Math.abs(x) - w * 0.6) / (w * 0.6)));
}

function showNextReason() {
  lastReason = App.pickDifferent(reasons, lastReason);
  shareable.reason = lastReason;
  $('reason').textContent = lastReason;
  $('reason-num').textContent = '№ ' + (reasons.indexOf(lastReason) + 1);
}

// карточка улетает в сторону с той скоростью, с какой её бросили
function flyOut(dir, velocity) {
  if (flying) return;
  if (!reasons.length) { App.toast('Добавьте причины в config.js'); return; }
  flying = true;
  App.haptic();
  const w = deck.clientWidth || 300;
  if (cardAnim) cardAnim.stop();
  const done = () => {
    showNextReason();
    card.style.transform = '';
    card.style.opacity = '';
    cardX = 0;
    card.classList.remove('arriving');
    void card.offsetWidth;
    card.classList.add('arriving');
    flying = false;
  };
  if (calm()) { done(); return; }
  cardAnim = App.spring({
    from: cardX, to: dir * w * 1.5, velocity: velocity || dir * 900,
    damping: 1, response: 0.34, onUpdate: placeCard, onDone: done
  });
}

$('reason-btn').addEventListener('click', () => flyOut(-1, 0));

let grab = null;
card.addEventListener('pointerdown', (e) => {
  if (flying || !reasons.length || e.button > 0) return;
  if (cardAnim) cardAnim.stop();
  grab = { x0: e.clientX - cardX, y0: e.clientY, id: e.pointerId, tr: App.tracker(), on: false };
  grab.tr.add(e.clientX, e.clientY);
});
card.addEventListener('pointermove', (e) => {
  if (!grab || e.pointerId !== grab.id) return;
  grab.tr.add(e.clientX, e.clientY);
  const dx = e.clientX - grab.x0;
  const dy = e.clientY - grab.y0;
  if (!grab.on) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { grab = null; return; }   // это прокрутка
    if (Math.abs(dx) < 8) return;
    grab.on = true;
    card.classList.remove('arriving');
    try { card.setPointerCapture(e.pointerId); } catch (err) {}
  }
  placeCard(dx);
});
const release = () => {
  if (!grab) return;
  const g = grab;
  grab = null;
  if (!g.on) return;
  const v = g.tr.velocity().x;
  const w = deck.clientWidth || 300;
  const landing = cardX + App.project(v, 0.99);
  if (Math.abs(landing) > w * 0.45) flyOut(Math.sign(landing), v);
  else cardAnim = App.spring({
    from: cardX, to: 0, velocity: v, damping: 0.72, response: 0.42, onUpdate: placeCard,
    onDone: () => { card.style.transform = ''; card.style.opacity = ''; }
  });
};
card.addEventListener('pointerup', release);
card.addEventListener('pointercancel', release);

/* ============================================================
   2. Вопросы — карточка переворачивается рубашкой вниз
   ============================================================ */

const questions = CFG.questions || [];
let lastQuestion = null;
let flipped = false;
let turning = false;

$('question-count').textContent = questions.length
  ? questions.length + ' ' + App.plural(questions.length, 'карточка', 'карточки', 'карточек')
  : 'колода пуста';

const flip = $('flip');

$('question-btn').addEventListener('click', async () => {
  if (!questions.length) { App.toast('Добавьте вопросы в config.js'); return; }
  if (turning) return;
  lastQuestion = App.pickDifferent(questions, lastQuestion);
  shareable.question = lastQuestion;

  if (calm() || !flip.animate) {
    $('question').textContent = lastQuestion;
    flip.style.transform = 'rotateY(180deg)';
    flipped = true;
    return;
  }

  turning = true;
  if (!flipped) {
    // первый раз: рубашка уходит, открывается вопрос
    $('question').textContent = lastQuestion;
    await flip.animate(
      [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }],
      { duration: 640, easing: 'cubic-bezier(.3, 1.18, .6, 1)', fill: 'forwards' }
    ).finished;
    flip.style.transform = 'rotateY(180deg)';
    flipped = true;
  } else {
    // дальше: карточка отворачивается ребром, подменяется и возвращается
    await flip.animate(
      [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(270deg)' }],
      { duration: 170, easing: 'cubic-bezier(.55, 0, 1, .45)', fill: 'forwards' }
    ).finished;
    $('question').textContent = lastQuestion;
    await flip.animate(
      [{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(180deg)' }],
      { duration: 380, easing: 'cubic-bezier(.23, 1, .32, 1)', fill: 'forwards' }
    ).finished;
    flip.style.transform = 'rotateY(180deg)';
  }
  flip.getAnimations().forEach((a) => a.cancel());
  turning = false;
});

/* ============================================================
   3. Скретч-карточка
   ============================================================ */

const scratchTexts = CFG.scratchMessages || ['Добавьте свои сообщения в config.js'];
const wrap = $('scratch-wrap');
const under = $('scratch-under');
const canvas = $('scratch-canvas');
const ctx = canvas.getContext('2d');

let lastScratch = null;
let scratching = false;
let revealed = false;
let lastPoint = null;

function coverCanvas() {
  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const g = ctx.createLinearGradient(0, 0, rect.width, rect.height);
  g.addColorStop(0, '#c9c6d3');
  g.addColorStop(0.42, '#a19db2');
  g.addColorStop(0.52, '#e4e1ec');
  g.addColorStop(1, '#8f8aa3');
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, rect.width, rect.height);

  // мелкая «зернистость», как у настоящего защитного слоя
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  for (let i = 0; i < 260; i++) ctx.fillRect(Math.random() * rect.width, Math.random() * rect.height, 1.2, 1.2);

  ctx.fillStyle = 'rgba(40, 30, 60, .55)';
  ctx.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('сотрите пальцем', rect.width / 2, rect.height / 2 + 6);
}

function newScratch() {
  lastScratch = App.pickDifferent(scratchTexts, lastScratch);
  under.textContent = lastScratch;
  revealed = false;
  canvas.style.transition = 'none';
  canvas.style.opacity = '1';
  canvas.style.pointerEvents = 'auto';
  coverCanvas();
}

function pointFrom(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// ведём линию, а не отдельные кружки: при быстром движении нет «пунктира»
function scratchTo(p) {
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 46;
  ctx.beginPath();
  ctx.moveTo((lastPoint || p).x, (lastPoint || p).y);
  ctx.lineTo(p.x + 0.01, p.y);
  ctx.stroke();
  lastPoint = p;
}

function clearedRatio() {
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let clear = 0;
  const step = 40;
  for (let i = 3; i < img.length; i += step) if (img[i] < 40) clear++;
  return clear / (img.length / step);
}

function maybeReveal() {
  if (revealed || clearedRatio() < 0.45) return;
  revealed = true;
  canvas.style.transition = 'opacity 500ms ease';
  canvas.style.opacity = '0';
  canvas.style.pointerEvents = 'none';
  App.haptic();
  const r = wrap.getBoundingClientRect();
  App.burst(r.left + r.width / 2, r.top + r.height / 2, ['💖', '✨', '💜'], 12);
}

canvas.addEventListener('pointerdown', (e) => {
  scratching = true;
  lastPoint = null;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  scratchTo(pointFrom(e));
});
canvas.addEventListener('pointermove', (e) => { if (scratching) scratchTo(pointFrom(e)); });
canvas.addEventListener('pointerup', () => { scratching = false; maybeReveal(); });
canvas.addEventListener('pointercancel', () => { scratching = false; });

$('scratch-again').addEventListener('click', newScratch);
window.addEventListener('resize', () => { if (!revealed) coverCanvas(); });

newScratch();

/* ============================================================
   4. Колесо свиданий
   ============================================================ */

const ideas = CFG.dateIdeas && CFG.dateIdeas.length ? CFG.dateIdeas : ['Добавьте идеи в config.js'];
const wheel = $('wheel');
const pointer = $('wheel-pointer');
const SEG = 360 / ideas.length;
const WHEEL_EMOJI = ['🎬', '🍜', '🗺️', '🎮', '📖', '🎧', '🎨', '🕯️', '📸', '🗓️', '💬', '🌙', '🍿', '☕', '🌸', '🚲'];

function buildWheel() {
  const colors = [
    'color-mix(in srgb, var(--dima-fill) 26%, var(--surface))',
    'color-mix(in srgb, var(--ragim-fill) 24%, var(--surface))'
  ];
  const stops = ideas.map((_, i) => colors[i % 2] + ' ' + (i * SEG) + 'deg ' + ((i + 1) * SEG) + 'deg').join(', ');
  wheel.style.background = 'conic-gradient(' + stops + ')';

  const radius = Math.round(wheel.offsetWidth * 0.36) || 94;
  wheel.innerHTML = ideas.map((_, i) => {
    const angle = i * SEG + SEG / 2;
    return '<span class="wheel-label" aria-hidden="true" style="transform: rotate(' + angle +
      'deg) translate(0, -' + radius + 'px) translate(-50%, -50%)">' + WHEEL_EMOJI[i % WHEEL_EMOJI.length] + '</span>';
  }).join('');
}

buildWheel();
window.addEventListener('resize', buildWheel);

let spinning = false;
let turns = 0;

function currentAngle() {
  const m = getComputedStyle(wheel).transform;
  if (!m || m === 'none') return 0;
  const v = m.match(/matrix\(([^)]+)\)/);
  if (!v) return 0;
  const [a, b] = v[1].split(',').map(Number);
  const deg = Math.atan2(b, a) * 180 / Math.PI;
  return (deg + 360) % 360;
}

// стрелка «цокает» на каждом делении, пока колесо крутится
function watchTicks() {
  let last = -1;
  const step = () => {
    if (!spinning) return;
    const seg = Math.floor(currentAngle() / SEG);
    if (seg !== last) {
      last = seg;
      pointer.classList.remove('tick');
      void pointer.getBoundingClientRect();
      pointer.classList.add('tick');
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

$('wheel-btn').addEventListener('click', () => {
  if (spinning) return;
  spinning = true;
  $('wheel-btn').disabled = true;
  const res = $('wheel-result');
  res.classList.remove('show');
  res.innerHTML = '<span class="hint muted">Крутится…</span>';

  const index = Math.floor(Math.random() * ideas.length);
  turns += 5 + Math.floor(Math.random() * 3);
  // указатель сверху: нужный сегмент должен оказаться под ним
  const target = turns * 360 + (360 - (index * SEG + SEG / 2));
  wheel.style.transform = 'rotate(' + target + 'deg)';
  if (!calm()) watchTicks();

  const done = () => {
    spinning = false;
    $('wheel-btn').disabled = false;
    shareable.wheel = ideas[index];
    res.textContent = ideas[index];
    void res.offsetWidth;
    res.classList.add('show');
    App.haptic();
    const r = res.getBoundingClientRect();
    App.burst(r.left + r.width / 2, r.top + r.height / 2, ['🎉', '✨', '💜', '💙'], 14);
  };
  wheel.addEventListener('transitionend', done, { once: true });
});

await cloud.ready();
cloud.presence(meKey);
trackUnread();
