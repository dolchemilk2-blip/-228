/* ============================================================
   Шахматы на двоих — партия по переписке в общей комнате.

   В комнате лежит одна текущая партия (chess): кто белыми,
   строка ходов, предложение ничьей и итог. Каждый ход — это
   новая строка ходов; второй получает её сразу и видит, как
   фигура переезжает. Сыгранные партии копятся в chessGames —
   из них считается счёт.
   ============================================================ */

import { cloud, trackUnread } from './cloud.js';
import * as E from './chess-engine.js';
import { pieceSvg, pieceName } from './chess-pieces.js';

const $ = (id) => document.getElementById(id);
const esc = App.escapeHtml;
const TOUCH = matchMedia('(pointer: coarse)').matches;

App.init();

const meKey = App.getMe() || 'a';
const otherKey = meKey === 'a' ? 'b' : 'a';
const nameOf = (k) => App.person(k).name;
document.addEventListener('me-changed', () => location.reload());

/* ---------------- состояние ---------------- */

let game = null;          // партия из комнаты; null — ещё не начинали
let rep = E.replay('');   // разобранная партия: позиции и ходы
let view = null;          // какую позицию смотрим; null — текущую
let selected = -1;        // выбранная фигура
let targets = [];         // её возможные ходы
let drag = null;
let promoting = null;
let partnerOnline = false;
let firstLoad = true;

function normalize(raw) {
  if (!raw || !raw.id) return null;
  const end = raw.end && raw.end.reason ? {
    winner: raw.end.winner === 'a' || raw.end.winner === 'b' ? raw.end.winner : null,
    reason: raw.end.reason,
    by: raw.end.by || null
  } : null;
  return {
    id: raw.id,
    white: raw.white === 'b' ? 'b' : 'a',
    moves: typeof raw.moves === 'string' ? raw.moves.trim() : '',
    by: raw.by || null,
    at: raw.at || 0,
    drawOffer: raw.drawOffer === 'a' || raw.drawOffer === 'b' ? raw.drawOffer : null,
    end,
    logged: Boolean(raw.logged)
  };
}

// пока партии нет, доска стоит со стороны белых, белые — вы
const myColor = () => (game && game.white === otherKey ? 'b' : 'w');
const keyOf = (color) => (color === myColor() ? meKey : otherKey);
const flipped = () => myColor() === 'b';

function result() {
  if (!game) return null;
  if (game.end) return game.end;
  if (rep.end) return { winner: rep.end.winner ? keyOf(rep.end.winner) : null, reason: rep.end.reason };
  return null;
}
const live = () => Boolean(game) && !result();
const myTurn = () => live() && rep.state.turn === myColor();
const canMove = () => myTurn() && view === null && !promoting;
const shown = () => (view === null ? rep.states.length - 1 : view);

/* ============================================================
   Доска
   ============================================================ */

const boardEl = $('board');
const squaresEl = $('squares');
const piecesEl = $('pieces');
const sqEls = new Array(64);
let orientation = null;

// клетка → место на экране (в клетках, от левого верхнего угла)
function disp(i) {
  const r = i >> 3, c = i & 7;
  return flipped() ? [7 - c, 7 - r] : [c, r];
}

function buildSquares() {
  orientation = flipped();
  squaresEl.innerHTML = '';
  for (let d = 0; d < 64; d++) {
    const i = orientation ? 63 - d : d;
    const r = i >> 3, c = i & 7;
    const el = document.createElement('div');
    el.className = 'sq' + ((r + c) % 2 ? ' dk' : '');
    el.setAttribute('role', 'gridcell');
    let co = '';
    if ((d & 7) === 0) co += '<span class="co rank" aria-hidden="true">' + (8 - r) + '</span>';
    if (d >> 3 === 7) co += '<span class="co file" aria-hidden="true">' + E.FILES[c] + '</span>';
    el.innerHTML = co;
    squaresEl.appendChild(el);
    sqEls[i] = el;
  }
}

/* ---------------- фигуры ----------------
   Каждая фигура — отдельный слой поверх клеток. Позиция задаётся
   в клетках, поэтому доска любого размера. Двигаются пружинами
   по двум осям — их можно перехватить и бросить пальцем. */

const pcs = new Map();    // клетка → фигура на экране

// отдельное свойство translate, а не transform: тогда «подъём»,
// появление и покачивание (scale, rotate) идут вокруг центра фигуры
function setPos(el, x, y) {
  el._x = x; el._y = y;
  el.style.translate = (x * 100).toFixed(2) + '% ' + (y * 100).toFixed(2) + '%';
}

function stopSlide(el) {
  if (el._anims) el._anims.forEach((a) => a.stop());
  el._anims = null;
  el.classList.remove('moving');
}

function slide(el, x, y, o = {}) {
  stopSlide(el);
  let cx = el._x * 100, cy = el._y * 100, left = 2;
  el.classList.add('moving');
  const fin = () => {
    if (--left) return;
    el._anims = null;
    el.classList.remove('moving');
    if (o.done) o.done();
  };
  const common = { damping: o.damping == null ? 0.86 : o.damping, response: o.response || 0.34 };
  el._anims = [
    App.spring({ ...common, from: cx, to: x * 100, velocity: o.vx || 0,
      onUpdate: (v) => { cx = v; setPos(el, cx / 100, cy / 100); }, onDone: fin }),
    App.spring({ ...common, from: cy, to: y * 100, velocity: o.vy || 0,
      onUpdate: (v) => { cy = v; setPos(el, cx / 100, cy / 100); }, onDone: fin })
  ];
}

function makePiece(p) {
  const el = document.createElement('div');
  el.className = 'pc';
  el.dataset.p = p;
  el.innerHTML = pieceSvg(p);
  piecesEl.appendChild(el);
  return el;
}

function pop(el) {
  if (App.reduceMotion()) return;
  el.classList.remove('born');
  void el.offsetWidth;
  el.classList.add('born');
  el.addEventListener('animationend', () => el.classList.remove('born'), { once: true });
}

/* Переход доски к новой позиции — любой: ход, отмена хода,
   новая партия, просмотр старых ходов. Фигура, что стоит на месте,
   стоит; та, что сменила клетку, едет (если такая же нашлась
   рядом); съеденная тает; новая появляется. */
function draw(board, o = {}) {
  const animate = o.animate !== false && !firstLoad;
  const next = new Map();
  const used = new Set();
  const moving = [];
  const take = (sq, el) => { next.set(sq, el); used.add(el); };

  const h = o.hint;
  if (h && pcs.get(h.from) && board[h.to]) {
    const el = pcs.get(h.from);
    take(h.to, el);
    moving.push([el, h.to, board[h.to]]);
  }
  board.forEach((p, sq) => {
    if (!p || next.has(sq)) return;
    const el = pcs.get(sq);
    if (el && !used.has(el) && el.dataset.p === p) take(sq, el);
  });
  board.forEach((p, sq) => {
    if (!p || next.has(sq)) return;
    let best = null, bestD = Infinity;
    pcs.forEach((el, from) => {
      if (used.has(el) || el.dataset.p !== p) return;
      const d = Math.hypot((from & 7) - (sq & 7), (from >> 3) - (sq >> 3));
      if (d < bestD) { bestD = d; best = el; }
    });
    if (best) { take(sq, best); moving.push([best, sq, p]); }
  });

  // съеденные — тают чуть позже, когда до них «доехали»
  pcs.forEach((el) => {
    if (used.has(el)) return;
    stopSlide(el);
    if (!animate) { el.remove(); return; }
    setTimeout(() => el.classList.add('gone'), moving.length ? 130 : 0);
    setTimeout(() => el.remove(), 480);
  });

  board.forEach((p, sq) => {
    if (!p || next.has(sq)) return;
    const el = makePiece(p);
    const [x, y] = disp(sq);
    setPos(el, x, y);
    if (animate) pop(el);
    next.set(sq, el);
  });

  pcs.clear();
  next.forEach((el, sq) => pcs.set(sq, el));

  const movers = new Set(moving.map((m) => m[0]));
  moving.forEach(([el, sq, p]) => {
    const [x, y] = disp(sq);
    const swap = () => {
      if (el.dataset.p === p) return;
      el.dataset.p = p;
      el.innerHTML = pieceSvg(p);
      pop(el);
    };
    if (!animate) { stopSlide(el); setPos(el, x, y); swap(); return; }
    slide(el, x, y, { ...(o.slide || {}), done: swap });
  });
  // фигуры на своих клетках, но не на своём месте (доску развернули)
  next.forEach((el, sq) => {
    if (movers.has(el)) return;
    const [x, y] = disp(sq);
    if (el._x === x && el._y === y) return;
    if (animate) slide(el, x, y); else setPos(el, x, y);
  });
}

/* ---------------- подсветка клеток ---------------- */

let kc = -1;   // клетка под «курсором» клавиатуры

function paintMarks() {
  const k = shown();
  const st = rep.states[k];
  const last = k > 0 ? rep.moves[k - 1] : null;
  const to = new Map();
  if (view === null) targets.forEach((m) => to.set(m.to, m));
  const checkSq = E.inCheck(st) ? E.kingSquare(st.board, st.turn) : -1;

  for (let i = 0; i < 64; i++) {
    const el = sqEls[i];
    el.classList.toggle('last', Boolean(last) && (i === last.from || i === last.to));
    el.classList.toggle('sel', view === null && i === selected);
    el.classList.toggle('to', to.has(i));
    el.classList.toggle('cap', to.has(i) && Boolean(st.board[i]));
    el.classList.toggle('check', i === checkSq);
    el.classList.toggle('kf', i === kc);
    const p = st.board[i];
    el.setAttribute('aria-label', E.sqName(i) + (p ? ', ' + pieceName(p) : '') + (to.has(i) ? ', можно пойти' : ''));
  }
}

function select(sq) {
  selected = sq;
  targets = sq >= 0 && canMove() ? E.legalMoves(rep.state, sq) : [];
  paintMarks();
}

const isMine = (sq) => {
  const p = rep.state.board[sq];
  return Boolean(p) && E.colorOf(p) === myColor();
};

function squareAt(clientX, clientY) {
  const r = boardEl.getBoundingClientRect();
  const x = Math.floor(((clientX - r.left) / r.width) * 8);
  const y = Math.floor(((clientY - r.top) / r.height) * 8);
  if (x < 0 || x > 7 || y < 0 || y > 7) return -1;
  return flipped() ? (7 - y) * 8 + (7 - x) : y * 8 + x;
}

/* ============================================================
   Ход: пальцем (перетащить) или двумя касаниями
   ============================================================ */

let lastNudge = 0;
function nudge(sq) {
  const el = pcs.get(sq);
  if (el && el.animate && !App.reduceMotion()) {
    el.animate([{ rotate: '0deg' }, { rotate: '-9deg' }, { rotate: '7deg' }, { rotate: '-4deg' }, { rotate: '0deg' }],
      { duration: 380, easing: 'ease-out' });
  }
  if (!game) return;               // шторку «Новая партия» откроет click — см. ниже
  if (Date.now() - lastNudge < 2200) return;
  lastNudge = Date.now();
  if (view !== null) { App.toast('Это старая позиция', { action: 'К партии', onAction: () => setView(null) }); return; }
  if (result()) { App.toast('Партия окончена', { action: 'Реванш', onAction: rematch }); return; }
  if (!myTurn() && el) App.toast('Сейчас ходит ' + nameOf(otherKey));
}

// касание клетки — без перетаскивания (и с клавиатуры)
function activate(sq) {
  if (promoting || sq < 0) return;
  if (!canMove()) { nudge(sq); return; }
  if (selected >= 0 && targets.some((m) => m.to === sq)) { tryMove(selected, sq); return; }
  if (isMine(sq)) { select(selected === sq ? -1 : sq); return; }
  if (selected >= 0) select(-1);
}

boardEl.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || promoting) return;
  const sq = squareAt(e.clientX, e.clientY);
  if (sq < 0) return;
  if (!canMove() || !isMine(sq) || (selected >= 0 && targets.some((m) => m.to === sq))) {
    activate(sq);
    return;
  }
  const el = pcs.get(sq);
  const was = selected === sq;
  if (!was) select(sq);
  const r = boardEl.getBoundingClientRect();
  drag = { sq, el, was, id: e.pointerId, x0: e.clientX, y0: e.clientY, size: r.width / 8, active: false, hover: -1, tr: App.tracker() };
  drag.tr.add(e.clientX, e.clientY);
  try { boardEl.setPointerCapture(e.pointerId); } catch (err) {}
});

function setHover(sq) {
  if (!drag || drag.hover === sq) return;
  if (drag.hover >= 0) sqEls[drag.hover].classList.remove('hover');
  drag.hover = sq;
  if (sq >= 0 && sq !== drag.sq && targets.some((m) => m.to === sq)) sqEls[sq].classList.add('hover');
}

boardEl.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.tr.add(e.clientX, e.clientY);
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.active) {
    if (Math.hypot(dx, dy) < (TOUCH ? 6 : 3)) return;
    // фигуру подняли: она идёт за пальцем 1:1, с того места, где была
    drag.active = true;
    stopSlide(drag.el);
    const [x, y] = disp(drag.sq);
    drag.gx = x; drag.gy = y;
    drag.el.classList.add('lifted');
    App.haptic();
  }
  setPos(drag.el, drag.gx + dx / drag.size, drag.gy + dy / drag.size);
  setHover(squareAt(e.clientX, e.clientY));
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  setHover(-1);
  drag = null;
  if (!d.active) {
    if (d.was) select(-1);       // второе касание той же фигуры — снять выбор
    return;
  }
  d.el.classList.remove('lifted');
  const to = e.type === 'pointerup' ? squareAt(e.clientX, e.clientY) : -1;
  if (to >= 0 && to !== d.sq && targets.some((m) => m.to === to)) {
    tryMove(d.sq, to, { dropped: true });
    return;
  }
  // не туда — фигура возвращается с той скоростью, с какой её бросили
  const v = d.tr.velocity();
  const [x, y] = disp(d.sq);
  slide(d.el, x, y, { vx: (v.x / d.size) * 100, vy: (v.y / d.size) * 100, damping: 0.75, response: 0.32 });
}
// партии ещё нет — касание доски предлагает начать. По click, а не по
// pointerdown: иначе отпущенный палец попадёт в фон шторки и закроет её
boardEl.addEventListener('click', (e) => { if (!game && !e.target.closest('.promo')) openNewGame(); });
boardEl.addEventListener('pointerup', endDrag);
boardEl.addEventListener('pointercancel', endDrag);

function cancelInteraction() {
  if (drag) {
    drag.el.classList.remove('lifted');
    setHover(-1);
    drag = null;
  }
  const ov = boardEl.querySelector('.promo');
  if (ov) ov.remove();
  promoting = null;
  selected = -1;
  targets = [];
}

function tryMove(from, to, o = {}) {
  const options = targets.filter((m) => m.from === from && m.to === to);
  if (!options.length) return;
  if (options[0].promo) { askPromotion(from, to, o); return; }
  commit(options[0], o);
}

/* Пешка дошла до края: рядом с ней раскрывается столбик фигур */
function askPromotion(from, to, o) {
  const pawn = pcs.get(from);
  const [x, y] = disp(to);
  slide(pawn, x, y, o.dropped ? { damping: 1, response: 0.2 } : {});
  promoting = { from, to };

  const color = myColor();
  const order = y === 0 ? ['q', 'n', 'r', 'b'] : ['b', 'r', 'n', 'q'];
  const ov = document.createElement('div');
  ov.className = 'promo';
  ov.innerHTML = '<div class="promo-col" role="group" aria-label="Во что превратить пешку" style="left:' + (x * 12.5) + '%;' +
    (y === 0 ? 'top:0' : 'bottom:0') + '">' +
    order.map((t) => {
      const p = color === 'w' ? t.toUpperCase() : t;
      return '<button type="button" data-t="' + t + '" aria-label="' + esc(pieceName(p)) + '">' + pieceSvg(p) + '</button>';
    }).join('') + '</div>';
  boardEl.appendChild(ov);
  App.haptic();
  setTimeout(() => { const b = ov.querySelector('button'); if (b && !TOUCH) b.focus(); }, 50);

  const finish = (t) => {
    ov.remove();
    promoting = null;
    if (!t) {
      const [fx, fy] = disp(from);
      slide(pawn, fx, fy);
      return;
    }
    const m = targets.find((x) => x.from === from && x.to === to && x.promo === t);
    if (m) commit(m, {});
  };
  // столбик появился прямо под пальцем: то же касание, отпущенное
  // над ним, ничего не выбирает — нужен новый тап (или клавиатура)
  let armed = false;
  ov.addEventListener('pointerdown', () => { armed = true; });
  ov.addEventListener('click', (e) => {
    if (!armed && e.detail !== 0) return;
    const b = e.target.closest('button[data-t]');
    finish(b ? b.dataset.t : null);
  });
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } });
}

/* Свой ход: сразу на доске, следом — в комнату */
function commit(m, o = {}) {
  const line = (game.moves ? game.moves + ' ' : '') + E.uciOf(m);
  rep = E.replay(line);
  selected = -1;
  targets = [];
  App.haptic();
  draw(rep.state.board, { hint: m, slide: o.dropped ? { damping: 1, response: 0.2 } : { damping: 0.88, response: 0.32 } });

  const patch = {
    moves: line,
    by: meKey,
    at: Date.now(),
    // ход вместо ответа на предложение ничьей — значит, «нет»
    drawOffer: game.drawOffer === meKey ? meKey : null
  };
  if (rep.end) {
    patch.end = { winner: rep.end.winner ? keyOf(rep.end.winner) : null, reason: rep.end.reason, by: meKey };
    patch.drawOffer = null;
    patch.logged = true;
  }
  Object.assign(game, patch);
  renderAll();
  cloud.update('chess', patch);
  if (patch.end) { logGame(patch.end); celebrate(patch.end); }
}

function logGame(end) {
  cloud.push('chessGames', {
    id: game.id, white: game.white,
    winner: end.winner, reason: end.reason,
    plies: rep.moves.length, by: meKey
  });
}

function celebrate(res) {
  if (res.winner === meKey) {
    App.haptic();
    App.rainHearts(3);
    const r = boardEl.getBoundingClientRect();
    App.burst(r.left + r.width / 2, r.top + r.height / 2, ['🏆', '✨', '💜', '💙', '♟️'], 18);
  }
}

/* ---------------- клавиатура ----------------
   Стрелки водят рамку по доске, Enter/пробел — как касание.
   Вне доски ← и → листают ходы партии. */

boardEl.tabIndex = 0;
boardEl.addEventListener('focus', () => {
  if (kc < 0) kc = E.kingSquare(rep.state.board, myColor());
  paintMarks();
});
boardEl.addEventListener('keydown', (e) => {
  const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (dirs[e.key]) {
    e.preventDefault();
    let [x, y] = disp(kc < 0 ? 0 : kc);
    x = Math.max(0, Math.min(7, x + dirs[e.key][0]));
    y = Math.max(0, Math.min(7, y + dirs[e.key][1]));
    kc = flipped() ? (7 - y) * 8 + (7 - x) : y * 8 + x;
    paintMarks();
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(kc); }
  if (e.key === 'Escape' && selected >= 0) select(-1);
});
document.addEventListener('keydown', (e) => {
  if (e.target !== document.body || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowLeft') stepView(-1);
  if (e.key === 'ArrowRight') stepView(1);
});

/* ============================================================
   Просмотр старых ходов
   ============================================================ */

function setView(k) {
  const max = rep.moves.length;
  const from = shown();
  const nextK = k == null || k >= max ? null : Math.max(0, k);
  const to = nextK === null ? max : nextK;
  if (to === from && nextK === view) return;
  view = nextK;
  if (promoting || drag) cancelInteraction();
  selected = -1;
  targets = [];
  // на один ход вперёд или назад — подсказываем, какая фигура едет
  let hint = null;
  if (to === from + 1) hint = rep.moves[from];
  else if (to === from - 1) { const m = rep.moves[to]; hint = { from: m.to, to: m.from }; }
  draw(rep.states[to].board, { hint, slide: { damping: 0.9, response: 0.28 } });
  renderAll();
}
function stepView(d) { setView(shown() + d); }

$('prev').addEventListener('click', () => stepView(-1));
$('next').addEventListener('click', () => stepView(1));
$('moves').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ply]');
  if (b) setView(+b.dataset.ply);
});

/* ============================================================
   Что показываем вокруг доски
   ============================================================ */

function capsHtml(color, mat) {
  // у игрока — то, что он съел, то есть потери соперника
  const foe = color === 'w' ? 'b' : 'w';
  const lost = mat.lost[foe];
  const adv = color === 'w' ? mat.diff : -mat.diff;
  if (!lost.length && adv <= 0) return '<span class="none">ничего не съедено</span>';
  return lost.map((t) => pieceSvg(foe === 'w' ? t.toUpperCase() : t)).join('') +
    (adv > 0 ? '<b>+' + adv + '</b>' : '');
}

function renderPlayers() {
  const st = rep.states[shown()];
  const mat = E.material(st.board);
  const res = result();
  [['p-top', myColor() === 'w' ? 'b' : 'w'], ['p-bottom', myColor()]].forEach(([id, color]) => {
    const key = keyOf(color);
    const box = $(id);
    const turn = Boolean(game) && !res && view === null && rep.state.turn === color;
    box.classList.toggle('turn', turn);
    box.classList.toggle('me', key === meKey);
    box.innerHTML =
      App.avatar(key) +
      '<div class="p-info">' +
        '<div class="p-name">' + esc(nameOf(key)) + (key === meKey ? ' <span class="faint" style="font-weight:400">(вы)</span>' : '') +
          '<span class="p-color ' + color + '" title="' + (color === 'w' ? 'белые' : 'чёрные') + '"></span></div>' +
        '<div class="p-caps">' + capsHtml(color, mat) + '</div>' +
      '</div>' +
      '<span class="p-turn">' + (key === meKey ? 'ваш ход' : 'думает') + '</span>';
    const ava = box.querySelector('.ava');
    if (ava && key === otherKey) ava.classList.toggle('is-online', partnerOnline);
  });
}

const END_TEXT = {
  mate: 'мат',
  resign: 'сдача',
  stalemate: 'пат',
  material: 'не хватает фигур для мата',
  fifty: '50 ходов без взятий',
  repetition: 'позиция повторилась трижды',
  agreed: 'по согласию'
};

function resultTitle(res) {
  if (res.winner === meKey) return res.reason === 'resign' ? nameOf(otherKey) + ' сдался — победа ваша 🎉' : 'Мат! Вы победили 🎉';
  if (res.winner === otherKey) return res.reason === 'resign' ? 'Вы сдались. Победил ' + nameOf(otherKey) : 'Мат. Победил ' + nameOf(otherKey);
  if (res.reason === 'stalemate') return 'Пат — ничья';
  if (res.reason === 'agreed') return 'Ничья по согласию';
  return 'Ничья';
}

const movesWord = (n) => n + ' ' + App.plural(n, 'ход', 'хода', 'ходов');

function statusData() {
  const res = result();
  const btn = (label, act, cls) => '<button class="btn small ' + (cls || '') + '" type="button" data-act="' + act + '">' + label + '</button>';
  if (!game) {
    return { main: 'Сыграем?', sub: 'Выберите цвет — партия появится у обоих', actions: btn('Начать', 'new') };
  }
  if (view !== null) {
    return {
      main: 'Ход ' + view + ' из ' + rep.moves.length,
      sub: view ? rep.moves[view - 1].san + ' — ' + nameOf(keyOf(rep.states[view - 1].turn)) : 'начальная позиция',
      actions: btn('К партии', 'live', 'tinted')
    };
  }
  if (res) {
    const full = Math.ceil(rep.moves.length / 2);
    return {
      main: resultTitle(res),
      sub: (res.reason !== 'mate' && res.reason !== 'resign' && res.reason !== 'agreed' ? END_TEXT[res.reason] + ' · ' : '') +
        movesWord(full) + (game.at ? ' · ' + App.formatWhen(game.at) : ''),
      cls: res.winner === meKey ? 'win' : '',
      actions: btn('Реванш', 'rematch')
    };
  }
  if (game.drawOffer === otherKey) {
    return {
      main: nameOf(otherKey) + ' предлагает ничью',
      sub: 'Согласиться — и партия закончится',
      actions: btn('Нет', 'decline', 'gray') + btn('Да', 'accept')
    };
  }
  const last = rep.moves[rep.moves.length - 1];
  const lastText = last
    ? (keyOf(E.colorOf(last.piece)) === meKey ? 'Вы сходили ' : nameOf(otherKey) + ' сходил ') + last.san +
      (game.at ? ' · ' + App.formatWhen(game.at) : '')
    : '';
  if (myTurn()) {
    const check = E.inCheck(rep.state);
    return {
      main: check ? 'Шах! Ваш ход' : 'Ваш ход',
      sub: lastText || 'Белые начинают',
      cls: check ? 'alert' : ''
    };
  }
  return {
    main: 'Ходит ' + nameOf(otherKey),
    sub: game.drawOffer === meKey ? 'Вы предложили ничью — ждём ответа'
      : partnerOnline ? nameOf(otherKey) + ' на сайте — ждём ответ'
      : (lastText || nameOf(otherKey) + ' увидит партию, когда зайдёт')
  };
}

let lastStatus = '';
function renderStatus() {
  const d = statusData();
  const box = $('status');
  $('s-main').textContent = d.main;
  $('s-sub').textContent = d.sub || '';
  $('s-actions').innerHTML = d.actions || '';
  box.classList.toggle('win', d.cls === 'win');
  box.classList.toggle('alert', d.cls === 'alert');
  // заметная смена — короткое «появление», мелкая — без него
  if (lastStatus && lastStatus !== d.main && !App.reduceMotion()) {
    box.classList.remove('enter');
    void box.offsetWidth;
    box.classList.add('enter');
  }
  lastStatus = d.main;
}

$('s-actions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'new') openNewGame();
  if (act === 'live') setView(null);
  if (act === 'rematch') rematch();
  if (act === 'accept') acceptDraw();
  if (act === 'decline') {
    game.drawOffer = null;
    cloud.update('chess', { drawOffer: null });
    renderAll();
  }
});

function renderMoves() {
  const box = $('moves');
  const cur = shown();
  if (!rep.moves.length) {
    box.innerHTML = '<span class="empty">' + (game ? 'Ходов пока нет' : 'Партия ещё не началась') + '</span>';
  } else {
    let html = '';
    rep.moves.forEach((m, i) => {
      if (i % 2 === 0) html += '<span class="n">' + (i / 2 + 1) + '.</span>';
      html += '<button type="button" data-ply="' + (i + 1) + '" aria-current="' + (cur === i + 1) + '">' + esc(m.san) + '</button>';
    });
    box.innerHTML = html;
    const b = box.querySelector('[aria-current="true"]');
    if (b) {
      const left = b.offsetLeft - box.clientWidth / 2 + b.offsetWidth / 2;
      box.scrollTo({ left, behavior: firstLoad || App.reduceMotion() ? 'auto' : 'smooth' });
    }
  }
  $('prev').disabled = cur <= 0;
  $('next').disabled = view === null;
}

function renderTools() {
  const on = live() && view === null;
  const mineLast = on && rep.moves.length > 0 && rep.state.turn !== myColor();
  $('t-undo').disabled = !mineLast;
  $('t-draw').disabled = !on || game.drawOffer === meKey;
  $('t-resign').disabled = !on;
  $('tools').classList.toggle('hidden', !live());
}

function renderAll() {
  if (orientation !== flipped()) {
    buildSquares();
    draw(rep.states[shown()].board);
  }
  boardEl.classList.toggle('idle', !game);
  boardEl.classList.toggle('review', view !== null);
  boardEl.style.cursor = canMove() ? 'pointer' : '';
  paintMarks();
  renderPlayers();
  renderStatus();
  renderMoves();
  renderTools();
  $('page-sub').textContent = game
    ? 'Вы играете ' + (myColor() === 'w' ? 'белыми' : 'чёрными') + '. Ходите, когда удобно, — ' + nameOf(otherKey) + ' увидит ход сразу.'
    : 'Партия на двоих: ходите, когда удобно, — второй увидит ход сразу.';
}

/* ============================================================
   Кнопки партии
   ============================================================ */

$('t-undo').addEventListener('click', () => {
  if (!game || !game.moves) return;
  const parts = game.moves.split(' ');
  parts.pop();
  cloud.update('chess', { moves: parts.join(' '), by: meKey, at: Date.now() });
});

$('t-draw').addEventListener('click', () => {
  if (!live()) return;
  if (game.drawOffer === otherKey) { acceptDraw(); return; }
  game.drawOffer = meKey;
  cloud.update('chess', { drawOffer: meKey });
  renderAll();
  App.toast('Предложили ничью — ждём ответа');
});

function acceptDraw() {
  const end = { winner: null, reason: 'agreed', by: meKey };
  game.end = end;
  game.drawOffer = null;
  cloud.update('chess', { end, drawOffer: null, logged: true, at: Date.now() });
  logGame(end);
  renderAll();
}

$('t-resign').addEventListener('click', () => {
  if (!live()) return;
  const s = App.sheet({
    title: 'Сдаться?',
    body: '<p class="muted">Победа достанется сопернику — ' + esc(nameOf(otherKey)) + '. Реванш можно начать сразу.</p>',
    foot:
      '<button class="btn gray" type="button" data-close>Играть дальше</button>' +
      '<button class="btn" type="button" id="rs-yes" style="--b-bg:var(--danger)">Сдаться</button>'
  });
  s.$('#rs-yes').addEventListener('click', () => {
    s.close();
    if (!live()) return;
    const end = { winner: otherKey, reason: 'resign', by: meKey };
    game.end = end;
    game.drawOffer = null;
    cloud.update('chess', { end, drawOffer: null, logged: true, at: Date.now() });
    logGame(end);
    renderAll();
  });
});

$('new-game').addEventListener('click', openNewGame);

function openNewGame() {
  let pick = game ? (game.white === meKey ? 'b' : 'w') : 'w';   // по умолчанию — поменяться цветом
  const busy = live() && rep.moves.length > 0;
  const s = App.sheet({
    title: 'Новая партия',
    body:
      '<div class="field new-game-colors">' +
        '<span class="label">Я играю</span>' +
        '<div class="segmented" id="ng-color" role="group" aria-label="Цвет фигур">' +
          '<span class="thumb" aria-hidden="true"></span>' +
          [['w', 'Белыми'], ['b', 'Чёрными'], ['r', 'Наугад']].map(([k, t]) =>
            '<button type="button" data-k="' + k + '" aria-pressed="' + (k === pick) + '">' + t + '</button>').join('') +
        '</div>' +
      '</div>' +
      '<p class="hint" style="margin-top:12px">Белые ходят первыми. ' + esc(nameOf(otherKey)) + ' увидит новую доску сразу.</p>' +
      (busy ? '<p class="hint" style="margin-top:6px;color:var(--danger)">Текущая партия закончится без результата.</p>' : ''),
    foot:
      '<button class="btn gray" type="button" data-close>Отмена</button>' +
      '<button class="btn" type="button" id="ng-start">Начать</button>'
  });
  App.segmented(s.$('#ng-color'), (b) => { pick = b.dataset.k; });
  s.$('#ng-start').addEventListener('click', () => {
    s.close();
    const meWhite = pick === 'w' || (pick === 'r' && Math.random() < 0.5);
    startGame(meWhite ? meKey : otherKey);
  });
}

function rematch() {
  startGame(game && game.white === meKey ? otherKey : meKey);
}

function startGame(white) {
  cancelInteraction();
  cloud.set('chess', { id: Date.now(), white, moves: '', by: meKey, at: Date.now(), drawOffer: null, end: null, logged: false });
  App.haptic();
  App.toast(white === meKey ? 'Вы играете белыми — ваш ход' : 'Вы играете чёрными — первым ходит ' + nameOf(otherKey));
}

/* ============================================================
   Счёт и последние партии
   ============================================================ */

function renderScore(data) {
  const list = Object.values(data || {}).filter((g) => g && g.reason).sort((x, y) => (y.at || 0) - (x.at || 0));
  const wins = { a: 0, b: 0 };
  let draws = 0;
  list.forEach((g) => { if (g.winner === 'a' || g.winner === 'b') wins[g.winner]++; else draws++; });

  const box = $('score');
  if (!box.dataset.ready) {
    box.innerHTML =
      '<div class="side">' + App.avatar('a', 'lg') + esc(nameOf('a')) + '</div>' +
      '<div class="big" id="score-num"></div>' +
      '<div class="side">' + App.avatar('b', 'lg') + esc(nameOf('b')) + '</div>' +
      '<div class="draws" id="score-draws"></div>';
    box.dataset.ready = '1';
  }
  App.roll($('score-num'), wins.a + ' : ' + wins.b);
  $('score-draws').textContent = list.length
    ? (draws ? 'ничьих: ' + draws + ' · ' : '') + 'всего ' + list.length + ' ' + App.plural(list.length, 'партия', 'партии', 'партий')
    : 'Пока ни одной сыгранной партии';

  const hist = $('history');
  hist.classList.toggle('hidden', !list.length);
  hist.innerHTML = list.slice(0, 5).map((g) => {
    const w = g.winner === 'a' || g.winner === 'b' ? g.winner : null;
    const title = w ? 'Победил ' + nameOf(w) + (g.reason === 'resign' ? ' — соперник сдался' : g.reason === 'mate' ? ' — мат' : '')
      : 'Ничья' + (END_TEXT[g.reason] ? ' — ' + END_TEXT[g.reason] : '');
    const full = Math.ceil((g.plies || 0) / 2);
    return '<div class="row-item">' +
      '<span class="res"' + (w ? ' data-p="' + w + '"' : '') + ' aria-hidden="true">' + (w ? esc(App.initial(w)) : '½') + '</span>' +
      '<span class="grow"><span class="title">' + esc(title) + '</span>' +
      '<span class="sub" style="display:block">' + movesWord(full) + (g.at ? ' · ' + esc(App.formatWhen(g.at)) : '') + '</span></span>' +
    '</div>';
  }).join('');
}

/* ============================================================
   Связь с комнатой
   ============================================================ */

buildSquares();
draw(rep.state.board, { animate: false });
renderAll();

function onRemote(raw) {
  const g = normalize(raw);
  const prev = game;
  const prevRep = rep;
  const prevRes = result();

  if (!g) {
    game = null;
    if (prev) { cancelInteraction(); view = null; rep = E.replay(''); draw(rep.state.board); }
    renderAll();
    firstLoad = false;
    return;
  }

  const fresh = !prev || prev.id !== g.id;
  const movesChanged = fresh || prev.moves !== g.moves;
  game = g;

  if (movesChanged) {
    rep = E.replay(g.moves);
    if (fresh) {
      cancelInteraction();
      view = null;
      if (orientation !== flipped()) buildSquares();
      draw(rep.state.board, { slide: { damping: 0.9, response: 0.5 } });
      if (prev && g.by === otherKey) {
        App.toast(nameOf(otherKey) + ' начал новую партию — вы ' + (myColor() === 'w' ? 'белыми, ваш ход' : 'чёрными'));
      }
    } else {
      const was = prevRep.moves.length, now = rep.moves.length;
      if (drag || promoting) cancelInteraction();
      if (view !== null && view > now) view = null;
      if (view === null) {
        let hint = null;
        if (now === was + 1) hint = rep.moves[was];
        else if (now === was - 1) { const m = prevRep.moves[now]; hint = { from: m.to, to: m.from }; }
        draw(rep.state.board, { hint, slide: { damping: 0.86, response: 0.42 } });
      }
      selected = -1;
      targets = [];
      if (g.by === otherKey && now > was) App.haptic();
      if (g.by === otherKey && now < was) App.toast(nameOf(otherKey) + ' передумал и вернул ход');
      if (g.by === meKey && now < was) App.toast('Ход вернули — ходите снова');
    }
  }

  renderAll();

  const res = result();
  if (!firstLoad && res && !prevRes && !fresh && g.end && g.end.by === otherKey) {
    celebrate(res);
    if (res.reason === 'agreed') App.toast(nameOf(otherKey) + ' согласился на ничью');
  }
  if (!firstLoad && prev && !fresh && g.drawOffer === otherKey && prev.drawOffer !== otherKey) App.haptic();
  if (!firstLoad && prev && !fresh && prev.drawOffer === meKey && !g.drawOffer && !g.end && g.by !== otherKey) {
    App.toast(nameOf(otherKey) + ' отказался от ничьей');
  }
  firstLoad = false;
}

await cloud.ready();
cloud.presence(meKey);
trackUnread();

cloud.watch('chess', onRemote);
cloud.watch('chessGames', renderScore);
cloud.watch('presence', (data) => {
  const info = (data || {})[otherKey];
  partnerOnline = Boolean(info && info.online);
  renderPlayers();
  renderStatus();
});

// «сходил 5 минут назад» — освежаем раз в минуту
setInterval(() => { if (game && !drag) renderStatus(); }, 60000);
