// Монтажка — дека в шапке: стрелочный индикатор уровня, катушки и лампа «Эфир».
// Один цикл requestAnimationFrame — только пока что-то играет или стрелка ещё не легла; в покое ничего не считается.
// Стрелка — пружина с лёгким перелётом, как баллистика настоящего VU (≈300 мс на подъём): 0 VU = −18 dBFS,
// шкала линейна по напряжению. Катушки разгоняются и тормозят плавно, правая крутится быстрее (на ней меньше ленты).
// prefers-reduced-motion: стрелка встаёт сразу, катушки стоят, лампа просто загорается.
// Использует audioLevel из app.js, playing и TP из app.js, ab из cleanup.js, MOTION из motion.js.
const DECK = { raf: 0, ang: -50, vel: 0, reel: 0, speed: 0, t: 0, on: false, needle: null, reels: [] };
const VU = { min: -48, max: 48, cx: 48, cy: 50, r: 36 };
/** VU (−20…+3) → угол стрелки. */
function vuAngle(vu) {
  const v = Math.pow(10, Math.max(-20, Math.min(3, vu)) / 20), lo = 0.1, hi = Math.pow(10, 3 / 20);
  return VU.min + (VU.max - VU.min) * (v - lo) / (hi - lo);
}
function vuPoint(a, r = VU.r) { const t = a * Math.PI / 180; return [VU.cx + r * Math.sin(t), VU.cy - r * Math.cos(t)]; }
function vuArc(a0, a1, r = VU.r) { const [x0, y0] = vuPoint(a0, r), [x1, y1] = vuPoint(a1, r); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; }
function initDeck() {
  const vu = document.getElementById('vu'); if (!vu) return;
  vu.querySelector('.scale').setAttribute('d', vuArc(VU.min, VU.max));
  vu.querySelector('.red').setAttribute('d', vuArc(vuAngle(0), VU.max));
  document.getElementById('vu-ticks').innerHTML = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3].map(d => {
    const a = vuAngle(d), big = d === -20 || d === -10 || d === 0 || d === 3, [x0, y0] = vuPoint(a, VU.r + 0.5), [x1, y1] = vuPoint(a, VU.r + (big ? 5 : 3));
    return `<line class="tick" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"${d > 0 ? ' style="stroke:var(--onair)"' : ''}/>`;
  }).join('');
  DECK.needle = document.getElementById('vu-needle');
  DECK.reels = [...document.querySelectorAll('#reels .reel')];
  document.addEventListener('visibilitychange', () => { if (!document.hidden) deckKick(); });
  deckKick();
}
function deckPlaying() { return !!((typeof playing !== 'undefined' && playing) || (typeof TP !== 'undefined' && TP.playing) || (typeof ab !== 'undefined' && ab)); }
/** Разбудить деку: звук пошёл. Зовётся из audioOut(), так что любое «слушать» будит её само. */
function deckKick() { if (!DECK.raf && DECK.needle) { DECK.t = performance.now(); DECK.raf = requestAnimationFrame(deckTick); } }
function deckTick(now) {
  DECK.raf = 0;
  const dt = Math.min(0.05, Math.max(0.001, (now - DECK.t) / 1000)); DECK.t = now;
  const on = deckPlaying(), reduce = typeof MOTION !== 'undefined' && MOTION.reduce;
  if (on !== DECK.on) { DECK.on = on; document.getElementById('onair')?.classList.toggle('on', on); document.getElementById('vu')?.classList.toggle('lit', on); }
  const lv = on && typeof audioLevel === 'function' ? audioLevel() : 0;
  const target = lv > 1e-5 ? vuAngle(20 * Math.log10(lv) + 18) : VU.min - 2;
  if (reduce) { DECK.ang = target; DECK.vel = 0; }
  else { const k = 160, c = 2 * Math.sqrt(k) * 0.7, acc = k * (target - DECK.ang) - c * DECK.vel; DECK.vel += acc * dt; DECK.ang += DECK.vel * dt; }
  DECK.ang = Math.max(VU.min - 3, Math.min(VU.max + 3, DECK.ang));
  DECK.needle.style.transform = `rotate(${DECK.ang.toFixed(2)}deg)`;
  const want = on && !reduce ? 220 : 0;                                  // градусов в секунду
  DECK.speed += (want - DECK.speed) * Math.min(1, dt * (want > DECK.speed ? 2.4 : 2));
  if (!want && DECK.speed < 1.5) DECK.speed = 0;
  if (DECK.speed > 0.3) { DECK.reel = (DECK.reel + DECK.speed * dt) % 3600; DECK.reels.forEach((r, i) => { r.style.transform = `rotate(${((i ? 1.35 : 1) * DECK.reel % 360).toFixed(1)}deg)`; }); }
  const settled = !on && Math.abs(DECK.vel) < 0.05 && Math.abs(DECK.ang - target) < 0.15 && DECK.speed === 0;
  if (!settled && !document.hidden) DECK.raf = requestAnimationFrame(deckTick);
}
