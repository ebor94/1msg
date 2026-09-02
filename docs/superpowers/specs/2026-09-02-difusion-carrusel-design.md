# Difusión de plantillas tipo CAROUSEL — diseño

Fecha: 2026-09-02
Estado: aprobado (pendiente de plan)

## Problema

Se pueden crear plantillas WhatsApp tipo **CAROUSEL** (varias tarjetas, cada una con
imagen, textos y botones), pero el sistema solo entiende plantillas planas: un `BODY`
con N variables + (opcional) una imagen de `HEADER`. Al elegir un carrusel en el
frontend aparece **una sola variable** (la del cuerpo general), se ignoran las tarjetas,
y el envío no arma el componente `carousel` — así que hoy **no se puede difundir un
carrusel**.

El formato de envío por 1msg **ya quedó confirmado en producción** (2026-09-02, plantilla
`olivos_carrusel_sfn`): `sendTemplate` acepta un `params` con un componente `body` + un
componente `carousel` con `cards[]` (cada card con `header` imagen + `body` params +
botones `quick_reply`). Ver memoria `formato-carrusel-1msg`.

## Alcance / no-alcance

- **Solo difusión** (envío masivo). El envío manual desde el chat (`SelectorPlantilla`)
  queda fuera; ahí los carruseles se **ocultan** para no ofrecer un envío roto.
- **Valores fijos por campaña**: los textos de las tarjetas y de la variable general son
  iguales para todos los destinatarios. El CSV solo aporta la lista de teléfonos
  (+ CEDULA si la difusión requiere resumen IA). No hay mapeo variable→columna en carrusel.
- **Imágenes por tarjeta subidas como archivo** (una por tarjeta), reusando el
  almacenamiento local de imágenes de difusión ya existente.
- Sin dependencias nuevas, sin Redis, solo tablas `wa_`. Solo `src/integrations/onemsg/`
  habla con 1msg.

## Decisiones (confirmadas por el usuario)

- Enfoque **A**: columna JSON `carrusel` en `wa_difusiones` + rama en el envío. (Se
  descartó modelar tablas por tarjeta —sobre-ingeniería para valores fijos— y meter el
  carrusel en los `parametros` por destinatario —duplicaría el contenido en miles de filas.)
- Alcance: **solo difusión**.
- Valores: **fijos para toda la campaña**.
- Imágenes: **subir archivo por tarjeta**.

## Arquitectura

### 1. Modelo de datos — Migración 012

Columna `carrusel` JSON (nullable) en `wa_difusiones`. Presente ⇒ la difusión es de
carrusel. Forma:

```json
{
  "bodyVars": ["participar en familia de las actividades..."],
  "cards": [
    { "imagenUrl": "https://.../dif-15-c0.jpg", "vars": ["Conferencia Renacer...", "Calle 6 #7-78", "Sábado 05...", "03:00 p.m"] },
    { "imagenUrl": "https://.../dif-15-c1.jpg", "vars": ["Eucaristía especial...", "Catedral Santa Clara", "Viernes 04...", "6:00 p.m"] }
  ]
}
```

- `bodyVars`: valores de las variables del cuerpo general (en orden `{{1}}..{{n}}`).
- `cards[i].vars`: valores de las variables del `BODY` de la tarjeta i (en orden).
- `cards[i].imagenUrl`: URL pública de la imagen de esa tarjeta (se llena tras subirla).

Todo fijo para la campaña. En carrusel **no** se usa `DifusionDestinatario.parametros`
para el cuerpo (los destinatarios solo aportan teléfono/agente).

### 2. Parseo de la plantilla — `src/services/plantillas.js`

`parsearPlantilla(t)` se extiende. Además de los campos actuales, cuando existe un
componente `CAROUSEL`:

```js
esCarrusel: true,
carrusel: {
  bodyVars: 1,                     // nº de {{n}} en el BODY de nivel superior
  cards: [
    { variables: 4, tieneImagen: true, imagenDefault: '<url ejemplo o null>', botones: ['Asistiré', 'No Asistiré'] },
    ...
  ]
}
```

- Lee `comps.find(c => c.type === 'CAROUSEL')`. Cada `card` de `.cards[]` trae su propio
  `.components` con `HEADER` (imagen), `BODY` (texto con `{{n}}`) y `BUTTONS`.
- Por tarjeta: `variables` = `contarVariables(card.body.text)`; `tieneImagen` =
  header con `format` en `IMAGE/VIDEO/DOCUMENT`; `imagenDefault` = del `example.header_handle`;
  `botones` = textos de los botones (para mostrar/armar el payload).
- Para plantillas no-carrusel, `esCarrusel` es `false` y el resto queda igual (sin regresión).

### 3. Armado del envío — `src/services/plantillas.js` + `src/services/difusionEnvio.js`

Nueva función **pura** `construirParamsCarrusel({ bodyVars, cards }, defCarrusel)` que
arma el `params` **idéntico al confirmado en producción**:

- `{ type: 'body', parameters: bodyVars.map(text) }` (si hay bodyVars).
- `{ type: 'carousel', cards: [ { card_index, components: [header imagen, body params, botones quick_reply] } ] }`.
- Los botones `quick_reply` se arman por tarjeta a partir de la definición de la plantilla
  (`defCarrusel.cards[i].botones`), con `index` incremental y un `payload` derivado
  (p.ej. `slug(texto)_c{index}`). Se incluyen porque el payload confirmado los llevaba.

`payloadDeEnvio(dif, def, dest, telefono)` bifurca:
- Si `def.esCarrusel` (y `dif.carrusel` presente) ⇒ `params = construirParamsCarrusel(dif.carrusel, def.carrusel)`.
- Si no ⇒ camino actual intacto (`[...construirParamsHeader(...), ...construirParams(...)]`).

`enviarDestinatario` no cambia su estructura; solo el `params` resultante difiere. La
persistencia del saliente (`persistirEnvioPlantilla`): `texto` = cuerpo general renderizado
+ marca `📸 Carrusel (N tarjetas)`; `mediaUrl` = `carrusel.cards[0].imagenUrl`.

### 4. Subida de imágenes por tarjeta — `src/services/difusionImagen.js` + rutas

- `nombreArchivoImagen(difusionId, mime, cardIndex?)` acepta índice de tarjeta opcional →
  `dif-{id}.ext` (sin índice, comportamiento actual) o `dif-{id}-c{idx}.ext` (carrusel).
- `guardarImagen(difusionId, buffer, mime, cardIndex?)` pasa el índice.
- Endpoint nuevo `POST /difusiones/:id/carrusel/:idx/imagen` (requireAuth + requireAdmin,
  `multer single('imagen')`) → guarda archivo → escribe la URL en `carrusel.cards[idx].imagenUrl`
  del `Difusion` (merge del JSON) → responde `{ imagenUrl }`.

### 5. Creación / contenido del carrusel — `difusionesController.js`

- `crear` acepta un campo opcional `carrusel` con `{ bodyVars, cards: [{ vars }] }`
  (sin `imagenUrl`; las imágenes llegan luego por su endpoint). Se persiste en la columna.
- Validación en `iniciar`: si la difusión es de carrusel, exige que **todas** las tarjetas
  tengan `imagenUrl` y que el nº de `bodyVars`/`vars` calce con la plantilla; si falta algo,
  400 con mensaje claro.
- `destinatarios` (carga de la lista): en carrusel, el `mapeo` solo lleva `telefono`
  (+ `agente`/`cedula` según aplique) y no variables; cada `DifusionDestinatario` se crea
  con `parametros = []`.

### 6. Frontend — `frontend/src/components/DifusionWizard.vue`

Cuando la plantilla elegida trae `esCarrusel`:

- Se **oculta** el bloque de mapeo de variables (`mapeo.variables`) y el de imagen única.
- Se muestra un **editor de carrusel**:
  - Input(s) para la(s) variable(s) del cuerpo general (`carrusel.bodyVars`), pre-llenado
    con el ejemplo de la plantilla.
  - Por tarjeta: selector de archivo de imagen + inputs para sus variables, pre-llenados
    con los ejemplos.
- Paso CSV: solo se exige la columna de **teléfono** (+ CEDULA si `requiereResumen`).
  `columnasRequeridas` ignora las variables en modo carrusel.
- Confirmar (orden): `crear` la difusión con el contenido del carrusel → subir cada imagen
  de tarjeta (`POST .../carrusel/:idx/imagen`) → cargar destinatarios (teléfonos) →
  `iniciar`. Botón deshabilitado hasta que todas las tarjetas tengan imagen.

En `frontend/src/components/SelectorPlantilla.vue` (envío manual, fuera de alcance): se
**filtran** las plantillas con `esCarrusel` de la lista, para no permitir un envío que el
backend manual no arma.

## Reglas / invariantes

- El `params` de carrusel replica el payload **confirmado**; no se inventa formato nuevo
  (memoria `formato-carrusel-1msg`). Solo `src/integrations/onemsg/` habla con 1msg.
- Sin regresión en plantillas planas: `esCarrusel=false` mantiene todos los caminos actuales.
- Valores fijos: el mismo `carrusel` se envía a todos los destinatarios; no se duplica por fila.
- Solo tablas `wa_`; parametrizado; imágenes con nombre determinístico y sin traversal.
- Admin-only para crear/subir/iniciar (igual que el resto de difusión).

## Pruebas

- **Backend puro (node:test):**
  - `parsearPlantilla` sobre el JSON de `olivos_carrusel_sfn`: `esCarrusel=true`, 2 tarjetas,
    4 variables/tarjeta, imagen por tarjeta, botones; una plantilla plana sigue con `esCarrusel=false`.
  - `construirParamsCarrusel` produce el `params` esperado (body + carousel con card_index,
    headers, body params y botones).
  - `payloadDeEnvio` bifurca: carrusel ⇒ usa el builder de carrusel; plana ⇒ camino actual.
  - `nombreArchivoImagen` con índice de tarjeta.
- **Frontend (vitest):** el wizard en modo carrusel arma `{ bodyVars, cards }` correctos;
  `columnasRequeridas` en carrusel solo exige teléfono (+ CEDULA si resumen).
- **En vivo (usuario):** crear una difusión de carrusel real, subir imágenes, enviar a un
  par de números y verificar en el teléfono (2 tarjetas con imagen, textos y botones).

## Límites (aceptados para v1)

- El mensaje que queda en la bandeja resume el carrusel (cuerpo general + marca + 1ª imagen);
  no reconstruye visualmente las N tarjetas en el historial propio.
- El resumen IA (si `requiereResumen`) representa el envío del carrusel con el cuerpo general
  en el transcript; no detalla cada tarjeta.
- Las respuestas de botones ("Asistiré/No Asistiré") entran como mensajes normales por la
  ingesta; **contarlas/tabularlas por evento queda fuera de v1** (feature aparte).
- Solo imágenes en el header de tarjeta (no video/documento en carrusel) para v1.
