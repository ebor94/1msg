# Fase 2 · Plan 1 — Backend: Autenticación y lectura de bandeja

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer el backend que permite a un agente autenticarse con sus credenciales de `serfuweb` y leer su bandeja (listar conversaciones y leer mensajes), respetando los roles administrador/asesor.

**Architecture:** Se extiende la API Express de la Fase 1 con rutas bajo `/api`. Autenticación por JWT propio, validando la clave con bcrypt contra `serfuweb.usuarios` y exigiendo fila en `wa_agentes`. La lógica pura (construcción de filtros por rol, JWT) se aísla en servicios/utils testeables con `node:test`; los controladores son delgados.

**Tech Stack:** Node 20 (CommonJS), Express, Sequelize (modelos de la Fase 1), `jsonwebtoken`, `bcryptjs`, `node:test`.

## Global Constraints

- CommonJS, `'use strict';` al inicio de cada archivo.
- Nombres de dominio en español, técnicos en inglés.
- NUNCA `sequelize.sync()`; los modelos ya existen (Fase 1).
- El token de 1msg y el `JWT_SECRET` jamás se loguean ni salen al frontend.
- Nada de `console.log` en producción: usar `src/utils/logger.js`.
- Roles: `administrador` (ve todo, filtra por agente) y `asesor` (mías + general).
- Tests con el runner nativo: `node --test` (sin dependencias nuevas de test).

---

### Task 1: Dependencias y variables de entorno para JWT

**Files:**
- Modify: `package.json` (dependencias)
- Modify: `src/config/env.js`
- Modify: `.env.example`

**Interfaces:**
- Produces: `env.jwt = { secret: string, expiresIn: string }`

- [ ] **Step 1: Instalar dependencias**

Run: `npm install jsonwebtoken bcryptjs`
Expected: se agregan a `dependencies` sin errores.

- [ ] **Step 2: Agregar JWT a la validación de env**

En `src/config/env.js`, añadir `'JWT_SECRET'` al array `REQUERIDAS` y agregar al objeto `env` congelado:

```js
  jwt: Object.freeze({
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES || '12h',
  }),
```

- [ ] **Step 3: Documentar en `.env.example`**

Agregar al final de `.env.example`:

```
# --- Autenticación de la bandeja (Fase 2) ---
JWT_SECRET=
JWT_EXPIRES=12h
```

- [ ] **Step 4: Verificar arranque**

Run: `JWT_SECRET=x DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=x ONEMSG_INSTANCE_ID=x ONEMSG_TOKEN=x WEBHOOK_SECRET=x node -e "console.log(require('./src/config/env').jwt.expiresIn)"`
Expected: imprime `12h`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/config/env.js .env.example
git commit -m "feat(auth): dependencias y env para JWT (fase 2)"
```

---

### Task 2: Utilidad JWT

**Files:**
- Create: `src/utils/jwt.js`
- Test: `test/jwt.test.js`

**Interfaces:**
- Produces: `firmar(payload: object): string`, `verificar(token: string): object` (lanza si es inválido/expirado).

- [ ] **Step 1: Escribir el test que falla**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { firmar, verificar } = require('../src/utils/jwt');

test('firmar y verificar devuelve el payload', () => {
  const token = firmar({ id: 1, rol: 'administrador' });
  const dec = verificar(token);
  assert.equal(dec.id, 1);
  assert.equal(dec.rol, 'administrador');
});

test('verificar lanza con token inválido', () => {
  assert.throws(() => verificar('no-es-un-token'));
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `JWT_SECRET=test_secret <resto de env dummy> node --test test/jwt.test.js`
Expected: FAIL (`Cannot find module '../src/utils/jwt'`).

- [ ] **Step 3: Implementar**

`src/utils/jwt.js`:

```js
'use strict';
const jwt = require('jsonwebtoken');
const env = require('../config/env');

function firmar(payload) {
  return jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
}
function verificar(token) {
  return jwt.verify(token, env.jwt.secret);
}
module.exports = { firmar, verificar };
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `JWT_SECRET=test_secret <env dummy> node --test test/jwt.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/jwt.js test/jwt.test.js
git commit -m "feat(auth): utilidad de firma/verificación JWT"
```

---

### Task 3: Servicio de autenticación

**Files:**
- Create: `src/services/auth.js`
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: `Agente` (modelo Fase 1), `sequelize` (raw query a `serfuweb.usuarios`), `bcryptjs`.
- Produces: `autenticar(usuario: string, clave: string, deps?): Promise<{agente, usuarioSerfuweb}|null>`. `deps` permite inyectar `buscarUsuario`, `buscarAgente`, `comparar` para tests.

- [ ] **Step 1: Escribir el test que falla**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { autenticar } = require('../src/services/auth');

const hash = bcrypt.hashSync('secreto', 10);
const deps = (over = {}) => ({
  buscarUsuario: async () => ({ id: 9, email: 'ssuarez', activo: 1, password: hash }),
  buscarAgente: async () => ({ id: 2, usuarioId: 9, usuario: 'ssuarez', rol: 'administrador', activo: true }),
  comparar: bcrypt.compare,
  ...over,
});

test('credenciales válidas → devuelve el agente', async () => {
  const r = await autenticar('ssuarez', 'secreto', deps());
  assert.equal(r.agente.id, 2);
});
test('clave incorrecta → null', async () => {
  assert.equal(await autenticar('ssuarez', 'mala', deps()), null);
});
test('usuario válido pero sin fila en wa_agentes → null', async () => {
  assert.equal(await autenticar('otro', 'secreto', deps({ buscarAgente: async () => null })), null);
});
test('usuario inactivo en serfuweb → null', async () => {
  assert.equal(await autenticar('x', 'secreto', deps({ buscarUsuario: async () => ({ id: 1, activo: 0, password: hash }) })), null);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `<env dummy> node --test test/auth.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

`src/services/auth.js`:

```js
'use strict';
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');
const { Agente } = require('../models');

async function buscarUsuarioSerfuweb(usuario) {
  const [rows] = await sequelize.query(
    'SELECT id, email, nombre, apellido, password, activo FROM serfuweb.usuarios WHERE email = ? LIMIT 1',
    { replacements: [usuario] },
  );
  return rows[0] || null;
}

async function autenticar(usuario, clave, deps = {}) {
  const buscarUsuario = deps.buscarUsuario || buscarUsuarioSerfuweb;
  const buscarAgente = deps.buscarAgente || ((usuarioId) => Agente.findOne({ where: { usuarioId } }));
  const comparar = deps.comparar || bcrypt.compare;

  const u = await buscarUsuario(usuario);
  if (!u || !u.activo) return null;
  const ok = await comparar(clave, u.password || '');
  if (!ok) return null;
  const agente = await buscarAgente(u.id);
  if (!agente || !agente.activo) return null;
  return { agente, usuarioSerfuweb: u };
}

module.exports = { autenticar, buscarUsuarioSerfuweb };
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `<env dummy> node --test test/auth.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/auth.js test/auth.test.js
git commit -m "feat(auth): servicio de autenticación contra serfuweb + wa_agentes"
```

---

### Task 4: Middleware de autenticación y rol

**Files:**
- Create: `src/middlewares/auth.js`
- Test: `test/middleware-auth.test.js`

**Interfaces:**
- Consumes: `verificar` (utils/jwt).
- Produces: `requireAuth(req,res,next)` (setea `req.agente`), `requireAdmin(req,res,next)`.

- [ ] **Step 1: Escribir el test que falla**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { firmar } = require('../src/utils/jwt');
const { requireAuth, requireAdmin } = require('../src/middlewares/auth');

function resFalso() {
  return { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test('sin header → 401', () => {
  const res = resFalso(); let siguiente = false;
  requireAuth({ get: () => '' }, res, () => { siguiente = true; });
  assert.equal(res.code, 401); assert.equal(siguiente, false);
});
test('con token válido → next y req.agente', () => {
  const token = firmar({ id: 2, rol: 'administrador' });
  const req = { get: () => `Bearer ${token}` }; const res = resFalso(); let siguiente = false;
  requireAuth(req, res, () => { siguiente = true; });
  assert.equal(siguiente, true); assert.equal(req.agente.id, 2);
});
test('requireAdmin bloquea a asesor con 403', () => {
  const res = resFalso(); let siguiente = false;
  requireAdmin({ agente: { rol: 'asesor' } }, res, () => { siguiente = true; });
  assert.equal(res.code, 403); assert.equal(siguiente, false);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `JWT_SECRET=test_secret <env dummy> node --test test/middleware-auth.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

`src/middlewares/auth.js`:

```js
'use strict';
const { verificar } = require('../utils/jwt');
const { ROL_AGENTE } = require('../config/constants');

function requireAuth(req, res, next) {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no autenticado' });
  try {
    req.agente = verificar(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'token inválido o expirado' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.agente || req.agente.rol !== ROL_AGENTE.ADMINISTRADOR) {
    return res.status(403).json({ error: 'requiere rol administrador' });
  }
  return next();
}

module.exports = { requireAuth, requireAdmin };
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `JWT_SECRET=test_secret <env dummy> node --test test/middleware-auth.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/middlewares/auth.js test/middleware-auth.test.js
git commit -m "feat(auth): middleware requireAuth/requireAdmin"
```

---

### Task 5: Rutas y controlador de auth (login, me)

**Files:**
- Create: `src/controllers/authController.js`
- Create: `src/routes/api.js`
- Modify: `src/routes/index.js` (montar `/api`)

**Interfaces:**
- Consumes: `autenticar` (services/auth), `firmar` (utils/jwt), `requireAuth`.
- Produces: `POST /api/auth/login` → `{ token, agente }`; `GET /api/auth/me` → `{ agente }`.

- [ ] **Step 1: Implementar el controlador**

`src/controllers/authController.js`:

```js
'use strict';
const { autenticar } = require('../services/auth');
const { firmar } = require('../utils/jwt');
const logger = require('../utils/logger');

async function login(req, res) {
  const { usuario, clave } = req.body || {};
  if (!usuario || !clave) return res.status(400).json({ error: 'usuario y clave requeridos' });
  let r;
  try {
    r = await autenticar(usuario, clave);
  } catch (err) {
    logger.error(`error autenticando ${usuario}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
  if (!r) {
    logger.warn(`login fallido para ${usuario} desde ${req.ip}`);
    return res.status(401).json({ error: 'credenciales inválidas' });
  }
  const a = r.agente;
  const token = firmar({ id: a.id, usuarioId: a.usuarioId, usuario: a.usuario, nombre: a.nombre, rol: a.rol });
  return res.json({
    token,
    agente: { id: a.id, usuario: a.usuario, nombre: a.nombre, rol: a.rol, firma: a.firma },
  });
}

function me(req, res) {
  return res.json({ agente: req.agente });
}

module.exports = { login, me };
```

- [ ] **Step 2: Crear el router `/api`**

`src/routes/api.js`:

```js
'use strict';
const { Router } = require('express');
const { requireAuth } = require('../middlewares/auth');
const authCtrl = require('../controllers/authController');

const router = Router();
router.post('/auth/login', authCtrl.login);
router.get('/auth/me', requireAuth, authCtrl.me);

module.exports = router;
```

- [ ] **Step 3: Montar `/api` en el índice de rutas**

En `src/routes/index.js`, añadir junto a las demás:

```js
const api = require('./api');
// ...
router.use('/api', api);
```

- [ ] **Step 4: Verificación manual local**

Con el server corriendo (`npm start`) y un `.env` completo (incluido `JWT_SECRET`):

Run: `curl -s -X POST localhost:3000/api/auth/login -H 'content-type: application/json' -d '{"usuario":"bortega","clave":"<clave real>"}'`
Expected: JSON con `token` y `agente.rol = "administrador"`. Con clave errónea → 401.

Run: `curl -s localhost:3000/api/auth/me -H "Authorization: Bearer <token>"`
Expected: `{ "agente": { "id":1, "rol":"administrador", ... } }`.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/authController.js src/routes/api.js src/routes/index.js
git commit -m "feat(auth): rutas /api/auth/login y /api/auth/me"
```

---

### Task 6: Servicio de conversaciones (filtro por rol + listado)

**Files:**
- Create: `src/services/conversaciones.js`
- Test: `test/conversaciones-filtro.test.js`

**Interfaces:**
- Consumes: `Conversacion`, `Contacto` (modelos), `Op`, constantes.
- Produces: `construirFiltro({bandeja, agenteSolicitante, agenteFiltro}): objetoWhere` (lanza `Error` con `.status=403` si un no-admin pide `todos`); `listar({...}): Promise<{total, pagina, conversaciones}>`; `puedeVer(agente, conv): boolean`.

- [ ] **Step 1: Escribir el test que falla (solo lógica pura del filtro)**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { construirFiltro, puedeVer } = require('../src/services/conversaciones');

const admin = { id: 1, rol: 'administrador' };
const asesor = { id: 2, rol: 'asesor' };

test('mías → filtra por el agente solicitante', () => {
  assert.deepEqual(construirFiltro({ bandeja: 'mias', agenteSolicitante: asesor }).agenteId, 2);
});
test('general → agenteId null', () => {
  const w = construirFiltro({ bandeja: 'general', agenteSolicitante: asesor });
  assert.equal(w.agenteId, null);
});
test('todos como asesor → lanza 403', () => {
  assert.throws(() => construirFiltro({ bandeja: 'todos', agenteSolicitante: asesor }), (e) => e.status === 403);
});
test('todos como admin con filtro de agente', () => {
  assert.equal(construirFiltro({ bandeja: 'todos', agenteSolicitante: admin, agenteFiltro: 5 }).agenteId, 5);
});
test('puedeVer: asesor ve las suyas y las de general, no las de otro', () => {
  assert.equal(puedeVer(asesor, { agenteId: 2 }), true);
  assert.equal(puedeVer(asesor, { agenteId: null }), true);
  assert.equal(puedeVer(asesor, { agenteId: 3 }), false);
  assert.equal(puedeVer(admin, { agenteId: 3 }), true);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `<env dummy> node --test test/conversaciones-filtro.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

`src/services/conversaciones.js`:

```js
'use strict';
const { Op } = require('sequelize');
const { Conversacion, Contacto } = require('../models');
const { ESTADO_CONVERSACION, ROL_AGENTE } = require('../config/constants');

const ABIERTAS = [ESTADO_CONVERSACION.NUEVA, ESTADO_CONVERSACION.ABIERTA, ESTADO_CONVERSACION.PENDIENTE];

function construirFiltro({ bandeja = 'mias', agenteSolicitante, agenteFiltro = null }) {
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
  } else {
    where.agenteId = agenteSolicitante.id;
  }
  return where;
}

function puedeVer(agente, conv) {
  if (agente.rol === ROL_AGENTE.ADMINISTRADOR) return true;
  return conv.agenteId === agente.id || conv.agenteId === null;
}

async function listar({ bandeja = 'mias', agenteSolicitante, agenteFiltro = null, q = null, pagina = 0, tam = 25 }) {
  const where = construirFiltro({ bandeja, agenteSolicitante, agenteFiltro });
  const orden = bandeja === 'general'
    ? [['ultimoMensajeEn', 'ASC']]
    : [['ultimoMensajeEn', 'DESC']];
  const contacto = {
    model: Contacto,
    as: 'contacto',
    required: true,
    attributes: ['id', 'waId', 'telefono', 'nombreWa', 'nombreDisplay'],
  };
  if (q) {
    contacto.where = {
      [Op.or]: [
        { nombreDisplay: { [Op.like]: `%${q}%` } },
        { nombreWa: { [Op.like]: `%${q}%` } },
        { telefono: { [Op.like]: `%${q}%` } },
      ],
    };
  }
  const { rows, count } = await Conversacion.findAndCountAll({
    where,
    include: [contacto],
    order: orden,
    limit: tam,
    offset: pagina * tam,
  });
  return { total: count, pagina, conversaciones: rows };
}

module.exports = { construirFiltro, puedeVer, listar };
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `<env dummy> node --test test/conversaciones-filtro.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/conversaciones.js test/conversaciones-filtro.test.js
git commit -m "feat(bandeja): servicio de conversaciones con filtro por rol"
```

---

### Task 7: Rutas de bandeja (listar, mensajes, marcar leído)

**Files:**
- Create: `src/controllers/conversacionesController.js`
- Modify: `src/routes/api.js` (agregar rutas de conversaciones)

**Interfaces:**
- Consumes: `listar`, `puedeVer` (services/conversaciones), `Conversacion`, `Mensaje`, `Op`, `requireAuth`.
- Produces: `GET /api/conversaciones`, `GET /api/conversaciones/:id/mensajes`, `POST /api/conversaciones/:id/leer`.

- [ ] **Step 1: Implementar el controlador**

`src/controllers/conversacionesController.js`:

```js
'use strict';
const { Op } = require('sequelize');
const { Conversacion, Mensaje } = require('../models');
const { listar, puedeVer } = require('../services/conversaciones');
const logger = require('../utils/logger');

async function accesible(req, res) {
  const conv = await Conversacion.findByPk(req.params.id);
  if (!conv) { res.status(404).json({ error: 'no encontrada' }); return null; }
  if (!puedeVer(req.agente, conv)) { res.status(403).json({ error: 'sin acceso' }); return null; }
  return conv;
}

async function listarHandler(req, res) {
  try {
    const r = await listar({
      bandeja: req.query.bandeja,
      agenteSolicitante: req.agente,
      agenteFiltro: req.query.agente ? Number(req.query.agente) : null,
      q: req.query.q || null,
      pagina: Number(req.query.pagina) || 0,
    });
    return res.json(r);
  } catch (err) {
    logger.error(`listar conversaciones: ${err.message}`);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

async function mensajes(req, res) {
  const conv = await accesible(req, res);
  if (!conv) return undefined;
  const where = { conversacionId: conv.id };
  if (req.query.antesDe) where.id = { [Op.lt]: Number(req.query.antesDe) };
  const filas = await Mensaje.findAll({ where, order: [['tsProveedor', 'DESC'], ['id', 'DESC']], limit: 30 });
  return res.json({ mensajes: filas.reverse() });
}

async function leer(req, res) {
  const conv = await accesible(req, res);
  if (!conv) return undefined;
  await Conversacion.update({ noLeidos: 0 }, { where: { id: conv.id } });
  return res.json({ ok: true });
}

module.exports = { listarHandler, mensajes, leer };
```

- [ ] **Step 2: Registrar las rutas**

En `src/routes/api.js`, añadir tras las de auth:

```js
const convCtrl = require('../controllers/conversacionesController');
router.get('/conversaciones', requireAuth, convCtrl.listarHandler);
router.get('/conversaciones/:id/mensajes', requireAuth, convCtrl.mensajes);
router.post('/conversaciones/:id/leer', requireAuth, convCtrl.leer);
```

- [ ] **Step 3: Verificación manual local**

Con el server corriendo y un token válido de la Task 5:

Run: `curl -s "localhost:3000/api/conversaciones?bandeja=mias" -H "Authorization: Bearer <token>"`
Expected: `{ total, pagina, conversaciones: [ { id, agenteId, contacto: {...} }, ... ] }` (las de ese agente).

Run: `curl -s "localhost:3000/api/conversaciones/<id>/mensajes" -H "Authorization: Bearer <token>"`
Expected: `{ mensajes: [ ... ] }` en orden ascendente por `ts_proveedor`.

Run (como asesor pidiendo todos): debe responder 403.

- [ ] **Step 4: Correr toda la suite de tests**

Run: `<env dummy> node --test`
Expected: PASS de toda la suite (normalizador + jwt + auth + middleware + filtro).

- [ ] **Step 5: Commit**

```bash
git add src/controllers/conversacionesController.js src/routes/api.js
git commit -m "feat(bandeja): rutas de listar/mensajes/leer conversaciones"
```

---

### Task 8: Verificación en el servidor (staging real)

**Files:** (ninguno — validación)

- [ ] **Step 1: Desplegar y probar contra datos reales**

```bash
# local
git push origin main
# server
ssh mantix 'cd ~/apps/wa && GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes" git pull -q && npm ci && pm2 restart wa-backend'
```

- [ ] **Step 2: Login real + listar**

Desde el server (o vía el túnel), hacer login con `bortega` y su clave real; con el token, `GET /api/conversaciones?bandeja=mias` debe devolver las conversaciones que la regla temporal le fue asignando, y `?bandeja=todos` (admin) el total. Confirmar que un token de asesor no puede ver `todos`.

- [ ] **Step 3: Cerrar Plan 1**

Marcar el hito: el backend de auth + lectura está funcionando en producción. Siguiente plan: **frontend (scaffold Vue + login + lista + ver chat)** consumiendo esta API.

---

## Notas de cobertura del spec (Plan 1)

Cubre del spec: §2 (auth contra serfuweb + roles), §5 endpoints de auth, listar conversaciones, mensajes y leer, §7 (JWT, autorización por rol). **Fuera de este plan** (planes siguientes): envío, tomar/asignar, notas/etiquetas, plantillas, tiempo real (Socket.io), marcar-no-leído, y todo el frontend.
