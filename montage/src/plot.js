// Монтажка — доска сюжета: события на линии, развилки и ветки, связи с подписями («если согласится»).
// Карточка — событие, стрелка — «что дальше». У события может быть несколько стрелок (развилка), ветки могут
// снова сходиться в одно событие. Доска одна на браузер и не зависит от сценария: её заводят ещё до записи.
// Сохраняется сама и входит в файл проекта. Использует S, $, esc, ic, store, notify, download, charName из
// app.js; notifyAct из home.js; plural, MOTION из motion.js.

const PLK = { W: 216, GX: 88, GY: 36, ANCHOR: 30, ZMIN: 0.2, ZMAX: 2.5 };
const PL_KINDS = [['ev', 'Событие'], ['turn', 'Поворот'], ['fork', 'Развилка'], ['end', 'Финал'], ['note', 'Заметка']];
const PL = { ready: false, title: '', nodes: [], links: [], view: { x: 48, y: 48, z: 1 }, seq: 1, sel: new Set(), link: -1, edit: null, undo: [], redo: [], h: new Map(), els: new Map(), ptr: new Map(), g: null, raf: 0, vraf: 0, menu: null };
// правка текста прямо в карточке: только текст, без жирного и картинок из буфера
const PL_CE = (() => { try { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true'; } catch { return 'true'; } })();
const plMo = () => !(typeof MOTION !== 'undefined' && MOTION.reduce);
const plClampZ = z => Math.min(PLK.ZMAX, Math.max(PLK.ZMIN, z));
const plNode = id => PL.nodes.find(n => n.id === id);
const plH = id => PL.h.get(id) || 84;
const plKids = id => PL.links.filter(l => l.a === id).map(l => plNode(l.b)).filter(Boolean).sort((p, q) => p.y - q.y || p.x - q.x);
const plParents = id => PL.links.filter(l => l.b === id).map(l => plNode(l.a)).filter(Boolean).sort((p, q) => p.y - q.y || p.x - q.x);
const plKindName = k => (PL_KINDS.find(x => x[0] === k) || PL_KINDS[0])[1];
const plText = el => el ? el.innerText.replace(/ /g, ' ').replace(/\n+$/, '').trim() : '';

// ------------------------------------------------------------------ данные
/** Доска поднимается из памяти браузера при первом обращении (store объявлен в app.js, он собирается позже). */
function plotEnsure() { if (PL.ready) return; PL.ready = true; plotLoad(store.get('montage:plot')); }
function plotLoad(v) {
  const ok = v && typeof v === 'object' && Array.isArray(v.nodes);
  PL.title = ok && typeof v.title === 'string' ? v.title.slice(0, 80) : '';
  PL.nodes = ok ? v.nodes.filter(n => n && typeof n.id === 'string').map(n => ({ id: n.id, x: Math.round(+n.x || 0), y: Math.round(+n.y || 0), t: String(n.t || ''), n: String(n.n || ''), k: PL_KINDS.some(k => k[0] === n.k) ? n.k : 'ev', ...(n.sc != null ? { sc: String(n.sc) } : {}) })) : [];
  const ids = new Set(PL.nodes.map(n => n.id)), seen = new Set();
  PL.links = ok && Array.isArray(v.links) ? v.links.filter(l => l && ids.has(l.a) && ids.has(l.b) && l.a !== l.b && !seen.has(l.a + '>' + l.b) && seen.add(l.a + '>' + l.b)).map(l => ({ a: l.a, b: l.b, l: String(l.l || '').slice(0, 60) })) : [];
  PL.view = ok && v.view && isFinite(v.view.z) ? { x: +v.view.x || 0, y: +v.view.y || 0, z: plClampZ(+v.view.z) } : { x: 48, y: 48, z: 1 };
  PL.seq = Math.max(1, ok ? +v.seq || 1 : 1, ...PL.nodes.map(n => (parseInt(n.id.slice(1), 10) || 0) + 1));
  PL.sel = new Set(); PL.link = -1; PL.edit = null;
}
/** Для файла проекта и памяти браузера; пустая доска — null. */
function plotSaved() { plotEnsure(); return PL.nodes.length || PL.title ? { app: 'montage-plot', v: 1, title: PL.title, nodes: PL.nodes, links: PL.links, view: PL.view, seq: PL.seq } : null; }
/** Доска из открытого проекта: прежнюю можно вернуть отменой. */
function plotFromProject(v) { plotEnsure(); if (!v) return; plPush(); plotLoad(v); plSaveNow(); plDraw(); }
let plSaveT = 0;
function plSave() { clearTimeout(plSaveT); plSaveT = setTimeout(plSaveNow, 250); }
function plSaveNow() { clearTimeout(plSaveT); store.set('montage:plot', plotSaved() || { nodes: [], links: [] }); }
const plSnap = () => JSON.stringify({ nodes: PL.nodes, links: PL.links });
function plPush() { PL.undo.push(plSnap()); if (PL.undo.length > 100) PL.undo.shift(); PL.redo = []; }
function plUndo(redo) {
  plEditEnd(); const from = redo ? PL.redo : PL.undo, to = redo ? PL.undo : PL.redo; if (!from.length) return;
  to.push(plSnap()); const s = JSON.parse(from.pop()); PL.nodes = s.nodes; PL.links = s.links;
  const ids = new Set(PL.nodes.map(n => n.id)); PL.sel = new Set([...PL.sel].filter(id => ids.has(id))); PL.link = -1;
  plChanged();
}
function plChanged(o = {}) {
  plDraw(); plSave();
  const el = o.born && PL.els.get(o.born);
  if (el && plMo() && typeof el.animate === 'function') el.animate([{ opacity: 0, scale: '0.94' }, { opacity: 1, scale: '1' }], { duration: 250, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
}

// ------------------------------------------------------------------ вид
function renderPlot() {
  plotEnsure();
  const el = $('#plp'); if (!el) return;
  if (!el.firstElementChild) { el.innerHTML = plShellHtml(); plBind(el); plDraw(); return; }
  plMeasure(); plLinks(); plView(); plHead();   // вкладку открыли снова: высоты карточек могли не измериться, пока она была скрыта
}
function plShellHtml() {
  const b = (a, icon, t, more = '') => `<button class="ghost-b tiny" type="button" data-pa="${a}"${more}>${ic(icon)}${t}</button>`;
  return `<div class="pl-top">
      <h2 class="step">Сюжет <small id="pl-sub"></small></h2>
      <input type="text" id="pl-title" class="pl-title" maxlength="80" placeholder="Название истории" aria-label="Название истории" autocomplete="off">
      <div class="pl-tools">
        ${b('add', 'plus', 'Событие')}${b('script', 'lines', 'Из сценария')}${b('arrange', 'branch', 'Выровнять')}
        ${b('txt', 'download', 'Текстом')}${b('save', 'download', 'Файл доски')}
        <label class="ghost-b tiny file-b">${ic('open')}Открыть<input type="file" id="pl-open" accept=".json,application/json"></label>
        <span class="pl-hist"><button class="icon-b" type="button" data-pa="undo" aria-label="Отменить" title="Отменить (Ctrl+Z)">${ic('undo')}</button><button class="icon-b" type="button" data-pa="redo" aria-label="Повторить" title="Повторить (Ctrl+Shift+Z)">${ic('redo')}</button></span>
      </div>
    </div>
    <div class="pl-board" id="pl-board" tabindex="0" role="application" aria-roledescription="доска" aria-label="Доска сюжета" aria-describedby="pl-help">
      <div class="pl-world" id="pl-world"><svg class="pl-links" id="pl-links" aria-hidden="true"></svg><div id="pl-labels"></div><div id="pl-cards"></div></div>
      <div class="pl-band" id="pl-band" hidden></div>
      <div class="pl-empty" id="pl-empty" hidden></div>
      <div class="pl-zoom"><button type="button" data-pa="zout" aria-label="Мельче">${ic('minus')}</button><button type="button" data-pa="z1" id="pl-z" aria-label="Масштаб 100 %">100%</button><button type="button" data-pa="zin" aria-label="Крупнее">${ic('plus')}</button><button type="button" data-pa="fit" aria-label="Вся доска" title="Вся доска (F)">${ic('expand')}</button></div>
    </div>
    <p class="pl-help muted small" id="pl-help">Двойной щелчок по доске — новое событие. «+» справа у карточки — что дальше; потяните его к другой карточке — связь, в пустое место — новое событие там. Значок ветки снизу — ещё один вариант развития. Двойной щелчок по стрелке — подпись. <span class="pl-keys">Tab — следующее событие, Ctrl+Enter — ветка, Enter — текст, стрелки — по событиям, 1–5 — тип, Delete — удалить, Ctrl+Z — отменить.</span></p>
    <div id="pl-menu" class="tl-menu" role="menu" aria-label="Действия" hidden></div>`;
}
function plCardHtml(n) {
  return `<div class="pl-card${PL.sel.has(n.id) ? ' on' : ''}" data-id="${n.id}" data-k="${n.k}" style="transform:translate(${n.x}px,${n.y}px)">
    <div class="pl-kind"><i></i>${plKindName(n.k)}${n.sc != null ? `<span class="pl-sc">сцена ${esc(n.sc)}</span>` : ''}</div>
    <div class="pl-t" data-f="t" data-ph="Что происходит">${esc(n.t)}</div><div class="pl-n" data-f="n" data-ph="Подробности, кто участвует">${esc(n.n)}</div>
    <button class="pl-next" type="button" tabindex="-1" aria-label="Дальше — следующее событие" title="Дальше: щелчок — новое событие, потянуть — связь">${ic('plus')}</button>
    <button class="pl-fork" type="button" tabindex="-1" aria-label="Ветка — ещё один вариант" title="Ветка — ещё один вариант">${ic('branch')}</button></div>`;
}
function plDraw() {
  const cards = $('#pl-cards'); if (!cards) return;
  if (PL.edit) plEditEnd();
  cards.innerHTML = PL.nodes.map(plCardHtml).join('');
  PL.els = new Map([...cards.children].map(c => [c.dataset.id, c]));
  plMeasure(); plLinks(); plView(); plHead();
}
function plMeasure() { for (const [id, c] of PL.els) if (c.offsetHeight) PL.h.set(id, c.offsetHeight); }
function plMoveEls(ids) { for (const n of PL.nodes) { if (ids && !ids.has(n.id)) continue; const c = PL.els.get(n.id); if (c) c.style.transform = `translate(${n.x}px,${n.y}px)`; } }
function plSelUi() { for (const [id, c] of PL.els) c.classList.toggle('on', PL.sel.has(id)); }
/** Стрелка: из правого края события (на уровне заголовка) в левый край следующего — у линии событий стрелки прямые.
 *  Возврат назад (петля к прошлому событию) обходит карточки снизу и рисуется пунктиром. */
function plPath(a, b) {
  const x1 = a.x + PLK.W, y1 = a.y + PLK.ANCHOR, x2 = b.x, y2 = b.y + PLK.ANCHOR;
  if (x2 < x1 + 24 && b.id) {
    let yb = Math.max(a.y + plH(a.id), b.y + plH(b.id));                  // ниже всех карточек на пути назад
    for (const n of PL.nodes) if (n.x < x1 && n.x + PLK.W > x2 && n.y < yb + 400) yb = Math.max(yb, n.y + plH(n.id));
    yb += 34; const xm = (x1 + x2) / 2, r = 44;
    return { back: true, d: `M${x1} ${y1}C${x1 + r} ${y1} ${x1 + r} ${yb} ${x1 - 10} ${yb}L${x2 + 10} ${yb}C${x2 - r} ${yb} ${x2 - r} ${y2} ${x2} ${y2}`, mx: xm, my: yb, x2, y2 };
  }
  const d = Math.max(36, Math.min(180, Math.abs(x2 - x1) / 2 + (x2 < x1 + 24 ? 90 : 0)));
  return { d: `M${x1} ${y1}C${x1 + d} ${y1} ${x2 - d} ${y2} ${x2} ${y2}`, mx: (x1 + 3 * (x1 + d) + 3 * (x2 - d) + x2) / 8, my: (y1 + y2) / 2, x2, y2 };
}
function plLinks() {
  const svg = $('#pl-links'), lab = $('#pl-labels'); if (!svg) return;
  const by = new Map(PL.nodes.map(n => [n.id, n])), parts = [], labels = [];
  let x0 = 0, y0 = 0, x1 = 1, y1 = 1;
  for (const n of PL.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + PLK.W); y1 = Math.max(y1, n.y + plH(n.id)); }
  PL.links.forEach((l, i) => {
    const a = by.get(l.a), b = by.get(l.b); if (!a || !b) return;
    const p = plPath(a, b), on = PL.link === i ? ' on' : '';
    parts.push(`<g class="pl-l${on}${p.back ? ' back' : ''}" data-l="${i}"><path class="hit" d="${p.d}"/><path class="ln" d="${p.d}"/><path class="ar" d="M${p.x2 - 7} ${p.y2 - 4.5}L${p.x2} ${p.y2}L${p.x2 - 7} ${p.y2 + 4.5}"/></g>`);
    if (l.l || on) labels.push(`<div class="pl-lab${l.l ? '' : ' ph'}${on}" data-l="${i}" style="transform:translate(${p.mx.toFixed(1)}px,${p.my.toFixed(1)}px) translate(-50%,-50%)">${l.l ? esc(l.l) : 'подпись'}</div>`);
  });
  const g = PL.g;
  if (g && g.type === 'wire' && g.moved && g.pt) {
    const a = by.get(g.from); if (a) { const p = plPath(a, { x: g.pt.x, y: g.pt.y - PLK.ANCHOR }); parts.push(`<path class="pl-wire" d="${p.d}"/>`); x0 = Math.min(x0, g.pt.x); y0 = Math.min(y0, g.pt.y); x1 = Math.max(x1, g.pt.x); y1 = Math.max(y1, g.pt.y); }
  }
  // холст стрелок — по размеру всех карточек с запасом на изгибы: вне своего прямоугольника SVG не ловит щелчки
  x0 -= 240; y0 -= 240; x1 += 240; y1 += 240;
  Object.assign(svg.style, { left: x0 + 'px', top: y0 + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px' });
  svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  svg.innerHTML = parts.join('');
  if (!(PL.labEdit && lab.contains(document.activeElement))) lab.innerHTML = labels.join('');
}
function plView() {
  const w = $('#pl-world'), b = $('#pl-board'); if (!w) return;
  const v = PL.view; let s = 24 * v.z; while (s < 12) s *= 2;   // мелко — точки сетки реже, а не сплошной серый
  w.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`;
  b.style.backgroundSize = `${s}px ${s}px`; b.style.backgroundPosition = `${v.x}px ${v.y}px`;
  const z = $('#pl-z'); if (z) z.textContent = Math.round(v.z * 100) + '%';
}
function plHead() {
  const n = PL.nodes.length, forks = PL.nodes.filter(x => PL.links.filter(l => l.a === x.id).length > 1).length;
  const sub = $('#pl-sub'); if (sub) sub.textContent = n ? `${n} ${plural(n, 'событие', 'события', 'событий')}${forks ? ` · ${forks} ${plural(forks, 'развилка', 'развилки', 'развилок')}` : ''}` : 'события, развилки и ветки истории';
  const t = $('#pl-title'); if (t && document.activeElement !== t) t.value = PL.title;
  const sc = S.P ? S.P.nScenes : 0;
  document.querySelectorAll('#plp [data-pa="script"]').forEach(x => { x.disabled = !sc; x.title = sc ? `Сцены сценария (${sc}) — событиями по порядку` : 'В сценарии нет сцен («Сцена 1», «Картина 2»…)'; });
  document.querySelectorAll('#plp [data-pa="arrange"], #plp [data-pa="txt"], #plp [data-pa="save"]').forEach(x => { x.disabled = !n; });
  const u = $('#plp [data-pa="undo"]'), r = $('#plp [data-pa="redo"]'); if (u) u.disabled = !PL.undo.length; if (r) r.disabled = !PL.redo.length;
  const e = $('#pl-empty'); if (!e) return;
  e.hidden = !!n;
  if (!n) e.innerHTML = `<div class="pl-empty-in"><b>Разложите историю по событиям</b>
    <p>Карточка — событие, стрелка — что дальше. Если у события несколько исходов — это развилка: у каждой ветки свой путь, а потом они могут сойтись.</p>
    <div class="pl-empty-b"><button class="primary" type="button" data-pa="start">${ic('plus')}Первое событие</button>${sc ? `<button class="ghost-b" type="button" data-pa="script">${ic('lines')}Из сценария — ${sc} ${plural(sc, 'сцена', 'сцены', 'сцен')}</button>` : ''}<button class="ghost-b" type="button" data-pa="sample">Пример с развилкой</button></div>
    <p class="muted small">или дважды щёлкните в любом месте доски</p></div>`;
}
const plBoardRect = () => $('#pl-board').getBoundingClientRect();
function plWorld(cx, cy) { const r = plBoardRect(), v = PL.view; return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z }; }
function plViewTo(t, anim = true) {
  cancelAnimationFrame(PL.vraf); PL.vraf = 0;
  t.z = plClampZ(t.z);
  if (!anim || !plMo()) { Object.assign(PL.view, t); plView(); plSave(); return; }
  const f = { ...PL.view }, t0 = performance.now(), D = 320;
  const step = now => { const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3); PL.view.x = f.x + (t.x - f.x) * e; PL.view.y = f.y + (t.y - f.y) * e; PL.view.z = f.z + (t.z - f.z) * e; plView(); if (k < 1) PL.vraf = requestAnimationFrame(step); else { PL.vraf = 0; plSave(); } };
  PL.vraf = requestAnimationFrame(step);
}
function plZoomAt(z, cx, cy, anim) {
  const r = plBoardRect(), v = PL.view; z = plClampZ(z);
  const px = cx == null ? r.width / 2 : cx - r.left, py = cy == null ? r.height / 2 : cy - r.top;
  plViewTo({ x: px - (px - v.x) * z / v.z, y: py - (py - v.y) * z / v.z, z }, anim);
}
/** Вся доска на экране. readable — не мельче читаемого: на узком экране тогда видно начало истории. */
function plFit(anim = true, readable = false) {
  const b = $('#pl-board'); if (!b || !b.clientWidth) return;
  if (!PL.nodes.length) { plViewTo({ x: 48, y: 48, z: 1 }, anim); return; }
  const x0 = Math.min(...PL.nodes.map(n => n.x)), y0 = Math.min(...PL.nodes.map(n => n.y)), x1 = Math.max(...PL.nodes.map(n => n.x + PLK.W)), y1 = Math.max(...PL.nodes.map(n => n.y + plH(n.id)));
  const pad = 40, W = b.clientWidth, H = b.clientHeight, z = plClampZ(Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0), 1.1));
  if (readable && z < 0.6) { const r = 0.6, h = (y1 - y0) * r; plViewTo({ x: pad - x0 * r, y: (h <= H - 2 * pad ? (H - h) / 2 : pad) - y0 * r, z: r }, anim); return; }
  plViewTo({ x: (W - (x1 - x0) * z) / 2 - x0 * z, y: (H - (y1 - y0) * z) / 2 - y0 * z, z }, anim);
}
/** Событие ушло за край доски — подвинуть вид ровно настолько, чтобы его стало видно. */
function plShow(n) {
  const b = $('#pl-board'); if (!b || !n) return;
  const v = PL.view, m = 24, W = b.clientWidth, H = b.clientHeight;
  const l = v.x + n.x * v.z, t = v.y + n.y * v.z, r = l + PLK.W * v.z, btm = t + plH(n.id) * v.z;
  let dx = 0, dy = 0;
  if (r > W - m) dx = W - m - r; if (l + dx < m) dx = m - l;
  if (btm > H - 56) dy = H - 56 - btm; if (t + dy < m) dy = m - t;
  if (dx || dy) plViewTo({ x: v.x + dx, y: v.y + dy, z: v.z });
}

// ------------------------------------------------------------------ правки
function plNew(x, y, o = {}) {
  const n = { id: 'n' + PL.seq++, x: Math.round(x), y: Math.round(y), t: o.t || '', n: o.n || '', k: o.k || 'ev' };
  if (o.sc != null) n.sc = String(o.sc);
  PL.nodes.push(n); return n;
}
/** Свободное место для новой карточки: сдвигать вниз, пока не перестанет налезать на другие. */
function plFree(x, y, h = 84) {
  for (let i = 0; i < 400; i++) {
    const hit = PL.nodes.find(m => x < m.x + PLK.W + 12 && x + PLK.W + 12 > m.x && y < m.y + plH(m.id) + PLK.GY / 2 && y + h + PLK.GY / 2 > m.y);
    if (!hit) return { x, y };
    y = hit.y + plH(hit.id) + PLK.GY;
  }
  return { x, y };
}
/** «Дальше» и «ветка»: новое событие справа. Если продолжение уже есть — новое встаёт под ним, это развилка. */
function plNext(id, branch) {
  plEditEnd(); const a = plNode(id); if (!a) return;
  plPush();
  const kids = plKids(id), x = a.x + PLK.W + PLK.GX;
  const y = kids.length ? Math.max(...kids.map(k => k.y + plH(k.id))) + PLK.GY : branch ? a.y + plH(a.id) + PLK.GY : a.y;
  const p = plFree(x, y), n = plNew(p.x, p.y);
  PL.links.push({ a: id, b: n.id, l: '' });
  PL.sel = new Set([n.id]); PL.link = -1;
  plChanged({ born: n.id }); plShow(n); plEdit(n.id, 't');
}
/** Вставить событие между этим и следующим: всё, что дальше по линии, отъезжает вправо. */
function plInsert(id) {
  const a = plNode(id), kids = plKids(id); if (!a) return; if (kids.length !== 1) { plNext(id); return; }
  plEditEnd(); plPush();
  const b = kids[0], d = PLK.W + PLK.GX, move = new Set(), q = [b.id];
  while (q.length) { const c = q.pop(); if (move.has(c) || c === id) continue; move.add(c); for (const l of PL.links) if (l.a === c) q.push(l.b); }
  for (const n of PL.nodes) if (move.has(n.id)) n.x += d;
  const n = plNew(a.x + d, b.y), l = PL.links.find(x => x.a === id && x.b === b.id);
  l.b = n.id; PL.links.push({ a: n.id, b: b.id, l: '' });
  PL.sel = new Set([n.id]); PL.link = -1;
  plChanged({ born: n.id }); plShow(n); plEdit(n.id, 't');
}
function plAddAt(wx, wy, from) {
  plEditEnd(); plPush();
  const n = plNew(wx, wy);
  if (from && plNode(from)) PL.links.push({ a: from, b: n.id, l: '' });
  PL.sel = new Set([n.id]); PL.link = -1;
  plChanged({ born: n.id }); plShow(n); plEdit(n.id, 't');
}
function plAddFree() {
  const one = PL.sel.size === 1 ? [...PL.sel][0] : null; if (one) { plNext(one); return; }
  const b = $('#pl-board'), v = PL.view;
  const p = plFree(Math.round((b.clientWidth / 2 - v.x) / v.z - PLK.W / 2), Math.round((b.clientHeight / 2 - v.y) / v.z - 50));
  plAddAt(p.x, p.y, null);
}
function plConnect(a, b) {
  if (a === b || PL.links.some(l => l.a === a && l.b === b)) return false;
  plPush(); PL.links.push({ a, b, l: '' }); PL.link = PL.links.length - 1; PL.sel.clear(); plChanged(); return true;
}
function plDelete() {
  plEditEnd();
  if (PL.link >= 0 && PL.links[PL.link]) { plPush(); PL.links.splice(PL.link, 1); PL.link = -1; plChanged(); notifyAct('Связь убрана', 'Вернуть', () => plUndo()); return; }
  if (!PL.sel.size) return;
  plPush();
  const del = new Set(PL.sel), add = [];
  // мост: удалили событие посреди линии — предыдущее цепляется к следующим, линия не рвётся
  for (const l of PL.links) {
    if (del.has(l.a) || !del.has(l.b) || PL.links.filter(x => x.b === l.b).length !== 1) continue;
    const seen = new Set(), q = [l.b];
    while (q.length) { const c = q.pop(); if (seen.has(c)) continue; seen.add(c); for (const o of PL.links) if (o.a === c) { if (del.has(o.b)) q.push(o.b); else add.push({ a: l.a, b: o.b, l: l.l || o.l || '' }); } }
  }
  PL.nodes = PL.nodes.filter(n => !del.has(n.id));
  PL.links = PL.links.filter(l => !del.has(l.a) && !del.has(l.b));
  for (const l of add) if (l.a !== l.b && !PL.links.some(x => x.a === l.a && x.b === l.b)) PL.links.push(l);
  PL.sel.clear(); PL.link = -1; plChanged();
  notifyAct(del.size > 1 ? `Удалено событий: ${del.size}` : 'Событие удалено', 'Вернуть', () => plUndo());
}
function plKind(k) {
  if (!PL.sel.size || !PL_KINDS.some(x => x[0] === k)) return;
  const list = PL.nodes.filter(n => PL.sel.has(n.id) && n.k !== k); if (!list.length) return;
  plEditEnd(); plPush(); for (const n of list) n.k = k; plChanged();
}
/** Выровнять: столбец — сколько событий до этого от начала, строка — своя у каждой ветки. Главная линия — прямая. */
function plArrange(anim = true) {
  plEditEnd(); const tg = plLayout(); if (!tg) return;
  plPush(); plAnimTo(tg, anim);
}
/** С чего начинать обход: сначала событие, от которого достижимо больше всего, — начало главной истории
 *  (даже если в него возвращается петля), отдельные события и обрывки — потом. */
function plStarts(ids, out, inn, byPos) {
  const size = i => { const seen = new Set(), q = [i]; while (q.length) { const c = q.pop(); if (seen.has(c)) continue; seen.add(c); q.push(...out.get(c)); } return seen.size; };
  const sz = new Map(ids.map(i => [i, size(i)]));
  return [...ids].sort((p, q) => sz.get(q) - sz.get(p) || inn.get(p) - inn.get(q) || byPos(p, q));
}
/** Места всех событий после выравнивания (Map id → {x, y}); null — уже ровно. */
function plLayout() {
  if (!PL.nodes.length) return null;
  const by = new Map(PL.nodes.map(n => [n.id, n])), ids = PL.nodes.map(n => n.id);
  const out = new Map(ids.map(i => [i, []])), inn = new Map(ids.map(i => [i, 0]));
  for (const l of PL.links) { out.get(l.a).push(l.b); inn.set(l.b, inn.get(l.b) + 1); }
  const byPos = (p, q) => by.get(p).y - by.get(q).y || by.get(p).x - by.get(q).x;
  for (const v of out.values()) v.sort(byPos);
  // порядок без петель: стрелка назад (возврат к прошлому событию) не двигает столбцы
  const st = new Map(), order = [], starts = [];
  const visit = i => { st.set(i, 1); for (const j of out.get(i)) if (!st.get(j)) visit(j); st.set(i, 2); order.push(i); };
  for (const i of plStarts(ids, out, inn, byPos)) if (!st.get(i)) { starts.push(i); visit(i); }
  order.reverse();
  const pos = new Map(order.map((i, k) => [i, k])), col = new Map(ids.map(i => [i, 0]));
  for (const i of order) for (const j of out.get(i)) if (pos.get(j) > pos.get(i)) col.set(j, Math.max(col.get(j), col.get(i) + 1));
  const row = new Map(); let rows = 0;
  const place = (i, r) => { row.set(i, r); let first = true; for (const j of out.get(i)) { if (row.has(j) || pos.get(j) < pos.get(i)) continue; place(j, first ? r : rows++); first = false; } };
  for (const i of [...starts, ...order]) if (!row.has(i)) place(i, rows++);
  const rowH = Array(rows).fill(0); for (const i of ids) rowH[row.get(i)] = Math.max(rowH[row.get(i)], plH(i));
  const rowY = []; let y = 0; for (let r = 0; r < rows; r++) { rowY.push(y); y += rowH[r] + PLK.GY; }
  const first = by.get(starts[0]), tg = new Map();
  const ox = first.x - col.get(first.id) * (PLK.W + PLK.GX), oy = first.y - rowY[row.get(first.id)];
  for (const i of ids) tg.set(i, { x: Math.round(ox + col.get(i) * (PLK.W + PLK.GX)), y: Math.round(oy + rowY[row.get(i)]) });
  return PL.nodes.every(n => tg.get(n.id).x === n.x && tg.get(n.id).y === n.y) ? null : tg;
}
function plAnimTo(tg, anim = true) {
  cancelAnimationFrame(PL.raf); PL.raf = 0;
  const done = () => { PL.raf = 0; for (const n of PL.nodes) { const t = tg.get(n.id); if (t) { n.x = t.x; n.y = t.y; } } plMoveEls(); plLinks(); plSave(); plHead(); };
  if (!anim || !plMo()) { done(); return; }
  const from = new Map(PL.nodes.map(n => [n.id, { x: n.x, y: n.y }])), t0 = performance.now(), D = 420;
  const step = now => {
    const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
    for (const n of PL.nodes) { const f = from.get(n.id), t = tg.get(n.id); if (f && t) { n.x = Math.round(f.x + (t.x - f.x) * e); n.y = Math.round(f.y + (t.y - f.y) * e); } }
    plMoveEls(); plLinks();
    if (k < 1) PL.raf = requestAnimationFrame(step); else done();
  };
  PL.raf = requestAnimationFrame(step);
}
/** Сцены сценария — событиями по порядку: заголовок сцены, кто в ней говорит и первая ремарка. */
function plFromScript() {
  if (!S.P || !S.P.nScenes) { notify('В сценарии нет сцен — заголовков вида «Сцена 1» или «Картина 2».'); return; }
  plEditEnd(); plPush();
  const scenes = []; let cur = null;
  for (const c of S.P.cues) {
    if (c.type === 'scene') { cur = { n: c.n, head: c.text, who: new Set(), dir: '' }; scenes.push(cur); }
    else if (cur && c.type === 'line') cur.who.add(charName(c.spk));
    else if (cur && c.type === 'dir' && !cur.dir) cur.dir = c.text;
  }
  const cut = (s, m) => s.length > m ? s.slice(0, m - 1).trimEnd() + '…' : s;
  const y0 = PL.nodes.length ? Math.max(...PL.nodes.map(n => n.y + plH(n.id))) + 80 : 0, x0 = PL.nodes.length ? Math.min(...PL.nodes.map(n => n.x)) : 0;
  let prev = null;
  scenes.forEach((s, i) => {
    const n = plNew(x0 + i * (PLK.W + PLK.GX), y0, { t: cut(s.head, 90), n: [s.who.size ? [...s.who].join(', ') : '', s.dir ? cut(s.dir, 140) : ''].filter(Boolean).join('\n'), sc: s.n });
    if (prev) PL.links.push({ a: prev.id, b: n.id, l: '' }); prev = n;
  });
  PL.sel.clear(); PL.link = -1; plChanged(); plFit(true, true);
  notify(`Сцены сценария — на доске: ${scenes.length}. Добавьте развилки там, где история может пойти иначе.`);
}
function plSample() {
  plEditEnd(); const snap = plSnap();
  const a = plNew(0, 0, { t: 'Звонок ночью', n: 'Кэфи будит звонок с незнакомого номера' });
  const b = plNew(0, 0, { t: 'Голос в трубке', n: 'Просят прийти к старому театру до полуночи', k: 'turn' });
  const c = plNew(0, 0, { t: 'Идти или нет?', n: 'Кэфи колеблется', k: 'fork' });
  const d1 = plNew(0, 0, { t: 'Пустой театр', n: 'За кулисами горит свет' });
  const d2 = plNew(0, 1, { t: 'Второй звонок', n: 'Тот же голос называет её по имени' });
  const e = plNew(0, 0, { t: 'Встреча', n: 'Обе ветки сходятся: незнакомец ждёт на сцене', k: 'end' });
  PL.links.push({ a: a.id, b: b.id, l: '' }, { a: b.id, b: c.id, l: '' }, { a: c.id, b: d1.id, l: 'пойти' }, { a: c.id, b: d2.id, l: 'остаться дома' }, { a: d1.id, b: e.id, l: '' }, { a: d2.id, b: e.id, l: 'всё-таки идёт' });
  plDraw();                                     // высоты карточек — для раскладки
  const tg = plLayout(); if (tg) for (const n of PL.nodes) Object.assign(n, tg.get(n.id));
  PL.undo.push(snap); PL.redo = [];
  plDraw(); plSave(); plFit(false, true);
}

// ------------------------------------------------------------------ текст в карточке
function plEdit(id, f = 't', at) {
  const card = PL.els.get(id), n = plNode(id); if (!card || !n) return;
  if (!PL.edit || PL.edit.id !== id) {
    plEditEnd();
    PL.edit = { id, snap: plSnap() };
    card.classList.add('ed'); card.querySelectorAll('[data-f]').forEach(e => { e.contentEditable = PL_CE; e.spellcheck = true; });
    plMeasure(); plLinks();
  }
  const el = card.querySelector(`[data-f="${f}"]`); el.focus({ preventScroll: true });
  const sel = getSelection(); let r = null;
  if (at && document.caretRangeFromPoint) r = document.caretRangeFromPoint(at.x, at.y);
  else if (at && document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(at.x, at.y); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); } }
  if (!r || !el.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(el); r.collapse(false); }
  sel.removeAllRanges(); sel.addRange(r);
}
function plEditEnd() {
  const e = PL.edit; if (!e) return; PL.edit = null;
  const card = PL.els.get(e.id), n = plNode(e.id); if (!card) return;
  const t = plText(card.querySelector('[data-f="t"]')), d = plText(card.querySelector('[data-f="n"]'));
  if (n && (t !== n.t || d !== n.n)) { PL.undo.push(e.snap); if (PL.undo.length > 100) PL.undo.shift(); PL.redo = []; n.t = t; n.n = d; plSave(); }
  card.classList.remove('ed');
  card.querySelectorAll('[data-f]').forEach(x => { x.removeAttribute('contenteditable'); x.textContent = n ? n[x.dataset.f] : ''; });
  if (card.contains(document.activeElement)) $('#pl-board').focus({ preventScroll: true });
  plMeasure(); plLinks(); plHead();
}
function plLabelEdit(i) {
  const l = PL.links[i]; if (!l) return;
  plEditEnd(); PL.link = i; PL.sel.clear(); plSelUi(); plLinks();
  const el = $(`#pl-labels .pl-lab[data-l="${i}"]`); if (!el) return;
  el.classList.remove('ph'); el.textContent = l.l; el.contentEditable = PL_CE; PL.labEdit = true;
  el.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  let done = false;
  const fin = save => {
    if (done) return; done = true; PL.labEdit = false;
    const v = plText(el).replace(/\s+/g, ' ').slice(0, 60);
    if (save && PL.links[i] === l && v !== l.l) { plPush(); l.l = v; plSave(); }
    plLinks(); plHead();
  };
  el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); fin(e.key === 'Enter'); $('#pl-board').focus({ preventScroll: true }); } });
  el.addEventListener('blur', () => fin(true), { once: true });
}

// ------------------------------------------------------------------ меню
function plMenuHtml(ctx) {
  const kb = t => `<kbd>${t}</kbd>`;
  const undo = `<div class="m-sep"></div><button role="menuitem" data-m="undo" ${PL.undo.length ? '' : 'disabled'}><span>${ic('undo')}Отменить</span>${kb('Ctrl+Z')}</button><button role="menuitem" data-m="redo" ${PL.redo.length ? '' : 'disabled'}><span>${ic('redo')}Повторить</span>${kb('Ctrl+Shift+Z')}</button>`;
  if (ctx.link >= 0 && PL.links[ctx.link]) {
    const l = PL.links[ctx.link], a = plNode(l.a), b = plNode(l.b), nm = n => esc((n && n.t) || 'событие');
    return `<div class="m-head"><span class="m-txt">${nm(a)} → ${nm(b)}</span></div>
      <button role="menuitem" data-m="label"><span>${l.l ? 'Изменить подпись' : 'Подписать ветку'}</span>${kb('Enter')}</button>
      <button role="menuitem" data-m="unlink"><span>${ic('trash')}Убрать связь</span>${kb('Delete')}</button>${undo}`;
  }
  const sel = PL.nodes.filter(n => PL.sel.has(n.id)), one = sel.length === 1 ? sel[0] : null;
  if (sel.length) {
    const kinds = new Set(sel.map(n => n.k)), cur = kinds.size === 1 ? [...kinds][0] : null;
    return `<div class="m-head">${one ? `<b>${esc(one.t || 'Событие')}</b>${one.sc != null ? `<span class="m-txt">сцена ${esc(one.sc)}</span>` : ''}` : `<b>Выбрано ${sel.length}</b>`}</div>
      ${one ? `<button role="menuitem" data-m="next"><span>${ic('plus')}Дальше — следующее событие</span>${kb('Tab')}</button>
      <button role="menuitem" data-m="branch"><span>${ic('branch')}Ветка — другой вариант</span>${kb('Ctrl+Enter')}</button>
      ${plKids(one.id).length === 1 ? `<button role="menuitem" data-m="insert"><span>Вставить событие после</span></button>` : ''}
      <button role="menuitem" data-m="edit"><span>Изменить текст</span>${kb('Enter')}</button>` : ''}
      <div class="m-lbl">Тип</div><div class="m-fx">${PL_KINDS.map(([k, t], i) => `<button role="menuitemradio" aria-checked="${cur === k}" class="${cur === k ? 'on' : ''}" data-m="kind" data-v="${k}" title="${t} (${i + 1})">${t}</button>`).join('')}</div>
      <div class="m-sep"></div><button role="menuitem" data-m="del"><span>${ic('trash')}Удалить</span>${kb('Delete')}</button>${undo}`;
  }
  return `<div class="m-head"><b>${esc(PL.title || 'Сюжет')}</b></div>
    <button role="menuitem" data-m="here"><span>${ic('plus')}Новое событие здесь</span>${kb('двойной щелчок')}</button>
    ${PL.nodes.length ? `<button role="menuitem" data-m="arrange"><span>${ic('branch')}Выровнять</span></button>
    <button role="menuitem" data-m="fit"><span>${ic('expand')}Вся доска</span>${kb('F')}</button>
    <button role="menuitem" data-m="all"><span>Выделить всё</span>${kb('Ctrl+A')}</button>` : ''}${undo}`;
}
function plMenuOpen(cx, cy, ctx) {
  const m = $('#pl-menu'); if (!m) return;
  const was = !m.hidden && m.dataset.open === 'true';
  PL.menu = { ...ctx, x: cx, y: cy }; clearTimeout(m._hide); m.style.pointerEvents = '';
  const instant = typeof MOTION !== 'undefined' && (MOTION.reduce || performance.now() - MOTION.kbd < 150);
  m.classList.add('t-morph'); m.classList.toggle('t-instant', instant && !was);
  if (!was) m.dataset.open = 'false';
  m.innerHTML = `<div class="t-morph-menu">${plMenuHtml(ctx)}</div><span class="t-morph-plus" aria-hidden="true">${ic('plus')}</span>`;
  m.hidden = false;
  const inner = m.firstElementChild, vw = innerWidth, vh = innerHeight, W = Math.min(320, vw - 16);
  inner.style.width = W + 'px'; inner.style.height = 'auto'; const H = Math.min(inner.scrollHeight, vh - 16); inner.style.width = inner.style.height = '';
  const toL = cx - 20 + W > vw - 8, toT = cy - 20 + H > vh - 8;
  const ax = toL ? Math.min(vw - 8, Math.max(W + 8, cx + 20)) : Math.max(8, Math.min(vw - 8 - W, cx - 20)), ay = toT ? Math.min(vh - 8, Math.max(H + 8, cy + 20)) : Math.max(8, Math.min(vh - 8 - H, cy - 20));
  m.dataset.ax = toL ? 'r' : 'l'; m.dataset.ay = toT ? 'b' : 't';
  m.style.left = toL ? 'auto' : ax + 'px'; m.style.right = toL ? (vw - ax) + 'px' : 'auto'; m.style.top = toT ? 'auto' : ay + 'px'; m.style.bottom = toT ? (vh - ay) + 'px' : 'auto';
  m.style.setProperty('--mw', W + 'px'); m.style.setProperty('--mh', H + 'px'); m.dataset.open = 'true';
  if (typeof segInd === 'function') m.querySelectorAll('.m-fx').forEach((b, i) => segInd(b, 'pl-k' + i));
  const f = m.querySelector('button:not([disabled])'); if (f) f.focus({ preventScroll: true });
}
function plMenuClose(refocus = true) {
  const m = $('#pl-menu'); if (!m || m.hidden || m.dataset.open !== 'true') return;
  PL.menu = null;
  const instant = typeof MOTION !== 'undefined' && MOTION.reduce;
  m.classList.toggle('t-instant', instant); m.dataset.open = 'false'; m.style.pointerEvents = 'none';
  clearTimeout(m._hide); if (instant) m.hidden = true; else m._hide = setTimeout(() => { if (m.dataset.open !== 'true') { m.hidden = true; m.style.pointerEvents = ''; } }, 270);
  if (refocus) $('#pl-board')?.focus({ preventScroll: true });
}
function plMenuAct(b) {
  const a = b.dataset.m, ctx = PL.menu || {}, one = PL.sel.size === 1 ? [...PL.sel][0] : null;
  if (a === 'kind') { plKind(b.dataset.v); plMenuOpen(ctx.x, ctx.y, ctx); return; }   // меню остаётся: видно, что тип сменился
  plMenuClose(a !== 'edit' && a !== 'label');
  if (a === 'next' && one) plNext(one);
  else if (a === 'branch' && one) plNext(one, true);
  else if (a === 'insert' && one) plInsert(one);
  else if (a === 'edit' && one) plEdit(one, 't');
  else if (a === 'del') plDelete();
  else if (a === 'label') plLabelEdit(ctx.link);
  else if (a === 'unlink') { PL.link = ctx.link; plDelete(); }
  else if (a === 'here') { const w = plWorld(ctx.x, ctx.y); plAddAt(w.x - PLK.W / 2, w.y - PLK.ANCHOR); }
  else if (a === 'arrange') plArrange();
  else if (a === 'fit') plFit();
  else if (a === 'all') { PL.sel = new Set(PL.nodes.map(n => n.id)); PL.link = -1; plSelUi(); plLinks(); }
  else if (a === 'undo' || a === 'redo') plUndo(a === 'redo');
}
function plMenuFromKeys() {
  if (typeof MOTION !== 'undefined') MOTION.kbd = performance.now();
  const r = plBoardRect(), v = PL.view, one = PL.nodes.find(n => PL.sel.has(n.id));
  if (one) plMenuOpen(r.left + v.x + (one.x + PLK.W) * v.z - 8, r.top + v.y + (one.y + PLK.ANCHOR) * v.z, {});
  else plMenuOpen(r.left + r.width / 2, r.top + r.height / 3, { link: PL.link });
}

// ------------------------------------------------------------------ клавиатура
/** Стрелки — к соседнему событию: вправо — следующее, влево — предыдущее, вверх-вниз — ближайшее по вертикали. */
function plNav(key) {
  const cur = PL.nodes.find(n => PL.sel.has(n.id));
  if (!cur) { const f = [...PL.nodes].sort((p, q) => p.x - q.x || p.y - q.y)[0]; if (f) { PL.sel = new Set([f.id]); plSelUi(); plShow(f); } return; }
  let to = null;
  if (key === 'ArrowRight') to = plKids(cur.id)[0];
  else if (key === 'ArrowLeft') to = plParents(cur.id)[0];
  if (!to) {
    const dir = key === 'ArrowDown' ? [0, 1] : key === 'ArrowUp' ? [0, -1] : key === 'ArrowRight' ? [1, 0] : [-1, 0];
    let best = Infinity;
    for (const n of PL.nodes) {
      if (n === cur) continue;
      const dx = n.x - cur.x, dy = n.y - cur.y, along = dx * dir[0] + dy * dir[1]; if (along <= 0) continue;
      const side = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]), s = along + side * 2;
      if (s < best) { best = s; to = n; }
    }
  }
  if (to) { PL.sel = new Set([to.id]); PL.link = -1; plSelUi(); plLinks(); plShow(to); }
}
function plKey(e) {
  const mod = e.ctrlKey || e.metaKey, one = PL.sel.size === 1 ? [...PL.sel][0] : null;
  if (PL.edit) {
    const id = PL.edit.id, f = e.target.dataset && e.target.dataset.f;
    if (e.key === 'Escape') { e.preventDefault(); plEditEnd(); return; }
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); plEditEnd(); plNext(id); return; }
    if (e.key === 'Enter' && mod) { e.preventDefault(); plEditEnd(); plNext(id, true); return; }
    if (e.key === 'Enter' && !e.shiftKey && f === 't') { e.preventDefault(); plEdit(id, 'n'); return; }
    return;                                    // остальное — обычный набор текста, Ctrl+Z тоже свой
  }
  if (e.target.closest && e.target.closest('#pl-menu, .pl-lab')) return;
  const k = e.key;
  if (mod && (k === 'z' || k === 'Z' || k === 'я' || k === 'Я')) { e.preventDefault(); plUndo(e.shiftKey); }
  else if (mod && (k === 'y' || k === 'н')) { e.preventDefault(); plUndo(true); }
  else if (mod && (k === 'a' || k === 'ф')) { e.preventDefault(); PL.sel = new Set(PL.nodes.map(n => n.id)); PL.link = -1; plSelUi(); plLinks(); }
  else if (k === 'Enter' && mod) { e.preventDefault(); if (one) plNext(one, true); }
  else if (k === 'Enter' || k === 'F2') { e.preventDefault(); if (one) plEdit(one, 't'); else if (PL.link >= 0) plLabelEdit(PL.link); }
  else if (k === 'Tab' && !e.shiftKey && !mod) { e.preventDefault(); if (one) plNext(one); else if (!PL.nodes.length) plAddFree(); else plNav('ArrowRight'); }
  else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); plDelete(); }
  else if (k === 'Escape') { if (PL.sel.size || PL.link >= 0) { e.preventDefault(); PL.sel.clear(); PL.link = -1; plSelUi(); plLinks(); } }
  else if (k.startsWith('Arrow') && !mod) { e.preventDefault(); plNav(k); }
  else if (/^[1-5]$/.test(k) && !mod) plKind(PL_KINDS[+k - 1][0]);
  else if ((k === '+' || k === '=') && !mod) plZoomAt(PL.view.z * 1.25, null, null, true);
  else if (k === '-' && !mod) plZoomAt(PL.view.z / 1.25, null, null, true);
  else if (k === '0' && !mod) plZoomAt(1, null, null, true);
  else if ((k === 'f' || k === 'F' || k === 'а' || k === 'А') && !mod) plFit();
  else if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) { e.preventDefault(); plMenuFromKeys(); }
}

// ------------------------------------------------------------------ мышь и пальцы
function plBind(root) {
  const board = $('#pl-board');
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-pa]'); if (!b || b.disabled) return;
    const a = b.dataset.pa;
    if (a === 'add' || a === 'start') plAddFree();
    else if (a === 'script') plFromScript();
    else if (a === 'sample') plSample();
    else if (a === 'arrange') plArrange();
    else if (a === 'txt') download(new Blob([plotText()], { type: 'text/plain;charset=utf-8' }), (PL.title || 'сюжет').replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.txt');
    else if (a === 'save') download(new Blob([JSON.stringify(plotSaved(), null, 1)], { type: 'application/json' }), (PL.title || 'сюжет').replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.доска.json');
    else if (a === 'undo' || a === 'redo') plUndo(a === 'redo');
    else if (a === 'zin') plZoomAt(PL.view.z * 1.25, null, null, true);
    else if (a === 'zout') plZoomAt(PL.view.z / 1.25, null, null, true);
    else if (a === 'z1') plZoomAt(1, null, null, true);
    else if (a === 'fit') plFit();
  });
  $('#pl-title').addEventListener('input', e => { PL.title = e.target.value.slice(0, 80); plSave(); });
  $('#pl-open').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const v = JSON.parse(await f.text()), d = v && v.app === 'montage' ? v.plot : v;
      if (!d || !Array.isArray(d.nodes)) throw new Error('не доска');
      plEditEnd(); plPush(); plotLoad(d); plDraw(); plSaveNow(); plFit(false, true);
      notifyAct(`Доска открыта: ${PL.nodes.length} ${plural(PL.nodes.length, 'событие', 'события', 'событий')}`, 'Вернуть прежнюю', () => plUndo());
    } catch { notify('Это не файл доски сюжета.'); }
  });
  const menu = $('#pl-menu');
  menu.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b && !b.disabled) plMenuAct(b); });
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); plMenuClose(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault(); const list = [...menu.querySelectorAll('button:not([disabled])')], i = list.indexOf(document.activeElement);
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  });
  document.addEventListener('pointerdown', e => { if (PL.menu && !e.target.closest('#pl-menu')) plMenuClose(false); }, true);
  board.addEventListener('keydown', plKey);
  board.addEventListener('focusout', e => { if (PL.edit && !(e.relatedTarget && PL.els.get(PL.edit.id)?.contains(e.relatedTarget))) setTimeout(() => { if (PL.edit && !PL.els.get(PL.edit.id)?.contains(document.activeElement)) plEditEnd(); }, 0); });
  board.addEventListener('input', e => { if (PL.edit && e.target.closest('.pl-card')) { const c = PL.els.get(PL.edit.id); if (c) { PL.h.set(PL.edit.id, c.offsetHeight); plLinks(); } } });
  board.addEventListener('contextmenu', e => {
    if (e.target.closest('.pl-zoom, .pl-empty-in') || (PL.edit && e.target.closest('.ed [data-f]'))) return;
    e.preventDefault(); plEditEnd();
    const card = e.target.closest('.pl-card'), lk = e.target.closest('.pl-l, .pl-lab');
    if (card) { if (!PL.sel.has(card.dataset.id)) PL.sel = new Set([card.dataset.id]); PL.link = -1; }
    else if (lk) { PL.link = +lk.dataset.l; PL.sel.clear(); }
    else { PL.sel.clear(); PL.link = -1; }
    plSelUi(); plLinks(); plMenuOpen(e.clientX, e.clientY, { link: lk ? +lk.dataset.l : -1 });
  });
  board.addEventListener('dblclick', e => {
    if (e.target.closest('.pl-zoom, .pl-empty-in, .pl-next, .pl-fork')) return;
    const card = e.target.closest('.pl-card'), lk = e.target.closest('.pl-l, .pl-lab');
    if (card) { const f = e.target.closest('[data-f]'); plEdit(card.dataset.id, f ? f.dataset.f : 't', f ? { x: e.clientX, y: e.clientY } : null); return; }
    if (lk) { plLabelEdit(+lk.dataset.l); return; }
    const w = plWorld(e.clientX, e.clientY); plAddAt(w.x - PLK.W / 2, w.y - PLK.ANCHOR);
  });
  board.addEventListener('wheel', e => {
    e.preventDefault(); cancelAnimationFrame(PL.vraf); PL.vraf = 0;
    const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    // щипок на тачпаде и колесо мыши — масштаб у курсора; прокрутка двумя пальцами — сдвиг доски
    const wheel = !e.ctrlKey && !e.deltaX && (e.deltaMode !== 0 || (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40));
    if (e.ctrlKey || e.metaKey || wheel) plZoomAt(PL.view.z * Math.exp(-e.deltaY * px * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY, false);
    else { PL.view.x -= e.deltaX * px; PL.view.y -= e.deltaY * px; plView(); plSave(); }
  }, { passive: false });

  board.addEventListener('pointerdown', e => {
    if (e.button === 2 || e.target.closest('.pl-zoom, .pl-empty-in')) return;
    if (PL.raf) { cancelAnimationFrame(PL.raf); PL.raf = 0; plSave(); }   // выравнивание можно перехватить на лету
    cancelAnimationFrame(PL.vraf); PL.vraf = 0;
    PL.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (PL.ptr.size === 2) {                     // второй палец — масштаб щипком; начатое перетаскивание заканчивается
      plGestureEnd(false);
      const [p, q] = [...PL.ptr.values()], r = plBoardRect(), c = { x: (p.x + q.x) / 2 - r.left, y: (p.y + q.y) / 2 - r.top };
      PL.g = { type: 'pinch', d0: Math.hypot(p.x - q.x, p.y - q.y) || 1, z0: PL.view.z, w: { x: (c.x - PL.view.x) / PL.view.z, y: (c.y - PL.view.y) / PL.view.z } };
      return;
    }
    if (PL.ptr.size > 2) return;
    const card = e.target.closest('.pl-card'), id = card && card.dataset.id;
    const start = { x0: e.clientX, y0: e.clientY, moved: false, pid: e.pointerId };
    if (e.target.closest('.pl-fork')) { e.preventDefault(); PL.g = { type: 'fork', id, ...start }; board.setPointerCapture(e.pointerId); return; }
    if (e.target.closest('.pl-next')) { e.preventDefault(); plEditEnd(); PL.g = { type: 'wire', from: id, ...start }; board.setPointerCapture(e.pointerId); return; }
    if (card) {
      if (PL.edit && PL.edit.id === id && e.target.closest('[data-f]')) { PL.ptr.delete(e.pointerId); return; }   // курсор и выделение в тексте
      e.preventDefault(); if (PL.edit) plEditEnd(); board.focus({ preventScroll: true });
      const wasSel = PL.sel.has(id), add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (add) { if (wasSel) PL.sel.delete(id); else PL.sel.add(id); } else if (!wasSel) PL.sel = new Set([id]);
      PL.link = -1; plSelUi(); plLinks();
      const ids = new Set(PL.sel.has(id) ? PL.sel : []);
      PL.g = { type: 'move', id, ids, from: new Map([...ids].map(i => { const n = plNode(i); return [i, { x: n.x, y: n.y }]; })), wasSel, add, field: e.target.closest('[data-f]') ? e.target.closest('[data-f]').dataset.f : null, ...start };
      board.setPointerCapture(e.pointerId); return;
    }
    const lab = e.target.closest('.pl-lab'); if (lab && lab.isContentEditable) return;
    const lk = e.target.closest('.pl-l, .pl-lab');
    e.preventDefault(); plEditEnd(); board.focus({ preventScroll: true });
    if (lk) { const i = +lk.dataset.l, again = PL.link === i && lab; PL.link = i; PL.sel.clear(); plSelUi(); plLinks(); PL.ptr.delete(e.pointerId); if (again) plLabelEdit(i); return; }
    PL.g = e.shiftKey ? { type: 'band', base: new Set(PL.sel), ...start } : { type: 'pan', vx: PL.view.x, vy: PL.view.y, ...start };
    board.setPointerCapture(e.pointerId);
  });
  board.addEventListener('pointermove', e => {
    if (!PL.ptr.has(e.pointerId)) return;
    PL.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = PL.g; if (!g) return;
    if (g.type === 'pinch') {
      const [p, q] = [...PL.ptr.values()]; if (!q) return;
      const r = plBoardRect(), c = { x: (p.x + q.x) / 2 - r.left, y: (p.y + q.y) / 2 - r.top }, z = plClampZ(g.z0 * Math.hypot(p.x - q.x, p.y - q.y) / g.d0);
      PL.view.z = z; PL.view.x = c.x - g.w.x * z; PL.view.y = c.y - g.w.y * z; plView(); return;
    }
    if (e.pointerId !== g.pid) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.moved && Math.hypot(dx, dy) < (e.pointerType === 'touch' ? 8 : 4)) return;
    if (g.type === 'fork') return;
    const first = !g.moved; g.moved = true;
    if (g.type === 'pan') { board.classList.add('panning'); PL.view.x = g.vx + dx; PL.view.y = g.vy + dy; plView(); }
    else if (g.type === 'move') {
      if (first) { if (!g.ids.size) { PL.sel = new Set([g.id]); g.ids = new Set([g.id]); const n = plNode(g.id); g.from.set(g.id, { x: n.x, y: n.y }); plSelUi(); } plPush(); g.ids.forEach(i => PL.els.get(i)?.classList.add('lift')); }
      const z = PL.view.z;
      for (const i of g.ids) { const n = plNode(i), f = g.from.get(i); if (n && f) { n.x = Math.round((f.x + dx / z) / 4) * 4; n.y = Math.round((f.y + dy / z) / 4) * 4; } }
      plMoveEls(g.ids); plLinks();
    } else if (g.type === 'wire') {
      g.pt = plWorld(e.clientX, e.clientY);
      const over = document.elementFromPoint(e.clientX, e.clientY), tc = over && over.closest('.pl-card'), tid = tc && tc.dataset.id !== g.from ? tc.dataset.id : null;
      if (tid !== g.tgt) { if (g.tgt) PL.els.get(g.tgt)?.classList.remove('tgt'); g.tgt = tid; if (tid) tc.classList.add('tgt'); }
      plLinks();
    } else if (g.type === 'band') {
      const r = plBoardRect(), x0 = Math.min(g.x0, e.clientX), y0 = Math.min(g.y0, e.clientY), x1 = Math.max(g.x0, e.clientX), y1 = Math.max(g.y0, e.clientY);
      const band = $('#pl-band'); band.hidden = false; Object.assign(band.style, { left: (x0 - r.left) + 'px', top: (y0 - r.top) + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px' });
      const a = plWorld(x0, y0), b = plWorld(x1, y1);
      PL.sel = new Set([...g.base, ...PL.nodes.filter(n => n.x < b.x && n.x + PLK.W > a.x && n.y < b.y && n.y + plH(n.id) > a.y).map(n => n.id)]); plSelUi();
    }
  });
  const up = e => {
    const had = PL.ptr.delete(e.pointerId), g = PL.g;
    if (!had || !g) return;
    if (g.type === 'pinch') { if (PL.ptr.size < 2) { PL.g = null; plSave(); } return; }
    if (e.pointerId !== g.pid) return;
    plGestureEnd(e.type === 'pointerup', e);
  };
  board.addEventListener('pointerup', up); board.addEventListener('pointercancel', up);
  board.addEventListener('lostpointercapture', e => { if (PL.g && PL.g.pid === e.pointerId && PL.g.type !== 'pinch') { PL.ptr.delete(e.pointerId); plGestureEnd(false); } });
}
/** Конец жеста. ok — палец отпущен (а не отменён): щелчок без сдвига — действие кнопки или выбор. */
function plGestureEnd(ok, e) {
  const g = PL.g; if (!g) return; PL.g = null;
  $('#pl-board')?.classList.remove('panning');
  if (g.type === 'move') {
    g.ids.forEach(i => PL.els.get(i)?.classList.remove('lift'));
    if (g.moved) { plSave(); return; }
    if (!ok) return;
    if (g.add) return;
    if (g.wasSel && g.field && PL.sel.size === 1) plEdit(g.id, g.field, e ? { x: e.clientX, y: e.clientY } : null);   // щелчок по тексту выбранной карточки — правка
    else if (PL.sel.size > 1) { PL.sel = new Set([g.id]); plSelUi(); }
  } else if (g.type === 'fork') { if (ok && g.id) plNext(g.id, true); }
  else if (g.type === 'wire') {
    if (g.tgt) PL.els.get(g.tgt)?.classList.remove('tgt');
    if (!ok) { plLinks(); return; }
    if (!g.moved) { plNext(g.from); return; }
    if (g.tgt) { if (!plConnect(g.from, g.tgt)) plLinks(); return; }
    const r = plBoardRect(), inside = e && e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
    if (inside && g.pt) plAddAt(g.pt.x, g.pt.y - PLK.ANCHOR, g.from); else plLinks();
  } else if (g.type === 'band') { $('#pl-band').hidden = true; PL.link = -1; plLinks(); }
  else if (g.type === 'pan') {
    if (g.moved) { plSave(); return; }
    if (!ok) return;
    PL.sel.clear(); PL.link = -1; plSelUi(); plLinks();
    // двойное касание пальцем — новое событие (dblclick на сенсорных экранах приходит не везде)
    const t = performance.now(), L = PL.tap;
    PL.tap = e && e.pointerType === 'touch' ? { t, x: e.clientX, y: e.clientY } : null;
    if (L && PL.tap && t - L.t < 350 && Math.hypot(L.x - e.clientX, L.y - e.clientY) < 30) { PL.tap = null; const w = plWorld(e.clientX, e.clientY); plAddAt(w.x - PLK.W / 2, w.y - PLK.ANCHOR); }
  }
}

// ------------------------------------------------------------------ текстом
/** План сюжета текстом: события по порядку, у развилки — ветки буквами со своими событиями; где ветки сходятся — ссылка. */
function plotText() {
  plotEnsure();
  const by = new Map(PL.nodes.map(n => [n.id, n])), num = new Map(), lines = [PL.title || 'Сюжет', ''];
  const outs = id => PL.links.filter(l => l.a === id).sort((p, q) => by.get(p.b).y - by.get(q.b).y || by.get(p.b).x - by.get(q.b).x);
  const ins = new Map(PL.nodes.map(n => [n.id, 0])); for (const l of PL.links) ins.set(l.b, ins.get(l.b) + 1);
  let k = 0;
  const walk = (id, ind) => {
    const n = by.get(id);
    if (num.has(id)) { lines.push(`${ind}→ к событию ${num.get(id)}${n.t ? ` «${n.t}»` : ''}`); return; }
    num.set(id, ++k);
    lines.push(`${ind}${k}. ${n.t || '(без названия)'}${n.k !== 'ev' ? ` [${plKindName(n.k).toLowerCase()}]` : ''}${n.sc != null ? ` — сцена ${n.sc}` : ''}`);
    for (const s of n.n ? n.n.split('\n') : []) lines.push(`${ind}   ${s}`);
    const o = outs(id);
    if (o.length === 1) { if (o[0].l) lines.push(`${ind}   (${o[0].l})`); walk(o[0].b, ind); }
    else if (o.length > 1) {
      lines.push(`${ind}   Развилка — ${o.length} ${plural(o.length, 'ветка', 'ветки', 'веток')}:`);
      o.forEach((l, i) => { lines.push(`${ind}   ${String.fromCharCode(1072 + i)}) ${l.l || 'ветка ' + (i + 1)}`); walk(l.b, ind + '      '); });
    }
  };
  const ids = PL.nodes.map(n => n.id), out = new Map(ids.map(i => [i, outs(i).map(l => l.b)]));
  for (const i of plStarts(ids, out, ins, (p, q) => by.get(p).x - by.get(q).x || by.get(p).y - by.get(q).y)) if (!num.has(i)) { walk(i, ''); lines.push(''); }
  return lines.join('\n').replace(/\n+$/, '\n');
}
