# Orden "más viejo primero" al filtrar solo no leídos — diseño

Fecha: 2026-09-24
Estado: aprobado

## Problema

Los agentes quieren, al activar el filtro **"solo no leídos"**, ver los chats **del más
viejo al más nuevo**, para atender primero al que más lleva esperando. Hoy la bandeja
"Mías" (y demás salvo general) ordena `ultimoMensajeEn DESC` (más nuevo primero); la
general ya ordena `ASC`.

## Decisión (confirmada por el usuario)

- **Solo cuando el filtro "solo no leídos" está activo** la lista se ordena
  `ultimoMensajeEn ASC` (más viejo primero), en cualquier bandeja. En vista normal, todo
  queda igual (más nuevo primero, salvo general que ya es ASC).

## Alcance

- Backend únicamente: una condición en el orden de `src/services/conversaciones.js` `listar`.
  El frontend ya envía `noLeidos=1` al activar el filtro y el controlador ya lo mapea a
  `soloNoLeidos`, así que no se toca el frontend.

## Diseño

- Extraer un helper puro `ordenLista(bandeja, soloNoLeidos)` que devuelva
  `[['ultimoMensajeEn', 'ASC']]` cuando `bandeja === 'general'` **o** `soloNoLeidos`;
  `[['ultimoMensajeEn', 'DESC']]` en caso contrario. `listar` lo usa en lugar del ternario
  actual. Se exporta para poder testearlo.

## Pruebas

- Puro (node:test, en `test/conversaciones-filtro.test.js`): `ordenLista('mias', true)` → ASC;
  `ordenLista('mias', false)` → DESC; `ordenLista('general', false)` → ASC.

## Invariantes

- Sin cambio de esquema, sin frontend, sin regresión (general sigue ASC; "mías" normal sigue
  DESC). Solo cambia el orden cuando el agente pide "solo no leídos".
