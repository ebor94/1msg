# Selector de indicativo de país al crear contacto

Fecha: 2026-08-01
Estado: aprobado (diseño)

## Problema

Al crear/iniciar un chat, el agente debe teclear el número completo **incluyendo el
indicativo del país** (57 para Colombia). Es propenso a olvidos e inconsistencias. Se
quiere un selector de país que anteponga el indicativo, con **Colombia (+57) por
defecto**, tecleando solo el número local.

## Contexto

Hoy el "crear contacto" es inline en `ListaConversaciones.vue`: el agente escribe en la
caja de búsqueda; si son dígitos, aparece "Iniciar chat con {dígitos}" → `iniciar()` →
`acc.crearContacto(tel, '')` con `tel = soloDigitos(texto)`. El backend
(`POST /contactos`) recibe `telefono` (solo dígitos, ≥10), arma `waId = telefono@c.us`.

**No se necesita API**: los indicativos telefónicos son datos estáticos y estables.

## Alcance: solo frontend

El backend **no cambia** (ya acepta el número completo en dígitos). Toda la lógica de
composición vive en el frontend.

## Arquitectura

### Datos estáticos

`frontend/src/utils/paises.js` — lista corta (~18) de LatAm + comunes, cada uno
`{ codigo, nombre, bandera }`. **Colombia primero** (el consumidor usa `PAISES[0]` como
default). Incluye al menos: Colombia (57), Venezuela (58), Ecuador (593), Perú (51),
Panamá (507), Chile (56), Argentina (54), México (52), Brasil (55), Bolivia (591),
Paraguay (595), Uruguay (598), Costa Rica (506), Guatemala (502), Honduras (504),
El Salvador (503), R. Dominicana (1), España (34), EE.UU./Canadá (1).

### Helper puro

`componerTelefono(codigo, texto) -> string` en `frontend/src/utils/paises.js`:
- Normaliza `texto` a solo dígitos (quita espacios, guiones, `+`, paréntesis).
- Si los dígitos resultantes **ya empiezan por `codigo`**, los devuelve tal cual
  (el agente pegó el número completo con indicativo) → evita el doble indicativo.
- Si no, antepone `codigo`.
- Si no hay dígitos, devuelve cadena vacía.

### UI (`ListaConversaciones.vue`)

- Un `<select>` compacto de país (opciones `bandera + nombre + +codigo`), enlazado a un
  ref `paisSel` inicializado a `PAISES[0]` (Colombia). Se muestra junto a la caja de
  crear/iniciar.
- La etiqueta de la opción "Iniciar chat" muestra el número **compuesto**:
  `Iniciar chat con +{paisSel.codigo} {numeroLocal}` (o el número compuesto completo),
  para que el agente vea qué se creará.
- `iniciar()` compone con `componerTelefono(paisSel.codigo, texto)` y lo pasa a
  `crearContacto`. La condición para mostrar la opción "Iniciar" y la validación mínima
  se calculan sobre el número compuesto.
- El **buscador no cambia**: el selector solo afecta la creación, no la búsqueda por
  nombre/teléfono (la query sigue siendo `texto`).

## Manejo de errores / bordes

- Doble indicativo (pegar número con 57 estando +57 seleccionado) → el helper lo evita.
- Número demasiado corto → el backend ya responde 400 "teléfono inválido"; la UI puede
  además exigir un mínimo de dígitos locales antes de habilitar "Iniciar".
- Contacto existente → el backend responde 409 `existe` (comportamiento actual).

## Pruebas

- **Frontend (Vitest)** `frontend/src/utils/paises.test.js`:
  - `componerTelefono('57','3001234567')` → `'573001234567'`.
  - `componerTelefono('57','573001234567')` → `'573001234567'` (sin duplicar).
  - `componerTelefono('57','300 123-4567')` → `'573001234567'` (quita separadores).
  - `componerTelefono('1','5551234567')` → `'15551234567'`.
  - `componerTelefono('57','')` → `''`.
  - `PAISES[0].codigo` === `'57'` (Colombia por defecto).
- Sin harness de componentes: la UI se valida con el build y verificación manual.

## Fuera de alcance

- Lista mundial completa (~200 países) con buscador.
- Validación de longitud/formato por país.
- Guardar el país/indicativo como campo aparte (se guarda el número completo, como hoy).

## Despliegue

Solo frontend: `git pull` + `npm --prefix frontend run build`. **No requiere reinicio
del backend** (no cambió), pero se puede reiniciar `wa-backend` por consistencia si se
sirve el frontend desde ahí. Sin migración.
