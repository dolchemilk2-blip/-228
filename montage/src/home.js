// Монтажка — главная (что умеет и куда идти), переходы между вкладками, вкладка «Таймлайн» (спектакль и свои
// файлы) и связь со страницей входа: пробный период решает, можно ли скачивать файлы.
// Использует S, $, esc, ic, store, render, stop, notify, TAB_HASH, renderMixTl, drawTimeline, segInd, MOTION из
// app.js и motion.js; ED, edLoad, edRender, edAddAudio, edPush, edChanged, edName из editor.js.

// ------------------------------------------------------------------ переходы
/** Открыть вкладку (и в ней — шаг или режим). С главной и из подсказок — с прокруткой к нужному месту. */
function goTab(tab, o = {}) {
  if (!TAB_HASH[tab]) return;
  if (o.mode) S.tlMode = o.mode;
  const same = S.tab === tab;
  if (!same && typeof edLeave === 'function') edLeave();      // таймлайн на весь экран не остаётся висеть над другой вкладкой
  S.tab = tab; if (!same) stop();
  try { history.replaceState(null, '', TAB_HASH[tab]); } catch {}
  store.set('montage:tab', tab);
  render({ tab: true });
  if (same && tab === 'tl') renderTl();
  if (o.at) requestAnimationFrame(() => { const el = document.getElementById(o.at); if (el && !el.hidden && el.getClientRects().length) el.scrollIntoView({ behavior: MOTION && !MOTION.reduce ? 'smooth' : 'auto', block: 'start' }); });
  else if (o.top && scrollY > 0) scrollTo({ top: 0, behavior: 'auto' });
}
function goFrom(el) {
  const o = { at: el.dataset.at, mode: el.dataset.mode, top: true }, tab = el.dataset.go;
  if (tab !== S.tab && typeof motionTabSwitch === 'function') motionTabSwitch(tab, () => goTab(tab, o)); else goTab(tab, o);
}
document.addEventListener('click', e => { const g = e.target.closest && e.target.closest('[data-go]'); if (!g || g.disabled) return; e.preventDefault(); goFrom(g); });
/** Сообщение внизу с кнопкой: «Спектакль сведён — Открыть таймлайн». */
function notifyAct(text, label, fn) {
  notify(text); const el = $('#msg'); if (!el) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'msg-act'; b.textContent = label;
  b.addEventListener('click', () => { notify(''); fn(); }); el.append(' ', b);
}

// ------------------------------------------------------------------ главная
const HOME_CARDS = [
  { go: 'build', at: 's1', icon: 'lines', t: 'Сборка по сценарию', d: 'Вставьте сценарий и киньте записи актёров — каждая реплика найдётся сама, громкость выровняется, паузы встанут по ремаркам.', cta: 'Собрать спектакль' },
  { go: 'tl', icon: 'tracks', t: 'Таймлайн', d: 'Паузы, громкость и эффект каждой реплики — на дорожках персонажей. Или свои записи без сценария: подрезать, разрезать, склеить.', cta: 'Открыть таймлайн' },
  { go: 'build', at: 'review', icon: 'check', t: 'Проверка и оговорки', d: 'Что нашлось, что нет и где актёр оговорился — по словам, рядом со сценарием. Дубли — на выбор.', cta: 'К проверке' },
  { go: 'build', at: 'review', icon: 'mic', t: 'Дозапись с микрофона', d: 'Недостающие реплики — прямо здесь, с суфлёром: записать, обрезать, почистить и вставить на место.', cta: 'Дописать реплики' },
  { go: 'clean', icon: 'wave', t: 'Чистка звука', d: 'Гул, шум, эхо комнаты, щелчки, свист, эквалайзер. Слушать «было — стало» и видеть спектр.', cta: 'Почистить запись' },
  { go: 'sfx', icon: 'search', t: 'Звуки и фон', d: 'Двери, шаги, стук — из ремарок; база звуков BBC или свои файлы. Фон сцен и комнатный тон в паузах.', cta: 'Подобрать звуки' },
  { go: 'build', at: 'mix', icon: 'on', t: 'Эффекты голоса', d: 'Телефон, мегафон, за дверью, «голос в голове» — всему персонажу или одной реплике. Пометки в сценарии срабатывают сами.', cta: 'К сведению' },
  { go: 'build', at: 'mix', icon: 'play', t: 'Читка, субтитры, видео', d: 'Сценарий идёт за плеером. Субтитры SRT и VTT, главы для YouTube и видео с волной — из готового спектакля.', cta: 'К сведению' },
];
function homeState() {
  const parts = [];
  if (S.P) parts.push(`сценарий: ${S.P.cues.filter(c => c.type === 'line').length} реплик`);
  if (S.files.length) parts.push(`записей: ${S.files.length}`);
  if (S.matches && S.matches.size) parts.push(`разобрано реплик: ${S.matches.size}`);
  if (S.result && S.result.out) parts.push('спектакль сведён');
  return parts;
}
function renderHome() {
  const el = $('#home'); if (!el) return;
  const st = homeState(), edN = typeof ED !== 'undefined' ? ED.clips.length : 0, first = !el.firstElementChild;
  const cont = st.length || edN ? `<section class="card home-cont"><div><b>Продолжить</b><span class="muted small">${[...st, edN ? `на таймлайне своих записей: ${edN}` : ''].filter(Boolean).map(esc).join(' · ')}</span></div>
      <div class="home-cont-b">${st.length ? `<button class="primary" data-go="build" data-at="${S.result ? 'mix' : S.matches && S.matches.size ? 'review' : 's1'}">${ic('right')}К сборке</button>` : ''}${edN ? `<button class="ghost-b" data-go="tl" data-mode="files">${ic('tracks')}Свои записи</button>` : ''}${S.result ? `<button class="ghost-b" data-go="tl" data-mode="show">${ic('tracks')}Таймлайн спектакля</button>` : ''}</div></section>` : '';
  setHtml(el, `
    <section class="card home-hero">
      <div class="home-hero-t">
        <p class="home-kicker">аппаратная радиоспектакля — в браузере</p>
        <h2 class="home-h">Сценарий и записи актёров — на входе. Готовый спектакль — на выходе.</h2>
        <p class="home-lead">Монтажка сама находит реплики в записях, выравнивает громкость, расставляет паузы по ремаркам и сводит дорожку. Всё считается на вашем компьютере: записи никуда не уходят.</p>
        <div class="home-cta"><button class="primary" data-go="build" data-at="s1">${ic('lines')}Собрать спектакль</button><button class="ghost-b" data-go="tl" data-mode="files">${ic('tracks')}Смонтировать свои записи</button></div>
      </div>
      <div class="home-art" aria-hidden="true">
        <div class="ha-ruler"></div>
        <div class="ha-lane"><i class="c1" style="left:4%;width:22%"></i><i class="c1" style="left:52%;width:16%"></i></div>
        <div class="ha-lane"><i class="c2" style="left:28%;width:20%"></i><i class="c2" style="left:72%;width:20%"></i></div>
        <div class="ha-lane"><i class="c3" style="left:12%;width:12%"></i><i class="c3" style="left:44%;width:9%"></i><i class="c3" style="left:80%;width:14%"></i></div>
        <div class="ha-lane ha-amb"><i style="left:0;width:100%"></i></div>
        <span class="ha-head"></span>
      </div>
    </section>
    ${cont}
    <div class="home-grid">${HOME_CARDS.map(c => `<button class="card hcard" type="button" data-go="${c.go}"${c.at ? ` data-at="${c.at}"` : ''}${c.go === 'tl' && !S.result ? ' data-mode="files"' : c.go === 'tl' ? ' data-mode="show"' : ''}>
      <span class="hcard-ic">${ic(c.icon)}</span><b class="hcard-t">${c.t}</b><span class="hcard-d">${c.d}</span><span class="hcard-go">${c.cta}${ic('right')}</span></button>`).join('')}</div>
    <section class="card home-how">
      <h3>Как собирается спектакль</h3>
      <ol>${[['s1', 'Сценарий', 'текст с репликами и ремарками'], ['s2', 'Записи', 'файлы актёров, можно все сразу'], ['s3', 'Разбор', 'реплики находятся в записях'], ['review', 'Проверка', 'оговорки, дубли, дозапись'], ['mix', 'Сведение', 'громкость, паузы, звуки, таймлайн']].map(([at, t, d], i) => `<li><button type="button" data-go="build" data-at="${at}"><b>${i + 1}</b><span><strong>${t}</strong><small>${d}</small></span></button></li>`).join('')}</ol>
    </section>`);
  if (first && typeof staggerList === 'function') staggerList([el.querySelector('.home-hero'), el.querySelector('.home-cont'), ...el.querySelectorAll('.hcard')].filter(Boolean).slice(0, 10), 35);
}

// ------------------------------------------------------------------ вкладка «Таймлайн»
function renderTl() {
  const has = !!(S.result && S.result.out); if (!S.tlMode) S.tlMode = has ? 'show' : 'files';
  const mode = $('#tlp-mode'); if (!mode) return;
  mode.querySelectorAll('button').forEach(b => { const on = b.dataset.m === S.tlMode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  if (typeof segInd === 'function') segInd(mode, 'tlp-mode');
  $('#tlp-show').hidden = S.tlMode !== 'show'; $('#tlp-files').hidden = S.tlMode !== 'files';
  $('#tlp-sub').textContent = S.tlMode === 'show' ? 'реплики, паузы и звуки спектакля по дорожкам персонажей' : 'любые записи: двигать, подрезать, резать, склеивать';
  store.set('montage:tl-seen', 1); const tb = $('.tabs [data-tab="tl"]'); if (tb) tb.classList.remove('new');
  if (S.tlMode === 'show') {
    setHtml($('#tlp-show-empty'), has ? '' : `<div class="tlp-empty"><span class="ed-drop-ic">${ic('tracks')}</span><b>Таймлайн спектакля появится после сведения</b><span class="muted">Вставьте сценарий и записи во вкладке «Сборка», разберите и сведите — здесь встанут все реплики по дорожкам персонажей: паузы, громкость, эффекты.</span>
      <div class="home-cta"><button class="primary" data-go="build" data-at="${S.matches && S.matches.size ? 'mix' : 's1'}">${ic('lines')}К сборке</button><button class="ghost-b" data-mode-go="files">${ic('tracks')}Свои записи без сценария</button></div></div>`);
    renderMixTl();
    requestAnimationFrame(() => { if (typeof drawTimeline === 'function') drawTimeline(); if (typeof drawOverview === 'function' && S.result && S.result.out) drawOverview(); });
  } else {
    if (typeof edLoad === 'function') edLoad();
    if (typeof edRender === 'function') edRender();
    if (typeof bindEditor === 'function') bindEditor();
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#tlp-mode button, [data-mode-go]'); if (!b) return;
  if (typeof edLeave === 'function') edLeave();
  S.tlMode = b.dataset.m || b.dataset.modeGo; if (S.tlMode === 'files' && typeof edStop === 'function') { /* свои записи молчат, пока не нажмут «играть» */ }
  if (typeof tpPause === 'function') tpPause(); if (typeof edStop === 'function') edStop();
  renderTl();
});
/** Запись из другой вкладки (например, очищенная) — на таймлайн своих записей, отдельной дорожкой. */
async function toTimeline(name, y) {
  if (typeof edLoad === 'function') await edLoad();
  edPush('добавить запись'); const c = await edAddAudio(name, y, 0, null); ED.sel = new Set([c.id]); edChanged();
  notifyAct(`«${edName(name)}» — на таймлайне своих записей`, 'Открыть', () => goTab('tl', { mode: 'files', top: true }));
}

// ------------------------------------------------------------------ пробный период (страница входа, window.montageAccess)
// На пробном периоде всё работает и слушается, но файлы скачиваются только по приглашениям. Без страницы
// входа (своя проверка, файл с диска) ограничений нет.
function exportLocked() { const A = window.montageAccess; return !!(A && typeof A.locked === 'function' && A.locked()); }
async function exportBegin(what) { const A = window.montageAccess; return A && typeof A.exportBegin === 'function' ? A.exportBegin(what) : { commit: async () => true }; }
addEventListener('montage-access', () => render());
