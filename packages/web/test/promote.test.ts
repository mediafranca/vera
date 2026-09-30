// Promover un rastro a recorrido.
//
// Lo que se fija aquí es la línea que separa el testimonio de la conectiva, que
// es lo único delicado de este gesto: Vera transcribe cómo se anduvo y no
// escribe nunca lo que significó. Un «y después» de plantilla tendría la forma
// de una conectiva sin afirmar nada, y ocuparía el sitio donde va lo que alguien
// tiene que escribir.
//
// Ver specs/trail.allium, regla PromoteTheTraceAsAnArgument.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  blocksFor,
  fillTraceCrossings,
  provisionalTitle,
  seedArgumentPreparation,
  testimonyFor,
} from '../src/promote.ts';
import type { TraceStep } from '../src/trace.ts';

const titles: Record<string, string> = {
  'page:1': 'Amereida',
  'page:2': 'Casiopea',
  'page:3': 'Travesía',
};
const titleOf = (id: string): string => titles[id] ?? id;

const step = (page: string, from: string | null, gesture: TraceStep['gesture']): TraceStep => ({
  page,
  from,
  gesture,
  at: 0,
});

describe('el testimonio', () => {
  it('dice cómo se anduvo, que es un hecho comprobable', () => {
    assert.equal(
      testimonyFor(step('page:2', 'page:1', 'followed_reference'), titleOf),
      'se llegó siguiendo una referencia desde «Amereida»',
    );
    assert.equal(
      testimonyFor(step('page:2', 'page:1', 'followed_backlink'), titleOf),
      'se llegó preguntando quién habla de «Amereida»',
    );
    assert.equal(testimonyFor(step('page:2', null, 'searched'), titleOf), 'se llegó buscando');
  });

  it('nunca dice lo que el paso significó', () => {
    // Testimonio y conectiva se parecen mucho y no son lo mismo. Lo primero lo
    // transcribe Vera; lo segundo lo escribe quien compone, o no está.
    for (const gesture of ['followed_reference', 'searched', 'opened_directly'] as const) {
      const said = testimonyFor(step('page:2', 'page:1', gesture), titleOf);
      assert.ok(/^se (llegó|volvió)/.test(said), `«${said}» no suena a testimonio`);
      assert.ok(!/por eso|porque|y después|entonces/.test(said));
    }
  });
});

describe('el nombre con que nace', () => {
  it('es un andamio con la fecha, para que la página pueda existir', () => {
    assert.equal(
      provisionalTitle(new Date('2026-08-09T12:00:00Z'), () => false),
      'Preparación argumental del 2026-08-09',
    );
  });

  it('no pisa una página que ya se llamaba así', () => {
    const taken = new Set(['Preparación argumental del 2026-08-09']);
    assert.equal(
      provisionalTitle(new Date('2026-08-09T12:00:00Z'), (name) => taken.has(name)),
      'Preparación argumental del 2026-08-09 (2)',
    );
  });
});

describe('lo que nace', () => {
  const trace = [
    step('page:1', null, 'opened_directly'),
    step('page:2', 'page:1', 'followed_reference'),
    step('page:3', 'page:2', 'searched'),
  ];

  it('nace privado, porque haber andado no es haber decidido enseñarlo', () => {
    // @invariant ADraftTrailIsBornPrivate: un rastro que se publicara solo
    // convertiría el mapa en una cámara.
    const seed = seedArgumentPreparation(trace, { title: 'Preparación argumental del 2026-08-09' });
    assert.deepEqual(seed.page, {
      kind: 'create_page',
      title: 'Preparación argumental del 2026-08-09',
      visibility: 'private',
    });
  });

  it('nace como preparación y no anticipa la madurez que debe declarar la persona', () => {
    const properties = seedArgumentPreparation(trace, { title: 'X' }).properties('page:9');
    assert.deepEqual(properties, [
      {
        kind: 'set_property',
        page: 'page:9',
        propertyKey: 'tipo',
        propertyValue: 'preparación argumental',
      },
    ]);
  });

  it('una parada, un hueco, una parada', () => {
    const blocks = blocksFor(trace, titleOf);
    assert.deepEqual(
      blocks.map((one) => one.content),
      ['[[Amereida]]', '', '[[Casiopea]]', '', '[[Travesía]]'],
    );
  });

  it('el hueco nace vacío y con el testimonio colgando', () => {
    // Está vacío a propósito: es el sitio donde va la conectiva, y se ve que
    // está vacío porque lo está.
    const blocks = blocksFor(trace, titleOf);
    assert.equal(blocks[1]?.content, '');
    assert.equal(blocks[1]?.testimony, 'se llegó siguiendo una referencia desde «Amereida»');
    assert.equal(blocks[3]?.testimony, 'se llegó buscando');
  });

  it('una conectiva recorrida entra como cita versionada, no como inferencia', () => {
    const walked = [
      step('page:1', null, 'opened_directly'),
      {
        ...step('page:2', 'page:1', 'followed_reference'),
        crossing: { id: 'crossing:12', revision: 'operation:7', content: 'La luz aprende a contar.' },
      },
    ];
    const blocks = blocksFor(walked, titleOf);
    assert.equal(blocks[1]?.content, 'La luz aprende a contar.');
    assert.deepEqual(blocks[1]?.crossing, {
      id: 'crossing:12',
      revision: 'operation:7',
      content: 'La luz aprende a contar.',
    });
  });

  it('una relación existente entra aunque se haya llegado por otro gesto', () => {
    const held = { id: 'crossing:12', revision: 'operation:7', content: 'La luz aprende a contar.' };
    const filled = fillTraceCrossings(trace, (from, to) =>
      from === 'page:1' && to === 'page:2' ? held : null,
    );
    assert.deepEqual(filled[1]?.crossing, held);
    assert.equal(filled[2]?.crossing, undefined);
  });

  it('la revisión realmente recorrida no se reemplaza por la vigente', () => {
    const cited = { id: 'crossing:12', revision: 'operation:6', content: 'antes' };
    const walked = [trace[0]!, { ...trace[1]!, crossing: cited }];
    const filled = fillTraceCrossings(walked, () => ({
      id: 'crossing:12', revision: 'operation:7', content: 'ahora',
    }));
    assert.deepEqual(filled[1]?.crossing, cited);
  });

  it('las paradas no llevan testimonio: el testimonio es del tramo', () => {
    for (const one of blocksFor(trace, titleOf).filter((x) => x.content !== '')) {
      assert.equal(one.testimony, null);
    }
  });

  it('un rastro de un solo paso da una parada y ningún hueco', () => {
    const blocks = blocksFor([step('page:1', null, 'opened_directly')], titleOf);
    assert.deepEqual(blocks.map((one) => one.content), ['[[Amereida]]']);
  });
});
