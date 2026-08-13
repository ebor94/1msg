'use strict';

/**
 * Único punto (junto con resumen.js) que habla con Anthropic. Redacta un BORRADOR
 * de respuesta al cliente con Claude Sonnet; el agente lo revisa y envía (la IA
 * nunca envía). La ANTHROPIC_API_KEY vive solo en el .env del server.
 */

const Anthropic = require('@anthropic-ai/sdk');
const env = require('../../config/env');

const MODELO = 'claude-sonnet-5';
const MAX_TOKENS = 500;

let cliente = null;
function obtenerCliente() {
  if (!env.anthropic.apiKey) { const e = new Error('Anthropic no configurado'); e.codigo = 'no_configurado'; throw e; }
  if (!cliente) cliente = new Anthropic({ apiKey: env.anthropic.apiKey, maxRetries: 2 });
  return cliente;
}

/** Recorta a 600 y limpia espacios (el borrador es editable por el agente). */
function recortar600(s) { return String(s || '').trim().slice(0, 600); }

/** Redacta el borrador. deps.cliente inyecta un cliente falso para test. */
async function responder(hilo, promptRol, deps = {}) {
  const c = deps.cliente || obtenerCliente();
  const resp = await c.messages.create({
    model: MODELO,
    max_tokens: MAX_TOKENS,
    // Borrador corto: en claude-sonnet-5 el thinking va ON por defecto si se omite,
    // y max_tokens es el tope combinado de thinking + texto. Lo desactivamos para
    // no gastar el presupuesto de 500 tokens en pensar ni sumar latencia.
    thinking: { type: 'disabled' },
    system: String(promptRol || ''),
    messages: [{ role: 'user', content: String(hilo || '') }],
  });
  const bloque = (resp.content || []).find((b) => b.type === 'text');
  return recortar600(bloque ? bloque.text : '');
}

module.exports = { responder, recortar600 };
