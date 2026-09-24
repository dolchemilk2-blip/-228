// Монтажка — вкладка «Чистка звука». Использует S, $, esc, notify, progress, play, stop, fmt,
// addFiles, render из app.js (в сборке — один файл) и модули из dsp.js (через C).

const MODULES = [
  { k: 'dehum', name: 'Гул сети', desc: '50 или 60 Гц и гармоники — только если они действительно торчат',
    params: [{ k: 'base', type: 'select', opts: [['auto', 'найти самому'], [50, '50 Гц'], [60, '60 Гц']] }] },
  { k: 'hp', name: 'Низ', desc: 'срез ниже частоты: подгул, стук по столу, ветер',
    params: [{ k: 'fc', min: 40, max: 160, step: 5, unit: 'Гц', label: 'срез' }] },
  { k: 'declick', name: 'Щелчки', desc: 'одиночные щелчки, тики, потрескивание',
    params: [{ k: 'sens', min: 0.3, max: 2, step: 0.1, label: 'чувствительность' }] },
  { k: 'denoise', name: 'Шум', desc: 'шипение, вентилятор, ровный фон; профиль шума берётся из тихих мест файла',
    params: [{ k: 'amount', min: 3, max: 24, step: 1, unit: 'дБ', label: 'сила' }, { k: 'sens', min: 1, max: 3, step: 0.1, label: 'чувствительность' }] },
  { k: 'dereverb', name: 'Эхо и комната', desc: 'спектрально — сушит сильнее всего, при больших значениях голос «водянистый»; хвосты — тише спад после слогов; паузы — тише всё между фразами',
    params: [{ k: 'spectral', min: 0, max: 1, step: 0.05, pct: true, label: 'спектрально' }, { k: 't60', min: 0.2, max: 1.5, step: 0.05, unit: 'с', label: 'размер комнаты' },
             { k: 'tails', min: 0, max: 1, step: 0.05, pct: true, label: 'хвосты после слогов' }, { k: 'pauses', min: 0, max: 24, step: 1, unit: 'дБ', label: 'паузы и дыхание тише на' }] },
  { k: 'deplosive', name: 'Взрывные', desc: '«п» и «б» в микрофон: низ придавливается только там, где выстреливает',
    params: [{ k: 'amount', min: 0, max: 1, step: 0.05, pct: true, label: 'сила' }] },
  { k: 'deess', name: 'Свист', desc: 'резкие «с», «ш», «ц»: полоса 4,5–9 кГц придавливается там, где громче обычного',
    params: [{ k: 'amount', min: 0, max: 1, step: 0.05, pct: true, label: 'сила' }] },
  { k: 'eq', name: 'Эквалайзер', desc: 'пять полос; частоту можно поменять', params: [] },
  { k: 'tone', name: 'Тембр', desc: 'снять гулкость (горб в низах) или подогнать спектр под другую запись, чтобы голоса звучали вместе',
    params: [{ k: 'mode', type: 'select', opts: [['auto', 'снять гулкость'], ['match', 'как у другой записи']] }, { k: 'ref', type: 'ref' }, { k: 'strength', min: 0, max: 1, step: 0.05, pct: true, label: 'насколько' }] },
  { k: 'comp', name: 'Компрессор', desc: 'ровнее по громкости внутри реплик; поднимает и хвосты комнаты — включать после чистки',
    params: [{ k: 'amount', min: 0, max: 1, step: 0.05, pct: true, label: 'сила' }] },
  { k: 'loud', name: 'Громкость', desc: 'привести файл к уровню', params: [{ k: 'lufs', type: 'select', opts: [[-16, '−16 LUFS'], [-18, '−18 LUFS'], [-20, '−20 LUFS'], [-23, '−23 LUFS']] }] },
];
const PRESET_NAMES = { soft: 'Мягко', normal: 'Обычно', strong: 'Сильно', hum: 'Только гул и низ', none: 'Ничего' };
const EXCERPT = 12;

// ------------------------------------------------------------------ воркер обработки
let dspWorker = null, dspSeq = 0; const dspWaiting = new Map();
function dsp() {
  if (dspWorker) return dspWorker;
  if (typeof DSP_WORKER_SRC === 'undefined') return null;
  try {
    dspWorker = new Worker(URL.createObjectURL(new Blob([DSP_WORKER_SRC], { type: 'text/javascript' })));
    dspWorker.onmessage = e => {
      const m = e.data, w = dspWaiting.get(m.id); if (!w) return;
      if (m.type === 'progress') { w.onProgress && w.onProgress(m.p); return; }
      dspWaiting.delete(m.id);
      m.type === 'error' ? w.rej(new Error(m.message)) : w.res(m);
    };
    dspWorker.onerror = () => { for (const w of dspWaiting.values()) w.rej(new Error('обработка в фоне не запустилась')); dspWaiting.clear(); dspWorker = null; };
  } catch { dspWorker = null; }
  return dspWorker;
}
function dspCall(msg, transfer, onProgress) {
  const w = dsp();
  if (!w) return Promise.resolve().then(() => {                    // без воркера — на странице
    if (msg.type === 'analyze') return { A: C.analyze(msg.y), noise: C.noiseProfile(msg.y), ltas: msg.wantLtas ? C.ltas(msg.y, 2) : null };
    const r = C.runChain(msg.y, msg.chain, msg.aux, onProgress); return { y: r.y, log: r.log };
  });
  return new Promise((res, rej) => { const id = ++dspSeq; dspWaiting.set(id, { res, rej, onProgress }); w.postMessage({ ...msg, id }, transfer || []); });
}

// ------------------------------------------------------------------ состояние файла
function cl(f) {
  if (!f.clean) f.clean = { chain: null, preset: 'normal', A: null, noise: null, ltas: null, at: null, before: null, after: null, log: null, busy: false, dirty: true };
  return f.clean;
}
const srcOf = f => f.raw48 || f.y48;
function excerptStart(f) {
  const y = srcOf(f), n = Math.floor(y.length / C.SR), cs = new Float64Array(n + 1);
  for (let s = 0; s < n; s++) { let e = 0; const o = s * C.SR; for (let i = o; i < o + C.SR; i += 8) e += y[i] * y[i]; cs[s + 1] = cs[s] + e; }
  let best = 0, bv = -1; for (let s = 0; s + EXCERPT <= n; s++) { const v = cs[s + EXCERPT] - cs[s]; if (v > bv) { bv = v; best = s; } }
  return best;
}
async function analyzeFile(f) {
  const c = cl(f); if (c.A || c.busy) return;
  c.busy = true; renderCleanup();
  try {
    const y = srcOf(f).slice();
    const r = await dspCall({ type: 'analyze', y, wantLtas: false }, [y.buffer]);
    c.A = r.A; c.noise = r.noise;
    if (!c.chain) c.chain = C.defaultChain(c.preset, { boom: r.A.boom });
    if (c.at == null) c.at = excerptStart(f);
  } catch (err) { notify('Не удалось разобрать файл: ' + err.message); }
  c.busy = false; c.dirty = true; renderCleanup();
  previewSoon(f);
}
async function refLtas(name) {
  const rf = S.files.find(x => x.name === name); if (!rf || !srcOf(rf)) return null;
  const c = cl(rf); if (c.ltas) return c.ltas;
  const y = srcOf(rf).slice();
  const r = await dspCall({ type: 'analyze', y, wantLtas: true }, [y.buffer]);
  c.A = c.A || r.A; c.noise = c.noise || r.noise; c.ltas = r.ltas; return c.ltas;
}
let previewTimer = null, previewRun = 0;
function previewSoon(f) { clearTimeout(previewTimer); previewTimer = setTimeout(() => preview(f), 350); }
async function preview(f) {
  const c = cl(f); if (!c.chain || !srcOf(f)) return;
  const run = ++previewRun, y = srcOf(f), a = Math.round(c.at * C.SR), b = Math.min(y.length, a + EXCERPT * C.SR);
  c.before = y.slice(a, b);
  const aux = { noise: c.noise, refLtas: c.chain.tone.on && c.chain.tone.mode === 'match' && c.chain.tone.ref ? await refLtas(c.chain.tone.ref) : null };
  const seg = c.before.slice();
  try {
    const r = await dspCall({ type: 'run', y: seg, chain: c.chain, aux }, [seg.buffer]);
    if (run !== previewRun) return;
    c.after = r.y; c.previewLog = r.log; c.dirty = false;
  } catch (err) { notify('Не получилось обработать отрывок: ' + err.message); }
  renderCleanup();
}
async function applyFile(f) {
  const c = cl(f); if (!c.chain || c.busy) return;
  c.busy = true; renderCleanup(); S.busy = true;
  try {
    const src = srcOf(f).slice();
    const aux = { noise: c.noise, refLtas: c.chain.tone.on && c.chain.tone.mode === 'match' && c.chain.tone.ref ? await refLtas(c.chain.tone.ref) : null };
    progress(`Обрабатываю ${f.name}…`, 0);
    const r = await dspCall({ type: 'run', y: src, chain: c.chain, aux }, [src.buffer], p => progress(`Обрабатываю ${f.name}: ${Math.round(p * 100)} %`, p));
    if (!f.raw48) f.raw48 = f.y48;
    f.y48 = r.y; c.log = r.log; c.appliedChain = JSON.parse(JSON.stringify(c.chain));
    S.result = null; progress('', 0);
    notify(`${f.name}: обработано. В сведение теперь идёт очищенная версия.`);
  } catch (err) { progress('', 0); notify('Не получилось: ' + err.message); }
  c.busy = false; S.busy = false; render();
}
function revertFile(f) {
  const c = cl(f); if (!f.raw48) return;
  f.y48 = f.raw48; f.raw48 = null; c.log = null; c.appliedChain = null; S.result = null; render();
}

// ------------------------------------------------------------------ спектрограмма
const CMAP = [[0, [14, 18, 32]], [0.25, [40, 60, 120]], [0.5, [20, 130, 140]], [0.75, [120, 200, 90]], [1, [250, 240, 120]]];
function color(v) {
  for (let i = 1; i < CMAP.length; i++) if (v <= CMAP[i][0]) { const [p0, c0] = CMAP[i - 1], [p1, c1] = CMAP[i], t = (v - p0) / (p1 - p0); return c0.map((a, k) => a + (c1[k] - a) * t); }
  return CMAP[CMAP.length - 1][1];
}
function drawSpec(canvas, y) {
  if (!canvas || !y) return;
  const W = Math.max(300, Math.floor(canvas.clientWidth || 600)), H = 150;
  canvas.width = W; canvas.height = H;
  const sp = C.spectrogram(y, { cols: W, rows: H });
  const img = canvas.getContext('2d').createImageData(W, H), d = img.data;
  for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) {
    const col = Math.min(sp.cols - 1, Math.floor(x * sp.cols / W)), v = (sp.data[r * sp.cols + col] - sp.min) / (sp.max - sp.min), c = color(Math.max(0, Math.min(1, v)));
    const o = (r * W + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  canvas.getContext('2d').putImageData(img, 0, 0);
}

// ------------------------------------------------------------------ отрисовка
function hintChips(A) {
  if (!A) return '';
  const out = [];
  if (A.hum) out.push(`<span class="hint bad">гул ${A.hum.base} Гц, +${A.hum.peaks[0].prom} дБ</span>`); else out.push('<span class="hint ok">гула нет</span>');
  out.push(`<span class="hint ${A.floorDb > -50 ? 'bad' : A.floorDb > -60 ? 'mid' : 'ok'}">фон ${A.floorDb.toFixed(0)} дБ</span>`);
  if (A.boom >= 4) out.push(`<span class="hint bad">низ +${A.boom} дБ — гулко</span>`); else if (A.boom >= 2) out.push(`<span class="hint mid">низ +${A.boom} дБ</span>`);
  if (A.decay != null) out.push(`<span class="hint ${A.decay < 100 ? 'bad' : A.decay < 125 ? 'mid' : 'ok'}">спад ${A.decay} дБ/с — ${A.decay < 100 ? 'комната' : A.decay < 125 ? 'немного комнаты' : 'сухо'}</span>`);
  out.push(`<span class="hint">${A.lufs.toFixed(1)} LUFS · пик ${A.peakDb.toFixed(1)} дБ</span>`);
  return out.join('');
}
function paramHtml(mod, p, chain, f) {
  const v = chain[mod.k][p.k];
  if (p.type === 'select') return `<label class="prm"><span>${esc(p.label || '')}</span><select data-m="${mod.k}" data-p="${p.k}">${p.opts.map(([val, t]) => `<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
  if (p.type === 'ref') {
    if (chain.tone.mode !== 'match') return '';
    const others = S.files.filter(x => x !== f && srcOf(x));
    return `<label class="prm"><span>образец</span><select data-m="tone" data-p="ref">${others.length ? others.map(x => `<option value="${esc(x.name)}" ${chain.tone.ref === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('') : '<option value="">нет других записей</option>'}</select></label>`;
  }
  const shown = p.pct ? `${Math.round(v * 100)} %` : `${v}${p.unit ? ' ' + p.unit : ''}`;
  return `<label class="prm"><span>${esc(p.label)} <b>${shown}</b></span><input type="range" data-m="${mod.k}" data-p="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}"></label>`;
}
function eqHtml(chain) {
  return `<div class="eq">${chain.eq.bands.map((b, i) => `<div class="eqb"><input type="range" class="v" data-m="eq" data-b="${i}" data-p="gain" min="-12" max="12" step="0.5" value="${b.gain}" aria-label="усиление ${b.f} Гц"><b>${b.gain > 0 ? '+' : ''}${b.gain}</b><input type="number" data-m="eq" data-b="${i}" data-p="f" value="${b.f}" min="30" max="16000" step="10" aria-label="частота"><span>Гц</span></div>`).join('')}</div>`;
}
function renderCleanup() {
  const pane = $('#cl-body'); if (!pane) return;
  const files = S.files.filter(f => srcOf(f) && !f.error);
  if (!files.length) { pane.innerHTML = '<p class="muted">Добавьте записи — здесь же или на вкладке «Сборка». Чистить можно любой файл, не только тот, что идёт в спектакль.</p>'; return; }
  if (!S.cleanFile || !files.includes(S.cleanFile)) S.cleanFile = files[0];
  const f = S.cleanFile, c = cl(f);
  const tabs = `<div class="cl-files">${files.map(x => `<button class="ftab ${x === f ? 'on' : ''}" data-name="${esc(x.name)}">${esc(x.name)}${x.raw48 ? ' <i>✓</i>' : ''}</button>`).join('')}</div>`;
  if (!c.A) { pane.innerHTML = tabs + `<p class="muted">${c.busy ? 'Смотрю, что с записью…' : 'Разбираю…'}</p>`; if (!c.busy) analyzeFile(f); return; }
  const chain = c.chain;
  const mods = MODULES.map(m => `
    <div class="mod ${chain[m.k].on ? 'on' : ''}">
      <label class="mhead"><input type="checkbox" data-m="${m.k}" data-p="on" ${chain[m.k].on ? 'checked' : ''}><b>${m.name}</b><span>${m.desc}</span></label>
      <div class="mprm">${m.k === 'eq' ? eqHtml(chain) : m.params.map(p => paramHtml(m, p, chain, f)).join('')}</div>
    </div>`).join('');
  const dur = srcOf(f).length / C.SR;
  pane.innerHTML = tabs + `
    <div class="cl-head"><div class="hints">${hintChips(c.A)}</div>
      <div class="presets">${Object.entries(PRESET_NAMES).map(([k, n]) => `<button class="ghost-b ${c.preset === k ? 'on' : ''}" data-preset="${k}">${n}</button>`).join('')}</div></div>
    <div class="mods">${mods}</div>
    <div class="cl-ab">
      <div class="ab-top">
        <label class="prm grow"><span>Отрывок для прослушивания: с ${fmt(c.at)} (${EXCERPT} с)</span><input type="range" id="cl-at" min="0" max="${Math.max(0, Math.floor(dur - EXCERPT))}" step="1" value="${c.at}"></label>
        <button class="play ab" data-act="before" ${c.before ? '' : 'disabled'}>▶ Было</button>
        <button class="play ab" data-act="after" ${c.after && !c.dirty ? '' : 'disabled'}>▶ Стало</button>
      </div>
      <div class="specs"><div><span class="lbl">было</span><canvas id="cl-spec-a"></canvas></div><div><span class="lbl">стало${c.dirty ? ' — считаю…' : ''}</span><canvas id="cl-spec-b"></canvas></div></div>
      ${c.previewLog ? `<p class="muted small">${c.previewLog.map(esc).join(' · ')}</p>` : ''}
    </div>
    <div class="cl-actions">
      <button class="primary" data-act="apply" ${c.busy ? 'disabled' : ''}>${f.raw48 ? 'Применить заново ко всему файлу' : 'Применить ко всему файлу'}</button>
      ${f.raw48 ? '<button class="ghost-b" data-act="revert">Вернуть оригинал</button><button class="ghost-b" data-act="wav">Скачать WAV</button>' : ''}
      <span class="muted small">${f.raw48 ? 'В сведение идёт обработанная версия. ' + (c.log ? c.log.join(' · ') : '') : 'Пока в сведение идёт оригинал.'}</span>
    </div>`;
  requestAnimationFrame(() => { drawSpec($('#cl-spec-a'), c.before); drawSpec($('#cl-spec-b'), c.dirty ? null : c.after); });
}
function bindCleanup() {
  const pane = $('#cl-body');
  pane.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const f = S.cleanFile, c = f && cl(f);
    if (b.dataset.name) { S.cleanFile = S.files.find(x => x.name === b.dataset.name); stop(); renderCleanup(); return; }
    if (b.dataset.preset) { c.preset = b.dataset.preset; c.chain = C.defaultChain(c.preset, { boom: c.A.boom }); c.dirty = true; renderCleanup(); previewSoon(f); return; }
    const a = b.dataset.act;
    if (a === 'before' && c.before) return playing && playing.btn === b ? stop() : play(c.before, b);
    if (a === 'after' && c.after) return playing && playing.btn === b ? stop() : play(c.after, b);
    if (a === 'apply') return applyFile(f);
    if (a === 'revert') return revertFile(f);
    if (a === 'wav') return download(new Blob([C.wav24(f.y48)], { type: 'audio/wav' }), f.name.replace(/\.[^.]+$/, '') + '_чисто.wav');
  });
  const onParam = e => {
    const x = e.target, f = S.cleanFile; if (!f || !x.dataset.m) return;
    const c = cl(f), m = x.dataset.m, p = x.dataset.p;
    if (m === 'eq' && x.dataset.b != null) { const band = c.chain.eq.bands[+x.dataset.b]; band[p] = +x.value; if (p === 'gain') x.nextElementSibling.textContent = (band.gain > 0 ? '+' : '') + band.gain; }
    else if (p === 'on') c.chain[m].on = x.checked;
    else if (x.tagName === 'SELECT') { const v = x.value; c.chain[m][p] = v === '' ? null : isNaN(+v) || p === 'ref' ? v : +v; if (m === 'tone' && p === 'mode') { renderCleanup(); } }
    else { c.chain[m][p] = +x.value; const lbl = x.previousElementSibling?.querySelector('b'); if (lbl) { const spec = MODULES.find(q => q.k === m).params.find(q => q.k === p); lbl.textContent = spec.pct ? `${Math.round(x.value * 100)} %` : `${x.value}${spec.unit ? ' ' + spec.unit : ''}`; } }
    if (p === 'on') { x.closest('.mod').classList.toggle('on', x.checked); }
    c.dirty = true; $('#cl-spec-b') && ($('#cl-spec-b').previousElementSibling.textContent = 'стало — считаю…'); previewSoon(f);
  };
  pane.addEventListener('input', e => { if (e.target.id === 'cl-at') { const f = S.cleanFile, c = cl(f); c.at = +e.target.value; e.target.previousElementSibling.textContent = `Отрывок для прослушивания: с ${fmt(c.at)} (${EXCERPT} с)`; c.dirty = true; previewSoon(f); return; } onParam(e); });
  pane.addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') onParam(e); });
  $('#cl-add').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
}
