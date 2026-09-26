/* Наша история: мост, общая лента моментов, фото, список желаний */

import { cloud, trackUnread, watchTrip } from './cloud.js';

const CFG = window.SITE_CONFIG;
const $ = (id) => document.getElementById(id);
const esc = App.escapeHtml;
const icon = App.icon;

App.init();

const meKey = App.getMe() || 'a';
const A = App.person('a');
const B = App.person('b');

document.addEventListener('me-changed', () => location.reload());

/* ============================================================
   Между нами: самолётик стоит там, где мы сейчас на пути к встрече
   ============================================================ */

$('bridge-a-city').textContent = A.city || A.name;
$('bridge-b-city').textContent = B.city || B.name;

function tickBridge() {
  $('bridge-a-time').textContent = App.clockIn(A.timeZone);
  $('bridge-b-time').textContent = App.clockIn(B.timeZone);
}
tickBridge();
setInterval(tickBridge, 15000);

/* самолётик на дуге: пролетает от начала до сегодняшней точки,
   а если дату прилёта поменяли — переезжает на новое место */
const arc = $('arc');
const arcPlane = $('arc-plane');
let planeAt = 0;
let planeAnim = null;

function putPlane(t, fromA) {
  if (!arc || !arc.getTotalLength) return;
  const len = arc.getTotalLength();
  const d = fromA ? t : 1 - t;
  const pt = arc.getPointAtLength(len * d);
  const ahead = arc.getPointAtLength(Math.min(len, Math.max(0, len * d + (fromA ? 1 : -1))));
  const ang = Math.atan2(ahead.y - pt.y, ahead.x - pt.x) * 180 / Math.PI;
  arcPlane.setAttribute('transform', 'translate(' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1) + ') rotate(' + ang.toFixed(1) + ')');
}

function renderBridge(trip) {
  const start = CFG.startDate ? new Date(CFG.startDate + 'T00:00:00') : null;
  let p = 0.5;
  if (start && !isNaN(start) && !isNaN(trip.at)) p = Math.max(0, Math.min(1, (Date.now() - start) / (trip.at - start)));
  const fromA = trip.traveler !== 'b';
  if (planeAnim) planeAnim.stop();
  planeAnim = App.spring({
    from: planeAt, to: p, damping: 1, response: 1.1, precision: 0.0005,
    onUpdate: (v) => { planeAt = v; putPlane(v, fromA); }
  });

  if (!isNaN(trip.at)) {
    const days = Math.max(0, Math.ceil((trip.at - Date.now()) / 86400000));
    $('bridge-note').textContent = days
      ? 'Пройдено ' + Math.round(p * 100) + '% пути · ещё ' + days + ' ' + App.plural(days, 'день', 'дня', 'дней')
      : 'Мы долетели';
  }
}

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
let ordering = false;  // режим «Порядок»
let storyLoaded = false;

const byOrder = (x, y) => (x.order ?? 0) - (y.order ?? 0) || (x.at ?? 0) - (y.at ?? 0);

function paintStory() {
  const box = $('story');
  if (!box) return;
  box.classList.toggle('ordering', ordering);

  const items = story.map((m) => {
    const author = App.person(m.by || 'a');
    const inner =
      '<span class="story-top">' +
        '<span class="story-who">' + esc(author.name) + '</span>' +
        (m.date ? '<span class="story-date">' + esc(m.date) + '</span>' : '') +
      '</span>' +
      '<span class="story-title" style="display:block">' + esc(m.title || 'Без названия') + '</span>' +
      (m.text ? '<span class="story-text" style="display:block">' + esc(m.text) + '</span>' : '');
    return '<div class="story-item ' + (m.by === 'b' ? 'by-b' : '') + '" data-id="' + esc(m.id) + '">' +
      '<div class="story-dot" aria-hidden="true">' + esc(m.icon || '💜') + '</div>' +
      (ordering
        ? '<div class="story-card">' + inner +
            '<div class="story-tools">' +
              '<button type="button" data-act="up" aria-label="Выше">' + icon('chev-up') + '</button>' +
              '<button type="button" data-act="down" aria-label="Ниже">' + icon('chev-down') + '</button>' +
              '<button type="button" class="grab" data-act="drag" aria-label="Перетащить">' + icon('grip') + '</button>' +
            '</div>' +
          '</div>'
        : '<button class="story-card" type="button" data-act="edit" aria-label="Изменить: ' + esc(m.title || '') + '">' + inner + '</button>') +
    '</div>';
  }).join('');

  const empty = !storyLoaded ? '<p class="muted" style="padding:8px 0 14px">Загружаю…</p>'
    : '<p class="muted" style="padding:8px 0 14px">Здесь пока пусто. Добавьте первый момент — с чего у вас всё началось.</p>';

  box.innerHTML = (story.length ? items : empty) +
    (ordering ? '' : '<button class="add-row" type="button" id="story-add"><span class="plus">' + icon('plus') + '</span>Добавить момент</button>');

  const rows = box.querySelectorAll('.story-item');
  rows.forEach((row, i) => {
    const up = row.querySelector('[data-act="up"]');
    const down = row.querySelector('[data-act="down"]');
    if (up) up.disabled = i === 0;
    if (down) down.disabled = i === rows.length - 1;
  });
}

$('story-order').addEventListener('click', () => {
  ordering = !ordering;
  $('story-order').textContent = ordering ? 'Готово' : 'Порядок';
  $('story-order').setAttribute('aria-pressed', String(ordering));
  paintStory();
});

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

/* Стрелки: карточка плавно переезжает на новое место (FLIP) */
function move(id, delta) {
  const i = story.findIndex((m) => m.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= story.length) return;

  const box = $('story');
  const before = new Map([...box.querySelectorAll('.story-item')].map((el) => [el.dataset.id, el.getBoundingClientRect().top]));

  const list = story.slice();
  list.splice(j, 0, list.splice(i, 1)[0]);
  story = list;
  paintStory();

  if (!App.reduceMotion()) {
    box.querySelectorAll('.story-item').forEach((el) => {
      const was = before.get(el.dataset.id);
      if (was == null) return;
      const dy = was - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      el.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }],
        { duration: 380, easing: 'cubic-bezier(.3, 1.18, .6, 1)' });
    });
  }
  saveOrder(story.map((m) => m.id));
}

/* Перетаскивание за «ручку»: карточка поднимается и едет за пальцем,
   соседи расступаются, в конце она мягко опускается на место (FLIP). */
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
  App.haptic();
  item.classList.add('lifted');
  try { e.target.setPointerCapture(e.pointerId); } catch (err) {}

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const onMove = (ev) => {
    const dy = ev.clientY - startY;
    item.style.transform = 'translateY(' + dy.toFixed(1) + 'px)';
    item.style.setProperty('--tilt', clamp(dy * 0.03, -2.5, 2.5).toFixed(2) + 'deg');

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
      const h = rects[from].height + 10;
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

    const wasAt = item.getBoundingClientRect().top;
    items.forEach((el) => { el.style.transform = ''; });
    item.classList.remove('lifted');
    item.style.removeProperty('--tilt');

    if (to !== from) {
      const list = story.slice();
      list.splice(to, 0, list.splice(from, 1)[0]);
      story = list;
      paintStory();
    }

    const settled = box.querySelector('[data-id="' + item.dataset.id + '"]') || item;
    const delta = wasAt - settled.getBoundingClientRect().top;
    if (Math.abs(delta) > 1) {
      settled.style.transition = 'none';
      settled.style.transform = 'translateY(' + delta.toFixed(1) + 'px)';
      requestAnimationFrame(() => {
        settled.style.transition = 'transform .4s cubic-bezier(.3, 1.18, .6, 1)';
        settled.style.transform = '';
        setTimeout(() => { settled.style.transition = ''; }, 420);
      });
    }

    dragging = false;
    if (to !== from) saveOrder(story.map((m) => m.id));
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

/* ---------- добавление и правка — в шторке ---------- */

function openEditor(moment) {
  const isNew = !moment;
  const m = moment || { icon: '✨', date: '', title: '', text: '' };
  let pick = m.icon || '✨';

  const s = App.sheet({
    title: isNew ? 'Новый момент' : 'Момент',
    body:
      '<div class="field">' +
        '<label for="ed-title">Что случилось</label>' +
        '<input type="text" id="ed-title" maxlength="70" placeholder="Первый созвон до утра" />' +
      '</div>' +
      '<div class="field" style="margin-top:14px">' +
        '<label for="ed-date">Когда</label>' +
        '<input type="text" id="ed-date" maxlength="40" placeholder="9 июля 2026 · или «прошлым летом»" />' +
      '</div>' +
      '<div class="field" style="margin-top:14px">' +
        '<label for="ed-text">Подробнее</label>' +
        '<textarea id="ed-text" maxlength="600" style="min-height:96px" placeholder="Проговорили шесть часов и не заметили."></textarea>' +
      '</div>' +
      '<div class="field" style="margin-top:14px">' +
        '<span class="label">Значок</span>' +
        '<div class="emoji-grid" id="ed-emoji">' +
          STORY_EMOJI.map((e) => '<button type="button" data-e="' + e + '" aria-pressed="' + (e === pick) + '">' + e + '</button>').join('') +
        '</div>' +
      '</div>' +
      (isNew ? '' : '<p class="hint" style="margin-top:14px">Добавил(а) ' + esc(App.person(m.by || 'a').name) +
        (m.editedBy ? ' · правил(а) ' + esc(App.person(m.editedBy).name) : '') + '</p>'),
    foot:
      (isNew ? '<button class="btn gray" type="button" data-close>Отмена</button>'
             : '<button class="btn danger" type="button" id="ed-del">' + icon('trash') + 'Удалить</button>') +
      '<button class="btn" type="button" id="ed-save">Сохранить</button>'
  });

  s.$('#ed-title').value = m.title || '';
  s.$('#ed-date').value = m.date || '';
  s.$('#ed-text').value = m.text || '';

  s.$('#ed-emoji').addEventListener('click', (e) => {
    const b = e.target.closest('[data-e]');
    if (!b) return;
    pick = b.getAttribute('data-e');
    s.$('#ed-emoji').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });

  s.$('#ed-save').addEventListener('click', async () => {
    const title = s.$('#ed-title').value.trim();
    if (!title) { App.toast('Напишите, что случилось'); s.$('#ed-title').focus(); return; }
    const data = { icon: pick, date: s.$('#ed-date').value.trim(), title, text: s.$('#ed-text').value.trim() };
    s.close();
    if (isNew) {
      const last = story.length ? (story[story.length - 1].order ?? 0) : 0;
      await cloud.push('story', { ...data, by: meKey, order: last + 100, at: Date.now() });
      App.toast('Момент добавлен');
    } else {
      await cloud.update('story/' + m.id, { ...data, editedBy: meKey, editedAt: Date.now() });
      App.toast('Сохранено');
    }
  });

  const del = s.$('#ed-del');
  if (del) del.addEventListener('click', () => {
    s.close();
    const { id, ...data } = m;
    cloud.remove('story/' + id);
    App.undoToast('Момент удалён', () => cloud.set('story/' + id, data));
  });
}

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
   Фото: добавляются прямо с телефона
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
      c.getContext('2d').drawImage(img, 0, 0, w, h);
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
  const tiles = photos.map((p) =>
    '<button class="photo" type="button" data-id="' + esc(p.id) + '" aria-label="' + esc(p.caption || 'Фото') + ', открыть">' +
      '<img src="' + esc(p.src) + '" alt="" loading="lazy" decoding="async" />' +
      '<span class="who" data-p="' + (p.by === 'b' ? 'b' : 'a') + '" aria-hidden="true"></span>' +
    '</button>').join('');

  box.innerHTML =
    '<button class="photo-add" id="photo-add" type="button">' + icon('plus') + 'Добавить</button>' + tiles;

  $('photo-count').textContent = photos.length ? photos.length + ' ' + App.plural(photos.length, 'снимок', 'снимка', 'снимков') : '';
  $('photo-note').textContent = photos.length
    ? 'Точка в углу — кто добавил. Снимки сжимаются на телефоне и сразу появляются у обоих.'
    : 'Пока ни одного снимка. Нажмите «Добавить» — фото появятся у обоих.';
}

$('gallery').addEventListener('click', (e) => {
  if (e.target.closest('#photo-add')) { $('photo-input').click(); return; }
  const cell = e.target.closest('[data-id]');
  if (!cell) return;
  const p = photos.find((x) => x.id === cell.dataset.id);
  if (p) openPhoto(p, cell);
});

$('photo-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';                       // чтобы тот же файл можно было выбрать снова
  if (!files.length) return;

  const note = App.toast(files.length > 1 ? 'Готовлю ' + files.length + ' ' + App.plural(files.length, 'снимок', 'снимка', 'снимков') + '…' : 'Готовлю снимок…', 60000);

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
  note.close();
  if (added) App.toast(added > 1 ? 'Добавлено ' + added + ' ' + App.plural(added, 'снимок', 'снимка', 'снимков') : 'Снимок добавлен');
  else App.toast('Не получилось прочитать снимок');
});

/* Просмотр: снимок вырастает из своей миниатюры и возвращается в неё
   при закрытии — как в «Фото» на iPhone. Потянуть вниз — закрыть. */
function openPhoto(p, cell) {
  const v = document.createElement('div');
  v.className = 'viewer';
  v.setAttribute('role', 'dialog');
  v.setAttribute('aria-modal', 'true');
  v.setAttribute('aria-label', 'Фото');
  v.innerHTML =
    '<div class="viewer-bg"></div>' +
    '<div class="viewer-top">' +
      '<button class="icon-btn" type="button" data-close aria-label="Закрыть">' + icon('x') + '</button>' +
      '<div class="meta"><b>' + esc(App.person(p.by || 'a').name) + '</b>' + esc(App.formatWhen(p.at)) + '</div>' +
      '<button class="icon-btn" type="button" id="v-del" aria-label="Удалить фото">' + icon('trash') + '</button>' +
    '</div>' +
    '<div class="viewer-stage"><img class="viewer-img" alt="" /></div>' +
    '<div class="viewer-bottom">' +
      '<input type="text" id="v-cap" maxlength="90" placeholder="Подпись к снимку…" aria-label="Подпись" enterkeyhint="done" />' +
      '<button class="btn small" type="button" id="v-save">Сохранить</button>' +
    '</div>';
  document.body.appendChild(v);
  document.documentElement.classList.add('sheet-open');

  const img = v.querySelector('.viewer-img');
  const stage = v.querySelector('.viewer-stage');
  const cap = v.querySelector('#v-cap');
  cap.value = p.caption || '';
  img.style.visibility = 'hidden';     // до первого кадра анимации снимка не видно
  img.src = p.src;
  img.alt = p.caption || '';

  const EASE = 'cubic-bezier(.32, .72, 0, 1)';
  let target = null;   // где снимок стоит «в покое»

  function layout() {
    const sr = stage.getBoundingClientRect();
    const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
    const k = Math.min(sr.width / nw, sr.height / nh);
    const w = nw * k, h = nh * k;
    target = { left: sr.left + (sr.width - w) / 2, top: sr.top + (sr.height - h) / 2, width: w, height: h };
    img.style.left = (target.left - sr.left) + 'px';
    img.style.top = (target.top - sr.top) + 'px';
    img.style.width = w + 'px';
    img.style.height = h + 'px';
  }

  // из какого прямоугольника вырасти: снимок «обрезается» до миниатюры
  function fromThumb(r) {
    const s = Math.max(r.width / target.width, r.height / target.height);
    const vw = r.width / s, vh = r.height / s;
    const ix = (target.width - vw) / 2, iy = (target.height - vh) / 2;
    const tx = r.left - target.left - ix * s;
    const ty = r.top - target.top - iy * s;
    return {
      transform: 'translate(' + tx + 'px, ' + ty + 'px) scale(' + s + ')',
      clipPath: 'inset(' + iy + 'px ' + ix + 'px ' + iy + 'px ' + ix + 'px round ' + (4 / s) + 'px)'
    };
  }
  const rest = { transform: 'translate(0px, 0px) scale(1)', clipPath: 'inset(0px 0px 0px 0px round 0px)' };

  const ready = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
  ready.then(() => {
    layout();
    img.style.visibility = '';
    requestAnimationFrame(() => v.classList.add('open'));
    if (!App.reduceMotion() && cell && cell.isConnected) {
      cell.classList.add('hide');
      img.animate([fromThumb(cell.getBoundingClientRect()), rest], { duration: 460, easing: EASE });
    } else {
      img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
    }
  });

  const onResize = () => layout();
  window.addEventListener('resize', onResize);

  let closing = false;
  function close(fromDrag) {
    if (closing) return;
    closing = true;
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    v.querySelector('.viewer-bg').style.opacity = '';
    v.classList.remove('open');
    const cur = fromDrag || rest;
    const live = cell && cell.isConnected ? cell : $('gallery').querySelector('[data-id="' + p.id + '"]');
    let anim;
    if (!App.reduceMotion() && live && target) {
      anim = img.animate([cur, fromThumb(live.getBoundingClientRect())], { duration: 380, easing: EASE, fill: 'forwards' });
    } else {
      anim = img.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
    }
    anim.finished.then(() => {
      if (live) live.classList.remove('hide');
      v.remove();
      document.documentElement.classList.remove('sheet-open');
    });
  }

  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  v.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });

  /* потянуть снимок вниз — он уменьшается, фон светлеет; отпустить — закрыть */
  /* Снимок идёт за пальцем 1:1, уменьшается и отпускает фон.
     Отпустил: если бросил вниз — закрывается, иначе пружиной
     возвращается, продолжая движение с той же скоростью. */
  let drag = null;
  let back = { x: null, y: null };
  const bgEl = v.querySelector('.viewer-bg');
  const scaleFor = (dy) => Math.max(0.6, 1 - Math.max(0, dy) / 900);
  const place = (x, y) => {
    img.style.transform = 'translate(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px) scale(' + scaleFor(y).toFixed(3) + ')';
    bgEl.style.opacity = String(Math.max(0.2, 1 - Math.abs(y) / 500));
  };
  stage.addEventListener('pointerdown', (e) => {
    if (back.x) back.x.stop();
    if (back.y) back.y.stop();
    drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, tr: App.tracker() };
    drag.tr.add(e.clientX, e.clientY);
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.tr.add(e.clientX, e.clientY);
    drag.dx = e.clientX - drag.x;
    // вверх — туго, как у края прокрутки
    const raw = e.clientY - drag.y;
    drag.dy = raw < 0 ? App.rubberband(raw, 400) : raw;
    place(drag.dx, drag.dy);
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (Math.hypot(d.dx, d.dy) < 6) return;
    const vel = d.tr.velocity();
    if (d.dy + App.project(vel.y, 0.99) > 160) {
      const from = { transform: img.style.transform, clipPath: rest.clipPath };
      img.style.transform = '';
      App.haptic();
      close(from);
      return;
    }
    // обе оси — отдельными пружинами, каждая со своей скоростью
    let x = d.dx, y = d.dy;
    back.x = App.spring({ from: d.dx, to: 0, velocity: vel.x, damping: 0.82, response: 0.36, onUpdate: (val) => { x = val; place(x, y); } });
    back.y = App.spring({ from: d.dy, to: 0, velocity: vel.y, damping: 0.82, response: 0.36,
      onUpdate: (val) => { y = val; place(x, y); },
      onDone: () => { img.style.transform = ''; bgEl.style.opacity = ''; } });
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  v.querySelector('#v-save').addEventListener('click', async () => {
    const caption = cap.value.trim();
    cap.blur();
    await cloud.update('photos/' + p.id, { caption });
    App.toast('Подпись сохранена');
  });
  cap.addEventListener('keydown', (e) => { if (e.key === 'Enter') v.querySelector('#v-save').click(); });

  v.querySelector('#v-del').addEventListener('click', () => {
    close();
    const { id, ...data } = p;
    cloud.remove('photos/' + id);
    App.undoToast('Снимок удалён', () => cloud.set('photos/' + id, data));
  });
}

paintGallery();

/* ============================================================
   Список «когда встретимся»: общий и редактируемый
   ============================================================ */

let wishes = [];      // [{ id, text, done, by, at, order }]
const byWishOrder = (x, y) => (x.order ?? 0) - (y.order ?? 0) || (x.at ?? 0) - (y.at ?? 0);

const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function paintWishes() {
  const box = $('wishlist');
  box.innerHTML = wishes.map((w) => {
    const done = Boolean(w.done);
    const by = done && w.doneBy ? 'отметил ' + App.person(w.doneBy).name : '';
    return '<div class="wish' + (done ? ' done' : '') + '" data-id="' + esc(w.id) + '">' +
      '<button class="check" type="button" data-act="toggle" role="checkbox" aria-checked="' + done + '" aria-label="' + esc(w.text || '') + '">' + CHECK_SVG + '</button>' +
      '<button class="wish-text" type="button" data-act="edit"><span class="t">' + esc(w.text || '') + '</span>' +
        (by ? '<span class="by">' + esc(by) + '</span>' : '') + '</button>' +
    '</div>';
  }).join('');

  const done = wishes.filter((w) => w.done).length;
  const pct = wishes.length ? Math.round(done / wishes.length * 100) : 0;
  $('wish-progress').style.width = pct + '%';
  $('wish-progress-text').textContent = wishes.length ? done + ' из ' + wishes.length : 'пусто';
}

function askWish(current, onSave, onDelete) {
  const s = App.sheet({
    title: current ? 'Пункт списка' : 'Новый пункт',
    body:
      '<div class="field">' +
        '<label for="w-text">Что хотим сделать вместе</label>' +
        '<input type="text" id="w-text" maxlength="90" enterkeyhint="done" placeholder="Дойти до моря" />' +
      '</div>',
    foot:
      (onDelete ? '<button class="btn danger" type="button" id="w-del">' + icon('trash') + 'Удалить</button>'
                : '<button class="btn gray" type="button" data-close>Отмена</button>') +
      '<button class="btn" type="button" id="w-ok">Сохранить</button>',
    focus: '#w-text'
  });
  const field = s.$('#w-text');
  field.value = current || '';

  const save = () => {
    const text = field.value.trim();
    if (!text) { App.toast('Пункт получился пустым'); return; }
    s.close();
    onSave(text);
  };
  s.$('#w-ok').addEventListener('click', save);
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const del = s.$('#w-del');
  if (del) del.addEventListener('click', () => { s.close(); onDelete(); });
}

$('wish-add').addEventListener('click', () => {
  askWish('', async (text) => {
    const last = wishes.length ? (wishes[wishes.length - 1].order ?? 0) : 0;
    await cloud.push('wishlist', { text, done: false, by: meKey, order: last + 100, at: Date.now() });
  });
});

$('wishlist').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-id]');
  if (!row) return;
  const w = wishes.find((x) => x.id === row.dataset.id);
  if (!w) return;
  const act = (e.target.closest('[data-act]') || {}).dataset?.act;

  if (act === 'edit') {
    askWish(w.text, (text) => cloud.update('wishlist/' + w.id, { text }), () => {
      const { id, ...data } = w;
      cloud.remove('wishlist/' + id);
      App.undoToast('Пункт убран', () => cloud.set('wishlist/' + id, data));
    });
    return;
  }

  if (act !== 'toggle') return;
  // отклик мгновенный, не дожидаясь общей базы
  const next = !w.done;
  w.done = next;
  w.doneBy = meKey;
  row.classList.toggle('done', next);
  row.querySelector('.check').setAttribute('aria-checked', String(next));
  const done = wishes.filter((x) => x.done).length;
  $('wish-progress').style.width = Math.round(done / wishes.length * 100) + '%';
  $('wish-progress-text').textContent = done + ' из ' + wishes.length;
  App.haptic();
  if (next) {
    const r = row.querySelector('.check').getBoundingClientRect();
    App.burst(r.left + r.width / 2, r.top + r.height / 2, ['✨', '💜', '💙'], 8);
  }
  await cloud.update('wishlist/' + w.id, { done: next, doneBy: meKey, doneAt: Date.now() });
});

paintWishes();

/* ============================================================
   Подключение к общей базе
   ============================================================ */

let lastTripKey = '';
watchTrip((t) => {
  const key = t.wall + t.traveler;
  if (key === lastTripKey) return;
  lastTripKey = key;
  renderBridge(t);
});

await cloud.ready();
cloud.presence(meKey);
trackUnread();

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
