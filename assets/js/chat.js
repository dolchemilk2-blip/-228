/* Живой чат на двоих */

import { cloud, renderCloudBadge } from './cloud.js';

const $ = (id) => document.getElementById(id);

App.init();
renderCloudBadge();

const meKey = App.getMe() || 'a';
const other = App.partner();

$('head-ava').textContent = other.emoji;
$('head-name').textContent = other.name;

document.addEventListener('me-changed', () => location.reload());

/* ---------------- быстрые эмодзи ---------------- */

const QUICK = ['❤️', '😘', '🫂', '🥺', '😂', '💭', '🌙', '☕', '👀', '🔥'];
$('quick').innerHTML = QUICK.map((e) => '<button type="button" data-e="' + e + '">' + e + '</button>').join('');
$('quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-e]');
  if (!b) return;
  const input = $('input');
  input.value += b.getAttribute('data-e');
  input.focus();
  autoGrow();
});

/* ---------------- рендер сообщений ---------------- */

const log = $('log');
let rendered = new Map();
let lastDayLabel = null;
let firstPaint = true;

const ONLY_EMOJI = /^(?:[\p{Extended_Pictographic}‍️\u{1f3fb}-\u{1f3ff}]|\s){1,3}$/u;

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  if (d.toDateString() === yest.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function atBottom() {
  return log.scrollHeight - log.scrollTop - log.clientHeight < 120;
}

function paint(list) {
  const stick = atBottom() || firstPaint;

  log.innerHTML = '';
  lastDayLabel = null;

  if (!list.length) {
    log.innerHTML = '<div class="empty-note">Здесь пока пусто.<br />Напишите первое сообщение 💜</div>';
    return;
  }

  list.forEach((m) => {
    const label = dayLabel(m.at || Date.now());
    if (label !== lastDayLabel) {
      lastDayLabel = label;
      const sep = document.createElement('div');
      sep.className = 'day-sep';
      sep.textContent = label;
      log.appendChild(sep);
    }

    const b = document.createElement('div');
    const mine = m.by === meKey;
    b.className = 'bubble ' + (mine ? 'mine' : 'theirs');
    if (ONLY_EMOJI.test(m.text || '')) b.classList.add('big-emoji');

    b.textContent = m.text || '';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = (mine ? 'вы' : App.person(m.by).name) + ' · ' +
      new Date(m.at || Date.now()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    b.appendChild(meta);
    log.appendChild(b);
  });

  if (typingVisible) log.appendChild(typingEl);
  if (stick) log.scrollTop = log.scrollHeight;
  firstPaint = false;
}

/* ---------------- индикатор «печатает» ---------------- */

const typingEl = document.createElement('div');
typingEl.className = 'typing';
typingEl.innerHTML = '<i></i><i></i><i></i>';
let typingVisible = false;

function setTypingVisible(on) {
  if (on === typingVisible) return;
  typingVisible = on;
  if (on) { log.appendChild(typingEl); if (atBottom()) log.scrollTop = log.scrollHeight; }
  else typingEl.remove();
  $('head-sub').textContent = on ? 'печатает…' : lastSeenText;
}

/* ---------------- подключение ---------------- */

await cloud.ready();
cloud.presence(meKey);

let messages = [];

cloud.watch('messages', (data) => {
  messages = Object.entries(data || {})
    .map(([id, m]) => ({ id, ...m }))
    .sort((x, y) => (x.at || 0) - (y.at || 0))
    .slice(-300);
  paint(messages);
});

/* статус второго человека */
let lastSeenText = '—';
cloud.watch('presence', (data) => {
  const info = (data || {})[App.partnerKey()];
  if (!info) lastSeenText = 'ещё не заходил сюда';
  else if (info.online) lastSeenText = '● сейчас на сайте';
  else lastSeenText = 'был ' + App.formatWhen(info.at);
  if (!typingVisible) $('head-sub').textContent = lastSeenText;
});

/* чужой набор текста */
cloud.watch('typing', (data) => {
  const t = (data || {})[App.partnerKey()];
  const fresh = t && t.at && (Date.now() - t.at < 5000);
  setTypingVisible(Boolean(fresh));
});
setInterval(() => { if (typingVisible) setTypingVisible(false); }, 5000);

/* ---------------- отправка ---------------- */

const input = $('input');

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 130) + 'px';
}

let typingSentAt = 0;
input.addEventListener('input', () => {
  autoGrow();
  const now = Date.now();
  if (now - typingSentAt > 1800) {
    typingSentAt = now;
    cloud.set('typing/' + meKey, { at: now });
  }
});

async function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  autoGrow();
  await cloud.push('messages', { by: meKey, text, at: Date.now() });
  await cloud.set('typing/' + meKey, { at: 0 });
  log.scrollTop = log.scrollHeight;
}

$('form').addEventListener('submit', (e) => { e.preventDefault(); send(); });

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

/* обнимашка прямо из чата */
$('btn-hug').addEventListener('click', async (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  App.burst(r.left + r.width / 2, r.top + r.height / 2, ['🫂', '💜', '✨']);
  await cloud.push('pings', { by: meKey, kind: 'hug', at: Date.now() });
  App.toast('Обнял 🫂');
});

input.focus();
