<script setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import { useChat } from '../stores/chat';
import { useAcciones } from '../stores/acciones';
import { useConversaciones } from '../stores/conversaciones';
import { ventanaAbierta } from '../utils/formato';
import SelectorPlantilla from './SelectorPlantilla.vue';
import PanelRespuestas from './PanelRespuestas.vue';

const chat = useChat();
const acc = useAcciones();
const texto = ref('');
const mostrarSelector = ref(false);
const mostrarRespuestas = ref(false);
const abierta = computed(() => ventanaAbierta(chat.conversacion?.ventanaExpiraEn));

function insertarRespuesta(t) {
  texto.value = texto.value.trim() ? `${texto.value.trim()} ${t}` : t;
  mostrarRespuestas.value = false;
}

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
      : e.codigo === 'tomada' ? 'Otro agente ya tomó este chat.'
      : e.codigo === 'audio' ? 'No se pudo procesar el audio.'
      : e.codigo === 'contacto_desactivado' ? 'El contacto está desactivado; reactívalo para escribirle.'
      : (e.status === 413 ? 'El archivo supera 16 MB.' : 'No se pudo enviar el archivo.');
    if (e.codigo === 'tomada') useConversaciones().cargar();
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
      <button @click="mostrarRespuestas = true" title="Respuestas rápidas"
        class="w-10 h-10 rounded-full bg-white text-marca-oscuro grid place-items-center shrink-0 hover:bg-gray-100">⚡</button>
      <input ref="fileInput" type="file" class="hidden" @change="elegirArchivo" />
      <input v-model="texto" @keydown.enter="enviar" @paste="onPaste" :disabled="chat.enviando"
        placeholder="Escribe un mensaje…" class="flex-1 bg-white rounded-full px-4 py-2 text-[13px] outline-none" />
      <button @click="enviar" :disabled="chat.enviando || !texto.trim()"
        class="w-10 h-10 rounded-full bg-marca text-white grid place-items-center disabled:opacity-50">➤</button>
    </div>

    <div v-if="chat.errorEnvio" class="text-center text-[12px] text-red-600 mt-1">{{ chat.errorEnvio }}</div>
    <SelectorPlantilla v-if="mostrarSelector" @cerrar="mostrarSelector = false" />
    <PanelRespuestas v-if="mostrarRespuestas" @elegir="insertarRespuesta" @cerrar="mostrarRespuestas = false" />
  </div>
</template>
