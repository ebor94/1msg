# Diseño — Multimedia: visor de entrantes + envío de adjuntos

Fecha: 2026-07-24 · Fase 2 · Bandeja WhatsApp Serfunorte

## Objetivo

Que los agentes **vean** el media que mandan los clientes (imágenes, audios, videos,
documentos) y puedan **enviar** adjuntos al cliente dentro de la ventana de 24h.

## Contexto (lo que YA existe — Fase 1)

- El webhook de media trae `body` = **URL directa temporal** (S3/Wasabi de 1msg) y el
  texto en `caption`. El `normalizador` ya produce `{ tipo, texto: caption, mediaUrl: body, esMedia }`.
- `src/services/media.js` `guardarMediaDeMensaje` **descarga y guarda** el archivo en
  `MEDIA_PATH/{año}/{mes}/{convId}/{waMessageId}.{ext}` y persiste en `wa_mensajes`:
  `media_ruta` (relativa, portable), `media_mime`, `media_nombre`, `media_bytes`.
  La descarga corre en el worker tras el commit (`ingesta.js`), con reintentos; un
  fallo deja `media_ruta` NULL sin perder el mensaje.
- La API `GET /conversaciones/:id/mensajes` ya devuelve las filas completas de
  `wa_mensajes` → los campos `media_*` y `tipo`/`texto` ya llegan al frontend.
- `src/integrations/onemsg/media.js` expone `descargarMedia(url, {maxBytes})` (aislado).
- `env.media.path` (default `./media`) y `env.media.maxBytes` (default 50MB) existen.
- Tiempo real: el worker procesa la cola y avisa a la API por el puente interno
  (`POST /internal/emitir`) para emitir por socket a los rooms correctos.
- Constantes de tipo ya definidas: `IMAGE, AUDIO, VIDEO, DOCUMENT, STICKER` en `TIPO_MENSAJE`.

## Lo que FALTA

1. **Servir** el archivo guardado al navegador (no hay endpoint).
2. **Pintar** el media en el frontend (`BurbujaMensaje.vue` hoy solo muestra `texto`).
3. **Enviar** adjuntos: subir el archivo del agente a 1msg y mandarlo, guardando copia propia.

## Decomposición en dos planes

- **Plan 8 — Visor de media entrante** (primero, autónomo y desplegable).
- **Plan 9 — Envío de adjuntos** (después).

---

## Plan 8 — Visor de media entrante

### Backend: endpoint para servir

`GET /api/mensajes/:id/media` (`requireAuth`):
- Carga el `Mensaje` por `:id`; 404 si no existe.
- Carga su conversación y valida `puedeVer(req.agente, conv)` → 403 si no.
- Si `media_ruta` es NULL → **404** (no es media, o aún no se descargó / falló la descarga).
- Sirve el archivo con `res.sendFile(path.join(env.media.path, media_ruta), opts)`:
  - Cabecera `Content-Type` = `media_mime` (fallback `application/octet-stream`).
  - `Content-Disposition`: `inline` para imagen/audio/video; para `document`, `attachment; filename="media_nombre"` (o inline con nombre — decisión de UI, ver frontend).
  - `res.sendFile` da **soporte de Range** y caché (`Last-Modified`/`ETag`) sin código extra → audio/video se reproducen y permiten seek.
  - Blindaje de path: `media_ruta` es generada por nosotros (no input del usuario), pero se valida que la ruta absoluta resuelta quede **dentro** de `env.media.path` (defensa en profundidad contra `..`).

### Backend: aviso en tiempo real cuando la descarga termina

Un media recién recibido en vivo emite `mensaje:nuevo` **antes** de que el archivo
esté en disco (la descarga es post-commit). Para que la burbuja se actualice sin
recargar, al terminar `guardarMediaDeMensaje` con éxito en `ingesta.js`, se **agrega
un evento** `mensaje:media` a `eventosSocket` (mismo puente interno, mismos rooms que
el `mensaje:nuevo` de ese mensaje) con `{ conversacionId, mensajeId, tipo, mediaNombre, mediaMime, mediaBytes }`.
El frontend, al recibirlo, marca ese mensaje como "media listo" y lo carga.

### Frontend: render por tipo en `BurbujaMensaje.vue`

- **Autenticación del archivo sin token en URL**: como `<img>`/`<audio>`/`<video>` no
  envían cabeceras, la burbuja pide `GET /api/mensajes/:id/media` con `apiFetch`
  (header `Authorization`) como **Blob**, crea `URL.createObjectURL(blob)` y lo usa
  como `src`. El object URL se **revoca** al desmontar el componente (evita fugas).
  Se carga de forma perezosa (solo cuando el mensaje es media y tiene ruta lista).
- Render por `tipo`:
  - `image` / `sticker` → miniatura (`max-h`), clic abre vista grande (lightbox simple sobre la bandeja).
  - `audio` → `<audio controls>` (notas de voz ogg/opus).
  - `video` → `<video controls>` con `max-h`.
  - `document` → tarjeta: ícono + `media_nombre` + tamaño legible; clic descarga (enlace con `download`).
  - `caption` (`texto`) se muestra debajo del media cuando existe.
- Estado "aún no disponible": si el endpoint responde 404 (media todavía no en disco),
  muestra un placeholder "descargando…"; se resuelve cuando llega `mensaje:media`
  (o al reabrir el chat). No se hace polling agresivo.

### Alcance Plan 8

Solo lectura de entrantes. No cambia la ingesta ni el modelo (ya tienen todo). No hay
subida ni envío. Sin migraciones.

---

## Plan 9 — Envío de adjuntos

### Backend: endpoint de subida y envío

`POST /api/conversaciones/:id/media` (`requireAuth`, multipart con **`multer`** en memoria):
- Valida: conversación existe + `puedeVer`; agente activo; **ventana 24h abierta**
  (`sendFile` exige sesión abierta, igual que el texto) → 409/403 si no; tamaño ≤
  `env.media.maxUploadBytes` (**16 MB**, nuevo env `MEDIA_MAX_UPLOAD_BYTES` default 16777216);
  `mediaType` permitido derivado del mime (`image`/`audio`/`video`/`document`).
- `caption` opcional (texto que acompaña; se le antepone la firma del agente como en el texto).
- Flujo con 1msg (en `src/integrations/onemsg/media.js`, aislado):
  1. `subirMedia(buffer, { mime, filename })` → `POST /uploadMedia` (multipart) → `mediaId`.
  2. `enviarArchivo({ chatId, mediaId, mediaType, caption, filename })` → `POST /sendFile`
     (form-urlencoded, token en query) → `{ id, sent }`. Reintento con backoff en 429.
- Guarda **copia propia** del archivo en disco reutilizando la convención de `media.js`
  (`MEDIA_PATH/{año}/{mes}/{convId}/{id}.{ext}`) para poder pintarlo y conservar historial.
- Persiste el saliente en `wa_mensajes` (idempotente por `wa_message_id = id`): `tipo`
  (image/audio/video/document), `direccion = out`, `media_ruta`/`media_mime`/`media_nombre`/`media_bytes`,
  `texto = caption` (con firma), `estado = enviado`, `enviado_por_id = agente`.
- Actualiza desnormalizados de la conversación y emite `mensaje:nuevo` a los rooms correctos.
- Persistir **antes** de emitir. El echo del webhook (mismo `id`) luego hace upsert sin duplicar.

### Frontend: adjuntar en el compositor

- **Tres puertas de entrada al mismo flujo** (todas producen un `File` idéntico):
  1. Botón 📎 junto a los botones existentes (📄 plantilla, ➤ enviar) — selector de archivo, **siempre disponible (respaldo garantizado)**.
  2. **Pegar** (`Ctrl/Cmd+V`) sobre el compositor: evento `paste` → `clipboardData.items`,
     se toma el primer ítem de imagen con `getAsFile()` (capturas de pantalla, imágenes copiadas de la web).
  3. **Arrastrar y soltar** un archivo sobre el área del chat: `dragover`/`drop` (con
     `preventDefault`) → `dataTransfer.files`; una capa visual "Suelta para adjuntar" al arrastrar.
- Cualquiera de las tres abre la **misma vista previa**: miniatura para imagen (nombre+tamaño
  para otros), campo de caption opcional, botón enviar con indicador de progreso/spinner,
  y opción de cancelar/quitar el adjunto.
- Reutiliza el store: nueva acción `enviarMedia(convId, file, caption)` que hace el POST
  multipart y hace push del `mensaje` devuelto al chat (como `enviarPlantilla`).
- Validación en cliente: tamaño ≤ 16 MB y tipo permitido (mensaje claro si excede). Pegar/soltar
  algo que no sea archivo permitido se ignora con aviso.
- Paste y drag-and-drop son APIs estándar del navegador (Clipboard API / HTML Drag and Drop),
  sin dependencias extra; validado como viable. El selector 📎 es el camino de respaldo si en
  algún navegador/entorno fallara alguno de los dos.

### Alcance Plan 9

Envío dentro de la ventana. Sin envío de media por plantilla (eso ya lo cubre el header
de imagen de plantillas). Sin edición/recorte de imágenes. Sin arrastrar-soltar (nice-to-have futuro).

---

## Transversales / invariantes

- **Aislamiento 1msg**: subir/enviar/descargar media solo en `src/integrations/onemsg/media.js`.
- **Persistir antes de emitir**; idempotencia por `wa_message_id`.
- **Rooms, no broadcast**: emisiones al `agente:{id}` dueño o a `general` (+ admins), nunca broadcast.
- **Permisos**: servir un archivo exige `puedeVer` sobre la conversación del mensaje.
- **Reintento 429** en todo llamado a 1msg; errores con su código, nunca tragados.
- **Sin token en URLs** de media (blob + header).
- **Límites**: subida 16 MB (`MEDIA_MAX_UPLOAD_BYTES`); descarga entrante sigue con `maxBytes` (50 MB).
- **Almacenamiento**: disco local del servidor bajo `MEDIA_PATH`, ruta relativa portable en BD.

## Pruebas

- Backend (node:test): permiso 403 al servir media de una conversación ajena; 404 cuando
  `media_ruta` NULL; blindaje de path (rechaza rutas fuera de MEDIA_PATH). Plan 9:
  validación de tamaño/tipo, y `subirMedia`/`enviarArchivo` con `http` inyectado (mock),
  reintento 429, persistencia idempotente.
- Frontend (vitest): el store `enviarMedia` hace push del mensaje; utilidades de tamaño legible.
- Prueba real end-to-end (a número propio): recibir una imagen y un audio (ver), y enviar
  una imagen y un PDF (enviar).

## Fuera de alcance (por ahora)

- Miniaturas/transcodificación server-side (se sirve el original).
- Envío de múltiples archivos en un mensaje.
- Purga/expiración del almacenamiento de media (ya hay purga de `wa_eventos_webhook`; el
  media en disco se puede abordar aparte).
