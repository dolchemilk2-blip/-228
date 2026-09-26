// Монтажка — таймлайн «Свои файлы»: простой многодорожечный монтаж любых записей, без сценария и сведения.
// Каждый файл ложится на свою дорожку. Клип тянут — он едет (и на другую дорожку), край — подрезается, уголок
// сверху — плавный вход и выход. S — разрезать на курсоре, Delete — удалить, пробел — играть, Ctrl+Z — отменить.
// Колёсико — прокрутка, с Ctrl (или щипок) — масштаб. Скачивается всё, что звучит, одним файлом MP3 или WAV.
// Монтаж и записи хранятся в браузере (IndexedDB) и переживают перезагрузку.
// Использует S, $, esc, fmt, ic, tpIcon, C, notify, progress, audioCtx, audioOut, stop, decodeFile, download,
// encodeMp3, budget, cssVar, PALETTE, exportBegin из app.js.
const EDK = { HEAD: 132, RULER: 24, ROW: 58, NEW: 34, BIN: 120, EDGE: 8, MAXZ: 800 };
const ED = { tracks: [], clips: [], srcs: new Map(), sel: new Set(), seq: 1, zoom: 0, scroll: 0, W: 0, t: 0,
  play: null, undo: [], redo: [], drag: null, loaded: false, cursor: '' };
const edRow = () => (innerWidth < 640 ? 50 : EDK.ROW);
const edLin = db => Math.pow(10, db / 20);
const edX = t => EDK.HEAD + (t - ED.scroll) * ED.zoom;
const edT = x => ED.scroll + (x - EDK.HEAD) / ED.zoom;
const edEnd = () => ED.clips.reduce((m, c) => Math.max(m, c.at + c.dur), 0);
const edTrack = id => ED.tracks.find(t => t.id === id);
const edClip = id => ED.clips.find(c => c.id === id);
const edAudible = tr => !tr.mute && (!ED.tracks.some(t => t.solo) || tr.solo);

// ------------------------------------------------------------------ хранение в браузере
const EDB = (() => {
  let p = null;
  const open = () => p || (p = new Promise((res, rej) => { const r = indexedDB.open('montage-ed', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const op = async (mode, fn) => { try { const db = await open(); return await new Promise(res => { const t = db.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => res(q && q.result); t.onerror = t.onabort = () => res(null); }); } catch { return null; } };
  return { get: k => op('readonly', s => s.get(k)), put: (k, v) => op('readwrite', s => s.put(v, k)), del: k => op('readwrite', s => s.delete(k)), keys: () => op('readonly', s => s.getAllKeys()) };
})();
let edSaveT = 0;
function edSave() {
  clearTimeout(edSaveT);
  edSaveT = setTimeout(async () => {
    await EDB.put('state', { tracks: ED.tracks, clips: ED.clips, seq: ED.seq, t: ED.t });
    // записи, на которые больше ничего не ссылается (и отменой не вернуть), — из браузера долой
    const keep = new Set(ED.clips.map(c => c.src));
    for (const s of [...ED.undo, ...ED.redo]) for (const c of JSON.parse(s).clips) keep.add(c.src);
    for (const id of [...ED.srcs.keys()]) if (!keep.has(id)) { ED.srcs.delete(id); EDB.del('src:' + id); }
  }, 400);
}
async function edLoad() {
  if (ED.loaded) return; ED.loaded = true;
  const st = await EDB.get('state'); if (!st || !st.clips || !st.clips.length) { edRender(); return; }
  edStatus('Открываю прошлый монтаж…');
  const need = [...new Set(st.clips.map(c => c.src))];
  for (const id of need) {
    const v = await EDB.get('src:' + id); if (!v || !v.y) continue;
    ED.srcs.set(id, { id, name: v.name, y: v.y, dur: v.y.length / C.SR, pk: await edPeaks(v.y) });
  }
  ED.clips = st.clips.filter(c => ED.srcs.has(c.src)); ED.tracks = st.tracks || []; ED.seq = st.seq || 1; ED.t = st.t || 0;
  for (const k of (await EDB.keys()) || []) if (String(k).startsWith('src:') && !ED.srcs.has(String(k).slice(4))) EDB.del(k);
  edStatus(''); ED.zoom = 0; edRender();
}
function edStatus(t) { const el = $('#ed-status'); if (el) el.textContent = t; }

// ------------------------------------------------------------------ записи
/** Пики для рисования волны: максимум модуля на каждые 120 отсчётов (400 в секунду). */
async function edPeaks(y) {
  const n = Math.ceil(y.length / EDK.BIN), pk = new Float32Array(n), tick = budget(12);
  for (let k = 0; k < n; k++) {
    let m = 0; const e = Math.min(y.length, (k + 1) * EDK.BIN);
    for (let i = k * EDK.BIN; i < e; i += 2) { const a = y[i] < 0 ? -y[i] : y[i]; if (a > m) m = a; }
    pk[k] = m; if ((k & 4095) === 0) await tick();
  }
  return pk;
}
const edName = n => String(n || 'запись').replace(/\.[^.]+$/, '').slice(0, 60);
/** Новая запись в монтаж: на дорожку с номером ti (или новую) с момента at. Возвращает клип. */
async function edAddAudio(name, y, at = ED.t, ti = null) {
  const id = 's' + ED.seq++, src = { id, name, y, dur: y.length / C.SR, pk: await edPeaks(y) };
  ED.srcs.set(id, src); EDB.put('src:' + id, { name, y });
  let tr = ti != null ? ED.tracks[ti] : null;
  if (!tr) { tr = { id: 't' + ED.seq++, name: edName(name), mute: false, solo: false, color: PALETTE[ED.tracks.length % PALETTE.length] }; ED.tracks.push(tr); }
  const c = { id: 'c' + ED.seq++, tr: tr.id, src: id, at: Math.max(0, at), off: 0, dur: src.dur, gain: 0, fin: 0, fout: 0 };
  ED.clips.push(c); return c;
}
async function edAddFiles(files, at = ED.t, ti = null) {
  files = [...files].filter(f => /^(audio|video)\//.test(f.type) || /\.(wav|mp3|m4a|aac|flac|ogg|oga|opus|webm|mp4|aif|aiff)$/i.test(f.name));
  if (!files.length) { notify('Это не звук: подойдут wav, mp3, m4a, flac, ogg.'); return; }
  const was = !ED.clips.length, added = [];
  edPush('добавить записи');
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; progress(`Читаю ${f.name}…`, (i + 0.3) / files.length);
    let y; try { y = await decodeFile(f); } catch { notify('Не удалось прочитать ' + f.name); continue; }
    added.push(await edAddAudio(f.name, y, at, i === 0 ? ti : null));
  }
  progress('', 0);
  if (!added.length) { ED.undo.pop(); return; }
  ED.sel = added.length === 1 ? new Set([added[0].id]) : new Set();   // несколько — ничего не выбрано: первый же рывок не потащит все разом
  if (was) ED.zoom = 0;
  edChanged();
  notify(added.length === 1 ? `«${edName(added[0] && ED.srcs.get(added[0].src).name)}» на таймлайне` : `Записей на таймлайне: ${added.length}`);
}

// ------------------------------------------------------------------ отмена и повтор
function edSnap() { return JSON.stringify({ tracks: ED.tracks, clips: ED.clips }); }
function edPush(label) { ED.undo.push(edSnap()); if (ED.undo.length > 100) ED.undo.shift(); ED.redo = []; ED.lastLabel = label; }
function edUndoRedo(back) {
  const from = back ? ED.undo : ED.redo, to = back ? ED.redo : ED.undo; if (!from.length) return;
  to.push(edSnap()); const s = JSON.parse(from.pop()); ED.tracks = s.tracks; ED.clips = s.clips;
  ED.sel = new Set([...ED.sel].filter(id => edClip(id))); edChanged();
}
/** После любой правки: сохранить, перерисовать, а если играет — продолжить с того же места уже с правкой. */
function edChanged() { edSave(); edRender(); if (ED.play) edPlay(edTime()); }

// ------------------------------------------------------------------ правки
function edSplit() {
  const t = ED.t, pick = ED.sel.size ? ED.clips.filter(c => ED.sel.has(c.id)) : ED.clips;
  const hit = pick.filter(c => t > c.at + 0.02 && t < c.at + c.dur - 0.02);
  if (!hit.length) { notify('Разрезать: поставьте курсор внутрь клипа (щелчок по линейке или по пустому месту дорожки).'); return; }
  edPush('разрезать');
  for (const c of hit) {
    const d = t - c.at, b = { ...c, id: 'c' + ED.seq++, at: t, off: c.off + d, dur: c.dur - d, fin: 0 };
    c.dur = d; c.fout = 0; ED.clips.push(b); ED.sel.add(b.id);
  }
  edChanged();
}
function edDelete() {
  if (!ED.sel.size) return;
  edPush('удалить'); ED.clips = ED.clips.filter(c => !ED.sel.has(c.id)); ED.sel.clear(); edChanged();
}
function edGain(d) {
  if (!ED.sel.size) return; edPush('громкость');
  for (const c of ED.clips) if (ED.sel.has(c.id)) c.gain = d === 0 ? 0 : Math.max(-30, Math.min(12, c.gain + d));
  edChanged();
}
function edNudge(d) {
  if (!ED.sel.size) { edSeek(ED.t + d); return; }
  const list = ED.clips.filter(c => ED.sel.has(c.id)), m = Math.min(...list.map(c => c.at)); d = Math.max(-m, d); if (!d) return;
  edPush('сдвинуть'); for (const c of list) c.at += d; edChanged();
}
function edRemoveTrack(tr) {
  edPush('убрать дорожку'); ED.tracks = ED.tracks.filter(t => t !== tr); ED.clips = ED.clips.filter(c => c.tr !== tr.id);
  ED.sel = new Set([...ED.sel].filter(id => edClip(id))); edChanged();
}
function edClear() {
  if (!ED.clips.length || !confirm('Убрать с таймлайна все записи? Отменить можно кнопкой «Отменить».')) return;
  edPush('очистить'); ED.tracks = []; ED.clips = []; ED.sel.clear(); edPause(); ED.t = 0; ED.zoom = 0; edChanged();
}

// ------------------------------------------------------------------ воспроизведение
function edTime() { const p = ED.play; return p ? Math.max(0, p.t0 + (audioCtx().currentTime - p.c0)) : ED.t; }
function edPlay(t = ED.t) {
  const end = edEnd(); if (!end) return;
  if (t >= end - 0.05) t = 0;
  const keep = !!ED.play; edStopNodes();
  if (!keep && typeof stop === 'function') stop();          // остальные плееры Монтажки замолкают
  const ctx = audioCtx(); ctx.resume();
  const c0 = ctx.currentTime + 0.04, out = audioOut(), nodes = [];
  for (const c of ED.clips) {
    const tr = edTrack(c.tr), src = ED.srcs.get(c.src); if (!tr || !src || !edAudible(tr) || c.at + c.dur <= t) continue;
    if (!src.buf) { src.buf = ctx.createBuffer(1, src.y.length, C.SR); src.buf.copyToChannel(src.y, 0); }
    const s = ctx.createBufferSource(), g = ctx.createGain(), k = edLin(c.gain), from = Math.max(t, c.at);
    const env = tt => k * (c.fin > 0 ? Math.min(1, (tt - c.at) / c.fin) : 1) * (c.fout > 0 ? Math.min(1, (c.at + c.dur - tt) / c.fout) : 1);
    const when = c0 + (from - t), at = tt => c0 + (tt - t);
    g.gain.setValueAtTime(Math.max(0, env(from)), when);
    if (c.fin > 0 && from < c.at + c.fin) g.gain.linearRampToValueAtTime(k * (c.fout > 0 ? Math.min(1, (c.dur - c.fin) / c.fout) : 1), at(c.at + c.fin));
    if (c.fout > 0) { const fs = Math.max(from, c.at + c.dur - c.fout); g.gain.setValueAtTime(Math.max(0, env(fs)), at(fs)); g.gain.linearRampToValueAtTime(0, at(c.at + c.dur)); }
    s.buffer = src.buf; s.connect(g); g.connect(out); s.start(when, c.off + (from - c.at), c.at + c.dur - from); nodes.push(s);
  }
  ED.play = { t0: t, c0, nodes, end };
  edBarUi(); edFollow();
}
function edStopNodes() { if (!ED.play) return; for (const s of ED.play.nodes) { try { s.stop(); } catch {} } ED.play.nodes = []; }
function edPause() { if (!ED.play) return; ED.t = Math.min(edTime(), ED.play.end); edStopNodes(); ED.play = null; edBarUi(); edHead(); edSave(); }
// когда заиграло что-то другое в Монтажке (app.js зовёт stop()) — таймлайн замолкает
function edStop() { if (ED.play) edPause(); }
function edToggle() { if (ED.play) edPause(); else edPlay(); }
function edSeek(t) { t = Math.max(0, Math.min(t, Math.max(edEnd(), 0))); if (ED.play) edPlay(t); else { ED.t = t; edHead(); edBarUi(); edSave(); } }
let edRaf = 0;
function edFollow() {
  cancelAnimationFrame(edRaf);
  const step = () => {
    edRaf = 0; if (!ED.play) return;
    const t = edTime();
    if (t >= ED.play.end) { ED.t = 0; edStopNodes(); ED.play = null; edBarUi(); edHead(); return; }
    ED.t = t; edHead();
    const x = edX(t), W = ED.W || 800;
    if ((x > W - 30 || x < EDK.HEAD) && !ED.drag) { ED.scroll = Math.max(0, t - (W - EDK.HEAD) / ED.zoom * 0.1); edDraw(); }
    const el = $('#ed-time'); if (el) { const txt = `${fmt(t)} / ${fmt(edEnd())}`; if (el.textContent !== txt) el.textContent = txt; }
    edRaf = requestAnimationFrame(step);
  };
  edRaf = requestAnimationFrame(step);
}
function edHead() {
  const el = $('#ed-head'); if (!el) return;
  const x = edX(ED.play ? edTime() : ED.t), show = ED.clips.length && x >= EDK.HEAD - 1 && x <= (ED.W || 800) + 1;
  el.style.transform = `translate3d(${(x - 1).toFixed(2)}px, 0, 0)`; el.style.opacity = show ? '' : '0';
}

// ------------------------------------------------------------------ скачивание
/** Всё, что звучит, одной дорожкой 48 кГц: громкость клипов, входы и выходы, без заглушённых дорожек. */
async function edMix() {
  const list = ED.clips.filter(c => { const tr = edTrack(c.tr); return tr && edAudible(tr); }), end = list.reduce((m, c) => Math.max(m, c.at + c.dur), 0);
  if (!end) return null;
  const out = new Float32Array(Math.ceil(end * C.SR) + 1), tick = budget(12);
  for (let q = 0; q < list.length; q++) {
    const c = list[q], y = ED.srcs.get(c.src).y, k = edLin(c.gain), a0 = Math.round(c.at * C.SR), o0 = Math.round(c.off * C.SR);
    const n = Math.min(Math.round(c.dur * C.SR), y.length - o0, out.length - a0), fi = c.fin * C.SR, fo = c.fout * C.SR;
    for (let a = 0; a < n; a += 1 << 18) {
      for (let j = a, b = Math.min(n, a + (1 << 18)); j < b; j++) { let e = k; if (j < fi) e *= j / fi; if (n - j < fo) e *= (n - j) / fo; out[a0 + j] += y[o0 + j] * e; }
      progress('Свожу таймлайн…', (q + a / n) / list.length); await tick();
    }
  }
  let pk = 0; for (let i = 0; i < out.length; i++) { const a = out[i] < 0 ? -out[i] : out[i]; if (a > pk) pk = a; }
  if (pk > 0.97) C.limit(out, 0.94, true);                   // перегруз от сложения дорожек — мягко под потолок
  progress('', 0);
  return out;
}
async function edExport(kind) {
  if (!ED.clips.length) return;
  const ex = await exportBegin(kind === 'mp3' ? 'MP3 из таймлайна' : 'WAV из таймлайна'); if (!ex) return;
  if (ED.play) edPause();
  const btns = [...document.querySelectorAll('#ed [data-ed^="dl-"]')]; btns.forEach(b => { b.disabled = true; });
  try {
    const x = await edMix(); if (!x) { notify('Нечего скачивать: все дорожки выключены.'); return; }
    const blob = kind === 'mp3' ? await encodeMp3(x, 256) : new Blob([C.wav24(x)], { type: 'audio/wav' });
    progress('', 0);
    if (!(await ex.commit())) return;
    const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    download(blob, `таймлайн-${stamp}.${kind}`);
  } catch (err) { progress('', 0); notify('Не получилось: ' + err.message); }
  finally { btns.forEach(b => { b.disabled = false; }); }
}

// ------------------------------------------------------------------ отрисовка
function edBarHtml() {
  const end = edEnd(), has = ED.clips.length > 0, lock = typeof exportLocked === 'function' && exportLocked();
  return `<div class="tl-group tl-tp"><button class="play tp-play-btn" data-ed="play" aria-label="${ED.play ? 'Пауза' : 'Играть'}" title="Играть и пауза (пробел)" ${has ? '' : 'disabled'}>${tpIcon(!!ED.play)}</button><span class="tp-time-txt" id="ed-time">${fmt(ED.play ? edTime() : ED.t)} / ${fmt(end)}</span></div>
    <div class="tl-group"><label class="ghost-b tiny file-b">${ic('plus')}Добавить записи<input type="file" id="ed-add" accept="audio/*,video/*,.m4a,.opus,.flac,.aif,.aiff" multiple hidden></label></div>
    <div class="tl-group"><button class="icon-b" data-ed="undo" aria-label="Отменить" title="Отменить (Ctrl+Z)" ${ED.undo.length ? '' : 'disabled'}>${ic('undo')}</button><button class="icon-b" data-ed="redo" aria-label="Повторить" title="Повторить (Ctrl+Shift+Z)" ${ED.redo.length ? '' : 'disabled'}>${ic('redo')}</button></div>
    <div class="tl-group"><button class="ghost-b tiny" data-ed="split" title="Разрезать на курсоре (S)" ${has ? '' : 'disabled'}>${ic('cut')}Разрезать</button><button class="ghost-b tiny" data-ed="del" title="Удалить выбранное (Delete)" ${ED.sel.size ? '' : 'disabled'}>${ic('trash')}Удалить</button></div>
    <div class="tl-group"><button class="icon-b" data-ed="zoom-" title="Мельче (−)" aria-label="Уменьшить масштаб" ${has ? '' : 'disabled'}>${ic('minus')}</button><button class="ghost-b tiny" data-ed="fit" title="Всё целиком (0)" ${has ? '' : 'disabled'}>всё</button><button class="icon-b" data-ed="zoom+" title="Крупнее (+)" aria-label="Увеличить масштаб" ${has ? '' : 'disabled'}>${ic('plus')}</button></div>
    <div class="tl-group ed-dl"><button class="primary small" data-ed="dl-mp3" ${has ? '' : 'disabled'}>${ic(lock ? 'lock' : 'download')}MP3</button><button class="ghost-b tiny" data-ed="dl-wav" ${has ? '' : 'disabled'}>${lock ? ic('lock') : ''}WAV</button></div>`;
}
function edInfoHtml() {
  if (!ED.clips.length) return '';
  const sel = ED.clips.filter(c => ED.sel.has(c.id));
  const gain = `<span class="gain">громкость <button class="icon" data-ed="g-" aria-label="Тише на 1 дБ">${ic('minus')}</button><button class="icon" data-ed="g+" aria-label="Громче на 1 дБ">${ic('plus')}</button></span>`;
  if (!sel.length) return '<span class="muted">Тяните клип — двигать, в том числе на другую дорожку · за край — подрезать · уголок сверху — плавный вход и выход · <b>S</b> — разрезать на курсоре · <b>Delete</b> — удалить · <b>пробел</b> — играть · Ctrl+Z — отменить · колёсико — листать, с Ctrl или щипком — масштаб</span>';
  if (sel.length > 1) return `<b>Выбрано ${sel.length}</b>${gain}<button class="ghost-b tiny" data-ed="g0">громкость 0 дБ</button><button class="ghost-b tiny" data-ed="desel">снять выделение</button>`;
  const c = sel[0], src = ED.srcs.get(c.src);
  return `<b>${esc(edName(src && src.name))}</b><span>начало <b>${C.ts(c.at)}</b></span><span>длина <b>${c.dur.toFixed(2)} с</b></span>${gain}${c.gain ? `<span><b>${c.gain > 0 ? '+' : '−'}${Math.abs(c.gain)} дБ</b></span>` : ''}
    ${c.fin ? `<span>вход <b>${c.fin.toFixed(2)} с</b></span>` : ''}${c.fout ? `<span>выход <b>${c.fout.toFixed(2)} с</b></span>` : ''}${c.fin || c.fout ? '<button class="ghost-b tiny" data-ed="nofade">без плавности</button>' : ''}`;
}
function edBarUi() {
  const bar = $('#ed .ed-bar'); if (!bar) return;
  const ae = document.activeElement, fk = ae && bar.contains(ae) && ae.dataset.ed ? `[data-ed="${ae.dataset.ed}"]` : null;
  if (setHtml(bar, edBarHtml()) && fk) { const n = bar.querySelector(fk); if (n && !n.disabled) n.focus({ preventScroll: true }); }
  const info = $('#ed-info'); if (info) setHtml(info, edInfoHtml());
}
function edRender() {
  const host = $('#tlp-files'); if (!host) return;
  if (!host.querySelector('#ed')) {
    host.innerHTML = `<div id="ed" class="ed">
      <div class="tl-bar ed-bar"></div>
      <div class="ed-empty" id="ed-empty">
        <label class="ed-drop"><input type="file" id="ed-pick" accept="audio/*,video/*,.m4a,.opus,.flac,.aif,.aiff" multiple hidden>
          <span class="ed-drop-ic">${ic('tracks')}</span><b>Перетащите сюда записи</b><span class="muted">или нажмите, чтобы выбрать файлы — wav, mp3, m4a, flac, ogg</span></label>
        <ul class="ed-can"><li>Каждая запись — на своей дорожке; клипы двигаются, в том числе между дорожками</li><li>Подрезать края, разрезать на курсоре, удалить лишнее</li><li>Громкость клипа и плавный вход и выход</li><li>Слушать прямо здесь и скачать всё одним файлом MP3 или WAV</li></ul>
        <p class="muted small" id="ed-status"></p>
      </div>
      <div class="ed-canvas" hidden><canvas id="ed-cv" tabindex="0" aria-label="Таймлайн своих записей: пробел — играть, S — разрезать, Delete — удалить, стрелки — сдвинуть"></canvas><div class="tl-head" id="ed-head" aria-hidden="true"></div></div>
      <div class="tl-info" id="ed-info"></div>
      <div class="ed-foot"><button class="ghost-b tiny" data-ed="clear">Очистить таймлайн</button></div>
    </div>`;
  }
  const has = ED.clips.length > 0 || ED.tracks.length > 0;
  $('#ed-empty').hidden = has; $('#ed .ed-canvas').hidden = !has; $('#ed .ed-foot').hidden = !has; $('#ed-info').hidden = !has; $('#ed .ed-bar').hidden = !has;   // пусто — только место, куда бросить записи
  edBarUi(); edDraw();
}
function edFit() { const W = ED.W || 800, end = edEnd() || 30; ED.zoom = Math.max(0.5, (W - EDK.HEAD - 16) / end); ED.scroll = 0; }
function edClamp() {
  const W = ED.W || 800, area = W - EDK.HEAD, minZ = Math.min(area / Math.max(edEnd() + 5, 10), 20);
  ED.zoom = Math.max(minZ, Math.min(EDK.MAXZ, ED.zoom));
  ED.scroll = Math.max(0, Math.min(ED.scroll, Math.max(0, edEnd() + 5 - area / ED.zoom)));
}
function edDraw() {
  const cv = $('#ed-cv'); if (!cv || !cv.getClientRects().length) return;
  const dpr = devicePixelRatio || 1, W = Math.max(320, Math.floor(cv.clientWidth)), ROW = edRow(), n = ED.tracks.length, H = EDK.RULER + n * ROW + EDK.NEW + 4;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; }
  ED.W = W; if (!ED.zoom) edFit(); edClamp();
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ink = cssVar('--ink'), muted = cssVar('--muted'), line = cssVar('--line'), line2 = cssVar('--line2'), bg = cssVar('--well'), surface = cssVar('--surface'), accent = cssVar('--accent');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // линейка: шаг подписей — чтобы между ними было не меньше 70 px
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600], st = steps.find(s => s * ED.zoom >= 70) || 600;
  g.fillStyle = surface; g.fillRect(EDK.HEAD, 0, W - EDK.HEAD, EDK.RULER);
  g.font = `11px ${cssVar('--mono') || 'monospace'}`; g.textBaseline = 'middle';
  const t0 = Math.floor(ED.scroll / st) * st, t1 = edT(W);
  for (let t = t0; t <= t1; t += st) {
    const x = edX(t); if (x < EDK.HEAD) continue;
    g.fillStyle = line; g.fillRect(Math.round(x), EDK.RULER - 7, 1, 7);
    g.fillStyle = muted; g.fillText(st < 1 ? t.toFixed(1) + ' с' : C.ts(t), Math.round(x) + 4, EDK.RULER / 2);
    g.fillStyle = line2; g.fillRect(Math.round(x), EDK.RULER, 1, H - EDK.RULER);
  }
  g.fillStyle = line; g.fillRect(0, EDK.RULER - 1, W, 1);
  // дорожки
  for (let i = 0; i <= n; i++) {
    const y = EDK.RULER + i * ROW;
    if (i === n) {                                          // пустая полоса снизу — сюда можно бросить клип или файл
      g.strokeStyle = line; g.setLineDash([4, 4]); g.strokeRect(EDK.HEAD + 4.5, y + 4.5, W - EDK.HEAD - 9, EDK.NEW - 9); g.setLineDash([]);
      g.fillStyle = muted; g.font = `12px ${cssVar('--sans')}`; g.fillText(ED.drag && ED.drag.kind === 'move' ? 'Сюда — на новую дорожку' : '+ новая дорожка: перетащите сюда клип или файл', EDK.HEAD + 14, y + EDK.NEW / 2);
      break;
    }
    g.fillStyle = line2; g.fillRect(EDK.HEAD, y + ROW - 1, W - EDK.HEAD, 1);
  }
  g.save(); g.beginPath(); g.rect(EDK.HEAD, EDK.RULER, W - EDK.HEAD, H - EDK.RULER); g.clip();
  const dr = ED.drag;
  for (const c of ED.clips) {
    const ti = ED.tracks.findIndex(t => t.id === c.tr); if (ti < 0) continue;
    const tr = ED.tracks[ti], x0 = edX(c.at), x1 = edX(c.at + c.dur); if (x1 < EDK.HEAD || x0 > W) continue;
    const y = EDK.RULER + ti * ROW + 4, h = ROW - 9, sel = ED.sel.has(c.id), col = cssVar('--' + tr.color), soft = cssVar('--' + tr.color + 's');
    g.globalAlpha = edAudible(tr) ? 1 : 0.4;
    g.fillStyle = soft; g.beginPath(); g.roundRect(x0, y, Math.max(2, x1 - x0), h, 5); g.fill();
    // волна: на каждый пиксель — максимум пиков под ним, с громкостью и плавностью клипа
    const src = ED.srcs.get(c.src);
    if (src && src.pk) {
      const k = edLin(c.gain), mid = y + h / 2 + 5, amp = (h - 14) / 2, a = Math.max(x0, EDK.HEAD), b = Math.min(x1, W);
      g.fillStyle = col;
      for (let x = Math.floor(a); x < b; x++) {
        const ta = edT(x) - c.at, tb = ta + 1 / ED.zoom, i0 = Math.floor((c.off + ta) * C.SR / EDK.BIN), i1 = Math.max(i0 + 1, Math.ceil((c.off + tb) * C.SR / EDK.BIN));
        let m = 0; for (let i = Math.max(0, i0); i < Math.min(src.pk.length, i1); i++) if (src.pk[i] > m) m = src.pk[i];
        let e = k; if (c.fin > 0 && ta < c.fin) e *= Math.max(0, ta / c.fin); if (c.fout > 0 && c.dur - ta < c.fout) e *= Math.max(0, (c.dur - ta) / c.fout);
        const v = Math.min(1, m * e) * amp; if (v > 0.3) g.fillRect(x, mid - v, 1, v * 2);
      }
    }
    // плавный вход и выход: линия огибающей и затенение над ней
    g.strokeStyle = col; g.lineWidth = 1.2;
    if (c.fin > 0) { const xf = edX(c.at + c.fin); g.beginPath(); g.moveTo(x0, y + h); g.lineTo(xf, y + 2); g.stroke(); }
    if (c.fout > 0) { const xf = edX(c.at + c.dur - c.fout); g.beginPath(); g.moveTo(xf, y + 2); g.lineTo(x1, y + h); g.stroke(); }
    g.lineWidth = sel ? 2 : 1; g.strokeStyle = sel ? accent : col; g.beginPath(); g.roundRect(x0 + (sel ? 1 : 0.5), y + (sel ? 1 : 0.5), Math.max(1, x1 - x0 - (sel ? 2 : 1)), h - (sel ? 2 : 1), 5); g.stroke();
    // подпись и уголки плавности у выбранного
    if (x1 - x0 > 40) {
      g.save(); g.beginPath(); g.rect(x0 + 4, y, Math.max(0, x1 - x0 - 8), h); g.clip();
      g.fillStyle = ink; g.font = `600 11.5px ${cssVar('--sans')}`; g.textBaseline = 'top';
      g.fillText(edName(src && src.name) + (c.gain ? `  ${c.gain > 0 ? '+' : '−'}${Math.abs(c.gain)} дБ` : ''), Math.max(x0, EDK.HEAD) + 6, y + 4); g.restore();
    }
    if (sel || (ED.hover === c.id)) {
      g.fillStyle = accent; for (const hx of [edX(c.at + c.fin), edX(c.at + c.dur - c.fout)]) { g.beginPath(); g.roundRect(hx - 4, y - 1, 8, 8, 2); g.fill(); }
    }
    g.globalAlpha = 1;
  }
  if (dr && dr.snap != null) { const x = edX(dr.snap); g.fillStyle = accent; g.fillRect(Math.round(x), EDK.RULER, 1, n * ROW + EDK.NEW); }
  g.restore();
  // головы дорожек: имя, «без звука», «только она», убрать
  g.fillStyle = surface; g.fillRect(0, 0, EDK.HEAD, H); g.fillStyle = line; g.fillRect(EDK.HEAD - 1, 0, 1, H);
  g.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const tr = ED.tracks[i], y = EDK.RULER + i * ROW;
    g.fillStyle = cssVar('--' + tr.color); g.fillRect(0, y + 4, 3, ROW - 9);
    g.fillStyle = ink; g.font = `600 12.5px ${cssVar('--sans')}`;
    let name = tr.name; while (name.length > 3 && g.measureText(name).width > EDK.HEAD - 22) name = name.slice(0, -2);
    g.fillText(name === tr.name ? name : name + '…', 12, y + 15);
    for (const [k, bx] of edHeadBtns(y, ROW)) {
      const on = (k === 'm' && tr.mute) || (k === 's' && tr.solo);
      g.fillStyle = on ? (k === 'm' ? cssVar('--bad') : accent) : bg; g.strokeStyle = line;
      g.beginPath(); g.roundRect(bx.x, bx.y, bx.w, bx.h, 4); g.fill(); g.stroke();
      g.fillStyle = on ? (k === 'm' ? '#fff' : cssVar('--accent-ink')) : muted; g.font = `600 11px ${cssVar('--sans')}`; g.textAlign = 'center';
      g.fillText(k === 'm' ? 'M' : k === 's' ? 'S' : '×', bx.x + bx.w / 2, bx.y + bx.h / 2 + 0.5); g.textAlign = 'left';
    }
  }
  edHead();
}
function edHeadBtns(y, ROW) { const by = y + ROW - 25; return [['m', { x: 12, y: by, w: 24, h: 18 }], ['s', { x: 40, y: by, w: 24, h: 18 }], ['x', { x: EDK.HEAD - 34, y: by, w: 22, h: 18 }]]; }

// ------------------------------------------------------------------ мышь, палец, клавиши
function edPos(e) { const r = $('#ed-cv').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function edHit(x, y) {
  const ROW = edRow(), n = ED.tracks.length;
  if (y < EDK.RULER) return x < EDK.HEAD ? null : { ruler: true, t: edT(x) };
  const i = Math.floor((y - EDK.RULER) / ROW);
  if (i >= n) return { lane: n, t: edT(x), empty: true };
  const tr = ED.tracks[i], ly = EDK.RULER + i * ROW;
  if (x < EDK.HEAD) { for (const [k, b] of edHeadBtns(ly, ROW)) if (x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2) return { head: tr, btn: k }; return { head: tr }; }
  const t = edT(x), cy = ly + 4;
  const on = ED.clips.filter(c => c.tr === tr.id).reverse();
  for (const c of on) {
    const x0 = edX(c.at), x1 = edX(c.at + c.dur); if (x < x0 - 3 || x > x1 + 3) continue;
    if (ED.sel.has(c.id) || ED.hover === c.id) {
      if (y < cy + 12 && Math.abs(x - edX(c.at + c.fin)) < 8) return { clip: c, part: 'fin', lane: i, t };
      if (y < cy + 12 && Math.abs(x - edX(c.at + c.dur - c.fout)) < 8) return { clip: c, part: 'fout', lane: i, t };
    }
    const wide = x1 - x0 > EDK.EDGE * 3;
    if (wide && x - x0 < EDK.EDGE) return { clip: c, part: 'l', lane: i, t };
    if (wide && x1 - x < EDK.EDGE) return { clip: c, part: 'r', lane: i, t };
    return { clip: c, part: 'body', lane: i, t };
  }
  return { lane: i, t, empty: true };
}
/** Прилипание: край к краю соседнего клипа (на любой дорожке), к курсору и к нулю, если ближе 8 px. */
function edSnapT(ts, moving) {
  const tol = 8 / ED.zoom; let best = null;
  const cand = [0, ED.t]; for (const c of ED.clips) if (!moving.has(c.id)) cand.push(c.at, c.at + c.dur);
  for (const T of cand) for (const e of ts) { const d = T - e; if (Math.abs(d) < tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t: T }; }
  return best;
}
function bindEditor() {
  const host = $('#tlp-files'); if (!host || host._bound) return; host._bound = true;
  const touches = new Map();
  host.addEventListener('pointerdown', e => {
    if (e.target.id !== 'ed-cv' || e.button === 2) return;
    const cv = e.target; cv.focus({ preventScroll: true });
    if (e.pointerType === 'touch') { touches.set(e.pointerId, e.clientX); if (touches.size === 2) { const [a, b] = [...touches.values()], mx = (a + b) / 2 - cv.getBoundingClientRect().left; ED.drag = { kind: 'pinch', d0: Math.abs(a - b) || 1, z0: ED.zoom, t: edT(mx), mx }; return; } }
    const p = edPos(e), h = edHit(p.x, p.y); if (!h) return;
    try { cv.setPointerCapture(e.pointerId); } catch {}
    if (h.ruler) { ED.drag = { kind: 'seek' }; edSeek(h.t); return; }
    if (h.head) {
      if (h.btn === 'm') { edPush('без звука'); h.head.mute = !h.head.mute; edChanged(); }
      else if (h.btn === 's') { edPush('только эта дорожка'); h.head.solo = !h.head.solo; edChanged(); }
      else if (h.btn === 'x') edRemoveTrack(h.head);
      else { ED.sel = new Set(ED.clips.filter(c => c.tr === h.head.id).map(c => c.id)); edBarUi(); edDraw(); }
      return;
    }
    if (h.clip) {
      const c = h.clip, add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (add) { ED.sel.has(c.id) ? ED.sel.delete(c.id) : ED.sel.add(c.id); edBarUi(); edDraw(); return; }
      if (!ED.sel.has(c.id) || h.part !== 'body') ED.sel = new Set([c.id]);
      const ids = h.part === 'body' ? new Set(ED.sel) : new Set([c.id]);
      ED.drag = { kind: h.part === 'body' ? 'move' : h.part, x0: p.x, y0: p.y, lane0: h.lane, id: c.id, ids, moved: false,
        orig: new Map(ED.clips.filter(x => ids.has(x.id)).map(x => [x.id, { at: x.at, off: x.off, dur: x.dur, fin: x.fin, fout: x.fout, ti: ED.tracks.findIndex(t => t.id === x.tr) }])) };
      edBarUi(); edDraw(); return;
    }
    ED.drag = { kind: 'pan', x0: p.x, s0: ED.scroll, t: h.t, moved: false };
  });
  host.addEventListener('pointermove', e => {
    if (e.target.id !== 'ed-cv') return;
    const cv = e.target, p = edPos(e), d = ED.drag;
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, e.clientX);
    if (!d) {                                                  // наведение: курсор и уголки плавности
      const h = edHit(p.x, p.y), cur = !h ? '' : h.ruler ? 'text' : h.head ? (h.btn ? 'pointer' : 'default') : h.clip ? (h.part === 'l' || h.part === 'r' ? 'ew-resize' : h.part === 'body' ? 'grab' : 'col-resize') : 'default';
      if (cur !== ED.cursor) { ED.cursor = cur; cv.style.cursor = cur; }
      const hv = h && h.clip ? h.clip.id : null; if (hv !== ED.hover) { ED.hover = hv; edDraw(); }
      return;
    }
    if (d.kind === 'pinch') { if (touches.size < 2) return; const [a, b] = [...touches.values()]; ED.zoom = d.z0 * Math.abs(a - b) / d.d0; edClamp(); ED.scroll = Math.max(0, d.t - (d.mx - EDK.HEAD) / ED.zoom); edDraw(); return; }
    if (d.kind === 'seek') { edSeek(edT(p.x)); return; }
    const dx = (p.x - d.x0) / ED.zoom;
    if (d.kind === 'pan') { if (Math.abs(p.x - d.x0) > 3) d.moved = true; ED.scroll = Math.max(0, d.s0 - dx); edDraw(); return; }
    if (!d.moved) { if (Math.abs(p.x - d.x0) < 3 && Math.abs(p.y - d.y0) < 3) return; d.moved = true; edPush(d.kind === 'move' ? 'сдвинуть' : d.kind === 'fin' || d.kind === 'fout' ? 'плавность' : 'подрезать'); cv.style.cursor = d.kind === 'move' ? 'grabbing' : cv.style.cursor; }
    const o = d.orig.get(d.id), c = edClip(d.id); d.snap = null;
    if (d.kind === 'move') {
      const list = [...d.orig.keys()].map(edClip).filter(Boolean), minAt = Math.min(...[...d.orig.values()].map(v => v.at));
      let delta = Math.max(-minAt, dx);
      const sn = edSnapT(list.flatMap(x => { const v = d.orig.get(x.id); return [v.at + delta, v.at + v.dur + delta]; }), d.ids);
      if (sn) { delta = Math.max(-minAt, delta + sn.d); d.snap = sn.t; }
      const n = ED.tracks.length, lane = Math.max(0, Math.min(n, Math.floor((p.y - EDK.RULER) / edRow()))), dl = lane - d.lane0;
      const tiMin = Math.min(...[...d.orig.values()].map(v => v.ti)), tiMax = Math.max(...[...d.orig.values()].map(v => v.ti));
      const dlc = Math.max(-tiMin, Math.min(n - 1 - tiMax, dl)); d.toNew = list.length === 1 && lane === n;
      for (const x of list) { const v = d.orig.get(x.id); x.at = v.at + delta; x.tr = ED.tracks[d.toNew ? v.ti : v.ti + dlc].id; }
    } else if (d.kind === 'l') {
      const src = ED.srcs.get(c.src); let at = Math.max(o.at - o.off, 0, Math.min(o.at + o.dur - 0.05, o.at + dx));
      const sn = edSnapT([at], d.ids); if (sn && sn.t >= o.at - o.off && sn.t <= o.at + o.dur - 0.05) { at = sn.t; d.snap = sn.t; }
      c.at = at; c.off = o.off + (at - o.at); c.dur = Math.min(src.dur - c.off, o.dur - (at - o.at)); c.fin = Math.min(c.fin, c.dur / 2);
    } else if (d.kind === 'r') {
      const src = ED.srcs.get(c.src); let dur = Math.max(0.05, Math.min(src.dur - o.off, o.dur + dx));
      const sn = edSnapT([o.at + dur], d.ids); if (sn && sn.t - o.at >= 0.05 && sn.t - o.at <= src.dur - o.off) { dur = sn.t - o.at; d.snap = sn.t; }
      c.dur = dur; c.fout = Math.min(c.fout, c.dur / 2);
    } else if (d.kind === 'fin') c.fin = Math.max(0, Math.min(c.dur - c.fout, edT(p.x) - c.at));
    else if (d.kind === 'fout') c.fout = Math.max(0, Math.min(c.dur - c.fin, c.at + c.dur - edT(p.x)));
    edDraw(); const info = $('#ed-info'); if (info) setHtml(info, edInfoHtml());
  });
  const up = e => {
    if (e.pointerType === 'touch') touches.delete(e.pointerId);
    const d = ED.drag; if (!d) return;
    if (d.kind === 'pinch') { if (touches.size < 2) ED.drag = null; return; }
    ED.drag = null;
    if (d.kind === 'pan' && !d.moved && e.type === 'pointerup') { ED.sel.clear(); edSeek(d.t); edBarUi(); edDraw(); return; }
    if (d.kind === 'seek' || d.kind === 'pan') { edDraw(); return; }
    if (!d.moved) { edDraw(); return; }
    if (d.toNew) { const c = edClip(d.id), src = ED.srcs.get(c.src), tr = { id: 't' + ED.seq++, name: edName(src && src.name), mute: false, solo: false, color: PALETTE[ED.tracks.length % PALETTE.length] }; ED.tracks.push(tr); c.tr = tr.id; }
    const cv = $('#ed-cv'); if (cv) cv.style.cursor = ED.cursor = '';
    edChanged();
  };
  host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
  host.addEventListener('wheel', e => {
    if (e.target.id !== 'ed-cv') return;
    if (e.ctrlKey || e.metaKey) {                              // щипок на тачпаде приходит сюда же, с Ctrl
      e.preventDefault(); const mx = edPos(e).x, t = edT(mx); ED.zoom *= Math.exp(-e.deltaY * 0.01); edClamp(); ED.scroll = Math.max(0, t - (mx - EDK.HEAD) / ED.zoom); edDraw(); return;
    }
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0; if (!dx) return;
    e.preventDefault(); ED.scroll = Math.max(0, ED.scroll + dx / ED.zoom); edDraw();
  }, { passive: false });
  host.addEventListener('click', e => {
    const b = e.target.closest('[data-ed]'); if (!b || b.disabled) return; const a = b.dataset.ed;
    if (a === 'play') edToggle(); else if (a === 'undo') edUndoRedo(true); else if (a === 'redo') edUndoRedo(false);
    else if (a === 'split') edSplit(); else if (a === 'del') edDelete(); else if (a === 'clear') edClear();
    else if (a === 'g-') edGain(-1); else if (a === 'g+') edGain(1); else if (a === 'g0') edGain(0);
    else if (a === 'desel') { ED.sel.clear(); edBarUi(); edDraw(); }
    else if (a === 'nofade') { edPush('без плавности'); for (const c of ED.clips) if (ED.sel.has(c.id)) { c.fin = 0; c.fout = 0; } edChanged(); }
    else if (a === 'zoom+' || a === 'zoom-') { const mid = edT(EDK.HEAD + (ED.W - EDK.HEAD) / 2); ED.zoom *= a === 'zoom+' ? 1.6 : 1 / 1.6; edClamp(); ED.scroll = Math.max(0, mid - (ED.W - EDK.HEAD) / 2 / ED.zoom); edDraw(); }
    else if (a === 'fit') { edFit(); edDraw(); }
    else if (a === 'dl-mp3') edExport('mp3'); else if (a === 'dl-wav') edExport('wav');
  });
  host.addEventListener('change', e => { if (e.target.id === 'ed-add' || e.target.id === 'ed-pick') { const f = e.target.files; if (f && f.length) edAddFiles(f); e.target.value = ''; } });
  // файлы бросают на всю вкладку; на холст — туда, где отпустили
  const pane = host.closest('[data-tabpane]') || host;
  pane.addEventListener('dragover', e => { if (S.tlMode !== 'files' || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); host.classList.add('over'); });
  pane.addEventListener('dragleave', e => { if (!pane.contains(e.relatedTarget)) host.classList.remove('over'); });
  pane.addEventListener('drop', e => {
    if (S.tlMode !== 'files' || !e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); host.classList.remove('over');
    if (e.target.id === 'ed-cv') { const p = edPos(e), h = edHit(p.x, p.y); if (h && h.t != null && !h.ruler) { edAddFiles(e.dataTransfer.files, Math.max(0, h.t), h.lane < ED.tracks.length ? h.lane : null); return; } }
    edAddFiles(e.dataTransfer.files);
  });
  document.addEventListener('keydown', e => {
    if (S.tab !== 'tl' || S.tlMode !== 'files' || !ED.tracks.length || e.defaultPrevented) return;
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable || e.target.closest('.theme-pop, .g-lock, .g-pop')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') { e.preventDefault(); edUndoRedo(!e.shiftKey); return; }
    if (mod && e.code === 'KeyY') { e.preventDefault(); edUndoRedo(false); return; }
    if (mod && e.code === 'KeyA') { e.preventDefault(); ED.sel = new Set(ED.clips.map(c => c.id)); edBarUi(); edDraw(); return; }
    if (mod || e.altKey) return;
    const onCv = e.target.id === 'ed-cv' || e.target === document.body;
    if (e.code === 'Space' && (onCv || e.target.closest('#tlp-files')) && !e.target.closest('button')) { e.preventDefault(); edToggle(); return; }
    if (!onCv) return;
    if (e.code === 'KeyS') { e.preventDefault(); edSplit(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); edDelete(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); edNudge((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1)); }
    else if (e.key === 'Home') { e.preventDefault(); edSeek(0); ED.scroll = 0; edDraw(); }
    else if (e.key === 'End') { e.preventDefault(); edSeek(edEnd()); }
    else if (e.key === 'Escape') { ED.sel.clear(); edBarUi(); edDraw(); }
    else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0') { e.preventDefault(); const b = $(`#ed [data-ed="${e.key === '0' ? 'fit' : e.key === '-' ? 'zoom-' : 'zoom+'}"]`); if (b) b.click(); }
  });
  addEventListener('resize', () => { if (S.tab === 'tl') edDraw(); });
}
