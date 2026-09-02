# Carrusel: validación de imagen + placeholders con ejemplos — diseño

Fecha: 2026-09-02
Estado: aprobado (pendiente de plan)

## Problema

Dos mejoras sobre la difusión de carrusel ya en producción
(ver `2026-09-02-difusion-carrusel-design.md`):

1. **Validación de imagen.** La difusión 36 falló ("Media upload error") porque se subió
   un **WebP renombrado a `.jpg`**. Hoy `src/services/difusionImagen.js` acepta
   `image/webp` y confía en el mime declarado por el navegador, así que no detecta ni el
   formato real ni un tamaño/aspecto inválido. WhatsApp solo admite **JPEG/PNG** (≤ 5 MB)
   en el encabezado de plantilla, y un carrusel exige que **todas las tarjetas** compartan
   la misma relación de aspecto.

2. **Placeholders poco útiles.** En el wizard, las variables del carrusel se muestran como
   "Variable 1", "Variable 2"… El admin no sabe qué va en cada una. La plantilla ya trae
   valores de ejemplo por variable (`example.body_text`) que sirven de guía.

## Decisiones (confirmadas por el usuario)

- Validación de imagen: **tipo + tamaño + aspecto**.
- Placeholders: **solo en el carrusel** (no en plantillas planas).

## Alcance / no-alcance

- Backend: validación real de imagen (bytes mágicos + dimensiones), aplicada a la subida
  por tarjeta del carrusel **y** a la imagen única de difusión (mismo helper). Chequeo de
  aspecto solo aplica al carrusel (varias tarjetas).
- Backend: `parsearPlantilla` expone los ejemplos por variable del carrusel.
- Frontend: el editor de carrusel usa los ejemplos como placeholder; el `accept` del
  selector de archivo pasa a `image/jpeg,image/png`.
- Sin dependencias nuevas (dimensiones se leen parseando el encabezado JPEG/PNG a mano).
  Solo tablas `wa_`. Solo `src/integrations/onemsg/` habla con 1msg.
- No se toca la lógica de envío ni el payload confirmado.

## Arquitectura

### 1. Lectura y validación de imagen — `src/services/difusionImagen.js`

- Quitar `image/webp` de `EXT_POR_MIME` (quedan `image/png`→`png`, `image/jpeg`/`image/jpg`→`jpg`).
- **Nueva función pura `leerImagen(buffer)`**:
  - Detecta el formato por bytes mágicos: JPEG = `FF D8 FF`, PNG = `89 50 4E 47 0D 0A 1A 0A`.
    Cualquier otro (incl. WebP `RIFF....WEBP`) → `err400('formato no soportado: usa JPEG o PNG')`.
  - Extrae dimensiones sin dependencias:
    - PNG: ancho = uint32 BE en offset 16, alto = uint32 BE en offset 20 (chunk IHDR).
    - JPEG: recorre marcadores hasta un SOF (`0xFFC0–0xFFC3`, `0xFFC5–0xFFC7`,
      `0xFFC9–0xFFCB`, `0xFFCD–0xFFCF`); alto = uint16 BE, ancho = uint16 BE tras
      `marker(2)+len(2)+precision(1)`.
  - Valida tamaño: `buffer.length` ≤ 5 MB (`5 * 1024 * 1024`) → si no, `err400('la imagen supera 5 MB')`.
  - Devuelve `{ formato: 'jpg'|'png', ancho, alto }`. Si no puede leer dimensiones → `err400('imagen ilegible o corrupta')`.
- `nombreArchivoImagen(difusionId, formato, cardIndex?)` usa el `formato` devuelto por
  `leerImagen` (no el mime declarado). `guardarImagen` recibe el buffer, llama `leerImagen`,
  usa su `formato` para el nombre, y **devuelve también `{ ancho, alto }`** además de `url`.

### 2. Endpoints de subida — `src/controllers/difusionesController.js`

- `subirImagenCarrusel`: tras `guardarImagen` (que ya valida por bytes), guarda en la
  tarjeta `{ ...c, imagenUrl: url, ancho, alto }` (merge inmutable del JSON, como hoy).
- `subirImagen` (imagen única de difusión): también pasa por `guardarImagen` → hereda la
  validación de tipo/tamaño (no necesita aspecto; es una sola imagen). Sin cambios de firma
  salvo tomar `{ url }` del resultado (ya lo hace).
- Ambos: si `guardarImagen` lanza `err400`, el controlador ya responde el `status`/mensaje
  (vía `fallo`), así que el mensaje de validación llega claro al frontend.

### 3. Validación de aspecto — `src/services/difusiones.js` `carruselListo`

- Además de imágenes/textos, cuando **todas** las tarjetas con imagen tengan `ancho`/`alto`,
  calcular `ratio = ancho/alto` y exigir que todas coincidan dentro de una tolerancia
  (`|r_i - r_0| / r_0 ≤ 0.02`). Si no → `{ ok:false, motivo:'las tarjetas deben tener la misma relación de aspecto' }`.
- Si a alguna tarjeta le faltan dimensiones (p. ej. difusiones creadas antes de esta mejora
  o con URL fijada por fuera), **se omite** el chequeo de aspecto (no rompe lo existente).

### 4. Ejemplos por variable — `src/services/plantillas.js`

- `parsearTarjeta(card)` añade `ejemplos: string[]` = `card.BODY.example.body_text[0]` (o `[]`).
- `parsearPlantilla` (rama carrusel) añade `carrusel.bodyEjemplos: string[]` =
  `BODY.example.body_text[0]` (o `[]`), y cada `carrusel.cards[i].ejemplos`.
- `bodyVars`/`variables` (conteos) se mantienen.

### 5. Frontend — `frontend/src/components/DifusionWizard.vue`

- En el editor de carrusel:
  - Input del cuerpo general i → `:placeholder="plantilla.carrusel.bodyEjemplos[i] ? 'Ej: ' + plantilla.carrusel.bodyEjemplos[i] : 'Variable ' + (i+1)'`.
  - Input de la tarjeta ci var vi → `:placeholder` con `plantilla.carrusel.cards[ci].ejemplos[vi]` (mismo patrón "Ej: …").
  - El `<input type="file">` de cada tarjeta pasa a `accept="image/jpeg,image/png"`.
- (La imagen única de plantillas planas mantiene su `accept` actual salvo que también se
  quite webp por consistencia — opcional, no crítico.)

## Reglas / invariantes

- La validación mira los **bytes reales**, nunca el mime declarado (que fue la causa del bug).
- Regresión cero: plantillas planas y difusiones existentes siguen igual; el chequeo de
  aspecto se omite si faltan dimensiones.
- Sin dependencias nuevas; dimensiones leídas parseando el encabezado.
- Solo tablas `wa_`; nombres de archivo deterministas y sin traversal (guard existente).

## Pruebas

- **Backend puro (node:test):**
  - `leerImagen`: buffer JPEG mínimo → `{formato:'jpg', ancho, alto}`; PNG mínimo → `png`
    con dimensiones; buffer WebP (`RIFF....WEBP`) → lanza; basura → lanza; > 5 MB → lanza.
  - `nombreArchivoImagen` usa el formato detectado (jpg/png), ya no webp.
  - `carruselListo`: dos tarjetas mismo ratio → ok; distinto ratio → `ok:false`; falta
    `ancho`/`alto` en alguna → se omite el chequeo (ok si lo demás está).
  - `parsearTarjeta`/`parsearPlantilla`: exponen `ejemplos`/`bodyEjemplos` desde `example.body_text`.
- **Frontend:** build; los inputs del carrusel muestran los ejemplos como placeholder.
- **En vivo (usuario):** subir un WebP → rechazo con mensaje; subir dos imágenes de aspecto
  distinto → no deja iniciar; los inputs muestran los ejemplos de la plantilla.

## Límites (aceptados v1)

- Placeholders solo en el carrusel (no en plantillas planas).
- El chequeo de aspecto necesita dimensiones guardadas al subir; difusiones con imágenes
  fijadas por fuera del endpoint no se validan por aspecto.
- No se recomprime ni convierte la imagen; si no es JPEG/PNG se rechaza (no se transforma).
