'use strict';
const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');

const EXT_POR_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' };
const SUBDIR = 'difusiones';

function err400(msg) { const e = new Error(msg); e.status = 400; return e; }

/** Nombre determinístico por campaña; rechaza mimes no soportados. */
function nombreArchivoImagen(difusionId, mime) {
  const ext = EXT_POR_MIME[String(mime || '').toLowerCase()];
  if (!ext) throw err400('formato de imagen no soportado (usa png/jpg/webp)');
  return `dif-${difusionId}.${ext}`;
}

/** Ruta absoluta segura del archivo servible; rechaza traversal. */
function rutaAbsolutaImagen(nombre) {
  if (/[\\/]/.test(String(nombre)) || String(nombre).includes('..')) throw err400('nombre inválido');
  return path.join(env.media.path, SUBDIR, String(nombre));
}

/** Guarda la imagen y devuelve su URL pública persistente. */
async function guardarImagen(difusionId, buffer, mime) {
  const nombre = nombreArchivoImagen(difusionId, mime);
  const abs = rutaAbsolutaImagen(nombre);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  const base = (env.publicBaseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return { rutaRelativa: path.join(SUBDIR, nombre), url: `${base}/media-difusion/${nombre}` };
}

module.exports = { nombreArchivoImagen, rutaAbsolutaImagen, guardarImagen, EXT_POR_MIME };
