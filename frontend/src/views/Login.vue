<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';

const usuario = ref('');
const clave = ref('');
const error = ref('');
const cargando = ref(false);
const auth = useAuth();
const router = useRouter();

async function entrar() {
  error.value = '';
  cargando.value = true;
  try {
    await auth.login(usuario.value.trim(), clave.value);
    router.push('/');
  } catch (e) {
    error.value = e.status === 429 ? 'Demasiados intentos, espera unos minutos.' : 'Usuario o contraseña incorrectos.';
  } finally {
    cargando.value = false;
  }
}
</script>

<template>
  <div class="min-h-full grid place-items-center bg-gray-100 p-4">
    <form class="w-full max-w-sm bg-white rounded-xl shadow p-6 space-y-4" @submit.prevent="entrar">
      <div class="text-center">
        <div class="text-xl font-bold text-marca-oscuro">Serfunorte</div>
        <div class="text-sm text-gray-500">Bandeja de WhatsApp</div>
      </div>
      <input v-model="usuario" type="text" placeholder="Usuario" autocomplete="username"
        class="w-full border rounded-lg px-3 py-2" required />
      <input v-model="clave" type="password" placeholder="Contraseña" autocomplete="current-password"
        class="w-full border rounded-lg px-3 py-2" required />
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <button type="submit" :disabled="cargando"
        class="w-full bg-marca text-white rounded-lg py-2 font-semibold disabled:opacity-60">
        {{ cargando ? 'Entrando…' : 'Entrar' }}
      </button>
    </form>
  </div>
</template>
