// Монтажка — базы звуков: Freesound (600 000+ современных записей, только CC0 и CC BY — через Openverse, без ключа)
// и архив BBC Sound Effects (33 000 записей, лицензия RemArc). Обе отдают звук прямо в браузер.
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
  curtain:   { q: 'curtain', main: 'curtain', good: /curtains|theatre|stage/, bad: /electric|shower|bath/ },
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
// Freesound ищет по названиям и меткам авторов — запросы проще, чем по рубрикам BBC
const FS_QUERY = { knock: 'knocking on door', door_open: 'door open close', door_slam: 'door slam', steps: 'footsteps wooden floor', steps_run: 'running footsteps',
  crash: 'crash debris', drip: 'dripping tap', bell: 'school bell', phone: 'old telephone ring', crowd: 'crowd chatter indoor', applause: 'applause audience',
  switch: 'light switch', curtain: 'theatre stage curtain', wind: 'wind', rain: 'rain', thunder: 'thunder', clock: 'clock ticking', whistle: 'whistle', keys: 'keys jingle',
  creak: 'wood creak', cough: 'cough' };
const FS_API = 'https://api.openverse.org/v1/audio/';
const FS_LICENCE = 'https://freesound.org/help/faq/#licenses';
const fsMedia = id => { const [n, u] = id.slice(3).split('_'); return `https://cdn.freesound.org/previews/${Math.floor(+n / 1000)}/${n}_${u}-hq.mp3`; };
const fsPage = id => `https://freesound.org/s/${id.slice(3).split('_')[0]}/`;
// для радиоспектакля нужны настоящие звуки, а не игровые и синтезированные
const FS_FAKE = /8.?bit|chiptune|arcade|retro game|video ?game|cartoon|synth|glitch|\bui\b|notification|whoosh|trailer|cinematic|robot|sci.?fi|laser|beep|bleep|remix|\bbeat\b/;
/** Где искать: Freesound (по умолчанию) или BBC. */
const DB_SRCS = { fs: 'Freesound', bbc: 'BBC' };
function dbSrc() { const v = store.get('montage:sfx-db'); return v === 'bbc' ? 'bbc' : 'fs'; }
/** Кто автор и какая лицензия у звуков Freesound — для «Авторов звуков» (CC BY требует указать автора). */
function fsMeta(id, v) { const all = store.get('montage:fs-meta') || {}; if (v) { all[id] = v; store.set('montage:fs-meta', all); } return all[id] || null; }
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
/** Поиск в выбранной базе. kind = 'amb' — фон сцены (в Freesound ищется «… ambience»). Ответы кэшируются на сеанс:
 *  у Openverse без ключа — 20 запросов в минуту и 200 в сутки с одного адреса. Freesound не ответил — ищем в BBC. */
async function dbSearch(q, size = 30, kind = '') {
  const db = dbState(), src = dbSrc(), key = src + '|' + kind + '|' + q;
  if (!db.qcache) db.qcache = new Map();
  if (db.qcache.has(key)) return db.qcache.get(key);
  let p;
  if (src === 'fs') p = fsSearch(kind === 'amb' && !/ambien|atmos|room tone/.test(q) ? q + ' ambience' : q).catch(e => { console.warn('Freesound:', e); db.fsDown = e.message; return bbcSearch(q, size); });
  else p = bbcSearch(q, size);
  db.qcache.set(key, p); p.catch(() => db.qcache.delete(key));
  return p;
}
async function fsSearch(q) {
  const u = `${FS_API}?q=${encodeURIComponent(q)}&source=freesound&license=cc0,by&page_size=20&mature=false`;
  let r = await fetch(u);
  if (r.status === 429) { await new Promise(ok => setTimeout(ok, Math.min(20, +r.headers.get('retry-after') || 8) * 1000)); r = await fetch(u); }
  if (!r.ok) throw new Error(r.status === 429 ? 'Freesound просит подождать — много запросов подряд' : 'Openverse ответил ' + r.status);
  const j = await r.json();
  const items = (j.results || []).map(x => {
    const m = /previews\/\d+\/(\d+_\d+)-hq\.mp3/.exec(x.url || ''); if (!m) return null;
    const lic = x.license === 'cc0' ? 'CC0' : 'CC BY ' + (x.license_version || '');
    return { id: 'fs:' + m[1], src: 'fs', text: String(x.title || '').replace(/\.(wav|aiff?|flac|mp3|ogg)$/i, '').replace(/[_]+/g, ' ').trim(), dur: (+x.duration || 0) / 1000,
      cat: `${lic.trim()} · ${x.creator || 'Freesound'}`, rubric: (x.tags || []).map(t => t.name).join(' ').toLowerCase(), lic: lic.trim(), author: x.creator || '' };
  }).filter(Boolean);
  return { total: j.result_count || items.length, items };
}
async function bbcSearch(q, size = 30) {
  const r = await fetch(DB_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ criteria: { from: 0, size, query: q } }) });
  if (!r.ok) throw new Error('база ответила ' + r.status);
  const j = await r.json();
  return { total: j.total || 0, items: (j.results || []).map(x => ({ id: String(x.id), src: 'bbc', text: String(x.description || '').trim(), dur: (+x.duration || 0) / 1000,
    cat: (x.additionalMetadata && x.additionalMetadata.originalCategory) || (x.categories && x.categories[0] && x.categories[0].className) || '',
    rubric: [x.categories && x.categories[0] && x.categories[0].className, x.additionalMetadata && x.additionalMetadata.originalCategory, x.additionalMetadata && x.additionalMetadata.cdName].filter(Boolean).join(' / ').toLowerCase() })) };
}
/** Имя записи из базы в библиотеке; из него же восстанавливается номер для повторной загрузки. */
const dbName = it => it.id.startsWith('fs:') ? `Freesound ${it.id.slice(3)} — ${it.text.replace(/\.$/, '')}` : `BBC ${it.id} — ${it.text.replace(/\.$/, '')}`;
const dbParse = name => { const m = /^(BBC|Freesound) (\S+) — (.*)$/.exec(name || ''); return m ? { id: (m[1] === 'Freesound' ? 'fs:' : '') + m[2], text: m[3] } : null; };
/** Имя для списков: «Скрип двери · Freesound» вместо «Freesound 219492_4056007 — Скрип двери». */
const dbNice = name => { const p = dbParse(name); return p ? `${p.text} · ${p.id.startsWith('fs:') ? 'Freesound' : 'BBC'}` : name; };
/** Скачать и раскодировать звук из базы (кэш в памяти на время сеанса). */
function dbFetch(it) {
  const db = dbState(); if (db.cache.has(it.id)) return db.cache.get(it.id);
  // длиннее трёх минут не храним: фон всё равно зацикливается с перекрёстным переходом, а 10 минут стерео из базы —
  // это 100+ МБ памяти на один звук
  const p = (async () => { const r = await fetch(it.id.startsWith('fs:') ? fsMedia(it.id) : DB_MEDIA(it.id)); if (!r.ok) throw new Error('звук ' + it.id + ' не скачался'); const y = await decodeFile(await r.blob()), max = 180 * C.SR; return y.length > max ? y.slice(0, max) : y; })();
  db.cache.set(it.id, p); p.catch(() => db.cache.delete(it.id)); return p;
}
/** Звук из базы → в библиотеку (если ещё нет); возвращает имя. */
async function dbAdd(it) {
  const st = sfxState(), name = dbName(it);
  if (!st.lib.some(x => x.name === name)) {
    const y = await dbFetch(it);
    if (!st.lib.some(x => x.name === name)) st.lib.push({ name, y48: y, dur: y.length / C.SR, db: it.id, text: it.text });
  }
  if (it.id.startsWith('fs:') && it.lic) fsMeta(it.id, { text: it.text, lic: it.lic, author: it.author || '' });
  return name;
}
/** Лучший кандидат под ремарку: главное слово обязательно, остальные слова запроса — плюс, своя рубрика — плюс,
 *  чужая (транспорт, звери) — минус; длительность: между репликами — короче лучше (длинное всё равно обрежется), фон — подольше. */
function dbScore(it, P, words, main, mode) {
  const d = it.text.toLowerCase(), all = (it.rubric || '') + ' ' + d; let s = 0;
  s += all.includes(main) ? (d.includes(main) ? 3 : 2) : -4;
  for (const w of words) if (!main.includes(w) && d.includes(w)) s += 1;
  if (P.good && P.good.test(all)) s += 2;
  if (P.bad && P.bad.test(all)) s -= 3;
  if (it.src === 'fs') { if (FS_FAKE.test(all)) s -= 4; if (it.lic === 'CC0') s += 0.3; }
  if (/^NHU/i.test(it.id) && !/nature|weather/.test(String(P.good))) s -= 3;   // записи природы — не для дверей и кашля
  if (mode === 'bed') s -= (it.dur < 15 ? 3 : 0) + Math.abs(Math.log(it.dur / 45)) * 0.6;
  else s -= it.dur <= SFX_SEQ_MAX ? Math.abs(Math.log(it.dur / 4)) * 0.8 : 1.5 + Math.min(2, Math.log(it.dur / SFX_SEQ_MAX) * 0.5);
  return s;
}
/** Кандидаты по убыванию пригодности (для поиска у ремарки — сверху то, что подойдёт). */
function dbRank(items, q, mode, key = null) {
  const P = (key && DB_PICK[key]) || {}, words = q.toLowerCase().split(/\s+/).filter(Boolean), main = P.main || words[0] || '';
  return items.filter(it => it.dur).map(it => [it, dbScore(it, P, words, main, mode)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
}
function dbPick(items, q, mode, key = null) { return dbRank(items, q, mode, key)[0] || null; }
/** Поиск из строки на вкладке. */
async function dbRun(q) {
  const db = dbState(), eq = dbQuery(q);
  if (!eq) return notify('Не понял запрос. Напишите по-английски: door, footsteps, rain — или по-русски простыми словами.');
  db.q = q; db.busy = true; db.fsDown = ''; renderSounds();
  try {
    const r = await dbSearch(eq, 40), cue = db.target && sfxState().cues[db.target];
    db.res = cue ? dbRank(r.items, eq, cue.mode, cue.key) : r.items; db.total = r.total; db.shownQ = eq;   // у ремарки — сверху подходящее
  }
  catch (e) { db.res = []; db.total = 0; notify('База звуков не отвечает: ' + e.message); }
  finally { db.busy = false; renderSounds(); }
}
/** Задачи по нескольку сразу: звуки качаются параллельно, а не по одному. */
async function dbPool(list, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; await fn(list[k], k); } })); }
/** Ко всем включённым ремаркам со встроенной заглушкой — звук из базы: сначала все поиски, потом загрузки по четыре. */
async function dbAutoAll() {
  const db = dbState(); if (db.busy || !S.P) return;
  const cues = C.soundCues(S.P.cues).filter(q => { const c = sfxCue(q.id); return c.on && (!c.src || c.src.startsWith('synth:')); });
  if (!cues.length) return notify('У всех включённых ремарок уже стоит звук из файла или базы.');
  db.busy = true; db.fsDown = ''; renderSounds();
  let ok = 0, done = 0; const byKey = new Map(), picks = [];
  try {
    for (const q of cues) {
      const cue = sfxCue(q.id), key = cue.key || q.key, query = (dbSrc() === 'fs' && FS_QUERY[key]) || DB_QUERY[key] || key;
      progress(`Ищу в базе: ${q.text.slice(0, 48)}…`, 0.3 * done++ / cues.length);
      try {
        let list = byKey.get(key + '|' + cue.mode);
        if (!list) { list = (await dbSearch(query, 40)).items; byKey.set(key + '|' + cue.mode, list); }
        const it = dbPick(list, query, cue.mode, key); if (it) picks.push([cue, it]);
      } catch (e) { console.warn('база:', e); }
    }
    done = 0;
    await dbPool(picks, 4, async ([cue, it]) => {
      try { cue.src = 'lib:' + await dbAdd(it); cue.manual = true; ok++; } catch (e) { console.warn('база:', e); }
      progress(`Качаю звуки из базы: ${++done} из ${picks.length}`, 0.3 + 0.7 * done / picks.length);
    });
  } finally {
    db.busy = false; progress('', 0); sfxSave(); renderSounds(); sfxChanged();
    notify(ok ? `Из базы подобрано ${ok} из ${cues.length}. Послушайте ▶ и поменяйте, где не подошло.` : 'База не ответила — проверьте интернет.');
  }
}
/** Звуки из базы, на которые ссылаются ремарки или проект, но которых ещё нет в библиотеке — докачать. */
async function dbRestore() {
  const st = sfxState(), db = dbState(), want = new Map();
  for (const e of S.sfxPendingDb || []) if (e && e.db) { want.set(String(e.db), { id: String(e.db), text: e.text || '' }); if (e.meta && String(e.db).startsWith('fs:')) fsMeta(String(e.db), e.meta); }
  S.sfxPendingDb = [];
  const refs = [...Object.values(st.cues), ...(typeof ambState === 'function' ? Object.values(ambState().scenes) : [])];
  for (const c of refs) if (c.src && c.src.startsWith('lib:')) { const it = dbParse(c.src.slice(4)); if (it && !st.lib.some(x => x.name === c.src.slice(4))) want.set(it.id, it); }
  const todo = [...want.values()].filter(it => !db.restoring.has(it.id));
  if (!todo.length) return;
  for (const it of todo) db.restoring.add(it.id);
  try { await Promise.all(todo.map(it => dbAdd(it).catch(e => console.warn('база:', e)))); }
  finally { for (const it of todo) db.restoring.delete(it.id); renderSounds(); if (S.result && typeof remixSoon === 'function') remixSoon(); }
}
