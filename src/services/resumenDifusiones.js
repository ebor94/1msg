'use strict';
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { DifusionDestinatario } = require('../models');
const { resumirConversacion } = require('../integrations/anthropic/resumen');
const { consultarPlanesPorDocumento, insertarGestion } = require('../integrations/prevision/cliente');

const CONCEPTO_WHATSAPP = '49';
const TRAMITO_IA = 'IA';
const SIN_RESPUESTA = 'Sin respuesta del cliente';

/**
 * Arma el texto de la conversación de un destinatario: el mensaje saliente de la
 * plantilla + las respuestas ENTRANTES del cliente posteriores al envío. Los
 * no-texto se representan por su tipo (no traen cuerpo útil para el resumen).
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
  const entrantes = await sequelize.query(
    `SELECT texto, tipo FROM wa_mensajes
      WHERE conversacion_id = :conv AND direccion = 'in' AND ts_proveedor > :ts
      ORDER BY ts_proveedor ASC`,
    { type: QueryTypes.SELECT, replacements: { conv: env.convId, ts: env.tsEnviado } },
  );
  const lineas = [`Mensaje enviado por la empresa: ${env.textoEnviado || ''}`];
  if (entrantes.length) {
    lineas.push('Respuestas del cliente:');
    for (const m of entrantes) {
      lineas.push(`- ${m.tipo === 'texto' ? (m.texto || '') : `[${m.tipo}]`}`);
    }
  }
  return { texto: lineas.join('\n'), huboRespuesta: entrantes.length > 0 };
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

module.exports = { construirTextoConversacion, siguientePendiente, marcarResumido, procesarPendiente };
