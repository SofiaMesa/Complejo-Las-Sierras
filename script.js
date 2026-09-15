/* ==========================================================================
   COMPLEJO LAS SIERRAS — Funciones generales del sitio
   - Utilidades de fechas (compartidas con el formulario de reserva)
   - Header, menú mobile, carruseles, galería y buscador rápido
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------
     Fechas (formato ISO AAAA-MM-DD, siempre en hora de Argentina)
     ------------------------------------------------------------------ */
  var TZ = 'America/Argentina/Buenos_Aires';
  var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function parts(iso) {
    var m = ISO_RE.exec(iso || '');
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }

  var fechas = {
    /** Fecha de hoy en Argentina, sin importar la zona horaria del dispositivo. */
    today: function () {
      try {
        var p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
          .formatToParts(new Date());
        var get = function (t) { return p.filter(function (x) { return x.type === t; })[0].value; };
        return get('year') + '-' + get('month') + '-' + get('day');
      } catch (e) {
        var d = new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      }
    },
    isValid: function (iso) {
      var p = parts(iso);
      if (!p) return false;
      var dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
      return dt.getUTCFullYear() === p.y && dt.getUTCMonth() === p.m - 1 && dt.getUTCDate() === p.d;
    },
    addDays: function (iso, n) {
      var p = parts(iso);
      var dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
      return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
    },
    /** Días entre dos fechas ISO (b - a). */
    diff: function (a, b) {
      var pa = parts(a), pb = parts(b);
      return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
    },
    toDMY: function (iso) {
      var p = parts(iso);
      return p ? pad(p.d) + '/' + pad(p.m) + '/' + p.y : '';
    },
    /** Ej.: "vie 12 de dic." */
    toLong: function (iso) {
      var p = parts(iso);
      if (!p) return '';
      try {
        return new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
          .format(new Date(Date.UTC(p.y, p.m - 1, p.d)));
      } catch (e) {
        return fechas.toDMY(iso);
      }
    }
  };

  window.LasSierras = window.LasSierras || {};
  window.LasSierras.fechas = fechas;

  /* ------------------------------------------------------------------
     Año del footer
     ------------------------------------------------------------------ */
  $$('[data-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });

  /* ------------------------------------------------------------------
     Header: sombra al hacer scroll
     ------------------------------------------------------------------ */
  var header = $('[data-header]');
  if (header) {
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ------------------------------------------------------------------
     Menú mobile accesible (foco atrapado, Escape para cerrar)
     ------------------------------------------------------------------ */
  (function initDrawer() {
    var drawer = $('[data-drawer]');
    var openBtn = $('[data-menu-open]');
    if (!drawer || !openBtn) return;
    var panel = $('.drawer__panel', drawer);
    var lastFocus = null;

    function focusables() {
      return $$('a[href], button:not([disabled])', panel).filter(function (el) { return el.offsetParent !== null; });
    }
    function onKey(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function open() {
      lastFocus = document.activeElement;
      drawer.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');
      openBtn.setAttribute('aria-expanded', 'true');
      document.body.classList.add('no-scroll');
      document.addEventListener('keydown', onKey);
      window.setTimeout(function () { var f = focusables(); if (f[0]) f[0].focus(); }, 60);
    }
    function close() {
      if (!drawer.classList.contains('is-open')) return;
      drawer.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
      openBtn.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('no-scroll');
      document.removeEventListener('keydown', onKey);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    openBtn.addEventListener('click', open);
    $$('[data-menu-close]', drawer).forEach(function (el) { el.addEventListener('click', close); });
    $$('a', panel).forEach(function (a) { a.addEventListener('click', close); });
    if (window.matchMedia) {
      var mq = window.matchMedia('(min-width: 960px)');
      var onChange = function (e) { if (e.matches) close(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }
  })();

  /* ------------------------------------------------------------------
     Carruseles de fotos (deslizables con el dedo, flechas y teclado)
     ------------------------------------------------------------------ */
  $$('[data-carousel]').forEach(function (root) {
    var track = $('.carousel__track', root);
    var slides = $$('.carousel__slide', track);
    var prev = $('[data-prev]', root);
    var next = $('[data-next]', root);
    var dotsWrap = $('[data-dots]', root);
    var count = $('[data-count]', root);
    var total = slides.length;
    var index = -1;

    if (total < 2) {
      [prev, next, dotsWrap, count].forEach(function (el) { if (el) el.hidden = true; });
      return;
    }

    var dots = slides.map(function (_, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'carousel__dot';
      b.setAttribute('aria-label', 'Ver foto ' + (i + 1) + ' de ' + total);
      b.addEventListener('click', function () { goTo(i); });
      dotsWrap.appendChild(b);
      return b;
    });

    function goTo(i) {
      i = Math.max(0, Math.min(total - 1, i));
      track.scrollTo({ left: i * track.clientWidth, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    function update() {
      var i = track.clientWidth ? Math.round(track.scrollLeft / track.clientWidth) : 0;
      i = Math.max(0, Math.min(total - 1, i));
      if (i === index) return;
      index = i;
      dots.forEach(function (d, k) { d.setAttribute('aria-current', k === i ? 'true' : 'false'); });
      prev.disabled = i === 0;
      next.disabled = i === total - 1;
      if (count) count.textContent = (i + 1) + ' / ' + total;
    }
    var ticking = false;
    track.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () { ticking = false; update(); });
    }, { passive: true });
    window.addEventListener('resize', function () { index = -1; update(); }, { passive: true });
    prev.addEventListener('click', function () { goTo(index - 1); });
    next.addEventListener('click', function () { goTo(index + 1); });
    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(index + 1); }
    });
    update();
  });

  /* ------------------------------------------------------------------
     Galería con visor de fotos
     ------------------------------------------------------------------ */
  (function initGallery() {
    var items = $$('[data-gallery] [data-full]');
    if (!items.length) return;
    var dlg = $('[data-lightbox]');
    var supported = dlg && typeof dlg.showModal === 'function';

    if (!supported) {
      items.forEach(function (btn) {
        btn.addEventListener('click', function () { window.open(btn.getAttribute('data-full'), '_blank', 'noopener'); });
      });
      return;
    }

    var imgEl = $('[data-lb-img]', dlg);
    var capEl = $('[data-lb-caption]', dlg);
    var countEl = $('[data-lb-count]', dlg);
    var current = 0;

    function show(i) {
      current = (i + items.length) % items.length;
      var btn = items[current];
      var caption = btn.getAttribute('data-caption') || '';
      imgEl.src = btn.getAttribute('data-full');
      imgEl.alt = caption;
      capEl.textContent = caption;
      countEl.textContent = (current + 1) + ' / ' + items.length;
    }
    items.forEach(function (btn, i) {
      btn.addEventListener('click', function () {
        show(i);
        dlg.showModal();
        document.body.classList.add('no-scroll');
      });
    });
    $('[data-lb-close]', dlg).addEventListener('click', function () { dlg.close(); });
    $('[data-lb-prev]', dlg).addEventListener('click', function () { show(current - 1); });
    $('[data-lb-next]', dlg).addEventListener('click', function () { show(current + 1); });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') show(current - 1);
      if (e.key === 'ArrowRight') show(current + 1);
    });
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.classList.contains('lightbox__stage')) dlg.close();
    });
    var startX = null;
    dlg.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
    dlg.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
      startX = null;
    }, { passive: true });
    dlg.addEventListener('close', function () {
      document.body.classList.remove('no-scroll');
      if (items[current]) items[current].focus();
    });
  })();

  /* ------------------------------------------------------------------
     Buscador rápido del inicio → lleva los datos a reserva.html
     ------------------------------------------------------------------ */
  (function initQuickBook() {
    var form = $('[data-quick-book]');
    if (!form) return;
    var ci = form.elements.checkin;
    var co = form.elements.checkout;
    var today = fechas.today();
    ci.min = today;
    co.min = fechas.addDays(today, 1);

    ci.addEventListener('change', function () {
      if (!fechas.isValid(ci.value)) return;
      co.min = fechas.addDays(ci.value, 1);
      if (co.value && co.value <= ci.value) co.value = '';
    });

    function enableAll() { $$('input, select', form).forEach(function (el) { el.disabled = false; }); }
    form.addEventListener('submit', function () {
      // No enviar parámetros vacíos para que la URL quede limpia
      $$('input, select', form).forEach(function (el) { if (!el.value) el.disabled = true; });
      window.setTimeout(enableAll, 0);
    });
    window.addEventListener('pageshow', enableAll);
  })();
})();
