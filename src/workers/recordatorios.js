'use strict';
const { dentroDeVentana, esperaEnvioMs } = require('../services/difusionReglas');
const servicio = require('../services/recordatorios');
const logger = require('../utils/logger');

/** Hoy en hora de Colombia (UTC-5), 'YYYY-MM-DD'. */
function hoyBogota() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Un paso del barrido. deps inyectable para test. */
async function tick(ahora, deps = {}) {
  const enVentana = (deps.dentroDeVentana || dentroDeVentana)(ahora);
  if (!enVentana) return 'fuera-ventana';
  const obtenerAjustes = deps.obtenerAjustes || servicio.obtenerAjustes;
  const configurado = deps.recordatorioConfigurado || servicio.recordatorioConfigurado;
  const siguiente = deps.siguiente || servicio.siguienteRecordatorio;
  const enviar = deps.enviar || ((rec, aj, hoy) => servicio.enviarRecordatorio(rec, aj, hoy));

  const aj = await obtenerAjustes();
  if (!configurado(aj)) return 'sin-config';
  const hoy = hoyBogota();
  const rec = await siguiente(hoy);
  if (!rec) return 'nada';
  const r = await enviar(rec, aj, hoy);
  return r === 'enviado' ? 'enviado' : 'sin-progreso';
}

let corriendo = false;
async function iniciarLoop() {
  if (corriendo) return;
  corriendo = true;
  const paso = async () => {
    let espera = 60000; // sin nada que enviar / fuera de ventana: revisar cada 60 s
    try {
      if ((await tick(new Date())) === 'enviado') espera = esperaEnvioMs(); // ritmo entre envíos
    } catch (err) {
      logger.error(`worker recordatorios: ${err.message}`);
    }
    if (corriendo) setTimeout(paso, espera);
  };
  paso();
}

module.exports = { tick, iniciarLoop };
