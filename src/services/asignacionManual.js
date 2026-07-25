'use strict';

/**
 * Lógica pura de la toma/reasignación manual de conversaciones (Fase 2, plan 6).
 * Sin efectos de lado: nada de I/O, nada de Sequelize. Los handlers en
 * conversacionesController.js son los que orquestan transacción + emisión.
 */

const { roomsPara } = require('../sockets/emisor');
const { TIPO_ASIGNACION } = require('../config/constants');

/**
 * Determina el tipo de wa_asignaciones.tipo según el origen/destino.
 *  - de=null (viene de la bandeja general) → toma_manual
 *  - a=null (vuelve a la bandeja general) → devuelta_general
 *  - en cualquier otro caso, de agente a agente → reasignacion
 */
function tipoDeAsignacion(deAgenteId, aAgenteId) {
  if (!deAgenteId) return TIPO_ASIGNACION.TOMA_MANUAL;
  if (!aAgenteId) return TIPO_ASIGNACION.DEVUELTA_GENERAL;
  return TIPO_ASIGNACION.REASIGNACION;
}

/**
 * Rooms que deben enterarse de una asignación: la unión de la room de origen
 * y la de destino (agente:{id} o general), sin duplicar. roomsPara ya agrega
 * 'admins' en ambos casos, así que la unión lo deja una sola vez.
 */
function roomsDeAsignacion(deAgenteId, aAgenteId) {
  const origen = roomsPara({ agenteId: deAgenteId, general: !deAgenteId });
  const destino = roomsPara({ agenteId: aAgenteId, general: !aAgenteId });
  return [...new Set([...origen, ...destino])];
}

module.exports = { tipoDeAsignacion, roomsDeAsignacion };
