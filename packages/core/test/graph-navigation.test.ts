// Propagated from specs/graph-navigation.allium.
//
// The priority here is @invariant EdgesAreDerivedFromContent: no link outlives
// the text that produced it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  OWNER,
  applied,
  inhabitedGraph,
  intents,
  makeBlock,
  makePage,
  runIntents,
  submit,
} from './helpers.ts';

const linksFrom = (graph: ReturnType<typeof inhabitedGraph>, block: string) =>
  graph.links().filter((l) => l.sourceBlock === block);

describe('links derived from block content', () => {
  it('creates a resolved link when a block references an existing page', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Origen');
    const target = makePage(graph, 'Destino');
    const block = makeBlock(graph, source, 'ver [[Destino]] para el detalle');

    const links = linksFrom(graph, block);
    assert.equal(links.length, 1);
    assert.equal(links[0]?.targetTitle, 'Destino');
    assert.equal(links[0]?.target, target);
  });

  it('preserves a reference to a page that does not exist as an unresolved link', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Origen');
    const block = makeBlock(graph, source, 'pendiente: [[Nunca escrita]]');

    const links = linksFrom(graph, block);
    assert.equal(links.length, 1, '@guarantee IntentToLinkSurvivesTheMissingPage');
    assert.equal(links[0]?.targetTitle, 'Nunca escrita');
    assert.equal(links[0]?.target, null);
  });

  it('does not silently create the page a dangling reference names', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Origen');
    makeBlock(graph, source, '[[Nunca escrita]]');

    assert.equal(
      graph.pages().find((p) => p.title === 'Nunca escrita'),
      undefined,
    );
  });

  it('discards a link when the sentence that produced it is rewritten', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Origen');
    makePage(graph, 'Destino');
    const block = makeBlock(graph, source, 'ver [[Destino]]');
    assert.equal(linksFrom(graph, block).length, 1);

    applied(submit(graph, { kind: 'edit_block', block, content: 'ya no dice nada' }));

    assert.equal(linksFrom(graph, block).length, 0);
  });

  it('discards a link when the block that produced it is removed', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Origen');
    makePage(graph, 'Destino');
    const block = makeBlock(graph, source, 'ver [[Destino]]');

    applied(submit(graph, { kind: 'remove_block', block }));

    assert.equal(linksFrom(graph, block).length, 0);
  });

  it('resolves waiting links when the page they named is finally written', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Origen');
    const block = makeBlock(graph, source, 'algun dia [[Tardia]]');
    assert.equal(linksFrom(graph, block)[0]?.target, null);

    const target = makePage(graph, 'Tardia');

    assert.equal(linksFrom(graph, block)[0]?.target, target);
  });

  it('orphans links back to unresolved when their target page is removed', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Origen');
    const target = makePage(graph, 'Efimera');
    const block = makeBlock(graph, source, 'ver [[Efimera]]');
    assert.equal(linksFrom(graph, block)[0]?.target, target);

    applied(submit(graph, { kind: 'remove_page', page: target }));

    const link = linksFrom(graph, block)[0];
    assert.equal(link?.target, null);
    assert.equal(link?.targetTitle, 'Efimera', 'the sentence keeps naming what it named');
  });

  it('never holds a link whose source block has gone', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        for (const link of graph.links()) {
          assert.notEqual(graph.block(link.sourceBlock), undefined);
        }
      }),
    );
  });

  it('never holds a resolved link pointing at a page that has gone', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        for (const link of graph.links()) {
          if (link.target !== null) assert.notEqual(graph.page(link.target), undefined);
        }
      }),
    );
  });

  it('agrees with the current content of every block', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        for (const block of graph.allBlocks()) {
          const titles = [...block.content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
          const linked = linksFrom(graph, block.stableId).map((l) => l.targetTitle);
          assert.deepEqual([...linked].sort(), [...new Set(titles)].sort());
        }
      }),
    );
  });
});

describe('backlinks', () => {
  it('reports the blocks that reference a page', () => {
    const graph = inhabitedGraph();
    const a = makePage(graph, 'A');
    const b = makePage(graph, 'B');
    const target = makePage(graph, 'Centro');
    const fromA = makeBlock(graph, a, 'cita [[Centro]]');
    const fromB = makeBlock(graph, b, 'tambien [[Centro]]');

    const backlinks = graph.backlinks(target);

    assert.deepEqual(
      backlinks.map((l) => l.sourceBlock).sort(),
      [fromA, fromB].sort(),
    );
  });

  it('excludes references to a page that does not exist', () => {
    const graph = inhabitedGraph();
    const a = makePage(graph, 'A');
    makeBlock(graph, a, '[[Fantasma]]');

    assert.deepEqual(graph.backlinks('page:missing'), []);
  });
});

describe('neighbourhood traversal', () => {
  it('places the centre alone at distance zero', () => {
    const graph = inhabitedGraph();
    const centre = makePage(graph, 'Centro');
    const near = makePage(graph, 'Cerca');
    makeBlock(graph, centre, 'ver [[Cerca]]');

    const hood = graph.neighbourhood({ centre, depth: 1, participant: OWNER });

    const zero = hood.nodes.filter((n) => n.distance === 0);
    assert.equal(zero.length, 1);
    assert.equal(zero[0]?.page, centre);
    assert.ok(hood.nodes.some((n) => n.page === near && n.distance === 1));
  });

  it('follows links in both directions', () => {
    const graph = inhabitedGraph();
    const centre = makePage(graph, 'Centro');
    const inbound = makePage(graph, 'Entrante');
    makeBlock(graph, inbound, 'apunta a [[Centro]]');

    const hood = graph.neighbourhood({ centre, depth: 1, participant: OWNER });

    assert.ok(
      hood.nodes.some((n) => n.page === inbound),
      '@invariant TraversalIsUndirected',
    );
  });

  it('returns only the centre at depth zero', () => {
    const graph = inhabitedGraph();
    const centre = makePage(graph, 'Centro');
    makePage(graph, 'Cerca');
    makeBlock(graph, centre, 'ver [[Cerca]]');

    const hood = graph.neighbourhood({ centre, depth: 0, participant: OWNER });

    assert.equal(hood.nodes.length, 1);
    assert.equal(hood.edges.length, 0);
  });

  it('excludes unresolved references from the nodes it returns', () => {
    const graph = inhabitedGraph();
    const centre = makePage(graph, 'Centro');
    makeBlock(graph, centre, 'ver [[Inexistente]]');

    const hood = graph.neighbourhood({ centre, depth: 2, participant: OWNER });

    assert.equal(hood.nodes.length, 1, '@invariant UnresolvedLinksAreNotNodes');
    assert.equal(hood.edges.length, 0);
  });

  it('terminates on a cyclic graph and respects the depth bound', () => {
    const graph = inhabitedGraph();
    const a = makePage(graph, 'A');
    const b = makePage(graph, 'B');
    makeBlock(graph, a, 'ver [[B]]');
    makeBlock(graph, b, 'ver [[A]]');

    const hood = graph.neighbourhood({ centre: a, depth: 5, participant: OWNER });

    assert.equal(hood.nodes.length, 2, '@invariant DepthBoundsTheResult');
    for (const node of hood.nodes) assert.ok(node.distance <= 5);
  });

  it('lists each page once and each edge once regardless of direction', () => {
    const graph = inhabitedGraph();
    const a = makePage(graph, 'A');
    const b = makePage(graph, 'B');
    makeBlock(graph, a, 'ver [[B]] y otra vez [[B]]');
    makeBlock(graph, b, 'de vuelta [[A]]');

    const hood = graph.neighbourhood({ centre: a, depth: 2, participant: OWNER });

    assert.equal(new Set(hood.nodes.map((n) => n.page)).size, hood.nodes.length);
    assert.equal(hood.edges.length, 1, '@invariant EdgeAppearsOnceRegardlessOfDirection');
  });

  it('draws no self edge for a page that links to itself', () => {
    const graph = inhabitedGraph();
    const solo = makePage(graph, 'Solo');
    makeBlock(graph, solo, 'ver [[Solo]]');

    const hood = graph.neighbourhood({ centre: solo, depth: 2, participant: OWNER });

    assert.equal(hood.edges.length, 0, '@invariant NeighbourhoodHasNoSelfEdge');
  });

  it('counts degree as the edges incident within the neighbourhood', () => {
    const graph = inhabitedGraph();
    const centre = makePage(graph, 'Centro');
    const one = makePage(graph, 'Uno');
    const two = makePage(graph, 'Dos');
    makeBlock(graph, centre, 'ver [[Uno]] y [[Dos]]');
    makeBlock(graph, one, 'ver [[Dos]]');

    const hood = graph.neighbourhood({ centre, depth: 1, participant: OWNER });

    for (const node of hood.nodes) {
      const incident = hood.edges.filter(
        (e) => e.source === node.page || e.target === node.page,
      ).length;
      assert.equal(node.degree, incident);
    }
  });

  it('keeps both endpoints of every edge among its own nodes', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        const centre = graph.pages()[0];
        if (!centre) return;
        const hood = graph.neighbourhood({ centre: centre.id, depth: 2, participant: OWNER });
        const pages = new Set(hood.nodes.map((n) => n.page));
        for (const edge of hood.edges) {
          assert.ok(pages.has(edge.source));
          assert.ok(pages.has(edge.target));
        }
      }),
    );
  });

  it('traverses two allowed relation hops and carries the authored path', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Fuente');
    const middle = makePage(graph, 'Puente');
    const target = makePage(graph, 'Destino');
    const excluded = makePage(graph, 'Descartada');
    applied(submit(graph, {
      kind: 'create_crossing', stableId: 'crossing:source-middle',
      fromPage: source, toPage: middle, term: 'respalda', content: 'La fuente respalda el puente.',
    }));
    applied(submit(graph, {
      kind: 'create_crossing', stableId: 'crossing:middle-target',
      fromPage: middle, toPage: target, term: 'respalda', content: 'El puente respalda el destino.',
    }));
    applied(submit(graph, {
      kind: 'create_crossing', stableId: 'crossing:source-excluded',
      fromPage: source, toPage: excluded, term: 'contradice', content: 'Esta rama contradice la fuente.',
    }));

    const hood = graph.neighbourhood({
      centre: source, depth: 2, participant: OWNER,
      allowedRelations: ['respalda'], maxDegree: 4,
    });

    assert.deepEqual(hood.nodes.map((node) => [node.page, node.distance]), [
      [source, 0], [middle, 1], [target, 2],
    ]);
    assert.equal(hood.nodes.find((node) => node.page === target)?.path.length, 2);
    for (const step of hood.nodes.find((node) => node.page === target)?.path ?? []) {
      assert.equal(step.evidence.kind, 'explained_relation');
      assert.equal(step.evidence.relation, 'respalda');
      assert.notEqual(step.evidence.block, '');
      assert.notEqual(step.evidence.phrase, '');
      assert.notEqual(step.evidence.revision, null);
    }
    assert.equal(hood.nodes.some((node) => node.page === excluded), false);
  });

  it('applies authorization before degree limiting and path selection', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Fuente');
    const hidden = makePage(graph, 'Oculta');
    const visible = makePage(graph, 'Visible');
    makeBlock(graph, source, '[[Oculta]] y [[Visible]]');

    const hood = graph.neighbourhood({
      centre: source, depth: 1, participant: OWNER,
      allowedRelations: ['link'], maxDegree: 1,
      canRead: (page) => page !== hidden,
    });

    assert.deepEqual(hood.nodes.map((node) => node.page), [source, visible]);
    assert.equal(hood.edges.length, 1);
    assert.equal(hood.omittedByDegree, 0,
      'la arista oculta no consume el grado de la página visible');
    assert.ok(hood.nodes.every((node) => node.path.every((step) =>
      step.source !== hidden && step.target !== hidden)));
  });

  it('caps each expansion frontier and reports omitted authorised edges', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Fuente');
    makePage(graph, 'Uno'); makePage(graph, 'Dos'); makePage(graph, 'Tres');
    makeBlock(graph, source, '[[Uno]], [[Dos]] y [[Tres]]');

    const hood = graph.neighbourhood({
      centre: source, depth: 1, participant: OWNER,
      allowedRelations: ['link'], maxDegree: 1,
    });

    assert.equal(hood.nodes.length, 2);
    assert.equal(hood.edges.length, 1);
    assert.equal(hood.omittedByDegree, 2);
  });
});

describe('renaming a page carries its links along', () => {
  it('rewrites the links that named it, and they stay connected', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Origen');
    const target = makePage(graph, 'Destino');
    const block = makeBlock(graph, source, 'ver [[Destino]] para el detalle');

    applied(submit(graph, { kind: 'rename_page', page: target, title: 'Llegada' }));

    assert.equal(graph.block(block)?.content, 'ver [[Llegada]] para el detalle');
    const links = linksFrom(graph, block);
    assert.equal(links.length, 1);
    assert.equal(links[0]?.targetTitle, 'Llegada');
    assert.equal(links[0]?.target, target, 'el enlace sigue apuntando a la misma página');
  });

  it('matches the link however it was capitalised', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Origen');
    const target = makePage(graph, 'Destino');
    const block = makeBlock(graph, source, 'ver [[destino]] y [[DESTINO]]');

    applied(submit(graph, { kind: 'rename_page', page: target, title: 'Llegada' }));

    assert.equal(graph.block(block)?.content, 'ver [[Llegada]] y [[Llegada]]');
    assert.equal(linksFrom(graph, block)[0]?.target, target);
  });

  it('leaves the same name alone when it is prose and not a link', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Origen');
    const target = makePage(graph, 'Destino');
    // El nombre suelto es algo que alguien dijo; sólo el corchete es un enlace.
    const block = makeBlock(graph, source, 'Destino es un buen nombre, ver [[Destino]]');

    applied(submit(graph, { kind: 'rename_page', page: target, title: 'Llegada' }));

    assert.equal(graph.block(block)?.content, 'Destino es un buen nombre, ver [[Llegada]]');
  });

  it('still connects a link that had been waiting for the new title', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Origen');
    const target = makePage(graph, 'Destino');
    const waiting = makeBlock(graph, source, 'algún día [[Llegada]]');
    assert.equal(linksFrom(graph, waiting)[0]?.target, null);

    applied(submit(graph, { kind: 'rename_page', page: target, title: 'Llegada' }));

    assert.equal(linksFrom(graph, waiting)[0]?.target, target);
  });

  it('reconstructs the same graph when the log is replayed', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Origen');
    const target = makePage(graph, 'Destino');
    const block = makeBlock(graph, source, 'ver [[Destino]]');
    applied(submit(graph, { kind: 'rename_page', page: target, title: 'Llegada' }));

    // @invariant ReplayReconstructsState: la reescritura es consecuencia del
    // renombrado, así que reproducir el registro la vuelve a producir.
    const again = graph.replayFromLog();
    assert.equal(again.block(block)?.content, 'ver [[Llegada]]');
    assert.equal(again.links().filter((l) => l.sourceBlock === block)[0]?.target, target);
  });
});
