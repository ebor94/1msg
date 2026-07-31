'use strict';

/**
 * Acceso de SOLO LECTURA a la BD externa de mantenimientos (KARINGSOFT, SQL
 * Server 2019 en 192.9.17.9). Aislado del resto. El driver mssql (tedious) sí
 * conecta a ese servidor; el cliente de consola genérico no.
 *
 * Config en env.mantenimientos. Si no está configurada, lanza error con
 * codigo 'no_configurado' (el endpoint lo traduce a 503, sin tumbar la app).
 */

const { obtenerPool, sql } = require('../karingsoft/pool');
const logger = require('../../utils/logger');

// Contratos de mantenimiento + estado de vigencia + saldo real (pagos por vigencia).
// `tercero` = cédula/NIT del cliente. Margen de gracia de 100 días para vencidos sin pagar.
const QUERY = `
SELECT
    t.tercero,
    t.nombre                        AS cliente,
    m.mantenimiento,
    m.documento                     AS contrato_documento,
    d.mantenimiento_detalle,
    s.descripcion                   AS servicio,
    d.predio,
    d.vigencia                      AS vigencia_dias,
    d.fecha_inicio,
    d.fecha_final,
    d.valor,
    pagos.total_pagado,
    (d.valor - ISNULL(pagos.total_pagado,0)) AS saldo_pendiente,
    pagos.ultimo_documento,
    CASE
        WHEN GETDATE() BETWEEN d.fecha_inicio AND d.fecha_final THEN 'VIGENTE'
        WHEN GETDATE() > d.fecha_final
             AND (d.valor - ISNULL(pagos.total_pagado,0)) > 0
             AND DATEDIFF(DAY, d.fecha_final, GETDATE()) <= 100
            THEN 'VIGENTE (en gracia, vencido sin pagar)'
        WHEN GETDATE() > d.fecha_final THEN 'VENCIDO'
        ELSE 'FUTURO'
    END AS estado_vigencia
FROM terceros_view t
JOIN mantenimientos m                ON m.tercero = t.tercero
JOIN mantenimientos_detalle d        ON d.mantenimiento = m.mantenimiento
LEFT JOIN mantenimientos_servicios s ON s.servicio = d.servicio
OUTER APPLY (
    SELECT SUM(dm.neto) AS total_pagado,
           MAX(dm.fecha) AS ultimo_movimiento,
           MAX(dm.documento) AS ultimo_documento
    FROM documentos_movimientos dm
    WHERE dm.mantenimiento_detalle = d.mantenimiento_detalle
) pagos
WHERE t.tercero = @cedula
ORDER BY d.fecha_inicio`;

/** Devuelve los contratos de mantenimiento del cliente (por documento/tercero). */
async function consultarMantenimientos(documento) {
  const p = obtenerPool();
  if (!p) {
    const e = new Error('mantenimientos no configurado');
    e.codigo = 'no_configurado';
    throw e;
  }
  const doc = String(documento || '').replace(/\D/g, '');
  if (!doc) return [];
  try {
    const pool = await p;
    const r = await pool.request().input('cedula', sql.VarChar, doc).query(QUERY);
    // Solo contratos que NO estén VENCIDO (se muestran VIGENTE, en gracia y FUTURO).
    return (r.recordset || []).filter((x) => x.estado_vigencia !== 'VENCIDO');
  } catch (err) {
    logger.error(`consultar mantenimientos (tercero ${doc}): ${err.message}`);
    throw err;
  }
}

module.exports = { consultarMantenimientos };
