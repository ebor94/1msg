'use strict';

const { RespuestaRapida } = require('../models');
const logger = require('../utils/logger');

function limpiar(s, max) {
  return String(s == null ? '' : s).trim().slice(0, max);
}
function forma(r) {
  return { id: r.id, titulo: r.titulo, texto: r.texto };
}

async function listar(req, res) {
  try {
    const filas = await RespuestaRapida.findAll({ where: { agenteId: req.agente.id }, order: [['id', 'ASC']] });
    return res.json({ respuestas: filas.map(forma) });
  } catch (err) {
    logger.error(`listar respuestas: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function crear(req, res) {
  const titulo = limpiar(req.body && req.body.titulo, 80);
  const texto = limpiar(req.body && req.body.texto, 2000);
  if (!titulo || !texto) return res.status(400).json({ error: 'título y texto requeridos' });
  try {
    const r = await RespuestaRapida.create({ agenteId: req.agente.id, titulo, texto });
    return res.status(201).json({ respuesta: forma(r) });
  } catch (err) {
    logger.error(`crear respuesta: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function actualizar(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  const titulo = limpiar(req.body && req.body.titulo, 80);
  const texto = limpiar(req.body && req.body.texto, 2000);
  if (!titulo || !texto) return res.status(400).json({ error: 'título y texto requeridos' });
  try {
    const r = await RespuestaRapida.findByPk(id);
    if (!r || r.agenteId !== req.agente.id) return res.status(404).json({ error: 'no encontrada' });
    await r.update({ titulo, texto });
    return res.json({ respuesta: forma(r) });
  } catch (err) {
    logger.error(`actualizar respuesta ${id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function eliminar(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const r = await RespuestaRapida.findByPk(id);
    if (!r || r.agenteId !== req.agente.id) return res.status(404).json({ error: 'no encontrada' });
    await r.destroy();
    return res.json({ ok: true });
  } catch (err) {
    logger.error(`eliminar respuesta ${id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { listar, crear, actualizar, eliminar };
