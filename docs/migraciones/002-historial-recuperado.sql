-- Marca de que ya se recuperó el historial completo del chat desde 1msg (una vez).
ALTER TABLE wa_conversaciones ADD COLUMN historial_recuperado_en DATETIME NULL;
