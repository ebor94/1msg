// Lista corta de indicativos (LatAm + comunes). Colombia primero = default.
export const PAISES = [
  { codigo: '57', nombre: 'Colombia', bandera: '🇨🇴' },
  { codigo: '58', nombre: 'Venezuela', bandera: '🇻🇪' },
  { codigo: '593', nombre: 'Ecuador', bandera: '🇪🇨' },
  { codigo: '51', nombre: 'Perú', bandera: '🇵🇪' },
  { codigo: '507', nombre: 'Panamá', bandera: '🇵🇦' },
  { codigo: '56', nombre: 'Chile', bandera: '🇨🇱' },
  { codigo: '54', nombre: 'Argentina', bandera: '🇦🇷' },
  { codigo: '52', nombre: 'México', bandera: '🇲🇽' },
  { codigo: '55', nombre: 'Brasil', bandera: '🇧🇷' },
  { codigo: '591', nombre: 'Bolivia', bandera: '🇧🇴' },
  { codigo: '595', nombre: 'Paraguay', bandera: '🇵🇾' },
  { codigo: '598', nombre: 'Uruguay', bandera: '🇺🇾' },
  { codigo: '506', nombre: 'Costa Rica', bandera: '🇨🇷' },
  { codigo: '502', nombre: 'Guatemala', bandera: '🇬🇹' },
  { codigo: '504', nombre: 'Honduras', bandera: '🇭🇳' },
  { codigo: '503', nombre: 'El Salvador', bandera: '🇸🇻' },
  { codigo: '34', nombre: 'España', bandera: '🇪🇸' },
  { codigo: '1', nombre: 'EE.UU. / Canadá', bandera: '🇺🇸' },
];

/**
 * Compone el número internacional: dígitos de `texto`, anteponiendo `codigo`
 * salvo que el número ya empiece por él (evita el doble indicativo).
 */
export function componerTelefono(codigo, texto) {
  const digitos = String(texto || '').replace(/\D/g, '');
  if (!digitos) return '';
  return digitos.startsWith(codigo) ? digitos : `${codigo}${digitos}`;
}
