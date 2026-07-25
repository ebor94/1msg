'use strict';

const axios = require('axios');
const env = require('../../config/env');
const { retryWithBackoff } = require('../../utils/reintentos');
const { OneMsgError } = require('../../utils/errors');

function construirUrl(path) {
  return `${env.onemsg.baseUrl}/${env.onemsg.instanceId}/${path}?token=${env.onemsg.token}`;
}

async function listarPlantillas(deps = {}) {
  const http = deps.http || axios;
  const r = await http.get(construirUrl('templates'), { timeout: 20000, validateStatus: (s) => s < 500 });
  const t = (r.data && r.data.templates) || [];
  return t.filter((p) => p.status === 'approved');
}

async function enviarPlantilla({ phone, template, language, params }, deps = {}) {
  const http = deps.http || axios;
  const baseMs = deps.baseMs || 800;
  const cuerpo = { template, language, params: params || [], phone };

  const resp = await retryWithBackoff(
    async () => {
      const r = await http.post(construirUrl('sendTemplate'), cuerpo, {
        timeout: 20000,
        headers: { 'content-type': 'application/json' },
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
  if (data.sent === true && data.id) return { id: String(data.id), sent: true };
  const codigo = data.error && (data.error.code ?? data.error.error_code);
  throw new OneMsgError(data.message || 'plantilla no enviada por 1msg', { codigo: codigo != null ? String(codigo) : null });
}

module.exports = { listarPlantillas, enviarPlantilla };
