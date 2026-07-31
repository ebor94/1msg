<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { horaCorta, iconoEstado, esLeido, etiquetaTipo, tamanoLegible } from '../utils/formato';
import { fetchMediaBlob } from '../api/cliente';

const props = defineProps({ mensaje: { type: Object, required: true } });
const saliente = computed(() => props.mensaje.direccion === 'out');

const TIPOS_MEDIA = ['image', 'sticker', 'audio', 'video', 'document'];
const esMedia = computed(() => TIPOS_MEDIA.includes(props.mensaje.tipo));
const caption = computed(() => props.mensaje.texto || '');

// Texto a mostrar en burbujas NO-media. Las tarjetas de contacto (vCard) llegan
// como tipo 'system' con un base64 gigante sin espacios; en vez de volcarlo
// (rompe el layout), mostramos una etiqueta.
const contenidoTexto = computed(() => {
  const t = caption.value;
  const esBlob = t && t.length > 200 && !/\s/.test(t); // base64/cadena sin espacios
  if (props.mensaje.tipo === 'system' && esBlob) return '📇 Tarjeta de contacto';
  return t || etiquetaTipo(props.mensaje.tipo);
});

const media = ref(null); // { blob, url, filename, mime }
const estado = ref('idle'); // idle | cargando | listo | error
const ampliada = ref(false);

let vivo = true; // false tras desmontar: evita fijar estado o dejar blobs sin revocar
let reintentoId = null;

async function cargar(reintentos = 1) {
  estado.value = 'cargando';
  try {
    const r = await fetchMediaBlob(`/mensajes/${props.mensaje.id}/media`);
    if (!vivo) { URL.revokeObjectURL(r.url); return; } // llegó tras desmontar
    media.value = r;
    estado.value = 'listo';
  } catch (e) {
    if (!vivo) return;
    if (e.status === 404 && reintentos > 0) {
      reintentoId = setTimeout(() => cargar(reintentos - 1), 1500);
      return;
    }
    estado.value = 'error';
  }
}

function onKey(e) {
  if (ampliada.value && e.key === 'Escape') ampliada.value = false;
}

onMounted(() => {
  if (esMedia.value) cargar();
  window.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  vivo = false;
  window.removeEventListener('keydown', onKey);
  if (reintentoId) clearTimeout(reintentoId);
  if (media.value?.url) URL.revokeObjectURL(media.value.url);
});
</script>

<template>
  <div class="flex" :class="saliente ? 'justify-end' : 'justify-start'">
    <div class="max-w-[75%] min-w-0 px-2.5 py-1.5 rounded-lg text-[13.5px] leading-snug shadow-sm"
      :class="saliente ? 'bg-[#d9fdd3] rounded-tr-sm' : 'bg-white rounded-tl-sm'">

      <div v-if="saliente && mensaje.enviadoPor" class="text-[10px] text-gray-500 font-medium mb-0.5">{{ mensaje.enviadoPor.nombre }}</div>

      <div v-if="esMedia" class="mb-0.5">
        <div v-if="estado === 'cargando' || estado === 'idle'" class="text-[12px] text-gray-400 py-3 text-center">Cargando…</div>
        <div v-else-if="estado === 'error'" class="text-[12px] text-gray-400 py-3 text-center">📎 Archivo no disponible</div>
        <template v-else>
          <img v-if="mensaje.tipo === 'image' || mensaje.tipo === 'sticker'" :src="media.url"
            class="rounded max-h-64 cursor-pointer" @click="ampliada = true" alt="" />
          <audio v-else-if="mensaje.tipo === 'audio'" :src="media.url" controls class="max-w-full" />
          <video v-else-if="mensaje.tipo === 'video'" :src="media.url" controls class="rounded max-h-64 max-w-full" />
          <a v-else :href="media.url" :download="media.filename || 'archivo'"
            class="flex items-center gap-2 py-1 text-marca-oscuro">
            <span class="text-lg">📄</span>
            <span class="truncate max-w-[180px] underline">{{ media.filename || 'Documento' }}</span>
            <span class="text-[11px] text-gray-500 shrink-0">{{ tamanoLegible(media.blob && media.blob.size) }}</span>
          </a>
        </template>
      </div>

      <span v-if="!esMedia" class="whitespace-pre-wrap [overflow-wrap:anywhere]">{{ contenidoTexto }}</span>
      <span v-else-if="caption" class="whitespace-pre-wrap [overflow-wrap:anywhere] block">{{ caption }}</span>

      <span class="text-[10px] text-gray-500 float-right ml-2 mt-1.5">
        {{ horaCorta(mensaje.tsProveedor) }}
        <span v-if="saliente" :class="esLeido(mensaje.estado) ? 'text-sky-500' : 'text-gray-500'">{{ iconoEstado(mensaje.estado) }}</span>
      </span>
    </div>

    <Teleport to="body">
      <div v-if="ampliada" class="fixed inset-0 z-[100] bg-black/85 overflow-auto" @click="ampliada = false">
        <!-- Barra superior fija: descargar / cerrar -->
        <div class="sticky top-0 flex items-center justify-end gap-4 px-4 py-3">
          <a :href="media.url" :download="media.filename || 'imagen'" @click.stop
            class="text-white/90 hover:text-white text-[13px] flex items-center gap-1" title="Descargar">
            <span class="text-base">⬇</span> Descargar
          </a>
          <button @click.stop="ampliada = false" title="Cerrar (Esc)"
            class="text-white/90 hover:text-white text-2xl leading-none w-9 h-9 grid place-items-center rounded-full hover:bg-white/10">✕</button>
        </div>
        <!-- La imagen se ajusta a pantalla; si es más grande, el contenedor hace scroll -->
        <div class="min-h-[calc(100%-3.5rem)] flex items-center justify-center px-4 pb-6">
          <img :src="media.url" @click.stop
            class="max-w-full max-h-[85vh] object-contain rounded shadow-lg" alt="" />
        </div>
      </div>
    </Teleport>
  </div>
</template>
