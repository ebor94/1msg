'use strict';

/**
 * Minutos laborales entre dos instantes en hora local de Colombia.
 * Entrada: strings 'YYYY-MM-DD HH:MM:SS' (así llegan de DATE_FORMAT en MySQL,
 * que ya guarda hora de pared local). Puro: sin BD, sin zona horaria.
 */

// Franjas por día de semana (0=Dom .. 6=Sáb), en minutos desde medianoche.
const CALENDARIO = {
  0: [],               // Domingo
  1: [[480, 1080]],    // Lun 08:00–18:00
  2: [[480, 1080]],
  3: [[480, 1080]],
  4: [[480, 1080]],
  5: [[480, 1080]],
  6: [[480, 660]],     // Sáb 08:00–11:00
};

// 'YYYY-MM-DD HH:MM:SS' -> minutos absolutos y ms de medianoche (aritmética TZ-free vía Date.UTC).
function partes(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s));
  if (!m) throw new Error(`fecha inválida: ${s}`);
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5];
  const diaMs = Date.UTC(y, mo - 1, d);
  return { diaMs, min: h * 60 + mi };
}

function minutosLaborales(desde, hasta, calendario = CALENDARIO) {
  const a = partes(desde);
  const b = partes(hasta);
  const desdeAbs = a.diaMs / 60000 + a.min;
  const hastaAbs = b.diaMs / 60000 + b.min;
  if (hastaAbs <= desdeAbs) return 0;

  let total = 0;
  for (let dia = a.diaMs; dia <= b.diaMs; dia += 86400000) {
    const dow = new Date(dia).getUTCDay();
    const base = dia / 60000; // minutos absolutos a la medianoche de ese día
    for (const [ini, fin] of calendario[dow] || []) {
      const ov = Math.min(hastaAbs, base + fin) - Math.max(desdeAbs, base + ini);
      if (ov > 0) total += ov;
    }
  }
  return total;
}

module.exports = { CALENDARIO, minutosLaborales };
