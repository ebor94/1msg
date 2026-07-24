'use strict';

/**
 * Instancia única de Sequelize contra la base serfuweb.
 *
 * IMPORTANTE:
 * - Prohibido sequelize.sync() de cualquier tipo: el esquema ya existe y la
 *   base contiene tablas del core de negocio que no debemos tocar.
 * - underscored: true y timestamps manuales (creado_en / actualizado_en) se
 *   definen por modelo; aquí van los defaults comunes.
 */

const { Sequelize } = require('sequelize');
const env = require('./env');
const logger = require('../utils/logger');

const sequelize = new Sequelize(env.db.name, env.db.user, env.db.password, {
  host: env.db.host,
  port: env.db.port,
  dialect: 'mysql',
  timezone: env.db.timezone, // escritura de DATETIME en hora de Colombia
  logging: (msg) => logger.debug(msg),
  define: {
    underscored: true,
    freezeTableName: true, // el nombre de tabla lo fija cada modelo, sin pluralizar
    charset: 'utf8mb4',
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  dialectOptions: {
    // Las fechas DATETIME se leen como string para no aplicar zona horaria
    // del proceso; el orden real lo manda ts_proveedor, no el reloj local.
    dateStrings: true,
    typeCast: true,
  },
});

/**
 * Verifica la conexión. Se llama al arrancar cualquier proceso.
 * Lanza si falla: preferimos no arrancar a arrancar ciego contra la base.
 */
async function verificarConexion() {
  await sequelize.authenticate();
  logger.info(`Conexión a MySQL establecida: ${env.db.user}@${env.db.host}:${env.db.port}/${env.db.name}`);
}

module.exports = { sequelize, verificarConexion };
