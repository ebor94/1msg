# Etiquetado de conversaciones + estadísticas por origen e interés

Fecha: 2026-07-31
Estado: aprobado (diseño), pendiente de plan de implementación

## Problema

Los administradores necesitan **estadísticas del origen** de los chats que ingresan
(cuántos por la página web, cuántos por otros orígenes) y del **interés / línea de
negocio** que motiva cada chat (prenecesidad, mantenimiento, previsión…). Hoy no hay
forma de marcar ni de contar esto.

## Contexto: infraestructura ya existente

El esquema **ya trae** el modelo de etiquetas, sin uso hasta ahora:

- `wa_etiquetas` — catálogo: `id`, `nombre` (único), `color`, `activa`.
- `wa_conversacion_etiqueta` — join N–M: `conversacion_id`, `etiqueta_id`,
  `agente_id`, `creado_en`. Soporta **múltiples etiquetas por chat** y ya registra
  **quién** etiquetó y **cuándo** (base de las estadísticas).
- Modelos Sequelize `Etiqueta` y `ConversacionEtiqueta` y las asociaciones
  `Conversacion.belongsToMany(Etiqueta, { as: 'etiquetas' })` ya están definidas en
  `src/models/index.js`.

No hay que rehacer nada de fondo. Falta: agrupar etiquetas en dimensiones, exponer la
UI de marcado y construir el endpoint de estadísticas.

## Decisiones tomadas

1. **Origen = manual.** No hay señal técnica fiable de "página web"; el agente conoce
   el origen por el contexto del cliente y lo marca a mano. **Cero cambios en el
   worker**, no se parsea `referral` ni el texto del primer mensaje.
2. **Cardinalidad: 1 origen + varios intereses.** Cada chat tiene un único origen
   (para que "chats por origen" cuente cada chat una sola vez) y puede tener varios
   intereses.
3. **Reutilizar `wa_etiquetas` / `wa_conversacion_etiqueta`.** Se distinguen las dos
   dimensiones con una columna `categoria` en el catálogo. No se crean tablas nuevas.
4. **Eje temporal de la estadística: `creado_en` de la conversación** (fecha en que
   ingresó el chat), no la fecha en que se puso la etiqueta. Responde directo a "de los
   chats que ingresaron en el periodo, cuántos por cada origen/interés".

## Arquitectura

### 1. Modelo de datos

Migración `docs/migraciones/004-etiquetas-categoria.sql`:

```sql
ALTER TABLE wa_etiquetas
  ADD COLUMN categoria ENUM('origen','interes') NOT NULL DEFAULT 'interes' AFTER nombre,
  ADD COLUMN orden     TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER activa;
```

- `wa_conversacion_etiqueta` **no cambia**.
- `src/models/Etiqueta.js`: agregar los campos `categoria` y `orden`.
- Semilla del catálogo inicial (INSERTs idempotentes por `nombre` único) en la misma
  migración.

**Catálogo semilla** (aprobado) — son solo **valores iniciales**. Todo el catálogo es
**dinámico**: el admin puede crear, renombrar, recolorear, reordenar y desactivar
etiquetas desde la UI (ver §4). No hay valores "quemados" en código: el `origen` y el
`interes` viven en `wa_etiquetas`, no en un ENUM de la conversación.

| Origen | Interés |
|---|---|
| Página web | Prenecesidad |
| Mostrador / oficina | Mantenimiento |
| Referido | Previsión (planes) |
| Redes sociales | Cartera / pagos |
| Publicidad / volante | Servicio inmediato (necesidad) |
| Llamada / telemercadeo | PQR / reclamo |
| Otro | Información general |

Cada fila lleva un `color` distinto y un `orden` para el despliegue.

### 2. Servicio de etiquetado

`src/services/etiquetas.js` (nuevo):

- `listarCatalogo()` → etiquetas activas agrupadas por `categoria`, ordenadas por
  `orden, nombre`.
- `etiquetarConversacion(convId, etiquetaId, agenteId)`:
  - Carga la etiqueta; valida que exista y esté activa.
  - Si `categoria = 'origen'`: en una **transacción**, borra cualquier fila de
    `wa_conversacion_etiqueta` de ese chat cuya etiqueta sea de categoría `origen`
    (regla "1 origen") y luego inserta la nueva. Idempotente si ya estaba.
  - Si `categoria = 'interes'`: upsert de la fila (no duplica por PK compuesta).
  - Registra `agente_id = agenteId` y `creado_en`.
- `desetiquetarConversacion(convId, etiquetaId)` → borra la fila.
- `estadisticas({ desde, hasta, categoria })`:
  - JOIN `wa_conversacion_etiqueta` × `wa_etiquetas` × `wa_conversaciones`.
  - Filtra por `wa_conversaciones.creado_en` en `[desde, hasta]`.
  - Filtra por `categoria` si se envía.
  - Agrupa por etiqueta → `{ etiqueta_id, nombre, categoria, color, total }`.

### 3. Endpoints (Express)

En `src/routes/api.js`:

```
GET    /etiquetas                                requireAuth            catálogo activo agrupado
POST   /conversaciones/:id/etiquetas             requireAuth            body { etiquetaId }
DELETE /conversaciones/:id/etiquetas/:etiquetaId requireAuth
GET    /etiquetas/estadisticas                   requireAuth+requireAdmin  ?desde=&hasta=&categoria=
POST   /etiquetas                                requireAuth+requireAdmin  crear (body: nombre, categoria, color)
PATCH  /etiquetas/:id                            requireAuth+requireAdmin  renombrar / color / activa / orden
```

- Controlador `src/controllers/etiquetasController.js` (nuevo) para el catálogo y las
  estadísticas.
- El marcar/desmarcar por conversación va en `conversacionesController` (junto a las
  demás acciones de conversación) o en el mismo `etiquetasController`; se decide en el
  plan. Cualquier agente autenticado puede etiquetar; solo admin ve estadísticas y
  gestiona el catálogo.
- Las **etiquetas actuales del chat** se incluyen en el payload de la conversación (el
  endpoint que hoy carga la conversación / sus mensajes) para que la UI las pinte sin
  una llamada extra.

### 4. Frontend (Vue 3)

- **Marcado** — en `PanelCliente.vue`, sección "Etiquetas" bajo los botones de consulta
  existentes:
  - Origen: chips de selección única (comportamiento radio).
  - Interés: chips de selección múltiple (toggle on/off).
  - Store `acciones.js`: `cargarEtiquetas` (catálogo, una vez), `etiquetarConversacion`,
    `desetiquetarConversacion`. Estado optimista con reversión si el request falla.
- **Indicador** (opcional, incluido): un punto de color del origen en
  `ItemConversacion.vue`.
- **Estadísticas** — vista admin tipo modal (mismo patrón que `PanelAgentes.vue`):
  - Filtro de rango de fechas (por defecto el mes actual).
  - Tabla de conteos por etiqueta, separada por Origen / Interés, con el color.
  - CSV/export queda fuera de alcance (se añade después si lo piden).
- **Gestión del catálogo (admin)** — dentro de la misma vista de admin, una pestaña o
  sección para administrar el catálogo de forma dinámica: listar todas las etiquetas
  (activas e inactivas), crear una nueva (nombre, categoría, color), renombrar,
  cambiar color, reordenar (`orden`) y desactivar/reactivar (`activa`). Se apoya en
  `POST /etiquetas` y `PATCH /etiquetas/:id`. Desactivar (no borrar) preserva el
  histórico: las etiquetas ya aplicadas siguen contando en estadísticas aunque la
  etiqueta deje de ofrecerse para marcar chats nuevos.

## Flujo de datos

1. Entra un chat → cae en general o al agente dueño (sin cambios).
2. El agente abre el chat, marca **1 origen** y los **intereses** que apliquen.
3. Cada marca es un `POST /conversaciones/:id/etiquetas`; el servicio inserta en
   `wa_conversacion_etiqueta` con `agente_id` y `creado_en`. La regla "1 origen"
   reemplaza el origen anterior.
4. El admin abre la vista de estadísticas, elige rango → `GET /etiquetas/estadisticas`
   agrupa los chats **ingresados** en ese rango por etiqueta.

## Manejo de errores

- Etiqueta inexistente o inactiva → 404 / 422.
- Conversación inexistente → 404.
- `POST` de una etiqueta de origen ya presente → idempotente (200, sin duplicar).
- Rango de fechas inválido en estadísticas → 400.
- El etiquetado nunca bloquea el envío/recepción de mensajes: es una acción
  independiente de la mensajería.

## Pruebas

- **Backend (node --test):**
  - `etiquetarConversacion` con categoría `origen` reemplaza el origen previo (queda 1).
  - `etiquetarConversacion` con `interes` acumula varios.
  - Idempotencia: marcar dos veces la misma etiqueta no duplica.
  - `desetiquetarConversacion` borra solo la fila indicada.
  - `estadisticas` cuenta por `conversaciones.creado_en` dentro del rango y respeta
    `categoria`.
  - Autorización: estadísticas y CRUD de catálogo exigen admin.
- **Frontend:** el selector de origen es de una sola opción; los intereses son
  múltiples; reversión optimista ante fallo del request.

## Fuera de alcance

- Auto-detección de origen (referral de Meta, parseo del primer mensaje).
- Etiquetado automático por reglas.
- Export CSV/Excel de estadísticas.
- Gráficas; por ahora solo tabla de conteos.

## Despliegue

1. Aplicar `004-etiquetas-categoria.sql` en el servidor (`mysql < ...`).
2. `git pull` + `npm --prefix frontend run build`.
3. `pm2 restart wa-backend` (no toca ingesta, `wa-worker` no requiere reinicio).
