/**
 * ============================================================================
 *  COMPLEJO LAS SIERRAS — Receptor de solicitudes de reserva (Google Apps Script)
 * ----------------------------------------------------------------------------
 *  Recibe los datos del formulario de https://complejolassierras.com/reserva.html,
 *  los valida y agrega una fila nueva en la planilla de solicitudes.
 *
 *  Cómo instalarlo: ver INSTRUCCIONES.md (en esta misma carpeta).
 *
 *  Funciones que podés ejecutar a mano desde el editor:
 *    - verificarConfiguracion()  → revisa que la planilla y las columnas estén bien.
 *    - probarSolicitud()         → agrega una fila de PRUEBA (después borrala).
 * ============================================================================
 */

/* ----------------------------- CONFIGURACIÓN ----------------------------- */
const CONFIG = {
  // ID de la planilla (la parte entre /d/ y /edit en la URL)
  SPREADSHEET_ID: '1gR65kacWQUSL1XJBRGj_l9oFHcVRvEW7qxmdVCOsiGw',
  // gid de la pestaña donde se guardan las solicitudes (#gid=0 en la URL)
  SHEET_GID: 0,

  // Aviso por email al complejo en cada solicitud nueva ('' para desactivar)
  NOTIFY_EMAIL: 'lassierrascamping@gmail.com',
  // Email automático al huésped confirmando que se recibió la solicitud.
  // Desactivado por defecto: dejalo en false salvo que lo necesites.
  SEND_GUEST_CONFIRMATION: false,

  SITE_NAME: 'Complejo Las Sierras',
  SITE_URL: 'https://complejolassierras.com',
  WHATSAPP: '5491160248224',
  TIMEZONE: 'America/Argentina/Buenos_Aires',

  // Reglas (iguales a las de config.js en la web)
  MAX_GUESTS: 20,
  MAX_NIGHTS: 60,
  MAX_DAYS_AHEAD: 730,
  MIN_FILL_MS: 1500,

  // Protección contra abuso
  MAX_PER_EMAIL_PER_HOUR: 5,
  MAX_TOTAL_PER_HOUR: 60,
  MAX_BODY_CHARS: 20000
};

// Unidades: la clave es la que envía la web; el valor es lo que se guarda en la planilla
const UNITS = {
  'cabana-simple': 'Cabaña Simple',
  'cabana-especial': 'Cabaña Especial',
  'bungalow-simple': 'Bungalow Simple (baños compartidos)',
  'bungalow-bano-exterior': 'Bungalow con baño exterior privado',
  'bungalow-bano-interno': 'Bungalow con baño interno',
  'sin-preferencia': 'Sin preferencia (que me asesoren)'
};

const PROVINCIAS = [
  'Buenos Aires', 'Ciudad Autónoma de Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba',
  'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones',
  'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe',
  'Santiago del Estero', 'Tierra del Fuego', 'Tucumán', 'Otro país'
];

// Columnas de la planilla. Se buscan por NOMBRE en la fila 1, así que el
// orden de las columnas en la planilla puede cambiar sin romper nada.
const COLUMNS = [
  { key: 'timestamp',   header: 'Marca temporal',                   format: 'dd/mm/yyyy hh:mm:ss' },
  { key: 'email',       header: 'Dirección de correo electrónico' },
  { key: 'nombre',      header: 'NOMBRE y APELLIDO' },
  { key: 'provincia',   header: 'Provincia' },
  { key: 'telefono',    header: 'Número de teléfono' },
  { key: 'unidad',      header: 'Unidad Solicitada' },
  { key: 'huespedes',   header: 'Cantidad de Huespedes',             format: '0' },
  { key: 'checkin',     header: 'Fecha de Ingreso (Check In 14hs)',  format: 'dd/mm/yyyy' },
  { key: 'checkout',    header: 'Fecha de Egreso (Check Out 10hs)',  format: 'dd/mm/yyyy' },
  { key: 'comentarios', header: 'Comentarios Adicionales' }
];

const MSG_GENERIC = 'Ocurrió un error inesperado. Intentá de nuevo en unos minutos o escribinos por WhatsApp.';

/* ------------------------------ PUNTOS DE ENTRADA ------------------------------ */

/** Recibe las solicitudes del formulario (POST). */
function doPost(e) {
  let result;
  try {
    const data = parseRequest_(e);
    result = data ? handleReservation_(data) : { ok: false, code: 'bad_request', message: MSG_GENERIC };
  } catch (err) {
    console.error('Error procesando solicitud:', err && err.stack ? err.stack : err);
    result = { ok: false, code: 'server_error', message: MSG_GENERIC };
  }
  return json_(result);
}

/** Permite comprobar desde el navegador que el servicio está publicado. */
function doGet() {
  return json_({ ok: true, service: 'reservas-complejo-las-sierras', status: 'online' });
}

/* ------------------------------ LÓGICA PRINCIPAL ------------------------------ */

function handleReservation_(raw) {
  // 1) Campo trampa para bots: si viene completo, se responde "ok" sin guardar nada.
  if (str_(raw.website)) {
    console.warn('Solicitud descartada por campo trampa.');
    return { ok: true };
  }

  // 2) Identificador único de la solicitud (evita filas duplicadas en reintentos)
  const requestId = str_(raw.requestId);
  if (!/^[A-Za-z0-9-]{16,64}$/.test(requestId)) {
    return { ok: false, code: 'bad_request', message: MSG_GENERIC };
  }

  // 3) Tiempo mínimo de llenado (los bots envían al instante)
  const elapsed = Number(raw.elapsedMs);
  if (!isFinite(elapsed) || elapsed < CONFIG.MIN_FILL_MS) {
    return { ok: false, code: 'too_fast', message: 'Por favor, revisá los datos y volvé a enviar la solicitud.' };
  }

  // 4) Validación completa del lado del servidor
  const v = validate_(raw);
  if (Object.keys(v.errors).length) {
    return { ok: false, code: 'invalid', message: 'Revisá los datos marcados.', fieldErrors: v.errors };
  }
  const clean = v.clean;

  // 5) Escritura protegida con bloqueo (evita choques entre envíos simultáneos)
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return { ok: false, code: 'busy', message: 'Estamos recibiendo muchas solicitudes. Intentá de nuevo en unos segundos.' };
  }
  let row;
  try {
    const cache = CacheService.getScriptCache();
    const reqKey = 'req:' + requestId;
    const fpKey = 'fp:' + hash_([clean.email, clean.unidadKey, clean.checkin, clean.checkout, clean.huespedes].join('|'));
    if (cache.get(reqKey) || cache.get(fpKey)) {
      cache.put(reqKey, '1', 21600);
      return { ok: true, duplicate: true };
    }

    const emailKey = 'rl:mail:' + hash_(clean.email);
    const hourKey = 'rl:hour:' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMddHH');
    const emailCount = Number(cache.get(emailKey) || 0);
    const hourCount = Number(cache.get(hourKey) || 0);
    if (emailCount >= CONFIG.MAX_PER_EMAIL_PER_HOUR) {
      return { ok: false, code: 'rate_limited', message: 'Ya recibimos varias solicitudes con este correo. Si necesitás cambiar algo, escribinos por WhatsApp.' };
    }
    if (hourCount >= CONFIG.MAX_TOTAL_PER_HOUR) {
      return { ok: false, code: 'rate_limited', message: 'En este momento no podemos recibir más solicitudes. Escribinos por WhatsApp y te respondemos.' };
    }

    row = appendReservation_(clean);

    cache.put(reqKey, '1', 21600);          // 6 horas
    cache.put(fpKey, '1', 600);             // 10 minutos: misma solicitud repetida
    cache.put(emailKey, String(emailCount + 1), 3600);
    cache.put(hourKey, String(hourCount + 1), 3700);
  } finally {
    lock.releaseLock();
  }

  // 6) Avisos por email (si fallan, la solicitud igual quedó guardada)
  try { notifyOwner_(clean, row); } catch (err) { console.error('No se pudo enviar el aviso al complejo:', err); }
  try { if (CONFIG.SEND_GUEST_CONFIRMATION) confirmGuest_(clean); } catch (err) { console.error('No se pudo enviar el email al huésped:', err); }

  return { ok: true };
}

/* --------------------------------- VALIDACIÓN --------------------------------- */

function validate_(raw) {
  const errors = {};
  const clean = {};
  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');

  // Unidad
  const unidadKey = str_(raw.unidad);
  if (!unidadKey) errors.unidad = 'Elegí la unidad que querés reservar.';
  else if (!Object.prototype.hasOwnProperty.call(UNITS, unidadKey)) errors.unidad = 'Elegí una unidad de la lista.';
  clean.unidadKey = unidadKey;
  clean.unidad = UNITS[unidadKey] || '';

  // Fechas
  const checkin = str_(raw.checkin);
  const checkout = str_(raw.checkout);
  if (!checkin) errors.checkin = 'Indicá la fecha de ingreso.';
  else if (!isIsoDate_(checkin)) errors.checkin = 'La fecha de ingreso no es válida.';
  else if (checkin < today) errors.checkin = 'La fecha de ingreso no puede ser anterior a hoy.';
  else if (daysBetween_(today, checkin) > CONFIG.MAX_DAYS_AHEAD) errors.checkin = 'Por ahora recibimos solicitudes con hasta 2 años de anticipación.';

  if (!checkout) errors.checkout = 'Indicá la fecha de egreso.';
  else if (!isIsoDate_(checkout)) errors.checkout = 'La fecha de egreso no es válida.';
  else if (checkout <= today) errors.checkout = 'La fecha de egreso tiene que ser posterior a hoy.';
  else if (isIsoDate_(checkin)) {
    if (checkout === checkin) errors.checkout = 'La fecha de egreso no puede ser igual a la de ingreso (mínimo 1 noche).';
    else if (checkout < checkin) errors.checkout = 'La fecha de egreso tiene que ser posterior a la de ingreso.';
    else if (daysBetween_(checkin, checkout) > CONFIG.MAX_NIGHTS) errors.checkout = 'La estadía máxima por solicitud es de ' + CONFIG.MAX_NIGHTS + ' noches.';
  }
  clean.checkin = checkin;
  clean.checkout = checkout;

  // Huéspedes
  const hu = str_(raw.huespedes);
  if (!hu) errors.huespedes = 'Indicá la cantidad de huéspedes.';
  else if (!/^\d{1,3}$/.test(hu)) errors.huespedes = 'Ingresá un número entero de huéspedes.';
  else if (Number(hu) < 1) errors.huespedes = 'Tiene que haber al menos 1 huésped.';
  else if (Number(hu) > CONFIG.MAX_GUESTS) errors.huespedes = 'Para grupos de más de ' + CONFIG.MAX_GUESTS + ' personas, escribinos por WhatsApp.';
  clean.huespedes = Number(hu);

  // Nombre y apellido
  const nombre = collapse_(raw.nombre);
  const words = nombre.split(' ').filter(function (w) { return w.replace(/[.'-]/g, '').length > 0; });
  if (!nombre) errors.nombre = 'Ingresá tu nombre y apellido.';
  else if (nombre.length > 80) errors.nombre = 'El nombre puede tener hasta 80 caracteres.';
  else if (!/^\p{L}[\p{L}\p{M}' .-]*$/u.test(nombre)) errors.nombre = 'Usá solo letras, espacios, apóstrofos o guiones.';
  else if (words.length < 2 || nombre.length < 4) errors.nombre = 'Ingresá tu nombre y tu apellido.';
  clean.nombre = nombre;

  // Email
  const email = str_(raw.email).toLowerCase();
  const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;
  if (!email) errors.email = 'Ingresá tu correo electrónico.';
  else if (email.length > 120 || !EMAIL_RE.test(email) || email.indexOf('..') !== -1) errors.email = 'Revisá el correo: tiene que tener el formato nombre@dominio.com.';
  clean.email = email;

  // Teléfono
  const tel = collapse_(raw.telefono);
  const telDigits = tel.replace(/\D/g, '');
  if (!tel) errors.telefono = 'Ingresá un teléfono de contacto.';
  else if (tel.length > 25 || !/^\+?[\d\s().-]+$/.test(tel)) errors.telefono = 'Usá solo números (podés incluir +, espacios o guiones).';
  else if (telDigits.length < 10) errors.telefono = 'El número parece incompleto: incluí el código de área.';
  else if (telDigits.length > 15) errors.telefono = 'El número tiene demasiados dígitos. Revisalo.';
  clean.telefono = tel;
  clean.telefonoDigits = telDigits;

  // Provincia
  const provincia = str_(raw.provincia);
  if (!provincia) errors.provincia = 'Elegí tu provincia (o «Otro país»).';
  else if (PROVINCIAS.indexOf(provincia) === -1) errors.provincia = 'Elegí una provincia de la lista.';
  clean.provincia = provincia;

  // Comentarios (opcional)
  const comentarios = String(raw.comentarios == null ? '' : raw.comentarios)
    .replace(/\r\n?/g, '\n')
    .split('')
    .filter(function (ch) { const c = ch.charCodeAt(0); return c === 9 || c === 10 || (c >= 32 && c !== 127); })
    .join('')
    .trim();
  if (comentarios.length > 1000) errors.comentarios = 'Los comentarios pueden tener hasta 1000 caracteres.';
  clean.comentarios = comentarios;

  return { clean: clean, errors: errors };
}

/* ------------------------------ PLANILLA ------------------------------ */

function getSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheets().filter(function (s) { return s.getSheetId() === CONFIG.SHEET_GID; })[0];
  if (!sheet) throw new Error('No se encontró la pestaña con gid=' + CONFIG.SHEET_GID + ' en la planilla.');
  return sheet;
}

/**
 * Devuelve {clave: númeroDeColumna}. Si falta alguna columna, la agrega al
 * final de la fila 1 para no perder datos (y lo deja registrado en el log).
 */
function ensureColumns_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(normalize_);
  const map = {};
  let nextCol = headers.every(function (h) { return h === ''; }) ? 1 : lastCol + 1;
  COLUMNS.forEach(function (c) {
    const idx = headers.indexOf(normalize_(c.header));
    if (idx !== -1) {
      map[c.key] = idx + 1;
    } else {
      sheet.getRange(1, nextCol).setValue(c.header);
      console.warn('Columna agregada porque no existía: "' + c.header + '" (columna ' + nextCol + ')');
      map[c.key] = nextCol;
      nextCol++;
    }
  });
  return map;
}

function appendReservation_(c) {
  const sheet = getSheet_();
  const map = ensureColumns_(sheet);
  const row = sheet.getLastRow() + 1;
  const now = new Date();

  const values = {
    timestamp: now,
    email: safeText_(c.email),
    nombre: safeText_(c.nombre),
    provincia: safeText_(c.provincia),
    telefono: "'" + c.telefono,                 // siempre como texto (conserva +, 0 y espacios)
    unidad: safeText_(c.unidad),
    huespedes: c.huespedes,
    checkin: isoToDate_(c.checkin),
    checkout: isoToDate_(c.checkout),
    comentarios: safeText_(c.comentarios)
  };
  // Versión en texto, por si la planilla tiene columnas que solo aceptan texto
  const asText = {
    timestamp: Utilities.formatDate(now, CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss'),
    huespedes: String(c.huespedes),
    checkin: toDMY_(c.checkin),
    checkout: toDMY_(c.checkout)
  };
  const formats = {};
  COLUMNS.forEach(function (col) { formats[col.key] = col.format || null; });
  let formatSkipped = false;

  // Se escriben solo las celdas de estas columnas, agrupadas en tramos contiguos,
  // para no pisar otras columnas que agregues a mano (ej.: "Estado").
  const keys = Object.keys(map).sort(function (a, b) { return map[a] - map[b]; });
  let i = 0;
  while (i < keys.length) {
    let j = i;
    while (j + 1 < keys.length && map[keys[j + 1]] === map[keys[j]] + 1) j++;
    const group = keys.slice(i, j + 1);
    const range = sheet.getRange(row, map[group[0]], 1, group.length);
    // Google Sheets agrupa los cambios y recién los aplica en flush(): por eso
    // cada paso se confirma con flush() dentro de su propio try/catch.
    try {
      range.setValues([group.map(function (k) { return values[k]; })]);
      SpreadsheetApp.flush();
    } catch (err) {
      console.warn('Se reintenta la escritura como texto: ' + err);
      range.setValues([group.map(function (k) { return Object.prototype.hasOwnProperty.call(asText, k) ? asText[k] : values[k]; })]);
      SpreadsheetApp.flush();
    }
    for (let n = 0; n < group.length; n++) {
      const f = formats[group[n]];
      if (!f) continue;
      try {
        range.getCell(1, n + 1).setNumberFormat(f);
        SpreadsheetApp.flush();
      } catch (err) {
        // Las planillas con formato de "tabla" y columnas de tipo fijo no permiten
        // cambiar el formato: se deja el que ya tiene cada columna.
        formatSkipped = true;
      }
    }
    i = j + 1;
  }
  if (formatSkipped) console.warn('La planilla tiene columnas con tipo fijo: se mantuvo su formato original.');
  return row;
}

/* ------------------------------ EMAILS ------------------------------ */

function notifyOwner_(c, row) {
  if (!CONFIG.NOTIFY_EMAIL) return;
  const nights = daysBetween_(c.checkin, c.checkout);
  const waGuest = 'https://wa.me/' + whatsappDigits_(c.telefonoDigits) + '?text=' +
    encodeURIComponent('¡Hola ' + c.nombre.split(' ')[0] + '! Te escribimos de ' + CONFIG.SITE_NAME + ' por tu solicitud de reserva.');
  const sheetUrl = 'https://docs.google.com/spreadsheets/d/' + CONFIG.SPREADSHEET_ID + '/edit#gid=' + CONFIG.SHEET_GID + '&range=A' + row;

  const rows = [
    ['Unidad', c.unidad],
    ['Ingreso', toDMY_(c.checkin) + ' (check-in 14:00 hs)'],
    ['Egreso', toDMY_(c.checkout) + ' (check-out 10:00 hs)'],
    ['Noches', String(nights)],
    ['Huéspedes', String(c.huespedes)],
    ['Nombre', c.nombre],
    ['Email', c.email],
    ['Teléfono', c.telefono],
    ['Provincia', c.provincia],
    ['Comentarios', c.comentarios || '—']
  ];
  const table = rows.map(function (r) {
    return '<tr><td style="padding:6px 12px 6px 0;color:#5b6457;vertical-align:top">' + esc_(r[0]) +
      '</td><td style="padding:6px 0;font-weight:600;color:#243021;white-space:pre-wrap">' + esc_(r[1]) + '</td></tr>';
  }).join('');
  const html =
    '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#243021;max-width:560px">' +
    '<h2 style="color:#2b3a28;margin:0 0 12px">Nueva solicitud de reserva</h2>' +
    '<p style="margin:0 0 16px">Llegó una solicitud desde la web. <strong>Todavía no está confirmada</strong>: verificá disponibilidad y contactá al huésped.</p>' +
    '<table style="border-collapse:collapse">' + table + '</table>' +
    '<p style="margin:20px 0 8px">' +
    '<a href="' + esc_(waGuest) + '" style="display:inline-block;background:#1b7a43;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:bold">Responder por WhatsApp</a> ' +
    '<a href="' + esc_(sheetUrl) + '" style="display:inline-block;margin-left:8px;color:#3e5e45">Ver en la planilla (fila ' + row + ')</a></p>' +
    '<p style="color:#5b6457;font-size:13px">Si respondés este email, la respuesta le llega directamente al huésped.</p></div>';
  const text = 'Nueva solicitud de reserva (sin confirmar)\n\n' +
    rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n') +
    '\n\nWhatsApp del huésped: ' + waGuest + '\nPlanilla: ' + sheetUrl;

  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL,
    replyTo: c.email,
    name: 'Web ' + CONFIG.SITE_NAME,
    subject: 'Nueva solicitud: ' + c.nombre + ' · ' + c.unidad + ' · ' + toDMY_(c.checkin) + ' al ' + toDMY_(c.checkout),
    body: text,
    htmlBody: html
  });
}

function confirmGuest_(c) {
  const first = c.nombre.split(' ')[0];
  const text = 'Hola ' + first + ':\n\n' +
    'Recibimos tu solicitud de reserva en ' + CONFIG.SITE_NAME + ' para ' + c.unidad + ', del ' + toDMY_(c.checkin) +
    ' al ' + toDMY_(c.checkout) + ' (' + c.huespedes + ' huéspedes).\n\n' +
    'Importante: tu reserva todavía NO está confirmada. Te vamos a contactar para confirmar la disponibilidad y continuar con la reserva (seña del 30%).\n\n' +
    'Check-in: 14:00 hs · Check-out: 10:00 hs\n' +
    'WhatsApp: https://wa.me/' + CONFIG.WHATSAPP + '\n\n' +
    '¡Gracias!\n' + CONFIG.SITE_NAME + '\n' + CONFIG.SITE_URL;
  const options = {
    to: c.email,
    name: CONFIG.SITE_NAME,
    subject: 'Recibimos tu solicitud de reserva – ' + CONFIG.SITE_NAME,
    body: text
  };
  if (CONFIG.NOTIFY_EMAIL) options.replyTo = CONFIG.NOTIFY_EMAIL;
  MailApp.sendEmail(options);
}

/* ------------------------------ UTILIDADES ------------------------------ */

function parseRequest_(e) {
  if (!e) return null;
  const body = e.postData && e.postData.contents;
  if (body) {
    if (body.length > CONFIG.MAX_BODY_CHARS) return null;
    try {
      const obj = JSON.parse(body);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
    } catch (err) {
      // Si no es JSON, se intenta como formulario tradicional
    }
  }
  return e.parameter && Object.keys(e.parameter).length ? e.parameter : null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function str_(v) {
  return v == null ? '' : String(v).trim();
}

function collapse_(v) {
  return str_(v).replace(/\s+/g, ' ');
}

function normalize_(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Evita que un texto se interprete como fórmula en la planilla. */
function safeText_(s) {
  s = String(s == null ? '' : s);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function isIsoDate_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function daysBetween_(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

/** Fecha a las 12:00 hs de Argentina: se ve igual aunque la planilla use otra zona horaria. */
function isoToDate_(iso) {
  return Utilities.parseDate(iso + ' 12:00', CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');
}

function toDMY_(iso) {
  const p = iso.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

function whatsappDigits_(d) {
  d = String(d || '');
  if (d.indexOf('00') === 0) d = d.slice(2);
  if (d.indexOf('0') === 0) d = d.slice(1);
  if (d.length === 10) d = '549' + d;           // número argentino sin código de país
  else if (d.indexOf('54') === 0 && d.charAt(2) !== '9' && d.length === 12) d = '549' + d.slice(2);
  return d;
}

function hash_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).slice(0, 32);
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ------------------------------ HERRAMIENTAS ------------------------------ */

/** Ejecutala desde el editor para revisar la conexión con la planilla. */
function verificarConfiguracion() {
  const sheet = getSheet_();
  const ss = sheet.getParent();
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  console.log('Planilla: "' + ss.getName() + '" · Pestaña: "' + sheet.getName() + '"');
  console.log('Zona horaria de la planilla: ' + ss.getSpreadsheetTimeZone() + ' (recomendada: ' + CONFIG.TIMEZONE + ')');
  console.log('Filas con datos: ' + sheet.getLastRow());
  const norm = headers.map(normalize_);
  COLUMNS.forEach(function (c) {
    const idx = norm.indexOf(normalize_(c.header));
    console.log((idx === -1 ? '✗ FALTA  ' : '✓ Columna ' + columnLetter_(idx + 1) + '  ') + c.header);
  });
  const form = ss.getFormUrl();
  if (form) console.warn('Atención: la planilla está vinculada a un Formulario de Google (' + form + '). Ver paso 1 de INSTRUCCIONES.md.');
  console.log('Aviso por email: ' + (CONFIG.NOTIFY_EMAIL || 'desactivado'));
}

/** Agrega una solicitud de PRUEBA a la planilla. Después borrá esa fila. */
function probarSolicitud() {
  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const plus = function (n) {
    const p = today.split('-').map(Number);
    return Utilities.formatDate(new Date(Date.UTC(p[0], p[1] - 1, p[2] + n, 15)), 'UTC', 'yyyy-MM-dd');
  };
  const fake = {
    postData: {
      contents: JSON.stringify({
        requestId: Utilities.getUuid(),
        unidad: 'cabana-simple',
        checkin: plus(30),
        checkout: plus(33),
        huespedes: 4,
        nombre: 'PRUEBA Borrar Esta Fila',
        email: 'prueba@example.com',
        telefono: '+54 9 351 123 4567',
        provincia: 'Córdoba',
        comentarios: 'Solicitud de prueba generada desde el editor de Apps Script.',
        website: '',
        elapsedMs: 60000
      })
    }
  };
  const out = doPost(fake).getContent();
  console.log('Respuesta: ' + out);
}

function columnLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
