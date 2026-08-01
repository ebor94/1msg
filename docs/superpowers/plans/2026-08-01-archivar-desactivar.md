# Archivar chats y desactivar contactos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un administrador pueda **archivar** una conversación y **desactivar** un contacto (ocultarlos de la bandeja, reversible), con reaparición automática al llegar un mensaje entrante y bloqueo del envío saliente a contactos desactivados.

**Architecture:** Dos banderas de fecha con marca de autor (`archivada_en`/`archivada_por` en `wa_conversaciones`, `desactivado_en`/`desactivado_por` en `wa_contactos`). La visibilidad se filtra en `construirFiltro`/`contarBandejas` + el include de contacto; un modo `ocultos` (admin, bandeja Todos) invierte la regla. La ingesta limpia las banderas en mensajes entrantes. El envío se bloquea si el contacto está desactivado. Endpoints admin para archivar/desarchivar/desactivar/reactivar; UI en `PanelCliente` + toggle "Ver ocultos".

**Tech Stack:** Node.js CommonJS, Express, Sequelize (MySQL 8), `node --test`; Vue 3 `<script setup>` + Pinia + Tailwind, Vitest.

## Global Constraints

- Solo tablas con prefijo `wa_`. Sequelize `underscored: true`; timestamps manuales.
- "Ocultar, no borrar": nada se elimina; se marca con fecha; reversible. Reaparición automática **solo** con mensajes **entrantes**.
- Acciones de archivar/desactivar/reactivar/desarchivar: **solo administradores** (`requireAdmin`).
- Envío a contacto desactivado → **409** `{ codigo: 'contacto_desactivado' }`, sin enviar. Archivar un chat NO bloquea el envío.
- Regla de visibilidad normal: conversación visible sii `archivada_en IS NULL` Y contacto `desactivado_en IS NULL`. Los badges de conteo NO cuentan ocultos.
- `logger` (nunca `console.log`); dominio en español, técnico en inglés.
- Backend test: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
- Frontend: `npm --prefix frontend test` y `npm --prefix frontend run build`.
- Despliegue reinicia **`wa-backend` y `wa-worker`** (cambia la ingesta).

## File Structure

- Create `docs/migraciones/005-archivar-desactivar.sql`.
- Modify `src/models/Conversacion.js`, `src/models/Contacto.js` — campos nuevos.
- Modify `src/services/conversaciones.js` — `construirFiltro` (archivada + ocultos), `listar` (include contacto + ocultos), `contarBandejas` (excluir ocultos).
- Modify `src/services/ingesta.js` — limpiar banderas en entrantes.
- Modify `src/services/envio.js` — helper `contactoActivo`.
- Modify `src/controllers/conversacionesController.js` — guard de envío (×3), handlers `archivar`/`desarchivar`, pasar `ocultos` a `listar`, `desactivadoEn` en includes de envío.
- Modify `src/controllers/contactosController.js` — handlers `desactivar`/`reactivar`, excluir desactivados del buscador.
- Modify `src/routes/api.js` — 4 rutas admin.
- Modify `frontend/src/stores/acciones.js`, `frontend/src/components/PanelCliente.vue`, `frontend/src/components/ListaConversaciones.vue`, `frontend/src/stores/conversaciones.js`, `frontend/src/components/Compositor.vue`.
- Tests: `test/conversaciones-filtro.test.js` (extender), `test/envio-servicio.test.js` (extender).

---

## Task 1: Migración 005 + campos en los modelos

**Files:**
- Create: `docs/migraciones/005-archivar-desactivar.sql`
- Modify: `src/models/Conversacion.js`
- Modify: `src/models/Contacto.js`

**Interfaces:**
- Produces: `Conversacion.archivadaEn` (DATE, null), `Conversacion.archivadaPor` (INT, null); `Contacto.desactivadoEn` (DATE, null), `Contacto.desactivadoPor` (INT, null).

- [ ] **Step 1: Create the migration**

Create `docs/migraciones/005-archivar-desactivar.sql`:

```sql
-- 005 — Archivar conversaciones y desactivar contactos (ocultar, reversible).
ALTER TABLE wa_conversaciones
  ADD COLUMN archivada_en  DATETIME     NULL AFTER estado,
  ADD COLUMN archivada_por INT UNSIGNED NULL AFTER archivada_en;

ALTER TABLE wa_contactos
  ADD COLUMN desactivado_en  DATETIME     NULL AFTER bloqueado,
  ADD COLUMN desactivado_por INT UNSIGNED NULL AFTER desactivado_en;
```

- [ ] **Step 2: Add fields to the Conversacion model**

En `src/models/Conversacion.js`, junto a los otros campos (después de `estado`), añade:

```javascript
      archivadaEn: { type: DataTypes.DATE, allowNull: true },
      archivadaPor: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
```

- [ ] **Step 3: Add fields to the Contacto model**

En `src/models/Contacto.js`, junto a `bloqueado`, añade:

```javascript
      desactivadoEn: { type: DataTypes.DATE, allowNull: true },
      desactivadoPor: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
```

- [ ] **Step 4: Verify models load (full suite)**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS (los modelos cargan; sin regresión).

- [ ] **Step 5: Commit**

```bash
git add docs/migraciones/005-archivar-desactivar.sql src/models/Conversacion.js src/models/Contacto.js
git commit -m "feat(bandeja): campos archivada/desactivado en modelos + migración 005"
```

---

## Task 2: Visibilidad — filtro, modo "ocultos", conteos y buscador

**Files:**
- Modify: `src/services/conversaciones.js`
- Modify: `src/controllers/conversacionesController.js` (pasar `ocultos` a `listar`)
- Modify: `src/controllers/contactosController.js` (excluir desactivados del buscador)
- Test: `test/conversaciones-filtro.test.js`

**Interfaces:**
- Consumes: `Op`, `ROL_AGENTE` (ya en el archivo).
- Produces:
  - `construirFiltro({ bandeja, agenteSolicitante, agenteFiltro, ocultos })` — normal añade `archivadaEn: null`; `ocultos:true` (solo con `bandeja:'todos'`) pone `where[Op.or] = [{archivadaEn:{[Op.ne]:null}}, {'$contacto.desactivado_en$':{[Op.ne]:null}}]`.
  - `listar({..., ocultos})` — include de `Contacto` con `where:{desactivadoEn:null}` en modo normal; sin ese `where` en modo `ocultos`. Devuelve `archivadaEn` de la conversación y `desactivadoEn` del contacto.

- [ ] **Step 1: Write the failing tests**

Añade a `test/conversaciones-filtro.test.js`:

```javascript
const { Op } = require('sequelize');

test('mías normal excluye archivadas (archivadaEn: null)', () => {
  const w = construirFiltro({ bandeja: 'mias', agenteSolicitante: asesor });
  assert.equal(w.archivadaEn, null);
});
test('todos con ocultos (admin) → OR de archivada / contacto desactivado', () => {
  const w = construirFiltro({ bandeja: 'todos', agenteSolicitante: admin, ocultos: true });
  assert.ok(Array.isArray(w[Op.or]), 'debe existir un Op.or con las dos condiciones');
  assert.equal(w[Op.or].length, 2);
  assert.equal(w.archivadaEn, undefined, 'en ocultos no se fuerza archivadaEn: null');
});
test('ocultos ignorado fuera de todos → sigue excluyendo archivadas', () => {
  const w = construirFiltro({ bandeja: 'mias', agenteSolicitante: asesor, ocultos: true });
  assert.equal(w.archivadaEn, null);
});
test('todos con ocultos como asesor → 403', () => {
  assert.throws(() => construirFiltro({ bandeja: 'todos', agenteSolicitante: asesor, ocultos: true }), (e) => e.status === 403);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/conversaciones-filtro.test.js`
Expected: FAIL (archivadaEn no existe aún en el where).

- [ ] **Step 3: Update `construirFiltro`**

En `src/services/conversaciones.js`, reemplaza la firma y el final de `construirFiltro`:

```javascript
function construirFiltro({ bandeja = 'mias', agenteSolicitante, agenteFiltro = null, ocultos = false }) {
  const where = {};
  if (bandeja === 'general') {
    where.agenteId = null;
    where.estado = { [Op.in]: ABIERTAS };
  } else if (bandeja === 'todos') {
    if (agenteSolicitante.rol !== ROL_AGENTE.ADMINISTRADOR) {
      const e = new Error('solo administradores pueden ver todos');
      e.status = 403;
      throw e;
    }
    if (agenteFiltro) where.agenteId = agenteFiltro;
  } else if (bandeja === 'resueltos') {
    where.agenteId = agenteSolicitante.id;
    where.estado = ESTADO_CONVERSACION.CERRADA;
  } else {
    where.agenteId = agenteSolicitante.id;
    where.estado = { [Op.in]: ABIERTAS };
  }
  // Visibilidad: normal excluye archivadas; modo "ocultos" (solo Todos, admin) invierte.
  if (ocultos && bandeja === 'todos') {
    where[Op.or] = [
      { archivadaEn: { [Op.ne]: null } },
      { '$contacto.desactivado_en$': { [Op.ne]: null } },
    ];
  } else {
    where.archivadaEn = null;
  }
  return where;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/conversaciones-filtro.test.js`
Expected: PASS.

- [ ] **Step 5: Update `listar` (include de contacto + ocultos + atributos)**

En `src/services/conversaciones.js`, en `listar`, cambia la firma para aceptar `ocultos` y el `contacto` include:

```javascript
async function listar({ bandeja = 'mias', agenteSolicitante, agenteFiltro = null, q = null, soloNoLeidos = false, ocultos = false, pagina = 0, tam = 25 }) {
  const where = construirFiltro({ bandeja, agenteSolicitante, agenteFiltro, ocultos });
  if (soloNoLeidos) where.noLeidos = { [Op.gt]: 0 };
  const orden = bandeja === 'general' ? [['ultimoMensajeEn', 'ASC']] : [['ultimoMensajeEn', 'DESC']];
  const contacto = {
    model: Contacto,
    as: 'contacto',
    required: true,
    attributes: ['id', 'waId', 'telefono', 'nombreWa', 'nombreDisplay', 'desactivadoEn'],
  };
  // En modo normal se excluyen los contactos desactivados; en "ocultos" se incluyen
  // (la condición de desactivado ya va en el Op.or del where).
  if (!ocultos) contacto.where = { desactivadoEn: null };
  if (q) {
    contacto.where = {
      ...(contacto.where || {}),
      [Op.or]: [
        { nombreDisplay: { [Op.like]: `%${q}%` } },
        { nombreWa: { [Op.like]: `%${q}%` } },
        { telefono: { [Op.like]: `%${q}%` } },
      ],
    };
  }
  const { rows, count } = await Conversacion.findAndCountAll({ where, include: [contacto], order: orden, limit: tam, offset: pagina * tam });
  return { total: count, pagina, conversaciones: rows };
}
```

(La conversación ya incluye `archivadaEn` por defecto al no restringir `attributes`.)

- [ ] **Step 6: Update `contarBandejas` (excluir ocultos de los conteos)**

En `contarBandejas`, cada `count` debe excluir archivadas (ya lo hace `construirFiltro` normal) y contactos desactivados (vía include). Cambia la función `cuenta` y el where de "todos":

```javascript
  const whereDe = (b) => {
    if (b !== 'todos') return construirFiltro({ bandeja: b, agenteSolicitante });
    const w = { estado: { [Op.in]: ABIERTAS }, archivadaEn: null };
    if (agenteFiltro) w.agenteId = agenteFiltro;
    return w;
  };
  const contactoActivo = { model: Contacto, as: 'contacto', required: true, where: { desactivadoEn: null }, attributes: [] };
  const cuenta = (where) => Conversacion.count({ where, include: [contactoActivo] });
```

(Requiere que `Contacto` esté importado en el archivo — ya lo está.)

- [ ] **Step 7: Controller passes `ocultos`; buscador excluye desactivados**

En `src/controllers/conversacionesController.js`, en `listarHandler`, lee `ocultos` del query y pásalo a `listar`:

```javascript
    const ocultos = req.query.ocultos === '1' || req.query.ocultos === 'true';
```
y añade `ocultos` al objeto que se pasa a `listar(...)`.

En `src/controllers/contactosController.js`, en `buscar`, añade al `where` de la consulta de contactos `desactivadoEn: null` (usa `Op` si el where ya lo usa, o `{ [Op.is]: null }`). Si el buscador usa SQL crudo, añade `AND desactivado_en IS NULL`.

- [ ] **Step 8: Full suite green**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/services/conversaciones.js src/controllers/conversacionesController.js src/controllers/contactosController.js test/conversaciones-filtro.test.js
git commit -m "feat(bandeja): visibilidad archivada/desactivado + modo ver ocultos"
```

---

## Task 3: Reaparición automática en la ingesta

**Files:**
- Modify: `src/services/ingesta.js`

**Interfaces:**
- Consumes: `DIRECCION` (ya importado; se usa en el archivo).
- Produces: al procesar un mensaje **entrante**, limpia `desactivado_en`/`desactivado_por` del contacto y `archivada_en`/`archivada_por` de la conversación (misma transacción).

- [ ] **Step 1: Limpiar el contacto en `resolverContacto`**

En `src/services/ingesta.js`, dentro de `resolverContacto`, tras las líneas que actualizan `nombreWa`/`bsuid` (antes del `if (!creado && cambio) await contacto.save(...)`), añade:

```javascript
  // Un mensaje ENTRANTE reactiva un contacto desactivado (reaparece en la bandeja).
  if (norm.direccion === DIRECCION.IN && contacto.desactivadoEn) {
    contacto.desactivadoEn = null;
    contacto.desactivadoPor = null;
    cambio = true;
  }
```

- [ ] **Step 2: Limpiar la conversación en `actualizarDesnormalizados`**

En `actualizarDesnormalizados`, dentro del bloque `if (norm.direccion === DIRECCION.IN) { ... }` (donde ya se ajusta `noLeidos`/`ventanaExpiraEn`), añade la limpieza del archivado. Como esa función recibe `conv`, agrega:

```javascript
  if (norm.direccion === DIRECCION.IN) {
    cambios.noLeidos = (conv.noLeidos || 0) + 1;
    cambios.ventanaExpiraEn = new Date(ts.getTime() + VENTANA_24H_MS);
    if (conv.archivadaEn) { cambios.archivadaEn = null; cambios.archivadaPor = null; } // reaparece
  }
```

- [ ] **Step 3: Full suite green**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS (sin regresión en la ingesta).

- [ ] **Step 4: Commit**

```bash
git add src/services/ingesta.js
git commit -m "feat(bandeja): reaparición automática de archivados/desactivados con mensaje entrante"
```

---

## Task 4: Bloquear envío a contacto desactivado

**Files:**
- Modify: `src/services/envio.js`
- Modify: `src/controllers/conversacionesController.js`
- Test: `test/envio-servicio.test.js`

**Interfaces:**
- Produces: `contactoActivo(contacto) -> boolean` (`false` si `desactivadoEn` no nulo).

- [ ] **Step 1: Write the failing test**

Añade a `test/envio-servicio.test.js`:

```javascript
const { contactoActivo } = require('../src/services/envio');

test('contactoActivo: false si desactivadoEn tiene fecha, true si null', () => {
  assert.equal(contactoActivo({ desactivadoEn: new Date() }), false);
  assert.equal(contactoActivo({ desactivadoEn: null }), true);
  assert.equal(contactoActivo({}), true);
  assert.equal(contactoActivo(null), true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/envio-servicio.test.js`
Expected: FAIL con "contactoActivo is not a function".

- [ ] **Step 3: Implement the helper**

En `src/services/envio.js`, añade y expórtala:

```javascript
/** Un contacto desactivado no puede recibir mensajes salientes. */
function contactoActivo(contacto) {
  return !(contacto && contacto.desactivadoEn);
}
```
Añade `contactoActivo` a `module.exports`.

- [ ] **Step 4: Run to verify it passes**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/envio-servicio.test.js`
Expected: PASS.

- [ ] **Step 5: Guard en los 3 handlers de envío**

En `src/controllers/conversacionesController.js`:

1. Importa el helper: en el require de `../services/envio`, añade `contactoActivo`:
```javascript
const { ventanaAbierta, destinatario1msg, contactoActivo } = require('../services/envio');
```
2. En `enviar`, `enviarMedia` y `enviarPlantilla`, cada uno carga la conversación con `include: [{ model: Contacto, as: 'contacto', attributes: [...] }]`. Añade `'desactivadoEn'` a esas tres listas de `attributes`. Y justo después de obtener `conv.contacto` (y antes de construir el destinatario / enviar), añade:
```javascript
    if (!contactoActivo(conv.contacto)) {
      return res.status(409).json({ error: 'el contacto está desactivado', codigo: 'contacto_desactivado' });
    }
```

- [ ] **Step 6: Full suite green**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/envio.js src/controllers/conversacionesController.js test/envio-servicio.test.js
git commit -m "feat(bandeja): bloquear envío a contacto desactivado (409)"
```

---

## Task 5: Endpoints admin (archivar/desarchivar/desactivar/reactivar)

**Files:**
- Modify: `src/controllers/conversacionesController.js`
- Modify: `src/controllers/contactosController.js`
- Modify: `src/routes/api.js`

**Interfaces:**
- Consumes: `accesible`/`Conversacion`/`Contacto`, `requireAdmin` (ya importado en rutas).
- Produces (todos `{ ok: true }`):
  - `POST /conversaciones/:id/archivar` / `/desarchivar`
  - `POST /contactos/:id/desactivar` / `/reactivar`

- [ ] **Step 1: Handlers de conversación**

En `src/controllers/conversacionesController.js`, añade (mismo estilo que `resolver`):

```javascript
async function archivar(req, res) {
  try {
    const n = await Conversacion.update(
      { archivadaEn: new Date(), archivadaPor: req.agente.id },
      { where: { id: req.params.id } },
    );
    if (!n[0]) return res.status(404).json({ error: 'no encontrada' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error(`archivar conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function desarchivar(req, res) {
  try {
    await Conversacion.update({ archivadaEn: null, archivadaPor: null }, { where: { id: req.params.id } });
    return res.json({ ok: true });
  } catch (err) {
    logger.error(`desarchivar conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```
Añádelos a `module.exports`.

- [ ] **Step 2: Handlers de contacto**

En `src/controllers/contactosController.js`, añade:

```javascript
async function desactivar(req, res) {
  try {
    const n = await Contacto.update(
      { desactivadoEn: new Date(), desactivadoPor: req.agente.id },
      { where: { id: req.params.id } },
    );
    if (!n[0]) return res.status(404).json({ error: 'no encontrado' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error(`desactivar contacto ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function reactivar(req, res) {
  try {
    await Contacto.update({ desactivadoEn: null, desactivadoPor: null }, { where: { id: req.params.id } });
    return res.json({ ok: true });
  } catch (err) {
    logger.error(`reactivar contacto ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```
Añádelos a `module.exports` (verifica que `Contacto` y `logger` estén importados; si no, agrégalos).

- [ ] **Step 3: Rutas admin**

En `src/routes/api.js`:

```javascript
router.post('/conversaciones/:id/archivar', requireAuth, requireAdmin, convCtrl.archivar);
router.post('/conversaciones/:id/desarchivar', requireAuth, requireAdmin, convCtrl.desarchivar);
router.post('/contactos/:id/desactivar', requireAuth, requireAdmin, contactosCtrl.desactivar);
router.post('/contactos/:id/reactivar', requireAuth, requireAdmin, contactosCtrl.reactivar);
```

- [ ] **Step 4: Full suite green**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Manual verification (backend con BD migrada)**

```bash
curl -s -X POST localhost:3000/api/conversaciones/123/archivar -H "Authorization: Bearer $TOK_ADMIN"   # {ok:true}; sale de las bandejas
curl -s -X POST localhost:3000/api/contactos/45/desactivar -H "Authorization: Bearer $TOK_ADMIN"        # oculta sus chats
curl -s -X POST localhost:3000/api/conversaciones/123/archivar -H "Authorization: Bearer $TOK_ASESOR"   # 403
```

- [ ] **Step 6: Commit**

```bash
git add src/controllers/conversacionesController.js src/controllers/contactosController.js src/routes/api.js
git commit -m "feat(bandeja): endpoints admin archivar/desarchivar/desactivar/reactivar"
```

---

## Task 6: Frontend — acciones admin, "Ver ocultos" y aviso de envío

**Files:**
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/components/PanelCliente.vue`
- Modify: `frontend/src/stores/conversaciones.js`
- Modify: `frontend/src/components/ListaConversaciones.vue`
- Modify: `frontend/src/components/Compositor.vue`

**Interfaces:**
- Consumes: endpoints de la Task 5; `apiFetch`.
- Produces: acciones de store; botones admin en `PanelCliente`; toggle "Ver ocultos" en la bandeja Todos; aviso `contacto_desactivado` en el compositor.

- [ ] **Step 1: Store actions**

En `frontend/src/stores/acciones.js` (junto a `resolver`):

```javascript
    async archivarConversacion(convId, archivar = true) {
      await apiFetch(`/conversaciones/${convId}/${archivar ? 'archivar' : 'desarchivar'}`, { method: 'POST' });
      const conv = useConversaciones();
      const i = conv.items.findIndex((c) => c.id === convId);
      if (i !== -1) conv.items.splice(i, 1);
      const chat = useChat();
      if (chat.conversacion?.id === convId) chat.cerrar();
      conv.cargarContadores();
    },
    async desactivarContacto(contactoId, convId, desactivar = true) {
      await apiFetch(`/contactos/${contactoId}/${desactivar ? 'desactivar' : 'reactivar'}`, { method: 'POST' });
      const conv = useConversaciones();
      if (convId) { const i = conv.items.findIndex((c) => c.id === convId); if (i !== -1) conv.items.splice(i, 1); }
      const chat = useChat();
      if (chat.conversacion?.id === convId) chat.cerrar();
      conv.cargarContadores();
    },
```

- [ ] **Step 2: Botones admin en `PanelCliente.vue`**

En `<script setup>` (ya hay `auth`, `acc`, `c`), añade helpers:

```javascript
const esAdmin = computed(() => auth.esAdministrador);
async function archivar() { if (confirm('¿Archivar este chat? Saldrá de la bandeja y volverá si el cliente escribe.')) { try { await acc.archivarConversacion(c.value.id, !c.value.archivadaEn); } catch { aviso.value = 'No se pudo archivar.'; } } }
async function desactivar() { if (confirm('¿Desactivar este contacto? Se ocultarán sus chats y no podrás escribirle.')) { try { await acc.desactivarContacto(c.value.contacto.id, c.value.id, !c.value.contacto?.desactivadoEn); } catch { aviso.value = 'No se pudo desactivar.'; } } }
```

En el `<template>`, dentro de un bloque solo-admin (al final del panel):

```html
    <div v-if="esAdmin" class="mt-4 border-t border-gray-100 pt-3 flex flex-col gap-2">
      <button @click="archivar" class="w-full border border-gray-300 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">
        {{ c.archivadaEn ? 'Desarchivar chat' : '🗄️ Archivar chat' }}
      </button>
      <button @click="desactivar" class="w-full border border-red-200 text-red-600 rounded-lg py-2 text-sm hover:bg-red-50">
        {{ c.contacto?.desactivadoEn ? 'Reactivar contacto' : '🚫 Desactivar contacto' }}
      </button>
    </div>
```

- [ ] **Step 3: Toggle "Ver ocultos" en la bandeja Todos**

En `frontend/src/stores/conversaciones.js`, añade estado `ocultos: false` y que `cargar`/`cargarMas` incluyan `ocultos=1` en la query cuando `this.ocultos && this.bandeja === 'todos'`. (Localiza dónde se arma el querystring de `/conversaciones` y añade el parámetro condicional.)

En `frontend/src/components/ListaConversaciones.vue`, junto al selector de bandeja "Todos" (solo admin), añade un toggle:

```html
<label v-if="auth.esAdministrador && conv.bandeja === 'todos'" class="flex items-center gap-1 text-[11px] text-gray-500 px-2">
  <input type="checkbox" :checked="conv.ocultos" @change="conv.ocultos = $event.target.checked; conv.cargar('todos')" /> Ver ocultos
</label>
```

(Usa el store `conv`/`auth` ya presentes en el componente.)

- [ ] **Step 4: Aviso de envío en `Compositor.vue`**

Donde el compositor maneja el error de envío (catch del `enviar`), añade el caso:

```javascript
      if (e.codigo === 'contacto_desactivado') { /* muestra en el aviso existente */ this.errorEnvio = 'El contacto está desactivado; reactívalo para escribirle.'; }
```
(Adapta a la variable de error real que use el compositor — sigue el patrón de los otros `e.codigo`.)

- [ ] **Step 5: Build + tests**

Run: `npm --prefix frontend run build && npm --prefix frontend test`
Expected: build sin errores; 19/19 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stores/acciones.js frontend/src/components/PanelCliente.vue frontend/src/stores/conversaciones.js frontend/src/components/ListaConversaciones.vue frontend/src/components/Compositor.vue
git commit -m "feat(bandeja): UI de archivar/desactivar + ver ocultos + aviso de envío"
```

---

## Deploy (tras aprobar e implementar)

1. `ssh mantix "mysql serfuweb < ~/apps/wa/docs/migraciones/005-archivar-desactivar.sql"`.
2. `git pull` + `npm --prefix frontend run build`.
3. `pm2 restart wa-backend wa-worker` (la ingesta cambió).
4. Verificación en vivo: archivar un chat → sale; el cliente escribe → vuelve. Desactivar un contacto → se ocultan sus chats y el envío da aviso. "Ver ocultos" → aparecen atenuados → Reactivar/Desarchivar los restaura.

## Fuera de alcance

- Bloqueo real de reingreso (se eligió "ocultar").
- Borrado físico/purga.
- Papelera dedicada (se usa "Ver ocultos").
