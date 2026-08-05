'use strict';
const logger = require('../utils/logger');
const { consultarPlanesPorDocumento, listarEstadosPlan } = require('../integrations/prevision/cliente');
const { consultarMantenimientos } = require('../integrations/mantenimientos/cliente');
const { consultarPrenecesidad } = require('../integrations/prenecesidad/cliente');

function soloDigitos(s) {
  return String(s || '').replace(/\D/g, '');
}

// Ajuste de la tabla de previsión SOLO en este popup: se ocultan estos campos.
const OMITIR_PREV = new Set(['fech_ini_plan', 'anexo_plan', 'concepto_plan', 'estado_plan']);

/**
 * Reshape de un plan para el popup de productos: muestra la DESCRIPCIÓN del concepto
 * (`concepto_desc`, ya en la fila) y del estado (`estados` = mapa cod_ep→nom_ep), y
 * oculta Fech ini, Anexo y los códigos crudos de concepto/estado. Puro.
 */
function vistaPlanPrevision(plan, estados) {
  const out = {};
  for (const [k, v] of Object.entries(plan)) {
    if (OMITIR_PREV.has(k)) continue;
    if (k === 'concepto_desc') out.Concepto = v;
    else out[k] = v;
  }
  const est = estados.get(String(plan.estado_plan));
  out.Estado = est != null ? est : plan.estado_plan;
  return out;
}

/** Ejecuta una consulta de producto sin lanzar: devuelve su estado + datos. */
async function seguro(fn, doc) {
  try {
    return { estado: 'ok', datos: await fn(doc) };
  } catch (err) {
    if (err.codigo === 'no_configurado') return { estado: 'no_configurado' };
    logger.error(`consultar producto (doc ${doc}): ${err.message}`);
    return { estado: 'error' };
  }
}

/** GET /api/productos?documento= — previsión + mantenimiento + prenecesidad en paralelo. */
async function consultar(req, res) {
  const doc = soloDigitos(req.query.documento);
  if (!doc) return res.status(400).json({ error: 'documento requerido' });
  const [prevision, mantenimientos, prenecesidad] = await Promise.all([
    seguro(consultarPlanesPorDocumento, doc),
    seguro(consultarMantenimientos, doc),
    seguro(consultarPrenecesidad, doc),
  ]);
  // Reshape de las columnas de previsión (descripción de concepto/estado, sin códigos).
  if (prevision.estado === 'ok' && prevision.datos.length) {
    let estados = new Map();
    try {
      estados = new Map((await listarEstadosPlan()).map((e) => [String(e.cod_ep), e.nom_ep]));
    } catch (err) {
      logger.error(`catálogo estadoplan: ${err.message}`); // sin bloquear: queda el código
    }
    prevision.datos = prevision.datos.map((p) => vistaPlanPrevision(p, estados));
  }
  return res.json({ documento: doc, prevision, mantenimientos, prenecesidad });
}

module.exports = { seguro, consultar, vistaPlanPrevision };
