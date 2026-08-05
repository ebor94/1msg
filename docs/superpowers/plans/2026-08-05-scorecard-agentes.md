# Scorecard diario de agentes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al administrador una pantalla de seguimiento diario de agentes: backlog en vivo (chats sin responder) + tabla del día con volumen de trabajo y tiempo de primera respuesta (TPR) ajustado a horario laboral.

**Architecture:** Capa de solo-lectura sobre tablas `wa_` existentes. Un módulo puro y testeado (`tiempoLaboral.js`) calcula minutos laborales; un servicio (`reporteAgentes.js`) hace las queries crudas y agrega; un controller delgado expone 2 endpoints admin-only; una vista Vue los consume. Sin migración, sin tocar la ingesta.

**Tech Stack:** Node 20 CommonJS, Express, Sequelize (`sequelize.query` crudo con `QueryTypes.SELECT`), MySQL 8 (window function `LAG`), Vue 3 `<script setup>` + Pinia + Vue Router + Tailwind. Tests: `node:test` (backend), Vitest (frontend).

## Global Constraints

- Solo lectura de tablas con prefijo `wa_`. No tocar `serfuweb` ni BD externas.
- Endpoints admin-only: `requireAuth` + `requireAdmin` (rol `administrador`). Un asesor → 403.
- Los `DATETIME` se guardan en hora local de Colombia (`DB_TIMEZONE=-05:00`). El "día" es `[fecha 00:00:00, fecha+1 00:00:00)` en hora local, sin conversión UTC.
- Excluir siempre `wa_mensajes.historico = 1` (backfill, no es actividad del día).
- Horario laboral para TPR: Lun–Vie 08:00–18:00, Sáb 08:00–11:00, Dom nada.
- Nombres de dominio en español, técnicos en inglés. Nada de `console.log`: usar el logger. Nunca tragar excepciones en silencio.
- Los timestamps que van al cálculo de TPR se leen como **strings** `'YYYY-MM-DD HH:MM:SS'` (vía `DATE_FORMAT` en SQL) para evitar líos de zona horaria: el string ya es la hora de pared de Colombia.

## File Structure

- `src/services/tiempoLaboral.js` (crear) — `minutosLaborales(desde, hasta, calendario)` puro + `CALENDARIO`.
- `src/services/reporteAgentes.js` (crear) — `parsearFecha`, `agregarTpr`, `percentil` (puros) + `metricasDelDia(fecha)`, `backlogVivo()` (queries).
- `src/controllers/reportesController.js` (crear) — `vivo(req,res)`, `delDia(req,res)`.
- `src/routes/api.js` (modificar) — registrar 2 rutas admin-only.
- `test/tiempo-laboral.test.js`, `test/reporte-agentes.test.js`, `test/reportes-controller.test.js` (crear).
- `frontend/src/stores/acciones.js` (modificar) — `cargarBacklogVivo()`, `cargarScorecard(fecha)`.
- `frontend/src/stores/acciones.scorecard.test.js` (crear) — test de las acciones con `apiFetch` mockeado.
- `frontend/src/views/ScorecardAgentes.vue` (crear) — la pantalla.
- `frontend/src/router/index.js` (modificar) — ruta `/seguimiento`.
- `frontend/src/views/Bandeja.vue` (modificar) — link en el menú (admin-only).

---

### Task 1: Módulo `tiempoLaboral` (minutos laborales, puro)

Corazón del TPR. Función pura sobre strings de hora de pared; sin BD, sin zona horaria. Es la parte con más aristas, así que va primero y con tests exhaustivos.

**Files:**
- Create: `src/services/tiempoLaboral.js`
- Test: `test/tiempo-laboral.test.js`

**Interfaces:**
- Produces:
  - `CALENDARIO` — objeto `{ [dow 0..6]: Array<[iniMin, finMin]> }` (minutos desde medianoche).
  - `minutosLaborales(desde: string, hasta: string, calendario = CALENDARIO): number` — minutos laborales entre dos `'YYYY-MM-DD HH:MM:SS'`. Devuelve 0 si `hasta <= desde`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/tiempo-laboral.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { minutosLaborales } = require('../src/services/tiempoLaboral');

// Fechas ancla (verificadas): 2026-08-03 Lun, 08-04 Mar, 08-08 Sáb, 08-09 Dom, 08-10 Lun.
test('mismo tramo, dentro de la franja (Lun)', () => {
  assert.equal(minutosLaborales('2026-08-03 08:10:00', '2026-08-03 08:25:00'), 15);
});
test('franja completa de un día hábil', () => {
  assert.equal(minutosLaborales('2026-08-03 08:00:00', '2026-08-03 18:00:00'), 600);
});
test('cruza la noche: solo cuenta horario hábil de cada día', () => {
  // Lun 17:55→18:00 = 5, Mar 08:00→08:05 = 5
  assert.equal(minutosLaborales('2026-08-03 17:55:00', '2026-08-04 08:05:00'), 10);
});
test('cruza fin de semana: sábado corto + domingo cero + lunes', () => {
  // Sáb 10:30→11:00 = 30, Dom 0, Lun 08:00→08:30 = 30
  assert.equal(minutosLaborales('2026-08-08 10:30:00', '2026-08-10 08:30:00'), 60);
});
test('domingo entero = 0', () => {
  assert.equal(minutosLaborales('2026-08-09 09:00:00', '2026-08-09 10:00:00'), 0);
});
test('fuera de horario (noche) = 0', () => {
  assert.equal(minutosLaborales('2026-08-03 19:00:00', '2026-08-03 20:00:00'), 0);
});
test('respuesta anterior o igual al inicio = 0', () => {
  assert.equal(minutosLaborales('2026-08-03 09:00:00', '2026-08-03 09:00:00'), 0);
  assert.equal(minutosLaborales('2026-08-03 10:00:00', '2026-08-03 09:00:00'), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/tiempo-laboral.test.js`
Expected: FAIL — `Cannot find module '../src/services/tiempoLaboral'`.

- [ ] **Step 3: Write the implementation**

```javascript
// src/services/tiempoLaboral.js
'use strict';

/**
 * Minutos laborales entre dos instantes en hora local de Colombia.
 * Entrada: strings 'YYYY-MM-DD HH:MM:SS' (así llegan de DATE_FORMAT en MySQL,
 * que ya guarda hora de pared local). Puro: sin BD, sin zona horaria.
 */

// Franjas por día de semana (0=Dom .. 6=Sáb), en minutos desde medianoche.
const CALENDARIO = {
  0: [],               // Domingo
  1: [[480, 1080]],    // Lun 08:00–18:00
  2: [[480, 1080]],
  3: [[480, 1080]],
  4: [[480, 1080]],
  5: [[480, 1080]],
  6: [[480, 660]],     // Sáb 08:00–11:00
};

// 'YYYY-MM-DD HH:MM:SS' -> minutos absolutos y ms de medianoche (aritmética TZ-free vía Date.UTC).
function partes(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s));
  if (!m) throw new Error(`fecha inválida: ${s}`);
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5];
  const diaMs = Date.UTC(y, mo - 1, d);
  return { diaMs, min: h * 60 + mi };
}

function minutosLaborales(desde, hasta, calendario = CALENDARIO) {
  const a = partes(desde);
  const b = partes(hasta);
  const desdeAbs = a.diaMs / 60000 + a.min;
  const hastaAbs = b.diaMs / 60000 + b.min;
  if (hastaAbs <= desdeAbs) return 0;

  let total = 0;
  for (let dia = a.diaMs; dia <= b.diaMs; dia += 86400000) {
    const dow = new Date(dia).getUTCDay();
    const base = dia / 60000; // minutos absolutos a la medianoche de ese día
    for (const [ini, fin] of calendario[dow] || []) {
      const ov = Math.min(hastaAbs, base + fin) - Math.max(desdeAbs, base + ini);
      if (ov > 0) total += ov;
    }
  }
  return total;
}

module.exports = { CALENDARIO, minutosLaborales };
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: PASS — todas las aserciones en verde.

- [ ] **Step 5: Commit**

```bash
git add src/services/tiempoLaboral.js test/tiempo-laboral.test.js
git commit -m "feat(reportes): módulo tiempoLaboral (minutos laborales para TPR)"
```

---

### Task 2: Servicio `reporteAgentes` (parseo, agregación TPR y queries)

Une el módulo de tiempo con las queries. Las partes puras (`parsearFecha`, `percentil`, `agregarTpr`) van con tests; las queries (`metricasDelDia`, `backlogVivo`) se prueban en vivo contra la BD al desplegar (dependen de MySQL, no se testean unitariamente).

**Files:**
- Create: `src/services/reporteAgentes.js`
- Test: `test/reporte-agentes.test.js`

**Interfaces:**
- Consumes: `minutosLaborales` de `tiempoLaboral.js`; `sequelize` de `config/database`; `QueryTypes` de `sequelize`.
- Produces:
  - `parsearFecha(fechaStr?: string): { fecha: string, ini: string, fin: string }` — valida `^\d{4}-\d{2}-\d{2}$`; sin valor usa hoy en Colombia. Lanza `Error` con `.status = 400` si el formato es inválido. `ini`/`fin` son `'YYYY-MM-DD 00:00:00'` (fin = día siguiente).
  - `percentil(ordenados: number[], p: number): number|null`.
  - `agregarTpr(turnos: Array<{agenteId, clienteTs, agenteTs}>): Map<number,{tprPromMin,tprP90Min,turnos}>`.
  - `async metricasDelDia(fecha?: string): { fecha, agentes: Array<{agenteId,nombre,mensajes,chatsAtendidos,tomados,cerrados,tprPromMin,tprP90Min,turnos}>, totales: {...} }`.
  - `async backlogVivo(): { agentes: Array<{agenteId,nombre,sinResponder,esperaMasViejaMin}>, general: {sinResponder,esperaMasViejaMin} }`.

- [ ] **Step 1: Write the failing test (partes puras)**

```javascript
// test/reporte-agentes.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsearFecha, percentil, agregarTpr } = require('../src/services/reporteAgentes');

test('parsearFecha válida arma ini/fin del día', () => {
  const r = parsearFecha('2026-08-03');
  assert.equal(r.fecha, '2026-08-03');
  assert.equal(r.ini, '2026-08-03 00:00:00');
  assert.equal(r.fin, '2026-08-04 00:00:00');
});
test('parsearFecha sin argumento no lanza y da un día válido', () => {
  const r = parsearFecha();
  assert.match(r.fecha, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(r.fin, /^\d{4}-\d{2}-\d{2} 00:00:00$/);
});
test('parsearFecha inválida lanza 400', () => {
  assert.throws(() => parsearFecha('03/08/2026'), (e) => e.status === 400);
});
test('percentil P90 de una lista', () => {
  const ord = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentil(ord, 90), 9);
  assert.equal(percentil([], 90), null);
});
test('agregarTpr agrupa por agente y calcula prom/P90/turnos', () => {
  // Lun 2026-08-03: dos turnos del agente 7 (10 y 20 min) y uno del 9 (5 min).
  const turnos = [
    { agenteId: 7, clienteTs: '2026-08-03 08:00:00', agenteTs: '2026-08-03 08:10:00' },
    { agenteId: 7, clienteTs: '2026-08-03 09:00:00', agenteTs: '2026-08-03 09:20:00' },
    { agenteId: 9, clienteTs: '2026-08-03 10:00:00', agenteTs: '2026-08-03 10:05:00' },
  ];
  const m = agregarTpr(turnos);
  assert.equal(m.get(7).tprPromMin, 15);
  assert.equal(m.get(7).turnos, 2);
  assert.equal(m.get(9).tprPromMin, 5);
  assert.equal(m.get(9).turnos, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/reporte-agentes.test.js`
Expected: FAIL — `Cannot find module '../src/services/reporteAgentes'`.

- [ ] **Step 3: Write the implementation**

```javascript
// src/services/reporteAgentes.js
'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { minutosLaborales } = require('./tiempoLaboral');

function err400(msg) { const e = new Error(msg); e.status = 400; return e; }

/** Hoy en hora de Colombia (UTC-5), como 'YYYY-MM-DD'. */
function hoyBogota() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Valida la fecha (o usa hoy) y arma los límites del día [ini, fin). */
function parsearFecha(fechaStr) {
  const fecha = fechaStr && fechaStr !== '' ? String(fechaStr) : hoyBogota();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw err400('fecha inválida (usar YYYY-MM-DD)');
  const finMs = Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10)) + 86400000;
  const fin = new Date(finMs).toISOString().slice(0, 10);
  return { fecha, ini: `${fecha} 00:00:00`, fin: `${fin} 00:00:00` };
}

function percentil(ordenados, p) {
  if (!ordenados.length) return null;
  const idx = Math.ceil((p / 100) * ordenados.length) - 1;
  return ordenados[Math.max(0, Math.min(idx, ordenados.length - 1))];
}

/** Agrupa turnos por agente y calcula prom/P90 (en minutos laborales). */
function agregarTpr(turnos) {
  const porAgente = new Map();
  for (const t of turnos) {
    const min = minutosLaborales(t.clienteTs, t.agenteTs);
    if (!porAgente.has(t.agenteId)) porAgente.set(t.agenteId, []);
    porAgente.get(t.agenteId).push(min);
  }
  const out = new Map();
  for (const [id, mins] of porAgente) {
    const ord = [...mins].sort((a, b) => a - b);
    const prom = ord.reduce((s, v) => s + v, 0) / ord.length;
    out.set(id, { tprPromMin: Math.round(prom), tprP90Min: Math.round(percentil(ord, 90)), turnos: ord.length });
  }
  return out;
}

const SEL = { type: QueryTypes.SELECT };

/** Métricas de volumen + TPR por agente para el día dado. */
async function metricasDelDia(fechaStr) {
  const { fecha, ini, fin } = parsearFecha(fechaStr);
  const repl = { ini, fin };

  const agentes = await sequelize.query(
    "SELECT id AS agenteId, nombre FROM wa_agentes WHERE activo = 1 ORDER BY nombre",
    SEL,
  );

  const msgs = await sequelize.query(
    `SELECT enviado_por_id AS agenteId, COUNT(*) AS mensajes,
            COUNT(DISTINCT conversacion_id) AS chatsAtendidos
       FROM wa_mensajes
      WHERE historico = 0 AND direccion = 'out' AND enviado_por_id IS NOT NULL
        AND COALESCE(ts_proveedor, creado_en) >= :ini
        AND COALESCE(ts_proveedor, creado_en) < :fin
      GROUP BY enviado_por_id`,
    { ...SEL, replacements: repl },
  );

  const tomas = await sequelize.query(
    `SELECT ejecutado_por_id AS agenteId, COUNT(*) AS tomados
       FROM wa_asignaciones
      WHERE tipo = 'toma_manual' AND ejecutado_por_id IS NOT NULL
        AND creado_en >= :ini AND creado_en < :fin
      GROUP BY ejecutado_por_id`,
    { ...SEL, replacements: repl },
  );

  const cierres = await sequelize.query(
    `SELECT agente_id AS agenteId, COUNT(*) AS cerrados
       FROM wa_conversaciones
      WHERE agente_id IS NOT NULL AND cerrada_en >= :ini AND cerrada_en < :fin
      GROUP BY agente_id`,
    { ...SEL, replacements: repl },
  );

  // Turnos de respuesta (cliente escribió -> agente contestó) del día, vía LAG.
  const turnos = await sequelize.query(
    `WITH ordenado AS (
        SELECT m.direccion, m.enviado_por_id,
               DATE_FORMAT(COALESCE(m.ts_proveedor, m.creado_en), '%Y-%m-%d %H:%i:%s') AS ts,
               LAG(m.direccion) OVER w AS dir_prev,
               DATE_FORMAT(LAG(COALESCE(m.ts_proveedor, m.creado_en)) OVER w, '%Y-%m-%d %H:%i:%s') AS ts_prev
          FROM wa_mensajes m
         WHERE m.historico = 0
           AND COALESCE(m.ts_proveedor, m.creado_en) >= :ini
           AND COALESCE(m.ts_proveedor, m.creado_en) < :fin
        WINDOW w AS (PARTITION BY m.conversacion_id
                     ORDER BY COALESCE(m.ts_proveedor, m.creado_en), m.id)
      )
      SELECT enviado_por_id AS agenteId, ts_prev AS clienteTs, ts AS agenteTs
        FROM ordenado
       WHERE direccion = 'out' AND dir_prev = 'in' AND enviado_por_id IS NOT NULL`,
    { ...SEL, replacements: repl },
  );

  const porMsg = new Map(msgs.map((r) => [r.agenteId, r]));
  const porToma = new Map(tomas.map((r) => [r.agenteId, r.tomados]));
  const porCierre = new Map(cierres.map((r) => [r.agenteId, r.cerrados]));
  const porTpr = agregarTpr(turnos);

  const filas = agentes.map((a) => {
    const mm = porMsg.get(a.agenteId) || {};
    const tp = porTpr.get(a.agenteId) || {};
    return {
      agenteId: a.agenteId,
      nombre: a.nombre,
      mensajes: Number(mm.mensajes || 0),
      chatsAtendidos: Number(mm.chatsAtendidos || 0),
      tomados: Number(porToma.get(a.agenteId) || 0),
      cerrados: Number(porCierre.get(a.agenteId) || 0),
      tprPromMin: tp.tprPromMin ?? null,
      tprP90Min: tp.tprP90Min ?? null,
      turnos: tp.turnos || 0,
    };
  });

  const totales = filas.reduce(
    (t, f) => {
      t.mensajes += f.mensajes; t.chatsAtendidos += f.chatsAtendidos;
      t.tomados += f.tomados; t.cerrados += f.cerrados; t.turnos += f.turnos;
      return t;
    },
    { mensajes: 0, chatsAtendidos: 0, tomados: 0, cerrados: 0, turnos: 0 },
  );

  return { fecha, agentes: filas, totales };
}

/** Backlog en vivo: chats sin responder (cliente escribió de último) por agente + general. */
async function backlogVivo() {
  const agentes = await sequelize.query(
    "SELECT id AS agenteId, nombre FROM wa_agentes WHERE activo = 1 ORDER BY nombre",
    SEL,
  );
  const filas = await sequelize.query(
    `SELECT agente_id AS agenteId, COUNT(*) AS sinResponder,
            TIMESTAMPDIFF(MINUTE, MIN(ultimo_mensaje_en), NOW()) AS esperaMasViejaMin
       FROM wa_conversaciones
      WHERE estado <> 'cerrada' AND ultimo_mensaje_dir = 'in'
      GROUP BY agente_id`,
    SEL,
  );
  const porAgente = new Map(filas.filter((r) => r.agenteId != null).map((r) => [r.agenteId, r]));
  const generalRow = filas.find((r) => r.agenteId == null);

  return {
    agentes: agentes.map((a) => {
      const r = porAgente.get(a.agenteId);
      return {
        agenteId: a.agenteId,
        nombre: a.nombre,
        sinResponder: Number(r?.sinResponder || 0),
        esperaMasViejaMin: r ? Number(r.esperaMasViejaMin) : null,
      };
    }),
    general: {
      sinResponder: Number(generalRow?.sinResponder || 0),
      esperaMasViejaMin: generalRow ? Number(generalRow.esperaMasViejaMin) : null,
    },
  };
}

module.exports = { parsearFecha, percentil, agregarTpr, metricasDelDia, backlogVivo };
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: PASS — 5 tests en verde (las queries no se ejecutan en el test).

- [ ] **Step 5: Commit**

```bash
git add src/services/reporteAgentes.js test/reporte-agentes.test.js
git commit -m "feat(reportes): servicio reporteAgentes (métricas del día + backlog vivo)"
```

---

### Task 3: Controller + rutas admin-only

Expone los dos endpoints. El controller es delgado: delega y traduce errores (`400` fecha inválida, `500` fallo de consulta). Test unitario del controller con `req`/`res` mock, sin BD (se mockea el servicio con un stub inyectado).

**Files:**
- Create: `src/controllers/reportesController.js`
- Modify: `src/routes/api.js`
- Test: `test/reportes-controller.test.js`

**Interfaces:**
- Consumes: `metricasDelDia`, `backlogVivo` de `reporteAgentes.js`; `logger`.
- Produces: `vivo(req,res)`, `delDia(req,res)`. Para poder testear sin BD, el módulo expone también `_setDeps({ metricasDelDia, backlogVivo })` que reemplaza las dependencias.

- [ ] **Step 1: Write the failing test**

```javascript
// test/reportes-controller.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ctrl = require('../src/controllers/reportesController');

function resMock() {
  return {
    _status: 200, _json: null,
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
  };
}

test('delDia responde 200 con las métricas', async () => {
  ctrl._setDeps({ metricasDelDia: async (f) => ({ fecha: f || '2026-08-05', agentes: [], totales: {} }) });
  const res = resMock();
  await ctrl.delDia({ query: { fecha: '2026-08-03' } }, res);
  assert.equal(res._status, 200);
  assert.equal(res._json.fecha, '2026-08-03');
});

test('delDia traduce error .status=400 a 400', async () => {
  ctrl._setDeps({ metricasDelDia: async () => { const e = new Error('fecha inválida'); e.status = 400; throw e; } });
  const res = resMock();
  await ctrl.delDia({ query: { fecha: 'x' } }, res);
  assert.equal(res._status, 400);
  assert.match(res._json.error, /fecha/);
});

test('vivo responde 200 con backlog', async () => {
  ctrl._setDeps({ backlogVivo: async () => ({ agentes: [], general: { sinResponder: 0, esperaMasViejaMin: null } }) });
  const res = resMock();
  await ctrl.vivo({}, res);
  assert.equal(res._status, 200);
  assert.equal(res._json.general.sinResponder, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/reportes-controller.test.js`
Expected: FAIL — `Cannot find module '../src/controllers/reportesController'`.

- [ ] **Step 3: Write the implementation**

```javascript
// src/controllers/reportesController.js
'use strict';
const logger = require('../utils/logger');
const servicio = require('../services/reporteAgentes');

// Dependencias inyectables (para test sin BD).
let deps = { metricasDelDia: servicio.metricasDelDia, backlogVivo: servicio.backlogVivo };
function _setDeps(d) { deps = { ...deps, ...d }; }

/** GET /api/reportes/agentes?fecha=YYYY-MM-DD — volumen + TPR del día. */
async function delDia(req, res) {
  try {
    const data = await deps.metricasDelDia(req.query.fecha);
    return res.json(data);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    logger.error(`reporte del día: ${err.message}`);
    return res.status(500).json({ error: 'no se pudo generar el reporte' });
  }
}

/** GET /api/reportes/agentes/vivo — backlog sin responder ahora mismo. */
async function vivo(req, res) {
  try {
    const data = await deps.backlogVivo();
    return res.json(data);
  } catch (err) {
    logger.error(`backlog vivo: ${err.message}`);
    return res.status(500).json({ error: 'no se pudo obtener el backlog' });
  }
}

module.exports = { delDia, vivo, _setDeps };
```

- [ ] **Step 4: Wire the routes** — en `src/routes/api.js`, agregar el require del controller junto a los demás y registrar las rutas (la más específica `/vivo` antes que la genérica). Copia el bloque de requires existente para ubicar dónde insertar.

```javascript
// junto a los otros require de controllers (p. ej. tras productosController):
const reportesCtrl = require('../controllers/reportesController');

// junto a las otras rutas (p. ej. tras la línea de /contactos/informe):
router.get('/reportes/agentes/vivo', requireAuth, requireAdmin, reportesCtrl.vivo);
router.get('/reportes/agentes', requireAuth, requireAdmin, reportesCtrl.delDia);
```

- [ ] **Step 5: Run tests + lint arranque**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/reportes-controller.test.js`
Expected: PASS — 3 tests en verde.
Además, correr **toda** la suite backend para no romper nada:
Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS — 111 previos + los nuevos.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/reportesController.js src/routes/api.js test/reportes-controller.test.js
git commit -m "feat(reportes): endpoints admin /reportes/agentes y /vivo"
```

---

### Task 4: Acciones del store (frontend)

Dos acciones que llaman la API. Test con `apiFetch` mockeado (patrón de los tests de store existentes).

**Files:**
- Modify: `frontend/src/stores/acciones.js`
- Test: `frontend/src/stores/acciones.scorecard.test.js`

**Interfaces:**
- Consumes: `apiFetch` de `../api/cliente`.
- Produces (acciones Pinia):
  - `cargarBacklogVivo(): Promise<{agentes,general}>` → `apiFetch('/reportes/agentes/vivo')`.
  - `cargarScorecard(fecha?): Promise<{fecha,agentes,totales}>` → `apiFetch('/reportes/agentes')` o `?fecha=`.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/stores/acciones.scorecard.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const fetchMock = vi.fn();
vi.mock('../api/cliente', () => ({
  apiFetch: (...a) => fetchMock(...a),
  tokenGuardado: () => 't',
}));

import { useAcciones } from './acciones';

describe('acciones scorecard', () => {
  beforeEach(() => { setActivePinia(createPinia()); fetchMock.mockReset(); });

  it('cargarBacklogVivo pega al endpoint vivo', async () => {
    fetchMock.mockResolvedValue({ agentes: [], general: { sinResponder: 0, esperaMasViejaMin: null } });
    const acc = useAcciones();
    const r = await acc.cargarBacklogVivo();
    expect(fetchMock).toHaveBeenCalledWith('/reportes/agentes/vivo');
    expect(r.general.sinResponder).toBe(0);
  });

  it('cargarScorecard con fecha arma el query', async () => {
    fetchMock.mockResolvedValue({ fecha: '2026-08-03', agentes: [], totales: {} });
    const acc = useAcciones();
    await acc.cargarScorecard('2026-08-03');
    expect(fetchMock).toHaveBeenCalledWith('/reportes/agentes?fecha=2026-08-03');
  });

  it('cargarScorecard sin fecha pega al endpoint base', async () => {
    fetchMock.mockResolvedValue({ fecha: 'hoy', agentes: [], totales: {} });
    const acc = useAcciones();
    await acc.cargarScorecard();
    expect(fetchMock).toHaveBeenCalledWith('/reportes/agentes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- acciones.scorecard`
Expected: FAIL — `acc.cargarBacklogVivo is not a function`.

- [ ] **Step 3: Write the implementation** — agregar las dos acciones dentro del objeto `actions` de `useAcciones` (junto a `cargarInforme`).

```javascript
    async cargarBacklogVivo() {
      return apiFetch('/reportes/agentes/vivo');
    },
    async cargarScorecard(fecha) {
      const q = fecha ? `?fecha=${encodeURIComponent(fecha)}` : '';
      return apiFetch(`/reportes/agentes${q}`);
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test -- acciones.scorecard`
Expected: PASS — 3 tests en verde.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/acciones.js frontend/src/stores/acciones.scorecard.test.js
git commit -m "feat(reportes): acciones cargarScorecard y cargarBacklogVivo"
```

---

### Task 5: Vista `ScorecardAgentes.vue` + ruta + link en el menú

La pantalla. Reusa el patrón de `Informe.vue` (cabecera con "‹ Volver", selector, tabla). Bloque "En vivo" arriba con auto-refresh cada 45 s; tabla del día abajo con selector de fecha. Umbrales de color en helpers puros y testeables.

**Files:**
- Create: `frontend/src/views/ScorecardAgentes.vue`
- Modify: `frontend/src/router/index.js`
- Modify: `frontend/src/views/Bandeja.vue`
- Test: `frontend/src/views/scorecard-formato.test.js`

**Interfaces:**
- Consumes: `useAcciones().cargarScorecard`, `useAcciones().cargarBacklogVivo`; `useRouter`.
- Produces: ruta con nombre `seguimiento` en `/seguimiento`. Helpers exportables `colorEspera(min)` y `colorTpr(min)` (para test) en un módulo aparte para poder importarlos: crear `frontend/src/utils/scorecard.js`.

- [ ] **Step 1: Write the failing test (helpers de umbral, puros)**

```javascript
// frontend/src/views/scorecard-formato.test.js
import { describe, it, expect } from 'vitest';
import { colorEspera, colorTpr, minAHhMm } from '../utils/scorecard';

describe('umbrales scorecard', () => {
  it('colorEspera: verde/ámbar/rojo por minutos', () => {
    expect(colorEspera(10)).toBe('ok');
    expect(colorEspera(45)).toBe('warn');
    expect(colorEspera(90)).toBe('bad');
    expect(colorEspera(null)).toBe('none');
  });
  it('colorTpr: verde/ámbar/rojo por minutos', () => {
    expect(colorTpr(5)).toBe('ok');
    expect(colorTpr(20)).toBe('warn');
    expect(colorTpr(40)).toBe('bad');
    expect(colorTpr(null)).toBe('none');
  });
  it('minAHhMm formatea minutos a texto', () => {
    expect(minAHhMm(0)).toBe('0m');
    expect(minAHhMm(75)).toBe('1h 15m');
    expect(minAHhMm(null)).toBe('—');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- scorecard-formato`
Expected: FAIL — no existe `../utils/scorecard`.

- [ ] **Step 3: Write the helpers**

```javascript
// frontend/src/utils/scorecard.js
// Umbrales visuales (solo color). Espera: >30 ámbar, >60 rojo. TPR: >10 ámbar, >30 rojo.
export function colorEspera(min) {
  if (min == null) return 'none';
  if (min > 60) return 'bad';
  if (min > 30) return 'warn';
  return 'ok';
}
export function colorTpr(min) {
  if (min == null) return 'none';
  if (min > 30) return 'bad';
  if (min > 10) return 'warn';
  return 'ok';
}
export function minAHhMm(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test -- scorecard-formato`
Expected: PASS — 3 tests en verde.

- [ ] **Step 5: Write the view**

```vue
<!-- frontend/src/views/ScorecardAgentes.vue -->
<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAcciones } from '../stores/acciones';
import { colorEspera, colorTpr, minAHhMm } from '../utils/scorecard';

const router = useRouter();
const acc = useAcciones();

const fecha = ref(new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10));
const dia = ref({ fecha: '', agentes: [], totales: {} });
const vivo = ref({ agentes: [], general: { sinResponder: 0, esperaMasViejaMin: null } });
const cargando = ref(false);
const error = ref('');
let timer = null;

const CLASE = { ok: 'text-gray-700', warn: 'text-amber-600 font-semibold', bad: 'text-red-600 font-bold', none: 'text-gray-300' };

async function cargarDia() {
  cargando.value = true; error.value = '';
  try { dia.value = await acc.cargarScorecard(fecha.value); }
  catch (e) { error.value = e.message || 'No se pudo cargar el reporte.'; }
  finally { cargando.value = false; }
}
async function cargarVivo() {
  try { vivo.value = await acc.cargarBacklogVivo(); } catch { /* silencioso: es un panel secundario */ }
}

onMounted(() => {
  cargarDia();
  cargarVivo();
  timer = setInterval(cargarVivo, 45000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="h-full flex flex-col bg-gray-50 overflow-auto">
    <header class="bg-marca-oscuro text-white flex items-center gap-3 px-4 py-2.5 sticky top-0 z-10">
      <button class="text-white/80 hover:text-white text-sm" @click="router.push('/')">‹ Volver</button>
      <div class="font-bold">Seguimiento de agentes</div>
    </header>

    <!-- En vivo -->
    <section class="p-4">
      <div class="text-[13px] font-semibold text-gray-600 mb-2">En vivo · sin responder ahora</div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div class="bg-white border rounded-lg p-3">
          <div class="text-[11px] text-gray-400 uppercase">General</div>
          <div class="text-2xl font-bold text-gray-800">{{ vivo.general.sinResponder }}</div>
          <div class="text-[11px]" :class="CLASE[colorEspera(vivo.general.esperaMasViejaMin)]">
            espera {{ minAHhMm(vivo.general.esperaMasViejaMin) }}
          </div>
        </div>
        <div v-for="a in vivo.agentes" :key="a.agenteId" class="bg-white border rounded-lg p-3">
          <div class="text-[11px] text-gray-400 uppercase truncate">{{ a.nombre }}</div>
          <div class="text-2xl font-bold text-gray-800">{{ a.sinResponder }}</div>
          <div class="text-[11px]" :class="CLASE[colorEspera(a.esperaMasViejaMin)]">
            espera {{ minAHhMm(a.esperaMasViejaMin) }}
          </div>
        </div>
      </div>
    </section>

    <!-- Tabla del día -->
    <section class="px-4 pb-6">
      <div class="flex items-center gap-2 mb-2">
        <div class="text-[13px] font-semibold text-gray-600">Del día</div>
        <input type="date" v-model="fecha" @change="cargarDia" class="border rounded px-2 py-1 text-[12px]" />
        <span v-if="cargando" class="text-[12px] text-gray-400">cargando…</span>
      </div>
      <p v-if="error" class="text-[12px] text-red-600 mb-2">{{ error }}</p>
      <div class="overflow-x-auto border rounded bg-white">
        <table class="w-full text-[12px]">
          <thead class="bg-gray-50 text-gray-500">
            <tr>
              <th class="px-3 py-2 text-left font-medium">Agente</th>
              <th class="px-3 py-2 text-right font-medium">Mensajes</th>
              <th class="px-3 py-2 text-right font-medium">Chats</th>
              <th class="px-3 py-2 text-right font-medium">Tomados</th>
              <th class="px-3 py-2 text-right font-medium">Cerrados</th>
              <th class="px-3 py-2 text-right font-medium">TPR prom</th>
              <th class="px-3 py-2 text-right font-medium">TPR P90</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in dia.agentes" :key="a.agenteId" class="border-t border-gray-100">
              <td class="px-3 py-1.5 text-gray-800">{{ a.nombre }}</td>
              <td class="px-3 py-1.5 text-right">{{ a.mensajes }}</td>
              <td class="px-3 py-1.5 text-right">{{ a.chatsAtendidos }}</td>
              <td class="px-3 py-1.5 text-right">{{ a.tomados }}</td>
              <td class="px-3 py-1.5 text-right">{{ a.cerrados }}</td>
              <td class="px-3 py-1.5 text-right" :class="CLASE[colorTpr(a.tprPromMin)]">{{ minAHhMm(a.tprPromMin) }}</td>
              <td class="px-3 py-1.5 text-right" :class="CLASE[colorTpr(a.tprP90Min)]">{{ minAHhMm(a.tprP90Min) }}</td>
            </tr>
          </tbody>
          <tfoot class="bg-gray-50 text-gray-700 font-semibold">
            <tr class="border-t">
              <td class="px-3 py-2">Total</td>
              <td class="px-3 py-2 text-right">{{ dia.totales.mensajes || 0 }}</td>
              <td class="px-3 py-2 text-right">{{ dia.totales.chatsAtendidos || 0 }}</td>
              <td class="px-3 py-2 text-right">{{ dia.totales.tomados || 0 }}</td>
              <td class="px-3 py-2 text-right">{{ dia.totales.cerrados || 0 }}</td>
              <td class="px-3 py-2 text-right" colspan="2">{{ dia.totales.turnos || 0 }} turnos</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  </div>
</template>
```

- [ ] **Step 6: Add the route** — en `frontend/src/router/index.js`, agregar dentro de `routes` (tras la línea de `/informe`):

```javascript
    { path: '/seguimiento', name: 'seguimiento', component: () => import('../views/ScorecardAgentes.vue'), meta: { requiereAuth: true } },
```

- [ ] **Step 7: Add the menu link** — en `frontend/src/views/Bandeja.vue`, dentro del desplegable, junto al link de "Informe de contactos", agregar (admin-only):

```html
          <button v-if="auth.esAdministrador" class="w-full text-left px-3 py-2 hover:bg-gray-50"
            @click="menuAbierto = false; router.push('/seguimiento')">📈 Seguimiento de agentes</button>
```

- [ ] **Step 8: Run tests + build**

Run: `npm --prefix frontend test`
Expected: PASS — 33 previos + los nuevos (acciones + scorecard-formato).
Run: `npm --prefix frontend run build`
Expected: build limpio.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/views/ScorecardAgentes.vue frontend/src/utils/scorecard.js frontend/src/router/index.js frontend/src/views/Bandeja.vue frontend/src/views/scorecard-formato.test.js
git commit -m "feat(reportes): pantalla Seguimiento de agentes (backlog vivo + tabla del día)"
```

---

## Notas de despliegue (tras completar todas las tareas)

- Sin migración ni cambios de ingesta → deploy normal: `git pull --ff-only && npm --prefix frontend run build && pm2 restart wa-backend` (no hace falta reiniciar `wa-worker`).
- **Verificación en vivo** (lo que los tests no cubren, porque dependen de MySQL):
  1. `GET /api/reportes/agentes/vivo` y `GET /api/reportes/agentes?fecha=<hoy>` con un JWT de admin → 200 con datos; con JWT de asesor → 403.
  2. Contrastar "Mensajes" y "Chats" de un agente contra la realidad de un día conocido.
  3. Revisar que el TPR de algún turno conocido cuadre (incluido uno que cruce la noche o el fin de semana).

## Limitaciones conocidas de v1 (documentadas, ajustables luego)

- Un turno de TPR solo cuenta si el mensaje del cliente y la respuesta del agente caen en el **mismo día calendario** (el `LAG` opera dentro del rango del día). Respuestas que cruzan la medianoche se excluyen de ese día; es raro dado el horario 8–18 y se puede refinar después.
- "Cerrados" se atribuye al `agente_id` dueño al cierre (no se registra quién hizo clic).
- Sin persistencia de snapshots: cada consulta recomputa el día (aceptable para un día; tendencias semanales serían fase 2).
