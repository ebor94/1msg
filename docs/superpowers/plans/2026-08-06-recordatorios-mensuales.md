# Recordatorios mensuales por contacto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recordatorio mensual automático por contacto: un switch + día (1–30) en el panel del contacto, y un barrido diario en el worker que envía una plantilla fija (mensaje + imagen globales) a los contactos cuyo día es hoy, una vez por mes, en la bandeja (resueltos).

**Architecture:** Reutiliza la maquinaria de difusiones. Se extrae el "persistir envío de plantilla en la bandeja" a un helper compartido (`persistirEnvioPlantilla`) que usan difusiones y recordatorios. El contenido (plantilla + texto `{{1}}` + URL de imagen) es un ajuste global en `wa_ajustes`. El worker barre a diario dentro de la ventana horaria con ritmo suave.

**Tech Stack:** Node 20 CommonJS, Express, Sequelize, MySQL 8, 1msg (`enviarPlantilla`). Frontend Vue 3 + Pinia. Tests: `node:test` (backend), Vitest (frontend).

## Global Constraints

- Solo tablas `wa_`. SQL parametrizado. Token 1msg solo en `integrations/onemsg`. Logger, nunca `console.log`, nunca tragar excepciones.
- El recordatorio es igual para todos: plantilla `texto_imagen_generico`, `{{1}}` = `recordatorio_texto` (global), imagen = `recordatorio_imagen_url` (global). Sin dato por contacto salvo el día.
- Envío como saliente automático: conversación `origen='recordatorio'`, `estado='cerrada'`, `enviado_por_id=NULL` (no cuenta en Scorecard); asignada al dueño del contacto (o al agente que configuró, si no hay dueño). Reapertura al responder la maneja la ingesta existente.
- Día > días del mes → se envía el último día del mes. Una vez por mes por contacto (`ultimo_envio_en`).
- Ventana de envío: Lun–Vie 08:00–18:59, Sáb 08:00–13:59 (hora Colombia); ritmo ~1/20 s. Se reutiliza `difusionReglas.dentroDeVentana`/`esperaEnvioMs`.
- Config por contacto la puede editar cualquier agente (`requireAuth`).
- Comando de test backend (env vars):
  `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/<archivo>`

## File Structure

- `docs/migraciones/008-recordatorios.sql` (crear) — `wa_recordatorios`, `wa_ajustes`, enum `origen`.
- `src/models/Recordatorio.js`, `src/models/Ajuste.js` (crear); `src/models/index.js` (registrar).
- `src/config/constants.js` (modificar) — `ORIGEN_CONVERSACION.RECORDATORIO`.
- `src/services/reporteAgentes.js` (modificar) — excluir `origen='recordatorio'` de "cerrados".
- `src/services/envioPlantilla.js` (crear) — `persistirEnvioPlantilla` (extraído de difusionEnvio).
- `src/services/difusionEnvio.js` (modificar) — usar el helper.
- `src/services/recordatorioReglas.js` (crear) — reglas de fecha puras.
- `src/services/recordatorios.js` (crear) — ajustes, CRUD, barrido, envío.
- `src/controllers/recordatoriosController.js` (crear) — GET/PUT por contacto.
- `src/routes/api.js` (modificar) — rutas.
- `src/workers/recordatorios.js` (crear); `src/workers/index.js` (modificar) — barrido.
- `frontend/src/stores/acciones.js` (modificar); `frontend/src/components/PanelCliente.vue` (modificar) — sección UI.
- `test/recordatorio-*.test.js`, `frontend/src/stores/acciones.recordatorio.test.js` (crear).

---

### Task 1: Migración 008 + modelos + enum origen + Scorecard

**Files:**
- Create: `docs/migraciones/008-recordatorios.sql`, `src/models/Recordatorio.js`, `src/models/Ajuste.js`
- Modify: `src/models/index.js`, `src/config/constants.js`, `docs/esquema_bandeja.sql`, `src/services/reporteAgentes.js`
- Test: `test/recordatorio-modelos.test.js`

**Interfaces:**
- Produces: modelos `Recordatorio` (`contactoId, diaMes, activo, ultimoEnvioEn, agenteId, creadoPorId`), `Ajuste` (`clave, valor`); constante `ORIGEN_CONVERSACION.RECORDATORIO = 'recordatorio'`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/recordatorio-modelos.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Recordatorio, Ajuste } = require('../src/models');
const { ORIGEN_CONVERSACION } = require('../src/config/constants');

test('Recordatorio tiene los campos clave', () => {
  for (const c of ['contactoId', 'diaMes', 'activo', 'ultimoEnvioEn', 'agenteId']) {
    assert.ok(Recordatorio.rawAttributes[c], `falta ${c}`);
  }
});
test('Ajuste tiene clave/valor', () => {
  assert.ok(Ajuste.rawAttributes.clave && Ajuste.rawAttributes.valor);
});
test('ORIGEN_CONVERSACION.RECORDATORIO existe', () => {
  assert.equal(ORIGEN_CONVERSACION.RECORDATORIO, 'recordatorio');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... node --test test/recordatorio-modelos.test.js`
Expected: FAIL (modelos/constante no existen).

- [ ] **Step 3: Write the migration**

```sql
-- docs/migraciones/008-recordatorios.sql
-- Recordatorios mensuales por contacto + ajustes globales + origen 'recordatorio'.
CREATE TABLE wa_recordatorios (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contacto_id     BIGINT UNSIGNED NOT NULL,
  dia_mes         TINYINT UNSIGNED NOT NULL,           -- 1..30
  activo          TINYINT(1)      NOT NULL DEFAULT 1,
  ultimo_envio_en DATE            NULL,                -- último envío (para no duplicar en el mes)
  agente_id       INT UNSIGNED    NULL,
  creado_por_id   INT UNSIGNED    NULL,
  creado_en       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recordatorio_contacto (contacto_id),
  KEY idx_recordatorio_barrido (activo, dia_mes),
  CONSTRAINT fk_recordatorio_contacto FOREIGN KEY (contacto_id) REFERENCES wa_contactos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE wa_ajustes (
  clave           VARCHAR(60)     NOT NULL,
  valor           TEXT            NULL,
  actualizado_en  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO wa_ajustes (clave, valor) VALUES
  ('recordatorio_plantilla', 'texto_imagen_generico'),
  ('recordatorio_texto', ''),
  ('recordatorio_imagen_url', '')
ON DUPLICATE KEY UPDATE clave = clave;

ALTER TABLE wa_conversaciones
  MODIFY COLUMN origen ENUM('entrante','saliente','difusion','ctwa','recordatorio') NOT NULL DEFAULT 'entrante';
```

- [ ] **Step 4: Write the models + constant + schema + scorecard**

`src/models/Recordatorio.js`:
```javascript
'use strict';
module.exports = (sequelize, DataTypes) =>
  sequelize.define('Recordatorio', {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    contactoId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    diaMes: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ultimoEnvioEn: { type: DataTypes.DATEONLY, allowNull: true },
    agenteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    creadoPorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  }, {
    tableName: 'wa_recordatorios', underscored: true,
    createdAt: 'creado_en', updatedAt: 'actualizado_en',
  });
```

`src/models/Ajuste.js`:
```javascript
'use strict';
module.exports = (sequelize, DataTypes) =>
  sequelize.define('Ajuste', {
    clave: { type: DataTypes.STRING(60), primaryKey: true },
    valor: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'wa_ajustes', underscored: true,
    createdAt: false, updatedAt: 'actualizado_en',
  });
```

Register both in `src/models/index.js` following the existing pattern (require + add to the exported models object, exactly like `Difusion`/`DifusionDestinatario` are registered).

In `src/config/constants.js`, add to the `ORIGEN_CONVERSACION` object: `RECORDATORIO: 'recordatorio',`.

In `docs/esquema_bandeja.sql`: add the two `CREATE TABLE` blocks (mirror the migration) and update the `origen` ENUM in the `wa_conversaciones` block to include `'recordatorio'`.

In `src/services/reporteAgentes.js`, the `cierres` query's WHERE currently has `AND origen <> 'difusion'` — change it to `AND origen NOT IN ('difusion','recordatorio')`.

- [ ] **Step 5: Run test to verify it passes**

Run: `... node --test test/recordatorio-modelos.test.js`
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add docs/migraciones/008-recordatorios.sql src/models/Recordatorio.js src/models/Ajuste.js src/models/index.js src/config/constants.js docs/esquema_bandeja.sql src/services/reporteAgentes.js test/recordatorio-modelos.test.js
git commit -m "feat(recordatorios): migración 008 + modelos + origen recordatorio"
```

---

### Task 2: Helper compartido `persistirEnvioPlantilla` + refactor difusiones

Extrae el bloque que persiste un envío saliente de plantilla en la bandeja (reusar/crear conversación, asignar dueño, mensaje `enviado_por_id=NULL`) para que difusiones y recordatorios lo compartan — sin duplicar invariantes delicadas.

**Files:**
- Create: `src/services/envioPlantilla.js`
- Modify: `src/services/difusionEnvio.js`

**Interfaces:**
- Produces: `async persistirEnvioPlantilla({ contactoId, agenteFallback, canalId, plantillaNombre, texto, waMessageId, origen }, extra?): number` — persiste y devuelve `convId`; `extra(t, convId)` (opcional) corre en la MISMA transacción para el bookkeeping del llamador.
- Consumes (difusionEnvio): el helper, en su ruta de éxito.

- [ ] **Step 1: Write the helper**

```javascript
// src/services/envioPlantilla.js
'use strict';
const { sequelize } = require('../config/database');
const { Conversacion, Mensaje, Contacto } = require('../models');
const { DIRECCION, TIPO_MENSAJE, ESTADO_MENSAJE, ESTADO_CONVERSACION } = require('../config/constants');

/**
 * Persiste un envío saliente de plantilla en la bandeja: reusa/crea la conversación
 * del contacto (cerrada, con el `origen` dado), asigna dueño si falta (sin reabrir un
 * chat abierto), y crea el mensaje saliente (enviado_por_id NULL, idempotente por
 * waMessageId). `extra(t, convId)` corre en la misma transacción para el bookkeeping
 * del llamador. Devuelve el id de la conversación.
 */
async function persistirEnvioPlantilla({ contactoId, agenteFallback, canalId, plantillaNombre, texto, waMessageId, origen }, extra) {
  const ahora = new Date();
  let convId;
  await sequelize.transaction(async (t) => {
    const contacto = await Contacto.findByPk(contactoId, { transaction: t });
    const agenteId = contacto.agenteDuenoId || agenteFallback || null;
    if (!contacto.agenteDuenoId && agenteId) await contacto.update({ agenteDuenoId: agenteId }, { transaction: t });

    let conv = await Conversacion.findOne({ where: { contactoId }, order: [['id', 'DESC']], transaction: t });
    if (!conv) {
      conv = await Conversacion.create({
        canalId, contactoId, agenteId, estado: ESTADO_CONVERSACION.CERRADA, origen, cerradaEn: ahora,
      }, { transaction: t });
    } else if (conv.estado === ESTADO_CONVERSACION.CERRADA && conv.agenteId !== agenteId) {
      await conv.update({ agenteId }, { transaction: t }); // enruta el resuelto sin reabrir
    }

    await Mensaje.findOrCreate({
      where: { waMessageId },
      defaults: {
        conversacionId: conv.id, waMessageId, direccion: DIRECCION.OUT, tipo: TIPO_MENSAJE.TEMPLATE,
        texto, plantillaNombre, estado: ESTADO_MENSAJE.ENVIADO, enviadoPorId: null, tsProveedor: ahora,
      },
      transaction: t,
    });
    await conv.update({ ultimoMensajeEn: ahora, ultimoMensajeTexto: texto.slice(0, 255), ultimoMensajeDir: DIRECCION.OUT }, { transaction: t });
    convId = conv.id;
    if (extra) await extra(t, conv.id);
  });
  return convId;
}

module.exports = { persistirEnvioPlantilla };
```

- [ ] **Step 2: Refactor difusionEnvio to use it**

In `src/services/difusionEnvio.js`, replace the success-path transaction block (everything from `const texto = renderizarCuerpo(...)` and the `await sequelize.transaction(...)` that follows, up to `return 'enviado';`) with:
```javascript
  const texto = renderizarCuerpo(def.cuerpo, dest.parametros);
  await persistirEnvioPlantilla({
    contactoId: dest.contactoId, agenteFallback: dest.agenteId, canalId: dif.canalId,
    plantillaNombre: dif.plantillaNombre, texto, waMessageId: enviado.id, origen: ORIGEN_CONVERSACION.DIFUSION,
  }, async (t) => {
    await dest.update({ estado: 'enviado', waMessageId: enviado.id, intentos: dest.intentos + 1, errorCodigo: null }, { transaction: t });
  });
  return 'enviado';
```
Add `const { persistirEnvioPlantilla } = require('./envioPlantilla');` to the imports. Remove now-unused imports from difusionEnvio: `Conversacion`, `Mensaje`, `DIRECCION`, `TIPO_MENSAJE`, `ESTADO_MENSAJE`, `ESTADO_CONVERSACION` (keep `Contacto`, `sequelize`, `ORIGEN_CONVERSACION`, `enviarPlantilla`, `construir*`/`renderizarCuerpo`, `clasificarError`, `logger` — still used by `payloadDeEnvio` and the error path). Do NOT change `payloadDeEnvio` or the error path.

- [ ] **Step 3: Run tests**

Run: `... node --test test/difusion-envio.test.js` → PASS (payloadDeEnvio 2/2, unchanged).
Run the full suite: `... node --test test/*.test.js` → PASS (was 151; difusiones behavior preserved — the persist moved to the helper, verified live at deploy).

- [ ] **Step 4: Commit**

```bash
git add src/services/envioPlantilla.js src/services/difusionEnvio.js
git commit -m "refactor(difusiones): extraer persistirEnvioPlantilla (compartido con recordatorios)"
```

---

### Task 3: Reglas de fecha (puras) + servicio de recordatorios

**Files:**
- Create: `src/services/recordatorioReglas.js`, `src/services/recordatorios.js`
- Test: `test/recordatorio-reglas.test.js`, `test/recordatorio-servicio.test.js`

**Interfaces:**
- Produces (reglas, puras):
  - `diasDelMes(anio, mes1a12): number`.
  - `esDiaDeEnvio(diaMes, diaHoy, diasEnElMes): boolean` — hoy coincide, o el día objetivo no existe este mes y hoy es el último.
- Produces (servicio):
  - `async obtenerAjustes(): { recordatorio_plantilla, recordatorio_texto, recordatorio_imagen_url }`.
  - `recordatorioConfigurado(aj): boolean` (texto y URL no vacíos).
  - `async recordatorioDeContacto(contactoId): { activo, diaMes } | null`.
  - `async guardarRecordatorio(contactoId, { activo, diaMes }, agente): { activo, diaMes }` (valida `diaMes` 1..30 → `.status=400`).
  - `async siguienteRecordatorio(hoyISO): Recordatorio | null` — el próximo enviable hoy (activo, `esDiaDeEnvio`, no enviado este mes).
  - `async enviarRecordatorio(rec, aj, hoyISO, deps={}): 'enviado'|'fallido'|'sin_plantilla'|'sin_contacto'`.

- [ ] **Step 1: Write the failing test (reglas)**

```javascript
// test/recordatorio-reglas.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diasDelMes, esDiaDeEnvio } = require('../src/services/recordatorioReglas');

test('diasDelMes', () => {
  assert.equal(diasDelMes(2026, 2), 28);
  assert.equal(diasDelMes(2024, 2), 29);
  assert.equal(diasDelMes(2026, 4), 30);
  assert.equal(diasDelMes(2026, 1), 31);
});
test('esDiaDeEnvio: coincide el día', () => {
  assert.equal(esDiaDeEnvio(5, 5, 31), true);
  assert.equal(esDiaDeEnvio(5, 6, 31), false);
});
test('esDiaDeEnvio: día 30 en febrero cae el último día', () => {
  assert.equal(esDiaDeEnvio(30, 28, 28), true);  // feb 28 = último día, objetivo 30 no existe
  assert.equal(esDiaDeEnvio(30, 27, 28), false);
  assert.equal(esDiaDeEnvio(30, 30, 31), true);  // en un mes de 31, el 30 es normal
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... node --test test/recordatorio-reglas.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Write the reglas**

```javascript
// src/services/recordatorioReglas.js
'use strict';
// Reglas PURAS de fecha para el recordatorio mensual.

/** Días del mes (mes 1..12). TZ-free vía Date.UTC. */
function diasDelMes(anio, mes1a12) {
  return new Date(Date.UTC(anio, mes1a12, 0)).getUTCDate();
}

/** ¿Hoy toca enviar? Coincide el día, o el objetivo no existe este mes y hoy es el último. */
function esDiaDeEnvio(diaMes, diaHoy, diasEnElMes) {
  if (diaHoy === diaMes) return true;
  return diaMes > diasEnElMes && diaHoy === diasEnElMes;
}

module.exports = { diasDelMes, esDiaDeEnvio };
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (3/3).

- [ ] **Step 5: Write the failing test (servicio, parte validable)**

```javascript
// test/recordatorio-servicio.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recordatorioConfigurado } = require('../src/services/recordatorios');

test('recordatorioConfigurado exige texto y URL', () => {
  assert.equal(recordatorioConfigurado({ recordatorio_texto: 'hola', recordatorio_imagen_url: 'http://x/y.png' }), true);
  assert.equal(recordatorioConfigurado({ recordatorio_texto: '', recordatorio_imagen_url: 'http://x/y.png' }), false);
  assert.equal(recordatorioConfigurado({ recordatorio_texto: 'hola', recordatorio_imagen_url: '' }), false);
  assert.equal(recordatorioConfigurado({}), false);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `... node --test test/recordatorio-servicio.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 7: Write the servicio**

```javascript
// src/services/recordatorios.js
'use strict';
const { Recordatorio, Ajuste, Contacto, Canal } = require('../models');
const { enviarPlantilla } = require('../integrations/onemsg/plantillas');
const { construirParams, construirParamsHeader, renderizarCuerpo } = require('./plantillas');
const { obtenerCatalogo } = require('../controllers/plantillasController');
const { persistirEnvioPlantilla } = require('./envioPlantilla');
const { esDiaDeEnvio, diasDelMes } = require('./recordatorioReglas');
const { ORIGEN_CONVERSACION } = require('../config/constants');
const env = require('../config/env');
const logger = require('../utils/logger');

const CLAVES = ['recordatorio_plantilla', 'recordatorio_texto', 'recordatorio_imagen_url'];

function err(status, msg) { const e = new Error(msg); e.status = status; return e; }

async function obtenerAjustes() {
  const filas = await Ajuste.findAll({ where: { clave: CLAVES } });
  const m = {};
  filas.forEach((f) => { m[f.clave] = f.valor; });
  return m;
}

/** Pura: hay contenido para enviar (texto y URL no vacíos). */
function recordatorioConfigurado(aj) {
  return !!(aj && String(aj.recordatorio_texto || '').trim() && String(aj.recordatorio_imagen_url || '').trim());
}

async function recordatorioDeContacto(contactoId) {
  const r = await Recordatorio.findOne({ where: { contactoId } });
  return r ? { activo: !!r.activo, diaMes: r.diaMes } : null;
}

async function guardarRecordatorio(contactoId, { activo, diaMes }, agente) {
  const dia = Number(diaMes);
  if (activo && (!Number.isInteger(dia) || dia < 1 || dia > 30)) throw err(400, 'día inválido (1-30)');
  const [r] = await Recordatorio.findOrCreate({
    where: { contactoId },
    defaults: { contactoId, diaMes: Number.isInteger(dia) ? dia : 1, activo: !!activo, agenteId: agente ? agente.id : null, creadoPorId: agente ? agente.id : null },
  });
  await r.update({ activo: !!activo, diaMes: Number.isInteger(dia) ? dia : r.diaMes, agenteId: r.agenteId || (agente ? agente.id : null) });
  return { activo: !!r.activo, diaMes: r.diaMes };
}

/** El próximo recordatorio enviable hoy (activo, toca hoy, no enviado este mes). */
async function siguienteRecordatorio(hoyISO) {
  const anio = +hoyISO.slice(0, 4), mes = +hoyISO.slice(5, 7), dia = +hoyISO.slice(8, 10);
  const dim = diasDelMes(anio, mes);
  const inicioMes = `${hoyISO.slice(0, 7)}-01`;
  const activos = await Recordatorio.findAll({ where: { activo: true }, order: [['id', 'ASC']] });
  return activos.find((r) => esDiaDeEnvio(r.diaMes, dia, dim) && (!r.ultimoEnvioEn || String(r.ultimoEnvioEn) < inicioMes)) || null;
}

/** Envía un recordatorio y lo persiste; marca ultimo_envio_en = hoy en la misma transacción. */
async function enviarRecordatorio(rec, aj, hoyISO, deps = {}) {
  const enviar = deps.enviarPlantilla || enviarPlantilla;
  const def = (await obtenerCatalogo()).find((p) => p.name === aj.recordatorio_plantilla);
  if (!def) { logger.error(`recordatorio: plantilla ${aj.recordatorio_plantilla} no está en el catálogo`); return 'sin_plantilla'; }
  const contacto = await Contacto.findByPk(rec.contactoId);
  if (!contacto) return 'sin_contacto';
  const canal = await Canal.findOne({ where: { instanceId: env.onemsg.instanceId } });

  const params = [
    ...construirParamsHeader(aj.recordatorio_imagen_url || def.imagenDefault),
    ...construirParams([aj.recordatorio_texto]),
  ];
  let enviado;
  try {
    enviado = await enviar({
      phone: contacto.telefono, template: def.name,
      language: { code: def.language || 'es', policy: 'deterministic' },
      namespace: def.namespace || null, params,
    });
  } catch (err2) {
    logger.warn(`recordatorio contacto ${rec.contactoId}: fallo [${err2.codigo || ''}] ${err2.message}`);
    return 'fallido';
  }

  const texto = renderizarCuerpo(def.cuerpo, [aj.recordatorio_texto]);
  await persistirEnvioPlantilla({
    contactoId: rec.contactoId, agenteFallback: rec.agenteId, canalId: canal ? canal.id : null,
    plantillaNombre: def.name, texto, waMessageId: enviado.id, origen: ORIGEN_CONVERSACION.RECORDATORIO,
  }, async (t) => { await rec.update({ ultimoEnvioEn: hoyISO }, { transaction: t }); });
  return 'enviado';
}

module.exports = { obtenerAjustes, recordatorioConfigurado, recordatorioDeContacto, guardarRecordatorio, siguienteRecordatorio, enviarRecordatorio };
```

- [ ] **Step 8: Run tests**

Run: `... node --test test/recordatorio-reglas.test.js test/recordatorio-servicio.test.js`
Expected: PASS (reglas 3/3 + servicio 1/1). Las funciones con BD/1msg se verifican en vivo.

- [ ] **Step 9: Commit**

```bash
git add src/services/recordatorioReglas.js src/services/recordatorios.js test/recordatorio-reglas.test.js test/recordatorio-servicio.test.js
git commit -m "feat(recordatorios): reglas de fecha + servicio (ajustes, CRUD, envío)"
```

---

### Task 4: Endpoints por contacto (GET/PUT)

**Files:**
- Create: `src/controllers/recordatoriosController.js`
- Modify: `src/routes/api.js`
- Test: `test/recordatorios-controller.test.js`

**Interfaces:**
- Consumes: `recordatorioDeContacto`, `guardarRecordatorio` del servicio.
- Produces: handlers `obtener(req,res)`, `guardar(req,res)`; `_setServicio(stub)` para test sin BD.

- [ ] **Step 1: Write the failing test**

```javascript
// test/recordatorios-controller.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ctrl = require('../src/controllers/recordatoriosController');

function resMock() {
  return { _s: 200, _j: null, status(c) { this._s = c; return this; }, json(o) { this._j = o; return this; } };
}

test('obtener responde el recordatorio', async () => {
  ctrl._setServicio({ recordatorioDeContacto: async () => ({ activo: true, diaMes: 5 }) });
  const res = resMock();
  await ctrl.obtener({ params: { id: '9' } }, res);
  assert.equal(res._j.recordatorio.diaMes, 5);
});
test('guardar traduce .status=400', async () => {
  ctrl._setServicio({ guardarRecordatorio: async () => { const e = new Error('día inválido'); e.status = 400; throw e; } });
  const res = resMock();
  await ctrl.guardar({ params: { id: '9' }, body: { activo: true, diaMes: 99 }, agente: { id: 1 } }, res);
  assert.equal(res._s, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... node --test test/recordatorios-controller.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Write the controller**

```javascript
// src/controllers/recordatoriosController.js
'use strict';
const logger = require('../utils/logger');
const servicioReal = require('../services/recordatorios');

let servicio = servicioReal;
function _setServicio(s) { servicio = { ...servicioReal, ...s }; }

async function obtener(req, res) {
  try {
    return res.json({ recordatorio: await servicio.recordatorioDeContacto(req.params.id) });
  } catch (err) {
    logger.error(`recordatorio obtener (${req.params.id}): ${err.message}`);
    return res.status(500).json({ error: 'no se pudo obtener el recordatorio' });
  }
}

async function guardar(req, res) {
  try {
    const { activo, diaMes } = req.body || {};
    const r = await servicio.guardarRecordatorio(req.params.id, { activo: !!activo, diaMes }, req.agente);
    return res.json({ recordatorio: r });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    logger.error(`recordatorio guardar (${req.params.id}): ${err.message}`);
    return res.status(500).json({ error: 'no se pudo guardar el recordatorio' });
  }
}

module.exports = { obtener, guardar, _setServicio };
```

- [ ] **Step 4: Wire the routes**

In `src/routes/api.js`, add the require near the other controllers:
```javascript
const recordatoriosCtrl = require('../controllers/recordatoriosController');
```
And near the other `/contactos/:id/...` routes (e.g. after `/contactos/:id/prenecesidad`):
```javascript
router.get('/contactos/:id/recordatorio', requireAuth, recordatoriosCtrl.obtener);
router.put('/contactos/:id/recordatorio', requireAuth, recordatoriosCtrl.guardar);
```

- [ ] **Step 5: Run tests + full suite**

Run: `... node --test test/recordatorios-controller.test.js` → PASS (2/2).
Run: `... node --test test/*.test.js` → PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/controllers/recordatoriosController.js src/routes/api.js test/recordatorios-controller.test.js
git commit -m "feat(recordatorios): endpoints GET/PUT por contacto"
```

---

### Task 5: Worker de barrido diario

**Files:**
- Create: `src/workers/recordatorios.js`
- Modify: `src/workers/index.js`
- Test: `test/recordatorio-worker.test.js`

**Interfaces:**
- Consumes: `dentroDeVentana`, `esperaEnvioMs` de `difusionReglas`; `obtenerAjustes`, `recordatorioConfigurado`, `siguienteRecordatorio`, `enviarRecordatorio` del servicio.
- Produces: `tick(ahora, deps): 'fuera-ventana'|'sin-config'|'nada'|'enviado'`; `iniciarLoop(): void`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/recordatorio-worker.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tick } = require('../src/workers/recordatorios');

function deps(over = {}) {
  return {
    dentroDeVentana: () => true,
    obtenerAjustes: async () => ({ recordatorio_texto: 'hola', recordatorio_imagen_url: 'http://x/y.png' }),
    recordatorioConfigurado: () => true,
    siguiente: async () => null,
    enviar: async () => 'enviado',
    ...over,
  };
}

test('fuera de ventana → no envía', async () => {
  let n = 0;
  const r = await tick(new Date(), deps({ dentroDeVentana: () => false, enviar: async () => { n++; return 'enviado'; } }));
  assert.equal(r, 'fuera-ventana'); assert.equal(n, 0);
});
test('sin configurar → sin-config', async () => {
  assert.equal(await tick(new Date(), deps({ recordatorioConfigurado: () => false })), 'sin-config');
});
test('nada pendiente → nada', async () => {
  assert.equal(await tick(new Date(), deps({ siguiente: async () => null })), 'nada');
});
test('hay uno → envía', async () => {
  let n = 0;
  const r = await tick(new Date(), deps({ siguiente: async () => ({ id: 1, contactoId: 2 }), enviar: async () => { n++; return 'enviado'; } }));
  assert.equal(r, 'enviado'); assert.equal(n, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... node --test test/recordatorio-worker.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Write the worker**

```javascript
// src/workers/recordatorios.js
'use strict';
const { dentroDeVentana, esperaEnvioMs } = require('../services/difusionReglas');
const servicio = require('../services/recordatorios');
const logger = require('../utils/logger');

/** Hoy en hora de Colombia (UTC-5), 'YYYY-MM-DD'. */
function hoyBogota() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Un paso del barrido. deps inyectable para test. */
async function tick(ahora, deps = {}) {
  const enVentana = (deps.dentroDeVentana || dentroDeVentana)(ahora);
  if (!enVentana) return 'fuera-ventana';
  const obtenerAjustes = deps.obtenerAjustes || servicio.obtenerAjustes;
  const configurado = deps.recordatorioConfigurado || servicio.recordatorioConfigurado;
  const siguiente = deps.siguiente || servicio.siguienteRecordatorio;
  const enviar = deps.enviar || ((rec, aj, hoy) => servicio.enviarRecordatorio(rec, aj, hoy));

  const aj = await obtenerAjustes();
  if (!configurado(aj)) return 'sin-config';
  const hoy = hoyBogota();
  const rec = await siguiente(hoy);
  if (!rec) return 'nada';
  await enviar(rec, aj, hoy);
  return 'enviado';
}

let corriendo = false;
async function iniciarLoop() {
  if (corriendo) return;
  corriendo = true;
  const paso = async () => {
    let espera = 60000; // sin nada que enviar / fuera de ventana: revisar cada 60 s
    try {
      if ((await tick(new Date())) === 'enviado') espera = esperaEnvioMs(); // ritmo entre envíos
    } catch (err) {
      logger.error(`worker recordatorios: ${err.message}`);
    }
    if (corriendo) setTimeout(paso, espera);
  };
  paso();
}

module.exports = { tick, iniciarLoop };
```

- [ ] **Step 4: Start the loop in the worker process**

In `src/workers/index.js`, near the difusiones startup, add the require:
```javascript
const { iniciarLoop: iniciarRecordatorios } = require('./recordatorios');
```
And next to `iniciarDifusiones();`:
```javascript
  iniciarRecordatorios();
```

- [ ] **Step 5: Run tests**

Run: `... node --test test/recordatorio-worker.test.js` → PASS (4/4).
Run: `... node --test test/*.test.js` → PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/workers/recordatorios.js src/workers/index.js test/recordatorio-worker.test.js
git commit -m "feat(recordatorios): worker de barrido diario (ventana + ritmo)"
```

---

### Task 6: Frontend — sección en el panel del contacto

**Files:**
- Modify: `frontend/src/stores/acciones.js`, `frontend/src/components/PanelCliente.vue`
- Test: `frontend/src/stores/acciones.recordatorio.test.js`

**Interfaces:**
- Produces (acciones): `cargarRecordatorio(contactoId)` → `{activo,diaMes}|null`; `guardarRecordatorio(contactoId, payload)`.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/stores/acciones.recordatorio.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const fetchMock = vi.fn();
vi.mock('../api/cliente', () => ({ apiFetch: (...a) => fetchMock(...a), tokenGuardado: () => 't' }));
import { useAcciones } from './acciones';

describe('acciones recordatorio', () => {
  beforeEach(() => { setActivePinia(createPinia()); fetchMock.mockReset(); });
  it('cargarRecordatorio hace GET y devuelve el recordatorio', async () => {
    fetchMock.mockResolvedValue({ recordatorio: { activo: true, diaMes: 5 } });
    const acc = useAcciones();
    const r = await acc.cargarRecordatorio(9);
    expect(fetchMock).toHaveBeenCalledWith('/contactos/9/recordatorio');
    expect(r.diaMes).toBe(5);
  });
  it('guardarRecordatorio hace PUT con el cuerpo', async () => {
    fetchMock.mockResolvedValue({ recordatorio: { activo: true, diaMes: 8 } });
    const acc = useAcciones();
    await acc.guardarRecordatorio(9, { activo: true, diaMes: 8 });
    expect(fetchMock).toHaveBeenCalledWith('/contactos/9/recordatorio', { method: 'PUT', body: JSON.stringify({ activo: true, diaMes: 8 }) });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- acciones.recordatorio`
Expected: FAIL (acciones no existen).

- [ ] **Step 3: Add the actions** — dentro de `actions` de `useAcciones` (junto a las de difusiones):

```javascript
    async cargarRecordatorio(contactoId) {
      return (await apiFetch(`/contactos/${contactoId}/recordatorio`)).recordatorio;
    },
    async guardarRecordatorio(contactoId, payload) {
      return (await apiFetch(`/contactos/${contactoId}/recordatorio`, { method: 'PUT', body: JSON.stringify(payload) })).recordatorio;
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test -- acciones.recordatorio`
Expected: PASS (2/2).

- [ ] **Step 5: Add the panel section** — en `frontend/src/components/PanelCliente.vue`.

In `<script setup>`, add state and load/save logic. Near the other `ref`s:
```javascript
const recordatorio = ref({ activo: false, diaMes: 5 });
```
In the existing `watch(() => c.value?.id, ...)` that loads notas/asignaciones, add loading the recordatorio (inside the same `if (id)` block):
```javascript
    acc.cargarRecordatorio(id).then((r) => { recordatorio.value = r || { activo: false, diaMes: 5 }; }).catch(() => {});
```
Add a save function:
```javascript
async function guardarRecordatorio() {
  try { recordatorio.value = await acc.guardarRecordatorio(c.value.contacto.id, { activo: recordatorio.value.activo, diaMes: recordatorio.value.diaMes }); }
  catch { /* no bloquear el panel */ }
}
```
In the template, add a section (place it near the "Notas internas"/"¿Compró?" area, following the same styling):
```html
    <div class="py-2 border-t border-gray-100">
      <div class="text-[11px] text-gray-400 uppercase mb-1">Recordatorio mensual</div>
      <label class="flex items-center gap-2 text-[12.5px] text-gray-700">
        <input type="checkbox" v-model="recordatorio.activo" @change="guardarRecordatorio" />
        Activar recordatorio automático
      </label>
      <div v-if="recordatorio.activo" class="flex items-center gap-2 mt-1 text-[12.5px]">
        <span class="text-gray-500">Día del mes</span>
        <select v-model.number="recordatorio.diaMes" @change="guardarRecordatorio" class="border rounded px-2 py-1">
          <option v-for="d in 30" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>
      <p class="text-[11px] text-gray-400 mt-1">Se enviará una plantilla automáticamente ese día de cada mes.</p>
    </div>
```

- [ ] **Step 6: Run tests + build**

Run: `npm --prefix frontend test` → PASS (previos + acciones.recordatorio).
Run: `npm --prefix frontend run build` → build limpio.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/stores/acciones.js frontend/src/components/PanelCliente.vue frontend/src/stores/acciones.recordatorio.test.js
git commit -m "feat(recordatorios): sección de recordatorio mensual en el panel del contacto"
```

---

## Verificación en vivo (tras completar)

Deploy: migración 008 en el server, `git pull`, `npm --prefix frontend run build`, reiniciar `wa-backend` **y** `wa-worker`.
1. **Cargar el contenido** (una vez, cuando el usuario lo comparta):
   `UPDATE wa_ajustes SET valor=:texto WHERE clave='recordatorio_texto';` y
   `UPDATE wa_ajustes SET valor=:url WHERE clave='recordatorio_imagen_url';`
2. En el panel de un contacto de prueba: activar el switch + elegir el día de **hoy** → guardar.
3. Dentro de la ventana horaria, el worker envía en ≤1 min; verificar que llega al WhatsApp, que la conversación queda en **resueltos** (origen recordatorio) y `ultimo_envio_en` = hoy.
4. Correr el barrido dos veces el mismo mes NO reenvía (idempotencia por `ultimo_envio_en`).
5. Sin `recordatorio_texto`/`imagen_url` cargados, el barrido NO envía (log "sin-config").

## Notas / decisiones

- **Refactor de difusiones** (Task 2): el envío de difusiones ahora persiste vía `persistirEnvioPlantilla`. Comportamiento idéntico; re-verificar difusiones en vivo tras el deploy (una carga/envío de prueba pequeño).
- Mensaje e imagen son globales (`wa_ajustes`); un formulario admin para editarlos es follow-up.
- Idempotencia mensual por `ultimo_envio_en`; el worker puede reintentar sin duplicar.
- Comparte número y ritmo con difusiones (loops separados; solape posible pero acotado — unificar la cola es follow-up).
