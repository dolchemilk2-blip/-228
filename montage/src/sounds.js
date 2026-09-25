// Монтажка — вкладка «Звуки»: ремарки сценария, которые звучат (дверь, стук, шаги…), звук к ним
// из библиотеки пользователя или встроенный, и как класть: между репликами или фоном.
// Использует S, $, esc, notify, play, stop, decodeFile, fmt, saveEdits из app.js; C — ядро.

const SFX_DEFAULT_GAIN = { seq: -6, bed: -16 };
const SFX_SEQ_MAX = 10;                           // между репликами звук не длиннее стольких секунд — иначе обрезается с затуханием
function sfxState() {
  if (!S.sfx) S.sfx = { lib: [], cues: {}, showAll: false };
  return S.sfx;
}
/** Настройка звука для ремарки: {src: 'synth:key' | 'lib:name' | null, mode, gain, on, manual}. */
function sfxCue(id) { const st = sfxState(); if (!st.cues[id]) st.cues[id] = { src: null, mode: 'seq', gain: SFX_DEFAULT_GAIN.seq, on: false, manual: false }; return st.cues[id]; }
/** Автоподбор: для каждой звучащей ремарки — файл из библиотеки по имени, иначе встроенный звук. Ручные настройки не трогаются. */
function sfxAuto() {
  if (!S.P) return;
  const st = sfxState(), names = st.lib.map(f => f.name);
  for (const q of C.soundCues(S.P.cues)) {
    const cue = sfxCue(q.id); if (cue.manual) continue;
    const lib = names.length ? C.matchLibrary(q.text, names, q.key) : null;
    cue.src = lib ? 'lib:' + lib : 'synth:' + q.key; cue.on = q.strong; cue.auto = true; cue.key = q.key;
  }
}
/** Звук ремарки (48 кГц, −20 LUFS + поправка) или null. */
function sfxAudio(id) {
  const cue = sfxState().cues[id]; if (!cue || !cue.on || !cue.src) return null;
  let y = null, name = '';
  if (cue.src.startsWith('synth:')) { y = C.synthSound(cue.src.slice(6)); name = C.sfxName(cue.src.slice(6)); }
  else { const f = sfxState().lib.find(x => x.name === cue.src.slice(4)); if (f && f.y48) { y = f.y48; name = f.name; } }
  if (!y || !y.length) return null;
  let cut = false;
  if (cue.mode !== 'bed' && y.length > SFX_SEQ_MAX * C.SR) { y = y.slice(0, SFX_SEQ_MAX * C.SR); const nf = Math.round(0.6 * C.SR); for (let i = 0; i < nf; i++) y[y.length - 1 - i] *= i / nf; cut = true; }
  const L = C.integratedLufs(y), g = (isFinite(L) && L > -69 ? Math.pow(10, (-20 - L) / 20) : 1) * Math.pow(10, (cue.gain || 0) / 20);
  const out = new Float32Array(y.length); for (let i = 0; i < y.length; i++) out[i] = y[i] * g;
  const n = Math.min(out.length, Math.round(0.02 * C.SR)); for (let i = 0; i < n; i++) { out[i] *= i / n; out[out.length - 1 - i] *= i / n; }
  if (cue.mode === 'bed') { const nf = Math.min(out.length >> 1, Math.round(0.4 * C.SR)); for (let i = 0; i < nf; i++) { out[out.length - 1 - i] *= i / nf; } }
  return { audio: out, name, cut };
}
const sfxIsSeq = cue => { const c = sfxState().cues[cue.id]; return !!(c && c.on && c.src && c.mode === 'seq'); };
const sfxBed = cue => { const c = sfxState().cues[cue.id]; return c && c.on && c.src && c.mode === 'bed' ? sfxAudio(cue.id) : null; };
function sfxSave() { const st = sfxState(); S.sfxSaved = Object.fromEntries(Object.entries(st.cues).filter(([, c]) => c.manual).map(([k, c]) => [k, { src: c.src, mode: c.mode, gain: c.gain, on: c.on, manual: true }])); saveEdits(); }
async function sfxAddFiles(list) {
  const st = sfxState();
  for (const file of [...list]) {
    if (st.lib.some(f => f.name === file.name)) continue;
    try { const y = await decodeFile(file); st.lib.push({ name: file.name, y48: y, dur: y.length / C.SR }); }
    catch { notify('Не удалось прочитать ' + file.name); }
  }
  sfxAuto(); S.result = null; renderSounds();
}
const sfxDurNote = (d, cue) => ` <span class="muted">· ${fmt(d)}${cue.mode !== 'bed' && d > SFX_SEQ_MAX ? `, между репликами — первые ${SFX_SEQ_MAX} с` : ''}</span>`;
/** Встроенные звуки-заглушки синтезируются в простое по одному, а не все разом при открытии вкладки. */
const sfxLater = new Set();
function sfxSynthIdle() {
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 60));
  // синтез — в фоновом потоке обработки; главный поток только кладёт готовое в кэш и дописывает длительность
  const next = () => { const k = sfxLater.values().next().value; if (k == null) return; sfxLater.delete(k);
    const done = y => { if (y) C.synthPut(k, y); if (!C.synthReady(k)) C.synthSound(k); const d = C.synthSound(k).length / C.SR;
      document.querySelectorAll(`.sdur[data-synth="${CSS.escape(k)}"]`).forEach(el => { el.outerHTML = sfxDurNote(d, { mode: el.dataset.mode }); });
      if (sfxLater.size) idle(next); };
    (typeof dspCall === 'function' ? dspCall({ type: 'synth', key: k }) : Promise.reject()).then(r => done(r.y), () => done(null)); };
  if (sfxLater.size) idle(next);
}
function renderSounds() {
  const el = $('#sfx-body'); if (!el) return;
  if (!S.P) { el.innerHTML = '<p class="muted">Сначала вставьте сценарий на вкладке «Сборка»: звуки берутся из его ремарок.</p>'; return; }
  const st = sfxState(), db = dbState(); sfxAuto();
  const missing = c => c && c.src && c.src.startsWith('lib:BBC ') && !st.lib.some(x => x.name === c.src.slice(4));
  if (!db.restoring.size && (Object.values(st.cues).some(missing) || Object.values(ambState().scenes).some(missing) || (S.sfxPendingDb || []).length)) dbRestore();
  const auto = new Map(C.soundCues(S.P.cues).map(q => [q.id, q]));
  const dirs = S.P.cues.filter(c => c.type === 'dir' && !/^\(?(долгая )?пауза\)?\.?$/i.test(c.text.trim()));
  const rows = dirs.filter(c => st.showAll || auto.has(c.id) || (st.cues[c.id] && st.cues[c.id].src));
  const inTrack = Object.values(st.cues).filter(c => c.on && c.src).length;
  const srcOpts = cue => `<option value="">— нет —</option>` +
    (st.lib.length ? `<optgroup label="Моя библиотека">${st.lib.map(f => `<option value="lib:${esc(f.name)}" ${cue.src === 'lib:' + f.name ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</optgroup>` : '') +
    `<optgroup label="Встроенные (заглушки)">${C.SFX_KEYS.map(k => `<option value="synth:${k}" ${cue.src === 'synth:' + k ? 'selected' : ''}>${C.sfxName(k)}</option>`).join('')}</optgroup>`;
  let scene = null; const list = [];
  for (const c of S.P.cues) {
    if (c.type === 'scene') { scene = c; continue; }
    if (!rows.includes(c)) continue;
    if (scene) { list.push(`<div class="scene">${esc(scene.text)}</div>`); scene = null; }
    const cue = sfxCue(c.id), a = auto.get(c.id);
    const sk = cue.src && cue.src.startsWith('synth:') ? cue.src.slice(6) : null, wait = sk && !C.synthReady(sk);
    if (wait) sfxLater.add(sk);                            // заглушку синтезируем в простое, длительность допишется
    const srcDur = !cue.src || wait ? null : sk ? C.synthSound(sk).length / C.SR : (st.lib.find(x => x.name === cue.src.slice(4)) || {}).dur;
    const durNote = srcDur ? sfxDurNote(srcDur, cue) : wait ? `<span class="sdur" data-synth="${esc(sk)}" data-mode="${cue.mode}"></span>` : '';
    list.push(`<div class="srow ${cue.on && cue.src ? 'on' : ''}" data-id="${c.id}">
      <label class="mini"><input type="checkbox" data-p="on" ${cue.on ? 'checked' : ''} aria-label="в дорожку"></label>
      <div class="stext"><span class="num">${esc(c.id)}</span> ${esc(c.text)}${a && !cue.manual ? `<span class="muted"> · ${a.strong ? 'похоже на звук' : 'может быть звуком'}</span>` : ''}${durNote}</div>
      <select data-p="src" aria-label="источник">${srcOpts(cue)}</select>
      <select data-p="mode" aria-label="как класть"><option value="seq" ${cue.mode === 'seq' ? 'selected' : ''}>между репликами</option><option value="bed" ${cue.mode === 'bed' ? 'selected' : ''}>фоном под следующими</option></select>
      <label class="gain"><input type="range" data-p="gain" min="-30" max="6" step="1" value="${cue.gain}" aria-label="громкость"><span class="gv" data-num="sfx:${cue.id}">${cue.gain > 0 ? '+' : ''}${cue.gain} дБ</span></label>
      <button class="play" data-act="play" ${cue.src ? '' : 'disabled'} aria-label="Слушать">▶</button>
      <button class="ghost-b tiny" data-act="db-for" title="Найти звук в базе BBC для этой ремарки">база</button>
    </div>`);
  }
  el.innerHTML = `
    <div class="sfx-head">
      <label class="ghost-b file-b">${ic('plus')}Загрузить свои звуки<input type="file" id="sfx-add" accept="audio/*,.m4a,.opus,.flac" multiple hidden></label>
      <span class="muted small">файлы называйте по смыслу: «дверь открывается.wav», «шаги.mp3», «стук.wav» — так они подставятся к ремаркам сами</span>
      <span class="pill ok">в дорожке ${inTrack}</span>
      <label class="mini"><input type="checkbox" id="sfx-all" ${st.showAll ? 'checked' : ''}> показывать все ремарки</label>
    </div>
    ${ambHtml()}
    ${dbBoxHtml(db)}
    ${st.lib.length ? `<div class="chips">${st.lib.map(f => `<span class="chip ghost">${esc(f.name)} <i>${fmt(f.dur)}</i> <button class="icon xs" data-act="lib-play" data-name="${esc(f.name)}" aria-label="Слушать">${ic('play')}</button><button class="icon xs" data-act="lib-rm" data-name="${esc(f.name)}" aria-label="Убрать">${ic('close')}</button></span>`).join('')}</div>` : ''}
    <div class="srows">${list.join('') || '<p class="muted pad">Звучащих ремарок не нашлось. Включите «показывать все ремарки» и назначьте звук вручную.</p>'}</div>`;
  sfxSynthIdle();
}
function dbBoxHtml(db) {
  const tcue = db.target && S.P ? S.P.cues.find(c => c.id === db.target) : null;
  return `<div class="dbbox">
    <div class="dbline">
      <input id="db-q" type="search" placeholder="Поиск в базе BBC: door open, footsteps, дождь, гром, школьный звонок…" value="${esc(db.q)}" aria-label="Поиск в базе звуков">
      <button class="ghost-b" data-act="db-go" ${db.busy ? 'disabled' : ''}>Найти</button>
      <button class="primary" data-act="db-auto" ${db.busy ? 'disabled' : ''}>Подобрать из базы ко всем включённым</button>
    </div>
    <p class="muted small">Архив BBC Sound Effects — 33 000 звуков, каждый качается по мере надобности (нужен интернет). Лицензия
      <a href="${DB_LICENCE}" target="_blank" rel="noopener">RemArc</a>: для личных и учебных проектов; для коммерческого выпуска нужна лицензия BBC.</p>
    ${tcue ? `<p class="small">Выбранный результат пойдёт к ремарке <b>${esc(tcue.id)}</b> «${esc(tcue.text.slice(0, 60))}» <button class="ghost-b tiny" data-act="db-untarget">отменить</button></p>` : ''}
    ${db.busy && !db.res.length ? '<p class="muted small">Ищу…</p>' : ''}
    ${db.res.length ? `<div class="dbrows">${db.res.map((it, i) => `<div class="dbrow"><button class="play" data-act="db-play" data-i="${i}" aria-label="Слушать">▶</button><span class="dbtext">${esc(it.text)} <i>${esc(it.cat)} · ${fmt(it.dur)}</i></span><button class="ghost-b tiny" data-act="db-add" data-i="${i}">${tcue ? 'к ремарке' : 'в библиотеку'}</button></div>`).join('')}</div>
      <p class="muted small">найдено ${db.total}${db.shownQ && db.shownQ !== db.q.trim().toLowerCase() ? `, искал «${esc(db.shownQ)}»` : ''}; показаны первые ${db.res.length}</p>` : db.q && !db.busy && db.shownQ ? '<p class="muted small">Ничего не нашлось — попробуйте другое слово.</p>' : ''}
  </div>`;
}
function bindSounds() {
  const el = $('#sfx-body');
  bindAmb(el);
  el.addEventListener('input', e => { if (e.target.id === 'db-q') dbState().q = e.target.value; });
  el.addEventListener('keydown', e => { if (e.target.id === 'db-q' && e.key === 'Enter') { e.preventDefault(); dbRun(e.target.value); } });
  el.addEventListener('change', e => {
    const x = e.target;
    if (x.id === 'sfx-add') { sfxAddFiles(x.files); x.value = ''; return; }
    if (x.id === 'sfx-all') { sfxState().showAll = x.checked; renderSounds(); return; }
    const row = x.closest('.srow'); if (!row) return;
    const cue = sfxCue(row.dataset.id), p = x.dataset.p;
    if (p === 'on') cue.on = x.checked;
    else if (p === 'src') { cue.src = x.value || null; if (cue.src && !cue.on) cue.on = true; }
    else if (p === 'mode') { cue.mode = x.value; if (!cue.manual || cue.gain === SFX_DEFAULT_GAIN[cue.mode === 'seq' ? 'bed' : 'seq']) cue.gain = SFX_DEFAULT_GAIN[cue.mode]; }
    else if (p === 'gain') cue.gain = +x.value;
    cue.manual = true; S.result = null; sfxSave(); renderSounds(); renderMix();
  });
  el.addEventListener('input', e => { const x = e.target; if (x.dataset.p === 'gain') { x.closest('.gain').querySelector('.gv').textContent = `${x.value > 0 ? '+' : ''}${x.value} дБ`; } });
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'play') { const r = sfxAudio(b.closest('.srow').dataset.id) || (() => { const cue = sfxCue(b.closest('.srow').dataset.id), was = cue.on; cue.on = true; const r = sfxAudio(b.closest('.srow').dataset.id); cue.on = was; return r; })(); if (r) playing && playing.btn === b ? stop() : play(r.audio, b); return; }
    if (a === 'lib-play') { const f = sfxState().lib.find(x => x.name === b.dataset.name); if (f) playing && playing.btn === b ? stop() : play(f.y48, b); return; }
    if (a === 'db-go') { dbRun($('#db-q').value); return; }
    if (a === 'db-auto') { dbAutoAll(); return; }
    if (a === 'db-untarget') { dbState().target = null; renderSounds(); return; }
    if (a === 'db-for') { const id = b.closest('.srow').dataset.id, cue = sfxCue(id), text = S.P.cues.find(c => c.id === id).text; dbState().target = id;
      const q = cue.key && DB_QUERY[cue.key] ? DB_QUERY[cue.key] : text; dbRun(q); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (a === 'db-play') { const it = dbState().res[+b.dataset.i]; if (!it) return; if (playing && playing.btn === b) return stop();
      b.classList.add('on'); dbFetch(it).then(y => { if (b.isConnected) play(y, b); }).catch(e => { b.classList.remove('on'); notify('Не скачался: ' + e.message); }); return; }
    if (a === 'db-add') { const it = dbState().res[+b.dataset.i]; if (!it) return; b.disabled = true; b.textContent = 'качаю…';
      dbAdd(it).then(name => { const db = dbState(); if (db.target) { const cue = sfxCue(db.target); cue.src = 'lib:' + name; cue.on = true; cue.manual = true; db.target = null; sfxSave(); }
        S.result = null; renderSounds(); renderMix(); notify(`«${it.text.slice(0, 50)}» в библиотеке.`); }).catch(e => { notify('Не скачался: ' + e.message); renderSounds(); }); return; }
    if (a === 'lib-rm') { const st = sfxState(); st.lib = st.lib.filter(x => x.name !== b.dataset.name); for (const c of Object.values(st.cues)) if (c.src === 'lib:' + b.dataset.name) { c.src = null; c.manual = false; } sfxAuto(); S.result = null; renderSounds(); return; }
  });
}
