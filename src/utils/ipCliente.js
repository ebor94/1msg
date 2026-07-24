'use strict';

// Detrás del Cloudflare Tunnel la app ve todas las peticiones como 127.0.0.1;
// la IP real del cliente viaja en el header CF-Connecting-IP.
function obtenerIpCliente(req) {
  return req.get('cf-connecting-ip') || req.ip;
}

module.exports = { obtenerIpCliente };
