# Informe de clasificación de contactos (seguimiento)

Fecha: 2026-08-02
Estado: aprobado (diseño)

## Problema

Se necesita una **lista de contactos filtrable y accionable** para hacer seguimiento:
ver quiénes ingresaron por cada origen/interés, si compraron o no, en qué estado está
su chat, y poder abrir cada uno para actuar (llamar/escribir/marcar ¿compró?).

## Decisiones (aprobadas)

1. **Tipo**: lista de contactos accionable (no dashboard de conteos).
2. **Acceso**: **todos ven todo** (cualquier agente autenticado ve todos los contactos;
   sin distinción de cartera). `requireAuth` sin `requireAdmin`.
3. **Filtros**: ¿Compró? · Origen (etiqueta) · Interés (etiqueta) · Estado del chat ·
   Rango de fechas por **última actividad**.
4. **Ubicación**: **pantalla aparte** (ruta `/informe`), no un modal.
5. **Unidad**: el contacto, representado por su **conversación más reciente** (de ahí
   salen origen/interés/estado/última actividad); ¿compró? y dueño son del contacto.

## Contexto de datos

- `wa_contactos`: `nombre_display`/`nombre_wa`, `telefono`, `agente_dueno_id`, `compro`
  (nuevo: si/no/pendiente/NULL), `desactivado_en`.
- `wa_conversaciones`: `estado` (nueva/abierta/pendiente/cerrada), `ultimo_mensaje_en`,
  `contacto_id`, `id`.
- `wa_conversacion_etiqueta` × `wa_etiquetas`: etiquetas de origen/interés por conversación.
- `wa_agentes`: nombre del dueño.

## Arquitectura

### Backend — `GET /api/contactos/informe` (requireAuth)

Query params (todos opcionales):
- `compro` = `si` | `no` | `pendiente` | `sin` (sin marcar → `compro IS NULL`).
- `origenId` = id de etiqueta (categoría origen).
- `interesId` = id de etiqueta (categoría interés).
- `estado` = `nueva` | `abierta` | `pendiente` | `cerrada` | `sin` (`sin` = contacto sin
  conversación).
- `desde` / `hasta` = rango sobre `ultimo_mensaje_en` (última actividad), formato
  `YYYY-MM-DD` (hasta inclusive → `< hasta + 1 día`).
- `pagina` (0-based), `tam` (default 25, máx 100).

**Consulta**: el contacto se representa por su conversación más reciente vía CTE con
`ROW_NUMBER() OVER (PARTITION BY contacto_id ORDER BY ultimo_mensaje_en DESC, id DESC)`.

```sql
WITH ultima AS (
  SELECT id, contacto_id, estado, ultimo_mensaje_en,
         ROW_NUMBER() OVER (PARTITION BY contacto_id ORDER BY ultimo_mensaje_en DESC, id DESC) AS rn
  FROM wa_conversaciones
)
SELECT c.id AS contacto_id, c.telefono, c.nombre_display, c.nombre_wa, c.compro,
       ad.nombre AS agente_dueno,
       u.id AS conversacion_id, u.estado, u.ultimo_mensaje_en AS ultima_actividad
FROM wa_contactos c
LEFT JOIN ultima u ON u.contacto_id = c.id AND u.rn = 1
LEFT JOIN wa_agentes ad ON ad.id = c.agente_dueno_id
WHERE c.desactivado_en IS NULL
  [AND c.compro = :compro | AND c.compro IS NULL]
  [AND u.estado = :estado | AND u.id IS NULL (estado 'sin')]
  [AND u.ultimo_mensaje_en >= :desde AND u.ultimo_mensaje_en < :hastaExcl]
  [AND EXISTS (SELECT 1 FROM wa_conversacion_etiqueta ce WHERE ce.conversacion_id = u.id AND ce.etiqueta_id = :origenId)]
  [AND EXISTS (... :interesId)]
ORDER BY u.ultimo_mensaje_en IS NULL, u.ultimo_mensaje_en DESC, c.id DESC
LIMIT :tam OFFSET :pagina*:tam
```

- **Total**: `SELECT COUNT(*)` con el mismo `WHERE` (sin `LIMIT`) para la paginación.
- **Etiquetas**: segunda consulta sobre los `conversacion_id` de la página →
  `wa_conversacion_etiqueta × wa_etiquetas`, agrupadas por conversación → se adjunta a
  cada fila `origen` (categoría origen, se espera 0..1) y `intereses` (lista). Mismo
  patrón perezoso que el resto (evita GROUP_CONCAT).
- Nota: si se pasa `desde/hasta`, los contactos **sin conversación** no aparecen (no
  tienen `ultimo_mensaje_en`). Coherente con "seguimiento por actividad".

**Servicio** `src/services/informeContactos.js`:
- `parsearFiltros(query) -> { compro, estado, origenId, interesId, desde, hastaExcl, pagina, tam }`
  — **puro y testeable**: valida `compro`/`estado` (422 si inválidos), parsea fechas
  (422 si inválidas o `desde > hasta`), normaliza paginación (tam 1..100, pagina ≥ 0).
- `consultar(filtros)` — ejecuta la consulta + total + adjunta etiquetas; devuelve
  `{ total, pagina, tam, contactos: [...] }`.

**Controlador** `contactosController.informe`: llama a `parsearFiltros` (mapea 422),
luego `consultar`, responde el JSON. Ruta `GET /contactos/informe` con `requireAuth`.

Cada fila del JSON: `{ contactoId, nombre, telefono, agenteDueno, compro, conversacionId,
estado, ultimaActividad, origen: {nombre,color}|null, intereses: [{nombre,color}] }`.

### Frontend — pantalla `/informe`

- **Ruta**: `{ path: '/informe', name: 'informe', component: () => import('../views/Informe.vue'), meta: { requiereAuth: true } }` en `src/router/index.js`.
- **Acceso**: ítem **"📋 Informe"** en el menú de la cabecera (`Bandeja.vue`) → `router.push('/informe')`. Disponible para todos.
- **Vista `Informe.vue`**:
  - Cabecera con "‹ Volver a la bandeja".
  - **Barra de filtros**: ¿Compró? (select), Origen (select de etiquetas origen), Interés
    (select de etiquetas interés), Estado (select), Desde/Hasta (date), botón **Aplicar**.
    Los selects de etiqueta se llenan con `acc.cargarEtiquetas()` (ya existe).
  - **Tabla**: Contacto (nombre + teléfono) · Dueño · ¿Compró? (con color) · Origen ·
    Interés(es) · Estado · Última actividad · botón **Abrir**.
  - **Paginación**: anterior/siguiente + "X–Y de N".
  - **Abrir**: `acc.abrirContacto(contactoId, false)` (abre sin tomar, conserva dueño) +
    `router.push('/')` para ir a la bandeja con el chat abierto.
- **Store** `acciones.js`: `cargarInforme(filtros) -> { total, pagina, tam, contactos }`
  (arma el querystring y llama al endpoint).

## Manejo de errores

- `compro`/`estado` inválidos → 422.
- Rango de fechas inválido (`desde > hasta` o fecha no parseable) → 422.
- Sin resultados → lista vacía (no error).
- La consulta excluye siempre contactos desactivados.

## Rendimiento

- La CTE hace un `ROW_NUMBER` sobre `wa_conversaciones` (menos filas que contactos: muchos
  importados no tienen chat). Con paginación (25) y los índices existentes de
  `wa_conversaciones` es aceptable para un informe. Si más adelante pesa, se puede
  materializar "última conversación por contacto".

## Pruebas

- **Backend (`node --test`, funciones puras)** `test/informe-contactos.test.js`:
  - `parsearFiltros`: `compro`/`estado` válidos pasan; inválidos → 422.
  - Rango: `desde/hasta` válidos → `hastaExcl = hasta + 1 día`; `desde > hasta` → 422;
    fecha basura → 422.
  - Paginación: `tam` se acota a 1..100 (default 25); `pagina` ≥ 0.
  - `origenId`/`interesId`: si no son enteros válidos (vacíos o basura) → **se ignoran**
    (no filtran), nunca 422.
- La consulta SQL se verifica en vivo (sin harness de BD), como el resto del proyecto.
- Frontend: sin harness de componentes; build + verificación manual.

## Fuera de alcance

- Export a Excel/CSV (se puede añadir después como botón que reusa el mismo filtro).
- Gráficas / dashboard de conteos (ya existe `PanelEstadisticas` para conteos por etiqueta).
- Filtro por agente/dueño y por línea de negocio (el dueño sale como columna, sin filtro).
- Editar ¿compró? desde la tabla (se hace abriendo el chat, en la ficha).

## Despliegue

Solo código (sin migración). `git pull` + `npm --prefix frontend run build` +
`pm2 restart wa-backend`. Verificación en vivo: abrir `/informe`, filtrar por
¿compró?/origen/interés/estado/fechas, paginar, y "Abrir" un contacto.
