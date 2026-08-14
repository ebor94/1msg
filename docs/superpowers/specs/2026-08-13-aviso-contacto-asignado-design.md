# Aviso de "contacto asignado" (notificación de escritorio) — diseño

Fecha: 2026-08-13
Estado: aprobado (pendiente de plan)

## Problema

Cuando un admin (o un agente) asigna/reasigna una conversación a otro agente, el
agente que la **recibe** no ve ningún aviso: la lista se actualiza en silencio y
puede pasársele. Se quiere una **notificación de escritorio** ("Contacto asignado")
para el agente que recibe el chat.

## Decisiones (confirmadas por el usuario)

- **Tipo**: notificación de escritorio del navegador — **reutiliza** el store
  `notificaciones` (`mostrar(...)`) que ya existe (la de mensajes entrantes). Cero UI
  nueva.
- **Siempre visible**: a diferencia de la de mensajes, esta debe aparecer **aunque el
  agente esté mirando la bandeja** (no solo cuando está en otra pestaña) — una
  asignación es un evento discreto que no debe perderse. Requiere un pequeño ajuste a
  `mostrar()` para saltarse el chequeo de foco en este caso.
- **Solo al que recibe**: le llega únicamente al agente destino (`agenteId` = su id) y
  **no cuando él mismo tomó el chat** (`por` ≠ su id) — así no le avisa al admin que
  asigna ni al agente que hace "tomar".

## Alcance / no-alcance

- **Solo frontend + un enriquecimiento del payload del socket** (backend). Sin
  migración, sin dependencias, sin BD nueva.
- Reutiliza el evento `conversacion:asignada` que ya se emite a la sala del agente
  destino (y origen/admins). Solo se le agregan datos; el comportamiento actual
  (actualizar la lista) no cambia.
- Requiere el permiso de notificaciones del navegador (el mismo toggle que ya existe).

## Flujo

### Backend — enriquecer el evento
Los handlers que emiten `conversacion:asignada` hacia un agente destino
(`src/controllers/conversacionesController.js`: `tomar`, `asignar`, `resolver`/toma, y
la reasignación) agregan al payload:
- `nombre`: el nombre visible del contacto (`nombreDisplay || nombreWa || telefono`).
- `por`: el id del agente que ejecutó la acción (`req.agente.id`).

Payload nuevo: `{ conversacionId, agenteId, nombre, por }` (los dos primeros ya iban).
Para el nombre se carga el contacto de la conversación (una sola lectura; la
conversación ya se consulta en esos handlers). Los emits de **des-asignación** a
general (`agenteId: null`) no necesitan `nombre`/`por` (no hay agente a quien avisar).

### Frontend — mostrar la notificación
En el handler `socket.on('conversacion:asignada', ...)` de
`frontend/src/socket/cliente.js`, además de lo actual (actualizar chat abierto +
recargar lista), si:
- `agenteId === auth.agente.id` (me lo asignaron a mí), **y**
- `por !== auth.agente.id` (no fui yo quien lo tomó/asignó),

entonces `useNotificaciones().mostrar({ conversacionId, titulo: 'Contacto asignado',
cuerpo: 'Se te asignó el chat de ' + nombre, onAbrir, omitirFoco: true })`.
- `onAbrir`: busca la conversación por id en `useConversaciones().items` y
  `useChat().abrir(conv)` si existe (mismo patrón que la notificación de mensajes).
- `omitirFoco: true`: hace que el popup aparezca aunque la bandeja esté enfocada.

### Ajuste a `mostrar()`
`frontend/src/stores/notificaciones.js` `mostrar({..., omitirFoco })`: el chequeo de
foco (`!document.hasFocus()`) se **salta** cuando `omitirFoco` es true. Todo lo demás
igual (respeta `activado` + permiso `granted`; `tag` por conversación; onclick
enfoca + abre + cierra; try/catch). El uso actual (mensajes) llama sin `omitirFoco`,
así que su comportamiento no cambia.

## Reglas / invariantes

- La notificación **solo** aparece para el agente destino y **no** para el iniciador
  (gate `agenteId === yo && por !== yo`).
- Reusa el permiso/toggle de notificaciones ya existente; si el agente no lo activó,
  no hay popup (la lista igual se actualiza).
- El evento sigue emitiéndose a las mismas salas; solo se enriquece el payload. La
  actualización de la lista (comportamiento actual) no cambia.
- Nada de red nuevo; la notificación la crea el propio navegador con datos que ya
  llegan por el socket.

## Pruebas

- Frontend (vitest): `mostrar({ omitirFoco: true })` crea la notificación **aunque**
  `document.hasFocus()` sea true; sin `omitirFoco` mantiene el gate de foco.
- Backend: los emits enriquecidos llevan `nombre` y `por` (verificable en los handlers;
  la mayoría no tiene test unitario directo — se valida en vivo).
- Verificación en vivo (usuario): con dos sesiones (admin + agente, permiso activo),
  el admin asigna un chat al agente → al agente le aparece "Contacto asignado — Se te
  asignó el chat de \<nombre\>" aunque esté en la bandeja; clic abre el chat; el admin
  NO recibe popup; si el agente toma su propio chat, tampoco.

## Límites (aceptados)

- Depende del permiso de notificaciones del navegador (por dispositivo).
- Solo notificación de escritorio (sin burbuja in-app) — decisión del usuario.
- La auto-asignación por cascada de la ingesta (worker) no lleva `por` humano; si en el
  futuro se quiere avisar de chats auto-ruteados, se decide aparte (fuera de v1).
