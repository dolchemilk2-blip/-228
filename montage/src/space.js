// Монтажка — мизансцена: где стоит каждый персонаж, куда он идёт по ходу сцены и как это звучит —
// стерео (панорама, расстояние, комната вокруг) или объёмно в наушниках (HRTF браузера).
// План сцены сверху: внизу — слушатель, вверху — глубина сцены. Персонажей перетаскивают; у сцены может
// быть своя расстановка. Движение — у реплики или звука (меню таймлайна): входит, уходит, подходит,
// проходит слева направо… Пока плеер играет, на плане видно, кто говорит и куда идёт.
// Использует S, $, esc, C, charName, colorOf, saveEdits, remixSoon, progress, TP, tpTime из app.js;
// histPush из history.js; fxPool из fx.js; mv, mvTo, SPRING из spring.js.

const SPACE_MODES = [['mono', 'Моно'], ['stereo', 'Стерео'], ['binaural', 'Объём в наушниках']];
const SPACE_HOME = { x: 0, y: 0.15 }, SPACE_SFX = { x: 0, y: 0.3 }, SPACE_CENTER = { x: 0, y: 0 };
const SPACE_MOVES = { enter: 'входит', away: 'уходит', near: 'подходит', lr: 'слева направо', rl: 'справа налево', to: 'идёт на место' };
function stageState() {
  if (!S.stage) S.stage = { mode: 'mono', room: 0.5, pos: {}, scenes: {}, moves: {} };
  const st = S.stage; if (!st.pos) st.pos = {}; if (!st.scenes) st.scenes = {}; if (!st.moves) st.moves = {}; if (st.room == null) st.room = 0.5;
  return st;
}
const spaceOn = () => !!(S.stage && S.stage.mode && S.stage.mode !== 'mono');
/** Сведение в два канала: мизансцена или музыка (она стерео). Иначе — моно, как раньше. */
const stereoMix = () => spaceOn() || (typeof musicOn === 'function' && musicOn());
const spaceKey = p => `${(+p.x).toFixed(3)},${(+p.y).toFixed(3)}`;
const spaceClamp = p => ({ x: Math.round(Math.max(-1, Math.min(1, +p.x || 0)) * 1000) / 1000, y: Math.round(Math.max(0, Math.min(1, +p.y || 0)) * 1000) / 1000 });
/** Для сохранения: только настройки. */
const stageSaved = () => { const st = stageState(); return { mode: st.mode, room: st.room, pos: st.pos, scenes: st.scenes, moves: st.moves }; };
function stageLoad(v) { S.stage = v && typeof v === 'object' ? { mode: v.mode || 'mono', room: v.room ?? 0.5, pos: v.pos || {}, scenes: v.scenes || {}, moves: v.moves || {} } : null; }

/** Сколько реплик у персонажей — главные ближе к центру и к слушателю. */
function spaceCounts() { const m = new Map(); if (S.P) for (const c of S.P.cues) if (c.type === 'line') m.set(c.spk, (m.get(c.spk) || 0) + 1); return m; }
/** Расставить самим: главные — слева и справа от центра, остальные — шире и глубже; «голос в голове» — в центре, вплотную. */
function spaceAuto(force = false) {
  const st = stageState(); if (!S.P) return;
  const counts = spaceCounts(), chars = S.P.chars.filter(c => counts.get(c.key)).sort((a, b) => counts.get(b.key) - counts.get(a.key));
  // ряды: главные двое — ближе всех по бокам от центра; дальше — шире и глубже, чтобы подписи не наезжали
  const slots = [[-0.4, 0.14], [0.4, 0.14], [-0.8, 0.34], [0.8, 0.34], [0, 0.34], [-0.45, 0.54], [0.45, 0.54], [-0.85, 0.72], [0.85, 0.72], [0, 0.72], [-0.4, 0.88], [0.4, 0.88]];
  let k = 0;
  for (const c of chars) {
    if (!force && st.pos[c.key]) continue;
    if (spaceInHead(c.key)) { st.pos[c.key] = { x: 0, y: 0 }; continue; }
    const [x, y] = slots[k++ % slots.length];
    st.pos[c.key] = { x, y };
  }
}
/** Движение у реплики: откуда и куда за время реплики. c — где персонаж стоял до неё. */
function spaceMove(mv, c) {
  if (!mv) return [c, c];
  switch (mv.k) {
    case 'enter': return [{ x: c.x, y: 1 }, c];
    case 'away': return [c, { x: c.x, y: 1 }];
    case 'near': return [c, { x: Math.round(c.x * 60) / 100, y: 0.03 }];
    case 'lr': return [{ x: -0.9, y: c.y }, { x: 0.9, y: c.y }];
    case 'rl': return [{ x: 0.9, y: c.y }, { x: -0.9, y: c.y }];
    case 'to': return [c, spaceClamp(mv.to || c)];
    default: return [c, c];
  }
}
/** Где кто на каждой реплике: {a, b} для каждой уложенной реплики и звука. Сцена начинается с её расстановки. */
function spacePlan(lay) {
  const st = stageState(), sceneOf = new Map(lay.rows.map(r => [r.cue.id, r.scene])), cur = new Map(), out = new Map();
  let scene;
  for (const p of lay.placed) {
    const id = p.cue.id, sc = sceneOf.get(id); if (sc !== scene) { scene = sc; cur.clear(); }
    const mv = st.moves[id];
    if (p.item) {
      if (p.item.fxKey === 'thought') { out.set(p, { a: SPACE_CENTER, b: SPACE_CENTER }); continue; }   // мысли — внутри головы
      const v = p.item.voice, c = cur.get(v) || spaceHome(v, sc), [a, b] = spaceMove(mv, c); cur.set(v, b); out.set(p, { a, b });
    } else { const [a, b] = mv && mv.k === 'to' ? [spaceClamp(mv.to), spaceClamp(mv.to)] : spaceMove(mv, SPACE_SFX); out.set(p, { a, b }); }
  }
  return out;
}
function spaceHome(v, sc) { const st = stageState(), o = sc != null && st.scenes[sc] && st.scenes[sc][v]; return o || st.pos[v] || (v === 'ремарки' ? SPACE_CENTER : SPACE_HOME); }

// ------------------------------------------------------------------ звук: в фоновых потоках, объём — браузером
let spSeq = 0;
function spaceInWorker(x, a, b, opt) {
  const pool = (typeof fxPool === 'function' ? fxPool() : []).filter(w => !w.dead);
  const local = () => { const r = C.spaceRender(x, a, b, opt); return r.D == null ? C.spPack(r.L, r.R) : r; };
  if (!pool.length) return Promise.resolve(local());
  const w = pool.reduce((p, q) => (q.busy < p.busy ? q : p)), id = 'sp' + (++spSeq), y = x.slice();
  w.busy++;
  return new Promise((res, rej) => { w.wait.set(id, { res, rej }); w.postMessage({ type: 'space', id, y, a, b, opt }, [y.buffer]); }).catch(local);
}
/** Поправка объёмного звука браузера: задержка и громкость — чтобы голос спереди звучал как в стерео по центру. */
let HRTF_CAL = null;
async function spaceHrtfCal() {
  if (HRTF_CAL) return HRTF_CAL;
  const SR = C.SR, n = SR >> 1, noise = new Float32Array(n); let s = 7;
  for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; noise[i] = (s / 2147483647 - 0.5) * 0.4; }
  const imp = new Float32Array(2048); imp[0] = 1;
  const [il, ir] = await spaceHrtfRaw(imp, SPACE_CENTER, SPACE_CENTER, 0);
  let lat = 0, pk = 0; for (let i = 0; i < il.length; i++) { const v = Math.abs(il[i]) + Math.abs(ir[i]); if (v > pk) { pk = v; lat = i; } }
  const [nl, nr] = await spaceHrtfRaw(noise, SPACE_CENTER, SPACE_CENTER, 0);
  let ei = 0, eo = 0; for (let i = 0; i < n; i++) ei += noise[i] * noise[i]; for (let i = lat; i < nl.length; i++) eo += nl[i] * nl[i] + nr[i] * nr[i];
  HRTF_CAL = { lat, g: eo > 0 ? Math.sqrt(ei / eo) : 1 };
  return HRTF_CAL;
}
async function spaceHrtfRaw(D, a, b, extra) {
  const SR = C.SR, n = D.length, ctx = new OfflineAudioContext(2, n + extra + 64, SR), buf = ctx.createBuffer(1, n, SR); buf.copyToChannel(D, 0);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const pn = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'linear', refDistance: 1, maxDistance: 10000, rolloffFactor: 0 });
  const at = p => { const az = Math.max(-1, Math.min(1, p.x)) * 1.4; return [Math.sin(az), -Math.cos(az)]; };   // до 80° в сторону
  const [x0, z0] = at(a); pn.positionX.setValueAtTime(x0, 0); pn.positionY.setValueAtTime(0, 0); pn.positionZ.setValueAtTime(z0, 0);
  if (Math.abs(a.x - b.x) > 1e-4) { const dur = n / SR, K = Math.max(2, Math.ceil(dur / 0.05)); for (let k = 1; k <= K; k++) { const f = k / K, [x, z] = at({ x: a.x + (b.x - a.x) * f }); pn.positionX.linearRampToValueAtTime(x, dur * f); pn.positionZ.linearRampToValueAtTime(z, dur * f); } }
  src.connect(pn).connect(ctx.destination); src.start(0);
  const out = await ctx.startRendering();
  return [out.getChannelData(0), out.getChannelData(1)];
}
async function spaceHrtf(r, a, b) {
  const cal = await spaceHrtfCal(), n = r.D.length, [hl, hr] = await spaceHrtfRaw(r.D, a, b, cal.lat);
  const len = r.L ? Math.max(n, r.L.length) : n, L = new Float32Array(len), R = new Float32Array(len), g = cal.g;
  for (let i = 0; i < n; i++) { L[i] = hl[i + cal.lat] * g; R[i] = hr[i + cal.lat] * g; }
  if (r.L) for (let i = 0; i < r.L.length; i++) { L[i] += r.L[i]; R[i] += r.R[i]; }
  return C.spPack(L, R);
}
const SPACE_SFX_CACHE = new Map();
const spaceFp = a => a.length + ':' + a[a.length >> 1] + ':' + a[a.length >> 2] + ':' + a[(a.length * 3) >> 2];
/** Длина с хвостом комнаты. */
const spaceLen = p => p.sp ? C.spLen(p.sp) : p.audio.length;
/**
 * Разложить уложенные реплики и звуки по каналам: p.sp = {L, R, gL, gR}. Готовое берётся из кэша (по звуку и месту),
 * новое считается параллельно в фоновых потоках; «объём» — ещё и объёмным звуком браузера.
 */
async function spaceEnsure(placed, lay, tick = async () => {}) {
  const st = stageState(), on = spaceOn(), mode = on ? st.mode : 'flat', room = on ? +st.room : 0, plan = spacePlan(lay), todo = [];
  for (const p of placed) {
    const pos = plan.get(p) || { a: SPACE_HOME, b: SPACE_HOME }, key = `${mode}|${room}|${spaceKey(pos.a)}|${spaceKey(pos.b)}`;
    let holder = p.item; if (!holder) { holder = SPACE_SFX_CACHE.get(p.cue.id); if (!holder) SPACE_SFX_CACHE.set(p.cue.id, holder = {}); }
    const src = p.item ? p.audio : spaceFp(p.audio), hit = holder._sp;
    if (hit && hit.key === key && hit.src === src) { p.sp = hit.sp; continue; }
    if (mode === 'flat') { p.sp = { L: p.audio, gL: Math.SQRT1_2, gR: Math.SQRT1_2 }; holder._sp = { key, src, sp: p.sp }; continue; }
    todo.push({ p, pos, key, holder, src });
  }
  if (!todo.length) return 0;
  const opt = { mode: mode === 'binaural' ? 'direct' : 'stereo', room }, many = todo.length > 24;
  let done = 0, next = 0;
  const K = Math.max(2, Math.min(8, ((typeof fxPool === 'function' ? fxPool().length : 0) || 2) * 2));
  const one = async j => {
    const r = await spaceInWorker(j.p.audio, j.pos.a, j.pos.b, opt);
    const sp = mode === 'binaural' ? await spaceHrtf(r, j.pos.a, j.pos.b) : r;
    j.holder._sp = { key: j.key, src: j.src, sp }; j.p.sp = sp;
    if (many && (++done % 8 === 0)) progress(`Мизансцена: ${done} из ${todo.length}…`, done / todo.length);
  };
  // не больше K сразу: копии всех реплик в очереди потоков — это сотни мегабайт
  await Promise.all(Array.from({ length: Math.min(K, todo.length) }, async () => { while (next < todo.length) { const j = todo[next++]; await one(j); await tick(); } }));
  if (many) progress('', 0);
  return todo.length;
}

// ------------------------------------------------------------------ план сцены (в шаге «Сведение»)
const SPACE_UI = { scope: 'all', drag: null, hist: null, live: null };
const spX = x => 50 + x * 44, spY = y => 86 - y * 74;              // место на плане, % — внизу слушатель, вверху глубина
const spFromXY = (px, py) => spaceClamp({ x: (px - 50) / 44, y: (86 - py) / 74 });
/** Персонажи сцены (или всего спектакля): у кого есть реплики, по порядку сценария. */
function spaceVoices(scope) {
  if (!S.P) return [];
  const has = new Set(); let sc = null;
  for (const c of S.P.cues) { if (c.type === 'scene') { sc = c.n; continue; } if (c.type === 'line' && (scope === 'all' || sc === scope)) has.add(c.spk); }
  return S.P.chars.filter(c => has.has(c.key)).map(c => c.key);
}
/** «Голос в голове» звучит внутри головы — по центру, вплотную; на плане его не двигают. */
const spaceInHead = v => { const fx = typeof fxOfVoice === 'function' ? fxOfVoice(v) : null; return !!(fx && fx.key === 'thought'); };
const spaceScenes = () => (S.P ? S.P.cues.filter(c => c.type === 'scene').map(c => c.n) : []);
function spacePosOf(v, scope) { const st = stageState(); return scope !== 'all' && st.scenes[scope] && st.scenes[scope][v] ? { p: st.scenes[scope][v], own: true } : { p: st.pos[v] || SPACE_HOME, own: false }; }
const spaceWhere = p => `${Math.abs(p.x) < 0.12 ? 'по центру' : (p.x < 0 ? 'слева' : 'справа') + (Math.abs(p.x) < 0.5 ? ', ближе к центру' : '')}, ${p.y < 0.2 ? 'у микрофона' : p.y < 0.5 ? 'недалеко' : p.y < 0.8 ? 'в глубине' : 'далеко'}`;
/** Движения по ходу сцены (или всего спектакля). */
function spaceMovesIn(scope) {
  const st = stageState(), out = []; if (!S.P) return out; let sc = null;
  for (const c of S.P.cues) { if (c.type === 'scene') { sc = c.n; continue; } const mv = st.moves[c.id]; if (mv && (scope === 'all' || sc === scope)) out.push({ c, mv, sc }); }
  return out;
}
function spaceHtml() {
  const st = stageState(), on = spaceOn(), scope = SPACE_UI.scope !== 'all' && !spaceScenes().includes(SPACE_UI.scope) ? (SPACE_UI.scope = 'all') : SPACE_UI.scope;
  const modes = `<div class="filters sp-modes" id="sp-mode" role="group" aria-label="Звук спектакля">${SPACE_MODES.map(([k, n]) => `<button type="button" data-spm="${k}" class="${st.mode === k ? 'on' : ''}" aria-pressed="${st.mode === k}">${n}</button>`).join('')}</div>`;
  const note = !on ? 'Все голоса из одной точки. Включите стерео — и расставьте персонажей по сцене.' : st.mode === 'binaural' ? 'Объёмный звук для наушников: голоса вокруг головы. В колонках лучше «Стерео».' : 'Слева и справа, ближе и дальше — для колонок и наушников.';
  if (!on) return `<div class="space off"><div class="sp-head"><b>Мизансцена</b>${modes}</div><p class="muted small">${note}</p></div>`;
  const scenes = spaceScenes(), all = spaceVoices(scope), voices = all.filter(v => !spaceInHead(v)), head = all.filter(spaceInHead), moves = spaceMovesIn(scope);
  const toks = voices.map(v => { const { p, own } = spacePosOf(v, scope); return `<button type="button" class="sp-tok ${colorOf(v)}${own ? ' own' : ''}" data-v="${esc(v)}" style="left:${spX(p.x)}%;top:${spY(p.y)}%" aria-label="${esc(charName(v))}: ${spaceWhere(p)}. Стрелки — сдвинуть"><span class="sp-dot">${esc(charName(v).slice(0, 1).toUpperCase())}</span><span class="sp-name">${esc(charName(v))}</span></button>`; }).join('');
  const ownN = scope !== 'all' && st.scenes[scope] ? Object.keys(st.scenes[scope]).length : 0;
  return `<div class="space">
    <div class="sp-head"><b>Мизансцена</b>${modes}<span class="muted small">${note}</span></div>
    ${scenes.length > 1 ? `<div class="filters sp-scopes" id="sp-scope" role="group" aria-label="Какая сцена"><button type="button" data-sps="all" class="${scope === 'all' ? 'on' : ''}" aria-pressed="${scope === 'all'}">Все сцены</button>${scenes.map(n => `<button type="button" data-sps="${esc(n)}" class="${scope === n ? 'on' : ''}" aria-pressed="${scope === n}" aria-label="Сцена ${esc(n)}" title="Сцена ${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
    <div class="sp-body">
      <div class="sp-stage" id="sp-stage" aria-label="План сцены: внизу слушатель, вверху глубина. Перетащите персонажей">
        <svg class="sp-floor" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M6 12 H94 M6 12 V92 M94 12 V92" />
          <path class="sp-arc" d="M22 92 A28 20 0 0 1 78 92" /><path class="sp-arc" d="M8 92 A42 42 0 0 1 92 92" /><path class="sp-arc" d="M2 92 A48 64 0 0 1 98 92" />
          <path class="sp-mid" d="M50 12 V92" />
        </svg>
        <span class="sp-lbl sp-l">слева</span><span class="sp-lbl sp-r">справа</span><span class="sp-lbl sp-far">глубина сцены</span>
        <span class="sp-ear" aria-hidden="true">${ic('headphones')}<i>слушатель</i></span>
        ${toks || '<span class="sp-empty muted small">В этой сцене нет реплик.</span>'}
        <span class="sp-now" aria-live="polite"></span>
      </div>
      <div class="sp-side">
        <button class="ghost-b" data-act="sp-auto">Расставить сами</button>
        ${scope !== 'all' ? `<p class="small muted">Сцена ${esc(scope)}: ${ownN ? `своё место у ${ownN} из ${voices.length}` : 'как во всех сценах'} — перетащите, чтобы поменять только здесь.</p>${ownN ? '<button class="ghost-b tiny" data-act="sp-scene-reset">Как во всех сценах</button>' : ''}` : '<p class="small muted">Расстановка для всего спектакля; у сцены может быть своя.</p>'}
        ${head.length ? `<p class="small muted">${head.map(v => esc(charName(v))).join(', ')} — внутри головы: по центру, вплотную.</p>` : ''}
        <label class="gain sp-room"><span>Комната <b data-num="sp-room">${Math.round(st.room * 100)}%</b></span><input type="range" id="sp-room" min="0" max="1" step="0.05" value="${st.room}" aria-label="Сколько комнаты вокруг голосов"></label>
        <div class="sp-moves"><b class="small">Движение по ходу ${scope === 'all' ? 'спектакля' : 'сцены'}</b>
          ${moves.length ? `<ul>${moves.slice(0, 40).map(({ c, mv, sc }) => `<li><span class="num">${esc(c.id)}</span> ${esc(c.type === 'line' ? charName(c.spk) : 'звук')} — ${esc(SPACE_MOVES[mv.k] || mv.k)}${scope === 'all' ? ` <span class="muted">(сцена ${esc(sc)})</span>` : ''}<button class="icon xs" data-act="sp-mv-rm" data-id="${esc(c.id)}" aria-label="Убрать движение">${ic('close')}</button></li>`).join('')}</ul>` : ''}
          <p class="muted small">Входит, уходит, проходит через сцену — правый щелчок по реплике или звуку на таймлайне → «Движение».</p></div>
      </div>
    </div>
  </div>`;
}
function renderSpace() {
  const box = $('#mix-space'); if (!box) return;
  if (SPACE_UI.drag) return;                             // во время перетаскивания план не перестраивается
  setHtml(box, S.result && S.result.out ? spaceHtml() : '');
  if (typeof segInd === 'function') { segInd($('#sp-mode'), 'sp-mode'); segInd($('#sp-scope'), 'sp-scope'); }
  SPACE_UI.live = null; spaceLive();
}
/** Правка мизансцены → пересчёт (реплики берутся из кэша, заново считаются только сдвинутые). */
function spaceChanged(label) {
  saveEdits();
  if (S.result && S.result.out) remixSoon('layout');
  if (label && typeof tlFlash === 'function' && S.tab === 'tl') tlFlash(label);
}
function spaceHist(label, key) {
  const now = performance.now(), h = SPACE_UI.hist;
  if (h && h.key === key && now - h.t < 1500) { h.t = now; return; }         // стрелками подряд — один шаг отмены
  histPush(label); SPACE_UI.hist = { key, t: now };
}
function spaceSet(v, p, scope = SPACE_UI.scope) {
  const st = stageState(), q = spaceClamp(p);
  if (scope === 'all') st.pos[v] = q; else (st.scenes[scope] || (st.scenes[scope] = {}))[v] = q;
}
function spaceSetMode(mode) {
  const st = stageState(); if (st.mode === mode) return;
  histPush(`звук: ${SPACE_MODES.find(m => m[0] === mode)[1].toLowerCase()}`);
  st.mode = mode; if (mode !== 'mono' && !Object.keys(st.pos).length) spaceAuto();
  saveEdits(); renderSpace();
  if (S.result && S.result.out) remixSoon('layout');
}
/** Движение у реплик и звуков (меню таймлайна). k = null — убрать. */
function spaceSetMove(ids, k) {
  const st = stageState(), list = [...ids]; if (!list.length) return;
  histPush(k ? `движение «${SPACE_MOVES[k]}» у ${list.length > 1 ? list.length + ' реплик' : 'реплики'}` : 'без движения');
  for (const id of list) { if (k) st.moves[id] = { k }; else delete st.moves[id]; }
  if (k && !spaceOn()) { st.mode = 'stereo'; if (!Object.keys(st.pos).length) spaceAuto(); notify('Мизансцена включена: стерео. Выключить — в сведении, «Моно».'); }
  spaceChanged(); renderSpace();
}
// ------------------------------------------------------------------ живой план: кто говорит и где он сейчас
function spaceLive() {
  const box = $('#sp-stage'), r = S.result; if (!box || !r || !r.lay || !spaceOn() || !box.getClientRects().length) return;   // план не на экране — не считать
  const t = typeof tpTime === 'function' ? tpTime() : 0, sc = (r.lay.scenes || []).find(s => t >= s.start && t < s.end);
  const key = TP.playing ? 'p' : 's' + (sc ? sc.n : ''); if (!TP.playing && SPACE_UI.live === key) return; SPACE_UI.live = key;
  let plan = r.lay._plan; if (!plan) { plan = spacePlan(r.lay); Object.defineProperty(r.lay, '_plan', { value: plan, configurable: true, writable: true }); }
  const at = new Map(), talk = new Set();
  if (TP.playing && sc) for (const p of r.lay.placed) {
    if (!p.item || p.at < sc.start || p.at >= sc.end) continue; const pos = plan.get(p); if (!pos) continue;
    const d = p.item.core != null ? p.item.core : p.audio.length / C.SR, v = p.item.voice;
    if (t >= p.at && t <= p.at + d) { const f = (t - p.at) / Math.max(0.01, d); at.set(v, { x: pos.a.x + (pos.b.x - pos.a.x) * f, y: pos.a.y + (pos.b.y - pos.a.y) * f }); talk.add(v); }
    else if (p.at + d < t) at.set(v, pos.b);
  }
  box.querySelectorAll('.sp-tok').forEach(el => {
    const v = el.dataset.v, live = TP.playing ? at.get(v) : null, p = live || spacePosOf(v, SPACE_UI.scope).p;
    el.style.left = spX(p.x) + '%'; el.style.top = spY(p.y) + '%'; el.classList.toggle('talk', talk.has(v)); el.classList.toggle('live', !!TP.playing);
  });
  const now = box.querySelector('.sp-now'); if (now) now.textContent = TP.playing && sc ? `сейчас: сцена ${sc.n}` : '';
}
function bindSpace() {
  const root = document;
  root.addEventListener('click', e => {
    const b = e.target.closest('#mix-space button'); if (!b) return;
    if (b.dataset.spm) { spaceSetMode(b.dataset.spm); return; }
    if (b.dataset.sps) { SPACE_UI.scope = b.dataset.sps; renderSpace(); return; }
    const a = b.dataset.act;
    if (a === 'sp-auto') { histPush('расставить персонажей'); const st = stageState(); if (SPACE_UI.scope !== 'all') delete st.scenes[SPACE_UI.scope]; spaceAuto(true); spaceChanged(); renderSpace(); notify('Главные — слева и справа от центра, остальные — шире и глубже.'); return; }
    if (a === 'sp-scene-reset') { histPush(`сцена ${SPACE_UI.scope}: как во всех`); delete stageState().scenes[SPACE_UI.scope]; spaceChanged(); renderSpace(); return; }
    if (a === 'sp-mv-rm') { spaceSetMove([b.dataset.id], null); return; }
  });
  root.addEventListener('input', e => { if (e.target.id === 'sp-room') { const el = e.target.closest('.sp-room').querySelector('b'); if (el) el.textContent = Math.round(+e.target.value * 100) + '%'; } });
  root.addEventListener('change', e => { if (e.target.id === 'sp-room') { histPush('комната вокруг голосов'); stageState().room = +e.target.value; spaceChanged(); } });
  // перетаскивание: персонаж идёт за пальцем 1:1, с того места, за которое взяли
  root.addEventListener('pointerdown', e => {
    const tok = e.target.closest('#sp-stage .sp-tok'); if (!tok || e.button > 0) return;
    e.preventDefault(); tok.setPointerCapture(e.pointerId); tok.focus({ preventScroll: true });
    const box = tok.closest('#sp-stage').getBoundingClientRect(), tr = tok.getBoundingClientRect();
    SPACE_UI.drag = { tok, v: tok.dataset.v, box, dx: e.clientX - (tr.left + tr.width / 2), dy: e.clientY - (tr.top + tr.height / 2), moved: false, id: e.pointerId };
    tok.classList.add('held');
  });
  root.addEventListener('pointermove', e => {
    const d = SPACE_UI.drag; if (!d || e.pointerId !== d.id) return;
    const px = (e.clientX - d.dx - d.box.left) / d.box.width * 100, py = (e.clientY - d.dy - d.box.top) / d.box.height * 100, p = spFromXY(px, py);
    d.p = p; d.moved = true; d.tok.style.left = spX(p.x) + '%'; d.tok.style.top = spY(p.y) + '%';
  });
  const up = e => {
    const d = SPACE_UI.drag; if (!d || e.pointerId !== d.id) return; SPACE_UI.drag = null;
    d.tok.classList.remove('held'); d.tok.classList.add('land'); setTimeout(() => d.tok.classList.remove('land'), 260);
    if (!d.moved || !d.p) return;
    histPush(`${charName(d.v)}: ${spaceWhere(d.p)}${SPACE_UI.scope !== 'all' ? ' (сцена ' + SPACE_UI.scope + ')' : ''}`);
    spaceSet(d.v, d.p); d.tok.setAttribute('aria-label', `${charName(d.v)}: ${spaceWhere(d.p)}. Стрелки — сдвинуть`);
    if (SPACE_UI.scope !== 'all') d.tok.classList.add('own');
    spaceChanged();
  };
  root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up);
  root.addEventListener('keydown', e => {
    const tok = e.target.closest && e.target.closest('#sp-stage .sp-tok'); if (!tok || !/^Arrow/.test(e.key)) return;
    e.preventDefault();
    const v = tok.dataset.v, s = e.shiftKey ? 0.2 : 0.05, p = { ...spacePosOf(v, SPACE_UI.scope).p };
    if (e.key === 'ArrowLeft') p.x -= s; if (e.key === 'ArrowRight') p.x += s; if (e.key === 'ArrowUp') p.y += s; if (e.key === 'ArrowDown') p.y -= s;
    const q = spaceClamp(p); spaceHist(`${charName(v)}: ${spaceWhere(q)}`, 'key:' + v + SPACE_UI.scope);
    spaceSet(v, q); tok.style.left = spX(q.x) + '%'; tok.style.top = spY(q.y) + '%'; tok.setAttribute('aria-label', `${charName(v)}: ${spaceWhere(q)}. Стрелки — сдвинуть`);
    spaceChanged();
  });
}
