'use strict';

const axios = require('axios');
const env = require('../../config/env');

function construirUrl(path) {
  return `${env.onemsg.baseUrl}/${env.onemsg.instanceId}/${path}?token=${env.onemsg.token}`;
}

/**
 * Comprueba la disponibilidad de la API de 1msg con una llamada barata y de solo
 * lectura al endpoint confirmado GET /webhook. 200 → arriba; 5xx (bug de su
 * plataforma) o error de red → caído. NUNCA lanza: todo fallo se traduce en arriba:false.
 * @returns {Promise<{arriba:boolean, httpStatus:number|null, detalle:string}>}
 */
async function verificarSalud(deps = {}) {
  const http = deps.http || axios;
  try {
    const r = await http.get(construirUrl('webhook'), { timeout: 15000, validateStatus: () => true });
    const arriba = r.status >= 200 && r.status < 300;
    return { arriba, httpStatus: r.status, detalle: arriba ? 'ok' : `HTTP ${r.status}` };
  } catch (e) {
    return { arriba: false, httpStatus: null, detalle: e.code || e.message || 'error de red' };
  }
}

module.exports = { verificarSalud };
