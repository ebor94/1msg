# Carrusel: validación de límite de caracteres — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validar que el cuerpo hidratado de cada tarjeta del carrusel no supere 160 caracteres y el encabezado no supere 1024, avisando en el wizard y bloqueando el inicio, para que el error no aparezca recién al enviar.

**Architecture:** `parsearTarjeta` expone el texto plantilla de la tarjeta; `carruselListo` (gate de `iniciar`) rechaza si algún cuerpo hidratado (`renderizarCuerpo(texto, vars)`) excede su límite; el wizard muestra contadores vivos y bloquea "Cargar destinatarios".

**Tech Stack:** Node 20 CommonJS, Sequelize, Vue 3 + Pinia + Vitest, `node:test`.

Spec: `docs/superpowers/specs/2026-09-22-carrusel-limite-caracteres-design.md`.

## Global Constraints

- Node 20 CommonJS. Solo tablas `wa_`. No dependencias nuevas. No se toca el envío ni el payload.
- Límites: **tarjeta ≤ 160**, **encabezado ≤ 1024**. Constantes `LIMITE_CUERPO_CARRUSEL = 160`, `LIMITE_CUERPO_GENERAL = 1024`.
- Se mide sobre el texto **hidratado** = `renderizarCuerpo(texto, vars)` y se cuenta con `String.length` (igual que 1msg; dio 167 en el caso real).
- Regresión cero: plantillas planas y carruseles que ya cumplen siguen igual.
- Test backend: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/<archivo>` (este Node usa el reporter con `ℹ`; para la suite completa `node --test test/*.test.js 2>&1 | tail -4`, confirmar `fail 0`).
- Test frontend: `npm --prefix frontend test` (un archivo: `-- <ruta>`); build `npm --prefix frontend run build`.

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `src/services/plantillas.js` | `parsearTarjeta` expone `texto` | Modificar |
| `test/plantillas-servicio.test.js` | test de `texto` | Modificar |
| `src/services/difusiones.js` | `carruselListo` valida 160/1024 | Modificar |
| `test/difusion-servicio.test.js` | tests de límite | Modificar |
| `frontend/src/utils/difusion.js` | `largoHidratado`, `carruselExcedeLimite`, constantes | Modificar |
| `frontend/src/utils/difusion.test.js` | tests de los helpers | Modificar |
| `frontend/src/components/DifusionWizard.vue` | contadores + gate `puedeCargar` | Modificar |

---

## Task 1: `parsearTarjeta` expone el texto plantilla de la tarjeta

**Files:**
- Modify: `src/services/plantillas.js`
- Test: `test/plantillas-servicio.test.js`

**Interfaces:**
- Produces: `parsearTarjeta(card)` añade `texto: string` = el `BODY.text` de la tarjeta (con `{{n}}`). Los demás campos se mantienen.

- [ ] **Step 1: Escribir el test que falla**

In `test/plantillas-servicio.test.js`, add:

```js
test('parsearPlantilla: cada tarjeta del carrusel expone su texto plantilla', () => {
  const t = {
    name: 'car3', language: 'es',
    components: [
      { type: 'BODY', text: 'Invita a {{1}}' },
      { type: 'CAROUSEL', cards: [
        { components: [
          { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://x/a.jpg'] } },
          { type: 'BODY', text: 'Evento: {{1}} , | Lugar : {{2}} .' },
        ] },
      ] },
    ],
  };
  const p = parsearPlantilla(t);
  assert.equal(p.carrusel.cards[0].texto, 'Evento: {{1}} , | Lugar : {{2}} .');
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/plantillas-servicio.test.js`
Expected: FAIL (`texto` es `undefined`).

- [ ] **Step 3: Implementar**

In `src/services/plantillas.js`, in `parsearTarjeta`, add `texto` to the returned object (the `body` const already exists in the function):

```js
    texto: (body && body.text) || '',
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/plantillas-servicio.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/plantillas.js test/plantillas-servicio.test.js
git commit -m "feat(carrusel): parsearTarjeta expone el texto plantilla de la tarjeta

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `carruselListo` valida el largo del cuerpo hidratado (160 / 1024)

**Files:**
- Modify: `src/services/difusiones.js`
- Test: `test/difusion-servicio.test.js`

**Interfaces:**
- Consumes: `def.carrusel.cards[i].texto` (Task 1), `def.cuerpo`, `dif.carrusel.cards[i].vars`, `dif.carrusel.bodyVars`, `renderizarCuerpo` (de `./plantillas`).
- Produces: `carruselListo` rechaza si el cuerpo hidratado de una tarjeta > 160 o el del encabezado > 1024, con mensaje que incluye el número medido.

- [ ] **Step 1: Escribir los tests que fallan**

In `test/difusion-servicio.test.js`, add:

```js
test('carruselListo: cuerpo de tarjeta hidratado > 160 → no ok', () => {
  const def = { esCarrusel: true, cuerpo: 'Hola {{1}}', carrusel: { bodyVars: 1, cards: [{ variables: 1, tieneImagen: true, texto: 'X: {{1}}' }] } };
  const dif = { carrusel: { bodyVars: ['ok'], cards: [{ imagenUrl: 'a', vars: ['a'.repeat(200)] }] } };
  const r = carruselListo(dif, def);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /tarjeta 1.*160/);
});

test('carruselListo: cuerpo de tarjeta ≤ 160 → ok', () => {
  const def = { esCarrusel: true, cuerpo: 'Hola {{1}}', carrusel: { bodyVars: 1, cards: [{ variables: 1, tieneImagen: true, texto: 'X: {{1}}' }] } };
  const dif = { carrusel: { bodyVars: ['ok'], cards: [{ imagenUrl: 'a', vars: ['corto'] }] } };
  assert.equal(carruselListo(dif, def).ok, true);
});

test('carruselListo: encabezado hidratado > 1024 → no ok', () => {
  const def = { esCarrusel: true, cuerpo: 'Enc: {{1}}', carrusel: { bodyVars: 1, cards: [{ variables: 1, tieneImagen: true, texto: 'X: {{1}}' }] } };
  const dif = { carrusel: { bodyVars: ['b'.repeat(1100)], cards: [{ imagenUrl: 'a', vars: ['corto'] }] } };
  const r = carruselListo(dif, def);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /encabezado.*1024/);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-servicio.test.js`
Expected: FAIL (todavía no hay chequeo de largo → devuelve ok:true).

- [ ] **Step 3: Implementar**

In `src/services/difusiones.js`, add the import near the top (junto a los otros `require`):

```js
const { renderizarCuerpo } = require('./plantillas');
```

Add the constants near `puedeIniciar`:

```js
const LIMITE_CUERPO_CARRUSEL = 160;   // límite de WhatsApp para el cuerpo de cada tarjeta
const LIMITE_CUERPO_GENERAL = 1024;   // límite para el cuerpo general del carrusel
```

In `carruselListo`, right before the final `return { ok: true };`, add:

```js
  // Límite de caracteres del cuerpo hidratado (WhatsApp): tarjeta ≤160, encabezado ≤1024.
  for (let i = 0; i < c.cards.length; i += 1) {
    const largo = renderizarCuerpo((cardsDef[i] && cardsDef[i].texto) || '', c.cards[i].vars || []).length;
    if (largo > LIMITE_CUERPO_CARRUSEL) {
      return { ok: false, motivo: `el texto de la tarjeta ${i + 1} supera el límite de ${LIMITE_CUERPO_CARRUSEL} caracteres (tiene ${largo})` };
    }
  }
  const largoGeneral = renderizarCuerpo(def.cuerpo || '', c.bodyVars || []).length;
  if (largoGeneral > LIMITE_CUERPO_GENERAL) {
    return { ok: false, motivo: `el texto del encabezado supera el límite de ${LIMITE_CUERPO_GENERAL} caracteres (tiene ${largoGeneral})` };
  }
```

- [ ] **Step 4: Correr y verificar que pasa (+ sin regresiones)**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/services/difusiones.js && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js 2>&1 | tail -4
```
Expected: sintaxis OK; `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/services/difusiones.js test/difusion-servicio.test.js
git commit -m "feat(carrusel): iniciar valida el largo del cuerpo (tarjeta 160, encabezado 1024)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Helpers de frontend (largo hidratado + excede límite)

**Files:**
- Modify: `frontend/src/utils/difusion.js`
- Test: `frontend/src/utils/difusion.test.js`

**Interfaces:**
- Produces: `LIMITE_CUERPO_CARRUSEL = 160`, `LIMITE_CUERPO_GENERAL = 1024`; `largoHidratado(texto, vars) → number`; `carruselExcedeLimite(plantilla, carrusel) → boolean` (true si el encabezado o alguna tarjeta excede su límite).

- [ ] **Step 1: Escribir los tests que fallan**

In `frontend/src/utils/difusion.test.js`, add (respeta el estilo `describe/it` del archivo; importa lo nuevo):

```js
import { largoHidratado, carruselExcedeLimite, LIMITE_CUERPO_CARRUSEL, LIMITE_CUERPO_GENERAL } from './difusion';

describe('límite de caracteres carrusel', () => {
  it('largoHidratado cuenta el texto con variables sustituidas', () => {
    expect(largoHidratado('Hola {{1}}', ['Ana'])).toBe(8);
    expect(LIMITE_CUERPO_CARRUSEL).toBe(160);
    expect(LIMITE_CUERPO_GENERAL).toBe(1024);
  });

  it('carruselExcedeLimite true si una tarjeta pasa de 160', () => {
    const plantilla = { cuerpo: 'Enc {{1}}', carrusel: { cards: [{ texto: 'X: {{1}}' }] } };
    const carrusel = { bodyVars: ['ok'], cards: [{ vars: ['a'.repeat(200)] }] };
    expect(carruselExcedeLimite(plantilla, carrusel)).toBe(true);
  });

  it('carruselExcedeLimite true si el encabezado pasa de 1024', () => {
    const plantilla = { cuerpo: 'Enc {{1}}', carrusel: { cards: [{ texto: 'X: {{1}}' }] } };
    const carrusel = { bodyVars: ['b'.repeat(1100)], cards: [{ vars: ['ok'] }] };
    expect(carruselExcedeLimite(plantilla, carrusel)).toBe(true);
  });

  it('carruselExcedeLimite false cuando todo cumple', () => {
    const plantilla = { cuerpo: 'Enc {{1}}', carrusel: { cards: [{ texto: 'X: {{1}}' }] } };
    const carrusel = { bodyVars: ['ok'], cards: [{ vars: ['corto'] }] };
    expect(carruselExcedeLimite(plantilla, carrusel)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm --prefix frontend test -- src/utils/difusion.test.js`
Expected: FAIL (los helpers no existen).

- [ ] **Step 3: Implementar**

In `frontend/src/utils/difusion.js`, add (usa `renderizarCuerpo` ya definido en el archivo):

```js
export const LIMITE_CUERPO_CARRUSEL = 160;
export const LIMITE_CUERPO_GENERAL = 1024;

// Largo del texto ya rellenado con sus variables (como lo mide WhatsApp).
export function largoHidratado(texto, vars) {
  return renderizarCuerpo(texto || '', vars || []).length;
}

// True si el encabezado (>1024) o alguna tarjeta (>160) excede su límite.
export function carruselExcedeLimite(plantilla, carrusel) {
  if (!plantilla || !plantilla.carrusel || !carrusel) return false;
  if (largoHidratado(plantilla.cuerpo, carrusel.bodyVars) > LIMITE_CUERPO_GENERAL) return true;
  return (carrusel.cards || []).some((card, i) => {
    const texto = plantilla.carrusel.cards[i] && plantilla.carrusel.cards[i].texto;
    return largoHidratado(texto, card.vars) > LIMITE_CUERPO_CARRUSEL;
  });
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm --prefix frontend test -- src/utils/difusion.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/difusion.js frontend/src/utils/difusion.test.js
git commit -m "feat(carrusel): helpers de largo hidratado y excede-límite (frontend)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wizard — contadores vivos + bloqueo de "Cargar"

**Files:**
- Modify: `frontend/src/components/DifusionWizard.vue`

**Interfaces:**
- Consumes: `largoHidratado`, `carruselExcedeLimite`, `LIMITE_CUERPO_CARRUSEL`, `LIMITE_CUERPO_GENERAL` (Task 3).

- [ ] **Step 1: Importar los helpers y sumar el gate a `puedeCargar`**

In `frontend/src/components/DifusionWizard.vue`, extend the import from `../utils/difusion` to include the new symbols:

```js
import { renderizarCuerpo, parsearCsvPreview, valorDeVariable, columnasRequeridas, initCarrusel, carruselBackend, largoHidratado, carruselExcedeLimite, LIMITE_CUERPO_CARRUSEL, LIMITE_CUERPO_GENERAL } from '../utils/difusion';
```

Then update `puedeCargar` to also require that no limit is exceeded (keep all existing conditions):

```js
const puedeCargar = computed(() => nombre.value.trim() && plantillaNombre.value && csvTexto.value.trim() && !faltaImagen.value && !faltaImagenCarrusel.value && !faltaTextoCarrusel.value && !(esCarrusel.value && carruselExcedeLimite(plantilla.value, carrusel.value)));
```

- [ ] **Step 2: Contador del encabezado**

In the carousel editor block, inside the `v-if="carrusel.bodyVars.length"` div (después de los inputs del cuerpo general), add a counter:

```html
              <div class="text-[11px] text-right" :class="largoHidratado(plantilla.cuerpo, carrusel.bodyVars) > LIMITE_CUERPO_GENERAL ? 'text-red-600 font-semibold' : 'text-gray-400'">
                {{ largoHidratado(plantilla.cuerpo, carrusel.bodyVars) }} / {{ LIMITE_CUERPO_GENERAL }}
              </div>
```

- [ ] **Step 3: Contador por tarjeta**

In the per-card block, después del `v-for` de los inputs de variables (dentro del div de la tarjeta), add:

```html
              <div class="text-[11px] text-right" :class="largoHidratado(plantilla.carrusel.cards[ci].texto, card.vars) > LIMITE_CUERPO_CARRUSEL ? 'text-red-600 font-semibold' : 'text-gray-400'">
                {{ largoHidratado(plantilla.carrusel.cards[ci].texto, card.vars) }} / {{ LIMITE_CUERPO_CARRUSEL }}
              </div>
```

- [ ] **Step 4: Suite frontend + build**

Run: `npm --prefix frontend test` (todo verde) y `npm --prefix frontend run build` (OK).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DifusionWizard.vue
git commit -m "feat(carrusel): contadores de caracteres en el wizard y bloqueo al exceder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Despliegue (tras merge)

Backend + worker (usan `plantillas.js`/`difusiones.js`) + frontend; sin migración:
```bash
ssh mantix 'cd ~/apps/wa && git pull --ff-only && npm --prefix frontend run build && pm2 restart wa-backend wa-worker'
```

**Verificación en vivo (usuario):**
1. En el wizard con la plantilla de carrusel, escribir un texto largo en una tarjeta → el contador se pone **rojo** y "Cargar destinatarios" queda **deshabilitado**.
2. Acortar el texto por debajo de 160 → el contador vuelve a gris y se habilita "Cargar".
3. (Borde) Si por algún camino se cuela un texto >160, `iniciar` lo rechaza con el mensaje que indica la tarjeta y el número de caracteres.
4. Una difusión de carrusel válida sigue enviando normal (sin regresión).

## Self-review

- **Cobertura del spec:** parse `texto` (T1); gate 160/1024 en `carruselListo` (T2); helpers front (T3); contadores + bloqueo `puedeCargar` (T4). Ambos límites cubiertos.
- **Tipos consistentes:** `parsearTarjeta.texto`; `carruselListo` usa `def.carrusel.cards[i].texto` + `def.cuerpo` + `renderizarCuerpo`; front `largoHidratado(texto, vars)`/`carruselExcedeLimite(plantilla, carrusel)` con esos nombres; constantes `LIMITE_CUERPO_CARRUSEL`/`LIMITE_CUERPO_GENERAL` en front (y equivalentes en `difusiones.js`).
- **Sin placeholders:** cada paso trae código real y comando con salida esperada.
