'use strict';
const { Ajuste, Agente } = require('../models');
const env = require('../config/env');
const { CLAVE_RECEPCION, parsearAgentesRecepcion, validarIdsRecepcion } = require('../services/recepcion');
const logger = require('../utils/logger');

const CLAVE_PROMPT = 'ia_gestion_prompt';

/** GET /api/ajustes/ia-gestion-prompt — devuelve el prompt de rol de la IA. */
async function obtenerPromptIa(req, res) {
  try {
    const fila = await Ajuste.findOne({ where: { clave: CLAVE_PROMPT } });
    return res.json({ prompt: fila ? fila.valor : '' });
  } catch (err) {
    logger.error(`obtener prompt IA: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

/** PUT /api/ajustes/ia-gestion-prompt — actualiza el prompt (admin). */
async function guardarPromptIa(req, res) {
  const valor = String((req.body && req.body.prompt) || '').trim();
  if (!valor) return res.status(422).json({ error: 'el prompt no puede estar vacío' });
  try {
    const [fila, creada] = await Ajuste.findOrCreate({ where: { clave: CLAVE_PROMPT }, defaults: { clave: CLAVE_PROMPT, valor } });
    if (!creada) await fila.update({ valor });
    return res.json({ prompt: valor });
  } catch (err) {
    logger.error(`guardar prompt IA: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

/** GET /api/ajustes/recepcion — ids de agentes de recepción efectivos. */
async function obtenerRecepcion(req, res) {
  try {
    const fila = await Ajuste.findOne({ where: { clave: CLAVE_RECEPCION } });
    return res.json({ agentes: parsearAgentesRecepcion(fila ? fila.valor : null, env.agenteRecepcionId) });
  } catch (err) {
    logger.error(`obtener recepción: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

/** PUT /api/ajustes/recepcion — guarda la lista de agentes de recepción (admin). */
async function guardarRecepcion(req, res) {
  const crudos = req.body && req.body.agentes;
  if (!Array.isArray(crudos)) return res.status(422).json({ error: 'agentes debe ser una lista de ids' });
  const unicos = [...new Set(crudos.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  try {
    if (unicos.length) {
      const activas = await Agente.findAll({ where: { id: unicos, activo: true }, attributes: ['id'] });
      const invalidos = validarIdsRecepcion(unicos, activas.map((a) => a.id));
      if (invalidos.length) return res.status(422).json({ error: `agentes inválidos o inactivos: ${invalidos.join(', ')}` });
    }
    const valor = JSON.stringify(unicos);
    const [fila, creada] = await Ajuste.findOrCreate({ where: { clave: CLAVE_RECEPCION }, defaults: { clave: CLAVE_RECEPCION, valor } });
    if (!creada) await fila.update({ valor });
    return res.json({ agentes: unicos });
  } catch (err) {
    logger.error(`guardar recepción: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { obtenerPromptIa, guardarPromptIa, obtenerRecepcion, guardarRecepcion };
