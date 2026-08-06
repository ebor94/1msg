<!-- frontend/src/components/DifusionWizard.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue';
import { useAcciones } from '../stores/acciones';
import { renderizarCuerpo, parsearCsvPreview, valorDeVariable } from '../utils/difusion';

const emit = defineEmits(['creada', 'cerrar']);
const acc = useAcciones();

const nombre = ref('');
const plantillaNombre = ref('');
const mapeo = ref({ telefono: 'CELULAR', agente: 'AGENTE_ID', variables: [] });
const csvTexto = ref('');
const imagenFile = ref(null);
const guardando = ref(false);
const error = ref('');
const resumen = ref(null); // { total, pendientes, omitidos } tras cargar
const difusionId = ref(null);

onMounted(() => { if (!acc.plantillas.length) acc.cargarPlantillas(); });

const plantilla = computed(() => acc.plantillas.find((p) => p.name === plantillaNombre.value) || null);

function elegirPlantilla() {
  const p = plantilla.value;
  mapeo.value.variables = p ? Array.from({ length: p.variables }, () => ({ tipo: 'columna', columna: '', valor: '' })) : [];
}

const preview = computed(() => {
  const p = plantilla.value;
  if (!p) return '';
  const { primera } = parsearCsvPreview(csvTexto.value);
  const valores = mapeo.value.variables.map((v) => valorDeVariable(v, primera || {}));
  return renderizarCuerpo(p.cuerpo, valores);
});

// Columnas que el CSV debe traer, según el mapeo.
const columnasReq = computed(() => {
  const cols = [mapeo.value.telefono, mapeo.value.agente];
  mapeo.value.variables.forEach((v) => { if (v.tipo === 'columna' && v.columna) cols.push(v.columna); });
  return [...new Set(cols)];
});

// mapeo listo para el backend (columna|fijo).
function mapeoBackend() {
  return {
    telefono: mapeo.value.telefono,
    agente: mapeo.value.agente,
    variables: mapeo.value.variables.map((v) => (v.tipo === 'fijo' ? { tipo: 'fijo', valor: v.valor } : { tipo: 'columna', columna: v.columna })),
  };
}

async function crearYCargar() {
  error.value = ''; guardando.value = true;
  try {
    const dif = await acc.crearDifusion({ nombre: nombre.value, plantilla: plantillaNombre.value });
    difusionId.value = dif.id;
    if (plantilla.value?.tieneImagen && imagenFile.value) {
      await acc.subirImagenDifusion(dif.id, imagenFile.value);
    }
    resumen.value = await acc.cargarDestinatariosDifusion(dif.id, { texto: csvTexto.value, mapeo: mapeoBackend() });
  } catch (e) {
    error.value = e.message || 'No se pudo crear la campaña.';
  } finally {
    guardando.value = false;
  }
}

async function iniciar() {
  error.value = ''; guardando.value = true;
  try {
    await acc.iniciarDifusion(difusionId.value);
    emit('creada');
    emit('cerrar');
  } catch (e) {
    error.value = e.message || 'No se pudo iniciar.';
  } finally {
    guardando.value = false;
  }
}

function onArchivo(ev) { imagenFile.value = ev.target.files?.[0] || null; }
const puedeCargar = computed(() => nombre.value.trim() && plantillaNombre.value && csvTexto.value.trim());
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Nueva difusión</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>

      <div class="overflow-auto p-4 space-y-4 text-[13px]">
        <!-- Paso 1: datos -->
        <div>
          <label class="block text-[11px] text-gray-400 uppercase mb-1">Nombre de la campaña</label>
          <input v-model="nombre" class="w-full border rounded px-2 py-1.5" placeholder="Ej. Mora agosto" />
        </div>
        <div>
          <label class="block text-[11px] text-gray-400 uppercase mb-1">Plantilla</label>
          <select v-model="plantillaNombre" @change="elegirPlantilla" class="w-full border rounded px-2 py-1.5">
            <option value="">Seleccione…</option>
            <option v-for="p in acc.plantillas" :key="p.name" :value="p.name">{{ p.name }}</option>
          </select>
        </div>

        <template v-if="plantilla">
          <div class="bg-gray-50 border rounded p-2 text-[12px] text-gray-600 whitespace-pre-wrap">{{ plantilla.cuerpo }}</div>

          <!-- Paso 2: mapeo de variables -->
          <div v-if="plantilla.variables" class="space-y-2">
            <div class="text-[11px] text-gray-400 uppercase">Variables</div>
            <div v-for="(v, i) in mapeo.variables" :key="i" class="flex items-center gap-2">
              <span class="text-gray-500 w-10">{{ '{{' }}{{ i + 1 }}{{ '}}' }}</span>
              <select v-model="v.tipo" class="border rounded px-2 py-1">
                <option value="columna">Columna CSV</option>
                <option value="fijo">Valor fijo</option>
              </select>
              <input v-if="v.tipo === 'columna'" v-model="v.columna" placeholder="Nombre de columna (ej. NOMBRE)" class="flex-1 border rounded px-2 py-1" />
              <input v-else v-model="v.valor" placeholder="Valor para todos" class="flex-1 border rounded px-2 py-1" />
            </div>
          </div>

          <!-- Imagen si la plantilla la lleva -->
          <div v-if="plantilla.tieneImagen">
            <label class="block text-[11px] text-gray-400 uppercase mb-1">Imagen del encabezado (opcional; si no, usa la de la plantilla)</label>
            <input type="file" accept="image/png,image/jpeg,image/webp" @change="onArchivo" class="text-[12px]" />
          </div>

          <!-- Paso 3: CSV -->
          <div>
            <label class="block text-[11px] text-gray-400 uppercase mb-1">Destinatarios (CSV)</label>
            <div class="text-[11px] text-gray-400 mb-1">Columnas requeridas: <b>{{ columnasReq.join(', ') }}</b></div>
            <textarea v-model="csvTexto" rows="5" class="w-full border rounded px-2 py-1.5 font-mono text-[12px]"
              placeholder="CELULAR,NOMBRE,AGENTE_ID&#10;573001234567,Ana,5"></textarea>
          </div>

          <!-- Vista previa -->
          <div v-if="preview" class="bg-green-50 border border-green-100 rounded p-2">
            <div class="text-[11px] text-gray-400 uppercase mb-1">Vista previa (primera fila)</div>
            <div class="text-[12.5px] text-gray-800 whitespace-pre-wrap">{{ preview }}</div>
          </div>
        </template>

        <!-- Resumen tras cargar -->
        <div v-if="resumen" class="border rounded p-3 bg-gray-50">
          <div class="text-[12px]"><b>{{ resumen.pendientes }}</b> destinatarios listos de {{ resumen.total }}.
            <span v-if="resumen.omitidos.length" class="text-amber-600">{{ resumen.omitidos.length }} omitidos.</span>
          </div>
          <ul v-if="resumen.omitidos.length" class="text-[11px] text-amber-700 mt-1 max-h-24 overflow-auto">
            <li v-for="(o, i) in resumen.omitidos" :key="i">{{ o.telefono }} — {{ o.motivo }}</li>
          </ul>
        </div>

        <p v-if="error" class="text-[12px] text-red-600">{{ error }}</p>
      </div>

      <div class="border-t px-4 py-3 flex justify-end gap-2">
        <button class="px-3 py-1.5 text-[13px] text-gray-500" @click="emit('cerrar')">Cancelar</button>
        <button v-if="!resumen" :disabled="!puedeCargar || guardando"
          class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px] disabled:opacity-60" @click="crearYCargar">
          {{ guardando ? 'Cargando…' : 'Cargar destinatarios' }}
        </button>
        <button v-else :disabled="guardando || resumen.pendientes === 0"
          class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px] disabled:opacity-60" @click="iniciar">
          {{ guardando ? 'Iniciando…' : `Iniciar envío (${resumen.pendientes})` }}
        </button>
      </div>
    </div>
  </div>
</template>
