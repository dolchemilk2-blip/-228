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
  async watchAdded(path, cb) { const d = await readyPromise; return d.watchAdded(path, cb); },
  async push(path, value) { const d = await readyPromise; return d.push(path, value); },
  async set(path, value) { const d = await readyPromise; return d.set(path, value); },
  async update(path, value) { const d = await readyPromise; return d.update(path, value); },
  async remove(path) { const d = await readyPromise; return d.remove(path); },
  async presence(who) { const d = await readyPromise; return d.presence(who); }
};

/* Маленький индикатор режима в шапке — если на странице есть #cloud-badge */
export async function renderCloudBadge() {
  const el = document.getElementById('cloud-badge');
  if (!el) return;
  el.className = 'badge';
  el.innerHTML = '<span class="pulse dim"></span> подключаюсь…';
  await readyPromise;
  if (driver.mode === 'cloud') {
    el.className = 'badge live';
    el.innerHTML = '<span class="pulse"></span> общая комната';
    el.title = 'Вы оба видите одно и то же в реальном времени';
  } else {
    el.className = 'badge off';
    el.innerHTML = '<span class="pulse dim"></span> локальный режим';
    el.title = CONFIGURED
      ? 'Не удалось подключиться к Firebase — данные сохраняются только в этом браузере'
      : 'Firebase ещё не настроен (см. SETUP.md) — данные сохраняются только в этом браузере';
  }
}
