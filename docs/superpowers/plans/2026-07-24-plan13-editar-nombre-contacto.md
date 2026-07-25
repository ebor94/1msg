# Plan 13 — Editar nombre del contacto (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un agente edite el nombre visible del contacto (`nombre_display`) desde el panel del cliente, y se refleje al instante en el panel, la cabecera del chat y la lista.

**Architecture:** Endpoint `PATCH /api/contactos/:id` que actualiza `wa_contactos.nombre_display` (cualquier agente autenticado; metadato compartido de bajo riesgo). Frontend: edición en línea en `PanelCliente` con una acción de store que actualiza el contacto en `chat.conversacion` y en el ítem de la lista.

**Tech Stack:** Express/Sequelize (backend); Vue 3/Pinia (frontend). Sin migración (la columna `nombre_display` ya existe).

## Global Constraints

- Cualquier agente autenticado puede editar el nombre (decisión de negocio confirmada).
- `nombre_display` se normaliza: trim, máximo 120 chars, vacío → NULL (cae a `nombreWa`/teléfono).
- Sin token al frontend; `'use strict'`, CommonJS backend; sin `console.log`.
- No se tocan mensajes ni permisos de conversación.

## File Structure

- `src/controllers/contactosController.js` (modificar): handler `actualizar`.
- `src/routes/api.js` (modificar): ruta `PATCH /contactos/:id`.
- `frontend/src/stores/acciones.js` (modificar): acción `editarNombre`.
- `frontend/src/components/PanelCliente.vue` (modificar): edición en línea del nombre.

---

### Task 1: Backend — `PATCH /api/contactos/:id`

**Files:**
- Modify: `src/controllers/contactosController.js`
- Modify: `src/routes/api.js`

**Interfaces:**
- `PATCH /api/contactos/:id` body `{ nombreDisplay }` → 200 `{ contacto: { id, waId, telefono, nombreWa, nombreDisplay } }`; 400 id inválido; 404 no encontrado.

- [ ] **Step 1: Handler `actualizar`**

En `src/controllers/contactosController.js` (ya importa `Contacto`, `logger`), añadir:

```js
/** Normaliza el nombre editable: trim, máx 120, vacío → null. */
function normalizarNombre(s) {
  const t = String(s == null ? '' : s).trim().slice(0, 120);
  return t || null;
}

/** PATCH /api/contactos/:id — edita el nombre visible (nombre_display). */
async function actualizar(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  const nombreDisplay = normalizarNombre(req.body && req.body.nombreDisplay);
  try {
    const contacto = await Contacto.findByPk(id);
    if (!contacto) return res.status(404).json({ error: 'no encontrado' });
    await contacto.update({ nombreDisplay });
    return res.json({
      contacto: {
        id: contacto.id,
        waId: contacto.waId,
        telefono: contacto.telefono,
        nombreWa: contacto.nombreWa,
        nombreDisplay: contacto.nombreDisplay,
      },
    });
  } catch (err) {
    logger.error(`actualizar contacto ${id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

Exportar `actualizar` junto a `crear` y `buscar`.

- [ ] **Step 2: Ruta**

En `src/routes/api.js` (junto a las de contactos; `PATCH` no colisiona con `GET /contactos/buscar`):

```js
router.patch('/contactos/:id', requireAuth, contactosCtrl.actualizar);
```

- [ ] **Step 3: Verificar carga + suite**

```
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node -e "require('./src/routes'); console.log('rutas OK')"
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js
```
Expected: "rutas OK" y suite verde (sin regresiones). (El handler depende de DB; se valida en la prueba real — el proyecto no tiene scaffolding HTTP/DB.)

- [ ] **Step 4: Commit**

```bash
git add src/controllers/contactosController.js src/routes/api.js
git commit -m "feat(contactos): PATCH /contactos/:id para editar el nombre visible"
```

---

### Task 2: Frontend — edición en línea del nombre

**Files:**
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/components/PanelCliente.vue`

**Interfaces:**
- Store: `editarNombre(contactoId, nombre): Promise<string>` — PATCH y actualiza el contacto en `chat.conversacion` y en la lista.

- [ ] **Step 1: Acción `editarNombre` en `frontend/src/stores/acciones.js`**

El store ya importa `apiFetch`, `useChat` y `useConversaciones`. Añadir:

```js
    async editarNombre(contactoId, nombre) {
      const r = await apiFetch(`/contactos/${contactoId}`, {
        method: 'PATCH',
        body: JSON.stringify({ nombreDisplay: nombre }),
      });
      const nuevo = r.contacto.nombreDisplay;
      const chat = useChat();
      if (chat.conversacion?.contacto?.id === contactoId) chat.conversacion.contacto.nombreDisplay = nuevo;
      const item = useConversaciones().items.find((c) => c.contacto?.id === contactoId);
      if (item?.contacto) item.contacto.nombreDisplay = nuevo;
      return nuevo;
    },
```

- [ ] **Step 2: `PanelCliente.vue` — lápiz + edición en línea**

En `<script setup>` añadir el estado de edición (el componente ya importa `ref`, `computed`, `useChat`, `useAcciones`, `iniciales`, y tiene `c`, `nombre`, `acc`):

```js
const editando = ref(false);
const nombreEdit = ref('');
const guardandoNombre = ref(false);

function abrirEdicion() {
  nombreEdit.value = c.value?.contacto?.nombreDisplay || '';
  editando.value = true;
}
async function guardarNombre() {
  if (guardandoNombre.value) return;
  guardandoNombre.value = true;
  try {
    await acc.editarNombre(c.value.contacto.id, nombreEdit.value);
    editando.value = false;
  } catch {
    aviso.value = 'No se pudo guardar el nombre.';
  } finally {
    guardandoNombre.value = false;
  }
}
```

En el template, reemplazar el `<h4>` del nombre por el bloque editable:

```vue
    <div v-if="!editando" class="flex items-center justify-center gap-1.5">
      <h4 class="text-center text-base text-gray-900 m-0">{{ nombre }}</h4>
      <button class="text-gray-400 hover:text-marca-oscuro text-sm" title="Editar nombre" @click="abrirEdicion">✎</button>
    </div>
    <div v-else class="flex flex-col items-center gap-1.5">
      <input v-model="nombreEdit" @keydown.enter="guardarNombre" placeholder="Nombre del contacto"
        class="w-full border rounded px-2 py-1.5 text-[13px] text-center" />
      <div class="flex gap-2">
        <button class="text-[12px] text-gray-500 px-2 py-1" @click="editando = false">Cancelar</button>
        <button :disabled="guardandoNombre" class="text-[12px] bg-marca text-white rounded-lg px-3 py-1 font-semibold disabled:opacity-60" @click="guardarNombre">
          {{ guardandoNombre ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
    </div>
```

(El `aviso` ya existe en el componente para mostrar mensajes de error.)

- [ ] **Step 3: Verificar suite y build**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: verde y build OK.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/acciones.js frontend/src/components/PanelCliente.vue
git commit -m "feat(frontend): editar el nombre del contacto en el panel del cliente"
```

---

### Task 3: Despliegue + prueba real

- [ ] **Step 1: Deploy.** Merge a `main`, push. En el servidor: `git pull`, `npm --prefix frontend run build`, `pm2 restart wa-backend`. `/health` 200; `PATCH /api/contactos/1` sin token → 401.
- [ ] **Step 2: Prueba real.** Abrir un chat, en el panel del cliente clic en ✎ junto al nombre → escribir un nombre → Guardar → verificar que cambia al instante en el panel, en la cabecera del chat y en el ítem de la lista. Vaciar el nombre → vuelve a mostrar el `nombreWa`/teléfono. Reabrir el chat → el nombre persiste.

---

## Notas de cobertura (Plan 13)

Cubre: editar `nombre_display` (cualquier agente), reflejo inmediato en panel/cabecera/lista, y normalización (vacío → NULL). Sin migración. El handler se valida en la prueba real; la normalización es trivial e inline.
