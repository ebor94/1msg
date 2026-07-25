# Plan 17 — Marcar como no leído + filtro de no leídos (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un agente marque un chat como no leído (desde la cabecera del chat) y pueda filtrar Míos/General/Todos para ver solo los no leídos.

**Architecture:** `POST /conversaciones/:id/no-leido` sube `no_leidos` a ≥1 (con permiso). El servicio `listar` gana un filtro `soloNoLeidos` (`no_leidos > 0`). Frontend: botón ✉ en la cabecera del chat (marca y cierra el chat) y un toggle "No leídos" junto a las pestañas de la bandeja.

**Tech Stack:** Express/Sequelize (backend); Vue 3/Pinia (frontend). Sin migración (`no_leidos` ya existe).

## Global Constraints

- Marcar no leído requiere `puedeVer` (permiso por conversación). Usa `GREATEST(no_leidos, 1)` para no bajar un contador existente.
- El filtro `soloNoLeidos` aplica dentro de la bandeja actual (mías/general/todos), respetando el orden existente.
- Sin migración ni cambios de modelo; `no_leidos` ya mueve el badge y `leer` lo resetea a 0.
- `'use strict'`, CommonJS backend; sin `console.log`; sin token al frontend.

## File Structure

- `src/services/conversaciones.js` (modificar): `listar` acepta `soloNoLeidos`.
- `src/controllers/conversacionesController.js` (modificar): pasar `soloNoLeidos` en `listarHandler`; handler `noLeido`.
- `src/routes/api.js` (modificar): ruta `POST /conversaciones/:id/no-leido`.
- `frontend/src/stores/conversaciones.js` (modificar): `soloNoLeidos` + `alternarNoLeidos`.
- `frontend/src/stores/acciones.js` (modificar): `marcarNoLeido`.
- `frontend/src/components/ListaConversaciones.vue` (modificar): toggle "No leídos".
- `frontend/src/components/VistaChat.vue` (modificar): botón ✉ en la cabecera.

---

### Task 1: Backend — filtro `soloNoLeidos` + marcar no leído

**Files:**
- Modify: `src/services/conversaciones.js`
- Modify: `src/controllers/conversacionesController.js`
- Modify: `src/routes/api.js`

**Interfaces:**
- `GET /api/conversaciones?bandeja=X&noLeidos=1` → filtra `no_leidos > 0`.
- `POST /api/conversaciones/:id/no-leido` → 200 `{ ok: true }` (permiso `puedeVer`).

- [ ] **Step 1: `listar` acepta `soloNoLeidos`**

En `src/services/conversaciones.js`, en la firma de `listar` añadir `soloNoLeidos = false`, y tras construir `where`:

```js
async function listar({ bandeja = 'mias', agenteSolicitante, agenteFiltro = null, q = null, soloNoLeidos = false, pagina = 0, tam = 25 }) {
  const where = construirFiltro({ bandeja, agenteSolicitante, agenteFiltro });
  if (soloNoLeidos) where.noLeidos = { [Op.gt]: 0 };
  // ... resto igual
```

(`Op` ya está importado en este archivo.)

- [ ] **Step 2: `listarHandler` pasa el filtro**

En `src/controllers/conversacionesController.js`, en `listarHandler`, añadir al objeto pasado a `listar`:

```js
      soloNoLeidos: req.query.noLeidos === '1',
```

- [ ] **Step 3: Handler `noLeido`**

`sequelize` ya está importado (se usa en `asignar`). Añadir:

```js
async function noLeido(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    await Conversacion.update(
      { noLeidos: sequelize.literal('GREATEST(no_leidos, 1)') },
      { where: { id: conv.id } },
    );
    return res.json({ ok: true });
  } catch (err) {
    logger.error(`marcar no leído ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

Exportar `noLeido`.

- [ ] **Step 4: Ruta**

En `src/routes/api.js`, junto a `/leer`:

```js
router.post('/conversaciones/:id/no-leido', requireAuth, convCtrl.noLeido);
```

- [ ] **Step 5: Verificar carga + suite**

```
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node -e "require('./src/routes'); console.log('rutas OK')"
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js
```
Expected: "rutas OK" y suite verde. (Handlers con DB → prueba real, Tarea 3.)

- [ ] **Step 6: Commit**

```bash
git add src/services/conversaciones.js src/controllers/conversacionesController.js src/routes/api.js
git commit -m "feat(bandeja): filtro no leídos en listar + POST /conversaciones/:id/no-leido"
```

---

### Task 2: Frontend — toggle de filtro + botón marcar no leído

**Files:**
- Modify: `frontend/src/stores/conversaciones.js`
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/components/ListaConversaciones.vue`
- Modify: `frontend/src/components/VistaChat.vue`

**Interfaces:**
- Store conversaciones: `soloNoLeidos` (state), `alternarNoLeidos()`.
- Store acciones: `marcarNoLeido(convId)`.

- [ ] **Step 1: Store `conversaciones` — filtro**

Añadir `soloNoLeidos: false` al state; en `cargar` incluir el query; y una acción para alternar:

```js
    async cargar(bandeja = this.bandeja) {
      this.bandeja = bandeja;
      this.cargando = true;
      this.error = '';
      try {
        let url = `/conversaciones?bandeja=${bandeja}`;
        if (this.soloNoLeidos) url += '&noLeidos=1';
        const r = await apiFetch(url);
        this.items = r.conversaciones;
      } catch (e) {
        this.error = 'No se pudo cargar la bandeja.';
        this.items = [];
      } finally {
        this.cargando = false;
      }
    },
    cambiarBandeja(b) {
      if (b !== this.bandeja) this.cargar(b);
    },
    alternarNoLeidos() {
      this.soloNoLeidos = !this.soloNoLeidos;
      this.cargar();
    },
```

- [ ] **Step 2: Store `acciones` — `marcarNoLeido`**

El store ya importa `apiFetch`, `useChat`, `useConversaciones`. Añadir:

```js
    async marcarNoLeido(convId) {
      await apiFetch(`/conversaciones/${convId}/no-leido`, { method: 'POST' });
      const item = useConversaciones().items.find((c) => c.id === convId);
      if (item) item.noLeidos = Math.max(item.noLeidos || 0, 1);
      const chat = useChat();
      if (chat.conversacion && chat.conversacion.id === convId) chat.conversacion.noLeidos = Math.max(chat.conversacion.noLeidos || 0, 1);
    },
```

- [ ] **Step 3: `ListaConversaciones.vue` — toggle "No leídos"**

Junto a la fila de pestañas (Míos/General/Todos) — dentro del bloque `<template v-else>` que las contiene — añadir debajo un toggle:

```vue
      <div class="px-2.5 pb-1">
        <button @click="conv.alternarNoLeidos()"
          class="text-[12px] px-2.5 py-1 rounded-full border"
          :class="conv.soloNoLeidos ? 'bg-marca text-white border-marca' : 'text-gray-500 border-gray-200'">
          ✉ No leídos
        </button>
      </div>
```

(`conv` = `useConversaciones()`, ya está en el componente.)

- [ ] **Step 4: `VistaChat.vue` — botón ✉ en la cabecera**

El componente ya importa `useChat`. Importar también `useAcciones`:

```js
import { useAcciones } from '../stores/acciones';
const acc = useAcciones();
async function marcarNoLeido() {
  await acc.marcarNoLeido(chat.conversacion.id);
  chat.cerrar(); // vuelve a la lista; el chat queda como no leído
}
```

En la cabecera (el `div` con avatar + nombre), añadir el botón alineado a la derecha:

```vue
    <div class="bg-[#f0f2f5] border-b border-gray-200 px-4 py-2.5 flex items-center gap-3">
      <div class="w-9 h-9 rounded-full bg-gray-300 text-gray-700 grid place-items-center font-bold">{{ iniciales(nombre(chat.conversacion)) }}</div>
      <b class="text-sm text-gray-900">{{ nombre(chat.conversacion) }}</b>
      <button @click="marcarNoLeido" title="Marcar como no leído"
        class="ml-auto text-gray-400 hover:text-marca-oscuro text-lg">✉</button>
    </div>
```

(Ajustar a la estructura real del header sin romper el nombre/avatar; el cambio clave es el `<button ml-auto>` y los dos imports/función.)

- [ ] **Step 5: Verificar suite y build**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: verde y build OK.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stores/conversaciones.js frontend/src/stores/acciones.js frontend/src/components/ListaConversaciones.vue frontend/src/components/VistaChat.vue
git commit -m "feat(frontend): marcar no leído (cabecera) + filtro de no leídos en la bandeja"
```

---

### Task 3: Despliegue + prueba real

- [ ] **Step 1: Deploy.** Merge a `main`, push. En el servidor: `git pull`, `npm --prefix frontend run build`, `pm2 restart wa-backend`. `/health` 200; `POST /api/conversaciones/1/no-leido` sin token → 401.
- [ ] **Step 2: Prueba real.** (a) Abrir un chat leído → ✉ en la cabecera → vuelve a la lista y el chat muestra el badge de no leído; (b) activar el toggle "No leídos" en Míos → solo aparecen los no leídos; probar en General y Todos; (c) abrir uno de los filtrados → al leerlo desaparece del filtro (badge a 0); (d) desactivar el toggle → vuelven todos.

---

## Notas de cobertura (Plan 17)

Cubre: marcar no leído (cabecera del chat, cross-plataforma) y filtro de no leídos por bandeja. Sin migración. Los handlers con DB se validan en la prueba real. **Fuera de alcance:** marcar no leído desde la lista sin abrir, contador global de no leídos por pestaña.
