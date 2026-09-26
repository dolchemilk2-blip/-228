/* Письма и капсулы времени */

import { cloud, trackUnread } from './cloud.js';

const $ = (id) => document.getElementById(id);
const esc = App.escapeHtml;
const icon = App.icon;

App.init();

const meKey = App.getMe() || 'a';
const OTHER = App.partner();
document.addEventListener('me-changed', () => location.reload());

const LS_OPENED = 'oursite:lettersOpened';
let opened = new Set();
try { opened = new Set(JSON.parse(localStorage.getItem(LS_OPENED) || '[]')); } catch (e) {}
function markOpened(id) {
  if (!id || opened.has(id)) return;
  opened.add(id);
  try { localStorage.setItem(LS_OPENED, JSON.stringify([...opened].slice(-300))); } catch (e) {}
}

// «от Рагима», «от Димы»
function fromName(key) {
  if (key === meKey) return 'от вас';
  const n = App.person(key).name;
  if (/а$/.test(n)) return 'от ' + n.slice(0, -1) + 'ы';
  if (/я$/.test(n)) return 'от ' + n.slice(0, -1) + 'и';
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(n)) return 'от ' + n + 'а';
  return 'от ' + n;
}

/* ============================================================
   Кодирование письма в ссылку (без сервера, UTF-8 безопасно)
   ============================================================ */

function encodeCapsule(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCapsule(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ============================================================
   Открытое письмо — разворачивается сверху вниз
   ============================================================ */

function openLetter(letter) {
  const sentAt = letter.at ? new Date(letter.at).toLocaleDateString('ru-RU',
    { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const mine = letter.by === meKey && letter.id;
  const author = letter.by ? App.person(letter.by).name : '';

  const s = App.sheet({
    title: '',
    className: 'letter-sheet',
    body:
      '<article class="paper">' +
        '<div class="p-meta"><span>' + esc(letter.by ? fromName(letter.by) : 'для тебя') + '</span><span>' + esc(sentAt) + '</span></div>' +
        '<h3 class="p-title"></h3>' +
        '<div class="p-body"></div>' +
        (author ? '<div class="p-sign">— ' + esc(author) + '</div>' : '') +
      '</article>',
    foot: mine
      ? '<button class="btn danger" type="button" id="l-del">' + icon('trash') + 'Удалить</button>' +
        '<button class="btn gray" type="button" data-close>Закрыть</button>'
      : '<button class="btn gray" type="button" data-close>Закрыть</button>'
  });
  s.$('.p-title').textContent = letter.title || 'Письмо';
  s.$('.p-body').textContent = letter.body || '';
  s.el.setAttribute('aria-label', 'Письмо: ' + (letter.title || ''));

  if (mine) s.$('#l-del').addEventListener('click', () => { s.close(); removeLetter(letter); });

  markOpened(letter.id);
  if (letter.id) paintShelf();
  if (letter.by && letter.by !== meKey) setTimeout(() => App.rainHearts(2), 400);
}

function removeLetter(letter) {
  const { id, ...data } = letter;
  cloud.remove('letters/' + id);
  App.undoToast('Письмо удалено', () => cloud.set('letters/' + id, data));
}

/* Запечатанное: печать, обратный отсчёт и дата */
function showSealed(letter, openAt) {
  const mine = letter.by === meKey && letter.id;
  const s = App.sheet({
    title: '',
    body:
      '<div class="seal-view">' +
        '<div class="env-seal">' + icon('lock') + '</div>' +
        '<h2 style="font-size:var(--t-title2)">Письмо запечатано</h2>' +
        '<p class="muted" style="margin-top:6px">' + esc(letter.by ? fromName(letter.by) : '') + ' · откроется ' +
          esc(new Date(openAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })) + '</p>' +
        '<div class="count" id="seal-count">—</div>' +
        '<p class="muted" style="margin-top:4px">Даже автор не сможет открыть раньше.</p>' +
      '</div>',
    foot:
      (mine ? '<button class="btn danger" type="button" id="l-del">' + icon('trash') + 'Удалить</button>' : '') +
      '<button class="btn gray" type="button" data-close>Хорошо, подожду</button>',
    onClose: () => clearInterval(iv)
  });

  const tick = () => {
    const left = openAt - Date.now();
    const el = s.$('#seal-count');
    if (!el) return;
    if (left <= 0) { clearInterval(iv); s.close(); setTimeout(() => openLetter(letter), 350); return; }
    const d = Math.floor(left / 86400000);
    const h = Math.floor((left % 86400000) / 3600000);
    const mi = Math.floor((left % 3600000) / 60000);
    const sec = Math.floor((left % 60000) / 1000);
    el.textContent = d > 0
      ? d + ' ' + App.plural(d, 'день', 'дня', 'дней') + ' ' + h + ' ч'
      : String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  };
  const iv = setInterval(tick, 1000);
  tick();
  if (mine) s.$('#l-del').addEventListener('click', () => { s.close(); removeLetter(letter); });
}

/* Письмо, пришедшее ссылкой */
function readFromHash() {
  const m = location.hash.match(/^#c=(.+)$/);
  if (!m) return;
  let letter;
  try { letter = decodeCapsule(m[1]); } catch (e) {
    App.toast('Ссылка повреждена — попросите прислать заново');
    return;
  }
  history.replaceState(null, '', location.pathname + location.search);
  const openAt = letter.openAt ? new Date(letter.openAt).getTime() : 0;
  if (openAt && Date.now() < openAt) { setTimeout(() => showSealed(letter, openAt), 300); return; }
  setTimeout(() => openLetter(letter), 350);
}

readFromHash();

/* ============================================================
   Написать письмо
   ============================================================ */

function localInputValue(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function openComposer() {
  const meet = window.SITE_CONFIG.meetingDate;
  const s = App.sheet({
    title: 'Письмо для ' + (OTHER.name === 'Рагим' ? 'Рагима' : OTHER.name === 'Дима' ? 'Димы' : OTHER.name),
    body:
      '<div class="field">' +
        '<label for="l-title">О чём оно</label>' +
        '<input type="text" id="l-title" maxlength="80" placeholder="Прочитай, когда будет грустно" />' +
      '</div>' +
      '<div class="field" style="margin-top:14px">' +
        '<label for="l-body">Письмо</label>' +
        '<textarea id="l-body" maxlength="4000" style="min-height:180px" placeholder="Пиши как есть. Здесь можно всё."></textarea>' +
      '</div>' +
      '<div class="switch-row" style="margin-top:18px">' +
        '<span class="grow"><span style="display:block;font-weight:600">Запечатать до даты</span>' +
        '<span class="hint" style="padding:0">Не откроется раньше — даже у вас</span></span>' +
        '<button class="switch" type="button" role="switch" aria-checked="false" id="l-seal" aria-label="Запечатать до даты"></button>' +
      '</div>' +
      '<div class="seal-date" id="l-seal-box"><div>' +
        '<div class="field" style="margin-top:12px">' +
          '<label for="l-open">Откроется</label>' +
          '<input type="datetime-local" id="l-open" />' +
        '</div>' +
        (meet ? '<button class="btn plain small" type="button" id="l-meet" style="margin-top:6px">В день встречи</button>' : '') +
      '</div></div>' +
      '<div id="link-result" class="hidden" style="margin-top:18px">' +
        '<div style="font-weight:600">Ссылка готова</div>' +
        '<p class="hint" style="padding:4px 0 0">Всё письмо внутри адреса — отправьте его в любой мессенджер.</p>' +
        '<div class="link-box">' +
          '<input type="text" id="link-value" readonly aria-label="Ссылка на письмо" />' +
          '<button class="btn small" type="button" id="link-copy">Скопировать</button>' +
        '</div>' +
      '</div>',
    foot:
      '<button class="btn gray" type="button" id="l-link">' + icon('link') + 'Ссылкой</button>' +
      '<button class="btn" type="button" id="l-send">На полку</button>'
  });

  const seal = s.$('#l-seal');
  const sealBox = s.$('#l-seal-box');
  seal.addEventListener('click', () => {
    const on = seal.getAttribute('aria-checked') !== 'true';
    seal.setAttribute('aria-checked', String(on));
    sealBox.classList.toggle('open', on);
    if (on && !s.$('#l-open').value) s.$('#l-open').value = localInputValue(Date.now() + 7 * 86400000);
  });
  const meetBtn = s.$('#l-meet');
  if (meetBtn) meetBtn.addEventListener('click', () => { s.$('#l-open').value = localInputValue(new Date(meet).getTime()); });

  function collect() {
    const title = s.$('#l-title').value.trim();
    const body = s.$('#l-body').value.trim();
    const sealed = seal.getAttribute('aria-checked') === 'true';
    const openRaw = s.$('#l-open').value;
    if (!body) { App.toast('Письмо пока пустое'); s.$('#l-body').focus(); return null; }
    return {
      by: meKey,
      title: title || 'Письмо для тебя',
      body,
      openAt: sealed && openRaw ? new Date(openRaw).getTime() : 0,
      at: Date.now()
    };
  }

  s.$('#l-send').addEventListener('click', async () => {
    const letter = collect();
    if (!letter) return;
    s.close();
    await cloud.push('letters', letter);
    App.toast(letter.openAt ? 'Запечатано. Откроется в срок' : 'Письмо на полке — ' + OTHER.name + ' увидит');
    App.rainHearts(1.5);
  });

  s.$('#l-link').addEventListener('click', async () => {
    const letter = collect();
    if (!letter) return;
    const url = location.origin + location.pathname + '#c=' + encodeCapsule(letter);
    // на телефоне — сразу системное «Поделиться»
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: letter.title, url }); return; } catch (e) { /* закрыли — покажем ссылку */ }
    }
    s.$('#link-value').value = url;
    s.$('#link-result').classList.remove('hidden');
    s.$('#link-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  s.$('#link-copy').addEventListener('click', async () => {
    const field = s.$('#link-value');
    try {
      await navigator.clipboard.writeText(field.value);
      App.toast('Скопировано — отправляйте');
    } catch (e) {
      field.select();
      App.toast('Выделено — скопируйте вручную');
    }
  });
}

$('write').addEventListener('click', openComposer);

/* ============================================================
   Полка
   ============================================================ */

let letters = [];
let filter = 'all';
let loaded = false;

App.segmented($('tabs'), (btn) => {
  filter = btn.getAttribute('data-filter');
  paintShelf(true);
});

const isSealed = (l) => l.openAt && Date.now() < l.openAt;

function envelope(l, i, animate) {
  const sealed = isSealed(l);
  const when = sealed
    ? 'откроется ' + new Date(l.openAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    : App.formatWhen(l.at);
  const fresh = !sealed && l.by !== meKey && !opened.has(l.id);
  const d = new Date(l.at || Date.now());
  const mark = String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
  return '<button class="env' + (sealed ? ' sealed' : '') + '" type="button" data-id="' + esc(l.id) + '"' +
      (animate ? ' style="animation: env-in 420ms var(--ease-out) ' + Math.min(i * 40, 240) + 'ms both"' : '') + '>' +
    '<span class="env-inner">' +
      '<span class="env-from">' + esc(fromName(l.by)) + '</span>' +
      '<span class="env-title">' + esc(sealed ? 'Запечатано' : (l.title || 'Письмо')) + '</span>' +
      '<span class="env-when">' + esc(when) + '</span>' +
      '<span class="env-stamp" data-p="' + (l.by === 'b' ? 'b' : 'a') + '" aria-hidden="true">' + esc(App.initial(l.by || 'a')) + '</span>' +
      '<span class="env-postmark" aria-hidden="true">' + mark + '</span>' +
      (sealed ? '<span class="env-seal" aria-hidden="true">' + icon('lock') + '</span>' : '') +
    '</span>' +
    (fresh ? '<span class="new">новое</span>' : '') +
  '</button>';
}

function paintShelf(animate) {
  const shelf = $('shelf');
  const list = letters.filter((l) => {
    if (filter === 'in') return l.by !== meKey;
    if (filter === 'out') return l.by === meKey;
    if (filter === 'sealed') return isSealed(l);
    return true;
  });

  if (!list.length) {
    const text = !loaded ? 'Загружаю…'
      : letters.length ? 'В этой стопке пусто.'
      : 'Полка пока пуста. Напишите первое письмо — ' + OTHER.name + ' увидит его здесь.';
    shelf.innerHTML = '<div class="empty-shelf">' + icon('letter') + esc(text) + '</div>';
    return;
  }
  shelf.innerHTML = list.map((l, i) => envelope(l, i, animate)).join('');
}

$('shelf').addEventListener('click', (e) => {
  const card = e.target.closest('[data-id]');
  if (!card) return;
  const letter = letters.find((l) => l.id === card.getAttribute('data-id'));
  if (!letter) return;
  if (isSealed(letter)) showSealed(letter, letter.openAt);
  else openLetter(letter);
});

paintShelf();

await cloud.ready();
cloud.presence(meKey);
trackUnread();

cloud.watch('letters', (data) => {
  const first = !loaded;
  loaded = true;
  letters = Object.entries(data || {})
    .map(([id, l]) => ({ id, ...l }))
    .sort((x, y) => (y.at || 0) - (x.at || 0));
  paintShelf(first);
});

/* Раз в минуту обновляем полку — вдруг капсула как раз созрела */
setInterval(() => paintShelf(false), 60000);
