<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAcciones } from '../stores/acciones';
import { useChat } from '../stores/chat';

const router = useRouter();
const acc = useAcciones();
const chat = useChat();

const filtros = ref({ compro: '', origenId: '', interesId: '', estado: '', desde: '', hasta: '', pagina: 0, tam: 25 });
const datos = ref({ total: 0, pagina: 0, tam: 25, contactos: [] });
const catalogo = ref({ origen: [], interes: [] });
const cargando = ref(false);
const error = ref('');

async function cargar(pagina = 0) {
  filtros.value.pagina = pagina;
  cargando.value = true; error.value = '';
  try { datos.value = await acc.cargarInforme(filtros.value); }
  catch (e) { error.value = e.message || 'No se pudo cargar el informe.'; }
  finally { cargando.value = false; }
}

onMounted(async () => {
  try { catalogo.value = await acc.cargarEtiquetas(); } catch { /* selects quedan vacíos */ }
  await cargar(0);
});

const desde = computed(() => datos.value.total === 0 ? 0 : datos.value.pagina * datos.value.tam + 1);
const hasta = computed(() => Math.min((datos.value.pagina + 1) * datos.value.tam, datos.value.total));
const hayPrev = computed(() => datos.value.pagina > 0);
const hayNext = computed(() => (datos.value.pagina + 1) * datos.value.tam < datos.value.total);

const colorCompro = (v) => v === 'si' ? 'text-green-700' : v === 'no' ? 'text-red-700' : v === 'pendiente' ? 'text-amber-700' : 'text-gray-400';
const textoCompro = (v) => v === 'si' ? 'Sí' : v === 'no' ? 'No' : v === 'pendiente' ? 'Pendiente' : '—';
function fecha(v) { return v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—'; }

async function abrir(row) {
  try { const conv = await acc.abrirContacto(row.contactoId, false); chat.abrir(conv); router.push('/'); }
  catch { error.value = 'No se pudo abrir el chat.'; }
}
</script>

<template>
  <div class="h-full flex flex-col bg-gray-50">
    <header class="bg-marca-oscuro text-white flex items-center gap-3 px-4 py-2.5">
      <button class="text-white/80 hover:text-white text-sm" @click="router.push('/')">‹ Volver</button>
      <div class="font-bold">Informe de contactos</div>
    </header>

    <div class="bg-white border-b px-4 py-2 flex flex-wrap items-end gap-2 text-[12px]">
      <label class="flex flex-col">¿Compró?
        <select v-model="filtros.compro" class="border rounded px-2 py-1">
          <option value="">Todos</option><option value="si">Sí</option><option value="no">No</option>
          <option value="pendiente">Pendiente</option><option value="sin">Sin marcar</option>
        </select>
      </label>
      <label class="flex flex-col">Origen
        <select v-model="filtros.origenId" class="border rounded px-2 py-1">
          <option value="">Todos</option>
          <option v-for="e in catalogo.origen" :key="e.id" :value="e.id">{{ e.nombre }}</option>
        </select>
      </label>
      <label class="flex flex-col">Interés
        <select v-model="filtros.interesId" class="border rounded px-2 py-1">
          <option value="">Todos</option>
          <option v-for="e in catalogo.interes" :key="e.id" :value="e.id">{{ e.nombre }}</option>
        </select>
      </label>
      <label class="flex flex-col">Estado
        <select v-model="filtros.estado" class="border rounded px-2 py-1">
          <option value="">Todos</option><option value="nueva">Nueva</option><option value="abierta">Abierta</option>
          <option value="pendiente">Pendiente</option><option value="cerrada">Cerrada</option><option value="sin">Sin chat</option>
        </select>
      </label>
      <label class="flex flex-col">Desde<input type="date" v-model="filtros.desde" class="border rounded px-2 py-1" /></label>
      <label class="flex flex-col">Hasta<input type="date" v-model="filtros.hasta" class="border rounded px-2 py-1" /></label>
      <button class="bg-marca text-white rounded-lg px-3 py-1.5 font-semibold" @click="cargar(0)">Aplicar</button>
    </div>

    <div class="flex-1 overflow-auto p-3">
      <div v-if="cargando" class="text-center text-gray-400 text-sm py-6">Cargando…</div>
      <div v-else-if="error" class="text-center text-red-500 text-sm py-6">{{ error }}</div>
      <template v-else>
        <div class="text-[12px] text-gray-500 mb-2">{{ desde }}–{{ hasta }} de {{ datos.total }}</div>
        <table class="w-full bg-white rounded shadow text-[13px]">
          <thead class="text-gray-500 text-[11px] uppercase bg-gray-50">
            <tr>
              <th class="text-left px-3 py-2">Contacto</th><th class="text-left px-3 py-2">Dueño</th>
              <th class="text-left px-3 py-2">¿Compró?</th><th class="text-left px-3 py-2">Origen</th>
              <th class="text-left px-3 py-2">Interés</th><th class="text-left px-3 py-2">Estado</th>
              <th class="text-left px-3 py-2">Última actividad</th><th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in datos.contactos" :key="r.contactoId" class="border-t hover:bg-gray-50">
              <td class="px-3 py-2"><div class="text-gray-800">{{ r.nombre }}</div><div class="text-[11px] text-gray-400">{{ r.telefono }}</div></td>
              <td class="px-3 py-2 text-gray-600">{{ r.agenteDueno || '—' }}</td>
              <td class="px-3 py-2 font-semibold" :class="colorCompro(r.compro)">{{ textoCompro(r.compro) }}</td>
              <td class="px-3 py-2">
                <span v-if="r.origen" class="px-2 py-0.5 rounded-full text-[11px]" :style="{ color: r.origen.color, border: `1px solid ${r.origen.color}` }">{{ r.origen.nombre }}</span>
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="px-3 py-2">
                <span v-for="i in r.intereses" :key="i.nombre" class="px-2 py-0.5 rounded-full text-[11px] mr-1" :style="{ color: i.color, border: `1px solid ${i.color}` }">{{ i.nombre }}</span>
                <span v-if="!r.intereses.length" class="text-gray-300">—</span>
              </td>
              <td class="px-3 py-2 capitalize text-gray-600">{{ r.estado || 'sin chat' }}</td>
              <td class="px-3 py-2 text-gray-500 whitespace-nowrap">{{ fecha(r.ultimaActividad) }}</td>
              <td class="px-3 py-2 text-right"><button class="text-marca-oscuro font-semibold" @click="abrir(r)">Abrir ›</button></td>
            </tr>
            <tr v-if="!datos.contactos.length"><td colspan="8" class="text-center text-gray-400 py-6">Sin resultados.</td></tr>
          </tbody>
        </table>
        <div class="flex items-center justify-center gap-3 mt-3 text-[13px]">
          <button :disabled="!hayPrev" class="px-3 py-1 rounded border disabled:opacity-40" @click="cargar(datos.pagina - 1)">‹ Anterior</button>
          <span class="text-gray-500">Página {{ datos.pagina + 1 }}</span>
          <button :disabled="!hayNext" class="px-3 py-1 rounded border disabled:opacity-40" @click="cargar(datos.pagina + 1)">Siguiente ›</button>
        </div>
      </template>
    </div>
  </div>
</template>
