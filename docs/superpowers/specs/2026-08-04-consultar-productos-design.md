# Consultar productos por cédula (previsión + mantenimiento + prenecesidad)

Fecha: 2026-08-04
Estado: aprobado (diseño)

## Problema

Hoy los 3 productos (previsión, mantenimiento, prenecesidad) solo se consultan desde la
ficha de un contacto, uno por uno. Se necesita una **consulta suelta por cédula** que,
en un popup, muestre los 3 productos a la vez sin depender de un contacto.

## Decisiones (aprobadas)

1. Opción **"🔎 Consultar productos"** en el menú de la cabecera → **popup** con un campo
   de cédula.
2. Los **3 productos en paralelo**, cada uno con estado independiente (uno que falle no
   tumba a los demás).
3. Las 3 secciones **apiladas** (todo visible de una), no pestañas.
4. **Dinero formateado** (`$1.627.500`) en este popup; se detecta por nombre de columna
   (Vr./Valor/Saldo/Abonado/Pagado/Precio/Monto) para no formatear Plazo, # cuotas, etc.
5. **Acceso: todos** los agentes. No se asocia a ningún contacto.

## Arquitectura

### Backend — `GET /api/productos?documento=` (requireAuth)

- `documento` → solo dígitos; si vacío → 400.
- Consulta los 3 productos **en paralelo** (`Promise.all`), cada uno envuelto en un
  helper `seguro(fn, doc)` que nunca lanza:
  - éxito → `{ estado: 'ok', datos: [...] }`.
  - integración no configurada (`err.codigo === 'no_configurado'`) → `{ estado: 'no_configurado' }`.
  - cualquier otro error → `{ estado: 'error' }` (se loguea el detalle).
- Respuesta:
  ```json
  { "documento": "1004997123",
    "prevision":      { "estado": "ok", "datos": [...] },
    "mantenimientos": { "estado": "ok", "datos": [...] },
    "prenecesidad":   { "estado": "ok", "datos": [...] } }
  ```
- Reutiliza las 3 integraciones existentes: `consultarPlanesPorDocumento` (previsión,
  olivosct), `consultarMantenimientos`, `consultarPrenecesidad` (KARINGSOFT).

**Controlador** `src/controllers/productosController.js`:
- `seguro(fn, doc) -> Promise<{estado, datos?}>` — **exportada y testeable** (con fn
  inyectada: ok / no_configurado / error).
- `consultar(req, res)` — arma el documento, corre los 3 `seguro`, responde.

**Ruta** `GET /contactos/... ` NO; ruta nueva `GET /productos` en `src/routes/api.js`.

### Frontend

- **Util** `frontend/src/utils/tablas.js` (helpers de tabla, puros):
  - `etiquetaCampo(k)` y `formatoValor(v)` — extraídos de `PanelCliente.vue` (mismo
    comportamiento; `PanelCliente` pasa a importarlos).
  - `esMoneda(col)` — `true` si el nombre de columna casa
    `/(vr\.?|valor|saldo|abonado|pagado|precio|monto)/i`.
  - `formatoCelda(col, v)` — `'—'` si vacío; fecha ISO → fecha local; si es número y
    `esMoneda(col)` → `'$' + Number(v).toLocaleString('es-CO')`; si no, `formatoValor(v)`.
- **Componente** `PanelProductos.vue` (modal, patrón de los otros modales):
  - Input de cédula (numérico) + botón **Consultar** (Enter también).
  - 3 secciones apiladas: **Previsión**, **Mantenimientos**, **Prenecesidad**. Cada una:
    - `estado === 'ok'` y `datos.length` → tabla a lo ancho (columnas dinámicas por
      `Object.keys(datos[0])`, encabezado `etiquetaCampo`, celdas `formatoCelda`).
    - `estado === 'ok'` y vacío → "Sin resultados".
    - `estado === 'no_configurado'` → "No configurado".
    - `estado === 'error'` → "No se pudo consultar".
- **Store** `acciones.js`: `consultarProductos(documento) -> Promise<{...}>`.
- **Menú** `Bandeja.vue`: ítem "🔎 Consultar productos" → abre el modal; para todos.

## Manejo de errores

- `documento` vacío → 400.
- Un producto no configurado o con error → su sección lo indica; los demás se muestran.
- El endpoint nunca 500 por un fallo de una sola integración (cada una va en `seguro`).

## Pruebas

- **Backend** `test/productos.test.js`: `seguro(fn, doc)` con fn inyectada →
  `{estado:'ok', datos}`; fn que lanza `{codigo:'no_configurado'}` → `{estado:'no_configurado'}`;
  fn que lanza otro error → `{estado:'error'}`.
- **Frontend** `frontend/src/utils/tablas.test.js`: `esMoneda` (positivos/negativos),
  `formatoCelda` (dinero `$` + miles, número no-moneda sin `$`, fecha ISO, vacío `—`).
- La consulta real de cada producto ya está verificada en vivo; el endpoint combinado se
  prueba con curl/manual.

## Fuera de alcance

- Guardar/crear contacto desde el popup (es solo consulta).
- Export; caché de resultados; formato de dinero en las tablas de `PanelCliente` (se
  mantiene como está allí; el formato de dinero es solo en este popup nuevo).

## Despliegue

Solo código (sin migración). `git pull` + `npm --prefix frontend run build` +
`pm2 restart wa-backend`. Verificación: menú → 🔎 Consultar productos → cédula → ver las
3 secciones.
