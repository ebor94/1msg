'use strict';

const axios = require('axios');
const env = require('../../config/env');
const { retryWithBackoff } = require('../../utils/reintentos');
const { OneMsgError } = require('../../utils/errors');

function construirUrl(path) {
  return `${env.onemsg.baseUrl}/${env.onemsg.instanceId}/${path}?token=${env.onemsg.token}`;
}

/** Extrae un código de error de la respuesta de 1msg, si lo trae. */
function codigoDe(data) {
  const c = data && (data.error?.code ?? data.error?.error_code ?? data.code);
  return c != null ? String(c) : null;
}

/**
 * Envía un texto por 1msg (POST /sendMessage). Reintenta en 429.
 * @returns {Promise<{id:string, sent:boolean}>}
 */
async function enviarTexto({ chatId, texto, quotedMsgId }, deps = {}) {
  const http = deps.http || axios;
  const baseMs = deps.baseMs || 800;

  const params = new URLSearchParams();
  params.append('body', texto);
  params.append('chatId', chatId);
  if (quotedMsgId) params.append('quotedMsgId', quotedMsgId);

  const resp = await retryWithBackoff(
    async () => {
      const r = await http.post(construirUrl('sendMessage'), params, {
        timeout: 20000,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        validateStatus: (s) => s < 500,
      });
      if (r.status === 429) {
        const e = new Error('rate limit de 1msg (429)');
        e.reintentable = true;
        throw e;
      }
      return r;
    },
    { intentos: 3, baseMs, shouldRetry: (e) => e.reintentable === true },
  );

  const data = resp.data || {};
  if (data.sent === true && data.id) {
    return { id: String(data.id), sent: true };
  }
  throw new OneMsgError(data.message || 'envío no confirmado por 1msg', { codigo: codigoDe(data) });
}

module.exports = { enviarTexto };
