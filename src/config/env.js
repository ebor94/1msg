'use strict';

/**
 * Carga y validación de variables de entorno.
 *
 * Regla de fase 1: si falta una variable obligatoria, el proceso NO arranca
 * (fallo ruidoso, no silencioso). Esto se ejecuta una sola vez al importar.
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

/** Variables obligatorias: sin ellas el proceso no debe arrancar. */
const REQUERIDAS = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'ONEMSG_BASE_URL',
  'ONEMSG_INSTANCE_ID',
  'ONEMSG_TOKEN',
  'WEBHOOK_SECRET',
  'JWT_SECRET',
];

const faltantes = REQUERIDAS.filter((clave) => {
  const valor = process.env[clave];
  return valor === undefined || valor === '';
});

if (faltantes.length > 0) {
  // Antes de que exista el logger: escribir a stderr y abortar.
  process.stderr.write(
    `\n[FATAL] Faltan variables de entorno obligatorias: ${faltantes.join(', ')}\n` +
      `Copia .env.example a .env y complétalas.\n\n`,
  );
  process.exit(1);
}

function entero(clave, porDefecto) {
  const bruto = process.env[clave];
  if (bruto === undefined || bruto === '') return porDefecto;
  const n = Number.parseInt(bruto, 10);
  if (Number.isNaN(n)) {
    process.stderr.write(`\n[FATAL] La variable ${clave} debe ser un entero, llegó: "${bruto}"\n\n`);
    process.exit(1);
  }
  return n;
}

function ruta(clave, porDefecto) {
  const bruto = process.env[clave] || porDefecto;
  return path.isAbsolute(bruto) ? bruto : path.resolve(process.cwd(), bruto);
}

const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: entero('PORT', 3000),

  // Agente de "recepción": los chats entrantes SIN dueño caen a él (y él reparte).
  // 0 = deshabilitado (vuelven a la bandeja general, comportamiento anterior).
  agenteRecepcionId: entero('AGENTE_RECEPCION_ID', 4),

  db: Object.freeze({
    host: process.env.DB_HOST,
    port: entero('DB_PORT', 3306),
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    timezone: process.env.DB_TIMEZONE || '-05:00',
  }),

  onemsg: Object.freeze({
    baseUrl: process.env.ONEMSG_BASE_URL,
    instanceId: process.env.ONEMSG_INSTANCE_ID,
    token: process.env.ONEMSG_TOKEN,
  }),

  webhookSecret: process.env.WEBHOOK_SECRET,

  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',

  jwt: Object.freeze({
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES || '12h',
  }),

  media: Object.freeze({
    path: ruta('MEDIA_PATH', './media'),
    maxBytes: entero('MEDIA_MAX_BYTES', 52428800),
    maxUploadBytes: entero('MEDIA_MAX_UPLOAD_BYTES', 16777216),
  }),

  log: Object.freeze({
    level: process.env.LOG_LEVEL || 'info',
    dir: ruta('LOG_DIR', './logs'),
  }),

  // BD externa de previsión (olivosct, solo lectura). Opcional: si no se
  // configura, el endpoint responde "no configurado" sin tumbar la app.
  prevision: Object.freeze({
    host: process.env.PREVISION_DB_HOST || '',
    port: entero('PREVISION_DB_PORT', 3306),
    user: process.env.PREVISION_DB_USER || '',
    password: process.env.PREVISION_DB_PASSWORD || '',
    database: process.env.PREVISION_DB_NAME || '',
  }),
});

module.exports = env;
