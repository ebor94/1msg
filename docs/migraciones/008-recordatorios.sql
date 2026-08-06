-- docs/migraciones/008-recordatorios.sql
-- Recordatorios mensuales por contacto + ajustes globales + origen 'recordatorio'.
CREATE TABLE wa_recordatorios (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contacto_id     BIGINT UNSIGNED NOT NULL,
  dia_mes         TINYINT UNSIGNED NOT NULL,           -- 1..30
  activo          TINYINT(1)      NOT NULL DEFAULT 1,
  ultimo_envio_en DATE            NULL,                -- último envío (para no duplicar en el mes)
  agente_id       INT UNSIGNED    NULL,
  creado_por_id   INT UNSIGNED    NULL,
  creado_en       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recordatorio_contacto (contacto_id),
  KEY idx_recordatorio_barrido (activo, dia_mes),
  CONSTRAINT fk_recordatorio_contacto FOREIGN KEY (contacto_id) REFERENCES wa_contactos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE wa_ajustes (
  clave           VARCHAR(60)     NOT NULL,
  valor           TEXT            NULL,
  actualizado_en  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO wa_ajustes (clave, valor) VALUES
  ('recordatorio_plantilla', 'texto_imagen_generico'),
  ('recordatorio_texto', ''),
  ('recordatorio_imagen_url', '')
ON DUPLICATE KEY UPDATE clave = clave;

ALTER TABLE wa_conversaciones
  MODIFY COLUMN origen ENUM('entrante','saliente','difusion','ctwa','recordatorio') NOT NULL DEFAULT 'entrante';
