-- =====================================================================
-- Migración 001 (2026-07-24): wa_agentes se apoya en serfuweb.usuarios
-- Roles propios: administrador / asesor. Enlace blando por usuario_id.
-- Aplicada sobre la tabla wa_agentes existente (estaba vacía).
-- =====================================================================

ALTER TABLE wa_agentes
  ADD COLUMN usuario_id INT NULL AFTER id,
  ADD UNIQUE KEY uq_agente_usuario_id (usuario_id),
  MODIFY COLUMN rol ENUM('administrador','asesor') NOT NULL DEFAULT 'asesor';

-- Seed de administradores iniciales (bortega, ssuarez), tomando la identidad
-- de serfuweb.usuarios. Idempotente.
INSERT INTO wa_agentes (usuario_id, usuario, nombre, rol, activo, disponible)
SELECT u.id, u.email, TRIM(CONCAT(u.nombre, ' ', u.apellido)), 'administrador', 1, 1
  FROM serfuweb.usuarios u
 WHERE u.email IN ('bortega', 'ssuarez')
ON DUPLICATE KEY UPDATE rol = 'administrador', activo = 1;
