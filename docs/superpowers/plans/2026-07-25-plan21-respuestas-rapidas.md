# Plan 21 — Respuestas rápidas (por agente) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada agente cree su lista de respuestas rápidas (atajos de texto) y, al elegir una, se **inserte en el compositor** para editarla y enviarla. NO son plantillas de WhatsApp.

**Architecture:** Tabla `wa_respuestas_rapidas` (por `agente_id`) + CRUD REST acotado a `req.agente.id`. Frontend: botón ⚡ en el compositor abre un panel que lista/crea/edita/borra las respuestas; al elegir una, su texto entra en el campo de escribir.

**Tech Stack:** Express/Sequelize (backend); Vue 3/Pinia (frontend). Migración nueva (tabla `wa_`).

## Global Constraints

- Cada agente solo ve/edita/borra las suyas (filtro y verificación por `agenteId = req.agente.id`).
- Son texto libre (no pasan por 1msg al crearlas); al enviarlas se usa el flujo de texto normal (`chat.enviar`), con su firma. No confundir con plantillas.
- Título ≤ 80, texto ≤ 2000 (trim; requeridos).
- `'use strict'`, CommonJS backend; sin `console.log`; sin token al frontend.

## File Structure

- `docs/migraciones/002-respuestas-rapidas.sql` (crear).
- `src/models/RespuestaRapida.js` (crear) + `src/models/index.js` (registrar).
- `src/controllers/respuestasController.js` (crear): listar/crear/actualizar/eliminar.
- `src/routes/api.js` (modificar): rutas `/respuestas`.
- `frontend/src/stores/respuestas.js` (crear): store CRUD.
- `frontend/src/components/PanelRespuestas.vue` (crear): panel lista + gestión.
- `frontend/src/components/Compositor.vue` (modificar): botón ⚡ + insertar en el texto.

---

### Task 1: Backend — tabla, modelo y CRUD

**Files:**
- Create: `docs/migraciones/002-respuestas-rapidas.sql`, `src/models/RespuestaRapida.js`, `src/controllers/respuestasController.js`
- Modify: `src/models/index.js`, `src/routes/api.js`

**Interfaces:**
- `GET /api/respuestas` → `{ respuestas: [{id, titulo, texto}] }` (las mías).
- `POST /api/respuestas` `{titulo, texto}` → 201 `{ respuesta }`.
- `PATCH /api/respuestas/:id` `{titulo, texto}` → 200 `{ respuesta }`; 404 si no es mía.
- `DELETE /api/respuestas/:id` → 200 `{ ok: true }`; 404 si no es mía.

- [ ] **Step 1: Migración**

`docs/migraciones/002-respuestas-rapidas.sql`:

```sql
-- Respuestas rápidas por agente (atajos de texto libre; NO son plantillas de WhatsApp).
CREATE TABLE wa_respuestas_rapidas (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  agente_id      INT UNSIGNED  NOT NULL,
  titulo         VARCHAR(80)   NOT NULL,
  texto          VARCHAR(2000) NOT NULL,
  creado_en      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rr_agente (agente_id)
);
```

- [ ] **Step 2: Modelo `src/models/RespuestaRapida.js`** (patrón `NotaInterna`)

```js
'use strict';

/** wa_respuestas_rapidas — atajos de texto que cada agente guarda para responder rápido. */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RespuestaRapida',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      agenteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      titulo: { type: DataTypes.STRING(80), allowNull: false },
      texto: { type: DataTypes.STRING(2000), allowNull: false },
    },
    {
      tableName: 'wa_respuestas_rapidas',
      timestamps: true,
      createdAt: 'creado_en',
      updatedAt: 'actualizado_en',
    },
  );
```

Registrar en `src/models/index.js` (junto a los otros `const X = require('./X')(...)` y en `module.exports`):

```js
const RespuestaRapida = require('./RespuestaRapida')(sequelize, DataTypes);
```

(No hace falta asociación; se filtra por `agenteId` en el controlador. Añadir `RespuestaRapida` al objeto exportado.)

- [ ] **Step 3: Controlador `src/controllers/respuestasController.js`**

```js
'use strict';

const { RespuestaRapida } = require('../models');
const logger = require('../utils/logger');

function limpiar(s, max) {
  return String(s == null ? '' : s).trim().slice(0, max);
}
function forma(r) {
  return { id: r.id, titulo: r.titulo, texto: r.texto };
}

async function listar(req, res) {
  try {
    const filas = await RespuestaRapida.findAll({ where: { agenteId: req.agente.id }, order: [['id', 'ASC']] });
    return res.json({ respuestas: filas.map(forma) });
  } catch (err) {
    logger.error(`listar respuestas: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function crear(req, res) {
  const titulo = limpiar(req.body && req.body.titulo, 80);
  const texto = limpiar(req.body && req.body.texto, 2000);
  if (!titulo || !texto) return res.status(400).json({ error: 'título y texto requeridos' });
  try {
    const r = await RespuestaRapida.create({ agenteId: req.agente.id, titulo, texto });
    return res.status(201).json({ respuesta: forma(r) });
  } catch (err) {
    logger.error(`crear respuesta: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function actualizar(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  const titulo = limpiar(req.body && req.body.titulo, 80);
  const texto = limpiar(req.body && req.body.texto, 2000);
  if (!titulo || !texto) return res.status(400).json({ error: 'título y texto requeridos' });
  try {
    const r = await RespuestaRapida.findByPk(id);
    if (!r || r.agenteId !== req.agente.id) return res.status(404).json({ error: 'no encontrada' });
    await r.update({ titulo, texto });
    return res.json({ respuesta: forma(r) });
  } catch (err) {
    logger.error(`actualizar respuesta ${id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function eliminar(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const r = await RespuestaRapida.findByPk(id);
    if (!r || r.agenteId !== req.agente.id) return res.status(404).json({ error: 'no encontrada' });
    await r.destroy();
    return res.json({ ok: true });
  } catch (err) {
    logger.error(`eliminar respuesta ${id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { listar, crear, actualizar, eliminar };
```

- [ ] **Step 4: Rutas en `src/routes/api.js`**

```js
const respuestasCtrl = require('../controllers/respuestasController');
// ... junto a las demás rutas:
router.get('/respuestas', requireAuth, respuestasCtrl.listar);
router.post('/respuestas', requireAuth, respuestasCtrl.crear);
router.patch('/respuestas/:id', requireAuth, respuestasCtrl.actualizar);
router.delete('/respuestas/:id', requireAuth, respuestasCtrl.eliminar);
```

- [ ] **Step 5: Verificar carga + suite**

```
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node -e "require('./src/models'); require('./src/routes'); console.log('carga OK')"
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js
```
Expected: "carga OK" y suite verde. (Handlers con DB → prueba real, Tarea 3.)

- [ ] **Step 6: Commit**

```bash
git add docs/migraciones/002-respuestas-rapidas.sql src/models/RespuestaRapida.js src/models/index.js src/controllers/respuestasController.js src/routes/api.js
git commit -m "feat(respuestas): tabla + CRUD de respuestas rápidas por agente"
```

---

### Task 2: Frontend — store + panel ⚡ en el compositor

**Files:**
- Create: `frontend/src/stores/respuestas.js`, `frontend/src/components/PanelRespuestas.vue`
- Modify: `frontend/src/components/Compositor.vue`

**Interfaces:**
- Store `respuestas`: `items`, `cargar()`, `crear(titulo,texto)`, `actualizar(id,titulo,texto)`, `eliminar(id)`.

- [ ] **Step 1: Store `frontend/src/stores/respuestas.js`**

```js
import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';

export const useRespuestas = defineStore('respuestas', {
  state: () => ({ items: [], cargadas: false }),
  actions: {
    async cargar() {
      try {
        this.items = (await apiFetch('/respuestas')).respuestas;
        this.cargadas = true;
      } catch {
        this.items = [];
      }
    },
    async crear(titulo, texto) {
      const r = await apiFetch('/respuestas', { method: 'POST', body: JSON.stringify({ titulo, texto }) });
      this.items.push(r.respuesta);
    },
    async actualizar(id, titulo, texto) {
      const r = await apiFetch(`/respuestas/${id}`, { method: 'PATCH', body: JSON.stringify({ titulo, texto }) });
      const i = this.items.findIndex((x) => x.id === id);
      if (i !== -1) this.items[i] = r.respuesta;
    },
    async eliminar(id) {
      await apiFetch(`/respuestas/${id}`, { method: 'DELETE' });
      this.items = this.items.filter((x) => x.id !== id);
    },
  },
});
```

- [ ] **Step 2: `frontend/src/components/PanelRespuestas.vue`**

```vue
<script setup>
import { ref, onMounted } from 'vue';
import { useRespuestas } from '../stores/respuestas';

const emit = defineEmits(['elegir', 'cerrar']);
const resp = useRespuestas();

const editando = ref(null); // null | 'nueva' | id
const titulo = ref('');
const texto = ref('');
const guardando = ref(false);
const error = ref('');

onMounted(() => { if (!resp.cargadas) resp.cargar(); });

function nueva() { editando.value = 'nueva'; titulo.value = ''; texto.value = ''; error.value = ''; }
function editar(r) { editando.value = r.id; titulo.value = r.titulo; texto.value = r.texto; error.value = ''; }
function cancelar() { editando.value = null; error.value = ''; }

async function guardar() {
  const t = titulo.value.trim();
  const x = texto.value.trim();
  if (!t || !x) { error.value = 'Título y texto son obligatorios.'; return; }
  guardando.value = true;
  try {
    if (editando.value === 'nueva') await resp.crear(t, x);
    else await resp.actualizar(editando.value, t, x);
    editando.value = null;
  } catch {
    error.value = 'No se pudo guardar.';
  } finally {
    guardando.value = false;
  }
}
async function borrar(r) {
  if (!window.confirm(`¿Borrar "${r.titulo}"?`)) return;
  try { await resp.eliminar(r.id); } catch { /* noop */ }
}
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg p-4 w-[420px] max-h-[80vh] overflow-auto shadow-lg">
      <div class="flex justify-between items-center mb-3">
        <h3 class="text-sm font-semibold text-gray-800">Respuestas rápidas</h3>
        <button class="text-gray-400 text-sm" @click="emit('cerrar')">✕</button>
      </div>

      <!-- Formulario crear/editar -->
      <div v-if="editando !== null" class="mb-3 border-b border-gray-100 pb-3">
        <input v-model="titulo" maxlength="80" placeholder="Título (ej. Saludo)" class="w-full border rounded px-2 py-1.5 text-[13px] mb-2" />
        <textarea v-model="texto" maxlength="2000" rows="3" placeholder="Texto de la respuesta…" class="w-full border rounded px-2 py-1.5 text-[13px] mb-2"></textarea>
        <div v-if="error" class="text-[12px] text-red-500 mb-2">{{ error }}</div>
        <div class="flex justify-end gap-2">
          <button class="text-[12px] text-gray-500 px-2 py-1" @click="cancelar">Cancelar</button>
          <button :disabled="guardando" class="text-[12px] bg-marca text-white rounded-lg px-3 py-1 font-semibold disabled:opacity-60" @click="guardar">
            {{ guardando ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </div>

      <!-- Lista -->
      <button v-if="editando === null" class="text-[12px] text-marca-oscuro font-semibold mb-2" @click="nueva">＋ Nueva respuesta</button>
      <div v-for="r in resp.items" :key="r.id" class="border-b border-gray-100 py-2 flex items-start gap-2">
        <div class="flex-1 min-w-0 cursor-pointer" @click="emit('elegir', r.texto)">
          <div class="text-[13px] font-medium text-gray-800">{{ r.titulo }}</div>
          <div class="text-[12px] text-gray-500 line-clamp-2">{{ r.texto }}</div>
        </div>
        <button class="text-gray-400 text-xs" title="Editar" @click="editar(r)">✎</button>
        <button class="text-gray-400 text-xs" title="Borrar" @click="borrar(r)">🗑</button>
      </div>
      <div v-if="!resp.items.length && editando === null" class="text-center text-gray-400 text-sm py-4">
        Aún no tienes respuestas. Crea una con "＋ Nueva".
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Botón ⚡ + inserción en `frontend/src/components/Compositor.vue`**

En `<script setup>`: importar el panel y añadir estado + función de inserción (el compositor ya tiene el `ref texto`):

```js
import PanelRespuestas from './PanelRespuestas.vue';
const mostrarRespuestas = ref(false);
function insertarRespuesta(t) {
  texto.value = texto.value.trim() ? `${texto.value.trim()} ${t}` : t;
  mostrarRespuestas.value = false;
}
```

En la fila del compositor (ventana abierta, junto a los botones 📄/📎/🎤), añadir el botón ⚡:

```vue
      <button @click="mostrarRespuestas = true" title="Respuestas rápidas"
        class="w-10 h-10 rounded-full bg-white text-marca-oscuro grid place-items-center shrink-0 hover:bg-gray-100">⚡</button>
```

Y montar el panel (junto a `<SelectorPlantilla>`):

```vue
    <PanelRespuestas v-if="mostrarRespuestas" @elegir="insertarRespuesta" @cerrar="mostrarRespuestas = false" />
```

- [ ] **Step 4: Verificar suite y build**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/respuestas.js frontend/src/components/PanelRespuestas.vue frontend/src/components/Compositor.vue
git commit -m "feat(frontend): respuestas rápidas (⚡ en el compositor) — listar/crear/editar/insertar"
```

---

### Task 3: Migración + despliegue + prueba real

- [ ] **Step 1: Migración.** En el servidor aplicar `docs/migraciones/002-respuestas-rapidas.sql` sobre `serfuweb` (crea `wa_respuestas_rapidas`). Confirmar la tabla.
- [ ] **Step 2: Deploy.** Merge a `main`, push. En el servidor: `git pull`, `npm --prefix frontend run build`, `pm2 restart wa-backend`. `/health` 200; `GET /api/respuestas` sin token → 401.
- [ ] **Step 3: Prueba real.** En un chat con ventana abierta: ⚡ → "＋ Nueva" → crear una respuesta (título + texto) → aparece en la lista; elegirla → su texto entra en el compositor y puedes editarlo y enviarlo. Editar y borrar una. Entrar con OTRO agente y confirmar que **no** ve las de otro (cada quien las suyas).

---

## Notas de cobertura (Plan 21)

Cubre: respuestas rápidas por agente (CRUD server-side), panel ⚡ en el compositor, e inserción en el campo de texto para editar antes de enviar. Claramente separadas de las plantillas de WhatsApp. **Fuera de alcance:** respuestas compartidas por equipo, variables/placeholders dentro de la respuesta, atajos con "/", orden manual.
