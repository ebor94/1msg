-- Difusiones MVP: agente responsable por destinatario + imagen de encabezado por campaña.
ALTER TABLE wa_difusion_destinatarios
  ADD COLUMN agente_id INT UNSIGNED NULL AFTER contacto_id;

ALTER TABLE wa_difusiones
  ADD COLUMN imagen_url VARCHAR(255) NULL AFTER plantilla_idioma;
