<script setup>
import { ref, onMounted } from 'vue';
import { useAcciones } from '../stores/acciones';
const emit = defineEmits(['cerrar']);
const acc = useAcciones();
const texto = ref('');
const guardando = ref(false);
const error = ref('');
onMounted(async () => { try { texto.value = await acc.obtenerPromptIa(); } catch { error.value = 'No se pudo cargar.'; } });
async function guardar() {
  error.value = ''; guardando.value = true;
  try { await acc.guardarPromptIa(texto.value); emit('cerrar'); }
  catch (e) { error.value = e.message || 'No se pudo guardar.'; }
  finally { guardando.value = false; }
}
</script>
<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-2xl flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Prompt de la IA (rol para los borradores)</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>
      <div class="p-4 space-y-2">
        <textarea v-model="texto" rows="10" class="w-full border rounded px-2 py-1.5 text-[13px]"></textarea>
        <p v-if="error" class="text-[12px] text-red-600">{{ error }}</p>
      </div>
      <div class="border-t px-4 py-3 flex justify-end gap-2">
        <button class="px-3 py-1.5 text-[13px] text-gray-500" @click="emit('cerrar')">Cancelar</button>
        <button :disabled="guardando || !texto.trim()" class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px] disabled:opacity-60" @click="guardar">
          {{ guardando ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
    </div>
  </div>
</template>
