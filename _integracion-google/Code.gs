/**
 * ============================================================================
 *  COMPLEJO LAS SIERRAS — Receptor de solicitudes de reserva (Google Apps Script)
 * ----------------------------------------------------------------------------
 *  Recibe los datos del formulario de https://complejolassierras.com/reserva.html,
 *  los valida y agrega una fila nueva en la planilla de solicitudes.
 *
 *  Cómo instalarlo: ver INSTRUCCIONES.md (en esta misma carpeta).
 *
 *  Además calcula la cotización de cada solicitud (tarifa por noche, promo 7x5,
 *  total y seña) con los precios de la pestaña "Tarifas" de la planilla.
 *
 *  Funciones que podés ejecutar a mano desde el editor:
 *    - prepararTarifas()         → crea la pestaña "Tarifas" y las columnas de cotización.
 *    - verificarConfiguracion()  → revisa que la planilla y las columnas estén bien.
 *    - probarSolicitud()         → agrega una fila de PRUEBA (después borrala).
 *
 *  En la planilla aparece el menú "Las Sierras" para recalcular la cotización
 *  de las filas seleccionadas, para enviarle al huésped su reserva con los
 *  datos para la seña y, cuando se recibe la seña, la confirmación de la
 *  reserva (por WhatsApp y/o por mail).
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
const MONEY = '"$"#,##0';
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
  { key: 'comentarios', header: 'Comentarios Adicionales' },
  // Cotización automática (se agregan al final de la planilla si no existen)
  { key: 'noches',      header: 'Noches',                            format: '0' },
  { key: 'tarifaNoche', header: 'Tarifa por noche',                  format: MONEY },
  { key: 'nochesPagar', header: 'Noches a pagar',                    format: '0' },
  { key: 'total',       header: 'Total estimado',                    format: MONEY },
  { key: 'sena',        header: 'Seña',                              format: MONEY },
  { key: 'cotizacion',  header: 'Enviar cotización' },
  // Envío de la reserva con los datos para la seña (menú "Las Sierras")
  { key: 'enviada',     header: 'Reserva enviada' },
  { key: 'venceSena',   header: 'Vence la seña' },
  { key: 'confirmada',  header: 'Confirmación enviada' }
];
const QUOTE_KEYS = ['noches', 'tarifaNoche', 'nochesPagar', 'total', 'sena', 'cotizacion'];

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
  const quote = cotizar_(clean.unidadKey, clean.huespedes, clean.checkin, clean.checkout);

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

    row = appendReservation_(clean, quote);

    cache.put(reqKey, '1', 21600);          // 6 horas
    cache.put(fpKey, '1', 600);             // 10 minutos: misma solicitud repetida
    cache.put(emailKey, String(emailCount + 1), 3600);
    cache.put(hourKey, String(hourCount + 1), 3700);
  } finally {
    lock.releaseLock();
  }

  // 6) Avisos por email (si fallan, la solicitud igual quedó guardada)
  try { notifyOwner_(clean, row, quote); } catch (err) { console.error('No se pudo enviar el aviso al complejo:', err); }
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

function appendReservation_(c, quote) {
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
  const cells = quoteCells_(quote);
  Object.keys(cells).forEach(function (k) { values[k] = cells[k]; });

  writeCells_(sheet, row, map, values, asText);
  setQuoteLink_(sheet, row, map, c, quote);
  try { setEstado_(sheet, row, ESTADOS.NO, false); } catch (err) { console.warn('No se pudo completar el Estado: ' + err); }
  return row;
}

/**
 * Escribe en la fila indicada solo las columnas de "values", agrupadas en
 * tramos contiguos (así no se pisan columnas agregadas a mano, ej.: "Estado").
 * Google Sheets aplica los cambios recién en flush(): por eso cada paso se
 * confirma con flush() dentro de su propio try/catch.
 */
function writeCells_(sheet, row, map, values, asText) {
  asText = asText || {};
  const formats = {};
  COLUMNS.forEach(function (col) { formats[col.key] = col.format || null; });
  let formatSkipped = false;
  const keys = Object.keys(values).filter(function (k) { return map[k]; })
    .sort(function (a, b) { return map[a] - map[b]; });
  let i = 0;
  while (i < keys.length) {
    let j = i;
    while (j + 1 < keys.length && map[keys[j + 1]] === map[keys[j]] + 1) j++;
    const group = keys.slice(i, j + 1);
    const range = sheet.getRange(row, map[group[0]], 1, group.length);
    try {
      range.setValues([group.map(function (k) { return values[k]; })]);
      SpreadsheetApp.flush();
    } catch (err) {
      console.warn('Se reintenta la escritura como texto: ' + err);
      range.setValues([group.map(function (k) {
        if (Object.prototype.hasOwnProperty.call(asText, k)) return asText[k];
        return typeof values[k] === 'number' ? String(values[k]) : values[k];
      })]);
      SpreadsheetApp.flush();
    }
    for (let n = 0; n < group.length; n++) {
      const f = formats[group[n]];
      if (!f || typeof values[group[n]] === 'string') continue;
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
}

/** Convierte la celda "Enviar cotización" en un enlace a WhatsApp con el mensaje listo. */
function setQuoteLink_(sheet, row, map, c, quote) {
  if (!map.cotizacion) return;
  try {
    const url = quoteWhatsappUrl_(c, quote);
    if (!url) return;
    const label = quoteMessage_(c, quote) ? QUOTE_LINK_TEXT : CHAT_LINK_TEXT;
    const rich = SpreadsheetApp.newRichTextValue().setText(label).setLinkUrl(url).build();
    sheet.getRange(row, map.cotizacion).setRichTextValue(rich);
    SpreadsheetApp.flush();
  } catch (err) {
    console.warn('No se pudo crear el enlace de WhatsApp: ' + err);
  }
}

/* ------------------------------ TARIFAS Y COTIZACIÓN ------------------------------ */

const TARIFAS_SHEET = 'Tarifas';
const QUOTE_LINK_TEXT = 'Enviar por WhatsApp';
const CHAT_LINK_TEXT = 'Escribir por WhatsApp';

// Precios iniciales (solo se usan para crear la pestaña "Tarifas" la primera vez;
// después manda lo que esté escrito en esa pestaña).
const DEFAULT_TARIFAS = [
  // clave, tarifa por noche (hasta 3 personas), persona adicional por noche, máximo de personas
  ['bungalow-simple',        100000, 20000, 6],
  ['bungalow-bano-exterior', 115000, 25000, 6],
  ['bungalow-bano-interno',  130000, 30000, 6],
  ['cabana-simple',          155000, 30000, 6],
  ['cabana-especial',        165000, 30000, 6]
];
const TARIFAS_LABELS = {
  promo: 'Promo: cada 7 noches se pagan',
  sena: 'Seña (%)',
  incluidas: 'Personas incluidas en la tarifa por noche'
};

function getTarifasSheet_(create) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sh = ss.getSheetByName(TARIFAS_SHEET);
  if (!sh && create) sh = crearHojaTarifas_(ss);
  return sh;
}

function crearHojaTarifas_(ss) {
  const sh = ss.insertSheet(TARIFAS_SHEET);
  const header = [['Clave (no modificar)', 'Unidad', 'Tarifa por noche (hasta 3 personas)', 'Persona adicional (por noche)', 'Máximo de personas']];
  const rows = DEFAULT_TARIFAS.map(function (r) { return [r[0], UNITS[r[0]], r[1], r[2], r[3]]; });
  sh.getRange(1, 1, 1, 5).setValues(header).setFontWeight('bold').setBackground('#e9ede5');
  sh.getRange(2, 1, rows.length, 5).setValues(rows);
  sh.getRange(2, 3, rows.length, 2).setNumberFormat(MONEY);
  const base = rows.length + 3;
  sh.getRange(base, 1, 3, 3).setValues([
    [TARIFAS_LABELS.promo, 5, 'Poné 7 para desactivar la promo (pagás 5 y te quedás 7).'],
    [TARIFAS_LABELS.sena, 30, 'Porcentaje del total que se pide para confirmar.'],
    [TARIFAS_LABELS.incluidas, 3, 'Desde cuántas personas se cobra el adicional (1 y 2 personas pagan lo mismo que 3).']
  ]);
  sh.getRange(base, 1, 3, 1).setFontWeight('bold');
  sh.getRange(base + 4, 1).setValue('Precios en pesos. Los cambios se aplican a las solicitudes nuevas. ' +
    'Para actualizar una solicitud ya cargada: menú "Las Sierras" → "Recalcular cotización de las filas seleccionadas".');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 300);
  sh.setColumnWidth(2, 260);
  sh.setColumnWidths(3, 3, 190);
  return sh;
}

function parseNumber_(v) {
  if (typeof v === 'number') return v;
  const t = String(v == null ? '' : v).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  return t === '' ? NaN : Number(t);
}

/** Lee la pestaña "Tarifas" (y la crea con los precios iniciales si no existe). */
function leerTarifas_() {
  const sh = getTarifasSheet_(true);
  const data = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), Math.max(sh.getLastColumn(), 2)).getValues();
  const out = { unidades: {}, pagaPorSemana: 5, senaPct: 30, incluidas: 3 };
  data.forEach(function (r) {
    const a = str_(r[0]);
    if (Object.prototype.hasOwnProperty.call(UNITS, a)) {
      out.unidades[a] = { base: parseNumber_(r[2]), adicional: parseNumber_(r[3]), max: parseNumber_(r[4]) || 6 };
      return;
    }
    const label = normalize_(a);
    const val = parseNumber_(r[1]);
    if (!isFinite(val)) return;
    if (label.indexOf('promo') === 0) out.pagaPorSemana = val;
    else if (label.indexOf('sena') === 0) out.senaPct = val;
    else if (label.indexOf('personas incluidas') === 0) out.incluidas = val;
  });
  // Si la celda de la seña tiene formato de porcentaje, llega como 0,3 en lugar de 30
  if (out.senaPct > 0 && out.senaPct <= 1) out.senaPct = out.senaPct * 100;
  return out;
}

/**
 * Calcula la cotización. Reglas:
 *  - Tarifa por noche = tarifa hasta N personas + adicional por cada persona extra.
 *  - Promo: cada 7 noches completas se pagan 5 (el resto, a tarifa normal).
 *  - Seña = porcentaje del total.
 */
function calcularCotizacion_(unidadKey, huespedes, checkin, checkout, tarifas) {
  const noches = daysBetween_(checkin, checkout);
  const q = { ok: false, motivo: '', unidadKey: unidadKey, huespedes: huespedes, checkin: checkin, checkout: checkout,
    noches: noches, tarifaNoche: 0, nochesPagar: 0, total: 0, sena: 0, promo: false, senaPct: tarifas.senaPct, opciones: [] };
  if (unidadKey === 'sin-preferencia') {
    q.motivo = 'Sin unidad elegida';
    Object.keys(tarifas.unidades).forEach(function (k) {
      const o = calcularCotizacion_(k, huespedes, checkin, checkout, tarifas);
      if (o.ok) q.opciones.push(o);
    });
    return q;
  }
  const u = tarifas.unidades[unidadKey];
  if (!u || !(u.base > 0) || !(u.adicional >= 0)) { q.motivo = 'Falta la tarifa en la pestaña Tarifas'; return q; }
  if (huespedes > u.max) { q.motivo = 'Más de ' + u.max + ' personas: cotizar aparte'; return q; }
  const paga = tarifas.pagaPorSemana;
  q.tarifaNoche = u.base + Math.max(0, huespedes - tarifas.incluidas) * u.adicional;
  q.nochesPagar = (paga > 0 && paga < 7) ? Math.floor(noches / 7) * paga + (noches % 7) : noches;
  q.promo = q.nochesPagar < noches;
  q.total = q.tarifaNoche * q.nochesPagar;
  q.sena = Math.round(q.total * tarifas.senaPct / 100);
  q.ok = true;
  return q;
}

/** Igual que calcularCotizacion_, pero nunca corta el guardado de la solicitud. */
function cotizar_(unidadKey, huespedes, checkin, checkout) {
  try {
    return calcularCotizacion_(unidadKey, huespedes, checkin, checkout, leerTarifas_());
  } catch (err) {
    console.error('No se pudo calcular la cotización:', err);
    return { ok: false, motivo: 'No se pudo calcular (revisá la pestaña Tarifas)', unidadKey: unidadKey, huespedes: huespedes,
      checkin: checkin, checkout: checkout, noches: daysBetween_(checkin, checkout), opciones: [] };
  }
}

function quoteCells_(q) {
  if (q && q.ok) {
    return { noches: q.noches, tarifaNoche: q.tarifaNoche, nochesPagar: q.nochesPagar, total: q.total, sena: q.sena, cotizacion: QUOTE_LINK_TEXT };
  }
  const motivo = (q && q.motivo) || 'Cotizar aparte';
  const hasOptions = q && q.opciones && q.opciones.length;
  return { noches: q ? q.noches : '', tarifaNoche: motivo, nochesPagar: '', total: '', sena: '', cotizacion: hasOptions ? QUOTE_LINK_TEXT : CHAT_LINK_TEXT };
}

function money_(n) {
  return '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function plural_(n, uno, varios) {
  return n + ' ' + (n === 1 ? uno : varios);
}

/** Mensaje de WhatsApp para el huésped con la cotización (null si no hay nada para cotizar). */
function quoteMessage_(c, q) {
  if (!q || !(q.ok || (q.opciones && q.opciones.length))) return null;
  const first = String(c.nombre || '').split(' ')[0];
  const fechas = 'del ' + toDMY_(q.checkin) + ' al ' + toDMY_(q.checkout) + ' (' + plural_(q.noches, 'noche', 'noches') +
    ', ' + plural_(q.huespedes, 'persona', 'personas') + ')';
  const lines = ['¡Hola ' + first + '! Te escribimos de ' + CONFIG.SITE_NAME + ' por tu solicitud de reserva ' + fechas + '.', ''];
  if (q.ok) {
    lines.push('Te pasamos la tarifa para ' + UNITS[q.unidadKey] + ':');
    lines.push('• Tarifa por noche: ' + money_(q.tarifaNoche));
    if (q.promo) lines.push('• Promo: te quedás ' + plural_(q.noches, 'noche', 'noches') + ' y pagás ' + q.nochesPagar);
    lines.push('• Total de la estadía: ' + money_(q.total));
    lines.push('');
    lines.push('Para confirmar la reserva se abona una seña del ' + q.senaPct + '%: ' + money_(q.sena) + '.');
  } else if (q.opciones && q.opciones.length) {
    lines.push('Te pasamos las opciones disponibles para esas fechas:');
    q.opciones.forEach(function (o) {
      lines.push('• ' + UNITS[o.unidadKey] + ': ' + money_(o.total) + ' en total (' + money_(o.tarifaNoche) + ' por noche)');
    });
    if (q.opciones[0].promo) lines.push('(Precios con la promo: te quedás ' + q.noches + ' noches y pagás ' + q.opciones[0].nochesPagar + ').');
    lines.push('');
    lines.push('Para confirmar la reserva se abona una seña del ' + q.opciones[0].senaPct + '% del total.');
  } else {
    return null;
  }
  lines.push('Check-in: 14:00 hs · Check-out: 10:00 hs.');
  return lines.join('\n');
}

function quoteWhatsappUrl_(c, q) {
  const msg = q ? quoteMessage_(c, q) : null;
  const digits = whatsappDigits_(String(c.telefonoDigits || c.telefono || '').replace(/\D/g, ''));
  if (!digits) return null;
  const text = msg || ('¡Hola ' + String(c.nombre || '').split(' ')[0] + '! Te escribimos de ' + CONFIG.SITE_NAME + ' por tu solicitud de reserva.');
  return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text);
}

/* ------------------------------ EMAILS ------------------------------ */

function notifyOwner_(c, row, quote) {
  if (!CONFIG.NOTIFY_EMAIL) return;
  quote = quote || { ok: false, opciones: [], noches: daysBetween_(c.checkin, c.checkout) };
  const nights = daysBetween_(c.checkin, c.checkout);
  const waGuest = quoteWhatsappUrl_(c, quote);
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
  const quoteRows = [];
  if (quote.ok) {
    quoteRows.push(['Tarifa por noche', money_(quote.tarifaNoche) + ' (' + plural_(c.huespedes, 'persona', 'personas') + ')']);
    quoteRows.push(['Noches a pagar', quote.nochesPagar + (quote.promo ? ' (promo: se queda ' + quote.noches + ')' : '')]);
    quoteRows.push(['Total estimado', money_(quote.total)]);
    quoteRows.push(['Seña (' + quote.senaPct + '%)', money_(quote.sena)]);
  } else if (quote.opciones && quote.opciones.length) {
    quote.opciones.forEach(function (o) {
      quoteRows.push([UNITS[o.unidadKey], money_(o.total) + ' (' + money_(o.tarifaNoche) + ' por noche)']);
    });
  } else {
    quoteRows.push(['Cotización', quote.motivo || 'Cotizar aparte']);
  }

  const tr = function (r, pad) {
    pad = pad || 0;
    return '<tr><td style="padding:6px 12px 6px ' + pad + 'px;color:#5b6457;vertical-align:top">' + esc_(r[0]) +
      '</td><td style="padding:6px ' + pad + 'px 6px 0;font-weight:600;color:#243021;white-space:pre-wrap">' + esc_(r[1]) + '</td></tr>';
  };
  const hasQuote = quote.ok || (quote.opciones && quote.opciones.length);
  const html =
    '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#243021;max-width:560px">' +
    '<h2 style="color:#2b3a28;margin:0 0 12px">Nueva solicitud de reserva</h2>' +
    '<p style="margin:0 0 16px">Llegó una solicitud desde la web. <strong>Todavía no está confirmada</strong>: verificá disponibilidad y contactá al huésped.</p>' +
    '<table style="border-collapse:collapse">' + rows.map(function (r) { return tr(r); }).join('') + '</table>' +
    '<h3 style="color:#2b3a28;margin:20px 0 6px">Cotización' + (quote.opciones && quote.opciones.length ? ' (sin unidad elegida)' : '') + '</h3>' +
    '<table style="border-collapse:collapse;background:#f4eee0;border-radius:8px;margin-top:4px">' + quoteRows.map(function (r) { return tr(r, 14); }).join('') + '</table>' +
    '<p style="margin:20px 0 8px">' +
    (waGuest ? '<a href="' + esc_(waGuest) + '" style="display:inline-block;background:#1b7a43;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:bold">' +
      (hasQuote ? 'Enviar cotización por WhatsApp' : 'Responder por WhatsApp') + '</a> ' : '') +
    '<a href="' + esc_(sheetUrl) + '" style="display:inline-block;margin-left:8px;color:#3e5e45">Ver en la planilla (fila ' + row + ')</a></p>' +
    '<p style="color:#5b6457;font-size:13px">' + (hasQuote ? 'El botón abre WhatsApp con la cotización ya escrita: revisá la disponibilidad antes de enviarla. ' : '') +
    'Si respondés este email, la respuesta le llega directamente al huésped.</p></div>';
  const text = 'Nueva solicitud de reserva (sin confirmar)\n\n' +
    rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n') +
    '\n\nCOTIZACIÓN\n' + quoteRows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n') +
    (waGuest ? '\n\nWhatsApp del huésped: ' + waGuest : '') + '\nPlanilla: ' + sheetUrl;

  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL,
    replyTo: c.email,
    name: 'Web ' + CONFIG.SITE_NAME,
    subject: 'Nueva solicitud: ' + c.nombre + ' · ' + c.unidad + ' · ' + toDMY_(c.checkin) + ' al ' + toDMY_(c.checkout) +
      (quote.ok ? ' · ' + money_(quote.total) : ''),
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

/* ------------------------------ MENÚ DE LA PLANILLA ------------------------------ */

/** Agrega el menú "Las Sierras" al abrir la planilla. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Las Sierras')
    .addItem('1) Enviar reserva y datos para la seña (fila seleccionada)', 'abrirEnvioReserva')
    .addItem('2) Enviar confirmación de reserva: seña recibida (fila seleccionada)', 'abrirConfirmacionReserva')
    .addItem('Actualizar la columna Estado de todas las filas', 'actualizarEstados')
    .addSeparator()
    .addItem('Recalcular cotización de las filas seleccionadas', 'recalcularFilasSeleccionadas')
    .addSeparator()
    .addItem('Preparar pestaña de Tarifas', 'prepararTarifas')
    .addToUi();
}

/** Recalcula la cotización de las filas seleccionadas (por ejemplo, si cambiaste fechas o personas). */
function recalcularFilasSeleccionadas() {
  const ui = SpreadsheetApp.getUi();
  const sheet = getSheet_();
  const active = SpreadsheetApp.getActiveSheet();
  if (!active || active.getSheetId() !== sheet.getSheetId()) {
    ui.alert('Abrí la pestaña de solicitudes, seleccioná una o más filas y volvé a intentarlo.');
    return;
  }
  const rows = {};
  SpreadsheetApp.getActiveRangeList().getRanges().forEach(function (r) {
    for (let i = r.getRow(); i < r.getRow() + r.getNumRows(); i++) if (i > 1) rows[i] = true;
  });
  const list = Object.keys(rows).map(Number).sort(function (a, b) { return a - b; }).slice(0, 300);
  if (!list.length) { ui.alert('Seleccioná al menos una fila de solicitudes (no la fila de títulos).'); return; }
  const res = recalcularFilas_(list);
  let msg = 'Listo: se recalcularon ' + res.ok + ' fila(s).';
  if (res.errores.length) msg += '\n\nNo se pudieron calcular:\n' + res.errores.join('\n');
  ui.alert(msg);
}

function recalcularFilas_(rowNumbers) {
  const sheet = getSheet_();
  const map = ensureColumns_(sheet);
  const tarifas = leerTarifas_();
  const lastCol = sheet.getLastColumn();
  const res = { ok: 0, errores: [] };
  rowNumbers.forEach(function (row) {
    const vals = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
    const disp = sheet.getRange(row, 1, 1, lastCol).getDisplayValues()[0];
    const get = function (k) { return map[k] ? vals[map[k] - 1] : ''; };
    const getD = function (k) { return map[k] ? disp[map[k] - 1] : ''; };
    const c = {
      nombre: str_(getD('nombre')),
      telefono: str_(getD('telefono')),
      unidadKey: unitKeyFromText_(getD('unidad')),
      huespedes: parseInt(String(getD('huespedes')).replace(/\D/g, ''), 10),
      checkin: cellToIso_(get('checkin'), getD('checkin')),
      checkout: cellToIso_(get('checkout'), getD('checkout'))
    };
    c.telefonoDigits = c.telefono.replace(/\D/g, '');
    let problema = '';
    if (!c.unidadKey) problema = 'unidad "' + getD('unidad') + '" no reconocida';
    else if (!(c.huespedes > 0)) problema = 'cantidad de huéspedes vacía';
    else if (!c.checkin || !c.checkout) problema = 'fechas no reconocidas';
    else if (c.checkout <= c.checkin) problema = 'el egreso no es posterior al ingreso';
    if (problema) { res.errores.push('Fila ' + row + ': ' + problema); return; }
    const q = calcularCotizacion_(c.unidadKey, c.huespedes, c.checkin, c.checkout, tarifas);
    writeCells_(sheet, row, map, quoteCells_(q));
    setQuoteLink_(sheet, row, map, c, q);
    if (q.ok || (q.opciones && q.opciones.length)) res.ok++;
    else res.errores.push('Fila ' + row + ': ' + q.motivo);
  });
  return res;
}

/** Reconoce la unidad aunque esté escrita distinto (por ejemplo, respuestas del formulario viejo). */
function unitKeyFromText_(text) {
  const t = normalize_(text);
  if (!t) return '';
  const exact = Object.keys(UNITS).filter(function (k) { return normalize_(UNITS[k]) === t || k === t; })[0];
  if (exact) return exact;
  if (t.indexOf('preferencia') !== -1 || t.indexOf('asesor') !== -1) return 'sin-preferencia';
  if (t.indexOf('cabana') !== -1) return t.indexOf('especial') !== -1 ? 'cabana-especial' : 'cabana-simple';
  if (t.indexOf('bungalow') !== -1) {
    if (t.indexOf('intern') !== -1 || t.indexOf('interior') !== -1) return 'bungalow-bano-interno';
    if (t.indexOf('exterior') !== -1) return 'bungalow-bano-exterior';
    return 'bungalow-simple';
  }
  return '';
}

/** Convierte una celda de fecha (fecha real o texto dd/mm/aaaa) a AAAA-MM-DD. */
function cellToIso_(value, display) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  const m = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(String(display || value || ''));
  if (!m) return '';
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const iso = y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return isIsoDate_(iso) ? iso : '';
}

/** Ejecutala una vez desde el editor: crea la pestaña "Tarifas" y las columnas de cotización. */
function prepararTarifas() {
  const creada = !getTarifasSheet_(false);
  const t = leerTarifas_();
  ensureColumns_(getSheet_());
  console.log(creada ? 'Se creó la pestaña "Tarifas" con los precios iniciales.' : 'La pestaña "Tarifas" ya existía: se usan sus precios.');
  Object.keys(t.unidades).forEach(function (k) {
    const u = t.unidades[k];
    console.log(UNITS[k] + ': ' + money_(u.base) + ' por noche + ' + money_(u.adicional) + ' por persona adicional (máx. ' + u.max + ')');
  });
  console.log('Promo: cada 7 noches se pagan ' + t.pagaPorSemana + ' · Seña: ' + t.senaPct + '% · Personas incluidas: ' + t.incluidas);
  const hoy = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const q = calcularCotizacion_('cabana-simple', 4, hoy, addDaysIso_(hoy, 7), t);
  console.log('Ejemplo · Cabaña Simple, 4 personas, 7 noches: ' + money_(q.tarifaNoche) + ' por noche, paga ' +
    q.nochesPagar + ' noches, total ' + money_(q.total) + ', seña ' + money_(q.sena));
}

function addDaysIso_(iso, n) {
  const p = iso.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
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

/* ======================= ENVÍO DE LA RESERVA CON DATOS PARA SEÑAR ======================= */
/*
 *  Menú "Las Sierras" → "Enviar reserva y datos para la seña (fila seleccionada)".
 *  Abre una ventana con los datos de la fila (unidad, personas, total y seña se pueden
 *  corregir), muestra cómo queda el mensaje y permite enviarlo por WhatsApp y/o por mail.
 *  Cada envío queda anotado en las columnas "Reserva enviada" y "Vence la seña".
 */

// Datos de la cuenta para la seña (revisalos antes de usar)
const CUENTA_SENA = {
  titular: 'COMPLEJO LAS SIERRAS SRL',
  banco: 'Banco ICBC',
  cuenta: 'Cuenta en pesos Nº 0523/02106190/01',
  cuit: '30-71302680-4',
  cbu: '0150523802000106190010',
  alias: 'ComplejoLasSierras'
};

// Horas que tiene el huésped para depositar la seña
const PLAZO_SENA_HORAS = 48;

// Política de cancelación que se incluye en el mensaje (editala si cambia)
const POLITICA_CANCELACION = [
  'Cancelando con 45 días o más de anticipación, se reintegra el 50% de la seña.',
  'Cancelando con menos de 45 días de anticipación, no hay reintegro.',
  'Si te retirás antes de la fecha de egreso, se cobra el total de la estadía. Podés ceder la reserva a otra persona, en las mismas condiciones y para las mismas fechas.',
  'Si no llegás el día de ingreso, guardamos la unidad durante 48 hs. Pasado ese plazo, la reserva se considera cancelada y se aplica esta política.'
];

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Paso 1: abre la ventana para enviar la reserva con los datos para la seña. */
function abrirEnvioReserva() { abrirDialogoReserva_('sena'); }

/** Paso 2: abre la ventana para enviar la confirmación (seña recibida). */
function abrirConfirmacionReserva() { abrirDialogoReserva_('confirmacion'); }

function abrirDialogoReserva_(tipo) {
  const ui = SpreadsheetApp.getUi();
  const sheet = getSheet_();
  const active = SpreadsheetApp.getActiveSheet();
  if (!active || active.getSheetId() !== sheet.getSheetId()) {
    ui.alert('Abrí la pestaña de solicitudes, hacé clic en la fila de la reserva y volvé a intentarlo.');
    return;
  }
  const row = SpreadsheetApp.getActiveRange().getRow();
  if (row < 2) { ui.alert('Hacé clic en la fila de la reserva (no en la fila de títulos).'); return; }

  const map = ensureColumns_(sheet);
  const c = leerFila_(sheet, map, row);
  const problema = problemaFila_(c);
  if (problema) { ui.alert('Fila ' + row + ': ' + problema + '.\n\nCorregí la fila y volvé a intentarlo.'); return; }

  const tarifas = leerTarifas_();
  const unidadKey = c.unidadKey === 'sin-preferencia' ? '' : c.unidadKey;
  let total = 0, sena = 0;
  if (unidadKey) {
    const q = calcularCotizacion_(unidadKey, c.huespedes, c.checkin, c.checkout, tarifas);
    total = q.ok ? q.total : 0;
    sena = q.ok ? q.sena : 0;
  }
  // Si en la planilla se corrigió el total o la seña a mano, se respeta lo de la planilla
  if (unidadKey && c.totalCelda > 0) total = c.totalCelda;
  if (unidadKey && c.senaCelda > 0) sena = c.senaCelda;
  if (tipo === 'confirmacion' && !unidadKey) total = sena = 0;

  const vence = new Date(Date.now() + PLAZO_SENA_HORAS * 3600000);
  const data = {
    tipo: tipo,
    row: row,
    nombre: c.nombre,
    email: c.email,
    telefono: c.telefono,
    checkin: c.checkin,
    checkout: c.checkout,
    noches: daysBetween_(c.checkin, c.checkout),
    unidadKey: unidadKey,
    huespedes: c.huespedes,
    total: total,
    sena: sena,
    senaPct: tarifas.senaPct,
    vence: Utilities.formatDate(vence, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm"),
    enviada: c.enviada,
    confirmada: c.confirmada,
    unidades: Object.keys(UNITS).filter(function (k) { return k !== 'sin-preferencia'; })
      .map(function (k) { return { key: k, label: UNITS[k] }; })
  };
  const html = HtmlService.createHtmlOutput(dialogoEnvioHtml_(data)).setWidth(760).setHeight(640);
  ui.showModalDialog(html, (tipo === 'confirmacion' ? 'Confirmar reserva (seña recibida)' : 'Enviar reserva y datos para la seña') +
    ' · fila ' + row + ' · ' + c.nombre);
}

/** Lee una fila de la planilla de solicitudes. */
function leerFila_(sheet, map, row) {
  const lastCol = sheet.getLastColumn();
  const vals = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  const disp = sheet.getRange(row, 1, 1, lastCol).getDisplayValues()[0];
  const get = function (k) { return map[k] ? vals[map[k] - 1] : ''; };
  const getD = function (k) { return map[k] ? disp[map[k] - 1] : ''; };
  const c = {
    row: row,
    nombre: collapse_(getD('nombre')),
    email: str_(getD('email')).toLowerCase(),
    telefono: str_(getD('telefono')),
    unidadTexto: str_(getD('unidad')),
    unidadKey: unitKeyFromText_(getD('unidad')),
    huespedes: parseInt(String(getD('huespedes')).replace(/\D/g, ''), 10),
    checkin: cellToIso_(get('checkin'), getD('checkin')),
    checkout: cellToIso_(get('checkout'), getD('checkout')),
    totalCelda: parseNumber_(get('total')),
    senaCelda: parseNumber_(get('sena')),
    enviada: str_(getD('enviada')),
    confirmada: str_(getD('confirmada'))
  };
  c.telefonoDigits = c.telefono.replace(/\D/g, '');
  return c;
}

function problemaFila_(c) {
  if (!c.nombre) return 'falta el nombre';
  if (!c.unidadKey) return 'la unidad "' + c.unidadTexto + '" no se reconoce';
  if (!(c.huespedes > 0)) return 'falta la cantidad de huéspedes';
  if (!c.checkin || !c.checkout) return 'no se reconocen las fechas de ingreso y egreso';
  if (c.checkout <= c.checkin) return 'la fecha de egreso no es posterior a la de ingreso';
  return '';
}

/** (Ventana) Cotiza de nuevo cuando se cambia la unidad o la cantidad de personas. */
function cotizarParaEnvio(unidadKey, huespedes, checkin, checkout) {
  const q = calcularCotizacion_(String(unidadKey), Number(huespedes), String(checkin), String(checkout), leerTarifas_());
  return { ok: q.ok, motivo: q.motivo, total: q.total || 0, sena: q.sena || 0 };
}

/** (Ventana) Devuelve el mensaje de WhatsApp, el enlace y el mail tal como se van a enviar. */
function vistaPreviaReserva(d) {
  const r = armarReserva_(d);
  const mail = r.confirmacion ? emailConfirmacion_(r) : emailReserva_(r);
  const wa = r.confirmacion ? mensajeConfirmacionWhatsapp_(r) : mensajeReservaWhatsapp_(r);
  return {
    errores: r.errores,
    whatsappTexto: wa,
    whatsappUrl: r.waDigits ? 'https://wa.me/' + r.waDigits + '?text=' + encodeURIComponent(wa) : '',
    mailAsunto: mail.subject,
    mailHtml: mail.html
  };
}

/** (Ventana) Anota en la planilla que se abrió WhatsApp con la reserva. */
function registrarEnvioWhatsapp(d) {
  const r = armarReserva_(d);
  const aviso = registrarEnvio_(r, 'WhatsApp');
  return 'Anotado en la planilla.' + (aviso ? ' ' + aviso : '');
}

/** (Ventana) Envía la reserva por mail al huésped (con copia al complejo) y lo anota en la planilla. */
function enviarReservaPorMail(d) {
  const r = armarReserva_(d);
  if (r.errores.length) throw new Error(r.errores.join(' '));
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!EMAIL_RE.test(r.email)) throw new Error('El email del huésped no es válido: ' + r.email);
  const mail = r.confirmacion ? emailConfirmacion_(r) : emailReserva_(r);
  const options = {
    to: r.email,
    name: CONFIG.SITE_NAME,
    subject: mail.subject,
    body: mail.text,
    htmlBody: mail.html
  };
  if (CONFIG.NOTIFY_EMAIL) {
    options.replyTo = CONFIG.NOTIFY_EMAIL;
    options.bcc = CONFIG.NOTIFY_EMAIL;           // copia para el complejo
  }
  MailApp.sendEmail(options);
  const aviso = registrarEnvio_(r, 'mail');
  return 'Mail enviado a ' + r.email + '.' + (aviso ? ' ' + aviso : '');
}

/**
 * Junta los datos de la fila (nombre y fechas salen siempre de la planilla) con lo
 * que se corrigió en la ventana (unidad, personas, total, seña, vencimiento, contacto).
 */
function armarReserva_(d) {
  d = d || {};
  const row = parseInt(d.row, 10);
  if (!(row >= 2)) throw new Error('Fila no válida.');
  const sheet = getSheet_();
  const map = ensureColumns_(sheet);
  const c = leerFila_(sheet, map, row);
  const r = {
    row: row,
    nombre: c.nombre,
    primerNombre: c.nombre.split(' ')[0],
    email: str_(d.email || c.email).toLowerCase(),
    telefono: str_(d.telefono || c.telefono),
    checkin: c.checkin,
    checkout: c.checkout,
    unidadKey: str_(d.unidadKey),
    huespedes: parseInt(d.huespedes, 10),
    confirmacion: d.tipo === 'confirmacion',
    total: Math.round(Number(d.total) || 0),
    sena: Math.round(Number(d.sena) || 0),
    errores: []
  };
  const p = problemaFila_(c);
  if (p) r.errores.push('Fila ' + row + ': ' + p + '.');
  if (!Object.prototype.hasOwnProperty.call(UNITS, r.unidadKey) || r.unidadKey === 'sin-preferencia') r.errores.push('Elegí la unidad.');
  if (!(r.huespedes > 0)) r.errores.push('Indicá la cantidad de personas.');
  if (!(r.total > 0)) r.errores.push('Indicá el total de la estadía.');
  if (!(r.sena > 0)) r.errores.push(d.tipo === 'confirmacion' ? 'Indicá la seña recibida.' : 'Indicá la seña.');
  if (r.sena > r.total) r.errores.push('La seña no puede ser mayor que el total.');

  r.unidad = UNITS[r.unidadKey] || '';
  r.noches = (r.checkin && r.checkout) ? daysBetween_(r.checkin, r.checkout) : 0;
  r.saldo = r.total - r.sena;
  r.senaPct = r.total > 0 ? Math.round(r.sena * 100 / r.total) : 0;

  // Tarifa por noche y promo: se muestran solo si el total coincide con la tarifa de la pestaña Tarifas
  r.tarifaNoche = 0; r.nochesPagar = r.noches; r.promo = false;
  if (r.unidad && r.huespedes > 0 && r.noches > 0) {
    const q = calcularCotizacion_(r.unidadKey, r.huespedes, r.checkin, r.checkout, leerTarifas_());
    if (q.ok && q.total === r.total) { r.tarifaNoche = q.tarifaNoche; r.nochesPagar = q.nochesPagar; r.promo = q.promo; }
  }

  const venceTxt = str_(d.vence).replace('T', ' ');
  let vence = null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(venceTxt)) vence = Utilities.parseDate(venceTxt, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');
  if (!vence || isNaN(vence.getTime())) vence = new Date(Date.now() + PLAZO_SENA_HORAS * 3600000);
  r.vence = vence;
  r.venceTexto = fechaHoraLarga_(vence);
  r.waDigits = whatsappDigits_(r.telefono.replace(/\D/g, ''));
  if (r.waDigits.length < 11) r.waDigits = '';
  return r;
}

/** Anota el envío en "Reserva enviada" y "Vence la seña" (paso 1) o en "Confirmación enviada" (paso 2). */
function registrarEnvio_(r, canal) {
  const sheet = getSheet_();
  const map = ensureColumns_(sheet);
  const col = r.confirmacion ? 'confirmada' : 'enviada';
  const actual = str_(sheet.getRange(r.row, map[col]).getDisplayValue());
  const nuevo = canal + ' ' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM HH:mm');
  const values = {};
  values[col] = actual ? actual + ' · ' + nuevo : nuevo;
  if (r.confirmacion) values[col] = values[col] + (actual ? '' : ' · seña ' + money_(r.sena));
  else values.venceSena = Utilities.formatDate(r.vence, CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm');
  writeCells_(sheet, r.row, map, values);
  return setEstado_(sheet, r.row, r.confirmacion ? ESTADOS.CONF : ESTADOS.ENV, true);
}

/* ------------------------- Textos del mensaje ------------------------- */

function fechaLarga_(iso) {
  const p = iso.split('-').map(Number);
  const dia = DIAS_SEMANA[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  return dia + ' ' + toDMY_(iso);
}

function fechaHoraLarga_(date) {
  const iso = Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  return fechaLarga_(iso) + ' a las ' + Utilities.formatDate(date, CONFIG.TIMEZONE, 'HH:mm') + ' hs';
}

/** Lista [título, valor] con el detalle de la reserva (se usa en WhatsApp y en el mail). */
function detalleReserva_(r) {
  const filas = [
    ['A nombre de', r.nombre],
    ['Ingreso', fechaLarga_(r.checkin) + ', desde las 14 hs'],
    ['Egreso', fechaLarga_(r.checkout) + ', hasta las 10 hs'],
    ['Noches', String(r.noches) + (r.promo ? ' (promo: pagás ' + r.nochesPagar + ')' : '')],
    ['Unidad', r.unidad],
    ['Personas', String(r.huespedes)]
  ];
  if (r.tarifaNoche) filas.push(['Tarifa por noche', money_(r.tarifaNoche)]);
  filas.push(['Total de la estadía', money_(r.total)]);
  if (r.confirmacion) {
    filas.push(['Seña recibida', money_(r.sena)]);
    filas.push(['Saldo a pagar', money_(r.saldo) + ', en efectivo al hacer el check-in']);
  } else {
    filas.push(['Seña a depositar (' + r.senaPct + '%)', money_(r.sena)]);
    filas.push(['Saldo', money_(r.saldo) + ', en efectivo al llegar al complejo']);
  }
  return filas;
}

function cuentaSena_() {
  return [
    ['Titular', CUENTA_SENA.titular],
    ['CUIT', CUENTA_SENA.cuit],
    ['CBU', CUENTA_SENA.cbu],
    ['Alias', CUENTA_SENA.alias],
    ['Cuenta', CUENTA_SENA.banco + ' · ' + CUENTA_SENA.cuenta]
  ];
}

function mensajeReservaWhatsapp_(r) {
  const L = [];
  L.push('¡Hola ' + r.primerNombre + '! Te enviamos los datos de tu reserva en *' + CONFIG.SITE_NAME + '*. Por favor revisalos y avisanos si hay algún error.');
  L.push('');
  detalleReserva_(r).forEach(function (f) { L.push('*' + f[0] + ':* ' + f[1]); });
  L.push('');
  L.push('*Depositá la seña hasta el ' + r.venceTexto + '.* La reserva ya está agendada y queda confirmada cuando recibimos la seña. Pasado ese plazo, queda sin efecto.');
  L.push('');
  L.push('*Datos para la transferencia*');
  cuentaSena_().forEach(function (f) { L.push(f[0] + ': ' + f[1]); });
  L.push('');
  L.push('Cuando hagas la transferencia, mandanos el comprobante por acá y te confirmamos la reserva.');
  L.push('');
  L.push('*Importante:* el saldo se paga en efectivo al ingresar al complejo, sin excepción: solo se puede ingresar con el total de la estadía pagado. Al llegar controlamos la reserva y la cantidad de personas. Depositar la seña implica aceptar estas condiciones.');
  L.push('');
  L.push('*Política de cancelación*');
  POLITICA_CANCELACION.forEach(function (t) { L.push('• ' + t); });
  L.push('');
  L.push('¡Muchas gracias! ' + CONFIG.SITE_NAME);
  return L.join('\n');
}

function emailReserva_(r) {
  const VERDE = '#43664a', OSCURO = '#243021', GRIS = '#5b6457', ROJO = '#c82613', ARENA = '#f4eee0';
  const tabla = function (filas, fondo) {
    return '<table style="border-collapse:collapse;width:100%;' + (fondo ? 'background:' + fondo + ';border-radius:8px' : '') + '">' +
      filas.map(function (f) {
        return '<tr><td style="padding:7px 14px;color:' + GRIS + ';vertical-align:top;white-space:nowrap">' + esc_(f[0]) +
          '</td><td style="padding:7px 14px;font-weight:600;color:' + OSCURO + '">' + esc_(f[1]) + '</td></tr>';
      }).join('') + '</table>';
  };
  const p = function (t, extra) { return '<p style="margin:0 0 12px;' + (extra || '') + '">' + t + '</p>'; };
  const h = function (t) { return '<h3 style="color:' + VERDE + ';margin:24px 0 8px;font-size:17px">' + esc_(t) + '</h3>'; };
  const waComplejo = 'https://wa.me/' + CONFIG.WHATSAPP;
  const comprobante = 'Una vez hecha la transferencia, envianos el comprobante respondiendo este mail o por ' +
    '<a href="' + esc_(waComplejo) + '" style="color:' + VERDE + '">WhatsApp</a>, y te confirmamos la reserva.';

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:' + OSCURO + ';max-width:600px">' +
    '<h2 style="color:' + VERDE + ';margin:0 0 4px;font-size:24px">' + esc_(CONFIG.SITE_NAME) + '</h2>' +
    p('Datos de tu reserva', 'color:#d99d55;font-weight:bold;font-size:17px') +
    p('Hola ' + esc_(r.primerNombre) + ':') +
    p('Te enviamos los datos de tu reserva. Por favor revisá que estén correctos y avisanos si hay algún error o si tenés alguna duda.') +
    tabla(detalleReserva_(r), ARENA) +
    '<div style="margin:18px 0;padding:12px 14px;border-left:4px solid ' + ROJO + ';background:#fbefec">' +
    '<strong style="color:' + ROJO + '">Último día para depositar la seña: ' + esc_(r.venceTexto) + '.</strong><br>' +
    'La reserva ya está agendada y se confirma cuando recibimos la seña. Pasado ese plazo, queda sin efecto.</div>' +
    h('Datos para la transferencia') +
    tabla(cuentaSena_()) +
    p(comprobante, 'margin-top:14px') +
    h('Importante') +
    p('Desde que recibimos la seña, la unidad queda reservada. <strong>El saldo se paga en efectivo al ingresar al complejo, sin excepción</strong>: ' +
      'solo se puede ingresar con el total de la estadía pagado. Al llegar, la administración controla la reserva y la cantidad de personas.') +
    p('Depositar la seña implica aceptar estas condiciones.') +
    h('Política de cancelación y no show') +
    '<ul style="margin:0 0 12px;padding-left:20px">' + POLITICA_CANCELACION.map(function (t) { return '<li style="margin-bottom:6px">' + esc_(t) + '</li>'; }).join('') + '</ul>' +
    p('<strong>¡Muchas gracias!</strong><br>' + esc_(CONFIG.SITE_NAME), 'margin-top:20px;color:' + VERDE) +
    p('<a href="' + esc_(CONFIG.SITE_URL) + '" style="color:' + GRIS + '">' + esc_(CONFIG.SITE_URL.replace('https://', '')) + '</a> · ' +
      '<a href="' + esc_(waComplejo) + '" style="color:' + GRIS + '">WhatsApp</a>', 'font-size:13px') +
    '</div>';

  const T = [];
  T.push('Hola ' + r.primerNombre + ':', '', 'Te enviamos los datos de tu reserva en ' + CONFIG.SITE_NAME + '. Por favor revisá que estén correctos y avisanos si hay algún error.', '');
  detalleReserva_(r).forEach(function (f) { T.push(f[0] + ': ' + f[1]); });
  T.push('', 'ÚLTIMO DÍA PARA DEPOSITAR LA SEÑA: ' + r.venceTexto + '.', 'La reserva ya está agendada y se confirma cuando recibimos la seña. Pasado ese plazo, queda sin efecto.', '');
  T.push('DATOS PARA LA TRANSFERENCIA');
  cuentaSena_().forEach(function (f) { T.push(f[0] + ': ' + f[1]); });
  T.push('', 'Una vez hecha la transferencia, envianos el comprobante respondiendo este mail o por WhatsApp (' + waComplejo + ').', '');
  T.push('IMPORTANTE: el saldo se paga en efectivo al ingresar al complejo, sin excepción. Solo se puede ingresar con el total de la estadía pagado. Depositar la seña implica aceptar estas condiciones.', '');
  T.push('POLÍTICA DE CANCELACIÓN');
  POLITICA_CANCELACION.forEach(function (t) { T.push('- ' + t); });
  T.push('', '¡Muchas gracias!', CONFIG.SITE_NAME, CONFIG.SITE_URL);

  return {
    subject: 'Tu reserva en ' + CONFIG.SITE_NAME + ' · ' + toDMY_(r.checkin).slice(0, 5) + ' al ' + toDMY_(r.checkout).slice(0, 5) + ' · datos para la seña',
    html: html,
    text: T.join('\n')
  };
}

/* ------------------------- Textos de la confirmación (seña recibida) ------------------------- */

function mensajeConfirmacionWhatsapp_(r) {
  const L = [];
  L.push('¡Hola ' + r.primerNombre + '! Recibimos tu seña y tu reserva en *' + CONFIG.SITE_NAME + '* quedó *CONFIRMADA*.');
  L.push('');
  detalleReserva_(r).forEach(function (f) { L.push('*' + f[0] + ':* ' + f[1]); });
  L.push('');
  L.push('Por favor revisá que los datos estén bien y guardá este mensaje. Al llegar, presentá en la recepción el comprobante de la transferencia.');
  L.push('');
  L.push('*Importante:* la unidad queda reservada exclusivamente para vos. Solo se puede ingresar con el total de la estadía pagado: el saldo se abona en efectivo en la administración del complejo. Haber depositado la seña y recibido esta confirmación implica aceptar nuestras condiciones.');
  L.push('');
  L.push('*Política de cancelación*');
  POLITICA_CANCELACION.forEach(function (t) { L.push('• ' + t); });
  L.push('');
  L.push('¡Muchas gracias y los esperamos! ' + CONFIG.SITE_NAME);
  return L.join('\n');
}

function emailConfirmacion_(r) {
  const VERDE = '#43664a', OSCURO = '#243021', GRIS = '#5b6457', ARENA = '#f4eee0', OK = '#1b7a43';
  const tabla = function (filas) {
    return '<table style="border-collapse:collapse;width:100%;background:' + ARENA + ';border-radius:8px">' +
      filas.map(function (f) {
        return '<tr><td style="padding:7px 14px;color:' + GRIS + ';vertical-align:top;white-space:nowrap">' + esc_(f[0]) +
          '</td><td style="padding:7px 14px;font-weight:600;color:' + OSCURO + '">' + esc_(f[1]) + '</td></tr>';
      }).join('') + '</table>';
  };
  const p = function (t, extra) { return '<p style="margin:0 0 12px;' + (extra || '') + '">' + t + '</p>'; };
  const h = function (t) { return '<h3 style="color:' + VERDE + ';margin:24px 0 8px;font-size:17px">' + esc_(t) + '</h3>'; };
  const waComplejo = 'https://wa.me/' + CONFIG.WHATSAPP;

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:' + OSCURO + ';max-width:600px">' +
    '<h2 style="color:' + VERDE + ';margin:0 0 14px;font-size:24px">' + esc_(CONFIG.SITE_NAME) + '</h2>' +
    '<div style="margin:0 0 18px;padding:12px 14px;border-left:4px solid ' + OK + ';background:#e8f4ec">' +
    '<strong style="color:' + OK + ';font-size:17px">Reserva confirmada</strong><br>Recibimos tu seña. ¡Gracias!</div>' +
    p('Hola ' + esc_(r.primerNombre) + ':') +
    p('Te confirmamos la recepción de la seña y la siguiente reserva:') +
    tabla(detalleReserva_(r)) +
    p('Por favor controlá que los datos estén bien y guardá o imprimí esta confirmación. ' +
      '<strong>Al llegar, presentá en la recepción el comprobante de la transferencia.</strong>', 'margin-top:16px') +
    h('Importante') +
    p('Esta reserva está realizada y la unidad queda reservada exclusivamente para vos.') +
    p('<strong>Solo se puede ingresar con el total de la estadía pagado</strong>: el saldo se abona en efectivo en la administración del complejo.') +
    p('Haber depositado la seña y recibido esta confirmación implica aceptar nuestras condiciones.') +
    h('Política de cancelación y no show') +
    '<ul style="margin:0 0 12px;padding-left:20px">' + POLITICA_CANCELACION.map(function (t) { return '<li style="margin-bottom:6px">' + esc_(t) + '</li>'; }).join('') + '</ul>' +
    p('<strong>¡Muchas gracias y los esperamos!</strong><br>' + esc_(CONFIG.SITE_NAME), 'margin-top:20px;color:' + VERDE) +
    p('<a href="' + esc_(CONFIG.SITE_URL) + '" style="color:' + GRIS + '">' + esc_(CONFIG.SITE_URL.replace('https://', '')) + '</a> · ' +
      '<a href="' + esc_(waComplejo) + '" style="color:' + GRIS + '">WhatsApp</a>', 'font-size:13px') +
    '</div>';

  const T = [];
  T.push('Hola ' + r.primerNombre + ':', '', 'RESERVA CONFIRMADA. Te confirmamos la recepción de la seña y la siguiente reserva en ' + CONFIG.SITE_NAME + ':', '');
  detalleReserva_(r).forEach(function (f) { T.push(f[0] + ': ' + f[1]); });
  T.push('', 'Por favor controlá que los datos estén bien y guardá o imprimí esta confirmación. Al llegar, presentá en la recepción el comprobante de la transferencia.', '');
  T.push('IMPORTANTE: la unidad queda reservada exclusivamente para vos. Solo se puede ingresar con el total de la estadía pagado; el saldo se abona en efectivo en la administración del complejo. Haber depositado la seña y recibido esta confirmación implica aceptar nuestras condiciones.', '');
  T.push('POLÍTICA DE CANCELACIÓN');
  POLITICA_CANCELACION.forEach(function (t) { T.push('- ' + t); });
  T.push('', '¡Muchas gracias y los esperamos!', CONFIG.SITE_NAME, CONFIG.SITE_URL);

  return {
    subject: 'Reserva confirmada · ' + CONFIG.SITE_NAME + ' · ' + toDMY_(r.checkin).slice(0, 5) + ' al ' + toDMY_(r.checkout).slice(0, 5),
    html: html,
    text: T.join('\n')
  };
}

/* ------------------------- Ventana (HTML) ------------------------- */

function dialogoEnvioHtml_(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return [
    '<!DOCTYPE html><html><head><base target="_top"><style>',
    'body{font-family:Arial,sans-serif;font-size:14px;color:#243021;margin:0;padding:4px 8px}',
    '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 14px;margin-bottom:12px}',
    'label{display:block;font-size:12px;color:#5b6457;margin-bottom:3px}',
    'input,select{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #c9cfc4;border-radius:6px;font-size:14px}',
    '.fijo{padding:6px 0;font-weight:bold}',
    '.aviso{background:#fff6dc;border:1px solid #e9cf7d;padding:8px 10px;border-radius:6px;margin-bottom:10px}',
    '.error{color:#c82613;font-weight:bold;margin:6px 0}',
    '.tabs button{border:0;background:#e9ede5;padding:7px 14px;border-radius:6px 6px 0 0;cursor:pointer;font-size:13px}',
    '.tabs button.on{background:#43664a;color:#fff}',
    '#prev{border:1px solid #c9cfc4;height:250px;overflow:auto;padding:10px;border-radius:0 6px 6px 6px;background:#fff}',
    '#prevWa{white-space:pre-wrap;font-size:13px;margin:0;font-family:Arial,sans-serif}',
    '.acciones{display:flex;gap:10px;margin-top:12px;align-items:center;flex-wrap:wrap}',
    '.btn{display:inline-block;padding:10px 18px;border-radius:999px;font-weight:bold;text-decoration:none;border:0;cursor:pointer;font-size:14px}',
    '.wa{background:#1b7a43;color:#fff}.mail{background:#43664a;color:#fff}.sec{background:#e9ede5;color:#243021}',
    '.off{opacity:.45;pointer-events:none}',
    '#estado{font-size:13px;color:#1b7a43;font-weight:bold}',
    '</style></head><body>',
    '<div id="yaEnviada" class="aviso" style="display:none"></div>',
    '<div class="grid">',
    '<div><label>Huésped</label><div class="fijo" id="nombre"></div></div>',
    '<div><label>Fechas</label><div class="fijo" id="fechas"></div></div>',
    '<div><label>Unidad</label><select id="unidad"></select></div>',
    '<div><label>Personas</label><input id="huespedes" type="number" min="1" max="20"></div>',
    '<div><label>Total de la estadía ($)</label><input id="total" inputmode="numeric"></div>',
    '<div><label id="lSena">Seña ($)</label><input id="sena" inputmode="numeric"></div>',
    '<div id="bVence"><label>Vence la seña</label><input id="vence" type="datetime-local"></div>',
    '<div><label>WhatsApp del huésped</label><input id="telefono"></div>',
    '<div><label>Email del huésped</label><input id="email" type="email"></div>',
    '</div>',
    '<div id="errores" class="error"></div>',
    '<div class="tabs"><button id="tWa" class="on" type="button">Vista previa WhatsApp</button> <button id="tMail" type="button">Vista previa mail</button></div>',
    '<div id="prev"><pre id="prevWa">Preparando…</pre><div id="prevMail" style="display:none"></div></div>',
    '<div class="acciones">',
    '<a id="btnWa" class="btn wa off" href="#" target="_blank" rel="noopener">Enviar por WhatsApp</a>',
    '<button id="btnMail" class="btn mail off" type="button">Enviar por mail</button>',
    '<button class="btn sec" type="button" onclick="google.script.host.close()">Cerrar</button>',
    '<span id="estado"></span>',
    '</div>',
    '<script>',
    'var D=' + json + ';',
    'var $=function(i){return document.getElementById(i)};',
    'var timer=null,listo=false,senaManual=false;',
    'function num(s){return Number(String(s).replace(/[^0-9]/g,""))||0}',
    'function fmt(n){return n?String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g,"."):""}',
    'function dmy(i){var p=i.split("-");return p[2]+"/"+p[1]+"/"+p[0]}',
    'function datos(){return{tipo:D.tipo,row:D.row,unidadKey:$("unidad").value,huespedes:num($("huespedes").value),total:num($("total").value),sena:num($("sena").value),vence:$("vence").value,telefono:$("telefono").value,email:$("email").value}}',
    'function bloquear(){if(window.bloquear2)bloquear2();listo=false;$("btnWa").classList.add("off");$("btnMail").classList.add("off")}',
    'function refrescar(){bloquear();clearTimeout(timer);timer=setTimeout(function(){',
    '  google.script.run.withSuccessHandler(function(r){',
    '    $("errores").textContent=r.errores.join(" ");',
    '    $("prevWa").textContent=r.whatsappTexto;',
    '    var f=document.createElement("iframe");f.style.cssText="width:100%;height:600px;border:0";$("prevMail").innerHTML="<div style=\\"font-size:12px;color:#5b6457;margin-bottom:6px\\">Asunto: <b></b></div>";$("prevMail").querySelector("b").textContent=r.mailAsunto;$("prevMail").appendChild(f);f.srcdoc=r.mailHtml;',
    '    if(r.errores.length)return;listo=true;',
    '    if(r.whatsappUrl){$("btnWa").href=r.whatsappUrl;$("btnWa").classList.remove("off")}',
    '    if($("email").value)$("btnMail").classList.remove("off");',
    '  }).withFailureHandler(function(e){$("errores").textContent="Error: "+e.message}).vistaPreviaReserva(datos());',
    '},350)}',
    'function recotizar(){bloquear();var u=$("unidad").value,h=num($("huespedes").value);if(!u||!h){refrescar();return}',
    '  google.script.run.withSuccessHandler(function(q){',
    '    if(q.ok){$("total").value=fmt(q.total);if(!CONF){$("sena").value=fmt(q.sena);senaManual=false}}else{$("errores").textContent=q.motivo+": completá el total y la seña a mano."}',
    '    refrescar()}).cotizarParaEnvio(u,h,D.checkin,D.checkout)}',
    '$("nombre").textContent=D.nombre;',
    '$("fechas").textContent=dmy(D.checkin)+" al "+dmy(D.checkout)+" ("+D.noches+(D.noches==1?" noche)":" noches)");',
    'var s=$("unidad");var o0=document.createElement("option");o0.value="";o0.textContent="Elegí la unidad…";s.appendChild(o0);',
    'D.unidades.forEach(function(u){var o=document.createElement("option");o.value=u.key;o.textContent=u.label;s.appendChild(o)});',
    's.value=D.unidadKey;$("huespedes").value=D.huespedes;$("total").value=fmt(D.total);$("sena").value=fmt(D.sena);',
    '$("vence").value=D.vence;$("telefono").value=D.telefono;$("email").value=D.email;',
    'var CONF=D.tipo==="confirmacion";',
    'if(CONF){$("lSena").textContent="Seña recibida ($)";$("bVence").style.display="none";$("btnWa").textContent="Enviar confirmación por WhatsApp";$("btnMail").textContent="Enviar confirmación por mail";',
    '  if(!D.enviada){$("yaEnviada").style.display="block";$("yaEnviada").textContent="Ojo: en esta fila no figura que se hayan enviado los datos para la seña. Verificá en el homebanking que la seña se acreditó antes de confirmar."}}',
    'var ya=CONF?D.confirmada:D.enviada;',
    'if(ya){$("yaEnviada").style.display="block";$("yaEnviada").textContent=(CONF?"La confirmación ya se envió: ":"Esta reserva ya se envió: ")+ya+". Si la volvés a enviar, queda anotado de nuevo."}',
    's.onchange=recotizar;$("huespedes").onchange=recotizar;',
    '$("total").oninput=function(){if(!senaManual&&!CONF)$("sena").value=fmt(Math.round(num(this.value)*D.senaPct/100));refrescar()};',
    '$("total").onblur=function(){this.value=fmt(num(this.value))};',
    '$("sena").oninput=function(){senaManual=true;refrescar()};$("sena").onblur=function(){this.value=fmt(num(this.value))};',
    '["vence","telefono","email"].forEach(function(i){$(i).oninput=refrescar});',
    '$("tWa").onclick=function(){this.className="on";$("tMail").className="";$("prevWa").style.display="block";$("prevMail").style.display="none"};',
    '$("tMail").onclick=function(){this.className="on";$("tWa").className="";$("prevWa").style.display="none";$("prevMail").style.display="block"};',
    '$("btnWa").onclick=function(){if(!listo)return false;google.script.run.withSuccessHandler(function(m){$("estado").textContent="WhatsApp abierto. "+m}).registrarEnvioWhatsapp(datos());return true};',
    'var confirmar=false;',
    'function bloquear2(){confirmar=false;$("btnMail").textContent=D.tipo==="confirmacion"?"Enviar confirmación por mail":"Enviar por mail"}',
    '$("btnMail").onclick=function(){if(!listo)return;if(!confirmar){confirmar=true;this.textContent="Confirmar envío a "+$("email").value;return}bloquear2();bloquear();$("estado").textContent="Enviando…";',
    '  google.script.run.withSuccessHandler(function(m){$("estado").textContent=m;refrescar()}).withFailureHandler(function(e){$("estado").textContent="";$("errores").textContent="No se pudo enviar: "+e.message;refrescar()}).enviarReservaPorMail(datos())};',
    'refrescar();',
    '</script></body></html>'
  ].join('\n');
}


/* ======================= COLUMNA ESTADO ======================= */
/*
 *  "No enviada"  → la solicitud llegó y todavía no se mandaron los datos para la seña.
 *  "Enviada"     → se mandaron los datos para la seña (paso 1).
 *  "Confirmada"  → se recibió la seña y se mandó la confirmación (paso 2).
 *  Se usa la columna "Estado" (o "Status") que ya exista; si no hay, se crea "Estado".
 *  Otros valores escritos a mano (por ejemplo "Cancelada") se respetan al actualizar.
 */
const ESTADOS = { NO: 'No enviada', ENV: 'Enviada', CONF: 'Confirmada' };
const ESTADO_HEADERS = ['estado', 'status', 'estado de la reserva'];

function rangoEstado_(v) {
  const t = normalize_(v);
  if (!t || t === normalize_(ESTADOS.NO)) return 0;
  if (t === normalize_(ESTADOS.ENV)) return 1;
  if (t === normalize_(ESTADOS.CONF)) return 2;
  return -1; // otro valor puesto a mano
}

/** Devuelve el número de la columna Estado (la crea si no existe). */
function columnaEstado_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(normalize_);
  for (let i = 0; i < headers.length; i++) if (ESTADO_HEADERS.indexOf(headers[i]) !== -1) return i + 1;
  const col = lastCol + 1;
  sheet.getRange(1, col).setValue('Estado');
  try {
    const regla = SpreadsheetApp.newDataValidation()
      .requireValueInList([ESTADOS.NO, ESTADOS.ENV, ESTADOS.CONF], true).setAllowInvalid(true).build();
    sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(regla);
  } catch (err) { console.warn('No se pudo poner la lista desplegable en Estado: ' + err); }
  colorearEstado_(sheet, col);
  return col;
}

/** Colores: gris "No enviada", amarillo "Enviada", verde "Confirmada" (solo si no estaban). */
function colorearEstado_(sheet, col) {
  try {
    const rules = sheet.getConditionalFormatRules();
    const ya = rules.some(function (r) {
      const c = r.getBooleanCondition();
      return c && String(c.getCriteriaValues()[0]) === ESTADOS.CONF &&
        r.getRanges().some(function (g) { return g.getColumn() === col; });
    });
    if (ya) return;
    const rango = sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1);
    const regla = function (txt, fondo, letra) {
      return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt)
        .setBackground(fondo).setFontColor(letra).setRanges([rango]).build();
    };
    rules.push(regla(ESTADOS.NO, '#eeeeee', '#555555'), regla(ESTADOS.ENV, '#fff1c2', '#7a5a00'), regla(ESTADOS.CONF, '#d4edda', '#1b6b34'));
    sheet.setConditionalFormatRules(rules);
  } catch (err) { console.warn('No se pudieron poner los colores de Estado: ' + err); }
}

/**
 * Escribe el estado de una fila. Con forzar=true (al enviar) pisa lo que haya,
 * salvo que ya esté "Confirmada" y se intente volver a "Enviada".
 * Devuelve '' si salió bien o un aviso si no se pudo escribir.
 */
function setEstado_(sheet, row, estado, forzar) {
  const col = columnaEstado_(sheet);
  const cell = sheet.getRange(row, col);
  const actual = rangoEstado_(cell.getDisplayValue());
  const nuevo = rangoEstado_(estado);
  if (actual === 2 && nuevo < 2) return '';
  if (!forzar && (actual === -1 || (str_(cell.getDisplayValue()) && actual >= nuevo))) return '';
  try {
    cell.setValue(estado);
    SpreadsheetApp.flush();
    return '';
  } catch (err) {
    console.warn('No se pudo escribir el Estado: ' + err);
    return 'No se pudo poner "' + estado + '" en la columna Estado: revisá que la lista desplegable de esa columna tenga las opciones "' +
      ESTADOS.NO + '", "' + ESTADOS.ENV + '" y "' + ESTADOS.CONF + '".';
  }
}

/** Menú: completa el Estado de todas las filas según lo que ya se envió. No pisa valores puestos a mano. */
function actualizarEstados() {
  const ui = SpreadsheetApp.getUi();
  const sheet = getSheet_();
  const map = ensureColumns_(sheet);
  const col = columnaEstado_(sheet);
  colorearEstado_(sheet, col);
  const last = sheet.getLastRow();
  if (last < 2) { ui.alert('No hay solicitudes para actualizar.'); return; }
  const n = last - 1;
  const leer = function (c) { return sheet.getRange(2, c, n, 1).getDisplayValues().map(function (r) { return str_(r[0]); }); };
  const nombres = leer(map.nombre), enviadas = leer(map.enviada), confirmadas = leer(map.confirmada), estados = leer(col);
  let cambios = 0, respetadas = 0, errores = 0;
  for (let i = 0; i < n; i++) {
    if (!nombres[i] && !estados[i]) continue;               // fila vacía
    const objetivo = confirmadas[i] ? ESTADOS.CONF : enviadas[i] ? ESTADOS.ENV : ESTADOS.NO;
    const actual = rangoEstado_(estados[i]);
    if (actual === -1) { respetadas++; continue; }
    if (actual >= rangoEstado_(objetivo) && estados[i]) continue;
    const aviso = setEstado_(sheet, i + 2, objetivo, false);
    if (aviso) errores++; else cambios++;
  }
  let msg = 'Listo: se actualizaron ' + cambios + ' fila(s).';
  if (respetadas) msg += '\n' + respetadas + ' fila(s) tienen otro estado escrito a mano (por ejemplo "Cancelada") y no se tocaron.';
  if (errores) msg += '\n' + errores + ' fila(s) no se pudieron escribir: revisá que la lista desplegable de la columna Estado tenga "' +
    ESTADOS.NO + '", "' + ESTADOS.ENV + '" y "' + ESTADOS.CONF + '".';
  ui.alert(msg);
}
