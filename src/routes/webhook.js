'use strict';

const { Router } = require('express');
const verificarSecretoWebhook = require('../middlewares/verificarSecretoWebhook');
const { verificar, recibir } = require('../controllers/webhookController');

const router = Router();

// El secreto se valida ANTES de cualquier otra cosa, en ambos verbos.
router.get('/', verificarSecretoWebhook, verificar);
router.post('/', verificarSecretoWebhook, recibir);

module.exports = router;
