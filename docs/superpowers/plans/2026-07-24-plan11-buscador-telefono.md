# Plan 11 — Buscador por teléfono (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buscar por número de teléfono → abrir el chat (con su historial), tomarlo (con confirmación) si lo atiende otro agente, o iniciar uno nuevo si no existe.

**Architecture:** Endpoint global `GET /api/contactos/buscar?telefono=X` que devuelve solo metadatos (dueño actual + una `conversacion` lista para abrir) — un helper puro `construirResultado` hace el mapeo (testeable). Frontend: barra de búsqueda en `ListaConversaciones` con un store `busqueda`; al elegir un resultado se abre (mío/general), se confirma+toma (de otro, reusando `asignar`) o se inicia (reusando `crearContacto`). El historial lo trae el backfill del Plan 10 al abrir.

**Tech Stack:** Express/Sequelize/`node:test` (backend); Vue 3/Pinia/Vitest (frontend).

## Global Constraints

- El buscador es **global** (cualquier agente, cualquier dueño) pero devuelve **solo metadatos**; los mensajes siguen protegidos por `puedeVer` (para abrir el de otro hay que tomarlo antes).
- Tomar de otro agente **siempre con confirmación**; queda auditado por `asignar` (ya existente) en `wa_asignaciones`.
- Se reutiliza `asignar`, `tomar`, `crear` (contacto) y el backfill del Plan 10. Sin migración ni cambios de modelo.
- Sin token al frontend; `'use strict'`, CommonJS backend; nombres de dominio en español / técnicos en inglés; sin `console.log`.

## File Structure

- `src/services/busquedaContactos.js` (crear): helper puro `construirResultado`.
- `src/controllers/contactosController.js` (modificar): handler `buscar`.
- `src/routes/api.js` (modificar): ruta `GET /contactos/buscar`.
- `frontend/src/stores/busqueda.js` (crear): store de búsqueda.
- `frontend/src/components/ListaConversaciones.vue` (modificar): barra de búsqueda + panel de resultados + interacciones.

---

### Task 1: Backend — endpoint `buscar` + helper puro

**Files:**
- Create: `src/services/busquedaContactos.js`
- Modify: `src/controllers/contactosController.js`
- Modify: `src/routes/api.js`
- Test: `test/busqueda-contactos.test.js`

**Interfaces:**
- Produces: `construirResultado(contacto, conv, miAgenteId): Object` — mapea a la forma de salida (con `esMio/esGeneral`, `conversacion` abrible o null).
- `GET /api/contactos/buscar?telefono=X` → `{ resultados: [...] }` (200); cualquier agente autenticado.

- [ ] **Step 1: Test del helper puro**

`test/busqueda-contactos.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { construirResultado } = require('../src/services/busquedaContactos');

const contacto = { id: 3, waId: '57300@c.us', telefono: '57300', nombreWa: 'Ana WA', nombreDisplay: 'Ana' };

test('conversación mía → esMio, nombre display, conversacion abrible', () => {
  const conv = { id: 9, agenteId: 5, ventanaExpiraEn: null, agente: { id: 5, nombre: 'Yo' } };
  const r = construirResultado(contacto, conv, 5);
  assert.equal(r.contactoId, 3);
  assert.equal(r.nombre, 'Ana');
  assert.equal(r.conversacionId, 9);
  assert.equal(r.esMio, true);
  assert.equal(r.esGeneral, false);
  assert.equal(r.agenteActualNombre, 'Yo');
  assert.equal(r.conversacion.id, 9);
  assert.equal(r.conversacion.contacto.waId, '57300@c.us');
});

test('conversación general → esGeneral, sin agente', () => {
  const conv = { id: 9, agenteId: null, ventanaExpiraEn: null, agente: null };
  const r = construirResultado(contacto, conv, 5);
  assert.equal(r.esGeneral, true);
  assert.equal(r.esMio, false);
  assert.equal(r.agenteActualNombre, null);
});

test('conversación de otro → ni mío ni general', () => {
  const conv = { id: 9, agenteId: 7, ventanaExpiraEn: null, agente: { id: 7, nombre: 'Otro' } };
  const r = construirResultado(contacto, conv, 5);
  assert.equal(r.esMio, false);
  assert.equal(r.esGeneral, false);
  assert.equal(r.agenteActualNombre, 'Otro');
});

test('contacto sin conversación → conversacionId y conversacion null', () => {
  const r = construirResultado({ ...contacto, nombreDisplay: null, nombreWa: null }, null, 5);
  assert.equal(r.conversacionId, null);
  assert.equal(r.conversacion, null);
  assert.equal(r.nombre, '57300'); // cae al teléfono
});
```

- [ ] **Step 2: Correr → FAIL** (`<env dummy> node --test test/busqueda-contactos.test.js`).
`<env dummy>` = `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn`

- [ ] **Step 3: Implementar `src/services/busquedaContactos.js`**

```js
'use strict';

/**
 * Mapea un contacto + su conversación actual (o null) a un resultado de búsqueda,
 * con banderas de propiedad y una `conversacion` lista para abrir en el frontend.
 * Puro (recibe objetos planos); no toca la BD.
 */
function construirResultado(contacto, conv, miAgenteId) {
  const nombre = contacto.nombreDisplay || contacto.nombreWa || contacto.telefono;
  const agenteId = conv ? conv.agenteId : null;
  return {
    contactoId: contacto.id,
    telefono: contacto.telefono,
    nombre,
    conversacionId: conv ? conv.id : null,
    agenteActualId: agenteId,
    agenteActualNombre: conv && conv.agente ? conv.agente.nombre : null,
    esMio: conv ? agenteId === miAgenteId : false,
    esGeneral: conv ? agenteId === null : false,
    conversacion: conv
      ? {
          id: conv.id,
          agenteId,
          ventanaExpiraEn: conv.ventanaExpiraEn,
          contacto: {
            id: contacto.id,
            waId: contacto.waId,
            telefono: contacto.telefono,
            nombreWa: contacto.nombreWa,
            nombreDisplay: contacto.nombreDisplay,
          },
        }
      : null,
  };
}

module.exports = { construirResultado };
```

- [ ] **Step 4: Handler `buscar` en `src/controllers/contactosController.js`**

Añadir imports que falten: `Conversacion`, `Agente` (a los de `../models`), `const { Op } = require('sequelize');`, `const { construirResultado } = require('../services/busquedaContactos');`. (`Contacto`, `Conversacion` ya se importan; añade `Agente`.)

```js
async function buscar(req, res) {
  const telefono = soloDigitos(req.query.telefono);
  if (telefono.length < 3) return res.json({ resultados: [] });
  try {
    const contactos = await Contacto.findAll({
      where: {
        [Op.or]: [
          { telefono: { [Op.like]: `%${telefono}%` } },
          { waId: { [Op.like]: `%${telefono}%` } },
        ],
      },
      attributes: ['id', 'waId', 'telefono', 'nombreWa', 'nombreDisplay'],
      limit: 10,
    });

    const resultados = [];
    for (const c of contactos) {
      const conv = await Conversacion.findOne({
        where: { contactoId: c.id },
        order: [['ultimoMensajeEn', 'DESC'], ['id', 'DESC']],
        include: [{ model: Agente, as: 'agente', attributes: ['id', 'nombre'] }],
      });
      resultados.push(construirResultado(c, conv, req.agente.id));
    }
    return res.json({ resultados });
  } catch (err) {
    logger.error(`buscar contactos: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

Exportar `buscar` junto a `crear`.

- [ ] **Step 5: Ruta**

En `src/routes/api.js`, junto a la de contactos:

```js
router.get('/contactos/buscar', requireAuth, contactosCtrl.buscar);
```

(Debe ir ANTES de cualquier ruta `/:id` de contactos si la hubiera; hoy solo existe `POST /contactos`, así que no hay colisión.)

- [ ] **Step 6: Verificar carga + suite**

```
<env dummy> node -e "require('./src/routes'); console.log('rutas OK')"
<env dummy> node --test test/*.test.js
```
Expected: "rutas OK" y suite verde.

- [ ] **Step 7: Commit**

```bash
git add src/services/busquedaContactos.js src/controllers/contactosController.js src/routes/api.js test/busqueda-contactos.test.js
git commit -m "feat(buscador): GET /contactos/buscar global por teléfono (metadatos) + helper puro"
```

---

### Task 2: Frontend — barra de búsqueda + resultados + interacciones

**Files:**
- Create: `frontend/src/stores/busqueda.js`
- Modify: `frontend/src/components/ListaConversaciones.vue`

**Interfaces:**
- Store `busqueda`: state `{ termino, resultados, buscando }`; acciones `buscar(telefono)`, `limpiar()`.

- [ ] **Step 1: Store `frontend/src/stores/busqueda.js`**

```js
import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';

export const useBusqueda = defineStore('busqueda', {
  state: () => ({ termino: '', resultados: [], buscando: false }),
  actions: {
    async buscar(telefono) {
      this.termino = telefono;
      const t = telefono.replace(/\D/g, '');
      if (t.length < 3) { this.resultados = []; return; }
      this.buscando = true;
      try {
        const r = await apiFetch(`/contactos/buscar?telefono=${encodeURIComponent(t)}`);
        // Guard: descarta la respuesta si el término cambió mientras estaba en vuelo.
        if (this.termino.replace(/\D/g, '') === t) this.resultados = r.resultados;
      } catch {
        this.resultados = [];
      } finally {
        this.buscando = false;
      }
    },
    limpiar() {
      this.termino = '';
      this.resultados = [];
      this.buscando = false;
    },
  },
});
```

- [ ] **Step 2: `ListaConversaciones.vue` — barra + panel + interacciones**

Reescribir el componente (mantiene las pestañas y la lista; añade la barra de búsqueda arriba, el panel de resultados cuando hay término, y el diálogo de confirmación para tomar de otro):

```vue
<script setup>
import { onMounted, ref, watch } from 'vue';
import { useConversaciones } from '../stores/conversaciones';
import { useAuth } from '../stores/auth';
import { useBusqueda } from '../stores/busqueda';
import { useChat } from '../stores/chat';
import { useAcciones } from '../stores/acciones';
import ItemConversacion from './ItemConversacion.vue';

const conv = useConversaciones();
const auth = useAuth();
const busqueda = useBusqueda();
const chat = useChat();
const acc = useAcciones();

onMounted(() => conv.cargar('mias'));

const texto = ref('');
let debounce = null;
watch(texto, (v) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => busqueda.buscar(v), 300);
});

const soloDigitos = (s) => s.replace(/\D/g, '');
const porConfirmar = ref(null); // resultado de otro agente pendiente de confirmar

function limpiar() {
  texto.value = '';
  busqueda.limpiar();
  porConfirmar.value = null;
}

async function elegir(r) {
  if (r.esMio || r.esGeneral) {
    chat.abrir(r.conversacion);
    limpiar();
  } else {
    porConfirmar.value = r; // pedir confirmación antes de tomar
  }
}

async function confirmarToma() {
  const r = porConfirmar.value;
  porConfirmar.value = null;
  await acc.asignar(r.conversacionId, auth.agente.id);
  r.conversacion.agenteId = auth.agente.id;
  await conv.cargar('mias');
  chat.abrir(r.conversacion);
  limpiar();
}

async function iniciar() {
  const tel = soloDigitos(texto.value);
  await acc.crearContacto(tel, '');
  limpiar();
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="p-2.5 pb-1">
      <div class="relative">
        <input v-model="texto" placeholder="Buscar por teléfono…"
          class="w-full bg-gray-100 rounded-full px-4 py-2 text-[13px] outline-none" />
        <button v-if="texto" class="absolute right-3 top-2 text-gray-400 text-sm" @click="limpiar">✕</button>
      </div>
    </div>

    <!-- Resultados de búsqueda -->
    <div v-if="busqueda.termino" class="flex-1 overflow-auto">
      <div v-if="busqueda.buscando" class="p-4 text-center text-gray-400 text-sm">Buscando…</div>
      <template v-else>
        <div v-for="r in busqueda.resultados" :key="r.contactoId" @click="elegir(r)"
          class="px-3 py-2.5 border-b border-gray-100 cursor-pointer hover:bg-gray-50 flex items-center justify-between">
          <div class="min-w-0">
            <div class="text-[14px] text-gray-800 truncate">{{ r.nombre }}</div>
            <div class="text-[12px] text-gray-400">{{ r.telefono }}</div>
          </div>
          <span class="text-[11px] px-2 py-0.5 rounded-full shrink-0"
            :class="r.esMio ? 'bg-green-100 text-green-700' : r.esGeneral ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-700'">
            {{ r.esMio ? 'Tuyo' : r.esGeneral ? 'General' : ('de ' + (r.agenteActualNombre || 'otro')) }}
          </span>
        </div>
        <div v-if="!busqueda.resultados.length && soloDigitos(texto).length >= 7"
          @click="iniciar" class="px-3 py-3 cursor-pointer hover:bg-gray-50 text-marca-oscuro text-[13px] font-semibold">
          ＋ Iniciar chat con {{ soloDigitos(texto) }}
        </div>
        <div v-else-if="!busqueda.resultados.length" class="p-4 text-center text-gray-400 text-sm">Sin resultados.</div>
      </template>
    </div>

    <!-- Lista normal (cuando no se está buscando) -->
    <template v-else>
      <div class="flex gap-1 px-2.5 pb-1">
        <button class="flex-1 text-sm py-2 rounded-lg" :class="conv.bandeja === 'mias' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('mias')">Míos</button>
        <button class="flex-1 text-sm py-2 rounded-lg" :class="conv.bandeja === 'general' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('general')">General</button>
        <button v-if="auth.esAdministrador" class="flex-1 text-sm py-2 rounded-lg" :class="conv.bandeja === 'todos' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('todos')">Todos</button>
      </div>
      <div class="flex-1 overflow-auto">
        <div v-if="conv.cargando" class="p-4 text-center text-gray-400 text-sm">Cargando…</div>
        <div v-else-if="conv.error" class="p-4 text-center text-red-500 text-sm">{{ conv.error }}</div>
        <div v-else-if="!conv.items.length" class="p-4 text-center text-gray-400 text-sm">Sin conversaciones.</div>
        <ItemConversacion v-for="c in conv.items" :key="c.id" :conversacion="c" />
      </div>
    </template>

    <!-- Confirmación para tomar de otro agente -->
    <div v-if="porConfirmar" class="fixed inset-0 bg-black/40 grid place-items-center z-50" @click.self="porConfirmar = null">
      <div class="bg-white rounded-lg p-4 w-80 shadow-lg">
        <p class="text-[13px] text-gray-700 mb-3">
          Este chat lo atiende <b>{{ porConfirmar.agenteActualNombre || 'otro agente' }}</b>. ¿Tomarlo?
        </p>
        <div class="flex justify-end gap-2">
          <button class="text-[13px] text-gray-500 px-3 py-1.5" @click="porConfirmar = null">Cancelar</button>
          <button class="text-[13px] bg-marca text-white rounded-lg px-3 py-1.5 font-semibold" @click="confirmarToma">Tomarlo</button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Verificar suite y build**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: verde y build OK.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/busqueda.js frontend/src/components/ListaConversaciones.vue
git commit -m "feat(frontend): buscador por teléfono (abrir / tomar con confirmación / iniciar)"
```

---

### Task 3: Despliegue + prueba real

- [ ] **Step 1: Deploy.** Merge a `main`, push. En el servidor: `git pull`, `npm --prefix frontend run build`, `pm2 restart wa-backend`. `/health` 200; `GET /api/contactos/buscar?telefono=300` sin token → 401.
- [ ] **Step 2: Prueba real.** (a) Buscar un número propio ya existente → abrirlo → carga su historial; (b) buscar uno que atiende otro agente → aparece "de {Agente}" → clic → confirmar → se toma y abre, pasa a Míos; (c) buscar un número nuevo (≥7 dígitos, sin resultados) → "Iniciar chat con {número}" → se crea, abre, y si tenía historial en 1msg aparece; (d) vaciar la búsqueda → vuelve la lista normal.

---

## Notas de cobertura del spec (Plan 11)

Cubre: buscador global por teléfono (metadatos, cualquier agente), abrir (mío/general) con historial, tomar de otro con confirmación (reusa `asignar`, auditado), iniciar chat nuevo (reusa `crear`). **Fuera de alcance:** búsqueda por nombre libre global, scroll de la lista de bandeja (Plan 12). Los handlers con DB se validan en la prueba real; el mapeo puro (`construirResultado`) va con tests.
