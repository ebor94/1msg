'use strict';

/**
 * Punto de entrada del proceso de API.
 *
 * Fase 1: valida entorno, conecta a la base, carga los modelos y levanta el
 * servidor HTTP con el webhook (tarea 3). El worker corre como proceso aparte
 * (npm run worker) y se implementa en la tarea 4.
 */

const http = require('http');
const { Server } = require('socket.io');
const env = require('./config/env'); // valida env y aborta si falta algo obligatorio
const logger = require('./utils/logger');
const { verificarConexion } = require('./config/database');
require('./models'); // registra modelos y asociaciones
const crearApp = require('./app');
const { setIo } = require('./sockets/io');
const { registrar } = require('./sockets/registro');

async function bootstrap() {
  logger.info('Arrancando bandeja WhatsApp — Serfunorte');
  await verificarConexion();

  const app = crearApp();
  const server = http.createServer(app);
  const io = new Server(server, { path: '/socket.io' });
  registrar(io);
  setIo(io);

  server.listen(env.port, () => {
    logger.info(`API HTTP+WS escuchando en http://127.0.0.1:${env.port} (webhook: POST /webhook/1msg)`);
  });

  // Apagado limpio: dejar de aceptar conexiones antes de morir.
  const cerrar = (senal) => {
    logger.info(`${senal} recibido, cerrando servidor...`);
    server.close(() => {
      logger.info('Servidor cerrado.');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => cerrar('SIGTERM'));
  process.on('SIGINT', () => cerrar('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('No se pudo arrancar el proceso', err);
  process.exit(1);
});
