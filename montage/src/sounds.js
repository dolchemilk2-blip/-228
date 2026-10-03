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
const sfxIsSeq = cue => { if (!mixUse('sfx')) return false; const c = sfxState().cues[cue.id]; return !!(c && c.on && c.src && c.mode === 'seq'); };
const sfxBed = cue => { if (!mixUse('sfx')) return null; const c = sfxState().cues[cue.id]; return c && c.on && c.src && c.mode === 'bed' ? sfxAudio(cue.id) : null; };
/** Звуки поменялись: готовое сведение пересчитывается само (как при смене фона сцены), а не сбрасывается —
 *  иначе ради одного звука приходилось заново нажимать «Свести» и ждать секунды. */
function sfxChanged() { if (S.result && S.result.out && typeof remixSoon === 'function') remixSoon('layout'); else { S.result = null; renderMix(); } }
function sfxSave() { const st = sfxState(); S.sfxSaved = Object.fromEntries(Object.entries(st.cues).filter(([, c]) => c.manual).map(([k, c]) => [k, { src: c.src, mode: c.mode, gain: c.gain, on: c.on, manual: true }])); saveEdits(); }
async function sfxAddFiles(list) {
  const st = sfxState();
  for (const file of [...list]) {
    if (st.lib.some(f => f.name === file.name)) continue;
    try { const y = await decodeFile(file); st.lib.push({ name: file.name, y48: y, dur: y.length / C.SR }); }
    catch { notify('Не удалось прочитать ' + file.name); }
  }
  sfxAuto(); renderSounds(); sfxChanged();
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
/** Все источники для списка у ремарки. В разметке списка — только выбранный: полный набор (библиотека × ремарки —
 *  больше тысячи пунктов) собирается, когда список открывают, иначе каждая правка на вкладке перестраивала их все. */
function sfxSrcOpts(cue) {
  const st = sfxState();
  return `<option value="">— нет —</option>` +
    (st.lib.length ? `<optgroup label="Моя библиотека">${st.lib.map(f => `<option value="lib:${esc(f.name)}" ${cue.src === 'lib:' + f.name ? 'selected' : ''}>${esc(dbNice(f.name))}</option>`).join('')}</optgroup>` : '') +
    `<optgroup label="Встроенные (заглушки)">${C.SFX_KEYS.map(k => `<option value="synth:${k}" ${cue.src === 'synth:' + k ? 'selected' : ''}>${C.sfxName(k)}</option>`).join('')}</optgroup>`;
}
function sfxSrcOne(cue) { const src = cue.src || ''; return `<option value="${esc(src)}" selected>${esc(!src ? '— нет —' : src.startsWith('synth:') ? C.sfxName(src.slice(6)) : dbNice(src.slice(4)))}</option>`; }
function sfxSrcFill(e) {
  const sel = e.target && e.target.closest && e.target.closest('select[data-lazy]'); if (!sel) return;
  const cue = sfxCue(sel.dataset.lazy); sel.removeAttribute('data-lazy'); sel.innerHTML = sfxSrcOpts(cue); sel.value = cue.src || '';
}
addEventListener('pointerdown', sfxSrcFill, true); addEventListener('focusin', sfxSrcFill, true);
/** Децибелы для подписей: настоящий минус «−», как по всему сайту, а не дефис. */
const dbv = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} дБ`;
const SFX_SEEN = { res: '', lib: null, panel: '' };
// ------------------------------------------------------------------ что звучит в сведении
/** Сколько чего включено: звуков у ремарок, фонов у сцен, музыки (заставка, отбивки, финал, подложки). */
function mixUseCounts() {
  const sfx = S.sfx ? Object.values(S.sfx.cues).filter(c => c.on && c.src).length : 0;
  const amb = S.amb ? Object.values(S.amb.scenes).filter(x => x && x.on && x.src).length : 0;
  const m = S.music, music = m && typeof MUS_SLOTS !== 'undefined' ? MUS_SLOTS.filter(([k]) => m[k] && m[k].on && musReady(m[k].id)).length + Object.values(m.beds || {}).filter(b => b && b.on && musReady(b.id)).length : 0;
  return { sfx, amb, music };
}
const MIX_USE = [['sfx', 'Звуки', 'звуки к ремаркам: двери, шаги, стук'], ['amb', 'Фон сцен', 'атмосфера под всей сценой'], ['music', 'Музыка', 'заставка, отбивки, финал, подложки']];
/** Выключатели «что звучит в сведении». Ничего не настроено — вместо выключателя ссылка «настроить». */
function mixUseHtml() {
  const n = mixUseCounts();
  return `<span class="mu-l">В сведении</span>${MIX_USE.map(([k, t, d]) => n[k]
    ? `<button type="button" class="mu${mixUse(k) ? ' on' : ''}" data-mu="${k}" aria-pressed="${mixUse(k)}" title="${d}: ${mixUse(k) ? 'звучат' : 'выключены'} — щелчок переключает, настройки не теряются"><span class="mu-sw" aria-hidden="true"></span>${t}<span class="mu-n">${n[k]}</span></button>`
    : `<button type="button" class="mu none" data-mu-go="${k}" title="${d} — пока не выбраны">${t}<span class="mu-n">настроить</span></button>`).join('')}`;
}
function renderMixUse() { document.querySelectorAll('[data-mixuse]').forEach(el => { el.innerHTML = mixUseHtml(); }); }
function mixUseSet(k, on) {
  S.mixUse = { ...(S.mixUse || {}), [k]: !!on }; saveEdits(); renderMixUse();
  const t = MIX_USE.find(x => x[0] === k)[1];
  if (S.result && S.result.out && typeof remixSoon === 'function') { remixSoon('layout'); notify(`${t} ${on ? 'снова в сведении' : 'выключены в сведении'} — дорожка пересчитывается.`); }
  else { S.result = null; renderMix(); }
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-mu], [data-mu-go]'); if (!b) return;
  if (b.dataset.mu) { mixUseSet(b.dataset.mu, !mixUse(b.dataset.mu)); return; }
  const k = b.dataset.muGo; sfxState().panel = k === 'sfx' ? 'cues' : k; store.set('montage:sfx-panel', sfxState().panel);
  if (S.tab === 'sfx') renderSounds(); else goTab('sfx', { top: true });
});

// ------------------------------------------------------------------ вкладка
const SFX_PANELS = [['cues', 'Звуки ремарок'], ['amb', 'Фон сцен'], ['music', 'Музыка'], ['lib', 'Свои файлы и базы']];
const SFX_FILTERS = [['sound', 'Звучащие'], ['on', 'В дорожке'], ['off', 'Выключенные'], ['all', 'Все ремарки']];
function sfxPanel() { const st = sfxState(); if (!st.panel) st.panel = store.get('montage:sfx-panel') || 'cues'; if (!SFX_PANELS.some(p => p[0] === st.panel)) st.panel = 'cues'; return st.panel; }
/** Ремарки для списка и счётчики фильтров. */
function sfxRows() {
  const st = sfxState(), auto = new Map(C.soundCues(S.P.cues).map(q => [q.id, q]));
  const dirs = S.P.cues.filter(c => c.type === 'dir' && !/^\(?(долгая )?пауза\)?\.?$/i.test(c.text.trim()));
  const sound = dirs.filter(c => auto.has(c.id) || (st.cues[c.id] && st.cues[c.id].src));
  const isOn = c => { const q = st.cues[c.id]; return !!(q && q.on && q.src); };
  const by = { sound, on: sound.filter(isOn), off: sound.filter(c => !isOn(c)), all: dirs };
  const f = st.filter || (st.showAll ? 'all' : 'sound');
  return { auto, by, f, rows: by[f] || sound };
}
function sfxRowHtml(c, a) {
  const st = sfxState(), cue = sfxCue(c.id), db = dbState(), open = db.target === c.id;
  const sk = cue.src && cue.src.startsWith('synth:') ? cue.src.slice(6) : null, wait = sk && !C.synthReady(sk);
  if (wait) sfxLater.add(sk);                            // заглушку синтезируем в простое, длительность допишется
  const srcDur = !cue.src || wait ? null : sk ? C.synthSound(sk).length / C.SR : (st.lib.find(x => x.name === cue.src.slice(4)) || {}).dur;
  const durNote = srcDur ? sfxDurNote(srcDur, cue) : wait ? `<span class="sdur" data-synth="${esc(sk)}" data-mode="${cue.mode}"></span>` : '';
  const how = a && !cue.manual ? `<span class="skind${a.strong ? ' strong' : ''}">${a.strong ? 'похоже на звук' : 'может быть'}</span>` : '';
  return `<div class="srow${cue.on && cue.src ? ' on' : ''}${open ? ' open' : ''}" data-id="${c.id}">
      <label class="mini"><input type="checkbox" data-p="on" ${cue.on ? 'checked' : ''} aria-label="в дорожку: ${esc(c.text.slice(0, 40))}"></label>
      <div class="stext"><span class="num">${esc(c.id)}</span> ${esc(c.text)} ${how}${durNote}</div>
      <select data-p="src" data-lazy="${esc(c.id)}" aria-label="какой звук">${sfxSrcOne(cue)}</select>
      <div class="smode" role="group" aria-label="как класть"><button type="button" data-mode="seq" aria-pressed="${cue.mode !== 'bed'}" title="реплики ждут, пока звук отзвучит">между</button><button type="button" data-mode="bed" aria-pressed="${cue.mode === 'bed'}" title="звук стелется тише под следующими репликами">фоном</button></div>
      <label class="gain"><input type="range" data-p="gain" min="-30" max="6" step="1" value="${cue.gain}" aria-label="громкость"><span class="gv" data-num="sfx:${cue.id}">${dbv(cue.gain)}</span></label>
      <button class="play" data-act="play" ${cue.src ? '' : 'disabled'} aria-label="Слушать">▶</button>
      <button class="ghost-b tiny sfind-b${open ? ' on' : ''}" data-act="db-for" aria-expanded="${open}" title="Найти звук для этой ремарки в базе Freesound или BBC">${ic('search')}<span>Найти</span></button>
    </div>${open ? sfxFindHtml(c, db) : ''}`;
}
/** Поиск в базе — прямо под ремаркой: послушать и поставить, не уходя со своего места в списке. */
function sfxFindHtml(c, db) {
  return `<div class="sfind" data-for="${c.id}">
    <div class="dbline">${dbSrcHtml()}<input type="search" class="sfind-q" value="${esc(db.q)}" placeholder="что искать: door, шаги, гром…" aria-label="Что искать в базе звуков"><button class="ghost-b" data-act="find-go" ${db.busy ? 'disabled' : ''}>Найти</button><button class="icon-b" data-act="db-untarget" aria-label="Закрыть поиск">${ic('close')}</button></div>${dbDownHtml(db)}
    ${db.busy && !db.res.length ? '<p class="muted small">Ищу…</p>' : db.res.length ? `<div class="dbrows">${db.res.slice(0, 12).map((it, i) => `<div class="dbrow"><button class="play" data-act="db-play" data-i="${i}" aria-label="Слушать">▶</button><span class="dbtext">${esc(it.text)} <i>${esc(it.cat)} · ${fmt(it.dur)}</i></span><button class="ghost-b tiny" data-act="db-add" data-i="${i}">Поставить</button></div>`).join('')}</div>
    <p class="muted small">найдено ${db.total}${db.shownQ ? ` по «${esc(db.shownQ)}»` : ''}; ▶ — послушать, «Поставить» — к ремарке ${esc(c.id)}. ${dbLicHtml()}</p>` : db.shownQ && !db.busy ? '<p class="muted small">Ничего не нашлось — попробуйте другое слово, лучше по-английски.</p>' : ''}
  </div>`;
}
function sfxCuesHtml() {
  const { auto, by, f, rows } = sfxRows(), set = new Set(rows), db = dbState();
  let scene = null; const list = [];
  for (const c of S.P.cues) {
    if (c.type === 'scene') { scene = c; continue; }
    if (!set.has(c)) continue;
    if (scene) { list.push(`<div class="scene">${esc(scene.text)}</div>`); scene = null; }
    list.push(sfxRowHtml(c, auto.get(c.id)));
  }
  const withSrc = rows.filter(c => sfxCue(c.id).src), anyOff = withSrc.some(c => !sfxCue(c.id).on), anyOn = withSrc.some(c => sfxCue(c.id).on);
  const empty = f === 'on' ? 'В дорожке пока нет звуков — включите галочки у ремарок.' : f === 'off' ? 'Выключенных нет — все найденные звуки в дорожке.' : 'Звучащих ремарок не нашлось. Откройте «Все ремарки» и назначьте звук вручную.';
  return `<div class="sfx-tools">
      <div class="filters" role="group" aria-label="Какие ремарки показать">${SFX_FILTERS.map(([k, t]) => `<button type="button" data-sf="${k}" class="${f === k ? 'on' : ''}" aria-pressed="${f === k}">${t} <i>${by[k].length}</i></button>`).join('')}</div>
      <div class="sfx-bulk">
        <button class="ghost-b tiny" data-act="bulk-on" ${anyOff ? '' : 'disabled'} title="Включить все показанные ремарки со звуком">${ic('check')}Включить показанные</button>
        <button class="ghost-b tiny" data-act="bulk-off" ${anyOn ? '' : 'disabled'} title="Выключить все показанные">${ic('off')}Выключить показанные</button>
        <button class="ghost-b tiny" data-act="db-auto" ${db.busy ? 'disabled' : ''} title="К включённым ремаркам со звуком-заглушкой — настоящий звук из базы (${DB_SRCS[dbSrc()]}; нужен интернет)">${ic('search')}Из ${dbSrc() === 'fs' ? 'Freesound' : 'BBC'} ко всем включённым</button>
      </div>
    </div>
    <p class="muted small sfx-hint">Галочка — звук идёт в дорожку. «Между» — реплики ждут, пока звук отзвучит; «фоном» — стелется тише под следующими репликами. «Найти» — звук из базы (Freesound или BBC) прямо к этой ремарке.</p>
    <div class="srows">${list.join('') || `<p class="muted pad">${empty}</p>`}</div>`;
}
function sfxLibHtml(db) {
  const st = sfxState(), used = name => Object.values(st.cues).filter(c => c.src === 'lib:' + name).length;
  return `<div class="sfx-lib">
      <div class="dbline"><label class="ghost-b file-b">${ic('plus')}Загрузить свои звуки<input type="file" data-sfx-add accept="audio/*,.m4a,.opus,.flac" multiple hidden></label>
        <span class="muted small">называйте файлы по смыслу: «дверь открывается.wav», «шаги.mp3», «стук.wav» — так они сами встанут к подходящим ремаркам</span>
        ${st.lib.some(f => f.db) ? `<button class="ghost-b tiny" data-act="credits" title="Список звуков из баз с авторами и лицензиями — для описания выпуска">${ic('download')}Авторы звуков (.txt)</button>` : ''}</div>
      ${st.lib.length ? `<div class="chips">${st.lib.map(f => { const u = used(f.name); return `<span class="chip ghost" title="${esc(f.name)}">${esc(dbNice(f.name))} <i>${fmt(f.dur)}${u ? ` · у ${u} ${plural(u, 'ремарки', 'ремарок', 'ремарок')}` : ''}</i> <button class="icon xs" data-act="lib-play" data-name="${esc(f.name)}" aria-label="Слушать">${ic('play')}</button><button class="icon xs" data-act="lib-rm" data-name="${esc(f.name)}" aria-label="Убрать">${ic('close')}</button></span>`; }).join('')}</div>` : '<p class="muted small">Своих звуков пока нет — пока звучат встроенные заглушки.</p>'}
    </div>
    ${dbBoxHtml(db)}`;
}
function renderSounds() {
  const el = $('#sfx-body'); if (!el) return;
  renderMixUse();
  if (!S.P) { el.innerHTML = '<p class="muted">Сначала вставьте сценарий на вкладке «Сборка»: звуки берутся из его ремарок.</p>'; return; }
  const st = sfxState(), db = dbState(); sfxAuto();
  const missing = c => c && c.src && /^lib:(BBC|Freesound) /.test(c.src) && !st.lib.some(x => x.name === c.src.slice(4));
  if (!db.restoring.size && (Object.values(st.cues).some(missing) || Object.values(ambState().scenes).some(missing) || (S.sfxPendingDb || []).length)) dbRestore();
  const panel = sfxPanel(), n = mixUseCounts(), scenes = S.P.nScenes || 0;
  const tabs = { cues: `${n.sfx}`, amb: `${n.amb}/${scenes}`, music: `${n.music}`, lib: `${st.lib.length}` };
  const body = panel === 'cues' ? sfxCuesHtml() : panel === 'amb' ? ambHtml() : panel === 'music' ? (typeof musicHtml === 'function' ? musicHtml() : '') : sfxLibHtml(db);
  // блоки вкладки при перестройке доезжают до новых мест, а не прыгают
  const BLK = '#sfx-body > .sfx-head, #sfx-body > .sfx-panel', bkey = x => x.classList[0];
  const before = typeof flipRecord === 'function' && typeof MOTION !== 'undefined' && MOTION.ready && !el.closest('[hidden]') && SFX_SEEN.panel === panel ? flipRecord(BLK, bkey) : null;
  el.innerHTML = `
    <div class="sfx-head">
      <div class="filters sfx-tabs" id="sfx-tabs" role="tablist" aria-label="Разделы звуков">${SFX_PANELS.map(([k, t]) => `<button type="button" role="tab" data-sp="${k}" class="${panel === k ? 'on' : ''}" aria-selected="${panel === k}">${t} <i>${tabs[k]}</i></button>`).join('')}</div>
      <div class="mix-use" data-mixuse role="group" aria-label="Что звучит в сведении">${mixUseHtml()}</div>
    </div>
    <div class="sfx-panel" data-panel="${panel}">${body}</div>`;
  if (typeof segInd === 'function') segInd($('#sfx-tabs'), 'sfx-tabs');
  if (before) flipPlay(before, BLK, bkey, { damping: 0.9, response: 0.36 });
  if (typeof MOTION !== 'undefined' && MOTION.ready && !el.closest('[hidden]')) {
    if (SFX_SEEN.panel && SFX_SEEN.panel !== panel && typeof mIn === 'function') mIn(el.querySelector('.sfx-panel'), { opacity: 0, transform: 'translateY(6px)' }, [0.92, 0.32]);
    const rk = db.res.map(x => x.id).join(',');
    if (rk && rk !== SFX_SEEN.res && typeof staggerList === 'function') staggerList([...el.querySelectorAll('.dbrow')].slice(0, 10), 30);
    const fresh = [...el.querySelectorAll('.sfx-lib .chips .chip')].filter((c, i) => st.lib[i] && SFX_SEEN.lib && !SFX_SEEN.lib.has(st.lib[i].name));
    fresh.forEach(c => mIn(c, { opacity: 0, transform: 'scale(0.6)', filter: 'blur(3px)' }, [0.62, 0.42]));
    SFX_SEEN.res = rk;
  }
  SFX_SEEN.lib = new Set(st.lib.map(x => x.name)); SFX_SEEN.panel = panel;
  sfxSynthIdle();
}
/** Где искать: Freesound или BBC. */
function dbSrcHtml() { const v = dbSrc(); return `<div class="smode dbsrc" role="group" aria-label="База звуков">${Object.entries(DB_SRCS).map(([k, t]) => `<button type="button" data-dbsrc="${k}" aria-pressed="${v === k}" title="${k === 'fs' ? 'Freesound: 600 000+ современных записей, CC0 и CC BY — можно и в коммерческом выпуске' : 'BBC Sound Effects: 33 000 архивных записей, лицензия RemArc — только личные и учебные проекты'}">${t}</button>`).join('')}</div>`; }
function dbLicHtml() {
  return dbSrc() === 'fs' ? `Freesound через <a href="https://openverse.org" target="_blank" rel="noopener">Openverse</a>: только <a href="${FS_LICENCE}" target="_blank" rel="noopener">CC0 и CC BY</a> — можно и в коммерческом выпуске; для CC BY укажите автора («Авторы звуков» в «Свои файлы и базы»).`
    : `BBC Sound Effects, лицензия <a href="${DB_LICENCE}" target="_blank" rel="noopener">RemArc</a>: для личных и учебных проектов; для коммерческого выпуска нужна лицензия BBC.`;
}
const dbDownHtml = db => db.fsDown && dbSrc() === 'fs' ? `<p class="small warn-t">Freesound не ответил (${esc(db.fsDown)}) — показаны звуки BBC.</p>` : '';
/** Авторы звуков из баз, которые звучат в спектакле: для описания выпуска (CC BY обязывает указать автора). */
function sfxCredits() {
  const st = sfxState(), used = new Set([...Object.values(st.cues), ...Object.values(ambState().scenes)].filter(c => c && c.on && c.src && c.src.startsWith('lib:')).map(c => c.src.slice(4)));
  const fs = [], bbc = [];
  for (const f of st.lib) {
    if (!f.db || !used.has(f.name)) continue;
    if (String(f.db).startsWith('fs:')) { const m = fsMeta(f.db) || {}; fs.push(`«${m.text || f.text || dbParse(f.name)?.text || ''}» — ${m.author ? 'автор ' + m.author + ', ' : ''}${m.lic || 'CC'} — ${fsPage(f.db)}`); }
    else bbc.push(`«${f.text || dbParse(f.name)?.text || ''}» — BBC Sound Effects, ${f.db}`);
  }
  const out = [];
  if (fs.length) out.push('Звуки с Freesound (freesound.org), лицензии Creative Commons:', ...fs, '');
  if (bbc.length) out.push('Звуки из архива BBC Sound Effects (sound-effects.bbcrewind.co.uk) — лицензия RemArc, только для личного и учебного использования:', ...bbc, '');
  return out.length ? out.join('\n') : '';
}
function dbBoxHtml(db) {
  const tcue = null;                               // поиск для одной ремарки — под её строкой, здесь — в библиотеку
  return `<div class="dbbox">
    <div class="dbline">
      ${dbSrcHtml()}<input id="db-q" type="search" placeholder="Поиск звуков: door open, footsteps, дождь, гром, школьный звонок…" value="${esc(db.q)}" aria-label="Поиск в базе звуков">
      <button class="ghost-b" data-act="db-go" ${db.busy ? 'disabled' : ''}>Найти</button>
    </div>
    <p class="muted small">${dbSrc() === 'fs' ? 'Freesound — больше 600 000 звуков, в основном современные чистые записи. ' : 'Архив BBC Sound Effects — 33 000 звуков. '}Каждый качается по мере надобности (нужен интернет). ${dbLicHtml()}</p>${dbDownHtml(db)}
    ${db.busy && !db.res.length ? '<p class="muted small">Ищу…</p>' : ''}
    ${db.res.length ? `<div class="dbrows">${db.res.map((it, i) => `<div class="dbrow"><button class="play" data-act="db-play" data-i="${i}" aria-label="Слушать">▶</button><span class="dbtext">${esc(it.text)} <i>${esc(it.cat)} · ${fmt(it.dur)}</i></span><button class="ghost-b tiny" data-act="db-add" data-i="${i}">${tcue ? 'к ремарке' : 'в библиотеку'}</button></div>`).join('')}</div>
      <p class="muted small">найдено ${db.total}${db.shownQ && db.shownQ !== db.q.trim().toLowerCase() ? `, искал «${esc(db.shownQ)}»` : ''}; показаны первые ${db.res.length}</p>` : db.q && !db.busy && db.shownQ ? '<p class="muted small">Ничего не нашлось — попробуйте другое слово.</p>' : ''}
  </div>`;
}
function bindSounds() {
  const el = $('#sfx-body');
  bindAmb(el); if (typeof bindMusic === 'function') bindMusic(el);
  const isQ = x => x.id === 'db-q' || x.classList.contains('sfind-q');
  el.addEventListener('input', e => { if (isQ(e.target)) dbState().q = e.target.value; });
  el.addEventListener('keydown', e => { if (isQ(e.target) && e.key === 'Enter') { e.preventDefault(); dbRun(e.target.value); } else if (e.target.classList.contains('sfind-q') && e.key === 'Escape') { e.preventDefault(); sfxFindClose(); } });
  el.addEventListener('change', e => {
    const x = e.target;
    if (x.matches('[data-sfx-add]')) { sfxAddFiles(x.files); x.value = ''; return; }
    const row = x.closest('.srow'); if (!row) return;
    const cue = sfxCue(row.dataset.id), p = x.dataset.p;
    if (p === 'on') cue.on = x.checked;
    else if (p === 'src') { cue.src = x.value || null; if (cue.src && !cue.on) cue.on = true; }
    else if (p === 'gain') cue.gain = +x.value;
    else return;
    cue.manual = true; sfxSave(); renderSounds(); sfxChanged();
  });
  el.addEventListener('input', e => { const x = e.target; if (x.dataset.p === 'gain') { x.closest('.gain').querySelector('.gv').textContent = `${dbv(x.value)}`; } });
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const st = sfxState();
    if (b.dataset.dbsrc) { if (dbSrc() !== b.dataset.dbsrc) { store.set('montage:sfx-db', b.dataset.dbsrc); const db = dbState(); db.res = []; db.total = 0; db.fsDown = ''; if (db.q.trim()) dbRun(db.q); else renderSounds(); } return; }
    if (b.dataset.act === 'credits') { const t = sfxCredits(); if (!t) { notify('Звуки из баз пока не звучат в спектакле.'); return; } download(new Blob([t], { type: 'text/plain;charset=utf-8' }), 'авторы звуков.txt'); return; }
    if (b.dataset.sp) { if (st.panel !== b.dataset.sp) { st.panel = b.dataset.sp; store.set('montage:sfx-panel', st.panel); renderSounds(); } return; }
    if (b.dataset.sf) { st.filter = b.dataset.sf; st.showAll = b.dataset.sf === 'all'; renderSounds(); return; }
    if (b.dataset.mode) {                       // между репликами / фоном: громкость по умолчанию — своя у каждого способа
      const cue = sfxCue(b.closest('.srow').dataset.id), m = b.dataset.mode; if (cue.mode === m) return;
      if (!cue.manual || cue.gain === SFX_DEFAULT_GAIN[cue.mode]) cue.gain = SFX_DEFAULT_GAIN[m];
      cue.mode = m; cue.manual = true; sfxSave(); renderSounds(); sfxChanged(); return;
    }
    const a = b.dataset.act;
    if (a === 'play') { const id = b.closest('.srow').dataset.id, r = sfxAudio(id) || (() => { const cue = sfxCue(id), was = cue.on; cue.on = true; const r = sfxAudio(id); cue.on = was; return r; })(); if (r) playing && playing.btn === b ? stop() : play(r.audio, b); return; }
    if (a === 'lib-play') { const f = st.lib.find(x => x.name === b.dataset.name); if (f) playing && playing.btn === b ? stop() : play(f.y48, b); return; }
    if (a === 'bulk-on' || a === 'bulk-off') {
      const on = a === 'bulk-on', list = sfxRows().rows.map(c => sfxCue(c.id)).filter(c => c.src && c.on !== on);
      for (const c of list) { c.on = on; c.manual = true; }
      sfxSave(); renderSounds(); sfxChanged(); notify(`${on ? 'Включено' : 'Выключено'} звуков: ${list.length}.`); return;
    }
    if (a === 'db-go') { dbRun($('#db-q').value); return; }
    if (a === 'find-go') { const q = b.closest('.sfind').querySelector('.sfind-q'); dbRun(q.value); return; }
    if (a === 'db-auto') { dbAutoAll(); return; }
    if (a === 'db-untarget') { sfxFindClose(); return; }
    if (a === 'db-for') {
      const id = b.closest('.srow').dataset.id, db = dbState();
      if (db.target === id) { sfxFindClose(); return; }
      const cue = sfxCue(id), text = S.P.cues.find(c => c.id === id).text;
      db.target = id; db.res = []; db.total = 0; db.shownQ = '';
      dbRun(cue.key && DB_QUERY[cue.key] ? (dbSrc() === 'fs' && FS_QUERY[cue.key]) || DB_QUERY[cue.key] : text).then(() => sfxFindFocus(id)); sfxFindFocus(id); return;
    }
    if (a === 'db-play') { const it = dbState().res[+b.dataset.i]; if (!it) return; if (playing && playing.btn === b) return stop();
      b.classList.add('on'); dbFetch(it).then(y => { if (b.isConnected) play(y, b); }).catch(e => { b.classList.remove('on'); notify('Не скачался: ' + e.message); }); return; }
    if (a === 'db-add') { const it = dbState().res[+b.dataset.i]; if (!it) return; b.disabled = true; b.textContent = 'качаю…';
      dbAdd(it).then(name => { const db = dbState(), id = db.target; if (id) { const cue = sfxCue(id); cue.src = 'lib:' + name; cue.on = true; cue.manual = true; db.target = null; sfxSave(); }
        renderSounds(); sfxChanged(); if (id) sfxRowFlash(id); notify(id ? `«${it.text.slice(0, 50)}» — к ремарке ${id}.` : `«${it.text.slice(0, 50)}» в библиотеке.`); }).catch(e => { notify('Не скачался: ' + e.message); renderSounds(); }); return; }
    if (a === 'lib-rm') { st.lib = st.lib.filter(x => x.name !== b.dataset.name); for (const c of Object.values(st.cues)) if (c.src === 'lib:' + b.dataset.name) { c.src = null; c.manual = false; } sfxAuto(); renderSounds(); sfxChanged(); return; }
  });
}
function sfxFindClose() { const db = dbState(), id = db.target; db.target = null; renderSounds(); if (id) el$row(id)?.querySelector('.sfind-b')?.focus({ preventScroll: true }); }
const el$row = id => document.querySelector(`#sfx-body .srow[data-id="${CSS.escape(id)}"]`);
/** Поиск открылся под строкой — строка с результатами должна быть видна, а курсор — в поле запроса. */
function sfxFindFocus(id) {
  requestAnimationFrame(() => {
    const f = document.querySelector(`#sfx-body .sfind[data-for="${CSS.escape(id)}"]`); if (!f) return;
    const r = f.getBoundingClientRect(); if (r.bottom > innerHeight - 16 || r.top < 80) f.scrollIntoView({ block: 'nearest', behavior: typeof MOTION !== 'undefined' && MOTION.reduce ? 'auto' : 'smooth' });
    const q = f.querySelector('.sfind-q'); if (q && document.activeElement !== q && !dbState().res.length) q.focus({ preventScroll: true });
  });
}
function sfxRowFlash(id) { const r = el$row(id); if (r && typeof r.animate === 'function' && !(typeof MOTION !== 'undefined' && MOTION.reduce)) r.animate([{ backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)' }, { backgroundColor: 'transparent' }], { duration: 900, easing: 'ease-out' }); }
