-- 012 — Contenido de plantillas tipo carrusel para una difusión (fijo por campaña).
-- Presente ⇒ la difusión es de carrusel: { bodyVars:[...], cards:[{ imagenUrl, vars:[...] }] }.
ALTER TABLE wa_difusiones
  ADD COLUMN carrusel JSON NULL AFTER imagen_url;
