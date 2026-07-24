'use strict';

const logger = require('../utils/logger');
const { EventoWebhook } = require('../models');

/**
 * Extracción defensiva y "best effort" de metadatos del payload, solo para
 * poblar las columnas indexadas tipo / wa_message_id. NO conduce lógica de
 * negocio y NUNCA lanza: si no encuentra algo, deja null. El worker (tarea 4)
 * es quien interpreta el payload de verdad, cuando confirmemos su formato real.
 */
function extraerMeta(payload) {
  const meta = { tipo: null, waMessageId: null };
  if (!payload || typeof payload !== 'object') return meta;

  // Formato real de 1msg (docs/payloads-reales-1msg.md): el discriminador es la
  // presencia de messages[] (mensajes) o ack[] (estados), no un campo `type`.
  let id = null;
  if (Array.isArray(payload.messages)) {
    meta.tipo = 'mensajes';
    id = payload.messages[0] && payload.messages[0].id;
  } else if (Array.isArray(payload.ack)) {
    meta.tipo = 'ack';
    id = payload.ack[0] && payload.ack[0].id;
  } else {
    meta.tipo = payload.type || payload.event || null;
  }

  if (typeof meta.tipo === 'string') meta.tipo = meta.tipo.slice(0, 60);
  if (typeof id === 'string') meta.waMessageId = id.slice(0, 128);
  return meta;
}

/**
 * GET /webhook/1msg — verificación inicial.
 * Si 1msg usa el estilo Meta (?hub.challenge=...), devolvemos el challenge tal
 * cual. En otro caso basta con un 200.
 */
function verificar(req, res) {
  const challenge = req.query['hub.challenge'];
  if (challenge !== undefined) {
    return res.status(200).send(String(challenge));
  }
  return res.status(200).json({ ok: true });
}

/**
 * POST /webhook/1msg — encolar el evento.
 * Invariante #1: aquí NO se procesa. Insertar el payload crudo y responder 200
 * en milisegundos. Si el insert falla, se responde 200 igual y se registra el
 * error: es preferible perder un evento a entrar en el bucle de reintentos.
 */
async function recibir(req, res) {
  const payload = req.body;
  const { tipo, waMessageId } = extraerMeta(payload);

  try {
    await EventoWebhook.create({
      tipo,
      waMessageId,
      payload,
      procesado: false,
    });
  } catch (err) {
    logger.error('No se pudo encolar el evento de webhook; se responde 200 igual', err);
  }

  return res.status(200).json({ ok: true });
}

module.exports = { verificar, recibir, extraerMeta };
