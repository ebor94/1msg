-- =====================================================================
-- Migración 002 (2026-07-25): respuestas rápidas por agente.
-- Atajos de texto libre para responder rápido; NO son plantillas de
-- WhatsApp (esas viven en 1msg / wa_plantillas si existiera).
-- =====================================================================

-- Respuestas rápidas por agente (atajos de texto libre; NO son plantillas de WhatsApp).
CREATE TABLE wa_respuestas_rapidas (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  agente_id      INT UNSIGNED  NOT NULL,
  titulo         VARCHAR(80)   NOT NULL,
  texto          VARCHAR(2000) NOT NULL,
  creado_en      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rr_agente (agente_id)
);
