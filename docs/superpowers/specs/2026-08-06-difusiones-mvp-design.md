# Difusiones (envío masivo de plantillas) — MVP — diseño

Fecha: 2026-08-06
Estado: en discusión (pendiente de aprobación del usuario antes del plan)

## Problema

Hoy las difusiones se hacen con **n8n + Google Sheets**: una hoja por campaña y un
workflow clonado que cada minuto lee la hoja, valida el número con Evolution API,
envía la plantilla por 1msg y escribe el estado de vuelta en la hoja. Eso no escala
(clonar workflow por campaña), no es medible (estado disperso en hojas), no es
transaccional (un corte puede duplicar envíos), está desconectado de la bandeja
(las respuestas llegan sin contexto) y expone el token de 1msg en el JSON del
workflow.

Lo reemplazamos por una capa **nativa en la app**, aprovechando que las tablas
`wa_difusiones` y `wa_difusion_destinatarios` (y sus modelos) **ya existen**, y los
patrones ya probados: `sendTemplate` en producción, cola→worker, backoff en 429,
ingesta de estados por webhook y reapertura de chats.

## Alcance del MVP

1. **Crear campaña** eligiendo una plantilla aprobada + **cargar destinatarios por
   CSV** (o pegar). El CSV trae el teléfono, los parámetros de la plantilla y el
   `id` del agente responsable por fila.
2. **Worker de envío** que drena la cola respetando ritmo (1 cada 20 s por
   campaña, una campaña a la vez), ventana horaria y backoff; idempotente.
3. **Los envíos entran a la bandeja**: crean/reusan la conversación del contacto,
   la dejan en **resueltos** (`cerrada`) asignada al agente, con `origen='difusion'`.
   Si el cliente responde, la **reapertura** ya existente se la devuelve a ese agente.
4. **Pantalla de resultados** (admin): embudo por campaña + detalle por destinatario.

**Fuera del MVP** (posibles fases siguientes): destinatarios desde `wa_contactos`
por filtros/etiquetas o desde el ERP (mora de KARINGSOFT); programación
(`programada_para` ya está en el esquema); A/B; opt-out; verificación nativa de
número si 1msg la ofrece.

## Permisos

Todo admin-only (`requireAuth` + `requireAdmin`). Un asesor recibe 403.

## Selección de plantilla y mapeo de variables

La app **ya parsea** cada plantilla (`src/services/plantillas.js` → `parsearPlantilla`)
y expone: `cuerpo` (texto con `{{1}}`..`{{n}}`), `variables` (nº de variables),
`tieneImagen` + `imagenDefault`, `namespace`. Ya existen `renderizarCuerpo` (preview)
y `construirParams`/`construirParamsHeader` (armar el envío). El MVP los reutiliza.

Las variables **no son libres**: son las que la plantilla define en Meta,
**posicionales** (`{{1}}`, `{{2}}`…). El flujo de creación de campaña (asistente por
pasos):

1. **Datos + plantilla**: nombre de la campaña + elegir plantilla. Idioma, categoría,
   nº de variables e imagen salen de la plantilla parseada.
2. **Mapeo de variables**: por cada `{{i}}` del cuerpo, la fuente es
   **columna del CSV** (varía por destinatario) o **valor fijo** (igual para todos).
   Si `tieneImagen`, se resuelve la imagen del encabezado (ver sección siguiente);
   normalmente es la misma para toda la campaña, no por persona.
3. **Cargar CSV** (siguiente sección): trae `CELULAR`, `AGENTE_ID` y una columna por
   cada variable mapeada a "columna".
4. **Vista previa + lanzar**: se renderiza el cuerpo con la primera fila
   (`renderizarCuerpo`) para ver el mensaje real antes de iniciar.

Por cada destinatario, `parametros` (JSON) queda como el arreglo **ordenado** de los
valores de `{{1}}..{{n}}` (resolviendo columnas y constantes), listo para
`construirParams`.

### Imagen del encabezado (plantillas con imagen)

1msg recibe la imagen como una **URL pública** en el `link` del header
(`construirParamsHeader`), y Meta la **descarga en cada envío**. Por eso la URL debe
seguir viva durante **toda** la campaña (horas).

- **No se reutiliza** el mecanismo `mediaPublica` de la bandeja: es efímero (TTL 15
  min, store en memoria que muere al reiniciar) — sirve para un envío suelto, no para
  una difusión de horas.
- En el asistente, si la plantilla `tieneImagen`, el admin:
  - usa la **imagen por defecto** de la plantilla (`imagenDefault`), o
  - **sube una imagen una sola vez** para la campaña.
- La imagen subida se guarda **en disco** (persistente, como la media entrante) y se
  sirve por una **ruta pública nueva y estable** (sin caducidad corta, sobrevive
  reinicios), p. ej. `GET /media-difusion/:id` (solo lectura, `Content-Type` correcto
  + `nosniff`). La URL resultante se guarda en `wa_difusiones.imagen_url` y se usa
  como header en **todos** los envíos de la campaña.
- La imagen es **a nivel de campaña** (misma para todos). Caso excepcional
  (imagen por destinatario): mapear una columna del CSV con la URL, como una variable
  más. Fuera del MVP salvo que se pida.

## Origen de destinatarios (CSV/pegar)

- El agente crea la campaña, **elige la plantilla** (de las aprobadas que ya
  listamos) y mapea sus variables (sección anterior).
- Sube un **CSV** con una fila por destinatario. Columnas:
  - `CELULAR` (obligatoria) — teléfono.
  - una columna por **cada parámetro** de la plantilla (ej. `NOMBRE`, `Valor_Mora`).
  - `AGENTE_ID` (obligatoria) — id del `wa_agente` responsable de ese destinatario.
- **Validación al cargar** (nada se envía todavía):
  - el teléfono se normaliza (solo dígitos, waId); se descartan los que no sean
    celular colombiano plausible (10 dígitos, empieza en 3) → quedan `omitido` con
    motivo "teléfono inválido".
  - se exige que estén todas las columnas de parámetros; faltantes → error de carga.
  - `AGENTE_ID` debe ser un agente **activo**; si no, error de carga (se rechaza el
    archivo, no se crea la campaña a medias).
  - **dedup** por teléfono dentro de la misma campaña (la clave única
    `(difusion_id, contacto_id)` lo garantiza a nivel BD).
- Cada fila **resuelve/crea el contacto** (`resolverContacto`, ya existe) para
  obtener `contacto_id`; los parámetros se guardan en
  `wa_difusion_destinatarios.parametros` (JSON) y el agente en la columna nueva
  `agente_id` (ver migración).

## Chequeo "¿tiene WhatsApp?" (sin Evolution)

Se elimina Evolution API. Estrategia en capas, sin proveedores extra:

1. **Filtro de formato** al cargar (arriba) — descarta basura obvia.
2. **Saltar lo que ya sabemos**: contactos marcados `wa_experimento=1` (130472) →
   `omitido`; contactos que alguna vez nos escribieron ya sabemos que tienen
   WhatsApp (no se descartan).
3. **Apoyarse en el resultado del envío**: si 1msg/Meta rechaza, se marca `fallido`
   con su `error_codigo`; si se acepta pero **nunca pasa a entregado** en una
   ventana razonable, se puede inferir "sin WhatsApp" (indicador suave, no bloquea).
4. **Por confirmar (no asumir)**: si 1msg expone un endpoint nativo de verificación
   de número, se evalúa sumarlo — pero NO se implementa sin confirmarlo en su doc.

Para plantillas **utility** a clientes propios (cartera) el riesgo de sanción por
enviar a un número sin WhatsApp es bajo, así que el MVP va sin pre-check.

## Modelo de datos

Se reutilizan `wa_difusiones` y `wa_difusion_destinatarios` tal como están. Cambios
de esquema (**migración 007**):

- `ALTER TABLE wa_difusion_destinatarios ADD COLUMN agente_id INT UNSIGNED NULL AFTER
  contacto_id;` (agente responsable declarado en el CSV; FK blanda a `wa_agentes`,
  sin constraint dura para no acoplar).
- `ALTER TABLE wa_difusiones ADD COLUMN imagen_url VARCHAR(255) NULL;` (URL pública
  persistente de la imagen del encabezado, cuando la plantilla lleva imagen).
- Actualizar también los modelos Sequelize y `docs/esquema_bandeja.sql`.

Campos ya existentes que usamos:
- `wa_difusiones`: `nombre`, `plantilla_nombre`, `plantilla_idioma`, `categoria`,
  `estado` (borrador→enviando→finalizada/cancelada), `programada_para` (null en MVP),
  `creado_por_id`, `canal_id`.
- `wa_difusion_destinatarios`: `parametros` JSON, `wa_message_id`, `estado`
  (pendiente→enviado→entregado→leido/fallido/omitido), `error_codigo`, `intentos`,
  `reintentar_en`, y la clave única `(difusion_id, contacto_id)`.

## Creación y asignación de la conversación

Al enviar con éxito a un destinatario:

1. **Reusar/crear conversación** del contacto:
   - si el contacto tiene una conversación **abierta** (no cerrada), el mensaje de
     plantilla **se anexa** a ella y **no** se fuerza su cierre (no interrumpimos un
     chat activo).
   - si solo tiene conversaciones cerradas, o ninguna, se **reusa/crea** una y queda
     en **`cerrada` (resueltos)**.
2. **Asignación del agente** (regla del CSV):
   - si el contacto **ya tiene dueño** (`agente_dueno_id`) → se **respeta**, no se
     modifica.
   - si **no** tiene dueño → se asigna el `agente_id` del CSV como dueño del contacto
     y agente de la conversación.
   - La asignación por campaña **no** emite fila de auditoría `toma_manual`/
     `reasignacion` (para no inflar "Recibidos" del Scorecard); si se audita, será
     con un tipo propio no contabilizado.
3. **Marcar la conversación** con `origen='difusion'`.
4. **Mensaje saliente**: fila en `wa_mensajes` con `direccion='out'`, `tipo='template'`,
   `plantilla_nombre`, `wa_message_id` (de la respuesta de 1msg), `estado='enviado'`,
   **`enviado_por_id=NULL`** (es de campaña, no trabajo de un agente → no cuenta en el
   Scorecard), `historico=0`, `ts_proveedor=NOW()`.
5. **Reapertura**: cuando el cliente responde, el mensaje entrante reabre el chat y
   la regla de reapertura ya existente lo devuelve al agente asignado (o a general si
   está inactivo). Sin código nuevo.

## Worker de envío

Nuevo proceso/loop (o extensión del patrón worker) que procesa **una campaña a la
vez** (FIFO por `programada_para`/`creado_en`), y dentro de ella drena destinatarios
`estado='pendiente'` (o `fallido` con `reintentar_en <= NOW()`):

- **Ritmo**: **1 mensaje cada 20 s** (configurable, default en `config`) + un jitter
  pequeño. Como se procesa una campaña a la vez, ese ritmo es también el global sobre
  el número compartido.
- **Ventana horaria**: solo envía en **Lun–Vie 08:00–18:59 y Sáb 08:00–13:59**
  (hora de Colombia); fuera de eso, el worker espera. (Misma ventana que el n8n
  actual.)
- **Límite diario (tier)**: respeta un tope diario configurable acorde al tier del
  número (1K/10K/100K). Al alcanzarlo, pausa hasta el otro día.
- **Envío**: usa el `sendTemplate` de `src/integrations/onemsg/` (token server-side,
  jamás en cliente). Arma el cuerpo con `construirParams(parametros)` y, si la
  plantilla lleva imagen, el header con `construirParamsHeader(difusion.imagen_url ||
  imagenDefault)`.
- **429 / errores**: backoff exponencial (ya existe); incrementa `intentos`, setea
  `reintentar_en`, guarda `error_codigo`. Códigos conocidos: 131049 (límite
  marketing → reintentar en 24h), 130472 (experimento → `omitido`, marca
  `wa_experimento`), 131047 (fuera de ventana → no aplica aquí, es plantilla).
- **Idempotencia**: por la clave única `(difusion_id, contacto_id)` y por escribir
  `wa_message_id`+`estado='enviado'` en la **misma transacción** que crea el mensaje;
  si el worker se reinicia, no reenvía lo ya enviado (a diferencia de la hoja).
- **Persistir antes de emitir**: el progreso se emite por socket **después** del
  commit (invariante del proyecto).
- **Fin de campaña**: cuando no quedan pendientes, `wa_difusiones.estado='finalizada'`.

## Estados

- **Campaña**: `borrador` (creada, cargando destinatarios) → `enviando` (worker
  activo) → `finalizada` (sin pendientes) / `cancelada` (admin la detiene).
- **Destinatario**: `pendiente` → `enviado` (aceptado por 1msg, con `wa_message_id`)
  → `entregado`/`leido` (por webhook) o `fallido` (con `error_codigo`) o `omitido`
  (sin WhatsApp/formato/experimento, nunca se intentó).

## Resultados / pantalla (lo medible)

Pantalla admin **Difusiones** (patrón Informe/Scorecard):

- **Lista de campañas**: nombre, plantilla, estado, creada por, fecha, y un resumen
  (enviados/total, % entrega).
- **Detalle de una campaña — embudo en vivo**: total · omitidos (sin WhatsApp) ·
  enviados · **entregados** · **leídos** · fallidos (**desglosados por
  `error_codigo`**) · **respondidos** (contactos que contestaron). Con auto-refresh
  mientras la campaña está `enviando`.
- **Detalle por destinatario** (paginado): teléfono, nombre, agente, estado, error,
  intentos, hora de envío.
- **Fuente de los estados de entrega**: para no tocar el worker de ingesta, el embudo
  **hace join** de `wa_difusion_destinatarios.wa_message_id` con `wa_mensajes.estado`
  (fuente única de verdad de entregado/leído/fallido, que el webhook ya actualiza).
  "Respondidos" = destinatarios cuya conversación recibió un `in` posterior al envío.

## Endpoints (admin-only)

- `POST /api/difusiones` — crea campaña (nombre, plantilla, idioma, categoría).
- `POST /api/difusiones/:id/destinatarios` — carga el CSV (valida, resuelve
  contactos, inserta destinatarios `pendiente`/`omitido`). Devuelve el resumen de
  validación (cuántos ok, cuántos omitidos y por qué).
- `POST /api/difusiones/:id/iniciar` — pasa a `enviando` (el worker la toma).
- `POST /api/difusiones/:id/cancelar` — la detiene (`cancelada`).
- `GET /api/difusiones` — lista con resumen.
- `GET /api/difusiones/:id` — embudo + metadatos.
- `GET /api/difusiones/:id/destinatarios?estado=&pagina=` — detalle paginado.

## Seguridad

- El token de 1msg vive **solo en el servidor** (`src/integrations/onemsg/`), nunca en
  el frontend ni en un workflow. **Recomendación**: rotar el token que hoy está en
  texto plano dentro del workflow de n8n (ver memoria `rotar-token-1msg`).
- SQL parametrizado; solo se tocan tablas `wa_`.

## Invariantes que respeta

- Cola→worker (no se bloquea el request); persistir antes de emitir; orden por
  `ts_proveedor`; rooms para el socket; idempotencia por `wa_message_id`.
- Reusa `sendTemplate`, `resolverContacto`, la ingesta de estados y la reapertura.
- Sin Redis/BullMQ (la tabla de destinatarios es la cola).
- Proceso único (compatible con el store en memoria de media pública ya existente).

## Decisiones derivadas (para revisar en el spec)

1. **Una campaña a la vez** (FIFO): simplifica el ritmo global sobre el número
   compartido. Si en el futuro se quieren campañas en paralelo, habría que añadir un
   throttle global.
2. **Los envíos de campaña no cuentan como actividad de agente** en el Scorecard
   (`origen='difusion'`, `enviado_por_id=NULL`, sin auditoría de asignación).
3. **Estados de entrega por join** con `wa_mensajes` (no se modifica el worker de
   ingesta en el MVP).
4. **Reuso de conversación**: si el contacto tiene un chat abierto, la plantilla se
   anexa sin cerrarlo; si no, se crea/reusa una en `cerrada`.

## Limitaciones conocidas del MVP

- Sin verificación previa de WhatsApp (se infiere del resultado del envío).
- Sin programación horaria fina (arranca cuando el admin da "iniciar"; solo respeta
  la ventana). `programada_para` queda para fase siguiente.
- Sin segmentación desde BD/ERP ni opt-out en el MVP.
- Ritmo fijo por config (20 s); override por campaña queda para después.
