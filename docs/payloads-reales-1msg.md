# Formato real de los webhooks de 1msg (canal VID182868781)

Capturado de tráfico de producción el 2026-07-24. Reemplaza a los payloads
ilustrativos de `scripts/payloads/`. **Los ejemplos van con datos personales
enmascarados** (`<X>` texto/nombre/teléfono, `<NUM>` número, `<TOKEN>` token).

## Discriminador de tipo de evento

No hay un campo `type` de nivel superior. El tipo se deduce por **qué arreglo
está presente**:

| Presencia | Evento |
|---|---|
| `messages: [...]` | mensajes entrantes y salientes (echo) |
| `ack: [...]` | estados de entrega |

Ambos traen `instanceId` (el canal, ej. `"VID182868781"`).

## 1. Mensajes — `{ instanceId, messages: [ { ... } ] }`

Claves de cada mensaje:
`id, body, self, time, type, author, chatId, fromMe, caption, chatName,
senderName, authorBsuid, isForwarded, quotedMsgId, authorUserName`

Mapeo a `wa_mensajes`:

| Campo 1msg | Destino | Notas |
|---|---|---|
| `id` | `wa_message_id` | clave de idempotencia (upsert) |
| `chatId` | contacto (`wa_contactos.wa_id`) | ej. `573...@c.us` |
| `senderName` | `wa_contactos.nombre_wa` | nombre de perfil |
| `type` | `tipo` | ver mapeo abajo |
| `body` | `texto` (si texto) **o** URL de media (si media) | ¡ojo! |
| `caption` | `texto` cuando hay media | pie del adjunto |
| `fromMe` / `self` | `direccion` | `true`/`1` → `out` ; `false`/`0` → `in` |
| `time` | `ts_proveedor` | **unix (segundos)** → `DATETIME` |
| `quotedMsgId` | `responde_a_id` | resolver contra `wa_message_id` |
| `isForwarded` | (informativo) | |

Mapeo de `type` → `wa_mensajes.tipo` (valores vistos en real):

| `type` 1msg | `tipo` nuestro |
|---|---|
| `chat` | `text` |
| `image` | `image` |
| `audio` | `audio` |
| `document` | `document` |
| `button` | `button` |
| `reaction` | `reaction` |
| *(esperables: video, sticker, location, contact, interactive)* | igual nombre |

**Media**: para `image`/`audio`/`document`/`video`, `body` es la **URL directa**
del archivo (S3 de 1msg, ej. `https://s3.eu-central-1.wasabisys.com/onemessageapp/...`).
Es **temporal** → descargar al procesar el evento (Tarea 5), no después. El texto
que acompaña va en `caption`.

## 2. Acks de estado — `{ instanceId, ack: [ { ... } ] }`

Claves de cada ack:
`id, bsuid, phone, chatId, status, category, userName` (+ `error`, `mmLite` según caso)

Mapeo a `wa_mensajes` (por `id` = `wa_message_id`):

| `status` 1msg | `wa_mensajes.estado` |
|---|---|
| `sent` | `enviado` |
| `delivered` | `entregado` |
| `read` | `leido` |
| `failed` | `fallido` |

Regla: **nunca retroceder** (los acks llegan desordenados). `category` puede ser
`marketing_lite` (difusiones).

### Acks fallidos (Tarea 6)

El ack fallido trae `error` como **texto legible**, NO el código numérico. Hay que
mapear texto → código:

| Texto de `error` (visto) | Código | Acción |
|---|---|---|
| `User's number is part of an experiment` | `130472` | `wa_contactos.wa_experimento = 1`; no reintentar |
| *(límite marketing por destinatario)* | `131049` | `marketing_bloqueado_hasta = NOW()+24h` |
| *(fuera de ventana 24h)* | `131047` | requiere plantilla |

> Confirmar los textos exactos de `131049`/`131047` cuando aparezcan en tráfico real.

## Ejemplos (enmascarados)

Mensaje de texto saliente:
```json
{ "instanceId": "VID182868781", "messages": [ {
  "id": "<STR>", "type": "chat", "body": "<X>", "caption": "<X>",
  "self": 1, "fromMe": true, "time": "<NUM>",
  "chatId": "<X>", "author": "<X>", "senderName": "<X>",
  "quotedMsgId": null, "isForwarded": false } ] }
```

Mensaje con documento (media):
```json
{ "instanceId": "VID182868781", "messages": [ {
  "id": "<STR>", "type": "document",
  "body": "https://s3.eu-central-1.wasabisys.com/onemessageapp/...<TOKEN>",
  "caption": "<X>", "fromMe": true, "time": "<NUM>", "chatId": "<X>" } ] }
```

Ack fallido (experimento / 130472):
```json
{ "instanceId": "VID182868781", "ack": [ {
  "id": "<STR>", "status": "failed",
  "error": "User's number is part of an experiment",
  "phone": "<X>", "chatId": "<X>", "bsuid": "CO...." } ] }
```
