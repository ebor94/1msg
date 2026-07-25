# Fase 2 · Plan 7 — Plantillas (enviar fuera de la ventana de 24h)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un agente, cuando la ventana de 24h está cerrada, elija una plantilla aprobada, llene sus variables de cuerpo `{{n}}` y la envíe por 1msg; el mensaje aparece en el chat como saliente.

**Architecture:** Cliente aislado en `src/integrations/onemsg/plantillas.js` que llama a `GET /templates` (listar) y `POST /sendTemplate` (enviar, JSON, `language:{code}`, `params` = array de componentes WhatsApp). Un endpoint `GET /api/plantillas` devuelve las aprobadas ya parseadas (cuerpo + nº de variables); `POST /api/conversaciones/:id/plantilla` arma los `params`, envía, persiste el saliente (tipo `template`) y emite por socket. Frontend: cuando la ventana está cerrada, el compositor ofrece "Usar plantilla" → un selector con las variables a llenar.

**Tech Stack:** Express/Sequelize/axios/`node:test` (backend), Vue 3/Pinia/Vitest (frontend). Reutiliza `retryWithBackoff`, el socket (`emitir`) y el compositor del Plan 4.

## Global Constraints

- Solo `src/integrations/onemsg/` habla con 1msg. El token jamás sale al frontend.
- `sendTemplate` funciona **fuera** de la ventana de 24h; el endpoint de plantilla NO valida ventana (a diferencia del texto).
- `params` = array de componentes WhatsApp; para el cuerpo: `[{ type:'body', parameters:[{type:'text', text:v1}, ...] }]`. Si la plantilla no tiene variables de cuerpo → `params: []`. Botones estáticos e imágenes fijas NO van en params (los resuelve 1msg).
- Persistir antes de emitir; idempotencia por `wa_message_id` (el echo del webhook llega después).
- El saliente se guarda con `tipo='template'`, `plantilla_nombre`, y `texto` = cuerpo con las variables ya sustituidas (para mostrarlo en el chat).
- Reintento con backoff en 429.
- Nombres de dominio en español, técnicos en inglés; `'use strict'`, CommonJS; nada de `console.log`.
- Enviar plantilla NO abre la ventana (solo la abre el cliente al responder): tras enviarla, el compositor sigue mostrando "fuera de ventana".

---

### Task 1: Cliente 1msg de plantillas + parseo

**Files:**
- Create: `src/integrations/onemsg/plantillas.js`
- Create: `src/services/plantillas.js` (helpers puros: parseo/render)
- Test: `test/onemsg-plantillas.test.js`, `test/plantillas-servicio.test.js`

**Interfaces:**
- `onemsg/plantillas.js`: `listarPlantillas(deps?): Promise<Array>` (GET /templates; devuelve las `status==='approved'`); `enviarPlantilla({ phone, template, language, params }, deps?): Promise<{id, sent}>` (POST /sendTemplate JSON; reintenta 429; lanza `OneMsgError` si no `sent`).
- `services/plantillas.js`:
  - `contarVariables(cuerpo): number` — nº de `{{n}}` distintos.
  - `renderizarCuerpo(cuerpo, variables): string` — sustituye `{{i}}` por `variables[i-1]` (vacío si falta).
  - `construirParams(variables): Array` — `[]` si vacío, o `[{type:'body', parameters: variables.map(v=>({type:'text', text:String(v)}))}]`.
  - `parsearPlantilla(t): { name, language, categoria, cuerpo, variables, tieneImagen, tieneBotones }` — extrae de `t.components`.

- [ ] **Step 1: Tests puros (parseo/render)**

`test/plantillas-servicio.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contarVariables, renderizarCuerpo, construirParams, parsearPlantilla } = require('../src/services/plantillas');

test('contarVariables cuenta {{n}} distintos', () => {
  assert.equal(contarVariables('Hola {{1}}, saldo {{2}} vence {{2}}'), 2);
  assert.equal(contarVariables('sin variables'), 0);
});

test('renderizarCuerpo sustituye', () => {
  assert.equal(renderizarCuerpo('Hola {{1}}, ${{2}}', ['Ana', '5000']), 'Hola Ana, $5000');
});

test('construirParams: vacío → [], con vars → componente body', () => {
  assert.deepEqual(construirParams([]), []);
  assert.deepEqual(construirParams(['a', 'b']), [
    { type: 'body', parameters: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
  ]);
});

test('parsearPlantilla extrae cuerpo, variables, flags', () => {
  const t = {
    name: 'renovacion_mora', language: 'es', category: 'MARKETING', status: 'approved',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Hola' },
      { type: 'BODY', text: 'Hola {{1}}, saldo {{2}}, plan {{3}}' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'ok' }] },
    ],
  };
  const p = parsearPlantilla(t);
  assert.equal(p.name, 'renovacion_mora');
  assert.equal(p.variables, 3);
  assert.equal(p.tieneBotones, true);
  assert.equal(p.tieneImagen, false);
  assert.match(p.cuerpo, /Hola \{\{1\}\}/);
});
```

`test/onemsg-plantillas.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enviarPlantilla } = require('../src/integrations/onemsg/plantillas');

function httpFalso(respuestas) {
  const llamadas = [];
  return { llamadas, post: async (url, body) => { llamadas.push({ url, body }); const r = respuestas[llamadas.length - 1]; if (r instanceof Error) throw r; return r; } };
}

test('enviarPlantilla exitoso', async () => {
  const http = httpFalso([{ status: 200, data: { sent: true, id: 'wamid.T1' } }]);
  const r = await enviarPlantilla({ phone: '573001112233', template: 'x', language: { code: 'es' }, params: [] }, { http });
  assert.equal(r.id, 'wamid.T1');
  assert.match(http.llamadas[0].url, /\/sendTemplate\?token=/);
  assert.equal(http.llamadas[0].body.template, 'x');
});

test('enviarPlantilla sin sent → OneMsgError', async () => {
  const http = httpFalso([{ status: 200, data: { sent: false, message: 'rejected' } }]);
  await assert.rejects(() => enviarPlantilla({ phone: '1', template: 'x', language: { code: 'es' }, params: [] }, { http, baseMs: 1 }));
});
```

- [ ] **Step 2: Correr → FAIL** (`<env dummy> node --test test/onemsg-plantillas.test.js test/plantillas-servicio.test.js`).
`<env dummy>` = `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn`

- [ ] **Step 3: Implementar `src/services/plantillas.js`**

```js
'use strict';

function contarVariables(cuerpo) {
  const set = new Set((String(cuerpo || '').match(/\{\{(\d+)\}\}/g) || []));
  return set.size;
}

function renderizarCuerpo(cuerpo, variables) {
  return String(cuerpo || '').replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const v = variables[Number(n) - 1];
    return v === undefined || v === null ? '' : String(v);
  });
}

function construirParams(variables) {
  if (!variables || !variables.length) return [];
  return [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: String(v) })) }];
}

function parsearPlantilla(t) {
  const comps = t.components || [];
  const body = comps.find((c) => c.type === 'BODY');
  const header = comps.find((c) => c.type === 'HEADER');
  const cuerpo = (body && body.text) || '';
  return {
    name: t.name,
    language: typeof t.language === 'string' ? t.language : (t.language && t.language.code) || 'es',
    categoria: t.category || null,
    cuerpo,
    variables: contarVariables(cuerpo),
    tieneImagen: !!(header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format)),
    tieneBotones: comps.some((c) => c.type === 'BUTTONS'),
  };
}

module.exports = { contarVariables, renderizarCuerpo, construirParams, parsearPlantilla };
```

- [ ] **Step 4: Implementar `src/integrations/onemsg/plantillas.js`**

```js
'use strict';

const axios = require('axios');
const env = require('../../config/env');
const { retryWithBackoff } = require('../../utils/reintentos');
const { OneMsgError } = require('../../utils/errors');

function construirUrl(path) {
  return `${env.onemsg.baseUrl}/${env.onemsg.instanceId}/${path}?token=${env.onemsg.token}`;
}

async function listarPlantillas(deps = {}) {
  const http = deps.http || axios;
  const r = await http.get(construirUrl('templates'), { timeout: 20000, validateStatus: (s) => s < 500 });
  const t = (r.data && r.data.templates) || [];
  return t.filter((p) => p.status === 'approved');
}

async function enviarPlantilla({ phone, template, language, params }, deps = {}) {
  const http = deps.http || axios;
  const baseMs = deps.baseMs || 800;
  const cuerpo = { template, language, params: params || [], phone };

  const resp = await retryWithBackoff(
    async () => {
      const r = await http.post(construirUrl('sendTemplate'), cuerpo, {
        timeout: 20000,
        headers: { 'content-type': 'application/json' },
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
  if (data.sent === true && data.id) return { id: String(data.id), sent: true };
  const codigo = data.error && (data.error.code ?? data.error.error_code);
  throw new OneMsgError(data.message || 'plantilla no enviada por 1msg', { codigo: codigo != null ? String(codigo) : null });
}

module.exports = { listarPlantillas, enviarPlantilla };
```

- [ ] **Step 5: Correr → PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/integrations/onemsg/plantillas.js src/services/plantillas.js test/onemsg-plantillas.test.js test/plantillas-servicio.test.js
git commit -m "feat(plantillas): cliente onemsg (listar/enviar) + parseo/render de plantillas"
```

---

### Task 2: Endpoints de plantillas

**Files:**
- Create: `src/controllers/plantillasController.js` (`listar`)
- Modify: `src/controllers/conversacionesController.js` (`enviarPlantilla`)
- Modify: `src/routes/api.js`

**Interfaces:**
- `GET /api/plantillas` → `{ plantillas: [{name, language, categoria, cuerpo, variables, tieneImagen, tieneBotones}] }` (aprobadas, parseadas). Cachea en memoria 5 min para no golpear 1msg en cada apertura.
- `POST /api/conversaciones/:id/plantilla` body `{ template, language, variables }` → 201 `{ mensaje }`; 404; 403 (puedeVer/agente inactivo); 502 (fallo 1msg con código). NO valida ventana.

- [ ] **Step 1: Controlador de listar (con caché)**

`src/controllers/plantillasController.js`:

```js
'use strict';
const { listarPlantillas } = require('../integrations/onemsg/plantillas');
const { parsearPlantilla } = require('../services/plantillas');
const logger = require('../utils/logger');

let cache = { en: 0, datos: null };
const TTL = 5 * 60 * 1000;

async function listar(req, res) {
  try {
    const ahora = Date.now();
    if (!cache.datos || ahora - cache.en > TTL) {
      const crudas = await listarPlantillas();
      cache = { en: ahora, datos: crudas.map(parsearPlantilla) };
    }
    return res.json({ plantillas: cache.datos });
  } catch (err) {
    logger.error(`listar plantillas: ${err.message}`);
    return res.status(502).json({ error: 'no se pudieron traer las plantillas' });
  }
}

module.exports = { listar };
```

- [ ] **Step 2: Handler `enviarPlantilla`**

En `src/controllers/conversacionesController.js` (importar `enviarPlantilla` como `enviarPlantillaOnemsg` de `../integrations/onemsg/plantillas`, `renderizarCuerpo`/`construirParams` de `../services/plantillas`):

```js
async function enviarPlantilla(req, res) {
  const { template, language, variables } = req.body || {};
  if (!template) return res.status(400).json({ error: 'plantilla requerida' });
  const vars = Array.isArray(variables) ? variables : [];

  try {
    const conv = await Conversacion.findByPk(req.params.id, {
      include: [{ model: Contacto, as: 'contacto', attributes: ['id', 'waId', 'telefono'] }],
    });
    if (!conv) return res.status(404).json({ error: 'no encontrada' });
    if (!puedeVer(req.agente, conv)) return res.status(403).json({ error: 'sin acceso' });
    const agente = await Agente.findByPk(req.agente.id);
    if (!agente || !agente.activo) return res.status(403).json({ error: 'agente inactivo' });

    let enviado;
    try {
      enviado = await enviarPlantillaOnemsg({
        phone: conv.contacto.telefono,
        template,
        language: { code: language || 'es' },
        params: construirParams(vars),
      });
    } catch (err) {
      logger.error(`envío plantilla 1msg falló (conv ${conv.id}): ${err.message} [${err.codigo || ''}]`);
      return res.status(502).json({ error: 'no se pudo enviar la plantilla', codigo: err.codigo || null });
    }

    const textoMostrar = `[plantilla: ${template}]`;
    const ahora = new Date();
    const [mensaje] = await Mensaje.findOrCreate({
      where: { waMessageId: enviado.id },
      defaults: {
        conversacionId: conv.id, waMessageId: enviado.id, direccion: DIRECCION.OUT,
        tipo: TIPO_MENSAJE.TEMPLATE, texto: textoMostrar, plantillaNombre: template,
        estado: enviado.sent ? ESTADO_MENSAJE.ENVIADO : ESTADO_MENSAJE.PENDIENTE,
        enviadoPorId: agente.id, tsProveedor: ahora,
      },
    });
    await conv.update({ ultimoMensajeEn: ahora, ultimoMensajeTexto: textoMostrar.slice(0, 255), ultimoMensajeDir: DIRECCION.OUT });
    emitir('mensaje:nuevo', { agenteId: conv.agenteId, general: !conv.agenteId }, { conversacionId: conv.id, mensaje });
    return res.status(201).json({ mensaje });
  } catch (err) {
    logger.error(`enviarPlantilla conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

(Nota: el texto que se muestra en el chat es `[plantilla: <nombre>]`; el cuerpo real con variables lo renderiza el frontend en el selector antes de enviar, pero no lo persistimos aquí para v1 — se puede mejorar guardando el renderizado.)

Exportar `enviarPlantilla`.

- [ ] **Step 3: Rutas**

En `src/routes/api.js` (importar `plantillasCtrl`):

```js
router.get('/plantillas', requireAuth, plantillasCtrl.listar);
router.post('/conversaciones/:id/plantilla', requireAuth, convCtrl.enviarPlantilla);
```

- [ ] **Step 4: Verificar** carga (`<env dummy> node -e "require('./src/routes')"`) y suite verde.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/plantillasController.js src/controllers/conversacionesController.js src/routes/api.js
git commit -m "feat(plantillas): endpoints GET /plantillas (caché) y POST /conversaciones/:id/plantilla"
```

---

### Task 3: Selector de plantillas en el frontend

**Files:**
- Modify: `frontend/src/stores/acciones.js` (`cargarPlantillas`, `enviarPlantilla`)
- Create: `frontend/src/components/SelectorPlantilla.vue`
- Modify: `frontend/src/components/Compositor.vue` (botón "Usar plantilla" cuando la ventana está cerrada)

**Interfaces:**
- store: `plantillas: []`, `cargarPlantillas()` (GET /plantillas), `enviarPlantilla(convId, {template, language, variables})` (POST; hace push del mensaje al chat como el envío de texto).
- `SelectorPlantilla.vue`: modal; lista las plantillas (nombre + preview del cuerpo); al elegir una, muestra N inputs (según `variables`) con el cuerpo renderizado en vivo; botón Enviar.

- [ ] **Step 1: Store**

En `frontend/src/stores/acciones.js` añadir a state `plantillas: []` y acciones:

```js
    async cargarPlantillas() {
      try { this.plantillas = (await apiFetch('/plantillas')).plantillas; } catch { this.plantillas = []; }
    },
    async enviarPlantilla(convId, cuerpo) {
      const r = await apiFetch(`/conversaciones/${convId}/plantilla`, { method: 'POST', body: JSON.stringify(cuerpo) });
      const chat = useChat();
      if (chat.conversacion && chat.conversacion.id === convId && !chat.mensajes.some((m) => m.id === r.mensaje.id)) {
        chat.mensajes.push(r.mensaje);
      }
      return r.mensaje;
    },
```

- [ ] **Step 2: `SelectorPlantilla.vue`**

```vue
<script setup>
import { ref, computed, onMounted } from 'vue';
import { useAcciones } from '../stores/acciones';
import { useChat } from '../stores/chat';

const emit = defineEmits(['cerrar']);
const acc = useAcciones();
const chat = useChat();
const elegida = ref(null);
const valores = ref([]);
const error = ref('');
const enviando = ref(false);

onMounted(() => acc.cargarPlantillas());

function elegir(p) {
  elegida.value = p;
  valores.value = Array.from({ length: p.variables }, () => '');
}
const preview = computed(() => {
  if (!elegida.value) return '';
  return elegida.value.cuerpo.replace(/\{\{(\d+)\}\}/g, (_, n) => valores.value[Number(n) - 1] || `{{${n}}}`);
});
async function enviar() {
  error.value = '';
  if (valores.value.some((v) => !String(v).trim())) { error.value = 'Completa todas las variables.'; return; }
  enviando.value = true;
  try {
    await acc.enviarPlantilla(chat.conversacion.id, { template: elegida.value.name, language: elegida.value.language, variables: valores.value });
    emit('cerrar');
  } catch (e) {
    error.value = e.codigo ? `No se pudo enviar (${e.codigo}).` : 'No se pudo enviar la plantilla.';
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg p-4 w-[420px] max-h-[80vh] overflow-auto shadow-lg">
      <div class="flex justify-between items-center mb-3">
        <h3 class="text-sm font-semibold text-gray-800">Enviar plantilla</h3>
        <button class="text-gray-400 text-sm" @click="emit('cerrar')">✕</button>
      </div>
      <div v-if="!elegida">
        <div v-for="p in acc.plantillas" :key="p.name" @click="elegir(p)"
          class="border-b border-gray-100 py-2 px-1 cursor-pointer hover:bg-gray-50">
          <div class="text-[13px] font-medium text-gray-800">{{ p.name }}</div>
          <div class="text-[12px] text-gray-500 line-clamp-2">{{ p.cuerpo }}</div>
        </div>
        <div v-if="!acc.plantillas.length" class="text-center text-gray-400 text-sm py-4">Cargando plantillas…</div>
      </div>
      <div v-else>
        <button class="text-[12px] text-marca-oscuro mb-2" @click="elegida = null">‹ Otra plantilla</button>
        <div class="bg-[#d9fdd3] rounded p-2 text-[13px] whitespace-pre-wrap mb-3">{{ preview }}</div>
        <div v-for="(_, i) in valores" :key="i" class="mb-2">
          <label class="text-[11px] text-gray-400">Variable {{ i + 1 }}</label>
          <input v-model="valores[i]" class="w-full border rounded px-2 py-1.5 text-[13px]" />
        </div>
        <div v-if="error" class="text-[12px] text-red-500 mb-2">{{ error }}</div>
        <button :disabled="enviando" @click="enviar"
          class="w-full bg-marca text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-60">
          {{ enviando ? 'Enviando…' : 'Enviar plantilla' }}
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Botón en `Compositor.vue`**

En el bloque `v-if="!abierta"` (ventana cerrada), añadir un botón "Usar plantilla" que abra el selector (con un `ref mostrarSelector`), y montar `<SelectorPlantilla v-if="mostrarSelector" @cerrar="mostrarSelector=false" />`:

```vue
<script setup>
import { ref, computed } from 'vue';
import { useChat } from '../stores/chat';
import { ventanaAbierta } from '../utils/formato';
import SelectorPlantilla from './SelectorPlantilla.vue';
const chat = useChat();
const texto = ref('');
const mostrarSelector = ref(false);
const abierta = computed(() => ventanaAbierta(chat.conversacion?.ventanaExpiraEn));
async function enviar() { const t = texto.value.trim(); if (!t || chat.enviando) return; texto.value = ''; await chat.enviar(t); }
</script>
```

Template del bloque cerrado:

```vue
    <div v-if="!abierta" class="text-center text-[12px] text-amber-700 bg-amber-50 rounded py-2 px-2">
      Fuera de la ventana de 24h.
      <button class="ml-2 underline text-marca-oscuro font-semibold" @click="mostrarSelector = true">Usar plantilla</button>
    </div>
    <SelectorPlantilla v-if="mostrarSelector" @cerrar="mostrarSelector = false" />
```

(El resto del compositor — input de texto cuando `abierta` — no cambia.)

- [ ] **Step 4: Verificar** `npm --prefix frontend test` (verde) y `npm --prefix frontend run build`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/acciones.js frontend/src/components/SelectorPlantilla.vue frontend/src/components/Compositor.vue
git commit -m "feat(frontend): selector de plantillas fuera de la ventana de 24h"
```

---

### Task 4: Despliegue + prueba real (controlador)

- [ ] **Step 1:** Merge a `main`; en el servidor `git pull`, `npm --prefix frontend ci --include=dev && npm --prefix frontend run build`, `pm2 restart wa-backend`; `/health` 200.
- [ ] **Step 2: Validar el formato de `params` con una prueba real segura.** Abrir un chat cuyo cliente sea un número propio (ej. el WhatsApp personal del agente), con la ventana cerrada → "Usar plantilla" → elegir una simple (ej. `recordatorio_de_mora`, 2 vars) → llenar y enviar. Confirmar en el WhatsApp personal que llega, y en la base que se guardó el saliente `tipo=template`. **Si 1msg rechaza el `params`**, revisar el error/código: probable que el formato de componentes deba ajustarse (flat array vs componentes) — iterar en `construirParams` y `enviarPlantilla`.

---

## Notas de cobertura del spec (Plan 7)

Cubre del spec: selector de plantillas fuera de ventana (`GET /plantillas`, `POST /conversaciones/:id/plantilla`, `sendTemplate`), aislamiento 1msg, reintento 429, persistir el saliente `template`. **Fuera de este plan / a iterar**: guardar el cuerpo renderizado (no solo `[plantilla: x]`), plantillas con header de imagen/variable dinámica o botones con parámetros, previsualizar la imagen del header, y validación fina del formato de `params` (se confirma en la prueba real).
