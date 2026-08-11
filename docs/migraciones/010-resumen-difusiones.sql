-- Resumen de difusiones con IA → gestión de previsión.
-- Flag por campaña + cédula y marca de idempotencia por destinatario.
ALTER TABLE wa_difusiones
  ADD COLUMN requiere_resumen TINYINT(1) NOT NULL DEFAULT 0 AFTER categoria;

ALTER TABLE wa_difusion_destinatarios
  ADD COLUMN documento VARCHAR(20) NULL AFTER parametros,
  ADD COLUMN resumen_en DATETIME NULL AFTER intentos;
