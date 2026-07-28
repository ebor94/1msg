'use strict';

/**
 * Cascada de asignación de una conversación entrante (regla de negocio, CLAUDE.md):
 *   1. Si el contacto ya tiene agente_dueno_id (y está activo) → ese agente (continuidad).
 *   2. Sin dueño (o dueño inactivo) → agente de RECEPCIÓN (env.agenteRecepcionId),
 *      si está activo. Él recibe los chats nuevos y los reparte.
 *   3. Si no hay recepción configurada o está inactivo → bandeja general (fallback).
 *
 * Decisión 2026-07-28: los chats sin dueño ya no caen a general, sino a un agente
 * de recepción (por defecto id 4) que los distribuye. La continuidad (regla 1) se
 * mantiene: los clientes con dueño siguen cayendo directo a su agente.
 */

const { TIPO_ASIGNACION } = require('../config/constants');
const env = require('../config/env');

/**
 * Evalúa la cascada para un contacto.
 * Devuelve { agenteId, tipo, motivo }. agenteId null = bandeja general.
 */
async function cascada(contacto, { Agente, transaction }) {
  // Regla 1: dueño histórico, solo si sigue activo.
  if (contacto.agenteDuenoId) {
    const dueno = await Agente.findByPk(contacto.agenteDuenoId, { transaction });
    if (dueno && dueno.activo) {
      return {
        agenteId: dueno.id,
        tipo: TIPO_ASIGNACION.AUTO_CONTINUIDAD,
        motivo: 'continuidad: contacto con agente dueño',
      };
    }
    // Dueño inactivo → sigue a la regla de recepción.
  }

  // Regla 2: sin dueño (o dueño inactivo) → agente de recepción, si está activo.
  const recepcionId = env.agenteRecepcionId;
  if (recepcionId) {
    const recepcion = await Agente.findByPk(recepcionId, { transaction });
    if (recepcion && recepcion.activo) {
      return {
        agenteId: recepcion.id,
        tipo: TIPO_ASIGNACION.AUTO_REGLA,
        motivo: `recepción: sin dueño → agente ${recepcion.id}`,
      };
    }
  }

  // Regla 3: sin recepción disponible → bandeja general (fallback).
  return { agenteId: null, tipo: TIPO_ASIGNACION.AUTO_REGLA, motivo: 'bandeja general' };
}

module.exports = { cascada };
