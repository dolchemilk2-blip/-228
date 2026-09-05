/* Письма и капсулы времени */

import { cloud, renderCloudBadge } from './cloud.js';

const $ = (id) => document.getElementById(id);

App.init({ reveal: true });
renderCloudBadge();

const meKey = App.getMe() || 'a';
document.addEventListener('me-changed', () => location.reload());

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
   Открытое письмо
   ============================================================ */

function openLetter(letter) {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';

  const authorName = letter.by ? App.person(letter.by).name : 'кто-то, кто тебя любит';
  const sentAt = letter.at ? new Date(letter.at).toLocaleDateString('ru-RU',
    { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  back.innerHTML =
    '<div class="paper">' +
      '<button class="p-close" title="Закрыть">✕</button>' +
      '<div class="p-from">от ' + App.escapeHtml(authorName) + '</div>' +
      '<div class="p-title">' + App.escapeHtml(letter.title || 'Без названия') + '</div>' +
      '<div class="p-body"></div>' +
      '<div class="p-foot"><span>' + App.escapeHtml(sentAt) + '</span><span>с любовью 💜</span></div>' +
    '</div>';

  back.querySelector('.p-body').textContent = letter.body || '';

  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('.p-close')) back.remove();
  });

  document.body.appendChild(back);
  App.rainHearts(3);
}

/* Письмо, пришедшее ссылкой */
function readFromHash() {
  const m = location.hash.match(/^#c=(.+)$/);
  if (!m) return;
  let letter;
  try { letter = decodeCapsule(m[1]); } catch (e) {
    App.toast('Ссылка повреждена 😔');
    return;
  }
  history.replaceState(null, '', location.pathname + location.search);

  const openAt = letter.openAt ? new Date(letter.openAt).getTime() : 0;
  if (openAt && Date.now() < openAt) {
    showSealedNotice(letter, openAt);
    return;
  }
  setTimeout(() => openLetter(letter), 350);
}

function showSealedNotice(letter, openAt) {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML =
    '<div class="modal card">' +
      '<div style="font-size:3.4rem">🔒</div>' +
      '<h2 class="mt">Письмо запечатано</h2>' +
      '<p class="lead mt">' + App.escapeHtml(letter.title || 'Кое-что важное') + '</p>' +
      '<div class="mt-lg" style="font-family:var(--font-display);font-size:1.5rem" id="seal-timer">—</div>' +
      '<p class="muted mt">Откроется ' + new Date(openAt).toLocaleString('ru-RU',
          { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</p>' +
      '<button class="btn ghost mt-lg" id="seal-close">Хорошо, подожду</button>' +
    '</div>';
  document.body.appendChild(back);

  const timer = back.querySelector('#seal-timer');
  const tick = () => {
    const left = openAt - Date.now();
    if (left <= 0) { clearInterval(iv); back.remove(); openLetter(letter); return; }
    const d = Math.floor(left / 86400000);
    const h = Math.floor((left % 86400000) / 3600000);
    const mi = Math.floor((left % 3600000) / 60000);
    const s = Math.floor((left % 60000) / 1000);
    timer.textContent = d > 0
      ? d + ' ' + App.plural(d, 'день', 'дня', 'дней') + ' ' + h + ' ч'
      : String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  };
  tick();
  const iv = setInterval(tick, 1000);
  back.querySelector('#seal-close').addEventListener('click', () => { clearInterval(iv); back.remove(); });
}

readFromHash();

/* ============================================================
   Форма
   ============================================================ */

function collect() {
  const title = $('l-title').value.trim();
  const body = $('l-body').value.trim();
  const openRaw = $('l-open').value;
  if (!body) { App.toast('Письмо получилось пустым 🙂'); return null; }
  return {
    by: meKey,
    title: title || 'Письмо для тебя',
    body,
    openAt: openRaw ? new Date(openRaw).getTime() : 0,
    at: Date.now()
  };
}

$('l-send').addEventListener('click', async () => {
  const letter = collect();
  if (!letter) return;
  await cloud.push('letters', letter);
  $('l-title').value = '';
  $('l-body').value = '';
  $('l-open').value = '';
  $('link-result').classList.add('hidden');
  App.toast(letter.openAt ? 'Запечатано 🔒 Появится в срок' : 'Письмо на полке 💌');
  App.rainHearts(2);
});

$('l-link').addEventListener('click', () => {
  const letter = collect();
  if (!letter) return;
  const url = location.origin + location.pathname + '#c=' + encodeCapsule(letter);
  $('link-value').value = url;
  $('link-result').classList.remove('hidden');
  $('link-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

$('link-copy').addEventListener('click', async () => {
  const field = $('link-value');
  try {
    await navigator.clipboard.writeText(field.value);
    App.toast('Скопировано — отправляйте 🔗');
  } catch (e) {
    field.select();
    App.toast('Выделено — нажмите Ctrl+C');
  }
});

/* ============================================================
   Полка
   ============================================================ */

let letters = [];
let filter = 'all';

$('tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  filter = tab.getAttribute('data-filter');
  paintShelf();
});

function isSealed(l) {
  return l.openAt && Date.now() < l.openAt;
}

function paintShelf() {
  const shelf = $('shelf');
  const list = letters.filter((l) => {
    if (filter === 'in') return l.by !== meKey;
    if (filter === 'out') return l.by === meKey;
    if (filter === 'sealed') return isSealed(l);
    return true;
  });

  $('shelf-empty').classList.toggle('hidden', list.length > 0);
  if (!list.length) {
    shelf.innerHTML = '';
    $('shelf-empty').textContent = letters.length
      ? 'В этой стопке пусто.'
      : 'Полка пока пуста. Напишите первое письмо слева 💌';
    return;
  }

  shelf.innerHTML = list.map((l) => {
    const sealed = isSealed(l);
    const who = l.by === meKey ? 'от вас' : 'от ' + App.person(l.by).name;
    const when = sealed
      ? 'откроется ' + new Date(l.openAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
      : App.formatWhen(l.at);
    return '<div class="card tight envelope-card ' + (sealed ? 'sealed' : '') + '" data-id="' + l.id + '">' +
      (l.by === meKey ? '<button class="del" title="Удалить">✕</button>' : '') +
      (sealed ? '<div class="lock">🔒</div>' : '') +
      '<div class="ico">' + (sealed ? '🕰️' : '💌') + '</div>' +
      '<div class="from">' + App.escapeHtml(who) + '</div>' +
      '<div class="title">' + App.escapeHtml(sealed ? 'Запечатано' : (l.title || 'Письмо')) + '</div>' +
      '<div class="when">' + App.escapeHtml(when) + '</div>' +
    '</div>';
  }).join('');
}

$('shelf').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-id]');
  if (!card) return;
  const id = card.getAttribute('data-id');
  const letter = letters.find((l) => l.id === id);
  if (!letter) return;

  if (e.target.closest('.del')) {
    if (!confirm('Удалить это письмо навсегда?')) return;
    await cloud.remove('letters/' + id);
    App.toast('Удалено');
    return;
  }

  if (isSealed(letter)) {
    showSealedNotice(letter, letter.openAt);
    return;
  }
  openLetter(letter);
});

await cloud.ready();
cloud.presence(meKey);

cloud.watch('letters', (data) => {
  letters = Object.entries(data || {})
    .map(([id, l]) => ({ id, ...l }))
    .sort((x, y) => (y.at || 0) - (x.at || 0));
  paintShelf();
});

/* Раз в минуту обновляем полку — вдруг капсула как раз созрела */
setInterval(paintShelf, 60000);
