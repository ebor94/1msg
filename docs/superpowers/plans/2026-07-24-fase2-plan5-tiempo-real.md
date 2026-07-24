# Fase 2 · Plan 5 — Tiempo real (Socket.io)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los mensajes nuevos, sus cambios de estado y el reordenamiento de la lista aparezcan en la bandeja **sin recargar**, respetando rooms por agente y "persistir antes de emitir".

**Architecture:** Socket.io montado en el proceso del API (`wa-backend`), autenticado con el JWT en el handshake; cada agente entra a `agente:{id}` (+ `general` los asesores, `admins` los administradores). El **envío** (mismo proceso) emite en línea. Los **entrantes/acks** los persiste el worker (`wa-worker`, otro proceso), que tras el commit le avisa al API por un endpoint interno en `localhost` (protegido por `WEBHOOK_SECRET`); el API emite. El frontend abre un socket con el JWT y actualiza los stores; al reconectar, recarga la bandeja abierta.

**Tech Stack:** `socket.io` (ya dep del backend), `socket.io-client` (nueva dep del frontend), Express, `node:test`, Vue 3/Pinia/Vitest.

## Global Constraints

- **Persistir antes de emitir** (invariante #3): el socket se emite SIEMPRE después del commit.
- **Rooms, no broadcast** (invariante #5): un agente solo recibe eventos de sus conversaciones o de general; el admin, de todas.
- **El socket no es la fuente de verdad** (invariante #6): al reconectar, el frontend recarga desde la API.
- El token de 1msg y el `JWT_SECRET` jamás salen al frontend. El socket se autentica con el JWT del agente.
- El endpoint interno de emisión solo se usa entre procesos (worker→API), protegido por `WEBHOOK_SECRET`; un fallo de emisión NO falla el procesamiento (el mensaje ya está persistido; la reconexión recupera).
- Nombres de dominio en español, técnicos en inglés; `'use strict'`, CommonJS (backend).
- Tests: lógica pura (targets de room, reducers del store) con `node:test`/Vitest; el flujo en vivo se valida en navegador.

## Rooms y destino de eventos

- Al conectar: `socket.join('agente:'+id)`; si rol `asesor` → `join('general')`; si `administrador` → `join('admins')`.
- `roomsPara({ agenteId, general })`:
  - con `agenteId` → `['agente:'+agenteId, 'admins']`
  - sin agente (general) → `['general', 'admins']`
- Eventos: `mensaje:nuevo` `{ conversacionId, mensaje }` · `conversacion:actualizada` `{ conversacion }` · `mensaje:ack` `{ conversacionId, waMessageId, estado }`.

---

### Task 1: Servidor Socket.io (auth + rooms + emisor)

**Files:**
- Create: `src/sockets/io.js` (singleton del `io`)
- Create: `src/sockets/emisor.js` (`roomsPara`, `emitir`)
- Create: `src/sockets/registro.js` (auth + join de rooms)
- Modify: `src/index.js` (crear http server + adjuntar io)
- Test: `test/sockets-emisor.test.js`

**Interfaces:**
- Produces:
  - `io.js`: `setIo(io)`, `getIo(): io|null`.
  - `emisor.js`: `roomsPara({agenteId, general}): string[]`; `emitir(evento, destino, payload)` (usa `getIo()`; no-op si no hay io).
  - `registro.js`: `registrar(io)` — `io.use` verifica JWT del handshake (`socket.handshake.auth.token`), setea `socket.data.agente`; en `connection` hace los joins.

- [ ] **Step 1: Escribir el test (lógica pura de rooms)**

`test/sockets-emisor.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roomsPara } = require('../src/sockets/emisor');

test('roomsPara con agente → su room + admins', () => {
  assert.deepEqual(roomsPara({ agenteId: 3, general: false }), ['agente:3', 'admins']);
});
test('roomsPara general → general + admins', () => {
  assert.deepEqual(roomsPara({ agenteId: null, general: true }), ['general', 'admins']);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `<env dummy> node --test test/sockets-emisor.test.js` (`<env dummy>` = `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=x ONEMSG_INSTANCE_ID=x ONEMSG_TOKEN=x WEBHOOK_SECRET=x LOG_LEVEL=warn`)
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `io.js`**

```js
'use strict';
let io = null;
function setIo(instancia) { io = instancia; }
function getIo() { return io; }
module.exports = { setIo, getIo };
```

- [ ] **Step 4: Implementar `emisor.js`**

```js
'use strict';
const { getIo } = require('./io');

function roomsPara({ agenteId, general }) {
  if (agenteId) return [`agente:${agenteId}`, 'admins'];
  if (general) return ['general', 'admins'];
  return ['admins'];
}

function emitir(evento, destino, payload) {
  const io = getIo();
  if (!io) return;
  const rooms = roomsPara(destino);
  let canal = io;
  for (const r of rooms) canal = canal.to(r);
  canal.emit(evento, payload);
}

module.exports = { roomsPara, emitir };
```

- [ ] **Step 5: Implementar `registro.js`**

```js
'use strict';
const { verificar } = require('../utils/jwt');
const { ROL_AGENTE } = require('../config/constants');
const logger = require('../utils/logger');

function registrar(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('no autenticado'));
      socket.data.agente = verificar(token);
      return next();
    } catch (e) {
      return next(new Error('token inválido'));
    }
  });

  io.on('connection', (socket) => {
    const a = socket.data.agente;
    socket.join(`agente:${a.id}`);
    if (a.rol === ROL_AGENTE.ADMINISTRADOR) socket.join('admins');
    else socket.join('general');
    logger.debug(`socket conectado: agente ${a.id} (${a.rol})`);
  });
}

module.exports = { registrar };
```

- [ ] **Step 6: Adjuntar Socket.io en `src/index.js`**

Cambiar el arranque para usar un http server explícito:

```js
const http = require('http');
const { Server } = require('socket.io');
const { setIo } = require('./sockets/io');
const { registrar } = require('./sockets/registro');
// ...
const app = crearApp();
const server = http.createServer(app);
const io = new Server(server, { path: '/socket.io' });
registrar(io);
setIo(io);
server.listen(env.port, () => {
  logger.info(`API HTTP+WS escuchando en http://127.0.0.1:${env.port}`);
});
// (usar `server.close` en el apagado en vez de `app`/el listen anterior)
```

- [ ] **Step 7: Correr tests + arranque**

Run: `<env dummy> node --test test/sockets-emisor.test.js` → PASS.
Run: `<env dummy> node -e "require('./src/sockets/registro'); require('./src/sockets/emisor'); console.log('OK carga')"` → `OK carga`.

- [ ] **Step 8: Commit**

```bash
git add src/sockets test/sockets-emisor.test.js src/index.js
git commit -m "feat(rt): servidor Socket.io con auth JWT, rooms y emisor"
```

---

### Task 2: Emitir en el envío + endpoint interno + worker

**Files:**
- Modify: `src/controllers/conversacionesController.js` (`enviar` emite tras persistir)
- Create: `src/controllers/internalController.js` (`emitirHandler`)
- Modify: `src/routes/index.js` (montar `POST /internal/emitir` antes del fallback SPA)
- Modify: `src/services/ingesta.js` (recolectar `eventosSocket`)
- Modify: `src/workers/index.js` (POST de los eventos al endpoint interno tras procesar)

**Interfaces:**
- `POST /internal/emitir` body `{ evento, destino:{agenteId,general}, payload }`, header `x-internal-secret: <WEBHOOK_SECRET>` → 204; 401 si el secreto no coincide.
- `procesarEventoWebhook(...)` añade a su retorno `eventosSocket: Array<{evento,destino,payload}>`.

- [ ] **Step 1: Emitir en `enviar` (mismo proceso)**

En `src/controllers/conversacionesController.js`, importar `const { emitir } = require('../sockets/emisor');` y, justo antes del `return res.status(201).json({ mensaje })`, agregar:

```js
    const destino = { agenteId: conv.agenteId, general: !conv.agenteId };
    emitir('mensaje:nuevo', destino, { conversacionId: conv.id, mensaje });
```

- [ ] **Step 2: Endpoint interno de emisión**

`src/controllers/internalController.js`:

```js
'use strict';
const env = require('../config/env');
const { emitir } = require('../sockets/emisor');

function emitirHandler(req, res) {
  if ((req.get('x-internal-secret') || '') !== env.webhookSecret) {
    return res.status(401).json({ error: 'no autorizado' });
  }
  const { evento, destino, payload } = req.body || {};
  if (!evento || !destino) return res.status(400).json({ error: 'evento y destino requeridos' });
  emitir(evento, destino, payload);
  return res.status(204).end();
}

module.exports = { emitirHandler };
```

En `src/routes/index.js`, añadir ANTES de que la app monte el fallback SPA (basta con registrarlo en el router, que va antes):

```js
const { emitirHandler } = require('../controllers/internalController');
router.post('/internal/emitir', emitirHandler);
```

- [ ] **Step 3: Recolectar `eventosSocket` en la ingesta**

En `src/services/ingesta.js`, dentro de `procesarEventoWebhook`, declarar `const eventosSocket = [];` junto a `tareasMedia`, y:

- Al crear un mensaje entrante/saliente nuevo (donde se hace `resumen.mensajes += 1`), agregar:

```js
        eventosSocket.push({
          evento: 'mensaje:nuevo',
          destino: { agenteId: conv.agenteId, general: !conv.agenteId },
          payload: { conversacionId: conv.id, mensaje: { id: mensajeId, direccion: norm.direccion, tipo: norm.tipo, texto: norm.texto, estado: 'pendiente', tsProveedor: norm.tsProveedor } },
        });
```

- En `procesarAck`, que devuelva también `{ aplicado, conversacionId, agenteId, estado, waMessageId }` cuando aplique; y en el bucle de acks, si aplicó, `eventosSocket.push({ evento:'mensaje:ack', destino:{agenteId, general:!agenteId}, payload:{ conversacionId, waMessageId, estado } })`.

Devolver `eventosSocket` en el objeto `resumen` (o como segundo campo del retorno). Mantener `procesarEventoWebhook` devolviendo `{ ...resumen, eventosSocket }`.

- [ ] **Step 4: El worker emite tras procesar**

En `src/workers/index.js`, tras `const resumen = await procesarEventoWebhook(evento, { dryRun })` y marcar procesado, si NO es dryRun y `resumen.eventosSocket?.length`, hacer por cada uno un POST best-effort:

```js
async function avisarSocket(ev) {
  try {
    await fetch(`http://127.0.0.1:${env.port}/internal/emitir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': env.webhookSecret },
      body: JSON.stringify(ev),
    });
  } catch (e) {
    logger.warn(`aviso socket falló (no crítico): ${e.message}`);
  }
}
```
(importar `env` de `../config/env`; usar `global.fetch` de Node 20). Llamar `for (const ev of resumen.eventosSocket) await avisarSocket(ev);` solo cuando `!dryRun`.

- [ ] **Step 5: Verificación local**

Run: `<env dummy> node -e "require('./src/routes'); require('./src/controllers/internalController'); require('./src/services/ingesta'); console.log('OK carga')"` → `OK carga`.
Run: `<env dummy> node --test test/*.test.js` → toda la suite verde.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/conversacionesController.js src/controllers/internalController.js src/routes/index.js src/services/ingesta.js src/workers/index.js
git commit -m "feat(rt): emitir en envío + endpoint interno + worker avisa al API"
```

---

### Task 3: Cliente de socket en el frontend

**Files:**
- Modify: `frontend/package.json` (+ `socket.io-client`)
- Create: `frontend/src/socket/cliente.js`
- Modify: `frontend/src/views/Bandeja.vue` (conectar/desconectar el socket)
- (Reutiliza los stores `useChat` y `useConversaciones`.)

**Interfaces:**
- Produces: `conectarSocket()` / `desconectarSocket()` — conecta con `io({ auth: { token } })`, y al recibir eventos actualiza los stores: `mensaje:nuevo` (si es de la conversación abierta y el id no está ya → push a `useChat().mensajes`; actualiza el item de la lista y súbelo arriba; si no está abierta, `noLeidos++`), `conversacion:actualizada` (refresca el item si existe), `mensaje:ack` (actualiza `estado` del mensaje en `useChat().mensajes` si está). Al `connect` (incluye reconexión), recarga la bandeja actual y reabre el chat abierto.

- [ ] **Step 1: Instalar la dependencia**

Run: `npm --prefix frontend install socket.io-client`

- [ ] **Step 2: Implementar el cliente**

`frontend/src/socket/cliente.js`:

```js
import { io } from 'socket.io-client';
import { tokenGuardado } from '../api/cliente';
import { useConversaciones } from '../stores/conversaciones';
import { useChat } from '../stores/chat';

let socket = null;

function subirEnLista(convId, parche) {
  const conv = useConversaciones();
  const i = conv.items.findIndex((c) => c.id === convId);
  if (i === -1) return null;
  const item = conv.items[i];
  Object.assign(item, parche);
  conv.items.splice(i, 1);
  conv.items.unshift(item);
  return item;
}

export function conectarSocket() {
  if (socket) return;
  socket = io({ path: '/socket.io', auth: { token: tokenGuardado() } });

  socket.on('mensaje:nuevo', ({ conversacionId, mensaje }) => {
    const chat = useChat();
    const abierta = chat.conversacion && chat.conversacion.id === conversacionId;
    if (abierta && !chat.mensajes.some((m) => m.id === mensaje.id)) {
      chat.mensajes.push(mensaje);
    }
    const item = subirEnLista(conversacionId, {
      ultimoMensajeTexto: mensaje.texto, ultimoMensajeEn: mensaje.tsProveedor, ultimoMensajeDir: mensaje.direccion,
    });
    if (item && !abierta && mensaje.direccion === 'in') item.noLeidos = (item.noLeidos || 0) + 1;
  });

  socket.on('mensaje:ack', ({ waMessageId, estado }) => {
    const chat = useChat();
    const m = chat.mensajes.find((x) => x.waMessageId === waMessageId);
    if (m) m.estado = estado;
  });

  socket.on('connect', () => {
    const conv = useConversaciones();
    if (conv.items.length || conv.bandeja) conv.cargar(conv.bandeja);
    const chat = useChat();
    if (chat.conversacion) chat.abrir(chat.conversacion);
  });
}

export function desconectarSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
```

- [ ] **Step 3: Conectar en `Bandeja.vue`**

En `frontend/src/views/Bandeja.vue`, en el `<script setup>`: `import { conectarSocket, desconectarSocket } from '../socket/cliente';` y `import { onMounted, onUnmounted } from 'vue';` → `onMounted(conectarSocket); onUnmounted(desconectarSocket);`. En `salir()`, llamar `desconectarSocket()` antes del `logout()`.

- [ ] **Step 4: Verificar tests + build**

Run: `npm --prefix frontend test` (los existentes siguen verdes; no hay test nuevo obligatorio para el cliente socket).
Run: `npm --prefix frontend run build` → compila.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/socket/cliente.js frontend/src/views/Bandeja.vue
git commit -m "feat(rt): cliente socket que actualiza la bandeja en vivo"
```

---

### Task 4: Despliegue + prueba real (controlador)

**Files:** (ninguno — despliegue/verificación)

- [ ] **Step 1: Merge + despliegue**

Tras la revisión final: merge a `main`; en el servidor `git pull`, `npm --prefix frontend ci --include=dev && npm --prefix frontend run build`, y **reiniciar AMBOS** procesos (`pm2 restart wa-backend wa-worker`) — el backend por Socket.io y el worker por el aviso interno. Confirmar `/health` 200 y que el socket handshake responde (`curl -s -o /dev/null -w "%{http_code}" "https://wa.losolivoscucuta.com/socket.io/?EIO=4&transport=polling"` → 200/400 de handshake, no 404).

- [ ] **Step 2: Prueba real coordinada**

Con la bandeja abierta en el navegador (logueado), pedir al humano que escriba desde su WhatsApp personal al número: el mensaje debe **aparecer solo** en el chat abierto (o subir en la lista con badge) sin recargar. Enviar una respuesta desde la bandeja y confirmar que el estado sube en vivo cuando llega el ack.

---

## Notas de cobertura del spec (Plan 5)

Cubre del spec §6 (tiempo real: Socket.io un proceso, rooms por agente/general/admins, persistir antes de emitir, recuperación al reconectar recargando de la API). Puente worker→API por HTTP interno en localhost (sin Redis). **Fuera de este plan**: `GET /api/sync` con cursor fino (aquí la recuperación es recargar), eventos de asignación en vivo, presencia/"escribiendo…", y el resto de la hoja de ruta (plantillas, tomar/asignar, media).
