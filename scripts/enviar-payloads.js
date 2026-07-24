'use strict';

/**
 * Dispara los payloads de prueba contra el webhook local para validar la
 * tarea 3 (ingesta cruda), sin depender de que un cliente real escriba.
 *
 * Uso:
 *   node scripts/enviar-payloads.js
 *   BASE_URL=http://127.0.0.1:3000 node scripts/enviar-payloads.js
 *
 * Requiere que el servidor esté corriendo (npm start) y un .env con
 * WEBHOOK_SECRET y PORT.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SECRET = process.env.WEBHOOK_SECRET;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const ENDPOINT = `${BASE_URL}/webhook/1msg`;

if (!SECRET) {
  console.error('Falta WEBHOOK_SECRET en el .env');
  process.exit(1);
}

const dirPayloads = path.join(__dirname, 'payloads');

async function postJson(url, cuerpo) {
  const t0 = Date.now();
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const ms = Date.now() - t0;
  let texto = '';
  try {
    texto = await resp.text();
  } catch (_) {
    /* sin cuerpo */
  }
  return { status: resp.status, ms, texto };
}

async function main() {
  const archivos = fs
    .readdirSync(dirPayloads)
    .filter((f) => f.endsWith('.json'))
    .sort();

  console.log(`Endpoint: ${ENDPOINT}`);
  console.log('----------------------------------------------------------');

  // 1) Prueba NEGATIVA: secreto inválido debe devolver 401 y NO encolar.
  const malo = await postJson(`${ENDPOINT}?secret=secreto-incorrecto`, { type: 'ping' });
  const okNeg = malo.status === 401;
  console.log(`[negativa] secreto inválido -> ${malo.status} ${okNeg ? '✅ (esperado 401)' : '❌'}`);

  // 2) Pruebas POSITIVAS: cada payload con el secreto correcto debe dar 200.
  let ok = 0;
  for (const archivo of archivos) {
    const cuerpo = JSON.parse(fs.readFileSync(path.join(dirPayloads, archivo), 'utf8'));
    const r = await postJson(`${ENDPOINT}?secret=${encodeURIComponent(SECRET)}`, cuerpo);
    const bien = r.status === 200;
    if (bien) ok += 1;
    console.log(`[${archivo}] -> ${r.status} en ${r.ms} ms ${bien ? '✅' : '❌ ' + r.texto}`);
  }

  console.log('----------------------------------------------------------');
  console.log(`Positivas OK: ${ok}/${archivos.length} | Negativa: ${okNeg ? 'OK' : 'FALLÓ'}`);
  process.exitCode = ok === archivos.length && okNeg ? 0 : 1;
}

main().catch((err) => {
  console.error('Error disparando payloads:', err.message);
  process.exit(1);
});
