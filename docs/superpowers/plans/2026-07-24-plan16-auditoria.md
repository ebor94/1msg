# Plan 16 — Auditoría: historial de asignaciones + autor del mensaje (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ver el historial de asignaciones de un chat (de→a, quién, cuándo, motivo) en el panel, y el nombre del agente que envió cada mensaje saliente en su burbuja.

**Architecture:** Los datos ya existen: `wa_asignaciones` (de/a/ejecutadoPor/tipo/motivo/creado_en) y `wa_mensajes.enviado_por_id`. Un endpoint `GET /conversaciones/:id/asignaciones` (patrón de `listarNotas`) devuelve el historial con nombres. El `mensajes` API incluye `enviadoPor` (join); los 3 endpoints de envío adjuntan el nombre al emitir. Frontend: línea de tiempo en `PanelCliente` + etiqueta de autor en `BurbujaMensaje`.

**Tech Stack:** Express/Sequelize (backend); Vue 3/Pinia/Vitest (frontend). Solo lectura + una etiqueta; sin migración.

## Global Constraints

- El historial de asignaciones requiere `puedeVer` (mismo permiso que las notas). Solo se ven metadatos (nombres, fechas, motivo).
- Autor por mensaje: los salientes muestran el agente (`enviadoPor`); los entrantes y los históricos/backfill (sin `enviado_por_id`) no muestran etiqueta.
- Sin migración ni cambios de modelo (las asociaciones `deAgente`/`aAgente`/`ejecutadoPor`/`enviadoPor` ya existen).
- Sin token al frontend; `'use strict'`, CommonJS backend; sin `console.log`.

## File Structure

- `src/controllers/conversacionesController.js` (modificar): handler `asignaciones` + `enviadoPor` en `mensajes` + adjuntar `enviadoPor` en los 3 handlers de envío.
- `src/routes/api.js` (modificar): ruta `GET /conversaciones/:id/asignaciones`.
- `frontend/src/utils/formato.js` (modificar): `etiquetaAsignacion(tipo)`.
- `frontend/src/stores/acciones.js` (modificar): `cargarAsignaciones`.
- `frontend/src/components/PanelCliente.vue` (modificar): sección "Historial de asignaciones".
- `frontend/src/components/BurbujaMensaje.vue` (modificar): etiqueta del autor en salientes.

---

### Task 1: Backend — endpoint de asignaciones + autor en mensajes/envíos

**Files:**
- Modify: `src/controllers/conversacionesController.js`
- Modify: `src/routes/api.js`

**Interfaces:**
- `GET /api/conversaciones/:id/asignaciones` → `{ asignaciones: [{ id, de, a, ejecutadoPor, tipo, motivo, creadoEn }] }` (permiso `puedeVer`).
- `GET /api/conversaciones/:id/mensajes` → cada mensaje incluye `enviadoPor: { id, nombre } | null`.
- Los 3 envíos (`enviar`, `enviarPlantilla`, `enviarMedia`) devuelven/emiten `mensaje.enviadoPor = { id, nombre }`.

- [ ] **Step 1: Handler `asignaciones`** (mirror de `listarNotas`)

`Asignacion` y `Agente` ya están importados. Añadir:

```js
async function asignaciones(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    const filas = await Asignacion.findAll({
      where: { conversacionId: conv.id },
      order: [['id', 'ASC']],
      include: [
        { model: Agente, as: 'deAgente', attributes: ['nombre'] },
        { model: Agente, as: 'aAgente', attributes: ['nombre'] },
        { model: Agente, as: 'ejecutadoPor', attributes: ['nombre'] },
      ],
    });
    const asignaciones = filas.map((a) => ({
      id: a.id,
      de: a.deAgente ? a.deAgente.nombre : null,
      a: a.aAgente ? a.aAgente.nombre : null,
      ejecutadoPor: a.ejecutadoPor ? a.ejecutadoPor.nombre : null,
      tipo: a.tipo,
      motivo: a.motivo,
      creadoEn: a.creado_en,
    }));
    return res.json({ asignaciones });
  } catch (err) {
    logger.error(`asignaciones ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

Exportar `asignaciones`.

- [ ] **Step 2: Incluir `enviadoPor` en `mensajes`**

En el handler `mensajes`, añadir el include a la consulta:

```js
    const filas = await Mensaje.findAll({
      where,
      order: [['tsProveedor', 'DESC'], ['id', 'DESC']],
      limit: 30,
      include: [{ model: Agente, as: 'enviadoPor', attributes: ['id', 'nombre'] }],
    });
```

(Cada fila serializa `enviadoPor: { id, nombre }` o `null`.)

- [ ] **Step 3: Adjuntar `enviadoPor` en los 3 envíos**

En `enviar`, `enviarPlantilla` y `enviarMedia`, donde hoy se emite y se responde con `mensaje`, construir una salida enriquecida (los tres tienen `agente` cargado con `nombre`):

```js
    const salida = { ...mensaje.toJSON(), enviadoPor: { id: agente.id, nombre: agente.nombre } };
    // ... emitir con `salida` en vez de `mensaje`:
    emitir('mensaje:nuevo', destino, { conversacionId: conv.id, mensaje: salida });
    return res.status(201).json({ mensaje: salida });
```

Aplicar el mismo patrón en los tres (usar el `destino`/rooms que ya tiene cada uno; solo cambia `mensaje` → `salida` en el emit y en el `res.json`).

- [ ] **Step 4: Ruta**

En `src/routes/api.js`, junto a las notas:

```js
router.get('/conversaciones/:id/asignaciones', requireAuth, convCtrl.asignaciones);
```

- [ ] **Step 5: Verificar carga + suite**

```
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node -e "require('./src/routes'); console.log('rutas OK')"
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js
```
Expected: "rutas OK" y suite verde (sin regresiones). (Handlers con DB → se validan en la prueba real.)

- [ ] **Step 6: Commit**

```bash
git add src/controllers/conversacionesController.js src/routes/api.js
git commit -m "feat(auditoria): GET /conversaciones/:id/asignaciones + enviadoPor en mensajes/envíos"
```

---

### Task 2: Frontend — timeline de asignaciones + autor en la burbuja

**Files:**
- Modify: `frontend/src/utils/formato.js`
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/components/PanelCliente.vue`
- Modify: `frontend/src/components/BurbujaMensaje.vue`
- Test: `frontend/src/utils/formato.test.js`

**Interfaces:**
- `etiquetaAsignacion(tipo): string`. Store `cargarAsignaciones(convId)` con state `asignaciones`.

- [ ] **Step 1: Test de `etiquetaAsignacion`**

Añadir a `frontend/src/utils/formato.test.js` (no dupliques el import de vitest; añade `etiquetaAsignacion` al import de `./formato`):

```js
describe('etiquetaAsignacion', () => {
  it('mapea los tipos conocidos', () => {
    expect(etiquetaAsignacion('toma_manual')).toBe('toma manual');
    expect(etiquetaAsignacion('reasignacion')).toBe('reasignación');
    expect(etiquetaAsignacion('devuelta_general')).toBe('devuelto a general');
    expect(etiquetaAsignacion('desconocido')).toBe('desconocido');
  });
});
```

- [ ] **Step 2: Correr → FAIL** (`npm --prefix frontend test`).

- [ ] **Step 3: `etiquetaAsignacion` en `frontend/src/utils/formato.js`**

```js
export function etiquetaAsignacion(tipo) {
  return {
    auto_continuidad: 'continuidad',
    auto_regla: 'regla',
    auto_rotacion: 'rotación',
    toma_manual: 'toma manual',
    reasignacion: 'reasignación',
    devuelta_general: 'devuelto a general',
    escalado_bot: 'escalado',
  }[tipo] || tipo;
}
```

- [ ] **Step 4: Correr → PASS.**

- [ ] **Step 5: Store `cargarAsignaciones` en `frontend/src/stores/acciones.js`**

Añadir a `state` `asignaciones: []` y `asignacionesConvId: null`, y la acción (mismo patrón anti-carrera que `cargarNotas`):

```js
    async cargarAsignaciones(convId) {
      this.asignacionesConvId = convId;
      try {
        const r = await apiFetch(`/conversaciones/${convId}/asignaciones`);
        if (this.asignacionesConvId === convId) this.asignaciones = r.asignaciones;
      } catch {
        if (this.asignacionesConvId === convId) this.asignaciones = [];
      }
    },
```

- [ ] **Step 6: `PanelCliente.vue` — sección "Historial de asignaciones"**

En `<script setup>` importar `horaCorta` y `etiquetaAsignacion` de `../utils/formato` (ya se importa `iniciales`; añade estos), y cargar al cambiar de chat (junto al `cargarNotas`):

```js
watch(() => c.value?.id, (id) => { if (id) { acc.cargarNotas(id); acc.cargarAsignaciones(id); } }, { immediate: true });
```

En el template, antes o después de "Notas internas", añadir:

```vue
    <div v-if="acc.asignaciones.length" class="mt-3">
      <div class="text-[11px] text-gray-400 uppercase mb-1">Historial de asignaciones</div>
      <div v-for="a in acc.asignaciones" :key="a.id" class="text-[12px] text-gray-600 border-l-2 border-gray-200 pl-2 mb-1.5">
        <div>
          <b>{{ a.de || 'General' }}</b> → <b>{{ a.a || 'General' }}</b>
          <span class="text-gray-400">· {{ etiquetaAsignacion(a.tipo) }}</span>
        </div>
        <div class="text-[11px] text-gray-400">
          {{ horaCorta(a.creadoEn) }}<span v-if="a.ejecutadoPor"> · por {{ a.ejecutadoPor }}</span><span v-if="a.motivo"> · {{ a.motivo }}</span>
        </div>
      </div>
    </div>
```

(Si `watch`/`horaCorta` ya están importados, no los dupliques.)

- [ ] **Step 7: `BurbujaMensaje.vue` — etiqueta del autor en salientes**

En el template, dentro de la burbuja saliente, antes del texto/media, mostrar el autor cuando exista:

```vue
      <div v-if="saliente && mensaje.enviadoPor" class="text-[10px] text-gray-500 font-medium mb-0.5">{{ mensaje.enviadoPor.nombre }}</div>
```

(Colocarlo al inicio del contenido de la burbuja; los entrantes y los salientes sin `enviadoPor` no lo muestran.)

- [ ] **Step 8: Verificar suite y build**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: verde y build OK.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/utils/formato.js frontend/src/utils/formato.test.js frontend/src/stores/acciones.js frontend/src/components/PanelCliente.vue frontend/src/components/BurbujaMensaje.vue
git commit -m "feat(frontend): historial de asignaciones en el panel + autor del mensaje en la burbuja"
```

---

### Task 3: Despliegue + prueba real

- [ ] **Step 1: Deploy.** Merge a `main`, push. En el servidor: `git pull`, `npm --prefix frontend run build`, `pm2 restart wa-backend`. `/health` 200; `GET /api/conversaciones/1/asignaciones` sin token → 401.
- [ ] **Step 2: Prueba real.** (a) En un chat que haya cambiado de agente (tomado/reasignado), abrir el panel → ver el "Historial de asignaciones" con de→a, tipo, quién y cuándo; (b) enviar un mensaje → la burbuja saliente muestra tu nombre; (c) hacer que otro agente/tú desde otra sesión reasigne y envíe → cada saliente muestra su autor; (d) los mensajes históricos (backfill) salientes NO muestran autor.

---

## Notas de cobertura (Plan 16)

Cubre: historial de asignaciones (de→a, quién, cuándo, motivo, tipo) con permiso, y el autor por mensaje saliente (join + adjunto en envíos, etiqueta en la burbuja). **Fuera de alcance:** exportar auditoría, filtros por rango de fechas, autor de mensajes entrantes (no aplica). Los handlers con DB se validan en la prueba real; el helper de etiquetas va con test.
