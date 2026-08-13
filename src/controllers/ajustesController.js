'use strict';
const { Ajuste } = require('../models');
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

module.exports = { obtenerPromptIa, guardarPromptIa };
