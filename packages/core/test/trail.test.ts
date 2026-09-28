// El recorrido leído de una página.
//
// Lo que se fija aquí es que un recorrido no sea una estructura que haya que
// mantener: que los nodos, las conectivas y los cruces salgan de mirar el texto,
// y que salgan igual escriba uno la conectiva en el bloque de la parada o en el
// de al lado, porque las dos formas son la misma cosa dicha de dos maneras.
//
// Ver specs/trail.allium.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_PROPERTY_NAMES } from '../src/property-names.ts';
import { isTrail, readTrail, readingOrder, type TrailBlock } from '../src/trail.ts';

let n = 0;
const block = (
  content: string,
  said: { parent?: string | null; position?: number; testimony?: string | null } = {},
): TrailBlock => {
  n += 1;
  return {
    stableId: `block:${n}`,
    parent: said.parent ?? null,
    position: said.position ?? n,
    content,
    testimony: said.testimony ?? null,
  };
};

/** Un corpus de mentira: qué títulos existen y qué páginas ya se tocaban. */
const reading = (
  blocks: readonly TrailBlock[],
  said: {
    pages?: Record<string, string>;
    edges?: [string, string][];
    relations?: Record<string, { id: string; revision: string; content: string }>;
    intent?: string;
  } = {},
) => ({
  page: 'page:trail',
  intent: said.intent ?? null,
  blocks,
  resolve: (title: string) => said.pages?.[title] ?? null,
  linked: (a: string, b: string) =>
    (said.edges ?? []).some(([x, y]) => (x === a && y === b) || (x === b && y === a)),
  relation: (from: string, to: string) => said.relations?.[`${from}->${to}`] ?? null,
});

const PAGES = { Uno: 'page:1', Dos: 'page:2', Tres: 'page:3' };

describe('declararse un recorrido', () => {
  it('es una propiedad y no una clase de página aparte', () => {
    const names = DEFAULT_PROPERTY_NAMES;
    assert.equal(isTrail([{ key: 'tipo', value: 'argumento' }], names), true);
    assert.equal(isTrail([{ key: 'Tipo', value: ' Argumento ' }], names), true);
    assert.equal(isTrail([{ key: 'tipo', value: 'proyecto' }], names), false);
    assert.equal(isTrail([], names), false);
  });

  it('sigue al nombre que el corpus le haya puesto a `tipo`', () => {
    // El vocabulario lo gobierna la ontología: si alguien llamó `clase` a `tipo`,
    // un recorrido se declara con `clase`.
    const names = { ...DEFAULT_PROPERTY_NAMES, kind: 'clase' };
    assert.equal(isTrail([{ key: 'clase', value: 'argumento' }], names), true);
    assert.equal(isTrail([{ key: 'tipo', value: 'argumento' }], names), false);
  });
});

describe('el orden de lectura', () => {
  it('es en profundidad: un hijo va antes que el siguiente hermano', () => {
    // Leerlo plano pondría las notas colgando de una parada detrás de la parada
    // siguiente, y el orden es lo único que un recorrido afirma.
    const first = block('primero', { position: 1 });
    const child = block('dentro', { parent: first.stableId, position: 1 });
    const second = block('segundo', { position: 2 });
    assert.deepEqual(
      readingOrder([second, child, first]).map((one) => one.content),
      ['primero', 'dentro', 'segundo'],
    );
  });
});

describe('leer una página como ruta', () => {
  it('los nodos son sus referencias, numerados desde uno', () => {
    const trail = readTrail(
      reading([block('Empieza en [[Uno]]'), block('y sigue en [[Dos]]')], { pages: PAGES }),
    );
    assert.deepEqual(
      trail.route.map((one) => [one.ordinal, one.title, one.page]),
      [
        [1, 'Uno', 'page:1'],
        [2, 'Dos', 'page:2'],
      ],
    );
  });

  it('una referencia de bloque conserva el bloque preciso y toca su página en el mapa', () => {
    const trail = readTrail({
      ...reading([block('Parte de ((block:source)) y llega a [[Dos]]')], { pages: PAGES }),
      resolveBlock: (id) => id === 'block:source'
        ? { page: 'page:1', title: 'Uno' }
        : null,
    });
    assert.deepEqual(trail.route.map((one) => ({
      title: one.title,
      page: one.page,
      targetBlock: one.targetBlock ?? null,
    })), [
      { title: 'Uno', page: 'page:1', targetBlock: 'block:source' },
      { title: 'Dos', page: 'page:2', targetBlock: null },
    ]);
  });

  it('la conectiva es lo que se lee entre una parada y la siguiente', () => {
    const trail = readTrail(
      reading([block('[[Uno]] no se sostiene sin [[Dos]]')], { pages: PAGES }),
    );
    assert.equal(trail.crossings.length, 1);
    assert.equal(trail.crossings[0]?.connective, 'no se sostiene sin');
  });

  it('un hueco reutiliza la relación dirigida que ya existe entre las paradas', () => {
    const trail = readTrail(reading([block('[[Uno]]'), block('[[Dos]]')], {
      pages: PAGES,
      relations: {
        'page:1->page:2': {
          id: 'crossing:12',
          revision: 'operation:7',
          content: 'la luz aprende a contar',
        },
      },
    }));
    assert.equal(trail.crossings[0]?.connective, 'la luz aprende a contar');
    assert.deepEqual(trail.crossings[0]?.citation, {
      crossing: 'crossing:12',
      revision: 'operation:7',
    });
    assert.equal(trail.argues, true);
  });

  it('no reutiliza la relación del sentido inverso', () => {
    const trail = readTrail(reading([block('[[Uno]]'), block('[[Dos]]')], {
      pages: PAGES,
      relations: {
        'page:2->page:1': {
          id: 'crossing:21',
          revision: 'operation:8',
          content: 'la vuelta dice otra cosa',
        },
      },
    }));
    assert.equal(trail.crossings[0]?.connective, '');
    assert.equal(trail.crossings[0]?.citation, null);
  });

  it('da igual si la conectiva va en el bloque de la parada o en el de al lado', () => {
    // «Y siete años después: [[X]]» y «[[X]]» con la frase encima son la misma
    // cosa dicha de dos maneras, y las dos son buenas.
    const juntos = readTrail(reading([block('[[Uno]] y por eso [[Dos]]')], { pages: PAGES }));
    const separados = readTrail(
      reading([block('[[Uno]]'), block('y por eso'), block('[[Dos]]')], { pages: PAGES }),
    );
    assert.equal(juntos.crossings[0]?.connective, separados.crossings[0]?.connective);
    assert.equal(separados.crossings[0]?.connective, 'y por eso');
  });

  it('lo que va antes de la primera parada abre y no cruza nada', () => {
    const trail = readTrail(
      reading([block('Esto es para quien llegue nuevo. [[Uno]] y luego [[Dos]]')], { pages: PAGES }),
    );
    assert.equal(trail.opening, 'Esto es para quien llegue nuevo.');
    assert.equal(trail.crossings[0]?.connective, 'y luego');
  });

  it('lo que va después de la última no es una conectiva sino la conclusión', () => {
    // @invariant TheLastConnectiveLeadsNowhere: un cruce tiene dos extremos y
    // éste no tendría el segundo.
    const trail = readTrail(
      reading([block('[[Uno]] contra [[Dos]]'), block('Y de ahí que no haya salida.')], {
        pages: PAGES,
      }),
    );
    assert.equal(trail.crossings.length, 1);
    assert.equal(trail.conclusion, 'Y de ahí que no haya salida.');
  });

  it('siete paradas son seis cruces', () => {
    const trail = readTrail(
      reading(
        Array.from({ length: 7 }, (_, at) => block(`[[P${at}]]`)),
        { pages: Object.fromEntries(Array.from({ length: 7 }, (_, at) => [`P${at}`, `page:${at}`])) },
      ),
    );
    assert.equal(trail.route.length, 7);
    assert.equal(trail.crossings.length, 6);
  });

  it('una página sin referencias es un recorrido de cero paradas y no un error', () => {
    // @invariant AnyPageCouldBeSeenAsAThread: mirar cualquier página como hilo es
    // siempre posible, y casi todas darían ruido.
    const trail = readTrail(reading([block('Un párrafo y nada más.')]));
    assert.deepEqual(trail.route, []);
    assert.deepEqual(trail.crossings, []);
    assert.equal(trail.conclusion, '');
    assert.equal(trail.argues, false);
  });
});

describe('las dos caras del cruce', () => {
  it('por camino cuando el corpus ya unía esas dos páginas', () => {
    const trail = readTrail(
      reading([block('[[Uno]] y [[Dos]]')], { pages: PAGES, edges: [['page:1', 'page:2']] }),
    );
    assert.equal(trail.crossings[0]?.kind, 'by_path');
  });

  it('a campo través cuando no las unía nadie', () => {
    const trail = readTrail(reading([block('[[Uno]] y [[Dos]]')], { pages: PAGES }));
    assert.equal(trail.crossings[0]?.kind, 'across_open_ground');
  });

  it('la cara derivada vale en cualquiera de los dos sentidos', () => {
    // Las aristas de Vera son menciones y una mención no se lee como flecha: que
    // la página de 2019 nombre a la de 2024 dice cuál se escribió antes.
    const trail = readTrail(
      reading([block('[[Uno]] y [[Dos]]')], { pages: PAGES, edges: [['page:2', 'page:1']] }),
    );
    assert.equal(trail.crossings[0]?.kind, 'by_path');
  });

  it('un puente cortado cruza a campo través y conserva su número', () => {
    // Renumerar para disimularlo cambiaría el argumento para que el dibujo
    // quedara limpio. @invariant ABrokenBridgeIsDrawnBroken.
    const trail = readTrail(
      reading([block('[[Uno]] luego [[Fantasma]] luego [[Dos]]')], { pages: PAGES }),
    );
    assert.equal(trail.route.length, 3);
    assert.equal(trail.route[1]?.ordinal, 2);
    assert.equal(trail.route[1]?.page, null);
    assert.deepEqual(trail.broken.map((one) => one.title), ['Fantasma']);
    assert.equal(trail.crossings[0]?.kind, 'across_open_ground');
  });

  it('un cruce sin nada escrito es un silencio, y se ve que lo es', () => {
    const trail = readTrail(reading([block('[[Uno]]'), block('[[Dos]]')], { pages: PAGES }));
    assert.equal(trail.crossings[0]?.spokenFor, false);
    assert.equal(trail.argues, false);
  });

  it('el testimonio de cómo se anduvo cuenta como algo dicho', () => {
    // Testimonio y conectiva se parecen y no son lo mismo: «se llegó aquí por
    // quién nombra a X» es un hecho sobre el caminante; «y por eso X no podía
    // sostenerse» es una afirmación del guía. Lo primero cuenta como que el cruce
    // no está mudo, y no como que el recorrido argumente.
    const trail = readTrail(
      reading(
        [block('[[Uno]]'), block('', { testimony: 'se llegó por el buscador' }), block('[[Dos]]')],
        { pages: PAGES },
      ),
    );
    assert.equal(trail.crossings[0]?.testimony, 'se llegó por el buscador');
    assert.equal(trail.crossings[0]?.spokenFor, true);
    assert.equal(trail.argues, false);
  });

  it('con una sola conectiva escrita, el recorrido ya afirma algo', () => {
    const trail = readTrail(reading([block('[[Uno]] contradice a [[Dos]]')], { pages: PAGES }));
    assert.equal(trail.argues, true);
  });
});
