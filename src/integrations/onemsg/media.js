'use strict';

/**
 * Único punto que descarga medios de 1msg.
 *
 * En el formato real, el webhook ya trae la URL del archivo en `body` (S3 de
 * 1msg). Esa URL es temporal (~5 min), por eso la descarga se hace al procesar
 * el evento. Si en el futuro solo tuviéramos un mediaId, aquí iría también la
 * llamada a retrieveMedia. Nada de esto sale de esta carpeta (regla de aislamiento).
 */

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
 * Descarga el contenido de una URL de media.
 * @returns {Promise<{buffer:Buffer, contentType:string|null, bytes:number}>}
 * @throws  error con `noReintentar=true` si excede el tamaño máximo.
 */
async function descargarMedia(url, { maxBytes, timeoutMs = 30000 } = {}) {
  try {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: timeoutMs,
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const buffer = Buffer.from(resp.data);
    const contentType = (resp.headers['content-type'] || '').split(';')[0].trim() || null;
    return { buffer, contentType, bytes: buffer.length };
  } catch (err) {
    // Exceder el tamaño es permanente: no tiene sentido reintentar.
    if (/maxContentLength|maxBodyLength|content length/i.test(err.message || '')) {
      const e = new Error(`media excede el tamaño máximo (${maxBytes} bytes)`);
      e.noReintentar = true;
      throw e;
    }
    throw err;
  }
}

/**
 * Envía un archivo por 1msg (POST /sendFile). El archivo se entrega como una URL
 * pública que Meta descarga (`body`). Reintenta en 429.
 * @returns {Promise<{id:string, sent:boolean}>}
 */
async function enviarArchivo({ chatId, phone, url, mediaType, caption, filename, voice }, deps = {}) {
  const http = deps.http || axios;
  const baseMs = deps.baseMs || 800;

  const params = new URLSearchParams();
  params.append('body', url);
  if (mediaType) params.append('mediaType', mediaType);
  if (caption) params.append('caption', caption);
  if (filename) params.append('filename', filename);
  if (voice) params.append('voice', 'true');
  // phone (BSUID/@lid) o chatId (contacto normal).
  if (phone) params.append('phone', phone);
  else params.append('chatId', chatId);

  const resp = await retryWithBackoff(
    async () => {
      const r = await http.post(construirUrl('sendFile'), params, {
        timeout: 30000,
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
  if (data.sent === true && data.id) return { id: String(data.id), sent: true };
  throw new OneMsgError(data.message || 'envío de archivo no confirmado por 1msg', { codigo: codigoDe(data) });
}

module.exports = { descargarMedia, enviarArchivo };
