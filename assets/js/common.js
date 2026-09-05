/* ============================================================
   Общие механики сайта: звёзды, личность, время, уведомления.
   Подключается на каждой странице ДО остальных скриптов.
   ============================================================ */

window.App = (function () {
  'use strict';

  var CFG = window.SITE_CONFIG || {};
  var LS_ME = 'oursite:me';

  /* ---------------- личность: кто сейчас за экраном ---------------- */

  function getMe() {
    var v = null;
    try { v = localStorage.getItem(LS_ME); } catch (e) { /* приватный режим */ }
    return (v === 'a' || v === 'b') ? v : null;
  }

  function setMe(key) {
    try { localStorage.setItem(LS_ME, key); } catch (e) {}
    document.dispatchEvent(new CustomEvent('me-changed', { detail: key }));
  }

  function person(key) {
    return (CFG.people && CFG.people[key]) || { name: '—', emoji: '💜', city: '', timeZone: 'UTC' };
  }

  function me() { return person(getMe() || 'a'); }
  function partnerKey() { return getMe() === 'b' ? 'a' : 'b'; }
  function partner() { return person(partnerKey()); }

  /* Модалка «кто ты?» — показывается один раз, потом по клику на чип. */
  function askWhoAmI(force) {
    if (getMe() && !force) return;

    var back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML =
      '<div class="modal card">' +
        '<div style="font-size:3rem">💌</div>' +
        '<h2 class="mt">Кто открыл сайт?</h2>' +
        '<p class="muted mt">Нужно один раз — чтобы сообщения подписывались правильно.</p>' +
        '<div class="stack mt-lg">' +
          '<button class="btn block" data-key="a">' + person('a').emoji + ' Это я, ' + person('a').name + '</button>' +
          '<button class="btn ghost block" data-key="b">' + person('b').emoji + ' Это я, ' + person('b').name + '</button>' +
        '</div>' +
      '</div>';

    back.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-key]');
      if (!btn) return;
      setMe(btn.getAttribute('data-key'));
      back.remove();
      renderWhoChip();
      toast('Привет, ' + me().name + '! ' + me().emoji);
    });

    document.body.appendChild(back);
  }

  function renderWhoChip() {
    var chip = document.getElementById('who-chip');
    if (!chip) return;
    var m = me();
    chip.innerHTML = '<span>' + m.emoji + '</span><span>' + m.name + '</span>';
    chip.title = 'Нажмите, чтобы сменить';
  }

  /* ---------------- уведомления ---------------- */

  function toast(text, ms) {
    var box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      document.body.appendChild(box);
    }
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    box.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .4s, transform .4s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(10px)';
      setTimeout(function () { t.remove(); }, 400);
    }, ms || 3200);
  }

  /* ---------------- звёзды ---------------- */

  function starfield(count) {
    var box = document.getElementById('starfield');
    if (!box) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < (count || 90); i++) {
      var s = document.createElement('div');
      s.className = 'star';
      var size = 1 + Math.random() * 2.4;
      s.style.width = s.style.height = size.toFixed(1) + 'px';
      s.style.left = (Math.random() * 100).toFixed(2) + '%';
      s.style.top = (Math.random() * 100).toFixed(2) + '%';
      s.style.animationDelay = (Math.random() * 4).toFixed(2) + 's';
      s.style.animationDuration = (3 + Math.random() * 3).toFixed(2) + 's';
      frag.appendChild(s);
    }
    box.appendChild(frag);
  }

  /* ---------------- праздничные эффекты ---------------- */

  var HEARTS = ['❤️', '💖', '💘', '💕', '🩷', '💗', '💜'];

  function rainHearts(seconds) {
    var end = Date.now() + (seconds || 4) * 1000;
    var timer = setInterval(function () {
      if (Date.now() > end) { clearInterval(timer); return; }
      var h = document.createElement('div');
      h.className = 'fly-heart';
      h.textContent = HEARTS[Math.floor(Math.random() * HEARTS.length)];
      h.style.left = (Math.random() * 100) + 'vw';
      h.style.fontSize = (18 + Math.random() * 30) + 'px';
      h.style.animationDuration = (4 + Math.random() * 4) + 's';
      document.body.appendChild(h);
      setTimeout(function () { h.remove(); }, 9000);
    }, 220);
  }

  function burst(x, y, emojis) {
    var pieces = emojis || ['❤️', '💖', '✨', '💫', '💗', '🌟'];
    for (var i = 0; i < 26; i++) {
      var p = document.createElement('div');
      p.className = 'burst-piece';
      p.textContent = pieces[Math.floor(Math.random() * pieces.length)];
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.fontSize = (16 + Math.random() * 16) + 'px';
      var angle = Math.random() * Math.PI * 2;
      var dist = 80 + Math.random() * 210;
      p.style.setProperty('--dx', (Math.cos(angle) * dist).toFixed(0) + 'px');
      p.style.setProperty('--dy', (Math.sin(angle) * dist).toFixed(0) + 'px');
      document.body.appendChild(p);
      (function (el) { setTimeout(function () { el.remove(); }, 1100); })(p);
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
      return new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit', minute: '2-digit', timeZone: timeZone
      }).format(new Date());
    } catch (e) {
      return '--:--';
    }
  }

  function dateIn(timeZone) {
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        weekday: 'short', day: 'numeric', month: 'long', timeZone: timeZone
      }).format(new Date());
    } catch (e) {
      return '';
    }
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
        // 24:00 встречается в некоторых движках — нормализуем
        var h = s.hour === '24' ? '00' : s.hour;
        return Date.UTC(+s.year, +s.month - 1, +s.day, +h, +s.minute, +s.second);
      }
      return Math.round((offset(tzB) - offset(tzA)) / 3600000);
    } catch (e) {
      return 0;
    }
  }

  function formatWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'только что';
    if (diff < 3600) { var m = Math.floor(diff / 60); return m + ' ' + plural(m, 'минуту', 'минуты', 'минут') + ' назад'; }
    var sameDay = d.toDateString() === new Date().toDateString();
    if (sameDay) return 'сегодня в ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) +
           ' в ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------------- разное ---------------- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Случайный элемент, по возможности не повторяющий предыдущий
  function pickDifferent(list, prev) {
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];
    var item;
    do { item = list[Math.floor(Math.random() * list.length)]; } while (item === prev);
    return item;
  }

  /* Карточки проявляются, когда доезжают до экрана. Класс ставим
     скриптом: если он не выполнится, страница просто будет видна вся. */
  function revealOnScroll() {
    if (!('IntersectionObserver' in window)) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var targets = [].slice.call(document.querySelectorAll('.section > .card, .section > .grid > .card'));
    if (!targets.length) return;

    targets.forEach(function (el, i) {
      // первый экран показываем сразу, без задержки
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
      el.classList.add('reveal');
      el.style.transitionDelay = ((i % 3) * 60) + 'ms';
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -40px 0px', threshold: 0.05 });

    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
  }

  var LS_LAST_TAB = 'oursite:lastTab';

  function currentPage() {
    return location.pathname.split('/').pop() || 'index.html';
  }

  /* Подсветка активной вкладки — отдельный элемент, поэтому она может
     переехать с прошлой вкладки на нынешнюю, пока грузится страница. */
  function markActiveNav() {
    var here = currentPage();
    var nav = document.querySelector('.nav');
    if (!nav) return;

    var links = [].slice.call(nav.querySelectorAll('a'));
    var active = null;

    links.forEach(function (a) {
      var target = a.getAttribute('href');
      if (target === here || (here === '' && target === 'index.html')) {
        a.classList.add('active');
        active = a;
      }
    });
    if (!active) return;

    var pill = nav.querySelector('.nav-pill');
    if (!pill) return;

    function place(el, glide) {
      pill.classList.toggle('glide', Boolean(glide));
      pill.style.setProperty('--pill-x', el.offsetLeft + 'px');
      pill.style.setProperty('--pill-w', el.offsetWidth + 'px');
      pill.classList.add('on');
    }

    var from = null;
    try { from = sessionStorage.getItem(LS_LAST_TAB); } catch (e) {}

    var prev = from && from !== here
      ? links.filter(function (a) { return a.getAttribute('href') === from; })[0]
      : null;

    // на телефоне «Главная» скрыта: ехать «оттуда» некорректно — ширины нет
    if (prev && !prev.offsetWidth) prev = null;

    if (prev && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // ставим подсветку туда, откуда пришли, и отпускаем её к новой вкладке
      place(prev, false);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { place(active, true); });
      });
    } else {
      place(active, false);
      requestAnimationFrame(function () { pill.classList.add('glide'); });
    }

    try { sessionStorage.setItem(LS_LAST_TAB, here); } catch (e) {}

    // на узком экране подводим активную вкладку в видимую часть
    if (nav.scrollWidth > nav.clientWidth) {
      nav.scrollTo({
        left: Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2),
        behavior: 'smooth'
      });
    }

    window.addEventListener('resize', function () { place(active, false); });
  }

  /* Плавная смена страниц: уходящая гаснет, новая проявляется.
     Ссылки остаются обычными — без скрипта всё просто работает как есть. */
  function pageTransitions() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      var a = e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;

      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^[a-z]+:/i.test(href)) return;
      if (href === currentPage()) { e.preventDefault(); return; }

      e.preventDefault();
      document.documentElement.classList.add('leaving');
      setTimeout(function () { location.href = href; }, 170);
    });

    // Возврат «назад» отдаёт страницу из кэша как есть — снимаем затухание,
    // иначе человек увидит пустой экран.
    window.addEventListener('pageshow', function () {
      document.documentElement.classList.remove('leaving');
    });
  }


  /* ---------------- запуск ---------------- */

  function init(opts) {
    opts = opts || {};
    starfield(opts.stars);
    markActiveNav();
    renderWhoChip();

    var chip = document.getElementById('who-chip');
    if (chip) chip.addEventListener('click', function () { askWhoAmI(true); });

    pageTransitions();
    if (opts.reveal) revealOnScroll();
    if (opts.requireIdentity !== false) askWhoAmI(false);

    document.addEventListener('me-changed', renderWhoChip);
  }

  return {
    init: init, getMe: getMe, setMe: setMe, me: me, partner: partner,
    partnerKey: partnerKey, person: person, askWhoAmI: askWhoAmI,
    toast: toast, rainHearts: rainHearts, burst: burst,
    plural: plural, daysBetween: daysBetween, clockIn: clockIn, dateIn: dateIn,
    tzOffsetHours: tzOffsetHours, formatWhen: formatWhen,
    escapeHtml: escapeHtml, pickDifferent: pickDifferent
  };
})();
