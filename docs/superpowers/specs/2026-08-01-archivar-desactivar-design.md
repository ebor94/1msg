# Archivar chats y desactivar contactos (admin)

Fecha: 2026-08-01
Estado: aprobado (diseño)

## Problema

Los administradores necesitan **quitar de la bandeja** conversaciones y contactos
irrelevantes o de spam sin borrar datos. Debe ser reversible y no perder mensajes.

## Decisiones (aprobadas por el usuario)

1. **Dos acciones**: *archivar* una conversación puntual y *desactivar* un contacto
   completo (con todos sus chats). Solo administradores.
2. **Ocultar, no bloquear**: nada se elimina; se marca con una fecha. Un **mensaje
   entrante** trae de vuelta automáticamente lo oculto (como la reapertura de un chat
   cerrado). Nunca se pierde un mensaje.
3. **Reversibilidad**: toggle **"Ver ocultos"** en la bandeja *Todos* (que ya es solo
   admin); no se crea una pantalla de papelera aparte.
4. **Impedir envío saliente** a un contacto desactivado mientras lo esté.

## Modelo de datos (migración `005`)

```sql
ALTER TABLE wa_conversaciones
  ADD COLUMN archivada_en  DATETIME     NULL AFTER estado,
  ADD COLUMN archivada_por INT UNSIGNED NULL AFTER archivada_en;

ALTER TABLE wa_contactos
  ADD COLUMN desactivado_en  DATETIME     NULL AFTER bloqueado,
  ADD COLUMN desactivado_por INT UNSIGNED NULL AFTER desactivado_en;
```

- No se usa el campo `bloqueado` (existe pero se eligió "ocultar", no bloquear).
- Modelos Sequelize `Conversacion` y `Contacto`: añadir los cuatro campos
  (`archivadaEn`, `archivadaPor`, `desactivadoEn`, `desactivadoPor`).

## Visibilidad (regla única)

Una conversación aparece en cualquier bandeja normal **solo si**
`archivada_en IS NULL` **Y** su contacto `desactivado_en IS NULL`.

- `src/services/conversaciones.js` → `construirFiltro`: añade `archivadaEn: null` al
  `where` de la conversación; y al include de `Contacto` (ya `required: true`) un
  `where: { desactivadoEn: null }`. `contarBandejas` usa los mismos filtros (los badges
  no cuentan ocultos).
- **Modo "ocultos"** (`ocultos=true`, solo admin, bandeja `todos`): invierte la regla y
  trae **solo** las conversaciones donde `archivada_en IS NOT NULL` **O** el contacto
  `desactivado_en IS NOT NULL`, para poder reactivarlas.
- El buscador `GET /contactos/buscar` excluye los contactos con `desactivado_en` no nulo.

La conversación serializada incluye `archivadaEn` y `contacto.desactivadoEn` para que la
UI sepa por qué está oculta y muestre el botón correcto.

## Reaparición automática (worker/ingesta)

Al procesar un **mensaje entrante** (`src/services/ingesta.js`), en la misma transacción
del upsert de la conversación/contacto:

- Si la conversación tenía `archivada_en` → ponerla a `NULL` (y `archivada_por` a NULL).
- Si el contacto tenía `desactivado_en` → ponerlo a `NULL` (y `desactivado_por` a NULL).

Solo aplica a mensajes **entrantes**; los salientes no reactivan. No afecta el orden ni
la idempotencia.

## Impedir envío a contacto desactivado

Antes de enviar (texto, media y plantilla), si el contacto tiene `desactivado_en` no
nulo → responder **409** `{ codigo: 'contacto_desactivado' }` y **no** enviar. Se apoya
en un helper puro `contactoActivo(contacto)` en `src/services/envio.js` (testeable).
Archivar una conversación **no** bloquea el envío (solo la desactivación del contacto).

## Endpoints (todos `requireAuth + requireAdmin`)

```
POST /conversaciones/:id/archivar     → archivada_en=NOW(), archivada_por=agente
POST /conversaciones/:id/desarchivar  → archivada_en=NULL, archivada_por=NULL
POST /contactos/:id/desactivar        → desactivado_en=NOW(), desactivado_por=agente
POST /contactos/:id/reactivar         → desactivado_en=NULL, desactivado_por=NULL
```

Cada handler responde `{ ok: true }`. Se registran con `logger` (auditoría básica: quién).

## Frontend (Vue 3)

- **`PanelCliente.vue`** (botones **solo admin**, con confirmación):
  - "🗄️ Archivar chat" / "Desarchivar" (según `c.archivadaEn`).
  - "🚫 Desactivar contacto" / "Reactivar" (según `c.contacto.desactivadoEn`).
  - Store `acciones.js`: `archivarConversacion`, `desarchivarConversacion`,
    `desactivarContacto`, `reactivarContacto`. Tras archivar/desactivar, la conversación
    sale de la lista activa y se cierra el chat.
- **Bandeja `Todos`** (`ListaConversaciones.vue`): toggle **"Ver ocultos"** (solo admin)
  que recarga con `ocultos=1`; los ítems se muestran atenuados con acción
  Desarchivar / Reactivar según corresponda.
- **Envío** (`Compositor.vue`): si el backend responde `contacto_desactivado`, mostrar
  "El contacto está desactivado; reactívalo para escribirle."
- Buscador: sin cambios en UI (el backend ya excluye los desactivados).

## Manejo de errores

- Acciones sobre id inexistente → 404.
- Envío a contacto desactivado → 409 `contacto_desactivado`.
- Toma/lectura de un chat oculto por un admin vía "Ver ocultos": permitida (es admin).

## Pruebas

- **Backend (`node --test`, funciones puras):**
  - `construirFiltro` normal incluye `archivadaEn: null` y el include de contacto con
    `desactivadoEn: null` (extiende `test/conversaciones-filtro.test.js`).
  - `construirFiltro` con `ocultos` invierte a "solo ocultos" y exige rol admin (403 si
    no).
  - `contactoActivo(contacto)` → `false` si `desactivadoEn` no nulo, `true` si nulo.
- **Manual/live** (sin harness HTTP ni de componentes): archivar un chat lo saca de la
  bandeja; un mensaje entrante lo devuelve; desactivar un contacto oculta sus chats y
  bloquea el envío; "Ver ocultos" los lista y Reactivar los restaura.

## Fuera de alcance

- Bloqueo real de reingreso (se eligió "ocultar": todo reaparece con un mensaje nuevo).
- Borrado físico/purga de conversaciones o contactos.
- Papelera dedicada (se usa el toggle "Ver ocultos").

## Despliegue

1. Aplicar `005-archivar-desactivar.sql`.
2. `git pull` + `npm --prefix frontend run build`.
3. `pm2 restart wa-backend` **y `wa-worker`** (cambia la ingesta).
4. Verificación en vivo: archivar → reaparecer con mensaje; desactivar → ocultar +
   envío bloqueado; "Ver ocultos" + reactivar.
