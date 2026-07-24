'use strict';
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middlewares/auth');
const { obtenerIpCliente } = require('../utils/ipCliente');
const authCtrl = require('../controllers/authController');
const convCtrl = require('../controllers/conversacionesController');

// Máximo 10 intentos de login por IP cada 15 minutos (freno a fuerza bruta).
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => obtenerIpCliente(req),
  message: { error: 'demasiados intentos, espera unos minutos' },
});

const router = Router();
router.post('/auth/login', limiteLogin, authCtrl.login);
router.get('/auth/me', requireAuth, authCtrl.me);

router.get('/conversaciones', requireAuth, convCtrl.listarHandler);
router.get('/conversaciones/:id/mensajes', requireAuth, convCtrl.mensajes);
router.post('/conversaciones/:id/mensajes', requireAuth, convCtrl.enviar);
router.post('/conversaciones/:id/leer', requireAuth, convCtrl.leer);

module.exports = router;
