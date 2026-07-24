'use strict';

/**
 * Cascada de asignación de una conversación entrante (regla de negocio, CLAUDE.md):
 *   1. Si el contacto ya tiene agente_dueno_id (y está activo) → ese agente (continuidad).
 *   2. En cualquier otro caso → bandeja general (agente_id NULL).
 *
 * Decisión 2026-07-24: se descartó el cruce automático con clientes de serfuweb.
 * Todo cae a general y el agente toma el chat manualmente (Fase 2); al tomarlo se
 * vuelve dueño del contacto y la regla 1 le devuelve los próximos mensajes.
 */

const { TIPO_ASIGNACION, ROL_AGENTE } = require('../config/constants');

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
    // Dueño inactivo → sigue a la regla temporal.
  }

  // TEMPORAL (por ahora): sin dueño → repartir al azar entre los administradores
  // activos (hoy: bortega, ssuarez). Al incorporar asesores se revisará (volver a
  // general o rotación entre asesores).
  const admins = await Agente.findAll({
    where: { rol: ROL_AGENTE.ADMINISTRADOR, activo: true },
    attributes: ['id'],
    transaction,
  });
  if (admins.length) {
    const elegido = admins[Math.floor(Math.random() * admins.length)];
    return {
      agenteId: elegido.id,
      tipo: TIPO_ASIGNACION.AUTO_ROTACION,
      motivo: 'reparto temporal entre administradores',
    };
  }

  // Sin administradores → bandeja general.
  return { agenteId: null, tipo: TIPO_ASIGNACION.AUTO_REGLA, motivo: 'bandeja general' };
}

module.exports = { cascada };
