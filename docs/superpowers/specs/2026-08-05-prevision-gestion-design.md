# Registrar gestión de planes de previsión (cartera)

Fecha: 2026-08-05
Estado: aprobado (diseño)

## Problema

Cartera registra la gestión de cobro de los planes de previsión desde una página PHP
legada (actualiza `plan` + traza en `gestion`, en la BD `olivosct`). Se quiere hacer ese
**registro de gestión desde la bandeja**, sobre el plan que el agente está consultando.

## Contexto

- La integración de previsión (`src/integrations/prevision/cliente.js`) conecta a
  `olivosct` (MySQL 5.0, 192.9.17.11) vía `mysql2`, hoy **solo lectura**.
- Usuario BD: `wa_lector@192.9.17.30` (hoy `SELECT` global).
- Tablas relevantes (columnas verificadas en vivo):
  - `plan`: `num_plan`, `ced_pagador`, `novedad_plan`, `concepto_plan`,
    `fech_gestion_plan`, `fech_pago_posfecha`.
  - `gestion`: `num_plan`, `novedad`, `fecha`, `hora`, `concepto`, `tramito`.
  - `conceptos_permitidos`: `codigo_concepto` (varchar, UNIQUE), `descripcion` — 39
    conceptos curados (subconjunto de los 58 de `concepto`).

## Prerrequisito de despliegue: GRANT de escritura (mínimo privilegio)

Ejecutar en `olivosct` como root/DBA **antes** de que la feature funcione:

```sql
GRANT UPDATE (novedad_plan, concepto_plan, fech_gestion_plan, fech_pago_posfecha) ON olivosct.plan TO 'wa_lector'@'192.9.17.30';
GRANT INSERT ON olivosct.gestion TO 'wa_lector'@'192.9.17.30';
FLUSH PRIVILEGES;
```

Solo se pueden actualizar **esas 4 columnas** de `plan` (nunca montos/estado) e insertar
en `gestion`. Sin el GRANT, la escritura falla y el endpoint responde 502.

## Reglas de negocio (réplica del PHP, endurecida)

Entrada: `numPlan`, `concepto` (código), `novedad` (texto, opcional), `posfecha`
(YYYY-MM-DD, opcional). `tramito` = **nombre del agente WA** (`wa_agentes.nombre`, del JWT).

1. **es_masivo** = `posfecha` presente **Y** `concepto` está en `conceptos_permitidos`
   (`SELECT COUNT(*) FROM conceptos_permitidos WHERE codigo_concepto = ?` > 0).
2. **Masivo** → `UPDATE plan SET novedad_plan=?, concepto_plan=?, fech_gestion_plan=CURDATE(),
   fech_pago_posfecha=? WHERE ced_pagador = ?` (el `ced_pagador` se saca de
   `SELECT ced_pagador FROM plan WHERE num_plan = ?`). Afecta **todos los planes de esa
   cédula**.
3. **Individual** (resto) → `UPDATE plan SET novedad_plan=?, concepto_plan=?,
   fech_gestion_plan=CURDATE() [, fech_pago_posfecha=?] WHERE num_plan = ?` (la posfecha
   solo si vino).
4. **Traza**: si `concepto !== '5'` (Camb PFecha) →
   `INSERT INTO gestion (num_plan, novedad, fecha, hora, concepto, tramito)
    VALUES (?, ?, CURDATE(), CURTIME(), ?, ?)`.
5. Todo lo anterior en **una transacción** (UPDATE + INSERT atómicos); parametrizado
   (`?`), sin interpolar valores (el PHP era vulnerable a inyección).

Si el `numPlan` no existe → error (no se encontró el plan). Devuelve
`{ ok:true, masivo, afectados }` (`afectados` = filas de `plan` actualizadas).

## Arquitectura

### Backend — integración (`src/integrations/prevision/cliente.js`)

- `listarConceptosPermitidos()` → `SELECT codigo_concepto, descripcion FROM
  conceptos_permitidos ORDER BY descripcion` (para el desplegable).
- `registrarGestion({ numPlan, concepto, novedad, posfecha, tramito })`:
  - Toma una conexión del pool, `beginTransaction`.
  - Calcula `es_masivo` y ejecuta el UPDATE correspondiente; hace el INSERT en `gestion`
    salvo `concepto === '5'`; `commit` (o `rollback` + rethrow en error).
  - Devuelve `{ masivo, afectados }`.
  - Si el pool no está configurado → error `codigo:'no_configurado'`.

### Backend — endpoints

- `GET /api/prevision/conceptos` (requireAuth) → `{ conceptos: [{codigo, descripcion}] }`.
- `POST /api/prevision/gestion` (requireAuth) — body `{ numPlan, concepto, novedad, posfecha }`.
  - `numPlan` y `concepto` requeridos (400 si faltan); `posfecha` opcional (valida
    `YYYY-MM-DD` si viene → 400 si mal formada).
  - `tramito = req.agente.nombre`.
  - Llama a `registrarGestion`; 503 si `no_configurado`, 502 si otro error de BD,
    `{ ok:true, masivo, afectados }` si OK.

**Controlador** `src/controllers/previsionController.js` (nuevo, delgado) o handlers en
`contactosController` — se decide en el plan (preferible un controlador propio por
claridad). Ruta standalone `/prevision/...` (la gestión es sobre un plan, no un contacto).

### Frontend

- En el **popup de Previsión** de `PanelCliente.vue`, sobre el plan seleccionado
  (`planSel`), una sección **"Registrar gestión"**:
  - Desplegable de **concepto** (de `GET /prevision/conceptos`).
  - **Novedad** (texto).
  - **Posfecha** (date, opcional).
  - Botón **Registrar**.
  - **Aviso de masivo**: si la cédula tiene **más de un plan** (`prev.planes.length > 1`)
    y (concepto permitido + posfecha) → mostrar "Esto actualizará los N planes de la
    cédula", para que el agente confirme antes de enviar.
  - Al registrar: éxito → mensaje "Gestión registrada" (+ "en N planes" si masivo);
    error → mensaje del backend.
- **Store** `acciones.js`: `cargarConceptosPrevision()`, `registrarGestionPrevision(payload)`.

## Manejo de errores

- Faltan `numPlan`/`concepto` → 400; `posfecha` mal formada → 400.
- Plan inexistente → 404/502 con mensaje claro.
- Sin GRANT / fallo de escritura → 502 (la BD rechaza; se loguea el detalle).
- `no_configurado` → 503.

## Pruebas

- **Backend (`node --test`, funciones puras)** `test/prevision-gestion.test.js`:
  - `decidirMasivo(posfecha, enPermitidos)` → true solo si ambos; false si falta alguno.
  - `debeRegistrarGestion(concepto)` → false si `'5'`, true en otro caso.
  - (La ejecución SQL con transacción se verifica en vivo con un plan de prueba tras el
    GRANT — como el resto de integraciones externas.)
- Frontend: sin harness de componentes; build + verificación manual.

## Seguridad / cuidado

- Escritura **parametrizada** y **transaccional**; GRANT de columnas mínimas.
- El masivo hace un UPDATE amplio (`WHERE ced_pagador`) — se avisa en la UI y se registra
  quién lo hizo (`gestion.tramito`).
- Se mantiene `concepto = '5'` sin traza (regla original).

## Fuera de alcance

- Editar/anular gestiones ya registradas; ver el historial de `gestion` en la bandeja.
- Gestión de mantenimiento/prenecesidad (esto es solo previsión).
- Gestionar conceptos no presentes en `conceptos_permitidos`.

## Despliegue

1. **Aplicar el GRANT** en `olivosct` (prerrequisito).
2. `git pull` + `npm --prefix frontend run build` + `pm2 restart wa-backend`.
3. Verificación en vivo con un `numPlan` de prueba: registrar una gestión individual
   (concepto no masivo, sin posfecha) y confirmar el UPDATE + la fila en `gestion`.
