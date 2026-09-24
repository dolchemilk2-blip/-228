// Монтажка — вкладка «Звуки»: ремарки сценария, которые звучат (дверь, стук, шаги…), звук к ним
// из библиотеки пользователя или встроенный, и как класть: между репликами или фоном.
// Использует S, $, esc, notify, play, stop, decodeFile, fmt, saveEdits из app.js; C — ядро.

const SFX_DEFAULT_GAIN = { seq: -6, bed: -16 };
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
  const L = C.integratedLufs(y), g = (isFinite(L) && L > -69 ? Math.pow(10, (-20 - L) / 20) : 1) * Math.pow(10, (cue.gain || 0) / 20);
  const out = new Float32Array(y.length); for (let i = 0; i < y.length; i++) out[i] = y[i] * g;
  const n = Math.min(out.length, Math.round(0.02 * C.SR)); for (let i = 0; i < n; i++) { out[i] *= i / n; out[out.length - 1 - i] *= i / n; }
  if (cue.mode === 'bed') { const nf = Math.min(out.length >> 1, Math.round(0.4 * C.SR)); for (let i = 0; i < nf; i++) { out[out.length - 1 - i] *= i / nf; } }
  return { audio: out, name };
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
function renderSounds() {
  const el = $('#sfx-body'); if (!el) return;
  if (!S.P) { el.innerHTML = '<p class="muted">Сначала вставьте сценарий на вкладке «Сборка»: звуки берутся из его ремарок.</p>'; return; }
  const st = sfxState(); sfxAuto();
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
    list.push(`<div class="srow ${cue.on && cue.src ? 'on' : ''}" data-id="${c.id}">
      <label class="mini"><input type="checkbox" data-p="on" ${cue.on ? 'checked' : ''} aria-label="в дорожку"></label>
      <div class="stext"><span class="num">${esc(c.id)}</span> ${esc(c.text)}${a && !cue.manual ? `<span class="muted"> · ${a.strong ? 'похоже на звук' : 'может быть звуком'}</span>` : ''}</div>
      <select data-p="src" aria-label="источник">${srcOpts(cue)}</select>
      <select data-p="mode" aria-label="как класть"><option value="seq" ${cue.mode === 'seq' ? 'selected' : ''}>между репликами</option><option value="bed" ${cue.mode === 'bed' ? 'selected' : ''}>фоном под следующими</option></select>
      <label class="gain"><input type="range" data-p="gain" min="-30" max="6" step="1" value="${cue.gain}" aria-label="громкость"><span>${cue.gain > 0 ? '+' : ''}${cue.gain} дБ</span></label>
      <button class="play" data-act="play" ${cue.src ? '' : 'disabled'} aria-label="Слушать">▶</button>
    </div>`);
  }
  el.innerHTML = `
    <div class="sfx-head">
      <label class="ghost-b file-b">Загрузить свои звуки<input type="file" id="sfx-add" accept="audio/*,.m4a,.opus,.flac" multiple hidden></label>
      <span class="muted small">файлы называйте по смыслу: «дверь открывается.wav», «шаги.mp3», «стук.wav» — так они подставятся к ремаркам сами</span>
      <span class="pill ok">в дорожке ${inTrack}</span>
      <label class="mini"><input type="checkbox" id="sfx-all" ${st.showAll ? 'checked' : ''}> показывать все ремарки</label>
    </div>
    ${st.lib.length ? `<div class="chips">${st.lib.map(f => `<span class="chip ghost">${esc(f.name)} <i>${fmt(f.dur)}</i> <button class="icon xs" data-act="lib-play" data-name="${esc(f.name)}" aria-label="Слушать">▶</button><button class="icon xs" data-act="lib-rm" data-name="${esc(f.name)}" aria-label="Убрать">✕</button></span>`).join('')}</div>` : ''}
    <div class="srows">${list.join('') || '<p class="muted pad">Звучащих ремарок не нашлось. Включите «показывать все ремарки» и назначьте звук вручную.</p>'}</div>`;
}
function bindSounds() {
  const el = $('#sfx-body');
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
  el.addEventListener('input', e => { const x = e.target; if (x.dataset.p === 'gain') { x.nextElementSibling.textContent = `${x.value > 0 ? '+' : ''}${x.value} дБ`; } });
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'play') { const r = sfxAudio(b.closest('.srow').dataset.id) || (() => { const cue = sfxCue(b.closest('.srow').dataset.id), was = cue.on; cue.on = true; const r = sfxAudio(b.closest('.srow').dataset.id); cue.on = was; return r; })(); if (r) playing && playing.btn === b ? stop() : play(r.audio, b); return; }
    if (a === 'lib-play') { const f = sfxState().lib.find(x => x.name === b.dataset.name); if (f) playing && playing.btn === b ? stop() : play(f.y48, b); return; }
    if (a === 'lib-rm') { const st = sfxState(); st.lib = st.lib.filter(x => x.name !== b.dataset.name); for (const c of Object.values(st.cues)) if (c.src === 'lib:' + b.dataset.name) { c.src = null; c.manual = false; } sfxAuto(); S.result = null; renderSounds(); return; }
  });
}
