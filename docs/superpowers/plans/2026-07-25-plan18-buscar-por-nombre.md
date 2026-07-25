# Plan 18 — Buscar por nombre (además de teléfono) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el buscador global (hoy solo por teléfono) también encuentre contactos por nombre, consultando `nombre_wa` y `nombre_display` de `wa_contactos`.

**Architecture:** Se extiende el handler `buscar` (`GET /contactos/buscar`) para aceptar un término genérico `q`: matchea nombre (`nombre_wa`/`nombre_display LIKE %q%`) y/o teléfono (`telefono`/`waId LIKE %dígitos%`). El frontend manda el término crudo y ajusta el placeholder. Todo lo demás del buscador (Plan 11) se conserva.

**Tech Stack:** Express/Sequelize (backend); Vue 3/Pinia (frontend). Sin migración.

## Global Constraints

- El buscador sigue siendo global (cualquier agente) pero devuelve **solo metadatos** (Plan 11); los mensajes siguen protegidos por `puedeVer`.
- Compatibilidad: se acepta `q` (nuevo) y se mantiene el fallback a `telefono` por si algún cliente viejo lo usa.
- LIKE parametrizado por Sequelize (sin inyección). `'use strict'`, sin `console.log`.

## File Structure

- `src/controllers/contactosController.js` (modificar): `buscar` amplía la consulta.
- `frontend/src/stores/busqueda.js` (modificar): manda el término crudo (`?q=`).
- `frontend/src/components/ListaConversaciones.vue` (modificar): placeholder.

---

### Task 1: Backend — `buscar` por nombre o teléfono

**Files:**
- Modify: `src/controllers/contactosController.js`

**Interfaces:**
- `GET /api/contactos/buscar?q=TERM` → busca por nombre (`nombre_wa`/`nombre_display`) y/o teléfono (`telefono`/`waId`). Mantiene `?telefono=` como alias.

- [ ] **Step 1: Ampliar el handler `buscar`**

Reemplazar el inicio del handler (la parte que arma `where`) por:

```js
async function buscar(req, res) {
  const q = String(req.query.q ?? req.query.telefono ?? '').trim();
  const digitos = soloDigitos(q);
  const condiciones = [];
  if (q.length >= 2) {
    condiciones.push({ nombreDisplay: { [Op.like]: `%${q}%` } });
    condiciones.push({ nombreWa: { [Op.like]: `%${q}%` } });
  }
  if (digitos.length >= 3) {
    condiciones.push({ telefono: { [Op.like]: `%${digitos}%` } });
    condiciones.push({ waId: { [Op.like]: `%${digitos}%` } });
  }
  if (!condiciones.length) return res.json({ resultados: [] });
  try {
    const contactos = await Contacto.findAll({
      where: { [Op.or]: condiciones },
      attributes: ['id', 'waId', 'telefono', 'nombreWa', 'nombreDisplay'],
      limit: 10,
    });
    // ... (el resto del handler —construcción de resultados con la conversación
    //      y construirResultado— NO cambia)
```

(El bucle que arma `resultados` con `Conversacion.findOne` + `construirResultado` y el `return res.json({ resultados })` quedan igual.)

- [ ] **Step 2: Verificar carga + suite**

```
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node -e "require('./src/routes'); console.log('rutas OK')"
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js
```
Expected: "rutas OK" y suite verde (el helper puro `construirResultado` no cambia). Se valida en la prueba real.

- [ ] **Step 3: Commit**

```bash
git add src/controllers/contactosController.js
git commit -m "feat(buscador): buscar contactos por nombre (nombre_wa/nombre_display) además de teléfono"
```

---

### Task 2: Frontend — término crudo + placeholder

**Files:**
- Modify: `frontend/src/stores/busqueda.js`
- Modify: `frontend/src/components/ListaConversaciones.vue`

- [ ] **Step 1: Store `busqueda.buscar` manda el término crudo**

Reemplazar `buscar` por:

```js
    async buscar(termino) {
      this.termino = termino;
      const t = termino.trim();
      const digitos = t.replace(/\D/g, '');
      if (t.length < 2 && digitos.length < 3) { this.resultados = []; return; }
      this.buscando = true;
      try {
        const r = await apiFetch(`/contactos/buscar?q=${encodeURIComponent(t)}`);
        // Guard: descarta la respuesta si el término cambió mientras estaba en vuelo.
        if (this.termino.trim() === t) this.resultados = r.resultados;
      } catch {
        this.resultados = [];
      } finally {
        this.buscando = false;
      }
    },
```

- [ ] **Step 2: `ListaConversaciones.vue` — placeholder**

Cambiar el placeholder del input de búsqueda:

```vue
        <input v-model="texto" placeholder="Buscar por nombre o teléfono…"
```

(El resto —debounce, panel de resultados, elegir/tomar/iniciar— NO cambia. La opción "Iniciar chat con {número}" ya se muestra solo cuando `soloDigitos(texto).length >= 10`, así que con un nombre no aparece; correcto.)

- [ ] **Step 3: Verificar suite y build**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: verde y build OK.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/busqueda.js frontend/src/components/ListaConversaciones.vue
git commit -m "feat(frontend): buscar por nombre o teléfono en el mismo cuadro"
```

---

### Task 3: Despliegue + prueba real

- [ ] **Step 1: Deploy.** Merge a `main`, push. En el servidor: `git pull`, `npm --prefix frontend run build`, `pm2 restart wa-backend`. `/health` 200.
- [ ] **Step 2: Prueba real.** (a) Escribir un **nombre** (o parte) en el buscador → aparecen los contactos cuyo `nombre_wa`/`nombre_display` coincide, con su etiqueta Tuyo/General/de-X → abrir/tomar funciona; (b) escribir un **teléfono** → sigue funcionando como antes, incluida la opción "Iniciar chat"; (c) término muy corto → sin resultados.

---

## Notas de cobertura (Plan 18)

Cubre: búsqueda por nombre (`nombre_wa`/`nombre_display`) integrada al buscador global existente, manteniendo la búsqueda por teléfono y todo el flujo del Plan 11 (abrir/tomar/iniciar). Sin migración. **Fuera de alcance:** búsqueda por texto de mensajes, ranking de relevancia.
