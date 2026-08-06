'use strict';
// Reglas PURAS de fecha para el recordatorio mensual.

/** Días del mes (mes 1..12). TZ-free vía Date.UTC. */
function diasDelMes(anio, mes1a12) {
  return new Date(Date.UTC(anio, mes1a12, 0)).getUTCDate();
}

/** ¿Hoy toca enviar? Coincide el día, o el objetivo no existe este mes y hoy es el último. */
function esDiaDeEnvio(diaMes, diaHoy, diasEnElMes) {
  if (diaHoy === diaMes) return true;
  return diaMes > diasEnElMes && diaHoy === diasEnElMes;
}

module.exports = { diasDelMes, esDiaDeEnvio };
