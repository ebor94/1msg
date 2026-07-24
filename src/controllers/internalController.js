'use strict';
const env = require('../config/env');
const { emitir } = require('../sockets/emisor');

function emitirHandler(req, res) {
  if ((req.get('x-internal-secret') || '') !== env.webhookSecret) {
    return res.status(401).json({ error: 'no autorizado' });
  }
  const { evento, destino, payload } = req.body || {};
  if (!evento || !destino) return res.status(400).json({ error: 'evento y destino requeridos' });
  emitir(evento, destino, payload);
  return res.status(204).end();
}

module.exports = { emitirHandler };
