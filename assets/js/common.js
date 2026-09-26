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

  /* ============================================================
     Физика движения — по мотивам Apple («Designing Fluid Interfaces»)

     Пружина задаётся как в iOS: damping (1 — плавно, без перелёта;
     меньше — с отскоком) и response (насколько быстро, в секундах).
     Её можно перехватить в любой момент: новая пружина стартует
     с текущего места и текущей скорости — без рывка.
     ============================================================ */

  function spring(o) {
    var damping = o.damping == null ? 1 : o.damping;
    var response = o.response || 0.4;
    var to = o.to;
    var x0 = o.from - to;                   // отклонение от цели
    var v0 = o.velocity || 0;               // единиц в секунду
    var w0 = 2 * Math.PI / response;
    var t0 = performance.now();
    var raf = 0, done = false, cur = o.from, vel = v0;

    function disp(t) {
      if (damping < 1) {
        var wd = w0 * Math.sqrt(1 - damping * damping);
        return Math.exp(-damping * w0 * t) * (x0 * Math.cos(wd * t) + ((v0 + damping * w0 * x0) / wd) * Math.sin(wd * t));
      }
      return Math.exp(-w0 * t) * (x0 + (v0 + w0 * x0) * t);
    }

    function finish() {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      cur = to; vel = 0;
      if (o.onUpdate) o.onUpdate(to, 0);
      if (o.onDone) o.onDone();
    }

    function step(now) {
      if (done) return;
      var t = (now - t0) / 1000;
      var x = disp(t);
      vel = (disp(t + 0.001) - x) / 0.001;
      cur = to + x;
      if (Math.abs(x) < (o.precision || 0.4) && Math.abs(vel) < 8) { finish(); return; }
      if (o.onUpdate) o.onUpdate(cur, vel);
      raf = requestAnimationFrame(step);
    }

    if (reduceMotion.matches || o.instant) { finish(); }
    else { if (o.onUpdate) o.onUpdate(o.from, v0); raf = requestAnimationFrame(step); }

    return {
      stop: function () { done = true; cancelAnimationFrame(raf); },
      get value() { return cur; },
      get velocity() { return vel; },
      get running() { return !done; }
    };
  }

  // Мягкий край: чем дальше тянешь за границу, тем туже идёт
  function rubberband(over, size, c) {
    c = c || 0.55;
    var s = Math.sign(over), a = Math.abs(over);
    return s * (a * size * c) / (size + c * a);
  }

  // Куда «докатится» жест с этой скоростью (px/с) — как прокрутка iOS
  function project(velocity, rate) {
    rate = rate || 0.99;
    return (velocity / 1000) * rate / (1 - rate);
  }

  // Скорость пальца по последним точкам — для передачи в пружину
  function tracker() {
    var pts = [];
    return {
      add: function (x, y) {
        var t = performance.now();
        pts.push({ x: x, y: y, t: t });
        while (pts.length > 2 && t - pts[0].t > 70) pts.shift();
      },
      velocity: function () {
        if (pts.length < 2) return { x: 0, y: 0 };
        var a = pts[0], b = pts[pts.length - 1];
        var dt = Math.max(1, b.t - a.t) / 1000;
        // палец давно стоит — скорости нет
        if (performance.now() - b.t > 80) return { x: 0, y: 0 };
        return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
      }
    };
  }

  /* ---------------- тактильный отклик ----------------
     На iPhone (iOS 18+) переключатель-свитч сам даёт лёгкий «тик»
     Taptic Engine — нажимаем невидимый. Там, где есть Vibration API
     (Android), — короткая вибрация. Только на значимые моменты. */

  var hapticEl = null;
  function haptic() {
    if (!matchMedia('(pointer: coarse)').matches) return;
    // пока открыта клавиатура, фокус не трогаем — иначе она закроется
    var a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.type !== 'checkbox') {
      if (navigator.vibrate) navigator.vibrate(8);
      return;
    }
    try {
      if (!hapticEl) {
        hapticEl = document.createElement('label');
        hapticEl.setAttribute('aria-hidden', 'true');
        hapticEl.style.cssText = 'position:fixed;left:-40px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
        var inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.setAttribute('switch', '');
        inp.tabIndex = -1;
        hapticEl.appendChild(inp);
        document.body.appendChild(hapticEl);
      }
      hapticEl.click();
    } catch (e) {}
    if (navigator.vibrate) navigator.vibrate(8);
  }

  /* ---------------- нажатия ----------------
     Отклик — в момент касания, а не когда палец отпустили.
     Сдвинул палец дальше 10px или начал прокрутку — нажатие
     отменяется, как в iOS. Отпускание — на пружине (в CSS). */

  var PRESS = 'button, a[href], [role="button"], label.pressable, .pressable';
  var NO_PRESS = '.bubble, .no-press, .sheet-grab, [data-act="drag"], canvas, input, textarea, select';
  var pressed = null;

  function releasePress() {
    if (!pressed) return;
    pressed.el.classList.remove('is-pressed');
    pressed = null;
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return;
    var el = e.target.closest(PRESS);
    if (!el || el.closest(NO_PRESS) || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    releasePress();
    pressed = { el: el, x: e.clientX, y: e.clientY, id: e.pointerId };
    el.classList.add('is-pressed');
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (!pressed || e.pointerId !== pressed.id) return;
    if (Math.abs(e.clientX - pressed.x) > 10 || Math.abs(e.clientY - pressed.y) > 10) releasePress();
  }, { capture: true, passive: true });
  ['pointerup', 'pointercancel', 'dragstart'].forEach(function (t) {
    document.addEventListener(t, releasePress, true);
  });
  window.addEventListener('blur', releasePress);
  window.addEventListener('scroll', releasePress, { passive: true, capture: true });
  // без этого iOS Safari не показывает :active на касании
  document.addEventListener('touchstart', function () {}, { passive: true });

  /* ---------------- цифры, которые перекатываются ----------------
     Как numericText в iOS: меняются только те цифры, что изменились,
     старая уезжает, новая въезжает с лёгким размытием. */

  function roll(el, text, opts) {
    opts = opts || {};
    text = String(text);
    if (el.dataset.roll === text) return;
    var first = el.dataset.roll === undefined;
    el.dataset.roll = text;
    el.setAttribute('aria-label', text);

    if (first || reduceMotion.matches || !el.animate) {
      el.innerHTML = '';
      Array.from(text).forEach(function (ch) {
        var s = document.createElement('span');
        s.className = 'rl';
        s.setAttribute('aria-hidden', 'true');
        s.textContent = ch;
        el.appendChild(s);
      });
      return;
    }

    var down = opts.down ? -1 : 1;           // обратный отсчёт катится сверху
    var olds = [].slice.call(el.children);
    var chars = Array.from(text);
    // выравниваем по правому краю: 99 → 100 меняет все разряды
    var shift = chars.length - olds.length;
    var frag = [];
    chars.forEach(function (ch, i) {
      var old = olds[i - shift];
      if (old && old.textContent === ch && !old.classList.contains('rl-out')) { frag.push(old); return; }
      var s = document.createElement('span');
      s.className = 'rl';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = ch;
      frag.push(s);
      s.animate([
        { transform: 'translateY(' + (45 * down) + '%)', opacity: 0, filter: 'blur(2px)' },
        { transform: 'none', opacity: 1, filter: 'blur(0)' }
      ], { duration: opts.duration || 420, easing: 'cubic-bezier(.23, 1, .32, 1)', delay: Math.max(0, (chars.length - 1 - i)) * 0 });
      if (old) {
        var ghost = old.cloneNode(true);
        ghost.classList.add('rl-out');
        s.appendChild(ghost);
        ghost.animate([
          { transform: 'none', opacity: 1, filter: 'blur(0)' },
          { transform: 'translateY(' + (-90 * down) + '%)', opacity: 0, filter: 'blur(2px)' }
        ], { duration: 320, easing: 'cubic-bezier(.55, 0, 1, .45)', fill: 'forwards' }).finished.then(function () { ghost.remove(); }, function () {});
      }
    });
    el.replaceChildren.apply(el, frag);
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

    /* уведомление можно смахнуть вниз или в сторону; пока палец на нём,
       оно не пропадает само */
    var g = null;
    t.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.t-action')) return;
      clearTimeout(timer);
      g = { x: e.clientX, y: e.clientY, tr: tracker(), dx: 0, dy: 0 };
      g.tr.add(e.clientX, e.clientY);
      t.style.transition = 'none';
      try { t.setPointerCapture(e.pointerId); } catch (err) {}
    });
    t.addEventListener('pointermove', function (e) {
      if (!g) return;
      g.tr.add(e.clientX, e.clientY);
      g.dx = e.clientX - g.x;
      var raw = e.clientY - g.y;
      g.dy = raw < 0 ? rubberband(raw, 60) : raw;
      t.style.transform = 'translate(' + g.dx.toFixed(1) + 'px,' + g.dy.toFixed(1) + 'px)';
      t.style.opacity = String(Math.max(0.2, 1 - Math.abs(g.dx) / 260));
    });
    function letGo() {
      if (!g) return;
      var v = g.tr.velocity(), d = g;
      g = null;
      var outY = d.dy + project(v.y) > 50, outX = Math.abs(d.dx + project(v.x)) > 130;
      if (outY || outX) {
        t.style.transition = 'transform 280ms cubic-bezier(.23, 1, .32, 1), opacity 220ms ease';
        t.style.transform = outX
          ? 'translate(' + (Math.sign(d.dx + v.x) * 420) + 'px,' + d.dy + 'px)'
          : 'translate(' + d.dx + 'px,' + (d.dy + 90) + 'px)';
        t.style.opacity = '0';
        t.classList.add('out');
        setTimeout(function () { t.remove(); }, 300);
        return;
      }
      t.style.transition = '';
      t.style.transform = '';
      t.style.opacity = '';
      timer = setTimeout(dismiss, 2400);
    }
    t.addEventListener('pointerup', letGo);
    t.addEventListener('pointercancel', letGo);

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

    /* На телефоне шторка движется пружиной, а затемнение фона идёт
       ровно за ней: потянул наполовину — фон наполовину посветлел. */
    var phone = window.innerWidth <= 720;
    var scrim = layer.querySelector('.sheet-scrim');
    var y = 0, H = 1, anim = null;

    function setY(v) {
      y = v;
      el.style.transform = 'translate3d(0,' + v.toFixed(2) + 'px,0)';
      scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - v / H)));
    }
    function measure() { H = el.offsetHeight + 24; }

    if (phone) {
      layer.classList.add('physics');
      measure();
      setY(H);
      requestAnimationFrame(function () {
        anim = spring({ from: H, to: 0, damping: 0.88, response: 0.44, onUpdate: setY });
      });
    } else {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { layer.classList.add('open'); });
      });
    }

    var focusTarget = opts.focus ? layer.querySelector(opts.focus) : el;
    // на телефоне поле с клавиатурой лучше не фокусировать до конца выезда
    setTimeout(function () {
      if (focusTarget && layer.isConnected) focusTarget.focus({ preventScroll: true });
    }, opts.focus ? 340 : 30);

    var closed = false;
    function close(velocity) {
      if (closed) return;
      closed = true;
      inerted.forEach(function (n) { n.inert = false; });
      document.removeEventListener('keydown', onKey);
      openSheets = Math.max(0, openSheets - 1);
      if (!openSheets) root.classList.remove('sheet-open');
      if (document.activeElement && layer.contains(document.activeElement)) document.activeElement.blur();
      layer.style.pointerEvents = 'none';
      if (phone) {
        if (anim) anim.stop();
        measure();
        anim = spring({
          from: y, to: H, velocity: typeof velocity === 'number' ? Math.max(0, velocity) : 0,
          damping: 1, response: 0.32, onUpdate: setY,
          onDone: function () { layer.remove(); }
        });
      } else {
        layer.classList.remove('open');
        setTimeout(function () { layer.remove(); }, 300);
      }
      if (prevFocus && prevFocus.focus && document.contains(prevFocus) && !matchMedia('(pointer: coarse)').matches) {
        prevFocus.focus({ preventScroll: true });
      }
      if (opts.onClose) opts.onClose();
    }

    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    scrim.addEventListener('click', function () { close(); });
    layer.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) close();
    });

    /* Потянуть за «язычок» или заголовок: шторка идёт за пальцем 1:1,
       вверх упирается мягко. Отпустил — решает не расстояние, а то,
       куда жест «докатился» бы с этой скоростью; и пружина продолжает
       движение ровно с той скоростью, с какой шёл палец. */
    var drag = null;
    function dragStart(e) {
      if (!phone || closed) return;
      if (e.target.closest('button, input, textarea, a')) return;
      if (anim) anim.stop();
      measure();
      drag = { y0: y, start: e.clientY, id: e.pointerId, tr: tracker() };
      drag.tr.add(0, e.clientY);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    }
    function dragMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag.tr.add(0, e.clientY);
      var raw = drag.y0 + (e.clientY - drag.start);
      setY(raw < 0 ? rubberband(raw, H) : raw);
    }
    function dragEnd() {
      if (!drag) return;
      var v = drag.tr.velocity().y;
      drag = null;
      // закрыть: либо жест «докатился» бы ниже середины, либо это явный смах вниз
      if (y + project(v) > H * 0.45 || (v > 500 && y > 30)) close(v);
      else anim = spring({ from: y, to: 0, velocity: v, damping: 0.8, response: 0.34, onUpdate: setY });
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

  /* Подсветка вкладки едет к нажатой сразу, в момент касания, —
     не дожидаясь, пока загрузится новая страница. */
  function preNavigate() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('.tabbar a[href], .nav a[href]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
      var href = a.getAttribute('href');
      if (href === currentPage()) { e.preventDefault(); window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' }); return; }
      try { sessionStorage.setItem(LS_LAST_TAB, href); } catch (err) {}

      var bar = a.closest('.tabbar, .nav');
      [].forEach.call(bar.querySelectorAll('a'), function (x) {
        if (x === a) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
      });
      if (bar.classList.contains('tabbar')) {
        var pill = bar.querySelector('.tab-pill');
        var idx = [].indexOf.call(bar.querySelectorAll('a'), a);
        if (pill && idx >= 0) { pill.style.opacity = ''; pill.classList.add('glide'); pill.style.setProperty('--i', idx); }
      } else {
        var np = bar.querySelector('.nav-pill');
        if (np) {
          np.classList.add('glide', 'on');
          np.style.setProperty('--pill-x', a.offsetLeft + 'px');
          np.style.setProperty('--pill-w', a.offsetWidth + 'px');
        }
      }
    }, true);
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

    preNavigate();
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
    spring: spring, rubberband: rubberband, project: project, tracker: tracker,
    haptic: haptic, roll: roll,
    reduceMotion: function () { return reduceMotion.matches; }
  };
})();
