'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { minutosLaborales } = require('./tiempoLaboral');

function err400(msg) { const e = new Error(msg); e.status = 400; return e; }

/** Hoy en hora de Colombia (UTC-5), como 'YYYY-MM-DD'. */
function hoyBogota() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Valida la fecha (o usa hoy) y arma los límites del día [ini, fin). */
function parsearFecha(fechaStr) {
  const fecha = fechaStr && fechaStr !== '' ? String(fechaStr) : hoyBogota();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw err400('fecha inválida (usar YYYY-MM-DD)');
  const finMs = Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10)) + 86400000;
  const fin = new Date(finMs).toISOString().slice(0, 10);
  return { fecha, ini: `${fecha} 00:00:00`, fin: `${fin} 00:00:00` };
}

/** Corre una fecha-hora 'YYYY-MM-DD 00:00:00' n días (aritmética TZ-free). */
function correrDias(fechaHora, dias) {
  const d = fechaHora.slice(0, 10);
  const ms = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + dias * 86400000;
  return `${new Date(ms).toISOString().slice(0, 10)} 00:00:00`;
}

function percentil(ordenados, p) {
  if (!ordenados.length) return null;
  const idx = Math.ceil((p / 100) * ordenados.length) - 1;
  return ordenados[Math.max(0, Math.min(idx, ordenados.length - 1))];
}

/** Agrupa turnos por agente y calcula prom/P90 (en minutos laborales). */
function agregarTpr(turnos) {
  const porAgente = new Map();
  for (const t of turnos) {
    const min = minutosLaborales(t.clienteTs, t.agenteTs);
    if (!porAgente.has(t.agenteId)) porAgente.set(t.agenteId, []);
    porAgente.get(t.agenteId).push(min);
  }
  const out = new Map();
  for (const [id, mins] of porAgente) {
    const ord = [...mins].sort((a, b) => a - b);
    const prom = ord.reduce((s, v) => s + v, 0) / ord.length;
    out.set(id, { tprPromMin: Math.round(prom), tprP90Min: Math.round(percentil(ord, 90)), turnos: ord.length });
  }
  return out;
}

const SEL = { type: QueryTypes.SELECT };

/** Métricas de volumen + TPR por agente para el día dado. */
async function metricasDelDia(fechaStr) {
  const { fecha, ini, fin } = parsearFecha(fechaStr);
  const repl = { ini, fin };

  const agentes = await sequelize.query(
    "SELECT id AS agenteId, nombre FROM wa_agentes WHERE activo = 1 ORDER BY nombre",
    SEL,
  );

  const msgs = await sequelize.query(
    `SELECT enviado_por_id AS agenteId, COUNT(*) AS mensajes,
            COUNT(DISTINCT conversacion_id) AS chatsAtendidos
       FROM wa_mensajes
      WHERE historico = 0 AND direccion = 'out' AND enviado_por_id IS NOT NULL
        AND COALESCE(ts_proveedor, creado_en) >= :ini
        AND COALESCE(ts_proveedor, creado_en) < :fin
      GROUP BY enviado_por_id`,
    { ...SEL, replacements: repl },
  );

  const tomas = await sequelize.query(
    `SELECT ejecutado_por_id AS agenteId, COUNT(*) AS tomados
       FROM wa_asignaciones
      WHERE tipo = 'toma_manual' AND ejecutado_por_id IS NOT NULL
        AND creado_en >= :ini AND creado_en < :fin
      GROUP BY ejecutado_por_id`,
    { ...SEL, replacements: repl },
  );

  const cierres = await sequelize.query(
    `SELECT agente_id AS agenteId, COUNT(*) AS cerrados
       FROM wa_conversaciones
      WHERE agente_id IS NOT NULL AND cerrada_en >= :ini AND cerrada_en < :fin
      GROUP BY agente_id`,
    { ...SEL, replacements: repl },
  );

  // Turnos de respuesta (cliente escribió -> agente contestó) del día, vía LAG.
  // Ventana ampliada ±3 días: el LAG debe ver el mensaje del cliente aunque la
  // respuesta caiga en otro día. El turno se atribuye al día del mensaje del
  // cliente (filtro final sobre ts_prev), no al de la respuesta.
  const iniBuf = correrDias(ini, -3);
  const finBuf = correrDias(fin, 3);
  const turnos = await sequelize.query(
    `WITH ordenado AS (
        SELECT m.direccion, m.enviado_por_id,
               DATE_FORMAT(COALESCE(m.ts_proveedor, m.creado_en), '%Y-%m-%d %H:%i:%s') AS ts,
               LAG(m.direccion) OVER w AS dir_prev,
               DATE_FORMAT(LAG(COALESCE(m.ts_proveedor, m.creado_en)) OVER w, '%Y-%m-%d %H:%i:%s') AS ts_prev
          FROM wa_mensajes m
         WHERE m.historico = 0
           AND COALESCE(m.ts_proveedor, m.creado_en) >= :iniBuf
           AND COALESCE(m.ts_proveedor, m.creado_en) < :finBuf
        WINDOW w AS (PARTITION BY m.conversacion_id
                     ORDER BY COALESCE(m.ts_proveedor, m.creado_en), m.id)
      )
      SELECT enviado_por_id AS agenteId, ts_prev AS clienteTs, ts AS agenteTs
        FROM ordenado
       WHERE direccion = 'out' AND dir_prev = 'in' AND enviado_por_id IS NOT NULL
         AND ts_prev >= :ini AND ts_prev < :fin`,
    { ...SEL, replacements: { ini, fin, iniBuf, finBuf } },
  );

  const porMsg = new Map(msgs.map((r) => [r.agenteId, r]));
  const porToma = new Map(tomas.map((r) => [r.agenteId, r.tomados]));
  const porCierre = new Map(cierres.map((r) => [r.agenteId, r.cerrados]));
  const porTpr = agregarTpr(turnos);

  const filas = agentes.map((a) => {
    const mm = porMsg.get(a.agenteId) || {};
    const tp = porTpr.get(a.agenteId) || {};
    return {
      agenteId: a.agenteId,
      nombre: a.nombre,
      mensajes: Number(mm.mensajes || 0),
      chatsAtendidos: Number(mm.chatsAtendidos || 0),
      tomados: Number(porToma.get(a.agenteId) || 0),
      cerrados: Number(porCierre.get(a.agenteId) || 0),
      tprPromMin: tp.tprPromMin ?? null,
      tprP90Min: tp.tprP90Min ?? null,
      turnos: tp.turnos || 0,
    };
  });

  const totales = filas.reduce(
    (t, f) => {
      t.mensajes += f.mensajes; t.chatsAtendidos += f.chatsAtendidos;
      t.tomados += f.tomados; t.cerrados += f.cerrados; t.turnos += f.turnos;
      return t;
    },
    { mensajes: 0, chatsAtendidos: 0, tomados: 0, cerrados: 0, turnos: 0 },
  );

  return { fecha, agentes: filas, totales };
}

/** Backlog en vivo: chats sin responder (cliente escribió de último) por agente + general. */
async function backlogVivo() {
  const agentes = await sequelize.query(
    "SELECT id AS agenteId, nombre FROM wa_agentes WHERE activo = 1 ORDER BY nombre",
    SEL,
  );
  const filas = await sequelize.query(
    `SELECT agente_id AS agenteId, COUNT(*) AS sinResponder,
            TIMESTAMPDIFF(MINUTE, MIN(ultimo_mensaje_en), NOW()) AS esperaMasViejaMin
       FROM wa_conversaciones
      WHERE estado <> 'cerrada' AND ultimo_mensaje_dir = 'in'
      GROUP BY agente_id`,
    SEL,
  );
  const porAgente = new Map(filas.filter((r) => r.agenteId != null).map((r) => [r.agenteId, r]));
  const generalRow = filas.find((r) => r.agenteId == null);

  return {
    agentes: agentes.map((a) => {
      const r = porAgente.get(a.agenteId);
      return {
        agenteId: a.agenteId,
        nombre: a.nombre,
        sinResponder: Number(r?.sinResponder || 0),
        esperaMasViejaMin: r ? Number(r.esperaMasViejaMin) : null,
      };
    }),
    general: {
      sinResponder: Number(generalRow?.sinResponder || 0),
      esperaMasViejaMin: generalRow ? Number(generalRow.esperaMasViejaMin) : null,
    },
  };
}

module.exports = { parsearFecha, percentil, agregarTpr, metricasDelDia, backlogVivo };
