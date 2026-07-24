'use strict';

const { sequelize } = require('../models');

/**
 * GET /health — chequeo de salud para monitoreo/despliegue.
 * Verifica la base y la antigüedad de la cola (si el evento más viejo sin
 * procesar lleva mucho, el worker podría estar caído).
 *
 * 200 → ok o degraded ; 503 → base caída.
 */
async function health(req, res) {
  const out = { status: 'ok', db: 'ok', cola: {} };

  try {
    await sequelize.query('SELECT 1');
  } catch (err) {
    return res.status(503).json({ status: 'error', db: 'error', detalle: err.message });
  }

  try {
    const [[c]] = await sequelize.query(
      'SELECT COUNT(*) AS pendientes, ' +
        'TIMESTAMPDIFF(SECOND, MIN(recibido_en), NOW()) AS mas_antiguo_seg ' +
        'FROM wa_eventos_webhook WHERE procesado = 0',
    );
    const masAntiguoSeg = c.mas_antiguo_seg === null ? 0 : Number(c.mas_antiguo_seg);
    out.cola = { pendientes: Number(c.pendientes), masAntiguoSeg };
    // Umbral: si el más viejo lleva >120s sin procesar, el worker va atrasado.
    if (masAntiguoSeg > 120) out.status = 'degraded';
  } catch (err) {
    out.status = 'degraded';
    out.cola = { error: err.message };
  }

  return res.status(200).json(out);
}

module.exports = { health };
