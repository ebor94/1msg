# Resumen de difusiones con IA → gestión de previsión — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al final del día, por cada destinatario de una difusión marcada "Requiere resumen", resumir su conversación con IA (Claude Haiku) y registrar ese resumen como gestión (INSERT en `gestion` de previsión), cerrando el ciclo difusión → conversación → cartera.

**Architecture:** Un check "Requiere resumen" en el asistente de difusión activa el flujo. La cédula del cliente viaja en la columna `CEDULA` del CSV y se guarda en `wa_difusion_destinatarios.documento`. Un nuevo loop del `wa-worker` corre a diario (~19:00 Colombia); por cada destinatario enviado y pendiente de resumir arma el texto de la conversación desde `wa_mensajes`, lo resume con Claude (si hubo respuesta), mapea la cédula a `num_plan` con `consultarPlanesPorDocumento` e inserta la gestión (concepto 49, tramito IA). Idempotente por `resumen_en`.

**Tech Stack:** Node 20 CommonJS, Express, Sequelize (MySQL 8 `serfuweb`), `mysql2` (BD externa `olivosct`), `@anthropic-ai/sdk` (Messages API, Haiku), Vue 3 + Pinia + Vitest.

## Global Constraints

- **Solo tablas `wa_`** en `serfuweb` + `gestion` en `olivosct` (INSERT ya cubierto por el GRANT de `wa_lector`). SQL siempre parametrizado.
- **La `ANTHROPIC_API_KEY` va solo en el `.env` del servidor** (`env.anthropic.apiKey`). Nunca al repo, frontend ni logs. Está pendiente de rotar (memoria `rotar-anthropic-key`).
- **Regla de aislamiento**: solo `src/integrations/anthropic/` importa el SDK de Anthropic; solo `src/integrations/prevision/` habla con `olivosct`. Ningún otro archivo.
- **novedad ≤ 255 caracteres** (límite de columna); recortar siempre.
- **Concepto `49`** (WhatsApp) debe existir en `conceptos_permitidos` — `insertarGestion` lo valida y lanza `concepto_invalido` si falta.
- **Solo INSERT en `gestion`** — NO se actualiza `plan`.
- Convenciones del repo: `underscored: true`, `timestamps` manuales, logger con niveles (nada de `console.log` en producción), nunca tragar excepciones de integraciones.
- Migraciones 001–009 aplicadas; la siguiente es **010**.
- Comando de test backend (166 tests actuales):
  `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
- Test frontend: `npm --prefix frontend test`.

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `docs/migraciones/010-resumen-difusiones.sql` | `wa_difusiones.requiere_resumen`, `wa_difusion_destinatarios.documento`, `wa_difusion_destinatarios.resumen_en` | Crear |
| `src/models/difusion.js` | Campo `requiereResumen` | Modificar |
| `src/models/difusionDestinatario.js` | Campos `documento`, `resumenEn` | Modificar |
| `src/services/difusionCsv.js` | Capturar `documento` desde columna `CEDULA` | Modificar |
| `src/services/difusiones.js` | `crear` acepta `requiereResumen`; `cargarDestinatarios` valida CEDULA y persiste `documento` | Modificar |
| `src/controllers/difusionesController.js` | `crear` reenvía `requiereResumen` | Modificar |
| `src/config/env.js` | `env.anthropic.apiKey` | Modificar |
| `src/integrations/anthropic/resumen.js` | Único punto que habla con Anthropic (Haiku) | Crear |
| `src/integrations/prevision/cliente.js` | `insertarGestion` (solo INSERT) | Modificar |
| `src/services/resumenDifusiones.js` | Armar texto de conversación, orquestar por destinatario | Crear |
| `src/workers/resumenDifusiones.js` | Loop diario (~19:00), ritmo suave | Crear |
| `src/workers/index.js` | Arrancar el nuevo loop | Modificar |
| `frontend/src/utils/difusion.js` | `columnasRequeridas(mapeo, requiereResumen)` (puro) | Modificar |
| `frontend/src/components/DifusionWizard.vue` | Check "Requiere resumen" + aviso CEDULA | Modificar |
| `test/*.test.js`, `frontend/src/utils/difusion.test.js` | Tests | Crear/Modificar |

---

## Task 1: Migración 010 + campos de modelo

**Files:**
- Create: `docs/migraciones/010-resumen-difusiones.sql`
- Modify: `src/models/difusion.js`
- Modify: `src/models/difusionDestinatario.js`

**Interfaces:**
- Produces: `Difusion.requiereResumen` (bool); `DifusionDestinatario.documento` (string|null), `DifusionDestinatario.resumenEn` (Date|null).

- [ ] **Step 1: Escribir la migración**

Create `docs/migraciones/010-resumen-difusiones.sql`:

```sql
-- Resumen de difusiones con IA → gestión de previsión.
-- Flag por campaña + cédula y marca de idempotencia por destinatario.
ALTER TABLE wa_difusiones
  ADD COLUMN requiere_resumen TINYINT(1) NOT NULL DEFAULT 0 AFTER categoria;

ALTER TABLE wa_difusion_destinatarios
  ADD COLUMN documento VARCHAR(20) NULL AFTER parametros,
  ADD COLUMN resumen_en DATETIME NULL AFTER intentos;
```

- [ ] **Step 2: Añadir el campo al modelo `Difusion`**

In `src/models/difusion.js`, add after the `categoria` block (before `estado`):

```js
      requiereResumen: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
```

- [ ] **Step 3: Añadir los campos al modelo `DifusionDestinatario`**

In `src/models/difusionDestinatario.js`, add `documento` after `parametros` and `resumenEn` after `reintentarEn`:

```js
      documento: { type: DataTypes.STRING(20), allowNull: true },
```
```js
      resumenEn: { type: DataTypes.DATE, allowNull: true },
```

- [ ] **Step 4: Verificar que los modelos cargan con los campos nuevos**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x \
ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t \
WEBHOOK_SECRET=x LOG_LEVEL=warn node -e "const m=require('./src/models'); \
console.log(!!m.Difusion.rawAttributes.requiereResumen, !!m.DifusionDestinatario.rawAttributes.documento, !!m.DifusionDestinatario.rawAttributes.resumenEn)"
```
Expected: `true true true`

- [ ] **Step 5: Commit**

```bash
git add docs/migraciones/010-resumen-difusiones.sql src/models/difusion.js src/models/difusionDestinatario.js
git commit -m "feat(difusiones): migración 010 — requiere_resumen, documento, resumen_en"
```

---

## Task 2: Capturar y persistir la cédula (CSV → destinatario)

**Files:**
- Modify: `src/services/difusionCsv.js`
- Modify: `src/services/difusiones.js`
- Modify: `src/controllers/difusionesController.js`
- Test: `test/difusion-csv.test.js`

**Interfaces:**
- Consumes: `Difusion.requiereResumen` (Task 1); `DifusionDestinatario.documento` (Task 1).
- Produces: cada destinatario de `construirDestinatarios` incluye `documento` (string|null, dígitos de la columna `CEDULA`). `crear({..., requiereResumen})` persiste el flag. `cargarDestinatarios` valida la columna `CEDULA` cuando la difusión requiere resumen y guarda `documento`.

- [ ] **Step 1: Escribir el test de captura de cédula**

In `test/difusion-csv.test.js`, append:

```js
test('construirDestinatarios captura documento (solo dígitos) de la columna CEDULA', () => {
  const mapeo = { telefono: 'CELULAR', agente: 'AGENTE_ID', variables: [{ tipo: 'columna', columna: 'NOMBRE' }] };
  const filas = [
    { CELULAR: '3001234567', NOMBRE: 'Juan', AGENTE_ID: '5', CEDULA: '88.123.456' },
    { CELULAR: '3009876543', NOMBRE: 'Ana', AGENTE_ID: '5', CEDULA: '' },
  ];
  const out = construirDestinatarios({ filas, mapeo, agentesActivos: [5] });
  assert.equal(out[0].documento, '88123456'); // normalizado a dígitos
  assert.equal(out[1].documento, null);       // vacío → null
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-csv.test.js`
Expected: FAIL — `out[0].documento` es `undefined`.

- [ ] **Step 3: Capturar `documento` en `construirDestinatarios`**

In `src/services/difusionCsv.js`, inside `construirDestinatarios`, add the column name near `colNombre` and compute `documento`, then include it in the three returned objects:

```js
  const colNombre = mapeo.nombre || 'NOMBRE'; // columna con el nombre del contacto (por defecto 'NOMBRE')
  const colCedula = mapeo.cedula || 'CEDULA'; // columna con la cédula (para el resumen → gestión)
```
```js
    const nombre = fila[colNombre] != null && String(fila[colNombre]).trim() !== '' ? String(fila[colNombre]).trim() : null;
    const documento = String(fila[colCedula] || '').replace(/\D/g, '') || null;
    if (!tel.ok) return { telefono: String(fila[mapeo.telefono] || ''), parametros, agenteId: null, nombre, documento, estado: 'omitido', motivo: 'telefono invalido' };
    if (!Number.isInteger(agenteId) || !activos.has(agenteId)) {
      return { telefono: tel.telefono, waId: tel.waId, parametros, agenteId: null, nombre, documento, estado: 'omitido', motivo: 'agente invalido' };
    }
    return { telefono: tel.telefono, waId: tel.waId, parametros, agenteId, nombre, documento, estado: 'pendiente', motivo: null };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-csv.test.js`
Expected: PASS

- [ ] **Step 5: `crear` acepta `requiereResumen`**

In `src/services/difusiones.js`, update `crear` to accept and persist the flag:

```js
async function crear({ nombre, plantilla, idioma, categoria, requiereResumen, creadoPorId }) {
```
and in the `Difusion.create({...})` call add:
```js
    canalId: canal.id, creadoPorId, requiereResumen: !!requiereResumen,
```

- [ ] **Step 6: `cargarDestinatarios` valida CEDULA y persiste `documento`**

In `src/services/difusiones.js`, inside `cargarDestinatarios`, after `validarColumnas(cabeceras, mapeo);` add the CEDULA requirement, and add `documento` to the `findOrCreate` defaults:

```js
  validarColumnas(cabeceras, mapeo); // lanza 400 si faltan columnas
  if (dif.requiereResumen && !cabeceras.includes(mapeo.cedula || 'CEDULA')) {
    throw err(400, 'esta difusión requiere resumen: el CSV debe traer la columna CEDULA');
  }
```
and in the destinatario upsert defaults:
```js
      defaults: { difusionId, contactoId: contacto.id, agenteId: d.agenteId, parametros: d.parametros, documento: d.documento || null, estado: 'pendiente' },
```

- [ ] **Step 7: El controlador reenvía `requiereResumen`**

In `src/controllers/difusionesController.js`, inside `crear`, add `requiereResumen` to the `servicio.crear({...})` call:

```js
    const dif = await servicio.crear({
      nombre: b.nombre, plantilla: b.plantilla, idioma: b.idioma, categoria: b.categoria,
      requiereResumen: b.requiereResumen, creadoPorId: req.agente.id,
    });
```

- [ ] **Step 8: Correr toda la suite backend**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS (sin regresiones; el nuevo test de cédula incluido).

- [ ] **Step 9: Commit**

```bash
git add src/services/difusionCsv.js src/services/difusiones.js src/controllers/difusionesController.js test/difusion-csv.test.js
git commit -m "feat(difusiones): capturar cédula del CSV y flag requiere_resumen"
```

---

## Task 3: Integración Anthropic (Haiku) — módulo aislado

**Files:**
- Modify: `src/config/env.js`
- Create: `src/integrations/anthropic/resumen.js`
- Test: `test/anthropic-resumen.test.js`
- Modify: `package.json` (dependencia `@anthropic-ai/sdk`)

**Interfaces:**
- Consumes: `env.anthropic.apiKey`.
- Produces: `resumirConversacion(texto, deps?) → Promise<string>` (resumen ≤255 chars); `recortar255(s) → string`. `deps.cliente` inyecta un cliente falso para test (evita red y API key).

- [ ] **Step 1: Instalar el SDK de Anthropic**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && npm install @anthropic-ai/sdk
```
Expected: `@anthropic-ai/sdk` queda en `dependencies` de `package.json`.

- [ ] **Step 2: Añadir la config al env**

In `src/config/env.js`, add a frozen block inside the `env` object (after the `mantenimientos` block):

```js
  // API de Anthropic (Claude) para el resumen de difusiones. Opcional: si no se
  // configura, el worker de resumen no llama a la IA (lanza 'no_configurado').
  anthropic: Object.freeze({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  }),
```

- [ ] **Step 3: Escribir el test del módulo (con cliente falso)**

Create `test/anthropic-resumen.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resumirConversacion, recortar255 } = require('../src/integrations/anthropic/resumen');

test('recortar255 recorta y limpia', () => {
  assert.equal(recortar255('  hola  '), 'hola');
  assert.equal(recortar255('a'.repeat(300)).length, 255);
});

test('resumirConversacion devuelve el texto del bloque text', async () => {
  const cliente = { messages: { create: async () => ({ content: [{ type: 'text', text: 'Cliente pagará el viernes.' }] }) } };
  const r = await resumirConversacion('Mensaje enviado: ...\nCliente: pago el viernes', { cliente });
  assert.equal(r, 'Cliente pagará el viernes.');
});

test('resumirConversacion recorta a 255 y tolera respuesta sin bloque text', async () => {
  const largo = { messages: { create: async () => ({ content: [{ type: 'text', text: 'x'.repeat(300) }] }) } };
  assert.equal((await resumirConversacion('t', { cliente: largo })).length, 255);
  const vacio = { messages: { create: async () => ({ content: [] }) } };
  assert.equal(await resumirConversacion('t', { cliente: vacio }), '');
});
```

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/anthropic-resumen.test.js`
Expected: FAIL — `Cannot find module '../src/integrations/anthropic/resumen'`.

- [ ] **Step 5: Escribir el módulo**

Create `src/integrations/anthropic/resumen.js`:

```js
'use strict';

/**
 * Único punto que habla con la API de Anthropic (Claude). Resume la conversación
 * de una difusión con Haiku (rápido/barato) para registrarla en gestión.
 *
 * La ANTHROPIC_API_KEY vive solo en el .env del servidor (env.anthropic.apiKey),
 * nunca se expone al frontend ni se loguea. Regla de aislamiento: ningún otro
 * archivo importa el SDK de Anthropic.
 */

const Anthropic = require('@anthropic-ai/sdk');
const env = require('../../config/env');

const MODELO = 'claude-haiku-4-5';
const MAX_TOKENS = 200; // ~255 chars de salida + margen
const SISTEMA =
  'Eres un asistente de cartera de Los Olivos Cúcuta. Resume en español, en máximo ' +
  '255 caracteres, la conversación de WhatsApp entre la empresa y el cliente sobre el ' +
  'pago de su cuota. Enfócate en la intención, compromiso o solicitud del cliente. ' +
  'Responde SOLO con el resumen, sin preámbulos ni comillas.';

let cliente = null;
function obtenerCliente() {
  if (!env.anthropic.apiKey) { const e = new Error('Anthropic no configurado'); e.codigo = 'no_configurado'; throw e; }
  // maxRetries: el SDK reintenta 429/5xx con backoff exponencial (por defecto 2).
  if (!cliente) cliente = new Anthropic({ apiKey: env.anthropic.apiKey, maxRetries: 3 });
  return cliente;
}

/** Recorta a 255 y limpia espacios (límite de la columna gestion.novedad). */
function recortar255(s) { return String(s || '').trim().slice(0, 255); }

/** Resume la conversación. deps.cliente inyecta un cliente falso para test. */
async function resumirConversacion(texto, deps = {}) {
  const c = deps.cliente || obtenerCliente();
  const resp = await c.messages.create({
    model: MODELO,
    max_tokens: MAX_TOKENS,
    system: SISTEMA,
    messages: [{ role: 'user', content: String(texto || '') }],
  });
  const bloque = (resp.content || []).find((b) => b.type === 'text');
  return recortar255(bloque ? bloque.text : '');
}

module.exports = { resumirConversacion, recortar255 };
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/anthropic-resumen.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/config/env.js src/integrations/anthropic/resumen.js test/anthropic-resumen.test.js
git commit -m "feat(anthropic): módulo aislado de resumen con Claude Haiku"
```

---

## Task 4: `insertarGestion` (solo INSERT) en previsión

**Files:**
- Modify: `src/integrations/prevision/cliente.js`

**Interfaces:**
- Consumes: pool de `olivosct` (ya existente en el módulo).
- Produces: `insertarGestion({ numPlan, concepto, novedad, tramito }) → Promise<{insertId}>`. Valida `concepto ∈ conceptos_permitidos` (lanza `Error` con `codigo:'concepto_invalido'`); recorta `novedad` a 255; **no** toca `plan`. Reutilizada por Task 5.

- [ ] **Step 1: Escribir `insertarGestion`**

In `src/integrations/prevision/cliente.js`, add this function after `registrarGestion` (before `module.exports`):

```js
/**
 * Registro histórico de gestión SIN tocar `plan` (solo INSERT). Se usa para el
 * resumen de difusiones: valida el concepto contra conceptos_permitidos y recorta
 * la novedad a 255. No hay UPDATE de plan (decisión del flujo de resumen).
 */
async function insertarGestion({ numPlan, concepto, novedad, tramito }) {
  const p = obtenerPool();
  if (!p) { const e = new Error('previsión no configurada'); e.codigo = 'no_configurado'; throw e; }
  const conc = String(concepto);
  const nov = String(novedad || '').slice(0, 255);
  const [cp] = await p.query('SELECT 1 FROM conceptos_permitidos WHERE codigo_concepto = ? LIMIT 1', [conc]);
  if (!cp.length) { const e = new Error('concepto no permitido'); e.codigo = 'concepto_invalido'; throw e; }
  const [r] = await p.query(
    'INSERT INTO gestion (num_plan, novedad, fecha, hora, concepto, tramito) VALUES (?, ?, CURDATE(), CURTIME(), ?, ?)',
    [numPlan, nov, conc, tramito],
  );
  return { insertId: r.insertId };
}
```

- [ ] **Step 2: Exportarla**

In the `module.exports` of `src/integrations/prevision/cliente.js`, add `insertarGestion`:

```js
module.exports = { consultarPlanesPorDocumento, decidirMasivo, debeRegistrarGestion, listarConceptosPermitidos, listarEstadosPlan, registrarGestion, insertarGestion };
```

- [ ] **Step 3: Verificar que el módulo carga y expone la función**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x \
ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t \
WEBHOOK_SECRET=x LOG_LEVEL=warn node -e "console.log(typeof require('./src/integrations/prevision/cliente').insertarGestion)"
```
Expected: `function`
(La escritura real en `gestion` se verifica en vivo en el despliegue; no hay test unitario porque toca la BD externa `olivosct`, igual que `registrarGestion`.)

- [ ] **Step 4: Commit**

```bash
git add src/integrations/prevision/cliente.js
git commit -m "feat(prevision): insertarGestion (solo INSERT, valida concepto)"
```

---

## Task 5: Servicio de resumen de difusiones

**Files:**
- Create: `src/services/resumenDifusiones.js`
- Test: `test/resumen-difusiones-servicio.test.js`

**Interfaces:**
- Consumes: `resumirConversacion` (Task 3), `consultarPlanesPorDocumento` + `insertarGestion` (Task 4), modelos y `wa_mensajes`.
- Produces:
  - `construirTextoConversacion(destId) → Promise<{ texto, huboRespuesta }>`
  - `siguientePendiente(hoyISO) → Promise<row|null>` (row: `{ id, documento }`)
  - `marcarResumido(destId) → Promise<void>`
  - `procesarPendiente(dest, deps?) → Promise<'resumido'|'sin-plan'>` — orquesta; lanza `concepto_invalido`/`no_configurado`/error de IA hacia arriba (el worker decide). `deps` inyecta `construirTexto`, `resumir`, `consultarPlanes`, `insertarGestion`, `marcar` para test.

- [ ] **Step 1: Escribir los tests del servicio (con deps inyectadas)**

Create `test/resumen-difusiones-servicio.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { procesarPendiente } = require('../src/services/resumenDifusiones');

function deps(over = {}) {
  const calls = { insert: [], marcar: [], resumir: 0 };
  const base = {
    construirTexto: async () => ({ texto: 'Enviado: x\nCliente: pago el viernes', huboRespuesta: true }),
    resumir: async () => { calls.resumir++; return 'Cliente pagará el viernes.'; },
    consultarPlanes: async () => [{ num_plan: 111 }],
    insertarGestion: async (g) => { calls.insert.push(g); },
    marcar: async (id) => { calls.marcar.push(id); },
  };
  return { d: { ...base, ...over }, calls };
}

test('con respuesta: resume, inserta gestión (concepto 49, tramito IA) y marca', async () => {
  const { d, calls } = deps();
  const r = await procesarPendiente({ id: 7, documento: '88123456' }, d);
  assert.equal(r, 'resumido');
  assert.equal(calls.resumir, 1);
  assert.deepEqual(calls.insert[0], { numPlan: 111, concepto: '49', novedad: 'Cliente pagará el viernes.', tramito: 'IA' });
  assert.deepEqual(calls.marcar, [7]);
});

test('sin respuesta: no llama a la IA, novedad "Sin respuesta del cliente"', async () => {
  const { d, calls } = deps({ construirTexto: async () => ({ texto: '', huboRespuesta: false }) });
  const r = await procesarPendiente({ id: 8, documento: '88123456' }, d);
  assert.equal(r, 'resumido');
  assert.equal(calls.resumir, 0);
  assert.equal(calls.insert[0].novedad, 'Sin respuesta del cliente');
});

test('sin plan para la cédula: marca y no inserta', async () => {
  const { d, calls } = deps({ consultarPlanes: async () => [] });
  const r = await procesarPendiente({ id: 9, documento: '000' }, d);
  assert.equal(r, 'sin-plan');
  assert.equal(calls.insert.length, 0);
  assert.deepEqual(calls.marcar, [9]);
});

test('concepto inválido: propaga el error y NO marca', async () => {
  const { d, calls } = deps({ insertarGestion: async () => { const e = new Error('concepto no permitido'); e.codigo = 'concepto_invalido'; throw e; } });
  await assert.rejects(() => procesarPendiente({ id: 10, documento: '88123456' }, d), /concepto/);
  assert.equal(calls.marcar.length, 0);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/resumen-difusiones-servicio.test.js`
Expected: FAIL — `Cannot find module '../src/services/resumenDifusiones'`.

- [ ] **Step 3: Escribir el servicio**

Create `src/services/resumenDifusiones.js`:

```js
'use strict';
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { DifusionDestinatario } = require('../models');
const { resumirConversacion } = require('../integrations/anthropic/resumen');
const { consultarPlanesPorDocumento, insertarGestion } = require('../integrations/prevision/cliente');

const CONCEPTO_WHATSAPP = '49';
const TRAMITO_IA = 'IA';
const SIN_RESPUESTA = 'Sin respuesta del cliente';

/**
 * Arma el texto de la conversación de un destinatario: el mensaje saliente de la
 * plantilla + las respuestas ENTRANTES del cliente posteriores al envío. Los
 * no-texto se representan por su tipo (no traen cuerpo útil para el resumen).
 */
async function construirTextoConversacion(destId) {
  const [env] = await sequelize.query(
    `SELECT env.texto AS textoEnviado, env.ts_proveedor AS tsEnviado, env.conversacion_id AS convId
       FROM wa_difusion_destinatarios dd
       JOIN wa_mensajes env ON env.wa_message_id = dd.wa_message_id
      WHERE dd.id = :id`,
    { type: QueryTypes.SELECT, replacements: { id: destId } },
  );
  if (!env) return { texto: '', huboRespuesta: false };
  const entrantes = await sequelize.query(
    `SELECT texto, tipo FROM wa_mensajes
      WHERE conversacion_id = :conv AND direccion = 'in' AND ts_proveedor > :ts
      ORDER BY ts_proveedor ASC`,
    { type: QueryTypes.SELECT, replacements: { conv: env.convId, ts: env.tsEnviado } },
  );
  const lineas = [`Mensaje enviado por la empresa: ${env.textoEnviado || ''}`];
  if (entrantes.length) {
    lineas.push('Respuestas del cliente:');
    for (const m of entrantes) {
      lineas.push(`- ${m.tipo === 'texto' ? (m.texto || '') : `[${m.tipo}]`}`);
    }
  }
  return { texto: lineas.join('\n'), huboRespuesta: entrantes.length > 0 };
}

/**
 * Próximo destinatario a resumir: de difusiones con requiere_resumen=1 y
 * finalizadas, enviado, con cédula y sin resumir todavía (resumen_en IS NULL).
 */
async function siguientePendiente() {
  const [row] = await sequelize.query(
    `SELECT dd.id, dd.documento
       FROM wa_difusion_destinatarios dd
       JOIN wa_difusiones d ON d.id = dd.difusion_id
      WHERE d.requiere_resumen = 1 AND d.estado = 'finalizada'
        AND dd.resumen_en IS NULL AND dd.documento IS NOT NULL
        AND dd.estado IN ('enviado','entregado','leido')
      ORDER BY dd.id ASC LIMIT 1`,
    { type: QueryTypes.SELECT },
  );
  return row || null;
}

async function marcarResumido(destId) {
  await DifusionDestinatario.update({ resumenEn: new Date() }, { where: { id: destId } });
}

/**
 * Procesa un destinatario: arma el texto, resume (o "Sin respuesta"), mapea la
 * cédula al primer plan e inserta la gestión; marca resumen_en (idempotencia).
 * Los errores de config/IA/gestión se propagan; el worker decide si marcar.
 */
async function procesarPendiente(dest, deps = {}) {
  const construir = deps.construirTexto || construirTextoConversacion;
  const resumir = deps.resumir || resumirConversacion;
  const planes = deps.consultarPlanes || consultarPlanesPorDocumento;
  const insertar = deps.insertarGestion || insertarGestion;
  const marcar = deps.marcar || marcarResumido;

  const { texto, huboRespuesta } = await construir(dest.id);
  const novedad = huboRespuesta ? await resumir(texto) : SIN_RESPUESTA;

  const filas = await planes(dest.documento);
  if (!filas.length) { await marcar(dest.id); return 'sin-plan'; }
  const numPlan = filas[0].num_plan;

  await insertar({ numPlan, concepto: CONCEPTO_WHATSAPP, novedad, tramito: TRAMITO_IA });
  await marcar(dest.id);
  return 'resumido';
}

module.exports = { construirTextoConversacion, siguientePendiente, marcarResumido, procesarPendiente };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/resumen-difusiones-servicio.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/resumenDifusiones.js test/resumen-difusiones-servicio.test.js
git commit -m "feat(difusiones): servicio de resumen (texto de conversación + gestión)"
```

---

## Task 6: Worker de resumen (loop diario) + arranque

**Files:**
- Create: `src/workers/resumenDifusiones.js`
- Modify: `src/workers/index.js`
- Test: `test/resumen-difusiones-worker.test.js`

**Interfaces:**
- Consumes: `siguientePendiente`, `procesarPendiente`, `marcarResumido` (Task 5).
- Produces: `esHoraDeResumen(fecha) → bool` (hora Colombia ≥ 19); `tick(ahora, deps?) → Promise<estado>` con estados `'fuera-hora' | 'nada' | 'resumido' | 'sin-plan' | 'error-config' | 'fallo'`; `iniciarLoop()`.

- [ ] **Step 1: Escribir los tests del worker**

Create `test/resumen-difusiones-worker.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tick, esHoraDeResumen } = require('../src/workers/resumenDifusiones');

// 2026-08-08 12:00 UTC = 07:00 Colombia (antes de las 19); 2026-08-08 00:30 UTC = 19:30 del día 7.
test('esHoraDeResumen: verdadero solo desde las 19:00 hora Colombia', () => {
  assert.equal(esHoraDeResumen(new Date('2026-08-08T12:00:00Z')), false); // 07:00 CO
  assert.equal(esHoraDeResumen(new Date('2026-08-09T00:30:00Z')), true);  // 19:30 CO
});

function deps(over = {}) {
  return { esHora: () => true, siguiente: async () => null, procesar: async () => 'resumido', marcar: async () => {}, ...over };
}

test('fuera de hora → fuera-hora, no consulta pendientes', async () => {
  let visto = 0;
  const d = deps({ esHora: () => false, siguiente: async () => { visto++; return null; } });
  assert.equal(await tick(new Date(), d), 'fuera-hora');
  assert.equal(visto, 0);
});
test('sin pendientes → nada', async () => {
  assert.equal(await tick(new Date(), deps({ siguiente: async () => null })), 'nada');
});
test('procesa un pendiente → devuelve el resultado del servicio', async () => {
  const d = deps({ siguiente: async () => ({ id: 1, documento: '9' }), procesar: async () => 'resumido' });
  assert.equal(await tick(new Date(), d), 'resumido');
});
test('concepto inválido → error-config, NO marca', async () => {
  let marcado = 0;
  const d = deps({
    siguiente: async () => ({ id: 1, documento: '9' }),
    procesar: async () => { const e = new Error('concepto no permitido'); e.codigo = 'concepto_invalido'; throw e; },
    marcar: async () => { marcado++; },
  });
  assert.equal(await tick(new Date(), d), 'error-config');
  assert.equal(marcado, 0);
});
test('fallo de IA/gestión → fallo, marca para no bloquear', async () => {
  let marcado = 0;
  const d = deps({
    siguiente: async () => ({ id: 1, documento: '9' }),
    procesar: async () => { throw new Error('timeout IA'); },
    marcar: async (id) => { marcado = id; },
  });
  assert.equal(await tick(new Date(), d), 'fallo');
  assert.equal(marcado, 1);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/resumen-difusiones-worker.test.js`
Expected: FAIL — `Cannot find module '../src/workers/resumenDifusiones'`.

- [ ] **Step 3: Escribir el worker**

Create `src/workers/resumenDifusiones.js`:

```js
'use strict';
const servicio = require('../services/resumenDifusiones');
const logger = require('../utils/logger');

const HORA_INICIO = 19;      // a partir de las 19:00 hora Colombia
const ESPERA_ENTRE_MS = 1500; // ritmo suave entre llamadas a la IA
const ESPERA_OCIO_MS = 60000; // fuera de hora / sin pendientes / error de config

/** Hora de pared de Colombia (UTC-5) ≥ 19:00. */
function esHoraDeResumen(fecha) {
  const bogota = new Date(fecha.getTime() - 5 * 3600 * 1000);
  return bogota.getUTCHours() >= HORA_INICIO;
}

/** Un paso del barrido. deps inyectable para test. Devuelve qué hizo. */
async function tick(ahora, deps = {}) {
  const esHora = deps.esHora || esHoraDeResumen;
  const siguiente = deps.siguiente || servicio.siguientePendiente;
  const procesar = deps.procesar || servicio.procesarPendiente;
  const marcar = deps.marcar || servicio.marcarResumido;

  if (!esHora(ahora)) return 'fuera-hora';
  const dest = await siguiente();
  if (!dest) return 'nada';
  try {
    return await procesar(dest);
  } catch (err) {
    // Config global (concepto 49 ausente / API key ausente): NO marcar; se resolverá
    // al configurar y se reintentará. No quemamos destinatarios por un error global.
    if (err.codigo === 'concepto_invalido' || err.codigo === 'no_configurado') {
      logger.error(`resumen difusiones: config — ${err.message}`);
      return 'error-config';
    }
    // Fallo por-destinatario (IA/gestión, ya reintentado por el SDK): marcar para no
    // bloquear la cola ni reintentar infinito (decisión del spec).
    logger.warn(`resumen difusiones dest ${dest.id}: ${err.message}; marcado para no bloquear`);
    try { await marcar(dest.id); } catch { /* si falla el marcado, se reintenta */ }
    return 'fallo';
  }
}

let corriendo = false;
async function iniciarLoop() {
  if (corriendo) return;
  corriendo = true;
  const paso = async () => {
    let espera = ESPERA_OCIO_MS;
    try {
      const r = await tick(new Date());
      if (r === 'resumido' || r === 'sin-plan' || r === 'fallo') espera = ESPERA_ENTRE_MS;
    } catch (err) {
      logger.error(`worker resumen difusiones: ${err.message}`);
    }
    if (corriendo) setTimeout(paso, espera);
  };
  paso();
}

module.exports = { esHoraDeResumen, tick, iniciarLoop };
```

- [ ] **Step 4: Arrancar el loop en el worker**

In `src/workers/index.js`, add the import next to the others:

```js
const { iniciarLoop: iniciarResumenDifusiones } = require('./resumenDifusiones');
```
and start it in `bootstrap`, right after `iniciarRecordatorios();`:

```js
  iniciarRecordatorios(); // idem: barrido diario de recordatorios, no lo bloquea
  iniciarResumenDifusiones(); // idem: barrido diario de resúmenes de difusión (~19:00), no lo bloquea
```

- [ ] **Step 5: Correr toda la suite backend**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS (sin regresiones; incluidos los tests de servicio y worker de resumen).

- [ ] **Step 6: Commit**

```bash
git add src/workers/resumenDifusiones.js src/workers/index.js test/resumen-difusiones-worker.test.js
git commit -m "feat(difusiones): worker diario de resumen (~19:00, ritmo suave)"
```

---

## Task 7: Frontend — check "Requiere resumen" + aviso CEDULA

**Files:**
- Modify: `frontend/src/utils/difusion.js`
- Modify: `frontend/src/components/DifusionWizard.vue`
- Test: `frontend/src/utils/difusion.test.js`

**Interfaces:**
- Consumes: `crearDifusion(datos)` (ya reenvía el objeto tal cual → `requiereResumen` viaja sin cambios en el store).
- Produces: `columnasRequeridas(mapeo, requiereResumen) → string[]` (puro, incluye `'CEDULA'` cuando `requiereResumen`).

- [ ] **Step 1: Escribir el test del helper de columnas**

In `frontend/src/utils/difusion.test.js`, add (ajusta el import existente si ya importa de `./difusion`):

```js
import { columnasRequeridas } from './difusion';

describe('columnasRequeridas', () => {
  const mapeo = { telefono: 'CELULAR', agente: 'AGENTE_ID', variables: [{ tipo: 'columna', columna: 'NOMBRE' }, { tipo: 'fijo', valor: '$1' }] };
  it('lista teléfono, agente y columnas de variables (sin duplicar)', () => {
    expect(columnasRequeridas(mapeo, false)).toEqual(['CELULAR', 'AGENTE_ID', 'NOMBRE']);
  });
  it('agrega CEDULA cuando requiere resumen', () => {
    expect(columnasRequeridas(mapeo, true)).toEqual(['CELULAR', 'AGENTE_ID', 'NOMBRE', 'CEDULA']);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm --prefix frontend test`
Expected: FAIL — `columnasRequeridas` no exportado.

- [ ] **Step 3: Escribir el helper puro**

In `frontend/src/utils/difusion.js`, add and export:

```js
// Columnas que el CSV debe traer, según el mapeo. Si la difusión requiere resumen,
// exige además la columna CEDULA (para mapear cada cliente a su plan de previsión).
export function columnasRequeridas(mapeo, requiereResumen) {
  const cols = [mapeo.telefono, mapeo.agente];
  (mapeo.variables || []).forEach((v) => { if (v.tipo === 'columna' && v.columna) cols.push(v.columna); });
  if (requiereResumen) cols.push('CEDULA');
  return [...new Set(cols)];
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm --prefix frontend test`
Expected: PASS

- [ ] **Step 5: Usar el helper y el check en el wizard**

In `frontend/src/components/DifusionWizard.vue`:

Import the helper (extend the existing import line):
```js
import { renderizarCuerpo, parsearCsvPreview, valorDeVariable, columnasRequeridas } from '../utils/difusion';
```

Add the ref next to the others (after `const imagenFile = ref(null);`):
```js
const requiereResumen = ref(false);
```

Replace the inline `columnasReq` computed with:
```js
const columnasReq = computed(() => columnasRequeridas(mapeo.value, requiereResumen.value));
```

Pass the flag when creating the campaign, in `crearYCargar`:
```js
      const dif = await acc.crearDifusion({ nombre: nombre.value, plantilla: plantillaNombre.value, requiereResumen: requiereResumen.value });
```

Add the checkbox + notice in the template, right after the Nombre `<div>` block (before the Plantilla block):
```html
        <div class="flex items-start gap-2">
          <input id="reqResumen" type="checkbox" v-model="requiereResumen" class="mt-0.5" />
          <label for="reqResumen" class="text-[12.5px] text-gray-700 leading-snug">
            Requiere resumen (registra la gestión en previsión al cierre del día)
            <span v-if="requiereResumen" class="block text-[11px] text-amber-600">El CSV debe incluir la columna <b>CEDULA</b>.</span>
          </label>
        </div>
```

- [ ] **Step 6: Build del frontend**

Run: `npm --prefix frontend run build`
Expected: build OK, sin errores.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/difusion.js frontend/src/utils/difusion.test.js frontend/src/components/DifusionWizard.vue
git commit -m "feat(difusiones): check Requiere resumen + aviso CEDULA en el asistente"
```

---

## Despliegue (tras merge)

1. Aplicar la migración 010 en producción:
```bash
ssh mantix 'cd ~/apps/wa && set -a && . ./.env && set +a && MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME" < docs/migraciones/010-resumen-difusiones.sql'
```
2. Poner `ANTHROPIC_API_KEY` en el `.env` del servidor (solo backend). Verificar que `conceptos_permitidos` contiene el código `49` **antes** de la primera corrida (si no, el worker devuelve `error-config` sin quemar destinatarios).
3. `ssh mantix 'cd ~/apps/wa && git pull --ff-only && npm ci && npm --prefix frontend run build && pm2 restart wa-backend wa-worker'`
   (`npm ci` por la nueva dependencia `@anthropic-ai/sdk`; reiniciar **wa-worker** porque cambió el worker.)
4. Verificar en vivo: crear una difusión de prueba con "Requiere resumen" + CSV con CEDULA, enviar, y tras las 19:00 confirmar la fila en `gestion` (concepto 49, tramito IA) y `resumen_en` marcado.
5. **Rotar la `ANTHROPIC_API_KEY`** una vez validado (memoria `rotar-anthropic-key`).
