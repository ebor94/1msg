'use strict';

/**
 * Verificación de la conexión y del mapeo de modelos contra serfuweb.
 *
 * Uso:  node scripts/verificar-conexion.js
 *
 * Qué hace:
 *   1. Autentica contra MySQL con las credenciales del .env.
 *   2. Por cada modelo wa_, hace un SELECT ... LIMIT 1 y un COUNT.
 *      Si una columna del modelo no existe en la tabla, el SELECT falla
 *      y se reporta: así se valida que el mapeo coincide con el esquema.
 *   NO modifica nada ni ejecuta sync().
 */

const logger = require('../src/utils/logger');
const { sequelize, verificarConexion } = require('../src/config/database');
const db = require('../src/models');

// Modelos a verificar (todos menos la clave sequelize del objeto db).
const modelos = Object.entries(db).filter(([nombre]) => nombre !== 'sequelize');

async function main() {
  await verificarConexion();

  const resultados = [];
  for (const [nombre, modelo] of modelos) {
    const tabla = modelo.getTableName();
    try {
      // Fuerza a MySQL a resolver todas las columnas del modelo.
      await modelo.findOne({ attributes: { exclude: [] }, limit: 1, raw: true });
      const total = await modelo.count();
      resultados.push({ modelo: nombre, tabla, estado: 'OK', filas: total });
    } catch (err) {
      resultados.push({ modelo: nombre, tabla, estado: 'FALLO', filas: '-', detalle: err.message });
    }
  }

  // eslint-disable-next-line no-console
  console.table(resultados.map(({ detalle, ...fila }) => fila));

  const fallidos = resultados.filter((r) => r.estado === 'FALLO');
  if (fallidos.length) {
    logger.error(`${fallidos.length} modelo(s) no mapean contra el esquema:`);
    fallidos.forEach((f) => logger.error(`  ${f.modelo} (${f.tabla}): ${f.detalle}`));
    process.exitCode = 1;
  } else {
    logger.info(`Los ${resultados.length} modelos mapean correctamente contra serfuweb.`);
  }

  await sequelize.close();
}

main().catch(async (err) => {
  logger.error('Error verificando la conexión', err);
  try {
    await sequelize.close();
  } catch (_) {
    /* la conexión pudo no abrirse */
  }
  process.exit(1);
});
