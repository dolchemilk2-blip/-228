// Монтажка — ползунки-фейдеры. Каждый input[type=range] получает свой вид: жёлоб, заливка (у регуляторов
// «−…+» — от нуля), колпачок фейдера с риской. Сам input остаётся на месте, прозрачный поверх: клавиатура,
// экранные дикторы, value и события — как были, код вокруг не меняется.
// Колпачок едет на пружине (spring.js): за пальцем — почти 1:1, прыжок по щелчку в жёлоб — пружиной с
// лёгким перелётом, с клавиатуры — сразу (правило Эмиля). Нажали — колпачок подрастает, отпустили —
// отпружинивает. Тянут за край — резина, отпустили — возврат. «−…+» у нуля чуть «щёлкает» (фиксация),
// двойной щелчок — в ноль. Значения, выставленные программой (плеер, отрывок чистки), тоже доезжают пружиной.
// Вертикальный фейдер (.v) — тот же ползунок, повёрнутый на 90°: низ — минимум.
const FDR = { drag: null, kbd: 0, desc: null, mute: false };
const FDR_CAP = 14;                                     // длина колпачка вдоль хода — как у невидимого родного бегунка
function fdrRange(inp) { const mn = inp.min === '' ? 0 : +inp.min, mx = inp.max === '' ? 100 : +inp.max; return [mn, mx > mn ? mx : mn + 1]; }
function fdrVal(inp) { return +FDR.desc.get.call(inp); }
function fdrP(inp) { const [mn, mx] = fdrRange(inp); return Math.max(0, Math.min(1, (fdrVal(inp) - mn) / (mx - mn))); }
function fdrOrigin(inp) { const [mn, mx] = fdrRange(inp); return mn < 0 && mx > 0 ? -mn / (mx - mn) : 0; }
/** Обернуть один ползунок. */
function fdrEnhance(inp) {
  if (inp._fdr || inp.type !== 'range' || !inp.parentNode) return;
  const vert = inp.classList.contains('v'), w = document.createElement('span');
  w.className = 'fdr' + (vert ? ' fdr-v' : '') + (fdrOrigin(inp) > 0 ? ' fdr-bi' : '');
  w.innerHTML = '<span class="fdr-track" aria-hidden="true"><span class="fdr-fill"></span></span><span class="fdr-cap" aria-hidden="true"></span>';
  inp.parentNode.insertBefore(w, inp); w.appendChild(inp);
  const F = { w, inp, vert, p0: fdrOrigin(inp), grab: false, first: false };
  const owner = { render() {
    const p = F.p.v, a = Math.min(p, F.p0), b = Math.max(p, F.p0), o = F.o.v;
    w.style.setProperty('--p', p.toFixed(4)); w.style.setProperty('--a', a.toFixed(4)); w.style.setProperty('--b', b.toFixed(4));
    w.style.setProperty('--o', o.toFixed(2) + 'px'); w.style.setProperty('--z', F.p0.toFixed(4)); w.style.setProperty('--s', F.s.v.toFixed(4));
    w.style.setProperty('--ol', (p < F.p0 ? o : 0).toFixed(2) + 'px'); w.style.setProperty('--or', (p >= F.p0 ? o : 0).toFixed(2) + 'px');
  } };
  F.p = mv(fdrP(inp), 0.0005, owner); F.o = mv(0, 0.05, owner); F.s = mv(1, 0.0005, owner);
  inp._fdr = F; owner.render();
  w.classList.toggle('is-off', inp.disabled);
}
/** Колпачок — к значению ползунка: как именно, зависит от того, чем его сдвинули. */
function fdrSync(inp, how) {
  const F = inp._fdr; if (!F) return;
  F.p0 = fdrOrigin(inp); F.w.classList.toggle('fdr-bi', F.p0 > 0); F.w.classList.toggle('is-off', inp.disabled);
  const to = fdrP(inp);
  if (how === 'key' || (typeof MOTION !== 'undefined' && MOTION.reduce)) { mvSet(F.p, to); return; }
  if (how === 'drag') { mvTo(F.p, to, { damping: 1, response: 0.05 }); return; }                        // за пальцем
  if (how === 'jump') { mvTo(F.p, to, { damping: 0.8, response: 0.34 }); return; }                       // щелчок в жёлоб
  if (Math.abs(to - F.p.v) < 0.03) mvSet(F.p, to); else mvTo(F.p, to, { damping: 1, response: 0.32 });  // программа: мелкий шаг — сразу
}
function fdrAxis(F, e) {                                 // где указатель вдоль хода: 0…1 и сколько пикселей хода
  const r = F.w.getBoundingClientRect(), L = (F.vert ? r.height : r.width) - FDR_CAP;
  const pos = F.vert ? r.bottom - e.clientY - FDR_CAP / 2 : e.clientX - r.left - FDR_CAP / 2;
  return { raw: pos / Math.max(1, L), L };
}
function fdrSet(inp, v) { FDR.mute = true; inp.value = v; FDR.mute = false; }
function fdrInit() {
  FDR.desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  // значение, выставленное программой (плеер ведёт позицию, отрывок чистки и т. п.), — колпачок доезжает сам
  Object.defineProperty(HTMLInputElement.prototype, 'value', { configurable: true, enumerable: FDR.desc.enumerable,
    get() { return FDR.desc.get.call(this); },
    set(v) { FDR.desc.set.call(this, v); if (this._fdr && !FDR.mute) fdrSync(this, 'prog'); } });
  document.querySelectorAll('input[type=range]').forEach(fdrEnhance);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'attributes') { if (m.target._fdr) fdrSync(m.target, 'prog'); continue; }
      for (const n of m.addedNodes) { if (n.nodeType !== 1) continue; if (n.matches('input[type=range]')) fdrEnhance(n); else if (n.firstElementChild) n.querySelectorAll('input[type=range]').forEach(fdrEnhance); }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['min', 'max', 'value', 'disabled'] });
  document.addEventListener('keydown', e => { if (e.target._fdr) FDR.kbd = performance.now(); }, true);
  document.addEventListener('pointerdown', e => {
    const inp = e.target._fdr ? e.target : null; if (!inp || inp.disabled || e.button > 0) return;
    const F = inp._fdr, { raw, L } = fdrAxis(F, e), capAt = F.p.v * L; F.L = L;
    // двойной щелчок по «−…+» — в ноль. Считаем сами: после первого щелчка строку могли перерисовать, и родной
    // dblclick придёт уже не ползунку. Узнаём ползунок по id и data-атрибутам, а не по элементу.
    const key = inp.id || JSON.stringify(inp.dataset), now = performance.now(), last = FDR.last;
    if (F.p0 > 0 && last && last.key === key && now - last.t < 400 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8) {
      FDR.last = null; e.preventDefault(); if (fdrVal(inp) !== 0) { fdrSet(inp, 0); fdrSync(inp, 'jump'); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }
      return;
    }
    FDR.last = { key, t: now, x: e.clientX, y: e.clientY };
    F.grab = Math.abs(raw * L - capAt) <= FDR_CAP / 2 + 5; F.first = true;             // взялись за колпачок или щёлкнули в жёлоб
    FDR.drag = { F, id: e.pointerId };
    F.w.classList.add('is-drag'); mvTo(F.s, 1.16, { damping: 1, response: 0.16 });
  }, true);
  document.addEventListener('pointermove', e => {
    const d = FDR.drag; if (!d || d.id !== e.pointerId) return;
    const { raw, L } = fdrAxis(d.F, e), over = raw < 0 ? raw * L : raw > 1 ? (raw - 1) * L : 0;
    mvSet(d.F.o, over ? Math.sign(over) * rubber(Math.abs(over), 26) : 0);             // за краем — резина
  }, true);
  const up = e => {
    const d = FDR.drag; if (!d || (e.pointerId != null && d.id !== e.pointerId)) return; FDR.drag = null;
    d.F.w.classList.remove('is-drag'); mvTo(d.F.s, 1, { damping: 0.55, response: 0.42 }); mvTo(d.F.o, 0, { damping: 0.7, response: 0.35 });
  };
  document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
  document.addEventListener('input', e => {
    const inp = e.target; if (!inp._fdr) return; const F = inp._fdr;
    if (FDR.drag && FDR.drag.F === F) {
      // «−…+»: у нуля — фиксация, как щелчок у настоящего фейдера с центральным упором
      if (F.p0 > 0) { const [mn, mx] = fdrRange(inp), v = fdrVal(inp), snap = 5 / Math.max(40, F.L || 200) * (mx - mn);   // упор ±5 px вокруг нуля
        if (v !== 0 && Math.abs(v) <= snap) { fdrSet(inp, 0); if (!F.zero) { F.zero = true; try { navigator.vibrate && navigator.vibrate(6); } catch {} } } else if (v !== 0) F.zero = false; }
      fdrSync(inp, F.first && !F.grab ? 'jump' : 'drag'); F.first = false; return;
    }
    fdrSync(inp, performance.now() - FDR.kbd < 150 ? 'key' : 'jump');
  }, true);
  document.addEventListener('dblclick', e => {                                          // двойной щелчок — в ноль
    const inp = e.target._fdr ? e.target : null; if (!inp || inp.disabled || !(inp._fdr.p0 > 0) || fdrVal(inp) === 0) return;
    fdrSet(inp, 0); fdrSync(inp, 'jump');
    inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  document.addEventListener('pointerover', e => { if (e.pointerType !== 'mouse' || FDR.drag || (typeof scrolling === 'function' && scrolling())) return; const F = e.target._fdr; if (F) mvTo(F.s, 1.07, { damping: 1, response: 0.2 }); });
  document.addEventListener('pointerout', e => { if (e.pointerType !== 'mouse') return; const F = e.target._fdr; if (F && !(FDR.drag && FDR.drag.F === F)) mvTo(F.s, 1, { damping: 0.7, response: 0.3 }); });
}
