# Primer prompt para la sesión de Claude Code

Copia esto tal cual en la primera sesión, ya dentro de la carpeta del proyecto.

---

Lee `CLAUDE.md`, `docs/fase-1.md` y `docs/esquema_bandeja.sql` antes de escribir nada.

Vamos a construir la fase 1 completa. Trabaja por tareas en el orden del documento,
y detente al terminar cada una para que yo la revise antes de seguir.

Empieza por la tarea 1 y 2: estructura del proyecto, carga y validación de variables
de entorno, conexión a Sequelize contra la base `serfuweb`, logger, y los modelos de
las 12 tablas `wa_` con sus asociaciones.

Restricciones que no puedes romper:
- No uses `sequelize.sync()` de ningún tipo contra esta base: el esquema ya existe y
  la base tiene tablas del core de negocio que no debemos tocar.
- Todo lo que hable con la API de 1msg vive únicamente en `src/integrations/onemsg/`.
- Nada de Redis.

Cuando termines, muéstrame la estructura de archivos creada y cómo verificar que la
conexión a la base funciona.

---

## Notas para las siguientes sesiones

Si Claude Code pierde contexto entre sesiones, basta con recordarle que lea
`CLAUDE.md`. Ese archivo es la memoria del proyecto: si tomamos una decisión nueva
(una regla de negocio, un cambio de convención), se agrega ahí en el momento, no en
el chat.

Orden sugerido de sesiones:

1. Tareas 1 y 2 — proyecto y modelos.
2. Tarea 3 — endpoint del webhook, probado con `curl` contra un payload de ejemplo.
3. Tarea 4 — worker de normalización. Es la sesión más larga; pídele que la divida
   en el manejador de entrantes primero, y el de acks después.
4. Tarea 5 — descarga de medios.
5. Tarea 6 — acks y errores.
6. Tarea 7 — despliegue y healthcheck.

Antes de conectar el webhook real, pídele que genere un conjunto de payloads de
prueba (mensaje de texto, imagen, audio, ack de entrega, ack con error 131049) y un
script que los dispare contra el endpoint local. Vas a poder validar el worker
entero sin depender de que un cliente escriba.
