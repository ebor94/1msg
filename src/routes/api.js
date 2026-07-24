'use strict';
const { Router } = require('express');
const { requireAuth } = require('../middlewares/auth');
const authCtrl = require('../controllers/authController');

const router = Router();
router.post('/auth/login', authCtrl.login);
router.get('/auth/me', requireAuth, authCtrl.me);

module.exports = router;
