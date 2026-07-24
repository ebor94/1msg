'use strict';
const { autenticar } = require('../services/auth');
const { firmar } = require('../utils/jwt');
const logger = require('../utils/logger');
const { obtenerIpCliente } = require('../utils/ipCliente');

async function login(req, res) {
  const { usuario, clave } = req.body || {};
  if (!usuario || !clave) return res.status(400).json({ error: 'usuario y clave requeridos' });
  let r;
  try {
    r = await autenticar(usuario, clave);
  } catch (err) {
    logger.error(`error autenticando ${usuario}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
  if (!r) {
    logger.warn(`login fallido para ${usuario} desde ${obtenerIpCliente(req)}`);
    return res.status(401).json({ error: 'credenciales inválidas' });
  }
  const a = r.agente;
  const token = firmar({ id: a.id, usuarioId: a.usuarioId, usuario: a.usuario, nombre: a.nombre, rol: a.rol });
  return res.json({
    token,
    agente: { id: a.id, usuario: a.usuario, nombre: a.nombre, rol: a.rol, firma: a.firma },
  });
}

function me(req, res) {
  return res.json({ agente: req.agente });
}

module.exports = { login, me };
