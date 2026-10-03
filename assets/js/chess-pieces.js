/* Фигуры — свои, нарисованные в SVG (45×45), без шрифтов и картинок:
   на любом телефоне выглядят одинаково. Цвета задаёт CSS:
   .f — тело фигуры, .d — линии-детали, .e — глаз и ноздря коня. */

const BASE = '<path class="f" d="M11 39.5h23a2 2 0 0 0 2-2v-.5a2 2 0 0 0-2-2H11a2 2 0 0 0-2 2v.5a2 2 0 0 0 2 2z"/>';
const SKIRT = '<path class="f" d="M12.5 35c1.5-1.8 2.3-4 2.5-6.6h15c.2 2.6 1 4.8 2.5 6.6z"/>';
const BAND = '<rect class="f" x="13.5" y="25.6" width="18" height="3.2" rx="1.6"/>';
const BAND_LINES = '<path class="d" d="M15 35h15M15.2 28.8h14.6"/>';

const SHAPES = {
  p:
    '<path class="f" d="M12.5 39.5h20a1.5 1.5 0 0 0 1.5-1.5v-.8a1.8 1.8 0 0 0-1.8-1.8H12.8a1.8 1.8 0 0 0-1.8 1.8v.8a1.5 1.5 0 0 0 1.5 1.5z"/>' +
    '<path class="f" d="M14.5 35.4c0-4.6 2.6-7.4 5-8.6h6c2.4 1.2 5 4 5 8.6z"/>' +
    '<rect class="f" x="17" y="24.2" width="11" height="3.2" rx="1.6"/>' +
    '<circle class="f" cx="22.5" cy="18" r="6.2"/>' +
    '<path class="d" d="M16.5 35.4h12"/>',

  r:
    BASE +
    '<path class="f" d="M12.5 35c1.6-1.6 2.5-3.4 2.5-5.5V18.5h15v11c0 2.1.9 3.9 2.5 5.5z"/>' +
    '<path class="f" d="M11.5 9.5h5V13H20V9.5h5V13h3.5V9.5h5V17c0 .8-.7 1.5-1.5 1.5H13c-.8 0-1.5-.7-1.5-1.5z"/>' +
    '<path class="d" d="M15 35h15M15 30h15M15.5 18.5h14"/>',

  b:
    BASE +
    '<path class="f" d="M14.5 35c1.8-1.6 3-3.6 3-6h10c0 2.4 1.2 4.4 3 6z"/>' +
    '<rect class="f" x="15.5" y="26" width="14" height="3.2" rx="1.6"/>' +
    '<path class="f" d="M22.5 10c-5.2 3.6-7.8 8.2-7 12.4.5 2.4 2.6 3.6 7 3.6s6.5-1.2 7-3.6c.8-4.2-1.8-8.8-7-12.4z"/>' +
    '<circle class="f" cx="22.5" cy="8" r="2.4"/>' +
    '<path class="d" d="M25.6 14.6l-4.4 5.2M16.5 35h12M17.2 29.2h10.6"/>',

  n:
    BASE +
    '<path class="f" d="M13.5 35c.3-4.6 2.4-8.2 5.6-11.3-1.6.4-3.3 1.4-4.8 2.2-1.3.7-2.8.6-3.7-.4l-1-1.1c-.8-.9-.9-2.2-.2-3.2l4.2-6.3c.8-1.2 1.7-2.4 2.8-3.4l.2-3.3 2.6 2.3c4.3-1.3 8.8-.2 11.5 3 3.6 4.2 4.2 11.8 3.6 21.5z"/>' +
    '<circle class="e" cx="17.6" cy="15.6" r="1.3"/>' +
    '<circle class="e" cx="11.6" cy="21.4" r=".75"/>' +
    '<path class="d" d="M31.2 31.5c.3-6.5-.6-11.8-3.2-14.8M15 35h15"/>',

  q:
    BASE + SKIRT +
    '<path class="f" d="M14.2 25.6 10.6 14.5l6.1 6.3.3-9.6 4.4 8.6 1.1-9.6 1.1 9.6 4.4-8.6.3 9.6 6.1-6.3-3.6 11.1z"/>' +
    BAND +
    '<circle class="f" cx="10.6" cy="13" r="2"/><circle class="f" cx="17" cy="9.6" r="2"/>' +
    '<circle class="f" cx="22.5" cy="8.4" r="2"/><circle class="f" cx="28" cy="9.6" r="2"/>' +
    '<circle class="f" cx="34.4" cy="13" r="2"/>' +
    BAND_LINES,

  k:
    BASE + SKIRT +
    '<path class="f" d="M21.3 5.5h2.4v2.8h2.7v2.4h-2.7v8.6h-2.4v-8.6h-2.7V8.3h2.7z"/>' +
    '<path class="f" d="M14.2 25.6c-3.4-4.4-3.2-10.2 1.6-10.9 3.2-.5 5.6 1.6 6.7 4.7 1.1-3.1 3.5-5.2 6.7-4.7 4.8.7 5 6.5 1.6 10.9z"/>' +
    BAND + BAND_LINES
};

const NAMES = { p: 'пешка', n: 'конь', b: 'слон', r: 'ладья', q: 'ферзь', k: 'король' };

export function pieceName(p) {
  const t = p.toLowerCase();
  const white = p !== t;
  const adj = t === 'p' || t === 'r'
    ? (white ? 'белая' : 'чёрная')
    : (white ? 'белый' : 'чёрный');
  return adj + ' ' + NAMES[t];
}

export function pieceSvg(p) {
  const t = p.toLowerCase();
  return '<svg viewBox="0 0 45 45" aria-hidden="true" class="' + (p === t ? 'pc-b' : 'pc-w') + '">' + SHAPES[t] + '</svg>';
}
