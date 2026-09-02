'use strict';
const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');

const SUBDIR = 'difusiones';
const MAX_BYTES = 5 * 1024 * 1024; // límite de WhatsApp para imagen de encabezado

function err400(msg) { const e = new Error(msg); e.status = 400; return e; }

/** Dimensiones de un JPEG recorriendo hasta un marcador SOF. null si no se hallan. */
function dimensionesJpeg(buf) {
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { alto: buf.readUInt16BE(i + 5), ancho: buf.readUInt16BE(i + 7) };
    }
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** Valida por bytes reales que sea JPEG/PNG ≤5 MB y devuelve { formato, ancho, alto }. */
function leerImagen(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) throw err400('imagen ilegible o corrupta');
  if (buffer.length > MAX_BYTES) throw err400('la imagen supera 5 MB');
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    const ancho = buffer.readUInt32BE(16);
    const alto = buffer.readUInt32BE(20);
    if (!ancho || !alto) throw err400('imagen ilegible o corrupta');
    return { formato: 'png', ancho, alto };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    const dim = dimensionesJpeg(buffer);
    if (!dim || !dim.ancho || !dim.alto) throw err400('imagen ilegible o corrupta');
    return { formato: 'jpg', ancho: dim.ancho, alto: dim.alto };
  }
  throw err400('formato no soportado: usa JPEG o PNG');
}

/** Nombre determinístico por campaña (y por tarjeta si se da cardIndex). */
function nombreArchivoImagen(difusionId, formato, cardIndex) {
  if (!['jpg', 'png'].includes(formato)) throw err400('formato no soportado: usa JPEG o PNG');
  const sufijo = cardIndex === undefined || cardIndex === null ? '' : `-c${Number(cardIndex)}`;
  return `dif-${difusionId}${sufijo}.${formato}`;
}

/** Ruta absoluta segura del archivo servible; rechaza traversal. */
function rutaAbsolutaImagen(nombre) {
  if (/[\\/]/.test(String(nombre)) || String(nombre).includes('..')) throw err400('nombre inválido');
  return path.join(env.media.path, SUBDIR, String(nombre));
}

/** Valida el buffer, guarda la imagen y devuelve URL pública + dimensiones. */
async function guardarImagen(difusionId, buffer, cardIndex) {
  const { formato, ancho, alto } = leerImagen(buffer);
  const nombre = nombreArchivoImagen(difusionId, formato, cardIndex);
  const abs = rutaAbsolutaImagen(nombre);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  const base = (env.publicBaseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return { rutaRelativa: path.join(SUBDIR, nombre), url: `${base}/media-difusion/${nombre}`, ancho, alto };
}

module.exports = { leerImagen, nombreArchivoImagen, rutaAbsolutaImagen, guardarImagen };
