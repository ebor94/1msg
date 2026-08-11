# Resumen de difusiones con IA → gestión de previsión — diseño

Fecha: 2026-08-08
Estado: en discusión (respuestas del usuario integradas; pendiente de revisión antes del plan)

## Problema

Para las difusiones de previsión, al final del día se quiere: por cada destinatario,
resumir la conversación (mensaje enviado + respuestas del cliente) con IA y registrar
ese resumen en la tabla `gestion` de olivosct (cartera), como cierre del ciclo
difusión → conversación → gestión. Hoy se hacía con un workflow de n8n + API de Claude
(era una prueba); se reemplaza por una capa nativa en la app.

## Decisiones (confirmadas por el usuario)

- **Se activa con un check** "Requiere resumen" al crear la difusión.
- **Cédula del destinatario**: columna **CEDULA** en el CSV (obligatoria cuando la
  difusión requiere resumen). Con la cédula → `consultarPlanesPorDocumento` → `num_plan`.
- **A todos** los destinatarios enviados (los que no respondieron → resumen
  "Sin respuesta del cliente", sin llamar a la IA).
- **Concepto**: `49` (WhatsApp) — debe existir en `conceptos_permitidos` (verificar en vivo).
- **tramito**: `IA`.
- **Solo INSERT en `gestion`** — NO se actualiza `plan` (novedad/concepto/fecha). Es un
  registro histórico; el estado del plan no cambia.
- **novedad ≤ 255 caracteres** (límite de la columna; el prompt lo pide y se recorta).
- **Modelo**: Claude **Haiku** (rápido/barato) para los resúmenes.

## Defaults propuestos

- El barrido corre **una vez al día ~19:00 (Colombia)**, tras cerrar la ventana de envío.
- Si una cédula tiene **varios planes**, se registra en el **primero** que devuelve
  `consultarPlanesPorDocumento`.
- El resumen es breve, en español, tono cartera.

## Modelo de datos (migración 010)

- `wa_difusiones` → `requiere_resumen TINYINT(1) NOT NULL DEFAULT 0`.
- `wa_difusion_destinatarios` →
  - `documento VARCHAR(20) NULL` (cédula del CSV, para el mapeo al plan).
  - `resumen_en DATETIME NULL` (idempotencia: se resume una sola vez).

## Flujo

**Crear difusión**: el asistente muestra un check "Requiere resumen (registra gestión
en previsión)". Si está activo, el CSV **debe** traer columna `CEDULA` (se valida al
cargar destinatarios; si falta, error 400). La cédula se guarda en
`wa_difusion_destinatarios.documento` (como ya se guarda el nombre).

**Worker de resumen** (nuevo loop en `wa-worker`, patrón de recordatorios):
- Corre a diario; a partir de las ~19:00 procesa los pendientes.
- **Selección**: destinatarios de difusiones con `requiere_resumen=1` y
  `estado='finalizada'`, donde el destinatario tiene `resumen_en IS NULL`,
  `documento` no nulo y fue **enviado** (`estado IN ('enviado','entregado','leido')`).
- Por cada uno, con ritmo suave (rate limit de Anthropic):
  1. **Texto de la conversación**: el mensaje saliente de la plantilla + los mensajes
     **entrantes** del cliente en esa conversación posteriores al envío
     (de `wa_mensajes`). Si no hay entrantes → resumen fijo "Sin respuesta del cliente"
     (no se llama a la IA).
  2. **Resumen IA**: si hubo respuesta, se llama a Anthropic (Haiku) con un prompt que
     pide un resumen en español, ≤255 caracteres. Se recorta a 255 por seguridad.
  3. **Mapeo a plan**: `consultarPlanesPorDocumento(documento)` → primer `num_plan`.
     Si no hay plan para esa cédula → se marca `resumen_en` con un motivo en log y se
     omite el INSERT (no bloquea a los demás).
  4. **Registrar gestión (solo INSERT)**: `insertarGestion({ numPlan, concepto:'49',
     novedad: resumen, tramito:'IA' })` → `INSERT INTO gestion (num_plan, novedad, fecha,
     hora, concepto, tramito) VALUES (?, ?, CURDATE(), CURTIME(), '49', 'IA')`. Valida
     `concepto ∈ conceptos_permitidos`. **No** toca `plan`.
  5. Marca `resumen_en = NOW()` (idempotente; si falla la IA/gestión de forma
     persistente, se marca igual para no bloquear/reintentar infinito, y se loguea).

**Integración Anthropic** (aislada, `src/integrations/anthropic/`):
- `resumirConversacion(texto): string` — llama a la Messages API (Haiku), devuelve el
  resumen. Config: `ANTHROPIC_API_KEY` en `.env` (solo servidor). Reintentos/backoff en
  429/5xx. Nunca se expone la key (ni logs ni frontend). Módulo único que habla con
  Anthropic (regla de aislamiento, como onemsg).

**Frontend**: el `DifusionWizard.vue` agrega el check "Requiere resumen" y, cuando está
activo, un aviso de que el CSV debe incluir la columna `CEDULA`. Se pasa
`requiereResumen` a `crearDifusion`.

## Seguridad

- La `ANTHROPIC_API_KEY` va solo en el `.env` del servidor. **Rotarla** (se compartió en
  texto plano — ver memoria `rotar-anthropic-key`).
- El INSERT en `gestion` usa el GRANT existente de `wa_lector` (ya tiene `INSERT ON
  gestion`); NO se necesita permiso nuevo (no se hace UPDATE de `plan` en este flujo).
- Solo lectura/escritura de `wa_` (app) + `gestion` (olivosct, ya permitido). SQL
  parametrizado.

## Alcance / límites (MVP)

- Solo difusiones de previsión (las que traen CEDULA y el flag). Otras no se tocan.
- Resumen por destinatario enviado; omitidos/fallidos (nunca entregados) se saltan.
- Un plan por cédula (el primero). Multi-plan / masivo queda para después.
- Sin reintento fino de la IA: un fallo persistente marca el destinatario para no
  bloquear (se puede re-lanzar manualmente si hace falta).
- El resumen no actualiza el estado del plan (solo INSERT en gestion) — decisión del
  usuario ("por ahora").

## Invariantes

- Cola/worker no bloquea; idempotencia por `resumen_en`; persistir/loguear, nunca tragar.
- Token/API key solo del lado del servidor. Solo tablas `wa_` + `gestion`.
- Ritmo suave en las llamadas a Anthropic (rate limit); una difusión no bloquea otra.
