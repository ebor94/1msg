'use strict';

/**
 * Servicio de medios: dado un mensaje con URL de media, descarga el archivo
 * (con reintentos) y lo guarda en MEDIA_PATH/{año}/{mes}/{conversacion_id}/
 * {wa_message_id}.{ext}. Devuelve los campos para wa_mensajes o null si se
 * descarta (p.ej. excede tamaño) o agota reintentos — nunca pierde el mensaje.
 */

const path = require('path');
const fs = require('fs').promises;
const env = require('../config/env');
const logger = require('../utils/logger');
const { retryWithBackoff } = require('../utils/reintentos');
const { descargarMedia } = require('../integrations/onemsg/media');

/** content-type → extensión. Fallback a la de la URL, luego 'bin'. */
const EXT_POR_MIME = Object.freeze({
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'application/zip': 'zip',
});

function sanitizar(nombre) {
  return String(nombre).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

function extDeUrl(url) {
  try {
    const ext = path.extname(new URL(url).pathname).replace('.', '').toLowerCase();
    return /^[a-z0-9]{1,5}$/.test(ext) ? ext : null;
  } catch {
    return null;
  }
}

function nombreDeUrl(url) {
  try {
    return path.basename(new URL(url).pathname) || null;
  } catch {
    return null;
  }
}

/**
 * Descarga y guarda la media de un mensaje.
 * @returns campos para wa_mensajes o null si no se pudo (se deja media_ruta NULL).
 */
async function guardarMediaDeMensaje({ mediaUrl, conversacionId, waMessageId, fecha }) {
  if (!mediaUrl) return null;

  let descarga;
  try {
    descarga = await retryWithBackoff(() => descargarMedia(mediaUrl, { maxBytes: env.media.maxBytes }), {
      intentos: 3,
      baseMs: 500,
      shouldRetry: (e) => !e.noReintentar,
      onRetry: (e, n, ms) => logger.warn(`reintento descarga media ${n} en ${ms}ms para ${waMessageId}: ${e.message}`),
    });
  } catch (err) {
    // Agotó reintentos o excedió tamaño: se registra y se deja media_ruta NULL.
    logger.error(`no se pudo descargar media de ${waMessageId}: ${err.message}`);
    return null;
  }

  const { buffer, contentType, bytes } = descarga;
  const ext = EXT_POR_MIME[contentType] || extDeUrl(mediaUrl) || 'bin';

  const cuando = fecha instanceof Date && !Number.isNaN(fecha.getTime()) ? fecha : new Date();
  const anio = String(cuando.getFullYear());
  const mes = String(cuando.getMonth() + 1).padStart(2, '0');

  const rutaRelativa = path.join(anio, mes, String(conversacionId), `${sanitizar(waMessageId)}.${ext}`);
  const rutaAbsoluta = path.join(env.media.path, rutaRelativa);

  await fs.mkdir(path.dirname(rutaAbsoluta), { recursive: true });
  await fs.writeFile(rutaAbsoluta, buffer);

  // Se guarda la ruta RELATIVA a MEDIA_PATH (portable). Para abrir el archivo:
  // path.join(env.media.path, media_ruta).
  return {
    mediaRuta: rutaRelativa,
    mediaMime: contentType,
    mediaNombre: nombreDeUrl(mediaUrl),
    mediaBytes: bytes,
  };
}

/**
 * Devuelve la ruta absoluta del archivo si queda dentro de `base`; si no, null.
 * Defensa contra rutas con `..` (media_ruta la generamos nosotros, pero se valida).
 */
function rutaMediaSegura(mediaRuta, base) {
  if (!mediaRuta) return null;
  const baseAbs = path.resolve(base);
  const abs = path.resolve(baseAbs, mediaRuta);
  // Debe ser un archivo DENTRO de base: descarta escapes con `..` y la base misma.
  if (!abs.startsWith(baseAbs + path.sep)) return null;
  return abs;
}

/** mime → categoría de envío/tipo de mensaje. */
function categoriaMedia(mime) {
  const m = String(mime || '');
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'document';
}

/**
 * Guarda un buffer (archivo saliente del agente) en disco con la misma convención
 * que la media entrante. `nombreArchivo` es el nombre base sin extensión (ej. out-<token>).
 * @returns campos para wa_mensajes.
 */
async function guardarBufferComoMedia({ buffer, contentType, conversacionId, nombreArchivo, nombreOriginal, fecha }) {
  const ext = EXT_POR_MIME[contentType] || 'bin';
  const cuando = fecha instanceof Date && !Number.isNaN(fecha.getTime()) ? fecha : new Date();
  const anio = String(cuando.getFullYear());
  const mes = String(cuando.getMonth() + 1).padStart(2, '0');

  const rutaRelativa = path.join(anio, mes, String(conversacionId), `${sanitizar(nombreArchivo)}.${ext}`);
  const rutaAbsoluta = path.join(env.media.path, rutaRelativa);
  await fs.mkdir(path.dirname(rutaAbsoluta), { recursive: true });
  await fs.writeFile(rutaAbsoluta, buffer);

  return {
    mediaRuta: rutaRelativa,
    mediaMime: contentType || 'application/octet-stream',
    mediaNombre: nombreOriginal ? sanitizar(nombreOriginal) : null,
    mediaBytes: buffer.length,
  };
}

module.exports = { guardarMediaDeMensaje, rutaMediaSegura, categoriaMedia, guardarBufferComoMedia };
