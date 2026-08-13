# Gestionar con IA — borrador de respuesta (v1) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al marcar "Gestionar con IA" en un contacto, cuando el cliente escribe, el `wa-worker` genera con Claude Sonnet un **borrador** de respuesta (best-effort, nunca envía) que el agente ve en una tarjeta sobre el compositor y usa/edita/envía.

**Architecture:** Backend Node/Express/Sequelize + frontend Vue/Pinia. La ingesta ya emite `mensaje:nuevo`; el worker, para cada entrante, llama a un servicio `borradorIa` (aislado del módulo `anthropic/`) que arma el hilo, pide un borrador a Sonnet, lo guarda en la conversación y lo emite por socket. El frontend muestra la tarjeta y el agente decide.

**Tech Stack:** Node 20 CommonJS, Express, Sequelize/MySQL 8 (`wa_`), `@anthropic-ai/sdk` (Messages API, `claude-sonnet-5`), Vue 3 + Pinia + Vitest, Socket.io.

## Global Constraints

- **La IA NUNCA envía**: solo escribe `wa_conversaciones.borrador_ia`. El envío es 100% del agente por el flujo normal.
- **Regla de aislamiento**: solo `src/integrations/anthropic/` importa el SDK de Anthropic; `ANTHROPIC_API_KEY` solo en el `.env` server (`env.anthropic.apiKey`), nunca repo/frontend/logs.
- **Solo tablas `wa_`**; SQL parametrizado.
- **No bloquear la ingesta** (invariante 1): la generación del borrador va en try/catch best-effort en el worker; un fallo/latencia de Anthropic solo omite ese borrador y se loguea.
- Modelo **`claude-sonnet-5`**. Prompt de rol en `wa_ajustes` clave **`ia_gestion_prompt`** (editable sin desplegar; con default de código si falta).
- Solo se genera para contactos con `gestionar_con_ia=1`, sobre mensajes **entrantes** (`direccion='in'`).
- Un borrador por conversación: se **reemplaza** con cada nuevo entrante; se **limpia** al usar/descartar.
- Convenciones del repo: dominio en español / técnico en inglés; pinia option stores; logger con niveles; nunca tragar excepciones de integraciones.
- Migraciones 001–010 aplicadas; la siguiente es **011**.
- Test backend: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`. Frontend: `npm --prefix frontend test` (un archivo: `-- <ruta>`), build `npm --prefix frontend run build`.

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `docs/migraciones/011-gestion-ia.sql` | columnas + semilla del prompt | Crear |
| `src/models/Contacto.js` | campo `gestionarConIa` | Modificar |
| `src/models/Conversacion.js` | campos `borradorIa`, `borradorIaEn` | Modificar |
| `src/integrations/anthropic/responder.js` | llamada a Sonnet (aislada) | Crear |
| `src/services/borradorIa.js` | armar hilo, generar y guardar el borrador | Crear |
| `src/workers/index.js` | enganche: entrante → generar + emitir | Modificar |
| `src/controllers/contactosController.js` | `actualizar` acepta `gestionarConIa` | Modificar |
| `src/controllers/conversacionesController.js` | `mensajes` incluye `borradorIa`; nuevo `descartarBorrador` | Modificar |
| `src/controllers/ajustesController.js` | GET/PUT `ia_gestion_prompt` (admin) | Crear |
| `src/routes/api.js` | rutas nuevas | Modificar |
| `frontend/src/stores/acciones.js` | `gestionarConIa`, `descartarBorrador`, prompt IA | Modificar |
| `frontend/src/stores/chat.js` | cargar `borradorIa` al abrir | Modificar |
| `frontend/src/socket/cliente.js` | listener `conversacion:borrador` | Modificar |
| `frontend/src/components/PanelCliente.vue` | switch "Gestionar con IA" | Modificar |
| `frontend/src/components/Compositor.vue` | tarjeta de sugerencia | Modificar |
| `frontend/src/components/PanelPromptIa.vue` | editor admin del prompt | Crear |
| `frontend/src/views/Bandeja.vue` | ítem de menú admin "🤖 Prompt IA" | Modificar |

---

## Task 1: Migración 011 + campos de modelo

**Files:**
- Create: `docs/migraciones/011-gestion-ia.sql`
- Modify: `src/models/Contacto.js`
- Modify: `src/models/Conversacion.js`

**Interfaces:**
- Produces: `Contacto.gestionarConIa` (bool), `Conversacion.borradorIa` (string|null), `Conversacion.borradorIaEn` (Date|null); fila `wa_ajustes.ia_gestion_prompt`.

- [ ] **Step 1: Escribir la migración**

Create `docs/migraciones/011-gestion-ia.sql`:

```sql
-- Gestionar con IA: flag por contacto + borrador de respuesta por conversación.
ALTER TABLE wa_contactos
  ADD COLUMN gestionar_con_ia TINYINT(1) NOT NULL DEFAULT 0 AFTER compro;

ALTER TABLE wa_conversaciones
  ADD COLUMN borrador_ia TEXT NULL,
  ADD COLUMN borrador_ia_en DATETIME NULL;

-- Prompt de rol editable (sin desplegar). Semilla por defecto.
INSERT INTO wa_ajustes (clave, valor)
VALUES ('ia_gestion_prompt',
  'Eres un asistente de atención al cliente de Los Olivos Cúcuta (servicios exequiales y de cartera) que redacta, en español y en tono cordial y breve, una posible respuesta de la empresa al último mensaje del cliente en WhatsApp. No inventes datos concretos (saldos, fechas, montos) que no aparezcan en la conversación; si el cliente los pide, ofrece verificarlo. No hagas promesas ni compromisos en nombre de la empresa. Responde SOLO con el texto sugerido para enviar, sin preámbulos ni comillas.')
ON DUPLICATE KEY UPDATE clave = clave;
```

- [ ] **Step 2: Añadir el campo a `Contacto`**

In `src/models/Contacto.js`, add after the `compro` attribute:

```js
      gestionarConIa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
```

- [ ] **Step 3: Añadir los campos a `Conversacion`**

In `src/models/Conversacion.js`, add (near the other nullable columns, e.g. after `atendidaPorBot`):

```js
      borradorIa: { type: DataTypes.TEXT, allowNull: true },
      borradorIaEn: { type: DataTypes.DATE, allowNull: true },
```

- [ ] **Step 4: Verificar que los modelos cargan los campos**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node -e "const m=require('./src/models'); console.log(!!m.Contacto.rawAttributes.gestionarConIa, !!m.Conversacion.rawAttributes.borradorIa, !!m.Conversacion.rawAttributes.borradorIaEn)"
```
Expected: `true true true`

- [ ] **Step 5: Commit**

```bash
git add docs/migraciones/011-gestion-ia.sql src/models/Contacto.js src/models/Conversacion.js
git commit -m "feat(ia): migración 011 — gestionar_con_ia, borrador_ia, prompt en ajustes"
```

---

## Task 2: Módulo Anthropic `responder` (Sonnet)

**Files:**
- Create: `src/integrations/anthropic/responder.js`
- Test: `test/anthropic-responder.test.js`

**Interfaces:**
- Consumes: `env.anthropic.apiKey`.
- Produces: `responder(hilo, promptRol, deps?) → Promise<string>` (borrador recortado ≤600); `recortar600(s) → string`. `deps.cliente` inyecta un cliente falso para test.

- [ ] **Step 1: Escribir el test**

Create `test/anthropic-responder.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { responder, recortar600 } = require('../src/integrations/anthropic/responder');

test('recortar600 recorta y limpia', () => {
  assert.equal(recortar600('  hola  '), 'hola');
  assert.equal(recortar600('a'.repeat(800)).length, 600);
});

test('responder llama al SDK con Sonnet, el prompt como system y el hilo, y devuelve el texto', async () => {
  let args = null;
  const cliente = { messages: { create: async (a) => { args = a; return { content: [{ type: 'text', text: 'Con gusto, ¿en qué te ayudo?' }] }; } } };
  const r = await responder('Cliente: hola', 'Eres un asistente.', { cliente });
  assert.equal(r, 'Con gusto, ¿en qué te ayudo?');
  assert.equal(args.model, 'claude-sonnet-5');
  assert.equal(args.system, 'Eres un asistente.');
  assert.equal(args.messages[0].role, 'user');
  assert.equal(args.messages[0].content, 'Cliente: hola');
});

test('responder recorta a 600 y tolera respuesta sin bloque text', async () => {
  const largo = { messages: { create: async () => ({ content: [{ type: 'text', text: 'x'.repeat(800) }] }) } };
  assert.equal((await responder('t', 'p', { cliente: largo })).length, 600);
  const vacio = { messages: { create: async () => ({ content: [] }) } };
  assert.equal(await responder('t', 'p', { cliente: vacio }), '');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/anthropic-responder.test.js`
Expected: FAIL — `Cannot find module '../src/integrations/anthropic/responder'`.

- [ ] **Step 3: Escribir el módulo**

Create `src/integrations/anthropic/responder.js`:

```js
'use strict';

/**
 * Único punto (junto con resumen.js) que habla con Anthropic. Redacta un BORRADOR
 * de respuesta al cliente con Claude Sonnet; el agente lo revisa y envía (la IA
 * nunca envía). La ANTHROPIC_API_KEY vive solo en el .env del server.
 */

const Anthropic = require('@anthropic-ai/sdk');
const env = require('../../config/env');

const MODELO = 'claude-sonnet-5';
const MAX_TOKENS = 500;

let cliente = null;
function obtenerCliente() {
  if (!env.anthropic.apiKey) { const e = new Error('Anthropic no configurado'); e.codigo = 'no_configurado'; throw e; }
  if (!cliente) cliente = new Anthropic({ apiKey: env.anthropic.apiKey, maxRetries: 2 });
  return cliente;
}

/** Recorta a 600 y limpia espacios (el borrador es editable por el agente). */
function recortar600(s) { return String(s || '').trim().slice(0, 600); }

/** Redacta el borrador. deps.cliente inyecta un cliente falso para test. */
async function responder(hilo, promptRol, deps = {}) {
  const c = deps.cliente || obtenerCliente();
  const resp = await c.messages.create({
    model: MODELO,
    max_tokens: MAX_TOKENS,
    system: String(promptRol || ''),
    messages: [{ role: 'user', content: String(hilo || '') }],
  });
  const bloque = (resp.content || []).find((b) => b.type === 'text');
  return recortar600(bloque ? bloque.text : '');
}

module.exports = { responder, recortar600 };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/anthropic-responder.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/anthropic/responder.js test/anthropic-responder.test.js
git commit -m "feat(ia): módulo responder (borrador con Claude Sonnet)"
```

---

## Task 3: Servicio `borradorIa`

**Files:**
- Create: `src/services/borradorIa.js`
- Test: `test/borrador-ia.test.js`

**Interfaces:**
- Consumes: `responder` (Task 2), modelos `Conversacion`/`Contacto`/`Mensaje`/`Ajuste`, `wa_mensajes`.
- Produces:
  - `construirHilo(mensajes) → string` (puro: transcripción `Cliente:`/`Empresa:`, media → `[tipo]`).
  - `generarBorrador(conversacionId, deps?) → Promise<string|null>` — devuelve el borrador guardado, o `null` si el flag está apagado / no hay hilo / la IA no devolvió texto. Guarda `borrador_ia`/`borrador_ia_en` en la conversación. `deps` inyecta `cargarConversacion`, `cargarHilo`, `cargarPrompt`, `responder`, `guardar` para test.

- [ ] **Step 1: Escribir el test**

Create `test/borrador-ia.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { construirHilo, generarBorrador } = require('../src/services/borradorIa');

test('construirHilo etiqueta cliente/empresa y media', () => {
  const h = construirHilo([
    { direccion: 'in', tipo: 'text', texto: 'hola' },
    { direccion: 'out', tipo: 'text', texto: 'buenas' },
    { direccion: 'in', tipo: 'image', texto: null },
  ]);
  assert.match(h, /Cliente: hola/);
  assert.match(h, /Empresa: buenas/);
  assert.match(h, /Cliente: \[image\]/);
});

function deps(over = {}) {
  const calls = { guardado: [], responder: 0 };
  const base = {
    cargarConversacion: async () => ({ conv: { id: 5, agenteId: 9 }, contacto: { gestionarConIa: true } }),
    cargarHilo: async () => [{ direccion: 'in', tipo: 'text', texto: 'hola' }],
    cargarPrompt: async () => 'Eres un asistente.',
    responder: async () => { calls.responder++; return 'Hola, con gusto te ayudo.'; },
    guardar: async (id, b) => { calls.guardado.push([id, b]); },
  };
  return { d: { ...base, ...over }, calls };
}

test('genera y guarda el borrador cuando el flag está activo', async () => {
  const { d, calls } = deps();
  const r = await generarBorrador(5, d);
  assert.equal(r, 'Hola, con gusto te ayudo.');
  assert.equal(calls.responder, 1);
  assert.deepEqual(calls.guardado[0], [5, 'Hola, con gusto te ayudo.']);
});

test('no hace nada si el contacto no tiene el flag', async () => {
  const { d, calls } = deps({ cargarConversacion: async () => ({ conv: { id: 5 }, contacto: { gestionarConIa: false } }) });
  const r = await generarBorrador(5, d);
  assert.equal(r, null);
  assert.equal(calls.responder, 0);
  assert.equal(calls.guardado.length, 0);
});

test('no guarda si la IA no devuelve texto', async () => {
  const { d, calls } = deps({ responder: async () => '   ' });
  const r = await generarBorrador(5, d);
  assert.equal(r, null);
  assert.equal(calls.guardado.length, 0);
});

test('no hace nada si no hay hilo', async () => {
  const { d, calls } = deps({ cargarHilo: async () => [] });
  const r = await generarBorrador(5, d);
  assert.equal(r, null);
  assert.equal(calls.responder, 0);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/borrador-ia.test.js`
Expected: FAIL — `Cannot find module '../src/services/borradorIa'`.

- [ ] **Step 3: Escribir el servicio**

Create `src/services/borradorIa.js`:

```js
'use strict';
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { Conversacion, Contacto, Ajuste } = require('../models');
const { responder } = require('../integrations/anthropic/responder');
const { DIRECCION } = require('../config/constants');

const CLAVE_PROMPT = 'ia_gestion_prompt';
const MAX_HILO = 20;

const PROMPT_DEFAULT =
  'Eres un asistente de atención al cliente de Los Olivos Cúcuta que redacta, en ' +
  'español y en tono cordial y breve, una posible respuesta de la empresa al último ' +
  'mensaje del cliente en WhatsApp. No inventes datos concretos que no aparezcan en la ' +
  'conversación. No hagas promesas. Responde SOLO con el texto sugerido, sin comillas.';

/** Etiqueta un mensaje: usa el texto si lo hay, si no `[tipo]`. */
function cuerpoMensaje(m) {
  return m.texto && String(m.texto).trim() !== '' ? String(m.texto) : `[${m.tipo}]`;
}

/** Pura: transcripción del hilo (Cliente/Empresa) para el prompt. */
function construirHilo(mensajes) {
  return (mensajes || [])
    .map((m) => `${m.direccion === DIRECCION.IN ? 'Cliente' : 'Empresa'}: ${cuerpoMensaje(m)}`)
    .join('\n');
}

async function cargarConversacionConContacto(conversacionId) {
  const conv = await Conversacion.findByPk(conversacionId, { attributes: ['id', 'agenteId', 'contactoId'] });
  if (!conv) return null;
  const contacto = await Contacto.findByPk(conv.contactoId, { attributes: ['id', 'gestionarConIa'] });
  return { conv, contacto };
}

async function cargarHiloReciente(conversacionId) {
  const filas = await sequelize.query(
    `SELECT direccion, tipo, texto FROM wa_mensajes
      WHERE conversacion_id = :id ORDER BY ts_proveedor DESC, id DESC LIMIT :lim`,
    { type: QueryTypes.SELECT, replacements: { id: conversacionId, lim: MAX_HILO } },
  );
  return filas.reverse(); // cronológico ascendente
}

async function cargarPromptRol() {
  const fila = await Ajuste.findOne({ where: { clave: CLAVE_PROMPT } });
  const v = fila && String(fila.valor || '').trim();
  return v || PROMPT_DEFAULT;
}

async function guardarBorrador(conversacionId, borrador) {
  await Conversacion.update({ borradorIa: borrador, borradorIaEn: new Date() }, { where: { id: conversacionId } });
}

/**
 * Genera y guarda el borrador de respuesta de una conversación si su contacto tiene
 * `gestionar_con_ia`. Devuelve el borrador (string) o null. deps inyectable para test.
 */
async function generarBorrador(conversacionId, deps = {}) {
  const cargarConv = deps.cargarConversacion || cargarConversacionConContacto;
  const cargarHilo = deps.cargarHilo || cargarHiloReciente;
  const cargarPrompt = deps.cargarPrompt || cargarPromptRol;
  const responderIa = deps.responder || responder;
  const guardar = deps.guardar || guardarBorrador;

  const cc = await cargarConv(conversacionId);
  if (!cc || !cc.contacto || !cc.contacto.gestionarConIa) return null;
  const mensajes = await cargarHilo(conversacionId);
  if (!mensajes.length) return null;
  const borrador = await responderIa(construirHilo(mensajes), await cargarPrompt());
  if (!borrador || !borrador.trim()) return null;
  await guardar(conversacionId, borrador);
  return borrador;
}

module.exports = { construirHilo, generarBorrador };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/borrador-ia.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Correr la suite completa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS (sin regresiones)

- [ ] **Step 6: Commit**

```bash
git add src/services/borradorIa.js test/borrador-ia.test.js
git commit -m "feat(ia): servicio borradorIa (arma el hilo, genera y guarda el borrador)"
```

---

## Task 4: Enganche en el worker

**Files:**
- Modify: `src/workers/index.js`

**Interfaces:**
- Consumes: `generarBorrador` (Task 3); el bucle ya recorre `resumen.eventosSocket` y llama `avisarSocket`.
- Produces: por cada `mensaje:nuevo` entrante, genera el borrador y emite `conversacion:borrador` a la misma sala (best-effort).

- [ ] **Step 1: Importar el servicio**

In `src/workers/index.js`, add the import near the others (e.g. after `iniciarRecordatorios`):

```js
const { generarBorrador } = require('../services/borradorIa');
```

- [ ] **Step 2: Enganchar tras emitir los eventos**

In `src/workers/index.js`, inside `procesarLote`, right after the existing loop
`for (const ev of resumen.eventosSocket) await avisarSocket(ev);`, add:

```js
        // Borrador IA: por cada entrante, generar sugerencia (best-effort, no bloquea la cola).
        for (const ev of resumen.eventosSocket) {
          if (ev.evento === 'mensaje:nuevo' && ev.payload?.mensaje?.direccion === 'in') {
            try {
              const borrador = await generarBorrador(ev.payload.conversacionId);
              if (borrador) {
                await avisarSocket({ evento: 'conversacion:borrador', destino: ev.destino, payload: { conversacionId: ev.payload.conversacionId, borrador } });
              }
            } catch (e) {
              logger.warn(`borrador IA conv ${ev.payload.conversacionId}: ${e.message}`);
            }
          }
        }
```

- [ ] **Step 3: Verificar que el módulo del worker parsea/carga**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/workers/index.js && node -e "require('./src/services/borradorIa'); console.log('carga OK')"
```
Expected: `carga OK` (sin errores de sintaxis; `index.js` conecta a BD al requerirse, por eso solo `--check`).

- [ ] **Step 4: Correr la suite completa (sin regresiones)**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workers/index.js
git commit -m "feat(ia): el worker genera y emite el borrador en cada entrante"
```

---

## Task 5: Endpoints backend (flag, descartar, borradorIa, prompt)

**Files:**
- Modify: `src/controllers/contactosController.js`
- Modify: `src/controllers/conversacionesController.js`
- Create: `src/controllers/ajustesController.js`
- Modify: `src/routes/api.js`
- Test: `test/ajustes-controller.test.js`

**Interfaces:**
- Produces: `PATCH /contactos/:id` acepta `gestionarConIa`; `DELETE /conversaciones/:id/borrador`; `GET /conversaciones/:id/mensajes` incluye `borradorIa`; `GET`/`PUT /ajustes/ia-gestion-prompt` (admin).

- [ ] **Step 1: `PATCH /contactos/:id` acepta `gestionarConIa`**

In `src/controllers/contactosController.js`, in `actualizar`, after the `compro` block (before `try`), add:

```js
  if (body.gestionarConIa !== undefined) cambios.gestionarConIa = !!body.gestionarConIa;
```
and in the `res.json({ contacto: {...} })` response object, add:
```js
        gestionarConIa: contacto.gestionarConIa,
```

- [ ] **Step 2: `mensajes` incluye `borradorIa` + nuevo `descartarBorrador`**

In `src/controllers/conversacionesController.js`, in `mensajes`, change the final response to include the draft (the conversation `conv` is already loaded by `accesible`):

```js
    return res.json({ mensajes: filas.reverse(), borradorIa: conv.borradorIa || null });
```

Add a new handler (near `noLeido`):

```js
/** DELETE /api/conversaciones/:id/borrador — limpia el borrador de IA. */
async function descartarBorrador(req, res) {
  const conv = await accesible(req, res);
  if (!conv) return undefined;
  await conv.update({ borradorIa: null, borradorIaEn: null });
  return res.json({ ok: true });
}
```
and add `descartarBorrador` to `module.exports`.

- [ ] **Step 3: Controlador de ajustes (prompt IA, admin)**

Create `src/controllers/ajustesController.js`:

```js
'use strict';
const { Ajuste } = require('../models');
const logger = require('../utils/logger');

const CLAVE_PROMPT = 'ia_gestion_prompt';

/** GET /api/ajustes/ia-gestion-prompt — devuelve el prompt de rol de la IA. */
async function obtenerPromptIa(req, res) {
  try {
    const fila = await Ajuste.findOne({ where: { clave: CLAVE_PROMPT } });
    return res.json({ prompt: fila ? fila.valor : '' });
  } catch (err) {
    logger.error(`obtener prompt IA: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

/** PUT /api/ajustes/ia-gestion-prompt — actualiza el prompt (admin). */
async function guardarPromptIa(req, res) {
  const valor = String((req.body && req.body.prompt) || '').trim();
  if (!valor) return res.status(422).json({ error: 'el prompt no puede estar vacío' });
  try {
    const [fila, creada] = await Ajuste.findOrCreate({ where: { clave: CLAVE_PROMPT }, defaults: { clave: CLAVE_PROMPT, valor } });
    if (!creada) await fila.update({ valor });
    return res.json({ prompt: valor });
  } catch (err) {
    logger.error(`guardar prompt IA: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { obtenerPromptIa, guardarPromptIa };
```

- [ ] **Step 4: Rutas**

In `src/routes/api.js`, add near the other routes (reuse the existing `requireAuth`/`requireAdmin` imports):

```js
const ajustesCtrl = require('../controllers/ajustesController');
```
and, with the conversaciones/ajustes routes:
```js
router.delete('/conversaciones/:id/borrador', requireAuth, convCtrl.descartarBorrador);
router.get('/ajustes/ia-gestion-prompt', requireAuth, requireAdmin, ajustesCtrl.obtenerPromptIa);
router.put('/ajustes/ia-gestion-prompt', requireAuth, requireAdmin, ajustesCtrl.guardarPromptIa);
```

- [ ] **Step 5: Test del controlador de ajustes**

Create `test/ajustes-controller.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guardarPromptIa } = require('../src/controllers/ajustesController');

function resFalso() {
  return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test('guardarPromptIa rechaza prompt vacío con 422', async () => {
  const res = resFalso();
  await guardarPromptIa({ body: { prompt: '   ' } }, res);
  assert.equal(res.code, 422);
});
```

- [ ] **Step 6: Correr el test y la suite**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS (incluye el test nuevo; sin regresiones).

- [ ] **Step 7: Commit**

```bash
git add src/controllers/contactosController.js src/controllers/conversacionesController.js src/controllers/ajustesController.js src/routes/api.js test/ajustes-controller.test.js
git commit -m "feat(ia): endpoints — flag gestionarConIa, descartar borrador, prompt admin"
```

---

## Task 6: Frontend — switch en el panel + acciones + editor del prompt

**Files:**
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/components/PanelCliente.vue`
- Create: `frontend/src/components/PanelPromptIa.vue`
- Modify: `frontend/src/views/Bandeja.vue`
- Test: `frontend/src/stores/acciones.gestionia.test.js`

**Interfaces:**
- Consumes: `apiFetch`.
- Produces: acciones `gestionarConIa(contactoId, on)`, `descartarBorrador(convId)`, `obtenerPromptIa()`, `guardarPromptIa(texto)`.

- [ ] **Step 1: Escribir el test de las acciones**

Create `frontend/src/stores/acciones.gestionia.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const fetchMock = vi.fn();
vi.mock('../api/cliente', () => ({ apiFetch: (...a) => fetchMock(...a), tokenGuardado: () => 't' }));

import { useAcciones } from './acciones';

describe('acciones gestión IA', () => {
  beforeEach(() => { setActivePinia(createPinia()); fetchMock.mockReset(); });

  it('gestionarConIa hace PATCH del flag', async () => {
    fetchMock.mockResolvedValue({ contacto: { id: 3, gestionarConIa: true } });
    const acc = useAcciones();
    await acc.gestionarConIa(3, true);
    expect(fetchMock).toHaveBeenCalledWith('/contactos/3', { method: 'PATCH', body: JSON.stringify({ gestionarConIa: true }) });
  });

  it('descartarBorrador hace DELETE', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const acc = useAcciones();
    await acc.descartarBorrador(9);
    expect(fetchMock).toHaveBeenCalledWith('/conversaciones/9/borrador', { method: 'DELETE' });
  });

  it('guardarPromptIa hace PUT', async () => {
    fetchMock.mockResolvedValue({ prompt: 'nuevo' });
    const acc = useAcciones();
    const r = await acc.guardarPromptIa('nuevo');
    expect(fetchMock).toHaveBeenCalledWith('/ajustes/ia-gestion-prompt', { method: 'PUT', body: JSON.stringify({ prompt: 'nuevo' }) });
    expect(r).toBe('nuevo');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm --prefix frontend test -- src/stores/acciones.gestionia.test.js`
Expected: FAIL — acciones no existen.

- [ ] **Step 3: Añadir las acciones**

In `frontend/src/stores/acciones.js`, add these actions (near `editarNombre`):

```js
    async gestionarConIa(contactoId, on) {
      const r = await apiFetch(`/contactos/${contactoId}`, { method: 'PATCH', body: JSON.stringify({ gestionarConIa: !!on }) });
      return r.contacto;
    },
    async descartarBorrador(convId) {
      return apiFetch(`/conversaciones/${convId}/borrador`, { method: 'DELETE' });
    },
    async obtenerPromptIa() {
      return (await apiFetch('/ajustes/ia-gestion-prompt')).prompt;
    },
    async guardarPromptIa(texto) {
      return (await apiFetch('/ajustes/ia-gestion-prompt', { method: 'PUT', body: JSON.stringify({ prompt: texto }) })).prompt;
    },
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm --prefix frontend test -- src/stores/acciones.gestionia.test.js`
Expected: PASS

- [ ] **Step 5: Switch "Gestionar con IA" en PanelCliente**

In `frontend/src/components/PanelCliente.vue`, add a switch that reflects `contacto.gestionarConIa` and calls the action. Place it near the other contact toggles (e.g. cerca de "¿Compró?"). Use the existing `acc`/contact object of the component; example markup:

```html
        <div class="flex items-center justify-between py-1">
          <span class="text-[12.5px] text-gray-700">Gestionar con IA</span>
          <input type="checkbox" :checked="!!contacto.gestionarConIa"
            @change="alternarGestionIa($event.target.checked)" />
        </div>
```
and in the script, add the handler (adapt to how the component references the contact + store):
```js
async function alternarGestionIa(on) {
  const c = await acc.gestionarConIa(contacto.value.id, on);
  contacto.value.gestionarConIa = c.gestionarConIa;
}
```

- [ ] **Step 6: Editor admin del prompt**

Create `frontend/src/components/PanelPromptIa.vue`:

```html
<script setup>
import { ref, onMounted } from 'vue';
import { useAcciones } from '../stores/acciones';
const emit = defineEmits(['cerrar']);
const acc = useAcciones();
const texto = ref('');
const guardando = ref(false);
const error = ref('');
onMounted(async () => { try { texto.value = await acc.obtenerPromptIa(); } catch { error.value = 'No se pudo cargar.'; } });
async function guardar() {
  error.value = ''; guardando.value = true;
  try { await acc.guardarPromptIa(texto.value); emit('cerrar'); }
  catch (e) { error.value = e.message || 'No se pudo guardar.'; }
  finally { guardando.value = false; }
}
</script>
<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-2xl flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Prompt de la IA (rol para los borradores)</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>
      <div class="p-4 space-y-2">
        <textarea v-model="texto" rows="10" class="w-full border rounded px-2 py-1.5 text-[13px]"></textarea>
        <p v-if="error" class="text-[12px] text-red-600">{{ error }}</p>
      </div>
      <div class="border-t px-4 py-3 flex justify-end gap-2">
        <button class="px-3 py-1.5 text-[13px] text-gray-500" @click="emit('cerrar')">Cancelar</button>
        <button :disabled="guardando || !texto.trim()" class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px] disabled:opacity-60" @click="guardar">
          {{ guardando ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
    </div>
  </div>
</template>
```

Wire it in `frontend/src/views/Bandeja.vue`: import it, add a ref `mostrarPromptIa` (default false), an admin menu item, and render the modal:
```html
          <button v-if="auth.esAdministrador" class="w-full text-left px-3 py-2 hover:bg-gray-50"
            @click="menuAbierto = false; mostrarPromptIa = true">🤖 Prompt IA</button>
```
```html
    <PanelPromptIa v-if="mostrarPromptIa" @cerrar="mostrarPromptIa = false" />
```
(añade `import PanelPromptIa from '../components/PanelPromptIa.vue';` y `const mostrarPromptIa = ref(false);`).

- [ ] **Step 7: Test frontend + build**

Run: `npm --prefix frontend test` (todo verde) y `npm --prefix frontend run build` (OK).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/stores/acciones.js frontend/src/stores/acciones.gestionia.test.js frontend/src/components/PanelCliente.vue frontend/src/components/PanelPromptIa.vue frontend/src/views/Bandeja.vue
git commit -m "feat(ia): switch gestionar con IA + acciones + editor del prompt (admin)"
```

---

## Task 7: Frontend — tarjeta de sugerencia en el compositor

**Files:**
- Modify: `frontend/src/stores/chat.js`
- Modify: `frontend/src/socket/cliente.js`
- Modify: `frontend/src/components/Compositor.vue`

**Interfaces:**
- Consumes: `descartarBorrador` (Task 6); `chat.conversacion.borradorIa`.
- Produces: la conversación abierta lleva `borradorIa`; llega en vivo por socket; la tarjeta permite "Usar y editar" / "Descartar".

- [ ] **Step 1: Cargar `borradorIa` al abrir el chat**

In `frontend/src/stores/chat.js`, in `abrir`, after `this.mensajes = r.mensajes;` (donde se procesa la respuesta de `/mensajes`), set the draft on the open conversation:

```js
        this.mensajes = r.mensajes;
        if (this.conversacion && this.conversacion.id === id) this.conversacion.borradorIa = r.borradorIa || null;
```

- [ ] **Step 2: Listener de socket para el borrador en vivo**

In `frontend/src/socket/cliente.js`, add after the `mensaje:nuevo` handler:

```js
  socket.on('conversacion:borrador', ({ conversacionId, borrador }) => {
    const chat = useChat();
    if (chat.conversacion && chat.conversacion.id === conversacionId) chat.conversacion.borradorIa = borrador;
  });
```

- [ ] **Step 3: Tarjeta en el compositor**

In `frontend/src/components/Compositor.vue`, add the suggestion card ABOVE the input row. It reads `chat.conversacion?.borradorIa`; "Usar y editar" writes into the composer's `texto` ref and clears the draft; "Descartar" clears it. Add to the template (encima de la fila del `<input v-model="texto" ...>`):

```html
    <div v-if="chat.conversacion?.borradorIa" class="mb-2 border border-marca/30 bg-marca/5 rounded p-2 text-[12.5px]">
      <div class="text-[11px] text-marca-oscuro uppercase mb-1">💡 Sugerencia IA</div>
      <div class="text-gray-800 whitespace-pre-wrap">{{ chat.conversacion.borradorIa }}</div>
      <div class="flex gap-2 mt-2">
        <button class="text-[12px] bg-marca text-white rounded px-2 py-1" @click="usarBorrador">Usar y editar</button>
        <button class="text-[12px] text-gray-500 px-2 py-1" @click="descartarBorrador">Descartar</button>
      </div>
    </div>
```
and in the script:
```js
async function usarBorrador() {
  texto.value = chat.conversacion.borradorIa;
  const id = chat.conversacion.id;
  chat.conversacion.borradorIa = null;
  try { await acc.descartarBorrador(id); } catch { /* no crítico */ }
}
async function descartarBorrador() {
  const id = chat.conversacion.id;
  chat.conversacion.borradorIa = null;
  try { await acc.descartarBorrador(id); } catch { /* no crítico */ }
}
```
(el componente ya tiene `chat` y `acc` en scope — reúsalos; `texto` es el `ref('')` del input.)

- [ ] **Step 4: Limpiar el borrador al enviar**

In `frontend/src/components/Compositor.vue`, in `enviar()`, after a successful send, clear any pending draft so no queda una sugerencia vieja:

```js
  if (chat.conversacion?.borradorIa) {
    const id = chat.conversacion.id;
    chat.conversacion.borradorIa = null;
    acc.descartarBorrador(id).catch(() => {});
  }
```
(colócalo tras `await chat.enviar(t);`).

- [ ] **Step 5: Test frontend + build**

Run: `npm --prefix frontend test` (todo verde) y `npm --prefix frontend run build` (OK).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stores/chat.js frontend/src/socket/cliente.js frontend/src/components/Compositor.vue
git commit -m "feat(ia): tarjeta de sugerencia en el compositor (usar/descartar) + socket"
```

---

## Despliegue (tras merge)

1. Migración 011:
```bash
ssh mantix 'cd ~/apps/wa && set -a && . ./.env && set +a && MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME" < docs/migraciones/011-gestion-ia.sql'
```
2. Deploy (build frontend + reiniciar backend y worker; la `ANTHROPIC_API_KEY` ya está en el `.env`):
```bash
ssh mantix 'cd ~/apps/wa && git pull --ff-only && npm ci && npm --prefix frontend run build && pm2 restart wa-backend wa-worker'
```
3. Verificación en vivo (usuario): marcar un contacto con "Gestionar con IA"; escribirle desde otro WhatsApp; abrir el chat (o tenerlo abierto) y ver la tarjeta con la sugerencia; "Usar y editar" → editar → enviar; confirmar que la tarjeta desaparece. Admin: menú → "🤖 Prompt IA" → ajustar el tono y guardar.
