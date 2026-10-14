# Difusión: opción "reasignar chats al agente de la difusión" — diseño

Fecha: 2026-10-14
Estado: aprobado (pendiente de plan)

## Problema

Al enviar una difusión, el sistema hoy asigna el dueño del contacto **solo si no tiene**
(`persistirEnvioPlantilla`: `agenteId = contacto.agenteDuenoId || agenteFallback`). Si el
contacto ya tiene dueño, se respeta. Se quiere una **opción (check) en la creación de la
difusión** para **forzar** que los contactos (y sus chats) queden con el agente de la
difusión, aunque ya tuvieran otro dueño.

## Decisiones (confirmadas por el usuario)

- Check **"Reasignar los chats al agente de la difusión"** en el wizard, **desmarcado por
  defecto**.
- **Marcado** → por cada destinatario: `agente_dueno_id = AGENTE_ID de la difusión` (aunque
  ya tenga otro dueño) **y mover la conversación** (abierta o cerrada) a ese agente.
- **Desmarcado** → comportamiento actual (solo asigna si no tenía dueño; respeta existentes).

## Alcance

- Backend: columna `reasignar` en `wa_difusiones` (migración 013); `persistirEnvioPlantilla`
  la respeta; `crear` la guarda; `difusionEnvio` la pasa.
- Frontend: checkbox en `DifusionWizard`.
- Solo tablas `wa_`. Sin dependencias nuevas.

## Arquitectura

### 1. Modelo + migración 013
`wa_difusiones` gana `reasignar BOOLEAN NOT NULL DEFAULT 0`. Modelo `Difusion`:
`reasignar: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }`.

### 2. Decisión de asignación — `src/services/envioPlantilla.js`
Dos helpers puros (exportados para test):
- `decidirAgenteEnvio({ reasignar, duenoActual, agenteDifusion }) → { agenteId, fijarDueno }`:
  - `agenteId = reasignar ? (agenteDifusion || duenoActual || null) : (duenoActual || agenteDifusion || null)`.
  - `fijarDueno = !!agenteId && (reasignar ? duenoActual !== agenteId : !duenoActual)`.
- `debeMoverConversacion({ reasignar, estado, convAgente, agenteId }) → boolean`:
  - `agenteId != null && convAgente !== agenteId && (reasignar || estado === 'cerrada')`.

`persistirEnvioPlantilla` gana un parámetro `reasignar` (opcional, default falso) y usa estos
helpers: calcula `agenteId`, fija el dueño cuando `fijarDueno`, y mueve la conversación
existente cuando `debeMoverConversacion` (hoy solo movía las cerradas; con `reasignar` también
mueve las abiertas). La creación de conversación nueva ya usa `agenteId` (correcto en ambos casos).

Los otros llamadores (`recordatorios.js`) no pasan `reasignar` → comportamiento actual intacto.

### 3. Envío de difusión — `src/services/difusionEnvio.js`
La llamada a `persistirEnvioPlantilla` agrega `reasignar: !!dif.reasignar`.

### 4. Crear difusión — `src/services/difusiones.js` + controller
`crear` acepta `reasignar` y lo persiste (`reasignar: !!reasignar`). El controller `crear`
pasa `reasignar: b.reasignar`.

### 5. Frontend — `DifusionWizard.vue`
Un checkbox "Reasignar los chats al agente de la difusión" (ref `reasignar`, default false),
junto al de "Requiere resumen". Se envía en `crearDifusion({ ..., reasignar })`.

## Reglas / invariantes

- Default seguro: sin el check, nada cambia respecto a hoy (solo asigna si no hay dueño).
- La reasignación ocurre dentro de la transacción de cada destinatario, solo para los que
  efectivamente reciben el mensaje.
- `recordatorios.js` y cualquier otro uso de `persistirEnvioPlantilla` quedan iguales (flag
  opcional).

## Pruebas

- **Backend puro (node:test):**
  - `decidirAgenteEnvio`: sin dueño → agente difusión (ambos modos); con dueño y `reasignar=false`
    → respeta dueño (fijarDueno false); con dueño y `reasignar=true` → agente difusión (fijarDueno
    true porque difiere); dueño == agente difusión → fijarDueno false.
  - `debeMoverConversacion`: cerrada con agente distinto → true (ambos modos); abierta con agente
    distinto → true solo con `reasignar`; mismo agente → false.
- **Backend:** `crear` persiste `reasignar` (con el flag true/false).
- **Frontend:** el wizard envía `reasignar` en el payload de crear.
- **En vivo:** difusión con el check → los destinatarios quedan con dueño = agente de la difusión
  y sus chats movidos; sin el check → se respetan los dueños existentes.

## Límites (v1)

- Sin notificación en vivo por la reasignación masiva (los agentes recargan); la difusión es el
  registro. Sin fila de auditoría por destinatario (fuera de v1).
- "El agente de la difusión" es el `AGENTE_ID` por destinatario del CSV (no un único agente global).
