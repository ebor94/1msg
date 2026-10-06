'use strict';
const env = require('../config/env');

const CLAVE_RECEPCION = 'agentes_recepcion';

/** Pura: parsea la lista JSON de ids. Fallback a [fallbackId] solo si el valor es
 *  nulo/ausente o no es un array parseable; un array válido (incluido []) se respeta. */
function parsearAgentesRecepcion(valor, fallbackId) {
  const fb = Number.isInteger(fallbackId) && fallbackId > 0 ? [fallbackId] : [];
  if (valor === null || valor === undefined) return fb;
  let arr;
  try { arr = JSON.parse(valor); } catch { return fb; }
  if (!Array.isArray(arr)) return fb;
  return [...new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
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
