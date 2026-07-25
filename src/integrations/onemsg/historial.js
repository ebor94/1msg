'use strict';

const axios = require('axios');
const env = require('../../config/env');
const { retryWithBackoff } = require('../../utils/reintentos');
const { OneMsgError } = require('../../utils/errors');

function construirUrl(chatId, lastMessageNumber, limit) {
  const qs = new URLSearchParams({
    token: env.onemsg.token,
    chatId,
    lastMessageNumber: String(lastMessageNumber),
    limit: String(limit),
  });
  return `${env.onemsg.baseUrl}/${env.onemsg.instanceId}/messages?${qs.toString()}`;
}

function codigoDe(data) {
  const c = data && (data.error?.code ?? data.error?.error_code ?? data.code);
  return c != null ? String(c) : null;
}

/**
 * Una página del historial de un chat (GET /messages). `lastMessageNumber=0` da
 * los más viejos; se avanza con el mayor messageNumber de la página. Reintenta 429.
 * @returns {Promise<Array>} mensajes crudos de 1msg.
 */
async function paginaHistorial({ chatId, lastMessageNumber = 0, limit = 100 }, deps = {}) {
  const http = deps.http || axios;
  const baseMs = deps.baseMs || 800;

  const resp = await retryWithBackoff(
    async () => {
      const r = await http.get(construirUrl(chatId, lastMessageNumber, limit), {
        timeout: 30000,
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
  if (resp.status >= 400) {
    throw new OneMsgError(data.message || `historial: 1msg respondió ${resp.status}`, { codigo: codigoDe(data) || String(resp.status) });
  }
  return Array.isArray(data.messages) ? data.messages : [];
}

module.exports = { paginaHistorial };
