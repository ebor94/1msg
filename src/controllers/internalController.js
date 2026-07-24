'use strict';
const crypto = require('crypto');
const env = require('../config/env');
const { emitir } = require('../sockets/emisor');

/** Comparación en tiempo constante (igual que el validador del webhook). */
function secretoValido(recibido) {
  const esperado = env.webhookSecret;
  if (typeof recibido !== 'string' || recibido.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado));
}

/**
 * Puente worker→API para emitir por el socket. Solo debe llamarlo el worker en
 * localhost. Toda petición que entra por el túnel de Cloudflare trae el header
 * CF-Connecting-IP; la llamada local del worker no. Si viene de afuera, 404
 * (no revelamos el endpoint). Además, secreto en tiempo constante.
 */
function emitirHandler(req, res) {
  if (req.get('cf-connecting-ip')) return res.status(404).end();
  if (!secretoValido(req.get('x-internal-secret') || '')) {
    return res.status(401).json({ error: 'no autorizado' });
  }
  const { evento, destino, payload } = req.body || {};
  if (!evento || !destino) return res.status(400).json({ error: 'evento y destino requeridos' });
  emitir(evento, destino, payload);
  return res.status(204).end();
}

module.exports = { emitirHandler };
