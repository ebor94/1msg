'use strict';

const { Router } = require('express');
const webhook = require('./webhook');
const api = require('./api');
const { health } = require('../controllers/healthController');
const { emitirHandler } = require('../controllers/internalController');

const router = Router();

// Healthcheck: estado de base + antigüedad de la cola.
router.get('/health', health);

// Única URL de webhook por canal (invariante del proyecto).
router.use('/webhook/1msg', webhook);

router.use('/api', api);

// Puente worker→API: el worker (proceso aparte) avisa aquí para que el API
// emita por el socket. Protegido con el mismo secreto del webhook.
router.post('/internal/emitir', emitirHandler);

module.exports = router;
