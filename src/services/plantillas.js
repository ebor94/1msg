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

function parsearPlantilla(t) {
  const comps = t.components || [];
  const body = comps.find((c) => c.type === 'BODY');
  const header = comps.find((c) => c.type === 'HEADER');
  const cuerpo = (body && body.text) || '';
  return {
    name: t.name,
    language: typeof t.language === 'string' ? t.language : (t.language && t.language.code) || 'es',
    categoria: t.category || null,
    cuerpo,
    variables: contarVariables(cuerpo),
    tieneImagen: !!(header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format)),
    tieneBotones: comps.some((c) => c.type === 'BUTTONS'),
  };
}

module.exports = { contarVariables, renderizarCuerpo, construirParams, parsearPlantilla };
