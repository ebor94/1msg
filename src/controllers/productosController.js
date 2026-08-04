'use strict';
const logger = require('../utils/logger');
const { consultarPlanesPorDocumento } = require('../integrations/prevision/cliente');
const { consultarMantenimientos } = require('../integrations/mantenimientos/cliente');
const { consultarPrenecesidad } = require('../integrations/prenecesidad/cliente');

function soloDigitos(s) {
  return String(s || '').replace(/\D/g, '');
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
  return res.json({ documento: doc, prevision, mantenimientos, prenecesidad });
}

module.exports = { seguro, consultar };
