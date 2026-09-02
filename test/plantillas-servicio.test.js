'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contarVariables, renderizarCuerpo, construirParams, construirParamsHeader, parsearPlantilla, construirParamsCarrusel } = require('../src/services/plantillas');

test('contarVariables cuenta {{n}} distintos', () => {
  assert.equal(contarVariables('Hola {{1}}, saldo {{2}} vence {{2}}'), 2);
  assert.equal(contarVariables('sin variables'), 0);
});

test('renderizarCuerpo sustituye', () => {
  assert.equal(renderizarCuerpo('Hola {{1}}, ${{2}}', ['Ana', '5000']), 'Hola Ana, $5000');
});

test('construirParams: vacío → [], con vars → componente body', () => {
  assert.deepEqual(construirParams([]), []);
  assert.deepEqual(construirParams(['a', 'b']), [
    { type: 'body', parameters: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
  ]);
});

test('parsearPlantilla extrae cuerpo, variables, flags', () => {
  const t = {
    name: 'renovacion_mora', language: 'es', category: 'MARKETING', status: 'approved',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Hola' },
      { type: 'BODY', text: 'Hola {{1}}, saldo {{2}}, plan {{3}}' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'ok' }] },
    ],
  };
  const p = parsearPlantilla(t);
  assert.equal(p.name, 'renovacion_mora');
  assert.equal(p.variables, 3);
  assert.equal(p.tieneBotones, true);
  assert.equal(p.tieneImagen, false);
  assert.equal(p.imagenDefault, null);
  assert.match(p.cuerpo, /Hola \{\{1\}\}/);
});

test('construirParamsHeader: sin url → [], con url → componente header imagen', () => {
  assert.deepEqual(construirParamsHeader(''), []);
  assert.deepEqual(construirParamsHeader('http://x/y.jpg'), [
    { type: 'header', parameters: [{ type: 'image', image: { link: 'http://x/y.jpg' } }] },
  ]);
});

test('parsearPlantilla con header IMAGE expone namespace e imagenDefault', () => {
  const t = {
    name: 'medio_de_pago', language: 'es', category: 'UTILITY', status: 'approved', namespace: 'ns1',
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['http://img'] } },
      { type: 'BODY', text: 'x {{1}}' },
    ],
  };
  const p = parsearPlantilla(t);
  assert.equal(p.imagenDefault, 'http://img');
  assert.equal(p.namespace, 'ns1');
  assert.equal(p.tieneImagen, true);
  assert.equal(p.variables, 1);
});

const plantillaCarrusel = {
  name: 'olivos_carrusel_sfn',
  language: 'es',
  category: 'MARKETING',
  namespace: '8297ac0c_48d8_4ec6_a482_3b545f0544ed',
  components: [
    { type: 'BODY', text: 'Los olivos te invita a , {{1}} , en los siguientes eventos :' },
    {
      type: 'CAROUSEL',
      cards: [
        {
          components: [
            { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://x/img/a.jpg'] } },
            { type: 'BODY', text: 'Evento: {{1}} , | Lugar : {{2}}  |  Fecha : {{3}} | Hora : {{4}} .' },
            { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Asistiré' }, { type: 'QUICK_REPLY', text: 'No Asistiré' }] },
          ],
        },
        {
          components: [
            { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://x/img/b.jpg'] } },
            { type: 'BODY', text: 'Evento: {{1}} , | Lugar : {{2}}  |  Fecha : {{3}} | Hora : {{4}} .' },
            { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Asistiré' }, { type: 'QUICK_REPLY', text: 'No Asistiré' }] },
          ],
        },
      ],
    },
  ],
};

test('parsearPlantilla: carrusel expone bodyVars, tarjetas, imágenes y botones', () => {
  const p = parsearPlantilla(plantillaCarrusel);
  assert.equal(p.esCarrusel, true);
  assert.equal(p.carrusel.bodyVars, 1);
  assert.equal(p.carrusel.cards.length, 2);
  assert.equal(p.carrusel.cards[0].variables, 4);
  assert.equal(p.carrusel.cards[0].tieneImagen, true);
  assert.equal(p.carrusel.cards[0].imagenDefault, 'https://x/img/a.jpg');
  assert.deepEqual(p.carrusel.cards[0].botones, ['Asistiré', 'No Asistiré']);
});

test('parsearPlantilla: plantilla plana no es carrusel', () => {
  const p = parsearPlantilla({ name: 'plana', language: 'es', components: [{ type: 'BODY', text: 'Hola {{1}}' }] });
  assert.equal(p.esCarrusel, false);
  assert.equal(p.carrusel, null);
});

test('construirParamsCarrusel: body + carousel con card_index, header, body y botones', () => {
  const contenido = {
    bodyVars: ['participar en familia'],
    cards: [
      { imagenUrl: 'https://x/a.jpg', vars: ['Conferencia', 'Calle 6', 'Sábado', '3pm'] },
      { imagenUrl: 'https://x/b.jpg', vars: ['Eucaristía', 'Catedral', 'Viernes', '6pm'] },
    ],
  };
  const def = { cards: [{ botones: ['Asistiré', 'No Asistiré'] }, { botones: ['Asistiré', 'No Asistiré'] }] };
  const params = construirParamsCarrusel(contenido, def);

  assert.equal(params[0].type, 'body');
  assert.deepEqual(params[0].parameters, [{ type: 'text', text: 'participar en familia' }]);

  const car = params[1];
  assert.equal(car.type, 'carousel');
  assert.equal(car.cards.length, 2);
  assert.equal(car.cards[0].card_index, 0);
  assert.deepEqual(car.cards[0].components[0], { type: 'header', parameters: [{ type: 'image', image: { link: 'https://x/a.jpg' } }] });
  assert.equal(car.cards[0].components[1].type, 'body');
  assert.equal(car.cards[0].components[1].parameters.length, 4);
  assert.deepEqual(car.cards[0].components[2], { type: 'button', sub_type: 'quick_reply', index: 0, parameters: [{ type: 'payload', payload: 'asistire_c0' }] });
  assert.equal(car.cards[0].components[3].parameters[0].payload, 'no_asistire_c0');
});
