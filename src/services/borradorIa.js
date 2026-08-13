'use strict';
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { Conversacion, Contacto, Ajuste } = require('../models');
const { responder } = require('../integrations/anthropic/responder');
const { DIRECCION } = require('../config/constants');

const CLAVE_PROMPT = 'ia_gestion_prompt';
const MAX_HILO = 20;

const PROMPT_DEFAULT =
  'Eres un asistente de atención al cliente de Los Olivos Cúcuta que redacta, en ' +
  'español y en tono cordial y breve, una posible respuesta de la empresa al último ' +
  'mensaje del cliente en WhatsApp. No inventes datos concretos que no aparezcan en la ' +
  'conversación. No hagas promesas. Responde SOLO con el texto sugerido, sin comillas.';

/** Etiqueta un mensaje: usa el texto si lo hay, si no `[tipo]`. */
function cuerpoMensaje(m) {
  return m.texto && String(m.texto).trim() !== '' ? String(m.texto) : `[${m.tipo}]`;
}

/** Pura: transcripción del hilo (Cliente/Empresa) para el prompt. */
function construirHilo(mensajes) {
  return (mensajes || [])
    .map((m) => `${m.direccion === DIRECCION.IN ? 'Cliente' : 'Empresa'}: ${cuerpoMensaje(m)}`)
    .join('\n');
}

async function cargarConversacionConContacto(conversacionId) {
  const conv = await Conversacion.findByPk(conversacionId, { attributes: ['id', 'agenteId', 'contactoId'] });
  if (!conv) return null;
  const contacto = await Contacto.findByPk(conv.contactoId, { attributes: ['id', 'gestionarConIa'] });
  return { conv, contacto };
}

async function cargarHiloReciente(conversacionId) {
  const filas = await sequelize.query(
    `SELECT direccion, tipo, texto FROM wa_mensajes
      WHERE conversacion_id = :id ORDER BY ts_proveedor DESC, id DESC LIMIT :lim`,
    { type: QueryTypes.SELECT, replacements: { id: conversacionId, lim: MAX_HILO } },
  );
  return filas.reverse(); // cronológico ascendente
}

async function cargarPromptRol() {
  const fila = await Ajuste.findOne({ where: { clave: CLAVE_PROMPT } });
  const v = fila && String(fila.valor || '').trim();
  return v || PROMPT_DEFAULT;
}

async function guardarBorrador(conversacionId, borrador) {
  await Conversacion.update({ borradorIa: borrador, borradorIaEn: new Date() }, { where: { id: conversacionId } });
}

/**
 * Genera y guarda el borrador de respuesta de una conversación si su contacto tiene
 * `gestionar_con_ia`. Devuelve el borrador (string) o null. deps inyectable para test.
 */
async function generarBorrador(conversacionId, deps = {}) {
  const cargarConv = deps.cargarConversacion || cargarConversacionConContacto;
  const cargarHilo = deps.cargarHilo || cargarHiloReciente;
  const cargarPrompt = deps.cargarPrompt || cargarPromptRol;
  const responderIa = deps.responder || responder;
  const guardar = deps.guardar || guardarBorrador;

  const cc = await cargarConv(conversacionId);
  if (!cc || !cc.contacto || !cc.contacto.gestionarConIa) return null;
  const mensajes = await cargarHilo(conversacionId);
  if (!mensajes.length) return null;
  const borrador = await responderIa(construirHilo(mensajes), await cargarPrompt());
  if (!borrador || !borrador.trim()) return null;
  await guardar(conversacionId, borrador);
  return borrador;
}

module.exports = { construirHilo, generarBorrador };
