# Cambio de contraseña desde la bandeja

Fecha: 2026-08-01
Estado: aprobado (diseño)

## Problema

Los agentes dados de alta (asesores) siguen usando una **contraseña temporal** y no
tienen forma de cambiarla desde la bandeja. Se necesita un auto-servicio de cambio de
contraseña.

## Contexto

El login valida contra `serfuweb.usuarios` (`email` + `password` bcrypt) y de ahí
enlaza a `wa_agentes` (`src/services/auth.js`). La contraseña **no vive en una tabla
`wa_`**: vive en `serfuweb.usuarios.password`, la misma credencial que usa la cuenta en
el resto de sistemas de Serfunorte.

**Decisión (autorizada por el usuario):** identidad única — cambiar la contraseña
escribe en `serfuweb.usuarios.password` (anula la regla "no tocar tablas no-`wa_`",
igual que cuando se crearon las cuentas). La nueva clave sirve para la bandeja y para
el sistema principal.

**Compatibilidad de hash verificada:** `serfuweb` almacena bcrypt **costo 10**
(`$2a$10$` / `$2b$10$`). `bcryptjs.hash(clave, 10)` produce exactamente ese formato, y
`bcrypt.compare` / `password_verify` (PHP) lo verifican indistintamente. Sin riesgo de
bloquear el login en ningún sistema.

El JWT lleva `usuarioId` (= `serfuweb.usuarios.id`), disponible en `req.agente.usuarioId`
tras `requireAuth`. El cambio apunta siempre a la fila propia: nadie puede cambiar la
clave de otro.

## Arquitectura

### Backend

- **Servicio** `cambiarClave(usuarioId, claveActual, claveNueva, deps = {})` en
  `src/services/auth.js`, con inyección de dependencias (como el `autenticar` actual)
  para poder testear sin BD:
  - `buscarPorId(usuarioId)` → `{ id, password, activo }` de `serfuweb.usuarios`.
  - Si no existe o `!activo` → error `{status:404}`.
  - `comparar(claveActual, u.password)`; si falla → error `{status:403, codigo:'clave_actual_incorrecta'}`.
    (Se usa **403**, no 401: el `apiFetch` del frontend interpreta cualquier 401 como
    sesión expirada y **borra el token**; una clave actual mal tecleada no debe cerrar
    la sesión. El 401 queda reservado para JWT inválido/expirado.)
  - Validación de `claveNueva`: `String(claveNueva)` con longitud ≥ 8; y distinta de
    `claveActual`; si no → error `{status:422}`.
  - `hashear(claveNueva)` = `bcrypt.hash(claveNueva, 10)`.
  - `actualizar(usuarioId, hash)` → `UPDATE serfuweb.usuarios SET password = ? WHERE id = ?`.
  - Devuelve `{ ok: true }`. Nunca loguea las claves.
- **Controlador** `authController.cambiarClave`: lee `claveActual`/`claveNueva` del body
  (400 si faltan), llama al servicio con `req.agente.usuarioId`, mapea
  `err.status` 403 → `{error, codigo:'clave_actual_incorrecta'}`, 422 →
  `{error:'la nueva contraseña no es válida'}`, 404 → 404, resto → 500.
- **Ruta** `POST /api/auth/cambiar-clave`, con `requireAuth` y un rate-limit ligero
  (reusa el patrón de `limiteLogin`: ventana 15 min, tope modesto, keyed por
  IP + usuarioId) para frenar fuerza bruta de `claveActual`.

### Frontend

- **Store** `auth.cambiarClave(claveActual, claveNueva)` → `POST /auth/cambiar-clave`.
- **Componente** `PanelCambiarClave.vue` (modal, patrón de los otros modales):
  - Campos: contraseña actual, nueva, confirmar nueva.
  - Validación en cliente: nueva == confirmar, longitud ≥ 8; deshabilita "Guardar" si
    no se cumple.
  - Al enviar: éxito → mensaje "Contraseña actualizada" y cierra; error → muestra el
    mensaje del backend (`e.message`). La sesión sigue viva (el JWT no cambia).
- **Acceso**: botón **🔑** en la cabecera de `Bandeja.vue`, junto a "Salir",
  disponible para **todos los roles**; abre el modal.

## Manejo de errores

- Faltan campos → 400.
- `claveActual` incorrecta → 403 `clave_actual_incorrecta` (mensaje claro en UI).
- `claveNueva` < 8 o igual a la actual → 422.
- Usuario inexistente/inactivo → 404 (no debería ocurrir con sesión válida).
- El cambio no afecta la sesión actual: el JWT ya emitido sigue válido.

## Pruebas (backend, `test/auth-cambiar-clave.test.js`, deps inyectadas)

- `claveActual` incorrecta → lanza 403 y **no** llama a `actualizar`.
- `claveNueva` de 7 chars → lanza 422 y no actualiza.
- `claveNueva` igual a la actual → lanza 422 y no actualiza.
- Camino feliz → llama a `actualizar(usuarioId, hash)` con un hash que empieza por
  `$2` (no la clave en claro) y devuelve `{ok:true}`.
- Usuario inactivo → lanza 404.

Frontend: sin harness de componentes (como el resto); se cubre la validación de cliente
con el build y verificación manual.

## Fuera de alcance

- Reseteo por administrador de la contraseña de otros usuarios.
- Forzar cambio en el primer login (las claves temporales siguen funcionando).
- Políticas de complejidad más allá de la longitud mínima; caducidad de contraseñas.

## Despliegue

Solo código (sin migración). `git pull` + `npm --prefix frontend run build` +
`pm2 restart wa-backend`. Verificación en vivo: cambiar la propia clave y volver a
entrar con la nueva.
