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
              <th class="px-3 py-2 text-right font-medium">Recibidos</th>
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
              <td class="px-3 py-1.5 text-right">{{ a.recibidos }}</td>
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
              <td class="px-3 py-2 text-right">{{ dia.totales.recibidos || 0 }}</td>
              <td class="px-3 py-2 text-right">{{ dia.totales.cerrados || 0 }}</td>
              <td class="px-3 py-2 text-right" colspan="2">{{ dia.totales.turnos || 0 }} turnos</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    <!-- Definiciones de los indicadores -->
    <section class="px-4 pb-8">
      <details class="bg-white border rounded-lg text-[12px] text-gray-600">
        <summary class="cursor-pointer select-none px-4 py-2.5 font-semibold text-gray-700">
          ¿Qué significa cada indicador?
        </summary>
        <div class="px-4 pb-3 space-y-3 border-t">
          <div class="pt-3">
            <div class="font-semibold text-gray-700 mb-1">En vivo (foto de ahora mismo, se refresca cada 45 s)</div>
            <ul class="space-y-1">
              <li><b>Sin responder:</b> chats abiertos del agente (o de la General, sin dueño) donde el último mensaje es del cliente — está esperando respuesta.</li>
              <li><b>Espera más vieja:</b> de esos chats, cuánto lleva esperando el más antiguo. <span class="text-amber-600">&gt;30 min ámbar</span>, <span class="text-red-600">&gt;60 min rojo</span>.</li>
            </ul>
          </div>
          <div>
            <div class="font-semibold text-gray-700 mb-1">Del día (según la fecha elegida)</div>
            <ul class="space-y-1">
              <li><b>Mensajes:</b> mensajes que el agente envió ese día (volumen bruto; no cuenta el historial traído por backfill).</li>
              <li><b>Chats:</b> conversaciones distintas en las que el agente escribió al menos un mensaje ese día.</li>
              <li><b>Recibidos:</b> chats nuevos que el agente empezó a atender ese día — ya sea que él los tomó de la general o que un admin se los asignó.</li>
              <li><b>Cerrados:</b> chats del agente que se cerraron ese día (atribuido al dueño al momento del cierre).</li>
              <li><b>TPR prom:</b> tiempo promedio de respuesta a un cliente que esperaba, contando <b>solo horario laboral</b> (Lun–Vie 8:00–18:00, Sáb 8:00–11:00); noches, domingos y fuera de horario no cuentan. <span class="text-amber-600">&gt;10 min ámbar</span>, <span class="text-red-600">&gt;30 min rojo</span>.</li>
              <li><b>TPR P90:</b> el 90 % de las respuestas fue igual o más rápido que este valor. Muestra los casos lentos que el promedio esconde.</li>
              <li><b>… turnos</b> (en Total): cuántas respuestas se usaron para el TPR ese día; si son pocas, el TPR es menos representativo.</li>
            </ul>
          </div>
          <p class="text-gray-400">El día va de 00:00 a 24:00 en hora de Colombia. El TPR mide cada respuesta a un cliente que esperaba (no solo la primera del chat) e incluye turnos que cruzan de un día a otro.</p>
        </div>
      </details>
    </section>
  </div>
</template>
