# Fase 2 — Bandeja operativa (API + tiempo real + frontend)

Diseño validado 2026-07-24. Reemplaza la bandeja de 1msg por una propia: los
agentes ven, atienden y responden los chats de WhatsApp desde nuestra interfaz.

## 1. Objetivo y alcance

Construir la **bandeja operativa completa** sobre la ingesta de la Fase 1 (que ya
graba contactos, conversaciones, mensajes, acks y medios en `serfuweb`).

**Dentro (v1):**
- Login con credenciales de `serfuweb`.
- Lista de conversaciones (mías / general / todos) con búsqueda y paginación.
- Ver un chat: historial con scroll hacia atrás, media, estados de entrega.
- Tiempo real (Socket.io): mensajes, acks y asignaciones sin recargar.
- Enviar texto dentro de la ventana de 24h; **selector de plantillas** fuera de ella.
- Tomar chats de general, **asignar/reasignar** (asesores y admins), crear contactos.
- Notificaciones: **sonido**, indicador visual, título de pestaña, notificación de
  escritorio opcional, y **marcar como no leído**.

**Fuera (fases/iteraciones posteriores):** difusiones, reportes/métricas, detalle
fino de la UI de adjuntos multimedia (se refina más adelante).

## 2. Usuarios y roles

Los agentes son usuarios de `serfuweb.usuarios` enlazados por `wa_agentes.usuario_id`
(ver `docs/migraciones/001-usuarios-serfuweb.sql`). Login: usuario + clave de
serfuweb, validado con **bcrypt** (`$2a$`) contra `serfuweb.usuarios.password`, y
debe existir fila en `wa_agentes`.

- **administrador** (hoy: `bortega`, `ssuarez`): ve todo (pestaña *Todos* + filtro
  por agente), asigna/reasigna a cualquiera.
- **asesor**: ve *Míos* + *General*; puede tomar de general y **también pasar chats
  a otros agentes** (reasignación entre asesores permitida).

## 3. Reglas de asignación

- **Continuidad (regla 1):** si el contacto tiene `agente_dueno_id` activo → ese agente.
- **Temporal (por ahora):** sin dueño → reparto **aleatorio entre administradores
  activos** (bortega/ssuarez). Implementado en `src/services/asignacion.js`
  (`AUTO_ROTACION`). Se revisará al incorporar asesores (volver a general o rotar
  entre asesores).
- **Tomar un chat** (de general): asignación atómica; el agente queda **dueño**
  (`wa_contactos.agente_dueno_id`) para la continuidad.
- **Crear contacto:** queda con `agente_dueno_id` = quien lo crea.
- **Reasignar:** asesores y admins pueden mover una conversación a otro agente o a
  general; se registra en `wa_asignaciones`.

## 4. Diseño / UX

Base **tipo WhatsApp Web** con identidad Serfunorte, **responsive** (escritorio y
móvil). Mockups aprobados en `.superpowers/brainstorm/` (layout + vista admin).

**Escritorio — 3 zonas:**
1. **Lista** (izq): pestañas *Míos / General* (+ *Todos* y filtro por agente para
   admin), buscador, ítems con avatar, último mensaje, hora y badge de no leídos.
   General se ordena FIFO por `ultimo_mensaje_en ASC`; las demás por reciente.
2. **Conversación** (centro): cabecera del contacto, burbujas in/out con estados
   (✓✓), indicador de ventana 24h, compositor (texto + adjuntar + emoji). Los
   salientes se prefijan con la firma del agente (`wa_agentes.firma`).
3. **Panel de cliente** (der): teléfono, estado, asignado a, etiquetas, notas
   internas, y acciones (Tomar / Asignar / Cerrar).

**Móvil:** las 3 zonas se colapsan en una; lista → chat a pantalla completa; el
panel de cliente se abre con un botón.

**Notificaciones:**
- **Sonido** al llegar un mensaje entrante (con toggle silenciar; respeta autoplay).
- **Visual:** badge de no leídos + contador en el título de la pestaña
  (`(3) Serfunorte`) + notificación de escritorio opcional (permiso una vez).
- **Marcar como no leído:** acción por conversación (deja `no_leidos ≥ 1`).

## 5. API de bandeja (REST, prefijo `/api`, JWT salvo login)

- **Auth:** `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`.
- **Bandeja:** `GET /conversaciones?bandeja=mias|general|todos&agente=&q=&cursor=`
  (paginada 25; `todos`/`agente` solo admin).
- **Chat:** `GET /conversaciones/:id/mensajes?antesDe=` (scroll atrás);
  `POST /conversaciones/:id/leer`; `POST /conversaciones/:id/no-leido`;
  `POST /conversaciones/:id/cerrar`.
- **Enviar:** `POST /conversaciones/:id/mensajes` — body `{texto}` (dentro de
  ventana) o `{plantilla, variables}` (fuera). Valida ventana 24h, antepone firma,
  envía por 1msg con reintento/backoff, **persiste antes de emitir** por socket.
- **Asignar:** `POST /conversaciones/:id/tomar`; `POST /conversaciones/:id/asignar`
  (`{agenteId|null}`).
- **Contactos/notas/etiquetas:** `POST /contactos`, `PATCH /contactos/:id`,
  `POST /conversaciones/:id/notas`, gestión de etiquetas.
- **Plantillas:** `GET /plantillas` (aprobadas de 1msg — endpoint 1msg por confirmar).
- **Sync:** `GET /sync?desde=cursor` para recuperar lo perdido al reconectar.

Todo lo que habla con 1msg vive en `src/integrations/onemsg/`.

## 6. Tiempo real (Socket.io, un proceso)

- El socket se autentica con el JWT; el agente entra a `agente:{id}`, los admins
  además a `supervisores`.
- **Persistir antes de emitir.** Eventos: `mensaje:nuevo`, `mensaje:ack`,
  `conversacion:actualizada`, `conversacion:asignada`.
- Un agente solo recibe eventos de sus conversaciones o de general; el admin, todo.
- El socket **no es la fuente de verdad**: al reconectar, el front llama `/sync`.

## 7. Seguridad

- JWT propio (secreto en `.env`), expiración configurable; el front lo envía en
  `Authorization: Bearer`.
- Autorización por rol en cada endpoint. El token de 1msg jamás llega al frontend.

## 8. Frontend (Vue 3 + Vite + Pinia + Tailwind)

- **Rutas:** `/login`, `/` (bandeja).
- **Stores Pinia:** `auth`, `conversaciones`, `chat`, `socket`, `notificaciones`.
- **Estilo:** componentes propios + Tailwind, look WhatsApp-like; paleta exacta de
  Serfunorte por definir (placeholder por ahora).
- Se construye con Vite y se sirve estático detrás de Cloudflare/Nginx (mismo
  dominio; `/api` y `/socket.io` al backend Node).

## 9. Manejo de errores

- Errores de 1msg (429 rate limit, 131047 fuera de ventana, etc.) se muestran al
  agente con mensaje claro y se registran con su código en `wa_mensajes`.
- Reintentos con backoff en el envío (reutiliza `utils/reintentos.js`).

## 10. Pruebas

- Unitarias (`node:test`) de la lógica pura: validación de ventana 24h, permisos
  por rol, construcción del payload de envío a 1msg, serialización de la lista.
- Validación manual de cada rebanada contra el entorno real (staging del server).

## 11. Orden de construcción (rebanadas verticales)

1. Auth (login backend + pantalla) → 2. Lista de bandeja (mías/general) →
3. Ver chat + historial + media → 4. Tiempo real (socket) → 5. Enviar texto →
6. Tomar/asignar/reasignar → 7. Crear contacto + notas + etiquetas →
8. Notificaciones (sonido/visual/no leído) → 9. *Todos* + filtro por agente (admin)
→ 10. Plantillas fuera de ventana.

## 12. Puntos abiertos

- **Plantillas de 1msg:** confirmar el endpoint real para listar plantillas
  aprobadas y el formato de variables (no inventar; ver CLAUDE.md).
- **Paleta Serfunorte:** aplicar los colores/branding exactos.
- **Conversaciones en general existentes (456):** decidir si se reparten entre los
  dos administradores para tener volumen desde el inicio.
- **UI de adjuntos multimedia:** se refina en una iteración posterior.
