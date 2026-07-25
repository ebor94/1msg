'use strict';
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middlewares/auth');
const { obtenerIpCliente } = require('../utils/ipCliente');
const authCtrl = require('../controllers/authController');
const convCtrl = require('../controllers/conversacionesController');
const agentesCtrl = require('../controllers/agentesController');
const contactosCtrl = require('../controllers/contactosController');
const plantillasCtrl = require('../controllers/plantillasController');
const mediaCtrl = require('../controllers/mediaController');

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
router.post('/conversaciones/:id/plantilla', requireAuth, convCtrl.enviarPlantilla);
router.post('/conversaciones/:id/leer', requireAuth, convCtrl.leer);
router.post('/conversaciones/:id/tomar', requireAuth, convCtrl.tomar);
router.post('/conversaciones/:id/asignar', requireAuth, convCtrl.asignar);
router.get('/conversaciones/:id/notas', requireAuth, convCtrl.listarNotas);
router.post('/conversaciones/:id/notas', requireAuth, convCtrl.agregarNota);
router.get('/mensajes/:id/media', requireAuth, mediaCtrl.servir);
router.get('/agentes', requireAuth, agentesCtrl.listar);
router.post('/contactos', requireAuth, contactosCtrl.crear);
router.get('/plantillas', requireAuth, plantillasCtrl.listar);

module.exports = router;
