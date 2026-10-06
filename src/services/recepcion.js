'use strict';
const env = require('../config/env');

const CLAVE_RECEPCION = 'agentes_recepcion';

/** Pura: parsea la lista JSON de ids; vacío/corrupto → [fallbackId] si es válido, si no []. */
function parsearAgentesRecepcion(valor, fallbackId) {
  let ids = [];
  try {
    const arr = JSON.parse(valor);
    if (Array.isArray(arr)) ids = arr.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  } catch { ids = []; }
  ids = [...new Set(ids)];
  if (ids.length) return ids;
  return Number.isInteger(fallbackId) && fallbackId > 0 ? [fallbackId] : [];
}

/** Pura: de `candidatos` (en orden) el de menor `cargas[id]` (0 si falta); empate → el primero; vacío → null. */
function elegirRecepcion(candidatos, cargas) {
  let mejor = null;
  let mejorCarga = Infinity;
  for (const id of candidatos || []) {
    const c = (cargas && cargas[id]) || 0;
    if (c < mejorCarga) { mejor = id; mejorCarga = c; }
  }
  return mejor;
}

/** Pura: ids pedidos que NO están en la lista de activos. */
function validarIdsRecepcion(pedidos, idsActivos) {
  const activos = new Set(idsActivos || []);
  return (pedidos || []).filter((id) => !activos.has(id));
}

/** Lee la config efectiva (clave en wa_ajustes; respaldo al env). */
async function agentesRecepcionConfigurados({ Ajuste }) {
  const fila = await Ajuste.findOne({ where: { clave: CLAVE_RECEPCION } });
  return parsearAgentesRecepcion(fila ? fila.valor : null, env.agenteRecepcionId);
}

module.exports = { CLAVE_RECEPCION, parsearAgentesRecepcion, elegirRecepcion, validarIdsRecepcion, agentesRecepcionConfigurados };
