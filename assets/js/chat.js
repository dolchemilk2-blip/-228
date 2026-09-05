/* Живой чат на двоих */

import { cloud, renderCloudBadge } from './cloud.js';

const $ = (id) => document.getElementById(id);

App.init();
renderCloudBadge();

const meKey = App.getMe() || 'a';
const other = App.partner();
const TOUCH = matchMedia('(pointer: coarse)').matches;

$('head-ava').textContent = other.emoji;
$('head-name').textContent = other.name;

document.addEventListener('me-changed', () => location.reload());

/* ============================================================
   Высота под клавиатуру.

   На телефоне окно чата закреплено на экране, а его высоту мы
   берём из visualViewport — это единственное, что честно знает,
   сколько места осталось после того, как вылезла клавиатура.
   Иначе поле ввода уезжает вниз и остаёшься смотреть в пустоту.
   ============================================================ */

const vv = window.visualViewport;
const root = document.documentElement;
const topbar = document.querySelector('.topbar');

// «Спокойная» высота экрана — без клавиатуры. По ней и понимаем, что она вылезла.
let restHeight = vv ? vv.height : window.innerHeight;
let keyboardOpen = false;

function fitViewport() {
  const h = vv ? vv.height : window.innerHeight;
  const top = vv ? vv.offsetTop : 0;

  // экран мог стать выше: поворот, скрытие адресной строки
  if (h > restHeight) restHeight = h;

  const open = (restHeight - h) > 120;
  if (open !== keyboardOpen) {
    keyboardOpen = open;
    document.body.classList.toggle('kb-open', open);
  }

  const headH = (open || !topbar) ? 0 : topbar.getBoundingClientRect().height;

  root.style.setProperty('--vvh', Math.round(h) + 'px');
  root.style.setProperty('--vvtop', Math.round(top) + 'px');
  root.style.setProperty('--head-h', Math.round(headH) + 'px');
}

let queued = false;
function scheduleFit(scrollDown) {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    fitViewport();
    if (scrollDown && stick) toBottom();
  });
}

fitViewport();
window.addEventListener('resize', () => scheduleFit(true));
window.addEventListener('orientationchange', () => {
  restHeight = 0;                       // после поворота меряем заново
  setTimeout(() => scheduleFit(true), 300);
});
if (vv) {
  vv.addEventListener('resize', () => scheduleFit(true));
  vv.addEventListener('scroll', () => scheduleFit(false));
}


/* ============================================================
   Быстрые эмодзи
   ============================================================ */

const QUICK = ['❤️', '😘', '🫂', '🥺', '😂', '💭', '🌙', '☕', '👀', '🔥'];
$('quick').innerHTML = QUICK.map((e) => '<button type="button" data-e="' + e + '">' + e + '</button>').join('');
$('quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-e]');
  if (!b) return;
  input.value += b.getAttribute('data-e');
  input.focus();
  autoGrow();
  refreshSendBtn();
});

/* ============================================================
   Отрисовка ленты
   ============================================================ */

const log = $('log');
const input = $('input');

let messages = [];   // то, что пришло из общей базы
let pending = [];    // отправленные, но ещё не подтверждённые
let stick = true;    // прилипать ли к низу
let unseen = 0;

const ONLY_EMOJI = /^(?:[\p{Extended_Pictographic}‍️\u{1f3fb}-\u{1f3ff}]|\s){1,3}$/u;
const GROUP_GAP = 5 * 60 * 1000;   // сообщения ближе 5 минут — одной группой

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  if (d.toDateString() === yest.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

const hhmm = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

function atBottom() {
  return log.scrollHeight - log.scrollTop - log.clientHeight < 90;
}

function toBottom(smooth) {
  log.scrollTo({ top: log.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  stick = true;
  unseen = 0;
  updateJump();
}

/* Что показываем: пришедшее из базы плюс ещё не подтверждённое.
   Отправленное убираем из «висящих», как только оно вернулось из базы. */
function visibleMessages() {
  const arrived = new Set(messages.map((m) => m.by + '\n' + m.text));
  const waiting = pending.filter((p) => !arrived.has(p.by + '\n' + p.text));
  return messages.concat(waiting).sort((x, y) => (x.at || 0) - (y.at || 0)).slice(-300);
}

function paint() {
  const list = visibleMessages();
  const wasAtBottom = stick;

  if (!list.length) {
    log.innerHTML = '<div class="empty-note">Здесь пока пусто.<br />Напишите первое сообщение 💜</div>';
    return;
  }

  log.innerHTML = '';
  let lastDay = null;

  list.forEach((m, i) => {
    const label = dayLabel(m.at || Date.now());
    if (label !== lastDay) {
      lastDay = label;
      const sep = document.createElement('div');
      sep.className = 'day-sep';
      sep.textContent = label;
      log.appendChild(sep);
    }

    const prev = list[i - 1];
    const next = list[i + 1];
    const sameDayAs = (o) => o && dayLabel(o.at || 0) === label;
    const groupStart = !prev || prev.by !== m.by || !sameDayAs(prev) ||
                       (m.at - prev.at) > GROUP_GAP;
    const groupEnd = !next || next.by !== m.by || !sameDayAs(next) ||
                     (next.at - m.at) > GROUP_GAP;

    const mine = m.by === meKey;
    const b = document.createElement('div');
    b.className = 'bubble ' + (mine ? 'mine' : 'theirs') +
                  (groupStart ? ' group-start' : '') +
                  (groupEnd ? ' group-end' : '') +
                  (m.pending ? ' pending' : '') +
                  (ONLY_EMOJI.test(m.text || '') ? ' big-emoji' : '');
    b.textContent = m.text || '';

    // время ставим только у последнего в группе — лента дышит свободнее
    if (groupEnd) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = hhmm(m.at || Date.now());
      if (mine) {
        const tick = document.createElement('span');
        tick.className = 'tick';
        tick.textContent = m.pending ? '🕐' : '✓';
        meta.appendChild(tick);
      }
      b.appendChild(meta);
    }
    log.appendChild(b);
  });

  if (typingVisible) log.appendChild(typingEl);
  if (wasAtBottom) log.scrollTop = log.scrollHeight;
  updateJump();
}

/* ---------- кнопка «вниз» с числом непрочитанных ---------- */

function updateJump() {
  const jump = $('jump');
  const show = !stick;
  jump.classList.toggle('hidden', !show);
  $('jump-n').textContent = unseen > 0 ? unseen : '';
  $('jump-n').style.display = unseen > 0 ? '' : 'none';
}

log.addEventListener('scroll', () => {
  const bottom = atBottom();
  if (bottom && !stick) { stick = true; unseen = 0; }
  else if (!bottom) stick = false;
  updateJump();
});

$('jump').addEventListener('click', () => toBottom(true));

/* ---------- «печатает» ---------- */

const typingEl = document.createElement('div');
typingEl.className = 'typing';
typingEl.innerHTML = '<i></i><i></i><i></i>';
let typingVisible = false;

function setTypingVisible(on) {
  if (on === typingVisible) return;
  typingVisible = on;
  if (on) { log.appendChild(typingEl); if (stick) log.scrollTop = log.scrollHeight; }
  else typingEl.remove();
  $('head-sub').textContent = on ? 'печатает…' : lastSeenText;
  $('head-sub').classList.toggle('online', !on && lastSeenOnline);
}

/* ============================================================
   Отправка
   ============================================================ */

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 128) + 'px';
}

function refreshSendBtn() {
  $('send').classList.toggle('empty', !input.value.trim());
}

// Пока фокус в поле, iOS норовит подскроллить страницу под себя —
// возвращаем её на место и пересчитываем раскладку.
input.addEventListener('focus', () => {
  for (const d of [50, 200, 450, 800]) {
    setTimeout(() => { window.scrollTo(0, 0); scheduleFit(true); }, d);
  }
});
input.addEventListener('blur', () => setTimeout(() => scheduleFit(false), 250));

let typingSentAt = 0;
input.addEventListener('input', () => {
  autoGrow();
  refreshSendBtn();
  const now = Date.now();
  if (now - typingSentAt > 1800) {
    typingSentAt = now;
    cloud.set('typing/' + meKey, { at: now });
  }
});

let tmpN = 0;

async function send() {
  const text = input.value.trim();
  if (!text) return;

  // Сообщение появляется сразу, ещё до ответа сервера — как в мессенджерах.
  const local = { id: 'tmp' + (tmpN++), by: meKey, text, at: Date.now(), pending: true };
  pending.push(local);

  input.value = '';
  autoGrow();
  refreshSendBtn();
  input.focus();          // клавиатуру не роняем

  const btn = $('send');
  btn.classList.remove('launch');
  void btn.offsetWidth;
  btn.classList.add('launch');

  stick = true;
  paint();
  toBottom(true);

  await cloud.push('messages', { by: meKey, text, at: local.at });
  pending = pending.filter((p) => p.id !== local.id);
  cloud.set('typing/' + meKey, { at: 0 });
  paint();
}

$('form').addEventListener('submit', (e) => { e.preventDefault(); send(); });

input.addEventListener('keydown', (e) => {
  // На телефоне Enter — это перенос строки, отправляет только кнопка.
  if (TOUCH) return;
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

$('btn-hug').addEventListener('click', async (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  App.burst(r.left + r.width / 2, r.top + r.height / 2, ['🫂', '💜', '✨']);
  await cloud.push('pings', { by: meKey, kind: 'hug', at: Date.now() });
  App.toast('Обнял 🫂');
});

/* ============================================================
   Общая база
   ============================================================ */

await cloud.ready();
cloud.presence(meKey);

let firstLoad = true;

cloud.watch('messages', (data) => {
  const before = messages.length;
  messages = Object.entries(data || {})
    .map(([id, m]) => ({ id, ...m }))
    .sort((x, y) => (x.at || 0) - (y.at || 0));

  // чужие сообщения, пришедшие пока лента прокручена вверх, копим в счётчик
  if (!firstLoad && !stick) {
    const added = messages.slice(before).filter((m) => m.by !== meKey).length;
    unseen += Math.max(0, added);
  }
  paint();
  if (firstLoad) { toBottom(); firstLoad = false; }
});

let lastSeenText = '—';
let lastSeenOnline = false;

cloud.watch('presence', (data) => {
  const info = (data || {})[App.partnerKey()];
  lastSeenOnline = Boolean(info && info.online);
  if (!info) lastSeenText = 'ещё не заходил сюда';
  else if (info.online) lastSeenText = '● сейчас на сайте';
  else lastSeenText = 'был ' + App.formatWhen(info.at);
  if (!typingVisible) {
    $('head-sub').textContent = lastSeenText;
    $('head-sub').classList.toggle('online', lastSeenOnline);
  }
});

cloud.watch('typing', (data) => {
  const t = (data || {})[App.partnerKey()];
  setTypingVisible(Boolean(t && t.at && (Date.now() - t.at < 5000)));
});
setInterval(() => { if (typingVisible) setTypingVisible(false); }, 5000);

if (!TOUCH) input.focus();
