'use strict';

/**
 * Worker de la cola wa_eventos_webhook (tarea 4).
 *
 * Proceso APARTE del API (npm run worker). Lee los eventos con procesado=0 en
 * orden de id ascendente, los normaliza y los vuelca en contactos/conversaciones/
 * mensajes/acks, y marca procesado=1.
 *
 * Modos:
 *   node src/workers/index.js              → bucle continuo
 *   node src/workers/index.js --dry-run    → procesa un lote SIN escribir y sale
 *   ... --limit=N                          → tamaño del lote de dry-run
 */

require('../config/env');
const logger = require('../utils/logger');
const { sequelize, verificarConexion } = require('../config/database');
const { EventoWebhook } = require('../models');
const { procesarEventoWebhook } = require('../services/ingesta');

const LOTE = 50;
const INTERVALO_MS = 1000;
const MAX_INTENTOS = 3;

const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limiteDry = limitArg ? Number(limitArg.split('=')[1]) : 20;

const intentos = new Map(); // eventoId → nº de fallos acumulados
let corriendo = true;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Procesa un lote. Devuelve cuántos eventos tomó. */
async function procesarLote(limite) {
  const eventos = await EventoWebhook.findAll({
    where: { procesado: false },
    order: [['id', 'ASC']],
    limit: limite,
  });
  for (const evento of eventos) {
    try {
      const resumen = await procesarEventoWebhook(evento, { dryRun });
      if (!dryRun) {
        evento.procesado = true;
        evento.error = null;
        await evento.save();
      }
      intentos.delete(evento.id);
      logger.debug(`evento ${evento.id} [${resumen.clase}] ok`, resumen);
    } catch (err) {
      const n = (intentos.get(evento.id) || 0) + 1;
      intentos.set(evento.id, n);
      logger.error(`evento ${evento.id} falló (intento ${n}/${MAX_INTENTOS}): ${err.message}`);
      if (!dryRun) {
        evento.error = String(err.message).slice(0, 255);
        if (n >= MAX_INTENTOS) {
          // Marcar procesado con error para no bloquear la cola.
          evento.procesado = true;
          logger.error(`evento ${evento.id} marcado procesado con error tras ${n} intentos`);
        }
        await evento.save();
      }
    }
  }
  return eventos;
}

/** Modo dry-run: procesa un lote una sola vez, agrega el resumen, sin escribir. */
async function correrDryRun() {
  logger.info(`DRY-RUN: procesando hasta ${limiteDry} eventos SIN escribir...`);
  const eventos = await EventoWebhook.findAll({
    where: { procesado: false },
    order: [['id', 'ASC']],
    limit: limiteDry,
  });
  const agg = { total: eventos.length, mensajes: 0, contactosNuevos: 0, convNuevas: 0, acks: 0, acksAplicados: 0, fallos: 0, porClase: {} };
  for (const ev of eventos) {
    try {
      const r = await procesarEventoWebhook(ev, { dryRun: true });
      agg.mensajes += r.mensajes;
      agg.contactosNuevos += r.contactosNuevos;
      agg.convNuevas += r.convNuevas;
      agg.acks += r.acks;
      agg.acksAplicados += r.acksAplicados;
      agg.porClase[r.clase] = (agg.porClase[r.clase] || 0) + 1;
    } catch (e) {
      agg.fallos += 1;
      logger.error(`  evento ${ev.id}: ${e.message}`);
    }
  }
  logger.info('DRY-RUN resumen:');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(agg, null, 2));
}

/** Bucle continuo. */
async function bucle() {
  logger.info('Worker de ingesta arrancado. Drenando cola...');
  while (corriendo) {
    try {
      const eventos = await procesarLote(LOTE);
      if (eventos.length === 0) await esperar(INTERVALO_MS);
      // Si procesó algo, sigue de inmediato para drenar el backlog.
    } catch (err) {
      logger.error('Error en el bucle del worker', err);
      await esperar(INTERVALO_MS);
    }
  }
  logger.info('Worker detenido.');
}

async function bootstrap() {
  await verificarConexion();
  if (dryRun) {
    await correrDryRun();
    await sequelize.close();
    return;
  }
  const cerrar = (senal) => {
    logger.info(`${senal} recibido, deteniendo worker...`);
    corriendo = false;
  };
  process.on('SIGTERM', () => cerrar('SIGTERM'));
  process.on('SIGINT', () => cerrar('SIGINT'));
  await bucle();
  await sequelize.close();
}

bootstrap().catch((err) => {
  logger.error('El worker no pudo arrancar', err);
  process.exit(1);
});
