# Difusiones — Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend nativo de difusiones: crear campaña, cargar destinatarios por CSV, hospedar la imagen del encabezado de forma persistente, y un worker que envía plantillas por 1msg con ritmo/ventana/backoff, dejando cada envío en la bandeja (resueltos) y exponiendo el resultado por API.

**Architecture:** La tabla `wa_difusion_destinatarios` es la cola. Un worker (en el proceso `wa-worker`) procesa una campaña a la vez, respeta ventana horaria y ritmo (1/20 s), llama al `enviarPlantilla` que ya existe, y en una transacción crea/reusa la conversación (origen `difusion`, estado `cerrada`) + el mensaje saliente, actualizando el destinatario. Los estados de entrega se derivan del webhook ya ingerido (join por `wa_message_id`). Solo lectura/escritura de tablas `wa_`.

**Tech Stack:** Node 20 CommonJS, Express, Sequelize (`sequelize.query` crudo + modelos), MySQL 8, multer (ya dependencia), 1msg (`src/integrations/onemsg/`). Tests: `node:test`.

## Global Constraints

- Solo tablas `wa_`. SQL parametrizado. Nada de `console.log`: logger. Nunca tragar excepciones.
- Endpoints admin-only: `requireAuth` + `requireAdmin`; asesor → 403.
- El token de 1msg vive solo en `src/integrations/onemsg/`; jamás en cliente ni logs.
- DATETIME en hora de Colombia (`-05:00`); "día" y ventana horaria se calculan sobre hora local.
- Ventana de envío: **Lun–Vie 08:00–18:59, Sáb 08:00–13:59, Dom no**.
- Ritmo: **1 mensaje cada 20 s por campaña**; **una campaña a la vez** (FIFO).
- Idempotencia: clave única `(difusion_id, contacto_id)` y `wa_mensajes.wa_message_id`.
- Persistir antes de emitir (socket después del commit). Proceso único.
- Envío de campaña: conversación `origen='difusion'`, estado `cerrada`, mensaje `enviado_por_id=NULL` (no cuenta en Scorecard); si el contacto ya tiene `agente_dueno_id` se respeta, si no se asigna el del CSV; **sin** fila de auditoría `toma_manual`/`reasignacion`.
- Comando de test backend (con env vars):
  `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/<archivo>`

## File Structure

- `docs/migraciones/007-difusiones-agente-imagen.sql` (crear) — ALTER de las 2 tablas.
- `src/models/DifusionDestinatario.js`, `src/models/Difusion.js`, `docs/esquema_bandeja.sql` (modificar) — nuevas columnas.
- `src/services/difusionCsv.js` (crear) — parseo/validación de CSV + mapeo (puro).
- `src/services/difusionReglas.js` (crear) — ventana, ritmo, clasificación de error (puro).
- `src/services/difusiones.js` (crear) — CRUD + carga + consultas (BD).
- `src/services/difusionImagen.js` (crear) — guardar imagen en disco + construir URL pública.
- `src/services/difusionEnvio.js` (crear) — envío de un destinatario (transaccional).
- `src/workers/emisorRemoto.js` (crear) — helper worker→backend para emitir por socket.
- `src/workers/difusiones.js` (crear) — loop del worker.
- `src/workers/index.js` (modificar) — arrancar el loop de difusiones.
- `src/controllers/difusionesController.js` (crear) — handlers HTTP.
- `src/controllers/mediaController.js` (modificar) — servir imagen de difusión.
- `src/routes/api.js`, `src/routes/index.js` (modificar) — rutas admin + ruta pública de imagen.
- `test/difusion-*.test.js` (crear) — pruebas.

---

### Task 1: Migración 007 + modelos (agente_id, imagen_url)

**Files:**
- Create: `docs/migraciones/007-difusiones-agente-imagen.sql`
- Modify: `src/models/DifusionDestinatario.js`, `src/models/Difusion.js`, `docs/esquema_bandeja.sql`
- Test: `test/difusion-modelos.test.js`

**Interfaces:**
- Produces: `DifusionDestinatario.agenteId` (INT UNSIGNED NULL), `Difusion.imagenUrl` (STRING(255) NULL).

- [ ] **Step 1: Write the failing test**

```javascript
// test/difusion-modelos.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Difusion, DifusionDestinatario } = require('../src/models');

test('DifusionDestinatario tiene agenteId', () => {
  assert.ok(DifusionDestinatario.rawAttributes.agenteId, 'falta agenteId');
});
test('Difusion tiene imagenUrl', () => {
  assert.ok(Difusion.rawAttributes.imagenUrl, 'falta imagenUrl');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-modelos.test.js`
Expected: FAIL ("falta agenteId").

- [ ] **Step 3: Write the migration**

```sql
-- docs/migraciones/007-difusiones-agente-imagen.sql
-- Difusiones MVP: agente responsable por destinatario + imagen de encabezado por campaña.
ALTER TABLE wa_difusion_destinatarios
  ADD COLUMN agente_id INT UNSIGNED NULL AFTER contacto_id;

ALTER TABLE wa_difusiones
  ADD COLUMN imagen_url VARCHAR(255) NULL AFTER plantilla_idioma;
```

- [ ] **Step 4: Add the model fields**

In `src/models/DifusionDestinatario.js`, add after `contactoId`:
```javascript
      agenteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
```
In `src/models/Difusion.js`, add after `plantillaIdioma`:
```javascript
      imagenUrl: { type: DataTypes.STRING(255), allowNull: true },
```
In `docs/esquema_bandeja.sql`, add the two columns to the corresponding `CREATE TABLE` blocks (mirror the ALTERs: `agente_id INT UNSIGNED NULL` in `wa_difusion_destinatarios` after `contacto_id`, `imagen_url VARCHAR(255) NULL` in `wa_difusiones` after `plantilla_idioma`).

- [ ] **Step 5: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (2/2).

- [ ] **Step 6: Commit**

```bash
git add docs/migraciones/007-difusiones-agente-imagen.sql src/models/DifusionDestinatario.js src/models/Difusion.js docs/esquema_bandeja.sql test/difusion-modelos.test.js
git commit -m "feat(difusiones): migración 007 (agente_id, imagen_url) + modelos"
```

---

### Task 2: CSV + mapeo de destinatarios (puro)

**Files:**
- Create: `src/services/difusionCsv.js`
- Test: `test/difusion-csv.test.js`

**Interfaces:**
- Produces:
  - `validarTelefonoCo(bruto): { ok:true, waId, telefono } | { ok:false }` — normaliza a `57` + 10 dígitos (celular empieza en 3).
  - `parsearCsv(texto): { cabeceras: string[], filas: object[] }`.
  - `validarColumnas(cabeceras, mapeo): void` — lanza `Error` con `.status=400` si falta alguna columna requerida.
  - `construirDestinatarios({ filas, mapeo, agentesActivos }): Array<{ telefono, waId?, parametros: string[], agenteId: number|null, estado:'pendiente'|'omitido', motivo: string|null }>`.
  - `mapeo` = `{ telefono: string, agente: string, variables: Array<{tipo:'columna', columna:string} | {tipo:'fijo', valor:string}> }` (variables en orden `{{1}}..{{n}}`).

- [ ] **Step 1: Write the failing test**

```javascript
// test/difusion-csv.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validarTelefonoCo, parsearCsv, validarColumnas, construirDestinatarios } = require('../src/services/difusionCsv');

test('validarTelefonoCo acepta celular de 10 dígitos y normaliza a 57...', () => {
  assert.deepEqual(validarTelefonoCo('3001234567'), { ok: true, waId: '573001234567', telefono: '573001234567' });
  assert.deepEqual(validarTelefonoCo('57 300 123 4567'), { ok: true, waId: '573001234567', telefono: '573001234567' });
});
test('validarTelefonoCo rechaza fijo/corto', () => {
  assert.equal(validarTelefonoCo('6017654321').ok, false); // no empieza en 3
  assert.equal(validarTelefonoCo('12345').ok, false);
});
test('parsearCsv separa cabeceras y filas', () => {
  const r = parsearCsv('CELULAR,NOMBRE\n3001234567,Juan\n3009876543,Ana');
  assert.deepEqual(r.cabeceras, ['CELULAR', 'NOMBRE']);
  assert.equal(r.filas.length, 2);
  assert.equal(r.filas[0].NOMBRE, 'Juan');
});
test('validarColumnas lanza 400 si falta una columna mapeada', () => {
  const mapeo = { telefono: 'CELULAR', agente: 'AGENTE_ID', variables: [{ tipo: 'columna', columna: 'NOMBRE' }] };
  assert.throws(() => validarColumnas(['CELULAR', 'NOMBRE'], mapeo), (e) => e.status === 400); // falta AGENTE_ID
});
test('construirDestinatarios: válido, teléfono malo, agente inactivo, y orden de parámetros', () => {
  const mapeo = {
    telefono: 'CELULAR', agente: 'AGENTE_ID',
    variables: [{ tipo: 'columna', columna: 'NOMBRE' }, { tipo: 'fijo', valor: '$450.000' }],
  };
  const filas = [
    { CELULAR: '3001234567', NOMBRE: 'Juan', AGENTE_ID: '5' },
    { CELULAR: '601000', NOMBRE: 'Fijo', AGENTE_ID: '5' },
    { CELULAR: '3009876543', NOMBRE: 'Ana', AGENTE_ID: '99' },
  ];
  const out = construirDestinatarios({ filas, mapeo, agentesActivos: [5] });
  assert.equal(out[0].estado, 'pendiente');
  assert.deepEqual(out[0].parametros, ['Juan', '$450.000']);
  assert.equal(out[0].agenteId, 5);
  assert.equal(out[1].estado, 'omitido'); assert.match(out[1].motivo, /telefono/);
  assert.equal(out[2].estado, 'omitido'); assert.match(out[2].motivo, /agente/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... node --test test/difusion-csv.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Write the implementation**

```javascript
// src/services/difusionCsv.js
'use strict';
// Utilidades PURAS para cargar destinatarios de una difusión desde CSV/pegado.
// Sin BD, sin red.

/** Normaliza a waId colombiano: 57 + 10 dígitos, celular empieza en 3. */
function validarTelefonoCo(bruto) {
  const d = String(bruto || '').replace(/\D/g, '');
  let local = d;
  if (local.length === 12 && local.startsWith('57')) local = local.slice(2);
  if (local.length === 10 && local.startsWith('3')) return { ok: true, waId: `57${local}`, telefono: `57${local}` };
  return { ok: false };
}

/** CSV simple: primera línea = cabeceras, separador coma, sin comillas complejas. */
function parsearCsv(texto) {
  const lineas = String(texto || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lineas.length) return { cabeceras: [], filas: [] };
  const cabeceras = lineas[0].split(',').map((c) => c.trim());
  const filas = lineas.slice(1).map((l) => {
    const celdas = l.split(',');
    const obj = {};
    cabeceras.forEach((c, i) => { obj[c] = (celdas[i] ?? '').trim(); });
    return obj;
  });
  return { cabeceras, filas };
}

/** Exige que el CSV traiga todas las columnas requeridas por el mapeo. */
function validarColumnas(cabeceras, mapeo) {
  const req = [mapeo.telefono, mapeo.agente,
    ...(mapeo.variables || []).filter((v) => v.tipo === 'columna').map((v) => v.columna)];
  const faltan = req.filter((c) => !cabeceras.includes(c));
  if (faltan.length) { const e = new Error(`faltan columnas: ${faltan.join(', ')}`); e.status = 400; throw e; }
}

/** Arma los destinatarios; marca 'omitido' (con motivo) los que no se enviarán. */
function construirDestinatarios({ filas, mapeo, agentesActivos }) {
  const activos = new Set((agentesActivos || []).map(Number));
  return filas.map((fila) => {
    const tel = validarTelefonoCo(fila[mapeo.telefono]);
    const agenteId = Number(String(fila[mapeo.agente] || '').replace(/\D/g, ''));
    const parametros = (mapeo.variables || []).map((v) =>
      v.tipo === 'fijo' ? String(v.valor ?? '') : String(fila[v.columna] ?? ''));
    if (!tel.ok) return { telefono: String(fila[mapeo.telefono] || ''), parametros, agenteId: null, estado: 'omitido', motivo: 'telefono invalido' };
    if (!Number.isInteger(agenteId) || !activos.has(agenteId)) {
      return { telefono: tel.telefono, waId: tel.waId, parametros, agenteId: null, estado: 'omitido', motivo: 'agente invalido' };
    }
    return { telefono: tel.telefono, waId: tel.waId, parametros, agenteId, estado: 'pendiente', motivo: null };
  });
}

module.exports = { validarTelefonoCo, parsearCsv, validarColumnas, construirDestinatarios };
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/services/difusionCsv.js test/difusion-csv.test.js
git commit -m "feat(difusiones): parseo/validación de CSV + mapeo de destinatarios (puro)"
```

---

### Task 3: Reglas de envío (ventana, ritmo, error) — puro

**Files:**
- Create: `src/services/difusionReglas.js`
- Test: `test/difusion-reglas.test.js`

**Interfaces:**
- Produces:
  - `dentroDeVentana(fecha: Date): boolean` — Lun–Vie 08:00–18:59, Sáb 08:00–13:59, Dom no (hora local).
  - `esperaEnvioMs(baseMs=20000, jitterMs=5000, rnd=Math.random): number`.
  - `clasificarError(codigo): { estado:'fallido'|'omitido', reintentarEnMin: number|null, marcarExperimento: boolean }`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/difusion-reglas.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dentroDeVentana, esperaEnvioMs, clasificarError } = require('../src/services/difusionReglas');

// 2026-08-03 = Lunes, 08-08 = Sábado, 08-09 = Domingo (verificado).
test('dentroDeVentana: Lun 10h sí, Lun 07h no, Lun 19h no', () => {
  assert.equal(dentroDeVentana(new Date(2026, 7, 3, 10, 0)), true);
  assert.equal(dentroDeVentana(new Date(2026, 7, 3, 7, 59)), false);
  assert.equal(dentroDeVentana(new Date(2026, 7, 3, 19, 0)), false);
});
test('dentroDeVentana: Sáb 12h sí, Sáb 14h no, Dom no', () => {
  assert.equal(dentroDeVentana(new Date(2026, 7, 8, 12, 0)), true);
  assert.equal(dentroDeVentana(new Date(2026, 7, 8, 14, 0)), false);
  assert.equal(dentroDeVentana(new Date(2026, 7, 9, 10, 0)), false);
});
test('esperaEnvioMs: base + jitter según rnd', () => {
  assert.equal(esperaEnvioMs(20000, 5000, () => 0), 20000);
  assert.equal(esperaEnvioMs(20000, 5000, () => 0.9998), 24999);
});
test('clasificarError: 131049→24h, 130472→omitido+experimento, otro→fallido', () => {
  assert.deepEqual(clasificarError('131049'), { estado: 'fallido', reintentarEnMin: 1440, marcarExperimento: false });
  assert.deepEqual(clasificarError('130472'), { estado: 'omitido', reintentarEnMin: null, marcarExperimento: true });
  assert.deepEqual(clasificarError('131000'), { estado: 'fallido', reintentarEnMin: null, marcarExperimento: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... node --test test/difusion-reglas.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Write the implementation**

```javascript
// src/services/difusionReglas.js
'use strict';
// Reglas PURAS del envío de difusiones: ventana horaria, ritmo y clasificación de error.

/** Ventana: Lun–Vie 08:00–18:59, Sáb 08:00–13:59 (hora local); Dom no. */
function dentroDeVentana(fecha) {
  const dow = fecha.getDay(); // 0=Dom..6=Sáb
  const h = fecha.getHours();
  if (dow === 0) return false;
  if (dow === 6) return h >= 8 && h < 14;
  return h >= 8 && h < 19;
}

/** Espera entre envíos: base (20 s) + jitter [0, jitterMs). rnd inyectable para test. */
function esperaEnvioMs(baseMs = 20000, jitterMs = 5000, rnd = Math.random) {
  return baseMs + Math.floor(rnd() * jitterMs);
}

/** Traduce un código de error de 1msg → qué hacer con el destinatario. */
function clasificarError(codigo) {
  const c = String(codigo || '');
  if (c === '131049') return { estado: 'fallido', reintentarEnMin: 1440, marcarExperimento: false }; // límite marketing → 24h
  if (c === '130472') return { estado: 'omitido', reintentarEnMin: null, marcarExperimento: true };  // experimento Meta
  return { estado: 'fallido', reintentarEnMin: null, marcarExperimento: false };
}

module.exports = { dentroDeVentana, esperaEnvioMs, clasificarError };
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/services/difusionReglas.js test/difusion-reglas.test.js
git commit -m "feat(difusiones): reglas puras de ventana, ritmo y clasificación de error"
```

---

### Task 4: Imagen de campaña (guardar en disco + URL pública)

**Files:**
- Create: `src/services/difusionImagen.js`
- Test: `test/difusion-imagen.test.js`

**Interfaces:**
- Consumes: `env.media.path` (dir base de media), `env.publicBaseUrl` (si no existe, usar `process.env.PUBLIC_BASE_URL`).
- Produces:
  - `nombreArchivoImagen(difusionId, mime): string` — nombre determinístico `dif-<id>.<ext>` (ext por mime: image/png→png, image/jpeg→jpg, image/webp→webp; otro → lanza Error `.status=400`).
  - `async guardarImagen(difusionId, buffer, mime): { rutaRelativa, url }` — escribe en `<media.path>/difusiones/<nombre>` y devuelve la URL pública `${PUBLIC_BASE_URL}/media-difusion/<nombre>`.
  - `rutaAbsolutaImagen(nombre): string` — para servirla (`<media.path>/difusiones/<nombre>`), con guardas anti path-traversal (rechaza `/`, `..`).

- [ ] **Step 1: Write the failing test**

```javascript
// test/difusion-imagen.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nombreArchivoImagen, rutaAbsolutaImagen } = require('../src/services/difusionImagen');

test('nombreArchivoImagen usa la extensión según el mime', () => {
  assert.equal(nombreArchivoImagen(7, 'image/png'), 'dif-7.png');
  assert.equal(nombreArchivoImagen(7, 'image/jpeg'), 'dif-7.jpg');
});
test('nombreArchivoImagen rechaza mime no soportado con 400', () => {
  assert.throws(() => nombreArchivoImagen(7, 'application/pdf'), (e) => e.status === 400);
});
test('rutaAbsolutaImagen rechaza path traversal', () => {
  assert.throws(() => rutaAbsolutaImagen('../secreto'), (e) => e.status === 400);
  assert.throws(() => rutaAbsolutaImagen('a/b'), (e) => e.status === 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... node --test test/difusion-imagen.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Write the implementation**

```javascript
// src/services/difusionImagen.js
'use strict';
const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');

const EXT_POR_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' };
const SUBDIR = 'difusiones';

function err400(msg) { const e = new Error(msg); e.status = 400; return e; }

/** Nombre determinístico por campaña; rechaza mimes no soportados. */
function nombreArchivoImagen(difusionId, mime) {
  const ext = EXT_POR_MIME[String(mime || '').toLowerCase()];
  if (!ext) throw err400('formato de imagen no soportado (usa png/jpg/webp)');
  return `dif-${difusionId}.${ext}`;
}

/** Ruta absoluta segura del archivo servible; rechaza traversal. */
function rutaAbsolutaImagen(nombre) {
  if (/[\\/]/.test(String(nombre)) || String(nombre).includes('..')) throw err400('nombre inválido');
  return path.join(env.media.path, SUBDIR, String(nombre));
}

/** Guarda la imagen y devuelve su URL pública persistente. */
async function guardarImagen(difusionId, buffer, mime) {
  const nombre = nombreArchivoImagen(difusionId, mime);
  const abs = rutaAbsolutaImagen(nombre);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  const base = (env.publicBaseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return { rutaRelativa: path.join(SUBDIR, nombre), url: `${base}/media-difusion/${nombre}` };
}

module.exports = { nombreArchivoImagen, rutaAbsolutaImagen, guardarImagen, EXT_POR_MIME };
```

- [ ] **Step 4: Serve the image (persistent public route)**

In `src/controllers/mediaController.js`, add a handler (mirrors `servirPublico` but from disk, no TTL):
```javascript
const { rutaAbsolutaImagen } = require('../services/difusionImagen');
const fssync = require('fs');

/** GET /media-difusion/:nombre — sirve la imagen de una campaña (pública, persistente). */
async function servirImagenDifusion(req, res) {
  try {
    const abs = rutaAbsolutaImagen(req.params.nombre);
    if (!fssync.existsSync(abs)) return res.status(404).end();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(abs);
  } catch (err) {
    if (err.status === 400) return res.status(400).end();
    logger.error(`media-difusion: ${err.message}`);
    return res.status(500).end();
  }
}
module.exports = { ...module.exports, servirImagenDifusion };
```
(Ensure `logger` is already required at the top of the file; it is.) In `src/routes/index.js`, near `router.get('/media-publico/:token', servirPublico);` add:
```javascript
const { servirImagenDifusion } = require('../controllers/mediaController');
router.get('/media-difusion/:nombre', servirImagenDifusion);
```

- [ ] **Step 5: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add src/services/difusionImagen.js src/controllers/mediaController.js src/routes/index.js test/difusion-imagen.test.js
git commit -m "feat(difusiones): imagen de campaña en disco + ruta pública persistente"
```

---

### Task 5: Servicio de difusiones (CRUD + carga + consultas)

**Files:**
- Create: `src/services/difusiones.js`
- Test: `test/difusion-servicio.test.js`

**Interfaces:**
- Consumes: modelos `Difusion`, `DifusionDestinatario`, `Contacto`; `sequelize`, `QueryTypes`; `construirDestinatarios`, `parsearCsv`, `validarColumnas` de `difusionCsv`; `obtenerCatalogo` de `plantillasController` (para validar la plantilla y leer `variables`).
- Produces:
  - `puedeIniciar(estado, pendientes): boolean` — pura: `estado` es `borrador` y `pendientes > 0`.
  - `async crear({ nombre, plantilla, idioma, categoria, creadoPorId }): Difusion` (resuelve el canal por `env.onemsg.instanceId`).
  - `async cargarDestinatarios(difusionId, { texto, mapeo }): { total, pendientes, omitidos: Array<{telefono,motivo}> }`.
  - `async iniciar(difusionId): void` (valida con `puedeIniciar`; lanza `.status=409` si no).
  - `async cancelar(difusionId): void`.
  - `async listar(): Array<campaña+resumen>`.
  - `async detalle(difusionId): { difusion, embudo }`.
  - `async destinatarios(difusionId, { estado, pagina }): { total, filas }`.

- [ ] **Step 1: Write the failing test (parte pura)**

```javascript
// test/difusion-servicio.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { puedeIniciar } = require('../src/services/difusiones');

test('puedeIniciar solo en borrador con pendientes', () => {
  assert.equal(puedeIniciar('borrador', 3), true);
  assert.equal(puedeIniciar('borrador', 0), false);
  assert.equal(puedeIniciar('enviando', 3), false);
  assert.equal(puedeIniciar('finalizada', 3), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... node --test test/difusion-servicio.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Write the implementation**

```javascript
// src/services/difusiones.js
'use strict';
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { Difusion, DifusionDestinatario, Contacto, Agente, Canal } = require('../models');
const { parsearCsv, validarColumnas, construirDestinatarios } = require('./difusionCsv');
const { obtenerCatalogo } = require('../controllers/plantillasController');
const env = require('../config/env');

function err(status, msg) { const e = new Error(msg); e.status = status; return e; }

/** Pura: solo se puede iniciar una campaña en borrador con destinatarios pendientes. */
function puedeIniciar(estado, pendientes) {
  return estado === 'borrador' && pendientes > 0;
}

async function crear({ nombre, plantilla, idioma, categoria, creadoPorId }) {
  const catalogo = await obtenerCatalogo();
  const def = catalogo.find((p) => p.name === plantilla);
  if (!def) throw err(400, 'plantilla no encontrada o no aprobada');
  // El canal se resuelve por el instanceId configurado (no se hardcodea).
  const canal = await Canal.findOne({ where: { instanceId: env.onemsg.instanceId } });
  if (!canal) throw err(503, 'canal WABA no configurado');
  return Difusion.create({
    nombre, plantillaNombre: plantilla, plantillaIdioma: idioma || def.language || 'es',
    categoria: categoria || def.categoria || 'utility', estado: 'borrador',
    canalId: canal.id, creadoPorId,
  });
}

/** Resuelve/crea contactos e inserta destinatarios. Devuelve el resumen de validación. */
async function cargarDestinatarios(difusionId, { texto, mapeo }) {
  const dif = await Difusion.findByPk(difusionId);
  if (!dif) throw err(404, 'difusión no encontrada');
  const { cabeceras, filas } = parsearCsv(texto);
  validarColumnas(cabeceras, mapeo); // lanza 400 si faltan columnas
  const agentes = await Agente.findAll({ where: { activo: true }, attributes: ['id'] });
  const destinatarios = construirDestinatarios({ filas, mapeo, agentesActivos: agentes.map((a) => a.id) });

  const omitidos = [];
  let pendientes = 0;
  for (const d of destinatarios) {
    if (d.estado === 'omitido') { omitidos.push({ telefono: d.telefono, motivo: d.motivo }); continue; }
    // Resolver/crear contacto por waId (patrón de ingesta).
    const [contacto] = await Contacto.findOrCreate({
      where: { waId: d.waId },
      defaults: { waId: d.waId, telefono: d.telefono },
    });
    // Upsert del destinatario (clave única difusion_id+contacto_id → no duplica).
    await DifusionDestinatario.findOrCreate({
      where: { difusionId, contactoId: contacto.id },
      defaults: { difusionId, contactoId: contacto.id, agenteId: d.agenteId, parametros: d.parametros, estado: 'pendiente' },
    });
    pendientes += 1;
  }
  return { total: destinatarios.length, pendientes, omitidos };
}

async function iniciar(difusionId) {
  const dif = await Difusion.findByPk(difusionId);
  if (!dif) throw err(404, 'difusión no encontrada');
  const pendientes = await DifusionDestinatario.count({ where: { difusionId, estado: 'pendiente' } });
  if (!puedeIniciar(dif.estado, pendientes)) throw err(409, 'la campaña no se puede iniciar (revisa estado y destinatarios)');
  await dif.update({ estado: 'enviando' });
}

async function cancelar(difusionId) {
  const dif = await Difusion.findByPk(difusionId);
  if (!dif) throw err(404, 'difusión no encontrada');
  await dif.update({ estado: 'cancelada' });
}

async function listar() {
  return sequelize.query(
    `SELECT d.id, d.nombre, d.plantilla_nombre AS plantilla, d.estado, d.creado_en AS creadoEn,
            COUNT(dd.id) AS total,
            SUM(dd.estado IN ('enviado','entregado','leido')) AS enviados
       FROM wa_difusiones d
       LEFT JOIN wa_difusion_destinatarios dd ON dd.difusion_id = d.id
      GROUP BY d.id
      ORDER BY d.creado_en DESC`,
    { type: QueryTypes.SELECT },
  );
}

/** Embudo por campaña: estados del destinatario + entrega real (join con wa_mensajes). */
async function detalle(difusionId) {
  const dif = await Difusion.findByPk(difusionId);
  if (!dif) throw err(404, 'difusión no encontrada');
  const [embudo] = await sequelize.query(
    `SELECT
        COUNT(*) AS total,
        SUM(dd.estado = 'omitido') AS omitidos,
        SUM(dd.estado IN ('enviado','entregado','leido')) AS enviados,
        SUM(m.estado = 'entregado') AS entregados,
        SUM(m.estado = 'leido') AS leidos,
        SUM(dd.estado = 'fallido') AS fallidos
       FROM wa_difusion_destinatarios dd
       LEFT JOIN wa_mensajes m ON m.wa_message_id = dd.wa_message_id
      WHERE dd.difusion_id = :id`,
    { type: QueryTypes.SELECT, replacements: { id: difusionId } },
  );
  const [{ fallidosPorCodigo }] = [{ fallidosPorCodigo: await sequelize.query(
    `SELECT error_codigo AS codigo, COUNT(*) AS n FROM wa_difusion_destinatarios
      WHERE difusion_id = :id AND estado = 'fallido' AND error_codigo IS NOT NULL GROUP BY error_codigo`,
    { type: QueryTypes.SELECT, replacements: { id: difusionId } }) }];
  const [{ respondidos }] = await sequelize.query(
    `SELECT COUNT(DISTINCT dd.contacto_id) AS respondidos
       FROM wa_difusion_destinatarios dd
       JOIN wa_mensajes env ON env.wa_message_id = dd.wa_message_id
       JOIN wa_conversaciones c ON c.id = env.conversacion_id
       JOIN wa_mensajes r ON r.conversacion_id = c.id AND r.direccion = 'in' AND r.ts_proveedor > env.ts_proveedor
      WHERE dd.difusion_id = :id`,
    { type: QueryTypes.SELECT, replacements: { id: difusionId } },
  );
  return { difusion: dif, embudo: { ...embudo, respondidos, fallidosPorCodigo } };
}

async function destinatarios(difusionId, { estado, pagina = 0, tam = 50 } = {}) {
  const where = { difusionId, ...(estado ? { estado } : {}) };
  const { count, rows } = await DifusionDestinatario.findAndCountAll({
    where, limit: tam, offset: pagina * tam, order: [['id', 'ASC']],
  });
  return { total: count, filas: rows };
}

module.exports = { puedeIniciar, crear, cargarDestinatarios, iniciar, cancelar, listar, detalle, destinatarios };
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (1/1). (Las funciones con BD se verifican en vivo.)

- [ ] **Step 5: Commit**

```bash
git add src/services/difusiones.js test/difusion-servicio.test.js
git commit -m "feat(difusiones): servicio CRUD + carga de destinatarios + embudo"
```

---

### Task 6: Envío de un destinatario (transaccional)

**Files:**
- Create: `src/services/difusionEnvio.js`
- Test: `test/difusion-envio.test.js`

**Interfaces:**
- Consumes: `enviarPlantilla` de `onemsg/plantillas`; `construirParams`, `construirParamsHeader`, `renderizarCuerpo` de `./plantillas`; modelos `Conversacion`, `Mensaje`, `Contacto`; `sequelize`; `clasificarError` de `difusionReglas`; constantes.
- Produces:
  - `payloadDeEnvio(dif, def, dest): { phone, template, language, namespace, params }` — pura; arma el cuerpo de `enviarPlantilla` (header con `dif.imagenUrl || def.imagenDefault` si `def.tieneImagen`).
  - `async enviarDestinatario(dest, dif, def, deps={}): 'enviado'|'fallido'|'omitido'` — envía y persiste el resultado en una transacción.

- [ ] **Step 1: Write the failing test (parte pura)**

```javascript
// test/difusion-envio.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { payloadDeEnvio } = require('../src/services/difusionEnvio');

const def = { name: 'recordatorio_de_mora', cuerpo: 'Hola {{1}}, mora {{2}}', variables: 2, tieneImagen: false, imagenDefault: null, namespace: 'ns', language: 'es' };

test('payloadDeEnvio arma phone, template y params de cuerpo', () => {
  const dif = { plantillaNombre: 'recordatorio_de_mora', plantillaIdioma: 'es', imagenUrl: null };
  const dest = { telefono: '573001234567', parametros: ['Juan', '$450.000'] };
  const p = payloadDeEnvio(dif, def, dest);
  assert.equal(p.phone, '573001234567');
  assert.equal(p.template, 'recordatorio_de_mora');
  assert.deepEqual(p.language, { code: 'es', policy: 'deterministic' });
  assert.equal(p.namespace, 'ns');
  // params = [ body con 2 textos ]
  assert.equal(p.params[0].type, 'body');
  assert.deepEqual(p.params[0].parameters.map((x) => x.text), ['Juan', '$450.000']);
});
test('payloadDeEnvio añade header de imagen si la plantilla la lleva', () => {
  const defImg = { ...def, tieneImagen: true, imagenDefault: 'https://x/y.png' };
  const dif = { plantillaNombre: 'promo', plantillaIdioma: 'es', imagenUrl: 'https://mi/persistente.png' };
  const p = payloadDeEnvio(dif, defImg, { telefono: '573001234567', parametros: ['Ana', '$1'] });
  assert.equal(p.params[0].type, 'header');
  assert.equal(p.params[0].parameters[0].image.link, 'https://mi/persistente.png'); // imagenUrl gana sobre default
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... node --test test/difusion-envio.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Write the implementation**

```javascript
// src/services/difusionEnvio.js
'use strict';
const { sequelize } = require('../config/database');
const { Conversacion, Mensaje, Contacto } = require('../models');
const { enviarPlantilla } = require('../integrations/onemsg/plantillas');
const { construirParams, construirParamsHeader, renderizarCuerpo } = require('./plantillas');
const { clasificarError } = require('./difusionReglas');
const { DIRECCION, TIPO_MENSAJE, ESTADO_MENSAJE, ESTADO_CONVERSACION } = require('../config/constants');
const logger = require('../utils/logger');

/** Pura: arma el cuerpo de enviarPlantilla (header de imagen si aplica). */
function payloadDeEnvio(dif, def, dest) {
  const header = def.tieneImagen ? construirParamsHeader(dif.imagenUrl || def.imagenDefault) : [];
  return {
    phone: dest.telefono,
    template: dif.plantillaNombre,
    language: { code: dif.plantillaIdioma || def.language || 'es', policy: 'deterministic' },
    namespace: def.namespace || null,
    params: [...header, ...construirParams(dest.parametros)],
  };
}

/**
 * Envía la plantilla a un destinatario y persiste el resultado. Devuelve el estado
 * final. En éxito: crea/reusa la conversación (origen difusion, cerrada), asigna
 * agente si el contacto no tiene dueño, y crea el mensaje saliente (enviado_por_id NULL).
 */
async function enviarDestinatario(dest, dif, def, deps = {}) {
  const enviar = deps.enviarPlantilla || enviarPlantilla;
  let enviado;
  try {
    enviado = await enviar(payloadDeEnvio(dif, def, dest));
  } catch (err) {
    const clas = clasificarError(err.codigo);
    const reintentarEn = clas.reintentarEnMin ? new Date(Date.now() + clas.reintentarEnMin * 60000) : null;
    await dest.update({ estado: clas.estado, errorCodigo: err.codigo || null, intentos: dest.intentos + 1, reintentarEn });
    if (clas.marcarExperimento) await Contacto.update({ waExperimento: true }, { where: { id: dest.contactoId } });
    logger.warn(`difusión ${dif.id} dest ${dest.id}: ${clas.estado} [${err.codigo || ''}]`);
    return clas.estado;
  }

  const texto = renderizarCuerpo(def.cuerpo, dest.parametros);
  const ahora = new Date();
  await sequelize.transaction(async (t) => {
    const contacto = await Contacto.findByPk(dest.contactoId, { transaction: t });
    // Dueño: si el contacto ya tiene, se respeta; si no, el del CSV.
    const agenteId = contacto.agenteDuenoId || dest.agenteId || null;
    if (!contacto.agenteDuenoId && agenteId) await contacto.update({ agenteDuenoId: agenteId }, { transaction: t });

    // Reusar la última conversación; si está cerrada o no hay, crear/dejar en cerrada.
    let conv = await Conversacion.findOne({ where: { contactoId: contacto.id }, order: [['id', 'DESC']], transaction: t });
    if (!conv) {
      conv = await Conversacion.create({
        canalId: dif.canalId, contactoId: contacto.id, agenteId,
        estado: ESTADO_CONVERSACION.CERRADA, origen: 'difusion', cerradaEn: ahora,
      }, { transaction: t });
    }

    await Mensaje.findOrCreate({
      where: { waMessageId: enviado.id },
      defaults: {
        conversacionId: conv.id, waMessageId: enviado.id, direccion: DIRECCION.OUT,
        tipo: TIPO_MENSAJE.TEMPLATE, texto, plantillaNombre: dif.plantillaNombre,
        estado: ESTADO_MENSAJE.ENVIADO, enviadoPorId: null, tsProveedor: ahora,
      },
      transaction: t,
    });
    await conv.update({ ultimoMensajeEn: ahora, ultimoMensajeTexto: texto.slice(0, 255), ultimoMensajeDir: DIRECCION.OUT }, { transaction: t });
    await dest.update({ estado: 'enviado', waMessageId: enviado.id, intentos: dest.intentos + 1, errorCodigo: null }, { transaction: t });
  });

  // El chat queda en resueltos; el progreso a admins lo emite el worker. La reapertura
  // (cuando el cliente responde) la maneja la ingesta existente.
  return 'enviado';
}

module.exports = { payloadDeEnvio, enviarDestinatario };
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (2/2). (La transacción se verifica en vivo.)

- [ ] **Step 5: Commit**

```bash
git add src/services/difusionEnvio.js test/difusion-envio.test.js
git commit -m "feat(difusiones): envío de un destinatario (transaccional, en bandeja)"
```

---

### Task 7: Worker de difusiones + emisor remoto

**Files:**
- Create: `src/workers/emisorRemoto.js`, `src/workers/difusiones.js`
- Modify: `src/workers/index.js`
- Test: `test/difusion-worker.test.js`

**Interfaces:**
- Consumes: `dentroDeVentana`, `esperaEnvioMs` de `difusionReglas`; `enviarDestinatario`, de `difusionEnvio`; modelos `Difusion`, `DifusionDestinatario`; `obtenerCatalogo`.
- Produces:
  - `emisorRemoto.emitirRemoto(evento, destino, payload): Promise<void>` — POST a `http://127.0.0.1:${env.port}/internal/emitir` con `x-internal-secret`.
  - `difusiones.tick(ahora, deps): Promise<'sin-campana'|'fuera-ventana'|'enviado'|'finalizada'>` — un paso del loop (testeable con deps mock).
  - `difusiones.iniciarLoop(): void` — arranca el loop.

- [ ] **Step 1: Write the failing test**

```javascript
// test/difusion-worker.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tick } = require('../src/workers/difusiones');

function deps(over = {}) {
  return {
    dentroDeVentana: () => true,
    campanaActiva: async () => null,
    siguienteDestinatario: async () => null,
    catalogo: async () => [],
    enviar: async () => 'enviado',
    finalizar: async () => {},
    ...over,
  };
}

test('tick sin campaña activa → sin-campana', async () => {
  assert.equal(await tick(new Date(), deps()), 'sin-campana');
});
test('tick fuera de ventana → fuera-ventana (no envía)', async () => {
  let envio = 0;
  const d = deps({ dentroDeVentana: () => false, campanaActiva: async () => ({ id: 1 }), enviar: async () => { envio++; return 'enviado'; } });
  assert.equal(await tick(new Date(), d), 'fuera-ventana');
  assert.equal(envio, 0);
});
test('tick con campaña y sin pendientes → finaliza', async () => {
  let finalizada = 0;
  const d = deps({ campanaActiva: async () => ({ id: 1, plantillaNombre: 'x' }), siguienteDestinatario: async () => null, finalizar: async () => { finalizada++; } });
  assert.equal(await tick(new Date(), d), 'finalizada');
  assert.equal(finalizada, 1);
});
test('tick con destinatario pendiente → envía', async () => {
  let envio = 0;
  const d = deps({
    campanaActiva: async () => ({ id: 1, plantillaNombre: 'recordatorio_de_mora' }),
    siguienteDestinatario: async () => ({ id: 9 }),
    catalogo: async () => [{ name: 'recordatorio_de_mora', variables: 2 }],
    enviar: async () => { envio++; return 'enviado'; },
  });
  assert.equal(await tick(new Date(), d), 'enviado');
  assert.equal(envio, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... node --test test/difusion-worker.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Write the emisor remoto**

```javascript
// src/workers/emisorRemoto.js
'use strict';
const env = require('../config/env');
const logger = require('../utils/logger');

/** Puente worker→backend para emitir por socket (mismo patrón que la ingesta). */
async function emitirRemoto(evento, destino, payload) {
  try {
    await fetch(`http://127.0.0.1:${env.port}/internal/emitir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': env.webhookSecret },
      body: JSON.stringify({ evento, destino, payload }),
    });
  } catch (err) {
    logger.warn(`emitirRemoto ${evento}: ${err.message}`); // no bloquea el envío
  }
}

module.exports = { emitirRemoto };
```

- [ ] **Step 4: Write the worker**

```javascript
// src/workers/difusiones.js
'use strict';
const { Op } = require('sequelize');
const { Difusion, DifusionDestinatario } = require('../models');
const { dentroDeVentana, esperaEnvioMs } = require('../services/difusionReglas');
const { enviarDestinatario } = require('../services/difusionEnvio');
const { obtenerCatalogo } = require('../controllers/plantillasController');
const { emitirRemoto } = require('./emisorRemoto');
const logger = require('../utils/logger');

// Campaña activa: la más antigua en 'enviando' (una a la vez, FIFO).
async function campanaActivaDefault() {
  return Difusion.findOne({ where: { estado: 'enviando' }, order: [['creado_en', 'ASC']] });
}
// Próximo destinatario enviable de una campaña: pendiente, o fallido cuyo reintentar_en ya venció.
async function siguienteDestinatarioDefault(difusionId, ahora) {
  return DifusionDestinatario.findOne({
    where: {
      difusionId,
      [Op.or]: [{ estado: 'pendiente' }, { estado: 'fallido', reintentarEn: { [Op.lte]: ahora } }],
    },
    order: [['id', 'ASC']],
  });
}

/** Un paso del loop. deps inyectable para test. Devuelve qué hizo. */
async function tick(ahora, deps = {}) {
  const enVentana = (deps.dentroDeVentana || dentroDeVentana)(ahora);
  const campanaActiva = deps.campanaActiva || campanaActivaDefault;
  const siguiente = deps.siguienteDestinatario || ((id) => siguienteDestinatarioDefault(id, ahora));
  const catalogo = deps.catalogo || obtenerCatalogo;
  const finalizar = deps.finalizar || (async (dif) => { await dif.update({ estado: 'finalizada' }); emitirRemoto('difusion:progreso', {}, { difusionId: dif.id, estado: 'finalizada' }); });
  const enviar = deps.enviar || (async (dest, dif, def) => enviarDestinatario(dest, dif, def));

  const dif = await campanaActiva();
  if (!dif) return 'sin-campana';
  if (!enVentana) return 'fuera-ventana';
  const dest = await siguiente(dif.id);
  if (!dest) { await finalizar(dif); return 'finalizada'; }
  const def = (await catalogo()).find((p) => p.name === dif.plantillaNombre);
  if (!def) { logger.error(`difusión ${dif.id}: plantilla ${dif.plantillaNombre} no está en el catálogo`); return 'fuera-ventana'; }
  await enviar(dest, dif, def);
  emitirRemoto('difusion:progreso', {}, { difusionId: dif.id }); // destino vacío → room 'admins'
  return 'enviado';
}

let corriendo = false;
async function iniciarLoop() {
  if (corriendo) return;
  corriendo = true;
  const paso = async () => {
    let espera = 5000; // sin campaña / fuera de ventana: revisar cada 5 s
    try {
      const r = await tick(new Date());
      if (r === 'enviado') espera = esperaEnvioMs(); // ritmo entre mensajes (20 s + jitter)
    } catch (err) {
      logger.error(`worker difusiones: ${err.message}`);
    }
    if (corriendo) setTimeout(paso, espera);
  };
  paso();
}

module.exports = { tick, iniciarLoop, campanaActivaDefault, siguienteDestinatarioDefault };
```

- [ ] **Step 5: Start the loop in the worker process**

In `src/workers/index.js`, require and start the loop where the worker boots (junto al arranque del bucle de eventos). Add near the top:
```javascript
const { iniciarLoop: iniciarDifusiones } = require('./difusiones');
```
And where the worker starts its main loop (after the event-processing loop begins), add:
```javascript
  iniciarDifusiones();
```

- [ ] **Step 6: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (4/4).

- [ ] **Step 7: Commit**

```bash
git add src/workers/emisorRemoto.js src/workers/difusiones.js src/workers/index.js test/difusion-worker.test.js
git commit -m "feat(difusiones): worker de envío (una campaña a la vez, ritmo + ventana)"
```

---

### Task 8: Controller + rutas admin + subida de imagen

**Files:**
- Create: `src/controllers/difusionesController.js`
- Modify: `src/routes/api.js`
- Test: `test/difusiones-controller.test.js`

**Interfaces:**
- Consumes: `difusiones` (servicio), `guardarImagen` de `difusionImagen`, `Difusion`; `requireAuth`, `requireAdmin`, `subida` (multer, ya definido en `api.js`).
- Produces: handlers `crear`, `cargar`, `subirImagen`, `iniciar`, `cancelar`, `listar`, `detalle`, `destinatarios`. Todas admin-only. `_setServicio(stub)` para test sin BD.

- [ ] **Step 1: Write the failing test**

```javascript
// test/difusiones-controller.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ctrl = require('../src/controllers/difusionesController');

function resMock() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

test('crear responde 201 con la campaña', async () => {
  ctrl._setServicio({ crear: async (d) => ({ id: 1, ...d }) });
  const res = resMock();
  await ctrl.crear({ body: { nombre: 'Mora agosto', plantilla: 'recordatorio_de_mora' }, agente: { id: 2 } }, res);
  assert.equal(res._status, 201);
  assert.equal(res._json.difusion.nombre, 'Mora agosto');
});
test('iniciar traduce .status=409 del servicio', async () => {
  ctrl._setServicio({ iniciar: async () => { const e = new Error('no'); e.status = 409; throw e; } });
  const res = resMock();
  await ctrl.iniciar({ params: { id: '1' } }, res);
  assert.equal(res._status, 409);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... node --test test/difusiones-controller.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Write the controller**

```javascript
// src/controllers/difusionesController.js
'use strict';
const logger = require('../utils/logger');
const servicioReal = require('../services/difusiones');
const { guardarImagen } = require('../services/difusionImagen');
const { Difusion } = require('../models');

let servicio = servicioReal;
function _setServicio(s) { servicio = { ...servicioReal, ...s }; }

function fallo(res, err, msgGenerico) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  logger.error(msgGenerico + ': ' + err.message);
  return res.status(500).json({ error: msgGenerico });
}

async function crear(req, res) {
  try {
    const b = req.body || {};
    if (!b.nombre || !b.plantilla) return res.status(400).json({ error: 'nombre y plantilla son obligatorios' });
    const dif = await servicio.crear({
      nombre: b.nombre, plantilla: b.plantilla, idioma: b.idioma, categoria: b.categoria,
      creadoPorId: req.agente.id,
    });
    return res.status(201).json({ difusion: dif });
  } catch (err) { return fallo(res, err, 'no se pudo crear la difusión'); }
}

async function cargar(req, res) {
  try {
    const { texto, mapeo } = req.body || {};
    if (!texto || !mapeo) return res.status(400).json({ error: 'texto y mapeo son obligatorios' });
    const r = await servicio.cargarDestinatarios(req.params.id, { texto, mapeo });
    return res.json(r);
  } catch (err) { return fallo(res, err, 'no se pudieron cargar los destinatarios'); }
}

async function subirImagen(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'falta el archivo' });
    const { url } = await guardarImagen(req.params.id, req.file.buffer, req.file.mimetype);
    await Difusion.update({ imagenUrl: url }, { where: { id: req.params.id } });
    return res.json({ imagenUrl: url });
  } catch (err) { return fallo(res, err, 'no se pudo subir la imagen'); }
}

async function iniciar(req, res) {
  try { await servicio.iniciar(req.params.id); return res.json({ ok: true }); }
  catch (err) { return fallo(res, err, 'no se pudo iniciar la difusión'); }
}
async function cancelar(req, res) {
  try { await servicio.cancelar(req.params.id); return res.json({ ok: true }); }
  catch (err) { return fallo(res, err, 'no se pudo cancelar la difusión'); }
}
async function listar(req, res) {
  try { return res.json({ difusiones: await servicio.listar() }); }
  catch (err) { return fallo(res, err, 'no se pudieron listar las difusiones'); }
}
async function detalle(req, res) {
  try { return res.json(await servicio.detalle(req.params.id)); }
  catch (err) { return fallo(res, err, 'no se pudo obtener la difusión'); }
}
async function destinatarios(req, res) {
  try {
    const pagina = Number(req.query.pagina) || 0;
    return res.json(await servicio.destinatarios(req.params.id, { estado: req.query.estado, pagina }));
  } catch (err) { return fallo(res, err, 'no se pudieron listar los destinatarios'); }
}

module.exports = { crear, cargar, subirImagen, iniciar, cancelar, listar, detalle, destinatarios, _setServicio };
```

- [ ] **Step 4: Wire the routes**

In `src/routes/api.js`, add the require near the other controllers:
```javascript
const difusionesCtrl = require('../controllers/difusionesController');
```
And register (admin-only; la subida de imagen usa el `subida` de multer ya definido en el archivo):
```javascript
router.get('/difusiones', requireAuth, requireAdmin, difusionesCtrl.listar);
router.post('/difusiones', requireAuth, requireAdmin, difusionesCtrl.crear);
router.get('/difusiones/:id', requireAuth, requireAdmin, difusionesCtrl.detalle);
router.get('/difusiones/:id/destinatarios', requireAuth, requireAdmin, difusionesCtrl.destinatarios);
router.post('/difusiones/:id/destinatarios', requireAuth, requireAdmin, difusionesCtrl.cargar);
router.post('/difusiones/:id/imagen', requireAuth, requireAdmin, subida.single('imagen'), difusionesCtrl.subirImagen);
router.post('/difusiones/:id/iniciar', requireAuth, requireAdmin, difusionesCtrl.iniciar);
router.post('/difusiones/:id/cancelar', requireAuth, requireAdmin, difusionesCtrl.cancelar);
```

- [ ] **Step 5: Run tests + full suite**

Run: `... node --test test/difusiones-controller.test.js` → PASS (2/2).
Run the whole backend suite to confirm no regressions:
`JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS (127 previos + los nuevos).

- [ ] **Step 6: Commit**

```bash
git add src/controllers/difusionesController.js src/routes/api.js test/difusiones-controller.test.js
git commit -m "feat(difusiones): endpoints admin (crear, cargar, imagen, iniciar, cancelar, resultados)"
```

---

## Verificación en vivo (tras completar todas las tareas)

Requiere migración 007 aplicada en el server + reinicio de `wa-backend` **y** `wa-worker`. Comprobar con un JWT admin:
1. `POST /api/difusiones` (nombre + `recordatorio_de_mora`) → 201.
2. `POST /api/difusiones/:id/destinatarios` con 2–3 filas (una válida, una con teléfono malo, una con agente inactivo) → resumen con `pendientes` y `omitidos`.
3. (Si la plantilla lleva imagen) `POST /api/difusiones/:id/imagen` → `imagenUrl`; abrir esa URL pública y ver la imagen.
4. `POST /api/difusiones/:id/iniciar` → el worker envía 1 cada ~20 s dentro de la ventana; verificar en 1msg/tu teléfono de prueba.
5. `GET /api/difusiones/:id` → embudo con enviados/entregados/leídos; `GET .../destinatarios` → estados. Un asesor recibe 403 en todos.
6. Confirmar que el envío **aparece en la bandeja** del agente asignado como chat en resueltos y que **responder reabre** el chat con ese agente.

## Notas / decisiones

- El worker vive en el proceso `wa-worker` (reusa el emisor remoto worker→backend). Requiere reiniciar `wa-worker` al desplegar.
- `PUBLIC_BASE_URL` ya está configurada en el server (se usa para la imagen pública persistente).
- Los estados de entrega salen del join con `wa_mensajes` (el webhook ya los actualiza); no se toca el worker de ingesta.
- El `canal_id` de la campaña se resuelve por `env.onemsg.instanceId` (tabla `wa_canales`, `instanceId` único), no se hardcodea.
