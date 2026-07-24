'use strict';

const { Router } = require('express');
const webhook = require('./webhook');
const { health } = require('../controllers/healthController');

const router = Router();

// Healthcheck: estado de base + antigüedad de la cola.
router.get('/health', health);

// Única URL de webhook por canal (invariante del proyecto).
router.use('/webhook/1msg', webhook);

module.exports = router;
