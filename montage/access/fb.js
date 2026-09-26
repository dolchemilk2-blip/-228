// Доступ к Монтажке: вход через Google (Firebase Authentication) и база (Realtime Database).
// База — через REST: без постоянного соединения, поэтому лимит одновременных подключений
// бесплатного тарифа не мешает, и не нужно тянуть SDK базы. Кто что может читать и писать,
// решают правила базы (access/database.rules.json), а не этот код.
import CFG from './config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
// эмуляторы Firebase — только для проверки на своём компьютере: http://localhost:…/?emu
// (флаг держится до закрытия вкладки: Монтажка сама убирает ?… из адреса при смене вкладок)
export const EMU = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && (() => {
  try { if (new URLSearchParams(location.search).has('emu')) sessionStorage.setItem('montage-access:emu', '1'); return sessionStorage.getItem('montage-access:emu') === '1'; }
  catch { return new URLSearchParams(location.search).has('emu'); }
})();
const FB = EMU
  ? { apiKey: 'demo-key', authDomain: 'demo-montage.firebaseapp.com', projectId: 'demo-montage', databaseURL: 'http://127.0.0.1:9000/?ns=demo-montage-default-rtdb' }
  : CFG.firebase || {};
export const configured = !!(FB.apiKey && FB.databaseURL && FB.projectId);
export const TS = { '.sv': 'timestamp' };

let A = null;
async function fa() {
  if (A) return A;
  const [app, m] = await Promise.all([import(SDK + '/firebase-app.js'), import(SDK + '/firebase-auth.js')]);
  const a = m.getAuth(app.initializeApp(FB));
  if (EMU) m.connectAuthEmulator(a, 'http://127.0.0.1:9099', { disableWarnings: true });
  return (A = { a, m });
}
export async function currentUser() { const { a } = await fa(); await a.authStateReady(); return a.currentUser; }
export async function signIn() {
  const { a, m } = await fa(), p = new m.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return (await m.signInWithPopup(a, p)).user;
}
export async function signOut() { const { a, m } = await fa(); await m.signOut(a); }
// только для проверки на эмуляторе: вход без окна Google
export async function emuSignIn(email) {
  if (!EMU) throw new Error('emu only');
  const { a, m } = await fa();
  return (await m.signInWithCredential(a, m.GoogleAuthProvider.credential(JSON.stringify({ sub: 'g-' + email, email, email_verified: true, name: email.split('@')[0] })))).user;
}

const DB = (() => { try { const u = new URL(FB.databaseURL); return { base: u.origin + u.pathname.replace(/\/$/, ''), ns: u.searchParams.get('ns') }; } catch { return null; } })();
const fail = (code, msg) => Object.assign(new Error(msg || code), { code });

// Запрос к базе от имени вошедшего. Ошибки: code 'denied' — правила не пускают, 'net' — нет связи.
// onProgress(байт получено) — для долгих загрузок.
export async function db(path, { method = 'GET', body, user, onProgress } = {}) {
  const u = new URL(DB.base + '/' + path + '.json');
  if (DB.ns) u.searchParams.set('ns', DB.ns);
  const who = user || await currentUser();
  if (!who) throw fail('denied', 'not signed in');
  u.searchParams.set('auth', await who.getIdToken());
  let r;
  try { r = await fetch(u, { method, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }); }
  catch (e) { throw fail('net', String(e && e.message || e)); }
  if (r.status === 401 || r.status === 403) throw fail('denied');
  if (!r.ok) throw fail('net', 'HTTP ' + r.status);
  if (!onProgress || !r.body) return r.json();
  const rd = r.body.getReader(), parts = [];
  let got = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onProgress(got); }
  const all = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return JSON.parse(new TextDecoder().decode(all));
}

// Коды активации: 16 знаков без похожих (0/O, 1/I) — 80 бит случайности, подобрать нельзя.
export const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const okCode = k => k.length === 16 && [...k].every(c => CODE_ABC.includes(c));
export const fmtCode = k => k.match(/.{1,4}/g).join('-');
export function newCode() { return [...crypto.getRandomValues(new Uint8Array(16))].map(x => CODE_ABC[x & 31]).join(''); }

export async function sha256(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Понятные сообщения для ошибок входа
export function authError(e) {
  const c = e && e.code || '';
  if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return '';
  if (c === 'auth/popup-blocked') return 'Браузер не открыл окно входа. Разрешите всплывающие окна для этого сайта и нажмите ещё раз.';
  if (c === 'auth/network-request-failed' || c === 'net') return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  if (c === 'auth/unauthorized-domain') return 'Этот адрес сайта не разрешён для входа. Владельцу: Firebase → Authentication → Settings → Authorized domains.';
  if (c === 'auth/operation-not-allowed') return 'Вход через Google не включён. Владельцу: Firebase → Authentication → Sign-in method → Google.';
  return 'Не получилось войти' + (c ? ` (${c})` : '') + '. Попробуйте ещё раз.';
}
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
