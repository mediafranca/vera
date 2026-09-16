// Pruebas de la lógica pura del outliner: no tocan el DOM.
//
// La sesión de edición vive ahora en session.ts y se prueba aparte: Escape dejó
// de descartar, así que los casos que lo fijaban ya no describen nada.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNeighbourhoods,
  buildTree,
  bodyBlocks,
  blockRemovalOrder,
  externalDestination,
  foldsWhileRevealing,
  foldedState,
  invokeMenuAction,
  isSpecialPage,
  matchingMovePages,
  needsProgressiveComposition,
  nodeMarkdown,
  projectedReferenceText,
  referenceExcerptAddsContext,
  reloadAfterServerWriting,
  reloadAfterDerivedWriting,
  reloadOptionsFor,
} from '../src/outliner.ts';
import type { BlockView } from '../src/api.ts';

const block = (stableId: string, parent: string | null, position: number, content = stableId): BlockView => ({
  stableId,
  parent,
  position,
  content,
});

describe('composición progresiva de páginas', () => {
  it('reparte una página mediana antes del antiguo umbral de cien bloques', () => {
    assert.equal(
      needsProgressiveComposition(Array.from({ length: 32 }, (_, index) => block(`b${index}`, null, index))),
      true,
    );
  });

  it('reparte una página de menos bloques cuando su fuente es costosa', () => {
    const blocks = Array.from({ length: 16 }, (_, index) =>
      block(`b${index}`, null, index, index < 2 ? '| una | tabla |\n| --- | --- |' : 'prosa'),
    );
    assert.equal(needsProgressiveComposition(blocks), true);
  });

  it('mantiene inmediata una página breve y liviana', () => {
    assert.equal(
      needsProgressiveComposition(Array.from({ length: 20 }, (_, index) => block(`b${index}`, null, index, 'prosa'))),
      false,
    );
  });
});

describe('enlaces salientes', () => {
  const here = 'https://vera.mediafranca.net/p/Bit%C3%A1cora';

  it('reconoce sólo HTTP de otro origen', () => {
    assert.equal(externalDestination('https://ejemplo.cl/a', here), 'https://ejemplo.cl/a');
    assert.equal(externalDestination('/p/Otra', here), null);
    assert.equal(externalDestination('#seccion', here), null);
    assert.equal(externalDestination('mailto:alguien@ejemplo.cl', here), null);
  });
});

describe('redibujar después de escribir', () => {
  it('un renombrado vuelve al corpus y reemplaza la ruta actual', () => {
    assert.deepEqual(
      reloadOptionsFor({ kind: 'rename_page', page: 'page:1', title: 'Nombre definitivo' }),
      { fromCorpus: true, replaceRoute: true },
    );
  });

  it('una edición local sigue redibujándose desde la réplica', () => {
    assert.equal(
      reloadOptionsFor({ kind: 'edit_block', block: 'block:1', content: 'texto' }),
      undefined,
    );
  });

  it('una transformación escrita por el servidor vuelve al corpus', () => {
    assert.deepEqual(reloadAfterServerWriting(), { fromCorpus: true });
  });

  it('una relación vuelve al corpus porque no vive en la réplica de una página', () => {
    assert.deepEqual(reloadAfterDerivedWriting(), { fromCorpus: true });
  });
});

describe('menú encadenado', () => {
  it('detiene el clic antes de abrir el siguiente menú', () => {
    const order: string[] = [];
    invokeMenuAction(
      { stopPropagation: () => order.push('stop') },
      { run: () => order.push('run') },
    );
    assert.deepEqual(order, ['stop', 'run']);
  });
});

describe('páginas especiales', () => {
  it('reconoce tanto la declaración humana como la junta canónica', () => {
    assert.equal(isSpecialPage([{ key: 'tipo', value: 'página especial' }]), true);
    assert.equal(isSpecialPage([{ key: 'special-kind', value: 'ontology' }]), true);
    assert.equal(isSpecialPage([{ key: 'tipo', value: 'argumento' }]), false);
  });
});

describe('buildTree', () => {
  it('anida por parent y ordena por position', () => {
    const tree = buildTree([
      block('b', 'a', 1),
      block('a', null, 0),
      block('c', 'a', 0),
    ]);

    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.block.stableId, 'a');
    assert.deepEqual(tree[0]?.children.map((n) => n.block.stableId), ['c', 'b']);
  });

  it('trata como raíz un bloque cuyo padre no vino en la página', () => {
    const tree = buildTree([block('huerfano', 'ausente', 0)]);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.block.stableId, 'huerfano');
  });

  it('no pierde ningún bloque', () => {
    const blocks = [
      block('a', null, 0),
      block('b', 'a', 0),
      block('c', 'b', 0),
      block('d', null, 1),
    ];
    const count = (nodes: ReturnType<typeof buildTree>): number =>
      nodes.reduce((n, node) => n + 1 + count(node.children), 0);
    assert.equal(count(buildTree(blocks)), blocks.length);
  });
});

describe('aparatos de enlaces proyectados fuera del cuerpo', () => {
  const blocks = [
    block('cara', null, 0, 'La cara'),
    block('aparato', null, 1, 'Conectivas de salida'),
    block('poema', 'aparato', 0, 'Poema entero → [[Otra]]'),
  ];
  const page = {
    blocks,
    blockProperties: {
      aparato: [{ key: 'presentación', value: 'referencias salientes' }],
    },
  };

  it('deja el cuerpo principal sin el aparato ni sus descendientes', () => {
    assert.deepEqual(bodyBlocks(page, null).map((one) => one.stableId), ['cara']);
  });

  it('lo conserva al enfocarlo para que siga siendo editable y auditable', () => {
    assert.deepEqual(bodyBlocks(page, 'aparato'), blocks);
  });

  it('presenta el texto canónico completo en la referencia saliente', () => {
    assert.equal(projectedReferenceText(page, 'poema', 'Poema entero…'), 'Poema entero → [[Otra]]');
  });
});

describe('extractos de referencias', () => {
  it('no repite debajo del título un bloque que sólo contiene ese mismo enlace', () => {
    assert.equal(referenceExcerptAddsContext('William Wong', '[[William Wong]]'), false);
  });

  it('conserva una frase que explica el contexto de la referencia', () => {
    assert.equal(referenceExcerptAddsContext('William Wong', 'Conversé con [[William Wong]]'), true);
  });
});

describe('borrar un subárbol', () => {
  it('quita cada hoja antes que su padre y deja la raíz para el final', () => {
    const tree = buildTree([
      block('raíz', null, 0),
      block('hijo', 'raíz', 0),
      block('nieto', 'hijo', 0),
      block('otro', 'raíz', 1),
    ]);

    assert.deepEqual(blockRemovalOrder(tree[0]!), ['nieto', 'hijo', 'otro', 'raíz']);
  });
});

describe('nodeMarkdown', () => {
  it('copia el bloque completo con todos sus descendientes', () => {
    const tree = buildTree([
      block('raíz', null, 0, 'Idea'),
      block('hijo', 'raíz', 0, 'Primer punto'),
      block('nieto', 'hijo', 0, 'Detalle'),
      block('otro', 'raíz', 1, 'Segundo punto'),
    ]);
    assert.equal(
      nodeMarkdown(tree[0]!),
      ['Idea', '- Primer punto', '  - Detalle', '- Segundo punto'].join('\n'),
    );
  });

  it('una hoja copia sólo su Markdown', () => {
    const tree = buildTree([block('hoja', null, 0, 'Texto **limpio**')]);
    assert.equal(nodeMarkdown(tree[0]!), 'Texto **limpio**');
  });
});

describe('foldedState', () => {
  it('proyecta inmediatamente plegar y desplegar en la vista local', () => {
    assert.deepEqual(foldedState([], 'padre', true), ['padre']);
    assert.deepEqual(foldedState(['padre'], 'padre', false), []);
  });

  it('no duplica un bloque ya plegado', () => {
    assert.deepEqual(foldedState(['padre'], 'padre', true), ['padre']);
  });
});

describe('llegar a un bloque referido', () => {
  it('abre sólo sus ancestros plegados y conserva los demás pliegues', () => {
    const blocks = [
      block('raíz', null, 0),
      block('padre', 'raíz', 0),
      block('destino', 'padre', 0),
      block('otra-raíz', null, 1),
    ];
    assert.deepEqual(
      foldsWhileRevealing(blocks, ['raíz', 'padre', 'otra-raíz'], 'destino'),
      ['otra-raíz'],
    );
  });

  it('tolera una identidad ausente sin alterar el plegado', () => {
    assert.deepEqual(foldsWhileRevealing([block('a', null, 0)], ['a'], 'ausente'), ['a']);
  });
});

describe('buscar la página a la que se mueve un bloque', () => {
  const page = (id: string, title: string) => ({ id, title, visibility: 'private' as const, blockCount: 0, linkCount: 0 });

  it('omite la página de origen y busca sin depender de acentos', () => {
    const pages = [page('a', 'Actual'), page('b', 'Diseño gráfico'), page('c', 'Biología')];
    assert.deepEqual(matchingMovePages('diseno', pages, 'a').map((one) => one.id), ['b']);
  });

  it('pone primero el título exacto y después los que sólo lo contienen', () => {
    const pages = [page('a', 'Actual'), page('b', 'Notas de diseño'), page('c', 'Diseño')];
    assert.deepEqual(matchingMovePages('diseño', pages, 'a').map((one) => one.id), ['c', 'b']);
  });
});

describe('buildNeighbourhoods', () => {
  const nodo = (id: string, children: ReturnType<typeof nodo>[] = []) => ({
    block: { stableId: id, parent: null, position: 0, content: id },
    children,
  });

  it('encadena el orden de lectura, no el de hermanos', () => {
    // a, su hijo a1, y luego b. Lo que está «encima» de b es a1, no a.
    const tree = [nodo('a', [nodo('a1')]), nodo('b')];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('b')?.previousVisible?.block, 'a1');
    assert.equal(near.get('a1')?.previousVisible?.block, 'a');
    assert.equal(near.get('a')?.previousVisible, null);
    assert.equal(near.get('a')?.nextVisible, 'a1');
  });

  it('el hermano anterior se salta a los hijos del medio', () => {
    const tree = [nodo('a', [nodo('a1')]), nodo('b')];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('b')?.previousSibling, 'a', 'a1 no es hermano de b');
    assert.equal(near.get('a1')?.previousSibling, null);
  });

  it('sitúa a cada bloque entre sus hermanos', () => {
    const tree = [nodo('a'), nodo('b'), nodo('c')];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('a')?.index, 0);
    assert.equal(near.get('c')?.index, 2);
  });

  it('recuerda al abuelo y dónde está el padre, para desindentar', () => {
    const tree = [nodo('a'), nodo('b', [nodo('b1', [nodo('b1x')])])];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('b1x')?.parent, 'b1');
    assert.equal(near.get('b1x')?.grandparent, 'b');
    assert.equal(near.get('b1')?.parentIndex, 1, 'b es el segundo de su nivel');
  });

  it('sabe quién tiene hijos', () => {
    const tree = [nodo('a', [nodo('a1')]), nodo('b')];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('a')?.hasChildren, true);
    assert.equal(near.get('b')?.hasChildren, false);
    assert.equal(near.get('b')?.previousVisible?.hasChildren, false);
  });
});
