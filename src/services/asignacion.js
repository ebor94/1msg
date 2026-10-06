'use strict';

const { Op } = require('sequelize');
const { TIPO_ASIGNACION, ESTADO_CONVERSACION } = require('../config/constants');
const { agentesRecepcionConfigurados, elegirRecepcion } = require('./recepcion');

/**
 * Cascada de asignación de una conversación entrante:
 *   1. Dueño activo → ese agente (continuidad).
 *   2. Sin dueño → agente de recepción configurado y activo con MENOS chats abiertos.
 *   3. Sin candidatos → bandeja general (fallback).
 */
async function cascada(contacto, { Agente, Conversacion, Ajuste, transaction }) {
  // Regla 1: dueño histórico, solo si sigue activo.
  if (contacto.agenteDuenoId) {
    const dueno = await Agente.findByPk(contacto.agenteDuenoId, { transaction });
    if (dueno && dueno.activo) {
      return { agenteId: dueno.id, tipo: TIPO_ASIGNACION.AUTO_CONTINUIDAD, motivo: 'continuidad: contacto con agente dueño' };
    }
  }

  // Regla 2: recepción configurada → activos → menos cargado.
  const ids = await agentesRecepcionConfigurados({ Ajuste });
  if (ids.length) {
    const filasActivas = await Agente.findAll({ where: { id: ids, activo: true }, attributes: ['id'], transaction });
    const activosSet = new Set(filasActivas.map((a) => a.id));
    const activos = ids.filter((id) => activosSet.has(id)); // preserva el orden configurado (desempate)
    if (activos.length) {
      const cargas = {};
      for (const id of activos) {
        cargas[id] = await Conversacion.count({
          where: { agenteId: id, estado: { [Op.in]: [ESTADO_CONVERSACION.NUEVA, ESTADO_CONVERSACION.ABIERTA] } },
          transaction,
        });
      }
      const elegido = elegirRecepcion(activos, cargas);
      if (elegido) {
        return { agenteId: elegido, tipo: TIPO_ASIGNACION.AUTO_REGLA, motivo: `recepción (menos cargado): agente ${elegido}` };
      }
    }
  }

  // Regla 3: sin recepción disponible → general.
  return { agenteId: null, tipo: TIPO_ASIGNACION.AUTO_REGLA, motivo: 'bandeja general' };
}

module.exports = { cascada };
