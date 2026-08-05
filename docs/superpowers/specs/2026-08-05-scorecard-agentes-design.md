# Scorecard diario de agentes — diseño

Fecha: 2026-08-05
Estado: aprobado (pendiente de revisión del usuario antes del plan)

## Problema

Los ~11 agentes atienden la bandeja todo el día y hoy no hay forma de ver, de un
vistazo, **quién está respondiendo, qué tan rápido y cuánto tiene pendiente**. El
supervisor (administrador) necesita un seguimiento **diario** para dar coaching y
detectar clientes abandonados.

La base de la bandeja ya captura todo lo necesario (quién envió cada mensaje y
cuándo, tomas de general, cierres, dirección del último mensaje). No hay que tocar
la ingesta ni migrar nada: es una capa de **lectura/agregación** sobre tablas `wa_`
existentes.

## Alcance (v1)

Una pantalla admin-only `/agentes` con dos bloques:

1. **En vivo** — foto del backlog *ahora mismo*, por agente y para la general.
2. **Tabla del día** — selector de fecha (default hoy), una fila por agente, con
   volumen de trabajo + tiempo de primera respuesta (TPR).

Fuera de v1 (posible después): conversión (`compró`), disciplina de etiquetado,
resumen diario automático / persistencia histórica para tendencias, gráficas.

## Permisos

Solo rol `administrador` (bortega, ssuarez). Los endpoints usan el middleware
`requireAdmin` ya existente. Un asesor que llame la API recibe 403.

## Definición del día y del horario

- Los `DATETIME` en BD se guardan en hora de Colombia (`DB_TIMEZONE=-05:00`),
  así que **el día es `[fecha 00:00:00, fecha+1 00:00:00)` en hora local**, sin
  conversión UTC. La fecha por defecto es "hoy" en hora de Colombia.
- **Horario laboral** (para el TPR): Lun–Vie 08:00–18:00 y Sáb 08:00–11:00.
  Domingos y fuera de esas franjas no cuentan.
- Se excluyen siempre los mensajes de backfill (`wa_mensajes.historico = 1`): son
  historial traído bajo demanda, no actividad del día.

## Bloque 1 — En vivo (independiente de la fecha)

Por cada agente **activo** y una fila extra **General**:

| Campo | Definición |
|---|---|
| Sin responder | nº de conversaciones con `agente_id = agente` (o `NULL` para General), `estado <> 'cerrada'` y `ultimo_mensaje_dir = 'in'` (el cliente escribió de último) |
| Espera más vieja | `NOW() - MIN(ultimo_mensaje_en)` sobre esas conversaciones |

Se resalta en la UI cuando la espera más vieja supera un umbral (ver "Umbrales").

Endpoint: `GET /api/reportes/agentes/vivo` → `{ agentes: [{ agenteId, nombre,
sinResponder, esperaMasViejaMin }], general: { sinResponder, esperaMasViejaMin } }`.

## Bloque 2 — Tabla del día

Endpoint: `GET /api/reportes/agentes?fecha=YYYY-MM-DD` (sin `fecha` = hoy). Devuelve
una fila por agente activo + totales:

| Métrica | Definición exacta |
|---|---|
| Mensajes enviados | `wa_mensajes` con `direccion='out'`, `enviado_por_id = agente`, `historico=0`, `ts_proveedor` (o `creado_en` si es NULL) dentro del día |
| Chats atendidos | nº de `conversacion_id` **distintas** de esos mensajes enviados |
| Tomados de general | `wa_asignaciones` con `tipo='toma_manual'` y `ejecutado_por_id = agente`, `creado_en` en el día |
| Cerrados | `wa_conversaciones` con `agente_id = agente` y `cerrada_en` en el día (se atribuye al agente dueño al cierre; `cerrada_en` no guarda quién cerró) |
| TPR promedio | media de los minutos laborales de los turnos de respuesta del día (ver abajo) |
| TPR P90 | percentil 90 de esos mismos turnos (más honesto que el promedio ante colas) |

Respuesta: `{ fecha, agentes: [{ agenteId, nombre, mensajes, chatsAtendidos,
tomados, cerrados, tprPromMin, tprP90Min, turnos }], totales: {...} }`. `turnos` es
el nº de turnos de respuesta usados para el TPR (para saber si la muestra es chica).

## TPR — cálculo

**Turno de respuesta**: dentro de una conversación, un mensaje `out` cuyo mensaje
**inmediatamente anterior** por `ts_proveedor` es `in`. Es decir, el cliente estaba
esperando y el agente contestó. El turno se **atribuye al `enviado_por_id`** del
mensaje `out`, y su `ts` del `in` debe caer en el día consultado.

**Tiempo del turno**: minutos **laborales** entre `in.ts_proveedor` y
`out.ts_proveedor`, recortando lo que caiga fuera de horario. Ejemplos:
- cliente 8:10, agente 8:25 → 15 min.
- cliente 17:55, agente (día siguiente) 08:05 → 5 min de hoy antes de 18:00 + 5 min
  de mañana desde 08:00 = **10 min** (la noche no cuenta).
- cliente domingo → cuenta desde el lunes 08:00.

**Módulo aislado y puro**: `src/services/tiempoLaboral.js` con
`minutosLaborales(desde, hasta, calendario)` donde `calendario` describe las franjas
por día de semana. Función pura, **cubierta con tests** (turnos dentro de una franja,
cruzando el mediodía, cruzando la noche, cruzando fin de semana, mismo instante).

Los pares `(in.ts, out.ts, enviado_por_id)` se extraen con una query (usando
`LAG()` sobre `wa_mensajes` particionado por `conversacion_id` ordenado por
`ts_proveedor`), y el promedio/P90 se calculan en Node sobre esos turnos. El volumen
diario de turnos es de cientos, así que agregarlo en JS es barato y mantiene el
cálculo de horario laboral testeable fuera de SQL.

## Umbrales visuales (configurables en el front, sin persistir)

- **En vivo**: espera más vieja > 30 min → ámbar, > 60 min → rojo.
- **TPR del día**: > 10 min → ámbar, > 30 min → rojo.

Son solo color en la UI; no disparan notificaciones en v1.

## Arquitectura

```
src/
  services/
    tiempoLaboral.js     // minutosLaborales(desde, hasta, calendario) — puro, testeado
    reporteAgentes.js    // queries + agregación: metricasDelDia(fecha), backlogVivo()
  controllers/
    reportesController.js // vivo(req,res), delDia(req,res); validan y devuelven JSON
  routes/
    api.js               // GET /reportes/agentes/vivo, GET /reportes/agentes (requireAdmin)
frontend/src/
  views/ScorecardAgentes.vue  // pantalla /agentes (o el patrón de vistas que use /informe)
  stores/acciones.js          // cargarScorecard(fecha), cargarBacklogVivo()
```

- `reporteAgentes.js` habla con Sequelize/consultas crudas; no mete lógica de horario
  (esa vive en `tiempoLaboral.js`).
- El controller es delgado: valida `fecha` (`^\d{4}-\d{2}-\d{2}$`, default hoy) y
  delega. Errores → 400 (fecha inválida) / 500 (fallo de consulta), nunca traga la
  excepción en silencio (se loguea).
- La pantalla Vue reusa el patrón de `/informe`: cabecera, selector de fecha,
  auto-refresh del bloque "En vivo" cada ~30–60 s (polling simple, sin socket nuevo).

## Testing

- **tiempoLaboral.js**: unit tests de los casos límite listados arriba (node:test,
  como el resto del backend). Es el corazón del TPR y la parte con más aristas.
- **reporteAgentes.js**: test de agregación con datos de ejemplo si se puede aislar
  la query; si depende demasiado de MySQL, al menos verificar el shape de salida.
- **Frontend**: un test de render/estado de la vista con datos mock (como los 33
  actuales), sin pegarle a la API real.

## Qué NO hace v1

- No persiste snapshots (cada consulta recomputa; MySQL 8 con los índices actuales
  resuelve un día rápido). La persistencia para tendencias semanales es una posible
  fase 2.
- No manda nada por WhatsApp ni email; es solo pantalla.
- No mide conversión ni etiquetado (dependen de disciplina de captura; se pueden
  sumar como columnas después).
- No hay escalamiento ni alertas automáticas: los umbrales son solo color.

## Invariantes que respeta

- Solo lee tablas `wa_`; no toca `serfuweb` ni las BD externas.
- Admin-only vía `requireAdmin`.
- No toca el webhook ni el worker (cero impacto en la ingesta).
- Sin migración de esquema.
