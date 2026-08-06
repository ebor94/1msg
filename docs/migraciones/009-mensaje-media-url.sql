-- URL pública de la imagen de encabezado de una plantilla saliente (para mostrarla en la bandeja).
-- TEXT (no VARCHAR(255)): las URLs de encabezado por defecto de Meta/CDN firmadas
-- pueden pasar de 255 chars; un overflow rompería el INSERT DESPUÉS del envío.
ALTER TABLE wa_mensajes ADD COLUMN media_url TEXT NULL AFTER media_nombre;
