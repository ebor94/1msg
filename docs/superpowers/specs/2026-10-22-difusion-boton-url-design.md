# Difusión: soporte de plantillas con botón de URL dinámico — diseño

Fecha: 2026-10-22
Estado: aprobado (pendiente de plan)

## Problema

Se aprobó la plantilla `mensaje_boton_link`: cuerpo con 1 variable + pie fijo + un **botón
de URL dinámico** (`https://losolivoscucuta.com/{{1}}`, texto "Respnder"). El envío de
difusión hoy arma solo `body` (+ imagen de header); **no arma el componente `button`**, así
que el `{{1}}` del link quedaría sin llenar y Meta rechaza el envío. Hay que soportar el
botón de URL en el flujo de difusión para poder usar esta plantilla en envíos masivos.

Estructura real (`listarPlantillas`):
- BODY `"Los Olivos, {{1}} . Gracias"` (1 var).
- FOOTER `"Los Olivos, un homenaje al amor"` (fijo).
- BUTTONS: `[{ type:'URL', text:'Respnder', url:'https://losolivoscucuta.com/{{1}}', example:['bigDay-encuesta/'] }]` (1 var).

## Decisiones (confirmadas por el usuario)

- El/los valor(es) del botón de URL son **fijos para toda la campaña** (un input en el wizard).
- Diseño **genérico**: N variables de cuerpo (ya soportadas) + M variables de botón de URL.

## Alcance

- Backend: parseo del botón, armado del componente `button`, columna para los valores fijos,
  `crear`/`iniciar`.
- Frontend: input(s) del botón en el wizard (plantillas planas con botón de URL).
- Sin dependencias nuevas. Solo tablas `wa_`. No se toca carrusel ni el header.

## Arquitectura

### 1. Parseo — `src/services/plantillas.js`
`parsearPlantilla` añade `botonUrl` (null si no hay botón de URL con variables):
```js
botonUrl: { index, variables, texto, ejemplos }
```
- `index`: posición del botón en `BUTTONS.buttons` (para el `index` del payload).
- `variables`: `contarVariables(boton.url)` (nº de `{{n}}` en la URL).
- `texto`: el texto del botón.
- `ejemplos`: `boton.example` (array) para pre-llenar el wizard.
Solo se considera botón de URL con al menos una variable (`type:'URL'` y `{{n}}` en `url`).

### 2. Armado del envío — `src/services/plantillas.js` + `src/services/difusionEnvio.js`
Nueva pura `construirParamsBotonUrl(valores, index) → [{ type:'button', index, sub_type:'url', parameters:[{type:'text', text}] }]` (`[]` si no hay valores). `payloadDeEnvio` (camino plano) agrega el botón cuando `def.botonUrl && dif.botonParams`:
```js
const header = def.tieneImagen ? construirParamsHeader(dif.imagenUrl || def.imagenDefault) : [];
const boton = (def.botonUrl && dif.botonParams) ? construirParamsBotonUrl(dif.botonParams, def.botonUrl.index) : [];
return { ...base, params: [...header, ...construirParams(dest.parametros), ...boton] };
```
El camino de carrusel no cambia.

### 3. Modelo + migración 014
`wa_difusiones` gana `boton_params JSON NULL` (array de valores fijos del botón). Modelo
`Difusion`: `botonParams: { type: DataTypes.JSON, allowNull: true }`.

### 4. Crear + iniciar — `src/services/difusiones.js` + controller
- `crear` acepta `botonParams` y persiste `botonParams: botonParams || null`.
- Pura `faltaBotonUrl(dif, def)`: true si `def.botonUrl.variables > 0` y `dif.botonParams` no tiene esa cantidad de valores no vacíos.
- `iniciar`: carga `def` (del catálogo); si `def.botonUrl && faltaBotonUrl(dif, def)` → `err(400, 'falta el valor del botón de enlace')`. (El guard de carrusel existente no cambia.)
- Controller `crear` pasa `botonParams: b.botonParams`.

### 5. Frontend — `DifusionWizard.vue`
- Estado `botonParams = ref([])`. Al elegir plantilla: si `plantilla.botonUrl`, inicializa
  `botonParams` con longitud `botonUrl.variables` (vacíos); si no, `[]`.
- Si `plantilla.botonUrl` (y no es carrusel): bloque con input(s) "Enlace del botón" (texto del
  botón como etiqueta), pre-llenados con `botonUrl.ejemplos`.
- `crearYCargar`: agrega `botonParams: botonParams.value` al `datos` cuando la plantilla tiene botón de URL.
- `puedeCargar`: también exige que los `botonParams` estén completos cuando `plantilla.botonUrl`.

## Reglas / invariantes

- Solo afecta el camino **plano**; carrusel e imagen de header intactos.
- Valores del botón fijos por campaña (no por destinatario).
- Si la plantilla no tiene botón de URL, nada cambia (botonUrl null, botonParams no se usa).
- El guard de `iniciar` evita enviar sin el valor del botón (que Meta rechazaría).

## Pruebas

- **Backend puro (node:test):**
  - `parsearPlantilla`: `mensaje_boton_link` → `botonUrl.variables===1`, `index===0`, `texto`, `ejemplos`; una plantilla sin botón de URL → `botonUrl===null`.
  - `construirParamsBotonUrl(['x'], 0)` → el componente button correcto; `[]` → `[]`.
  - `payloadDeEnvio`: plantilla con botón → el `params` incluye body + button; sin botón → sin button (sin regresión).
  - `faltaBotonUrl`: sin valor → true; con valor → false; plantilla sin botón → false.
- **Backend:** `crear` persiste `botonParams`.
- **Frontend:** el wizard arma `botonParams` y lo envía; `puedeCargar` falso si falta.
- **En vivo:** difusión con `mensaje_boton_link` (cuerpo + `bigDay-encuesta/`) → llega con el botón "Respnder" apuntando a `https://losolivoscucuta.com/bigDay-encuesta/`.

## Límites (v1)

- Botón de URL con valores **fijos** por campaña (no per-destinatario).
- Un solo botón de URL por plantilla (el primero con variables); no se manejan botones de
  respuesta rápida dinámicos (no aplica a esta plantilla).
