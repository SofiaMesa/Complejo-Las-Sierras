/* ==========================================================================
   COMPLEJO LAS SIERRAS — Configuración del formulario de reservas
   --------------------------------------------------------------------------
   Este es el ÚNICO archivo que hay que editar para conectar el formulario
   con Google Sheets. Ver instrucciones en _integracion-google/INSTRUCCIONES.md
   ========================================================================== */
window.LAS_SIERRAS_CONFIG = Object.freeze({
  // URL de la aplicación web de Google Apps Script.
  // Tiene que empezar con https://script.google.com/macros/s/ y terminar en /exec
  reservasEndpoint: 'https://script.google.com/macros/s/AKfycbzQE1M5sep8uLZ5BPFss00lWkrrpmZjgMhe3pjYkW3ako6Ojl6VX4SZ1mPB477R5VfF/exec',

  // WhatsApp del complejo (código de país + 9 + código de área + número, sin espacios)
  whatsappNumero: '5491160248224',

  // Reglas del formulario (deben coincidir con las del Apps Script)
  capacidadPorUnidad: 6,     // se muestra un aviso si piden más personas
  maxHuespedes: 20,          // máximo aceptado por solicitud
  maxNoches: 60,             // estadía máxima por solicitud
  maxDiasAnticipacion: 730,  // hasta cuántos días hacia adelante se puede pedir
  timeoutMs: 30000           // tiempo máximo de espera del envío (30 s)
});
