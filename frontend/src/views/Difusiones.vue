<!-- frontend/src/views/Difusiones.vue -->
<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAcciones } from '../stores/acciones';
import DifusionWizard from '../components/DifusionWizard.vue';

const router = useRouter();
const acc = useAcciones();

const campanas = ref([]);
const sel = ref(null);          // detalle { difusion, embudo }
const destinatarios = ref({ total: 0, filas: [] });
const cargando = ref(false);
const error = ref('');
const mostrarWizard = ref(false);
let timer = null;

async function cargarLista() {
  cargando.value = true; error.value = '';
  try { campanas.value = await acc.listarDifusiones(); }
  catch (e) { error.value = e.message || 'No se pudieron cargar las campañas.'; }
  finally { cargando.value = false; }
}
async function abrir(id) {
  try {
    sel.value = await acc.detalleDifusion(id);
    destinatarios.value = await acc.destinatariosDifusion(id, {});
  } catch (e) { error.value = e.message || 'No se pudo abrir la campaña.'; }
}
async function refrescarSel() {
  if (sel.value?.difusion?.estado === 'enviando') {
    try { sel.value = await acc.detalleDifusion(sel.value.difusion.id); await cargarLista(); } catch { /* silencioso */ }
  }
}
async function cancelar(id) {
  try { await acc.cancelarDifusion(id); await cargarLista(); if (sel.value?.difusion?.id === id) await abrir(id); }
  catch (e) { error.value = e.message || 'No se pudo cancelar.'; }
}

onMounted(() => { cargarLista(); timer = setInterval(refrescarSel, 8000); });
onUnmounted(() => { if (timer) clearInterval(timer); });

function tras() { mostrarWizard.value = false; cargarLista(); }
const pct = (n, total) => (total ? Math.round((Number(n) || 0) * 100 / total) : 0);
const COLOR_ESTADO = { borrador: 'text-gray-500', enviando: 'text-blue-600', finalizada: 'text-green-600', cancelada: 'text-red-500' };
</script>

<template>
  <div class="h-full flex flex-col bg-gray-50 overflow-auto">
    <header class="bg-marca-oscuro text-white flex items-center gap-3 px-4 py-2.5 sticky top-0 z-10">
      <button class="text-white/80 hover:text-white text-sm" @click="router.push('/')">‹ Volver</button>
      <div class="font-bold">Difusiones</div>
      <button class="ml-auto bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1 text-[13px]" @click="mostrarWizard = true">＋ Nueva difusión</button>
    </header>

    <div class="p-4 grid md:grid-cols-2 gap-4">
      <!-- Lista -->
      <section>
        <div class="text-[13px] font-semibold text-gray-600 mb-2">Campañas</div>
        <p v-if="error" class="text-[12px] text-red-600 mb-2">{{ error }}</p>
        <div v-if="cargando" class="text-[12px] text-gray-400">Cargando…</div>
        <div v-for="c in campanas" :key="c.id" @click="abrir(c.id)"
          class="bg-white border rounded-lg p-3 mb-2 cursor-pointer hover:bg-gray-50"
          :class="sel && sel.difusion.id === c.id ? 'ring-2 ring-marca' : ''">
          <div class="flex justify-between items-center">
            <b class="text-gray-800 text-[13px]">{{ c.nombre }}</b>
            <span class="text-[11px] font-semibold capitalize" :class="COLOR_ESTADO[c.estado]">{{ c.estado }}</span>
          </div>
          <div class="text-[11px] text-gray-400">{{ c.plantilla }} · {{ c.enviados || 0 }}/{{ c.total || 0 }} enviados</div>
        </div>
        <div v-if="!cargando && !campanas.length" class="text-[12px] text-gray-400">Aún no hay campañas.</div>
      </section>

      <!-- Detalle -->
      <section v-if="sel" class="bg-white border rounded-lg p-4">
        <div class="flex justify-between items-start mb-3">
          <div>
            <b class="text-gray-800">{{ sel.difusion.nombre }}</b>
            <div class="text-[11px] text-gray-400">{{ sel.difusion.plantillaNombre }}</div>
          </div>
          <button v-if="sel.difusion.estado === 'enviando'" @click="cancelar(sel.difusion.id)"
            class="text-[12px] text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50">Cancelar</button>
        </div>

        <!-- Embudo -->
        <div class="grid grid-cols-3 gap-2 text-center mb-3">
          <div class="bg-gray-50 rounded p-2"><div class="text-lg font-bold text-gray-800">{{ sel.embudo.total }}</div><div class="text-[10px] text-gray-400 uppercase">Total</div></div>
          <div class="bg-gray-50 rounded p-2"><div class="text-lg font-bold text-gray-800">{{ sel.embudo.enviados }}</div><div class="text-[10px] text-gray-400 uppercase">Enviados</div></div>
          <div class="bg-gray-50 rounded p-2"><div class="text-lg font-bold text-green-600">{{ sel.embudo.leidos }}</div><div class="text-[10px] text-gray-400 uppercase">Leídos</div></div>
          <div class="bg-gray-50 rounded p-2"><div class="text-sm font-bold text-gray-700">{{ sel.embudo.entregados }}</div><div class="text-[10px] text-gray-400 uppercase">Entregados</div></div>
          <div class="bg-gray-50 rounded p-2"><div class="text-sm font-bold text-amber-600">{{ sel.embudo.omitidos }}</div><div class="text-[10px] text-gray-400 uppercase">Omitidos</div></div>
          <div class="bg-gray-50 rounded p-2"><div class="text-sm font-bold text-red-600">{{ sel.embudo.fallidos }}</div><div class="text-[10px] text-gray-400 uppercase">Fallidos</div></div>
        </div>
        <div class="text-[12px] text-gray-600 mb-2">Respondidos: <b>{{ sel.embudo.respondidos }}</b>
          <span v-if="sel.embudo.total"> · lectura {{ pct(sel.embudo.leidos, sel.embudo.total) }}%</span>
        </div>
        <div v-if="sel.embudo.fallidosPorCodigo && sel.embudo.fallidosPorCodigo.length" class="text-[11px] text-gray-500 mb-3">
          Fallidos por código: <span v-for="f in sel.embudo.fallidosPorCodigo" :key="f.codigo">{{ f.codigo }} ({{ f.n }}) </span>
        </div>

        <!-- Detalle por destinatario -->
        <div class="text-[11px] text-gray-400 uppercase mb-1">Destinatarios ({{ destinatarios.total }})</div>
        <div class="max-h-64 overflow-auto border rounded">
          <table class="w-full text-[12px]">
            <tbody>
              <tr v-for="d in destinatarios.filas" :key="d.id" class="border-b border-gray-100">
                <td class="px-2 py-1 text-gray-700">{{ (d.parametros && d.parametros[0]) || '—' }}</td>
                <td class="px-2 py-1 capitalize" :class="d.estado === 'fallido' ? 'text-red-600' : d.estado === 'omitido' ? 'text-amber-600' : 'text-gray-600'">{{ d.estado }}</td>
                <td class="px-2 py-1 text-gray-400 text-right">{{ d.errorCodigo || '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section v-else class="text-[12px] text-gray-400 grid place-items-center">Selecciona una campaña para ver su resultado.</section>
    </div>

    <DifusionWizard v-if="mostrarWizard" @creada="tras" @cerrar="mostrarWizard = false" />
  </div>
</template>
