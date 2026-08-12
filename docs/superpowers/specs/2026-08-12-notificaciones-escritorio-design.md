# Notificación de escritorio para mensajes entrantes — diseño

Fecha: 2026-08-12
Estado: aprobado (pendiente de plan)

## Problema

Hoy, al llegar un mensaje entrante de un chat que el agente no tiene abierto, suena
un mp3 ([`socket/cliente.js:39`](../../../frontend/src/socket/cliente.js) →
`useSonido().reproducir()`). Si el agente está en otra pestaña, otra ventana u otra
app, el sonido puede pasar desapercibido. Se quiere **además** un aviso **visual**:
una notificación de escritorio del navegador cuando no está mirando la bandeja.

## Decisiones (confirmadas por el usuario)

- **Alcance**: solo cuando la bandeja está **abierta** en el navegador (aunque el
  agente esté en otra pestaña/ventana/app). NO se hace push real (bandeja cerrada) —
  eso requeriría Service Worker + Web Push + VAPID y quedó descartado.
- **Contenido**: nombre/teléfono del contacto + **vista previa** del mensaje. Media →
  etiqueta (“📷 Imagen”, “🎤 Audio”, “🎬 Video”, “📎 Documento”).
- **Al hacer clic**: enfoca la ventana y abre ese chat.
- **Incluye contador en el título de la pestaña** (respaldo que funciona sin permiso).

## Alcance / no-alcance

- **Solo frontend** (Vue 3). Sin backend, sin migración, sin dependencias nuevas.
- Nada de contenido sale del navegador: la notificación la crea el propio navegador
  con datos que ya están en pantalla.
- Preferencia por agente/dispositivo (localStorage), como el sonido.

## Componentes

### 1. Store `notificaciones` (nuevo, hermano de `sonido`)

`frontend/src/stores/notificaciones.js`. Estado:

- `activado` (bool) ← `localStorage['wa_notif']`, **por defecto apagado** (requiere
  permiso explícito del navegador).

Getters/estado derivado:

- `soportado` = `typeof window !== 'undefined' && 'Notification' in window`.
- `permiso` = `Notification.permission` (`'default' | 'granted' | 'denied'`).
- `bloqueado` = `permiso === 'denied'` (el usuario lo negó en el navegador; el toggle
  se deshabilita).

Acciones:

- `async activar()`: si no está `soportado` o `bloqueado`, no hace nada. Pide permiso
  (`await Notification.requestPermission()`) — **debe llamarse desde un gesto del
  usuario** (clic del toggle), requisito de los navegadores. Si el resultado es
  `'granted'`, `activado = true` y persiste. Si no, queda apagado.
- `desactivar()`: `activado = false`, persiste. (No revoca el permiso del navegador,
  solo deja de mostrar.)
- `alternar()`: si está `activado` → `desactivar()`; si no → `activar()`.
- `mostrar({ conversacionId, titulo, cuerpo })`: **no** muestra nada si
  `!activado` o `permiso !== 'granted'`. Solo muestra si además la bandeja **no está
  enfocada** (`!document.hasFocus()`) — así no tapa la bandeja con un popup del SO
  cuando el agente ya la está mirando. Crea
  `new Notification(titulo, { body: cuerpo, tag: 'wa-conv-' + conversacionId, icon })`.
  `tag` por conversación → varios mensajes del mismo chat **reemplazan** el popup en
  vez de apilarse. `onclick`: `window.focus()`, abre ese chat (ver §3), `this.close()`.
  Todo envuelto en try/catch (algunos navegadores lanzan en contextos raros); un fallo
  nunca rompe el flujo del socket.

`icon` = el favicon/logo de la app (asset estático ya existente si lo hay; opcional).

### 2. Helper puro de vista previa

`frontend/src/utils/notificacion.js` (o dentro del store si es trivial): función pura
`vistaPreviaMensaje(mensaje)`:

- Si `mensaje.tipo === 'text'` (o el texto existe) → `mensaje.texto` recortado a ~120
  chars.
- Si no, según `mensaje.tipo`: `image → '📷 Imagen'`, `audio → '🎤 Audio'`,
  `video → '🎬 Video'`, `document → '📎 Documento'`, `sticker → 'Sticker'`,
  `location → '📍 Ubicación'`, otro → `'Nuevo mensaje'`.

Testeable con `vitest` (unidad pura).

### 3. Toggle 🖥️ en la cabecera

En `frontend/src/views/Bandeja.vue`, junto al botón de sonido
([`Bandeja.vue:112`](../../../frontend/src/views/Bandeja.vue)):

- Botón que llama `notif.alternar()`.
- Etiqueta: `activado` → “🖥️ Notificaciones” / apagado → “🖥️ Activar notificaciones”.
- `:disabled = !notif.soportado || notif.bloqueado`; tooltip cuando `bloqueado`:
  “Permiso de notificaciones bloqueado en el navegador”.
- Separado del toggle de sonido (preferencias independientes: se puede querer sonido
  sin popup o al revés).

### 4. Enganche en `socket/cliente.js`

En el handler `mensaje:nuevo`, junto a la línea del sonido
([`socket/cliente.js:39`](../../../frontend/src/socket/cliente.js)):

- Cuando el mensaje es `in` y el chat **no** está abierto (misma condición que el
  sonido): llamar `useNotificaciones().mostrar({ conversacionId, titulo, cuerpo })`.
  - `titulo` = nombre del contacto: `item?.contacto?.nombreDisplay ||
    item?.contacto?.nombreWa || item?.contacto?.telefono || 'Nuevo mensaje'`
    (misma lógica que `ItemConversacion.vue`). Cuando `!item` (chat que aún no está en
    la lista) → `'Nuevo mensaje'`.
  - `cuerpo` = `vistaPreviaMensaje(mensaje)`.
  - La decisión de mostrar u ocultar (permiso, activado, foco) vive **dentro** de
    `mostrar()` — el socket solo le pasa los datos.
- **Abrir el chat al hacer clic**: `mostrar()` guarda `conversacionId`; en `onclick`
  busca la conversación en `useConversaciones().items` por id y, si existe, llama
  `useChat().abrir(conv)`. Si no está (chat nuevo/reabierto que aún recarga), solo
  enfoca la ventana. (El socket ya dispara `useConversaciones().cargar()` para el caso
  `!item`.)

### 5. Contador en el título de la pestaña (punto 4)

Pequeño módulo/mixin de UI (en `Bandeja.vue` o un composable
`frontend/src/utils/tituloPestana.js`):

- Estado local `nuevosEnBackground` (número).
- En el handler `mensaje:nuevo`, si `mensaje.direccion === 'in'`, chat no abierto y
  `document.hidden` (pestaña en 2º plano) → incrementar el contador y poner
  `document.title = '(' + n + ') ' + TITULO_BASE`.
- Al volver a enfocar la pestaña (`document.addEventListener('visibilitychange', ...)`
  cuando `!document.hidden`) → resetear el contador y restaurar `document.title`.
- `TITULO_BASE` = el título actual de la app (se captura una vez al montar).
- Independiente del permiso de notificaciones: funciona siempre. Sirve de respaldo si
  el agente bloqueó las notificaciones del navegador.

## Reglas / invariantes

- El sonido **no cambia** su comportamiento actual (suena en entrantes de chats no
  abiertos, aunque la bandeja esté enfocada).
- El **popup de escritorio** solo aparece cuando la bandeja **no** está enfocada
  (`!document.hasFocus()`) — para no molestar cuando ya la está mirando.
- El **contador del título** solo cuenta cuando la pestaña está en 2º plano
  (`document.hidden`) y se limpia al volver a ella.
- Nada rompe el flujo del socket: `mostrar()` y el contador van en try/catch; un fallo
  se ignora (como ya hace el sonido con el autoplay).
- Preferencia persistida por dispositivo en `localStorage` (`wa_notif`), igual que
  `wa_sonido`.
- Cero llamadas de red nuevas; cero datos enviados a terceros.

## Pruebas

- `vitest`: `vistaPreviaMensaje` (texto recortado + cada tipo de media).
- `vitest`: store `notificaciones` — `activar()` con permiso `granted`/`denied`
  (mock de `Notification`/`requestPermission`), `mostrar()` respeta `activado`/permiso/
  `document.hasFocus()` (no crea notificación cuando corresponde).
- Verificación funcional en vivo (el usuario, tras desplegar): conceder permiso,
  ponerse en otra pestaña/app y confirmar que aparece el popup con nombre + vista
  previa, que al hacer clic enfoca y abre el chat, y que el título muestra el contador.

## Límites (aceptados)

- Solo con la bandeja abierta (sin push real con la app cerrada).
- Depende de que el agente conceda el permiso del navegador una vez; si lo bloquea, el
  contador del título es el respaldo.
- El popup del SO puede estar además silenciado/limitado por el sistema operativo
  (Do Not Disturb, etc.) — fuera de nuestro control.
