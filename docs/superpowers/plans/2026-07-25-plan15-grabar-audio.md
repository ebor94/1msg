# Plan 15 — Grabar audio (nota de voz) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el agente grabe una nota de voz desde el micrófono y la envíe como nota de voz nativa de WhatsApp (audio/ogg opus), reutilizando el pipeline de media del Plan 9.

**Architecture:** El navegador graba con `MediaRecorder` (webm/opus). El backend, cuando el envío es una nota de voz (`voz=1`), **transcodifica** el buffer a ogg/opus con **ffmpeg** (`src/services/audio.js`), lo guarda y lo envía con `sendFile` + `voice: true`. Frontend: botón 🎤 en el compositor con temporizador y previsualización, que produce un archivo y usa `acc.enviarMedia(..., voz=true)`.

**Tech Stack:** Express/Sequelize/`child_process`+ffmpeg (backend); Vue 3/Pinia, MediaRecorder API (frontend). ffmpeg se instala en el servidor (Tarea 3).

## Global Constraints

- Solo `src/integrations/onemsg/` habla con 1msg (se extiende `enviarArchivo` con `voice`).
- La nota de voz exige `audio/ogg` (opus) → se transcodifica en el backend antes de enviar. `voice: true` la marca como PTT nativa.
- Se reutiliza TODO el pipeline del Plan 9 (multipart, `guardarBufferComoMedia`, URL pública efímera, `sendFile`, persistir-antes-de-emitir, idempotencia). Requiere ventana 24h abierta.
- La transcodificación es best-effort-con-error-claro: si ffmpeg falla, 502 con código `audio` (nunca se envía un webm que WhatsApp no reproduce).
- `'use strict'`, CommonJS backend; sin `console.log`; sin token al frontend.

## File Structure

- `src/services/audio.js` (crear): `transcodificarAOgg(buffer)`.
- `src/integrations/onemsg/media.js` (modificar): `enviarArchivo` acepta `voice`.
- `src/controllers/conversacionesController.js` (modificar): `enviarMedia` transcodifica cuando `voz`.
- `frontend/src/stores/acciones.js` (modificar): `enviarMedia(convId, file, caption, voz)`.
- `frontend/src/components/Compositor.vue` (modificar): grabación 🎤 + preview de audio.

---

### Task 1: Backend — transcodificación + `voice` + `enviarMedia`

**Files:**
- Create: `src/services/audio.js`
- Modify: `src/integrations/onemsg/media.js`
- Modify: `src/controllers/conversacionesController.js`
- Test: `test/onemsg-enviararchivo.test.js` (existe)

**Interfaces:**
- `transcodificarAOgg(bufferEntrada): Promise<Buffer>` — convierte cualquier audio a ogg/opus con ffmpeg; rechaza si ffmpeg falla o no está.
- `enviarArchivo({ chatId, url, mediaType, caption, filename, voice }, deps?)` — añade `voice` al form si truthy.

- [ ] **Step 1: `src/services/audio.js`**

```js
'use strict';

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * Transcodifica un buffer de audio (webm/mp4/ogg/…) a ogg/opus mono 48k, apto
 * para nota de voz de WhatsApp. Usa ffmpeg vía archivos temporales.
 * @returns {Promise<Buffer>} ogg/opus.
 */
async function transcodificarAOgg(bufferEntrada) {
  const base = path.join(os.tmpdir(), `voz-${crypto.randomBytes(8).toString('hex')}`);
  const entrada = `${base}.in`;
  const salida = `${base}.ogg`;
  await fs.writeFile(entrada, bufferEntrada);
  try {
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ['-y', '-i', entrada, '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', salida]);
      let err = '';
      ff.stderr.on('data', (d) => { err += d.toString(); });
      ff.on('error', reject); // ffmpeg no instalado / no ejecutable
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg salió ${code}: ${err.slice(-200)}`))));
    });
    return await fs.readFile(salida);
  } finally {
    await fs.rm(entrada, { force: true }).catch(() => {});
    await fs.rm(salida, { force: true }).catch(() => {});
  }
}

module.exports = { transcodificarAOgg };
```

- [ ] **Step 2: `enviarArchivo` acepta `voice`**

En `src/integrations/onemsg/media.js`, en `enviarArchivo`, añadir `voice` al destructuring y al form:

```js
async function enviarArchivo({ chatId, url, mediaType, caption, filename, voice }, deps = {}) {
  const http = deps.http || axios;
  const baseMs = deps.baseMs || 800;

  const params = new URLSearchParams();
  params.append('body', url);
  if (mediaType) params.append('mediaType', mediaType);
  if (caption) params.append('caption', caption);
  if (filename) params.append('filename', filename);
  if (voice) params.append('voice', 'true');
  params.append('chatId', chatId);
  // ... resto igual
```

- [ ] **Step 3: Test de `voice` en `test/onemsg-enviararchivo.test.js`**

Añadir un caso:

```js
test('enviarArchivo con voice=true manda voice', async () => {
  const http = httpFalso([{ status: 200, data: { sent: true, id: 'wamid.V1' } }]);
  await enviarArchivo({ chatId: 'x@c.us', url: 'https://x/v.ogg', mediaType: 'audio', voice: true }, { http });
  assert.equal(http.llamadas[0].body.get('voice'), 'true');
});
```

Correr → PASS (`<env dummy> node --test test/onemsg-enviararchivo.test.js`).
`<env dummy>` = `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn`

- [ ] **Step 4: `enviarMedia` transcodifica cuando `voz`**

En `src/controllers/conversacionesController.js`, importar `const { transcodificarAOgg } = require('../services/audio');`. En el handler `enviarMedia`, tras las validaciones (ventana/PUBLIC_BASE_URL) y ANTES de `guardarBufferComoMedia`, decidir buffer/tipo/voz:

```js
    const esVoz = !!(req.body && (req.body.voz === '1' || req.body.voz === 'true'));
    let buffer = archivo.buffer;
    let contentType = archivo.mimetype;
    let nombreOriginal = archivo.originalname;
    let voice = false;
    if (esVoz) {
      try {
        buffer = await transcodificarAOgg(archivo.buffer);
      } catch (err) {
        logger.error(`transcodificar nota de voz (conv ${req.params.id}): ${err.message}`);
        return res.status(502).json({ error: 'no se pudo procesar el audio', codigo: 'audio' });
      }
      contentType = 'audio/ogg';
      nombreOriginal = 'nota-de-voz.ogg';
      voice = true;
    }

    const categoria = categoriaMedia(contentType);
    const token = crypto.randomBytes(32).toString('hex');
    const guardado = await guardarBufferComoMedia({
      buffer,
      contentType,
      conversacionId: conv.id,
      nombreArchivo: `out-${token}`,
      nombreOriginal,
      fecha: new Date(),
    });
```

Y en la llamada a `enviarArchivo`, pasar `voice`:

```js
      enviado = await enviarArchivo({
        chatId: conv.contacto.waId,
        url: urlPublica,
        mediaType: categoria,
        caption: captionFinal,
        filename: guardado.mediaNombre || undefined,
        voice,
      });
```

(El resto del handler —persistir, emitir, desnorm— no cambia; `categoria` será `audio`.)

- [ ] **Step 5: Verificar carga + suite**

```
<env dummy> node -e "require('./src/routes'); console.log('rutas OK')"
<env dummy> node --test test/*.test.js
```
Expected: "rutas OK" y suite verde. (La transcodificación real necesita ffmpeg → se valida en la prueba real, Tarea 3.)

- [ ] **Step 6: Commit**

```bash
git add src/services/audio.js src/integrations/onemsg/media.js src/controllers/conversacionesController.js test/onemsg-enviararchivo.test.js
git commit -m "feat(audio): transcodificar nota de voz a ogg/opus (ffmpeg) + sendFile voice=true"
```

---

### Task 2: Frontend — grabación 🎤 en el compositor

**Files:**
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/components/Compositor.vue`

**Interfaces:**
- Store: `enviarMedia(convId, file, caption, voz)` (nuevo 4º parámetro).

- [ ] **Step 1: `acc.enviarMedia` acepta `voz`**

En `frontend/src/stores/acciones.js`, en `enviarMedia`, añadir el parámetro y el campo:

```js
    async enviarMedia(convId, file, caption, voz) {
      const fd = new FormData();
      fd.append('archivo', file);
      if (caption) fd.append('caption', caption);
      if (voz) fd.append('voz', '1');
      // ... resto igual (fetch multipart, manejo de error, push del mensaje)
    },
```

- [ ] **Step 2: Reescribir `frontend/src/components/Compositor.vue`**

```vue
<script setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import { useChat } from '../stores/chat';
import { useAcciones } from '../stores/acciones';
import { ventanaAbierta } from '../utils/formato';
import SelectorPlantilla from './SelectorPlantilla.vue';

const chat = useChat();
const acc = useAcciones();
const texto = ref('');
const mostrarSelector = ref(false);
const abierta = computed(() => ventanaAbierta(chat.conversacion?.ventanaExpiraEn));

const adjunto = ref(null); // File
const previewUrl = ref('');
const captionAdj = ref('');
const enviandoAdj = ref(false);
const errorAdj = ref('');
const fileInput = ref(null);
const esVoz = ref(false);

// Grabación de nota de voz
const grabando = ref(false);
const segundos = ref(0);
let mediaRecorder = null;
let chunks = [];
let stream = null;
let timer = null;
let descartar = false;

const MAX = 16 * 1024 * 1024;
const mmss = computed(() => `${Math.floor(segundos.value / 60)}:${String(segundos.value % 60).padStart(2, '0')}`);

function tomarArchivo(file) {
  if (!file) return;
  if (file.size > MAX) { errorAdj.value = 'El archivo supera 16 MB.'; return; }
  errorAdj.value = '';
  adjunto.value = file;
  esVoz.value = false;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
}
function elegirArchivo(e) { tomarArchivo(e.target.files[0]); e.target.value = ''; }
function onPaste(e) {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file');
  if (item) { e.preventDefault(); tomarArchivo(item.getAsFile()); }
}
function cancelarAdj() {
  adjunto.value = null;
  captionAdj.value = '';
  errorAdj.value = '';
  esVoz.value = false;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
}
async function enviarAdj() {
  if (!adjunto.value || enviandoAdj.value) return;
  enviandoAdj.value = true;
  errorAdj.value = '';
  try {
    await acc.enviarMedia(chat.conversacion.id, adjunto.value, captionAdj.value.trim(), esVoz.value);
    cancelarAdj();
  } catch (e) {
    errorAdj.value = e.codigo === 'fuera_de_ventana' ? 'La ventana de 24h está cerrada.'
      : e.codigo === 'audio' ? 'No se pudo procesar el audio.'
      : (e.status === 413 ? 'El archivo supera 16 MB.' : 'No se pudo enviar el archivo.');
  } finally {
    enviandoAdj.value = false;
  }
}

// --- grabación ---
function mimeSoportado() {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return cands.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}
function pararStream() {
  if (timer) { clearInterval(timer); timer = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  grabando.value = false;
}
async function iniciarGrabacion() {
  errorAdj.value = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    errorAdj.value = 'No se pudo acceder al micrófono.';
    return;
  }
  chunks = [];
  descartar = false;
  const mime = mimeSoportado();
  mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const tipo = (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm';
    pararStream();
    if (descartar || !chunks.length) return;
    const blob = new Blob(chunks, { type: tipo });
    const file = new File([blob], 'nota-de-voz.webm', { type: tipo });
    adjunto.value = file;
    esVoz.value = true;
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = URL.createObjectURL(blob);
  };
  mediaRecorder.start();
  grabando.value = true;
  segundos.value = 0;
  timer = setInterval(() => { segundos.value += 1; if (segundos.value >= 120) detenerGrabacion(); }, 1000);
}
function detenerGrabacion() {
  descartar = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  else pararStream();
}
function cancelarGrabacion() {
  descartar = true;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  else pararStream();
}

watch(() => chat.conversacion?.id, () => { cancelarGrabacion(); cancelarAdj(); });
onUnmounted(() => { cancelarGrabacion(); if (previewUrl.value) URL.revokeObjectURL(previewUrl.value); });

defineExpose({ tomarArchivo });

async function enviar() {
  const t = texto.value.trim();
  if (!t || chat.enviando) return;
  texto.value = '';
  await chat.enviar(t);
}
</script>

<template>
  <div class="bg-[#f0f2f5] border-t border-gray-200 p-2.5">
    <!-- Preview de adjunto (archivo o nota de voz) -->
    <div v-if="adjunto" class="bg-white rounded-lg p-2 mb-2 shadow-sm">
      <div v-if="esVoz" class="flex items-center gap-2">
        <audio :src="previewUrl" controls class="flex-1 h-9"></audio>
        <button class="text-gray-400 text-sm" @click="cancelarAdj">✕</button>
      </div>
      <div v-else class="flex items-center gap-2">
        <img v-if="previewUrl" :src="previewUrl" class="w-14 h-14 object-cover rounded" alt="" />
        <span v-else class="text-2xl">📄</span>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] truncate">{{ adjunto.name }}</div>
          <div class="text-[11px] text-gray-400">{{ (adjunto.size / 1024 / 1024).toFixed(2) }} MB</div>
        </div>
        <button class="text-gray-400 text-sm" @click="cancelarAdj">✕</button>
      </div>
      <input v-if="!esVoz" v-model="captionAdj" placeholder="Añadir un comentario…" class="w-full mt-2 border rounded px-2 py-1.5 text-[13px]" />
      <div v-if="errorAdj" class="text-[12px] text-red-500 mt-1">{{ errorAdj }}</div>
      <button :disabled="enviandoAdj" @click="enviarAdj"
        class="w-full mt-2 bg-marca text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-60">
        {{ enviandoAdj ? 'Enviando…' : (esVoz ? 'Enviar nota de voz' : 'Enviar archivo') }}
      </button>
    </div>

    <div v-if="!abierta && !adjunto" class="text-center text-[12px] text-amber-700 bg-amber-50 rounded py-2 px-2">
      Fuera de la ventana de 24h.
      <button class="ml-2 underline text-marca-oscuro font-semibold" @click="mostrarSelector = true">Usar plantilla</button>
    </div>
    <div v-else-if="grabando" class="flex items-center gap-2">
      <span class="w-3 h-3 rounded-full bg-red-500 animate-pulse shrink-0"></span>
      <span class="text-[13px] text-gray-600 flex-1">Grabando… {{ mmss }}</span>
      <button @click="cancelarGrabacion" title="Cancelar" class="w-10 h-10 rounded-full bg-white text-gray-500 grid place-items-center shrink-0">✕</button>
      <button @click="detenerGrabacion" title="Detener" class="w-10 h-10 rounded-full bg-marca text-white grid place-items-center shrink-0">⏹</button>
    </div>
    <div v-else-if="!adjunto" class="flex items-center gap-2">
      <button @click="mostrarSelector = true" title="Usar plantilla"
        class="w-10 h-10 rounded-full bg-white text-marca-oscuro grid place-items-center shrink-0 hover:bg-gray-100">📄</button>
      <button @click="fileInput.click()" title="Adjuntar archivo"
        class="w-10 h-10 rounded-full bg-white text-marca-oscuro grid place-items-center shrink-0 hover:bg-gray-100">📎</button>
      <button @click="iniciarGrabacion" title="Grabar nota de voz"
        class="w-10 h-10 rounded-full bg-white text-marca-oscuro grid place-items-center shrink-0 hover:bg-gray-100">🎤</button>
      <input ref="fileInput" type="file" class="hidden" @change="elegirArchivo" />
      <input v-model="texto" @keydown.enter="enviar" @paste="onPaste" :disabled="chat.enviando"
        placeholder="Escribe un mensaje…" class="flex-1 bg-white rounded-full px-4 py-2 text-[13px] outline-none" />
      <button @click="enviar" :disabled="chat.enviando || !texto.trim()"
        class="w-10 h-10 rounded-full bg-marca text-white grid place-items-center disabled:opacity-50">➤</button>
    </div>

    <div v-if="chat.errorEnvio" class="text-center text-[12px] text-red-600 mt-1">{{ chat.errorEnvio }}</div>
    <SelectorPlantilla v-if="mostrarSelector" @cerrar="mostrarSelector = false" />
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
git add frontend/src/stores/acciones.js frontend/src/components/Compositor.vue
git commit -m "feat(frontend): grabar y enviar nota de voz (🎤 + MediaRecorder)"
```

---

### Task 3: Instalar ffmpeg + despliegue + prueba real

- [ ] **Step 1: Instalar ffmpeg en el servidor.** `ssh mantix 'sudo apt-get update && sudo apt-get install -y ffmpeg && ffmpeg -version | head -1'`. Confirmar la versión.
- [ ] **Step 2: Deploy.** Merge a `main`, push. En el servidor: `git pull`, `npm --prefix frontend run build`, `pm2 restart wa-backend`. `/health` 200.
- [ ] **Step 3: Prueba real.** En un chat con ventana abierta: pulsar 🎤 (el navegador pedirá permiso de micrófono la primera vez; requiere HTTPS — producción lo es) → hablar unos segundos → ⏹ → escuchar la previsualización → "Enviar nota de voz". Verificar en el WhatsApp del cliente que llega como **nota de voz reproducible**, y en la bandeja que aparece como saliente de audio (se ve con el visor del Plan 8). Probar también ✕ para cancelar sin enviar.

---

## Notas de cobertura (Plan 15)

Cubre: grabación con MediaRecorder, transcodificación a ogg/opus con ffmpeg, envío como nota de voz nativa (`voice: true`), reutilizando el pipeline de media del Plan 9. **Fuera de alcance:** forma de onda animada, pausar/reanudar la grabación, transcripción. La transcodificación se valida en la prueba real (necesita ffmpeg instalado).
