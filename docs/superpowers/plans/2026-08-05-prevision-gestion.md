# Registrar gestión de previsión — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar la gestión de un plan de previsión desde la bandeja (UPDATE `plan` + traza en `gestion` en `olivosct`), replicando la lógica de cartera (masivo/individual) de forma parametrizada y transaccional.

**Architecture:** La integración de previsión (hoy solo lectura) gana funciones de escritura: `listarConceptosPermitidos` y `registrarGestion` (transacción mysql2). Un controlador nuevo expone `GET /prevision/conceptos` y `POST /prevision/gestion`. El frontend añade un formulario "Registrar gestión" en el popup de previsión, sobre el plan seleccionado.

**Tech Stack:** Node.js CommonJS, Express, `mysql2` (transacción), `node --test`; Vue 3 `<script setup>` + Pinia + Tailwind, Vitest.

## Global Constraints

- **Prerrequisito**: el GRANT de escritura ya está aplicado en `olivosct` (UPDATE de 4 columnas de `plan` + INSERT en `gestion` para `wa_lector@192.9.17.30`). Sin él, la escritura falla → 502.
- Toda escritura **parametrizada** (`?`, mysql2), nunca interpolando valores.
- UPDATE + INSERT en **una transacción** (commit/rollback).
- `es_masivo` = `posfecha` presente **Y** `concepto` en `conceptos_permitidos` (`codigo_concepto`). Masivo → `WHERE ced_pagador`; individual → `WHERE num_plan`.
- Traza en `gestion` salvo `concepto === '5'`. `tramito` = `req.agente.nombre`.
- Aislamiento: toda la BD `olivosct` vive en `src/integrations/prevision/`.
- `logger` (nunca `console.log`); dominio en español, técnico en inglés.
- Backend test: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
- Frontend: `npm --prefix frontend test` y `npm --prefix frontend run build`.

## File Structure

- Modify `src/integrations/prevision/cliente.js` — `decidirMasivo`, `debeRegistrarGestion` (puros), `listarConceptosPermitidos`, `registrarGestion`.
- Create `src/controllers/previsionController.js` — `conceptos`, `gestion`.
- Modify `src/routes/api.js` — rutas.
- Test `test/prevision-gestion.test.js` — helpers puros.
- Modify `frontend/src/stores/acciones.js` — `cargarConceptosPrevision`, `registrarGestionPrevision`.
- Modify `frontend/src/components/PanelCliente.vue` — formulario en el popup de previsión.

---

## Task 1: Integración — helpers puros + escritura (transacción)

**Files:**
- Modify: `src/integrations/prevision/cliente.js`
- Test: `test/prevision-gestion.test.js`

**Interfaces:**
- Produces:
  - `decidirMasivo(posfecha, enPermitidos) -> boolean` (true solo si ambos truthy).
  - `debeRegistrarGestion(concepto) -> boolean` (false si `'5'`).
  - `listarConceptosPermitidos() -> Promise<[{codigo, descripcion}]>`.
  - `registrarGestion({ numPlan, concepto, novedad, posfecha, tramito }) -> Promise<{masivo, afectados}>`. Lanza `{codigo:'no_configurado'}` o `{codigo:'plan_no_encontrado'}`.

- [ ] **Step 1: Write the failing tests (pure helpers)**

Create `test/prevision-gestion.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decidirMasivo, debeRegistrarGestion } = require('../src/integrations/prevision/cliente');

test('decidirMasivo: true solo con posfecha Y concepto permitido', () => {
  assert.equal(decidirMasivo('2026-08-10', true), true);
  assert.equal(decidirMasivo('2026-08-10', false), false); // no permitido
  assert.equal(decidirMasivo(null, true), false);          // sin posfecha
  assert.equal(decidirMasivo('', true), false);
});

test('debeRegistrarGestion: false para concepto 5, true para el resto', () => {
  assert.equal(debeRegistrarGestion('5'), false);
  assert.equal(debeRegistrarGestion(5), false);
  assert.equal(debeRegistrarGestion('49'), true);
  assert.equal(debeRegistrarGestion('1'), true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/prevision-gestion.test.js`
Expected: FAIL — `decidirMasivo is not a function`.

- [ ] **Step 3: Implement helpers + write functions**

En `src/integrations/prevision/cliente.js`, añade (antes de `module.exports`):

```javascript
/** Masivo = hay posfecha Y el concepto está en conceptos_permitidos. */
function decidirMasivo(posfecha, enPermitidos) {
  return !!posfecha && !!enPermitidos;
}

/** El concepto 5 (Camb PFecha) NO deja traza en `gestion`. */
function debeRegistrarGestion(concepto) {
  return String(concepto) !== '5';
}

/** Conceptos habilitados para gestión (los 39 curados). */
async function listarConceptosPermitidos() {
  const p = obtenerPool();
  if (!p) { const e = new Error('previsión no configurada'); e.codigo = 'no_configurado'; throw e; }
  const [rows] = await p.query(
    'SELECT codigo_concepto AS codigo, descripcion FROM conceptos_permitidos ORDER BY descripcion',
  );
  return rows;
}

/**
 * Registra la gestión de un plan: UPDATE plan (+ INSERT gestion salvo concepto 5),
 * en una transacción y parametrizado. Masivo (posfecha + concepto permitido) actualiza
 * todos los planes del ced_pagador; si no, solo el num_plan.
 */
async function registrarGestion({ numPlan, concepto, novedad, posfecha, tramito }) {
  const p = obtenerPool();
  if (!p) { const e = new Error('previsión no configurada'); e.codigo = 'no_configurado'; throw e; }
  const conc = String(concepto);
  const nov = String(novedad || '');
  const post = posfecha ? String(posfecha) : null;
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();

    const [pl] = await conn.query('SELECT ced_pagador FROM plan WHERE num_plan = ?', [numPlan]);
    if (!pl.length) { const e = new Error('plan no encontrado'); e.codigo = 'plan_no_encontrado'; throw e; }
    const cedPagador = pl[0].ced_pagador;

    let enPermitidos = false;
    if (post) {
      const [cp] = await conn.query('SELECT 1 FROM conceptos_permitidos WHERE codigo_concepto = ? LIMIT 1', [conc]);
      enPermitidos = cp.length > 0;
    }
    const masivo = decidirMasivo(post, enPermitidos);

    let afectados;
    if (masivo) {
      const [r] = await conn.query(
        'UPDATE plan SET novedad_plan=?, concepto_plan=?, fech_gestion_plan=CURDATE(), fech_pago_posfecha=? WHERE ced_pagador=?',
        [nov, conc, post, cedPagador],
      );
      afectados = r.affectedRows;
    } else if (post) {
      const [r] = await conn.query(
        'UPDATE plan SET novedad_plan=?, concepto_plan=?, fech_gestion_plan=CURDATE(), fech_pago_posfecha=? WHERE num_plan=?',
        [nov, conc, post, numPlan],
      );
      afectados = r.affectedRows;
    } else {
      const [r] = await conn.query(
        'UPDATE plan SET novedad_plan=?, concepto_plan=?, fech_gestion_plan=CURDATE() WHERE num_plan=?',
        [nov, conc, numPlan],
      );
      afectados = r.affectedRows;
    }

    if (debeRegistrarGestion(conc)) {
      await conn.query(
        'INSERT INTO gestion (num_plan, novedad, fecha, hora, concepto, tramito) VALUES (?, ?, CURDATE(), CURTIME(), ?, ?)',
        [numPlan, nov, conc, tramito],
      );
    }

    await conn.commit();
    return { masivo, afectados };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
```

Extiende `module.exports`:
```javascript
module.exports = { consultarPlanesPorDocumento, decidirMasivo, debeRegistrarGestion, listarConceptosPermitidos, registrarGestion };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/prevision-gestion.test.js`
Expected: PASS.

- [ ] **Step 5: Full suite green**

Run: `... node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/integrations/prevision/cliente.js test/prevision-gestion.test.js
git commit -m "feat(prevision): escritura de gestión (masivo/individual, transacción) + conceptos"
```

---

## Task 2: Endpoints — conceptos + gestión

**Files:**
- Create: `src/controllers/previsionController.js`
- Modify: `src/routes/api.js`

**Interfaces:**
- Consumes: `listarConceptosPermitidos`, `registrarGestion` (Task 1).
- Produces:
  - `GET /api/prevision/conceptos` → `{ conceptos: [{codigo, descripcion}] }`.
  - `POST /api/prevision/gestion` body `{ numPlan, concepto, novedad, posfecha }` → `{ ok:true, masivo, afectados }`.

- [ ] **Step 1: Create the controller**

Create `src/controllers/previsionController.js`:

```javascript
'use strict';
const { listarConceptosPermitidos, registrarGestion } = require('../integrations/prevision/cliente');
const logger = require('../utils/logger');

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

async function conceptos(req, res) {
  try {
    return res.json({ conceptos: await listarConceptosPermitidos() });
  } catch (err) {
    if (err.codigo === 'no_configurado') return res.status(503).json({ error: 'previsión no configurada', codigo: 'no_configurado' });
    logger.error(`conceptos previsión: ${err.message}`);
    return res.status(502).json({ error: 'no se pudieron cargar los conceptos' });
  }
}

async function gestion(req, res) {
  const { numPlan, concepto, novedad, posfecha } = req.body || {};
  if (!numPlan || !concepto) return res.status(400).json({ error: 'numPlan y concepto requeridos' });
  if (posfecha && !RE_FECHA.test(posfecha)) return res.status(400).json({ error: 'posfecha inválida (YYYY-MM-DD)' });
  try {
    const r = await registrarGestion({ numPlan, concepto, novedad, posfecha: posfecha || null, tramito: req.agente.nombre });
    return res.json({ ok: true, ...r });
  } catch (err) {
    if (err.codigo === 'no_configurado') return res.status(503).json({ error: 'previsión no configurada', codigo: 'no_configurado' });
    if (err.codigo === 'plan_no_encontrado') return res.status(404).json({ error: 'no se encontró el plan' });
    logger.error(`registrar gestión previsión (plan ${numPlan}): ${err.message}`);
    return res.status(502).json({ error: 'no se pudo registrar la gestión' });
  }
}

module.exports = { conceptos, gestion };
```

- [ ] **Step 2: Wire the routes**

En `src/routes/api.js`, require + rutas (junto a las otras de contactos/prevision):

```javascript
const previsionCtrl = require('../controllers/previsionController');
```
```javascript
router.get('/prevision/conceptos', requireAuth, previsionCtrl.conceptos);
router.post('/prevision/gestion', requireAuth, previsionCtrl.gestion);
```

- [ ] **Step 3: Full suite green**

Run: `... node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 4: Manual verification (con el GRANT aplicado, plan de prueba)**

```bash
curl -s localhost:3000/api/prevision/conceptos -H "Authorization: Bearer $TOK" | head -c 300
# Gestión INDIVIDUAL (sin posfecha, concepto no masivo): afecta 1 plan + traza
curl -s -X POST localhost:3000/api/prevision/gestion -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"numPlan": <PLAN_PRUEBA>, "concepto": "16", "novedad": "prueba gestión"}'
```
Expected: `{ok:true, masivo:false, afectados:1}`; y una fila nueva en `gestion`.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/previsionController.js src/routes/api.js
git commit -m "feat(prevision): endpoints GET /prevision/conceptos y POST /prevision/gestion"
```

---

## Task 3: Frontend — formulario "Registrar gestión" en el popup de previsión

**Files:**
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/components/PanelCliente.vue`

**Interfaces:**
- Consumes: `GET /prevision/conceptos`, `POST /prevision/gestion` (Task 2).
- Produces: `cargarConceptosPrevision()`, `registrarGestionPrevision(payload)`; formulario en el popup de previsión sobre `planSel`.

- [ ] **Step 1: Store actions**

En `frontend/src/stores/acciones.js`:

```javascript
    async cargarConceptosPrevision() {
      return (await apiFetch('/prevision/conceptos')).conceptos;
    },
    async registrarGestionPrevision(payload) {
      return apiFetch('/prevision/gestion', { method: 'POST', body: JSON.stringify(payload) });
    },
```

- [ ] **Step 2: Formulario en `PanelCliente.vue` (popup de previsión)**

READ `PanelCliente.vue` primero: la previsión usa `prev` (con `prev.planes`), `planSel` (plan
seleccionado en el popup), y el popup a lo ancho de previsión (Teleport). Añade dentro de
ese popup, cuando hay un `planSel`, la sección de gestión.

Script (`<script setup>`): estado y acciones:

```javascript
const conceptosPrev = ref([]);
const gest = ref({ concepto: '', novedad: '', posfecha: '', guardando: false, ok: '', error: '' });
onMounted(async () => { try { conceptosPrev.value = await acc.cargarConceptosPrevision(); } catch { /* queda vacío */ } });
// Masivo (aviso): todos los conceptos del desplegable son "permitidos", así que masivo = hay posfecha.
const gestMasivo = computed(() => !!gest.value.posfecha && (prev.value.planes?.length || 0) > 1);
async function registrarGestion() {
  if (!planSel.value || !gest.value.concepto || gest.value.guardando) return;
  gest.value.guardando = true; gest.value.ok = ''; gest.value.error = '';
  try {
    const r = await acc.registrarGestionPrevision({
      numPlan: planSel.value.num_plan,
      concepto: gest.value.concepto,
      novedad: gest.value.novedad,
      posfecha: gest.value.posfecha || null,
    });
    gest.value.ok = r.masivo ? `Gestión registrada en ${r.afectados} planes.` : 'Gestión registrada.';
    gest.value = { ...gest.value, novedad: '', posfecha: '' };
    if (c.value?.contacto?.id) consultarPrevision(); // refresca los planes con la nueva gestión
  } catch (e) {
    gest.value.error = e.message || 'No se pudo registrar la gestión.';
  } finally {
    gest.value.guardando = false;
  }
}
```
(Reinicia `gest` al cambiar de contacto/plan si conviene, siguiendo el patrón de reseteo ya existente.)

Template — dentro del popup de previsión, tras la tabla/detalle del `planSel`:

```html
        <div v-if="planSel" class="mt-3 border-t pt-3">
          <div class="text-[12px] font-semibold text-marca-oscuro mb-1">Registrar gestión · plan {{ planSel.num_plan }}</div>
          <div class="flex flex-wrap items-end gap-2 text-[12px]">
            <label class="flex flex-col">Concepto
              <select v-model="gest.concepto" class="border rounded px-2 py-1 min-w-[160px]">
                <option value="">Seleccione…</option>
                <option v-for="k in conceptosPrev" :key="k.codigo" :value="k.codigo">{{ k.descripcion }}</option>
              </select>
            </label>
            <label class="flex flex-col flex-1 min-w-[180px]">Novedad
              <input v-model="gest.novedad" maxlength="255" class="border rounded px-2 py-1" />
            </label>
            <label class="flex flex-col">Posfecha
              <input type="date" v-model="gest.posfecha" class="border rounded px-2 py-1" />
            </label>
            <button :disabled="!gest.concepto || gest.guardando"
              class="bg-marca text-white rounded-lg px-3 py-1.5 font-semibold disabled:opacity-60"
              @click="registrarGestion">{{ gest.guardando ? 'Guardando…' : 'Registrar' }}</button>
          </div>
          <p v-if="gestMasivo" class="text-[11px] text-amber-600 mt-1">⚠️ Con posfecha, esto actualizará los {{ prev.planes.length }} planes de esta cédula.</p>
          <p v-if="gest.ok" class="text-[12px] text-green-600 mt-1">{{ gest.ok }}</p>
          <p v-if="gest.error" class="text-[12px] text-red-600 mt-1">{{ gest.error }}</p>
        </div>
```

- [ ] **Step 3: Build + tests**

Run: `npm --prefix frontend run build && npm --prefix frontend test`
Expected: build sin errores; tests en verde.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/acciones.js frontend/src/components/PanelCliente.vue
git commit -m "feat(prevision): formulario para registrar gestión en el popup de previsión"
```

---

## Deploy (tras aprobar e implementar)

1. Confirmar el **GRANT** aplicado en `olivosct` (ya hecho).
2. `git pull` + `npm --prefix frontend run build` + `pm2 restart wa-backend`.
3. Verificación en vivo con un plan de prueba: gestión individual (sin posfecha) → `afectados:1` + fila en `gestion`; luego revisar en cartera que la novedad/concepto quedaron.

## Fuera de alcance

- Editar/anular gestiones; ver historial de `gestion`; gestión de mantenimiento/prenecesidad.
