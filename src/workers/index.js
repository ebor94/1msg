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

const { Op } = require('sequelize');
const env = require('../config/env');
const logger = require('../utils/logger');
const { sequelize, verificarConexion } = require('../config/database');
const { EventoWebhook } = require('../models');
const { procesarEventoWebhook } = require('../services/ingesta');
const { iniciarLoop: iniciarDifusiones } = require('./difusiones');
const { iniciarLoop: iniciarRecordatorios } = require('./recordatorios');
const { iniciarLoop: iniciarResumenDifusiones } = require('./resumenDifusiones');
const { generarBorrador } = require('../services/borradorIa');

/**
 * Avisa al API (mismo host, proceso aparte) para que emita por el socket.
 * Best-effort: un fallo de red o del endpoint interno NUNCA debe tumbar el
 * procesamiento del evento (el socket no es la fuente de verdad, invariante 6).
 */
async function avisarSocket(ev) {
  try {
    const res = await fetch(`http://127.0.0.1:${env.port}/internal/emitir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': env.webhookSecret },
      body: JSON.stringify(ev),
    });
    if (!res.ok) logger.warn(`aviso socket devolvió ${res.status} (revisar WEBHOOK_SECRET/PORT)`);
  } catch (e) {
    logger.warn(`aviso socket falló (no crítico): ${e.message}`);
  }
}

const LOTE = 50;
const INTERVALO_MS = 1000;
const MAX_INTENTOS = 3;

// Purga de la bitácora: los eventos ya procesados con más de 60 días se borran.
// wa_eventos_webhook es cola + auditoría cruda; sin purga crece sin límite.
const RETENCION_DIAS = 60;
const PURGA_LOTE = 5000; // borra en tandas para no tomar un lock largo
const PURGA_CADA_MS = 24 * 60 * 60 * 1000; // una vez al día

const dryRun = process.argv.includes('--dry-run');
const unaVez = process.argv.includes('--once'); // procesa un lote real y sale
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
        if (resumen.eventosSocket?.length) {
          for (const ev of resumen.eventosSocket) await avisarSocket(ev);
        }
        // Borrador IA: por cada entrante, generar sugerencia (best-effort, no bloquea la cola).
        for (const ev of resumen.eventosSocket) {
          if (ev.evento === 'mensaje:nuevo' && ev.payload?.mensaje?.direccion === 'in') {
            try {
              const borrador = await generarBorrador(ev.payload.conversacionId);
              if (borrador) {
                await avisarSocket({ evento: 'conversacion:borrador', destino: ev.destino, payload: { conversacionId: ev.payload.conversacionId, borrador } });
              }
            } catch (e) {
              logger.warn(`borrador IA conv ${ev.payload.conversacionId}: ${e.message}`);
            }
          }
        }
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

/**
 * Borra eventos ya procesados con más de RETENCION_DIAS días, en tandas para no
 * tomar un lock largo. Best-effort: un fallo se loguea y no tumba el worker.
 */
async function purgarEventosViejos() {
  const corte = new Date(Date.now() - RETENCION_DIAS * 24 * 60 * 60 * 1000);
  try {
    let total = 0;
    let n;
    do {
      n = await EventoWebhook.destroy({
        where: { procesado: true, recibidoEn: { [Op.lt]: corte } },
        limit: PURGA_LOTE,
      });
      total += n;
    } while (n === PURGA_LOTE);
    if (total > 0) logger.info(`Purga: ${total} eventos webhook >${RETENCION_DIAS}d eliminados.`);
  } catch (e) {
    logger.error(`Purga de eventos falló (no crítico): ${e.message}`);
  }
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
  if (unaVez) {
    const lote = limitArg ? limiteDry : LOTE;
    logger.info(`Corrida única: procesando hasta ${lote} eventos (real)...`);
    const eventos = await procesarLote(lote);
    logger.info(`Corrida única: ${eventos.length} eventos procesados.`);
    await sequelize.close();
    return;
  }
  const timerPurga = setInterval(purgarEventosViejos, PURGA_CADA_MS);
  timerPurga.unref(); // no mantener vivo el proceso solo por este timer
  const cerrar = (senal) => {
    logger.info(`${senal} recibido, deteniendo worker...`);
    corriendo = false;
    clearInterval(timerPurga);
  };
  process.on('SIGTERM', () => cerrar('SIGTERM'));
  process.on('SIGINT', () => cerrar('SIGINT'));
  await purgarEventosViejos(); // una purga al arrancar
  iniciarDifusiones(); // arranca junto al bucle de eventos, no lo bloquea
  iniciarRecordatorios(); // idem: barrido diario de recordatorios, no lo bloquea
  iniciarResumenDifusiones(); // idem: barrido diario de resúmenes de difusión (~19:00), no lo bloquea
  await bucle();
  clearInterval(timerPurga);
  await sequelize.close();
}

bootstrap().catch((err) => {
  logger.error('El worker no pudo arrancar', err);
  process.exit(1);
});
