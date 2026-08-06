# Recordatorios mensuales por contacto — diseño

Fecha: 2026-08-06
Estado: en discusión (pendiente de revisión del usuario antes del plan)

## Problema

Algunos clientes le piden al agente por chat "recuérdame / mándame un mensaje todos
los 5 (o X) de cada mes". Hoy no hay forma de programarlo: el agente tendría que
acordarse manualmente. Queremos un **recordatorio mensual automático por contacto**:
un switch de activación + un día del mes (1–30) en el perfil del contacto, y el
sistema, todos los días, envía una plantilla a los contactos cuyo día es hoy.

## Cómo encaja (reutiliza difusiones)

Es una **difusión de un contacto que se repite cada mes**. Reutiliza la maquinaria ya
en producción: `enviarPlantilla` (1msg), la ventana horaria, y el patrón de envío que
crea/reusa la conversación, la deja en **resueltos** (`enviado_por_id=NULL`, no cuenta
en el Scorecard) y la **reabre** al agente dueño cuando el cliente responde.

**Debe ser plantilla aprobada**, no texto libre: el recordatorio casi siempre sale
**fuera de la ventana de 24 h**, donde WhatsApp solo permite plantillas.

## Decisiones tomadas

- **Plantilla fija**: `texto_imagen_generico` (1 variable, con imagen). Cuerpo:
  *"Los Olivos, {{1}} , Gracias."*. `{{1}}` = **nombre del contacto**
  (`nombre_display || nombre_wa || telefono`); la imagen usa la **default** de la
  plantilla. → UX por contacto = solo switch + día, sin configuración extra.
  - *Nota de flexibilidad*: si más adelante quieren que `{{1}}` sea una frase fija
    (ej. "te recordamos tu pago mensual") en vez del nombre, es un cambio de una línea
    (constante de config). Se deja como follow-up, no MVP.
- **Día inexistente en el mes** (ej. 30 en febrero): se envía el **último día del
  mes** (febrero → 28/29). El recordatorio nunca se pierde.
- **Quién lo configura**: cualquier agente que atienda el contacto, desde el panel
  (como notas/etiquetas/¿compró?). `requireAuth` (no admin).
- **Remitente/dueño**: automático (`enviado_por_id=NULL`); la conversación se asigna
  al **dueño del contacto** (`agente_dueno_id`), o al agente que configuró el
  recordatorio si el contacto no tiene dueño. Cae en *resueltos*.

## Alcance del MVP

1. Sección "Recordatorio mensual" en el panel del contacto: switch + select de día (1–30).
2. Persistencia de la configuración por contacto.
3. Chequeo diario en el worker que envía los recordatorios de "hoy", una vez por mes,
   dentro de la ventana horaria, con ritmo suave.
4. El envío cae en la bandeja (resueltos, dueño del contacto) y reabre al responder.

**Fuera del MVP**: varios recordatorios por contacto; valores por-contacto que varían
(para eso está difusiones); fechas arbitrarias (solo día del mes); `{{1}}` configurable
por UI; recordatorios semanales/anuales.

## Modelo de datos

**Migración 008**:

- Tabla nueva `wa_recordatorios` (uno por contacto):
  ```
  id              BIGINT UNSIGNED PK
  contacto_id     BIGINT UNSIGNED NOT NULL, UNIQUE (uno por contacto)
  dia_mes         TINYINT UNSIGNED NOT NULL           -- 1..30
  activo          TINYINT(1) NOT NULL DEFAULT 1
  ultimo_envio_en DATE NULL                            -- para no duplicar en el mes
  agente_id       INT UNSIGNED NULL                    -- dueño/config al momento
  creado_por_id   INT UNSIGNED NULL
  creado_en       DATETIME DEFAULT CURRENT_TIMESTAMP
  actualizado_en  DATETIME ... ON UPDATE CURRENT_TIMESTAMP
  FK contacto_id -> wa_contactos ON DELETE CASCADE
  KEY (activo, dia_mes)                                -- para el barrido diario
  ```
- Añadir `'recordatorio'` al ENUM `wa_conversaciones.origen`
  (`'entrante','saliente','difusion','ctwa','recordatorio'`), para distinguirlo en
  reportes.
- Actualizar el Scorecard: el conteo de "cerrados" ya excluye `origen='difusion'`;
  pasa a `origen NOT IN ('difusion','recordatorio')`.

## API (admin-abierto a cualquier agente que opere el contacto)

- El detalle del contacto (`abrirContacto`) incluye `recordatorio: { activo, diaMes } | null`.
- `PUT /api/contactos/:id/recordatorio` — upsert `{ activo, diaMes }`. Valida
  `diaMes` ∈ 1..30. Si `activo=false`, se guarda desactivado (no se borra la fila).

## UI

En `PanelCliente.vue`, sección **"Recordatorio mensual"**:
- Switch **Activo**.
- Select **Día del mes** (1–30), habilitado solo con el switch encendido.
- Guarda al cambiar (como los otros campos del panel). Muestra un texto de ayuda:
  "Se enviará una plantilla automáticamente ese día de cada mes".

## Worker: chequeo diario

Nuevo loop en el worker (`wa-worker`), junto a difusiones:

- **Una vez al día**: guardado por una marca de "último barrido" (fecha) para no
  repetir; corre cuando abre la ventana horaria.
- **Selección**: día de hoy `D` y si hoy es el **último día del mes** `UDM`. Enviables =
  recordatorios `activo=1` donde `dia_mes = D`, **o** (`dia_mes > díasDelMes` **y** hoy
  es el último día del mes) → así un "día 30" cae el 28/29 en febrero. Excluir los que
  ya tengan `ultimo_envio_en` dentro del mes actual (no duplicar).
- **Envío**: por cada uno, dentro de la ventana y con **ritmo suave** (reusa
  `dentroDeVentana` + `esperaEnvioMs`, 1 cada ~20 s), envía `texto_imagen_generico`
  con `params` = header imagen (default) + body `[nombre del contacto]`. Persiste como
  saliente (conversación reusada/creada, `origen='recordatorio'`, `estado=cerrada`,
  `enviado_por_id=NULL`), asigna el dueño, y marca `ultimo_envio_en = hoy`.
- **Idempotencia**: `ultimo_envio_en` (mes actual) evita el doble envío aunque el
  worker reinicie o el barrido corra dos veces el mismo día.

## Reutilización de código (DRY)

El bloque que **persiste un envío saliente de plantilla en la bandeja** (crear/reusar
conversación, asignar dueño, mensaje `enviado_por_id=NULL`, reapertura) hoy vive dentro
de `difusionEnvio.enviarDestinatario`. Se **extrae** a un helper compartido
`persistirEnvioPlantilla({ contactoId, telefono, agenteId, canalId, plantilla, texto,
waMessageId, origen })` que usarán tanto difusiones como recordatorios — para no
duplicar código con invariantes delicadas (fue justo ahí donde una revisión encontró un
bug de asignación). Difusiones se refactoriza para llamarlo; su comportamiento no cambia.

## Invariantes que respeta

- Solo tablas `wa_`. SQL parametrizado. Token 1msg solo en `integrations/onemsg`.
- Cola/worker no bloquea; persistir antes de emitir; idempotencia (`ultimo_envio_en` +
  `wa_message_id`).
- Ventana horaria y ritmo respetados (comparte número con difusiones).
- No infla el Scorecard (`enviado_por_id=NULL`, `origen` excluido de "cerrados").

## Limitaciones conocidas del MVP

- `{{1}}` = nombre del contacto (fijo por código); frase personalizada = follow-up.
- Un solo recordatorio por contacto, solo por día del mes.
- Si una difusión grande corre al mismo tiempo que el barrido de recordatorios,
  ambos comparten el número y el ritmo combinado puede subir a ~2/20 s (bajo, acotado;
  se puede unificar la cola después).
- Sin verificación previa de WhatsApp (se infiere del resultado del envío, como difusiones).
