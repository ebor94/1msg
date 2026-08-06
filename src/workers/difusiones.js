'use strict';
const { Op } = require('sequelize');
const { Difusion, DifusionDestinatario } = require('../models');
const { dentroDeVentana, esperaEnvioMs } = require('../services/difusionReglas');
const { enviarDestinatario } = require('../services/difusionEnvio');
const { obtenerCatalogo } = require('../controllers/plantillasController');
const { emitirRemoto } = require('./emisorRemoto');
const logger = require('../utils/logger');

// Campaña activa: la más antigua en 'enviando' (una a la vez, FIFO).
async function campanaActivaDefault() {
  return Difusion.findOne({ where: { estado: 'enviando' }, order: [['creado_en', 'ASC']] });
}
// Próximo destinatario enviable de una campaña: pendiente, o fallido cuyo reintentar_en ya venció.
async function siguienteDestinatarioDefault(difusionId, ahora) {
  return DifusionDestinatario.findOne({
    where: {
      difusionId,
      [Op.or]: [{ estado: 'pendiente' }, { estado: 'fallido', reintentarEn: { [Op.lte]: ahora } }],
    },
    order: [['id', 'ASC']],
  });
}

/** Un paso del loop. deps inyectable para test. Devuelve qué hizo. */
async function tick(ahora, deps = {}) {
  const enVentana = (deps.dentroDeVentana || dentroDeVentana)(ahora);
  const campanaActiva = deps.campanaActiva || campanaActivaDefault;
  const siguiente = deps.siguienteDestinatario || ((id) => siguienteDestinatarioDefault(id, ahora));
  const catalogo = deps.catalogo || obtenerCatalogo;
  const emitir = deps.emitirRemoto || emitirRemoto;
  const finalizar = deps.finalizar || (async (dif) => { await dif.update({ estado: 'finalizada' }); emitir('difusion:progreso', {}, { difusionId: dif.id, estado: 'finalizada' }); });
  const enviar = deps.enviar || (async (dest, dif, def) => enviarDestinatario(dest, dif, def));

  const dif = await campanaActiva();
  if (!dif) return 'sin-campana';
  if (!enVentana) return 'fuera-ventana';
  const dest = await siguiente(dif.id);
  if (!dest) { await finalizar(dif); return 'finalizada'; }
  const def = (await catalogo()).find((p) => p.name === dif.plantillaNombre);
  if (!def) { logger.error(`difusión ${dif.id}: plantilla ${dif.plantillaNombre} no está en el catálogo`); return 'sin-plantilla'; }
  await enviar(dest, dif, def);
  emitir('difusion:progreso', {}, { difusionId: dif.id }); // destino vacío → room 'admins'
  return 'enviado';
}

let corriendo = false;
async function iniciarLoop() {
  if (corriendo) return;
  corriendo = true;
  const paso = async () => {
    let espera = 5000; // sin campaña / fuera de ventana: revisar cada 5 s
    try {
      const r = await tick(new Date());
      if (r === 'enviado') espera = esperaEnvioMs(); // ritmo entre mensajes (20 s + jitter)
    } catch (err) {
      logger.error(`worker difusiones: ${err.message}`);
    }
    if (corriendo) setTimeout(paso, espera);
  };
  paso();
}

module.exports = { tick, iniciarLoop, campanaActivaDefault, siguienteDestinatarioDefault };
