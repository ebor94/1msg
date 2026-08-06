'use strict';
const { sequelize } = require('../config/database');
const { Conversacion, Mensaje, Contacto } = require('../models');
const { enviarPlantilla } = require('../integrations/onemsg/plantillas');
const { construirParams, construirParamsHeader, renderizarCuerpo } = require('./plantillas');
const { clasificarError } = require('./difusionReglas');
const { DIRECCION, TIPO_MENSAJE, ESTADO_MENSAJE, ESTADO_CONVERSACION, ORIGEN_CONVERSACION } = require('../config/constants');
const logger = require('../utils/logger');

/** Pura: arma el cuerpo de enviarPlantilla (header de imagen si aplica). */
function payloadDeEnvio(dif, def, dest, telefono) {
  const header = def.tieneImagen ? construirParamsHeader(dif.imagenUrl || def.imagenDefault) : [];
  return {
    phone: telefono,
    template: dif.plantillaNombre,
    language: { code: dif.plantillaIdioma || def.language || 'es', policy: 'deterministic' },
    namespace: def.namespace || null,
    params: [...header, ...construirParams(dest.parametros)],
  };
}

/**
 * Envía la plantilla a un destinatario y persiste el resultado. Devuelve el estado
 * final. En éxito: crea/reusa la conversación (origen difusion, cerrada), asigna
 * agente si el contacto no tiene dueño, y crea el mensaje saliente (enviado_por_id NULL).
 */
async function enviarDestinatario(dest, dif, def, deps = {}) {
  const enviar = deps.enviarPlantilla || enviarPlantilla;
  const contacto = await Contacto.findByPk(dest.contactoId);
  let enviado;
  try {
    // Al menos una vez: si el proceso falla entre este envío exitoso y la
    // transacción de persistencia de abajo, el worker puede reintentar y
    // reenviar a este destinatario (aceptado para el MVP).
    enviado = await enviar(payloadDeEnvio(dif, def, dest, contacto.telefono));
  } catch (err) {
    const clas = clasificarError(err.codigo);
    const reintentarEn = clas.reintentarEnMin ? new Date(Date.now() + clas.reintentarEnMin * 60000) : null;
    await sequelize.transaction(async (t) => {
      await dest.update({ estado: clas.estado, errorCodigo: err.codigo || null, intentos: dest.intentos + 1, reintentarEn }, { transaction: t });
      if (clas.marcarExperimento) await Contacto.update({ waExperimento: true }, { where: { id: dest.contactoId }, transaction: t });
    });
    logger.warn(`difusión ${dif.id} dest ${dest.id}: ${clas.estado} [${err.codigo || ''}]`);
    return clas.estado;
  }

  const texto = renderizarCuerpo(def.cuerpo, dest.parametros);
  const ahora = new Date();
  await sequelize.transaction(async (t) => {
    const contacto = await Contacto.findByPk(dest.contactoId, { transaction: t });
    // Dueño: si el contacto ya tiene, se respeta; si no, el del CSV.
    const agenteId = contacto.agenteDuenoId || dest.agenteId || null;
    if (!contacto.agenteDuenoId && agenteId) await contacto.update({ agenteDuenoId: agenteId }, { transaction: t });

    // Reusar la última conversación; si está cerrada o no hay, crear/dejar en cerrada.
    let conv = await Conversacion.findOne({ where: { contactoId: contacto.id }, order: [['id', 'DESC']], transaction: t });
    if (!conv) {
      conv = await Conversacion.create({
        canalId: dif.canalId, contactoId: contacto.id, agenteId,
        estado: ESTADO_CONVERSACION.CERRADA, origen: ORIGEN_CONVERSACION.DIFUSION, cerradaEn: ahora,
      }, { transaction: t });
    } else if (conv.estado === ESTADO_CONVERSACION.CERRADA && conv.agenteId !== agenteId) {
      await conv.update({ agenteId }, { transaction: t }); // enruta el resuelto al agente resuelto, sin reabrir
    }

    await Mensaje.findOrCreate({
      where: { waMessageId: enviado.id },
      defaults: {
        conversacionId: conv.id, waMessageId: enviado.id, direccion: DIRECCION.OUT,
        tipo: TIPO_MENSAJE.TEMPLATE, texto, plantillaNombre: dif.plantillaNombre,
        estado: ESTADO_MENSAJE.ENVIADO, enviadoPorId: null, tsProveedor: ahora,
      },
      transaction: t,
    });
    await conv.update({ ultimoMensajeEn: ahora, ultimoMensajeTexto: texto.slice(0, 255), ultimoMensajeDir: DIRECCION.OUT }, { transaction: t });
    await dest.update({ estado: 'enviado', waMessageId: enviado.id, intentos: dest.intentos + 1, errorCodigo: null }, { transaction: t });
  });

  // El chat queda en resueltos; el progreso a admins lo emite el worker. La reapertura
  // (cuando el cliente responde) la maneja la ingesta existente.
  return 'enviado';
}

module.exports = { payloadDeEnvio, enviarDestinatario };
