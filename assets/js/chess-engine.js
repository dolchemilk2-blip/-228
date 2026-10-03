/* ============================================================
   Шахматы: правила целиком, без библиотек.

   Клетки — числа 0…63: 0 = a8, 7 = h8, 56 = a1, 63 = h1
   (так доска выглядит со стороны белых). Фигуры — буквы FEN:
   большие белые (PNBRQK), маленькие чёрные (pnbrqk).

   Ход хранится как в UCI: «e2e4», превращение — «e7e8q».
   Партия — просто строка ходов через пробел: из неё всегда
   можно заново получить любую позицию.
   ============================================================ */

export const FILES = 'abcdefgh';
export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const sqName = (i) => FILES[i & 7] + (8 - (i >> 3));
export const sqIndex = (n) => FILES.indexOf(n[0]) + (8 - Number(n[1])) * 8;
export const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');
const other = (c) => (c === 'w' ? 'b' : 'w');
const rowOf = (i) => i >> 3;
const colOf = (i) => i & 7;
const at = (r, c) => (r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c);

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const LINE = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/* ---------------- позиция ---------------- */

export function fromFen(fen) {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const board = [];
  for (const ch of placement.replace(/\//g, '')) {
    if (/\d/.test(ch)) for (let k = 0; k < +ch; k++) board.push(null);
    else board.push(ch);
  }
  return {
    board,
    turn: turn || 'w',
    castling: castling && castling !== '-' ? castling : '',
    ep: ep && ep !== '-' ? sqIndex(ep) : -1,
    half: +half || 0,
    full: +full || 1
  };
}

export function toFen(s) {
  let out = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = s.board[r * 8 + c];
      if (!p) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      out += p;
    }
    if (empty) out += empty;
    if (r < 7) out += '/';
  }
  return out + ' ' + s.turn + ' ' + (s.castling || '-') + ' ' +
    (s.ep >= 0 ? sqName(s.ep) : '-') + ' ' + s.half + ' ' + s.full;
}

// для повторений позиции: без счётчиков ходов
const positionKey = (s) => toFen(s).split(' ').slice(0, 4).join(' ');

/* ---------------- под боем ли клетка ---------------- */

export function attacked(board, sq, by) {
  const r = rowOf(sq), c = colOf(sq);
  // пешки: белая бьёт вверх по доске, значит стоит на ряд ниже
  const pr = by === 'w' ? r + 1 : r - 1;
  const pawn = by === 'w' ? 'P' : 'p';
  for (const dc of [-1, 1]) {
    const i = at(pr, c + dc);
    if (i >= 0 && board[i] === pawn) return true;
  }
  const knight = by === 'w' ? 'N' : 'n';
  for (const [dr, dc] of KNIGHT) {
    const i = at(r + dr, c + dc);
    if (i >= 0 && board[i] === knight) return true;
  }
  const king = by === 'w' ? 'K' : 'k';
  for (const [dr, dc] of KING) {
    const i = at(r + dr, c + dc);
    if (i >= 0 && board[i] === king) return true;
  }
  const bishops = by === 'w' ? 'BQ' : 'bq';
  const rooks = by === 'w' ? 'RQ' : 'rq';
  for (const [dirs, set] of [[DIAG, bishops], [LINE, rooks]]) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const p = board[rr * 8 + cc];
        if (p) { if (set.includes(p)) return true; break; }
        rr += dr; cc += dc;
      }
    }
  }
  return false;
}

export function kingSquare(board, color) {
  return board.indexOf(color === 'w' ? 'K' : 'k');
}

export function inCheck(s, color) {
  const k = kingSquare(s.board, color || s.turn);
  return k >= 0 && attacked(s.board, k, other(color || s.turn));
}

/* ---------------- ходы ---------------- */

function pseudoMoves(s) {
  const out = [];
  const me = s.turn, b = s.board;
  const mine = (p) => p && colorOf(p) === me;
  const theirs = (p) => p && colorOf(p) !== me;
  const add = (from, to, extra) => out.push({ from, to, piece: b[from], captured: b[to] || null, ...extra });

  for (let from = 0; from < 64; from++) {
    const p = b[from];
    if (!mine(p)) continue;
    const r = rowOf(from), c = colOf(from);
    const t = p.toLowerCase();

    if (t === 'p') {
      const dir = me === 'w' ? -1 : 1;
      const startRow = me === 'w' ? 6 : 1;
      const lastRow = me === 'w' ? 0 : 7;
      const pushPawn = (to, extra) => {
        if (rowOf(to) === lastRow) {
          for (const promo of ['q', 'r', 'b', 'n']) add(from, to, { ...extra, promo });
        } else add(from, to, extra);
      };
      const one = at(r + dir, c);
      if (one >= 0 && !b[one]) {
        pushPawn(one);
        const two = at(r + 2 * dir, c);
        if (r === startRow && !b[two]) add(from, two, { double: true });
      }
      for (const dc of [-1, 1]) {
        const to = at(r + dir, c + dc);
        if (to < 0) continue;
        if (theirs(b[to])) pushPawn(to);
        else if (to === s.ep) add(from, to, { ep: true, captured: me === 'w' ? 'p' : 'P' });
      }
      continue;
    }

    if (t === 'n' || t === 'k') {
      for (const [dr, dc] of (t === 'n' ? KNIGHT : KING)) {
        const to = at(r + dr, c + dc);
        if (to >= 0 && !mine(b[to])) add(from, to);
      }
      if (t === 'k') castleMoves(s, from, add);
      continue;
    }

    const dirs = t === 'b' ? DIAG : t === 'r' ? LINE : DIAG.concat(LINE);
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const to = rr * 8 + cc;
        if (mine(b[to])) break;
        add(from, to);
        if (b[to]) break;
        rr += dr; cc += dc;
      }
    }
  }
  return out;
}

function castleMoves(s, from, add) {
  const w = s.turn === 'w';
  const home = w ? 60 : 4;
  if (from !== home) return;
  const b = s.board, foe = other(s.turn);
  const rook = w ? 'R' : 'r';
  if (attacked(b, home, foe)) return;
  // короткая: король идёт на g, ладья — на f
  if (s.castling.includes(w ? 'K' : 'k') && b[home + 3] === rook &&
      !b[home + 1] && !b[home + 2] &&
      !attacked(b, home + 1, foe) && !attacked(b, home + 2, foe)) {
    add(from, home + 2, { castle: 'k' });
  }
  // длинная: король идёт на c, ладья — на d
  if (s.castling.includes(w ? 'Q' : 'q') && b[home - 4] === rook &&
      !b[home - 1] && !b[home - 2] && !b[home - 3] &&
      !attacked(b, home - 1, foe) && !attacked(b, home - 2, foe)) {
    add(from, home - 2, { castle: 'q' });
  }
}

const CORNER_RIGHT = { 63: 'K', 56: 'Q', 7: 'k', 0: 'q' };

export function makeMove(s, m) {
  const b = s.board.slice();
  const w = s.turn === 'w';
  let piece = b[m.from];
  b[m.from] = null;
  if (m.ep) b[m.to + (w ? 8 : -8)] = null;
  if (m.promo) piece = w ? m.promo.toUpperCase() : m.promo;
  b[m.to] = piece;
  if (m.castle === 'k') { b[m.from + 1] = b[m.from + 3]; b[m.from + 3] = null; }
  if (m.castle === 'q') { b[m.from - 1] = b[m.from - 4]; b[m.from - 4] = null; }

  let castling = s.castling;
  if (piece.toLowerCase() === 'k') castling = castling.replace(w ? /[KQ]/g : /[kq]/g, '');
  for (const sq of [m.from, m.to]) {
    if (CORNER_RIGHT[sq]) castling = castling.replace(CORNER_RIGHT[sq], '');
  }

  const isPawn = m.piece.toLowerCase() === 'p';
  return {
    board: b,
    turn: other(s.turn),
    castling,
    ep: m.double ? (m.from + m.to) / 2 : -1,
    half: isPawn || m.captured ? 0 : s.half + 1,
    full: s.full + (w ? 0 : 1)
  };
}

export function legalMoves(s, from) {
  return pseudoMoves(s).filter((m) => {
    if (from != null && m.from !== from) return false;
    const next = makeMove(s, m);
    return !inCheck(next, s.turn);
  });
}

export const uciOf = (m) => sqName(m.from) + sqName(m.to) + (m.promo || '');

/* ---------------- запись ходов по-русски ----------------
   Кр — король, Ф — ферзь, Л — ладья, С — слон, К — конь.
   «Кf3», «exd5», «e8Ф+», «0-0». */

export const RU = { k: 'Кр', q: 'Ф', r: 'Л', b: 'С', n: 'К', p: '' };

export function san(s, m) {
  let out;
  if (m.castle) out = m.castle === 'k' ? '0-0' : '0-0-0';
  else {
    const t = m.piece.toLowerCase();
    if (t === 'p') {
      out = (m.captured ? FILES[colOf(m.from)] + 'x' : '') + sqName(m.to) + (m.promo ? RU[m.promo] : '');
    } else {
      // если на ту же клетку может пойти такая же фигура — уточняем, какая
      const rivals = legalMoves(s).filter((x) => x.to === m.to && x.from !== m.from && x.piece === m.piece);
      let hint = '';
      if (rivals.length) {
        const sameFile = rivals.some((x) => colOf(x.from) === colOf(m.from));
        const sameRow = rivals.some((x) => rowOf(x.from) === rowOf(m.from));
        if (!sameFile) hint = FILES[colOf(m.from)];
        else if (!sameRow) hint = String(8 - rowOf(m.from));
        else hint = sqName(m.from);
      }
      out = RU[t] + hint + (m.captured ? 'x' : '') + sqName(m.to);
    }
  }
  const next = makeMove(s, m);
  if (inCheck(next)) out += legalMoves(next).length ? '+' : '#';
  return out;
}

/* ---------------- конец партии ---------------- */

function insufficient(board) {
  const rest = board.filter((p) => p && p.toLowerCase() !== 'k');
  if (!rest.length) return true;
  if (rest.length === 1 && 'nb'.includes(rest[0].toLowerCase())) return true;
  // только слоны, и все — на полях одного цвета
  if (rest.every((p) => p.toLowerCase() === 'b')) {
    const shades = new Set();
    board.forEach((p, i) => { if (p && p.toLowerCase() === 'b') shades.add((rowOf(i) + colOf(i)) % 2); });
    return shades.size === 1;
  }
  return false;
}

/* Итог позиции: null — игра идёт; иначе { winner: 'w'|'b'|null, reason } */
export function outcome(s, keys) {
  const moves = legalMoves(s);
  if (!moves.length) {
    return inCheck(s) ? { winner: other(s.turn), reason: 'mate' } : { winner: null, reason: 'stalemate' };
  }
  if (insufficient(s.board)) return { winner: null, reason: 'material' };
  if (s.half >= 100) return { winner: null, reason: 'fifty' };
  if (keys) {
    const k = positionKey(s);
    if (keys.filter((x) => x === k).length >= 3) return { winner: null, reason: 'repetition' };
  }
  return null;
}

/* ---------------- партия целиком ----------------
   Из строки ходов — все позиции по порядку, ходы с записью
   и итог. Неверный ход (чужая правка, сбой) просто обрывает
   разбор: всё, что было до него, остаётся. */

export function replay(line) {
  const ucis = String(line || '').trim().split(/\s+/).filter(Boolean);
  let s = fromFen(START);
  const states = [s];
  const moves = [];
  const keys = [positionKey(s)];
  let broken = false;
  for (const u of ucis) {
    const from = sqIndex(u.slice(0, 2)), to = sqIndex(u.slice(2, 4)), promo = u[4] || undefined;
    const m = legalMoves(s, from).find((x) => x.to === to && (x.promo || undefined) === promo);
    if (!m) { broken = true; break; }
    m.san = san(s, m);
    m.uci = u;
    moves.push(m);
    s = makeMove(s, m);
    states.push(s);
    keys.push(positionKey(s));
    if (outcome(s, keys)) break;
  }
  return { states, moves, state: s, end: outcome(s, keys), broken };
}

/* Сколько и каких фигур съедено — для полоски под именем */
const FULL_SET = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

export function material(board) {
  const left = { w: {}, b: {} };
  board.forEach((p) => {
    if (!p || p.toLowerCase() === 'k') return;
    const c = colorOf(p), t = p.toLowerCase();
    left[c][t] = (left[c][t] || 0) + 1;
  });
  const lost = { w: [], b: [] };
  let score = { w: 0, b: 0 };
  for (const c of ['w', 'b']) {
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      const n = Math.max(0, FULL_SET[t] - (left[c][t] || 0));
      for (let k = 0; k < n; k++) lost[c].push(t);
      score[c] += (left[c][t] || 0) * VALUE[t];
    }
  }
  // lost.w — какие белые фигуры съели (их показываем у чёрных)
  return { lost, diff: score.w - score.b };
}
