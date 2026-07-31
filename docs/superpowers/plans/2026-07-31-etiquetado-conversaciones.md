# Etiquetado de conversaciones + estadísticas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que los agentes etiqueten cada conversación con **1 origen + varios intereses** y que los administradores vean **estadísticas de chats por origen/interés**, reutilizando las tablas `wa_etiquetas` y `wa_conversacion_etiqueta` que ya existen sin uso.

**Architecture:** Se agrega una columna `categoria` ('origen' | 'interes') al catálogo `wa_etiquetas` y un `orden` de despliegue. Un servicio nuevo (`src/services/etiquetas.js`) concentra la lógica; los endpoints de conversación (marcar/desmarcar/listar del chat) viven en `conversacionesController` para reutilizar su chequeo de acceso `accesible`, y el catálogo + estadísticas + gestión (admin) en un `etiquetasController` nuevo. El frontend añade una sección "Etiquetas" en `PanelCliente.vue` y una vista admin `PanelEstadisticas.vue`.

**Tech Stack:** Node.js 20 (CommonJS), Express, Sequelize (MySQL 8), Socket.io (no se usa aquí), Vue 3 `<script setup>` + Pinia + Tailwind, Vitest (frontend), `node --test` (backend).

## Global Constraints

- Solo se tocan tablas con prefijo `wa_`. Ninguna tabla de `serfuweb` sin ese prefijo.
- Sequelize con `underscored: true`; timestamps manuales (`creado_en`).
- Nombres de dominio en español, técnicos en inglés.
- Nada de `console.log`: usar `src/utils/logger`.
- El etiquetado **nunca** bloquea mensajería; es independiente.
- Cardinalidad fija: **1 origen** por chat (lo fuerza el servicio, no la BD), **varios intereses**.
- Eje temporal de estadísticas: `wa_conversaciones.creado_en` (fecha de ingreso del chat).
- El catálogo es **dinámico** (admin lo gestiona); no hay valores quemados en código.
- Backend test: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
- Frontend test: `npm --prefix frontend test`.

---

## File Structure

**Backend**
- Create `docs/migraciones/004-etiquetas-categoria.sql` — ALTER + semilla del catálogo.
- Modify `src/models/Etiqueta.js` — campos `categoria`, `orden`.
- Create `src/services/etiquetas.js` — lógica: helpers puros + orquestación Sequelize.
- Modify `src/controllers/conversacionesController.js` — handlers `etiquetasDeConv`, `etiquetarConv`, `desetiquetarConv`.
- Create `src/controllers/etiquetasController.js` — `listar` (catálogo), `estadisticas`, `crear`, `actualizar`.
- Modify `src/routes/api.js` — rutas nuevas.

**Frontend**
- Create `frontend/src/utils/etiquetas.js` — helper puro `siguienteSeleccion`.
- Modify `frontend/src/stores/acciones.js` — acciones de catálogo y marcado.
- Modify `frontend/src/components/PanelCliente.vue` — sección "Etiquetas".
- Create `frontend/src/components/PanelEstadisticas.vue` — modal admin (estadísticas + gestión de catálogo).
- Modify `frontend/src/views/Bandeja.vue` — botón admin "🏷️ Etiquetas" + montaje del modal.

**Tests**
- Create `test/etiquetas.test.js` — `agruparCatalogo`, `normalizarRango`, `validarNuevaEtiqueta`.
- Create `frontend/src/utils/etiquetas.test.js` — `siguienteSeleccion`.

---

## Task 1: Datos del catálogo (migración, modelo, agrupación)

**Files:**
- Create: `docs/migraciones/004-etiquetas-categoria.sql`
- Modify: `src/models/Etiqueta.js`
- Create: `src/services/etiquetas.js`
- Test: `test/etiquetas.test.js`

**Interfaces:**
- Produces:
  - `CATEGORIAS = { ORIGEN: 'origen', INTERES: 'interes' }`
  - `agruparCatalogo(filas) -> { origen: Etiqueta[], interes: Etiqueta[] }` — separa por `categoria` y ordena cada grupo por `orden` ascendente y luego `nombre`. `filas` son objetos con al menos `{ id, nombre, categoria, color, orden }`.

- [ ] **Step 1: Write the failing test**

Create `test/etiquetas.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { agruparCatalogo, CATEGORIAS } = require('../src/services/etiquetas');

test('CATEGORIAS expone origen e interes', () => {
  assert.equal(CATEGORIAS.ORIGEN, 'origen');
  assert.equal(CATEGORIAS.INTERES, 'interes');
});

test('agruparCatalogo separa por categoria y ordena por orden y luego nombre', () => {
  const filas = [
    { id: 3, nombre: 'Web', categoria: 'origen', color: '#111', orden: 2 },
    { id: 1, nombre: 'Prenecesidad', categoria: 'interes', color: '#222', orden: 1 },
    { id: 2, nombre: 'Mostrador', categoria: 'origen', color: '#333', orden: 1 },
    { id: 4, nombre: 'Abono', categoria: 'interes', color: '#444', orden: 1 },
  ];
  const r = agruparCatalogo(filas);
  assert.deepEqual(r.origen.map((e) => e.id), [2, 3]); // orden 1 antes que 2
  assert.deepEqual(r.interes.map((e) => e.id), [4, 1]); // mismo orden → por nombre: Abono, Prenecesidad
});

test('agruparCatalogo con lista vacía devuelve grupos vacíos', () => {
  assert.deepEqual(agruparCatalogo([]), { origen: [], interes: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/etiquetas.test.js`
Expected: FAIL con "Cannot find module '../src/services/etiquetas'".

- [ ] **Step 3: Create the service with the pure helper**

Create `src/services/etiquetas.js`:

```javascript
'use strict';

const CATEGORIAS = Object.freeze({ ORIGEN: 'origen', INTERES: 'interes' });

/** Separa el catálogo en {origen, interes}, cada grupo ordenado por orden y nombre. */
function agruparCatalogo(filas) {
  const cmp = (a, b) => (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es');
  return {
    origen: filas.filter((e) => e.categoria === CATEGORIAS.ORIGEN).sort(cmp),
    interes: filas.filter((e) => e.categoria === CATEGORIAS.INTERES).sort(cmp),
  };
}

module.exports = { CATEGORIAS, agruparCatalogo };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/etiquetas.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the migration**

Create `docs/migraciones/004-etiquetas-categoria.sql`:

```sql
-- 004 — Etiquetado de conversaciones: categoría + orden + catálogo semilla.
-- Reutiliza wa_etiquetas / wa_conversacion_etiqueta (ya existían sin uso).

ALTER TABLE wa_etiquetas
  ADD COLUMN categoria ENUM('origen','interes') NOT NULL DEFAULT 'interes' AFTER nombre,
  ADD COLUMN orden     TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER activa;

-- Catálogo inicial (idempotente por UNIQUE(nombre)). El admin puede editarlo luego.
INSERT INTO wa_etiquetas (nombre, categoria, color, activa, orden) VALUES
  ('Página web',           'origen',  '#2563eb', 1, 1),
  ('Mostrador / oficina',  'origen',  '#0d9488', 1, 2),
  ('Referido',             'origen',  '#7c3aed', 1, 3),
  ('Redes sociales',       'origen',  '#db2777', 1, 4),
  ('Publicidad / volante', 'origen',  '#ea580c', 1, 5),
  ('Llamada / telemercadeo','origen', '#ca8a04', 1, 6),
  ('Otro',                 'origen',  '#6b7280', 1, 7),
  ('Prenecesidad',          'interes', '#1d4ed8', 1, 1),
  ('Mantenimiento',         'interes', '#0f766e', 1, 2),
  ('Previsión (planes)',    'interes', '#6d28d9', 1, 3),
  ('Cartera / pagos',       'interes', '#b91c1c', 1, 4),
  ('Servicio inmediato',    'interes', '#c2410c', 1, 5),
  ('PQR / reclamo',         'interes', '#a16207', 1, 6),
  ('Información general',    'interes', '#4b5563', 1, 7)
ON DUPLICATE KEY UPDATE categoria = VALUES(categoria), color = VALUES(color), orden = VALUES(orden);
```

- [ ] **Step 6: Add `categoria` and `orden` to the model**

In `src/models/Etiqueta.js`, add the two fields after `nombre` / before `activa`:

```javascript
      nombre: { type: DataTypes.STRING(60), allowNull: false, unique: true },
      categoria: { type: DataTypes.ENUM('origen', 'interes'), allowNull: false, defaultValue: 'interes' },
      color: { type: DataTypes.STRING(9), allowNull: false, defaultValue: '#888780' },
      activa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      orden: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
```

- [ ] **Step 7: Commit**

```bash
git add test/etiquetas.test.js src/services/etiquetas.js docs/migraciones/004-etiquetas-categoria.sql src/models/Etiqueta.js
git commit -m "feat(etiquetas): categoría/orden en catálogo + agruparCatalogo"
```

---

## Task 2: Servicio — catálogo, marcado (1 origen) y lectura por chat

**Files:**
- Modify: `src/services/etiquetas.js`

**Interfaces:**
- Consumes: `CATEGORIAS`, `agruparCatalogo` (Task 1); modelos `Etiqueta`, `ConversacionEtiqueta` de `../models`; `sequelize` de `../config/database`.
- Produces:
  - `listarCatalogo() -> Promise<{origen, interes}>` — solo etiquetas `activa=1`.
  - `etiquetasDeConversacion(convId) -> Promise<Etiqueta[]>` — etiquetas del chat con `{id, nombre, categoria, color}`.
  - `etiquetarConversacion(convId, etiquetaId, agenteId) -> Promise<Etiqueta[]>` — inserta; si la etiqueta es de categoría `origen`, primero borra en la misma transacción cualquier otra etiqueta de origen del chat (regla "1 origen"). Idempotente. Devuelve la lista actualizada. Lanza `{status:404}` si la etiqueta no existe o está inactiva.
  - `desetiquetarConversacion(convId, etiquetaId) -> Promise<void>`.

- [ ] **Step 1: Implement the DB functions**

Append to `src/services/etiquetas.js` (antes de `module.exports`):

```javascript
const { Etiqueta, ConversacionEtiqueta } = require('../models');
const { sequelize } = require('../config/database');

const ATTRS = ['id', 'nombre', 'categoria', 'color', 'orden'];

async function listarCatalogo() {
  const filas = await Etiqueta.findAll({ where: { activa: true }, attributes: ATTRS });
  return agruparCatalogo(filas.map((f) => f.get({ plain: true })));
}

async function etiquetasDeConversacion(convId) {
  const filas = await ConversacionEtiqueta.findAll({
    where: { conversacionId: convId },
    include: [{ model: Etiqueta, as: 'etiqueta', attributes: ATTRS }],
  });
  return filas.map((f) => f.etiqueta.get({ plain: true }));
}

async function etiquetarConversacion(convId, etiquetaId, agenteId) {
  const etq = await Etiqueta.findByPk(etiquetaId);
  if (!etq || !etq.activa) {
    const e = new Error('etiqueta no encontrada');
    e.status = 404;
    throw e;
  }
  await sequelize.transaction(async (tx) => {
    // Regla "1 origen": al poner un origen se retira cualquier otro origen del chat.
    if (etq.categoria === CATEGORIAS.ORIGEN) {
      await sequelize.query(
        `DELETE ce FROM wa_conversacion_etiqueta ce
           JOIN wa_etiquetas e ON e.id = ce.etiqueta_id
          WHERE ce.conversacion_id = :conv AND e.categoria = 'origen'`,
        { replacements: { conv: convId }, transaction: tx },
      );
    }
    await ConversacionEtiqueta.findOrCreate({
      where: { conversacionId: convId, etiquetaId },
      defaults: { conversacionId: convId, etiquetaId, agenteId },
      transaction: tx,
    });
  });
  return etiquetasDeConversacion(convId);
}

async function desetiquetarConversacion(convId, etiquetaId) {
  await ConversacionEtiqueta.destroy({ where: { conversacionId: convId, etiquetaId } });
}
```

Update `module.exports`:

```javascript
module.exports = {
  CATEGORIAS,
  agruparCatalogo,
  listarCatalogo,
  etiquetasDeConversacion,
  etiquetarConversacion,
  desetiquetarConversacion,
};
```

- [ ] **Step 2: Add the `etiqueta` association on the join model**

The include `as: 'etiqueta'` above needs a `belongsTo`. In `src/models/index.js`, after the existing `Conversacion.belongsToMany(Etiqueta, …)` / `Etiqueta.belongsToMany(Conversacion, …)` block, add:

```javascript
// Acceso directo a la etiqueta desde la fila puente (para leer categoría/color).
ConversacionEtiqueta.belongsTo(Etiqueta, { foreignKey: 'etiquetaId', as: 'etiqueta' });
```

- [ ] **Step 3: Verify the suite still passes**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS (todo verde; el módulo carga sin romper asociaciones).

- [ ] **Step 4: Commit**

```bash
git add src/services/etiquetas.js src/models/index.js
git commit -m "feat(etiquetas): servicio de catálogo y marcado con regla 1-origen"
```

---

## Task 3: Endpoints de marcado por conversación

**Files:**
- Modify: `src/controllers/conversacionesController.js`
- Modify: `src/routes/api.js`

**Interfaces:**
- Consumes: `etiquetasDeConversacion`, `etiquetarConversacion`, `desetiquetarConversacion` (Task 2); helper `accesible(req, res)` ya existente en el controlador (carga la conversación y valida acceso, responde 403/404 y devuelve `undefined` si no procede).
- Produces (rutas):
  - `GET /api/conversaciones/:id/etiquetas` → `{ etiquetas: [...] }`
  - `POST /api/conversaciones/:id/etiquetas` body `{ etiquetaId }` → `{ etiquetas: [...] }`
  - `DELETE /api/conversaciones/:id/etiquetas/:etiquetaId` → `{ ok: true }`

- [ ] **Step 1: Add the require at the top of the controller**

En `src/controllers/conversacionesController.js`, junto a los demás `require`:

```javascript
const etiquetasSvc = require('../services/etiquetas');
```

- [ ] **Step 2: Add the three handlers** (cerca de `leer`/`resolver`, mismo estilo)

```javascript
async function etiquetasDeConv(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    return res.json({ etiquetas: await etiquetasSvc.etiquetasDeConversacion(conv.id) });
  } catch (err) {
    logger.error(`etiquetas de conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function etiquetarConv(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    const etiquetaId = Number(req.body && req.body.etiquetaId);
    if (!Number.isInteger(etiquetaId)) return res.status(400).json({ error: 'etiquetaId inválido' });
    const etiquetas = await etiquetasSvc.etiquetarConversacion(conv.id, etiquetaId, req.agente.id);
    return res.json({ etiquetas });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'etiqueta no encontrada' });
    logger.error(`etiquetar conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function desetiquetarConv(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    await etiquetasSvc.desetiquetarConversacion(conv.id, Number(req.params.etiquetaId));
    return res.json({ ok: true });
  } catch (err) {
    logger.error(`desetiquetar conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

Añádelos a `module.exports` del controlador: `..., etiquetasDeConv, etiquetarConv, desetiquetarConv`.

- [ ] **Step 3: Wire the routes**

En `src/routes/api.js`, junto a las rutas de `/conversaciones/:id/...`:

```javascript
router.get('/conversaciones/:id/etiquetas', requireAuth, convCtrl.etiquetasDeConv);
router.post('/conversaciones/:id/etiquetas', requireAuth, convCtrl.etiquetarConv);
router.delete('/conversaciones/:id/etiquetas/:etiquetaId', requireAuth, convCtrl.desetiquetarConv);
```

- [ ] **Step 4: Backend suite still green**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Manual verification (contra un backend con BD aplicada la migración 004)**

Con un token válido y un `:id` de conversación real:

```bash
# marcar un origen y un interés, luego listar
curl -s -X POST localhost:3000/api/conversaciones/123/etiquetas -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"etiquetaId":1}'
curl -s -X POST localhost:3000/api/conversaciones/123/etiquetas -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"etiquetaId":8}'
curl -s localhost:3000/api/conversaciones/123/etiquetas -H "Authorization: Bearer $TOK"
```
Expected: el `GET` devuelve `Página web` (origen) + `Prenecesidad` (interés). Marcar otro origen (p. ej. `etiquetaId:2`) debe **reemplazar** el origen (sigue habiendo un solo origen). `DELETE .../etiquetas/8` lo quita.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/conversacionesController.js src/routes/api.js
git commit -m "feat(etiquetas): endpoints de marcado por conversación"
```

---

## Task 4: Estadísticas + gestión de catálogo (admin)

**Files:**
- Modify: `src/services/etiquetas.js`
- Create: `src/controllers/etiquetasController.js`
- Modify: `src/routes/api.js`
- Test: `test/etiquetas.test.js`

**Interfaces:**
- Consumes: `sequelize`, `Etiqueta`, `CATEGORIAS` (Tasks 1–2).
- Produces:
  - `normalizarRango(desdeStr, hastaStr) -> { desde: Date, hastaExclusivo: Date }` — parsea `YYYY-MM-DD`; `hastaExclusivo` = día `hasta` + 1 (rango inclusivo del día final). Lanza `{status:400}` si falta un dato, la fecha es inválida o `desde > hasta`.
  - `validarNuevaEtiqueta({ nombre, categoria, color }) -> { nombre, categoria, color }` — normaliza y valida; `color` por defecto `'#888780'`. Lanza `{status:422}` si `nombre` vacío/>60, `categoria` no ∈ {origen,interes}, o `color` no casa `/^#[0-9a-fA-F]{3,8}$/`.
  - `estadisticas({ desde, hastaExclusivo, categoria }) -> Promise<Array<{id,nombre,categoria,color,total}>>` — cuenta chats por etiqueta filtrando por `wa_conversaciones.creado_en ∈ [desde, hastaExclusivo)`, opcionalmente por `categoria`.
  - `crearEtiqueta(datos) -> Promise<Etiqueta>`, `actualizarEtiqueta(id, cambios) -> Promise<Etiqueta>`.

- [ ] **Step 1: Write the failing tests for the pure helpers**

Append to `test/etiquetas.test.js`:

```javascript
const { normalizarRango, validarNuevaEtiqueta } = require('../src/services/etiquetas');

test('normalizarRango: rango válido, hastaExclusivo = hasta + 1 día', () => {
  const r = normalizarRango('2026-07-01', '2026-07-31');
  assert.equal(r.desde.toISOString().slice(0, 10), '2026-07-01');
  assert.equal(r.hastaExclusivo.toISOString().slice(0, 10), '2026-08-01');
});

test('normalizarRango: desde > hasta lanza 400', () => {
  assert.throws(() => normalizarRango('2026-08-01', '2026-07-01'), (e) => e.status === 400);
});

test('normalizarRango: fecha inválida lanza 400', () => {
  assert.throws(() => normalizarRango('no-fecha', '2026-07-01'), (e) => e.status === 400);
});

test('validarNuevaEtiqueta: normaliza y aplica color por defecto', () => {
  const r = validarNuevaEtiqueta({ nombre: '  Web  ', categoria: 'origen' });
  assert.deepEqual(r, { nombre: 'Web', categoria: 'origen', color: '#888780' });
});

test('validarNuevaEtiqueta: categoría inválida lanza 422', () => {
  assert.throws(() => validarNuevaEtiqueta({ nombre: 'X', categoria: 'otra' }), (e) => e.status === 422);
});

test('validarNuevaEtiqueta: nombre vacío lanza 422', () => {
  assert.throws(() => validarNuevaEtiqueta({ nombre: '   ', categoria: 'origen' }), (e) => e.status === 422);
});

test('validarNuevaEtiqueta: color mal formado lanza 422', () => {
  assert.throws(() => validarNuevaEtiqueta({ nombre: 'X', categoria: 'origen', color: 'rojo' }), (e) => e.status === 422);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/etiquetas.test.js`
Expected: FAIL con "normalizarRango is not a function".

- [ ] **Step 3: Implement the helpers + DB functions**

Append to `src/services/etiquetas.js` (antes de `module.exports`):

```javascript
const { QueryTypes } = require('sequelize');

const RE_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const UN_DIA_MS = 24 * 60 * 60 * 1000;

function normalizarRango(desdeStr, hastaStr) {
  const desde = new Date(`${desdeStr}T00:00:00.000Z`);
  const hasta = new Date(`${hastaStr}T00:00:00.000Z`);
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
    const e = new Error('fechas inválidas'); e.status = 400; throw e;
  }
  if (desde > hasta) { const e = new Error('desde > hasta'); e.status = 400; throw e; }
  return { desde, hastaExclusivo: new Date(hasta.getTime() + UN_DIA_MS) };
}

function validarNuevaEtiqueta({ nombre, categoria, color } = {}) {
  const nom = String(nombre || '').trim();
  if (!nom || nom.length > 60) { const e = new Error('nombre inválido'); e.status = 422; throw e; }
  if (categoria !== CATEGORIAS.ORIGEN && categoria !== CATEGORIAS.INTERES) {
    const e = new Error('categoría inválida'); e.status = 422; throw e;
  }
  const col = color == null || color === '' ? '#888780' : String(color);
  if (!RE_COLOR.test(col)) { const e = new Error('color inválido'); e.status = 422; throw e; }
  return { nombre: nom, categoria, color: col };
}

async function estadisticas({ desde, hastaExclusivo, categoria }) {
  const filtroCat = categoria ? 'AND e.categoria = :categoria' : '';
  return sequelize.query(
    `SELECT e.id, e.nombre, e.categoria, e.color, COUNT(*) AS total
       FROM wa_conversacion_etiqueta ce
       JOIN wa_etiquetas e        ON e.id = ce.etiqueta_id
       JOIN wa_conversaciones c   ON c.id = ce.conversacion_id
      WHERE c.creado_en >= :desde AND c.creado_en < :hastaExclusivo ${filtroCat}
      GROUP BY e.id, e.nombre, e.categoria, e.color
      ORDER BY e.categoria, total DESC`,
    { type: QueryTypes.SELECT, replacements: { desde, hastaExclusivo, categoria } },
  );
}

async function crearEtiqueta(datos) {
  const limpio = validarNuevaEtiqueta(datos);
  return Etiqueta.create({ ...limpio, activa: true, orden: Number(datos.orden) || 0 });
}

async function actualizarEtiqueta(id, cambios) {
  const etq = await Etiqueta.findByPk(id);
  if (!etq) { const e = new Error('no encontrada'); e.status = 404; throw e; }
  const permitidos = {};
  if (cambios.nombre !== undefined) permitidos.nombre = String(cambios.nombre).trim();
  if (cambios.color !== undefined) {
    if (!RE_COLOR.test(String(cambios.color))) { const e = new Error('color inválido'); e.status = 422; throw e; }
    permitidos.color = String(cambios.color);
  }
  if (cambios.activa !== undefined) permitidos.activa = !!cambios.activa;
  if (cambios.orden !== undefined) permitidos.orden = Number(cambios.orden) || 0;
  await etq.update(permitidos);
  return etq;
}
```

Extend `module.exports` con: `normalizarRango, validarNuevaEtiqueta, estadisticas, crearEtiqueta, actualizarEtiqueta`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/etiquetas.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Create the controller**

Create `src/controllers/etiquetasController.js`:

```javascript
'use strict';
const svc = require('../services/etiquetas');
const logger = require('../utils/logger');

async function listar(req, res) {
  try {
    return res.json(await svc.listarCatalogo());
  } catch (err) {
    logger.error(`listar catálogo etiquetas: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

// Rango por defecto: mes en curso (si no llegan ?desde=&hasta=).
function rangoDelMes() {
  const hoy = new Date();
  const desde = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
  const hasta = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { desde: iso(desde), hasta: iso(hasta) };
}

async function estadisticas(req, res) {
  try {
    const def = rangoDelMes();
    const { desde, hastaExclusivo } = svc.normalizarRango(
      req.query.desde || def.desde,
      req.query.hasta || def.hasta,
    );
    const categoria = req.query.categoria || null;
    const filas = await svc.estadisticas({ desde, hastaExclusivo, categoria });
    return res.json({ estadisticas: filas.map((f) => ({ ...f, total: Number(f.total) })) });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: 'rango inválido' });
    logger.error(`estadísticas etiquetas: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function crear(req, res) {
  try {
    const etq = await svc.crearEtiqueta(req.body || {});
    return res.status(201).json({ etiqueta: etq });
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ error: err.message });
    logger.error(`crear etiqueta: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function actualizar(req, res) {
  try {
    const etq = await svc.actualizarEtiqueta(Number(req.params.id), req.body || {});
    return res.json({ etiqueta: etq });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'no encontrada' });
    if (err.status === 422) return res.status(422).json({ error: err.message });
    logger.error(`actualizar etiqueta ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { listar, estadisticas, crear, actualizar };
```

- [ ] **Step 6: Wire the routes**

En `src/routes/api.js` (require + rutas). Añade el require:

```javascript
const etiquetasCtrl = require('../controllers/etiquetasController');
```

Y las rutas (`/etiquetas/estadisticas` **antes** que no aplique conflicto; el catálogo lo ve cualquier agente, lo demás es admin):

```javascript
router.get('/etiquetas', requireAuth, etiquetasCtrl.listar);
router.get('/etiquetas/estadisticas', requireAuth, requireAdmin, etiquetasCtrl.estadisticas);
router.post('/etiquetas', requireAuth, requireAdmin, etiquetasCtrl.crear);
router.patch('/etiquetas/:id', requireAuth, requireAdmin, etiquetasCtrl.actualizar);
```

- [ ] **Step 7: Full backend suite**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 8: Manual verification (backend con BD)**

```bash
curl -s localhost:3000/api/etiquetas -H "Authorization: Bearer $TOK"
curl -s "localhost:3000/api/etiquetas/estadisticas?desde=2026-07-01&hasta=2026-07-31" -H "Authorization: Bearer $TOK_ADMIN"
curl -s "localhost:3000/api/etiquetas/estadisticas" -H "Authorization: Bearer $TOK_ASESOR"   # → 403
```
Expected: catálogo agrupado; estadísticas con `total` por etiqueta; asesor recibe 403.

- [ ] **Step 9: Commit**

```bash
git add test/etiquetas.test.js src/services/etiquetas.js src/controllers/etiquetasController.js src/routes/api.js
git commit -m "feat(etiquetas): estadísticas y gestión de catálogo (admin)"
```

---

## Task 5: Frontend — sección "Etiquetas" en el panel del chat

**Files:**
- Create: `frontend/src/utils/etiquetas.js`
- Test: `frontend/src/utils/etiquetas.test.js`
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/components/PanelCliente.vue`

**Interfaces:**
- Produces:
  - `siguienteSeleccion(actuales, etiqueta) -> Array<{id, categoria}>` — dada la lista actual de etiquetas del chat y la etiqueta pulsada: si ya está (por `id`) la quita (toggle off); si es `origen` reemplaza cualquier origen previo; si es `interes` la añade.
  - Store `acciones`: `cargarEtiquetas()` (catálogo, cachea en `state.catalogoEtiquetas`), `alternarEtiqueta(convId, etiqueta)` (POST o DELETE según esté puesta; deja `useChat().etiquetas` autoritativo con la respuesta del POST).

- [ ] **Step 1: Write the failing test for the pure helper**

Create `frontend/src/utils/etiquetas.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { siguienteSeleccion } from './etiquetas';

const web = { id: 1, categoria: 'origen' };
const mostrador = { id: 2, categoria: 'origen' };
const prenec = { id: 8, categoria: 'interes' };
const abono = { id: 9, categoria: 'interes' };

describe('siguienteSeleccion', () => {
  it('agrega un interés a la selección', () => {
    expect(siguienteSeleccion([web], prenec).map((e) => e.id).sort()).toEqual([1, 8]);
  });
  it('un segundo origen reemplaza al primero (1 origen)', () => {
    const r = siguienteSeleccion([web, prenec], mostrador);
    expect(r.map((e) => e.id).sort()).toEqual([2, 8]);
  });
  it('pulsar una etiqueta ya puesta la quita', () => {
    expect(siguienteSeleccion([web, prenec], prenec).map((e) => e.id)).toEqual([1]);
  });
  it('pulsar el origen seleccionado lo deselecciona', () => {
    expect(siguienteSeleccion([web, abono], web).map((e) => e.id)).toEqual([9]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend test`
Expected: FAIL — no existe `./etiquetas`.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/utils/etiquetas.js`:

```javascript
// Calcula la selección siguiente al pulsar una etiqueta. Regla: 1 origen, varios intereses.
export function siguienteSeleccion(actuales, etiqueta) {
  if (actuales.some((e) => e.id === etiqueta.id)) {
    return actuales.filter((e) => e.id !== etiqueta.id); // toggle off
  }
  if (etiqueta.categoria === 'origen') {
    return [...actuales.filter((e) => e.categoria !== 'origen'), etiqueta];
  }
  return [...actuales, etiqueta];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Add store state + actions**

En `frontend/src/stores/acciones.js`, añade al `state`: `catalogoEtiquetas: { origen: [], interes: [] }`. Añade acciones (junto a `consultarPrenecesidad`):

```javascript
    async cargarEtiquetas() {
      if (this.catalogoEtiquetas.origen.length || this.catalogoEtiquetas.interes.length) return this.catalogoEtiquetas;
      this.catalogoEtiquetas = await apiFetch('/etiquetas');
      return this.catalogoEtiquetas;
    },
    async alternarEtiqueta(convId, etiqueta) {
      const chat = useChat();
      const previa = chat.etiquetas || [];
      const puesta = previa.some((e) => e.id === etiqueta.id);
      chat.etiquetas = siguienteSeleccion(previa, etiqueta); // optimista (regla 1-origen en UI)
      try {
        if (puesta) {
          await apiFetch(`/conversaciones/${convId}/etiquetas/${etiqueta.id}`, { method: 'DELETE' });
        } else {
          const r = await apiFetch(`/conversaciones/${convId}/etiquetas`, {
            method: 'POST', body: JSON.stringify({ etiquetaId: etiqueta.id }),
          });
          chat.etiquetas = r.etiquetas; // autoritativo: confirma la regla 1-origen del backend
        }
      } catch (e) {
        chat.etiquetas = previa; // revertir si el request falla
        throw e;
      }
    },
```

Importa el helper al inicio de `acciones.js` (junto a los demás imports):

```javascript
import { siguienteSeleccion } from '../utils/etiquetas';
```

- [ ] **Step 6: Hold the chat's tags in the chat store**

`frontend/src/stores/chat.js` ya importa `apiFetch` y tiene `abrir(conversacion)` / `cerrar()`.

1. Añade `etiquetas: []` al `state` (junto a `mensajes: []`).
2. En `abrir(conversacion)`, tras `this.mensajes = [];` añade `this.etiquetas = [];`. Y dentro del `try`, después de `this.marcarLeidaEnLista(id);`, dispara la carga best-effort (no bloquea, respeta el guard `sigueActual`):

```javascript
        apiFetch(`/conversaciones/${id}/etiquetas`)
          .then((r) => { if (sigueActual()) this.etiquetas = r.etiquetas; })
          .catch(() => { /* el etiquetado es best-effort al abrir */ });
```

3. En `cerrar()`, añade `this.etiquetas = [];`.

- [ ] **Step 7: Add the "Etiquetas" section in `PanelCliente.vue`**

`PanelCliente.vue` **ya** importa `computed`, `ref`, `watch`, `onMounted`, `useChat`, `useAcciones`, y ya tiene `const chat = useChat();`, `const acc = useAcciones();` y `const c = computed(() => chat.conversacion);`. **No los reimportes.** Solo añade, en `<script setup>`:

- una línea de carga del catálogo dentro del `onMounted` existente (o un `onMounted` nuevo): `onMounted(() => acc.cargarEtiquetas());`
- y estos computed/helpers:

```javascript
const catalogo = computed(() => acc.catalogoEtiquetas);
const etqSel = computed(() => chat.etiquetas || []);
const estaPuesta = (e) => etqSel.value.some((x) => x.id === e.id);
async function alternar(e) { try { await acc.alternarEtiqueta(c.value.id, e); } catch { aviso.value = 'No se pudo etiquetar.'; } }
```

En el `<template>`, tras el bloque de "Asignar a" (antes de los botones de consulta), agrega:

```html
    <div class="mt-4 border-t border-gray-100 pt-3">
      <div class="text-[11px] text-gray-400 uppercase mb-1">Origen</div>
      <div class="flex flex-wrap gap-1.5 mb-2">
        <button v-for="e in catalogo.origen" :key="e.id" @click="alternar(e)"
          class="text-[12px] rounded-full px-2.5 py-1 border transition"
          :style="estaPuesta(e) ? { backgroundColor: e.color, borderColor: e.color, color: '#fff' } : { borderColor: e.color, color: e.color }">
          {{ e.nombre }}
        </button>
      </div>
      <div class="text-[11px] text-gray-400 uppercase mb-1">Interés</div>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="e in catalogo.interes" :key="e.id" @click="alternar(e)"
          class="text-[12px] rounded-full px-2.5 py-1 border transition"
          :style="estaPuesta(e) ? { backgroundColor: e.color, borderColor: e.color, color: '#fff' } : { borderColor: e.color, color: e.color }">
          {{ e.nombre }}
        </button>
      </div>
    </div>
```

(`c` es la conversación actual ya usada en el componente; si es una `computed`, usa `c.value.id` en el script como arriba y `c.id` en el template.)

- [ ] **Step 8: Build the frontend to catch template/script errors**

Run: `npm --prefix frontend run build`
Expected: build sin errores.

- [ ] **Step 9: Frontend tests still pass**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/utils/etiquetas.js frontend/src/utils/etiquetas.test.js frontend/src/stores/acciones.js frontend/src/stores/chat.js frontend/src/components/PanelCliente.vue
git commit -m "feat(etiquetas): sección de etiquetas en el panel del chat"
```

---

## Task 6: Frontend — vista admin de estadísticas

**Files:**
- Create: `frontend/src/components/PanelEstadisticas.vue`
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/views/Bandeja.vue`

**Interfaces:**
- Consumes: nada de tareas frontend previas (usa `apiFetch`).
- Produces: store action `cargarEstadisticas(desde, hasta) -> Promise<Array>`; componente `PanelEstadisticas.vue` (modal) montado desde `Bandeja.vue` tras un botón admin. (La pestaña de gestión del catálogo se añade en la Task 7.)

- [ ] **Step 1: Add the stats store action**

En `frontend/src/stores/acciones.js`:

```javascript
    async cargarEstadisticas(desde, hasta) {
      const q = new URLSearchParams();
      if (desde) q.set('desde', desde);
      if (hasta) q.set('hasta', hasta);
      const r = await apiFetch(`/etiquetas/estadisticas?${q.toString()}`);
      return r.estadisticas;
    },
```

- [ ] **Step 2: Create `PanelEstadisticas.vue`** (modal calcado de `PanelAgentes.vue`)

```html
<script setup>
import { ref, onMounted, computed } from 'vue';
import { useAcciones } from '../stores/acciones';

const emit = defineEmits(['cerrar']);
const acc = useAcciones();

const hoy = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const desde = ref(iso(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1))));
const hasta = ref(iso(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0))));
const filas = ref([]);
const cargando = ref(true);
const error = ref('');

async function cargar() {
  cargando.value = true; error.value = '';
  try { filas.value = await acc.cargarEstadisticas(desde.value, hasta.value); }
  catch { error.value = 'No se pudieron cargar las estadísticas.'; }
  finally { cargando.value = false; }
}
onMounted(cargar);

const origen = computed(() => filas.value.filter((f) => f.categoria === 'origen'));
const interes = computed(() => filas.value.filter((f) => f.categoria === 'interes'));
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[85vh] flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Estadísticas de etiquetas</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>
      <div class="flex items-end gap-2 px-4 py-2 border-b text-[12px]">
        <label class="flex flex-col">Desde<input type="date" v-model="desde" class="border rounded px-2 py-1" /></label>
        <label class="flex flex-col">Hasta<input type="date" v-model="hasta" class="border rounded px-2 py-1" /></label>
        <button class="bg-marca text-white rounded-lg px-3 py-1.5 font-semibold" @click="cargar">Aplicar</button>
      </div>
      <div class="overflow-auto p-4">
        <div v-if="cargando" class="text-center text-gray-400 text-sm py-6">Cargando…</div>
        <div v-else-if="error" class="text-center text-red-500 text-sm py-6">{{ error }}</div>
        <template v-else>
          <div class="text-[11px] text-gray-400 uppercase mb-1">Origen</div>
          <div v-if="!origen.length" class="text-[12px] text-gray-400 mb-3">Sin datos.</div>
          <div v-for="f in origen" :key="f.id" class="flex items-center justify-between py-1 text-[13px]">
            <span class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full" :style="{ backgroundColor: f.color }"></span>{{ f.nombre }}</span>
            <b class="tabular-nums">{{ f.total }}</b>
          </div>
          <div class="text-[11px] text-gray-400 uppercase mt-4 mb-1">Interés</div>
          <div v-if="!interes.length" class="text-[12px] text-gray-400">Sin datos.</div>
          <div v-for="f in interes" :key="f.id" class="flex items-center justify-between py-1 text-[13px]">
            <span class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full" :style="{ backgroundColor: f.color }"></span>{{ f.nombre }}</span>
            <b class="tabular-nums">{{ f.total }}</b>
          </div>
        </template>
      </div>
      <div class="px-4 py-2 border-t text-[11px] text-gray-400">
        Cuenta de chats que ingresaron en el rango. El origen es único por chat; un chat puede tener varios intereses.
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Mount it from `Bandeja.vue`**

Junto al botón "📊 Agentes" (línea ~67), añade:

```html
        <button v-if="auth.esAdministrador" class="bg-white/20 hover:bg-white/30 px-2 py-1 rounded-full text-[11px]" @click="mostrarEtiquetas = true">🏷️ Etiquetas</button>
```

Registra el estado `const mostrarEtiquetas = ref(false);`, importa `PanelEstadisticas`, y móntalo junto a `<PanelAgentes ...>`:

```html
    <PanelEstadisticas v-if="mostrarEtiquetas" @cerrar="mostrarEtiquetas = false" />
```

- [ ] **Step 4: Build**

Run: `npm --prefix frontend run build`
Expected: build sin errores.

- [ ] **Step 5: Frontend tests**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PanelEstadisticas.vue frontend/src/stores/acciones.js frontend/src/views/Bandeja.vue
git commit -m "feat(etiquetas): vista admin de estadísticas de etiquetas"
```

---

## Task 7: Gestión del catálogo (admin)

**Files:**
- Modify: `src/services/etiquetas.js`
- Modify: `src/controllers/etiquetasController.js`
- Modify: `src/routes/api.js`
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/components/PanelEstadisticas.vue`

**Interfaces:**
- Consumes: `agruparCatalogo`, `Etiqueta`, `crearEtiqueta`, `actualizarEtiqueta` (Tasks 1/4); componente `PanelEstadisticas.vue` (Task 6).
- Produces:
  - `listarCatalogoCompleto() -> Promise<{origen, interes}>` — **todas** las etiquetas (activas e inactivas), agrupadas y ordenadas.
  - Ruta `GET /api/etiquetas/todas` (admin) → `{origen, interes}` con inactivas incluidas.
  - Store: `cargarCatalogoAdmin()`, `crearEtiqueta(datos)`, `actualizarEtiqueta(id, cambios)`; ambas mutaciones invalidan el catálogo cacheado de los agentes (`catalogoEtiquetas`).
  - Pestaña "Catálogo" en `PanelEstadisticas.vue`.

- [ ] **Step 1: Service — listar todas**

En `src/services/etiquetas.js`, añade y expórtala en `module.exports`:

```javascript
async function listarCatalogoCompleto() {
  const filas = await Etiqueta.findAll({ attributes: [...ATTRS, 'activa'] });
  return agruparCatalogo(filas.map((f) => f.get({ plain: true })));
}
```

- [ ] **Step 2: Controller — soporte admin en el catálogo**

En `src/controllers/etiquetasController.js` añade el handler y expórtalo:

```javascript
async function listarTodas(req, res) {
  try {
    return res.json(await svc.listarCatalogoCompleto());
  } catch (err) {
    logger.error(`listar catálogo completo: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

- [ ] **Step 3: Route**

En `src/routes/api.js`, junto a las demás rutas de `/etiquetas` (antes de `PATCH /etiquetas/:id`):

```javascript
router.get('/etiquetas/todas', requireAuth, requireAdmin, etiquetasCtrl.listarTodas);
```

- [ ] **Step 4: Backend suite**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Store actions**

En `frontend/src/stores/acciones.js`:

```javascript
    async cargarCatalogoAdmin() {
      return apiFetch('/etiquetas/todas');
    },
    async crearEtiqueta(datos) {
      const r = await apiFetch('/etiquetas', { method: 'POST', body: JSON.stringify(datos) });
      this.catalogoEtiquetas = { origen: [], interes: [] }; // invalida cache de agentes
      return r.etiqueta;
    },
    async actualizarEtiqueta(id, cambios) {
      const r = await apiFetch(`/etiquetas/${id}`, { method: 'PATCH', body: JSON.stringify(cambios) });
      this.catalogoEtiquetas = { origen: [], interes: [] };
      return r.etiqueta;
    },
```

- [ ] **Step 6: Add a tab bar + Catálogo tab to `PanelEstadisticas.vue`**

En `<script setup>`, añade estado y carga del catálogo admin:

```javascript
const tab = ref('stats');
const cat = ref({ origen: [], interes: [] });
const nueva = ref({ nombre: '', categoria: 'origen', color: '#2563eb' });
const errCat = ref('');

async function cargarCat() {
  try { cat.value = await acc.cargarCatalogoAdmin(); } catch { errCat.value = 'No se pudo cargar el catálogo.'; }
}
async function verCatalogo() { tab.value = 'catalogo'; if (!cat.value.origen.length && !cat.value.interes.length) await cargarCat(); }
async function agregar() {
  errCat.value = '';
  try { await acc.crearEtiqueta({ ...nueva.value }); nueva.value = { nombre: '', categoria: 'origen', color: '#2563eb' }; await cargarCat(); }
  catch (e) { errCat.value = e.message || 'No se pudo crear (¿nombre repetido?).'; }
}
async function toggleActiva(e) { await acc.actualizarEtiqueta(e.id, { activa: !e.activa }); await cargarCat(); }
async function guardarFila(e) { await acc.actualizarEtiqueta(e.id, { nombre: e.nombre, color: e.color, orden: Number(e.orden) }); await cargarCat(); }
```

En el `<template>`, justo bajo la cabecera del modal (antes del bloque de filtro de fechas), añade la barra de pestañas:

```html
      <div class="flex gap-1 px-4 pt-2 text-[12px]">
        <button class="px-3 py-1 rounded-t" :class="tab === 'stats' ? 'bg-gray-100 font-semibold' : 'text-gray-500'" @click="tab = 'stats'">Estadísticas</button>
        <button class="px-3 py-1 rounded-t" :class="tab === 'catalogo' ? 'bg-gray-100 font-semibold' : 'text-gray-500'" @click="verCatalogo">Catálogo</button>
      </div>
```

Envuelve el filtro de fechas y el cuerpo de estadísticas existentes en `v-if="tab === 'stats'"`. Añade el cuerpo del catálogo tras el de estadísticas:

```html
      <div v-if="tab === 'catalogo'" class="overflow-auto p-4">
        <div v-if="errCat" class="text-red-500 text-[12px] mb-2">{{ errCat }}</div>
        <div class="flex items-end gap-2 mb-3 text-[12px] border-b pb-3">
          <label class="flex flex-col flex-1">Nombre<input v-model="nueva.nombre" maxlength="60" class="border rounded px-2 py-1" /></label>
          <label class="flex flex-col">Tipo<select v-model="nueva.categoria" class="border rounded px-2 py-1"><option value="origen">Origen</option><option value="interes">Interés</option></select></label>
          <label class="flex flex-col">Color<input type="color" v-model="nueva.color" class="h-8 w-10 border rounded" /></label>
          <button class="bg-marca text-white rounded-lg px-3 py-1.5 font-semibold" :disabled="!nueva.nombre.trim()" @click="agregar">Agregar</button>
        </div>
        <template v-for="grupo in [{ k: 'origen', t: 'Origen' }, { k: 'interes', t: 'Interés' }]" :key="grupo.k">
          <div class="text-[11px] text-gray-400 uppercase mb-1 mt-2">{{ grupo.t }}</div>
          <div v-for="e in cat[grupo.k]" :key="e.id" class="flex items-center gap-2 py-1 text-[13px]" :class="{ 'opacity-40': !e.activa }">
            <input type="color" v-model="e.color" class="h-6 w-8 border rounded" />
            <input v-model="e.nombre" maxlength="60" class="border rounded px-2 py-1 flex-1" />
            <input type="number" v-model="e.orden" class="border rounded px-2 py-1 w-14" title="orden" />
            <button class="text-[12px] text-marca-oscuro" @click="guardarFila(e)">Guardar</button>
            <button class="text-[12px]" :class="e.activa ? 'text-gray-500' : 'text-green-600'" @click="toggleActiva(e)">{{ e.activa ? 'Desactivar' : 'Activar' }}</button>
          </div>
        </template>
      </div>
```

- [ ] **Step 7: Build + tests**

Run: `npm --prefix frontend run build && npm --prefix frontend test`
Expected: build sin errores y tests en verde.

- [ ] **Step 8: Manual verification**

Como admin: abrir 🏷️ Etiquetas → pestaña Catálogo. Crear una etiqueta nueva (aparece en la lista), renombrarla y Guardar, Desactivarla (se atenúa y deja de ofrecerse en el panel del chat). Confirmar que un asesor no puede llamar `GET /api/etiquetas/todas` (403).

- [ ] **Step 9: Commit**

```bash
git add src/services/etiquetas.js src/controllers/etiquetasController.js src/routes/api.js frontend/src/stores/acciones.js frontend/src/components/PanelEstadisticas.vue
git commit -m "feat(etiquetas): gestión del catálogo por administradores"
```

---

## Deploy (tras aprobar e implementar todas las tareas)

1. Aplicar migración en el servidor: `ssh mantix "mysql serfuweb < ~/apps/wa/docs/migraciones/004-etiquetas-categoria.sql"` (o el flujo `mysql < ...` habitual).
2. `ssh mantix` → `cd ~/apps/wa && git pull --ff-only && npm --prefix frontend run build`.
3. `pm2 restart wa-backend` (no toca ingesta; `wa-worker` no requiere reinicio).
4. Verificación en vivo: abrir un chat, marcar 1 origen + varios intereses; como admin abrir 🏷️ Etiquetas y confirmar los conteos del mes.

## Fuera de alcance (confirmado en el spec)

- Auto-detección de origen (referral de Meta / parseo del primer mensaje).
- Emisión por socket del cambio de etiquetas (no hay sync en tiempo real entre agentes).
- Export CSV/Excel y gráficas.
- Reordenar/recolorear etiquetas con arrastre; la gestión de catálogo es por formulario simple (crear/renombrar/color/activar-desactivar vía `PATCH`).
- **Punto de color del origen en `ItemConversacion.vue`** (la spec lo marcó "opcional"). Se **difiere**: la lista de chats se pagina y no incluye las etiquetas (se cargan de forma perezosa al abrir cada chat, como notas/asignaciones). Mostrarlo por fila exigiría meter la etiqueta de origen en el payload de `listar`, lo que complica el `findAndCountAll` con M:N y su conteo. Si luego se quiere, se añade con una consulta ligera aparte.
