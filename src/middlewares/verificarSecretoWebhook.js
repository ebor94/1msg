'use strict';

const crypto = require('crypto');
const env = require('../config/env');
const logger = require('../utils/logger');

/**
 * Comparación en tiempo constante: evita filtrar el secreto por el tiempo
 * que tarda en fallar la comparación.
 */
function iguales(recibido, esperado) {
  if (typeof recibido !== 'string' || recibido.length === 0) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Valida el WEBHOOK_SECRET que 1msg debe presentar. Se acepta en:
 *   - query string:  ?secret=...
 *   - header:        x-webhook-secret: ...
 *   - verificación estilo Meta:  ?hub.verify_token=...
 * Si no coincide, corta con 401 y NUNCA se toca la cola.
 */
module.exports = function verificarSecretoWebhook(req, res, next) {
  const presentado =
    req.query.secret || req.get('x-webhook-secret') || req.query['hub.verify_token'] || '';

  if (!iguales(presentado, env.webhookSecret)) {
    logger.warn(`Webhook rechazado: secreto inválido desde ${req.ip}`);
    return res.status(401).json({ error: 'no autorizado' });
  }
  return next();
};
