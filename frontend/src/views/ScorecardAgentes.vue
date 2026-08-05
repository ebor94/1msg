<!-- frontend/src/views/ScorecardAgentes.vue -->
<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAcciones } from '../stores/acciones';
import { colorEspera, colorTpr, minAHhMm } from '../utils/scorecard';

const router = useRouter();
const acc = useAcciones();

const fecha = ref(new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10));
const dia = ref({ fecha: '', agentes: [], totales: {} });
const vivo = ref({ agentes: [], general: { sinResponder: 0, esperaMasViejaMin: null } });
const cargando = ref(false);
const error = ref('');
let timer = null;

const CLASE = { ok: 'text-gray-700', warn: 'text-amber-600 font-semibold', bad: 'text-red-600 font-bold', none: 'text-gray-300' };

async function cargarDia() {
  cargando.value = true; error.value = '';
  try { dia.value = await acc.cargarScorecard(fecha.value); }
  catch (e) { error.value = e.message || 'No se pudo cargar el reporte.'; }
  finally { cargando.value = false; }
}
async function cargarVivo() {
  try { vivo.value = await acc.cargarBacklogVivo(); } catch { /* silencioso: es un panel secundario */ }
}

onMounted(() => {
  cargarDia();
  cargarVivo();
  timer = setInterval(cargarVivo, 45000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="h-full flex flex-col bg-gray-50 overflow-auto">
    <header class="bg-marca-oscuro text-white flex items-center gap-3 px-4 py-2.5 sticky top-0 z-10">
      <button class="text-white/80 hover:text-white text-sm" @click="router.push('/')">‹ Volver</button>
      <div class="font-bold">Seguimiento de agentes</div>
    </header>

    <!-- En vivo -->
    <section class="p-4">
      <div class="text-[13px] font-semibold text-gray-600 mb-2">En vivo · sin responder ahora</div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div class="bg-white border rounded-lg p-3">
          <div class="text-[11px] text-gray-400 uppercase">General</div>
          <div class="text-2xl font-bold text-gray-800">{{ vivo.general.sinResponder }}</div>
          <div class="text-[11px]" :class="CLASE[colorEspera(vivo.general.esperaMasViejaMin)]">
            espera {{ minAHhMm(vivo.general.esperaMasViejaMin) }}
          </div>
        </div>
        <div v-for="a in vivo.agentes" :key="a.agenteId" class="bg-white border rounded-lg p-3">
          <div class="text-[11px] text-gray-400 uppercase truncate">{{ a.nombre }}</div>
          <div class="text-2xl font-bold text-gray-800">{{ a.sinResponder }}</div>
          <div class="text-[11px]" :class="CLASE[colorEspera(a.esperaMasViejaMin)]">
            espera {{ minAHhMm(a.esperaMasViejaMin) }}
          </div>
        </div>
      </div>
    </section>

    <!-- Tabla del día -->
    <section class="px-4 pb-6">
      <div class="flex items-center gap-2 mb-2">
        <div class="text-[13px] font-semibold text-gray-600">Del día</div>
        <input type="date" v-model="fecha" @change="cargarDia" class="border rounded px-2 py-1 text-[12px]" />
        <span v-if="cargando" class="text-[12px] text-gray-400">cargando…</span>
      </div>
      <p v-if="error" class="text-[12px] text-red-600 mb-2">{{ error }}</p>
      <div class="overflow-x-auto border rounded bg-white">
        <table class="w-full text-[12px]">
          <thead class="bg-gray-50 text-gray-500">
            <tr>
              <th class="px-3 py-2 text-left font-medium">Agente</th>
              <th class="px-3 py-2 text-right font-medium">Mensajes</th>
              <th class="px-3 py-2 text-right font-medium">Chats</th>
              <th class="px-3 py-2 text-right font-medium">Tomados</th>
              <th class="px-3 py-2 text-right font-medium">Cerrados</th>
              <th class="px-3 py-2 text-right font-medium">TPR prom</th>
              <th class="px-3 py-2 text-right font-medium">TPR P90</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in dia.agentes" :key="a.agenteId" class="border-t border-gray-100">
              <td class="px-3 py-1.5 text-gray-800">{{ a.nombre }}</td>
              <td class="px-3 py-1.5 text-right">{{ a.mensajes }}</td>
              <td class="px-3 py-1.5 text-right">{{ a.chatsAtendidos }}</td>
              <td class="px-3 py-1.5 text-right">{{ a.tomados }}</td>
              <td class="px-3 py-1.5 text-right">{{ a.cerrados }}</td>
              <td class="px-3 py-1.5 text-right" :class="CLASE[colorTpr(a.tprPromMin)]">{{ minAHhMm(a.tprPromMin) }}</td>
              <td class="px-3 py-1.5 text-right" :class="CLASE[colorTpr(a.tprP90Min)]">{{ minAHhMm(a.tprP90Min) }}</td>
            </tr>
          </tbody>
          <tfoot class="bg-gray-50 text-gray-700 font-semibold">
            <tr class="border-t">
              <td class="px-3 py-2">Total</td>
              <td class="px-3 py-2 text-right">{{ dia.totales.mensajes || 0 }}</td>
              <td class="px-3 py-2 text-right">{{ dia.totales.chatsAtendidos || 0 }}</td>
              <td class="px-3 py-2 text-right">{{ dia.totales.tomados || 0 }}</td>
              <td class="px-3 py-2 text-right">{{ dia.totales.cerrados || 0 }}</td>
              <td class="px-3 py-2 text-right" colspan="2">{{ dia.totales.turnos || 0 }} turnos</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  </div>
</template>
