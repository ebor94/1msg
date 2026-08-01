# Cambio de contraseña — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que cada agente cambie su propia contraseña desde la bandeja; el cambio se escribe en `serfuweb.usuarios.password` (identidad única) con un hash bcrypt compatible.

**Architecture:** Endpoint `POST /api/auth/cambiar-clave` (requireAuth + rate-limit) → servicio `cambiarClave` (con inyección de dependencias, testeable) que verifica la clave actual, valida la nueva y hace `UPDATE serfuweb.usuarios`. Frontend: un modal `PanelCambiarClave.vue` abierto desde un botón 🔑 en la cabecera.

**Tech Stack:** Node.js CommonJS, Express, Sequelize (raw query a `serfuweb.usuarios`), `bcryptjs`, `express-rate-limit`, `node --test`; Vue 3 `<script setup>` + Pinia + Tailwind, Vitest.

## Global Constraints

- La contraseña vive en `serfuweb.usuarios.password` (bcrypt **costo 10**, `$2a$`/`$2b$`). `bcryptjs.hash(clave, 10)` es compatible. Escribir en `serfuweb.usuarios` está **autorizado** para esta feature (anula la regla de no tocar tablas no-`wa_`).
- El cambio apunta SIEMPRE a la fila propia vía `req.agente.usuarioId` (del JWT). Nadie cambia la clave de otro.
- Validación de la nueva clave: longitud ≥ 8 y distinta de la actual.
- Nunca loguear las contraseñas.
- `logger` (nunca `console.log`); nombres de dominio en español, técnicos en inglés.
- Backend test: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
- Frontend: `npm --prefix frontend test` y `npm --prefix frontend run build`.

## File Structure

- Modify `src/services/auth.js` — añade `cambiarClave` + helpers `buscarUsuarioPorId`, `actualizarPassword`.
- Modify `src/controllers/authController.js` — handler `cambiarClave`.
- Modify `src/routes/api.js` — rate-limit + ruta.
- Test `test/auth-cambiar-clave.test.js` — servicio con deps inyectadas.
- Create `frontend/src/components/PanelCambiarClave.vue` — modal.
- Modify `frontend/src/stores/auth.js` — acción `cambiarClave`.
- Modify `frontend/src/views/Bandeja.vue` — botón 🔑 + montaje del modal.

---

## Task 1: Backend — servicio, endpoint y pruebas

**Files:**
- Modify: `src/services/auth.js`
- Modify: `src/controllers/authController.js`
- Modify: `src/routes/api.js`
- Test: `test/auth-cambiar-clave.test.js`

**Interfaces:**
- Consumes: `sequelize` de `../config/database`, `bcryptjs`, `requireAuth`, `limiteLogin`-style `rateLimit`, `obtenerIpCliente` (ya importados en `api.js`).
- Produces:
  - `cambiarClave(usuarioId, claveActual, claveNueva, deps = {}) -> Promise<{ok:true}>`. Deps inyectables: `buscarPorId(id)`, `comparar(plano, hash)`, `hashear(plano)`, `actualizar(id, hash)`. Lanza `{status:404}` (usuario inexistente/inactivo), `{status:401, codigo:'clave_actual_incorrecta'}` (clave actual mala), `{status:422}` (nueva < 8 o igual a la actual).
  - Ruta `POST /api/auth/cambiar-clave` → `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

Create `test/auth-cambiar-clave.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { cambiarClave } = require('../src/services/auth');

const hashActual = bcrypt.hashSync('claveVieja1', 10);

function deps(over = {}) {
  const llamadas = { actualizar: [] };
  const base = {
    buscarPorId: async () => ({ id: 9, password: hashActual, activo: 1 }),
    comparar: bcrypt.compare,
    hashear: async (c) => bcrypt.hash(c, 10),
    actualizar: async (id, hash) => { llamadas.actualizar.push({ id, hash }); },
    _llamadas: llamadas,
  };
  return { ...base, ...over };
}

test('clave actual incorrecta → 401 y NO actualiza', async () => {
  const d = deps();
  await assert.rejects(
    () => cambiarClave(9, 'malaClave', 'nuevaClave1', d),
    (e) => e.status === 401 && e.codigo === 'clave_actual_incorrecta',
  );
  assert.equal(d._llamadas.actualizar.length, 0);
});

test('clave nueva de 7 caracteres → 422 y NO actualiza', async () => {
  const d = deps();
  await assert.rejects(() => cambiarClave(9, 'claveVieja1', '1234567', d), (e) => e.status === 422);
  assert.equal(d._llamadas.actualizar.length, 0);
});

test('clave nueva igual a la actual → 422 y NO actualiza', async () => {
  const d = deps();
  await assert.rejects(() => cambiarClave(9, 'claveVieja1', 'claveVieja1', d), (e) => e.status === 422);
  assert.equal(d._llamadas.actualizar.length, 0);
});

test('usuario inactivo → 404', async () => {
  const d = deps({ buscarPorId: async () => ({ id: 9, password: hashActual, activo: 0 }) });
  await assert.rejects(() => cambiarClave(9, 'claveVieja1', 'nuevaClave1', d), (e) => e.status === 404);
});

test('camino feliz → actualiza con un hash bcrypt y devuelve ok', async () => {
  const d = deps();
  const r = await cambiarClave(9, 'claveVieja1', 'nuevaClave1', d);
  assert.deepEqual(r, { ok: true });
  assert.equal(d._llamadas.actualizar.length, 1);
  const guardado = d._llamadas.actualizar[0];
  assert.equal(guardado.id, 9);
  assert.match(guardado.hash, /^\$2[aby]\$/); // hash bcrypt, no la clave en claro
  assert.notEqual(guardado.hash, 'nuevaClave1');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/auth-cambiar-clave.test.js`
Expected: FAIL con "cambiarClave is not a function".

- [ ] **Step 3: Implement the service**

En `src/services/auth.js`, añade (antes de `module.exports`):

```javascript
async function buscarUsuarioPorId(id) {
  const [rows] = await sequelize.query(
    'SELECT id, password, activo FROM serfuweb.usuarios WHERE id = ? LIMIT 1',
    { replacements: [id] },
  );
  return rows[0] || null;
}

async function actualizarPassword(id, hash) {
  await sequelize.query('UPDATE serfuweb.usuarios SET password = ? WHERE id = ?', {
    replacements: [hash, id],
  });
}

/**
 * Cambia la contraseña del propio usuario en serfuweb.usuarios (identidad única).
 * Verifica la clave actual, valida la nueva (≥8 y distinta) y escribe el hash bcrypt.
 */
async function cambiarClave(usuarioId, claveActual, claveNueva, deps = {}) {
  const buscarPorId = deps.buscarPorId || buscarUsuarioPorId;
  const comparar = deps.comparar || bcrypt.compare;
  const hashear = deps.hashear || ((c) => bcrypt.hash(c, 10));
  const actualizar = deps.actualizar || actualizarPassword;

  const u = await buscarPorId(usuarioId);
  if (!u || !u.activo) { const e = new Error('usuario no encontrado'); e.status = 404; throw e; }

  const ok = await comparar(String(claveActual || ''), u.password || '');
  if (!ok) { const e = new Error('clave actual incorrecta'); e.status = 401; e.codigo = 'clave_actual_incorrecta'; throw e; }

  const nueva = String(claveNueva || '');
  if (nueva.length < 8) { const e = new Error('clave nueva muy corta'); e.status = 422; throw e; }
  if (nueva === String(claveActual || '')) { const e = new Error('la clave nueva debe ser distinta'); e.status = 422; throw e; }

  const hash = await hashear(nueva);
  await actualizar(usuarioId, hash);
  return { ok: true };
}
```

Actualiza `module.exports` para incluir `cambiarClave`:

```javascript
module.exports = { autenticar, buscarUsuarioSerfuweb, cambiarClave };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/auth-cambiar-clave.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the controller handler**

En `src/controllers/authController.js`: cambia el require del servicio para traer también `cambiarClave`, y añade el handler.

Require (arriba):

```javascript
const { autenticar, cambiarClave: cambiarClaveSvc } = require('../services/auth');
```

Handler (antes de `module.exports`):

```javascript
async function cambiarClave(req, res) {
  const { claveActual, claveNueva } = req.body || {};
  if (!claveActual || !claveNueva) return res.status(400).json({ error: 'clave actual y nueva requeridas' });
  try {
    await cambiarClaveSvc(req.agente.usuarioId, claveActual, claveNueva);
    return res.json({ ok: true });
  } catch (err) {
    if (err.status === 401) return res.status(401).json({ error: 'la contraseña actual no es correcta', codigo: 'clave_actual_incorrecta' });
    if (err.status === 422) return res.status(422).json({ error: 'la nueva contraseña no es válida (mínimo 8 caracteres y distinta de la actual)' });
    if (err.status === 404) return res.status(404).json({ error: 'usuario no encontrado' });
    logger.error(`cambiar clave usuario ${req.agente && req.agente.usuarioId}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

Actualiza el `module.exports` del controlador para incluir `cambiarClave`: `module.exports = { login, me, cambiarClave };`

- [ ] **Step 6: Wire the route with a rate-limit**

En `src/routes/api.js`, tras la definición de `limiteLogin`, añade un limitador análogo (keyed por usuarioId, disponible tras `requireAuth`):

```javascript
const limiteCambioClave = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${obtenerIpCliente(req)}:${(req.agente && req.agente.usuarioId) || ''}`,
  message: { error: 'demasiados intentos, espera unos minutos' },
});
```

Y la ruta (junto a `/auth/me`):

```javascript
router.post('/auth/cambiar-clave', requireAuth, limiteCambioClave, authCtrl.cambiarClave);
```

(`requireAuth` va PRIMERO para que `req.agente.usuarioId` exista al calcular la clave del rate-limit.)

- [ ] **Step 7: Full backend suite green**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS (todo verde).

- [ ] **Step 8: Commit**

```bash
git add src/services/auth.js src/controllers/authController.js src/routes/api.js test/auth-cambiar-clave.test.js
git commit -m "feat(auth): endpoint de cambio de contraseña (self-service)"
```

---

## Task 2: Frontend — modal y acceso desde la cabecera

**Files:**
- Modify: `frontend/src/stores/auth.js`
- Create: `frontend/src/components/PanelCambiarClave.vue`
- Modify: `frontend/src/views/Bandeja.vue`

**Interfaces:**
- Consumes: endpoint `POST /auth/cambiar-clave` (Task 1); `apiFetch` (ya importado en `auth.js`).
- Produces: `auth.cambiarClave(claveActual, claveNueva)`; componente `PanelCambiarClave.vue`; botón 🔑 en `Bandeja.vue`.

- [ ] **Step 1: Add the store action**

En `frontend/src/stores/auth.js`, dentro de `actions` (junto a `logout`):

```javascript
    async cambiarClave(claveActual, claveNueva) {
      return apiFetch('/auth/cambiar-clave', {
        method: 'POST',
        body: JSON.stringify({ claveActual, claveNueva }),
      });
    },
```

- [ ] **Step 2: Create the modal component**

Create `frontend/src/components/PanelCambiarClave.vue`:

```html
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
```

- [ ] **Step 3: Add the button + mount in `Bandeja.vue`**

`Bandeja.vue` ya importa `ref` y tiene `auth`, una función `salir()` y el botón "Salir" (~línea 78). Añade:

1. En `<script setup>`: `const mostrarCambioClave = ref(false);` y el import del componente `import PanelCambiarClave from '../components/PanelCambiarClave.vue';` (junto a los otros imports de componentes).
2. En el `<template>`, justo antes del botón "Salir":

```html
        <button class="ml-2 text-white/80 hover:text-white text-xs" title="Cambiar contraseña" @click="mostrarCambioClave = true">🔑</button>
```

3. Junto a `<PanelAgentes ... />` / `<PanelEstadisticas ... />`:

```html
    <PanelCambiarClave v-if="mostrarCambioClave" @cerrar="mostrarCambioClave = false" />
```

- [ ] **Step 4: Build + tests**

Run: `npm --prefix frontend run build && npm --prefix frontend test`
Expected: build sin errores; tests existentes en verde (19/19).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/auth.js frontend/src/components/PanelCambiarClave.vue frontend/src/views/Bandeja.vue
git commit -m "feat(auth): modal de cambio de contraseña en la cabecera"
```

---

## Deploy (tras aprobar e implementar)

Solo código (sin migración):
1. `git pull` en el servidor + `npm --prefix frontend run build`.
2. `pm2 restart wa-backend`.
3. Verificación en vivo: 🔑 → cambiar la propia clave → Salir → entrar con la nueva. Confirmar que la vieja ya no funciona.

## Fuera de alcance

- Reseteo por admin de la clave de otros usuarios.
- Forzar cambio en el primer login.
- Políticas de complejidad/caducidad más allá de la longitud mínima.
