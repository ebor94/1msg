'use strict';
const svc = require('../services/etiquetas');
const logger = require('../utils/logger');

async function listar(req, res) {
  try {
    return res.json(await svc.listarCatalogo());
  } catch (err) {
    logger.error(`listar catálogo etiquetas: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

// Rango por defecto: mes en curso (si no llegan ?desde=&hasta=).
function rangoDelMes() {
  const hoy = new Date();
  const desde = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
  const hasta = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { desde: iso(desde), hasta: iso(hasta) };
}

async function estadisticas(req, res) {
  try {
    const def = rangoDelMes();
    const { desde, hastaExclusivo } = svc.normalizarRango(
      req.query.desde || def.desde,
      req.query.hasta || def.hasta,
    );
    const categoria = req.query.categoria || null;
    const filas = await svc.estadisticas({ desde, hastaExclusivo, categoria });
    return res.json({ estadisticas: filas.map((f) => ({ ...f, total: Number(f.total) })) });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: 'rango inválido' });
    logger.error(`estadísticas etiquetas: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function crear(req, res) {
  try {
    const etq = await svc.crearEtiqueta(req.body || {});
    return res.status(201).json({ etiqueta: etq });
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ error: err.message });
    logger.error(`crear etiqueta: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function actualizar(req, res) {
  try {
    const etq = await svc.actualizarEtiqueta(Number(req.params.id), req.body || {});
    return res.json({ etiqueta: etq });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'no encontrada' });
    if (err.status === 422) return res.status(422).json({ error: err.message });
    logger.error(`actualizar etiqueta ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { listar, estadisticas, crear, actualizar };
