'use strict';
const { verificar } = require('../utils/jwt');
const { ROL_AGENTE } = require('../config/constants');

function requireAuth(req, res, next) {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no autenticado' });
  try {
    req.agente = verificar(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'token inválido o expirado' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.agente || req.agente.rol !== ROL_AGENTE.ADMINISTRADOR) {
    return res.status(403).json({ error: 'requiere rol administrador' });
  }
  return next();
}

module.exports = { requireAuth, requireAdmin };
