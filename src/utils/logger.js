'use strict';

/**
 * Logger central con niveles y salida a archivo.
 *
 * - En producción no se usa console.log; todo pasa por aquí.
 * - Nunca se loguea el token de 1msg ni secretos (responsabilidad de quien llama).
 */

const fs = require('fs');
const path = require('path');
const winston = require('winston');
const env = require('../config/env');

// Asegura que el directorio de logs exista antes de crear los transports.
fs.mkdirSync(env.log.dir, { recursive: true });

const { combine, timestamp, printf, colorize, errors, splat, json } = winston.format;

const formatoConsola = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  errors({ stack: true }),
  splat(),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} ${level}: ${stack || message}${extra}`;
  }),
);

const formatoArchivo = combine(
  timestamp(),
  errors({ stack: true }),
  splat(),
  json(),
);

const logger = winston.createLogger({
  level: env.log.level,
  transports: [
    new winston.transports.Console({ format: formatoConsola }),
    new winston.transports.File({
      filename: path.join(env.log.dir, 'app.log'),
      format: formatoArchivo,
      maxsize: 10 * 1024 * 1024, // 10 MB por archivo
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(env.log.dir, 'error.log'),
      level: 'error',
      format: formatoArchivo,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

module.exports = logger;
