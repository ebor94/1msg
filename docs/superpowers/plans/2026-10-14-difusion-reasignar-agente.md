# Difusión: opción "reasignar al agente de la difusión" — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un check en la creación de la difusión que, si está marcado, pone al agente de la difusión como dueño de cada contacto y mueve sus chats a ese agente; si no, deja los dueños existentes como hoy.

**Architecture:** Columna `reasignar` en `wa_difusiones`; `persistirEnvioPlantilla` decide el agente y si fija dueño / mueve la conversación según esa bandera (dos helpers puros); `crear` la guarda, `difusionEnvio` la pasa, y el wizard la ofrece como checkbox.

**Tech Stack:** Node 20 CommonJS, Express, Sequelize, Vue 3 + Pinia + Vitest, `node:test`.

Spec: `docs/superpowers/specs/2026-10-14-difusion-reasignar-agente-design.md`.

## Global Constraints

- Node 20 CommonJS. Solo tablas `wa_`. Sin dependencias nuevas.
- Default seguro: sin el check, el comportamiento es idéntico a hoy (solo asigna dueño si no hay).
- `reasignar` es un parámetro OPCIONAL de `persistirEnvioPlantilla` (default falso) para no afectar a otros llamadores (`recordatorios.js`).
- Constantes: `ESTADO_CONVERSACION.CERRADA = 'cerrada'`.
- Test backend: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/<archivo>` (suite completa `test/*.test.js 2>&1 | tail -4`, reporter `ℹ`, confirmar `fail 0`).
- Test frontend: `npm --prefix frontend test` (un archivo: `-- <ruta>`); build `npm --prefix frontend run build`.
- Migración a mano: `set -a && . ./.env && set +a && MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME" < docs/migraciones/013-*.sql`

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `docs/migraciones/013-difusion-reasignar.sql` | columna `reasignar` | Crear |
| `src/models/Difusion.js` | mapear `reasignar` | Modificar |
| `src/services/difusiones.js` | `crear` acepta/guarda `reasignar` | Modificar |
| `src/controllers/difusionesController.js` | `crear` pasa `reasignar` | Modificar |
| `src/services/envioPlantilla.js` | helpers + `persistirEnvioPlantilla` respeta `reasignar` | Modificar |
| `test/envio-plantilla-reasignar.test.js` | tests de los helpers | Crear |
| `src/services/difusionEnvio.js` | pasa `reasignar` al persistir | Modificar |
| `frontend/src/components/DifusionWizard.vue` | checkbox | Modificar |

---

## Task 1: Migración 013 + modelo + `crear` guarda `reasignar`

**Files:**
- Create: `docs/migraciones/013-difusion-reasignar.sql`
- Modify: `src/models/Difusion.js`
- Modify: `src/services/difusiones.js`
- Modify: `src/controllers/difusionesController.js`

**Interfaces:**
- Produces: `Difusion.reasignar` (boolean, default false); `crear(... , reasignar)` lo persiste; el controller `crear` pasa `reasignar: b.reasignar`.

- [ ] **Step 1: Migración**

Create `docs/migraciones/013-difusion-reasignar.sql`:

```sql
-- 013 — opción de reasignar los chats al agente de la difusión (dueño + mover chat).
ALTER TABLE wa_difusiones
  ADD COLUMN reasignar BOOLEAN NOT NULL DEFAULT 0 AFTER requiere_resumen;
```

- [ ] **Step 2: Modelo**

In `src/models/Difusion.js`, after the `requiereResumen` field, add:

```js
      reasignar: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
```

- [ ] **Step 3: `crear` (servicio) acepta y guarda `reasignar`**

In `src/services/difusiones.js`, add `reasignar` to the `crear` destructuring:

```js
async function crear({ nombre, plantilla, idioma, categoria, requiereResumen, carrusel, reasignar, creadoPorId }) {
```

And in the `Difusion.create({...})` call, add:

```js
    reasignar: !!reasignar,
```

- [ ] **Step 4: Controller pasa `reasignar`**

In `src/controllers/difusionesController.js`, in `crear`, add `reasignar: b.reasignar` to the `servicio.crear({...})` call (junto a `requiereResumen: b.requiereResumen`).

- [ ] **Step 5: Verificar sintaxis + suite (sin regresiones)**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/models/Difusion.js && node --check src/services/difusiones.js && node --check src/controllers/difusionesController.js && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js 2>&1 | tail -4
```
Expected: sintaxis OK; `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add docs/migraciones/013-difusion-reasignar.sql src/models/Difusion.js src/services/difusiones.js src/controllers/difusionesController.js
git commit -m "feat(difusion): columna reasignar + crear la persiste (migración 013)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `persistirEnvioPlantilla` respeta `reasignar`

**Files:**
- Modify: `src/services/envioPlantilla.js`
- Test: `test/envio-plantilla-reasignar.test.js`
- Modify: `src/services/difusionEnvio.js`

**Interfaces:**
- Produces: `decidirAgenteEnvio({ reasignar, duenoActual, agenteDifusion }) → { agenteId, fijarDueno }` y `debeMoverConversacion({ reasignar, estado, convAgente, agenteId }) → boolean` (exportados). `persistirEnvioPlantilla` gana el parámetro opcional `reasignar`.
- `difusionEnvio` pasa `reasignar: !!dif.reasignar`.

- [ ] **Step 1: Escribir los tests que fallan**

Create `test/envio-plantilla-reasignar.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decidirAgenteEnvio, debeMoverConversacion } = require('../src/services/envioPlantilla');

test('decidirAgenteEnvio: sin dueño → agente de la difusión y fija dueño (ambos modos)', () => {
  assert.deepEqual(decidirAgenteEnvio({ reasignar: false, duenoActual: null, agenteDifusion: 7 }), { agenteId: 7, fijarDueno: true });
  assert.deepEqual(decidirAgenteEnvio({ reasignar: true, duenoActual: null, agenteDifusion: 7 }), { agenteId: 7, fijarDueno: true });
});
test('decidirAgenteEnvio: con dueño y reasignar=false → respeta dueño, no fija', () => {
  assert.deepEqual(decidirAgenteEnvio({ reasignar: false, duenoActual: 9, agenteDifusion: 7 }), { agenteId: 9, fijarDueno: false });
});
test('decidirAgenteEnvio: con dueño distinto y reasignar=true → agente difusión, fija dueño', () => {
  assert.deepEqual(decidirAgenteEnvio({ reasignar: true, duenoActual: 9, agenteDifusion: 7 }), { agenteId: 7, fijarDueno: true });
});
test('decidirAgenteEnvio: reasignar=true pero dueño ya es el de la difusión → no re-fija', () => {
  assert.deepEqual(decidirAgenteEnvio({ reasignar: true, duenoActual: 7, agenteDifusion: 7 }), { agenteId: 7, fijarDueno: false });
});

test('debeMoverConversacion: cerrada con agente distinto → true (ambos modos)', () => {
  assert.equal(debeMoverConversacion({ reasignar: false, estado: 'cerrada', convAgente: 9, agenteId: 7 }), true);
  assert.equal(debeMoverConversacion({ reasignar: true, estado: 'cerrada', convAgente: 9, agenteId: 7 }), true);
});
test('debeMoverConversacion: abierta con agente distinto → solo con reasignar', () => {
  assert.equal(debeMoverConversacion({ reasignar: false, estado: 'abierta', convAgente: 9, agenteId: 7 }), false);
  assert.equal(debeMoverConversacion({ reasignar: true, estado: 'abierta', convAgente: 9, agenteId: 7 }), true);
});
test('debeMoverConversacion: mismo agente o sin destino → false', () => {
  assert.equal(debeMoverConversacion({ reasignar: true, estado: 'cerrada', convAgente: 7, agenteId: 7 }), false);
  assert.equal(debeMoverConversacion({ reasignar: true, estado: 'abierta', convAgente: 9, agenteId: null }), false);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/envio-plantilla-reasignar.test.js`
Expected: FAIL (helpers no existen).

- [ ] **Step 3: Implementar los helpers + usarlos**

In `src/services/envioPlantilla.js`, add the two helpers (antes de `persistirEnvioPlantilla`):

```js
/** Pura: agente a usar en el envío y si hay que fijar el dueño del contacto. */
function decidirAgenteEnvio({ reasignar, duenoActual, agenteDifusion }) {
  const agenteId = reasignar ? (agenteDifusion || duenoActual || null) : (duenoActual || agenteDifusion || null);
  const fijarDueno = !!agenteId && (reasignar ? duenoActual !== agenteId : !duenoActual);
  return { agenteId, fijarDueno };
}

/** Pura: si hay que mover la conversación existente al agente elegido. */
function debeMoverConversacion({ reasignar, estado, convAgente, agenteId }) {
  return agenteId != null && convAgente !== agenteId && (reasignar || estado === ESTADO_CONVERSACION.CERRADA);
}
```

Update `persistirEnvioPlantilla` to accept `reasignar` and use the helpers. Replace its signature and the agente/dueño/conversación logic:

```js
async function persistirEnvioPlantilla({ contactoId, agenteFallback, canalId, plantillaNombre, texto, waMessageId, origen, mediaUrl, reasignar }, extra) {
  const ahora = new Date();
  let convId;
  await sequelize.transaction(async (t) => {
    const contacto = await Contacto.findByPk(contactoId, { transaction: t });
    const { agenteId, fijarDueno } = decidirAgenteEnvio({ reasignar: !!reasignar, duenoActual: contacto.agenteDuenoId || null, agenteDifusion: agenteFallback || null });
    if (fijarDueno) await contacto.update({ agenteDuenoId: agenteId }, { transaction: t });

    let conv = await Conversacion.findOne({ where: { contactoId }, order: [['id', 'DESC']], transaction: t });
    if (!conv) {
      conv = await Conversacion.create({
        canalId, contactoId, agenteId, estado: ESTADO_CONVERSACION.CERRADA, origen, cerradaEn: ahora,
      }, { transaction: t });
    } else if (debeMoverConversacion({ reasignar: !!reasignar, estado: conv.estado, convAgente: conv.agenteId, agenteId })) {
      await conv.update({ agenteId }, { transaction: t });
    }

    await Mensaje.findOrCreate({
      where: { waMessageId },
      defaults: {
        conversacionId: conv.id, waMessageId, direccion: DIRECCION.OUT, tipo: TIPO_MENSAJE.TEMPLATE,
        texto, plantillaNombre, estado: ESTADO_MENSAJE.ENVIADO, enviadoPorId: null, tsProveedor: ahora,
        mediaUrl: mediaUrl || null,
      },
      transaction: t,
    });
    await conv.update({ ultimoMensajeEn: ahora, ultimoMensajeTexto: texto.slice(0, 255), ultimoMensajeDir: DIRECCION.OUT }, { transaction: t });
    convId = conv.id;
    if (extra) await extra(t, conv.id);
  });
  return convId;
}
```

Update `module.exports` to also export the helpers:

```js
module.exports = { persistirEnvioPlantilla, decidirAgenteEnvio, debeMoverConversacion };
```

- [ ] **Step 4: `difusionEnvio` pasa `reasignar`**

In `src/services/difusionEnvio.js`, in the `persistirEnvioPlantilla({...})` call, add `reasignar: !!dif.reasignar` to the object (junto a `mediaUrl`).

- [ ] **Step 5: Correr y verificar que pasa (+ sin regresiones)**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/services/envioPlantilla.js && node --check src/services/difusionEnvio.js && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js 2>&1 | tail -4
```
Expected: sintaxis OK; `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/services/envioPlantilla.js test/envio-plantilla-reasignar.test.js src/services/difusionEnvio.js
git commit -m "feat(difusion): reasignar fuerza dueño y mueve el chat al agente de la difusión

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wizard — checkbox "Reasignar los chats al agente de la difusión"

**Files:**
- Modify: `frontend/src/components/DifusionWizard.vue`

**Interfaces:**
- Consumes: `acc.crearDifusion(datos)` con un campo `reasignar` nuevo.

- [ ] **Step 1: Estado + payload**

In `frontend/src/components/DifusionWizard.vue`, add a ref next to `requiereResumen` (línea ~15):

```js
const reasignar = ref(false);
```

In the `datos` object built in `crearYCargar` (donde está `requiereResumen: requiereResumen.value`), add:

```js
      const datos = { nombre: nombre.value, plantilla: plantillaNombre.value, requiereResumen: requiereResumen.value, reasignar: reasignar.value };
```

- [ ] **Step 2: Checkbox en el template**

In `frontend/src/components/DifusionWizard.vue`, right after the "Requiere resumen" checkbox block (el `<div class="flex items-start gap-2">` que contiene `#reqResumen`), add a sibling block mirroring it:

```html
        <div class="flex items-start gap-2">
          <input id="reasignar" type="checkbox" v-model="reasignar" class="mt-0.5" />
          <label for="reasignar" class="text-[12.5px] text-gray-700 leading-snug">
            Reasignar los chats al agente de la difusión
            <span class="block text-[11px] text-gray-400">Si se marca, cada contacto queda con el agente de la difusión (dueño) y su chat se mueve a ese agente, aunque ya tuviera otro.</span>
          </label>
        </div>
```

- [ ] **Step 3: Suite frontend + build**

Run: `npm --prefix frontend test` (todo verde) y `npm --prefix frontend run build` (OK).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/DifusionWizard.vue
git commit -m "feat(difusion): checkbox para reasignar los chats al agente de la difusión

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Despliegue (tras merge)

Backend (modelo/servicios) + worker (usa `difusionEnvio`/`envioPlantilla`) + frontend; **con migración 013**:
```bash
ssh mantix 'cd ~/apps/wa && git pull --ff-only'
ssh mantix 'cd ~/apps/wa && set -a && . ./.env && set +a && MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME" < docs/migraciones/013-difusion-reasignar.sql'
ssh mantix 'cd ~/apps/wa && npm --prefix frontend run build && pm2 restart wa-backend wa-worker'
```

**Verificación en vivo (usuario):**
1. Crear una difusión con el check **marcado**, a contactos que ya tengan otro dueño → tras enviarse, esos contactos quedan con `agente_dueno_id` = el AGENTE_ID de la difusión y sus chats movidos a ese agente.
2. Crear una difusión con el check **desmarcado** → se respetan los dueños existentes (como hoy); solo los sin dueño quedan con el agente de la difusión.
3. Recordatorios y otros envíos no cambian.

## Self-review

- **Cobertura del spec:** columna/migración + crear (T1); helpers + persistir + difusionEnvio (T2); wizard (T3).
- **Tipos consistentes:** `decidirAgenteEnvio({reasignar,duenoActual,agenteDifusion})→{agenteId,fijarDueno}`; `debeMoverConversacion({reasignar,estado,convAgente,agenteId})→bool`; `persistirEnvioPlantilla(..., reasignar)`; `dif.reasignar`; campo `reasignar` en Difusion/crear/controller/wizard.
- **Sin placeholders:** cada paso trae código real y comando con salida esperada.
