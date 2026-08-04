'use strict';

/**
 * Prenecesidad (planes funerarios pagados por anticipado) en KARINGSOFT.
 * Una sola consulta por cédula (tercero o id_propietario) que devuelve, por
 * contrato, la cuota pendiente más próxima, # de cuotas vencidas, valor abonado,
 * saldo pendiente, asesor, observaciones y datos de cobro.
 *
 * `GETDATE()` va inline en las subconsultas (no como parámetro): aquí es una
 * consulta normal (no un EXEC de SP), así que SQL Server lo acepta sin problema.
 * Usa el pool compartido de KARINGSOFT. Solo lectura.
 */

const { obtenerPool, sql } = require('../karingsoft/pool');
const logger = require('../../utils/logger');

const Q_PRENECESIDAD = `
SELECT
    c.contrato                                                    AS Contrato,
    v.nombre_contratante                                          AS Nombre,
    c.expedicion                                                  AS Expedicion,
    cu_pend.valor                                                 AS [Vr. Cuota],
    cu_pend.cuota                                                 AS [Cuota Pendiente],
    cu_pend.fecha                                                 AS [Fecha Vencimiento],
    ISNULL(venc.cuotas_vencidas, 0)                               AS [# Cuotas Vencidas],
    c.plazo                                                       AS Plazo,
    ISNULL(ab.total_abonado, 0)                                   AS [Vr. Abonado],
    ((c.valor - c.valor_descuento) - ISNULL(ab.total_abonado,0))  AS [Saldo Pendiente],
    ase.nombre                                                    AS Asesor,
    c.observacion                                                 AS Observaciones,
    c.direccion_cobro                                             AS Direccion,
    c.telefonos_cobro                                             AS Telefono
FROM prenecesidad_contratos c
JOIN prenecesidad_contratos_view v     ON v.contrato = c.contrato
LEFT JOIN terceros_view ase            ON ase.tercero = c.vendedor
OUTER APPLY (
    SELECT SUM(ABS(cu.abonado)) AS total_abonado
    FROM prenecesidad_contratos_primas_view cu
    WHERE cu.contrato = c.contrato
) ab
OUTER APPLY (
    SELECT COUNT(*) AS cuotas_vencidas
    FROM prenecesidad_contratos_primas_view cu
    WHERE cu.contrato = c.contrato
      AND cu.fecha < GETDATE()
      AND ABS(cu.abonado) < cu.valor
) venc
OUTER APPLY (
    SELECT TOP 1 cu.cuota, cu.valor, cu.fecha
    FROM prenecesidad_contratos_primas_view cu
    WHERE cu.contrato = c.contrato
      AND ABS(cu.abonado) < cu.valor
    ORDER BY cu.fecha ASC
) cu_pend
WHERE c.tercero = @cedula OR c.id_propietario = @cedula
ORDER BY c.expedicion DESC`;

/** Devuelve los contratos de prenecesidad del cliente (por cédula), ya enriquecidos. */
async function consultarPrenecesidad(documento) {
  const p = obtenerPool();
  if (!p) {
    const e = new Error('prenecesidad no configurado');
    e.codigo = 'no_configurado';
    throw e;
  }
  const doc = String(documento || '').replace(/\D/g, '');
  if (!doc) return [];
  try {
    const pool = await p;
    const r = await pool.request().input('cedula', sql.VarChar, doc).query(Q_PRENECESIDAD);
    return r.recordset || [];
  } catch (err) {
    logger.error(`consultar prenecesidad (cédula ${doc}): ${err.message}`);
    throw err;
  }
}

module.exports = { consultarPrenecesidad };
