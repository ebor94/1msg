# Bandeja de chats WhatsApp — Serfunorte

Contexto permanente del proyecto. Léelo antes de escribir código.

## Qué estamos construyendo y por qué

Serfunorte atiende clientes por WhatsApp con **15 agentes** sobre **un solo número
WABA**, usando la bandeja que trae la plataforma 1msg. Esa bandeja se cuelga por el
volumen de conversaciones.

Reemplazamos únicamente la capa de bandeja. 1msg sigue siendo el BSP (la pasarela
hacia Meta); nosotros construimos la gestión: asignación de conversaciones por
agente, historial propio, permisos y métricas.

**La base de datos es la fuente de verdad de la bandeja.** La API de 1msg no tiene
concepto de agente, ni de asignación, ni de "lista de chats". Todo eso lo derivamos
nosotros del flujo de webhooks.

## Stack y entorno

| Pieza | Decisión |
|---|---|
| Runtime | Node.js 20+, CommonJS |
| API | Express |
| ORM | Sequelize |
| Base | MySQL 8 — base existente `serfuweb`, tablas con prefijo `wa_` |
| Tiempo real | Socket.io (un solo proceso, sin adapter Redis) |
| Cola | Tabla `wa_eventos_webhook` (NO usar Redis/BullMQ por ahora) |
| Frontend | Vue 3 (fase 3, aún no empieza) |
| Servidor | `192.9.17.30` (hostname `srv-backend`, alias SSH `mantix`), Oracle Cloud, Ubuntu 24.04. App en `~/apps/wa` bajo pm2 (`wa-backend`) |
| URL pública | `https://wa.losolivoscucuta.com` → Cloudflare Tunnel (`glpi-olivos`) → `localhost:3000`. Sin puertos entrantes abiertos; TLS en el borde de Cloudflare. La app ve todas las peticiones como `127.0.0.1`; la IP real del cliente va en `CF-Connecting-IP` |

La base `serfuweb` ya contiene las tablas del core de negocio. **No toques ninguna
tabla que no empiece por `wa_`.** El esquema está en `docs/esquema_bandeja.sql`.

## La API de 1msg — lo que hay que saber

Instalación: `npm install @1msg/sdk` (existe SDK oficial en TypeScript, pero también
se puede llamar por HTTP directo).

**Forma de las URLs:**

```
https://{baseUrl}/{instanceId}/{path}?token={token}
```

El token va en query string, no en header. `instanceId` y token viven en `.env`.

**Reglas duras:**

- El SDK y el token son **solo de servidor**. El token jamás se expone al frontend
  ni viaja al navegador. El frontend habla con nuestra API, nuestra API habla con 1msg.
- **El webhook admite MÚLTIPLES URLs** (`webhookUrl` es un array — confirmado en
  producción 2026-07-24). El canal `VID182868781` ya trae la URL interna de 1msg
  `https://app.1msg.io/service/service_core/whatsapp/webhook/12106` que **alimenta
  la bandeja que usan los agentes**: NUNCA quitarla. Nosotros nos SUMAMOS a la
  lista con nuestra URL; 1msg hace el fan-out nativo, no hace falta reenviar desde
  nuestro backend. Leer/instalar: `GET`/`POST https://api.1msg.io/{instanceId}/webhook?token=...`.
  El formato real de los eventos está en `docs/payloads-reales-1msg.md`.
- **Ventana de 24 horas**: todos los métodos de envío excepto `sendTemplate`
  fallan si la sesión con el usuario está cerrada. Fuera de ventana solo se puede
  enviar plantilla aprobada.
- Los endpoints de envío devuelven **429** cuando se excede el rate limit. Todo
  envío pasa por reintento con backoff exponencial.
- `retrieveMedia` devuelve una URL temporal que **expira en ~5 minutos**. Hay que
  descargar el archivo y guardarlo en almacenamiento propio en el momento de
  procesar el evento, nunca después.
- `listMessages(token, count, ..., chatId)` trae historial por conversación. Se usa
  solo para el backfill bajo demanda.

**Códigos de error relevantes** (guardar en `wa_mensajes.error_codigo`):

- `131049` — límite por destinatario de plantillas de marketing. Reintentar tras 24h.
- `130472` — el número está en un experimento de Meta. No reintentar nunca; marcar
  `wa_contactos.wa_experimento = 1`.
- `131047` — fuera de la ventana de 24h, requiere plantilla.

## Reglas de negocio

**Asignación de una conversación entrante** (cascada, se evalúa en el worker):

1. Si el contacto ya tiene `agente_dueno_id` → va a ese agente (continuidad).
2. En cualquier otro caso → `agente_id = NULL`, o sea **bandeja general**.

> Decisión 2026-07-24: se **descartó** el cruce automático con clientes de
> `serfuweb` (asesor). En su lugar, todo cae a general y el agente **toma** el
> chat manualmente; al tomarlo se vuelve su dueño (ver "Toma de un chat"). El
> agente también podrá **crear un contacto** y quedárselo (`agente_dueno_id` =
> él). Ambas acciones son de la bandeja (Fase 2); el modelo ya las soporta.

**Bandeja general**: conversaciones con `agente_id IS NULL`. Visible para todos los
agentes. Se ordena FIFO por `ultimo_mensaje_en ASC` (lo que más lleva esperando va
primero).

**Toma de un chat**: siempre atómica, nunca `SELECT` + `UPDATE`.

```sql
UPDATE wa_conversaciones
   SET agente_id = :agente, tomada_en = NOW(), estado = 'abierta'
 WHERE id = :conv AND agente_id IS NULL
```

Si `affectedRows = 0`, otro agente se adelantó: devolver 409 y refrescar su bandeja.

Al tomar el chat, en la misma transacción se marca al agente como **dueño** del
contacto (`wa_contactos.agente_dueno_id = :agente`) para que la continuidad
(regla 1) le devuelva los próximos mensajes de ese número. Lo mismo cuando un
agente crea un contacto: queda con `agente_dueno_id = él`.

**Reapertura**: un chat cerrado que recibe mensaje nuevo vuelve **siempre a su
agente anterior**, sin límite de tiempo. Solo cae a la general si ese agente está
inactivo.

**SLA**: por ahora solo indicador visual del tiempo de espera en la bandeja general.
Sin escalamiento automático.

**Firma del agente**: como los 15 comparten un número, los mensajes salientes se
prefijan con `wa_agentes.firma` (ej. `Ana | `). El texto guardado en `wa_mensajes`
incluye el prefijo tal como salió.

**No hay bot.** Los campos `atendida_por_bot` y el valor `escalado_bot` están
reservados pero no se usan.

## Invariantes técnicas — romper cualquiera de estas es un bug

1. El endpoint del webhook **no procesa**. Valida, inserta en `wa_eventos_webhook`
   y responde 200 en milisegundos. Si tarda, 1msg reintenta y se duplica todo.
2. **Idempotencia**: `wa_mensajes.wa_message_id` es único. Todo insert de mensaje
   entrante es un upsert contra esa clave.
3. **Persistir antes de emitir.** El socket se emite después del commit, nunca antes.
4. **Orden por `ts_proveedor`**, no por `creado_en` ni por orden de llegada.
5. **Rooms, no broadcast.** Cada agente entra a `agente:{id}`; los supervisores
   además a `supervisores` y `general`. Un agente nunca recibe por socket mensajes
   de conversaciones que no le pertenecen.
6. **El socket no es la fuente de verdad.** Existe `GET /api/sync?desde={cursor}`
   para que el frontend recupere lo perdido al reconectar.
7. **Nunca cargar todo en el cliente.** Lista de bandeja paginada de 25; mensajes
   solo al abrir el chat, con scroll hacia atrás.
8. `wa_eventos_webhook` no se borra en caliente. Purga programada a los 60 días.

## Estructura de carpetas

```
src/
  config/        conexión Sequelize, carga de env, constantes
  models/        modelos Sequelize (uno por tabla wa_)
  routes/        definición de rutas Express
  controllers/   handlers HTTP delgados
  services/      lógica de negocio (asignación, ventana 24h, envío)
  integrations/
    onemsg/      único punto que habla con la API de 1msg
  workers/       procesador de la cola de eventos, descarga de medios
  sockets/       registro de rooms y emisores
  utils/         logger, errores, helpers
docs/
  esquema_bandeja.sql
```

**Regla de aislamiento**: ningún archivo fuera de `src/integrations/onemsg/` puede
importar el SDK ni construir una URL de 1msg. Si mañana cambia el proveedor, se
reescribe esa carpeta y nada más.

## Convenciones

- Nombres de dominio en español (`conversacion`, `agente`, `contacto`), nombres
  técnicos en inglés (`buildPayload`, `retryWithBackoff`).
- Sequelize con `underscored: true`, `timestamps` manuales para respetar
  `creado_en` / `actualizado_en`.
- Nada de `console.log` en producción: logger con niveles.
- Todo error de 1msg se registra con su código; nunca se traga una excepción en
  silencio.
- Sin secretos en el repositorio. `.env` en `.gitignore`, `.env.example` versionado.

## Qué NO hacer

- No instalar Redis, RabbitMQ ni BullMQ.
- No exponer el token de 1msg al frontend ni loguearlo.
- No hacer trabajo pesado dentro del request del webhook.
- No modificar tablas de `serfuweb` que no tengan prefijo `wa_`.
- No migrar todo el historial de golpe: el backfill es bajo demanda.
- No inventar endpoints de 1msg: si no está confirmado en la documentación,
  pregunta antes de asumir.

## Fase actual

**Fase 1 — Ingesta.** Ver `docs/fase-1.md`. No empieces API de bandeja ni frontend
hasta que la fase 1 esté validada corriendo en paralelo con la bandeja de 1msg.
