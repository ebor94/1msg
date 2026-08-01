'use strict';
const { autenticar, cambiarClave: cambiarClaveSvc } = require('../services/auth');
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

async function cambiarClave(req, res) {
  const { claveActual, claveNueva } = req.body || {};
  if (!claveActual || !claveNueva) return res.status(400).json({ error: 'clave actual y nueva requeridas' });
  try {
    await cambiarClaveSvc(req.agente.usuarioId, claveActual, claveNueva);
    return res.json({ ok: true });
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: 'la contraseña actual no es correcta', codigo: 'clave_actual_incorrecta' });
    if (err.status === 422) return res.status(422).json({ error: 'la nueva contraseña no es válida (mínimo 8 caracteres y distinta de la actual)' });
    if (err.status === 404) return res.status(404).json({ error: 'usuario no encontrado' });
    logger.error(`cambiar clave usuario ${req.agente && req.agente.usuarioId}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { login, me, cambiarClave };
