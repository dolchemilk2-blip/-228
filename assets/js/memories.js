/* Наша история: мост, общая лента моментов, фото, список желаний */

import { cloud, renderCloudBadge } from './cloud.js';

const CFG = window.SITE_CONFIG;
const $ = (id) => document.getElementById(id);

App.init({ reveal: true });
renderCloudBadge();

const meKey = App.getMe() || 'a';
const A = App.person('a');
const B = App.person('b');

document.addEventListener('me-changed', () => location.reload());

/* ============================================================
   Мост между городами
   ============================================================ */

$('bridge-a-city').textContent = A.city || A.name;
$('bridge-b-city').textContent = B.city || B.name;

function tickBridge() {
  $('bridge-a-time').textContent = App.clockIn(A.timeZone);
  $('bridge-b-time').textContent = App.clockIn(B.timeZone);
}
tickBridge();
setInterval(tickBridge, 1000);

/* ============================================================
   Наша история — общая лента, которую оба могут править
   ============================================================ */

const STORY_EMOJI = [
  '✨', '💜', '💙', '❤️', '✈️', '📞', '💬', '🎂', '🎁', '🌙',
  '☀️', '🎬', '🎵', '☕', '🍽️', '🏠', '🚗', '🌊', '🏔️', '📸',
  '💐', '🌸', '⭐', '🥂', '💍', '🐾', '🎓', '🎉', '🔥', '🗝️'
];

let story = [];        // отсортированный список моментов
let dragging = false;  // пока тащим — не перерисовываем из облака

const byOrder = (x, y) => (x.order ?? 0) - (y.order ?? 0) || (x.at ?? 0) - (y.at ?? 0);

/* ---------- рисуем ленту ---------- */

function paintStory() {
  const box = $('story');
  if (!box) return;

  const items = story.map((m) => {
    const author = App.person(m.by || 'a');
    return '<div class="story-item ' + (m.by === 'b' ? 'by-b' : '') + '" data-id="' + m.id + '">' +
      '<div class="story-dot">' + App.escapeHtml(m.icon || '💜') + '</div>' +
      '<div class="story-card">' +
        '<div class="story-top">' +
          '<span class="story-who">' + App.escapeHtml(author.emoji + ' ' + author.name) + '</span>' +
          '<span class="story-date">' + App.escapeHtml(m.date || '') + '</span>' +
        '</div>' +
        '<div class="story-title">' + App.escapeHtml(m.title || 'Без названия') + '</div>' +
        (m.text ? '<div class="story-text">' + App.escapeHtml(m.text) + '</div>' : '') +
        '<div class="story-tools">' +
          '<button class="grab" data-act="drag" title="Перетащить">⠿</button>' +
          '<button data-act="up" title="Выше">↑</button>' +
          '<button data-act="down" title="Ниже">↓</button>' +
          '<button data-act="edit" title="Изменить">✏️</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  const empty = '<p class="muted" style="margin-bottom:12px">' +
    'Здесь пока пусто. Добавьте первый момент — с чего у вас всё началось.</p>';

  box.innerHTML = (story.length ? items : empty) +
    '<button class="story-add" id="story-add">' +
      '<span class="plus">+</span> Добавить момент' +
    '</button>';

  // крайние стрелки некуда двигать
  const rows = box.querySelectorAll('.story-item');
  rows.forEach((row, i) => {
    row.querySelector('[data-act="up"]').disabled = i === 0;
    row.querySelector('[data-act="down"]').disabled = i === rows.length - 1;
  });
}

/* ---------- порядок ---------- */

// Раздаём порядковые номера заново — так он остаётся предсказуемым
// даже если моменты добавляли одновременно с двух телефонов.
async function saveOrder(ids) {
  await Promise.all(ids.map((id, i) => {
    const m = story.find((s) => s.id === id);
    if (!m || m.order === i * 100) return null;
    m.order = i * 100;
    return cloud.update('story/' + id, { order: i * 100 });
  }).filter(Boolean));
}

function move(id, delta) {
  const i = story.findIndex((m) => m.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= story.length) return;
  const list = story.slice();
  list.splice(j, 0, list.splice(i, 1)[0]);
  story = list;
  paintStory();
  saveOrder(story.map((m) => m.id));
}

/* ---------- перетаскивание ---------- */

/* Перетаскивание.

   Карточка не прыгает по списку, а поднимается и едет за пальцем;
   соседи в это время расступаются. В конце она плавно опускается
   в новое место приёмом FLIP: замеряем, где она была и где стала,
   и проигрываем путь между этими точками. */
function startDrag(e, item) {
  e.preventDefault();
  const box = $('story');
  const items = [...box.querySelectorAll('.story-item')];
  const from = items.indexOf(item);
  if (from < 0) return;

  const rects = items.map((el) => el.getBoundingClientRect());
  const startY = e.clientY;
  let to = from;

  dragging = true;
  item.classList.add('lifted');
  try { e.target.setPointerCapture(e.pointerId); } catch (err) {}

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const onMove = (ev) => {
    const dy = ev.clientY - startY;
    // наклон зависит от скорости движения — карточка будто живая
    item.style.transform = 'translateY(' + dy.toFixed(1) + 'px)';
    item.style.setProperty('--tilt', clamp(dy * 0.03, -2.5, 2.5).toFixed(2) + 'deg');

    // куда метим: сравниваем центр поднятой карточки с серединами остальных
    const center = rects[from].top + rects[from].height / 2 + dy;
    let next = from;
    items.forEach((_, i) => {
      if (i === from) return;
      const mid = rects[i].top + rects[i].height / 2;
      if (i < from && center < mid) next = Math.min(next, i);
      else if (i > from && center > mid) next = Math.max(next, i);
    });

    if (next !== to) {
      to = next;
      const h = rects[from].height + 12;      // высота карточки плюс отступ
      items.forEach((el, i) => {
        if (i === from) return;
        let shift = 0;
        if (to > from && i > from && i <= to) shift = -h;
        else if (to < from && i >= to && i < from) shift = h;
        el.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
      });
    }
  };

  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);

    const wasAt = item.getBoundingClientRect().top;      // где карточка сейчас

    items.forEach((el) => { el.style.transform = ''; });
    item.classList.remove('lifted');
    item.style.removeProperty('--tilt');

    if (to !== from) {
      const list = story.slice();
      list.splice(to, 0, list.splice(from, 1)[0]);
      story = list;
      paintStory();
    }

    // FLIP: карточка появляется там, где её отпустили, и едет на место
    const settled = box.querySelector('[data-id="' + item.dataset.id + '"]') || item;
    const nowAt = settled.getBoundingClientRect().top;
    const delta = wasAt - nowAt;
    if (Math.abs(delta) > 1) {
      settled.style.transition = 'none';
      settled.style.transform = 'translateY(' + delta.toFixed(1) + 'px)';
      requestAnimationFrame(() => {
        settled.style.transition = 'transform .38s cubic-bezier(.2, .9, .28, 1.1)';
        settled.style.transform = '';
        setTimeout(() => { settled.style.transition = ''; }, 400);
      });
    }

    dragging = false;
    if (to !== from) saveOrder(story.map((m) => m.id));
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

/* ---------- окно добавления и правки ---------- */

function openEditor(moment) {
  const isNew = !moment;
  const m = moment || { icon: '✨', date: '', title: '', text: '' };

  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML =
    '<div class="card story-editor">' +
      '<h2>' + (isNew ? 'Новый момент' : 'Изменить момент') + '</h2>' +
      '<div class="stack mt-lg">' +
        '<div class="field">' +
          '<label>Значок</label>' +
          '<div class="emoji-grid" id="ed-emoji">' +
            STORY_EMOJI.map((e) =>
              '<button type="button" data-e="' + e + '"' +
              (e === (m.icon || '✨') ? ' class="picked"' : '') + '>' + e + '</button>').join('') +
          '</div>' +
        '</div>' +
        '<div class="field">' +
          '<label for="ed-date">Когда</label>' +
          '<input type="text" id="ed-date" maxlength="40" placeholder="9 июля 2026 · или «Прошлым летом»" />' +
        '</div>' +
        '<div class="field">' +
          '<label for="ed-title">Что случилось</label>' +
          '<input type="text" id="ed-title" maxlength="70" placeholder="Первый созвон до утра" />' +
        '</div>' +
        '<div class="field">' +
          '<label for="ed-text">Подробнее <span class="muted">(по желанию)</span></label>' +
          '<textarea id="ed-text" maxlength="600" style="min-height:90px" ' +
            'placeholder="Проговорили шесть часов и не заметили."></textarea>' +
        '</div>' +
      '</div>' +
      '<div class="row mt-lg">' +
        '<button class="btn" id="ed-save">Сохранить</button>' +
        '<button class="btn ghost" id="ed-cancel">Отмена</button>' +
        (isNew ? '' : '<button class="btn ghost small" id="ed-del" style="margin-left:auto">Удалить</button>') +
      '</div>' +
    '</div>';

  document.body.appendChild(back);

  back.querySelector('#ed-date').value = m.date || '';
  back.querySelector('#ed-title').value = m.title || '';
  back.querySelector('#ed-text').value = m.text || '';

  let icon = m.icon || '✨';
  back.querySelector('#ed-emoji').addEventListener('click', (e) => {
    const b = e.target.closest('[data-e]');
    if (!b) return;
    icon = b.getAttribute('data-e');
    back.querySelectorAll('#ed-emoji button').forEach((x) => x.classList.remove('picked'));
    b.classList.add('picked');
  });

  const close = () => back.remove();
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.querySelector('#ed-cancel').addEventListener('click', close);

  back.querySelector('#ed-save').addEventListener('click', async () => {
    const title = back.querySelector('#ed-title').value.trim();
    const date = back.querySelector('#ed-date').value.trim();
    if (!title) { App.toast('Напишите, что случилось 🙂'); return; }

    const data = { icon, date, title, text: back.querySelector('#ed-text').value.trim() };
    close();

    if (isNew) {
      const last = story.length ? (story[story.length - 1].order ?? 0) : 0;
      await cloud.push('story', { ...data, by: meKey, order: last + 100, at: Date.now() });
      App.toast('Момент добавлен ' + icon);
      App.rainHearts(2);
    } else {
      await cloud.update('story/' + m.id, { ...data, editedBy: meKey, editedAt: Date.now() });
      App.toast('Сохранено');
    }
  });

  const del = back.querySelector('#ed-del');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Удалить этот момент из нашей истории?')) return;
    close();
    await cloud.remove('story/' + m.id);
    App.toast('Удалено');
  });

  setTimeout(() => back.querySelector('#ed-title').focus(), 60);
}

/* ---------- клики по ленте ---------- */

$('story').addEventListener('pointerdown', (e) => {
  const grab = e.target.closest('[data-act="drag"]');
  if (!grab) return;
  startDrag(e, grab.closest('.story-item'));
});

$('story').addEventListener('click', (e) => {
  if (e.target.closest('#story-add')) { openEditor(null); return; }

  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.story-item').dataset.id;
  const act = btn.getAttribute('data-act');

  if (act === 'up') move(id, -1);
  else if (act === 'down') move(id, 1);
  else if (act === 'edit') openEditor(story.find((m) => m.id === id));
});

paintStory();

/* ============================================================
   Галерея: фото добавляются прямо с телефона
   ============================================================ */

/* Снимок с телефона весит мегабайты — в общую базу такое класть нельзя.
   Поэтому уменьшаем и пережимаем прямо в браузере, до отправки.
   Если после сжатия всё ещё тяжело, заходим на второй круг построже. */
function shrinkImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { reject(new Error('пустой снимок')); return; }
      const k = Math.min(1, maxSide / Math.max(w, h));
      w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('не удалось прочитать')); };
    img.src = url;
  });
}

async function prepareImage(file) {
  const steps = [[1400, 0.78], [1100, 0.68], [900, 0.58], [720, 0.5]];
  let out = null;
  for (const [side, q] of steps) {
    out = await shrinkImage(file, side, q);
    if (out.length < 700000) return out;      // ~500 КБ и меньше — годится
  }
  return out;
}

let photos = [];

function paintGallery() {
  const box = $('gallery');
  if (!box) return;

  const tiles = photos.map((p) => {
    const who = App.person(p.by || 'a');
    return '<div class="photo" data-id="' + p.id + '">' +
      '<img src="' + App.escapeHtml(p.src) + '" alt="' + App.escapeHtml(p.caption || 'Воспоминание') + '" loading="lazy" />' +
      '<div class="who">' + App.escapeHtml(who.emoji) + '</div>' +
      (p.caption ? '<div class="cap">' + App.escapeHtml(p.caption) + '</div>' : '') +
    '</div>';
  }).join('');

  box.innerHTML = tiles +
    '<button class="photo-add" id="photo-add" type="button">' +
      '<span class="plus">+</span>Добавить фото' +
    '</button>';

  const note = $('photo-note');
  if (note) note.textContent = photos.length
    ? 'Снимки сжимаются прямо в браузере и попадают в общую комнату — второй увидит их сразу.'
    : 'Пока ни одного снимка. Нажмите «Добавить фото» — они сжимаются прямо в браузере и появятся у обоих.';
}

$('gallery').addEventListener('click', (e) => {
  if (e.target.closest('#photo-add')) { $('photo-input').click(); return; }
  const cell = e.target.closest('[data-id]');
  if (!cell) return;
  const p = photos.find((x) => x.id === cell.dataset.id);
  if (p) openPhoto(p);
});

$('photo-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';                       // чтобы тот же файл можно было выбрать снова
  if (!files.length) return;

  App.toast(files.length > 1 ? 'Готовлю ' + files.length + ' снимка…' : 'Готовлю снимок…');

  let added = 0;
  for (const file of files) {
    try {
      const src = await prepareImage(file);
      await cloud.push('photos', { src, caption: '', by: meKey, at: Date.now() });
      added++;
    } catch (err) {
      console.warn('снимок не прошёл:', err);
    }
  }

  if (added) { App.toast(added > 1 ? 'Добавлено ' + added + ' 📷' : 'Добавлено 📷'); App.rainHearts(2); }
  else App.toast('Не получилось прочитать снимок 😔');
});

function openPhoto(p) {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML =
    '<div class="card lightbox center">' +
      '<img src="' + App.escapeHtml(p.src) + '" alt="' + App.escapeHtml(p.caption || '') + '" />' +
      '<div class="lb-tools">' +
        '<input type="text" id="lb-cap" maxlength="90" placeholder="Подпись к снимку…" />' +
        '<button class="btn small" id="lb-save">Сохранить</button>' +
        '<button class="btn ghost small" id="lb-del" title="Удалить">🗑</button>' +
      '</div>' +
      '<p class="muted mt">Добавил(а) ' + App.escapeHtml(App.person(p.by || 'a').name) + ' · ' + App.formatWhen(p.at) + '</p>' +
    '</div>';
  document.body.appendChild(back);
  back.querySelector('#lb-cap').value = p.caption || '';

  back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });

  back.querySelector('#lb-save').addEventListener('click', async () => {
    const caption = back.querySelector('#lb-cap').value.trim();
    back.remove();
    await cloud.update('photos/' + p.id, { caption });
    App.toast('Подпись сохранена');
  });

  back.querySelector('#lb-del').addEventListener('click', async () => {
    if (!confirm('Удалить этот снимок?')) return;
    back.remove();
    await cloud.remove('photos/' + p.id);
    App.toast('Снимок удалён');
  });
}

paintGallery();

/* ============================================================
   Список желаний: пункты общие и редактируемые
   ============================================================ */

let wishes = [];      // [{ id, text, done, by, at, order }]

const byWishOrder = (x, y) => (x.order ?? 0) - (y.order ?? 0) || (x.at ?? 0) - (y.at ?? 0);

function paintWishes() {
  const box = $('wishlist');
  if (!box) return;

  const rows = wishes.map((w) => {
    const done = Boolean(w.done);
    const by = done && w.doneBy ? 'отметил ' + App.person(w.doneBy).name : '';
    return '<div class="wish ' + (done ? 'done' : '') + '" data-id="' + w.id + '">' +
      '<div class="box" data-act="toggle">' + (done ? '✓' : '') + '</div>' +
      '<div class="label" data-act="toggle">' + App.escapeHtml(w.text || '') + '</div>' +
      '<div class="by">' + App.escapeHtml(by) + '</div>' +
      '<div class="tools">' +
        '<button data-act="edit" title="Изменить">✏️</button>' +
        '<button data-act="del" title="Удалить">🗑</button>' +
      '</div>' +
    '</div>';
  }).join('');

  box.innerHTML = rows +
    '<button class="wish-add" id="wish-add" type="button"><span class="plus">+</span>Добавить пункт</button>';

  const done = wishes.filter((w) => w.done).length;
  const pct = wishes.length ? Math.round(done / wishes.length * 100) : 0;
  $('wish-progress').style.width = pct + '%';
  $('wish-progress-text').textContent = wishes.length
    ? 'Сделано ' + done + ' из ' + wishes.length + ' · ' + pct + '%'
    : 'Список пуст — добавьте, чего ждёте от встречи';
}

function askWish(current, onSave) {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML =
    '<div class="card story-editor">' +
      '<h2>' + (current ? 'Изменить пункт' : 'Новый пункт') + '</h2>' +
      '<div class="field mt-lg">' +
        '<label for="w-text">Что хотим сделать</label>' +
        '<input type="text" id="w-text" maxlength="90" placeholder="Дойти до моря" />' +
      '</div>' +
      '<div class="row mt-lg">' +
        '<button class="btn" id="w-ok">Сохранить</button>' +
        '<button class="btn ghost" id="w-cancel">Отмена</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(back);

  const field = back.querySelector('#w-text');
  field.value = current || '';
  setTimeout(() => field.focus(), 60);

  const close = () => back.remove();
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.querySelector('#w-cancel').addEventListener('click', close);

  const save = () => {
    const text = field.value.trim();
    if (!text) { App.toast('Пункт получился пустым 🙂'); return; }
    close();
    onSave(text);
  };
  back.querySelector('#w-ok').addEventListener('click', save);
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

$('wishlist').addEventListener('click', async (e) => {
  if (e.target.closest('#wish-add')) {
    askWish('', async (text) => {
      const last = wishes.length ? (wishes[wishes.length - 1].order ?? 0) : 0;
      await cloud.push('wishlist', { text, done: false, by: meKey, order: last + 100, at: Date.now() });
      App.toast('Добавлено ✨');
    });
    return;
  }

  const row = e.target.closest('[data-id]');
  if (!row) return;
  const w = wishes.find((x) => x.id === row.dataset.id);
  if (!w) return;
  const act = (e.target.closest('[data-act]') || {}).dataset;

  if (act && act.act === 'edit') {
    askWish(w.text, async (text) => {
      await cloud.update('wishlist/' + w.id, { text });
      App.toast('Изменено');
    });
    return;
  }

  if (act && act.act === 'del') {
    if (!confirm('Убрать «' + (w.text || '') + '» из списка?')) return;
    await cloud.remove('wishlist/' + w.id);
    App.toast('Убрано');
    return;
  }

  // отклик мгновенный, не дожидаясь общей базы
  const next = !w.done;
  w.done = next;
  w.doneBy = meKey;
  paintWishes();

  await cloud.update('wishlist/' + w.id, { done: next, doneBy: meKey, doneAt: Date.now() });
  if (next) {
    const r = row.getBoundingClientRect();
    App.burst(r.left + 20, r.top + r.height / 2, ['✅', '✨', '💜']);
  }
});

paintWishes();

/* ============================================================
   Подключение к общей базе
   ============================================================ */

await cloud.ready();
cloud.presence(meKey);

cloud.watch('photos', (data) => {
  photos = Object.entries(data || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((x, y) => (y.at || 0) - (x.at || 0));      // свежие впереди
  paintGallery();
});

let wishLoaded = false;
let wishSeeded = null;

/* Перенос списка из config.js — один раз за всю жизнь комнаты.
   Ключи те же (w0, w1…), что были у галочек раньше, поэтому уже
   отмеченные пункты сохраняют отметку: мы лишь дописываем текст. */
function seedWishesOnce() {
  if (!wishLoaded || wishSeeded !== false) return;
  if (wishes.length || !(CFG.wishlist || []).length) return;

  wishSeeded = true;
  cloud.set('meta/wishSeeded', true);
  CFG.wishlist.forEach((text, i) => {
    cloud.update('wishlist/w' + i, { text, order: i * 100, by: 'a', at: Date.now() + i });
  });
}

cloud.watch('wishlist', (data) => {
  wishes = Object.entries(data || {})
    .map(([id, w]) => ({ id, ...w }))
    .filter((w) => typeof w.text === 'string' && w.text.length)   // старые записи без текста пропускаем
    .sort(byWishOrder);
  wishLoaded = true;
  seedWishesOnce();
  paintWishes();
});

/* Перенос стартовых моментов из config.js — ровно один раз за всю жизнь
   комнаты. Отметку держим в базе, а не в переменной: иначе стоило бы
   удалить всю историю и перезагрузить страницу, как она бы вернулась. */
let storyLoaded = false;
let storySeeded = null;   // null — ещё не знаем

function seedStoryOnce() {
  if (!storyLoaded || storySeeded !== false) return;
  if (story.length || !(CFG.timeline || []).length) return;

  storySeeded = true;
  cloud.set('meta/storySeeded', true);
  // Ключи фиксированные (seed0, seed1…): если оба откроют сайт в одну
  // секунду, записи перезапишут друг друга, а не задвоятся.
  CFG.timeline.forEach((t, i) => {
    cloud.set('story/seed' + i, {
      icon: t.icon || '✨', date: t.date || '', title: t.title || '',
      text: t.text || '', by: 'a', order: i * 100, at: Date.now() + i
    });
  });
}

/* У истории и списка отметки РАЗНЫЕ. С одной общей выходила гонка:
   кто первым загрузился и поставил её, второму перенос уже не доставался. */
cloud.watch('meta', (m) => {
  storySeeded = Boolean((m || {}).storySeeded);
  wishSeeded = Boolean((m || {}).wishSeeded);
  seedStoryOnce();
  seedWishesOnce();
});

cloud.watch('story', (data) => {
  story = Object.entries(data || {})
    .map(([id, m]) => ({ id, ...m }))
    .sort(byOrder);
  storyLoaded = true;
  seedStoryOnce();
  if (!dragging) paintStory();
});
