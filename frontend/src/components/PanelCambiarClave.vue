<script setup>
import { ref, computed } from 'vue';
import { useAuth } from '../stores/auth';

const emit = defineEmits(['cerrar']);
const auth = useAuth();

const actual = ref('');
const nueva = ref('');
const confirmar = ref('');
const error = ref('');
const okMsg = ref('');
const guardando = ref(false);

const valido = computed(() =>
  actual.value.length > 0 && nueva.value.length >= 8 && nueva.value === confirmar.value);

async function guardar() {
  if (!valido.value || guardando.value) return;
  guardando.value = true; error.value = ''; okMsg.value = '';
  try {
    await auth.cambiarClave(actual.value, nueva.value);
    okMsg.value = 'Contraseña actualizada.';
    actual.value = ''; nueva.value = ''; confirmar.value = '';
    setTimeout(() => emit('cerrar'), 1200);
  } catch (e) {
    error.value = e.codigo === 'clave_actual_incorrecta'
      ? 'La contraseña actual no es correcta.'
      : (e.message || 'No se pudo cambiar la contraseña.');
  } finally {
    guardando.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-sm flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Cambiar contraseña</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>
      <div class="p-4 flex flex-col gap-2 text-[13px]">
        <label class="flex flex-col gap-1">Contraseña actual
          <input type="password" v-model="actual" autocomplete="current-password" class="border rounded px-2 py-1.5" />
        </label>
        <label class="flex flex-col gap-1">Nueva contraseña (mín. 8)
          <input type="password" v-model="nueva" autocomplete="new-password" class="border rounded px-2 py-1.5" />
        </label>
        <label class="flex flex-col gap-1">Confirmar nueva
          <input type="password" v-model="confirmar" autocomplete="new-password" class="border rounded px-2 py-1.5" />
        </label>
        <p v-if="nueva && nueva.length < 8" class="text-[12px] text-amber-600">La nueva debe tener al menos 8 caracteres.</p>
        <p v-else-if="confirmar && nueva !== confirmar" class="text-[12px] text-amber-600">Las contraseñas no coinciden.</p>
        <p v-if="error" class="text-[12px] text-red-600">{{ error }}</p>
        <p v-if="okMsg" class="text-[12px] text-green-600">{{ okMsg }}</p>
        <button :disabled="!valido || guardando"
          class="mt-2 bg-marca text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-60"
          @click="guardar">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
      </div>
    </div>
  </div>
</template>
