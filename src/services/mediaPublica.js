'use strict';

const crypto = require('crypto');

const TTL_MS = 15 * 60 * 1000;
const almacen = new Map(); // token → { rutaRelativa, mime, expira }

/** Elimina entradas vencidas (barrido perezoso; el volumen es bajo). */
function podar(ahora) {
  for (const [k, v] of almacen) {
    if (ahora > v.expira) almacen.delete(k);
  }
}

/** Registra un archivo servible públicamente por un token efímero. */
function registrar(rutaRelativa, mime) {
  const ahora = Date.now();
  podar(ahora);
  const token = crypto.randomBytes(32).toString('hex');
  almacen.set(token, { rutaRelativa, mime, expira: ahora + TTL_MS });
  return token;
}

/** Devuelve la entrada si el token existe y no expiró, o null. */
function resolver(token, ahora = Date.now()) {
  const e = almacen.get(token);
  if (!e) return null;
  if (ahora > e.expira) { almacen.delete(token); return null; }
  return e;
}

module.exports = { registrar, resolver, TTL_MS };
