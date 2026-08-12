'use strict';
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { DifusionDestinatario } = require('../models');
const { resumirConversacion } = require('../integrations/anthropic/resumen');
const { consultarPlanesPorDocumento, insertarGestion } = require('../integrations/prevision/cliente');
const { DIRECCION } = require('../config/constants');

const CONCEPTO_WHATSAPP = '49';
const TRAMITO_IA = 'IA';
const SIN_RESPUESTA = 'Sin respuesta del cliente';

/**
 * Etiqueta un mensaje para la transcripción: usa el texto si lo hay (cubre texto,
 * plantilla con cuerpo y pies de foto); si no, cae a `[tipo]` (media sin texto).
 */
function cuerpoMensaje(m) {
  return m.texto && String(m.texto).trim() !== '' ? String(m.texto) : `[${m.tipo}]`;
}

/**
 * Pura: arma la transcripción a partir del texto enviado y los mensajes
 * posteriores (entrantes del cliente + salientes escritos por un agente humano),
 * en orden. `huboRespuesta` es true solo si hubo al menos un mensaje del cliente
 * (los mensajes del agente aportan contexto pero no cuentan como respuesta).
 */
function construirTranscripcion(textoEnviado, mensajes) {
  const lineas = [`Mensaje enviado por la empresa: ${textoEnviado || ''}`];
  let huboRespuesta = false;
  for (const m of mensajes || []) {
    if (m.direccion === DIRECCION.IN) {
      huboRespuesta = true;
      lineas.push(`Cliente: ${cuerpoMensaje(m)}`);
    } else {
      lineas.push(`Agente: ${cuerpoMensaje(m)}`);
    }
  }
  return { texto: lineas.join('\n'), huboRespuesta };
}

/**
 * Arma el texto de la conversación de un destinatario: el mensaje saliente de la
 * plantilla (la difusión) + los mensajes posteriores al envío — respuestas
 * ENTRANTES del cliente y salientes escritos por un AGENTE humano
 * (`enviado_por_id` no nulo, lo que excluye la propia difusión y las
 * auto-respuestas). Así el resumen refleja aclaraciones del agente (p. ej.
 * "el mensaje se envió por error").
 */
async function construirTextoConversacion(destId) {
  const [env] = await sequelize.query(
    `SELECT env.texto AS textoEnviado, env.ts_proveedor AS tsEnviado, env.conversacion_id AS convId
       FROM wa_difusion_destinatarios dd
       JOIN wa_mensajes env ON env.wa_message_id = dd.wa_message_id
      WHERE dd.id = :id`,
    { type: QueryTypes.SELECT, replacements: { id: destId } },
  );
  if (!env) return { texto: '', huboRespuesta: false };
  const mensajes = await sequelize.query(
    `SELECT direccion, tipo, texto FROM wa_mensajes
      WHERE conversacion_id = :conv AND ts_proveedor > :ts
        AND (direccion = 'in' OR (direccion = 'out' AND enviado_por_id IS NOT NULL))
      ORDER BY ts_proveedor ASC, id ASC`,
    { type: QueryTypes.SELECT, replacements: { conv: env.convId, ts: env.tsEnviado } },
  );
  return construirTranscripcion(env.textoEnviado, mensajes);
}

/**
 * Próximo destinatario a resumir: de difusiones con requiere_resumen=1 y
 * finalizadas, enviado, con cédula y sin resumir todavía (resumen_en IS NULL).
 */
async function siguientePendiente() {
  const [row] = await sequelize.query(
    `SELECT dd.id, dd.documento
       FROM wa_difusion_destinatarios dd
       JOIN wa_difusiones d ON d.id = dd.difusion_id
      WHERE d.requiere_resumen = 1 AND d.estado = 'finalizada'
        AND dd.resumen_en IS NULL AND dd.documento IS NOT NULL
        AND dd.estado IN ('enviado','entregado','leido')
      ORDER BY dd.id ASC LIMIT 1`,
    { type: QueryTypes.SELECT },
  );
  return row || null;
}

async function marcarResumido(destId) {
  await DifusionDestinatario.update({ resumenEn: new Date() }, { where: { id: destId } });
}

/**
 * Procesa un destinatario: arma el texto, resume (o "Sin respuesta"), mapea la
 * cédula al primer plan e inserta la gestión; marca resumen_en (idempotencia).
 * Los errores de config/IA/gestión se propagan; el worker decide si marcar.
 */
async function procesarPendiente(dest, deps = {}) {
  const construir = deps.construirTexto || construirTextoConversacion;
  const resumir = deps.resumir || resumirConversacion;
  const planes = deps.consultarPlanes || consultarPlanesPorDocumento;
  const insertar = deps.insertarGestion || insertarGestion;
  const marcar = deps.marcar || marcarResumido;

  const { texto, huboRespuesta } = await construir(dest.id);
  const novedad = huboRespuesta ? await resumir(texto) : SIN_RESPUESTA;

  const filas = await planes(dest.documento);
  if (!filas.length) { await marcar(dest.id); return 'sin-plan'; }
  const numPlan = filas[0].num_plan;

  await insertar({ numPlan, concepto: CONCEPTO_WHATSAPP, novedad, tramito: TRAMITO_IA });
  await marcar(dest.id);
  return 'resumido';
}

module.exports = { construirTranscripcion, construirTextoConversacion, siguientePendiente, marcarResumido, procesarPendiente };
