<script setup>
import { ref, computed, onMounted } from 'vue';
import { useAcciones } from '../stores/acciones';
import { etiquetaCampo, formatoCelda } from '../utils/tablas';

const emit = defineEmits(['cerrar']);
const acc = useAcciones();

const documento = ref('');
const datos = ref(null);
const cargando = ref(false);
const error = ref('');

let cerrarTimer = null; // auto-cierre del form de gestión tras registrar
function cancelarTimer() { if (cerrarTimer) { clearTimeout(cerrarTimer); cerrarTimer = null; } }

async function consultar() {
  const doc = documento.value.replace(/\D/g, '');
  if (!doc) { error.value = 'Ingresa una cédula.'; return; }
  cancelarTimer();
  cargando.value = true; error.value = ''; datos.value = null; planGest.value = null;
  try { datos.value = await acc.consultarProductos(doc); }
  catch (e) { error.value = e.message || 'No se pudo consultar.'; }
  finally { cargando.value = false; }
}

const SECCIONES = [
  { key: 'prevision', titulo: 'Previsión' },
  { key: 'mantenimientos', titulo: 'Mantenimientos' },
  { key: 'prenecesidad', titulo: 'Prenecesidad' },
];
const columnas = (datos) => (datos && datos.length ? Object.keys(datos[0]) : []);

// --- Registrar gestión (solo sección Previsión) ---
const conceptosPrev = ref([]);
const planGest = ref(null); // num_plan seleccionado para gestión
const gest = ref({ concepto: '', novedad: '', posfecha: '', guardando: false, ok: '', error: '' });
onMounted(async () => { try { conceptosPrev.value = await acc.cargarConceptosPrevision(); } catch { /* queda vacío */ } });

const numPlanesPrev = computed(() =>
  datos.value?.prevision?.estado === 'ok' ? (datos.value.prevision.datos?.length || 0) : 0);
// Todos los conceptos del desplegable son "permitidos", así que masivo = hay posfecha.
const gestMasivo = computed(() => !!gest.value.posfecha && numPlanesPrev.value > 1);

function abrirGestion(numPlan) {
  cancelarTimer();
  planGest.value = numPlan;
  gest.value = { concepto: '', novedad: '', posfecha: '', guardando: false, ok: '', error: '' };
}
async function registrarGestion() {
  if (!planGest.value || !gest.value.concepto || gest.value.guardando) return;
  gest.value.guardando = true; gest.value.ok = ''; gest.value.error = '';
  try {
    const r = await acc.registrarGestionPrevision({
      numPlan: planGest.value,
      concepto: gest.value.concepto,
      novedad: gest.value.novedad,
      posfecha: gest.value.posfecha || null,
    });
    gest.value.ok = r.masivo ? `Gestión registrada en ${r.afectados} planes.` : 'Gestión registrada.';
    cerrarTimer = setTimeout(() => { cerrarTimer = null; planGest.value = null; consultar(); }, 1200); // refresca la tabla
  } catch (e) {
    gest.value.error = e.message || 'No se pudo registrar la gestión.';
  } finally {
    gest.value.guardando = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-5xl max-h-[88vh] flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Consultar productos</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>

      <div class="flex items-center gap-2 px-4 py-3 border-b">
        <input v-model="documento" inputmode="numeric" placeholder="Cédula del cliente"
          class="flex-1 border rounded px-3 py-1.5 text-[13px]" @keyup.enter="consultar" />
        <button class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px]" @click="consultar">Consultar</button>
      </div>

      <div class="overflow-auto p-4">
        <div v-if="cargando" class="text-center text-gray-400 text-sm py-6">Consultando…</div>
        <div v-else-if="error" class="text-center text-red-500 text-sm py-6">{{ error }}</div>
        <div v-else-if="!datos" class="text-center text-gray-400 text-sm py-6">Ingresa una cédula y pulsa Consultar.</div>
        <template v-else>
          <div v-for="s in SECCIONES" :key="s.key" class="mb-5">
            <div class="text-[13px] font-semibold text-marca-oscuro mb-1">{{ s.titulo }}</div>
            <div v-if="datos[s.key].estado === 'no_configurado'" class="text-[12px] text-gray-400">No configurado.</div>
            <div v-else-if="datos[s.key].estado === 'error'" class="text-[12px] text-red-500">No se pudo consultar.</div>
            <div v-else-if="!datos[s.key].datos || !datos[s.key].datos.length" class="text-[12px] text-gray-400">Sin resultados.</div>
            <div v-else class="overflow-x-auto border rounded">
              <table class="w-full text-[12px]">
                <thead class="bg-gray-50 text-gray-500">
                  <tr>
                    <th v-for="k in columnas(datos[s.key].datos)" :key="k" class="px-2 py-1.5 border-b whitespace-nowrap font-medium text-left">{{ etiquetaCampo(k) }}</th>
                    <th v-if="s.key === 'prevision'" class="px-2 py-1.5 border-b font-medium text-left">Gestión</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, i) in datos[s.key].datos" :key="i" class="border-b border-gray-100 hover:bg-gray-50">
                    <td v-for="k in columnas(datos[s.key].datos)" :key="k" class="px-2 py-1 text-gray-800 align-top"
                      :class="/observ/i.test(k) ? 'whitespace-normal min-w-[220px] max-w-[360px]' : 'whitespace-nowrap'">{{ formatoCelda(k, row[k]) }}</td>
                    <td v-if="s.key === 'prevision'" class="px-2 py-1 whitespace-nowrap">
                      <button class="text-marca-oscuro font-semibold" @click="abrirGestion(row.num_plan)">✎ Registrar</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Formulario de gestión (solo Previsión, sobre el plan elegido) -->
            <div v-if="s.key === 'prevision' && planGest" class="mt-2 border rounded p-3 bg-gray-50">
              <div class="text-[12px] font-semibold text-marca-oscuro mb-1">
                Registrar gestión · plan {{ planGest }}
                <button class="ml-2 text-[11px] text-gray-400 hover:text-gray-600" @click="planGest = null">cancelar</button>
              </div>
              <div class="flex flex-wrap items-end gap-2 text-[12px]">
                <label class="flex flex-col">Concepto
                  <select v-model="gest.concepto" class="border rounded px-2 py-1 min-w-[160px]">
                    <option value="">Seleccione…</option>
                    <option v-for="k in conceptosPrev" :key="k.codigo" :value="k.codigo">{{ k.descripcion }}</option>
                  </select>
                </label>
                <label class="flex flex-col flex-1 min-w-[180px]">Novedad
                  <input v-model="gest.novedad" maxlength="255" class="border rounded px-2 py-1" />
                </label>
                <label class="flex flex-col">Posfecha
                  <input type="date" v-model="gest.posfecha" class="border rounded px-2 py-1" />
                </label>
                <button :disabled="!gest.concepto || gest.guardando"
                  class="bg-marca text-white rounded-lg px-3 py-1.5 font-semibold disabled:opacity-60"
                  @click="registrarGestion">{{ gest.guardando ? 'Guardando…' : 'Registrar' }}</button>
              </div>
              <p v-if="gestMasivo" class="text-[11px] text-amber-600 mt-1">⚠️ Con posfecha, esto actualizará los {{ numPlanesPrev }} planes de esta cédula.</p>
              <p v-if="gest.ok" class="text-[12px] text-green-600 mt-1">{{ gest.ok }}</p>
              <p v-if="gest.error" class="text-[12px] text-red-600 mt-1">{{ gest.error }}</p>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
