/* ==========================================================================
   COMPLEJO LAS SIERRAS — Formulario de solicitud de reserva
   --------------------------------------------------------------------------
   Flujo: validar datos → enviar a Google Apps Script → nueva fila en
   Google Sheets → confirmación en pantalla.
   - La URL del Apps Script se configura en config.js
   - Todo texto ingresado por el usuario se muestra con textContent (sin HTML)
   ========================================================================== */
(function () {
  'use strict';

  var form = document.querySelector('[data-booking-form]');
  var F = window.LasSierras && window.LasSierras.fechas;
  if (!form || !F) return;

  var CONFIG = window.LAS_SIERRAS_CONFIG || {};
  var LIMITS = {
    capacidad: CONFIG.capacidadPorUnidad || 6,
    huespedesMax: CONFIG.maxHuespedes || 20,
    maxNoches: CONFIG.maxNoches || 60,
    maxDias: CONFIG.maxDiasAnticipacion || 730,
    timeoutMs: CONFIG.timeoutMs || 30000,
    comentariosMax: 1000,
    minMsParaEnviar: 1500
  };
  var WA_NUMBER = CONFIG.whatsappNumero || '5491160248224';
  var ENDPOINT = String(CONFIG.reservasEndpoint || '').trim();
  var ENDPOINT_OK = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(ENDPOINT);
  var DRAFT_KEY = 'lasSierras.reservaBorrador';

  var q = function (sel, root) { return (root || document).querySelector(sel); };
  var qa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var ui = {
    card: q('[data-booking-card]'),
    success: q('[data-success]'),
    submit: q('[data-submit]', form),
    submitLabel: q('[data-submit-label]', form),
    errorSummary: q('[data-error-summary]', form),
    errorList: q('[data-error-list]', form),
    submitError: q('[data-submit-error]', form),
    submitErrorTitle: q('[data-submit-error-title]', form),
    submitErrorText: q('[data-submit-error-text]', form),
    waFallback: q('[data-wa-fallback]', form),
    live: q('[data-live]', form),
    staySummary: q('[data-stay-summary]', form),
    capacityNote: q('[data-capacity-note]', form),
    charCount: q('[data-char-count]', form),
    emailSuggest: q('[data-email-suggest]', form),
    successTitle: q('[data-success-title]'),
    successName: q('[data-success-name]'),
    successSummary: q('[data-success-summary]'),
    successWa: q('[data-success-wa]'),
    newRequest: q('[data-new-request]')
  };

  var FIELD_NAMES = ['unidad', 'checkin', 'checkout', 'huespedes', 'nombre', 'email', 'telefono', 'provincia', 'comentarios'];
  var fields = {};
  FIELD_NAMES.forEach(function (n) { fields[n] = form.elements[n]; });

  var LABELS = {
    unidad: 'Unidad solicitada', checkin: 'Fecha de ingreso', checkout: 'Fecha de egreso',
    huespedes: 'Cantidad de huéspedes', nombre: 'Nombre y apellido', email: 'Correo electrónico',
    telefono: 'Teléfono', provincia: 'Provincia', comentarios: 'Comentarios'
  };

  // Valores viejos que pueden venir en enlaces anteriores (?unidad=Cabaña%20Simple)
  var LEGACY_UNITS = {
    'cabana simple': 'cabana-simple',
    'cabana especial': 'cabana-especial',
    'bungalow simple': 'bungalow-simple',
    'bungalow bano exterior': 'bungalow-bano-exterior',
    'bungalow exterior': 'bungalow-bano-exterior',
    'bungalow bano interno': 'bungalow-bano-interno',
    'bungalow interno': 'bungalow-bano-interno'
  };

  var EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
  var NAME_RE;
  try { NAME_RE = new RegExp("^[\\p{L}][\\p{L}\\p{M}' .-]*$", 'u'); }
  catch (e) { NAME_RE = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' .-]*$/; }

  var EMAIL_TYPOS = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmil.com': 'gmail.com',
    'gnail.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com',
    'gmail.om': 'gmail.com', 'gmaill.com': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com',
    'hotmal.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hormail.com': 'hotmail.com',
    'yahoo.con': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.com.ar.': 'yahoo.com.ar', 'outlok.com': 'outlook.com',
    'outlook.con': 'outlook.com', 'live.con': 'live.com', 'icloud.con': 'icloud.com'
  };

  var state = {
    sending: false,
    startedAt: Date.now(),
    requestId: newId(),
    touched: {}
  };

  /* ================================================================
     Utilidades
     ================================================================ */
  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function collapse(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function plain(s) { return collapse(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036F]/g, '').replace(/[-_]+/g, ' '); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function wrapperOf(name) { return form.querySelector('[data-field="' + name + '"]'); }
  function unitLabel(slug) {
    var opt = qa('option', fields.unidad).filter(function (o) { return o.value === slug; })[0];
    return opt ? opt.textContent : slug;
  }
  function isValidUnit(v) {
    return !!v && qa('option', fields.unidad).some(function (o) { return o.value && o.value === v; });
  }
  function announce(msg) { if (ui.live) { ui.live.textContent = ''; window.setTimeout(function () { ui.live.textContent = msg; }, 50); } }
  function waUrl(text) { return 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(text); }
  function scrollIntoViewSmart(el) {
    if (!el) return;
    var top = el.getBoundingClientRect().top + window.pageYOffset - 90;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
  function storage() {
    try { var s = window.sessionStorage; s.setItem('__t', '1'); s.removeItem('__t'); return s; } catch (e) { return null; }
  }

  /* ================================================================
     Validaciones (las mismas reglas se repiten en el Apps Script)
     ================================================================ */
  var validators = {
    unidad: function (v) {
      if (!v) return 'Elegí la unidad que querés reservar.';
      if (!isValidUnit(v)) return 'Elegí una unidad de la lista.';
      return '';
    },
    checkin: function (v) {
      if (!v) return 'Indicá la fecha de ingreso.';
      if (!F.isValid(v)) return 'La fecha de ingreso no es válida.';
      var today = F.today();
      if (v < today) return 'La fecha de ingreso no puede ser anterior a hoy.';
      if (F.diff(today, v) > LIMITS.maxDias) return 'Por ahora recibimos solicitudes con hasta 2 años de anticipación.';
      return '';
    },
    checkout: function (v) {
      if (!v) return 'Indicá la fecha de egreso.';
      if (!F.isValid(v)) return 'La fecha de egreso no es válida.';
      if (v <= F.today()) return 'La fecha de egreso tiene que ser posterior a hoy.';
      var ci = fields.checkin.value;
      if (F.isValid(ci)) {
        if (v === ci) return 'La fecha de egreso no puede ser igual a la de ingreso (mínimo 1 noche).';
        if (v < ci) return 'La fecha de egreso tiene que ser posterior a la de ingreso.';
        if (F.diff(ci, v) > LIMITS.maxNoches) return 'La estadía máxima por solicitud es de ' + LIMITS.maxNoches + ' noches. Para estadías más largas, escribinos.';
      }
      return '';
    },
    huespedes: function (v) {
      var t = String(v).trim();
      if (!t) return 'Indicá la cantidad de huéspedes.';
      if (!/^\d+$/.test(t)) return 'Ingresá un número entero de huéspedes.';
      var n = parseInt(t, 10);
      if (n < 1) return 'Tiene que haber al menos 1 huésped.';
      if (n > LIMITS.huespedesMax) return 'Para grupos de más de ' + LIMITS.huespedesMax + ' personas, escribinos por WhatsApp.';
      return '';
    },
    nombre: function (v) {
      var t = collapse(v);
      if (!t) return 'Ingresá tu nombre y apellido.';
      if (t.length > 80) return 'El nombre puede tener hasta 80 caracteres.';
      if (!NAME_RE.test(t)) return 'Usá solo letras, espacios, apóstrofos o guiones.';
      var words = t.split(' ').filter(function (w) { return w.replace(/[.'-]/g, '').length > 0; });
      if (words.length < 2 || t.length < 4) return 'Ingresá tu nombre y tu apellido.';
      return '';
    },
    email: function (v) {
      var t = String(v).trim();
      if (!t) return 'Ingresá tu correo electrónico.';
      if (t.length > 120 || !EMAIL_RE.test(t) || t.indexOf('..') !== -1) return 'Revisá el correo: tiene que tener el formato nombre@dominio.com.';
      return '';
    },
    telefono: function (v) {
      var t = String(v).trim();
      if (!t) return 'Ingresá un teléfono de contacto.';
      if (!/^\+?[\d\s().-]+$/.test(t)) return 'Usá solo números (podés incluir +, espacios o guiones).';
      var d = digits(t).length;
      if (d < 10) return 'El número parece incompleto: incluí el código de área (ej.: 351 123 4567).';
      if (d > 15) return 'El número tiene demasiados dígitos. Revisalo.';
      return '';
    },
    provincia: function (v) {
      if (!v) return 'Elegí tu provincia (o «Otro país»).';
      var ok = qa('option', fields.provincia).some(function (o) { return o.value && o.value === v; });
      return ok ? '' : 'Elegí una provincia de la lista.';
    },
    comentarios: function (v) {
      return String(v).length > LIMITS.comentariosMax ? 'Los comentarios pueden tener hasta ' + LIMITS.comentariosMax + ' caracteres.' : '';
    }
  };

  function setFieldState(name, msg) {
    var wrap = wrapperOf(name);
    var input = fields[name];
    if (!wrap || !input) return;
    var err = q('[data-error]', wrap);
    wrap.classList.toggle('is-invalid', !!msg);
    wrap.classList.toggle('is-valid', !msg && String(input.value).trim() !== '' && name !== 'comentarios');
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (err) err.textContent = msg || '';
  }

  function validateField(name) {
    var msg = validators[name](fields[name].value);
    setFieldState(name, msg);
    return msg;
  }

  function validateAll() {
    var errors = [];
    FIELD_NAMES.forEach(function (name) {
      state.touched[name] = true;
      var msg = validateField(name);
      if (msg) errors.push({ name: name, msg: msg });
    });
    return errors;
  }

  /* ================================================================
     Resumen de errores
     ================================================================ */
  function showErrorSummary(errors) {
    ui.errorList.textContent = '';
    errors.forEach(function (e) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + fields[e.name].id;
      a.textContent = (LABELS[e.name] || e.name) + ': ' + e.msg;
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        fields[e.name].focus();
        scrollIntoViewSmart(wrapperOf(e.name));
      });
      li.appendChild(a);
      ui.errorList.appendChild(li);
    });
    ui.errorSummary.hidden = false;
    scrollIntoViewSmart(ui.errorSummary);
    ui.errorSummary.focus({ preventScroll: true });
  }
  function hideErrorSummary() { ui.errorSummary.hidden = true; }
  function refreshErrorSummary() {
    if (ui.errorSummary.hidden) return;
    var remaining = FIELD_NAMES.filter(function (n) { return validators[n](fields[n].value); });
    if (!remaining.length) hideErrorSummary();
  }

  /* ================================================================
     Ayudas visuales: límites de fechas, resumen, capacidad, contador
     ================================================================ */
  function updateDateLimits() {
    var today = F.today();
    fields.checkin.min = today;
    fields.checkin.max = F.addDays(today, LIMITS.maxDias);
    var ci = fields.checkin.value;
    var base = F.isValid(ci) && ci >= today ? ci : today;
    fields.checkout.min = F.addDays(base, 1);
    fields.checkout.max = F.addDays(base, LIMITS.maxNoches);
  }

  function updateStaySummary() {
    var ci = fields.checkin.value, co = fields.checkout.value;
    var box = ui.staySummary;
    if (!validators.checkin(ci) && !validators.checkout(co)) {
      var n = F.diff(ci, co);
      box.textContent = '';
      var strong = document.createElement('strong');
      strong.textContent = n + (n === 1 ? ' noche' : ' noches');
      var span = document.createElement('span');
      span.textContent = 'Ingreso ' + F.toLong(ci) + ' (desde 14:00 hs) → Egreso ' + F.toLong(co) + ' (hasta 10:00 hs)';
      box.appendChild(strong);
      box.appendChild(span);
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  function updateCapacity() {
    var n = parseInt(fields.huespedes.value, 10);
    ui.capacityNote.hidden = !(n > LIMITS.capacidad && n <= LIMITS.huespedesMax);
    var minus = q('[data-step="-1"]', form), plus = q('[data-step="1"]', form);
    if (minus) minus.disabled = !(n > 1);
    if (plus) plus.disabled = n >= LIMITS.huespedesMax;
  }

  function updateCount() {
    var len = fields.comentarios.value.length;
    ui.charCount.textContent = len + ' / ' + LIMITS.comentariosMax;
    ui.charCount.classList.toggle('is-over', len > LIMITS.comentariosMax);
  }

  function updateEmailSuggestion() {
    var v = fields.email.value.trim();
    var box = ui.emailSuggest;
    var at = v.lastIndexOf('@');
    var domain = at > 0 ? v.slice(at + 1).toLowerCase() : '';
    var fix = EMAIL_TYPOS[domain];
    box.textContent = '';
    if (!fix) { box.hidden = true; return; }
    var suggestion = v.slice(0, at + 1) + fix;
    box.appendChild(document.createTextNode('¿Quisiste decir '));
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = suggestion;
    btn.addEventListener('click', function () {
      fields.email.value = suggestion;
      box.hidden = true;
      validateField('email');
      saveDraft();
      fields.email.focus();
    });
    box.appendChild(btn);
    box.appendChild(document.createTextNode('?'));
    box.hidden = false;
  }

  /* ================================================================
     Borrador (por si se recarga la página sin querer)
     ================================================================ */
  var draftTimer = null;
  function saveDraft() {
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(function () {
      var s = storage();
      if (!s) return;
      var data = {};
      FIELD_NAMES.forEach(function (n) { data[n] = fields[n].value; });
      try { s.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) { /* sin espacio: se ignora */ }
    }, 300);
  }
  function loadDraft() {
    var s = storage();
    if (!s) return;
    try {
      var data = JSON.parse(s.getItem(DRAFT_KEY) || 'null');
      if (!data) return;
      FIELD_NAMES.forEach(function (n) {
        if (typeof data[n] === 'string' && data[n] !== '') fields[n].value = data[n];
      });
      // Una fecha guardada que ya pasó se descarta
      if (validators.checkin(fields.checkin.value)) fields.checkin.value = '';
      if (validators.checkout(fields.checkout.value)) fields.checkout.value = '';
    } catch (e) { /* borrador inválido: se ignora */ }
  }
  function clearDraft() {
    var s = storage();
    if (s) { try { s.removeItem(DRAFT_KEY); } catch (e) { /* nada */ } }
  }

  /* ================================================================
     Datos que llegan desde otras páginas (?unidad=...&checkin=...)
     ================================================================ */
  function prefillFromUrl() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    var unidad = params.get('unidad');
    if (unidad) {
      var slug = isValidUnit(unidad) ? unidad : LEGACY_UNITS[plain(unidad)];
      if (slug && isValidUnit(slug)) fields.unidad.value = slug;
    }
    var ci = params.get('checkin') || params.get('ingreso');
    var co = params.get('checkout') || params.get('egreso');
    if (ci && !validators.checkin(ci)) fields.checkin.value = ci;
    if (co) {
      updateDateLimits();
      var prev = fields.checkout.value;
      fields.checkout.value = co;
      if (validators.checkout(co)) fields.checkout.value = prev && !validators.checkout(prev) ? prev : '';
    }
    var hu = params.get('huespedes');
    if (hu && !validators.huespedes(hu)) fields.huespedes.value = String(parseInt(hu, 10));
  }

  /* ================================================================
     Envío
     ================================================================ */
  function buildPayload() {
    return {
      requestId: state.requestId,
      unidad: fields.unidad.value,
      checkin: fields.checkin.value,
      checkout: fields.checkout.value,
      huespedes: parseInt(fields.huespedes.value, 10),
      nombre: collapse(fields.nombre.value),
      email: fields.email.value.trim().toLowerCase(),
      telefono: collapse(fields.telefono.value),
      provincia: fields.provincia.value,
      comentarios: String(fields.comentarios.value).trim(),
      website: form.elements.website ? form.elements.website.value : '',
      elapsedMs: Date.now() - state.startedAt,
      pagina: window.location.pathname
    };
  }

  function requestText(p) {
    var lines = [
      '¡Hola! Quiero hacer una solicitud de reserva en Complejo Las Sierras:',
      '• Unidad: ' + unitLabel(p.unidad),
      '• Ingreso: ' + F.toDMY(p.checkin) + ' (14:00 hs)',
      '• Egreso: ' + F.toDMY(p.checkout) + ' (10:00 hs)',
      '• Huéspedes: ' + p.huespedes,
      '• Nombre: ' + p.nombre,
      '• Teléfono: ' + p.telefono,
      '• Email: ' + p.email,
      '• Provincia: ' + p.provincia
    ];
    if (p.comentarios) lines.push('• Comentarios: ' + p.comentarios);
    return lines.join('\n');
  }

  function setSending(on) {
    state.sending = on;
    form.setAttribute('aria-busy', on ? 'true' : 'false');
    ui.submit.disabled = on;
    ui.submit.classList.toggle('is-loading', on);
    ui.submitLabel.textContent = on ? 'Enviando solicitud…' : 'Enviar solicitud de reserva';
    qa('button[type="submit"]', form).forEach(function (b) { b.disabled = on; });
    qa('fieldset', form).forEach(function (fs) { fs.disabled = on; });
    if (on) announce('Enviando tu solicitud, esperá un momento…');
  }

  function postToEndpoint(payload) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = window.setTimeout(function () { if (controller) controller.abort(); }, LIMITS.timeoutMs);
    // Sin encabezados personalizados: se envía como text/plain para evitar
    // la verificación CORS previa, que Apps Script no admite.
    return window.fetch(ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(payload),
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (!res.ok) {
        var httpErr = new Error('HTTP ' + res.status);
        httpErr.kind = 'http';
        throw httpErr;
      }
      return res.text();
    }).then(function (text) {
      try { return JSON.parse(text); } catch (e) {
        var parseErr = new Error('Respuesta inesperada del servidor');
        parseErr.kind = 'bad_response';
        throw parseErr;
      }
    }).finally(function () { window.clearTimeout(timer); });
  }

  var ERROR_TEXTS = {
    network: ['No pudimos enviar tu solicitud', 'Parece que hay un problema de conexión. Revisá tu internet y tocá «Reintentar». Tus datos siguen cargados.'],
    timeout: ['La solicitud está tardando más de lo normal', 'Puede que se haya enviado igual. Tocá «Reintentar»: si ya la recibimos, no se va a duplicar.'],
    http: ['No pudimos enviar tu solicitud', 'El servicio de reservas no respondió correctamente. Intentá de nuevo en unos minutos o envianos tu solicitud por WhatsApp.'],
    bad_response: ['No pudimos confirmar el envío', 'Hubo un problema al procesar tu solicitud. Intentá de nuevo en unos minutos o envianos tu solicitud por WhatsApp.'],
    config: ['El formulario no está disponible en este momento', 'Envianos tu solicitud por WhatsApp con el botón de abajo: ya tiene tus datos cargados.'],
    server: ['No pudimos registrar tu solicitud', 'Ocurrió un error inesperado. Intentá de nuevo en unos minutos o envianos tu solicitud por WhatsApp.']
  };

  function showSubmitError(kind, serverMessage, payload) {
    var t = ERROR_TEXTS[kind] || ERROR_TEXTS.server;
    ui.submitErrorTitle.textContent = t[0];
    ui.submitErrorText.textContent = serverMessage || t[1];
    if (ui.waFallback && payload) ui.waFallback.href = waUrl(requestText(payload));
    var retry = q('button[type="submit"]', ui.submitError);
    if (retry) retry.hidden = kind === 'config';
    ui.submitError.hidden = false;
    scrollIntoViewSmart(ui.submitError);
    ui.submitError.focus({ preventScroll: true });
  }

  function applyServerFieldErrors(fieldErrors) {
    var list = [];
    Object.keys(fieldErrors || {}).forEach(function (name) {
      if (fields[name]) {
        setFieldState(name, String(fieldErrors[name]));
        list.push({ name: name, msg: String(fieldErrors[name]) });
      }
    });
    if (list.length) showErrorSummary(list);
    return list.length > 0;
  }

  function showSuccess(p) {
    ui.successName.textContent = p.nombre.split(' ')[0];
    var nights = F.diff(p.checkin, p.checkout);
    var rows = [
      ['Unidad', unitLabel(p.unidad)],
      ['Ingreso', F.toDMY(p.checkin) + ' · desde 14:00 hs'],
      ['Egreso', F.toDMY(p.checkout) + ' · hasta 10:00 hs'],
      ['Estadía', nights + (nights === 1 ? ' noche' : ' noches')],
      ['Huéspedes', String(p.huespedes)],
      ['Nombre', p.nombre],
      ['Email', p.email],
      ['Teléfono', p.telefono],
      ['Provincia', p.provincia]
    ];
    if (p.comentarios) rows.push(['Comentarios', p.comentarios]);
    ui.successSummary.textContent = '';
    rows.forEach(function (r) {
      var dt = document.createElement('dt');
      var dd = document.createElement('dd');
      dt.textContent = r[0];
      dd.textContent = r[1];
      ui.successSummary.appendChild(dt);
      ui.successSummary.appendChild(dd);
    });
    ui.successWa.href = waUrl('¡Hola! Acabo de enviar una solicitud de reserva desde la web a nombre de ' + p.nombre +
      ': ' + unitLabel(p.unidad) + ', del ' + F.toDMY(p.checkin) + ' al ' + F.toDMY(p.checkout) +
      ', ' + p.huespedes + (p.huespedes === 1 ? ' huésped' : ' huéspedes') + '.');

    ui.card.hidden = true;
    ui.success.hidden = false;
    clearDraft();
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* nada */ }
    scrollIntoViewSmart(ui.success);
    ui.successTitle.focus({ preventScroll: true });
    try { document.dispatchEvent(new CustomEvent('reserva:enviada', { detail: { unidad: p.unidad } })); } catch (e) { /* nada */ }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (state.sending) return;
    ui.submitError.hidden = true;

    var errors = validateAll();
    if (errors.length) {
      showErrorSummary(errors);
      announce('Hay ' + errors.length + (errors.length === 1 ? ' dato para revisar.' : ' datos para revisar.'));
      return;
    }
    hideErrorSummary();

    var payload = buildPayload();
    if (!ENDPOINT_OK) {
      if (window.console) console.error('[Reservas] Falta configurar reservasEndpoint en config.js');
      showSubmitError('config', null, payload);
      return;
    }
    setSending(true);
    // Protección básica contra envíos automáticos: si el formulario se envía
    // apenas cargó la página, se espera un instante antes de mandarlo.
    var wait = Math.max(0, LIMITS.minMsParaEnviar - payload.elapsedMs);
    window.setTimeout(function () {
      payload.elapsedMs = Date.now() - state.startedAt;
      send(payload);
    }, wait);
  }

  function send(payload) {
    postToEndpoint(payload).then(function (res) {
      setSending(false);
      if (res && res.ok) {
        showSuccess(payload);
        return;
      }
      if (res && res.fieldErrors && applyServerFieldErrors(res.fieldErrors)) return;
      showSubmitError('server', res && res.message, payload);
    }).catch(function (err) {
      setSending(false);
      var kind = err && err.name === 'AbortError' ? 'timeout' : (err && err.kind) || 'network';
      if (window.console) console.error('[Reservas] Error al enviar:', err);
      showSubmitError(kind, null, payload);
    });
  }

  function resetForNewRequest() {
    ['unidad', 'checkin', 'checkout', 'comentarios'].forEach(function (n) { fields[n].value = ''; });
    fields.huespedes.value = '2';
    state.requestId = newId();
    state.startedAt = Date.now();
    state.touched = {};
    FIELD_NAMES.forEach(function (n) {
      var w = wrapperOf(n);
      if (w) w.classList.remove('is-invalid', 'is-valid');
      fields[n].removeAttribute('aria-invalid');
    });
    ui.submitError.hidden = true;
    hideErrorSummary();
    updateDateLimits(); updateStaySummary(); updateCapacity(); updateCount();
    ui.success.hidden = true;
    ui.card.hidden = false;
    scrollIntoViewSmart(ui.card);
    fields.unidad.focus({ preventScroll: true });
  }

  /* ================================================================
     Eventos
     ================================================================ */
  function onFieldEvent(e) {
    var name = e.target && e.target.name;
    if (!name || !validators[name]) return;

    if (name === 'checkin') {
      updateDateLimits();
      var ci = fields.checkin.value, co = fields.checkout.value;
      if (F.isValid(ci) && co && co <= ci) {
        fields.checkout.value = '';
        if (state.touched.checkout) setFieldState('checkout', '');
      }
      if (state.touched.checkout && fields.checkout.value) validateField('checkout');
    }
    if (name === 'huespedes') updateCapacity();
    if (name === 'comentarios') updateCount();
    if (name === 'email' && e.type !== 'input') updateEmailSuggestion();
    if (name === 'checkin' || name === 'checkout') updateStaySummary();

    if (e.type === 'focusout' || e.type === 'change') state.touched[name] = true;
    if (state.touched[name]) validateField(name);
    // Cambiar la fecha de ingreso puede volver válida la de egreso
    if (name === 'checkin' && state.touched.checkout) validateField('checkout');
    refreshErrorSummary();
    saveDraft();
  }

  form.addEventListener('input', onFieldEvent);
  form.addEventListener('change', onFieldEvent);
  form.addEventListener('focusout', onFieldEvent);
  form.addEventListener('submit', onSubmit);

  qa('[data-step]', form).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var n = parseInt(fields.huespedes.value, 10);
      if (isNaN(n)) n = 0;
      n = Math.min(LIMITS.huespedesMax, Math.max(1, n + parseInt(btn.getAttribute('data-step'), 10)));
      fields.huespedes.value = String(n);
      state.touched.huespedes = true;
      validateField('huespedes');
      updateCapacity();
      refreshErrorSummary();
      saveDraft();
    });
  });

  if (ui.newRequest) ui.newRequest.addEventListener('click', resetForNewRequest);

  // Inicialización
  loadDraft();
  prefillFromUrl();
  updateDateLimits();
  updateStaySummary();
  updateCapacity();
  updateCount();
})();
