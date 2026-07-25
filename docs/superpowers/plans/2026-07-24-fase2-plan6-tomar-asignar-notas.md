# Fase 2 · Plan 6 — Tomar / asignar chats + notas + crear contacto

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un agente tome un chat de general (atómico, queda su dueño), reasigne un chat a otro agente o a general (transfiriendo la propiedad), agregue/vea notas internas, y cree un contacto suyo. Los cambios de asignación se reflejan en vivo en las bandejas.

**Architecture:** Endpoints REST bajo `/api` que operan en transacción; la toma usa un UPDATE atómico con guarda (`agente_id IS NULL`) → 409 si otro se adelantó. Cada cambio de asignación registra `wa_asignaciones` y emite `conversacion:asignada` a los rooms del agente anterior y el nuevo (+ general/admins) para que las listas se actualicen. Frontend: acciones en el panel de cliente + un store, y el socket recarga la bandeja al recibir la asignación.

**Tech Stack:** Express/Sequelize/`node:test` (backend), Vue 3/Pinia/Vitest (frontend). Reutiliza el socket del Plan 5.

## Global Constraints

- **Toma atómica**: nunca `SELECT`+`UPDATE`. `UPDATE … SET agente_id=:me … WHERE id=:id AND agente_id IS NULL`; si `affectedRows=0` → 409.
- Al tomar o reasignar a un agente B: la conversación queda con `agente_id=B` Y el contacto con `agente_dueno_id=B` (continuidad). Reasignar a **general** limpia ambos (`agente_id=NULL`, `agente_dueno_id=NULL`).
- Toda asignación se audita en `wa_asignaciones` (`de_agente_id`, `a_agente_id`, `tipo`, `ejecutado_por_id`).
- Asesores y admins pueden reasignar cualquier chat (decisión 2026-07-24). El endpoint de reasignar NO exige `puedeVer`.
- Persistir antes de emitir; emitir a rooms del agente anterior y el nuevo.
- Nombres de dominio en español, técnicos en inglés; `'use strict'`, CommonJS; nada de `console.log`.
- Tests de lógica pura con `node:test`; el resto se valida en navegador.

---

### Task 1: Tomar y reasignar (backend)

**Files:**
- Modify: `src/sockets/emisor.js` (+ `emitirARooms`)
- Create: `src/services/asignacionManual.js` (helpers puros: `tipoDeAsignacion`, `roomsDeAsignacion`)
- Test: `test/asignacion-manual.test.js`
- Modify: `src/controllers/conversacionesController.js` (`tomar`, `asignar`)
- Modify: `src/routes/api.js`

**Interfaces:**
- `emitirARooms(evento, rooms, payload)` — emite a un conjunto de rooms (unión, sin repetir).
- `tipoDeAsignacion(deAgenteId, aAgenteId)`: `toma_manual` si de=null; `devuelta_general` si a=null; si no `reasignacion`.
- `roomsDeAsignacion(deAgenteId, aAgenteId)`: unión de rooms de origen y destino (usa `roomsPara`), sin duplicados.
- `POST /api/conversaciones/:id/tomar` → 200 `{ conversacion }`; 409 si ya la tomaron; 404.
- `POST /api/conversaciones/:id/asignar` body `{ agenteId: number|null }` → 200 `{ conversacion }`; 400 (agenteId inválido); 404.

- [ ] **Step 1: Test de lógica pura**

`test/asignacion-manual.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tipoDeAsignacion, roomsDeAsignacion } = require('../src/services/asignacionManual');

test('tipoDeAsignacion', () => {
  assert.equal(tipoDeAsignacion(null, 5), 'toma_manual');
  assert.equal(tipoDeAsignacion(3, null), 'devuelta_general');
  assert.equal(tipoDeAsignacion(3, 5), 'reasignacion');
});

test('roomsDeAsignacion une origen y destino sin duplicar', () => {
  const r = roomsDeAsignacion(3, 5);
  assert.ok(r.includes('agente:3') && r.includes('agente:5') && r.includes('admins'));
  assert.equal(new Set(r).size, r.length);
  const g = roomsDeAsignacion(null, 5);
  assert.ok(g.includes('general') && g.includes('agente:5'));
});
```

- [ ] **Step 2: Correr → FAIL** (`<env dummy> node --test test/asignacion-manual.test.js`).
`<env dummy>` = `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=x ONEMSG_INSTANCE_ID=x ONEMSG_TOKEN=x WEBHOOK_SECRET=x LOG_LEVEL=warn`

- [ ] **Step 3: Implementar helpers + emisor**

`src/services/asignacionManual.js`:

```js
'use strict';
const { roomsPara } = require('../sockets/emisor');
const { TIPO_ASIGNACION } = require('../config/constants');

function tipoDeAsignacion(deAgenteId, aAgenteId) {
  if (!deAgenteId) return TIPO_ASIGNACION.TOMA_MANUAL;
  if (!aAgenteId) return TIPO_ASIGNACION.DEVUELTA_GENERAL;
  return TIPO_ASIGNACION.REASIGNACION;
}

function roomsDeAsignacion(deAgenteId, aAgenteId) {
  const origen = roomsPara({ agenteId: deAgenteId, general: !deAgenteId });
  const destino = roomsPara({ agenteId: aAgenteId, general: !aAgenteId });
  return [...new Set([...origen, ...destino])];
}

module.exports = { tipoDeAsignacion, roomsDeAsignacion };
```

En `src/sockets/emisor.js`, agregar y exportar:

```js
function emitirARooms(evento, rooms, payload) {
  const io = getIo();
  if (!io) return;
  let canal = io;
  for (const r of rooms) canal = canal.to(r);
  canal.emit(evento, payload);
}
```

- [ ] **Step 4: Correr → PASS.**

- [ ] **Step 5: Handlers `tomar` y `asignar`**

En `src/controllers/conversacionesController.js` (importar `sequelize` de `../config/database`, `Asignacion` de `../models`, `emitirARooms`, `tipoDeAsignacion`, `roomsDeAsignacion`, `Contacto` ya está):

```js
async function tomar(req, res) {
  const id = req.params.id;
  const me = req.agente.id;
  try {
    const conv = await Conversacion.findByPk(id);
    if (!conv) return res.status(404).json({ error: 'no encontrada' });

    const resultado = await sequelize.transaction(async (t) => {
      const [n] = await Conversacion.update(
        { agenteId: me, tomadaEn: new Date(), estado: ESTADO_CONVERSACION.ABIERTA },
        { where: { id, agenteId: null }, transaction: t },
      );
      if (n === 0) return null; // otro se adelantó
      await Contacto.update({ agenteDuenoId: me }, { where: { id: conv.contactoId }, transaction: t });
      await Asignacion.create(
        { conversacionId: id, deAgenteId: null, aAgenteId: me, tipo: TIPO_ASIGNACION.TOMA_MANUAL, ejecutadoPorId: me },
        { transaction: t },
      );
      return true;
    });
    if (!resultado) return res.status(409).json({ error: 'otro agente ya la tomó', codigo: 'tomada' });

    emitirARooms('conversacion:asignada', roomsDeAsignacion(null, me), { conversacionId: Number(id), agenteId: me });
    const actualizada = await Conversacion.findByPk(id);
    return res.json({ conversacion: actualizada });
  } catch (err) {
    logger.error(`tomar conversación ${id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function asignar(req, res) {
  const id = req.params.id;
  const me = req.agente.id;
  const nuevo = req.body && req.body.agenteId != null ? Number(req.body.agenteId) : null;
  if (req.body && req.body.agenteId != null && !Number.isInteger(nuevo)) {
    return res.status(400).json({ error: 'agenteId inválido' });
  }
  try {
    const conv = await Conversacion.findByPk(id);
    if (!conv) return res.status(404).json({ error: 'no encontrada' });
    if (nuevo) {
      const ag = await Agente.findByPk(nuevo);
      if (!ag || !ag.activo) return res.status(400).json({ error: 'agente destino inválido' });
    }
    const anterior = conv.agenteId;

    await sequelize.transaction(async (t) => {
      await Conversacion.update(
        { agenteId: nuevo, estado: nuevo ? ESTADO_CONVERSACION.ABIERTA : ESTADO_CONVERSACION.NUEVA },
        { where: { id }, transaction: t },
      );
      await Contacto.update({ agenteDuenoId: nuevo }, { where: { id: conv.contactoId }, transaction: t });
      await Asignacion.create(
        { conversacionId: id, deAgenteId: anterior, aAgenteId: nuevo, tipo: tipoDeAsignacion(anterior, nuevo), ejecutadoPorId: me },
        { transaction: t },
      );
    });

    emitirARooms('conversacion:asignada', roomsDeAsignacion(anterior, nuevo), { conversacionId: Number(id), agenteId: nuevo });
    const actualizada = await Conversacion.findByPk(id);
    return res.json({ conversacion: actualizada });
  } catch (err) {
    logger.error(`asignar conversación ${id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

Exportar `tomar` y `asignar`.

- [ ] **Step 6: Rutas**

En `src/routes/api.js`:

```js
router.post('/conversaciones/:id/tomar', requireAuth, convCtrl.tomar);
router.post('/conversaciones/:id/asignar', requireAuth, convCtrl.asignar);
```

- [ ] **Step 7: Verificar** `<env dummy> node -e "require('./src/routes')" && echo OK` y `<env dummy> node --test test/*.test.js` (verde).

- [ ] **Step 8: Commit**

```bash
git add src/services/asignacionManual.js test/asignacion-manual.test.js src/sockets/emisor.js src/controllers/conversacionesController.js src/routes/api.js
git commit -m "feat(asignacion): tomar (atómico) y reasignar chats con transferencia de dueño + evento en vivo"
```

---

### Task 2: Notas internas, lista de agentes y crear contacto (backend)

**Files:**
- Modify: `src/controllers/conversacionesController.js` (`agregarNota`, `listarNotas`)
- Create: `src/controllers/agentesController.js` (`listar`) y `src/controllers/contactosController.js` (`crear`)
- Modify: `src/routes/api.js`

**Interfaces:**
- `POST /api/conversaciones/:id/notas` `{ nota }` → 201 `{ nota }` (con `agente`); 400 vacía; requiere `puedeVer`.
- `GET /api/conversaciones/:id/notas` → `{ notas: [...] }` (con nombre del agente); requiere `puedeVer`.
- `GET /api/agentes` → `{ agentes: [{id, usuario, nombre, rol}] }` (activos) — para el desplegable de asignación.
- `POST /api/contactos` `{ telefono, nombre }` → 201 `{ contacto }` con `agente_dueno_id = me`; 409 si el `wa_id` ya existe.

- [ ] **Step 1: Notas (handlers)**

En `conversacionesController.js` (importar `NotaInterna` de `../models`):

```js
async function agregarNota(req, res) {
  const nota = (req.body && req.body.nota ? String(req.body.nota) : '').trim();
  if (!nota) return res.status(400).json({ error: 'nota vacía' });
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    const creada = await NotaInterna.create({ conversacionId: conv.id, agenteId: req.agente.id, nota });
    return res.status(201).json({ nota: { id: creada.id, nota: creada.nota, agente: req.agente.nombre, creadoEn: creada.creado_en } });
  } catch (err) {
    logger.error(`nota conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function listarNotas(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    const filas = await NotaInterna.findAll({
      where: { conversacionId: conv.id },
      order: [['id', 'ASC']],
      include: [{ model: Agente, as: 'agente', attributes: ['nombre'] }],
    });
    const notas = filas.map((n) => ({ id: n.id, nota: n.nota, agente: n.agente ? n.agente.nombre : null, creadoEn: n.creado_en }));
    return res.json({ notas });
  } catch (err) {
    logger.error(`listar notas ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

(Nota: `NotaInterna.belongsTo(Agente, { as: 'agente' })` ya existe en `src/models/index.js`.)

- [ ] **Step 2: Lista de agentes**

`src/controllers/agentesController.js`:

```js
'use strict';
const { Agente } = require('../models');
const logger = require('../utils/logger');

async function listar(req, res) {
  try {
    const filas = await Agente.findAll({
      where: { activo: true },
      attributes: ['id', 'usuario', 'nombre', 'rol'],
      order: [['nombre', 'ASC']],
    });
    return res.json({ agentes: filas });
  } catch (err) {
    logger.error(`listar agentes: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { listar };
```

- [ ] **Step 3: Crear contacto**

`src/controllers/contactosController.js`:

```js
'use strict';
const { Contacto } = require('../models');
const logger = require('../utils/logger');

function soloDigitos(s) {
  return String(s || '').replace(/\D/g, '');
}

async function crear(req, res) {
  const telefono = soloDigitos(req.body && req.body.telefono);
  const nombre = (req.body && req.body.nombre ? String(req.body.nombre) : '').trim();
  if (telefono.length < 10) return res.status(400).json({ error: 'teléfono inválido' });
  const waId = `${telefono}@c.us`;
  try {
    const existente = await Contacto.findOne({ where: { waId } });
    if (existente) return res.status(409).json({ error: 'el contacto ya existe', codigo: 'existe' });
    const contacto = await Contacto.create({
      waId, telefono, nombreDisplay: nombre || null, agenteDuenoId: req.agente.id,
    });
    return res.status(201).json({ contacto });
  } catch (err) {
    logger.error(`crear contacto: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { crear };
```

- [ ] **Step 4: Rutas**

En `src/routes/api.js` (importar los dos controladores nuevos):

```js
router.get('/conversaciones/:id/notas', requireAuth, convCtrl.listarNotas);
router.post('/conversaciones/:id/notas', requireAuth, convCtrl.agregarNota);
router.get('/agentes', requireAuth, agentesCtrl.listar);
router.post('/contactos', requireAuth, contactosCtrl.crear);
```

Exportar `agregarNota`/`listarNotas` desde el controlador de conversaciones.

- [ ] **Step 5: Verificar** carga + suite verde.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/agentesController.js src/controllers/contactosController.js src/controllers/conversacionesController.js src/routes/api.js
git commit -m "feat(bandeja): notas internas, lista de agentes y crear contacto"
```

---

### Task 3: Frontend — acciones del panel + socket de asignación

**Files:**
- Create: `frontend/src/stores/acciones.js` (tomar/asignar/notas/crearContacto + lista de agentes)
- Modify: `frontend/src/components/PanelCliente.vue` (botón Tomar, desplegable Asignar, notas)
- Modify: `frontend/src/views/Bandeja.vue` (botón "Nuevo contacto" + modal simple)
- Modify: `frontend/src/socket/cliente.js` (listener `conversacion:asignada`)

**Interfaces:**
- store `useAcciones`: state `{ agentes: [], notas: [] }`; acciones `cargarAgentes()`, `tomar(convId)`, `asignar(convId, agenteId)`, `cargarNotas(convId)`, `agregarNota(convId, texto)`, `crearContacto(telefono, nombre)`. `tomar`/`asignar` actualizan el `useChat().conversacion.agenteId` y la lista.

- [ ] **Step 1: Store `acciones.js`**

```js
import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';
import { useChat } from './chat';
import { useConversaciones } from './conversaciones';

export const useAcciones = defineStore('acciones', {
  state: () => ({ agentes: [], notas: [], error: '' }),
  actions: {
    async cargarAgentes() {
      try { this.agentes = (await apiFetch('/agentes')).agentes; } catch { this.agentes = []; }
    },
    async tomar(convId) {
      const r = await apiFetch(`/conversaciones/${convId}/tomar`, { method: 'POST' });
      this.aplicarAsignacion(convId, r.conversacion.agenteId);
    },
    async asignar(convId, agenteId) {
      const r = await apiFetch(`/conversaciones/${convId}/asignar`, { method: 'POST', body: JSON.stringify({ agenteId }) });
      this.aplicarAsignacion(convId, r.conversacion.agenteId);
    },
    aplicarAsignacion(convId, agenteId) {
      const chat = useChat();
      if (chat.conversacion && chat.conversacion.id === convId) chat.conversacion.agenteId = agenteId;
      useConversaciones().cargar();
    },
    async cargarNotas(convId) {
      try { this.notas = (await apiFetch(`/conversaciones/${convId}/notas`)).notas; } catch { this.notas = []; }
    },
    async agregarNota(convId, texto) {
      const r = await apiFetch(`/conversaciones/${convId}/notas`, { method: 'POST', body: JSON.stringify({ nota: texto }) });
      this.notas.push(r.nota);
    },
    async crearContacto(telefono, nombre) {
      return (await apiFetch('/contactos', { method: 'POST', body: JSON.stringify({ telefono, nombre }) })).contacto;
    },
  },
});
```

- [ ] **Step 2: `PanelCliente.vue` — acciones**

Añadir (dentro del bloque con conversación abierta): botón **Tomar** cuando `!c.agenteId`; un `<select>` **Asignar a** (opciones: los `agentes` + "Bandeja general" con valor vacío) que llama `asignar`; y una sección de **notas** (lista + input para agregar). Cargar agentes y notas en `onMounted`/`watch` de la conversación:

```vue
<script setup>
import { computed, ref, watch, onMounted } from 'vue';
import { useChat } from '../stores/chat';
import { useAcciones } from '../stores/acciones';
import { iniciales } from '../utils/formato';

const chat = useChat();
const acc = useAcciones();
const c = computed(() => chat.conversacion);
const nombre = computed(() => c.value?.contacto?.nombreDisplay || c.value?.contacto?.nombreWa || c.value?.contacto?.telefono || 'Sin nombre');
const nuevaNota = ref('');

onMounted(() => acc.cargarAgentes());
watch(() => c.value?.id, (id) => { if (id) acc.cargarNotas(id); }, { immediate: true });

async function tomar() { await acc.tomar(c.value.id); }
async function asignarA(e) { await acc.asignar(c.value.id, e.target.value ? Number(e.target.value) : null); }
async function guardarNota() { const t = nuevaNota.value.trim(); if (!t) return; nuevaNota.value = ''; await acc.agregarNota(c.value.id, t); }
</script>
```

Template (dentro del `v-else`): mostrar teléfono/estado/origen (como hoy) y agregar:

```vue
      <button v-if="!c.agenteId" @click="tomar" class="w-full mt-2 bg-marca text-white rounded-lg py-2 text-sm font-semibold">Tomar chat</button>
      <div class="mt-3">
        <div class="text-[11px] text-gray-400 uppercase mb-1">Asignar a</div>
        <select @change="asignarA" class="w-full border rounded-lg px-2 py-1.5 text-[13px]">
          <option value="">— Bandeja general —</option>
          <option v-for="a in acc.agentes" :key="a.id" :value="a.id" :selected="a.id === c.agenteId">{{ a.nombre }}</option>
        </select>
      </div>
      <div class="mt-4">
        <div class="text-[11px] text-gray-400 uppercase mb-1">Notas internas</div>
        <div v-for="n in acc.notas" :key="n.id" class="bg-amber-50 border border-amber-100 rounded p-2 text-[12px] text-gray-700 mb-1">
          {{ n.nota }} <span class="text-gray-400">— {{ n.agente }}</span>
        </div>
        <div class="flex gap-1 mt-1">
          <input v-model="nuevaNota" @keydown.enter="guardarNota" placeholder="Agregar nota…" class="flex-1 border rounded px-2 py-1 text-[12px]" />
          <button @click="guardarNota" class="bg-gray-200 rounded px-2 text-[12px]">+</button>
        </div>
      </div>
```

- [ ] **Step 3: `Bandeja.vue` — nuevo contacto**

En el header, un botón "＋ Contacto" que abre un modal simple (input teléfono + nombre) y llama `acc.crearContacto`; al éxito, mostrar confirmación y limpiar. (Modal con `v-if` sobre un `ref mostrarNuevo`.)

- [ ] **Step 4: Socket — asignación en vivo**

En `frontend/src/socket/cliente.js`, añadir dentro de `conectarSocket`:

```js
  socket.on('conversacion:asignada', ({ conversacionId, agenteId }) => {
    const chat = useChat();
    if (chat.conversacion && chat.conversacion.id === conversacionId) chat.conversacion.agenteId = agenteId;
    useConversaciones().cargar();
  });
```

- [ ] **Step 5: Verificar** `npm --prefix frontend test` (verde) y `npm --prefix frontend run build` (compila).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stores/acciones.js frontend/src/components/PanelCliente.vue frontend/src/views/Bandeja.vue frontend/src/socket/cliente.js
git commit -m "feat(frontend): tomar/asignar/notas y crear contacto en el panel; asignación en vivo"
```

---

### Task 4: Despliegue + prueba real (controlador)

- [ ] **Step 1:** Merge a `main`; en el servidor `git pull`, `npm --prefix frontend ci --include=dev && npm --prefix frontend run build`, `pm2 restart wa-backend wa-worker`; `/health` 200.
- [ ] **Step 2:** Prueba: con dos sesiones (o una), tomar un chat de general → sale de general y queda en "Míos"; reasignar a otro agente; agregar una nota; crear un contacto. Confirmar que la asignación se refleja sin recargar.

---

## Notas de cobertura del spec (Plan 6)

Cubre: toma atómica (invariante), reasignación con transferencia de dueño, `wa_asignaciones`, notas internas, crear contacto propio, y actualización en vivo de asignación. **Fuera de este plan**: plantillas, visor de media, etiquetas, iniciar conversación saliente a un contacto nuevo (necesita plantilla), onboarding masivo de agentes.
