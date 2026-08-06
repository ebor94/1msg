-- URL pública de la imagen de encabezado de una plantilla saliente (para mostrarla en la bandeja).
ALTER TABLE wa_mensajes ADD COLUMN media_url VARCHAR(255) NULL AFTER media_nombre;
