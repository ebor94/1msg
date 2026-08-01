# Selector de indicativo de país — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al crear/iniciar un chat, el agente elige el indicativo de país (Colombia +57 por defecto) y teclea solo el número local; el sistema compone el número completo.

**Architecture:** Solo frontend. Datos estáticos + helper puro `componerTelefono` en `frontend/src/utils/paises.js`; se cablea en el flujo "Iniciar chat" de `ListaConversaciones.vue`. El backend no cambia.

**Tech Stack:** Vue 3 `<script setup>` + Pinia + Tailwind, Vitest.

## Global Constraints

- Solo frontend; el backend (`POST /contactos`) no se toca (ya acepta el número completo en dígitos, ≥10).
- Colombia (+57) es el default (`PAISES[0]`).
- `componerTelefono` evita el doble indicativo (si los dígitos ya empiezan por el código, no lo antepone).
- El buscador por nombre/teléfono no cambia (el selector solo afecta la creación).
- Frontend: `npm --prefix frontend test` y `npm --prefix frontend run build`.

## File Structure

- Create `frontend/src/utils/paises.js` — `PAISES` (lista corta) + `componerTelefono`.
- Test `frontend/src/utils/paises.test.js`.
- Modify `frontend/src/components/ListaConversaciones.vue` — selector + composición.

---

## Task 1: Datos de países + helper `componerTelefono`

**Files:**
- Create: `frontend/src/utils/paises.js`
- Test: `frontend/src/utils/paises.test.js`

**Interfaces:**
- Produces:
  - `PAISES` — array de `{ codigo, nombre, bandera }`, Colombia primero.
  - `componerTelefono(codigo, texto) -> string` — dígitos de `texto`; si ya empiezan por `codigo` los devuelve tal cual, si no antepone `codigo`; `''` si no hay dígitos.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/utils/paises.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { PAISES, componerTelefono } from './paises';

describe('paises', () => {
  it('Colombia es el país por defecto (+57)', () => {
    expect(PAISES[0].codigo).toBe('57');
    expect(PAISES.length).toBeGreaterThanOrEqual(10);
  });
});

describe('componerTelefono', () => {
  it('antepone el indicativo a un número local', () => {
    expect(componerTelefono('57', '3001234567')).toBe('573001234567');
  });
  it('no duplica el indicativo si el número ya lo trae', () => {
    expect(componerTelefono('57', '573001234567')).toBe('573001234567');
  });
  it('quita espacios, guiones, paréntesis y +', () => {
    expect(componerTelefono('57', '+57 300 123-4567')).toBe('573001234567');
    expect(componerTelefono('57', '(300) 123 4567')).toBe('573001234567');
  });
  it('funciona con otros indicativos', () => {
    expect(componerTelefono('1', '5551234567')).toBe('15551234567');
  });
  it('devuelve cadena vacía si no hay dígitos', () => {
    expect(componerTelefono('57', '')).toBe('');
    expect(componerTelefono('57', 'abc')).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend test`
Expected: FAIL — no existe `./paises`.

- [ ] **Step 3: Implement**

Create `frontend/src/utils/paises.js`:

```javascript
// Lista corta de indicativos (LatAm + comunes). Colombia primero = default.
export const PAISES = [
  { codigo: '57', nombre: 'Colombia', bandera: '🇨🇴' },
  { codigo: '58', nombre: 'Venezuela', bandera: '🇻🇪' },
  { codigo: '593', nombre: 'Ecuador', bandera: '🇪🇨' },
  { codigo: '51', nombre: 'Perú', bandera: '🇵🇪' },
  { codigo: '507', nombre: 'Panamá', bandera: '🇵🇦' },
  { codigo: '56', nombre: 'Chile', bandera: '🇨🇱' },
  { codigo: '54', nombre: 'Argentina', bandera: '🇦🇷' },
  { codigo: '52', nombre: 'México', bandera: '🇲🇽' },
  { codigo: '55', nombre: 'Brasil', bandera: '🇧🇷' },
  { codigo: '591', nombre: 'Bolivia', bandera: '🇧🇴' },
  { codigo: '595', nombre: 'Paraguay', bandera: '🇵🇾' },
  { codigo: '598', nombre: 'Uruguay', bandera: '🇺🇾' },
  { codigo: '506', nombre: 'Costa Rica', bandera: '🇨🇷' },
  { codigo: '502', nombre: 'Guatemala', bandera: '🇬🇹' },
  { codigo: '504', nombre: 'Honduras', bandera: '🇭🇳' },
  { codigo: '503', nombre: 'El Salvador', bandera: '🇸🇻' },
  { codigo: '34', nombre: 'España', bandera: '🇪🇸' },
  { codigo: '1', nombre: 'EE.UU. / Canadá', bandera: '🇺🇸' },
];

/**
 * Compone el número internacional: dígitos de `texto`, anteponiendo `codigo`
 * salvo que el número ya empiece por él (evita el doble indicativo).
 */
export function componerTelefono(codigo, texto) {
  const digitos = String(texto || '').replace(/\D/g, '');
  if (!digitos) return '';
  return digitos.startsWith(codigo) ? digitos : `${codigo}${digitos}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/paises.js frontend/src/utils/paises.test.js
git commit -m "feat(contactos): datos de países + helper componerTelefono"
```

---

## Task 2: Selector de país en el flujo "Iniciar chat"

**Files:**
- Modify: `frontend/src/components/ListaConversaciones.vue`

**Interfaces:**
- Consumes: `PAISES`, `componerTelefono` (Task 1); el componente ya usa `texto` (ref), `soloDigitos`, `iniciar()`, `busqueda`, `acc.crearContacto`.

- [ ] **Step 1: Script — importar y componer**

En `<script setup>` de `ListaConversaciones.vue`:

1. Importa: `import { PAISES, componerTelefono } from '../utils/paises';`
2. Añade estado y computed (junto a `texto`):
```javascript
import { ref, computed } from 'vue'; // si `computed` no está ya importado, agrégalo al import existente de vue
const paisCodigo = ref(PAISES[0].codigo); // Colombia +57 por defecto
const telCompuesto = computed(() => componerTelefono(paisCodigo.value, texto.value));
```
(Si `ref`/`computed` ya se importan, solo añade lo que falte — no dupliques el import.)

3. Cambia `iniciar()` para usar el número compuesto en vez de `soloDigitos(texto.value)`:
```javascript
async function iniciar() {
  const tel = telCompuesto.value;
  errorAccion.value = '';
  try {
    await acc.crearContacto(tel, '');
    limpiar();
  } catch (e) {
    if (e.codigo === 'existe') {
      errorAccion.value = 'Ese contacto ya existe — elígelo abajo.';
      await busqueda.buscar(tel);
    } else {
      errorAccion.value = 'No se pudo iniciar el chat.';
    }
  }
}
```

- [ ] **Step 2: Template — selector + etiqueta compuesta**

1. Bajo la caja de búsqueda (después del `<div class="relative">…</div>` que contiene el input, dentro del bloque `p-2.5`), añade el selector de país:

```html
      <div class="mt-1.5 flex items-center gap-1 text-[11px] text-gray-500">
        <span>País:</span>
        <select v-model="paisCodigo" class="bg-gray-100 rounded px-2 py-1 text-[12px] outline-none">
          <option v-for="p in PAISES" :key="p.codigo + p.nombre" :value="p.codigo">{{ p.bandera }} {{ p.nombre }} +{{ p.codigo }}</option>
        </select>
      </div>
```

2. Cambia la fila "Iniciar chat" (usa el número compuesto tanto en la condición como en la etiqueta):

```html
        <div v-if="!busqueda.resultados.length && telCompuesto.length >= 10"
          @click="iniciar" class="px-3 py-3 cursor-pointer hover:bg-gray-50 text-marca-oscuro text-[13px] font-semibold">
          ＋ Iniciar chat con +{{ telCompuesto }}
        </div>
```

- [ ] **Step 3: Build + tests**

Run: `npm --prefix frontend run build && npm --prefix frontend test`
Expected: build sin errores; tests en verde (incluye los de `paises`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ListaConversaciones.vue
git commit -m "feat(contactos): selector de país en Iniciar chat (default +57)"
```

---

## Deploy (tras aprobar e implementar)

Solo frontend:
1. `git pull` + `npm --prefix frontend run build`.
2. `pm2 restart wa-backend` (sirve el SPA; sin migración, el worker no cambia).
3. Verificación en vivo: escribir un número local, elegir país (default 🇨🇴 +57), "Iniciar chat con +57…" crea el contacto con el número compuesto; pegar un número con 57 no lo duplica.

## Fuera de alcance

- Lista mundial completa con buscador.
- Validación de longitud por país; guardar el país como campo aparte.
