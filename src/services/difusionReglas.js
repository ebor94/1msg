'use strict';
// Reglas PURAS del envío de difusiones: ventana horaria, ritmo y clasificación de error.

/** Ventana: Lun–Vie 08:00–18:59, Sáb 08:00–13:59 (hora local); Dom no. */
function dentroDeVentana(fecha) {
  const dow = fecha.getDay(); // 0=Dom..6=Sáb
  const h = fecha.getHours();
  if (dow === 0) return false;
  if (dow === 6) return h >= 8 && h < 14;
  return h >= 8 && h < 19;
}

/** Espera entre envíos: base (20 s) + jitter [0, jitterMs). rnd inyectable para test. */
function esperaEnvioMs(baseMs = 20000, jitterMs = 5000, rnd = Math.random) {
  return baseMs + Math.floor(rnd() * jitterMs);
}

/** Traduce un código de error de 1msg → qué hacer con el destinatario. */
function clasificarError(codigo) {
  const c = String(codigo || '');
  if (c === '131049') return { estado: 'fallido', reintentarEnMin: 1440, marcarExperimento: false }; // límite marketing → 24h
  if (c === '130472') return { estado: 'omitido', reintentarEnMin: null, marcarExperimento: true };  // experimento Meta
  return { estado: 'fallido', reintentarEnMin: null, marcarExperimento: false };
}

module.exports = { dentroDeVentana, esperaEnvioMs, clasificarError };
