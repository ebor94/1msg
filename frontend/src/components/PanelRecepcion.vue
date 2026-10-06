<script setup>
import { ref, onMounted } from 'vue';
import { useAcciones } from '../stores/acciones';
const emit = defineEmits(['cerrar']);
const acc = useAcciones();
const seleccion = ref(new Set());
const guardando = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    if (!acc.agentes.length) await acc.cargarAgentes();
    const ids = await acc.obtenerRecepcion();
    seleccion.value = new Set(ids);
  } catch { error.value = 'No se pudo cargar.'; }
});

function toggle(id) {
  const s = new Set(seleccion.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  seleccion.value = s;
}

async function guardar() {
  error.value = ''; guardando.value = true;
  try { await acc.guardarRecepcion([...seleccion.value]); emit('cerrar'); }
  catch (e) { error.value = e.message || 'No se pudo guardar.'; }
  finally { guardando.value = false; }
}
</script>
<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-md flex flex-col max-h-[85vh]">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Agentes de recepción (chats nuevos)</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>
      <div class="p-4 space-y-2 overflow-auto">
        <p class="text-[12px] text-gray-500">Los chats nuevos sin dueño se reparten entre los seleccionados (al de menos chats abiertos). Si no marcas ninguno, van a la bandeja general.</p>
        <label v-for="a in acc.agentes" :key="a.id" class="flex items-center gap-2 py-1 text-[13px] text-gray-800">
          <input type="checkbox" :checked="seleccion.has(a.id)" @change="toggle(a.id)" />
          {{ a.nombre }} <span class="text-gray-400">({{ a.usuario }})</span>
        </label>
        <p v-if="error" class="text-[12px] text-red-600">{{ error }}</p>
      </div>
      <div class="border-t px-4 py-3 flex justify-end gap-2">
        <button class="px-3 py-1.5 text-[13px] text-gray-500" @click="emit('cerrar')">Cancelar</button>
        <button :disabled="guardando" class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px] disabled:opacity-60" @click="guardar">
          {{ guardando ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
    </div>
  </div>
</template>
