'use strict';
const servicio = require('../services/resumenDifusiones');
const logger = require('../utils/logger');

const HORA_INICIO = 19;      // a partir de las 19:00 hora Colombia
const ESPERA_ENTRE_MS = 1500; // ritmo suave entre llamadas a la IA
const ESPERA_OCIO_MS = 60000; // fuera de hora / sin pendientes / error de config

/** Hora de pared de Colombia (UTC-5) ≥ 19:00. */
function esHoraDeResumen(fecha) {
  const bogota = new Date(fecha.getTime() - 5 * 3600 * 1000);
  return bogota.getUTCHours() >= HORA_INICIO;
}

/** Un paso del barrido. deps inyectable para test. Devuelve qué hizo. */
async function tick(ahora, deps = {}) {
  const esHora = deps.esHora || esHoraDeResumen;
  const siguiente = deps.siguiente || servicio.siguientePendiente;
  const procesar = deps.procesar || servicio.procesarPendiente;
  const marcar = deps.marcar || servicio.marcarResumido;

  if (!esHora(ahora)) return 'fuera-hora';
  const dest = await siguiente();
  if (!dest) return 'nada';
  try {
    return await procesar(dest);
  } catch (err) {
    // Config global (concepto 49 ausente / API key ausente): NO marcar; se resolverá
    // al configurar y se reintentará. No quemamos destinatarios por un error global.
    if (err.codigo === 'concepto_invalido' || err.codigo === 'no_configurado') {
      logger.error(`resumen difusiones: config — ${err.message}`);
      return 'error-config';
    }
    // Fallo por-destinatario (IA/gestión, ya reintentado por el SDK): marcar para no
    // bloquear la cola ni reintentar infinito (decisión del spec).
    logger.warn(`resumen difusiones dest ${dest.id}: ${err.message}; marcado para no bloquear`);
    try { await marcar(dest.id); } catch { /* si falla el marcado, se reintenta */ }
    return 'fallo';
  }
}

let corriendo = false;
async function iniciarLoop() {
  if (corriendo) return;
  corriendo = true;
  const paso = async () => {
    let espera = ESPERA_OCIO_MS;
    try {
      const r = await tick(new Date());
      if (r === 'resumido' || r === 'sin-plan' || r === 'fallo') espera = ESPERA_ENTRE_MS;
    } catch (err) {
      logger.error(`worker resumen difusiones: ${err.message}`);
    }
    if (corriendo) setTimeout(paso, espera);
  };
  paso();
}

module.exports = { esHoraDeResumen, tick, iniciarLoop };
