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

module.exports = { descargarMedia };
