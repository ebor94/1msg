'use strict';
// Chequeo periódico de salud de la API de 1msg. Cada CADA_MS pinga al proveedor
// y guarda up/down en wa_ajustes; eso enciende/apaga el banner automático de la
// bandeja sin intervención humana. Loguea solo las transiciones (no cada tick).
const { verificarSalud } = require('../integrations/onemsg/salud');
const servicio = require('../services/mantenimiento');
const logger = require('../utils/logger');

const CADA_MS = 2 * 60 * 1000; // cada 2 minutos

/** Un chequeo. deps inyectable para test. Devuelve el resultado del registro. */
async function tick(deps = {}) {
  const verificar = deps.verificarSalud || verificarSalud;
  const registrar = deps.registrarSaludProveedor || servicio.registrarSaludProveedor;
  const salud = await verificar();
  const r = await registrar(salud.arriba);
  if (r.cambio) {
    if (salud.arriba) logger.warn('proveedor 1msg: RECUPERADO (vuelve a responder)');
    else logger.error(`proveedor 1msg: CAÍDO (${salud.detalle}) — banner de mantenimiento activado`);
  }
  return { ...r, arriba: salud.arriba, detalle: salud.detalle };
}

let corriendo = false;
async function iniciarLoop() {
  if (corriendo) return;
  corriendo = true;
  const paso = async () => {
    try { await tick(); }
    catch (err) { logger.error(`worker salud proveedor: ${err.message}`); }
    if (corriendo) setTimeout(paso, CADA_MS);
  };
  paso();
}

module.exports = { tick, iniciarLoop, CADA_MS };
