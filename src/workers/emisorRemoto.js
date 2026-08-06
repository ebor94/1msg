'use strict';
const env = require('../config/env');
const logger = require('../utils/logger');

/** Puente worker→backend para emitir por socket (mismo patrón que la ingesta). */
async function emitirRemoto(evento, destino, payload) {
  try {
    const res = await fetch(`http://127.0.0.1:${env.port}/internal/emitir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': env.webhookSecret },
      body: JSON.stringify({ evento, destino, payload }),
    });
    if (!res.ok) logger.warn(`emitirRemoto ${evento}: backend respondió ${res.status}`);
  } catch (err) {
    logger.warn(`emitirRemoto ${evento}: ${err.message}`); // no bloquea el envío
  }
}

module.exports = { emitirRemoto };
