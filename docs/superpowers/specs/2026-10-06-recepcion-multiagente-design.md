# Recepción de chats nuevos: varios agentes + balanceo — diseño

Fecha: 2026-10-06
Estado: aprobado (pendiente de plan)

## Problema

Todos los chats nuevos sin dueño entran a **un solo agente de recepción**
(`env.agenteRecepcionId`, por defecto id 4, fijado en `.env`). No se puede cambiar desde
la interfaz ni repartir entre varios. Se pide poder, desde la UI, **cambiar el agente de
recepción o seleccionar varios** para distribuir la carga.

Contexto confirmado en el código:
- Cascada de asignación (`src/services/asignacion.js`): **dueño (continuidad) → recepción
  → general**. La recepción asigna la conversación pero **no marca dueño**, así que cada
  chat nuevo se re-evalúa (apto para repartir).
- Ajustes editables viven en `wa_ajustes` (clave/valor); ya hay patrón GET/PUT admin
  (`ia_gestion_prompt`) y editor (`PanelPromptIa.vue`). Los agentes se listan en `GET /agentes`.

## Decisiones (confirmadas por el usuario)

- Selección de **varios** agentes de recepción desde la UI.
- Distribución entre varios = **menos cargado** (el agente con menos chats abiertos recibe
  el siguiente). Empate → el primero de la lista configurada. Sin candidatos → general.
- La **continuidad (regla 1)** no cambia.

## Alcance

- Backend: config en `wa_ajustes` + cambio de la regla 2 de la cascada + API admin GET/PUT.
- Frontend: panel admin con selección múltiple de agentes de recepción.
- **Sin migración** (la tabla `wa_ajustes` ya existe; solo una clave nueva). Sin dependencias.
- Solo tablas `wa_`.

## Arquitectura

### 1. Config de recepción — `wa_ajustes` clave `agentes_recepcion`
Valor: lista JSON de ids de agente, ej. `"[4,7,9]"`. Vacío/ausente/ inválido → respaldo a
`[env.agenteRecepcionId]` (comportamiento actual). Helper puro
`parsearAgentesRecepcion(valor, fallbackId) → number[]` (parsea JSON, filtra enteros
positivos, dedup; si queda vacío y hay fallback → `[fallbackId]`; si no → `[]`).

### 2. Servicio de recepción — `src/services/recepcion.js` (nuevo)
- `agentesRecepcionConfigurados({ Ajuste } = deps) → Promise<number[]>`: lee la clave,
  aplica `parsearAgentesRecepcion` con `env.agenteRecepcionId` de respaldo.
- `elegirRecepcion(candidatos, cargas) → number|null` (pura): de `candidatos` (ids en orden),
  devuelve el de menor `cargas[id]` (0 si falta); empate → el primero en el orden de
  `candidatos`; lista vacía → `null`.

### 3. Cascada (regla 2) — `src/services/asignacion.js`
`cascada(contacto, { Agente, Conversacion, Ajuste, transaction })`:
- Regla 1 (dueño activo) igual.
- Regla 2: `ids = await agentesRecepcionConfigurados({ Ajuste })`; filtra a los **activos**
  (consulta `Agente`); si hay ≥1, cuenta los chats abiertos de cada uno
  (`Conversacion.count` con `agenteId` y `estado IN (nueva, abierta)`), arma el mapa `cargas`,
  y `elegido = elegirRecepcion(activos, cargas)`; devuelve ese `agenteId` (tipo AUTO_REGLA,
  motivo `recepción (menos cargado): agente N`).
- Regla 3: sin candidatos activos → general (`agenteId: null`), igual que hoy.
- `ingesta.js` pasa `Conversacion` y `Ajuste` en las 3 llamadas a `cascada`.

### 4. API admin — `src/controllers/ajustesController.js` + rutas
- `GET /api/ajustes/recepcion` (requireAuth + requireAdmin) → `{ agentes: number[] }`
  (los efectivos: configurados o respaldo del env).
- `PUT /api/ajustes/recepcion` (admin) body `{ agentes: number[] }`: valida que todos existan
  y estén **activos** (si alguno no → 422 con mensaje); dedup; guarda JSON en la clave
  `agentes_recepcion` (findOrCreate + update, como el prompt IA). Lista vacía permitida
  (= volver a general) — o se decide exigir ≥1; **v1: permite vacío** (cae a general).

### 5. Frontend — panel admin
- Nuevo `frontend/src/components/PanelRecepcion.vue` (estilo `PanelPromptIa.vue`): lista los
  agentes activos (de `acc.agentes` / `cargarAgentes`) con checkbox; marca los que vienen de
  `GET /ajustes/recepcion`; botón guardar hace el PUT con los ids marcados. Mensaje de estado.
- Store (`acciones.js`): `obtenerRecepcion()` y `guardarRecepcion(ids)`.
- Se monta donde ya vive `PanelPromptIa` (área admin de la bandeja).

## Reglas / invariantes

- Continuidad intacta: un contacto con dueño activo sigue cayendo a su agente.
- La recepción sigue **sin marcar dueño** (solo asigna la conversación), así cada chat nuevo
  se reparte por carga.
- Respaldo seguro: si la clave está vacía/corrupta → `env.agenteRecepcionId`; si ese agente
  no está activo o no hay candidatos → general (nunca se pierde el chat).
- Solo admin cambia la config. Parametrizado; solo `wa_`.

## Pruebas

- **Puro (node:test):**
  - `parsearAgentesRecepcion`: JSON válido → ids; vacío/basura → `[fallback]`; sin fallback → `[]`; dedup y filtra no-enteros.
  - `elegirRecepcion`: elige menor carga; empate → primero del orden; lista vacía → null.
- **Backend:** `cascada` con mock de `Agente`/`Conversacion`/`Ajuste`: elige el menos cargado entre activos; si ninguno activo → general; dueño activo → continuidad (sin regresión).
- **API:** `PUT /ajustes/recepcion` rechaza ids inexistentes/inactivos (422) y guarda la lista válida; `GET` devuelve los efectivos.
- **Frontend:** el panel arma el PUT con los ids marcados; refleja los efectivos del GET.
- **En vivo:** configurar 2–3 agentes; enviar varios chats nuevos (sin dueño) y ver que se reparten al de menos chats abiertos; dejar uno solo → todo a él; vaciar → general.

## Límites (v1)

- Balanceo por "chats abiertos" (nueva/abierta), no por complejidad del chat.
- La cuenta de carga se evalúa en el momento de cada ingesta (el worker procesa eventos en
  serie, así que no hay carrera relevante).
- Sin tope por agente ni horarios de recepción (fuera de v1).
