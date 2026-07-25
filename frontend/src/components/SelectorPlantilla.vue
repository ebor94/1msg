<script setup>
import { ref, computed, onMounted } from 'vue';
import { useAcciones } from '../stores/acciones';
import { useChat } from '../stores/chat';

const emit = defineEmits(['cerrar']);
const acc = useAcciones();
const chat = useChat();
const elegida = ref(null);
const valores = ref([]);
const imagenUrl = ref('');
const error = ref('');
const enviando = ref(false);

onMounted(() => acc.cargarPlantillas());

function elegir(p) {
  elegida.value = p;
  valores.value = Array.from({ length: p.variables }, () => '');
  imagenUrl.value = p.tieneImagen ? (p.imagenDefault || '') : '';
}
const preview = computed(() => {
  if (!elegida.value) return '';
  return elegida.value.cuerpo.replace(/\{\{(\d+)\}\}/g, (_, n) => valores.value[Number(n) - 1] || `{{${n}}}`);
});
async function enviar() {
  error.value = '';
  if (valores.value.some((v) => !String(v).trim())) { error.value = 'Completa todas las variables.'; return; }
  if (elegida.value.tieneImagen && !imagenUrl.value.trim()) { error.value = 'La URL de la imagen es requerida.'; return; }
  enviando.value = true;
  try {
    await acc.enviarPlantilla(chat.conversacion.id, {
      template: elegida.value.name,
      language: elegida.value.language,
      namespace: elegida.value.namespace,
      variables: valores.value,
      imagenUrl: elegida.value.tieneImagen ? imagenUrl.value.trim() : undefined,
    });
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
        <div v-if="elegida.tieneImagen" class="mb-2">
          <label class="text-[11px] text-gray-400">URL de la imagen</label>
          <input v-model="imagenUrl" class="w-full border rounded px-2 py-1.5 text-[13px]" />
        </div>
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
