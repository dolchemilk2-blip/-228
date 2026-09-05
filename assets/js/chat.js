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

const log = $('log');
const input = $('input');

/* ============================================================
   Высота под клавиатуру.

   iOS не ужимает страницу под клавиатуру, а опускает видимую
   область. Поэтому берём у visualViewport и высоту, и смещение —
   иначе окно чата остаётся висеть за краем экрана.
   ============================================================ */

const vv = window.visualViewport;
const root = document.documentElement;
const topbar = document.querySelector('.topbar');

let appH = window.innerHeight;   // высота страницы БЕЗ клавиатуры
let barH = 0;
let keyboardOpen = false;

/* Диагностика: откройте страницу с ?debug в адресе, и сверху появится
   табличка с тем, что браузер сообщает про клавиатуру. Нужна, чтобы
   ловить особенности Safari, которые не воспроизводятся на компьютере. */
const DEBUG = /[?&]debug\b/.test(location.search);
let dbgBox = null;
let dbgEvents = 0;
let dbgWindowStart = 0;
let dbgRate = 0;

function paintDebug(h, top, shift, streaming) {
  if (!dbgBox) {
    dbgBox = document.createElement('div');
    dbgBox.style.cssText =
      'position:fixed;left:6px;top:6px;z-index:200;padding:7px 9px;border-radius:9px;' +
      'background:rgba(0,0,0,.82);color:#8fffc9;font:11px/1.45 ui-monospace,monospace;' +
      'white-space:pre;pointer-events:none;max-width:62vw';
    document.body.appendChild(dbgBox);
  }

  const now = performance.now();
  dbgEvents++;
  if (now - dbgWindowStart > 1000) {
    dbgRate = dbgEvents;
    dbgEvents = 0;
    dbgWindowStart = now;
  }

  dbgBox.textContent =
    'innerH   ' + window.innerHeight + '\n' +
    'vv.h     ' + Math.round(h) + '\n' +
    'vv.top   ' + Math.round(top) + '\n' +
    'scrollY  ' + Math.round(window.scrollY) + '\n' +
    'appH     ' + appH + '\n' +
    'сдвиг    ' + shift + '\n' +
    'событий/с ' + dbgRate + (streaming ? '  (поток)' : '  (одиночное)') +
    '\nклавиатура ' + (keyboardOpen ? 'открыта' : 'закрыта');
}

/* Меряем «спокойные» величины — только когда клавиатуры нет.
   Пока она открыта, эти значения должны оставаться прежними,
   иначе окно начнёт прыгать вслед за пересчётом. */
function measure() {
  appH = window.innerHeight;
  barH = topbar ? Math.round(topbar.getBoundingClientRect().height) : 0;
  root.style.setProperty('--app-h', appH + 'px');
  root.style.setProperty('--bar-h', barH + 'px');
}

/* Клавиатура двигает не высоту, а положение: считаем, на сколько
   поднять окно, чтобы поле ввода встало ровно над ней. */
let curShift = 0;
let lastEventAt = 0;

function updateShift() {
  const h = vv ? vv.height : window.innerHeight;
  const top = vv ? vv.offsetTop : 0;
  const shift = Math.min(0, Math.round(top + h - appH));
  if (shift === curShift) return;

  const now = performance.now();
  const streaming = (now - lastEventAt) < 240;
  lastEventAt = now;

  /* Если события идут потоком — значит браузер сам анимирует клавиатуру,
     и нам надо просто идти за ним кадр в кадр. Плавный переход тут только
     добавил бы отставание. Он нужен в обратном случае: когда прилетело
     одно большое изменение разом. */
  const jump = !streaming && Math.abs(shift - curShift) > 40;
  document.body.classList.toggle('kb-anim', jump);

  curShift = shift;
  root.style.setProperty('--shift', shift + 'px');

  const open = shift < -80;
  if (open !== keyboardOpen) {
    keyboardOpen = open;
    document.body.classList.toggle('kb-open', open);
    // к низу прокручиваем только на смену состояния, а не каждый кадр:
    // трогать прокрутку в каждом кадре — это принудительный пересчёт
    if (stick) requestAnimationFrame(() => toBottom());
  }
  if (DEBUG) paintDebug(h, top, shift, streaming);
}

/* Считаем сдвиг сразу в обработчике, без ожидания кадра: чтение
   visualViewport и запись переменной стиля не требуют пересчёта
   раскладки, зато лишний кадр ожидания — это отставание от клавиатуры
   на два десятка пикселей, которое и видно как рывок. */
const scheduleFit = updateShift;

measure();
updateShift();
if (DEBUG) paintDebug(vv ? vv.height : innerHeight, vv ? vv.offsetTop : 0, curShift, false);

// Пересчитываем «спокойные» величины только при закрытой клавиатуре.
// Отличить одно от другого можно так: пока её нет, видимая высота
// почти совпадает с высотой страницы.
window.addEventListener('resize', () => {
  const h = vv ? vv.height : window.innerHeight;
  if (Math.abs(window.innerHeight - h) < 60) measure();
  scheduleFit();
});

window.addEventListener('orientationchange', () => {
  setTimeout(() => { measure(); scheduleFit(); }, 320);
});

if (vv) {
  vv.addEventListener('resize', scheduleFit);
  vv.addEventListener('scroll', scheduleFit);
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
   Данные ленты
   ============================================================ */

let messages = [];   // пришедшее из общей базы
let pending = [];    // отправленное, но ещё не подтверждённое
let stick = true;
let unseen = 0;

const ONLY_EMOJI = /^(?:[\p{Extended_Pictographic}‍️\u{1f3fb}-\u{1f3ff}]|\s){1,3}$/u;
const GROUP_GAP = 5 * 60 * 1000;

// Свой постоянный номер у каждого сообщения. Нужен, чтобы пузырь,
// нарисованный сразу при отправке, и он же, вернувшийся из базы, —
// были для страницы одним и тем же элементом, а не двумя разными.
const newCid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const keyOf = (m) => m.cid || m.id;

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

function visibleMessages() {
  const arrived = new Set(messages.map(keyOf));
  const waiting = pending.filter((p) => !arrived.has(p.cid));
  return messages.concat(waiting)
    .sort((x, y) => (x.at || 0) - (y.at || 0))
    .slice(-300);
}

/* ============================================================
   Точечная отрисовка.

   Раньше лента стиралась и собиралась заново на каждое изменение —
   поэтому все пузыри переигрывали анимацию появления и всё дёргалось.
   Теперь у каждого сообщения свой элемент, который живёт до конца:
   анимируется только по-настоящему новое.
   ============================================================ */

const nodes = new Map();   // ключ сообщения -> элемент

function makeQuote(reply) {
  const q = document.createElement('div');
  q.className = 'quote';
  q.dataset.to = reply.key || '';
  const who = document.createElement('span');
  who.className = 'q-who';
  who.textContent = reply.who === meKey ? 'Вы' : App.person(reply.who).name;
  const txt = document.createElement('span');
  txt.className = 'q-text';
  txt.textContent = reply.text || '';
  q.append(who, txt);
  return q;
}

function makeBubble(m) {
  const el = document.createElement('div');
  el.className = 'bubble';
  el.dataset.key = keyOf(m);

  if (m.replyTo) el.appendChild(makeQuote(m.replyTo));

  const body = document.createElement('span');
  body.className = 'body';
  body.textContent = m.text || '';
  el.appendChild(body);

  const arrow = document.createElement('span');
  arrow.className = 'swipe-arrow';
  arrow.textContent = '↩';
  el.appendChild(arrow);

  if (!TOUCH) {
    const rb = document.createElement('button');
    rb.className = 'reply-btn';
    rb.type = 'button';
    rb.title = 'Ответить';
    rb.textContent = '↩';
    el.appendChild(rb);
  }
  return el;
}

function decorate(el, m, groupStart, groupEnd) {
  const mine = m.by === meKey;
  const wasPending = el.classList.contains('pending');

  // текст мог измениться — правка приезжает в тот же пузырь
  const body = el.querySelector('.body');
  if (body && body.textContent !== (m.text || '')) {
    body.textContent = m.text || '';
    el.classList.remove('edited-flash');
    void el.offsetWidth;
    el.classList.add('edited-flash');
  }
  el.dataset.id = m.id || '';
  el.dataset.mine = mine ? '1' : '';

  el.classList.toggle('mine', mine);
  el.classList.toggle('theirs', !mine);
  el.classList.toggle('group-start', groupStart);
  el.classList.toggle('group-end', groupEnd);
  el.classList.toggle('pending', Boolean(m.pending));
  el.classList.toggle('big-emoji', ONLY_EMOJI.test(m.text || '') && !m.replyTo);

  let meta = el.querySelector('.meta');
  if (groupEnd) {
    if (!meta) {
      meta = document.createElement('span');
      meta.className = 'meta';
      el.appendChild(meta);
    }
    let mark = meta.querySelector('.edited');
    if (m.editedAt) {
      if (!mark) { mark = document.createElement('span'); mark.className = 'edited'; mark.textContent = 'изм.'; meta.prepend(mark); }
    } else if (mark) mark.remove();

    const time = hhmm(m.at || Date.now());
    let timeEl = meta.querySelector('.time');
    if (!timeEl) { timeEl = document.createElement('span'); timeEl.className = 'time'; meta.appendChild(timeEl); }
    if (timeEl.textContent !== time) timeEl.textContent = time;

    if (mine) {
      let tick = meta.querySelector('.tick');
      if (!tick) { tick = document.createElement('span'); tick.className = 'tick'; meta.appendChild(tick); }
      const want = m.pending ? '🕐' : '✓';
      if (tick.textContent !== want) {
        tick.textContent = want;
        // часики превращаются в галочку с хлопком, а не подменяются молча
        if (wasPending && !m.pending) {
          tick.classList.remove('pop');
          void tick.offsetWidth;
          tick.classList.add('pop');
        }
      }
    } else {
      const tick = meta.querySelector('.tick');
      if (tick) tick.remove();
    }
  } else if (meta) {
    meta.remove();
  }
}

function render() {
  const list = visibleMessages();

  const empty = log.querySelector('.empty-note');
  if (!list.length) {
    nodes.forEach((el) => el.remove());
    nodes.clear();
    if (!empty) log.innerHTML = '<div class="empty-note">Здесь пока пусто.<br />Напишите первое сообщение 💜</div>';
    return;
  }
  if (empty) empty.remove();

  // из чего должна состоять лента
  const seq = [];
  let lastDay = null;
  list.forEach((m, i) => {
    const label = dayLabel(m.at || Date.now());
    if (label !== lastDay) { lastDay = label; seq.push({ day: label, key: 'day:' + label }); }

    const prev = list[i - 1];
    const next = list[i + 1];
    const sameDay = (o) => o && dayLabel(o.at || 0) === label;
    seq.push({
      m, key: keyOf(m),
      start: !prev || prev.by !== m.by || !sameDay(prev) || (m.at - prev.at) > GROUP_GAP,
      end:   !next || next.by !== m.by || !sameDay(next) || (next.at - m.at) > GROUP_GAP
    });
  });

  // убираем то, чего больше нет
  const wanted = new Set(seq.map((s) => s.key));
  nodes.forEach((el, k) => {
    if (!wanted.has(k)) { el.remove(); nodes.delete(k); }
  });

  // расставляем по порядку, создавая только недостающее
  let prevEl = null;
  seq.forEach((s) => {
    let el = nodes.get(s.key);
    const fresh = !el;

    if (!el) {
      if (s.day) {
        el = document.createElement('div');
        el.className = 'day-sep';
        el.textContent = s.day;
      } else {
        el = makeBubble(s.m);
      }
      nodes.set(s.key, el);
    }
    if (s.m) decorate(el, s.m, s.start, s.end);

    const shouldFollow = prevEl ? prevEl.nextSibling : log.firstChild;
    if (shouldFollow !== el) log.insertBefore(el, shouldFollow);

    if (fresh && s.m) {
      el.classList.add('enter');
      el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
    }
    prevEl = el;
  });

  if (typingVisible) log.appendChild(typingEl);
  if (stick) log.scrollTop = log.scrollHeight;
  updateJump();
}

/* ---------- кнопка «вниз» ---------- */

function updateJump() {
  const jump = $('jump');
  jump.classList.toggle('hidden', stick);
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
   Ответ на сообщение
   ============================================================ */

let replyTo = null;   // { key, who, text }

function startReply(key) {
  const m = visibleMessages().find((x) => keyOf(x) === key);
  if (!m) return;
  cancelEdit(true);
  replyTo = { key, who: m.by, text: (m.text || '').slice(0, 140) };
  $('rb-who').textContent = m.by === meKey ? 'Ваше сообщение' : App.person(m.by).name;
  $('rb-text').textContent = replyTo.text;
  $('reply-bar').classList.add('show');
  input.focus();
}

function cancelReply() {
  replyTo = null;
  if (!editing) $('reply-bar').classList.remove('show', 'editing');
}

$('rb-close').addEventListener('click', () => {
  if (editing) cancelEdit(true);
  else cancelReply();
});

function jumpTo(key) {
  const el = nodes.get(key);
  if (!el) { App.toast('Это сообщение уже далеко вверху'); return; }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
}

log.addEventListener('click', (e) => {
  const q = e.target.closest('.quote');
  if (q) { jumpTo(q.dataset.to); return; }
  const rb = e.target.closest('.reply-btn');
  if (rb) startReply(rb.closest('.bubble').dataset.key);
});

/* ============================================================
   Меню сообщения: долгое нажатие на телефоне, правый клик на мыши
   ============================================================ */

let menuEls = null;

function closeMenu() {
  if (!menuEls) return;
  const { veil, menu, bubble } = menuEls;
  menuEls = null;
  bubble.classList.remove('menu-open');
  menu.style.transition = 'opacity .14s, transform .14s';
  menu.style.opacity = '0';
  menu.style.transform = 'scale(.92)';
  veil.style.opacity = '0';
  setTimeout(() => { veil.remove(); menu.remove(); }, 150);
}

function openMenu(bubble, x, y) {
  closeMenu();

  const key = bubble.dataset.key;
  const m = visibleMessages().find((v) => keyOf(v) === key);
  if (!m) return;

  const mine = m.by === meKey;
  const saved = Boolean(m.id) && !m.pending;   // править и удалять можно только записанное

  const veil = document.createElement('div');
  veil.className = 'menu-veil';

  const menu = document.createElement('div');
  menu.className = 'msg-menu';
  menu.innerHTML =
    '<button data-do="reply"><span class="ic">↩</span>Ответить</button>' +
    (mine && saved ? '<button data-do="edit"><span class="ic">✏️</span>Изменить</button>' : '') +
    '<button data-do="copy"><span class="ic">📋</span>Копировать</button>' +
    (mine && saved ? '<hr /><button class="danger" data-do="delete"><span class="ic">🗑</span>Удалить</button>' : '');

  document.body.append(veil, menu);
  bubble.classList.add('menu-open');
  menuEls = { veil, menu, bubble };

  // держим меню в пределах экрана
  const r = menu.getBoundingClientRect();
  const pad = 10;
  // clientY отсчитывается от видимой области, а position:fixed — от страницы;
  // на iOS при поднятой клавиатуре это разные системы координат
  const off = vv ? vv.offsetTop : 0;
  const top0 = off + pad;
  const bottom0 = off + (vv ? vv.height : innerHeight) - pad;
  menu.style.left = Math.round(Math.min(Math.max(pad, x - r.width / 2), innerWidth - r.width - pad)) + 'px';
  menu.style.top = Math.round(Math.min(Math.max(top0, y + off - r.height - 12), bottom0 - r.height)) + 'px';

  veil.addEventListener('pointerdown', closeMenu);

  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-do]');
    if (!btn) return;
    const act = btn.getAttribute('data-do');

    if (act === 'delete') {
      // подтверждение прямо в меню, без системного окна
      if (!btn.classList.contains('armed')) {
        btn.classList.add('armed');
        btn.lastChild.textContent = 'Точно удалить?';
        return;
      }
      closeMenu();
      cloud.remove('messages/' + m.id);
      App.toast('Удалено');
      return;
    }

    closeMenu();
    if (act === 'reply') startReply(key);
    else if (act === 'edit') startEdit(m);
    else if (act === 'copy') {
      navigator.clipboard?.writeText(m.text || '')
        .then(() => App.toast('Скопировано'))
        .catch(() => App.toast('Не вышло скопировать'));
    }
  });
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
log.addEventListener('scroll', closeMenu);

// правый клик на компьютере
log.addEventListener('contextmenu', (e) => {
  const b = e.target.closest('.bubble');
  if (!b) return;
  e.preventDefault();
  openMenu(b, e.clientX, e.clientY);
});

/* ============================================================
   Правка своего сообщения
   ============================================================ */

let editing = null;   // { id, key, original }

function startEdit(m) {
  cancelReply();
  editing = { id: m.id, key: keyOf(m), original: m.text || '' };
  input.value = m.text || '';
  autoGrow();
  refreshSendBtn();
  $('rb-who').textContent = 'Изменить сообщение';
  $('rb-text').textContent = m.text || '';
  $('reply-bar').classList.add('show', 'editing');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function cancelEdit(clearField) {
  if (!editing) return;
  editing = null;
  if (clearField) { input.value = ''; autoGrow(); refreshSendBtn(); }
  $('reply-bar').classList.remove('show', 'editing');
}

/* ---------- свайп вправо = ответить ---------- */

let swipe = null;
const SWIPE_TRIGGER = 52;

let pressTimer = null;

function clearPress() { clearTimeout(pressTimer); pressTimer = null; }

log.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;        // на мыши есть кнопка и правый клик
  const b = e.target.closest('.bubble');
  if (!b) return;
  swipe = { el: b, x: e.clientX, y: e.clientY, id: e.pointerId, on: false, d: 0 };
  b.classList.add('press');

  // подержать палец — откроется меню; любое заметное движение это отменит
  clearPress();
  pressTimer = setTimeout(() => {
    pressTimer = null;
    swipe = null;
    if (navigator.vibrate) navigator.vibrate(14);
    b.classList.remove('press');
    openMenu(b, e.clientX, e.clientY);
  }, 460);
});

log.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x;
  const dy = e.clientY - swipe.y;

  if (pressTimer && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
    clearPress();
    swipe.el.classList.remove('press');
  }

  if (!swipe.on) {
    if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { swipe = null; return; }  // это прокрутка
    if (dx < 14) return;
    swipe.on = true;
    // анимация появления перебила бы наш сдвиг: в каскаде она сильнее inline-стиля
    swipe.el.classList.remove('enter', 'press');
    swipe.el.classList.add('swiping');
  }
  // сопротивление: чем дальше тянешь, тем туже
  swipe.d = Math.min(72, Math.max(0, dx - 14) * 0.75);
  swipe.el.style.transform = 'translateX(' + swipe.d.toFixed(1) + 'px)';
  swipe.el.style.setProperty('--sw', Math.min(1, swipe.d / SWIPE_TRIGGER).toFixed(2));
});

function endSwipe() {
  clearPress();
  log.querySelectorAll('.bubble.press').forEach((el) => el.classList.remove('press'));
  if (!swipe) return;
  const { el, d, on } = swipe;
  swipe = null;
  if (!on) return;

  el.classList.remove('swiping');
  el.classList.add('releasing');
  el.style.transform = '';
  el.style.setProperty('--sw', '0');
  setTimeout(() => el.classList.remove('releasing'), 360);

  if (d >= SWIPE_TRIGGER) {
    if (navigator.vibrate) navigator.vibrate(12);
    startReply(el.dataset.key);
  }
}

log.addEventListener('pointerup', endSwipe);
log.addEventListener('pointercancel', endSwipe);

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

/* Раньше здесь страница четыре раза принудительно возвращалась наверх
   (window.scrollTo) — прямо поверх того, как Safari анимирует клавиатуру.
   Именно эта борьба и давала рывки. Страница и так закреплена
   (overflow: hidden), прокручивать нечего, так что просто дожидаемся
   событий от браузера и один раз проверяемся, когда всё улеглось. */
input.addEventListener('focus', () => setTimeout(scheduleFit, 350));
input.addEventListener('blur', () => setTimeout(scheduleFit, 350));

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

async function send() {
  const text = input.value.trim();

  // режим правки: не создаём новое сообщение, а меняем существующее
  if (editing) {
    const { id, original } = editing;
    cancelEdit(true);
    if (!text) { App.toast('Пустое сообщение лучше удалить'); return; }
    if (text === original) return;
    await cloud.update('messages/' + id, { text, editedAt: Date.now() });
    App.toast('Изменено');
    return;
  }

  if (!text) return;

  const cid = newCid();
  const local = { cid, by: meKey, text, at: Date.now(), pending: true };
  if (replyTo) local.replyTo = replyTo;
  pending.push(local);

  const payload = { by: meKey, text, cid };
  if (replyTo) payload.replyTo = replyTo;

  input.value = '';
  autoGrow();
  refreshSendBtn();
  input.focus();
  cancelReply();

  const btn = $('send');
  btn.classList.remove('launch');
  void btn.offsetWidth;
  btn.classList.add('launch');

  stick = true;
  render();
  toBottom(true);

  await cloud.push('messages', payload);
  pending = pending.filter((p) => p.cid !== cid);
  cloud.set('typing/' + meKey, { at: 0 });
  render();
}

$('form').addEventListener('submit', (e) => { e.preventDefault(); send(); });

input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (editing) { cancelEdit(true); return; }
    if (replyTo) { cancelReply(); return; }
  }
  if (TOUCH) return;                              // на телефоне Enter — перенос строки
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

  if (!firstLoad && !stick) {
    const added = messages.slice(before).filter((m) => m.by !== meKey).length;
    unseen += Math.max(0, added);
  }
  render();
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
