'use strict';
const { listarConceptosPermitidos, registrarGestion } = require('../integrations/prevision/cliente');
const logger = require('../utils/logger');

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

async function conceptos(req, res) {
  try {
    return res.json({ conceptos: await listarConceptosPermitidos() });
  } catch (err) {
    if (err.codigo === 'no_configurado') return res.status(503).json({ error: 'previsión no configurada', codigo: 'no_configurado' });
    logger.error(`conceptos previsión: ${err.message}`);
    return res.status(502).json({ error: 'no se pudieron cargar los conceptos' });
  }
}

async function gestion(req, res) {
  const { numPlan, concepto, novedad, posfecha } = req.body || {};
  if (!numPlan || !concepto) return res.status(400).json({ error: 'numPlan y concepto requeridos' });
  if (posfecha && !RE_FECHA.test(posfecha)) return res.status(400).json({ error: 'posfecha inválida (YYYY-MM-DD)' });
  try {
    const r = await registrarGestion({ numPlan, concepto, novedad, posfecha: posfecha || null, tramito: req.agente.nombre });
    return res.json({ ok: true, ...r });
  } catch (err) {
    if (err.codigo === 'no_configurado') return res.status(503).json({ error: 'previsión no configurada', codigo: 'no_configurado' });
    if (err.codigo === 'plan_no_encontrado') return res.status(404).json({ error: 'no se encontró el plan' });
    if (err.codigo === 'concepto_invalido') return res.status(400).json({ error: 'concepto no válido' });
    logger.error(`registrar gestión previsión (plan ${numPlan}): ${err.message}`);
    return res.status(502).json({ error: 'no se pudo registrar la gestión' });
  }
}

module.exports = { conceptos, gestion };
