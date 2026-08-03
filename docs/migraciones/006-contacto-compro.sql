-- 006 — Estado de compra del contacto (¿el cliente compró?).
-- NULL = "Seleccione" (sin marcar). Lo marca el agente en la ficha del contacto.
ALTER TABLE wa_contactos
  ADD COLUMN compro ENUM('si','no','pendiente') NULL AFTER linea_negocio;
