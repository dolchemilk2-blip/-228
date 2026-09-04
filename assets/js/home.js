/* Главная страница: счётчики, часы, присутствие, настроение, обнимашки */

import { cloud, renderCloudBadge } from './cloud.js';

const CFG = window.SITE_CONFIG;
const $ = (id) => document.getElementById(id);
const PAGE_LOADED = Date.now();

App.init();
renderCloudBadge();

const A = App.person('a');
const B = App.person('b');

/* ---------------- имена и подводка ---------------- */

$('name-a').textContent = A.name;
$('name-b').textContent = B.name;
$('city-a').textContent = A.city;
$('city-b').textContent = B.city;
$('pres-a-name').textContent = A.name;
$('pres-b-name').textContent = B.name;
$('pres-a-ava').textContent = A.emoji;
$('pres-b-ava').textContent = B.emoji;
$('footer-note').textContent = A.city + ' ⟷ ' + B.city;
$('partner-mood-label').textContent = 'Настроение: ' + App.partner().name;

document.addEventListener('me-changed', () => location.reload());

/* ---------------- сколько мы вместе ---------------- */

function renderTogether() {
  const start = CFG.startDate ? new Date(CFG.startDate + 'T00:00:00') : null;
  if (!start || isNaN(start)) {
    $('stat-together').textContent = '∞';
    $('stat-together-cap').textContent = 'впишите дату в config.js';
    return 0;
  }
  const days = Math.max(0, App.daysBetween(start, new Date()));
  $('stat-together').textContent = days.toLocaleString('ru-RU');
  $('stat-together-cap').textContent = App.plural(days, 'день вместе', 'дня вместе', 'дней вместе');
  return days;
}

const daysTogether = renderTogether();

const lead = $('hero-lead');
if (daysTogether > 0) {
  lead.textContent = 'Мы вместе уже ' + daysTogether + ' ' +
    App.plural(daysTogether, 'день', 'дня', 'дней') +
    '. Между нами километры — и это единственное, что между нами есть.';
}

/* ---------------- обратный отсчёт ---------------- */

const two = (n) => String(n).padStart(2, '0');

function renderCountdown() {
  const big = $('stat-countdown');
  const cap = $('stat-countdown-cap');
  const raw = CFG.meetingDate;

  if (!raw) {
    big.textContent = '?';
    cap.textContent = 'дата встречи ещё не назначена';
    return;
  }
  const target = new Date(raw);
  if (isNaN(target)) { big.textContent = '?'; cap.textContent = 'проверьте формат даты'; return; }

  let left = target - Date.now();
  if (left <= 0) {
    big.textContent = '🎉';
    cap.textContent = 'мы уже встретились';
    return;
  }

  const days = Math.floor(left / 86400000);
  left -= days * 86400000;
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);

  big.textContent = days.toLocaleString('ru-RU');
  cap.textContent = App.plural(days, 'день', 'дня', 'дней') + ' ' + (CFG.meetingLabel || 'до встречи') +
                    ' · ' + two(h) + ':' + two(m) + ':' + two(s);
}

/* ---------------- часы ---------------- */

function renderClocks() {
  $('clock-a').textContent = App.clockIn(A.timeZone);
  $('clock-b').textContent = App.clockIn(B.timeZone);
  $('day-a').textContent = App.dateIn(A.timeZone);
  $('day-b').textContent = App.dateIn(B.timeZone);

  const diff = App.tzOffsetHours(A.timeZone, B.timeZone);
  const el = $('tz-diff');
  if (diff === 0) {
    el.innerHTML = 'одно<br>время';
  } else {
    const abs = Math.abs(diff);
    const word = App.plural(abs, 'час', 'часа', 'часов');
    // имя в именительном падеже — так фраза остаётся грамотной с любым именем
    el.innerHTML = App.escapeHtml(B.name) + (diff > 0 ? ' впереди' : ' позади') +
                   '<br>на ' + abs + ' ' + word;
  }
}

renderCountdown();
renderClocks();
setInterval(() => { renderCountdown(); renderClocks(); }, 1000);

/* ---------------- облако: присутствие, настроение, эмоции ---------------- */

const meKey = App.getMe() || 'a';
const otherKey = App.partnerKey();

await cloud.ready();
cloud.presence(meKey);

/* -- кто онлайн -- */
cloud.watch('presence', (data) => {
  ['a', 'b'].forEach((key) => {
    const info = data[key];
    const el = $('pres-' + key + '-status');
    if (!info) { el.textContent = 'ещё ни разу не заходил(а)'; return; }
    if (info.online) {
      el.innerHTML = '<span style="color:var(--mint);font-weight:700">● сейчас на сайте</span>';
    } else {
      el.textContent = 'был(а) ' + App.formatWhen(info.at);
    }
  });
});

/* -- настроение -- */
const moodInput = $('mood-input');

cloud.watch('mood', (data) => {
  const mine = data[meKey];
  if (mine && document.activeElement !== moodInput && !moodInput.value) moodInput.value = mine.text || '';

  const theirs = data[otherKey];
  $('partner-mood').innerHTML = theirs && theirs.text
    ? App.escapeHtml(theirs.text) + ' <span class="muted">· ' + App.formatWhen(theirs.at) + '</span>'
    : '<span class="muted">пока тихо…</span>';
});

$('mood-save').addEventListener('click', async () => {
  const text = moodInput.value.trim();
  if (!text) { App.toast('Напишите пару слов 🙂'); return; }
  await cloud.set('mood/' + meKey, { text, at: Date.now() });
  App.toast('Записал — ' + App.partner().name + ' увидит ' + App.partner().emoji);
});
moodInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('mood-save').click(); });

/* -- отправка эмоций -- */
const PING_TEXT = {
  hug:   ['обнимает тебя',      '🫂'],
  kiss:  ['целует тебя',        '😘'],
  think: ['думает о тебе',      '💭'],
  miss:  ['скучает по тебе',    '🥺'],
  night: ['желает спокойной ночи', '🌙'],
  love:  ['любит тебя',         '❤️']
};

document.querySelectorAll('[data-ping]').forEach((btn) => {
  btn.addEventListener('click', async (e) => {
    const kind = btn.getAttribute('data-ping');
    const emoji = btn.getAttribute('data-emoji');
    const r = btn.getBoundingClientRect();
    App.burst(r.left + r.width / 2, r.top + r.height / 2, [emoji, '✨', '💫']);
    await cloud.push('pings', { by: meKey, kind, at: Date.now() });
    App.toast('Отправлено ' + emoji);
  });
});

/* -- получение эмоций -- */
cloud.watchAdded('pings', (id, data) => {
  if (!data) return;
  if (data.by === meKey) return;                 // свои не показываем
  if ((data.at || 0) < PAGE_LOADED - 15000) return; // старые не проигрываем
  showPing(data.kind);
});

function showPing(kind) {
  const [text, emoji] = PING_TEXT[kind] || ['шлёт тебе привет', '💜'];
  const who = App.partner().name;

  const old = $('ping-overlay');
  if (old) old.remove();

  const ov = document.createElement('div');
  ov.id = 'ping-overlay';
  ov.innerHTML = '<div><div class="huge">' + emoji + '</div>' +
                 '<div class="who">' + App.escapeHtml(who) + ' ' + text + '</div></div>';
  ov.addEventListener('click', () => ov.remove());
  document.body.appendChild(ov);

  App.rainHearts(3);
  App.burst(window.innerWidth / 2, window.innerHeight / 2, [emoji, '✨', '💖']);
  setTimeout(() => ov.remove(), 4200);
}

/* -- маленькая статистика -- */
cloud.watch('messages', (d) => { $('stat-messages').textContent = Object.keys(d || {}).length; });
cloud.watch('pings',    (d) => { $('stat-hugs').textContent    = Object.keys(d || {}).length; });
