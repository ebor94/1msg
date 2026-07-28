<script setup>
import { ref, onMounted, computed } from 'vue';
import { useAcciones } from '../stores/acciones';
import { useConversaciones } from '../stores/conversaciones';
import { useChat } from '../stores/chat';

const emit = defineEmits(['cerrar']);
const acc = useAcciones();
const conv = useConversaciones();
const chat = useChat();

const filas = ref([]);
const cargando = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    filas.value = await acc.cargarTotalesAgentes();
  } catch {
    error.value = 'No se pudo cargar el resumen.';
  } finally {
    cargando.value = false;
  }
});

const ordenadas = computed(() => [...filas.value].sort((a, b) => b.activas - a.activas));
const totales = computed(() => filas.value.reduce((t, f) => ({
  contactos: t.contactos + f.contactos,
  activas: t.activas + f.activas,
  noLeidas: t.noLeidas + f.noLeidas,
  resueltas: t.resueltas + f.resueltas,
}), { contactos: 0, activas: 0, noLeidas: 0, resueltas: 0 }));

// Al tocar una fila: abrir "Todos" filtrado por ese agente.
function verAgente(f) {
  chat.cerrar();
  conv.agenteFiltro = f.id;
  conv.cargar('todos');
  emit('cerrar');
}
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[85vh] flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Resumen por agente</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>
      <div class="overflow-auto">
        <div v-if="cargando" class="p-6 text-center text-gray-400 text-sm">Cargando…</div>
        <div v-else-if="error" class="p-6 text-center text-red-500 text-sm">{{ error }}</div>
        <table v-else class="w-full text-[13px]">
          <thead class="text-gray-500 text-[11px] uppercase sticky top-0 bg-gray-50">
            <tr>
              <th class="text-left px-4 py-2 font-medium">Agente</th>
              <th class="text-right px-3 py-2 font-medium">Cartera</th>
              <th class="text-right px-3 py-2 font-medium">Activas</th>
              <th class="text-right px-3 py-2 font-medium">No leídas</th>
              <th class="text-right px-4 py-2 font-medium">Resueltas</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in ordenadas" :key="f.id" class="border-t hover:bg-gray-50 cursor-pointer" @click="verAgente(f)">
              <td class="px-4 py-2">
                <span :class="f.activo ? 'text-gray-800' : 'text-gray-400'">{{ f.nombre }}</span>
                <span v-if="f.rol === 'administrador'" class="ml-1 text-[10px] text-marca-oscuro">(admin)</span>
                <span v-if="!f.activo" class="ml-1 text-[10px] text-gray-400">(inactivo)</span>
              </td>
              <td class="px-3 py-2 text-right tabular-nums">{{ f.contactos }}</td>
              <td class="px-3 py-2 text-right tabular-nums font-semibold">{{ f.activas }}</td>
              <td class="px-3 py-2 text-right tabular-nums" :class="f.noLeidas ? 'text-marca-oscuro font-semibold' : 'text-gray-300'">{{ f.noLeidas }}</td>
              <td class="px-4 py-2 text-right tabular-nums text-gray-500">{{ f.resueltas }}</td>
            </tr>
          </tbody>
          <tfoot class="border-t-2 bg-gray-50 font-semibold text-gray-700">
            <tr>
              <td class="px-4 py-2">Total</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ totales.contactos }}</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ totales.activas }}</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ totales.noLeidas }}</td>
              <td class="px-4 py-2 text-right tabular-nums">{{ totales.resueltas }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="px-4 py-2 border-t text-[11px] text-gray-400">
        Cartera = contactos de los que es dueño · Activas = chats en curso · Toca una fila para ver sus chats
      </div>
    </div>
  </div>
</template>
