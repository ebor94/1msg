'use strict';
const { sequelize } = require('../config/database');
const { Conversacion, Mensaje, Contacto } = require('../models');
const { DIRECCION, TIPO_MENSAJE, ESTADO_MENSAJE, ESTADO_CONVERSACION } = require('../config/constants');

/** Pura: agente a usar en el envío y si hay que fijar el dueño del contacto. */
function decidirAgenteEnvio({ reasignar, duenoActual, agenteDifusion }) {
  const agenteId = reasignar ? (agenteDifusion || duenoActual || null) : (duenoActual || agenteDifusion || null);
  const fijarDueno = !!agenteId && (reasignar ? duenoActual !== agenteId : !duenoActual);
  return { agenteId, fijarDueno };
}

/** Pura: si hay que mover la conversación existente al agente elegido. */
function debeMoverConversacion({ reasignar, estado, convAgente, agenteId }) {
  return agenteId != null && convAgente !== agenteId && (reasignar || estado === ESTADO_CONVERSACION.CERRADA);
}

/**
 * Persiste un envío saliente de plantilla en la bandeja: reusa/crea la conversación
 * del contacto (cerrada, con el `origen` dado), asigna dueño si falta (sin reabrir un
 * chat abierto), y crea el mensaje saliente (enviado_por_id NULL, idempotente por
 * waMessageId). `extra(t, convId)` corre en la misma transacción para el bookkeeping
 * del llamador. Devuelve el id de la conversación.
 */
async function persistirEnvioPlantilla({ contactoId, agenteFallback, canalId, plantillaNombre, texto, waMessageId, origen, mediaUrl, reasignar }, extra) {
  const ahora = new Date();
  let convId;
  await sequelize.transaction(async (t) => {
    const contacto = await Contacto.findByPk(contactoId, { transaction: t });
    const { agenteId, fijarDueno } = decidirAgenteEnvio({ reasignar: !!reasignar, duenoActual: contacto.agenteDuenoId || null, agenteDifusion: agenteFallback || null });
    if (fijarDueno) await contacto.update({ agenteDuenoId: agenteId }, { transaction: t });

    let conv = await Conversacion.findOne({ where: { contactoId }, order: [['id', 'DESC']], transaction: t });
    if (!conv) {
      conv = await Conversacion.create({
        canalId, contactoId, agenteId, estado: ESTADO_CONVERSACION.CERRADA, origen, cerradaEn: ahora,
      }, { transaction: t });
    } else if (debeMoverConversacion({ reasignar: !!reasignar, estado: conv.estado, convAgente: conv.agenteId, agenteId })) {
      await conv.update({ agenteId }, { transaction: t }); // enruta el chat (resuelto sin reabrir; abierto solo con reasignar)
    }

    await Mensaje.findOrCreate({
      where: { waMessageId },
      defaults: {
        conversacionId: conv.id, waMessageId, direccion: DIRECCION.OUT, tipo: TIPO_MENSAJE.TEMPLATE,
        texto, plantillaNombre, estado: ESTADO_MENSAJE.ENVIADO, enviadoPorId: null, tsProveedor: ahora,
        mediaUrl: mediaUrl || null,
      },
      transaction: t,
    });
    await conv.update({ ultimoMensajeEn: ahora, ultimoMensajeTexto: texto.slice(0, 255), ultimoMensajeDir: DIRECCION.OUT }, { transaction: t });
    convId = conv.id;
    if (extra) await extra(t, conv.id);
  });
  return convId;
}

module.exports = { persistirEnvioPlantilla, decidirAgenteEnvio, debeMoverConversacion };
