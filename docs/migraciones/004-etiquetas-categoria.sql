-- 004 — Etiquetado de conversaciones: categoría + orden + catálogo semilla.
-- Reutiliza wa_etiquetas / wa_conversacion_etiqueta (ya existían sin uso).

ALTER TABLE wa_etiquetas
  ADD COLUMN categoria ENUM('origen','interes') NOT NULL DEFAULT 'interes' AFTER nombre,
  ADD COLUMN orden     TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER activa;

-- Catálogo inicial (idempotente por UNIQUE(nombre)). El admin puede editarlo luego.
INSERT INTO wa_etiquetas (nombre, categoria, color, activa, orden) VALUES
  ('Página web',           'origen',  '#2563eb', 1, 1),
  ('Mostrador / oficina',  'origen',  '#0d9488', 1, 2),
  ('Referido',             'origen',  '#7c3aed', 1, 3),
  ('Redes sociales',       'origen',  '#db2777', 1, 4),
  ('Publicidad / volante', 'origen',  '#ea580c', 1, 5),
  ('Llamada / telemercadeo','origen', '#ca8a04', 1, 6),
  ('Otro',                 'origen',  '#6b7280', 1, 7),
  ('Prenecesidad',          'interes', '#1d4ed8', 1, 1),
  ('Mantenimiento',         'interes', '#0f766e', 1, 2),
  ('Previsión (planes)',    'interes', '#6d28d9', 1, 3),
  ('Cartera / pagos',       'interes', '#b91c1c', 1, 4),
  ('Servicio inmediato',    'interes', '#c2410c', 1, 5),
  ('PQR / reclamo',         'interes', '#a16207', 1, 6),
  ('Información general',    'interes', '#4b5563', 1, 7)
ON DUPLICATE KEY UPDATE categoria = VALUES(categoria), color = VALUES(color), orden = VALUES(orden);
