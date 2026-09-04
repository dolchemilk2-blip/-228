/* Игры для двоих: причины, вопросы, скретч-карточка, колесо свиданий */

import { cloud, renderCloudBadge } from './cloud.js';

const CFG = window.SITE_CONFIG;
const $ = (id) => document.getElementById(id);

App.init();
renderCloudBadge();

const meKey = App.getMe() || 'a';
document.addEventListener('me-changed', () => location.reload());

/* то, что можно переслать в чат */
const shareable = { reason: '', question: '', wheel: '' };

document.querySelectorAll('[data-share]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const kind = btn.getAttribute('data-share');
    const text = shareable[kind];
    if (!text) { App.toast('Сначала вытяните карточку 🙂'); return; }
    const prefix = { reason: '💘 ', question: '🃏 ', wheel: '🎡 ' }[kind] || '';
    await cloud.push('messages', { by: meKey, text: prefix + text, at: Date.now() });
    App.toast('Отправлено в чат 💬');
  });
});

/* ============================================================
   1. Сто причин
   ============================================================ */

const reasons = CFG.reasons || [];
let lastReason = null;

$('reason-count').textContent = reasons.length
  ? 'В коллекции ' + reasons.length + ' ' + App.plural(reasons.length, 'причина', 'причины', 'причин')
  : 'Список причин пуст — добавьте их в config.js';

$('reason-btn').addEventListener('click', (e) => {
  if (!reasons.length) { App.toast('Добавьте причины в config.js'); return; }
  lastReason = App.pickDifferent(reasons, lastReason);
  shareable.reason = lastReason;
  const el = $('reason');
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  el.textContent = lastReason;
  const r = e.currentTarget.getBoundingClientRect();
  App.burst(r.left + r.width / 2, r.top, ['💘', '💖', '✨']);
});

/* ============================================================
   2. Вопросы
   ============================================================ */

const questions = CFG.questions || [];
let lastQuestion = null;

$('question-count').textContent = questions.length
  ? 'В колоде ' + questions.length + ' ' + App.plural(questions.length, 'карточка', 'карточки', 'карточек')
  : 'Колода пуста — добавьте вопросы в config.js';

$('question-btn').addEventListener('click', () => {
  if (!questions.length) { App.toast('Добавьте вопросы в config.js'); return; }
  lastQuestion = App.pickDifferent(questions, lastQuestion);
  shareable.question = lastQuestion;
  const el = $('question');
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  el.textContent = lastQuestion;
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

function coverCanvas() {
  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const g = ctx.createLinearGradient(0, 0, rect.width, rect.height);
  g.addColorStop(0, '#b8b3cc');
  g.addColorStop(.45, '#8f89ab');
  g.addColorStop(.55, '#d6d2e6');
  g.addColorStop(1, '#7d7799');
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, rect.width, rect.height);

  ctx.fillStyle = 'rgba(40,20,60,.5)';
  ctx.font = '600 15px Manrope, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('сотри меня 👆', rect.width / 2, rect.height / 2 + 5);
}

function newScratch() {
  lastScratch = App.pickDifferent(scratchTexts, lastScratch);
  under.textContent = lastScratch;
  revealed = false;
  canvas.style.opacity = '1';
  canvas.style.pointerEvents = 'auto';
  coverCanvas();
}

function scratchAt(e) {
  const rect = canvas.getBoundingClientRect();
  const p = e.touches ? e.touches[0] : e;
  const x = p.clientX - rect.left;
  const y = p.clientY - rect.top;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(x, y, 24, 0, Math.PI * 2);
  ctx.fill();
}

function clearedRatio() {
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let clear = 0;
  const step = 40; // каждый 10-й пиксель — достаточно точно и быстро
  for (let i = 3; i < img.length; i += step) if (img[i] < 40) clear++;
  return clear / (img.length / step);
}

function maybeReveal() {
  if (revealed) return;
  if (clearedRatio() < 0.5) return;
  revealed = true;
  canvas.style.transition = 'opacity .6s ease';
  canvas.style.opacity = '0';
  canvas.style.pointerEvents = 'none';
  App.rainHearts(2);
}

canvas.addEventListener('pointerdown', (e) => {
  scratching = true;
  // не во всех браузерах захват указателя доступен — на скретч это не влияет
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  scratchAt(e);
});
canvas.addEventListener('pointermove', (e) => { if (scratching) scratchAt(e); });
canvas.addEventListener('pointerup', () => { scratching = false; maybeReveal(); });
canvas.addEventListener('pointercancel', () => { scratching = false; });
canvas.addEventListener('pointerleave', () => { if (scratching) { scratching = false; maybeReveal(); } });

$('scratch-again').addEventListener('click', newScratch);
window.addEventListener('resize', () => { if (!revealed) coverCanvas(); });

newScratch();

/* ============================================================
   4. Колесо свиданий
   ============================================================ */

const ideas = CFG.dateIdeas && CFG.dateIdeas.length ? CFG.dateIdeas : ['Добавьте идеи в config.js'];
const wheel = $('wheel');
const SEG = 360 / ideas.length;
const WHEEL_EMOJI = ['🎬', '🍜', '🗺️', '🎮', '📖', '🎧', '🎨', '🕯️', '📸', '🗓️', '💬', '🌙', '🍿', '☕', '🌸', '🚲'];

function buildWheel() {
  const stops = ideas.map((_, i) => {
    const c = i % 2 ? 'rgba(180,69,255,.55)' : 'rgba(255,94,156,.55)';
    return c + ' ' + (i * SEG) + 'deg ' + ((i + 1) * SEG) + 'deg';
  }).join(', ');
  wheel.style.background = 'conic-gradient(' + stops + ')';

  wheel.innerHTML = ideas.map((_, i) => {
    const angle = i * SEG + SEG / 2;
    return '<span class="wheel-label" style="transform: rotate(' + angle +
      'deg) translate(0, -88px) rotate(90deg)">' + WHEEL_EMOJI[i % WHEEL_EMOJI.length] + '</span>';
  }).join('');
}

buildWheel();

let spinning = false;
let turns = 0;

$('wheel-btn').addEventListener('click', () => {
  if (spinning) return;
  spinning = true;
  $('wheel-btn').disabled = true;
  $('wheel-result').textContent = '';

  const index = Math.floor(Math.random() * ideas.length);
  turns += 5 + Math.floor(Math.random() * 3);
  // указатель сверху: нужный сегмент должен оказаться под ним
  const target = turns * 360 + (360 - (index * SEG + SEG / 2));
  wheel.style.transform = 'rotate(' + target + 'deg)';

  setTimeout(() => {
    spinning = false;
    $('wheel-btn').disabled = false;
    shareable.wheel = ideas[index];
    $('wheel-result').textContent = ideas[index];
    App.burst(window.innerWidth / 2, window.innerHeight / 2, ['🎉', '✨', '💜', '💖']);
  }, 4700);
});

await cloud.ready();
cloud.presence(meKey);
