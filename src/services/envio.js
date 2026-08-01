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

/**
 * Decide con qué identificador se envía a 1msg (BSUID de WhatsApp):
 *  - Contacto normal (@c.us) → { chatId: waId } (como siempre).
 *  - Contacto @lid (número oculto por privacidad) → { phone: bsuid }. 1msg mapea
 *    el BSUID al teléfono real y entrega. Enviar el @lid como chatId falla (1msg
 *    lo recorta a dígitos). El bsuid es el authorBsuid del entrante = waId sin @lid.
 */
function destinatario1msg(contacto) {
  const waId = String(contacto?.waId || '');
  if (/@lid$/i.test(waId)) {
    const bsuid = contacto.bsuid || waId.replace(/@lid$/i, '');
    return { phone: bsuid };
  }
  return { chatId: waId };
}

/** Un contacto desactivado no puede recibir mensajes salientes. */
function contactoActivo(contacto) {
  return !(contacto && contacto.desactivadoEn);
}

module.exports = { ventanaAbierta, conFirma, destinatario1msg, contactoActivo };
