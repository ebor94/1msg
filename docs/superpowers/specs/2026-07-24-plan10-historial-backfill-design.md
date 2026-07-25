# Diseño — Plan 10: Recuperar historial del chat (backfill)

Fecha: 2026-07-24 · Fase 2 · Bandeja WhatsApp Serfunorte

## Objetivo

Que al abrir un chat se recupere el **historial completo** desde 1msg (mensajes
anteriores a que empezáramos a ingerir por webhook), se guarde en `wa_mensajes` y se
muestre, con **scroll hacia atrás** para ver los más viejos.

## Hallazgos confirmados (empíricos, solo lectura) sobre `GET /messages`

- Se llama por **query string** (el body de GET se ignora): `GET https://api.1msg.io/{instanceId}/messages?token=…&chatId={wa_id}&lastMessageNumber={n}&limit={L}`.
- La respuesta es `{ messages: [ … ] }`, sin metadatos de paginación.
- Cada mensaje: `{ messageNumber, id, body, caption, type, fromMe (0/1), self, isForwarded, author, time (unix s), chatId, senderName, chatName, quotedMsgId }`. **Casi idéntico al webhook** (ver `docs/payloads-reales-1msg.md`): en media, `body` es la URL temporal y `caption` el texto.
- **Paginación fiable hacia adelante**: `lastMessageNumber=X` devuelve los mensajes con `messageNumber > X`, ascendente, hasta `limit`. Con `lastMessageNumber=0` se obtienen los **más viejos**; usando el mayor `messageNumber` de cada página como nuevo cursor se avanza hasta agotar (una página con menos de `limit` = última). (`firstMessageNumber` y rangos no son fiables; `last=true&limit=N` da los N más recientes — no se usa para el backfill completo.)
- `messageNumber` es una secuencia global monotónica de la instancia (no por chat), pero sirve perfecto como cursor.

## Arquitectura

Cliente aislado `src/integrations/onemsg/historial.js` (`paginaHistorial`). Servicio
`src/services/backfill.js` que recorre TODAS las páginas, normaliza (reutilizando el
normalizador del webhook), hace upsert idempotente por `wa_message_id` y descarga los
medios. Un endpoint `POST /api/conversaciones/:id/historial` lo dispara **una vez por
chat** (marca en `wa_conversaciones.historial_recuperado_en`). El frontend lo llama al
abrir el chat y recarga; el scroll hacia atrás reutiliza la paginación local existente.

## Componentes

### 1. Cliente onemsg — `src/integrations/onemsg/historial.js`

`paginaHistorial({ chatId, lastMessageNumber = 0, limit = 100 }, deps?): Promise<Array>`
- `GET /messages` con query `token, chatId, lastMessageNumber, limit`.
- Reintento con backoff en 429; `validateStatus: s<500`; devuelve `data.messages || []`.
- Lanza `OneMsgError` en fallo (≥400 con código si lo trae). Aislamiento: único punto que arma esta URL.

### 2. Normalización — `src/services/normalizador.js` (sin cambios)

El shape de `/messages` es prácticamente el del webhook. Verificado: `normalizarMensaje`
deriva la dirección con `m.fromMe === true || m.self === 1 || m.self === true`, y
`/messages` **sí trae `self`** (`self:1` en salientes, `self:0` en entrantes), así que la
dirección sale bien **sin tocar el normalizador**. `time` (unix s) y la lógica de
media/caption son idénticas al webhook. El backfill solo llama `normalizarMensaje(m)` por
cada mensaje de la página. (Task de verificación: un test que confirme `self:1 → out`,
`self:0 → in` con el shape de `/messages`.)

### 3. Servicio de backfill — `src/services/backfill.js`

`recuperarHistorial(conversacion, { limit = 100 } = {}): Promise<{ recuperados, mediaOk, mediaFallida }>`
- Si `conversacion.historialRecuperadoEn` ya está seteado → devuelve `{ yaRecuperado: true }` sin llamar a 1msg.
- Bucle: `cursor = 0`; en cada vuelta `pagina = paginaHistorial({ chatId: contacto.waId, lastMessageNumber: cursor, limit })`.
  - Si `pagina.length === 0` → fin.
  - Para cada mensaje: normaliza y `Mensaje.findOrCreate({ where: { waMessageId }, defaults: {...} })` (idempotente; no pisa lo existente). Cuenta `recuperados` solo los creados.
  - Junta las tareas de media (`esMedia && mediaUrl`) para descargarlas.
  - `cursor = max(messageNumber de la página)`; si `pagina.length < limit` → fin.
  - **Tope de seguridad**: máximo de páginas (p. ej. 500 → 50k mensajes) para no colgarse ante un bug de cursor; se loguea si se alcanza.
- Descarga de medios: reutiliza `guardarMediaDeMensaje` (best-effort, con concurrencia limitada, p. ej. de a 4); un fallo deja `media_ruta` NULL sin abortar el backfill. Las URLs expiran (~5 min), por eso se descargan durante el backfill.
- Al terminar, `conversacion.update({ historialRecuperadoEn: new Date() })`.
- No emite por socket (el chat ya está abierto; el frontend recarga los mensajes tras la respuesta).

### 4. Endpoint — `POST /api/conversaciones/:id/historial`

- `requireAuth` + `puedeVer(req.agente, conv)`.
- Carga la conversación con su contacto (para `waId`). Llama `recuperarHistorial(conv)`.
- Respuesta: `{ yaRecuperado }` o `{ recuperados, mediaOk, mediaFallida }`. 502 si 1msg falla (con código); 200 si ya estaba recuperado.
- Es idempotente y seguro de reintentar.

### 5. Migración — `wa_conversaciones.historial_recuperado_en`

`docs/migraciones/002-historial-recuperado.sql`: `ALTER TABLE wa_conversaciones ADD COLUMN historial_recuperado_en DATETIME NULL;` y el campo `historialRecuperadoEn` en el modelo `Conversacion` (underscored). Se ejecuta a mano en el deploy (como las otras migraciones del proyecto).

### 6. Frontend — disparo al abrir + scroll hacia atrás

- Store `chat.abrir(conversacion)`: tras cargar los mensajes locales, llama `POST /conversaciones/:id/historial`. Mientras corre, muestra un indicador sutil ("recuperando historial…"). Si devuelve `recuperados > 0`, **recarga** los mensajes (vuelve a pedir la primera página local, que ahora incluye el historial). Guard anti-carrera: si el usuario cambió de chat, se descarta.
- **Scroll-load hacia atrás**: en `VistaChat`, al hacer scroll cerca del tope, si hay más, pedir `GET /conversaciones/:id/mensajes?antesDe={idMásViejoCargado}` (ya existe, 30/pág) y **anteponer** los resultados manteniendo la posición de scroll. Se corta cuando una página vuelve con menos de 30.

## Invariantes / constraints

- Aislamiento 1msg: solo `src/integrations/onemsg/historial.js` arma la URL de `/messages`.
- Idempotencia por `wa_message_id` (upsert; el backfill nunca duplica ni pisa lo ingerido por webhook).
- **Orden por `ts_proveedor`** (no por orden de llegada ni por `messageNumber` directamente para mostrar).
- Reintento 429; errores de 1msg con su código, nunca tragados.
- El backfill corre **una vez por chat**; no re-descarga en cada apertura.
- Sin token en logs; sin exponer el token al frontend.
- El endpoint valida permiso: un agente no recupera historial de una conversación que no puede ver.

## Pruebas

- `historial.js`: `paginaHistorial` con `http` inyectado (mock) — arma bien la query, reintenta 429, devuelve `messages`.
- `backfill.js`: con `onemsg` y modelos falsos/inyectados — pagina hasta agotar (corta con página incompleta), upsert idempotente (no duplica), respeta `yaRecuperado`, y el tope de seguridad. (Si el proyecto no permite testear con modelos reales sin DB, testear la lógica de paginación/cursor con dependencias inyectadas.)
- Normalizador: caso `fromMe: 1` (número) → `direccion: out`; media de historial (body=URL) → `esMedia`.
- Prueba real: abrir un chat viejo (con mensajes anteriores a la ingesta) y verificar que aparece el historial completo, con imágenes, y que el scroll hacia atrás carga más.

## Fuera de alcance (otros planes)

- Buscador por teléfono + iniciar/tomar (Plan 11), scroll de la lista de bandeja (Plan 12),
  editar nombre (Plan 13), sonido (Plan 14), grabar audio (Plan 15).
- Re-sincronización periódica del historial (basta una vez; el webhook mantiene lo nuevo).
- Backfill en segundo plano por el worker (si algún chat resultara demasiado grande para
  hacerlo en el request, se movería al worker; por ahora corre en el endpoint).
