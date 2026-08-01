-- 005 — Archivar conversaciones y desactivar contactos (ocultar, reversible).
ALTER TABLE wa_conversaciones
  ADD COLUMN archivada_en  DATETIME     NULL AFTER estado,
  ADD COLUMN archivada_por INT UNSIGNED NULL AFTER archivada_en;

ALTER TABLE wa_contactos
  ADD COLUMN desactivado_en  DATETIME     NULL AFTER bloqueado,
  ADD COLUMN desactivado_por INT UNSIGNED NULL AFTER desactivado_en;
