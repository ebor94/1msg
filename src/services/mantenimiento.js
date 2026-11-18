'use strict';
// Modo mantenimiento / aviso de proveedor caído. El banner se enciende de forma
// MANUAL (switch admin) o AUTOMÁTICA (el worker de salud marca 1msg como caído).
// La fuente de verdad son filas de wa_ajustes; aquí vive la lógica.
const { Ajuste } = require('../models');

const CLAVE_MANUAL = 'mantenimiento_manual';        // '0' | '1'
const CLAVE_MENSAJE = 'mantenimiento_mensaje';      // texto mostrado en el banner
const CLAVE_PROVEEDOR = 'proveedor_1msg_estado';    // 'up' | 'down'
const CLAVE_REVISADO = 'proveedor_1msg_revisado_en'; // ISO del último chequeo

const MENSAJE_DEFECTO = 'El envío de WhatsApp no está disponible temporalmente (proveedor). ' +
  'Puedes seguir leyendo los chats; reintenta en unos minutos.';

const CLAVES = [CLAVE_MANUAL, CLAVE_MENSAJE, CLAVE_PROVEEDOR, CLAVE_REVISADO];

/**
 * PURA: decide el estado del banner a partir de los valores crudos.
 * activo = switch manual encendido O proveedor caído. El manual manda en `origen`.
 */
function calcularBanner({ manual, proveedor, mensaje } = {}) {
  const porManual = String(manual || '') === '1';
  const porProveedor = String(proveedor || '') === 'down';
  const activo = porManual || porProveedor;
  const origen = porManual ? 'manual' : (porProveedor ? 'proveedor' : null);
  const texto = String(mensaje || '').trim() || MENSAJE_DEFECTO;
  return { activo, origen, mensaje: texto };
}

async function leerAjustes() {
  const filas = await Ajuste.findAll({ where: { clave: CLAVES } });
  const m = {};
  filas.forEach((f) => { m[f.clave] = f.valor; });
  return m;
}

async function upsert(clave, valor) {
  const [fila, creada] = await Ajuste.findOrCreate({ where: { clave }, defaults: { clave, valor } });
  if (!creada) await fila.update({ valor });
}

/** Estado del banner para el frontend (lo consulta cualquier agente). */
async function estadoBanner() {
  const a = await leerAjustes();
  const b = calcularBanner({ manual: a[CLAVE_MANUAL], proveedor: a[CLAVE_PROVEEDOR], mensaje: a[CLAVE_MENSAJE] });
  return {
    ...b,
    proveedor: a[CLAVE_PROVEEDOR] === 'down' ? 'down' : 'up',
    revisadoEn: a[CLAVE_REVISADO] || null,
    manual: String(a[CLAVE_MANUAL] || '') === '1',
  };
}

/** Guarda el switch manual y, opcionalmente, el mensaje personalizado (admin). */
async function guardarManual({ activo, mensaje }) {
  await upsert(CLAVE_MANUAL, activo ? '1' : '0');
  if (mensaje !== undefined) await upsert(CLAVE_MENSAJE, String(mensaje || '').trim());
  return estadoBanner();
}

/**
 * Registra el resultado del chequeo de salud del proveedor.
 * Devuelve { cambio: boolean, antes, ahora } para que el worker loguee transiciones.
 */
async function registrarSaludProveedor(arriba) {
  const a = await leerAjustes();
  const antes = a[CLAVE_PROVEEDOR] === 'down' ? 'down' : (a[CLAVE_PROVEEDOR] === 'up' ? 'up' : null);
  const ahora = arriba ? 'up' : 'down';
  await upsert(CLAVE_PROVEEDOR, ahora);
  await upsert(CLAVE_REVISADO, new Date().toISOString());
  return { cambio: antes !== ahora, antes, ahora };
}

module.exports = {
  calcularBanner, estadoBanner, guardarManual, registrarSaludProveedor,
  MENSAJE_DEFECTO, CLAVE_MANUAL, CLAVE_MENSAJE, CLAVE_PROVEEDOR, CLAVE_REVISADO,
};
