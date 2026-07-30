'use strict';

/**
 * Acceso de SOLO LECTURA a la BD externa de previsión (`olivosct`, un MySQL 5.0
 * muy antiguo en el AppServ 192.9.17.11). Aislado del resto: nadie más habla con
 * esa base. El cliente de consola MySQL 8 no puede autenticarse contra ese
 * servidor viejo, pero el driver mysql2 (Node) sí.
 *
 * Config en env.prevision. Si no está configurada, las funciones lanzan un error
 * con codigo 'no_configurado' (el endpoint lo traduce a 503, sin tumbar la app).
 */

const mysql = require('mysql2/promise');
const env = require('../../config/env');

let pool = null;

function obtenerPool() {
  const cfg = env.prevision;
  if (!cfg.host || !cfg.database || !cfg.user) return null;
  if (!pool) {
    pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      waitForConnections: true,
      connectionLimit: 3, // servidor viejo: pocas conexiones
      connectTimeout: 8000,
    });
  }
  return pool;
}

/** Devuelve los planes cuyo `ced_pagador` coincide con el documento (solo dígitos). */
async function consultarPlanesPorDocumento(documento) {
  const p = obtenerPool();
  if (!p) {
    const e = new Error('previsión no configurada');
    e.codigo = 'no_configurado';
    throw e;
  }
  const doc = String(documento || '').replace(/\D/g, '');
  if (!doc) return [];
  // JOIN con `concepto` para traer la descripción (concepto_plan es un id → nom_con).
  const [rows] = await p.query(
    `SELECT p.*, c.nom_con AS concepto_desc
       FROM plan p
       LEFT JOIN concepto c ON c.cod_con = p.concepto_plan
      WHERE p.ced_pagador = ?`,
    [doc],
  );
  return rows;
}

module.exports = { consultarPlanesPorDocumento };
