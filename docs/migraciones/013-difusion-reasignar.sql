-- 013 — opción de reasignar los chats al agente de la difusión (dueño + mover chat).
ALTER TABLE wa_difusiones
  ADD COLUMN reasignar BOOLEAN NOT NULL DEFAULT 0 AFTER requiere_resumen;
