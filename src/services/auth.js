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

async function buscarUsuarioPorId(id) {
  const [rows] = await sequelize.query(
    'SELECT id, password, activo FROM serfuweb.usuarios WHERE id = ? LIMIT 1',
    { replacements: [id] },
  );
  return rows[0] || null;
}

async function actualizarPassword(id, hash) {
  await sequelize.query('UPDATE serfuweb.usuarios SET password = ? WHERE id = ?', {
    replacements: [hash, id],
  });
}

/**
 * Cambia la contraseña del propio usuario en serfuweb.usuarios (identidad única).
 * Verifica la clave actual, valida la nueva (≥8 y distinta) y escribe el hash bcrypt.
 */
async function cambiarClave(usuarioId, claveActual, claveNueva, deps = {}) {
  const buscarPorId = deps.buscarPorId || buscarUsuarioPorId;
  const comparar = deps.comparar || bcrypt.compare;
  const hashear = deps.hashear || ((c) => bcrypt.hash(c, 10));
  const actualizar = deps.actualizar || actualizarPassword;

  const u = await buscarPorId(usuarioId);
  if (!u || !u.activo) { const e = new Error('usuario no encontrado'); e.status = 404; throw e; }

  const ok = await comparar(String(claveActual || ''), u.password || '');
  if (!ok) { const e = new Error('clave actual incorrecta'); e.status = 403; e.codigo = 'clave_actual_incorrecta'; throw e; }

  const nueva = String(claveNueva || '');
  if (nueva.length < 8) { const e = new Error('clave nueva muy corta'); e.status = 422; throw e; }
  if (nueva === String(claveActual || '')) { const e = new Error('la clave nueva debe ser distinta'); e.status = 422; throw e; }

  const hash = await hashear(nueva);
  await actualizar(usuarioId, hash);
  return { ok: true };
}

module.exports = { autenticar, buscarUsuarioSerfuweb, cambiarClave };
