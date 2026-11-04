// Extraer la respuesta del modelo de lo que la rodea.
//
// No se prueba el modelo —eso sería probar a Qwen, no a Vera— sino lo que Vera
// hace con lo que devuelva: un modelo desobediente es el caso normal, no la
// excepción.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  lastObjectIn,
  hierarchyFrom,
  mergeReadings,
  readingFrom,
  readingPrompt,
  readLocalModelOutput,
  READING_PROMPT_CHARS,
} from '../src/model.ts';

describe('salida del runtime local', () => {
  it('rechaza como fallo el error de ventana que llama-cli imprime por stdout', () => {
    assert.deepEqual(
      readLocalModelOutput(
        'Error: request (5692 tokens) exceeds the available context size (4096 tokens), try increasing it',
        'prompt breve',
      ),
      {
        error: 'el modelo local rechazó el contexto: request (5692 tokens) exceeds the available context size (4096 tokens), try increasing it',
        fatal: true,
      },
    );
  });

  it('conserva una respuesta ordinaria después de retirar el eco del prompt', () => {
    assert.deepEqual(readLocalModelOutput('prompt breve\nRespuesta útil.\nExiting...', 'prompt breve'), {
      text: 'Respuesta útil.',
    });
  });
});

const flat = [
  { stableId: 'block:1', page: 'page:1', parent: null, position: 0, content: 'Problema' },
  { stableId: 'block:2', page: 'page:1', parent: null, position: 1, content: 'Primer detalle' },
  { stableId: 'block:3', page: 'page:1', parent: null, position: 2, content: 'Segundo detalle' },
];

describe('propuesta de jerarquía', () => {
  it('convierte parentescos válidos en movimientos sin reescribir ni reordenar', () => {
    const proposal = hierarchyFrom({
      parents: [
        { block: 'block:2', parent: 'block:1' },
        { block: 'block:3', parent: 'block:1' },
      ],
      explanation: 'Los detalles desarrollan el problema.',
    }, flat);
    assert.deepEqual(proposal.changes, [
      { kind: 'move_block', block: 'block:2', page: 'page:1', parent: 'block:1', position: 0 },
      { kind: 'move_block', block: 'block:3', page: 'page:1', parent: 'block:1', position: 1 },
    ]);
  });

  it('rechaza identidades inventadas, padres posteriores y cambios sobre jerarquía existente', () => {
    const nested = flat.map((block) =>
      block.stableId === 'block:3' ? { ...block, parent: 'block:1' } : block,
    );
    const proposal = hierarchyFrom({ parents: [
      { block: 'block:1', parent: 'block:2' },
      { block: 'block:3', parent: 'block:2' },
      { block: 'block:404', parent: 'block:1' },
    ] }, nested);
    assert.deepEqual(proposal.changes, []);
  });
});

describe('el objeto que el modelo devolvió', () => {
  it('lo encuentra cuando viene solo', () => {
    assert.deepEqual(lastObjectIn('{"types": ["Nota"], "concepts": ["a"]}'), {
      types: ['Nota'],
      concepts: ['a'],
    });
  });

  it('lo encuentra dentro de una valla de código', () => {
    const said = 'Aquí tienes:\n```json\n{"types": ["Idea"], "concepts": []}\n```\n¡Espero que sirva!';
    assert.deepEqual(lastObjectIn(said), { types: ['Idea'], concepts: [] });
  });

  it('ignora el ejemplo del prompt y toma la respuesta', () => {
    // El caso que falló de verdad: el prompt lleva un `{…}` de muestra, y una
    // expresión codiciosa abarcaba desde esa llave hasta la última del texto.
    const said = [
      'Responde con esta forma: {"types": ["…"], "concepts": ["…"]}',
      '{"types": ["Persona"], "concepts": ["diseño"]}',
    ].join('\n');
    assert.deepEqual(lastObjectIn(said), { types: ['Persona'], concepts: ['diseño'] });
  });

  it('no se queda con un objeto que no es el pedido', () => {
    assert.equal(lastObjectIn('{"otra": "cosa"}'), null);
  });

  it('sobrevive a un JSON roto y sigue buscando', () => {
    const said = '{"types": [roto}\n{"types": ["Nota"], "concepts": ["b"]}';
    assert.deepEqual(lastObjectIn(said), { types: ['Nota'], concepts: ['b'] });
  });

  it('dice que no hay nada cuando no lo hay', () => {
    assert.equal(lastObjectIn('No puedo clasificar esta página.'), null);
  });
});

describe('atar la lectura al vocabulario de Vera', () => {
  const context = {
    objects: [],
    properties: [],
    candidates: [
      { id: 'page:aac', title: 'Accesibilidad cognitiva', uses: 3, backlinks: 2, linked: false, excerpt: null },
    ],
  };

  it('convierte en existente un título que Qwen devolvió como nuevo', () => {
    const reading = readingFrom(
      { types: ['proyecto'], newConcepts: ['accesibilidad cognitiva', 'codiseño'] },
      ['Proyecto'],
      context,
    );
    assert.deepEqual(reading, {
      types: ['Proyecto'],
      existingConcepts: ['page:aac'],
      newConcepts: ['codiseño'],
    });
  });

  it('rechaza identidades inventadas y no hace coincidencias difusas', () => {
    const reading = readingFrom(
      { existingConcepts: ['page:inventada'], newConcepts: ['Accesibilidad'] },
      [],
      context,
    );
    assert.deepEqual(reading.existingConcepts, []);
    assert.deepEqual(reading.newConcepts, ['Accesibilidad']);
  });
});

describe('presupuesto del contexto local', () => {
  it('hace caber ontología, candidatos y texto en la ventana completa', () => {
    const candidates = Array.from({ length: 24 }, (_, at) => ({
      id: `page:${at}`,
      title: `Concepto pertinente ${at}`,
      uses: 10,
      backlinks: 20,
      linked: false,
      excerpt: 'Una glosa deliberadamente larga para ocupar el presupuesto del contexto.'.repeat(3),
    }));
    const prompt = readingPrompt('Página larga', 'á'.repeat(20_000), ['Nota'], {
      objects: [],
      properties: [],
      candidates,
    });
    assert.ok(prompt.length <= READING_PROMPT_CHARS);
    assert.match(prompt, /page:0 \| Concepto pertinente 0/);
    assert.doesNotMatch(prompt, /page:23 \| Concepto pertinente 23/);
    assert.match(prompt, /Texto: á+/);
  });
});

/*
 * Juntar lo que dijo cada parte de una página larga.
 *
 * Ver `rule SemanticReadingFollowsTheSections` en specs/page-processing.allium:
 * una página que no cabe de una vez se lee en varias, y lo que sale de cada
 * lectura tiene que volver a ser una sola lectura de la página.
 */
describe('mergeReadings', () => {
  it('lo que dicen varias partes manda sobre lo que dice una sola', () => {
    const merged = mergeReadings([
      { types: ['Nota'], existingConcepts: ['page:diseño'], newConcepts: [] },
      { types: ['Bitácora'], existingConcepts: ['page:diseño'], newConcepts: [] },
      { types: ['Bitácora'], existingConcepts: [], newConcepts: ['almuerzo'] },
    ]);
    assert.deepEqual(merged.types, ['Bitácora', 'Nota']);
    assert.equal(merged.existingConcepts[0], 'page:diseño');
  });

  it('a igualdad de menciones manda el orden de aparición', () => {
    const merged = mergeReadings([
      { types: ['Idea'], existingConcepts: [], newConcepts: [] },
      { types: ['Nota'], existingConcepts: [], newConcepts: [] },
    ]);
    assert.deepEqual(merged.types, ['Idea', 'Nota']);
  });

  it('no inventa nada que ninguna parte dijera', () => {
    const merged = mergeReadings([{ types: [], existingConcepts: [], newConcepts: [] }]);
    assert.deepEqual(merged, { types: [], existingConcepts: [], newConcepts: [] });
  });

  it('leer la página entera da una lectura mejor, no una lista más larga', () => {
    const many = Array.from({ length: 8 }, (_, at) => ({
      types: [`T${at}`],
      existingConcepts: [`page:c${at}`],
      newConcepts: [`d${at}`],
    }));
    const merged = mergeReadings(many);
    assert.equal(merged.types.length, 2);
    assert.equal(merged.existingConcepts.length + merged.newConcepts.length, 5);
  });

  it('la misma palabra escrita de dos formas es una sola', () => {
    const merged = mergeReadings([
      { types: ['Nota'], existingConcepts: [], newConcepts: ['Diseño'] },
      { types: ['nota'], existingConcepts: [], newConcepts: [' diseño '] },
    ]);
    assert.deepEqual(merged.types, ['Nota']);
    assert.deepEqual(merged.newConcepts, ['Diseño']);
  });
});
