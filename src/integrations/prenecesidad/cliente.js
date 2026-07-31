'use strict';

/**
 * Prenecesidad (planes funerarios pagados por anticipado) en KARINGSOFT. Dos pasos:
 *  1) buscar los contratos del cliente por cédula (tercero o id_propietario).
 *  2) por cada contrato, ejecutar el SP dw_prenecesidad_inf_saldos_contrato para
 *     el resumen financiero (valor, descuento, cuota inicial, abonado, saldoCartera).
 *
 * La fecha del SP se pasa como PARÁMETRO (no GETDATE() inline): el statement EXEC
 * de SQL Server no acepta una función como valor de parámetro con nombre.
 * Usa el pool compartido de KARINGSOFT. Solo lectura.
 */

const { obtenerPool, sql } = require('../karingsoft/pool');
const logger = require('../../utils/logger');

const Q_CONTRATOS = `
SELECT contrato, expedicion, valor, valor_descuento, cuota_inicial,
       valor_contratado, plazo, saldo, vendedor, lugar_pago, observacion
FROM prenecesidad_contratos
WHERE tercero = @cedula OR id_propietario = @cedula`;

/** Devuelve los contratos de prenecesidad del cliente con su resumen de saldos. */
async function consultarPrenecesidad(documento) {
  const p = obtenerPool();
  if (!p) {
    const e = new Error('prenecesidad no configurado');
    e.codigo = 'no_configurado';
    throw e;
  }
  const doc = String(documento || '').replace(/\D/g, '');
  if (!doc) return [];
  const pool = await p;

  // 1) Contratos del cliente.
  const q1 = await pool.request().input('cedula', sql.VarChar, doc).query(Q_CONTRATOS);
  const contratos = q1.recordset || [];

  // 2) Resumen de saldos por contrato (SP). Se enriquece con datos de la cabecera.
  const resultados = [];
  for (const c of contratos) {
    try {
      const req = pool.request();
      req.input('de_contrato', sql.VarChar, c.contrato);
      req.input('a_contrato', sql.VarChar, c.contrato);
      req.input('a_fecha', sql.DateTime, new Date());
      const sp = await req.execute('dw_prenecesidad_inf_saldos_contrato');
      const saldos = (sp.recordset && sp.recordset[0]) || {};
      resultados.push({ ...saldos, vendedor: c.vendedor, lugar_pago: c.lugar_pago, observacion: c.observacion });
    } catch (err) {
      logger.warn(`SP saldos prenecesidad ${c.contrato}: ${err.message}`);
      resultados.push(c); // fallback: al menos la cabecera del contrato
    }
  }
  return resultados;
}

module.exports = { consultarPrenecesidad };
