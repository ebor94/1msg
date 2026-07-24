'use strict';

const { Router } = require('express');
const webhook = require('./webhook');

const router = Router();

// Healthcheck mínimo (la tarea 7 lo amplía con estado de base y de la cola).
router.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// Única URL de webhook por canal (invariante del proyecto).
router.use('/webhook/1msg', webhook);

module.exports = router;
