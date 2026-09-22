# Carrusel: validación de límite de caracteres — diseño

Fecha: 2026-09-22
Estado: aprobado (pendiente de plan)

## Problema

La difusión 56 (carrusel) falló al enviar con el error de 1msg:
`"Hydrated body length (167) is greater than the limit (160) (for card_index=1)"`.
El cuerpo de una tarjeta, ya rellenado con sus variables ("hidratado"), medía 167
caracteres y WhatsApp limita el cuerpo de cada tarjeta de carrusel a **160**. Hoy nada
valida ese límite: el error solo aparece **al enviar**, no al armar la campaña, y quema
un destinatario. WhatsApp también limita el **cuerpo general** (encabezado del carrusel)
a **1024** caracteres.

## Decisiones (confirmadas por el usuario)

- Validar **ambos** límites: cuerpo de cada tarjeta **≤ 160** y cuerpo general **≤ 1024**.

## Alcance / no-alcance

- Backend: `parsearTarjeta` expone el texto plantilla de la tarjeta; `carruselListo`
  (gate de `iniciar`) rechaza si algún cuerpo hidratado supera su límite.
- Frontend: el wizard muestra un contador vivo por tarjeta y del encabezado, y **bloquea
  "Cargar destinatarios"** si algún texto excede su límite.
- Solo carrusel. Sin dependencias nuevas. Solo tablas `wa_`. No se toca el envío ni el
  payload confirmado.

## Cómo se mide

"Hidratado" = el texto plantilla con las variables sustituidas: `renderizarCuerpo(texto, vars)`
(helper ya existente en back y front). Se cuenta con `String.length` (unidades UTF-16), que
es exactamente lo que midió 1msg en el caso real (dio 167, coincidiendo con nuestro cálculo).
Es una cota conservadora: para emojis de par sustituto cuenta de más, así que en el peor caso
bloquea un poco antes, nunca deja pasar uno inválido.

Constantes: `LIMITE_CUERPO_CARRUSEL = 160`, `LIMITE_CUERPO_GENERAL = 1024`.

## Arquitectura

### 1. Parseo — `src/services/plantillas.js`
`parsearTarjeta(card)` añade `texto: string` = el `BODY.text` de la tarjeta (la plantilla con
`{{n}}`). Los demás campos (`variables`, `tieneImagen`, `imagenDefault`, `botones`, `ejemplos`)
se mantienen. El texto del cuerpo general ya está expuesto como `parsearPlantilla(...).cuerpo`.

### 2. Gate backend — `src/services/difusiones.js` `carruselListo`
Tras los chequeos existentes (imágenes, textos completos, aspecto), añadir:
- Por cada tarjeta i: `renderizarCuerpo(def.carrusel.cards[i].texto, dif.carrusel.cards[i].vars).length`;
  si `> 160` → `{ ok:false, motivo: 'el texto de la tarjeta i+1 supera el límite de 160 caracteres (tiene N)' }`.
- Cuerpo general: `renderizarCuerpo(def.cuerpo, dif.carrusel.bodyVars).length`; si `> 1024` →
  `{ ok:false, motivo: 'el texto del encabezado supera el límite de 1024 caracteres (tiene N)' }`.
- Importa `renderizarCuerpo` de `./plantillas`. Las constantes viven en `difusiones.js` (o un
  módulo compartido si conviene; el plan decide).

### 3. Frontend — `frontend/src/components/DifusionWizard.vue`
En el editor de carrusel:
- **Encabezado**: bajo el/los input(s) del cuerpo general, contador `N / 1024` que se pone rojo
  si `renderizarCuerpo(plantilla.cuerpo, carrusel.bodyVars).length > 1024`.
- **Cada tarjeta**: bajo los inputs de variables, contador `N / 160` que se pone rojo si
  `renderizarCuerpo(plantilla.carrusel.cards[ci].texto, card.vars).length > 160`.
- `puedeCargar` gana una condición: **false** si el encabezado o alguna tarjeta excede su límite
  (helper `carruselExcedeLimite` computado). Así el botón "Cargar destinatarios" queda deshabilitado.

Se reutiliza `renderizarCuerpo` ya importado en el wizard.

## Reglas / invariantes

- El backend es la garantía real (bloquea `iniciar`); el frontend es feedback temprano.
- Regresión cero: no cambia nada para plantillas planas ni para carruseles que ya cumplen.
- Se mide sobre el texto hidratado, igual que WhatsApp.

## Pruebas

- **Backend puro (node:test):**
  - `parsearTarjeta` expone `texto` (el BODY.text de la tarjeta).
  - `carruselListo`: una tarjeta cuyo cuerpo hidratado da >160 → `ok:false` con el mensaje y el
    número; ≤160 → ok. Cuerpo general >1024 → `ok:false`; ≤1024 → ok.
- **Frontend:** el contador refleja el largo hidratado; `puedeCargar` es false cuando algún texto
  excede su límite (helper puro testeable en `utils/difusion` si se extrae).
- **En vivo (usuario):** en el wizard, escribir un texto largo en una tarjeta → contador rojo y
  "Cargar" deshabilitado; al acortarlo por debajo de 160, se habilita; si por algún camino se
  cuela, `iniciar` lo rechaza con el mensaje.

## Límites (aceptados v1)

- Se cuenta con `String.length` (UTF-16), cota conservadora frente a emojis de par sustituto.
- Solo carrusel (las plantillas planas no tienen este problema de tarjetas).
