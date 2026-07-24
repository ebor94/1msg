'use strict';
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');
const { Agente } = require('../models');

async function buscarUsuarioSerfuweb(usuario) {
  const [rows] = await sequelize.query(
    'SELECT id, email, nombre, apellido, password, activo FROM serfuweb.usuarios WHERE email = ? LIMIT 1',
    { replacements: [usuario] },
  );
  return rows[0] || null;
}

async function autenticar(usuario, clave, deps = {}) {
  const buscarUsuario = deps.buscarUsuario || buscarUsuarioSerfuweb;
  const buscarAgente = deps.buscarAgente || ((usuarioId) => Agente.findOne({ where: { usuarioId } }));
  const comparar = deps.comparar || bcrypt.compare;

  const u = await buscarUsuario(usuario);
  if (!u || !u.activo) return null;
  const ok = await comparar(clave, u.password || '');
  if (!ok) return null;
  const agente = await buscarAgente(u.id);
  if (!agente || !agente.activo) return null;
  return { agente, usuarioSerfuweb: u };
}

module.exports = { autenticar, buscarUsuarioSerfuweb };
