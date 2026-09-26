/* ============================================================
   Слой синхронизации.

   Если в config.js заполнен блок firebase — работает настоящая
   общая база (оба видите одно и то же в реальном времени).
   Если не заполнен — включается локальный режим: всё работает,
   но данные живут только в этом браузере. Так сайт никогда
   не выглядит «сломанным», даже до настройки.
   ============================================================ */

const CFG = window.SITE_CONFIG || {};
const ROOM = (CFG.roomId || 'default-room').replace(/[.#$\[\]\/]/g, '-');
const FB = CFG.firebase || {};
const CONFIGURED = Boolean(FB.apiKey && FB.databaseURL && FB.projectId);

/* ---------------- вспомогательное ---------------- */

const splitPath = (p) => String(p).split('/').filter(Boolean);

function getIn(obj, path) {
  return splitPath(path).reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

function setIn(obj, path, value) {
  const parts = splitPath(path);
  const last = parts.pop();
  let node = obj;
  for (const k of parts) {
    if (typeof node[k] !== 'object' || node[k] === null) node[k] = {};
    node = node[k];
  }
  if (value === null) delete node[last];
  else node[last] = value;
}

/* ============================================================
   Драйвер 1: локальный (localStorage + синхронизация вкладок)
   ============================================================ */

function localDriver() {
  const KEY = 'oursite:db:' + ROOM;
  const listeners = [];
  let db = {};

  try { db = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { db = {}; }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
    if (channel) { try { channel.postMessage(db); } catch (e) {} }
  }

  function notify() {
    listeners.forEach((l) => l.fire(getIn(db, l.path)));
  }

  let channel = null;
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(KEY);
    channel.onmessage = (e) => { db = e.data || {}; notify(); };
  }
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    try { db = JSON.parse(e.newValue || '{}'); } catch (err) { db = {}; }
    notify();
  });

  function register(path, kind, cb) {
    const seen = new Set();
    const l = {
      path,
      fire(value) {
        const data = value || {};
        if (kind === 'value') { cb(data); return; }
        Object.keys(data).forEach((k) => {
          if (seen.has(k)) return;
          seen.add(k);
          cb(k, data[k]);
        });
      }
    };
    listeners.push(l);
    setTimeout(() => l.fire(getIn(db, path)), 0);
    return () => {
      const i = listeners.indexOf(l);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  let counter = 0;
  const newId = () => 'l' + Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 6);

  return {
    mode: 'local',
    watch: (path, cb) => register(path, 'value', cb),
    watchLast: (path, n, cb) => register(path, 'value', (data) => {
      const keys = Object.keys(data).sort((x, y) => ((data[x] || {}).at || 0) - ((data[y] || {}).at || 0));
      const out = {};
      keys.slice(-n).forEach((k) => { out[k] = data[k]; });
      cb(out);
    }),
    watchAdded: (path, cb) => register(path, 'added', cb),
    async push(path, value) {
      const id = newId();
      setIn(db, path + '/' + id, { ...value, at: Date.now() });
      persist(); notify();
      return id;
    },
    async set(path, value) { setIn(db, path, value); persist(); notify(); },
    async update(path, value) {
      const cur = getIn(db, path) || {};
      setIn(db, path, { ...cur, ...value });
      persist(); notify();
    },
    async remove(path) { setIn(db, path, null); persist(); notify(); },
    async presence(who) {
      setIn(db, 'presence/' + who, { online: true, at: Date.now() });
      persist(); notify();
      window.addEventListener('beforeunload', () => {
        setIn(db, 'presence/' + who, { online: false, at: Date.now() });
        persist();
      });
    },
    stamp: () => Date.now()
  };
}

/* ============================================================
   Драйвер 2: Firebase Realtime Database
   ============================================================ */

async function firebaseDriver() {
  const V = 'https://www.gstatic.com/firebasejs/10.12.5';
  const [{ initializeApp }, auth, rtdb] = await Promise.all([
    import(`${V}/firebase-app.js`),
    import(`${V}/firebase-auth.js`),
    import(`${V}/firebase-database.js`)
  ]);

  const app = initializeApp(FB);
  const a = auth.getAuth(app);
  await auth.signInAnonymously(a);

  const dbi = rtdb.getDatabase(app);
  const base = 'rooms/' + ROOM + '/';
  const at = (path) => rtdb.ref(dbi, base + path);

  return {
    mode: 'cloud',
    watch(path, cb) {
      return rtdb.onValue(at(path), (snap) => cb(snap.val() || {}));
    },
    watchLast(path, n, cb) {
      const q = rtdb.query(at(path), rtdb.limitToLast(n));
      return rtdb.onValue(q, (snap) => cb(snap.val() || {}));
    },
    watchAdded(path, cb) {
      return rtdb.onChildAdded(at(path), (snap) => cb(snap.key, snap.val()));
    },
    async push(path, value) {
      const r = await rtdb.push(at(path), { ...value, at: rtdb.serverTimestamp() });
      return r.key;
    },
    set: (path, value) => rtdb.set(at(path), value),
    update: (path, value) => rtdb.update(at(path), value),
    remove: (path) => rtdb.remove(at(path)),
    async presence(who) {
      const meRef = at('presence/' + who);
      const conn = rtdb.ref(dbi, '.info/connected');
      rtdb.onValue(conn, (snap) => {
        if (snap.val() !== true) return;
        rtdb.onDisconnect(meRef).set({ online: false, at: rtdb.serverTimestamp() });
        rtdb.set(meRef, { online: true, at: rtdb.serverTimestamp() });
      });
    },
    stamp: () => rtdb.serverTimestamp()
  };
}

/* ============================================================
   Публичный объект
   ============================================================ */

let driver = null;
let error = null;

const readyPromise = (async () => {
  if (!CONFIGURED) {
    driver = localDriver();
    return driver;
  }
  try {
    driver = await firebaseDriver();
  } catch (e) {
    console.warn('Firebase недоступен, включаю локальный режим:', e);
    error = e;
    driver = localDriver();
  }
  return driver;
})();

export const cloud = {
  /** 'cloud' — общая база на двоих; 'local' — только этот браузер */
  get mode() { return driver ? driver.mode : 'connecting'; },
  get configured() { return CONFIGURED; },
  get error() { return error; },
  get room() { return ROOM; },

  ready: () => readyPromise,

  async watch(path, cb) { const d = await readyPromise; return d.watch(path, cb); },
  async watchLast(path, n, cb) { const d = await readyPromise; return d.watchLast(path, n, cb); },
  async watchAdded(path, cb) { const d = await readyPromise; return d.watchAdded(path, cb); },
  async push(path, value) { const d = await readyPromise; return d.push(path, value); },
  async set(path, value) { const d = await readyPromise; return d.set(path, value); },
  async update(path, value) { const d = await readyPromise; return d.update(path, value); },
  async remove(path) { const d = await readyPromise; return d.remove(path); },
  async presence(who) { const d = await readyPromise; return d.presence(who); }
};

/* Маленький индикатор режима — если на странице есть #cloud-badge */
export async function renderCloudBadge() {
  const el = document.getElementById('cloud-badge');
  if (!el) return;
  el.className = 'badge';
  el.innerHTML = '<span class="pulse"></span> подключаюсь…';
  await readyPromise;
  if (driver.mode === 'cloud') {
    el.className = 'badge live';
    el.innerHTML = '<span class="pulse"></span> общая комната';
    el.title = 'Вы оба видите одно и то же в реальном времени';
  } else {
    el.className = 'badge off';
    el.innerHTML = '<span class="pulse"></span> только этот телефон';
    el.title = CONFIGURED
      ? 'Не удалось подключиться к Firebase — данные сохраняются только в этом браузере'
      : 'Firebase ещё не настроен (см. SETUP.md) — данные сохраняются только в этом браузере';
  }
}

/* ============================================================
   Непрочитанные: цифра на вкладке «Чат»
   ============================================================ */

const LS_READ = 'oursite:chatRead';

export function markChatRead(ts) {
  try {
    const prev = +localStorage.getItem(LS_READ) || 0;
    const next = Math.max(prev, ts || Date.now());
    if (next !== prev) localStorage.setItem(LS_READ, String(next));
  } catch (e) {}
}

export async function trackUnread(onCount) {
  const me = (window.App && App.getMe()) || 'a';
  await readyPromise;
  driver.watchLast('messages', 60, (data) => {
    let read = 0;
    try { read = +localStorage.getItem(LS_READ) || 0; } catch (e) {}
    // впервые на этом телефоне — старое непрочитанным не считаем
    if (!read) { markChatRead(Date.now()); read = Date.now(); }
    const n = Object.values(data || {}).filter((m) => m && m.by && m.by !== me && (m.at || 0) > read).length;
    document.querySelectorAll('a[href="chat.html"]').forEach((a) => {
      let b = a.querySelector('.tab-badge');
      if (!n) { if (b) b.remove(); return; }
      if (!b) { b = document.createElement('b'); b.className = 'tab-badge'; a.appendChild(b); }
      b.textContent = n > 9 ? '9+' : String(n);
      b.setAttribute('aria-label', n + ' новых');
    });
    if (onCount) onCount(n);
  });
}

/* ============================================================
   Поездка: когда прилетаю. Меняется прямо на главной и живёт
   в общей комнате — у второго дата обновляется сразу же.
   Пока в комнате ничего нет, берём дату из config.js.
   ============================================================ */

// Смещение пояса в миллисекундах в данный момент
function tzOffsetMs(tz, ts) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(ts)).reduce((acc, x) => { acc[x.type] = x.value; return acc; }, {});
  const h = p.hour === '24' ? 0 : +p.hour;
  return Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}

// «2027-06-01T12:00» по часам города → момент времени.
// Время посадки считаем по месту прилёта: у обоих отсчёт совпадёт.
export function zonedToTs(wall, tz) {
  const [d, t = '00:00'] = String(wall).split('T');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, m] = t.split(':').map(Number);
  const guess = Date.UTC(Y, M - 1, D, h || 0, m || 0);
  try {
    let ts = guess - tzOffsetMs(tz, guess);
    ts = guess - tzOffsetMs(tz, ts);
    return ts;
  } catch (e) {
    return new Date(wall).getTime();
  }
}

export function normalizeTrip(raw) {
  const traveler = raw && (raw.traveler === 'a' || raw.traveler === 'b') ? raw.traveler
    : (CFG.traveler === 'b' ? 'b' : 'a');
  const dest = traveler === 'a' ? 'b' : 'a';
  const people = CFG.people || {};
  const tz = (people[dest] && people[dest].timeZone) || 'UTC';
  const wall = (raw && raw.wall) || CFG.meetingDate || '';
  const at = wall ? zonedToTs(wall, tz) : NaN;
  return {
    wall, at, tz, traveler, dest,
    flight: (raw && raw.flight) || '',
    by: raw && raw.by, updatedAt: raw && raw.updatedAt,
    fromCloud: Boolean(raw && raw.wall)
  };
}

export async function watchTrip(cb) {
  cb(normalizeTrip(null));
  await readyPromise;
  driver.watch('trip', (data) => cb(normalizeTrip(data && data.wall ? data : null)));
}
