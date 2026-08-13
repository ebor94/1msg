# Gestionar con IA — borrador de respuesta (v1) — diseño

Fecha: 2026-08-12
Estado: aprobado (pendiente de plan)

## Problema

Se quiere que, a futuro, un modelo de IA responda conversaciones de WhatsApp de forma
autónoma. Como **primer paso seguro** (human-in-the-loop): marcar un contacto como
"gestionar con IA" y que, cuando el cliente escriba, la IA **redacte** una respuesta
que el agente **revisa, edita y envía** — la IA nunca envía sola. Así se mide la
calidad del modelo antes de darle autonomía.

## Decisiones (confirmadas por el usuario)

- **Autonomía v1**: **borrador para el agente** (la IA propone, el humano decide y
  envía). La IA NUNCA envía sola.
- **Presentación**: **tarjeta de sugerencia** sobre el compositor, con "Usar y editar"
  y "Descartar".
- **Disparo**: cuando llega un mensaje **entrante** de un contacto con el flag activo.
- **Contexto v1**: solo el **hilo de la conversación** + un prompt de rol. Sin datos
  de cartera (saldo/mora) todavía — mejora futura (los contactos no tienen la cédula
  guardada de forma confiable).
- **Modelo**: **Claude Sonnet** (`claude-sonnet-5`).
- **Prompt de rol**: **editable** (en `wa_ajustes`, sin desplegar).

## Alcance / no-alcance

- Backend (Node/Express/Sequelize) + frontend (Vue). Migración pequeña (solo tablas `wa_`).
- La IA **solo redacta**; el envío lo hace el agente por el flujo normal (respeta la
  ventana de 24h, que además siempre está abierta porque el cliente acaba de escribir).
- Se reutiliza el módulo aislado `src/integrations/anthropic/` (regla de aislamiento:
  solo esa carpeta habla con Anthropic; `ANTHROPIC_API_KEY` solo en el `.env` server).
- No autónomo, no escalamiento automático, no envío por IA (todo eso es fase futura).

## Modelo de datos (migración 011)

- `wa_contactos` → `gestionar_con_ia TINYINT(1) NOT NULL DEFAULT 0`.
- `wa_conversaciones` →
  - `borrador_ia TEXT NULL` (la sugerencia pendiente; una por conversación).
  - `borrador_ia_en DATETIME NULL` (cuándo se generó).
- Semilla en `wa_ajustes`: `INSERT` clave `ia_gestion_prompt` con un prompt de rol por
  defecto (editable después).

## Flujo

### Marcar el contacto
En el panel del cliente (PanelCliente), un switch **"Gestionar con IA"** →
`PATCH /contactos/:id` con `{ gestionarConIa: true|false }` (se extiende el endpoint que
ya edita el nombre). Cualquier agente puede marcarlo (como el resto de la ficha).

### Generar el borrador (en el `wa-worker`)
Tras la ingesta persistir un mensaje **entrante** (`direccion='in'`) y emitir su socket,
si el contacto tiene `gestionar_con_ia=1` se genera el borrador (servicio nuevo
`src/services/borradorIa.js` → `generarBorrador(conversacionId)`):
1. Carga la conversación + contacto; si el flag no está, no hace nada.
2. Arma el **hilo reciente** (últimos ~20 mensajes de `wa_mensajes` de esa conversación,
   como transcripción `Cliente:` / `Empresa:`; media → `[tipo]`), reusando el mismo
   patrón que `construirTranscripcion` del resumen.
3. Carga el **prompt de rol** de `wa_ajustes` (`ia_gestion_prompt`); si está vacío, usa
   un default de código.
4. Llama a `responder(hilo, prompt)` (módulo Anthropic, Sonnet).
5. Guarda `borrador_ia` + `borrador_ia_en` en la conversación (reemplaza el anterior).
6. Emite por socket `conversacion:borrador` `{ conversacionId, borrador }` a la sala del
   agente dueño (mismo mecanismo worker→API `/internal/emitir` que ya existe).

**Best-effort**: todo el paso 1–6 va en try/catch; si Anthropic falla (o el flag está
apagado, o no hay hilo), simplemente no hay borrador y se loguea — **nunca frena la cola
de ingesta** (invariante 1). Solo se dispara para contactos con el flag (volumen y costo
acotados).

### Ciclo de vida del borrador
- **Nuevo entrante** (flag on) → se **regenera** y reemplaza (siempre refleja lo último
  que dijo el cliente).
- **Agente abre el chat** → el borrador viaja en el objeto conversación (`borradorIa`);
  la tarjeta aparece. Si el chat ya estaba abierto, aparece en vivo por el socket.
- **"Usar y editar"** → rellena el compositor con el texto (editable) y **limpia** el
  borrador en backend (se consumió).
- **"Descartar"** → limpia el borrador en backend.
- **Enviar cualquier mensaje** (manual o el editado) → limpia el borrador en backend
  (defensivo, por si quedó).

### Endpoints
- `PATCH /contactos/:id` — acepta además `gestionarConIa` (bool).
- `DELETE /conversaciones/:id/borrador` — limpia `borrador_ia`/`borrador_ia_en`
  (requireAuth + `puedeVer`). Lo llaman "Usar y editar", "Descartar" y el envío.
- El objeto conversación (lista/al abrir) incluye `borradorIa` para que la tarjeta se
  muestre al abrir.
- Prompt de rol: `GET /ajustes/ia-gestion-prompt` y `PUT /ajustes/ia-gestion-prompt`
  (admin), + un textarea admin para editarlo sin desplegar. (Semilla por defecto en la
  migración.)

## Módulo IA (`src/integrations/anthropic/responder.js`)

- `responder(hilo, promptRol, deps?) → Promise<string>`: llama a la Messages API con
  `model: 'claude-sonnet-5'`, `system: promptRol`, `messages: [{ role: 'user', content:
  hilo }]`, `max_tokens ~500`. Devuelve el texto del bloque `text`, recortado a un
  máximo razonable (~600 chars). `deps.cliente` inyectable para test (sin red).
- Reusa el mismo cliente/patrón que `resumen.js` (mismo `ANTHROPIC_API_KEY`, reintentos
  del SDK). Regla de aislamiento intacta.
- `effort`/thinking quedan en un valor por defecto sensato (tunable); el borrador es
  asíncrono (el agente lo revisa después), así que la latencia de unos segundos es
  aceptable.

## Frontend

- **Switch "Gestionar con IA"** en `PanelCliente.vue` (reusa `acciones` + `PATCH`).
- **Tarjeta de sugerencia** sobre el compositor (en `VistaChat`/`Compositor`): si
  `chat.conversacion.borradorIa`, muestra *"💡 Sugerencia IA: <texto>"* con:
  - **"Usar y editar"** → escribe el texto en el modelo del compositor y llama
    `DELETE .../borrador` (limpia backend + la tarjeta).
  - **"Descartar"** → `DELETE .../borrador`.
- **Socket**: el store de chat escucha `conversacion:borrador`; si el chat abierto
  coincide, setea `chat.conversacion.borradorIa` (aparece la tarjeta en vivo).
- Al **enviar**, además de la lógica actual, se limpia el borrador (llamada o dependido
  del backend que ya lo limpia al registrar el saliente).

## Prompt de rol (default, editable)

Semilla en `wa_ajustes.ia_gestion_prompt` (ejemplo, ajustable):

> "Eres un asistente de atención al cliente de Los Olivos Cúcuta (servicios exequiales
> y de cartera) que redacta, en español y en tono cordial y breve, una posible respuesta
> de la empresa al último mensaje del cliente en WhatsApp. No inventes datos concretos
> (saldos, fechas, montos) que no aparezcan en la conversación; si el cliente los pide,
> ofrece verificarlo. No hagas promesas ni compromisos en nombre de la empresa. Responde
> SOLO con el texto sugerido para enviar, sin preámbulos ni comillas."

## Seguridad / invariantes

- La IA **nunca envía**: solo escribe `borrador_ia`. El envío es 100% del agente.
- `ANTHROPIC_API_KEY` solo en el `.env` server; nunca al repo/frontend/logs. Solo
  `src/integrations/anthropic/` importa el SDK.
- Solo tablas `wa_`. SQL parametrizado.
- La generación no bloquea la ingesta (try/catch, best-effort, invariante 1).
- Idempotencia práctica: un borrador por conversación; se reemplaza/limpia según el ciclo.
- Se dispara solo para contactos con el flag (costo/volumen acotados).

## Pruebas

- Backend (node --test): `responder` con cliente falso (sin red); `generarBorrador` con
  deps inyectadas (flag on/off, con/sin hilo, guarda/limpia el borrador); `PATCH`
  `gestionarConIa`; `DELETE .../borrador`.
- Frontend (vitest): la tarjeta aparece/oculta según `borradorIa`; "Usar y editar"
  rellena el compositor y limpia; el switch pega al `PATCH`.
- Verificación en vivo (usuario): marcar un contacto, escribirle desde otro WhatsApp,
  ver la tarjeta con la sugerencia, usarla/editarla/enviarla, y confirmar que se limpia.

## Límites (v1, aceptados)

- Human-in-the-loop (sin envío autónomo, sin escalamiento) — es el diseño elegido.
- Sin datos de cartera (saldo/mora) en el contexto — mejora futura.
- Un borrador por conversación (no historial de sugerencias).
- La generación corre en el `wa-worker`; una latencia/fallo de Anthropic solo omite el
  borrador de ese mensaje (se re-genera con el próximo entrante).
- Costo: una llamada Sonnet por mensaje entrante de contacto marcado; controlado por el
  flag. Si el volumen crece, se puede bajar a Haiku o limitar por horario.
