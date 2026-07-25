# Plan 20 — Marcar resuelto + bandeja Resueltos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un agente marque un chat como resuelto (botón ✓ en la cabecera): sale de "Míos" (que muestra solo activos) y pasa a una nueva pestaña "Resueltos". Si el cliente vuelve a escribir, reabre como trabajo activo (ya existe).

**Architecture:** Se reutiliza el estado `cerrada` como "resuelto". `construirFiltro` filtra "Míos" a estados activos y añade la bandeja `resueltos` (mis cerradas). `POST /conversaciones/:id/resolver` pone `estado=cerrada`. Frontend: pestaña "Resueltos", botón ✓ en la cabecera del chat (marca + cierra la ventana), y saca el ítem de la lista activa. La reapertura por nuevo mensaje ya la maneja la ingesta.

**Tech Stack:** Express/Sequelize (backend); Vue 3/Pinia (frontend). Sin migración (`estado`/`cerrada_en` ya existen).

## Global Constraints

- "Resuelto" = `estado = 'cerrada'` (con `cerrada_en`). No se agrega estado nuevo.
- "Míos" y "General" muestran solo activos (`ABIERTAS = nueva/abierta/pendiente`); "Resueltos" = mis `cerrada`. "Todos" (admin) sigue mostrando todo.
- Resolver requiere `puedeVer` (permiso por conversación), igual que `leer`.
- **Reapertura en sitio**: cuando el cliente escribe a un chat resuelto (`cerrada`), el MISMO chat vuelve a activo (mismo hilo, mismo historial), reasignado a su agente dueño (o a general si está inactivo). Hoy la ingesta crea una conversación nueva en ese caso; se cambia a reabrir en sitio. Corre en el worker (`wa-worker`).
- Sin migración; `'use strict'`, sin `console.log`; sin token al frontend.

## File Structure

- `src/services/conversaciones.js` (modificar): `construirFiltro` — Míos activos + bandeja `resueltos`.
- `src/controllers/conversacionesController.js` (modificar): handler `resolver`.
- `src/routes/api.js` (modificar): ruta `POST /conversaciones/:id/resolver`.
- `frontend/src/stores/acciones.js` (modificar): `resolver(convId)`.
- `frontend/src/components/ListaConversaciones.vue` (modificar): pestaña "Resueltos".
- `frontend/src/components/VistaChat.vue` (modificar): botón ✓ en la cabecera.

---

### Task 1: Backend — filtro Míos activos + bandeja Resueltos + resolver

**Files:**
- Modify: `src/services/conversaciones.js`
- Modify: `src/controllers/conversacionesController.js`
- Modify: `src/routes/api.js`
- Modify: `src/services/ingesta.js` (reapertura en sitio)

**Interfaces:**
- `GET /api/conversaciones?bandeja=mias` → solo activos (excluye cerradas).
- `GET /api/conversaciones?bandeja=resueltos` → mis conversaciones `cerrada`.
- `POST /api/conversaciones/:id/resolver` → 200 `{ ok: true }` (permiso `puedeVer`).
- `resolverConversacion` reabre en sitio la última conversación si está `cerrada`.

- [ ] **Step 1: `construirFiltro` — Míos activos + `resueltos`**

En `src/services/conversaciones.js` reemplazar el cuerpo de `construirFiltro` por:

```js
function construirFiltro({ bandeja = 'mias', agenteSolicitante, agenteFiltro = null }) {
  const where = {};
  if (bandeja === 'general') {
    where.agenteId = null;
    where.estado = { [Op.in]: ABIERTAS };
  } else if (bandeja === 'todos') {
    if (agenteSolicitante.rol !== ROL_AGENTE.ADMINISTRADOR) {
      const e = new Error('solo administradores pueden ver todos');
      e.status = 403;
      throw e;
    }
    if (agenteFiltro) where.agenteId = agenteFiltro;
  } else if (bandeja === 'resueltos') {
    where.agenteId = agenteSolicitante.id;
    where.estado = ESTADO_CONVERSACION.CERRADA;
  } else {
    where.agenteId = agenteSolicitante.id;
    where.estado = { [Op.in]: ABIERTAS };
  }
  return where;
}
```

(Nota: el orden de "Resueltos" en `orden` — la función `listar` ordena por `ultimoMensajeEn`. Para "resueltos" conviene DESC como "mias"; el `else` de orden en `listar` ya usa DESC salvo `general`, así que resueltos hereda DESC. OK, no hay que tocar `listar`.)

- [ ] **Step 2: Handler `resolver`** (patrón `leer`; `ESTADO_CONVERSACION` ya importado)

```js
async function resolver(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    await Conversacion.update(
      { estado: ESTADO_CONVERSACION.CERRADA, cerradaEn: new Date() },
      { where: { id: conv.id } },
    );
    return res.json({ ok: true });
  } catch (err) {
    logger.error(`resolver conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

Exportar `resolver`.

- [ ] **Step 2b: Reapertura en sitio en `src/services/ingesta.js`**

En `resolverConversacion`, hoy: si la última conversación es `cerrada`, crea una NUEVA. Cambiarlo para que **reabra la misma** cuando es `cerrada` (así el mismo hilo/historial vuelve a activo). `cascada`, `Agente`, `Asignacion`, `ESTADO_CONVERSACION` ya están importados en el archivo. Reemplazar el cuerpo por:

```js
async function resolverConversacion(contacto, norm, canalId, transaction) {
  const ultima = await Conversacion.findOne({
    where: { contactoId: contacto.id },
    order: [['id', 'DESC']],
    transaction,
  });

  // Conversación activa existente → se reutiliza.
  if (ultima && ultima.estado !== ESTADO_CONVERSACION.CERRADA) {
    return { conv: ultima, creada: false };
  }

  // Chat resuelto (cerrada) que recibe mensaje → REABRIR el mismo (continuidad de hilo).
  if (ultima && ultima.estado === ESTADO_CONVERSACION.CERRADA) {
    const asig = await cascada(contacto, { Agente, transaction }); // dueño activo o general
    await ultima.update(
      {
        agenteId: asig.agenteId,
        estado: asig.agenteId ? ESTADO_CONVERSACION.ABIERTA : ESTADO_CONVERSACION.NUEVA,
        cerradaEn: null,
      },
      { transaction },
    );
    await Asignacion.create(
      {
        conversacionId: ultima.id,
        deAgenteId: null,
        aAgenteId: asig.agenteId,
        tipo: asig.tipo,
        ejecutadoPorId: null,
        motivo: 'reapertura: cliente escribió a un chat resuelto',
      },
      { transaction },
    );
    return { conv: ultima, creada: false };
  }

  // Sin conversación previa (contacto nuevo) → crear una.
  const asig = await cascada(contacto, { Agente, transaction });
  const conv = await Conversacion.create(
    {
      canalId,
      contactoId: contacto.id,
      agenteId: asig.agenteId,
      estado: asig.agenteId ? ESTADO_CONVERSACION.ABIERTA : ESTADO_CONVERSACION.NUEVA,
      origen: norm.direccion === DIRECCION.IN ? ORIGEN_CONVERSACION.ENTRANTE : ORIGEN_CONVERSACION.SALIENTE,
    },
    { transaction },
  );
  await Asignacion.create(
    {
      conversacionId: conv.id,
      deAgenteId: null,
      aAgenteId: asig.agenteId,
      tipo: asig.tipo,
      ejecutadoPorId: null,
      motivo: asig.motivo,
    },
    { transaction },
  );
  return { conv, creada: true };
}
```

- [ ] **Step 3: Ruta**

En `src/routes/api.js`, junto a `/leer` y `/no-leido`:

```js
router.post('/conversaciones/:id/resolver', requireAuth, convCtrl.resolver);
```

- [ ] **Step 4: Verificar carga + suite**

```
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node -e "require('./src/routes'); console.log('rutas OK')"
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js
```
Expected: "rutas OK" y suite verde. **Ojo:** si hay un test de `construirFiltro`/`listar` que asuma que "mias" no filtra por estado, actualízalo (ahora "mias" incluye `estado IN ABIERTAS`). Ajústalo mínimamente.

- [ ] **Step 5: Commit**

```bash
git add src/services/conversaciones.js src/controllers/conversacionesController.js src/routes/api.js src/services/ingesta.js
git commit -m "feat(resueltos): Míos solo activos + bandeja resueltos + resolver + reapertura en sitio"
```

---

### Task 2: Frontend — pestaña Resueltos + botón ✓ resolver

**Files:**
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/components/ListaConversaciones.vue`
- Modify: `frontend/src/components/VistaChat.vue`

**Interfaces:**
- Store: `acciones.resolver(convId)` (POST + saca el ítem de la lista activa).

- [ ] **Step 1: `acc.resolver` en `frontend/src/stores/acciones.js`**

El store ya importa `apiFetch` y `useConversaciones`. Añadir:

```js
    async resolver(convId) {
      await apiFetch(`/conversaciones/${convId}/resolver`, { method: 'POST' });
      const conv = useConversaciones();
      // Sale de las bandejas activas; en Resueltos/Todos permanece.
      if (conv.bandeja !== 'resueltos' && conv.bandeja !== 'todos') {
        const i = conv.items.findIndex((c) => c.id === convId);
        if (i !== -1) conv.items.splice(i, 1);
      }
    },
```

- [ ] **Step 2: `ListaConversaciones.vue` — pestaña "Resueltos"**

En la fila de pestañas (dentro del `<template v-else>` de lista normal), añadir "Resueltos" después de "Míos":

```vue
        <button class="flex-1 text-sm py-2 rounded-lg" :class="conv.bandeja === 'mias' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('mias')">Míos</button>
        <button class="flex-1 text-sm py-2 rounded-lg" :class="conv.bandeja === 'resueltos' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('resueltos')">Resueltos</button>
        <button class="flex-1 text-sm py-2 rounded-lg" :class="conv.bandeja === 'general' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('general')">General</button>
        <button v-if="auth.esAdministrador" class="flex-1 text-sm py-2 rounded-lg" :class="conv.bandeja === 'todos' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('todos')">Todos</button>
```

(Es reemplazar la fila de botones existente por esta con el botón "Resueltos" agregado; el resto del componente no cambia.)

- [ ] **Step 3: `VistaChat.vue` — botón ✓ en la cabecera**

En `<script setup>` (ya importa `useChat`, `useAcciones` (`acc`), y tiene `marcarNoLeido`), añadir:

```js
async function resolver() {
  try {
    await acc.resolver(chat.conversacion.id);
    chat.cerrar(); // vuelve a la lista; el chat pasa a Resueltos
  } catch {
    /* si falla, el chat queda abierto */
  }
}
```

En la cabecera, junto al botón ✉ (marcar no leído), añadir el ✓ (agruparlos a la derecha). Reemplazar el bloque del botón ✉ por:

```vue
      <div class="ml-auto flex items-center gap-3">
        <button @click="resolver" title="Marcar como resuelto"
          class="text-gray-400 hover:text-green-600 text-lg">✓</button>
        <button @click="marcarNoLeido" title="Marcar como no leído"
          class="text-gray-400 hover:text-marca-oscuro text-lg">✉</button>
      </div>
```

(El `<button ✉ ml-auto>` existente pasa a este grupo; el avatar/nombre no cambian.)

- [ ] **Step 4: Verificar suite y build**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/acciones.js frontend/src/components/ListaConversaciones.vue frontend/src/components/VistaChat.vue
git commit -m "feat(frontend): botón ✓ resolver en el chat + pestaña Resueltos"
```

---

### Task 3: Despliegue + prueba real

- [ ] **Step 1: Deploy.** Merge a `main`, push. En el servidor: `git pull`, `npm --prefix frontend run build`, `pm2 restart wa-worker wa-backend` (la reapertura corre en el **worker**). `/health` 200; `POST /api/conversaciones/1/resolver` sin token → 401.
- [ ] **Step 2: Prueba real.** (a) Abrir un chat en **Míos** → **✓** en la cabecera → se cierra la ventana y el chat **desaparece de Míos**; (b) ir a la pestaña **Resueltos** → ahí está; (c) que el cliente **vuelva a escribir** a ese número → el **mismo chat** (con su historial) debe salir de Resueltos y reaparecer **activo** en Míos del agente dueño (o en General si está inactivo); (d) confirmar que General sigue mostrando solo activos y que un admin en **Todos** ve también los resueltos.

---

## Notas de cobertura (Plan 20)

Cubre: resolver un chat (estado `cerrada`) desde la cabecera, "Míos"/"General" solo activos, nueva pestaña "Resueltos" por agente, y reapertura automática (ya existente). **Fuera de alcance:** motivos de cierre/etiquetas de resolución, métricas de resueltos, resolver desde la lista sin abrir, "Resueltos" global para admin (usan "Todos").
