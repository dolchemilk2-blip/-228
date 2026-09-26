// Монтажка — «читка»: сценарий идёт за плеером. Текущая реплика подсвечена и «прочитывается» слева направо,
// лист сам держит её на виду (прокрутка на пружине), щелчок по строке — играть с неё. Если прокрутить лист
// руками, он не мешает 4 секунды. Незаписанные реплики видны как паузы — сразу слышно, где дыры.
// Использует S, C, $, esc, fmt, charName, colorOf, tpTime, tpSeek, TP из app.js; mv/mvTo/mvSet из spring.js.
const READ = { key: null, rows: [], cur: -1, hold: 0, scroll: null };
function readRows() {
  const r = S.result; if (!r || !r.lay) return [];
  const out = []; let scene = null;
  for (const row of r.lay.rows) {
    if (row.scene !== scene) { scene = row.scene; out.push({ scene }); }
    if (row.bed) continue;
    out.push({ row, at: row.at, end: row.at + row.dur });
  }
  return out;
}
function readHtml() {
  const chs = typeof chapterList === 'function' ? chapterList() : [];
  return `<div class="read" role="list" aria-label="Читка: сценарий за плеером">${READ.rows.map((x, i) => {
    if (x.scene != null) { const ch = chs.find(c => c.title.startsWith('Сцена ' + x.scene)); return `<div class="read-sc">${esc(ch ? ch.title : 'Сцена ' + x.scene)}</div>`; }
    const c = x.row.cue, line = c.type === 'line', who = x.row.sound ? 'звук' : line ? charName(c.spk) : 'ремарка';
    return `<div class="read-row${x.row.recorded ? '' : ' gap'}" role="listitem" data-i="${i}" tabindex="-1">
      <span class="read-t">${fmt(x.at)}</span>
      <span class="chip ${line ? colorOf(c.spk) : 'ghost'}">${esc(who)}</span>
      <span class="read-x">${c.note && line ? `<i>(${esc(c.note)})</i> ` : ''}<span class="rt">${esc(line ? c.text.replace(/^[—–-]\s*/, '') : c.text)}</span>${x.row.recorded ? '' : ' <em>нет записи — пауза</em>'}</span>
    </div>`;
  }).join('')}</div>`;
}
/** Панель читки: строится один раз на сведение, дальше меняются только классы. */
function readRender() {
  const box = $('#mix-read'); if (!box) return;
  if (!S.readOpen || !S.result || !S.result.lay) { if (box.innerHTML) box.innerHTML = ''; READ.key = null; return; }
  const key = S.result.lay;
  if (READ.key === key && box.firstElementChild) { readTick(true); return; }
  READ.key = key; READ.rows = readRows(); READ.cur = -1; box.innerHTML = readHtml();
  const list = box.querySelector('.read');
  const owner = { render() { list.scrollTop = READ.scroll.v; } };
  READ.scroll = mv(list.scrollTop, 0.5, owner);
  const hold = () => { READ.hold = performance.now(); mvSet(READ.scroll, list.scrollTop); SPRING.live.delete(READ.scroll); };
  list.addEventListener('wheel', hold, { passive: true }); list.addEventListener('touchmove', hold, { passive: true });
  list.addEventListener('pointerdown', e => { if (e.target === list) hold(); });
  list.addEventListener('click', e => { const rowEl = e.target.closest('.read-row'); if (!rowEl) return; const x = READ.rows[+rowEl.dataset.i]; READ.hold = 0; tpSeek(x.at, true); });
  readTick(true);
}
/** Каждый кадр, пока играет (и при остановке): какая реплика звучит, сколько прочитано, держать на виду. */
function readTick(jump) {
  if (!S.readOpen || !READ.rows.length) return;
  const list = document.querySelector('#mix-read .read'); if (!list) return;
  const t = tpTime();
  let k = -1; for (let i = 0; i < READ.rows.length; i++) { const x = READ.rows[i]; if (x.row && x.at <= t + 0.02) { if (t < x.end + 0.25) k = i; } }
  if (k !== READ.cur) {
    const old = list.querySelector('.read-row.cur'); if (old) { old.classList.remove('cur'); old.querySelector('.rt').style.removeProperty('--p'); }
    READ.cur = k;
    const el = k >= 0 ? list.children[k] : null;
    if (el) {
      el.classList.add('cur');
      if (performance.now() - READ.hold > 4000) {                  // держим текущую на трети высоты — на пружине
        const to = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, el.offsetTop - list.clientHeight * 0.33));
        if (jump || typeof MOTION !== 'undefined' && MOTION.reduce) { mvSet(READ.scroll, to); list.scrollTop = to; } else { READ.scroll.v = list.scrollTop; mvTo(READ.scroll, to, { damping: 1, response: 0.55 }); }
      }
    }
  }
  if (k >= 0) { const x = READ.rows[k], p = Math.max(0, Math.min(1, (t - x.at) / Math.max(0.1, x.end - x.at))); list.children[k].querySelector('.rt').style.setProperty('--p', (p * 100).toFixed(1) + '%'); }
}
