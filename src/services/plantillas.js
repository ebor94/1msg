'use strict';

function contarVariables(cuerpo) {
  const set = new Set((String(cuerpo || '').match(/\{\{(\d+)\}\}/g) || []));
  return set.size;
}

function renderizarCuerpo(cuerpo, variables) {
  return String(cuerpo || '').replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const v = variables[Number(n) - 1];
    return v === undefined || v === null ? '' : String(v);
  });
}

function construirParams(variables) {
  if (!variables || !variables.length) return [];
  return [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: String(v) })) }];
}

function construirParamsHeader(imagenUrl) {
  if (!imagenUrl) return [];
  return [{ type: 'header', parameters: [{ type: 'image', image: { link: String(imagenUrl) } }] }];
}

function parsearTarjeta(card) {
  const comps = card.components || [];
  const body = comps.find((c) => c.type === 'BODY');
  const header = comps.find((c) => c.type === 'HEADER');
  const buttons = comps.find((c) => c.type === 'BUTTONS');
  const esImagen = !!(header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format));
  return {
    variables: contarVariables((body && body.text) || ''),
    tieneImagen: esImagen,
    imagenDefault: esImagen ? (header.example && header.example.header_handle && header.example.header_handle[0]) || null : null,
    botones: buttons ? (buttons.buttons || []).map((b) => b.text) : [],
    ejemplos: (body && body.example && body.example.body_text && body.example.body_text[0]) || [],
    texto: (body && body.text) || '',
  };
}

function parsearPlantilla(t) {
  const comps = t.components || [];
  const body = comps.find((c) => c.type === 'BODY');
  const header = comps.find((c) => c.type === 'HEADER');
  const cuerpo = (body && body.text) || '';
  const esImagen = !!(header && header.format === 'IMAGE');
  const carrusel = comps.find((c) => c.type === 'CAROUSEL');
  const bodyEjemplos = (body && body.example && body.example.body_text && body.example.body_text[0]) || [];
  return {
    name: t.name,
    language: typeof t.language === 'string' ? t.language : (t.language && t.language.code) || 'es',
    categoria: t.category || null,
    cuerpo,
    variables: contarVariables(cuerpo),
    tieneImagen: !!(header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format)),
    tieneBotones: comps.some((c) => c.type === 'BUTTONS'),
    namespace: t.namespace || null,
    imagenDefault: esImagen ? (header.example && header.example.header_handle && header.example.header_handle[0]) || null : null,
    esCarrusel: !!carrusel,
    carrusel: carrusel ? { bodyVars: contarVariables(cuerpo), bodyEjemplos, cards: (carrusel.cards || []).map(parsearTarjeta) } : null,
  };
}

function slugBoton(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Pura: arma el `params` de sendTemplate para una plantilla tipo carrusel. */
function construirParamsCarrusel(contenido, def) {
  const bodyVars = (contenido && contenido.bodyVars) || [];
  const params = [];
  if (bodyVars.length) {
    params.push({ type: 'body', parameters: bodyVars.map((v) => ({ type: 'text', text: String(v) })) });
  }
  const cards = ((contenido && contenido.cards) || []).map((card, i) => {
    const botonesDef = (def && def.cards && def.cards[i] && def.cards[i].botones) || [];
    const components = [];
    if (card.imagenUrl) {
      components.push({ type: 'header', parameters: [{ type: 'image', image: { link: String(card.imagenUrl) } }] });
    }
    if ((card.vars || []).length) {
      components.push({ type: 'body', parameters: card.vars.map((v) => ({ type: 'text', text: String(v) })) });
    }
    botonesDef.forEach((texto, idx) => {
      components.push({ type: 'button', sub_type: 'quick_reply', index: idx, parameters: [{ type: 'payload', payload: `${slugBoton(texto)}_c${i}` }] });
    });
    return { card_index: i, components };
  });
  params.push({ type: 'carousel', cards });
  return params;
}

module.exports = { contarVariables, renderizarCuerpo, construirParams, construirParamsHeader, construirParamsCarrusel, parsearPlantilla };
