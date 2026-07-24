'use strict';
const { Router } = require('express');
const { requireAuth } = require('../middlewares/auth');
const authCtrl = require('../controllers/authController');
const convCtrl = require('../controllers/conversacionesController');

const router = Router();
router.post('/auth/login', authCtrl.login);
router.get('/auth/me', requireAuth, authCtrl.me);

router.get('/conversaciones', requireAuth, convCtrl.listarHandler);
router.get('/conversaciones/:id/mensajes', requireAuth, convCtrl.mensajes);
router.post('/conversaciones/:id/leer', requireAuth, convCtrl.leer);

module.exports = router;
