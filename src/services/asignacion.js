'use strict';

/**
 * Cascada de asignación de una conversación entrante (regla de negocio, CLAUDE.md):
 *   1. Si el contacto ya tiene agente_dueno_id (y está activo) → ese agente (continuidad).
 *   2. Si el número cruza con un cliente de serfuweb con asesor → ese asesor.
 *   3. En cualquier otro caso → bandeja general (agente_id NULL).
 *
 * La regla 2 depende del cruce con las tablas del core de serfuweb, que aún NO
 * está definido (qué tabla/columna). Queda como gancho `resolverAsesorSerfuweb`
 * que hoy devuelve null; al conectarlo, la cascada funciona sin más cambios.
 */

const { TIPO_ASIGNACION } = require('../config/constants');

/**
 * Gancho para la regla 2. Debe devolver el id de un wa_agentes (asesor) o null.
 * TODO: definir el cruce número→cliente serfuweb→asesor.
 */
async function resolverAsesorSerfuweb(/* contacto, { transaction } */) {
  return null;
}

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
    // Dueño inactivo → cae a general (regla de reapertura).
  }

  // Regla 2: cliente de serfuweb con asesor (pendiente de mapeo).
  const asesorId = await resolverAsesorSerfuweb(contacto, { transaction });
  if (asesorId) {
    return { agenteId: asesorId, tipo: TIPO_ASIGNACION.AUTO_REGLA, motivo: 'cliente serfuweb con asesor' };
  }

  // Regla 3: bandeja general.
  return { agenteId: null, tipo: TIPO_ASIGNACION.AUTO_REGLA, motivo: 'bandeja general' };
}

module.exports = { cascada, resolverAsesorSerfuweb };
