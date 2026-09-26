/* Главная: талон до встречи, два города, настроение, вопрос дня, обнимашки */

import { cloud, renderCloudBadge, trackUnread } from './cloud.js';

const CFG = window.SITE_CONFIG;
const $ = (id) => document.getElementById(id);
const PAGE_LOADED = Date.now();

App.init();
renderCloudBadge();

const meKey = App.getMe() || 'a';
const otherKey = App.partnerKey();
const ME = App.person(meKey);
const OTHER = App.person(otherKey);
const A = App.person('a');
const B = App.person('b');
const esc = App.escapeHtml;
const icon = App.icon;

document.addEventListener('me-changed', () => location.reload());

/* ============================================================
   Приветствие и «сколько мы вместе»
   ============================================================ */

function greeting() {
  const h = App.hourIn(ME.timeZone);
  const part = h >= 5 && h < 12 ? 'Доброе утро' : h >= 12 && h < 18 ? 'Добрый день' : h >= 18 && h < 23 ? 'Добрый вечер' : 'Доброй ночи';
  $('greet').textContent = part + ', ' + ME.name;
}
greeting();

(function together() {
  const start = CFG.startDate ? new Date(CFG.startDate + 'T00:00:00') : null;
  if (!start || isNaN(start)) { $('together').textContent = A.city + ' ⇄ ' + B.city; return; }
  const now = new Date();
  const days = Math.max(0, App.daysBetween(start, now));
  const since = start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

  // месяцы — в «нашу дату», каждое 9-е число
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (now.getDate() === start.getDate() && months > 0) {
    const word = months % 12 === 0
      ? (months / 12) + ' ' + App.plural(months / 12, 'год', 'года', 'лет')
      : months + ' ' + App.plural(months, 'месяц', 'месяца', 'месяцев');
    $('together').textContent = 'Сегодня ' + word + ' вместе. С праздником!';
    setTimeout(() => App.rainHearts(2), 900);
    return;
  }
  $('together').textContent = 'Вместе ' + days.toLocaleString('ru-RU') + ' ' +
    App.plural(days, 'день', 'дня', 'дней') + ' — с ' + since;
})();

/* ============================================================
   Посадочный талон: самолётик стоит там, где мы сейчас на пути
   ============================================================ */

const traveler = CFG.traveler === 'b' ? 'b' : 'a';
const FROM = App.person(traveler);
const TO = App.person(traveler === 'a' ? 'b' : 'a');
const meetAt = CFG.meetingDate ? new Date(CFG.meetingDate) : null;
const startAt = CFG.startDate ? new Date(CFG.startDate + 'T00:00:00') : null;

$('pass-from').textContent = FROM.airport || FROM.city.slice(0, 3).toUpperCase();
$('pass-to').textContent = TO.airport || TO.city.slice(0, 3).toUpperCase();
$('pass-from').style.color = 'var(--' + (traveler === 'a' ? 'dima' : 'ragim') + ')';
$('pass-to').style.color = 'var(--' + (traveler === 'a' ? 'ragim' : 'dima') + ')';
$('pass-from-city').textContent = FROM.city;
$('pass-to-city').textContent = TO.city;
$('pass-who').textContent = FROM.name;
$('pass-seat').textContent = meKey === traveler ? 'рядом с ' + (TO.name === 'Рагим' ? 'Рагимом' : TO.name) : 'рядом с тобой';

if (meetAt && !isNaN(meetAt)) {
  $('pass-date').textContent = meetAt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const dd = String(meetAt.getDate()).padStart(2, '0') + String(meetAt.getMonth() + 1).padStart(2, '0');
  $('pass-flight').textContent = 'рейс ' + A.name.charAt(0) + B.name.charAt(0) + ' ' + dd;
}

const pass = $('pass');
const plane = $('pass-plane');
const path = $('pass-path');

function layoutPass() {
  const main = pass.querySelector('.pass-main');
  pass.style.setProperty('--tear', main.offsetHeight + 'px');
  pass.style.setProperty('--track', path.clientWidth + 'px');
}

function progress() {
  if (!meetAt || !startAt || isNaN(meetAt) || isNaN(startAt)) return 0;
  const p = (Date.now() - startAt) / (meetAt - startAt);
  return Math.max(0, Math.min(1, p));
}

const two = (n) => String(n).padStart(2, '0');

function renderCountdown() {
  if (!meetAt || isNaN(meetAt)) {
    $('cd-days').textContent = '?';
    $('cd-unit').textContent = 'дата встречи ещё не назначена';
    return;
  }
  let left = meetAt - Date.now();
  if (left <= 0) {
    pass.classList.add('done');
    $('cd-days').textContent = 'Вместе';
    $('cd-unit').textContent = 'мы встретились';
    $('cd-clock').textContent = '';
    return;
  }
  const days = Math.floor(left / 86400000);
  left -= days * 86400000;
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  $('cd-days').textContent = days.toLocaleString('ru-RU');
  $('cd-unit').innerHTML = esc(App.plural(days, 'день', 'дня', 'дней')) + '<br>' + esc(CFG.meetingLabel || 'до встречи');
  $('cd-clock').textContent = 'и ещё ' + two(h) + ':' + two(m) + ':' + two(s) + ' · ' +
    Math.round(progress() * 100) + '% пути позади';
}

layoutPass();
renderCountdown();
// самолётик выезжает с начала маршрута на сегодняшнее место — один раз, при входе
requestAnimationFrame(() => requestAnimationFrame(() => plane.style.setProperty('--p', progress().toFixed(4))));
window.addEventListener('resize', layoutPass);

/* ============================================================
   Два города: время, небо, погода
   ============================================================ */

const WEATHER = {
  0: ['ясно', 'sun'], 1: ['почти ясно', 'partly'], 2: ['переменная облачность', 'partly'], 3: ['пасмурно', 'cloud'],
  45: ['туман', 'fog'], 48: ['туман', 'fog'],
  51: ['морось', 'rain'], 53: ['морось', 'rain'], 55: ['морось', 'rain'], 56: ['ледяная морось', 'rain'], 57: ['ледяная морось', 'rain'],
  61: ['дождь', 'rain'], 63: ['дождь', 'rain'], 65: ['сильный дождь', 'rain'], 66: ['ледяной дождь', 'rain'], 67: ['ледяной дождь', 'rain'],
  71: ['снег', 'snow'], 73: ['снег', 'snow'], 75: ['сильный снег', 'snow'], 77: ['снежная крупа', 'snow'],
  80: ['ливень', 'rain'], 81: ['ливень', 'rain'], 82: ['сильный ливень', 'rain'], 85: ['снегопад', 'snow'], 86: ['снегопад', 'snow'],
  95: ['гроза', 'storm'], 96: ['гроза с градом', 'storm'], 99: ['гроза с градом', 'storm']
};

let weather = { a: null, b: null };

function minutesOf(isoLocal) {
  // «2026-09-26T06:58» — время уже местное для города
  const t = String(isoLocal || '').split('T')[1];
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function nowMinutesIn(tz) {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz })
      .formatToParts(new Date()).reduce((acc, x) => { acc[x.type] = x.value; return acc; }, {});
    return (+p.hour % 24) * 60 + (+p.minute);
  } catch (e) { return new Date().getHours() * 60; }
}

function skyOf(key) {
  const P = App.person(key);
  const now = nowMinutesIn(P.timeZone);
  const w = weather[key];
  const rise = w ? minutesOf(w.sunrise) : 6 * 60 + 30;
  const set = w ? minutesOf(w.sunset) : 19 * 60;
  if (now < rise - 30 || now > set + 50) return 'night';
  if (Math.abs(now - rise) <= 50 || Math.abs(now - set) <= 50) return 'dusk';
  return 'day';
}

function hhmmFromMinutes(min) {
  return two(Math.floor(min / 60)) + ':' + two(min % 60);
}

function renderCity(key) {
  const P = App.person(key);
  const box = $('city-' + key);
  const f = (name) => box.querySelector('[data-f="' + name + '"]');
  const sky = skyOf(key);
  box.classList.toggle('night', sky === 'night');
  box.classList.toggle('dusk', sky === 'dusk');

  f('city').textContent = P.city;
  f('time').textContent = App.clockIn(P.timeZone);

  const w = weather[key];
  if (w) {
    const [label, ico] = WEATHER[w.code] || ['', 'cloud'];
    const night = sky === 'night';
    const shown = (ico === 'sun' && night) ? 'moon' : (ico === 'partly' && night) ? 'cloud' : ico;
    f('sky').innerHTML = icon(shown) + '<span>' + Math.round(w.temp) + '°</span>';
    f('sky').setAttribute('aria-label', label + ', ' + Math.round(w.temp) + ' градусов');
    f('sky').title = label;

    const now = nowMinutesIn(P.timeZone);
    const rise = minutesOf(w.sunrise), set = minutesOf(w.sunset);
    let next = '';
    if (rise != null && set != null) {
      next = now < rise ? 'рассвет ' + hhmmFromMinutes(rise)
           : now < set ? 'закат ' + hhmmFromMinutes(set)
           : 'рассвет ' + hhmmFromMinutes(rise);
    }
    f('meta').textContent = label + (next ? ' · ' + next : '');
  } else {
    f('meta').textContent = App.dateIn(P.timeZone);
  }

  f('who').innerHTML = App.avatar(key, 'sm') + '<span>' + esc(P.name) + (key === meKey ? ' · вы' : '') + '</span>';
}

function renderCallHint() {
  const h = App.hourIn(OTHER.timeZone);
  const t = App.clockIn(OTHER.timeZone);
  const n = OTHER.name;
  let text;
  if (h < 7) text = 'У ' + genitive(n) + ' ночь, ' + t + ' — наверное, спит. Лучше оставить сообщение до утра.';
  else if (h < 10) text = 'У ' + genitive(n) + ' утро — самое время пожелать хорошего дня.';
  else if (h < 18) text = 'У ' + genitive(n) + ' день — может быть занят, но сообщение точно порадует.';
  else if (h < 23) text = 'У ' + genitive(n) + ' вечер, ' + t + ' — хорошее время созвониться.';
  else text = 'У ' + genitive(n) + ' поздно, ' + t + ' — самое время пожелать спокойной ночи.';

  const diff = App.tzOffsetHours(ME.timeZone, OTHER.timeZone);
  if (diff) {
    const abs = Math.abs(diff);
    text += ' Разница — ' + abs + ' ' + App.plural(abs, 'час', 'часа', 'часов') + ', у ' + genitive(n) +
      (diff < 0 ? ' раньше.' : ' позже.');
  }
  $('call-hint').textContent = text;
}

// «у Рагима», «у Димы» — родительный падеж для двух имён сайта
function genitive(name) {
  if (/а$/.test(name)) return name.slice(0, -1) + 'ы';
  if (/я$/.test(name)) return name.slice(0, -1) + 'и';
  if (/й$/.test(name)) return name.slice(0, -1) + 'я';
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(name)) return name + 'а';
  return name;
}

function renderCities() {
  renderCity(meKey);
  renderCity(otherKey);
  renderCallHint();
}

// на телефоне своя карточка слева
if (meKey === 'b') $('city-b').parentNode.insertBefore($('city-b'), $('city-a'));

renderCities();
setInterval(() => { renderCountdown(); }, 1000);
setInterval(() => { renderCities(); greeting(); }, 20000);

const W_KEY = 'oursite:weather';

async function loadWeather() {
  try {
    const cached = JSON.parse(localStorage.getItem(W_KEY) || 'null');
    if (cached && Date.now() - cached.at < 20 * 60 * 1000) { weather = cached.data; renderCities(); return; }
  } catch (e) {}

  if (A.lat == null || B.lat == null) return;
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + A.lat + ',' + B.lat +
    '&longitude=' + A.lon + ',' + B.lon +
    '&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=auto&forecast_days=1';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const list = await res.json();
    const pick = (x) => x && x.current ? {
      temp: x.current.temperature_2m, code: x.current.weather_code,
      sunrise: x.daily && x.daily.sunrise && x.daily.sunrise[0],
      sunset: x.daily && x.daily.sunset && x.daily.sunset[0]
    } : null;
    weather = { a: pick(list[0]), b: pick(list[1]) };
    try { localStorage.setItem(W_KEY, JSON.stringify({ at: Date.now(), data: weather })); } catch (e) {}
    renderCities();
  } catch (e) {
    // нет сети или сервис недоступен — просто без погоды
  }
}
loadWeather();

/* расстояние по прямой — для строчки внизу */
function distanceKm(p, q) {
  if (p.lat == null || q.lat == null) return 0;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (q.lat - p.lat) * rad, dLon = (q.lon - p.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * rad) * Math.cos(q.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
const km = distanceKm(A, B);
$('stats').textContent = A.city + ' ⇄ ' + B.city + (km ? ' · ' + km.toLocaleString('ru-RU') + ' км по прямой' : '');

/* ============================================================
   Прямо сейчас: второй на сайте? настроения
   ============================================================ */

$('partner-ava').innerHTML = App.avatar(otherKey, 'lg');
$('partner-name').textContent = OTHER.name;
$('switch-me-sub').textContent = ME.name + ' · сменить';
$('switch-me').addEventListener('click', () => App.askWhoAmI(true));

let myMood = '';

const MOOD_CHIPS = ['скучаю', 'думаю о тебе', 'всё хорошо', 'счастлив', 'устал', 'занят', 'хочу спать', 'грущу', 'жду встречи'];

function openMoodSheet() {
  const s = App.sheet({
    title: 'Моё настроение',
    body:
      '<p class="muted">Пару слов — ' + esc(OTHER.name) + ' увидит на главной.</p>' +
      '<div class="chips" style="margin-top:14px">' +
        MOOD_CHIPS.map((c) => '<button class="chip" type="button" aria-pressed="false">' + esc(c) + '</button>').join('') +
      '</div>' +
      '<div class="field" style="margin-top:16px">' +
        '<label for="mood-input">Или своими словами</label>' +
        '<input type="text" id="mood-input" maxlength="90" enterkeyhint="done" placeholder="устал, но думаю о тебе…" />' +
      '</div>',
    foot:
      '<button class="btn gray" type="button" data-close>Отмена</button>' +
      '<button class="btn" type="button" id="mood-save">Сохранить</button>'
  });
  const field = s.$('#mood-input');
  field.value = myMood;

  s.body.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    s.body.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    field.value = chip.textContent;
  });

  const save = async () => {
    const text = field.value.trim();
    if (!text) { App.toast('Напишите пару слов'); return; }
    s.close();
    await cloud.set('mood/' + meKey, { text, at: Date.now() });
    App.toast('Сохранено — ' + OTHER.name + ' увидит');
  };
  s.$('#mood-save').addEventListener('click', save);
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

$('my-mood').addEventListener('click', openMoodSheet);

/* ============================================================
   Вопрос дня: у обоих один и тот же. Ответ второго открывается,
   только когда ответил сам — так интереснее и честнее.
   ============================================================ */

const QUESTIONS = CFG.questions || [];
// день считаем по тому, у кого полночь наступает позже — чтобы
// вопрос ни у кого не сменился раньше его собственной полуночи
const DAY_TZ = App.tzOffsetHours(A.timeZone, B.timeZone) < 0 ? B.timeZone : A.timeZone;
const today = App.dayKey(DAY_TZ);

function questionFor(key) {
  if (!QUESTIONS.length) return 'Добавьте вопросы в config.js';
  const n = Math.floor(Date.parse(key + 'T00:00:00Z') / 86400000);
  return QUESTIONS[((n * 37) % QUESTIONS.length + QUESTIONS.length) % QUESTIONS.length];
}

$('qday-q').textContent = questionFor(today);

let daily = {};
let wasHidden = null;

// заглушка вместо чужого ответа: размыта, а настоящий текст не попадает на страницу
function placeholder(len) {
  const base = 'мне кажется это было бы очень мило и немного смешно потому что ';
  let s = '';
  while (s.length < Math.min(Math.max(len, 18), 160)) s += base;
  return s.slice(0, Math.min(Math.max(len, 18), 160));
}

function answerRow(key, a, visible) {
  const P = App.person(key);
  let inner;
  if (!a) {
    inner = '<div class="bubble wait">' + (key === meKey ? 'вы ещё не ответили' : esc(P.name) + ' ещё не ответил') + '</div>';
  } else if (!visible) {
    inner = '<div class="bubble hidden-answer" aria-hidden="true">' + esc(placeholder((a.text || '').length)) + '</div>' +
      '<div class="lock-note">' + icon('lock') + 'Ответьте — и увидите, что написал ' + esc(P.name) + '</div>';
  } else {
    inner = '<div class="bubble" data-key="' + key + '">' + esc(a.text || '') + '</div>';
  }
  return '<div class="answer">' + App.avatar(key, 'sm') + '<div class="answer-body">' + inner + '</div></div>';
}

function renderDaily() {
  const day = daily[today] || {};
  const mine = day[meKey];
  const theirs = day[otherKey];
  const theirsHidden = Boolean(theirs && !mine);

  $('qday-answers').innerHTML = answerRow(otherKey, theirs, !theirsHidden) + answerRow(meKey, mine, true);

  // момент, когда оба ответили: чужой ответ проявляется из размытия
  if (wasHidden === true && !theirsHidden && theirs) {
    const el = $('qday-answers').querySelector('.bubble[data-key="' + otherKey + '"]');
    if (el) {
      el.classList.add('revealing');
      const r = el.getBoundingClientRect();
      App.burst(r.left + r.width / 2, r.top + r.height / 2, ['💜', '💙', '✨'], 10);
    }
  }
  wasHidden = theirsHidden;

  const btn = $('qday-btn');
  btn.textContent = mine ? 'Изменить ответ' : 'Ответить';
  btn.classList.toggle('gray', Boolean(mine));
}

function openAnswerSheet() {
  const day = daily[today] || {};
  const s = App.sheet({
    title: 'Вопрос дня',
    body:
      '<p class="qday-q" style="font-size:1.15rem">' + esc(questionFor(today)) + '</p>' +
      '<div class="field" style="margin-top:16px">' +
        '<label for="qday-input">Ваш ответ</label>' +
        '<textarea id="qday-input" maxlength="600" style="min-height:110px" placeholder="Честно и как есть…"></textarea>' +
      '</div>',
    foot:
      '<button class="btn gray" type="button" data-close>Отмена</button>' +
      '<button class="btn" type="button" id="qday-save">Сохранить</button>',
    focus: '#qday-input'
  });
  const field = s.$('#qday-input');
  field.value = (day[meKey] && day[meKey].text) || '';

  s.$('#qday-save').addEventListener('click', async () => {
    const text = field.value.trim();
    if (!text) { App.toast('Ответ получился пустым'); return; }
    s.close();
    await cloud.set('daily/' + today + '/' + meKey, { text, at: Date.now() });
    const partnerDone = Boolean((daily[today] || {})[otherKey]);
    App.toast(partnerDone ? 'Готово — смотрите, что ответил ' + OTHER.name : 'Сохранено — ' + OTHER.name + ' увидит, когда ответит сам');
  });
}

$('qday-btn').addEventListener('click', openAnswerSheet);

$('qday-past').addEventListener('click', () => {
  const days = Object.keys(daily).filter((k) => k < today).sort().reverse().slice(0, 30);
  const body = days.length
    ? days.map((k) => {
        const d = daily[k] || {};
        const date = new Date(k + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
        return '<div class="past-day"><div class="d">' + esc(date) + '</div>' +
          '<div class="q">' + esc(questionFor(k)) + '</div>' +
          '<div class="answers" style="margin-top:0">' +
            answerRow('a', d.a, true) + answerRow('b', d.b, true) +
          '</div></div>';
      }).join('')
    : '<p class="muted">Здесь будут вопросы прошлых дней и ваши ответы. Первый появится завтра.</p>';
  App.sheet({ title: 'Прошлые вопросы', body });
});

renderDaily();

/* ============================================================
   Дотянуться: обнимашки и прочее
   ============================================================ */

const PING_TEXT = {
  hug:   ['обнимает тебя', '🫂'],
  kiss:  ['целует тебя', '😘'],
  think: ['думает о тебе', '💭'],
  miss:  ['скучает по тебе', '🥺'],
  night: ['желает спокойной ночи', '🌙'],
  love:  ['любит тебя', '❤️']
};

document.querySelectorAll('[data-ping]').forEach((btn) => {
  let timer = null;
  btn.addEventListener('click', async () => {
    const kind = btn.getAttribute('data-ping');
    const emoji = btn.getAttribute('data-emoji');
    const e = btn.querySelector('.ping-e').getBoundingClientRect();
    App.burst(e.left + e.width / 2, e.top + e.height / 2, [emoji, '✨'], 10);
    btn.classList.add('sent');
    clearTimeout(timer);
    timer = setTimeout(() => btn.classList.remove('sent'), 1600);
    await cloud.push('pings', { by: meKey, kind, at: Date.now() });
  });
});

function showPing(kind, at) {
  const [text, emoji] = PING_TEXT[kind] || ['шлёт тебе привет', '💜'];
  const old = $('ping-overlay');
  if (old) old.remove();

  const ov = document.createElement('div');
  ov.id = 'ping-overlay';
  ov.setAttribute('role', 'alert');
  ov.innerHTML =
    '<div class="card">' +
      '<div class="huge" aria-hidden="true">' + emoji + '</div>' +
      '<div class="who">' + esc(OTHER.name) + ' ' + esc(text) + '</div>' +
      '<div class="sub">' + esc(App.formatWhen(at || Date.now())) + ' · нажмите, чтобы закрыть</div>' +
    '</div>';
  const close = () => { ov.classList.remove('in'); setTimeout(() => ov.remove(), 300); };
  ov.addEventListener('click', close);
  document.body.appendChild(ov);
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('in')));
  App.rainHearts(2.5);
  setTimeout(close, 4500);
}

/* ============================================================
   Общая база
   ============================================================ */

await cloud.ready();
cloud.presence(meKey);
trackUnread();

$('room-sub').textContent = cloud.mode === 'cloud'
  ? 'вы оба видите одно и то же в реальном времени'
  : 'пока только на этом телефоне — см. SETUP.md';

cloud.watch('presence', (data) => {
  const info = (data || {})[otherKey];
  const ava = $('partner-ava').querySelector('.ava');
  const el = $('partner-status');
  const online = Boolean(info && info.online);
  if (ava) ava.classList.toggle('is-online', online);
  if (!info) el.textContent = 'ещё ни разу не заходил';
  else if (online) el.innerHTML = '<span style="color:var(--ok);font-weight:600">сейчас на сайте</span>';
  else el.textContent = 'был ' + App.formatWhen(info.at);
});

cloud.watch('mood', (data) => {
  const mine = (data || {})[meKey];
  myMood = (mine && mine.text) || '';
  $('my-mood-text').textContent = myMood ? '«' + myMood + '»' : 'расскажите, как вы';

  const theirs = (data || {})[otherKey];
  const box = $('partner-mood');
  if (theirs && theirs.text) {
    box.classList.remove('empty');
    box.innerHTML = '«' + esc(theirs.text) + '» <span class="faint" style="font-family:var(--font);font-size:var(--t-foot)">' +
      esc(App.formatWhen(theirs.at)) + '</span>';
  } else {
    box.classList.add('empty');
    box.textContent = 'пока ничего не написал о настроении';
  }
});

cloud.watch('daily', (data) => {
  daily = data || {};
  renderDaily();
});

cloud.watchAdded('pings', (id, data) => {
  if (!data || data.by === meKey) return;
  if ((data.at || 0) < PAGE_LOADED - 15000) return;   // старые не проигрываем
  showPing(data.kind, data.at);
});
