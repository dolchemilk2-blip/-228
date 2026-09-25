// Монтажка — значки. Один рисунок на всё: сетка 16×16, штрих 1,6, скруглённые концы; заливка — только у «играть» и «пауза».
// ic('play') → <svg class="ic">…</svg>. tpIcon(playing) — кнопка плеера: оба значка в одной ячейке, меняются с размытием.
const IC = {
  play: '<path class="f" d="M5 3.3v9.4a.7.7 0 0 0 1.07.6l7.3-4.7a.7.7 0 0 0 0-1.2L6.07 2.7A.7.7 0 0 0 5 3.3z"/>',
  pause: '<rect class="f" x="3.6" y="2.8" width="3" height="10.4" rx="1"/><rect class="f" x="9.4" y="2.8" width="3" height="10.4" rx="1"/>',
  up: '<path d="M4 10l4-4 4 4"/>',
  down: '<path d="M4 6l4 4 4-4"/>',
  next: '<path d="M6.5 4l4 4-4 4"/>',
  close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  check: '<path d="M3.5 8.4l3 3 6-6.8"/>',
  undo: '<path d="M6 3.8L3 6.8l3 3"/><path d="M3.3 6.8h6.2a3.3 3.3 0 0 1 0 6.6H7.8"/>',
  redo: '<path d="M10 3.8l3 3-3 3"/><path d="M12.7 6.8H6.5a3.3 3.3 0 0 0 0 6.6h1.7"/>',
  expand: '<path d="M3 6.2V3h3.2M9.8 3H13v3.2M13 9.8V13H9.8M6.2 13H3V9.8"/>',
  collapse: '<path d="M6.2 3v3.2H3M13 6.2H9.8V3M9.8 13V9.8H13M3 9.8h3.2V13"/>',
  left: '<path d="M13 8H3.5M7 4.5L3.5 8 7 11.5"/>',
  right: '<path d="M3 8h9.5M9 4.5L12.5 8 9 11.5"/>',
  download: '<path d="M8 2.6v7.6M4.8 7.2L8 10.4l3.2-3.2M3 13.4h10"/>',
  plus: '<path d="M8 3.2v9.6M3.2 8h9.6"/>',
  minus: '<path d="M3.2 8h9.6"/>',
  on: '<circle class="f" cx="8" cy="8" r="3.2"/>',
  off: '<circle cx="8" cy="8" r="3.2"/>',
  file: '<path d="M4 2.5h4.8L12 5.7v7.8H4z"/><path d="M8.6 2.6v3.3H12"/>',
  open: '<path d="M2.6 12.8V3.6h3.6l1.4 1.5h5.8v7.7z"/>',
  search: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.4 3.4"/>',
  wave: '<path d="M2 8h1.4M4.6 5.5v5M7 3.2v9.6M9.4 5v6M11.8 6.5v3M14 8h.1"/>',
};
const ic = (n, cls = '') => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 16 16" aria-hidden="true">${IC[n] || ''}</svg>`;
const tpIcon = on => `<span class="swap" data-state="${on ? 'b' : 'a'}"><svg class="ic" data-icon="a" viewBox="0 0 16 16" aria-hidden="true">${IC.play}</svg><svg class="ic" data-icon="b" viewBox="0 0 16 16" aria-hidden="true">${IC.pause}</svg></span>`;
