# Etiquetar origen e interés obligatorio al resolver — diseño

Fecha: 2026-10-09
Estado: aprobado (pendiente de plan)

## Problema

Al marcar un chat como **resuelto** (botón ✓ en `VistaChat.vue`) se cierra directo, sin
pedir etiquetas. Se quiere que, al resolver, un **popup obligue** a marcar **≥1 etiqueta de
origen y ≥1 de interés** antes de cerrar. Debe ser obligatorio.

Contexto confirmado:
- Etiquetas tienen `categoria` ('origen'/'interes'); el catálogo viene agrupado
  `{ origen:[...], interes:[...] }`. Regla "1 origen": poner un origen quita el origen previo.
- `etiquetasSvc.etiquetasDeConversacion(convId)` devuelve las etiquetas del chat con `categoria`.
- `resolver` (POST `/conversaciones/:id/resolver`) hoy solo exige que el chat tenga dueño.
- Frontend: `chat.etiquetas` = aplicadas; `acc.alternarEtiqueta(convId, etiqueta)` las alterna
  (optimista, respeta la regla 1-origen); `acc.catalogoEtiquetas` = catálogo cacheado.

## Decisiones (confirmadas por el usuario)

- Obligatorio: **≥1 origen y ≥1 interés** para poder resolver.
- Si el chat **ya** tiene ambas al dar ✓ → **resuelve directo** (sin popup). El popup solo
  aparece cuando falta alguna.
- Aplica a **todos los agentes** (asesores y admins).

## Alcance

- Backend: candado en `resolver` (rechaza si faltan) — garantía real, no saltable por API.
- Frontend: popup al resolver + lógica directo-vs-popup.
- Sin migración (las etiquetas y su relación ya existen). Sin dependencias. Solo tablas `wa_`.

## Arquitectura

### 1. Candado backend — `src/controllers/conversacionesController.js` `resolver`
- Helper puro `faltanEtiquetasObligatorias(etiquetas) → boolean` (true si NO hay al menos una
  `categoria==='origen'` **y** una `categoria==='interes'`). Vive en `src/services/etiquetas.js`
  (o un util), exportado para test.
- En `resolver`, tras el chequeo de dueño y antes de cerrar:
  `const etqs = await etiquetasSvc.etiquetasDeConversacion(conv.id);`
  `if (faltanEtiquetasObligatorias(etqs)) return res.status(409).json({ error: 'marca una etiqueta de origen y una de interés antes de resolver', codigo: 'etiquetas_requeridas' });`
- El resto de `resolver` igual (409 `sin_asignar` si no tiene dueño; cierra con CERRADA).

### 2. Frontend — helper puro
`frontend/src/utils` gana `tieneOrigenEInteres(etiquetas) → boolean` (true si hay ≥1 origen y
≥1 interés en la lista). Se usa para decidir directo-vs-popup.

### 3. Frontend — flujo en `VistaChat.vue`
`resolver()`:
- Si `tieneOrigenEInteres(chat.etiquetas)` → `acc.resolver(id)` + `chat.cerrar()` (como hoy).
- Si no → abrir el popup (`mostrarPopupResolver = true`). No cierra todavía.
- Si `acc.resolver` devuelve 409 `etiquetas_requeridas` (carrera / estado desfasado) → también
  abre el popup en vez de fallar en silencio.

### 4. Frontend — `PopupEtiquetarResolver.vue` (nuevo)
- Carga el catálogo (`acc.cargarCatalogoEtiquetas()` si hace falta) y parte de `chat.etiquetas`.
- Muestra **Origen** (opciones de `catalogo.origen`) e **Interés** (`catalogo.interes`), marcando
  las ya seleccionadas; al tocar una → `acc.alternarEtiqueta(conv.id, e)` (respeta regla 1-origen).
- Botón **"Resolver"** deshabilitado hasta que `tieneOrigenEInteres(chat.etiquetas)` sea true.
- Al confirmar → `acc.resolver(conv.id)` + `chat.cerrar()` + emitir cerrar. Si el PUT falla con
  409 `etiquetas_requeridas` (no debería, ya validado), muestra el mensaje y no cierra.
- Cancelar cierra el popup sin resolver (las etiquetas que haya marcado quedan aplicadas — es
  el comportamiento normal de etiquetar).

## Reglas / invariantes

- El backend es la garantía (no se puede resolver sin origen+interés, ni por API).
- El popup solo aparece cuando falta etiqueta; no molesta si ya está completo.
- Se reutiliza el etiquetado existente (`alternarEtiqueta`, regla 1-origen); no se duplica lógica.
- No cambia el cierre en sí (estado CERRADA) ni la reapertura.

## Pruebas

- **Backend puro (node:test):** `faltanEtiquetasObligatorias`: sin etiquetas → true; solo origen
  → true; solo interés → true; con origen+interés → false.
- **Backend:** `resolver` devuelve 409 `etiquetas_requeridas` cuando faltan (se valida con las
  piezas; el handler en vivo). (El 409 `sin_asignar` existente no cambia.)
- **Frontend puro (vitest):** `tieneOrigenEInteres` con las mismas combinaciones.
- **En vivo:** resolver un chat sin etiquetas → aparece el popup, "Resolver" deshabilitado;
  marcar una de origen y una de interés → se habilita y cierra; resolver un chat ya etiquetado →
  cierra directo sin popup.

## Límites (v1)

- "Obligatorio" = al menos una de cada categoría (no se exige un número fijo ni categorías extra).
- No se fuerza re-etiquetar un chat que ya tenía ambas (resuelve directo).
