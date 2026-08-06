-- =====================================================================
-- Bandeja de chats por agente sobre la API de 1msg
-- Convive dentro de la base serfuweb con el prefijo wa_
-- MySQL 8.x / InnoDB / utf8mb4 (emojis obligatorios en WhatsApp)
-- =====================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- Canales WABA. Hoy hay uno solo, pero el instanceId no se hardcodea.
-- El token NO se guarda aquí en claro: se guarda una referencia al
-- secreto (variable de entorno o gestor de secretos).
-- ---------------------------------------------------------------------
CREATE TABLE wa_canales (
  id              INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  instance_id     VARCHAR(64)    NOT NULL,
  nombre          VARCHAR(100)   NOT NULL,
  telefono        VARCHAR(20)    NOT NULL,
  token_ref       VARCHAR(120)   NOT NULL,
  webhook_url     VARCHAR(255)   NULL,
  activo          TINYINT(1)     NOT NULL DEFAULT 1,
  creado_en       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_canal_instance (instance_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Agentes. Son los usuarios de serfuweb que operan la bandeja de WhatsApp
-- (~15 de 40). Tabla puente: usuario_id referencia (blanda, sin FK dura)
-- a serfuweb.usuarios.id; la identidad (nombre/email/activo/clave) vive allá.
-- rol es PROPIO de la herramienta:
--   'administrador' → ve todo y asigna chats ; 'asesor' → lo suyo + general.
-- ---------------------------------------------------------------------
CREATE TABLE wa_agentes (
  id              INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  usuario_id      INT            NULL,   -- enlace blando a serfuweb.usuarios.id
  usuario         VARCHAR(60)    NOT NULL,  -- = serfuweb.usuarios.email (login)
  nombre          VARCHAR(120)   NOT NULL,
  email           VARCHAR(150)   NULL,
  firma           VARCHAR(60)    NULL,  -- prefijo en mensajes salientes
  rol             ENUM('administrador','asesor') NOT NULL DEFAULT 'asesor',
  linea_negocio   VARCHAR(40)    NULL,  -- prevision / funeraria / cementerio
  sede            VARCHAR(60)    NULL,
  max_chats       SMALLINT UNSIGNED NOT NULL DEFAULT 50,
  disponible      TINYINT(1)     NOT NULL DEFAULT 1,
  activo          TINYINT(1)     NOT NULL DEFAULT 1,
  ultima_conexion DATETIME       NULL,
  creado_en       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agente_usuario (usuario),
  UNIQUE KEY uq_agente_usuario_id (usuario_id),
  KEY idx_agente_disponible (activo, disponible)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Contactos. agente_dueno_id es la continuidad: si este número vuelve
-- a escribir, la conversación cae con su agente histórico.
-- wa_experimento y marketing_bloqueado_hasta vienen de los errores
-- 130472 y 131049 de las difusiones.
-- ---------------------------------------------------------------------
CREATE TABLE wa_contactos (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wa_id                     VARCHAR(40)     NOT NULL,  -- 57300xxxxxxx@c.us
  telefono                  VARCHAR(20)     NOT NULL,
  nombre_wa                 VARCHAR(120)    NULL,
  nombre_display            VARCHAR(120)    NULL,      -- editable por el agente
  bsuid                     VARCHAR(64)     NULL,      -- BSUID WhatsApp (@lid: envío por phone=bsuid)
  agente_dueno_id           INT UNSIGNED    NULL,
  cliente_serfuweb_id       VARCHAR(40)     NULL,      -- cruce con el core
  documento                 VARCHAR(20)     NULL,
  linea_negocio             VARCHAR(40)     NULL,
  wa_experimento            TINYINT(1)      NOT NULL DEFAULT 0,
  marketing_bloqueado_hasta DATETIME        NULL,
  bloqueado                 TINYINT(1)      NOT NULL DEFAULT 0,
  creado_en                 DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contacto_wa (wa_id),
  KEY idx_contacto_telefono (telefono),
  KEY idx_contacto_dueno (agente_dueno_id),
  KEY idx_contacto_cliente (cliente_serfuweb_id),
  CONSTRAINT fk_contacto_dueno FOREIGN KEY (agente_dueno_id)
    REFERENCES wa_agentes (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Conversaciones. agente_id NULL = bandeja general.
-- ventana_expira_en es el reloj de las 24h: si ya pasó, la UI bloquea
-- el envío libre y obliga a plantilla.
-- ultimo_mensaje_* están desnormalizados a propósito: la lista de
-- bandeja no puede hacer JOIN contra mensajes en cada refresco.
-- ---------------------------------------------------------------------
CREATE TABLE wa_conversaciones (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canal_id              INT UNSIGNED    NOT NULL,
  contacto_id           BIGINT UNSIGNED NOT NULL,
  agente_id             INT UNSIGNED    NULL,
  estado                ENUM('nueva','abierta','pendiente','cerrada')
                                        NOT NULL DEFAULT 'nueva',
  origen                ENUM('entrante','saliente','difusion','ctwa','recordatorio')
                                        NOT NULL DEFAULT 'entrante',
  atendida_por_bot      TINYINT(1)      NOT NULL DEFAULT 0,
  ventana_expira_en     DATETIME        NULL,
  ultimo_mensaje_en     DATETIME        NULL,
  ultimo_mensaje_texto  VARCHAR(255)    NULL,
  ultimo_mensaje_dir    ENUM('in','out') NULL,
  no_leidos             SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  tomada_en             DATETIME        NULL,
  historico_cargado_en  DATETIME        NULL,  -- backfill bajo demanda ya hecho
  cerrada_en            DATETIME        NULL,
  creado_en             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),

  -- Índice principal de la bandeja de cada agente
  KEY idx_bandeja_agente (agente_id, estado, ultimo_mensaje_en DESC),
  -- Bandeja general: agente_id NULL entra por el mismo índice,
  -- este cubre el orden de llegada de la cola
  KEY idx_bandeja_general (estado, agente_id, ultimo_mensaje_en),
  -- Resincronización tras reconexión del socket
  KEY idx_sync (actualizado_en),
  KEY idx_conv_contacto (contacto_id, creado_en),

  CONSTRAINT fk_conv_canal    FOREIGN KEY (canal_id)    REFERENCES wa_canales (id),
  CONSTRAINT fk_conv_contacto FOREIGN KEY (contacto_id) REFERENCES wa_contactos (id),
  CONSTRAINT fk_conv_agente   FOREIGN KEY (agente_id)   REFERENCES wa_agentes (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Mensajes. wa_message_id UNIQUE es la idempotencia frente a los
-- reintentos del webhook: el worker hace INSERT ... ON DUPLICATE KEY.
-- ts_proveedor manda sobre creado_en para el orden real.
-- media_ruta es TU copia; la URL de 1msg expira en ~5 minutos.
-- ---------------------------------------------------------------------
CREATE TABLE wa_mensajes (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversacion_id   BIGINT UNSIGNED NOT NULL,
  wa_message_id     VARCHAR(128)    NULL,
  direccion         ENUM('in','out') NOT NULL,
  tipo              ENUM('text','image','audio','video','document','sticker',
                         'location','contact','button','interactive','template',
                         'reaction','system') NOT NULL DEFAULT 'text',
  texto             TEXT            NULL,
  media_id          VARCHAR(128)    NULL,
  media_ruta        VARCHAR(255)    NULL,
  media_mime        VARCHAR(100)    NULL,
  media_nombre      VARCHAR(180)    NULL,
  media_url         VARCHAR(255)    NULL,
  media_bytes       INT UNSIGNED    NULL,
  historico         TINYINT(1)      NOT NULL DEFAULT 0,  -- traído por backfill
  responde_a_id     BIGINT UNSIGNED NULL,
  plantilla_nombre  VARCHAR(120)    NULL,
  enviado_por_id    INT UNSIGNED    NULL,   -- NULL si lo envió el bot
  enviado_por_bot   TINYINT(1)      NOT NULL DEFAULT 0,
  estado            ENUM('pendiente','enviado','entregado','leido','fallido')
                                    NOT NULL DEFAULT 'pendiente',
  error_codigo      VARCHAR(20)     NULL,   -- 131049, 130472, 131047...
  error_detalle     VARCHAR(255)    NULL,
  intentos          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ts_proveedor      DATETIME        NULL,
  creado_en         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_msg_wa (wa_message_id),
  -- Scroll infinito del chat abierto
  KEY idx_msg_conv (conversacion_id, ts_proveedor DESC, id DESC),
  KEY idx_msg_estado (estado, actualizado_en),
  KEY idx_msg_error (error_codigo),
  KEY idx_msg_historico (conversacion_id, historico),
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversacion_id)
    REFERENCES wa_conversaciones (id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_agente FOREIGN KEY (enviado_por_id) REFERENCES wa_agentes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Auditoría de asignaciones. Con 15 agentes y contactos que rotan,
-- esta tabla es la que zanja cualquier discusión.
-- ---------------------------------------------------------------------
CREATE TABLE wa_asignaciones (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversacion_id  BIGINT UNSIGNED NOT NULL,
  de_agente_id     INT UNSIGNED    NULL,
  a_agente_id      INT UNSIGNED    NULL,
  tipo             ENUM('auto_continuidad','auto_regla','auto_rotacion',
                        'toma_manual','reasignacion','devuelta_general',
                        'escalado_bot') NOT NULL,
  ejecutado_por_id INT UNSIGNED    NULL,   -- NULL si lo hizo el sistema
  motivo           VARCHAR(200)    NULL,
  creado_en        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_asig_conv (conversacion_id, creado_en),
  KEY idx_asig_agente (a_agente_id, creado_en),
  CONSTRAINT fk_asig_conv FOREIGN KEY (conversacion_id)
    REFERENCES wa_conversaciones (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Notas internas: no salen a WhatsApp, solo las ve el equipo.
-- ---------------------------------------------------------------------
CREATE TABLE wa_notas_internas (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversacion_id BIGINT UNSIGNED NOT NULL,
  agente_id       INT UNSIGNED    NOT NULL,
  nota            TEXT            NOT NULL,
  creado_en       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_nota_conv (conversacion_id, creado_en),
  CONSTRAINT fk_nota_conv FOREIGN KEY (conversacion_id)
    REFERENCES wa_conversaciones (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Etiquetas
-- ---------------------------------------------------------------------
CREATE TABLE wa_etiquetas (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre   VARCHAR(60)  NOT NULL,
  color    VARCHAR(9)   NOT NULL DEFAULT '#888780',
  activa   TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_etiqueta (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE wa_conversacion_etiqueta (
  conversacion_id BIGINT UNSIGNED NOT NULL,
  etiqueta_id     INT UNSIGNED    NOT NULL,
  agente_id       INT UNSIGNED    NULL,
  creado_en       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversacion_id, etiqueta_id),
  KEY idx_ce_etiqueta (etiqueta_id),
  CONSTRAINT fk_ce_conv FOREIGN KEY (conversacion_id)
    REFERENCES wa_conversaciones (id) ON DELETE CASCADE,
  CONSTRAINT fk_ce_etq FOREIGN KEY (etiqueta_id)
    REFERENCES wa_etiquetas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Bitácora cruda del webhook. Sirve para reprocesar cuando el worker
-- falla y para depurar payloads raros. Purgar a los 30-60 días.
-- ---------------------------------------------------------------------
CREATE TABLE wa_eventos_webhook (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canal_id       INT UNSIGNED    NULL,
  tipo           VARCHAR(60)     NULL,
  wa_message_id  VARCHAR(128)    NULL,
  payload        JSON            NOT NULL,
  procesado      TINYINT(1)      NOT NULL DEFAULT 0,
  error          VARCHAR(255)    NULL,
  recibido_en    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_evt_pendiente (procesado, recibido_en),
  KEY idx_evt_msg (wa_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Difusiones. Cierra el círculo con el problema de los errores
-- 131049 / 130472: cada destinatario guarda su propio desenlace.
-- ---------------------------------------------------------------------
CREATE TABLE wa_difusiones (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canal_id          INT UNSIGNED    NOT NULL,
  nombre            VARCHAR(150)    NOT NULL,
  plantilla_nombre  VARCHAR(120)    NOT NULL,
  plantilla_idioma  VARCHAR(10)     NOT NULL DEFAULT 'es',
  imagen_url        VARCHAR(255)    NULL,
  categoria         ENUM('marketing','utility','authentication')
                                    NOT NULL DEFAULT 'utility',
  estado            ENUM('borrador','programada','enviando','finalizada','cancelada')
                                    NOT NULL DEFAULT 'borrador',
  programada_para   DATETIME        NULL,
  creado_por_id     INT UNSIGNED    NULL,
  creado_en         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dif_estado (estado, programada_para)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE wa_difusion_destinatarios (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  difusion_id     BIGINT UNSIGNED NOT NULL,
  contacto_id     BIGINT UNSIGNED NOT NULL,
  agente_id       INT UNSIGNED    NULL,
  parametros      JSON            NULL,
  wa_message_id   VARCHAR(128)    NULL,
  estado          ENUM('pendiente','enviado','entregado','leido','fallido','omitido')
                                  NOT NULL DEFAULT 'pendiente',
  error_codigo    VARCHAR(20)     NULL,
  intentos        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  reintentar_en   DATETIME        NULL,
  actualizado_en  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dif_contacto (difusion_id, contacto_id),
  KEY idx_dif_cola (estado, reintentar_en),
  KEY idx_dif_error (difusion_id, error_codigo),
  CONSTRAINT fk_dif_dest FOREIGN KEY (difusion_id)
    REFERENCES wa_difusiones (id) ON DELETE CASCADE,
  CONSTRAINT fk_dif_contacto FOREIGN KEY (contacto_id)
    REFERENCES wa_contactos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Recordatorios mensuales por contacto + ajustes globales del feature
-- (plantilla y textos usados al enviar). origen 'recordatorio' en
-- wa_conversaciones identifica las conversaciones que dispara este envío.
-- ---------------------------------------------------------------------
CREATE TABLE wa_recordatorios (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contacto_id     BIGINT UNSIGNED NOT NULL,
  dia_mes         TINYINT UNSIGNED NOT NULL,           -- 1..30
  activo          TINYINT(1)      NOT NULL DEFAULT 1,
  ultimo_envio_en DATE            NULL,                -- último envío (para no duplicar en el mes)
  agente_id       INT UNSIGNED    NULL,
  creado_por_id   INT UNSIGNED    NULL,
  creado_en       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recordatorio_contacto (contacto_id),
  KEY idx_recordatorio_barrido (activo, dia_mes),
  CONSTRAINT fk_recordatorio_contacto FOREIGN KEY (contacto_id)
    REFERENCES wa_contactos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE wa_ajustes (
  clave           VARCHAR(60)     NOT NULL,
  valor           TEXT            NULL,
  actualizado_en  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- Consultas clave (referencia)
-- =====================================================================

-- Toma atómica de un chat de la bandeja general.
-- Verificar affectedRows: si es 0, otro agente se adelantó.
--
-- UPDATE wa_conversaciones
--    SET agente_id = :agente, tomada_en = NOW(), estado = 'abierta'
--  WHERE id = :conv AND agente_id IS NULL;

-- Bandeja de un agente (paginada, 25 por página).
--
-- SELECT c.*, ct.nombre_display, ct.telefono
--   FROM wa_conversaciones c
--   JOIN wa_contactos ct ON ct.id = c.contacto_id
--  WHERE c.agente_id = :agente AND c.estado <> 'cerrada'
--  ORDER BY c.ultimo_mensaje_en DESC
--  LIMIT 25 OFFSET :offset;

-- Bandeja general (cola FIFO).
--
-- SELECT ... FROM wa_conversaciones c
--  WHERE c.agente_id IS NULL AND c.estado IN ('nueva','abierta')
--  ORDER BY c.ultimo_mensaje_en ASC;

-- Resincronización tras reconexión del socket.
--
-- SELECT ... FROM wa_conversaciones
--  WHERE actualizado_en > :cursor
--    AND (agente_id = :agente OR agente_id IS NULL)
--  ORDER BY actualizado_en ASC;
