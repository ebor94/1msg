-- 014 — valores fijos del botón de URL para una difusión (array JSON, p. ej. ["bigDay-encuesta/"]).
ALTER TABLE wa_difusiones
  ADD COLUMN boton_params JSON NULL AFTER reasignar;
