# Fase 1 — Ingesta de mensajes

Objetivo: que todo lo que entra y sale por el número de WhatsApp quede reflejado en
la base `serfuweb` en tiempo real, **sin tocar la operación actual**. Al terminar
esta fase la bandeja de 1msg sigue siendo la que usan los agentes; nosotros solo
observamos y grabamos.

## Alcance

Dentro:

- Endpoint de webhook y persistencia del payload crudo.
- Worker que normaliza eventos y los convierte en contactos, conversaciones y mensajes.
- Descarga y almacenamiento local de medios.
- Cascada de asignación de conversaciones.
- Actualización de estados de entrega (ack) y de errores.
- Cálculo de la ventana de 24 horas.
- Script de arranque y servicio systemd.

Fuera (fases posteriores):

- API de bandeja, sockets, envío de mensajes desde la plataforma, frontend,
  difusiones, reportes.

## Tareas

### 1. Base del proyecto

- `npm init`, dependencias, estructura de carpetas de `CLAUDE.md`.
- Carga y validación de variables de entorno: si falta una obligatoria, el proceso
  no arranca (fallo ruidoso, no silencioso).
- Conexión Sequelize a `serfuweb` y verificación al arrancar.
- Logger con niveles y salida a archivo.

### 2. Modelos

Un modelo por tabla `wa_` del esquema, con las asociaciones:

- `Canal` 1—N `Conversacion`
- `Contacto` 1—N `Conversacion`
- `Agente` 1—N `Conversacion` (opcional), 1—N `Contacto` (como dueño)
- `Conversacion` 1—N `Mensaje`, 1—N `Asignacion`, 1—N `NotaInterna`

El esquema ya existe; los modelos se mapean contra él. **No usar `sync({ alter: true })`**
sobre `serfuweb`.

### 3. Endpoint del webhook

`POST /webhook/1msg`

- Verifica un secreto compartido en la ruta o en un header (`WEBHOOK_SECRET`) y
  rechaza con 401 si no coincide.
- Inserta el body completo en `wa_eventos_webhook` (`payload` JSON, `procesado = 0`).
- Responde `200 OK` inmediatamente. Nada de lógica de negocio aquí.
- Si el insert falla, igual responde 200 pero registra el error en el log: es
  preferible perder un evento que entrar en bucle de reintentos de 1msg.

También `GET /webhook/1msg` para la verificación inicial si 1msg la exige.

### 4. Worker de la cola

Proceso (o intervalo dentro del mismo proceso) que cada segundo:

```sql
SELECT * FROM wa_eventos_webhook
 WHERE procesado = 0 ORDER BY id LIMIT 50
```

Por cada evento, dentro de una transacción:

1. Identifica el tipo: mensaje entrante, ack de estado, echo de saliente, otro.
2. **Contacto**: busca por `wa_id`; si no existe, lo crea con el nombre del perfil.
3. **Conversación**: busca la conversación abierta del contacto. Si no hay, o la
   última está `cerrada`, crea una nueva y aplica la cascada de asignación
   (ver `CLAUDE.md`). Registra el resultado en `wa_asignaciones`.
4. **Mensaje**: upsert por `wa_message_id`. Guarda `ts_proveedor` del payload.
5. **Medios**: si el mensaje trae media, encola la descarga (ver tarea 5).
6. **Desnormalizados**: actualiza en la conversación `ultimo_mensaje_en`,
   `ultimo_mensaje_texto` (truncado a 255), `ultimo_mensaje_dir`, incrementa
   `no_leidos` si es entrante, y recalcula `ventana_expira_en` = `ts_proveedor + 24h`
   cuando el mensaje es entrante.
7. Marca el evento como `procesado = 1`.

Si el procesamiento lanza excepción: rollback, `error` con el mensaje, y dejar
`procesado = 0` hasta un máximo de 3 intentos; al cuarto marcar como procesado con
error para que no bloquee la cola.

**Ordenar siempre por `id` ascendente** para respetar el orden de llegada.

### 5. Descarga de medios

- Al detectar un mensaje con media, llamar a la API para obtener la URL y descargar
  **de inmediato**: la URL expira en unos 5 minutos.
- Guardar en `MEDIA_PATH/{año}/{mes}/{conversacion_id}/{wa_message_id}.{ext}`.
- Registrar `media_ruta`, `media_mime`, `media_nombre`, `media_bytes`.
- Si la descarga falla, reintentar hasta 3 veces con backoff; si agota, dejar
  `media_ruta = NULL` y registrar el error sin perder el mensaje.
- Límite de tamaño configurable; si se excede, no descargar y anotar el motivo.

### 6. Acks y errores

Los eventos de estado actualizan `wa_mensajes.estado` siguiendo la progresión
`pendiente → enviado → entregado → leido`. **Nunca retroceder**: si llega un ack de
`enviado` sobre un mensaje ya `leido`, se ignora (los acks llegan desordenados).

Si el ack trae error, guardar `error_codigo` y `error_detalle`, poner estado
`fallido`, y aplicar la regla del código:

- `130472` → `wa_contactos.wa_experimento = 1`
- `131049` → `wa_contactos.marketing_bloqueado_hasta = NOW() + 24h`

### 7. Despliegue

- Script de arranque y unidad `systemd` con reinicio automático.
- Documentar en `README.md` los pasos de instalación en el servidor.
- Healthcheck `GET /health` que verifique base de datos y antigüedad del último
  evento procesado.

## Criterios de aceptación

La fase 1 está lista cuando, con el webhook apuntando a nuestro servidor y la
bandeja de 1msg funcionando en paralelo:

1. Todo mensaje entrante aparece en `wa_mensajes` en menos de 2 segundos.
2. Un mensaje enviado desde la bandeja de 1msg por un agente también queda
   registrado como saliente.
3. Reenviar el mismo evento dos veces no crea mensajes duplicados.
4. Las imágenes, audios y documentos quedan descargados y abribles desde disco.
5. Los estados de entrega llegan a `leido` y nunca retroceden.
6. Un contacto nuevo cae en bandeja general; un contacto con dueño previo cae
   directo con su agente.
7. Detener el worker 10 minutos y volver a arrancarlo recupera todo lo pendiente
   sin pérdida.
8. Comparar durante 3 días el conteo de conversaciones y mensajes de nuestra base
   contra la bandeja de 1msg: deben coincidir.

Cuando los 8 criterios pasen, se puede empezar la fase 2.
