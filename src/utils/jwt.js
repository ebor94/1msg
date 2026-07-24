'use strict';
const jwt = require('jsonwebtoken');
const env = require('../config/env');

function firmar(payload) {
  return jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
}

function verificar(token) {
  return jwt.verify(token, env.jwt.secret);
}

module.exports = { firmar, verificar };
