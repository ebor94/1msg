'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const logger = require('./utils/logger');
const rutas = require('./routes');

/** Construye la app Express. El arranque del servidor vive en index.js. */
function crearApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  // El body del webhook es JSON. Límite holgado por si trae metadatos grandes;
  // los medios NO viajan aquí (se descargan aparte con retrieveMedia).
  app.use(express.json({ limit: '2mb' }));

  app.use('/', rutas);

  const distFront = path.resolve(__dirname, '..', 'frontend', 'dist');
  if (fs.existsSync(distFront)) {
    app.use(express.static(distFront));
    // Fallback SPA: cualquier GET que no sea /api, /webhook, /health ni un archivo.
    app.get(/^\/(?!api|webhook|health).*/, (req, res, next) => {
      if (req.method !== 'GET') return next();
      return res.sendFile(path.join(distFront, 'index.html'));
    });
  }

  // 404
  app.use((req, res) => res.status(404).json({ error: 'no encontrado' }));

  // Manejador de errores (incluye JSON malformado del body-parser).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    logger.error(`Error en ${req.method} ${req.originalUrl}: ${err.message}`);
    if (res.headersSent) return;
    res.status(status).json({ error: status >= 500 ? 'error interno' : err.message });
  });

  return app;
}

module.exports = crearApp;
