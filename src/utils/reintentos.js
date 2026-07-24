'use strict';

/**
 * Reintento con backoff exponencial.
 *
 * @param {Function} fn        función async a ejecutar (recibe el nº de intento).
 * @param {object}   opciones
 * @param {number}   opciones.intentos     máximo de intentos (default 3).
 * @param {number}   opciones.baseMs        espera base (default 500).
 * @param {number}   opciones.factor        factor de crecimiento (default 2).
 * @param {Function} opciones.shouldRetry   (err) => bool; si false, no reintenta.
 * @param {Function} opciones.onRetry       (err, intento, esperaMs) para loguear.
 */
async function retryWithBackoff(fn, { intentos = 3, baseMs = 500, factor = 2, shouldRetry = () => true, onRetry } = {}) {
  let ultimoError;
  for (let i = 0; i < intentos; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      ultimoError = err;
      const esUltimo = i === intentos - 1;
      if (esUltimo || !shouldRetry(err)) break;
      const espera = baseMs * factor ** i;
      if (onRetry) onRetry(err, i + 1, espera);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  throw ultimoError;
}

module.exports = { retryWithBackoff };
