'use strict';

/**
 * Acceso a la BD externa de previsión (`olivosct`, un MySQL 5.0 muy antiguo en el
 * AppServ 192.9.17.11). Aislado del resto: nadie más habla con esa base. El cliente
 * de consola MySQL 8 no puede autenticarse contra ese servidor viejo, pero el driver
 * mysql2 (Node) sí.
 *
 * Mayormente LECTURA (consulta de planes/conceptos). ÚNICA escritura: `registrarGestion`
 * (UPDATE plan + INSERT gestion, transaccional y parametrizado), habilitada por un GRANT
 * de columnas mínimas para `wa_lector`. Ninguna otra función escribe.
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

/** Masivo = hay posfecha Y el concepto está en conceptos_permitidos. */
function decidirMasivo(posfecha, enPermitidos) {
  return !!posfecha && !!enPermitidos;
}

/** El concepto 5 (Camb PFecha) NO deja traza en `gestion`. */
function debeRegistrarGestion(concepto) {
  return String(concepto) !== '5';
}

/** Conceptos habilitados para gestión (los 39 curados). */
async function listarConceptosPermitidos() {
  const p = obtenerPool();
  if (!p) { const e = new Error('previsión no configurada'); e.codigo = 'no_configurado'; throw e; }
  const [rows] = await p.query(
    'SELECT codigo_concepto AS codigo, descripcion FROM conceptos_permitidos ORDER BY descripcion',
  );
  return rows;
}

/**
 * Registra la gestión de un plan: UPDATE plan (+ INSERT gestion salvo concepto 5),
 * en una transacción y parametrizado. Masivo (posfecha + concepto permitido) actualiza
 * todos los planes del ced_pagador; si no, solo el num_plan.
 */
async function registrarGestion({ numPlan, concepto, novedad, posfecha, tramito }) {
  const p = obtenerPool();
  if (!p) { const e = new Error('previsión no configurada'); e.codigo = 'no_configurado'; throw e; }
  const conc = String(concepto);
  const nov = String(novedad || '');
  const post = posfecha ? String(posfecha) : null;
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();

    const [pl] = await conn.query('SELECT ced_pagador FROM plan WHERE num_plan = ?', [numPlan]);
    if (!pl.length) { const e = new Error('plan no encontrado'); e.codigo = 'plan_no_encontrado'; throw e; }
    const cedPagador = pl[0].ced_pagador;

    let enPermitidos = false;
    if (post) {
      const [cp] = await conn.query('SELECT 1 FROM conceptos_permitidos WHERE codigo_concepto = ? LIMIT 1', [conc]);
      enPermitidos = cp.length > 0;
    }
    const masivo = decidirMasivo(post, enPermitidos);

    let afectados;
    if (masivo) {
      const [r] = await conn.query(
        'UPDATE plan SET novedad_plan=?, concepto_plan=?, fech_gestion_plan=CURDATE(), fech_pago_posfecha=? WHERE ced_pagador=?',
        [nov, conc, post, cedPagador],
      );
      afectados = r.affectedRows;
    } else if (post) {
      const [r] = await conn.query(
        'UPDATE plan SET novedad_plan=?, concepto_plan=?, fech_gestion_plan=CURDATE(), fech_pago_posfecha=? WHERE num_plan=?',
        [nov, conc, post, numPlan],
      );
      afectados = r.affectedRows;
    } else {
      const [r] = await conn.query(
        'UPDATE plan SET novedad_plan=?, concepto_plan=?, fech_gestion_plan=CURDATE() WHERE num_plan=?',
        [nov, conc, numPlan],
      );
      afectados = r.affectedRows;
    }

    if (debeRegistrarGestion(conc)) {
      await conn.query(
        'INSERT INTO gestion (num_plan, novedad, fecha, hora, concepto, tramito) VALUES (?, ?, CURDATE(), CURTIME(), ?, ?)',
        [numPlan, nov, conc, tramito],
      );
    }

    await conn.commit();
    return { masivo, afectados };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { consultarPlanesPorDocumento, decidirMasivo, debeRegistrarGestion, listarConceptosPermitidos, registrarGestion };
