/* Наша история: мост, таймлайн, фото, общий список желаний */

import { cloud, renderCloudBadge } from './cloud.js';

const CFG = window.SITE_CONFIG;
const $ = (id) => document.getElementById(id);

App.init();
renderCloudBadge();

const meKey = App.getMe() || 'a';
const A = App.person('a');
const B = App.person('b');

document.addEventListener('me-changed', () => location.reload());

/* ---------------- мост между городами ---------------- */

$('bridge-a-city').textContent = A.city || A.name;
$('bridge-b-city').textContent = B.city || B.name;

function tickBridge() {
  $('bridge-a-time').textContent = App.clockIn(A.timeZone);
  $('bridge-b-time').textContent = App.clockIn(B.timeZone);
}
tickBridge();
setInterval(tickBridge, 1000);

/* ---------------- таймлайн ---------------- */

const timeline = CFG.timeline || [];
$('timeline').innerHTML = timeline.length
  ? timeline.map((t) =>
      '<div class="tl-item">' +
        '<div class="tl-dot">' + App.escapeHtml(t.icon || '💜') + '</div>' +
        '<div class="tl-date">' + App.escapeHtml(t.date || '') + '</div>' +
        '<div class="tl-title">' + App.escapeHtml(t.title || '') + '</div>' +
        '<div class="tl-text">' + App.escapeHtml(t.text || '') + '</div>' +
      '</div>').join('')
  : '<p class="muted">Впишите свои даты в <code>config.js</code>, раздел <code>timeline</code>.</p>';

/* ---------------- галерея ---------------- */

const photos = CFG.photos || [];

if (!photos.length) {
  $('photo-hint').classList.remove('hidden');
} else {
  $('gallery').innerHTML = photos.map((p, i) =>
    '<div class="photo" data-i="' + i + '">' +
      '<img src="' + App.escapeHtml(p.src) + '" alt="' + App.escapeHtml(p.caption || 'Воспоминание') + '" loading="lazy" />' +
      (p.caption ? '<div class="cap">' + App.escapeHtml(p.caption) + '</div>' : '') +
    '</div>').join('');
}

$('gallery').addEventListener('click', (e) => {
  const cell = e.target.closest('[data-i]');
  if (!cell) return;
  const p = photos[+cell.getAttribute('data-i')];
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = '<div class="lightbox center">' +
    '<img src="' + App.escapeHtml(p.src) + '" alt="' + App.escapeHtml(p.caption || '') + '" />' +
    (p.caption ? '<p>' + App.escapeHtml(p.caption) + '</p>' : '') + '</div>';
  back.addEventListener('click', () => back.remove());
  document.body.appendChild(back);
});

/* ---------------- список желаний ---------------- */

const wishes = CFG.wishlist || [];
let wishState = {};

function paintWishes() {
  const box = $('wishlist');
  if (!wishes.length) {
    box.innerHTML = '<p class="muted">Впишите свои пункты в <code>config.js</code>, раздел <code>wishlist</code>.</p>';
    return;
  }

  box.innerHTML = wishes.map((text, i) => {
    const st = wishState['w' + i];
    const done = Boolean(st && st.done);
    const by = done && st.by ? 'отметил ' + App.person(st.by).name : '';
    return '<div class="wish ' + (done ? 'done' : '') + '" data-i="' + i + '">' +
      '<div class="box">' + (done ? '✓' : '') + '</div>' +
      '<div class="label">' + App.escapeHtml(text) + '</div>' +
      '<div class="by">' + App.escapeHtml(by) + '</div>' +
    '</div>';
  }).join('');

  const done = wishes.filter((_, i) => wishState['w' + i] && wishState['w' + i].done).length;
  const pct = wishes.length ? Math.round(done / wishes.length * 100) : 0;
  $('wish-progress').style.width = pct + '%';
  $('wish-progress-text').textContent = 'Сделано ' + done + ' из ' + wishes.length + ' · ' + pct + '%';
}

$('wishlist').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-i]');
  if (!row) return;
  const i = row.getAttribute('data-i');
  const cur = wishState['w' + i];
  const next = !(cur && cur.done);

  // мгновенный отклик, не дожидаясь облака
  wishState['w' + i] = { done: next, by: meKey, at: Date.now() };
  paintWishes();

  await cloud.set('wishlist/w' + i, { done: next, by: meKey, at: Date.now() });
  if (next) {
    const r = row.getBoundingClientRect();
    App.burst(r.left + 20, r.top + r.height / 2, ['✅', '✨', '💜']);
  }
});

paintWishes();

await cloud.ready();
cloud.presence(meKey);

cloud.watch('wishlist', (data) => {
  wishState = data || {};
  paintWishes();
});
