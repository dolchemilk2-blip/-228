// Первое знакомство и подсказки по месту. Только интерфейс: данные проекта не меняются.
// Использует общие токены, mIn/springEase и goTab; запускается после готовности приложения.
const GUIDE_KEY = 'montage:guide:v1';
const GUIDE = { ready: false, prefs: null, mode: null, step: 0, item: null, root: null, back: null,
  origin: null, inert: [], timer: 0, frame: 0, token: 0, quiet: 0, pointer: false };
const GUIDE_TOUR = [
  { tab: 'build', target: '#s1 .acc-head', icon: 'lines', title: 'Ремарки тоже работают',
    text: 'В «Как оформить сценарий» есть пример. Имена отделяют реплики, а ремарки задают паузы и помогают подобрать звуки. Начните с текста — записи можно добавить позже.',
    demo: 'СЦЕНА 1\nАнна (шёпотом):\nТы слышишь?\n\n[стук в дверь]' },
  { tab: 'plot', target: '.pl-tools', icon: 'branch', title: 'У истории может быть несколько путей',
    text: '«+» справа у карточки продолжает историю, значок ветки снизу создаёт другой вариант. Потяните «+» к другой карточке, чтобы соединить события. «Из сценария» перенесёт сцены на доску.' },
  { tab: 'tl', mode: 'files', target: '#tlp-mode', icon: 'tracks', title: 'Можно монтировать без сценария',
    text: '«Свои файлы» — отдельный редактор любых записей. Перетащите аудио на дорожки: клипы можно двигать, подрезать и склеивать. В режиме «Спектакль» появится результат сборки по сценарию.' },
  { tab: 'sfx', target: '#sfx .step', icon: 'music', title: 'Звуки, атмосфера и музыка — отдельно',
    text: 'После добавления сценария здесь появятся разделы звуков ремарок, фона сцен, музыки и своих файлов. Поиск можно открыть прямо под ремаркой. Переключатели «В сведении» отключают слой, сохраняя его настройки.' },
  { target: '#guide-b', icon: 'check', title: 'Остальное — по ходу работы',
    text: 'Короткие подсказки появятся рядом с новыми возможностями, когда они станут доступны. Кнопка с вопросом всегда здесь: повторить знакомство, вернуть подсказки или отключить их.' },
];
const GUIDE_TIPS = [
  { id: 'plot-links', tab: 'plot', target: '.pl-card .pl-next', icon: 'branch', title: 'Потяните «+», чтобы связать события',
    text: 'Щелчок добавляет следующее событие. Перетащите «+» к другой карточке — получится связь; в пустое место — новая карточка. Значок ветки снизу создаёт альтернативный путь.' },
  { id: 'review-filters', tab: 'build', target: '#rv-sum', when: () => !!(S.matches.size || S.uploads.size), icon: 'check', title: 'Эти счётчики можно нажать',
    text: '«Проверить» и «Нет записи» откроют только нужные реплики. Внутри можно выбрать другой кусок, подложить свой файл или дозаписать голос с микрофона.' },
  { id: 'editor-menu', tab: 'tl', target: '#ed-cv', when: () => S.tlMode === 'files' && ED.clips.length > 0, icon: 'cut', title: 'У клипа есть скрытые настройки',
    text: () => matchMedia('(pointer: coarse)').matches
      ? 'Тяните края клипа, чтобы подрезать запись, а верхние уголки — для плавного входа и выхода. С мышью правый щелчок открывает эффекты и громкость; с клавиатурой — Shift+F10.'
      : 'Правый щелчок по клипу — эффекты, громкость и плавный вход/выход. Края подрезают запись, верхние уголки меняют плавность. Клавиша S разрезает на курсоре; Ctrl+Z отменяет правку.' },
  { id: 'sounds-search', tab: 'sfx', target: '.srow .sfind-b', icon: 'search', title: 'Ищите звук прямо у ремарки',
    text: '«Найти» открывает поиск под этой строкой. «Между» задерживает следующую реплику, пока звучит эффект; «Фоном» оставляет его под голосами.' },
  { id: 'mix-layers', tab: 'sfx', target: '#sfx-body [data-mixuse]', when: () => !!document.querySelector('#sfx-body [data-mu]'), icon: 'music', title: 'Сравните сведение без целого слоя',
    text: 'Выключите звуки, фон сцен или музыку одной кнопкой. Их настройки сохранятся, а готовое сведение пересчитается само. Включите обратно, когда захотите.' },
  { id: 'sounds-sections', tab: 'sfx', target: '#sfx-tabs', icon: 'music', title: 'Фон и музыка — в соседних разделах',
    text: 'Фон сцен задаёт атмосферу места. Музыка — заставку, отбивки, финал и подложки. В «Свои файлы и базы» можно загрузить записи или найти звук в базе.' },
  { id: 'cleanup-compare', tab: 'clean', target: '#cl-body .ab-top', icon: 'wave', title: 'Сначала послушайте разницу',
    text: '«Было» и «Стало» переключаются на одном отрывке. Подберите обработку, затем примените ко всему файлу. После применения появится кнопка «В таймлайн».' },
  { id: 'mix-stage', tab: 'build', target: '#mix-space #sp-mode', icon: 'stage', title: 'Голоса можно расставить в пространстве',
    text: 'В стерео и бинауральном режиме появляется план сцены. Расставляйте персонажей по сторонам и глубине, а для реплик задавайте движение.' },
  { id: 'mix-reading', tab: 'build', target: '#mix-top [data-act="read"]', icon: 'lines', title: 'Сценарий может идти за звуком',
    text: '«Читка» показывает реплики вслед за воспроизведением. У готового спектакля также доступны субтитры, видео с волной и отдельные дорожки персонажей.' },
];
function guideSave() { store.set(GUIDE_KEY, GUIDE.prefs); }
function guideTarget(item) {
  const el = item && document.querySelector(item.target);
  return el && !el.closest('[hidden]') && el.getClientRects().length ? el : null;
}
function guideViewport() {
  const v = window.visualViewport;
  return { x: v ? v.offsetLeft : 0, y: v ? v.offsetTop : 0, w: v ? v.width : innerWidth, h: v ? v.height : innerHeight };
}
function guideInView(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect(), v = guideViewport(), deck = document.querySelector('.deck');
  const top = deck && !deck.contains(el) ? Math.max(v.y, deck.getBoundingClientRect().bottom) : v.y;
  return r.bottom > top + 24 && r.top < v.y + v.h - 40 && r.right > v.x && r.left < v.x + v.w;
}
function guideBlocked() {
  return S.busy || GUIDE.pointer || document.hidden || (typeof ED !== 'undefined' && ED.play) || (typeof deckPlaying === 'function' && deckPlaying()) ||
    [...document.querySelectorAll('.sheetbox:not([hidden]), .theme-pop:not([hidden]), .g-pop, .g-lock, [role="menu"]:not([hidden]), [aria-modal="true"]')]
      .some(el => !el.closest('#guide, [data-guide-ghost]') && !el.closest('[hidden]') && el.getClientRects().length);
}
function guideEditing() {
  const a = document.activeElement;
  return a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}
function guideSchedule(delay = 850) {
  if (!GUIDE.ready || GUIDE.timer) return;
  GUIDE.timer = setTimeout(() => { GUIDE.timer = 0; guideCheck(); }, delay);
}
function guideCheck() {
  if (GUIDE.mode) {
    if (GUIDE.mode === 'tip') {
      if (guideBlocked() || !guideInView(guideTarget(GUIDE.item))) guideClose(false, false);
      else guidePlace();
    }
    return;
  }
  if (guideBlocked() || guideEditing() || !MOTION.ready) { guideSchedule(1400); return; }
  if (!GUIDE.prefs.welcomed) { guideOpen(false); return; }
  if (!GUIDE.prefs.enabled || Date.now() < GUIDE.quiet) return;
  const tip = GUIDE_TIPS.find(t => t.tab === S.tab && !GUIDE.prefs.seen[t.id] && (!t.when || t.when()) && guideInView(guideTarget(t)));
  if (tip) guideShow('tip', tip, false);
}
function guideLock() {
  if (GUIDE.inert.length) return;
  for (const el of document.body.children) {
    if (el === GUIDE.root || el.tagName === 'SCRIPT') continue;
    GUIDE.inert.push([el, el.inert]); el.inert = true;
  }
}
function guideUnlock() { for (const [el, value] of GUIDE.inert) el.inert = value; GUIDE.inert = []; }
function guideOpen(fromKey) {
  if (GUIDE.mode) guideClose(true, fromKey);
  GUIDE.back = document.activeElement;
  GUIDE.origin = null;
  const returning = GUIDE.prefs.welcomed;
  GUIDE.prefs.welcomed = true; guideSave();
  guideShow('welcome', { icon: 'tracks', title: returning ? 'Что ещё умеет Монтажка' : 'Освоимся в монтажной',
    text: 'Здесь можно собрать спектакль по сценарию или смонтировать свои записи вручную. Покажем за минуту возможности, которые легко не заметить.' }, fromKey);
}
function guideShow(mode, item, fromKey) {
  const root = GUIDE.root, card = root.querySelector('.guide-card'), oldMode = GUIDE.mode;
  GUIDE.mode = mode; GUIDE.item = item; GUIDE.token++;
  root.dataset.mode = mode; root.hidden = false;
  const modal = mode !== 'tip';
  if (modal) guideLock(); else guideUnlock();
  const text = typeof item.text === 'function' ? item.text() : item.text;
  card.setAttribute('aria-modal', String(modal));
  card.innerHTML = `<div class="guide-top"><span class="guide-label">${ic(item.icon)}${mode === 'tour' ? `Знакомство · ${GUIDE.step + 1} из ${GUIDE_TOUR.length}` : mode === 'tip' ? 'Полезная возможность' : 'Монтажка · короткое знакомство'}</span><button class="icon-b" type="button" data-guide="close" aria-label="Закрыть подсказку">${ic('close')}</button></div>
    <h2 id="guide-title">${esc(item.title)}</h2><p id="guide-text">${esc(text)}</p>
    ${item.demo ? `<div class="guide-demo">${esc(item.demo)}</div>` : ''}
    ${mode === 'tour' ? `<div class="guide-progress" aria-hidden="true">${GUIDE_TOUR.map((_, i) => `<i class="${i <= GUIDE.step ? 'on' : ''}"></i>`).join('')}</div>` : ''}
    <div class="guide-actions">${mode === 'welcome' ? `<button class="ghost-b" type="button" data-guide="close">Сразу к работе</button><button class="primary" type="button" data-guide="start">Показать${ic('right')}</button>` : mode === 'tour' ? `<button class="ghost-b" type="button" data-guide="${GUIDE.step ? 'back' : 'close'}">${GUIDE.step ? 'Назад' : 'Пропустить'}</button><button class="primary" type="button" data-guide="next">${GUIDE.step === GUIDE_TOUR.length - 1 ? 'К работе' : 'Дальше'}${ic('right')}</button>` : `<button class="ghost-b tiny" type="button" data-guide="off">Не подсказывать</button><button class="primary" type="button" data-guide="close">Понятно${ic('check')}</button>`}</div>
    ${mode === 'welcome' ? `<label class="guide-pref"><input type="checkbox" data-guide-pref ${GUIDE.prefs.enabled ? 'checked' : ''}>Подсказывать новые возможности по ходу работы</label><button class="ghost-b tiny guide-replay" type="button" data-guide="reset">Повторить подсказки разделов</button><p class="guide-foot">Можно пропустить. Обзор всегда доступен по кнопке с вопросом вверху.</p>` : ''}`;
  document.getElementById('guide-b').setAttribute('aria-expanded', String(modal));
  guidePlace();
  // На телефоне цель остаётся над карточкой, а не за ней. Автоподсказки страницу не прокручивают.
  if (mode === 'tour' && guideViewport().w <= 560) {
    const target = guideTarget(item), deck = document.querySelector('.deck');
    if (target && !(deck && deck.contains(target))) {
      const v = guideViewport(), top = Math.max(v.y, deck ? deck.getBoundingClientRect().bottom : v.y) + 14;
      scrollTo({ top: Math.max(0, scrollY + target.getBoundingClientRect().top - top), behavior: 'instant' });
      guidePlace();
    }
  }
  document.getElementById('guide-live').textContent = mode === 'tip' ? `${item.title}. ${text}` : '';
  card.getAnimations?.().forEach(a => a.cancel());
  if (!fromKey && mOK()) mIn(card, { opacity: 0, transform: 'translateY(8px) scale(0.97)' }, [0.86, 0.32]);
  if (modal) card.querySelector(`[data-guide="${mode === 'welcome' ? 'start' : 'next'}"]`).focus({ preventScroll: true });
  else if (oldMode) guideUnlock();
}
function guideStep(index, fromKey) {
  if (index >= GUIDE_TOUR.length) { guideClose(true, fromKey); return; }
  GUIDE.step = Math.max(0, index);
  const item = GUIDE_TOUR[GUIDE.step];
  GUIDE.mode = 'tour';
  const token = ++GUIDE.token;
  const show = () => {
    if (token !== GUIDE.token || GUIDE.mode !== 'tour') return;
    if (item.tab) goTab(item.tab, { mode: item.mode, top: true });
    // Новая вкладка и её пружины должны успеть получить геометрию.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token !== GUIDE.token || GUIDE.mode !== 'tour') return;
      const target = guideTarget(item);
      if (target && !guideInView(target)) target.scrollIntoView({ block: 'center', behavior: 'instant' });
      guideShow('tour', item, fromKey);
    }));
  };
  if (!fromKey && item.tab && item.tab !== S.tab && typeof motionTabSwitch === 'function') motionTabSwitch(item.tab, show);
  else show();
}
function guidePlace() {
  if (!GUIDE.mode) return;
  const card = GUIDE.root.querySelector('.guide-card'), ring = GUIDE.root.querySelector('.guide-ring');
  const target = GUIDE.mode === 'welcome' ? null : guideTarget(GUIDE.item), v = guideViewport(), gap = 12;
  const r = target && target.getBoundingClientRect(), w = Math.min(366, v.w - gap * 2);
  const deck = document.querySelector('.deck'), safeTop = Math.max(v.y, deck ? deck.getBoundingClientRect().bottom : v.y);
  const reserve = GUIDE.mode === 'tour' && r && v.w <= 560 ? Math.max(0, safeTop - v.y) + Math.min(100, r.height) + 28 : 0;
  card.style.width = w + 'px'; card.style.maxHeight = Math.max(150, v.h - gap * 2 - reserve) + 'px';
  const h = card.offsetHeight;
  let x = v.x + (v.w - w) / 2, y = v.y + (v.h - h) / 2, origin = 'center';
  ring.hidden = !r || !guideInView(target);
  if (r && !ring.hidden) {
    const left = Math.max(v.x + 4, r.left - 5), top = Math.max(v.y + 4, r.top - 5);
    const right = Math.min(v.x + v.w - 4, r.right + 5), bottom = Math.min(v.y + v.h - 4, r.bottom + 5);
    Object.assign(ring.style, { left: left + 'px', top: top + 'px', width: Math.max(0, right - left) + 'px', height: Math.max(0, bottom - top) + 'px' });
    x = Math.max(v.x + gap, Math.min(r.left, v.x + v.w - w - gap));
    if (v.w <= 560) {
      y = v.y + v.h - h - gap - 8; origin = 'center bottom';
      if (GUIDE.mode === 'tip' && bottom > y && top - gap - h >= safeTop + gap) { y = top - gap - h; origin = 'center top'; }
    }
    else if (bottom + gap + h <= v.y + v.h - gap) { y = bottom + gap; origin = 'left top'; }
    else if (top - gap - h >= v.y + gap) { y = top - gap - h; origin = 'left bottom'; }
    else if (left - gap - w >= v.x + gap) { x = left - gap - w; origin = 'right center'; }
    else if (right + gap + w <= v.x + v.w - gap) { x = right + gap; origin = 'left center'; }
    else { y = v.y + v.h - h - gap; origin = 'center bottom'; }
  }
  Object.assign(card.style, { left: Math.round(x) + 'px', top: Math.round(Math.max(v.y + gap, y)) + 'px' });
  card.style.setProperty('--guide-origin', origin);
  // При исчезновении цели обзор остаётся читаемым на обычном затемнении.
  GUIDE.root.querySelector('.guide-shade').style.background = GUIDE.mode === 'tour' && ring.hidden ? 'rgb(10 8 6 / 42%)' : '';
}
function guideClose(ack = true, fromKey = false) {
  if (!GUIDE.mode) return;
  const modal = GUIDE.mode !== 'tip', card = GUIDE.root.querySelector('.guide-card'), active = document.activeElement;
  const refocus = modal || card.contains(active);
  if (ack && GUIDE.mode === 'tip') { GUIDE.prefs.seen[GUIDE.item.id] = true; guideSave(); }
  GUIDE.mode = null; GUIDE.item = null; GUIDE.token++; GUIDE.quiet = Date.now() + 20000;
  if (!fromKey && mOK()) {
    const ghost = card.cloneNode(true); ghost.removeAttribute('id'); ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    ghost.dataset.guideGhost = ''; ghost.inert = true; ghost.setAttribute('aria-hidden', 'true'); ghost.style.pointerEvents = 'none'; ghost.style.zIndex = '71'; document.body.append(ghost);
    const a = ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(4px) scale(0.99)' }], { duration: 150, easing: EASE });
    a.onfinish = a.oncancel = () => ghost.remove();
  }
  GUIDE.root.hidden = true; document.getElementById('guide-live').textContent = ''; guideUnlock();
  document.getElementById('guide-b').setAttribute('aria-expanded', 'false');
  if (GUIDE.origin) {
    const o = GUIDE.origin; GUIDE.origin = null;
    goTab(o.tab, { mode: o.mode }); S.tlMode = o.mode;
    const token = GUIDE.token;
    requestAnimationFrame(() => { if (token === GUIDE.token) scrollTo({ top: o.scroll, behavior: 'instant' }); });
  }
  if (refocus) {
    const back = GUIDE.back;
    (back && back.isConnected && !back.closest('[hidden]') && back !== document.body ? back : document.getElementById('guide-b')).focus({ preventScroll: true });
  }
  GUIDE.back = null;
}
function guideInit() {
  if (GUIDE.ready) return;
  const saved = store.get(GUIDE_KEY);
  GUIDE.prefs = { welcomed: !!saved?.welcomed, enabled: saved?.enabled !== false, seen: saved?.seen && typeof saved.seen === 'object' && !Array.isArray(saved.seen) ? saved.seen : {} };
  const root = GUIDE.root = document.createElement('div'); root.id = 'guide'; root.hidden = true;
  root.innerHTML = '<div class="guide-shade"></div><div class="guide-ring" aria-hidden="true" hidden></div><section class="guide-card" id="guide-card" role="dialog" aria-labelledby="guide-title" aria-describedby="guide-text"></section>';
  document.body.append(root); GUIDE.ready = true;
  const live = document.createElement('div'); live.id = 'guide-live'; live.className = 'guide-live'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true'); document.body.append(live);
  document.addEventListener('click', e => {
    if (e.target.closest('#guide-b, [data-guide-open]')) { guideOpen(e.detail === 0); return; }
    const b = e.target.closest('[data-guide]'); if (!b || !root.contains(b)) return;
    const a = b.dataset.guide, k = e.detail === 0;
    if (a === 'close') guideClose(true, k);
    if (a === 'off') { GUIDE.prefs.enabled = false; guideSave(); guideClose(true, k); }
    if (a === 'start') { GUIDE.origin = { tab: S.tab, mode: S.tlMode, scroll: scrollY }; guideStep(0, k); }
    if (a === 'next') guideStep(GUIDE.step + 1, k);
    if (a === 'back') guideStep(GUIDE.step - 1, k);
    if (a === 'reset') { GUIDE.prefs.seen = {}; GUIDE.prefs.enabled = true; guideSave(); root.querySelector('[data-guide-pref]').checked = true; b.textContent = 'Подсказки снова включены'; }
  });
  root.addEventListener('change', e => { if (e.target.matches('[data-guide-pref]')) { GUIDE.prefs.enabled = e.target.checked; guideSave(); } });
  document.addEventListener('keydown', e => {
    if (!GUIDE.mode) return;
    const card = root.querySelector('.guide-card'), inside = card.contains(e.target), modal = GUIDE.mode !== 'tip';
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); guideClose(true, true); return; }
    if (!modal && !inside) return;
    e.stopImmediatePropagation(); // Пробел/Delete/Ctrl+Z не попадают в редактор под подсказкой.
    if (e.key === 'Tab') {
      const controls = [...card.querySelectorAll('button:not([disabled]), input:not([disabled])')], first = controls[0], last = controls.at(-1);
      if (modal && (!inside || (!e.shiftKey && e.target === last) || (e.shiftKey && e.target === first))) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    }
  }, true);
  document.addEventListener('pointerdown', e => {
    GUIDE.pointer = !root.contains(e.target);
    if (GUIDE.mode === 'tip' && !root.contains(e.target)) guideClose(true, true);
  }, true);
  const release = () => { GUIDE.pointer = false; guideSchedule(); };
  document.addEventListener('pointerup', release, true); document.addEventListener('pointercancel', release, true);
  document.addEventListener('focusout', () => guideSchedule());
  const place = () => {
    if (!GUIDE.frame && GUIDE.mode) GUIDE.frame = requestAnimationFrame(() => { GUIDE.frame = 0; if (GUIDE.mode === 'tip') guideCheck(); else guidePlace(); });
    guideSchedule();
  };
  addEventListener('resize', place); addEventListener('scroll', place, true);
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', place); window.visualViewport.addEventListener('scroll', place); }
  // Наблюдаем только приложение: сами подсказки и их уходящие копии не создают цикл.
  const main = document.getElementById('main');
  if (main) new MutationObserver(() => guideSchedule()).observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', () => guideSchedule());
  guideSchedule(1100);
}
