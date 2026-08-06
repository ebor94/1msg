# Mostrar la imagen de plantilla en la bandeja — diseño

Fecha: 2026-08-06
Estado: aprobado (enfoque URL confirmado por el usuario)

## Problema

Cuando se envía una plantilla con imagen (difusión, recordatorio, o envío manual de
plantilla), el cliente recibe bien la imagen, pero en **nuestra bandeja** el mensaje
saliente se guarda con `tipo='template'` y **solo el texto** — los campos de media
quedan NULL. La burbuja (`BurbujaMensaje.vue`) solo pinta imagen para
`tipo ∈ ['image','sticker','audio','video','document']`, así que un `template`
muestra solo texto. El agente no ve la imagen que se envió.

## Enfoque (el más liviano): guardar la URL y mostrarla

No descargamos ni servimos el archivo. Guardamos la **URL** de la imagen del
encabezado en el mensaje y la burbuja la pinta directo con `<img :src="url">`.

- Las imágenes de **difusión** ya se sirven desde nuestro server (`/media-difusion/…`,
  mismo origen) → el CSP `'self'` ya las permite.
- Las imágenes **default de plantilla** y la del **recordatorio** están en
  `losolivoscucuta.com` → hay que **añadir ese host al `img-src`** del CSP.

## Cambios

**Datos (migración 009):** `ALTER TABLE wa_mensajes ADD COLUMN media_url VARCHAR(255)
NULL;` — URL pública de la imagen del encabezado de la plantilla. Modelo
`Mensaje.mediaUrl`. (La serialización ya devuelve el modelo completo, así que el
campo llega al frontend sin más.)

**Backend — guardar la URL al enviar plantilla con imagen:**
- `persistirEnvioPlantilla` (compartido difusión/recordatorio): nuevo parámetro
  `mediaUrl`, se guarda en el mensaje.
  - difusiones: `mediaUrl = def.tieneImagen ? (dif.imagenUrl || def.imagenDefault) : null`.
  - recordatorios: `mediaUrl = def.tieneImagen ? (aj.recordatorio_imagen_url || def.imagenDefault) : null`.
- Envío manual de plantilla (`conversacionesController.enviarPlantilla`): guardar
  `mediaUrl = imagenUrl` (la imagen del encabezado elegida) en el mensaje.

**Frontend (`BurbujaMensaje.vue`):** si el mensaje tiene `mediaUrl`, pintar
`<img :src="mensaje.mediaUrl">` (encima del texto, que queda como pie). Es
independiente del path de `fetchMediaBlob` (esa imagen es pública, no necesita
token). Un fallback discreto si la imagen no carga (que no rompa la burbuja).

**CSP (`src/app.js`):** añadir `https://losolivoscucuta.com` a `img-src`
(las imágenes de difusión son mismo-origen, ya cubiertas por `'self'`).

## Alcance / límites

- Solo aplica a mensajes **salientes de plantilla** con imagen (difusión, recordatorio,
  manual). Los entrantes/media normales no cambian (siguen por `media_ruta`).
- Si la URL apunta a un host no permitido por el CSP, la imagen no carga (queda el
  texto). Por eso se añade `losolivoscucuta.com`; las de difusión son mismo-origen.
- No se toca el envío a 1msg (ya funciona); es solo cómo se ve en la bandeja.

## Invariantes

- Solo tablas `wa_`. La URL es pública (imágenes que ya se mandan al cliente); no hay
  token ni dato sensible en ella.
- Sin cambios en el worker ni en la lógica de envío; el mensaje sigue siendo
  `tipo='template'`, solo se le suma la URL de la imagen.
