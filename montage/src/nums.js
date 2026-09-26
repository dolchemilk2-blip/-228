// Монтажка — меняющиеся числа (transitions.dev: Number pop-in). Любой элемент с data-num="ключ" следит за своим
// текстом сам: изменилось число — новые цифры въезжают с размытием и лёгким перелётом; выросло — снизу,
// уменьшилось — сверху; соседние изменившиеся цифры — лесенкой по 70 мс. Въезжают только изменившиеся цифры:
// 1:04 → 1:05 — одна «5». Если число меняется чаще, чем раз в 140 мс (тянут ползунок, идёт прогресс), цифры не
// гаснут каждый раз, а лишь коротко «тикают». Первое появление — без движения; время плеера во время игры не
// прыгает (data-num-quiet="play"). data-num-flow — для строк в тексте: группа не становится inline-flex и переносится
// как обычный текст. prefers-reduced-motion — без движения.
const NUMS = { prev: new Map(), at: new Map(), ids: new WeakMap(), n: 0 };
const NUM_RE = /([+−\-]?\d[\d.,:]*\d|[+−\-]?\d)/;
function numVal(t) { const s = t.replace('−', '-').replace(',', '.'); return s.includes(':') ? s.split(':').reduce((a, x) => a * 60 + Math.abs(+x || 0), 0) * (s.startsWith('-') ? -1 : 1) : parseFloat(s); }
const numEsc = t => t.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
/** Та же ли «форма» у двух строк: одинаковый текст вокруг чисел (меняются только сами числа). */
function numShape(a, b) {
  if (a == null || b == null) return false;
  const x = a.split(NUM_RE), y = b.split(NUM_RE);
  return x.length === y.length && x.every((p, i) => i % 2 === 1 || p === y[i]);
}
function numKey(el) { if (el.dataset.num) return el.dataset.num; if (!NUMS.ids.has(el)) NUMS.ids.set(el, '#' + (++NUMS.n)); return NUMS.ids.get(el); }
/** Перерисовать число: изменившиеся цифры — отдельными ячейками с въездом, остальные — на месте. */
function numRender(el, text) {
  const key = numKey(el), prev = NUMS.prev.get(key); NUMS.prev.set(key, text);
  const now = performance.now(), fast = now - (NUMS.at.get(key) || 0) < 140;
  const quiet = prev == null || prev === text || (typeof MOTION !== 'undefined' && (MOTION.reduce || !MOTION.ready))
    || (el.dataset.numQuiet === 'play' && typeof TP !== 'undefined' && TP.playing);
  const flow = el.hasAttribute('data-num-flow'), onlySame = el.hasAttribute('data-num-shape'), parts = text.split(NUM_RE), old = prev != null ? prev.split(NUM_RE) : null;
  const same = numShape(prev, text), oldNums = old ? old.filter((p, i) => i % 2) : [], still = quiet || (onlySame && !same);
  let html = '', k = 0, moved = false;
  parts.forEach((p, i) => {
    if (i % 2 === 0) { if (p) html += flow ? numEsc(p) : `<span class="t-digit t-txt">${numEsc(p)}</span>`; return; }
    // с чем сравнивать: то же место в строке той же формы; иначе — вся строка новая, но числа, что уже были, не прыгают
    const o = same ? old[i] : oldNums.includes(p) ? p : null;
    const dir = o != null && !isNaN(numVal(o)) && numVal(p) < numVal(o) ? -1 : 1;
    for (let j = 0; j < p.length; j++) {
      const oc = o != null ? o[o.length - p.length + j] : undefined, pop = !still && oc !== p[j];
      if (pop) { moved = true; html += `<span class="t-digit"${k ? ` data-stagger="${Math.min(3, k)}"` : ''}${dir < 0 ? ' style="--digit-dir-y:-1"' : ''}>${p[j]}</span>`; k++; }
      else html += `<span class="t-digit t-still">${p[j]}</span>`;
    }
  });
  el.classList.add('t-digit-group'); el.classList.toggle('t-flow', flow);
  el.classList.toggle('is-animating', !fast); el.classList.toggle('is-tick', fast);
  el._numText = text; el.innerHTML = html;
  if (moved) NUMS.at.set(key, now);
}
function numCheck(el) { const t = el.textContent; if (el._numText === t) return; numRender(el, t); }
function numInit() {
  document.querySelectorAll('[data-num]').forEach(numCheck);
  new MutationObserver(list => {
    const hit = new Set();
    for (const m of list) {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement, host = t && t.closest && t.closest('[data-num]');
      if (host) hit.add(host);
      for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.hasAttribute('data-num')) hit.add(n); if (n.firstElementChild) n.querySelectorAll('[data-num]').forEach(x => hit.add(x)); }
    }
    hit.forEach(numCheck);                             // своя перерисовка тоже попадает сюда — и отсекается по _numText
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
