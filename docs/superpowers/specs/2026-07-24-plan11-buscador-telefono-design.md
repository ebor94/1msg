# Diseño — Plan 11: Buscador por teléfono (iniciar/abrir/tomar chat)

Fecha: 2026-07-24 · Fase 2 · Bandeja WhatsApp Serfunorte

## Objetivo

Que un agente busque por número de teléfono y: abra el chat (cargando su historial —
Plan 10), lo **tome** si lo atiende otro agente (con confirmación, auditado), o **inicie**
uno nuevo si el número no existe en la bandeja.

## Contexto (lo que ya existe)

- `listar({ q })` busca por `nombreDisplay/nombreWa/telefono`, **pero acotado a la bandeja
  del agente** (mías/general/todos) → un asesor NO encuentra el chat de otro asesor. Por eso
  se necesita un buscador **global**.
- `asignar` (POST `/conversaciones/:id/asignar`) reasigna una conversación y registra el
  traspaso en `wa_asignaciones` (de→a, quién, cuándo). **No tiene candado de rol**, así que
  un asesor ya puede tomárselo (decisión de negocio confirmada: asesores se pasan chats).
- `puedeVer`: admin ve todo; asesor ve lo suyo + general (`agente_id NULL`). Para abrir el
  chat de OTRO asesor primero hay que tomarlo (reasignar a sí mismo).
- `POST /contactos` (crear) ya crea contacto + conversación asignada al agente (Plan 6).
- Al abrir cualquier chat, el backfill del historial (Plan 10) trae lo de 1msg — así, un
  número nuevo que ya había escrito a la empresa muestra su historial al iniciarlo.

## Componentes

### 1. Backend — `GET /api/contactos/buscar?telefono=X`

- `requireAuth`. Cualquier agente puede buscar (solo devuelve **metadatos**, no mensajes).
- Normaliza dígitos de `X` (`soloDigitos`). Si queda vacío → `{ resultados: [] }`.
- Busca **global** en `wa_contactos` por `telefono LIKE %X%` o `waId LIKE %X%` (límite 10),
  ordenado por conversación más reciente. Para cada contacto toma su conversación actual
  (la más reciente / abierta) con su agente dueño.
- Responde `{ resultados: [ {
    contactoId, telefono, nombre,            // nombreDisplay || nombreWa || telefono
    conversacionId,                          // null si el contacto no tiene conversación
    agenteActualId, agenteActualNombre,      // null/null si general
    esMio,      // agenteActualId === req.agente.id
    esGeneral,  // agenteActualId === null
    conversacion: { id, agenteId, ventanaExpiraEn, contacto: { id, waId, telefono, nombreWa, nombreDisplay } }
  } ] }`.
- El objeto `conversacion` viene listo para `chat.abrir` (mismos campos que un ítem de la lista).
- Nuevo método `buscar` en `contactosController.js`.

### 2. Tomar / iniciar — se reutiliza lo existente

- **Tomar de otro**: `POST /conversaciones/:id/asignar` con `{ agenteId: <yo> }` (ya existe;
  crea el audit). Se llama tras confirmar en el frontend.
- **General**: `POST /conversaciones/:id/tomar` (toma atómica, ya existe) o `asignar`.
- **Número nuevo**: `POST /contactos` (crear, ya existe) → devuelve `{ conversacion }`.

### 3. Frontend — buscador en el header de la bandeja

- Caja de búsqueda en el header (junto a "＋ Contacto"). Input de teléfono con **debounce**
  (~300 ms); si hay ≥3 dígitos, llama `GET /contactos/buscar`. Muestra un panel de resultados.
- Store `useBusqueda` (o dentro de `acciones`): `resultados`, `buscando`, `buscar(telefono)`.
- Cada resultado: nombre, teléfono, y una etiqueta según el dueño: **"Tuyo"** (verde),
  **"General"** (gris), **"de {Agente}"** (ámbar).
- Al hacer clic en un resultado:
  - `esMio` o `esGeneral` → `chat.abrir(resultado.conversacion)` (carga historial). Si es
    general, un botón "Tomar" adicional (toma → pasa a Míos).
  - **de otro agente** → diálogo de confirmación: *"Este chat lo atiende {Agente}. ¿Tomarlo?"*
    → `asignar(convId, yo)` → recargar Míos → `chat.abrir`.
- Si no hay resultados y el input parece un número (≥7 dígitos): opción **"Iniciar chat con
  {número}"** → `crearContacto(telefono)` (reutiliza el flujo del Plan 6: crea, recarga Míos,
  abre) → el backfill trae el historial si 1msg lo tiene.
- Cerrar el panel al elegir o al vaciar el input.

## Invariantes / constraints

- El buscador es global pero devuelve **solo metadatos**; los mensajes siguen protegidos por
  `puedeVer` (para abrir el de otro hay que tomarlo primero).
- Tomar de otro agente **siempre con confirmación** y queda auditado en `wa_asignaciones`
  (de→a, `ejecutado_por`, `creado_en`).
- Sin token al frontend; permiso por conversación intacto en los endpoints de mensajes.
- No se toca el modelo ni hay migración; se reutilizan `asignar`, `tomar`, `crear` y el
  backfill del Plan 10.

## Pruebas

- Backend `contactosController.buscar`: con modelos/inyección — normaliza dígitos, arma el
  resultado con `esMio/esGeneral`, límite, y contacto sin conversación → `conversacionId null`.
  (Si no hay scaffolding de DB, testear la parte pura: normalización y el mapeo de un
  contacto+conversación a la forma de salida.)
- Frontend (vitest): el store `buscar` puebla `resultados`; el mapeo de etiqueta según dueño.
- Prueba real: (a) buscar un número propio ya existente y abrirlo con su historial; (b) buscar
  uno que atiende otro agente → confirmar → tomarlo → se abre y pasa a Míos; (c) buscar un
  número nuevo → "Iniciar chat" → se crea y, si tenía historial en 1msg, aparece.

## Fuera de alcance (otros planes)

- Búsqueda por nombre/texto libre global (por ahora solo teléfono; `listar({q})` cubre la
  búsqueda dentro de la propia bandeja).
- Scroll de la lista de bandeja (Plan 12), editar nombre (Plan 13), sonido (14), audio (15),
  auditoría/visualización del historial de asignaciones (Plan 16).
