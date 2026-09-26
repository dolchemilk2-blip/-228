/* ============================================================
   Общие механики сайта: кто за экраном, шторки, уведомления,
   вкладки, время. Подключается на каждой странице ДО остальных.

   Часть работы (цвет, вкладки) делается сразу при загрузке файла,
   а не в init(): так страница с первого кадра выглядит правильно.
   ============================================================ */

window.App = (function () {
  'use strict';

  var CFG = window.SITE_CONFIG || {};
  var LS_ME = 'oursite:me';
  var root = document.documentElement;
  var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------- кто сейчас за экраном ---------------- */

  function getMe() {
    var v = null;
    try { v = localStorage.getItem(LS_ME); } catch (e) { /* приватный режим */ }
    return (v === 'a' || v === 'b') ? v : null;
  }

  function applyMe() {
    root.setAttribute('data-me', getMe() || 'a');
  }

  function setMe(key) {
    try { localStorage.setItem(LS_ME, key); } catch (e) {}
    applyMe();
    document.dispatchEvent(new CustomEvent('me-changed', { detail: key }));
  }

  function person(key) {
    return (CFG.people && CFG.people[key]) || { name: '—', emoji: '💜', city: '', timeZone: 'UTC' };
  }

  function me() { return person(getMe() || 'a'); }
  function partnerKey() { return getMe() === 'b' ? 'a' : 'b'; }
  function partner() { return person(partnerKey()); }

  /* ---------------- мелкие строительные блоки ---------------- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function icon(name, cls) {
    return '<svg class="i' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' +
           '<use href="assets/icons.svg#' + name + '"/></svg>';
  }

  function initial(key) {
    return (person(key).name || '?').charAt(0).toUpperCase();
  }

  function avatar(key, cls) {
    return '<span class="ava' + (cls ? ' ' + cls : '') + '" data-p="' + key + '" aria-hidden="true">' +
           escapeHtml(initial(key)) + '<i class="online-dot"></i></span>';
  }

  /* ---------------- уведомления ---------------- */

  function toastBox() {
    var box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    return box;
  }

  /* toast('Текст') или toast('Текст', { action: 'Вернуть', onAction: fn, ms: 5000 }) */
  function toast(text, opts) {
    if (typeof opts === 'number') opts = { ms: opts };
    opts = opts || {};

    var box = toastBox();
    // больше трёх сразу не держим — старые уходят
    var live = box.querySelectorAll('.toast:not(.out)');
    if (live.length >= 3) dismiss(live[0]);

    var t = document.createElement('div');
    t.className = 'toast' + (opts.action ? '' : ' no-action');
    var span = document.createElement('span');
    span.className = 't-text';
    span.textContent = text;
    t.appendChild(span);

    var timer = null;
    function dismiss(el) {
      el = el || t;
      if (el.classList.contains('out')) return;
      el.classList.add('out');
      el.classList.remove('in');
      setTimeout(function () { el.remove(); }, 240);
    }

    if (opts.action) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 't-action';
      b.textContent = opts.action;
      b.addEventListener('click', function () {
        clearTimeout(timer);
        dismiss();
        if (opts.onAction) opts.onAction();
      });
      t.appendChild(b);
    }

    box.appendChild(t);
    // кадр на то, чтобы браузер увидел стартовое состояние
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { t.classList.add('in'); });
    });
    timer = setTimeout(dismiss, opts.ms || (opts.action ? 5200 : 2800));
    return { close: function () { clearTimeout(timer); dismiss(); } };
  }

  /* Удалили — и сразу можно вернуть. Вместо окна «Вы уверены?» */
  function undoToast(text, onUndo) {
    return toast(text, { action: 'Вернуть', onAction: onUndo, ms: 5500 });
  }

  /* ---------------- шторки ----------------
     На телефоне — снизу, тянется пальцем вниз, чтобы закрыть.
     На компьютере — окно по центру. */

  var vv = window.visualViewport;
  var openSheets = 0;

  function trackViewport() {
    var h = vv ? vv.height : window.innerHeight;
    var top = vv ? vv.offsetTop : 0;
    root.style.setProperty('--vv-h', Math.round(h) + 'px');
    root.style.setProperty('--vv-top', Math.round(top) + 'px');
  }
  if (vv) {
    vv.addEventListener('resize', function () { if (openSheets) trackViewport(); });
    vv.addEventListener('scroll', function () { if (openSheets) trackViewport(); });
  }

  function sheet(opts) {
    opts = opts || {};
    var prevFocus = document.activeElement;

    var layer = document.createElement('div');
    layer.className = 'sheet-layer';
    layer.innerHTML =
      '<div class="sheet-scrim"></div>' +
      '<div class="sheet" role="dialog" aria-modal="true" tabindex="-1">' +
        '<div class="sheet-grab" aria-hidden="true"></div>' +
        (opts.title !== undefined
          ? '<div class="sheet-head"><h2></h2>' +
              '<button class="icon-btn" type="button" data-close aria-label="Закрыть">' + icon('x') + '</button>' +
            '</div>'
          : '') +
        '<div class="sheet-body"></div>' +
        (opts.foot ? '<div class="sheet-foot"></div>' : '') +
      '</div>';

    var el = layer.querySelector('.sheet');
    var body = layer.querySelector('.sheet-body');
    if (opts.title !== undefined) {
      layer.querySelector('h2').textContent = opts.title;
      el.setAttribute('aria-label', opts.title);
    }
    if (opts.className) el.classList.add(opts.className);
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    if (opts.foot) {
      var foot = layer.querySelector('.sheet-foot');
      if (typeof opts.foot === 'string') foot.innerHTML = opts.foot;
      else foot.appendChild(opts.foot);
    }

    // всё, что под шторкой, на время недоступно ни пальцу, ни клавиатуре
    var inerted = [].slice.call(document.body.children).filter(function (n) {
      return n !== layer && n.id !== 'toasts' && !n.inert && n.tagName !== 'SCRIPT';
    });

    openSheets++;
    trackViewport();
    root.classList.add('sheet-open');
    document.body.appendChild(layer);
    inerted.forEach(function (n) { n.inert = true; });

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { layer.classList.add('open'); });
    });

    var focusTarget = opts.focus ? layer.querySelector(opts.focus) : el;
    // на телефоне поле с клавиатурой лучше не фокусировать до конца выезда
    setTimeout(function () {
      if (focusTarget && layer.isConnected) focusTarget.focus({ preventScroll: true });
    }, opts.focus ? 320 : 30);

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      layer.classList.remove('open');
      el.style.setProperty('--drag', '0px');
      inerted.forEach(function (n) { n.inert = false; });
      document.removeEventListener('keydown', onKey);
      openSheets = Math.max(0, openSheets - 1);
      if (!openSheets) root.classList.remove('sheet-open');
      if (document.activeElement && layer.contains(document.activeElement)) document.activeElement.blur();
      setTimeout(function () { layer.remove(); }, 420);
      if (prevFocus && prevFocus.focus && document.contains(prevFocus) && !matchMedia('(pointer: coarse)').matches) {
        prevFocus.focus({ preventScroll: true });
      }
      if (opts.onClose) opts.onClose();
    }

    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    layer.querySelector('.sheet-scrim').addEventListener('click', close);
    layer.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) close();
    });

    /* Потянуть вниз за «язычок» или заголовок — закрыть.
       Решает не только расстояние, но и скорость: короткий резкий
       смах тоже закрывает, как в iOS. */
    var drag = null;
    function dragStart(e) {
      if (e.target.closest('button, input, textarea, a')) return;
      if (e.pointerType === 'mouse' && window.innerWidth > 720) return;
      drag = { y: e.clientY, t: performance.now(), dy: 0, id: e.pointerId };
      el.classList.add('dragging');
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    }
    function dragMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dy = e.clientY - drag.y;
      // вверх шторка почти не идёт — упирается
      drag.dy = dy > 0 ? dy : dy * 0.18;
      el.style.setProperty('--drag', drag.dy.toFixed(1) + 'px');
    }
    function dragEnd() {
      if (!drag) return;
      var dt = Math.max(1, performance.now() - drag.t);
      var v = drag.dy / dt;
      var far = drag.dy > el.offsetHeight * 0.3;
      el.classList.remove('dragging');
      drag = null;
      if (far || v > 0.45) close();
      else el.style.setProperty('--drag', '0px');
    }
    [layer.querySelector('.sheet-grab'), layer.querySelector('.sheet-head')].forEach(function (h) {
      if (!h) return;
      h.addEventListener('pointerdown', dragStart);
      h.addEventListener('pointermove', dragMove);
      h.addEventListener('pointerup', dragEnd);
      h.addEventListener('pointercancel', dragEnd);
    });

    return { el: el, layer: layer, body: body, close: close, $: function (s) { return layer.querySelector(s); } };
  }

  /* ---------------- сегменты (переключатель, как в iOS) ---------------- */

  function segmented(box, onChange) {
    var buttons = [].slice.call(box.querySelectorAll('button'));
    box.style.setProperty('--n', buttons.length);
    function select(btn, silent) {
      buttons.forEach(function (b, i) {
        var on = b === btn;
        b.setAttribute('aria-pressed', String(on));
        if (on) box.style.setProperty('--i', i);
      });
      if (!silent && onChange) onChange(btn);
    }
    var current = buttons.filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; })[0] || buttons[0];
    select(current, true);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (b && b.getAttribute('aria-pressed') !== 'true') select(b);
    });
    box.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      var next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
      next.focus();
      select(next);
    });
    return { select: select };
  }

  /* ---------------- «кто открыл сайт?» ---------------- */

  function askWhoAmI(force) {
    if (getMe() && !force) return;

    var s = sheet({
      title: 'Кто держит телефон?',
      body:
        '<p class="muted">Нужно один раз — чтобы сообщения подписывались правильно, а сайт окрасился в ваш цвет.</p>' +
        '<div class="group" style="margin-top:16px">' +
          ['a', 'b'].map(function (k) {
            return '<button class="row-item" type="button" data-key="' + k + '">' +
              avatar(k, 'lg') +
              '<span class="grow"><span class="title">Это я, ' + escapeHtml(person(k).name) + '</span>' +
              '<span class="sub" style="display:block">' + escapeHtml(person(k).city || '') + '</span></span>' +
              (getMe() === k ? '<span class="tail" style="color:var(--accent)">' + icon('check') + '</span>' : '') +
            '</button>';
          }).join('') +
        '</div>'
    });

    s.body.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-key]');
      if (!btn) return;
      var key = btn.getAttribute('data-key');
      var changed = key !== getMe();
      s.close();
      if (!changed && getMe()) return;
      setMe(key);
      renderWhoChip();
      toast('Привет, ' + me().name + '!');
    });
  }

  function renderWhoChip() {
    var chip = document.getElementById('who-chip');
    if (!chip) return;
    var k = getMe() || 'a';
    chip.innerHTML = avatar(k) + '<span class="who-name">' + escapeHtml(person(k).name) + '</span>';
    chip.setAttribute('aria-label', 'Сейчас: ' + person(k).name + '. Сменить');
  }

  /* ---------------- праздник ---------------- */

  var HEARTS = ['❤️', '💖', '💕', '💗', '💜', '💙'];

  function rainHearts(seconds) {
    if (reduceMotion.matches) return;
    var end = Date.now() + (seconds || 3) * 1000;
    var timer = setInterval(function () {
      if (Date.now() > end || document.hidden) { clearInterval(timer); return; }
      var h = document.createElement('div');
      h.className = 'fly-heart';
      h.textContent = HEARTS[Math.floor(Math.random() * HEARTS.length)];
      h.style.left = (Math.random() * 96) + 'vw';
      h.style.fontSize = (16 + Math.random() * 22) + 'px';
      h.style.animationDuration = (3.6 + Math.random() * 3) + 's';
      document.body.appendChild(h);
      setTimeout(function () { h.remove(); }, 7000);
    }, 260);
  }

  function burst(x, y, emojis, count) {
    if (reduceMotion.matches) return;
    var pieces = emojis || ['❤️', '💖', '✨'];
    var n = count || 14;
    for (var i = 0; i < n; i++) {
      var p = document.createElement('div');
      p.className = 'burst-piece';
      p.textContent = pieces[i % pieces.length];
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.fontSize = (14 + Math.random() * 12) + 'px';
      var angle = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      var dist = 60 + Math.random() * 90;
      p.style.setProperty('--dx', (Math.cos(angle) * dist).toFixed(0) + 'px');
      p.style.setProperty('--dy', (Math.sin(angle) * dist - 20).toFixed(0) + 'px');
      p.style.setProperty('--rot', ((Math.random() - .5) * 160).toFixed(0) + 'deg');
      document.body.appendChild(p);
      (function (el) { setTimeout(function () { el.remove(); }, 950); })(p);
    }
  }

  /* ---------------- время ---------------- */

  // Склонение: 1 день, 2 дня, 5 дней
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function daysBetween(from, to) {
    return Math.floor((to - from) / 86400000);
  }

  function clockIn(timeZone) {
    try {
      return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timeZone }).format(new Date());
    } catch (e) { return '--:--'; }
  }

  function hourIn(timeZone) {
    try {
      var h = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: timeZone }).format(new Date());
      return parseInt(h, 10) % 24;
    } catch (e) { return new Date().getHours(); }
  }

  function dateIn(timeZone) {
    try {
      return new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: timeZone }).format(new Date());
    } catch (e) { return ''; }
  }

  // Сегодняшняя дата в поясе (ГГГГ-ММ-ДД) — общий «день» для двоих
  function dayKey(timeZone, ts) {
    try {
      var p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timeZone })
        .formatToParts(ts ? new Date(ts) : new Date())
        .reduce(function (acc, x) { acc[x.type] = x.value; return acc; }, {});
      return p.year + '-' + p.month + '-' + p.day;
    } catch (e) { return new Date().toISOString().slice(0, 10); }
  }

  // Разница часовых поясов в часах между двумя зонами
  function tzOffsetHours(tzA, tzB) {
    try {
      var now = new Date();
      function offset(tz) {
        var s = new Intl.DateTimeFormat('en-US', {
          timeZone: tz, hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).formatToParts(now).reduce(function (acc, p) { acc[p.type] = p.value; return acc; }, {});
        var h = s.hour === '24' ? '00' : s.hour;
        return Date.UTC(+s.year, +s.month - 1, +s.day, +h, +s.minute, +s.second);
      }
      return Math.round((offset(tzB) - offset(tzA)) / 3600000);
    } catch (e) { return 0; }
  }

  function formatWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'только что';
    if (diff < 3600) { var m = Math.floor(diff / 60); return m + ' ' + plural(m, 'минуту', 'минуты', 'минут') + ' назад'; }
    var sameDay = d.toDateString() === new Date().toDateString();
    var t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return 'сегодня в ' + t;
    var yest = new Date(Date.now() - 86400000);
    if (d.toDateString() === yest.toDateString()) return 'вчера в ' + t;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' в ' + t;
  }

  // Случайный элемент, по возможности не повторяющий предыдущий
  function pickDifferent(list, prev) {
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];
    var item;
    do { item = list[Math.floor(Math.random() * list.length)]; } while (item === prev);
    return item;
  }

  /* ---------------- вкладки и переходы ---------------- */

  var LS_LAST_TAB = 'oursite:lastTab';
  var hasVT = ('onpagereveal' in window) && window.CSS && CSS.supports && CSS.supports('view-transition-name', 'x');
  if (!hasVT) root.classList.add('no-vt');

  function currentPage() {
    return location.pathname.split('/').pop() || 'index.html';
  }

  function markActiveNav() {
    var here = currentPage();
    var from = null;
    try { from = sessionStorage.getItem(LS_LAST_TAB); } catch (e) {}
    try { sessionStorage.setItem(LS_LAST_TAB, here); } catch (e) {}

    var glideFrom = (!hasVT && from && from !== here && !reduceMotion.matches) ? from : null;

    /* -- нижняя панель (телефон): позиция подсветки задана номером -- */
    var bar = document.querySelector('.tabbar');
    if (bar) {
      var tabs = [].slice.call(bar.querySelectorAll('a'));
      var idx = -1, prevIdx = -1;
      tabs.forEach(function (a, i) {
        var target = a.getAttribute('href');
        if (target === here) { idx = i; a.setAttribute('aria-current', 'page'); }
        if (glideFrom && target === glideFrom) prevIdx = i;
      });
      var tp = bar.querySelector('.tab-pill');
      if (tp) {
        if (idx < 0) tp.style.opacity = '0';
        else if (prevIdx >= 0) {
          tp.style.setProperty('--i', prevIdx);
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              tp.classList.add('glide');
              tp.style.setProperty('--i', idx);
            });
          });
        } else tp.style.setProperty('--i', idx);
      }
    }

    /* -- верхнее меню (компьютер): подсветка меряется по ссылкам -- */
    var nav = document.querySelector('.nav');
    if (!nav) return;
    var links = [].slice.call(nav.querySelectorAll('a'));
    var active = null, prev = null;
    links.forEach(function (a) {
      var target = a.getAttribute('href');
      if (target === here) { active = a; a.setAttribute('aria-current', 'page'); }
      if (glideFrom && target === glideFrom) prev = a;
    });
    var pill = nav.querySelector('.nav-pill');
    if (!pill || !active) return;

    function place(el, glide) {
      pill.classList.toggle('glide', Boolean(glide));
      pill.style.setProperty('--pill-x', el.offsetLeft + 'px');
      pill.style.setProperty('--pill-w', el.offsetWidth + 'px');
      pill.classList.add('on');
    }

    if (!active.offsetWidth) {
      // меню скрыто (телефон) — разместим, когда появится
      window.addEventListener('resize', function once() {
        if (!active.offsetWidth) return;
        place(active, false);
      });
      return;
    }

    if (prev && prev.offsetWidth) {
      place(prev, false);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { place(active, true); });
      });
    } else {
      place(active, false);
    }
    window.addEventListener('resize', function () { if (active.offsetWidth) place(active, false); });
  }

  /* Плавная смена страниц там, где нет View Transitions:
     уходящая гаснет, новая проявляется. */
  function pageTransitions() {
    if (hasVT || reduceMotion.matches) return;

    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^[a-z]+:/i.test(href)) return;
      if (href === currentPage()) { e.preventDefault(); return; }
      e.preventDefault();
      root.classList.add('leaving');
      setTimeout(function () { location.href = href; }, 150);
    });

    window.addEventListener('pageshow', function () { root.classList.remove('leaving'); });
  }

  /* Большой заголовок уезжает под шапку — в шапке проявляется маленький,
     и сама шапка становится матовой. Как в Настройках iPhone. */
  function largeTitle() {
    var bar = document.querySelector('.topbar');
    var title = document.querySelector('.page-title');
    if (!bar) return;
    var small = bar.querySelector('.bar-title');
    if (small && title && !small.textContent) small.textContent = title.getAttribute('data-short') || title.textContent;

    function update() {
      var limit = title ? title.getBoundingClientRect().bottom : 1;
      bar.classList.toggle('scrolled', limit < bar.offsetHeight - 4 || (!title && window.scrollY > 4));
    }
    var queued = false;
    window.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; update(); });
    }, { passive: true });
    update();
  }

  // сразу, до первого кадра
  applyMe();
  markActiveNav();

  /* ---------------- запуск ---------------- */

  function init(opts) {
    opts = opts || {};
    renderWhoChip();

    var chip = document.getElementById('who-chip');
    if (chip) chip.addEventListener('click', function () { askWhoAmI(true); });

    pageTransitions();
    largeTitle();
    if (opts.requireIdentity !== false) askWhoAmI(false);

    document.addEventListener('me-changed', renderWhoChip);
  }

  return {
    init: init, getMe: getMe, setMe: setMe, me: me, partner: partner,
    partnerKey: partnerKey, person: person, askWhoAmI: askWhoAmI,
    toast: toast, undoToast: undoToast, sheet: sheet, segmented: segmented,
    icon: icon, avatar: avatar, initial: initial,
    rainHearts: rainHearts, burst: burst,
    plural: plural, daysBetween: daysBetween, clockIn: clockIn, hourIn: hourIn, dateIn: dateIn,
    dayKey: dayKey, tzOffsetHours: tzOffsetHours, formatWhen: formatWhen,
    escapeHtml: escapeHtml, pickDifferent: pickDifferent,
    reduceMotion: function () { return reduceMotion.matches; }
  };
})();
