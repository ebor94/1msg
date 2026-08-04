'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const COMPRO = ['si', 'no', 'pendiente'];
const ESTADOS = ['nueva', 'abierta', 'pendiente', 'cerrada'];
const UN_DIA_MS = 24 * 60 * 60 * 1000;

function err422(msg) { const e = new Error(msg); e.status = 422; return e; }

/** Valida y normaliza los filtros del querystring del informe. Puro (sin BD). */
function parsearFiltros(query = {}) {
  const f = {};

  if (query.compro !== undefined && query.compro !== '') {
    if (query.compro === 'sin' || COMPRO.includes(query.compro)) f.compro = query.compro;
    else throw err422('compro inválido');
  }
  if (query.estado !== undefined && query.estado !== '') {
    if (query.estado === 'sin' || ESTADOS.includes(query.estado)) f.estado = query.estado;
    else throw err422('estado inválido');
  }

  const oi = Number(query.origenId);
  if (Number.isInteger(oi) && oi > 0) f.origenId = oi;
  const ii = Number(query.interesId);
  if (Number.isInteger(ii) && ii > 0) f.interesId = ii;

  if (query.desde) {
    const d = new Date(`${query.desde}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw err422('fecha desde inválida');
    f.desde = d;
  }
  if (query.hasta) {
    const h = new Date(`${query.hasta}T00:00:00.000Z`);
    if (Number.isNaN(h.getTime())) throw err422('fecha hasta inválida');
    f.hastaExcl = new Date(h.getTime() + UN_DIA_MS);
  }
  if (f.desde && f.hastaExcl && f.desde >= f.hastaExcl) throw err422('desde > hasta');

  let tam = Number(query.tam);
  if (!Number.isInteger(tam) || tam < 1) tam = 25;
  if (tam > 100) tam = 100;
  let pagina = Number(query.pagina);
  if (!Number.isInteger(pagina) || pagina < 0) pagina = 0;
  f.tam = tam;
  f.pagina = pagina;

  return f;
}

// Construye las cláusulas WHERE + replacements según los filtros presentes.
function construirWhere(f) {
  const cond = ['c.desactivado_en IS NULL'];
  const repl = {};
  if (f.compro === 'sin') cond.push('c.compro IS NULL');
  else if (f.compro) { cond.push('c.compro = :compro'); repl.compro = f.compro; }
  if (f.estado === 'sin') cond.push('u.id IS NULL');
  else if (f.estado) { cond.push('u.estado = :estado'); repl.estado = f.estado; }
  if (f.desde) { cond.push('u.ultimo_mensaje_en >= :desde'); repl.desde = f.desde; }
  if (f.hastaExcl) { cond.push('u.ultimo_mensaje_en < :hastaExcl'); repl.hastaExcl = f.hastaExcl; }
  if (f.origenId) { cond.push('EXISTS (SELECT 1 FROM wa_conversacion_etiqueta ce WHERE ce.conversacion_id = u.id AND ce.etiqueta_id = :origenId)'); repl.origenId = f.origenId; }
  if (f.interesId) { cond.push('EXISTS (SELECT 1 FROM wa_conversacion_etiqueta ce WHERE ce.conversacion_id = u.id AND ce.etiqueta_id = :interesId)'); repl.interesId = f.interesId; }
  return { where: cond.join(' AND '), repl };
}

const CTE = `WITH ultima AS (
  SELECT id, contacto_id, estado, ultimo_mensaje_en,
         ROW_NUMBER() OVER (PARTITION BY contacto_id ORDER BY ultimo_mensaje_en DESC, id DESC) AS rn
  FROM wa_conversaciones
)`;

async function consultar(f) {
  const { where, repl } = construirWhere(f);
  const from = `FROM wa_contactos c
    LEFT JOIN ultima u ON u.contacto_id = c.id AND u.rn = 1
    LEFT JOIN wa_agentes ad ON ad.id = c.agente_dueno_id
   WHERE ${where}`;

  const [totalRow] = await sequelize.query(`${CTE} SELECT COUNT(*) AS n ${from}`, {
    type: QueryTypes.SELECT, replacements: repl,
  });
  const total = Number(totalRow.n);

  const filas = await sequelize.query(
    `${CTE}
     SELECT c.id AS contactoId, c.telefono,
            COALESCE(NULLIF(c.nombre_display, ''), NULLIF(c.nombre_wa, ''), c.telefono) AS nombre,
            c.compro, ad.nombre AS agenteDueno,
            u.id AS conversacionId, u.estado, u.ultimo_mensaje_en AS ultimaActividad
     ${from}
     ORDER BY u.ultimo_mensaje_en IS NULL, u.ultimo_mensaje_en DESC, c.id DESC
     LIMIT :tam OFFSET :offset`,
    { type: QueryTypes.SELECT, replacements: { ...repl, tam: f.tam, offset: f.pagina * f.tam } },
  );

  // Adjuntar etiquetas (origen 0..1 + intereses) por conversación de la página.
  const convIds = filas.map((r) => r.conversacionId).filter((x) => x != null);
  const porConv = new Map();
  if (convIds.length) {
    const etqs = await sequelize.query(
      `SELECT ce.conversacion_id AS convId, e.nombre, e.color, e.categoria
         FROM wa_conversacion_etiqueta ce JOIN wa_etiquetas e ON e.id = ce.etiqueta_id
        WHERE ce.conversacion_id IN (:convIds)`,
      { type: QueryTypes.SELECT, replacements: { convIds } },
    );
    for (const e of etqs) {
      if (!porConv.has(e.convId)) porConv.set(e.convId, { origen: null, intereses: [] });
      const bucket = porConv.get(e.convId);
      if (e.categoria === 'origen') { if (!bucket.origen) bucket.origen = { nombre: e.nombre, color: e.color }; }
      else bucket.intereses.push({ nombre: e.nombre, color: e.color });
    }
  }

  const contactos = filas.map((r) => {
    const et = porConv.get(r.conversacionId) || { origen: null, intereses: [] };
    return { ...r, origen: et.origen, intereses: et.intereses };
  });

  return { total, pagina: f.pagina, tam: f.tam, contactos };
}

module.exports = { parsearFiltros, consultar };
