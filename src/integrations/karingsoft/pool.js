'use strict';

/**
 * Conexión compartida (pool) a la BD KARINGSOFT (SQL Server 2019, solo lectura).
 * La usan las integraciones de `mantenimientos` y `prenecesidad` — misma base.
 * Config en env.mantenimientos (MANTEN_DB_*). Si no está configurada, obtenerPool
 * devuelve null y cada feature responde 'no_configurado' sin tumbar la app.
 */

const sql = require('mssql');
const env = require('../../config/env');

let poolPromise = null;

function obtenerPool() {
  const cfg = env.mantenimientos;
  if (!cfg.host || !cfg.database || !cfg.user) return null;
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool({
      server: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      options: { encrypt: false, trustServerCertificate: true },
      pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
      connectionTimeout: 10000,
      requestTimeout: 25000,
    })
      .connect()
      .catch((e) => { poolPromise = null; throw e; }); // permite reintentar tras un fallo
  }
  return poolPromise;
}

module.exports = { obtenerPool, sql };
