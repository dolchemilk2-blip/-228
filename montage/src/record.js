// Монтажка — дозапись прямо на сайте. Суфлёр (реплика до, эта — крупно, после), отсчёт 3-2-1, микрофон
// без обработки браузера, уровень на стрелке деки и лампа «Эфир», пока пишет. Записанное обрезается по тишине,
// чистится и подгоняется по тембру под основной файл актёра (та же цепочка чистки + «тембр как у образца») и
// встаёт на место реплики как «своя запись». Очередь — все реплики роли, которые надо дозаписать, или одна.
// Для актёра на расстоянии: «Скачать записи (.zip)» — файлы по номерам реплик; режиссёр перетаскивает ZIP или
// файлы «004.wav» в «Записи», и они встают на место сами (recImport).
// Использует S, C, $, esc, fmt, charName, colorOf, notify, render, decodeFile, download из app.js;
// dspCall, cl, clone, refLtas, autoPreset из cleanup.js; rerecList, zipStore из extras.js; пружины и движение.
const REC = { open: false, queue: [], i: 0, live: false, level: 0, stream: null, rec: null, chunks: [], take: null, t0: 0, raf: 0, count: 0, busy: false, done: 0, countdown: true, taken: new Map() };
const recCue = () => REC.queue[REC.i] || null;
function recNear(c, d) { const cues = S.P.cues; let i = cues.indexOf(c) + d; while (i >= 0 && i < cues.length && cues[i].type !== 'line') i += d; return cues[i] && cues[i].type === 'line' ? cues[i] : null; }
/** Очередь: одна реплика или все реплики роли, которые надо дозаписать. */
function recOpen(list) {
  if (!list || !list.length) { notify('Для этой роли дозаписывать нечего.'); return; }
  REC.queue = list; REC.i = 0; REC.take = null; REC.open = true; REC.done = 0; recRender();
}
function recOpenFor(spk) { const all = rerecList(); recOpen((all.get(spk) || []).map(x => x.cue)); }
function recClose(swiped) { recStop(true); REC.open = false; const el = $('#rec'); if (el && !el.hidden) { if (!swiped && typeof sheetGhostOut === 'function') sheetGhostOut(el); el.hidden = true; } render(); }
function recHtml() {
  const c = recCue(); if (!c) return '';
  const p = recNear(c, -1), n = recNear(c, 1), total = REC.queue.length, take = REC.take;
  const line = (x, cls) => x ? `<div class="rec-l ${cls}"><span class="chip ${colorOf(x.spk)}">${esc(charName(x.spk))}</span> ${x.note ? `<i>(${esc(x.note)})</i> ` : ''}${esc(x.text)}</div>` : '';
  return `<div class="rec-in" role="dialog" aria-modal="true" aria-label="Дозапись">
    <div class="rec-grab" aria-hidden="true"></div>
    <div class="rec-head"><b>Дозапись</b><span class="chip ${colorOf(c.spk)}">${esc(charName(c.spk))}</span><span class="muted small"><span data-num="rec:pos">${REC.i + 1} из ${total}</span> · реплика ${esc(c.id)}</span>
      <button class="icon rec-x" data-rec="close" aria-label="Закрыть">${ic('close')}</button></div>
    <div class="rec-prompt">
      ${line(p, 'prev')}
      <div class="rec-l cur">${c.note ? `<i>(${esc(c.note)})</i> ` : ''}${esc(c.text.replace(/^[—–-]\s*/, ''))}</div>
      ${line(n, 'next')}
    </div>
    <div class="rec-meter" aria-hidden="true"><span class="rec-bar"></span><span class="rec-time">${REC.live ? '0:00.0' : take ? fmt(take.y.length / C.SR) : ''}</span></div>
    <div class="rec-ctl">
      ${REC.busy ? `<span class="rec-busy">Обрабатываю: обрезаю тишину, подгоняю звук под запись актёра…</span>` : take ? `
        <button class="play big-take" data-rec="play" aria-label="Послушать дубль">▶</button>
        <button class="ghost-b" data-rec="again">${ic('mic')}Заново</button>
        <button class="primary" data-rec="take">${REC.i + 1 < total ? 'Взять и дальше' : 'Взять'}</button>` : `
        <button class="rec-btn${REC.live ? ' on' : ''}" data-rec="rec" aria-label="${REC.live ? 'Остановить' : 'Записать'}"><span></span></button>
        <span class="muted small">${REC.live ? 'Идёт запись — нажмите, чтобы остановить' : REC.count ? 'Приготовьтесь…' : 'Нажмите и прочитайте реплику'}</span>`}
      ${REC.i + 1 < total && !REC.live ? '<button class="ghost-b tiny" data-rec="skip">Пропустить</button>' : ''}
    </div>
    <div class="rec-foot">
      <label class="mini"><input type="checkbox" data-rec="countdown" ${REC.countdown ? 'checked' : ''}> отсчёт 3-2-1</label>
      ${REC.taken.size ? `<button class="ghost-b tiny" data-rec="zip">${ic('download')}Скачать записи (.zip, ${REC.taken.size})</button>` : ''}
      <span class="muted small">Микрофон без обработки браузера: чистка — своя, под звук остальных записей.</span>
    </div>
    ${REC.count ? `<div class="rec-count" aria-live="assertive">${REC.count}</div>` : ''}
  </div>`;
}
function recRender() {
  let el = $('#rec');
  if (!el) { el = document.createElement('div'); el.id = 'rec'; el.className = 'sheetbox'; el.hidden = true; document.body.appendChild(el); recBind(el); }
  if (!REC.open) { el.hidden = true; return; }
  const html = recHtml(), inn = el.querySelector('.rec-in');
  if (!inn || el.hidden) { el.innerHTML = html; el.hidden = false; REC.shownI = REC.i; return; }
  // шторка уже открыта: меняются только части, а сама шторка (её пружина, перетаскивание) остаётся той же.
  // Следующая реплика подъезжает снизу, как на суфлёре; кнопки сменяются проявлением, а не подменой
  const t = document.createElement('template'); t.innerHTML = html; const nx = t.content.querySelector('.rec-in'); if (!nx) { el.innerHTML = html; return; }
  const moved = REC.shownI !== REC.i, anim = typeof MOTION !== 'undefined' && MOTION.ready && typeof mIn === 'function'; REC.shownI = REC.i;
  for (const sel of ['.rec-head', '.rec-prompt', '.rec-meter', '.rec-ctl', '.rec-foot']) {
    const a = inn.querySelector(sel), b = nx.querySelector(sel); if (!a || !b || a.innerHTML === b.innerHTML) continue;
    a.replaceWith(b);
    if (!anim) continue;
    if (sel === '.rec-prompt' && moved) mIn(b, { opacity: 0, transform: 'translateY(22px)' }, [0.9, 0.36]);
    else if (sel === '.rec-ctl') mIn(b, { opacity: 0, transform: 'scale(0.98)' }, [1, 0.24]);
  }
  const ca = inn.querySelector('.rec-count'), cb = nx.querySelector('.rec-count');
  if (ca && !cb) ca.remove(); else if (cb && !ca) inn.appendChild(cb); else if (ca && cb && ca.textContent !== cb.textContent) ca.replaceWith(cb);
}
function recBind(el) {
  el.addEventListener('click', async e => {
    if (e.target === el) { if (!REC.live) recClose(); return; }                     // щелчок по затемнению
    const b = e.target.closest('[data-rec]'); if (!b) return; const a = b.dataset.rec;
    if (a === 'close') return recClose();
    if (a === 'rec') return REC.live ? recStop() : recStart();
    if (a === 'again') { REC.take = null; recRender(); return recStart(); }
    if (a === 'skip') { REC.take = null; REC.i++; recRender(); return; }
    if (a === 'play') { if (REC.take) { playing && playing.btn === b ? stop() : play(REC.take.y, b); } return; }
    if (a === 'take') return recTake();
    if (a === 'zip') return recZip();
  });
  el.addEventListener('change', e => { if (e.target.dataset.rec === 'countdown') REC.countdown = e.target.checked; });
  if (typeof sheetDrag === 'function') sheetDrag(el, '.rec-grab, .rec-head', () => recClose(true), () => !REC.live && !REC.busy && !REC.count);   // смахнуть вниз; пока пишет — только резина
  document.addEventListener('keydown', e => { if (REC.open && e.key === 'Escape' && !REC.live) recClose(); });
}
/** Микрофон: «сырой» звук — без эхоподавления, шумодава и автоусиления браузера. */
async function recStart() {
  if (REC.live || REC.count) return;
  try {
    if (!REC.stream) REC.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  } catch (err) { notify('Нет доступа к микрофону: ' + (err.message || err.name) + '. Разрешите микрофон для этого сайта.'); return; }
  const ctx = audioCtx(); if (ctx.state === 'suspended') await ctx.resume();
  if (!REC.an) { REC.src = ctx.createMediaStreamSource(REC.stream); REC.an = ctx.createAnalyser(); REC.an.fftSize = 1024; REC.src.connect(REC.an); REC.buf = new Float32Array(REC.an.fftSize); }
  if (REC.countdown) { for (let k = 3; k >= 1; k--) { REC.count = k; recRender(); await new Promise(r => setTimeout(r, 650)); if (!REC.open) { REC.count = 0; return; } } REC.count = 0; }
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  REC.chunks = []; REC.rec = new MediaRecorder(REC.stream, type ? { mimeType: type, audioBitsPerSecond: 192000 } : undefined);
  REC.rec.ondataavailable = e => { if (e.data && e.data.size) REC.chunks.push(e.data); };
  REC.rec.start(); REC.live = true; REC.t0 = performance.now(); recRender();
  if (typeof deckKick === 'function') deckKick();
  const tick = () => {
    if (!REC.live) return;
    REC.an.getFloatTimeDomainData(REC.buf); let s = 0; for (const v of REC.buf) s += v * v; REC.level = Math.sqrt(s / REC.buf.length);
    const bar = document.querySelector('#rec .rec-bar'), tm = document.querySelector('#rec .rec-time');
    if (bar) bar.style.transform = `scaleX(${Math.min(1, Math.max(0.02, (20 * Math.log10(REC.level + 1e-9) + 60) / 60)).toFixed(3)})`;
    if (tm) tm.textContent = fmt((performance.now() - REC.t0) / 1000);
    REC.raf = requestAnimationFrame(tick);
  };
  tick();
}
async function recStop(discard = false) {
  REC.count = 0;
  if (!REC.live) return;
  REC.live = false; cancelAnimationFrame(REC.raf); REC.level = 0;
  const stopped = new Promise(r => { REC.rec.onstop = r; }); REC.rec.stop(); await stopped;
  if (discard) return;
  const blob = new Blob(REC.chunks, { type: REC.rec.mimeType || 'audio/webm' });
  try {
    let y = await decodeFile(blob);
    y = C.trimSilence(y); if (y.length < 0.2 * C.SR) throw new Error('почти тишина — проверьте микрофон');
    REC.take = { y, raw: y };
  } catch (err) { notify('Запись не получилась: ' + err.message); REC.take = null; }
  recRender();
}
/** Взять дубль: подогнать под запись актёра и поставить на место реплики. */
async function recTake() {
  const c = recCue(); if (!c || !REC.take || REC.busy) return;
  REC.busy = true; recRender();
  let y = REC.take.y;
  try { y = await recMatch(y, c.spk); } catch (err) { console.warn('дозапись: чистка не удалась, беру как есть —', err); }
  S.uploads.set(c.id, { name: 'дозапись ' + new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }), y48: y, rec: true });
  REC.taken.set(c.id, y); REC.done++; REC.busy = false; REC.take = null; S.result = null;
  if (REC.i + 1 < REC.queue.length) { REC.i++; recRender(); render(); }
  else { recClose(); notify(`Дозаписано реплик: ${REC.done}. Они уже на местах — сведите заново, чтобы услышать.`); }
}
/** Звук дубля — как у основной записи роли: та же чистка и тембр «как у образца». */
async function recMatch(y, spk) {
  const f = S.files.find(x => x.chars.has(spk) && x.y48 && !x.error);
  if (!f || typeof dspCall !== 'function') return C.fade(y);
  const an = await dspCall({ type: 'analyze', y: y.slice() }, []);
  const base = cl(f).appliedChain ? clone(cl(f).appliedChain) : C.defaultChain(autoPreset(an.A).preset);
  base.tone = { ...base.tone, on: true, mode: 'match', ref: f.name, strength: 0.8 };
  const aux = { noise: an.noise, refLtas: await refLtas(f.name) }, seg = y.slice();
  const r = await dspCall({ type: 'run', y: seg, chain: base, aux }, [seg.buffer]);
  return C.fade(r.y);
}
/** Записи одним архивом: «004 Кэфи.wav» — режиссёр перетаскивает архив в «Записи». */
function recZip() {
  const files = [...REC.taken].map(([id, y]) => { const c = S.P.cues.find(q => q.id === id); return { name: `${id} ${c ? charName(c.spk) : ''}.wav`.trim(), data: new Uint8Array(C.wav24(y)) }; });
  download(zipStore(files), `дозапись-${new Date().toISOString().slice(0, 10)}.zip`);
}
// ------------------------------------------------------------------ приём дозаписи: файлы «004.wav» и ZIP с ними
/** Номер реплики из имени файла: «004.wav», «4 Кэфи.wav», «004_кэфи.m4a». */
function recIdOf(name) {
  if (!S.P) return null; const m = String(name).match(/^(\d{3,4})(?=[\s._-]|$)/); if (!m) return null;
  const id = m[1].padStart(3, '0'); return S.P.cues.some(c => c.id === id && c.type === 'line') ? id : null;
}
/** Разобрать ZIP без сжатия (такой делает «Скачать записи»). */
async function unzipStore(file) {
  const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer), out = [], dec = new TextDecoder();
  let e = buf.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('это не ZIP');
  let p = dv.getUint32(e + 16, true); const n = dv.getUint16(e + 10, true);
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl2 = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl2;
    if (method !== 0) throw new Error('архив сжат — распакуйте его и перетащите файлы');
    const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true), a = off + 30 + lnl + lxl;
    if (!name.endsWith('/')) out.push(new File([buf.slice(a, a + size)], name.split('/').pop()));
  }
  return out;
}
/** Из пришедших файлов забрать дозапись: ZIP и файлы с номером реплики. Остальные — обычные записи. */
async function recImport(list) {
  const rest = [], got = [];
  for (const f of list) {
    try {
      if (/\.zip$/i.test(f.name)) { for (const x of await unzipStore(f)) { const id = recIdOf(x.name); if (id) { await uploadFor(id, x); got.push(id); } } continue; }
      const id = /^(audio\/|)/.test(f.type) && /\.(wav|mp3|m4a|aac|flac|ogg|opus|webm)$/i.test(f.name) ? recIdOf(f.name) : null;
      if (id) { await uploadFor(id, f); got.push(id); } else rest.push(f);
    } catch (err) { notify(`${f.name}: ${err.message}`); }
  }
  if (got.length) notify(`Дозапись встала на места: ${got.length} ${got.length === 1 ? 'реплика' : got.length < 5 ? 'реплики' : 'реплик'} (${got.slice(0, 6).join(', ')}${got.length > 6 ? '…' : ''}).`);
  return rest;
}
