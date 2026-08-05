'use strict';
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('../middlewares/auth');
const { obtenerIpCliente } = require('../utils/ipCliente');
const authCtrl = require('../controllers/authController');
const convCtrl = require('../controllers/conversacionesController');
const agentesCtrl = require('../controllers/agentesController');
const contactosCtrl = require('../controllers/contactosController');
const plantillasCtrl = require('../controllers/plantillasController');
const mediaCtrl = require('../controllers/mediaController');
const respuestasCtrl = require('../controllers/respuestasController');
const etiquetasCtrl = require('../controllers/etiquetasController');
const productosCtrl = require('../controllers/productosController');
const env = require('../config/env');

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.media.maxUploadBytes } });

function subirUno(req, res, next) {
  subida.single('archivo')(req, res, (err) => {
    if (!err) return next();
    const grande = err.code === 'LIMIT_FILE_SIZE';
    return res.status(grande ? 413 : 400).json({ error: grande ? 'archivo demasiado grande (máx 16 MB)' : 'archivo inválido' });
  });
}

// Máximo 20 intentos FALLIDOS de login por (IP + usuario) cada 15 minutos: frena la
// fuerza bruta por cuenta sin bloquear a una oficina que comparte IP pública (NAT).
// skipSuccessfulRequests: un login correcto NO gasta cupo — así un usuario que entra
// varias veces (o forcejea con su clave y al final la acierta) no queda bloqueado.
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${obtenerIpCliente(req)}:${(req.body && req.body.usuario) || ''}`,
  message: { error: 'demasiados intentos, espera unos minutos' },
});

const limiteCambioClave = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${obtenerIpCliente(req)}:${(req.agente && req.agente.usuarioId) || ''}`,
  message: { error: 'demasiados intentos, espera unos minutos' },
});

const router = Router();
router.post('/auth/login', limiteLogin, authCtrl.login);
router.get('/auth/me', requireAuth, authCtrl.me);
router.post('/auth/cambiar-clave', requireAuth, limiteCambioClave, authCtrl.cambiarClave);

router.get('/conversaciones', requireAuth, convCtrl.listarHandler);
router.get('/conversaciones/contadores', requireAuth, convCtrl.contadores);
router.get('/conversaciones/:id/mensajes', requireAuth, convCtrl.mensajes);
router.post('/conversaciones/:id/mensajes', requireAuth, convCtrl.enviar);
router.post('/conversaciones/:id/media', requireAuth, subirUno, convCtrl.enviarMedia);
router.post('/conversaciones/:id/plantilla', requireAuth, convCtrl.enviarPlantilla);
router.post('/conversaciones/:id/leer', requireAuth, convCtrl.leer);
router.post('/conversaciones/:id/no-leido', requireAuth, convCtrl.noLeido);
router.post('/conversaciones/:id/resolver', requireAuth, convCtrl.resolver);
router.post('/conversaciones/:id/historial', requireAuth, convCtrl.historial);
router.post('/conversaciones/:id/tomar', requireAuth, convCtrl.tomar);
router.post('/conversaciones/:id/asignar', requireAuth, convCtrl.asignar);
router.get('/conversaciones/:id/asignaciones', requireAuth, convCtrl.asignaciones);
router.get('/conversaciones/:id/notas', requireAuth, convCtrl.listarNotas);
router.post('/conversaciones/:id/notas', requireAuth, convCtrl.agregarNota);
router.get('/conversaciones/:id/etiquetas', requireAuth, convCtrl.etiquetasDeConv);
router.post('/conversaciones/:id/etiquetas', requireAuth, convCtrl.etiquetarConv);
router.delete('/conversaciones/:id/etiquetas/:etiquetaId', requireAuth, convCtrl.desetiquetarConv);
router.post('/conversaciones/:id/archivar', requireAuth, requireAdmin, convCtrl.archivar);
router.post('/conversaciones/:id/desarchivar', requireAuth, requireAdmin, convCtrl.desarchivar);
router.get('/mensajes/:id/media', requireAuth, mediaCtrl.servir);
router.get('/agentes/totales', requireAuth, requireAdmin, agentesCtrl.totales);
router.get('/agentes', requireAuth, agentesCtrl.listar);
router.get('/contactos/buscar', requireAuth, contactosCtrl.buscar);
router.get('/contactos/informe', requireAuth, contactosCtrl.informe);
router.get('/productos', requireAuth, productosCtrl.consultar);
router.post('/contactos', requireAuth, contactosCtrl.crear);
router.post('/contactos/:id/conversacion', requireAuth, contactosCtrl.abrir);
router.get('/contactos/:id/prevision', requireAuth, contactosCtrl.prevision);
router.get('/contactos/:id/mantenimientos', requireAuth, contactosCtrl.mantenimientos);
router.get('/contactos/:id/prenecesidad', requireAuth, contactosCtrl.prenecesidad);
router.patch('/contactos/:id', requireAuth, contactosCtrl.actualizar);
router.post('/contactos/:id/desactivar', requireAuth, requireAdmin, contactosCtrl.desactivar);
router.post('/contactos/:id/reactivar', requireAuth, requireAdmin, contactosCtrl.reactivar);
router.get('/plantillas', requireAuth, plantillasCtrl.listar);
router.get('/respuestas', requireAuth, respuestasCtrl.listar);
router.post('/respuestas', requireAuth, respuestasCtrl.crear);
router.patch('/respuestas/:id', requireAuth, respuestasCtrl.actualizar);
router.delete('/respuestas/:id', requireAuth, respuestasCtrl.eliminar);
router.get('/etiquetas', requireAuth, etiquetasCtrl.listar);
router.get('/etiquetas/estadisticas', requireAuth, requireAdmin, etiquetasCtrl.estadisticas);
router.get('/etiquetas/todas', requireAuth, requireAdmin, etiquetasCtrl.listarTodas);
router.post('/etiquetas', requireAuth, requireAdmin, etiquetasCtrl.crear);
router.patch('/etiquetas/:id', requireAuth, requireAdmin, etiquetasCtrl.actualizar);

module.exports = router;
