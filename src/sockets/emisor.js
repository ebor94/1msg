'use strict';
const { getIo } = require('./io');

function roomsPara({ agenteId, general }) {
  if (agenteId) return [`agente:${agenteId}`, 'admins'];
  if (general) return ['general', 'admins'];
  return ['admins'];
}

function emitir(evento, destino, payload) {
  const io = getIo();
  if (!io) return;
  const rooms = roomsPara(destino);
  let canal = io;
  for (const r of rooms) canal = canal.to(r);
  canal.emit(evento, payload);
}

module.exports = { roomsPara, emitir };
