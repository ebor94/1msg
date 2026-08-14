# Aviso de "contacto asignado" (notificación de escritorio) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando un admin/agente reasigna una conversación a otro agente, el agente que la recibe ve una notificación de escritorio "Contacto asignado — Se te asignó el chat de \<nombre\>" (aunque esté mirando la bandeja); clic abre el chat.

**Architecture:** Reutiliza el store `notificaciones` (`mostrar`) ya existente. El backend enriquece el evento `conversacion:asignada` de la reasignación manual (`asignar`) con `nombre` (contacto) y `por` (quién asignó). El frontend, en el handler de ese evento, dispara la notificación solo si el chat me lo asignaron a mí y no fui yo.

**Tech Stack:** Node/Express/Sequelize (backend), Vue 3 + Pinia + Vitest (frontend), Socket.io, Web Notification API.

## Global Constraints

- **La notificación solo le llega al agente destino** (`agenteId === mi id`) y **no cuando él mismo tomó/asignó** (`por !== mi id`). El admin que asigna NO recibe popup.
- **Solo frontend + enriquecer el payload del socket**. Sin migración, sin dependencias, sin BD nueva.
- Reusa el permiso/toggle de notificaciones ya existente; sin permiso, no hay popup (la lista igual se actualiza).
- **Aparece aunque la bandeja esté enfocada** (para asignaciones): `mostrar` gana una opción `omitirFoco` que se salta el chequeo `!document.hasFocus()`. El uso actual (mensajes) llama SIN `omitirFoco`, así que su comportamiento no cambia.
- Solo se enriquece el emit de la **reasignación manual** (`asignar`, controllerConversaciones línea ~605). Los otros emits de `conversacion:asignada` — `liberarToma` (a general, `agenteId:null`), `emitirAutoToma` (auto), `tomar` (uno mismo) — NO se tocan: no representan "alguien más me asignó un chat" y no deben avisar (el frontend además exige `por` presente).
- Convenciones del repo; nada de red nuevo; solo tablas `wa_` (aquí ni se tocan tablas — solo se lee el nombre del contacto).
- Test frontend: `npm --prefix frontend test` (un archivo: `-- <ruta>`), build `npm --prefix frontend run build`. Test backend: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`.

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `frontend/src/stores/notificaciones.js` | `mostrar` acepta `omitirFoco` | Modificar |
| `frontend/src/stores/notificaciones.test.js` | test de `omitirFoco` | Modificar |
| `src/controllers/conversacionesController.js` | `asignar` emite `nombre` + `por` (+ helper) | Modificar |
| `frontend/src/socket/cliente.js` | handler `conversacion:asignada` dispara la notificación | Modificar |

---

## Task 1: `mostrar()` acepta `omitirFoco`

**Files:**
- Modify: `frontend/src/stores/notificaciones.js`
- Test: `frontend/src/stores/notificaciones.test.js`

**Interfaces:**
- Produces: `mostrar({ conversacionId, titulo, cuerpo, onAbrir, omitirFoco })` — cuando `omitirFoco` es true, NO aplica el chequeo `!document.hasFocus()` (aparece aunque la bandeja esté enfocada). Sin `omitirFoco`, comportamiento actual.

- [ ] **Step 1: Añadir el test de `omitirFoco`**

In `frontend/src/stores/notificaciones.test.js`, add (reusa el helper `stubNotification` ya presente en el archivo):

```js
  it('mostrar({omitirFoco:true}) crea la notificación aunque la bandeja esté enfocada', () => {
    const ctor = stubNotification({ permission: 'granted' });
    document.hasFocus = () => true;
    const n = useNotificaciones();
    n.activado = true;
    n.mostrar({ conversacionId: 3, titulo: 'Contacto asignado', cuerpo: 'Se te asignó el chat de Ana', omitirFoco: true });
    expect(ctor).toHaveBeenCalledWith('Contacto asignado', { body: 'Se te asignó el chat de Ana', tag: 'wa-conv-3' });
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm --prefix frontend test -- src/stores/notificaciones.test.js`
Expected: FAIL — con `omitirFoco` la notificación aún no se crea (el gate de foco la bloquea).

- [ ] **Step 3: Implementar `omitirFoco`**

In `frontend/src/stores/notificaciones.js`, update the `mostrar` signature and the focus guard:

```js
    mostrar({ conversacionId, titulo, cuerpo, onAbrir, omitirFoco }) {
      if (!this.activado || this.permiso !== 'granted') return;
      // No molestar con un popup del SO si el agente ya está mirando la bandeja
      // (salvo omitirFoco: para eventos que deben verse siempre, p. ej. una asignación).
      if (!omitirFoco && typeof document !== 'undefined' && document.hasFocus && document.hasFocus()) return;
      try {
        const n = new Notification(titulo, { body: cuerpo, tag: `wa-conv-${conversacionId}` });
        n.onclick = () => {
          try { window.focus(); } catch { /* ignore */ }
          if (typeof onAbrir === 'function') onAbrir();
          n.close();
        };
      } catch { /* algunos navegadores lanzan en contextos raros; no romper el socket */ }
    },
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm --prefix frontend test -- src/stores/notificaciones.test.js`
Expected: PASS (los tests previos + el nuevo).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/notificaciones.js frontend/src/stores/notificaciones.test.js
git commit -m "feat(notif): mostrar() acepta omitirFoco (aparece aunque la bandeja esté enfocada)"
```

---

## Task 2: Backend — enriquecer el emit de `asignar`

**Files:**
- Modify: `src/controllers/conversacionesController.js`

**Interfaces:**
- Consumes: `Contacto` (ya importado en el archivo), `emitirARooms`, `roomsDeAsignacion`.
- Produces: el emit `conversacion:asignada` del handler `asignar` lleva `{ conversacionId, agenteId, nombre, por }` (antes solo los dos primeros). Helper `nombreDelContacto(contactoId) → Promise<string|null>`.

- [ ] **Step 1: Añadir el helper `nombreDelContacto`**

In `src/controllers/conversacionesController.js`, add near the other helpers (p. ej. cerca de `roomsDeAsignacion`):

```js
/** Nombre visible del contacto de una conversación (para el aviso de asignación). */
async function nombreDelContacto(contactoId) {
  const c = await Contacto.findByPk(contactoId, { attributes: ['nombreDisplay', 'nombreWa', 'telefono'] });
  return c ? (c.nombreDisplay || c.nombreWa || c.telefono) : null;
}
```

- [ ] **Step 2: Enriquecer el emit de `asignar`**

In `src/controllers/conversacionesController.js`, in `asignar`, replace the emit line:

```js
    emitirARooms('conversacion:asignada', roomsDeAsignacion(anterior, nuevo), { conversacionId: Number(id), agenteId: nuevo });
```
with:
```js
    const nombreCto = nuevo ? await nombreDelContacto(conv.contactoId) : null;
    emitirARooms('conversacion:asignada', roomsDeAsignacion(anterior, nuevo), { conversacionId: Number(id), agenteId: nuevo, nombre: nombreCto, por: me });
```
(`conv` ya está cargado arriba en el handler; `me` = `req.agente.id`. Cuando `nuevo` es null —des-asignar a general— `nombre` queda null y no hay agente a quien avisar.)

- [ ] **Step 3: Verificar sintaxis + suite backend (sin regresiones)**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/controllers/conversacionesController.js && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected: sintaxis OK; PASS (sin regresiones). (El emit va por socket; no hay test unitario directo — se valida en vivo.)

- [ ] **Step 4: Commit**

```bash
git add src/controllers/conversacionesController.js
git commit -m "feat(notif): el emit de asignar lleva nombre del contacto + quién asignó"
```

---

## Task 3: Frontend — disparar la notificación al recibir la asignación

**Files:**
- Modify: `frontend/src/socket/cliente.js`

**Interfaces:**
- Consumes: `useNotificaciones().mostrar` con `omitirFoco` (Task 1); el payload enriquecido `{ conversacionId, agenteId, nombre, por }` (Task 2); `useAuth`, `useChat`, `useConversaciones` (ya importados en el archivo).

- [ ] **Step 1: Ampliar el handler `conversacion:asignada`**

In `frontend/src/socket/cliente.js`, replace the current handler:

```js
  socket.on('conversacion:asignada', ({ conversacionId, agenteId }) => {
    const chat = useChat();
    if (chat.conversacion && chat.conversacion.id === conversacionId) chat.conversacion.agenteId = agenteId;
    useConversaciones().cargar();
  });
```
with:
```js
  socket.on('conversacion:asignada', ({ conversacionId, agenteId, nombre, por }) => {
    const chat = useChat();
    if (chat.conversacion && chat.conversacion.id === conversacionId) chat.conversacion.agenteId = agenteId;
    useConversaciones().cargar();
    // Aviso solo al agente que RECIBE el chat y que no fue quien lo asignó/tomó.
    const yo = useAuth().agente?.id;
    if (yo != null && agenteId === yo && por != null && por !== yo) {
      useNotificaciones().mostrar({
        conversacionId,
        titulo: 'Contacto asignado',
        cuerpo: `Se te asignó el chat de ${nombre || 'un contacto'}`,
        omitirFoco: true,
        onAbrir: () => {
          const conv = useConversaciones().items.find((c) => c.id === conversacionId);
          if (conv) chat.abrir(conv);
        },
      });
    }
  });
```
(Confirma que `useAuth` y `useNotificaciones` ya están importados arriba en el archivo — lo están por la funcionalidad de notificaciones de mensajes; si faltara alguno, agrégalo.)

- [ ] **Step 2: Suite frontend + build**

Run: `npm --prefix frontend test` (todo verde) y `npm --prefix frontend run build` (OK).
(El archivo del socket no tiene test unitario; se apoya en las piezas ya testeadas —`mostrar`/`omitirFoco`— y se valida en vivo.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/socket/cliente.js
git commit -m "feat(notif): notificación de escritorio al recibir un contacto asignado"
```

---

## Despliegue (tras merge)

Solo frontend + backend, sin migración ni dependencias:
```bash
ssh mantix 'cd ~/apps/wa && git pull --ff-only && npm --prefix frontend run build && pm2 restart wa-backend'
```
(Reinicia `wa-backend` por el cambio del emit; el `wa-worker` no cambió.)

**Verificación en vivo (usuario):** con dos sesiones (un admin y un agente con el permiso de notificaciones activo), el admin **asigna** un chat al agente → al agente le aparece "Contacto asignado — Se te asignó el chat de \<nombre\>" aunque tenga la bandeja al frente; clic abre el chat. El admin NO recibe popup; si el agente **toma** su propio chat, tampoco.
