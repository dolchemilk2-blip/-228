// Монтажка — фон сцен: по описанию сцены («кабинет, идёт урок», «гул, подносы, очередь») из базы BBC
// подбирается атмосфера, растягивается на всю сцену с плавными стыками и приглушается под репликами.
// Использует S, $, esc, fmt, notify, progress, play, stop, playing, saveEdits, remixSoon, renderMix из app.js;
// sfxState, dbSearch, dbAdd, dbFetch, dbState из sounds.js/sfxdb.js; C — ядро.

const AMB_RULES = [
  { re: /кабинет|класс|урок|парт/i, name: 'класс, идёт урок', q: 'classroom', good: /subdued|working|quiet|classroom/, bad: /argument|noisy|leaving|entering|infant|play|year-old|5-year|singing/ },
  { re: /столов|поднос|очеред|буфет/i, name: 'школьная столовая', q: 'school dining hall', good: /dining hall|canteen/, bad: /infant|grace|5 year|kitchen|steam|urn/ },
  { re: /коридор|к выходу|идут|перемен/i, name: 'школьный коридор', q: 'school corridor', good: /corridor/, bad: /hospital|italy|playground/ },
  { re: /кафел|туалет|гулко|умывальн/i, name: 'пустое гулкое помещение', q: 'quiet room', good: /quiet room/, bad: /crowd|speech|church|lloyd|underwriting/ },
  { re: /пустой зал|ряды кресел|пыльн/i, name: 'пустой зал', q: 'quiet room', good: /quiet room/, bad: /crowd|speech|church|lloyd|underwriting/ },
  { re: /тесно|темно|кулис|за сцен|занавес/i, name: 'за кулисами, зал за стеной', q: 'theatre foyer', good: /foyer|theatre/, bad: /china|changchun|applause|laughter/ },
  { re: /свет|концерт|выступлен|зрител|публик/i, name: 'зал со зрителями', q: 'audience murmur theatre', good: /audience|chatter|murmur/, bad: /leaving|laughter|applause|french/ },
  { re: /двор|улиц|снаружи|на воздух/i, name: 'улица, двор', q: 'street atmosphere', good: /high street|college|street/, bad: /china|mexico|greece|tram|market|riverboat|tijuana/ },
  { re: /зал/i, name: 'зал', q: 'quiet room', good: /quiet room/, bad: /crowd|speech|church|lloyd|underwriting/ },
];
function ambState() { if (!S.amb) S.amb = { duck: 8, scenes: {}, cands: {} }; return S.amb; }
/** Описание сцены — первые одна-две ремарки после заголовка. */
function sceneDesc(sceneCue) {
  const cues = S.P.cues, i = cues.indexOf(sceneCue), out = [];
  for (let k = i + 1; k < cues.length && out.length < 2; k++) { const c = cues[k]; if (c.type === 'scene' || c.type === 'line') break; if (c.type === 'dir') out.push(c.text); }
  return out.join(' · ');
}
function ambRule(desc) { for (const r of AMB_RULES) if (r.re.test(desc)) return r; return null; }
function ambScenes() { return S.P ? S.P.cues.filter(c => c.type === 'scene').map(c => { const desc = sceneDesc(c); return { n: c.n, cue: c, desc, rule: ambRule(desc) }; }) : []; }
function ambSave() { saveEdits(); }
/** Подбор из базы: по сцене — лучший кандидат (рубрика, описание, длина от 40 с); остальные запоминаются для «другой». */
function ambPick(items, rule) {
  const scored = items.filter(it => it.dur >= 20).map(it => {
    const all = (it.rubric || '') + ' ' + it.text.toLowerCase(); let s = 0;
    if (rule.good.test(all)) s += 3; if (rule.bad.test(all)) s -= 4; if (/^NHU/i.test(it.id)) s -= 3;
    s -= it.dur < 40 ? 1.5 : 0; s -= it.dur > 400 ? 0.5 : 0;
    return { it, s };
  }).sort((a, b) => b.s - a.s);
  return scored.map(x => x.it);
}
async function ambAutoAll() {
  const st = ambState(), scenes = ambScenes().filter(sc => sc.rule); if (!scenes.length) return notify('В описаниях сцен не нашлось мест, под которые есть фон. Выберите фон у сцены вручную.');
  let ok = 0; const byQ = new Map();
  try {
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i], cur = st.scenes[sc.n]; if (cur && cur.manual && cur.src) continue;
      progress(`Подбираю фон: сцена ${sc.n} — ${sc.rule.name}…`, i / scenes.length);
      try {
        let list = byQ.get(sc.rule.q); if (!list) { list = (await dbSearch(sc.rule.q, 40)).items; byQ.set(sc.rule.q, list); }
        const cands = ambPick(list, sc.rule); if (!cands.length) continue;
        st.cands[sc.n] = cands.slice(0, 8).map(it => ({ id: it.id, text: it.text, dur: it.dur }));
        const name = await dbAdd(cands[0]);
        st.scenes[sc.n] = { src: 'lib:' + name, gain: cur?.gain ?? -18, on: true, pick: 0 }; ok++;
      } catch (e) { console.warn('фон:', e); }
    }
  } finally { progress('', 0); ambSave(); renderSounds(); if (S.result) remixSoon(); }
  notify(ok ? `Фон подобран для ${ok} сцен. Послушайте ▶, «другой» — следующий вариант из базы.` : 'База не ответила — проверьте интернет.');
}
async function ambNext(n) {
  const st = ambState(), sc = ambScenes().find(x => x.n === n); if (!sc) return;
  let cands = st.cands[n];
  if (!cands || !cands.length) { const rule = sc.rule || AMB_RULES[AMB_RULES.length - 1]; cands = ambPick((await dbSearch(rule.q, 40)).items, rule).slice(0, 8).map(it => ({ id: it.id, text: it.text, dur: it.dur })); st.cands[n] = cands; }
  if (!cands.length) return;
  const cur = st.scenes[n] || { gain: -18, on: true, pick: -1 }, pick = ((cur.pick ?? -1) + 1) % cands.length;
  const name = await dbAdd(cands[pick]);
  st.scenes[n] = { ...cur, src: 'lib:' + name, on: true, pick, manual: true }; ambSave(); renderSounds(); if (S.result) remixSoon();
}
/** Звук фона сцены (48 кГц, −20 LUFS + поправка) или null. */
function ambAudio(n) { const it = ambAudioSteps(n); let r; while (!(r = it.next()).done); return r.value; }
/** Фон сцены к −20 LUFS (с поправкой), по шагам: длинная запись из базы меряется кусками, между ними — кадры. */
function* ambAudioSteps(n) {
  const cfg = ambState().scenes[n]; if (!cfg || !cfg.on || !cfg.src) return null;
  let y = null;
  if (cfg.src.startsWith('synth:')) y = C.synthSound(cfg.src.slice(6));
  else { const f = sfxState().lib.find(x => x.name === cfg.src.slice(4)); if (f) y = f.y48; }
  if (!y || y.length < C.SR) return null;
  if (!cfg._norm || cfg._norm.src !== y || cfg._norm.gain !== cfg.gain) {
    const CH = 1 << 18, m = C.loudnessMeter(y.length, 0.4, 0.1); for (let a = 0; a < y.length; a += CH) { m.push(y, a, Math.min(y.length, a + CH)); yield; }
    const L = m.result(), g = (isFinite(L) && L > -69 ? Math.pow(10, (-20 - L) / 20) : 1) * Math.pow(10, (cfg.gain || 0) / 20);
    const out = new Float32Array(y.length); for (let i = 0; i < y.length; i++) out[i] = y[i] * g; yield;
    Object.defineProperty(cfg, '_norm', { value: { src: y, gain: cfg.gain, y: out }, writable: true, configurable: true, enumerable: false });
  }
  return cfg._norm.y;
}
/** Фон на отрезок [a, b] секунд: зацикливание с перекрёстным переходом 2 с, вход и выход по 1,5 с. */
function ambFill(y, dur) { const it = ambFillSteps(y, dur); let r; while (!(r = it.next()).done); return r.value; }
function* ambFillSteps(y, dur) {
  const n = Math.round(dur * C.SR), out = new Float32Array(n), xf = Math.min(Math.round(2 * C.SR), y.length >> 2), CH = 1 << 18;
  let o = 0;
  while (o < n) {
    const len = Math.min(y.length, n - o);
    for (let c0 = 0; c0 < len; c0 += CH) {               // кусками: сцена в несколько минут — это миллионы отсчётов
      for (let i = c0, c1 = Math.min(len, c0 + CH); i < c1; i++) { let g = 1; if (o > 0 && i < xf) g = Math.sin(Math.PI / 2 * i / xf); if (o + y.length < n && i >= y.length - xf) g *= Math.cos(Math.PI / 2 * (i - (y.length - xf)) / xf); out[o + i] += y[i] * g; }
      yield;
    }
    o += y.length - xf;
  }
  const f = Math.min(n >> 1, Math.round(1.5 * C.SR)); for (let i = 0; i < f; i++) { const g = i / f; out[i] *= g; out[n - 1 - i] *= g; }
  return out;
}
/** Фон всех сцен в микс с приглушением под репликами. Возвращает клипы для таймлайна. */
function ambMix(mix, lay) { const it = ambMixSteps(mix, lay); let r; while (!(r = it.next()).done); return r.value; }
function* ambMixSteps(mix, lay) {
  const st = ambState(), clips = [], duck = st.duck || 0;
  const hop = Math.round(0.01 * C.SR), nH = Math.ceil(mix.length / hop), speech = new Uint8Array(nH);
  for (const p of lay.placed) if (p.item) { const a = Math.floor(p.at * C.SR / hop), b = Math.min(nH, Math.ceil((p.at * C.SR + p.audio.length) / hop)); speech.fill(1, Math.max(0, a), b); }
  const gdb = new Float32Array(nH); { const aA = 1 - Math.exp(-1 / 8), aR = 1 - Math.exp(-1 / 40); let v = 0; for (let k = nH - 1, look = 0; k >= 0; k--) { look = speech[k] ? 12 : Math.max(0, look - 1); if (look) speech[k] = 1; } for (let k = 0; k < nH; k++) { const t = speech[k] ? -duck : 0; v += (t - v) * (t < v ? aA : aR); gdb[k] = v; } }
  // приглушение в разах — один раз на каждые 10 мс, а не Math.pow на каждый отсчёт (50 млн — это секунды)
  const lin = new Float64Array(nH); for (let k = 0; k < nH; k++) lin[k] = Math.pow(10, gdb[k] / 20);
  yield;
  for (const sc of lay.scenes || []) {
    const y = yield* ambAudioSteps(sc.n); if (!y) continue;
    const a = sc.start, dur = sc.end - sc.start; if (dur < 1) continue;
    const bed = yield* ambFillSteps(y, dur), i0 = Math.round(a * C.SR);
    const end = Math.min(bed.length, mix.length - i0), CH = 1 << 18;
    for (let c0 = 0; c0 < end; c0 += CH) {                // в клип — уже приглушённый: он же идёт в стемы
      for (let i = c0, c1 = Math.min(end, c0 + CH); i < c1; i++) { bed[i] *= lin[((i0 + i) / hop) | 0]; mix[i0 + i] += bed[i]; }
      yield;
    }
    const cfg = st.scenes[sc.n]; clips.push({ n: sc.n, at: a, dur, name: cfg.src.replace(/^lib:BBC \S+ — |^lib:|^synth:/, ''), audio: bed });
  }
  return clips;
}
function ambHtml() {
  const st = ambState(), scenes = ambScenes(); if (!scenes.length) return '';
  const on = scenes.filter(sc => st.scenes[sc.n] && st.scenes[sc.n].on && st.scenes[sc.n].src).length;
  const rows = scenes.map(sc => {
    const cfg = st.scenes[sc.n] || {}, has = !!cfg.src, lib = has && cfg.src.startsWith('lib:') ? sfxState().lib.find(x => x.name === cfg.src.slice(4)) : null;
    const label = !has ? '<span class="muted">нет фона</span>' : cfg.src.startsWith('synth:') ? esc(C.sfxName(cfg.src.slice(6))) : lib ? esc(lib.name.replace(/^BBC \S+ — /, '')) + ` <i>${fmt(lib.dur)}</i>` : '<span class="muted">качаю…</span>';
    return `<div class="arow ${cfg.on && has ? 'on' : ''}" data-n="${esc(sc.n)}">
      <label class="mini"><input type="checkbox" data-p="on" ${cfg.on && has ? 'checked' : ''} ${has ? '' : 'disabled'} aria-label="фон сцены ${esc(sc.n)}"></label>
      <div class="stext"><b>Сцена ${esc(sc.n)}</b> <span class="muted">${esc(sc.desc.slice(0, 70))}</span>${sc.rule ? `<div class="small muted">место: ${esc(sc.rule.name)}</div>` : ''}</div>
      <div class="asrc">${label}</div>
      <label class="gain"><input type="range" data-p="gain" min="-36" max="-6" step="1" value="${cfg.gain ?? -18}" aria-label="громкость фона"><span class="gv" data-num="amb:${esc(sc.n)}">${cfg.gain ?? -18} дБ</span></label>
      <button class="play" data-act="amb-play" ${has ? '' : 'disabled'} aria-label="Слушать">▶</button>
      <button class="ghost-b tiny" data-act="amb-next">${has ? 'другой' : 'из базы'}</button>
      <button class="ghost-b tiny" data-act="amb-room" title="Тихий ровный фон помещения без событий">тишина</button>
    </div>`;
  }).join('');
  return `<div class="ambbox">
    <div class="dbline"><b>Фон сцен</b><span class="pill ${on ? 'ok' : 'none'}">${on ? 'сцен с фоном ' + on : 'выключен'}</span>
      <button class="primary" data-act="amb-auto">Подобрать фон из базы ко всем сценам</button>
      <label class="gain duck"><span>под репликами тише на <b id="duck-v" data-num="duck">${st.duck} дБ</b></span><input type="range" id="amb-duck" min="0" max="18" step="1" value="${st.duck}"></label></div>
    <p class="muted small">Место берётся из описания сцены. Фон тянется на всю сцену, стыки плавные, под речью он сам приглушается.</p>
    <div class="arows">${rows}</div></div>`;
}
function bindAmb(el) {
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const a = b.dataset.act, row = b.closest('.arow'), n = row && row.dataset.n;
    if (a === 'amb-auto') { ambAutoAll(); return; }
    if (a === 'amb-next') { b.disabled = true; b.textContent = 'качаю…'; ambNext(n).catch(err => notify('База не ответила: ' + err.message)).finally(() => renderSounds()); return; }
    if (a === 'amb-room') { const st = ambState(); st.scenes[n] = { ...(st.scenes[n] || { gain: -18 }), src: 'synth:room', on: true, manual: true }; ambSave(); renderSounds(); if (S.result) remixSoon(); return; }
    if (a === 'amb-play') { if (playing && playing.btn === b) return stop(); const y = ambAudio(n) || (() => { const st = ambState(), c = st.scenes[n]; const was = c.on; c.on = true; const r = ambAudio(n); c.on = was; return r; })(); if (y) play(y.subarray(0, Math.min(y.length, 12 * C.SR)), b); return; }
  });
  el.addEventListener('input', e => { const x = e.target; if (x.id === 'amb-duck') { $('#duck-v').textContent = x.value + ' дБ'; return; } if (x.closest('.arow') && x.dataset.p === 'gain') x.closest('.gain').querySelector('.gv').textContent = x.value + ' дБ'; });
  el.addEventListener('change', e => {
    const x = e.target, st = ambState();
    if (x.id === 'amb-duck') { st.duck = +x.value; ambSave(); if (S.result) remixSoon(); return; }
    const row = x.closest('.arow'); if (!row) return; const cfg = st.scenes[row.dataset.n] || (st.scenes[row.dataset.n] = { gain: -18 });
    if (x.dataset.p === 'on') cfg.on = x.checked; else if (x.dataset.p === 'gain') cfg.gain = +x.value;
    cfg.manual = true; ambSave(); if (x.dataset.p === 'on') renderSounds(); if (S.result) remixSoon();
  });
}
/** Для сохранения: без кэшей. */
const ambSaved = () => { const st = ambState(); return { duck: st.duck, scenes: Object.fromEntries(Object.entries(st.scenes).map(([k, v]) => [k, { src: v.src, gain: v.gain, on: v.on, pick: v.pick, manual: v.manual }])), cands: st.cands }; };
// ------------------------------------------------------------------ комнатный тон в паузах
// Между репликами одной сцены — «дыхание» той же комнаты: самые ровные тихие места записи этого актёра,
// на уровне реплики, со стыками по 40 мс. Звук не проваливается в цифровую тишину, паузы не «хлопают».
// Если запись очищена — тон берётся из очищенной версии, так что лишнего шума не прибавляется.
const ROOM = new WeakMap();
function roomSample(f) {
  if (!f || !f.y48 || !f.segs || f.segs.length < 2) return null;
  const hit = ROOM.get(f); if (hit && hit.key === f.y48) return hit.val;
  const SR = C.SR, y = f.y48, segs = f.segs, gaps = [];
  const push = (a, b) => { a += 0.12; b -= 0.08; if (b - a >= 0.25) gaps.push([a, b]); };
  push(0, segs[0].a); for (let i = 1; i < segs.length; i++) push(segs[i - 1].b, segs[i].a); push(segs[segs.length - 1].b, y.length / SR);
  // комната — это ровный шум: окна по 20 мс без провалов в цифровой ноль (шумодав, гейт) и без хвостов речи и вдохов
  const db = ([a, b]) => {
    const w = Math.round(0.02 * SR), ws = []; let s = 0, n = 0;
    for (let i = Math.round(a * SR), e = Math.min(y.length, Math.round(b * SR)); i + w <= e; i += w) { let q = 0; for (let j = i; j < i + w; j += 2) q += y[j] * y[j]; ws.push(10 * Math.log10(q / (w / 2) + 1e-20)); s += q; n += w / 2; }
    if (ws.length < 5) return null; ws.sort((p, q) => p - q);
    return ws[0] > -95 && ws[Math.floor(ws.length * 0.9)] - ws[Math.floor(ws.length * 0.1)] < 10 ? 10 * Math.log10(s / n + 1e-20) : null;
  };
  const list = gaps.map(g => ({ g, db: db(g) })).filter(x => x.db != null && x.db > -88).sort((p, q) => p.db - q.db);
  let val = null;
  if (list.length) {
    const floor = list[0].db, pick = list.filter(x => x.db < floor + 5 && x.db < -38).slice(0, 12), xf = Math.round(0.02 * SR);
    const parts = []; let len = 0;
    for (const { g: [a, b] } of pick) { if (len > 4 * SR) break; const p = y.subarray(Math.round(a * SR), Math.round(b * SR)); parts.push(p); len += p.length - xf; }
    if (len > 0.4 * SR) {
      const out = new Float32Array(len + xf); let o = 0;
      parts.forEach((p, k) => { for (let i = 0; i < p.length && o + i < out.length; i++) { const w = k && i < xf ? i / xf : 1, t = i >= p.length - xf && k < parts.length - 1 ? (p.length - i) / xf : 1; out[o + i] += p[i] * Math.min(w, t); } o += p.length - xf; });
      val = { y: out.subarray(0, Math.max(0, o + xf)), db: floor };
    }
  }
  ROOM.set(f, { key: f.y48, val }); return val;
}
/** Тон нужной длины: куски образца с перекрытием 30 мс, начало куска — псевдослучайно, но одинаково при каждом пересчёте. */
function roomFill(smp, n, seed) {
  const SR = C.SR, L = smp.length, xf = Math.round(0.03 * SR), out = new Float32Array(n); if (L < xf * 4) return null;
  let o = 0, s = (seed * 2654435761) >>> 0;
  while (o < n) {
    s = (s * 1664525 + 1013904223) >>> 0; const st = Math.floor((s / 4294967296) * (L - xf * 3)), len = Math.min(L - st, n - o + xf);
    for (let i = 0; i < len && o + i < n; i++) { const w = o && i < xf ? i / xf : 1, t = i >= len - xf ? (len - i) / xf : 1; out[o + i] += smp[st + i] * Math.min(w, t); }
    o += len - xf; if (len <= xf) break;
  }
  const f = Math.min(Math.round(0.04 * SR), n >> 1); for (let i = 0; i < f; i++) { out[i] *= i / f; out[n - 1 - i] *= i / f; }
  return out;
}
function roomToneMix(mix, lay) {
  if (S.room === false) return [];
  const SR = C.SR, out = [], voice = lay.placed.filter(p => p.item && !p.bed).sort((a, b) => a.at - b.at);
  const sceneOf = t => { const sc = (lay.scenes || []).find(s => t >= s.start - 1e-6 && t < s.end); return sc ? sc.n : null; };
  let reach = -1;
  for (let k = 1; k < voice.length; k++) {
    const A = voice[k - 1], B = voice[k], aEnd = A.at + A.audio.length / SR; reach = Math.max(reach, aEnd);
    if (sceneOf(A.at) !== sceneOf(B.at)) continue;
    const t0 = reach - 0.04, t1 = B.at + 0.04; if (t1 - t0 < 0.15) continue;
    const sa = !A.item.fxKey ? roomSample(A.item.file) : null, sb = !B.item.fxKey ? roomSample(B.item.file0) : null;
    const s = sa || sb; if (!s) continue;
    const n = Math.round((t1 - t0) * SR), y = roomFill(s.y, n, k + 1); if (!y) continue;
    const gA = (sa ? A.item : B.item).roomGain || 1, gB = sb && sb !== s ? B.item.roomGain || 1 : gA;
    const yb = sb && sa && sb !== sa ? roomFill(sb.y, n, k + 7) : null;
    for (let i = 0; i < n; i++) { const m = i / n; y[i] = yb ? y[i] * gA * (1 - m) + yb[i] * gB * m : y[i] * gA; }
    const i0 = Math.round(t0 * SR); for (let i = 0; i < n && i0 + i < mix.length; i++) mix[i0 + i] += y[i];
    out.push({ at: t0, audio: y });
  }
  return out;
}

