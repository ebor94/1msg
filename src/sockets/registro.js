'use strict';
const { verificar } = require('../utils/jwt');
const { ROL_AGENTE } = require('../config/constants');
const logger = require('../utils/logger');

function registrar(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('no autenticado'));
      socket.data.agente = verificar(token);
      return next();
    } catch (e) {
      return next(new Error('token inválido'));
    }
  });

  io.on('connection', (socket) => {
    const a = socket.data.agente;
    socket.join(`agente:${a.id}`);
    if (a.rol === ROL_AGENTE.ADMINISTRADOR) socket.join('admins');
    else socket.join('general');
    logger.debug(`socket conectado: agente ${a.id} (${a.rol})`);
  });
}

module.exports = { registrar };
