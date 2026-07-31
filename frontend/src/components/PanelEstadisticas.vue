<script setup>
import { ref, onMounted, computed } from 'vue';
import { useAcciones } from '../stores/acciones';

const emit = defineEmits(['cerrar']);
const acc = useAcciones();

const hoy = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const desde = ref(iso(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1))));
const hasta = ref(iso(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0))));
const filas = ref([]);
const cargando = ref(true);
const error = ref('');

async function cargar() {
  cargando.value = true; error.value = '';
  try { filas.value = await acc.cargarEstadisticas(desde.value, hasta.value); }
  catch { error.value = 'No se pudieron cargar las estadísticas.'; }
  finally { cargando.value = false; }
}
onMounted(cargar);

const origen = computed(() => filas.value.filter((f) => f.categoria === 'origen'));
const interes = computed(() => filas.value.filter((f) => f.categoria === 'interes'));
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[85vh] flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Estadísticas de etiquetas</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>
      <div class="flex items-end gap-2 px-4 py-2 border-b text-[12px]">
        <label class="flex flex-col">Desde<input type="date" v-model="desde" class="border rounded px-2 py-1" /></label>
        <label class="flex flex-col">Hasta<input type="date" v-model="hasta" class="border rounded px-2 py-1" /></label>
        <button class="bg-marca text-white rounded-lg px-3 py-1.5 font-semibold" @click="cargar">Aplicar</button>
      </div>
      <div class="overflow-auto p-4">
        <div v-if="cargando" class="text-center text-gray-400 text-sm py-6">Cargando…</div>
        <div v-else-if="error" class="text-center text-red-500 text-sm py-6">{{ error }}</div>
        <template v-else>
          <div class="text-[11px] text-gray-400 uppercase mb-1">Origen</div>
          <div v-if="!origen.length" class="text-[12px] text-gray-400 mb-3">Sin datos.</div>
          <div v-for="f in origen" :key="f.id" class="flex items-center justify-between py-1 text-[13px]">
            <span class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full" :style="{ backgroundColor: f.color }"></span>{{ f.nombre }}</span>
            <b class="tabular-nums">{{ f.total }}</b>
          </div>
          <div class="text-[11px] text-gray-400 uppercase mt-4 mb-1">Interés</div>
          <div v-if="!interes.length" class="text-[12px] text-gray-400">Sin datos.</div>
          <div v-for="f in interes" :key="f.id" class="flex items-center justify-between py-1 text-[13px]">
            <span class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full" :style="{ backgroundColor: f.color }"></span>{{ f.nombre }}</span>
            <b class="tabular-nums">{{ f.total }}</b>
          </div>
        </template>
      </div>
      <div class="px-4 py-2 border-t text-[11px] text-gray-400">
        Cuenta de chats que ingresaron en el rango. El origen es único por chat; un chat puede tener varios intereses.
      </div>
    </div>
  </div>
</template>
