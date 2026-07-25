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

function parsearPlantilla(t) {
  const comps = t.components || [];
  const body = comps.find((c) => c.type === 'BODY');
  const header = comps.find((c) => c.type === 'HEADER');
  const cuerpo = (body && body.text) || '';
  const esImagen = !!(header && header.format === 'IMAGE');
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
  };
}

module.exports = { contarVariables, renderizarCuerpo, construirParams, construirParamsHeader, parsearPlantilla };
