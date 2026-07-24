# Bandeja de chats WhatsApp — Serfunorte

Capa de bandeja propia sobre la API de 1msg (BSP). Reemplaza únicamente la
gestión (asignación por agente, historial propio, permisos, métricas); 1msg
sigue siendo la pasarela hacia Meta.

La **base de datos es la fuente de verdad**. Ver [`CLAUDE.md`](CLAUDE.md) para el
contexto completo y las reglas de negocio.

## Arquitectura (Fase 1 — ingesta)

```
WhatsApp ─► 1msg ─► webhook (POST /webhook/1msg) ─► wa_eventos_webhook (cola)
                                                          │
                                        worker ◄──────────┘  normaliza a
                                          └─► wa_contactos / wa_conversaciones /
                                              wa_mensajes / wa_asignaciones (+ media a disco)
```

Dos procesos:
- **API/webhook** (`src/index.js`, pm2 `wa-backend`): recibe el webhook, valida el
  secreto e inserta el evento crudo. Nada de lógica pesada (responde en ms).
- **Worker** (`src/workers/index.js`, pm2 `wa-worker`): drena la cola y materializa
  contactos, conversaciones, mensajes, acks y descarga de medios.

## Requisitos

- Node.js 20+
- MySQL 8 (base `serfuweb` con las tablas `wa_` ya creadas — ver
  [`docs/esquema_bandeja.sql`](docs/esquema_bandeja.sql))
- pm2 (`npm i -g pm2`)

## Instalación

```bash
git clone git@github.com:ebor94/1msg.git ~/apps/wa
cd ~/apps/wa
npm ci
cp .env.example .env    # y completar (ver variables abajo)
chmod 600 .env
```

### Variables de entorno (`.env`)

| Variable | Descripción |
|---|---|
| `DB_HOST/PORT/NAME/USER/PASSWORD` | conexión MySQL a `serfuweb` (en el server, `DB_HOST=127.0.0.1`) |
| `ONEMSG_BASE_URL/INSTANCE_ID/TOKEN` | API de 1msg (solo servidor, nunca al frontend) |
| `WEBHOOK_SECRET` | secreto que 1msg presenta en la URL del webhook |
| `MEDIA_PATH` | carpeta donde se guardan los medios descargados |
| `MEDIA_MAX_BYTES` | tamaño máximo de media a descargar |
| `LOG_LEVEL`, `LOG_DIR` | logging |

Si falta una obligatoria, el proceso **no arranca** (fallo ruidoso).

## Verificación

```bash
node scripts/verificar-conexion.js   # conexión + mapeo de los 12 modelos
npm test                             # tests del normalizador
```

## Ejecución (producción con pm2)

```bash
pm2 start src/index.js       --name wa-backend --time
pm2 start src/workers/index.js --name wa-worker  --time
pm2 save                     # persiste la lista para el reinicio
```

Arranque automático tras reboot del servidor (una vez, con sudo):

```bash
pm2 startup    # imprime un comando `sudo env ... systemctl enable ...`; ejecútalo
pm2 save
```

### Modos del worker

```bash
node src/workers/index.js               # bucle continuo (producción)
node src/workers/index.js --dry-run [--limit=N]   # procesa sin escribir (validación)
node src/workers/index.js --once   [--limit=N]    # un lote real y sale
```

## Exposición pública (Cloudflare Tunnel)

El webhook se expone en `https://wa.losolivoscucuta.com` a través del túnel
Cloudflare existente (`glpi-olivos`), ruta pública `wa` → `http://localhost:3000`.
No se abren puertos entrantes; el TLS lo pone Cloudflare. La app ve las
peticiones como `127.0.0.1` (IP real en `CF-Connecting-IP`).

## Configuración del webhook en 1msg

En el panel de 1msg (canal `VID182868781`), el `webhookUrl` es un **array** e
incluye DOS URLs (no quitar la primera, alimenta la bandeja de agentes de 1msg):

```
https://app.1msg.io/service/service_core/whatsapp/webhook/12106
https://wa.losolivoscucuta.com/webhook/1msg?secret=<WEBHOOK_SECRET>
```

Leer/instalar por API: `GET`/`POST https://api.1msg.io/{instanceId}/webhook?token=...`

## Salud

`GET /health` → estado de la base y antigüedad de la cola (pendientes y segundos
del evento más viejo sin procesar).

## Estructura

Ver [`CLAUDE.md`](CLAUDE.md#estructura-de-carpetas). El formato real de los
eventos de 1msg está en [`docs/payloads-reales-1msg.md`](docs/payloads-reales-1msg.md).
