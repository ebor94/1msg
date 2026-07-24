'use strict';

const { Router } = require('express');
const webhook = require('./webhook');
const api = require('./api');
const { health } = require('../controllers/healthController');

const router = Router();

// Healthcheck: estado de base + antigüedad de la cola.
router.get('/health', health);

// Única URL de webhook por canal (invariante del proyecto).
router.use('/webhook/1msg', webhook);

router.use('/api', api);

module.exports = router;
