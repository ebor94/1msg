<script setup>
import { ref, onMounted } from 'vue';
import { useAcciones } from '../stores/acciones';
import { useMantenimiento } from '../stores/mantenimiento';
const emit = defineEmits(['cerrar']);
const acc = useAcciones();
const mant = useMantenimiento();

const activo = ref(false);
const mensaje = ref('');
const proveedor = ref('up');
const revisadoEn = ref(null);
const cargando = ref(true);
const guardando = ref(false);
const error = ref('');

function fecha(v) { return v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—'; }

onMounted(async () => {
  try {
    const r = await acc.obtenerMantenimiento();
    activo.value = !!r.manual;        // el switch refleja solo el estado MANUAL
    mensaje.value = r.mensaje || '';
    proveedor.value = r.proveedor || 'up';
    revisadoEn.value = r.revisadoEn || null;
  } catch { error.value = 'No se pudo cargar el estado.'; }
  finally { cargando.value = false; }
});

async function guardar() {
  error.value = ''; guardando.value = true;
  try {
    await acc.guardarMantenimiento({ activo: activo.value, mensaje: mensaje.value });
    await mant.cargar(); // refresca el banner al instante
    emit('cerrar');
  } catch (e) { error.value = e.message || 'No se pudo guardar.'; }
  finally { guardando.value = false; }
}
</script>
<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-lg flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Modo mantenimiento / aviso</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>
      <div class="p-4 space-y-3">
        <div v-if="cargando" class="text-gray-400 text-sm">Cargando…</div>
        <template v-else>
          <!-- Estado automático del proveedor (lo gestiona el chequeo cada 2 min) -->
          <div class="flex items-center justify-between rounded-lg border px-3 py-2 text-[13px]"
            :class="proveedor === 'down' ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'">
            <span class="text-gray-700">Proveedor 1msg (automático)</span>
            <span :class="proveedor === 'down' ? 'text-red-700 font-semibold' : 'text-green-700 font-semibold'">
              {{ proveedor === 'down' ? '● Caído' : '● Operando' }}
            </span>
          </div>
          <p class="text-[11px] text-gray-400 -mt-1">Último chequeo: {{ fecha(revisadoEn) }}. Si 1msg está caído, el aviso se muestra solo aunque el switch manual esté apagado.</p>

          <!-- Switch manual -->
          <label class="flex items-center gap-2 text-[13px] text-gray-800 pt-1">
            <input type="checkbox" v-model="activo" />
            Mostrar aviso manualmente (mantenimiento programado)
          </label>

          <div>
            <div class="text-[11px] text-gray-400 uppercase mb-1">Mensaje del aviso</div>
            <textarea v-model="mensaje" rows="3" maxlength="500" placeholder="Deja vacío para usar el mensaje por defecto."
              class="w-full border rounded px-2 py-1.5 text-[13px]"></textarea>
            <p class="text-[11px] text-gray-400">Máx 500 caracteres. Se muestra tanto en el aviso manual como en el automático.</p>
          </div>

          <p v-if="error" class="text-[12px] text-red-600">{{ error }}</p>
        </template>
      </div>
      <div class="border-t px-4 py-3 flex justify-end gap-2">
        <button class="px-3 py-1.5 text-[13px] text-gray-500" @click="emit('cerrar')">Cancelar</button>
        <button :disabled="guardando || cargando" class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px] disabled:opacity-60" @click="guardar">
          {{ guardando ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
    </div>
  </div>
</template>
