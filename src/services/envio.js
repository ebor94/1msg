'use strict';

/** Helpers puros del envío: ventana de 24h y prefijo de firma. */

function ventanaAbierta(ventanaExpiraEn, ahora = new Date()) {
  if (!ventanaExpiraEn) return false;
  const exp = ventanaExpiraEn instanceof Date ? ventanaExpiraEn : new Date(ventanaExpiraEn);
  return exp.getTime() > ahora.getTime();
}

function conFirma(firma, texto) {
  return firma ? `${firma}${texto}` : texto;
}

module.exports = { ventanaAbierta, conFirma };
