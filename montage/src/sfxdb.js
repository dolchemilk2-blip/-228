// Монтажка — база звуков: архив BBC Sound Effects (33 000 записей, отдаёт звук прямо в браузер).
// Поиск, прослушивание, загрузка в библиотеку вкладки «Звуки» и автоподбор к ремаркам сценария.
// Использует S, $, esc, notify, play, stop, decodeFile, fmt, progress из app.js; sfxState, sfxCue,
// sfxSave, renderSounds из sounds.js; C — ядро.

const DB_API = 'https://sound-effects-api.bbcrewind.co.uk/api/sfx/search';
const DB_MEDIA = id => `https://sound-effects-media.bbcrewind.co.uk/mp3/${id}.mp3`;
const DB_LICENCE = 'https://sound-effects.bbcrewind.co.uk/licensing';
/** Для каждого встроенного звука: что искать в базе, главное слово (без него запись не подходит),
 *  что в рубрике или описании — плюс, что — минус (транспорт, звери, чужие рубрики). */
const DB_PICK = {
  knock:     { q: 'knock on door', main: 'knock', good: /door|knock|creaks|household/, bad: /transport|aircraft|destruction|axe|animal|factory|dog/ },
  door_open: { q: 'door open interior', main: 'door', good: /doors|household|house/, bad: /transport|car|van|train|taxi|animal|nature|comedy|footsteps|aircraft|oven|fridge|cupboard|prison|cell/ },
  door_slam: { q: 'door slam', main: 'door', good: /doors|household|house|creaks|slam/, bad: /transport|train|car|taxi|nature|animal|station/ },
  steps:     { q: 'footsteps wooden floor', main: 'wooden floor', good: /footsteps|entering|walking/, bad: /nature|crowds|animal|comedy|station|shop|market|running|pigeon/ },
  steps_run: { q: 'running wooden floor', main: 'running', good: /footsteps|floor/, bad: /nature|animal|engine|motor|water|tap|crowd/ },
  crash:     { q: 'crash', main: 'crash', good: /crash|destruction|creaks|glass|wood/, bad: /transport|car|road|aircraft|sport|cymbal|sea|waves/ },
  drip:      { q: 'dripping tap', main: 'drip', good: /household|water|tap/, bad: /power|office|transport|comedy|cave|rain|dancer/ },
  bell:      { q: 'school bell', main: 'bell', good: /bells|school/, bad: /playground|crowds|atmosphere|children at play|church|chatter|enter/ },
  phone:     { q: 'telephone ringing', main: 'telephone', good: /telephones|telephone/, bad: /american|field|modem|mobile|engaged|dial/ },
  crowd:     { q: 'crowd chatter', main: 'crowd', good: /crowds|interior/, bad: /nigeria|czech|dutch|italian|yugoslav|french|german|spanish|greek|exterior|market|station|horror|gasp|panic|scream|riot|boo/ },
  applause:  { q: 'applause', main: 'applause', good: /applause/, bad: /sport|cricket|try/ },
  switch:    { q: 'light switch', main: 'switch', good: /household|light switch/, bad: /transport|van|car|papermaking|factory|engine|railway/ },
  curtain:   { q: 'curtain', main: 'curtain', good: /curtains|theatre/, bad: /electric/ },
  wind:      { q: 'wind', main: 'wind', good: /nature|weather/, bad: /harbour|ship|rigging|boat|birds|grackle|towhee|volcano|leaves/ },
  rain:      { q: 'rain', main: 'rain', good: /weather|nature|heavy rain/, bad: /rainforest|jungle|tropical|squirrel|crickets|thunder|shower|woodland|song|bird|frog|insect/ },
  thunder:   { q: 'thunder', main: 'thunder', good: /nature|weather/, bad: /rainforest|savanna|birds|insects|wren|rain falling/ },
  clock:     { q: 'clock ticking', main: 'clock', good: /clocks/, bad: /alarm|cuckoo|car|chime|strik|grandfather|bracket/ },
  whistle:   { q: 'whistle', main: 'whistle', good: /sport|whistles/, bad: /nature|transport|comedy|swannee|police|crowd|grunt/ },
  keys:      { q: 'keys jingle', main: 'keys', good: /doors|house|cell/, bad: /horses|animals|transport|car|volkswag|golf|prison/ },
  creak:     { q: 'creak', main: 'creak', good: /creaks|wooden/, bad: /door|gate|ship|rope/ },
  cough:     { q: 'coughing', main: 'cough', good: /medical|comedy|coughing/, bad: /animal|cat|nature|snor|sneez|scream|groan|crowd|monks|baby/ },
};
const DB_QUERY = Object.fromEntries(Object.entries(DB_PICK).map(([k, v]) => [k, v.q]));
/** Русские слова → английские для строки поиска (по основе слова). */
const RU_EN = {
  дверь: 'door', открыва: 'open', закрыва: 'close', хлопа: 'slam', стук: 'knock', стучит: 'knock', шаги: 'footsteps', шаг: 'footsteps',
  бег: 'running', бежит: 'running', бегут: 'running', грохот: 'crash', пада: 'fall', удар: 'hit', звонок: 'bell', звонит: 'ringing',
  телефон: 'telephone', толпа: 'crowd', зал: 'hall', гул: 'murmur', аплодисмент: 'applause', выключател: 'switch', свет: 'light',
  занавес: 'curtain', ветер: 'wind', дождь: 'rain', гром: 'thunder', гроза: 'thunderstorm', часы: 'clock', тика: 'ticking', свист: 'whistle',
  ключи: 'keys', скрип: 'creak', кашел: 'cough', кашля: 'cough', смех: 'laugh', смеё: 'laugh', плач: 'crying', крик: 'scream', кричит: 'scream',
  машина: 'car', автомобил: 'car', поезд: 'train', самол: 'aeroplane', вода: 'water', кран: 'tap', река: 'river', море: 'sea', волн: 'waves',
  огонь: 'fire', огня: 'fire', кост: 'fire', птиц: 'birds', собак: 'dog', лает: 'barking', кошк: 'cat', кот: 'cat', лошад: 'horse',
  улиц: 'street', город: 'city', лес: 'forest', ночь: 'night', школ: 'school', класс: 'classroom', урок: 'lesson', мел: 'chalk',
  доск: 'blackboard', стул: 'chair', стол: 'table', окно: 'window', окна: 'window', стекл: 'glass', разбива: 'breaking', бумаг: 'paper',
  книг: 'book', музык: 'music', пианино: 'piano', выстрел: 'gunshot', взрыв: 'explosion', сирен: 'siren', лифт: 'lift', лестниц: 'stairs',
  коридор: 'corridor', голоса: 'voices', шёпот: 'whisper', шепот: 'whisper', дыхани: 'breathing', сердц: 'heartbeat', радио: 'radio',
  телевизор: 'television', компьютер: 'computer', клавиатур: 'keyboard', печата: 'typing', микрофон: 'microphone', мегафон: 'megaphone',
  пробк: 'traffic', дорог: 'traffic', мотор: 'engine', двигател: 'engine', велосипед: 'bicycle', колокол: 'bell', церк: 'church',
  вокзал: 'station', метро: 'underground', автобус: 'bus', трамва: 'tram', вертолёт: 'helicopter', вертолет: 'helicopter',
  кухн: 'kitchen', посуд: 'dishes', чайник: 'kettle', вилк: 'fork', ложк: 'spoon', стакан: 'glass', бутылк: 'bottle', ящик: 'drawer',
  шкаф: 'cupboard', ворота: 'gate', замок: 'lock', ключ: 'key', цепь: 'chain', металл: 'metal', дерев: 'wood', камень: 'stone',
  снег: 'snow', лёд: 'ice', лед: 'ice', гравий: 'gravel', трава: 'grass', листь: 'leaves', насеком: 'insects', комар: 'mosquito',
  пчел: 'bees', ворон: 'crow', сова: 'owl', петух: 'cockerel', курица: 'chicken', корова: 'cow', овца: 'sheep', свинья: 'pig',
  ребён: 'baby', ребен: 'baby', дети: 'children', мужчин: 'man', женщин: 'woman', шум: 'noise', тишин: 'quiet', эхо: 'echo',
  фон: 'atmosphere', атмосфер: 'atmosphere', театр: 'theatre', сцен: 'stage', зрител: 'audience', концерт: 'concert',
  барабан: 'drum', гитар: 'guitar', скрипк: 'violin', труба: 'trumpet', флейт: 'flute', орган: 'organ', оркестр: 'orchestra',
};
function dbState() {
  const st = sfxState();
  if (!st.db) st.db = { q: '', shownQ: '', res: [], total: 0, busy: false, target: null, cache: new Map(), restoring: new Set() };
  return st.db;
}
/** Русский запрос → английский по словарю основ; английские слова — как есть. */
function dbQuery(q) {
  const out = [];
  for (const w of String(q).trim().split(/\s+/)) {
    const k = w.toLowerCase().replace(/[^a-zа-яё]/g, '');
    if (!k) continue;
    if (!/[а-яё]/.test(k)) { out.push(k); continue; }
    const kk = k.replace(/ё/g, 'е');
    let hit = RU_EN[k] || RU_EN[kk];
    if (!hit) { const base = Object.keys(RU_EN).filter(r => kk.startsWith(r.replace(/ё/g, 'е'))).sort((a, b) => b.length - a.length)[0]; if (base) hit = RU_EN[base]; }
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out.join(' ');
}
async function dbSearch(q, size = 30) {
  const r = await fetch(DB_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ criteria: { from: 0, size, query: q } }) });
  if (!r.ok) throw new Error('база ответила ' + r.status);
  const j = await r.json();
  return { total: j.total || 0, items: (j.results || []).map(x => ({ id: String(x.id), text: String(x.description || '').trim(), dur: (+x.duration || 0) / 1000,
    cat: (x.additionalMetadata && x.additionalMetadata.originalCategory) || (x.categories && x.categories[0] && x.categories[0].className) || '',
    rubric: [x.categories && x.categories[0] && x.categories[0].className, x.additionalMetadata && x.additionalMetadata.originalCategory, x.additionalMetadata && x.additionalMetadata.cdName].filter(Boolean).join(' / ').toLowerCase() })) };
}
/** Имя записи из базы в библиотеке; из него же восстанавливается номер для повторной загрузки. */
const dbName = it => `BBC ${it.id} — ${it.text.replace(/\.$/, '')}`;
const dbParse = name => { const m = /^BBC (\S+) — (.*)$/.exec(name || ''); return m ? { id: m[1], text: m[2] } : null; };
/** Скачать и раскодировать звук из базы (кэш в памяти на время сеанса). */
function dbFetch(it) {
  const db = dbState(); if (db.cache.has(it.id)) return db.cache.get(it.id);
  const p = (async () => { const r = await fetch(DB_MEDIA(it.id)); if (!r.ok) throw new Error('звук ' + it.id + ' не скачался'); return decodeFile(await r.blob()); })();
  db.cache.set(it.id, p); p.catch(() => db.cache.delete(it.id)); return p;
}
/** Звук из базы → в библиотеку (если ещё нет); возвращает имя. */
async function dbAdd(it) {
  const st = sfxState(), name = dbName(it);
  if (!st.lib.some(x => x.name === name)) {
    const y = await dbFetch(it);
    if (!st.lib.some(x => x.name === name)) st.lib.push({ name, y48: y, dur: y.length / C.SR, db: it.id, text: it.text });
  }
  return name;
}
/** Лучший кандидат под ремарку: главное слово обязательно, остальные слова запроса — плюс, своя рубрика — плюс,
 *  чужая (транспорт, звери) — минус; длительность: между репликами — короче лучше (длинное всё равно обрежется), фон — подольше. */
function dbPick(items, q, mode, key = null) {
  const P = (key && DB_PICK[key]) || {}, words = q.toLowerCase().split(/\s+/).filter(Boolean), main = P.main || words[0] || '';
  let best = null, bs = -1e9;
  for (const it of items) {
    if (!it.dur) continue;
    const d = it.text.toLowerCase(), all = (it.rubric || '') + ' ' + d; let s = 0;
    s += d.includes(main) ? 3 : -4;
    for (const w of words) if (!main.includes(w) && d.includes(w)) s += 1;
    if (P.good && P.good.test(all)) s += 2;
    if (P.bad && P.bad.test(all)) s -= 3;
    if (/^NHU/i.test(it.id) && !/nature|weather/.test(String(P.good))) s -= 3;   // записи природы — не для дверей и кашля
    if (mode === 'bed') s -= (it.dur < 15 ? 3 : 0) + Math.abs(Math.log(it.dur / 45)) * 0.6;
    else s -= it.dur <= SFX_SEQ_MAX ? Math.abs(Math.log(it.dur / 4)) * 0.8 : 1.5 + Math.min(2, Math.log(it.dur / SFX_SEQ_MAX) * 0.5);
    if (s > bs) { bs = s; best = it; }
  }
  return best;
}
/** Поиск из строки на вкладке. */
async function dbRun(q) {
  const db = dbState(), eq = dbQuery(q);
  if (!eq) return notify('Не понял запрос. Напишите по-английски: door, footsteps, rain — или по-русски простыми словами.');
  db.q = q; db.busy = true; renderSounds();
  try { const r = await dbSearch(eq, 40); db.res = r.items; db.total = r.total; db.shownQ = eq; }
  catch (e) { db.res = []; db.total = 0; notify('База звуков не отвечает: ' + e.message); }
  finally { db.busy = false; renderSounds(); }
}
/** Ко всем включённым ремаркам со встроенной заглушкой — звук из базы. */
async function dbAutoAll() {
  const db = dbState(); if (db.busy || !S.P) return;
  const cues = C.soundCues(S.P.cues).filter(q => { const c = sfxCue(q.id); return c.on && (!c.src || c.src.startsWith('synth:')); });
  if (!cues.length) return notify('У всех включённых ремарок уже стоит звук из файла или базы.');
  db.busy = true; renderSounds();
  let done = 0, ok = 0; const byKey = new Map();
  try {
    for (const q of cues) {
      const cue = sfxCue(q.id), key = cue.key || q.key, query = DB_QUERY[key] || key;
      progress(`Подбираю из базы: ${q.text.slice(0, 48)}…`, done / cues.length);
      try {
        let list = byKey.get(key + '|' + cue.mode);
        if (!list) { list = (await dbSearch(query, 40)).items; byKey.set(key + '|' + cue.mode, list); }
        const it = dbPick(list, query, cue.mode, key);
        if (it) { cue.src = 'lib:' + await dbAdd(it); cue.manual = true; ok++; }
      } catch (e) { console.warn('база:', e); }
      done++;
    }
  } finally {
    db.busy = false; progress('', 0); sfxSave(); S.result = null; renderSounds(); renderMix();
    notify(ok ? `Из базы подобрано ${ok} из ${cues.length}. Послушайте ▶ и поменяйте, где не подошло.` : 'База не ответила — проверьте интернет.');
  }
}
/** Звуки из базы, на которые ссылаются ремарки или проект, но которых ещё нет в библиотеке — докачать. */
async function dbRestore() {
  const st = sfxState(), db = dbState(), want = new Map();
  for (const e of S.sfxPendingDb || []) if (e && e.db) want.set(String(e.db), { id: String(e.db), text: e.text || '' });
  S.sfxPendingDb = [];
  for (const c of Object.values(st.cues)) if (c.src && c.src.startsWith('lib:')) { const it = dbParse(c.src.slice(4)); if (it && !st.lib.some(x => x.name === c.src.slice(4))) want.set(it.id, it); }
  const todo = [...want.values()].filter(it => !db.restoring.has(it.id));
  if (!todo.length) return;
  for (const it of todo) db.restoring.add(it.id);
  try { await Promise.all(todo.map(it => dbAdd(it).catch(e => console.warn('база:', e)))); }
  finally { for (const it of todo) db.restoring.delete(it.id); S.result = null; renderSounds(); if (typeof renderMix === 'function') renderMix(); }
}
