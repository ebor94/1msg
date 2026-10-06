# Recepción multiagente con balanceo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir configurar desde la UI varios agentes de recepción y repartir los chats nuevos sin dueño al agente de recepción con menos chats abiertos.

**Architecture:** La config vive en `wa_ajustes` (clave `agentes_recepcion`, lista JSON de ids; respaldo al `.env`). Un servicio `recepcion.js` parsea la config y elige por carga; la regla 2 de la cascada (`asignacion.js`) usa esa lista, filtra activos, cuenta chats abiertos y elige el menos cargado. API admin GET/PUT y un panel de selección múltiple en el frontend.

**Tech Stack:** Node 20 CommonJS, Express, Sequelize, Vue 3 + Pinia + Vitest, `node:test`.

Spec: `docs/superpowers/specs/2026-10-06-recepcion-multiagente-design.md`.

## Global Constraints

- Node 20 CommonJS. Solo tablas `wa_`. Sin migración (la clave va en `wa_ajustes`, ya existente). Sin dependencias nuevas.
- La **continuidad (regla 1: dueño activo)** no cambia. La recepción **no marca dueño** (solo asigna la conversación).
- Respaldo: config vacía/corrupta → `env.agenteRecepcionId`; sin candidatos activos → bandeja general (nunca se pierde el chat).
- "Chats abiertos" de un agente = `Conversacion` con `agenteId = id` y `estado IN ('nueva','abierta')`.
- Constantes: `ESTADO_CONVERSACION.NUEVA='nueva'`, `.ABIERTA='abierta'`; `TIPO_ASIGNACION.AUTO_REGLA='auto_regla'`. Ajuste: `wa_ajustes(clave, valor)`.
- Solo admin cambia la config (`requireAuth + requireAdmin`).
- Test backend: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/<archivo>` (suite completa `test/*.test.js 2>&1 | tail -4`, reporter `ℹ`, confirmar `fail 0`).
- Test frontend: `npm --prefix frontend test` (un archivo: `-- <ruta>`); build `npm --prefix frontend run build`.

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `src/services/recepcion.js` | parseo + elección por carga + validación (puras) + lectura de config | Crear |
| `test/recepcion.test.js` | tests de las puras | Crear |
| `src/services/asignacion.js` | cascada regla 2 usa recepción + menos cargado | Modificar |
| `src/services/ingesta.js` | pasa `Conversacion` + `Ajuste` a `cascada` | Modificar |
| `test/asignacion.test.js` | tests de cascada | Crear |
| `src/controllers/ajustesController.js` | GET/PUT `/ajustes/recepcion` | Modificar |
| `src/routes/api.js` | rutas de recepción | Modificar |
| `frontend/src/stores/acciones.js` | `obtenerRecepcion`/`guardarRecepcion` | Modificar |
| `frontend/src/components/PanelRecepcion.vue` | panel admin de selección múltiple | Crear |
| `frontend/src/views/Bandeja.vue` | botón + montaje del panel | Modificar |

---

## Task 1: Servicio `recepcion.js` — puras + lectura de config

**Files:**
- Create: `src/services/recepcion.js`
- Test: `test/recepcion.test.js`

**Interfaces:**
- Produces: `parsearAgentesRecepcion(valor, fallbackId) → number[]`; `elegirRecepcion(candidatos, cargas) → number|null`; `validarIdsRecepcion(pedidos, idsActivos) → number[]` (ids pedidos que NO están activos); `agentesRecepcionConfigurados({ Ajuste }) → Promise<number[]>`; `CLAVE_RECEPCION = 'agentes_recepcion'`.

- [ ] **Step 1: Escribir los tests que fallan**

Create `test/recepcion.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsearAgentesRecepcion, elegirRecepcion, validarIdsRecepcion, agentesRecepcionConfigurados } = require('../src/services/recepcion');

test('parsearAgentesRecepcion: JSON válido → ids (dedup, filtra no-enteros)', () => {
  assert.deepEqual(parsearAgentesRecepcion('[4,7,7,0,"x",9]', 4), [4, 7, 9]);
});
test('parsearAgentesRecepcion: vacío/basura → [fallback]', () => {
  assert.deepEqual(parsearAgentesRecepcion('', 4), [4]);
  assert.deepEqual(parsearAgentesRecepcion('no-json', 4), [4]);
  assert.deepEqual(parsearAgentesRecepcion('[]', 4), [4]);
  assert.deepEqual(parsearAgentesRecepcion(null, 4), [4]);
});
test('parsearAgentesRecepcion: vacío y sin fallback válido → []', () => {
  assert.deepEqual(parsearAgentesRecepcion('[]', null), []);
});

test('elegirRecepcion: elige el de menor carga', () => {
  assert.equal(elegirRecepcion([4, 7, 9], { 4: 5, 7: 2, 9: 8 }), 7);
});
test('elegirRecepcion: empate → el primero del orden', () => {
  assert.equal(elegirRecepcion([9, 4, 7], { 9: 3, 4: 3, 7: 3 }), 9);
});
test('elegirRecepcion: carga faltante cuenta como 0', () => {
  assert.equal(elegirRecepcion([4, 7], { 4: 1 }), 7);
});
test('elegirRecepcion: lista vacía → null', () => {
  assert.equal(elegirRecepcion([], {}), null);
});

test('validarIdsRecepcion: devuelve los pedidos que no están activos', () => {
  assert.deepEqual(validarIdsRecepcion([4, 7, 9], [4, 9]), [7]);
  assert.deepEqual(validarIdsRecepcion([4, 9], [4, 9]), []);
});

test('agentesRecepcionConfigurados: lee la clave y parsea (con mock de Ajuste)', async () => {
  const Ajuste = { findOne: async () => ({ valor: '[7,9]' }) };
  assert.deepEqual(await agentesRecepcionConfigurados({ Ajuste }), [7, 9]);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/recepcion.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `recepcion.js`**

Create `src/services/recepcion.js`:

```js
'use strict';
const env = require('../config/env');

const CLAVE_RECEPCION = 'agentes_recepcion';

/** Pura: parsea la lista JSON de ids; vacío/corrupto → [fallbackId] si es válido, si no []. */
function parsearAgentesRecepcion(valor, fallbackId) {
  let ids = [];
  try {
    const arr = JSON.parse(valor);
    if (Array.isArray(arr)) ids = arr.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  } catch { ids = []; }
  ids = [...new Set(ids)];
  if (ids.length) return ids;
  return Number.isInteger(fallbackId) && fallbackId > 0 ? [fallbackId] : [];
}

/** Pura: de `candidatos` (en orden) el de menor `cargas[id]` (0 si falta); empate → el primero; vacío → null. */
function elegirRecepcion(candidatos, cargas) {
  let mejor = null;
  let mejorCarga = Infinity;
  for (const id of candidatos || []) {
    const c = (cargas && cargas[id]) || 0;
    if (c < mejorCarga) { mejor = id; mejorCarga = c; }
  }
  return mejor;
}

/** Pura: ids pedidos que NO están en la lista de activos. */
function validarIdsRecepcion(pedidos, idsActivos) {
  const activos = new Set(idsActivos || []);
  return (pedidos || []).filter((id) => !activos.has(id));
}

/** Lee la config efectiva (clave en wa_ajustes; respaldo al env). */
async function agentesRecepcionConfigurados({ Ajuste }) {
  const fila = await Ajuste.findOne({ where: { clave: CLAVE_RECEPCION } });
  return parsearAgentesRecepcion(fila ? fila.valor : null, env.agenteRecepcionId);
}

module.exports = { CLAVE_RECEPCION, parsearAgentesRecepcion, elegirRecepcion, validarIdsRecepcion, agentesRecepcionConfigurados };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/recepcion.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/recepcion.js test/recepcion.test.js
git commit -m "feat(recepcion): servicio de config y elección de agente por carga

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Cascada regla 2 → recepción multiagente por menos cargado

**Files:**
- Modify: `src/services/asignacion.js`
- Modify: `src/services/ingesta.js`
- Test: `test/asignacion.test.js`

**Interfaces:**
- Consumes: `agentesRecepcionConfigurados`, `elegirRecepcion` (Task 1); `ESTADO_CONVERSACION`, `TIPO_ASIGNACION`.
- Produces: `cascada(contacto, { Agente, Conversacion, Ajuste, transaction })` — regla 2 elige el agente de recepción activo con menos chats abiertos; `ingesta.js` pasa `Conversacion` y `Ajuste`.

- [ ] **Step 1: Escribir los tests que fallan**

Create `test/asignacion.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cascada } = require('../src/services/asignacion');

// Mocks mínimos
function AgenteMock({ porId = {}, activos = [] }) {
  return {
    findByPk: async (id) => porId[id] || null,
    findAll: async ({ where }) => activos.filter((a) => where.id.includes(a.id) && a.activo).map((a) => ({ id: a.id })),
  };
}
function ConversacionMock(cargas) {
  return { count: async ({ where }) => cargas[where.agenteId] || 0 };
}
function AjusteMock(valor) {
  return { findOne: async () => (valor === undefined ? null : { valor }) };
}

test('cascada: dueño activo → continuidad', async () => {
  const Agente = AgenteMock({ porId: { 5: { id: 5, activo: true } } });
  const r = await cascada({ agenteDuenoId: 5 }, { Agente, Conversacion: ConversacionMock({}), Ajuste: AjusteMock('[7,9]'), transaction: null });
  assert.equal(r.agenteId, 5);
});

test('cascada: sin dueño → recepción con menos chats abiertos', async () => {
  const Agente = AgenteMock({ activos: [{ id: 7, activo: true }, { id: 9, activo: true }] });
  const Conversacion = ConversacionMock({ 7: 10, 9: 3 });
  const r = await cascada({ agenteDuenoId: null }, { Agente, Conversacion, Ajuste: AjusteMock('[7,9]'), transaction: null });
  assert.equal(r.agenteId, 9);
});

test('cascada: recepción configurada pero ninguno activo → general', async () => {
  const Agente = AgenteMock({ activos: [] }); // nadie activo entre los pedidos
  const r = await cascada({ agenteDuenoId: null }, { Agente, Conversacion: ConversacionMock({}), Ajuste: AjusteMock('[7,9]'), transaction: null });
  assert.equal(r.agenteId, null);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/asignacion.test.js`
Expected: FAIL (la cascada aún usa el env de un solo agente; el test de "menos cargado" no se cumple / firma vieja).

- [ ] **Step 3: Implementar la nueva regla 2 en `asignacion.js`**

Replace the body of `src/services/asignacion.js` from the `require`s down through `cascada`, keeping regla 1 unchanged, with:

```js
'use strict';

const { Op } = require('sequelize');
const { TIPO_ASIGNACION, ESTADO_CONVERSACION } = require('../config/constants');
const { agentesRecepcionConfigurados, elegirRecepcion } = require('./recepcion');

/**
 * Cascada de asignación de una conversación entrante:
 *   1. Dueño activo → ese agente (continuidad).
 *   2. Sin dueño → agente de recepción configurado y activo con MENOS chats abiertos.
 *   3. Sin candidatos → bandeja general (fallback).
 */
async function cascada(contacto, { Agente, Conversacion, Ajuste, transaction }) {
  // Regla 1: dueño histórico, solo si sigue activo.
  if (contacto.agenteDuenoId) {
    const dueno = await Agente.findByPk(contacto.agenteDuenoId, { transaction });
    if (dueno && dueno.activo) {
      return { agenteId: dueno.id, tipo: TIPO_ASIGNACION.AUTO_CONTINUIDAD, motivo: 'continuidad: contacto con agente dueño' };
    }
  }

  // Regla 2: recepción configurada → activos → menos cargado.
  const ids = await agentesRecepcionConfigurados({ Ajuste });
  if (ids.length) {
    const filasActivas = await Agente.findAll({ where: { id: ids, activo: true }, attributes: ['id'], transaction });
    const activosSet = new Set(filasActivas.map((a) => a.id));
    const activos = ids.filter((id) => activosSet.has(id)); // preserva el orden configurado (desempate)
    if (activos.length) {
      const cargas = {};
      for (const id of activos) {
        cargas[id] = await Conversacion.count({
          where: { agenteId: id, estado: { [Op.in]: [ESTADO_CONVERSACION.NUEVA, ESTADO_CONVERSACION.ABIERTA] } },
          transaction,
        });
      }
      const elegido = elegirRecepcion(activos, cargas);
      if (elegido) {
        return { agenteId: elegido, tipo: TIPO_ASIGNACION.AUTO_REGLA, motivo: `recepción (menos cargado): agente ${elegido}` };
      }
    }
  }

  // Regla 3: sin recepción disponible → general.
  return { agenteId: null, tipo: TIPO_ASIGNACION.AUTO_REGLA, motivo: 'bandeja general' };
}

module.exports = { cascada };
```

- [ ] **Step 4: `ingesta.js` pasa `Conversacion` y `Ajuste`**

In `src/services/ingesta.js`, add `Ajuste` to the models import (línea 14):

```js
const { sequelize, Canal, Agente, Contacto, Conversacion, Mensaje, Asignacion, Ajuste } = require('../models');
```

Then update **both** `cascada(contacto, { Agente, transaction })` calls (hay exactamente 2, líneas ~99 y ~123, ambas dentro de `resolverConversacion`, donde `Agente`/`Conversacion`/`Ajuste` son del módulo y `transaction` es el parámetro) a:

```js
    const asig = await cascada(contacto, { Agente, Conversacion, Ajuste, transaction });
```

- [ ] **Step 5: Verificar sintaxis + tests (+ suite)**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/services/asignacion.js && node --check src/services/ingesta.js && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/asignacion.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)" && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js 2>&1 | tail -4
```
Expected: sintaxis OK; asignación PASS; suite `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/services/asignacion.js src/services/ingesta.js test/asignacion.test.js
git commit -m "feat(recepcion): cascada reparte chats nuevos al agente de recepción menos cargado

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: API admin GET/PUT `/ajustes/recepcion`

**Files:**
- Modify: `src/controllers/ajustesController.js`
- Modify: `src/routes/api.js`

**Interfaces:**
- Consumes: `parsearAgentesRecepcion`, `validarIdsRecepcion`, `CLAVE_RECEPCION` (Task 1); `Ajuste`, `Agente` (models); `env`.
- Produces: `GET /api/ajustes/recepcion → { agentes:number[] }` (efectivos); `PUT /api/ajustes/recepcion` body `{ agentes:number[] }` (valida existan+activos, 422 si no; guarda JSON).

- [ ] **Step 1: Implementar los handlers**

In `src/controllers/ajustesController.js`, add imports at the top (junto a los existentes):

```js
const { Agente } = require('../models');
const env = require('../config/env');
const { CLAVE_RECEPCION, parsearAgentesRecepcion, validarIdsRecepcion } = require('../services/recepcion');
```

Add the two handlers:

```js
/** GET /api/ajustes/recepcion — ids de agentes de recepción efectivos. */
async function obtenerRecepcion(req, res) {
  try {
    const fila = await Ajuste.findOne({ where: { clave: CLAVE_RECEPCION } });
    return res.json({ agentes: parsearAgentesRecepcion(fila ? fila.valor : null, env.agenteRecepcionId) });
  } catch (err) {
    logger.error(`obtener recepción: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

/** PUT /api/ajustes/recepcion — guarda la lista de agentes de recepción (admin). */
async function guardarRecepcion(req, res) {
  const crudos = req.body && req.body.agentes;
  if (!Array.isArray(crudos)) return res.status(422).json({ error: 'agentes debe ser una lista de ids' });
  const unicos = [...new Set(crudos.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  try {
    if (unicos.length) {
      const activas = await Agente.findAll({ where: { id: unicos, activo: true }, attributes: ['id'] });
      const invalidos = validarIdsRecepcion(unicos, activas.map((a) => a.id));
      if (invalidos.length) return res.status(422).json({ error: `agentes inválidos o inactivos: ${invalidos.join(', ')}` });
    }
    const valor = JSON.stringify(unicos);
    const [fila, creada] = await Ajuste.findOrCreate({ where: { clave: CLAVE_RECEPCION }, defaults: { clave: CLAVE_RECEPCION, valor } });
    if (!creada) await fila.update({ valor });
    return res.json({ agentes: unicos });
  } catch (err) {
    logger.error(`guardar recepción: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

Add both to `module.exports` (junto a `obtenerPromptIa, guardarPromptIa`).

- [ ] **Step 2: Rutas**

In `src/routes/api.js`, after the `ia-gestion-prompt` routes (~línea 122), add:

```js
router.get('/ajustes/recepcion', requireAuth, requireAdmin, ajustesCtrl.obtenerRecepcion);
router.put('/ajustes/recepcion', requireAuth, requireAdmin, ajustesCtrl.guardarRecepcion);
```

- [ ] **Step 3: Verificar sintaxis + suite (sin regresiones)**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/controllers/ajustesController.js && node --check src/routes/api.js && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js 2>&1 | tail -4
```
Expected: sintaxis OK; `fail 0`. (La validación pura `validarIdsRecepcion` ya está cubierta por `test/recepcion.test.js`; los handlers se validan en vivo.)

- [ ] **Step 4: Commit**

```bash
git add src/controllers/ajustesController.js src/routes/api.js
git commit -m "feat(recepcion): API admin GET/PUT /ajustes/recepcion

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — panel admin de recepción

**Files:**
- Modify: `frontend/src/stores/acciones.js`
- Create: `frontend/src/components/PanelRecepcion.vue`
- Modify: `frontend/src/views/Bandeja.vue`

**Interfaces:**
- Consumes: `GET`/`PUT /ajustes/recepcion` (Task 3); `GET /agentes` (`acc.cargarAgentes`, agentes activos `{id, usuario, nombre, rol}`).

- [ ] **Step 1: Métodos del store**

In `frontend/src/stores/acciones.js`, after `guardarPromptIa` (~línea 264), add:

```js
    async obtenerRecepcion() {
      return (await apiFetch('/ajustes/recepcion')).agentes;
    },
    async guardarRecepcion(ids) {
      return (await apiFetch('/ajustes/recepcion', { method: 'PUT', body: JSON.stringify({ agentes: ids }) })).agentes;
    },
```

- [ ] **Step 2: Panel `PanelRecepcion.vue`**

Create `frontend/src/components/PanelRecepcion.vue` (espeja `PanelPromptIa.vue`):

```vue
<script setup>
import { ref, onMounted } from 'vue';
import { useAcciones } from '../stores/acciones';
const emit = defineEmits(['cerrar']);
const acc = useAcciones();
const seleccion = ref(new Set());
const guardando = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    if (!acc.agentes.length) await acc.cargarAgentes();
    const ids = await acc.obtenerRecepcion();
    seleccion.value = new Set(ids);
  } catch { error.value = 'No se pudo cargar.'; }
});

function toggle(id) {
  const s = new Set(seleccion.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  seleccion.value = s;
}

async function guardar() {
  error.value = ''; guardando.value = true;
  try { await acc.guardarRecepcion([...seleccion.value]); emit('cerrar'); }
  catch (e) { error.value = e.message || 'No se pudo guardar.'; }
  finally { guardando.value = false; }
}
</script>
<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-md flex flex-col max-h-[85vh]">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Agentes de recepción (chats nuevos)</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>
      <div class="p-4 space-y-2 overflow-auto">
        <p class="text-[12px] text-gray-500">Los chats nuevos sin dueño se reparten entre los seleccionados (al de menos chats abiertos). Si no marcas ninguno, van a la bandeja general.</p>
        <label v-for="a in acc.agentes" :key="a.id" class="flex items-center gap-2 py-1 text-[13px] text-gray-800">
          <input type="checkbox" :checked="seleccion.has(a.id)" @change="toggle(a.id)" />
          {{ a.nombre }} <span class="text-gray-400">({{ a.usuario }})</span>
        </label>
        <p v-if="error" class="text-[12px] text-red-600">{{ error }}</p>
      </div>
      <div class="border-t px-4 py-3 flex justify-end gap-2">
        <button class="px-3 py-1.5 text-[13px] text-gray-500" @click="emit('cerrar')">Cancelar</button>
        <button :disabled="guardando" class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px] disabled:opacity-60" @click="guardar">
          {{ guardando ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Montar en `Bandeja.vue`**

In `frontend/src/views/Bandeja.vue`:
- Import the component with the others: `import PanelRecepcion from '../components/PanelRecepcion.vue';`
- Add a ref next to `mostrarPromptIa`: `const mostrarRecepcion = ref(false);`
- Add a menu button next to the "🤖 Prompt IA" button (línea ~118), mismo estilo:
  ```html
  <button class="..." @click="menuAbierto = false; mostrarRecepcion = true">👥 Recepción</button>
  ```
  (copia las clases EXACTAS del botón "🤖 Prompt IA" contiguo.)
- Mount next to `<PanelPromptIa ...>` (línea ~176):
  ```html
  <PanelRecepcion v-if="mostrarRecepcion" @cerrar="mostrarRecepcion = false" />
  ```

- [ ] **Step 4: Suite frontend + build**

Run: `npm --prefix frontend test` (todo verde) y `npm --prefix frontend run build` (OK).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/acciones.js frontend/src/components/PanelRecepcion.vue frontend/src/views/Bandeja.vue
git commit -m "feat(recepcion): panel admin para seleccionar agentes de recepción

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Despliegue (tras merge)

Backend (asignación/ingesta/API) + worker (usa `asignacion.js`/`ingesta.js`) + frontend; sin migración:
```bash
ssh mantix 'cd ~/apps/wa && git pull --ff-only && npm --prefix frontend run build && pm2 restart wa-backend wa-worker'
```

**Verificación en vivo (usuario):**
1. Como admin, abrir el panel "👥 Recepción", marcar 2–3 agentes, guardar.
2. Que entren chats nuevos de contactos **sin dueño** → se asignan al agente de recepción con menos chats abiertos (se reparten).
3. Dejar un solo agente marcado → todo nuevo va a él. Desmarcar todos → caen a general.
4. Un contacto con dueño activo sigue cayendo a su agente (continuidad, sin regresión).

## Self-review

- **Cobertura del spec:** config+puras (T1), cascada menos-cargado + ingesta (T2), API admin (T3), panel UI (T4). Sin migración.
- **Tipos consistentes:** `parsearAgentesRecepcion(valor, fallbackId)→number[]`; `elegirRecepcion(candidatos,cargas)→number|null`; `validarIdsRecepcion(pedidos,idsActivos)→number[]`; `agentesRecepcionConfigurados({Ajuste})→number[]`; `cascada(contacto,{Agente,Conversacion,Ajuste,transaction})`; clave `agentes_recepcion`; endpoints `/ajustes/recepcion`.
- **Sin placeholders:** cada paso trae código real y comando con salida esperada.
