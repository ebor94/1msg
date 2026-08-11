'use strict';

/**
 * Único punto que habla con la API de Anthropic (Claude). Resume la conversación
 * de una difusión con Haiku (rápido/barato) para registrarla en gestión.
 *
 * La ANTHROPIC_API_KEY vive solo en el .env del servidor (env.anthropic.apiKey),
 * nunca se expone al frontend ni se loguea. Regla de aislamiento: ningún otro
 * archivo importa el SDK de Anthropic.
 */

const Anthropic = require('@anthropic-ai/sdk');
const env = require('../../config/env');

const MODELO = 'claude-haiku-4-5';
const MAX_TOKENS = 200; // ~255 chars de salida + margen
const SISTEMA =
  'Eres un asistente de cartera de Los Olivos Cúcuta. Resume en español, en máximo ' +
  '255 caracteres, la conversación de WhatsApp entre la empresa y el cliente sobre el ' +
  'pago de su cuota. Enfócate en la intención, compromiso o solicitud del cliente. ' +
  'Responde SOLO con el resumen, sin preámbulos ni comillas.';

let cliente = null;
function obtenerCliente() {
  if (!env.anthropic.apiKey) { const e = new Error('Anthropic no configurado'); e.codigo = 'no_configurado'; throw e; }
  // maxRetries: el SDK reintenta 429/5xx con backoff exponencial (por defecto 2).
  if (!cliente) cliente = new Anthropic({ apiKey: env.anthropic.apiKey, maxRetries: 3 });
  return cliente;
}

/** Recorta a 255 y limpia espacios (límite de la columna gestion.novedad). */
function recortar255(s) { return String(s || '').trim().slice(0, 255); }

/** Resume la conversación. deps.cliente inyecta un cliente falso para test. */
async function resumirConversacion(texto, deps = {}) {
  const c = deps.cliente || obtenerCliente();
  const resp = await c.messages.create({
    model: MODELO,
    max_tokens: MAX_TOKENS,
    system: SISTEMA,
    messages: [{ role: 'user', content: String(texto || '') }],
  });
  const bloque = (resp.content || []).find((b) => b.type === 'text');
  return recortar255(bloque ? bloque.text : '');
}

module.exports = { resumirConversacion, recortar255 };
