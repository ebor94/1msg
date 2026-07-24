# Fase 2 · Plan 4 — Enviar texto (dentro de la ventana de 24h)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un agente responda con texto libre desde la bandeja cuando la ventana de 24h está abierta; el mensaje se envía por 1msg, se persiste como saliente y aparece en el chat. Fuera de ventana, el compositor se deshabilita con un aviso (las plantillas son el Plan 5).

**Architecture:** Backend: un cliente aislado en `src/integrations/onemsg/` que llama a `POST /sendMessage` de 1msg (confirmado vía SDK: campos `body`, `chatId`, `quotedMsgId`; token en query; form-urlencoded; respuesta `{sent, id}`), con reintento/backoff en 429. Un endpoint `POST /api/conversaciones/:id/mensajes` valida acceso + ventana, re-valida que el agente siga activo, antepone su firma, envía, persiste el saliente y actualiza los desnormalizados. Frontend: un compositor en la vista de chat + acción `enviar` en el store; deshabilitado si la ventana está cerrada.

**Tech Stack:** Node/Express/Sequelize (backend), `axios` (ya dep), `node:test`; Vue 3/Pinia/Vitest (frontend).

## Global Constraints

- Solo `src/integrations/onemsg/` habla con 1msg o construye sus URLs. El token jamás sale al frontend.
- `POST /sendMessage` solo funciona con la sesión abierta (ventana 24h). Fuera de ella NO se intenta (se responde 409).
- Todo envío pasa por reintento con backoff (429 = rate limit).
- Persistir antes de nada visible; idempotencia por `wa_message_id` (el echo del webhook llega después con el mismo id).
- Los salientes se prefijan con `wa_agentes.firma` (si está definida; hoy los agentes no tienen firma → sin prefijo).
- El endpoint de envío re-valida `wa_agentes.activo` (primer endpoint de escritura).
- Nombres de dominio en español, técnicos en inglés. `'use strict'`, CommonJS (backend).
- Tests: lógica pura y el cliente onemsg con `node:test` (axios mockeado); el compositor se valida en navegador.

---

### Task 1: Cliente de envío 1msg (`enviarTexto`)

**Files:**
- Create: `src/integrations/onemsg/envio.js`
- Test: `test/onemsg-envio.test.js`

**Interfaces:**
- Consumes: `axios`, `env.onemsg` (`baseUrl`, `instanceId`, `token`), `retryWithBackoff` (`src/utils/reintentos`), `OneMsgError` (`src/utils/errors`).
- Produces: `enviarTexto({ chatId, texto, quotedMsgId }, deps?): Promise<{ id: string, sent: boolean }>`. `deps.http` permite inyectar un cliente falso en tests. Lanza `OneMsgError` (con `.codigo` si 1msg lo da) cuando `sent` no es true; reintenta en 429.

- [ ] **Step 1: Escribir el test que falla**

`test/onemsg-envio.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enviarTexto } = require('../src/integrations/onemsg/envio');

function httpFalso(respuestas) {
  const llamadas = [];
  return {
    llamadas,
    post: async (url, body) => {
      llamadas.push({ url, body: body.toString() });
      const r = respuestas[llamadas.length - 1];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

test('envío exitoso devuelve id y sent', async () => {
  const http = httpFalso([{ status: 200, data: { sent: true, id: 'wamid.NEW1' } }]);
  const r = await enviarTexto({ chatId: '57300@c.us', texto: 'hola' }, { http });
  assert.equal(r.id, 'wamid.NEW1');
  assert.equal(r.sent, true);
  assert.match(http.llamadas[0].url, /\/sendMessage\?token=/);
  assert.match(http.llamadas[0].body, /body=hola/);
  assert.match(http.llamadas[0].body, /chatId=57300/);
});

test('429 reintenta y luego pasa', async () => {
  const http = httpFalso([
    { status: 429, data: { message: 'rate limit' } },
    { status: 200, data: { sent: true, id: 'wamid.NEW2' } },
  ]);
  const r = await enviarTexto({ chatId: '57300@c.us', texto: 'x' }, { http, baseMs: 1 });
  assert.equal(r.id, 'wamid.NEW2');
  assert.equal(http.llamadas.length, 2);
});

test('respuesta sin sent lanza OneMsgError con código', async () => {
  const http = httpFalso([{ status: 200, data: { sent: false, error: { code: 131047 }, message: 'outside window' } }]);
  await assert.rejects(() => enviarTexto({ chatId: '57300@c.us', texto: 'x' }, { http, baseMs: 1 }), (e) => e.codigo === '131047');
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `<env dummy> node --test test/onemsg-envio.test.js`
Expected: FAIL (módulo no existe). (`<env dummy>` = `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn`)

- [ ] **Step 3: Implementar**

`src/integrations/onemsg/envio.js`:

```js
'use strict';

const axios = require('axios');
const env = require('../../config/env');
const { retryWithBackoff } = require('../../utils/reintentos');
const { OneMsgError } = require('../../utils/errors');

function construirUrl(path) {
  return `${env.onemsg.baseUrl}/${env.onemsg.instanceId}/${path}?token=${env.onemsg.token}`;
}

/** Extrae un código de error de la respuesta de 1msg, si lo trae. */
function codigoDe(data) {
  const c = data && (data.error?.code ?? data.error?.error_code ?? data.code);
  return c != null ? String(c) : null;
}

/**
 * Envía un texto por 1msg (POST /sendMessage). Reintenta en 429.
 * @returns {Promise<{id:string, sent:boolean}>}
 */
async function enviarTexto({ chatId, texto, quotedMsgId }, deps = {}) {
  const http = deps.http || axios;
  const baseMs = deps.baseMs || 800;

  const params = new URLSearchParams();
  params.append('body', texto);
  params.append('chatId', chatId);
  if (quotedMsgId) params.append('quotedMsgId', quotedMsgId);

  const resp = await retryWithBackoff(
    async () => {
      const r = await http.post(construirUrl('sendMessage'), params, {
        timeout: 20000,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        validateStatus: (s) => s < 500,
      });
      if (r.status === 429) {
        const e = new Error('rate limit de 1msg (429)');
        e.reintentable = true;
        throw e;
      }
      return r;
    },
    { intentos: 3, baseMs, shouldRetry: (e) => e.reintentable === true },
  );

  const data = resp.data || {};
  if (data.sent === true && data.id) {
    return { id: String(data.id), sent: true };
  }
  throw new OneMsgError(data.message || 'envío no confirmado por 1msg', { codigo: codigoDe(data) });
}

module.exports = { enviarTexto };
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `<env dummy> node --test test/onemsg-envio.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/integrations/onemsg/envio.js test/onemsg-envio.test.js
git commit -m "feat(onemsg): cliente enviarTexto (POST /sendMessage) con reintento en 429"
```

---

### Task 2: Servicio + endpoint de envío

**Files:**
- Create: `src/services/envio.js` (helpers puros: `ventanaAbierta`, `conFirma`)
- Test: `test/envio-servicio.test.js`
- Modify: `src/controllers/conversacionesController.js` (handler `enviar`)
- Modify: `src/routes/api.js` (ruta `POST /conversaciones/:id/mensajes`)

**Interfaces:**
- Consumes: `enviarTexto` (onemsg), modelos `Conversacion`/`Contacto`/`Mensaje`/`Agente`, `puedeVer`, `requireAuth`.
- Produces:
  - `ventanaAbierta(ventanaExpiraEn, ahora=new Date()): boolean` — true si hay fecha futura.
  - `conFirma(firma, texto): string` — `firma ? firma + texto : texto`.
  - `POST /api/conversaciones/:id/mensajes` body `{ texto }` → 201 `{ mensaje }`; 400 (texto vacío), 403 (sin acceso / agente inactivo), 404, 409 (`fuera_de_ventana`), 502 (fallo de 1msg con su código).

- [ ] **Step 1: Escribir el test que falla (helpers puros)**

`test/envio-servicio.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ventanaAbierta, conFirma } = require('../src/services/envio');

test('ventanaAbierta: futura=true, pasada/null=false', () => {
  const enUnaHora = new Date(Date.now() + 3600e3);
  const haceUnaHora = new Date(Date.now() - 3600e3);
  assert.equal(ventanaAbierta(enUnaHora), true);
  assert.equal(ventanaAbierta(haceUnaHora), false);
  assert.equal(ventanaAbierta(null), false);
});

test('conFirma antepone la firma si existe', () => {
  assert.equal(conFirma('Ana | ', 'hola'), 'Ana | hola');
  assert.equal(conFirma(null, 'hola'), 'hola');
  assert.equal(conFirma('', 'hola'), 'hola');
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `<env dummy> node --test test/envio-servicio.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar los helpers**

`src/services/envio.js`:

```js
'use strict';

function ventanaAbierta(ventanaExpiraEn, ahora = new Date()) {
  if (!ventanaExpiraEn) return false;
  const exp = ventanaExpiraEn instanceof Date ? ventanaExpiraEn : new Date(ventanaExpiraEn);
  return exp.getTime() > ahora.getTime();
}

function conFirma(firma, texto) {
  return firma ? `${firma}${texto}` : texto;
}

module.exports = { ventanaAbierta, conFirma };
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `<env dummy> node --test test/envio-servicio.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Implementar el handler `enviar`**

En `src/controllers/conversacionesController.js`, añadir imports y el handler. Requiere `Contacto`, `Mensaje`, `Agente`, `enviarTexto`, `ventanaAbierta`, `conFirma`, constantes:

```js
const { Contacto, Mensaje, Agente } = require('../models');
const { enviarTexto } = require('../integrations/onemsg/envio');
const { ventanaAbierta, conFirma } = require('../services/envio');
const { DIRECCION, TIPO_MENSAJE, ESTADO_MENSAJE } = require('../config/constants');
```

```js
async function enviar(req, res) {
  const texto = (req.body && req.body.texto ? String(req.body.texto) : '').trim();
  if (!texto) return res.status(400).json({ error: 'texto vacío' });

  try {
    const conv = await Conversacion.findByPk(req.params.id, {
      include: [{ model: Contacto, as: 'contacto', attributes: ['id', 'waId'] }],
    });
    if (!conv) return res.status(404).json({ error: 'no encontrada' });
    if (!puedeVer(req.agente, conv)) return res.status(403).json({ error: 'sin acceso' });

    // Re-validar el agente (primer endpoint de escritura) y obtener su firma.
    const agente = await Agente.findByPk(req.agente.id);
    if (!agente || !agente.activo) return res.status(403).json({ error: 'agente inactivo' });

    if (!ventanaAbierta(conv.ventanaExpiraEn)) {
      return res.status(409).json({ error: 'fuera de la ventana de 24h', codigo: 'fuera_de_ventana' });
    }

    const textoFinal = conFirma(agente.firma, texto);
    let enviado;
    try {
      enviado = await enviarTexto({ chatId: conv.contacto.waId, texto: textoFinal });
    } catch (err) {
      logger.error(`envío 1msg falló (conv ${conv.id}): ${err.message} [${err.codigo || ''}]`);
      return res.status(502).json({ error: 'no se pudo enviar', codigo: err.codigo || null });
    }

    const ahora = new Date();
    const [mensaje] = await Mensaje.findOrCreate({
      where: { waMessageId: enviado.id },
      defaults: {
        conversacionId: conv.id,
        waMessageId: enviado.id,
        direccion: DIRECCION.OUT,
        tipo: TIPO_MENSAJE.TEXT,
        texto: textoFinal,
        estado: enviado.sent ? ESTADO_MENSAJE.ENVIADO : ESTADO_MENSAJE.PENDIENTE,
        enviadoPorId: agente.id,
        tsProveedor: ahora,
      },
    });
    await conv.update({
      ultimoMensajeEn: ahora,
      ultimoMensajeTexto: textoFinal.slice(0, 255),
      ultimoMensajeDir: DIRECCION.OUT,
    });

    return res.status(201).json({ mensaje });
  } catch (err) {
    logger.error(`enviar conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

Exportar `enviar` junto a los demás handlers.

- [ ] **Step 6: Registrar la ruta**

En `src/routes/api.js`, junto a las de conversaciones:

```js
router.post('/conversaciones/:id/mensajes', requireAuth, convCtrl.enviar);
```

- [ ] **Step 7: Verificación local (carga de módulos + suite)**

Run: `<env dummy> node -e "require('./src/routes'); require('./src/controllers/conversacionesController'); console.log('OK carga')"`
Expected: `OK carga`.
Run: `<env dummy> node --test test/*.test.js`
Expected: toda la suite del backend verde (incluye los nuevos tests de onemsg-envio y envio-servicio).

- [ ] **Step 8: Commit**

```bash
git add src/services/envio.js test/envio-servicio.test.js src/controllers/conversacionesController.js src/routes/api.js
git commit -m "feat(bandeja): endpoint POST /conversaciones/:id/mensajes (enviar texto, ventana 24h, firma)"
```

---

### Task 3: Compositor en el frontend

**Files:**
- Create: `frontend/src/components/Compositor.vue`
- Modify: `frontend/src/stores/chat.js` (acción `enviar`)
- Test: `frontend/src/stores/chat.test.js` (test de `enviar`)
- Modify: `frontend/src/components/VistaChat.vue` (montar el compositor)
- Modify: `frontend/src/utils/formato.js` (+ test) — `ventanaAbierta(fecha)`

**Interfaces:**
- Produces:
  - `formato.ventanaAbierta(fecha): boolean` (misma lógica que el backend, para habilitar el compositor).
  - store `useChat.enviar(texto)`: `POST /conversaciones/:id/mensajes` con `{texto}`; en éxito hace push del mensaje a `this.mensajes` y actualiza `ultimoMensaje*` del item en `useConversaciones`. Estado `enviando` + `errorEnvio`.
  - `Compositor.vue`: input + botón; deshabilitado y con aviso si la ventana está cerrada; Enter envía.

- [ ] **Step 1: Añadir `ventanaAbierta` a formato + test**

En `frontend/src/utils/formato.js`:

```js
export function ventanaAbierta(fecha) {
  if (!fecha) return false;
  const d = new Date(fecha);
  return !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
}
```

En `frontend/src/utils/formato.test.js` (append):

```js
import { ventanaAbierta } from './formato';
it('ventanaAbierta: futura true, pasada/null false', () => {
  expect(ventanaAbierta(new Date(Date.now() + 3600e3).toISOString())).toBe(true);
  expect(ventanaAbierta(new Date(Date.now() - 3600e3).toISOString())).toBe(false);
  expect(ventanaAbierta(null)).toBe(false);
});
```

- [ ] **Step 2: Test de `enviar` en el store (falla primero)**

En `frontend/src/stores/chat.test.js` (append, dentro del describe):

```js
it('enviar hace POST y agrega el mensaje', async () => {
  const chat = useChat();
  chat.conversacion = { id: 7, contacto: {} };
  chat.mensajes = [];
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 201, json: async () => ({ mensaje: { id: 99, direccion: 'out', texto: 'hola' } }),
  });
  await chat.enviar('hola');
  expect(chat.mensajes.at(-1).id).toBe(99);
  expect(global.fetch).toHaveBeenCalledWith('/api/conversaciones/7/mensajes', expect.objectContaining({ method: 'POST' }));
});
```

Run `npm --prefix frontend test` → FAIL (no existe `enviar`).

- [ ] **Step 3: Implementar `enviar` en `frontend/src/stores/chat.js`**

Añadir la acción (y `enviando`/`errorEnvio` al state):

```js
    async enviar(texto) {
      if (!this.conversacion) return;
      const convId = this.conversacion.id;
      this.enviando = true;
      this.errorEnvio = '';
      try {
        const r = await apiFetch(`/conversaciones/${convId}/mensajes`, {
          method: 'POST',
          body: JSON.stringify({ texto }),
        });
        if (this.conversacion && this.conversacion.id === convId) this.mensajes.push(r.mensaje);
        const item = useConversaciones().items.find((c) => c.id === convId);
        if (item) { item.ultimoMensajeTexto = r.mensaje.texto; item.ultimoMensajeEn = r.mensaje.tsProveedor; item.ultimoMensajeDir = 'out'; }
      } catch (e) {
        this.errorEnvio = e.codigo === 'fuera_de_ventana' ? 'La ventana de 24h está cerrada.' : 'No se pudo enviar.';
      } finally {
        this.enviando = false;
      }
    },
```

(Añadir `enviando: false, errorEnvio: ''` al `state`.)

Run `npm --prefix frontend test` → PASS.

- [ ] **Step 4: Implementar `Compositor.vue`**

```vue
<script setup>
import { ref, computed } from 'vue';
import { useChat } from '../stores/chat';
import { ventanaAbierta } from '../utils/formato';

const chat = useChat();
const texto = ref('');
const abierta = computed(() => ventanaAbierta(chat.conversacion?.ventanaExpiraEn));

async function enviar() {
  const t = texto.value.trim();
  if (!t || chat.enviando) return;
  texto.value = '';
  await chat.enviar(t);
}
</script>

<template>
  <div class="bg-[#f0f2f5] border-t border-gray-200 p-2.5">
    <div v-if="!abierta" class="text-center text-[12px] text-amber-700 bg-amber-50 rounded py-1.5 px-2">
      Fuera de la ventana de 24h — el cliente debe escribir primero (plantillas en el próximo plan).
    </div>
    <div v-else class="flex items-center gap-2">
      <input v-model="texto" @keydown.enter="enviar" :disabled="chat.enviando"
        placeholder="Escribe un mensaje…" class="flex-1 bg-white rounded-full px-4 py-2 text-[13px] outline-none" />
      <button @click="enviar" :disabled="chat.enviando || !texto.trim()"
        class="w-10 h-10 rounded-full bg-marca text-white grid place-items-center disabled:opacity-50">➤</button>
    </div>
    <div v-if="chat.errorEnvio" class="text-center text-[12px] text-red-600 mt-1">{{ chat.errorEnvio }}</div>
  </div>
</template>
```

- [ ] **Step 5: Montar el compositor en `VistaChat.vue`**

Importar `Compositor` y colocarlo al final del bloque del chat abierto, después del contenedor de mensajes (dentro del `<div v-else class="h-full flex flex-col ...">`):

```vue
<Compositor />
```
(y `import Compositor from './Compositor.vue';` en el script).

- [ ] **Step 6: Verificar tests + build**

Run: `npm --prefix frontend test` (verde) y `npm --prefix frontend run build` (compila).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Compositor.vue frontend/src/stores/chat.js frontend/src/stores/chat.test.js frontend/src/components/VistaChat.vue frontend/src/utils/formato.js frontend/src/utils/formato.test.js
git commit -m "feat(frontend): compositor para enviar texto (con ventana 24h)"
```

---

### Task 4: Despliegue + prueba real coordinada (controlador)

**Files:** (ninguno — despliegue/verificación)

- [ ] **Step 1: Merge + despliegue**

Tras la revisión final: merge a `main`, luego en el servidor `git pull`, `npm ci` (backend, sin deps nuevas más allá de las existentes), `npm --prefix frontend ci --include=dev && npm --prefix frontend run build`, y `pm2 restart wa-backend` (el endpoint de envío es backend nuevo → sí requiere reinicio).

- [ ] **Step 2: Prueba real segura (coordinada con el humano)**

1. El humano escribe desde su WhatsApp personal al número de la empresa → abre ventana; el worker crea/actualiza el chat.
2. En la bandeja, abrir ESE chat y enviar un texto de prueba.
3. Confirmar: llega al WhatsApp personal, aparece como burbuja saliente con estado, y luego el ack lo pasa a entregado/leído.

No disparar envíos a otros números.

---

## Notas de cobertura del spec (Plan 4)

Cubre del spec: §5 envío de texto (`POST /conversaciones/:id/mensajes`), ventana 24h, firma del agente, aislamiento de 1msg en `integrations/onemsg`, reintento en 429, persistir el saliente e idempotencia por `wa_message_id`. **Fuera de este plan** (Plan 5+): selector de plantillas fuera de ventana, tiempo real (Socket.io — por ahora el saliente aparece por la respuesta HTTP), tomar/asignar, adjuntar media, notas/etiquetas.
