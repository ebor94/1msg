'use strict';
const { sequelize } = require('../config/database');
const { Contacto } = require('../models');
const { enviarPlantilla } = require('../integrations/onemsg/plantillas');
const { construirParams, construirParamsHeader, construirParamsCarrusel, renderizarCuerpo } = require('./plantillas');
const { clasificarError } = require('./difusionReglas');
const { persistirEnvioPlantilla } = require('./envioPlantilla');
const { ORIGEN_CONVERSACION } = require('../config/constants');
const logger = require('../utils/logger');

/** Pura: arma el cuerpo de enviarPlantilla (carrusel, o header de imagen + body). */
function payloadDeEnvio(dif, def, dest, telefono) {
  const base = {
    phone: telefono,
    template: dif.plantillaNombre,
    language: { code: dif.plantillaIdioma || def.language || 'es', policy: 'deterministic' },
    namespace: def.namespace || null,
  };
  if (def.esCarrusel && dif.carrusel) {
    return { ...base, params: construirParamsCarrusel(dif.carrusel, def.carrusel) };
  }
  const header = def.tieneImagen ? construirParamsHeader(dif.imagenUrl || def.imagenDefault) : [];
  return { ...base, params: [...header, ...construirParams(dest.parametros)] };
}

/** Pura: texto y media que se guardan en el mensaje saliente de la bandeja. */
function textoYMediaSaliente(dif, def, dest) {
  if (def.esCarrusel && dif.carrusel) {
    const cards = dif.carrusel.cards || [];
    const texto = `${renderizarCuerpo(def.cuerpo, dif.carrusel.bodyVars || [])} 📸 Carrusel (${cards.length} tarjetas)`.trim();
    return { texto, mediaUrl: (cards[0] && cards[0].imagenUrl) || null };
  }
  return {
    texto: renderizarCuerpo(def.cuerpo, dest.parametros),
    mediaUrl: def.tieneImagen ? (dif.imagenUrl || def.imagenDefault) : null,
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

  const { texto, mediaUrl } = textoYMediaSaliente(dif, def, dest);
  await persistirEnvioPlantilla({
    contactoId: dest.contactoId, agenteFallback: dest.agenteId, canalId: dif.canalId,
    plantillaNombre: dif.plantillaNombre, texto, waMessageId: enviado.id, origen: ORIGEN_CONVERSACION.DIFUSION,
    mediaUrl,
  }, async (t) => {
    await dest.update({ estado: 'enviado', waMessageId: enviado.id, intentos: dest.intentos + 1, errorCodigo: null }, { transaction: t });
  });

  // El chat queda en resueltos; el progreso a admins lo emite el worker. La reapertura
  // (cuando el cliente responde) la maneja la ingesta existente.
  return 'enviado';
}

module.exports = { payloadDeEnvio, textoYMediaSaliente, enviarDestinatario };
