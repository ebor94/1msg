<script setup>
import { ref, computed, onMounted } from 'vue';
import { useChat } from '../stores/chat';
import { useAcciones } from '../stores/acciones';
import { tieneOrigenEInteres } from '../utils/etiquetas';

const emit = defineEmits(['cerrar']);
const chat = useChat();
const acc = useAcciones();
const guardando = ref(false);
const error = ref('');

const catalogo = computed(() => acc.catalogoEtiquetas);
const seleccion = computed(() => chat.etiquetas || []);
const completo = computed(() => tieneOrigenEInteres(seleccion.value));
const marcada = (e) => seleccion.value.some((x) => x.id === e.id);

onMounted(() => { acc.cargarEtiquetas(); });

async function alternar(e) {
  try { await acc.alternarEtiqueta(chat.conversacion.id, e); }
  catch { error.value = 'No se pudo etiquetar.'; }
}

async function resolver() {
  if (!completo.value) return;
  error.value = ''; guardando.value = true;
  try { await acc.resolver(chat.conversacion.id); chat.cerrar(); emit('cerrar'); }
  catch (e) { error.value = e.codigo === 'etiquetas_requeridas' ? 'Faltan etiquetas de origen e interés.' : (e.message || 'No se pudo resolver.'); }
  finally { guardando.value = false; }
}
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-md flex flex-col max-h-[85vh]">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Etiquetar antes de resolver</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>
      <div class="p-4 space-y-3 overflow-auto">
        <p class="text-[12px] text-gray-500">Marca una etiqueta de <b>Origen</b> y una de <b>Interés</b> para poder resolver.</p>
        <div>
          <div class="text-[11px] text-gray-400 uppercase mb-1">Origen</div>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="e in catalogo.origen" :key="e.id" @click="alternar(e)"
              class="px-2 py-1 rounded-full text-[12px] border"
              :class="marcada(e) ? 'bg-marca text-white border-marca' : 'bg-white text-gray-700 border-gray-300'">{{ e.nombre }}</button>
          </div>
        </div>
        <div>
          <div class="text-[11px] text-gray-400 uppercase mb-1">Interés</div>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="e in catalogo.interes" :key="e.id" @click="alternar(e)"
              class="px-2 py-1 rounded-full text-[12px] border"
              :class="marcada(e) ? 'bg-marca text-white border-marca' : 'bg-white text-gray-700 border-gray-300'">{{ e.nombre }}</button>
          </div>
        </div>
        <p v-if="error" class="text-[12px] text-red-600">{{ error }}</p>
      </div>
      <div class="border-t px-4 py-3 flex justify-end gap-2">
        <button class="px-3 py-1.5 text-[13px] text-gray-500" @click="emit('cerrar')">Cancelar</button>
        <button :disabled="!completo || guardando" class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px] disabled:opacity-60" @click="resolver">
          {{ guardando ? 'Resolviendo…' : 'Resolver' }}
        </button>
      </div>
    </div>
  </div>
</template>
