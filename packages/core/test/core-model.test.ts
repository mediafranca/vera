// Propagated from specs/core.allium — the structural and surface obligations.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { CHANGE_KINDS, CONTRIBUTION_CHANNELS, VISIBILITIES, checkInvariants } from '@vera/core';
import {
  AGENT,
  OUTSIDER,
  OWNER,
  inhabitedGraph,
  intents,
  makeBlock,
  makePage,
  makeSite,
  runIntents,
  submit,
} from './helpers.ts';

describe('enumerations', () => {
  it('declares exactly the change vocabulary the spec settled on', () => {
    assert.deepEqual([...CHANGE_KINDS].sort(), [
      'create_block',
      'create_crossing',
      'create_page',
      'edit_block',
      'edit_crossing',
      'move_block',
      'recover_page_origin',
      'remove_block',
      'remove_page',
      'remove_property',
      'rename_page',
      'set_block_gloss',
      'set_page_visibility',
      'set_property',
    ]);
  });

  it('has no link_pages kind, because links are derived from content', () => {
    assert.ok(!CHANGE_KINDS.includes('link_pages' as never));
  });

  it('declares the six contribution channels', () => {
    assert.deepEqual([...CONTRIBUTION_CHANNELS].sort(), [
      'agent_generation',
      'authenticated_voice',
      'drawn',
      'import',
      'typed_text',
      'walked',
    ]);
  });

  // Caminar es producir: el testimonio de un cruce lo escribe quien anduvo, y sin
  // este canal lo firmaría Vera. Ver trail/TheTestimonyIsWrittenByWhoeverWalked.
  it('admits what someone produced by walking', () => {
    assert.ok(CONTRIBUTION_CHANNELS.includes('walked'));
  });

  /*
   * Dibujar es producir con la mano, y eso deja denominación de origen humana.
   * Es de la misma clase que la voz autenticada: una grabación prueba que
   * alguien habló, un trazo con su presión prueba que alguien lo hizo con la
   * mano. Ver hand-drawing/AHandLeavesItsName.
   */
  it('admits what someone drew with their hand', () => {
    assert.ok(CONTRIBUTION_CHANNELS.includes('drawn'));
  });

  it('declares two visibilities', () => {
    assert.deepEqual([...VISIBILITIES].sort(), ['private', 'public']);
  });
});

describe('entity fields', () => {
  it('gives a page a title, a visibility and a graph', () => {
    const graph = inhabitedGraph();
    const id = makePage(graph, 'Ficha', 'public');
    const page = graph.page(id);

    assert.equal(page?.title, 'Ficha');
    assert.equal(page?.visibility, 'public');
    assert.equal(page?.graph, graph.id);
  });

  it('gives a block a stable id, a page, a position and an optional parent', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Arbol');
    const root = makeBlock(graph, page, 'raiz', { position: 0 });
    const child = makeBlock(graph, page, 'hijo', { parent: root, position: 0 });

    assert.equal(graph.block(root)?.parent, null, 'a root block has no parent');
    assert.equal(graph.block(child)?.parent, root);
    assert.equal(graph.block(child)?.position, 0);
  });

  it('defaults a page to private', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Nueva');

    assert.equal(graph.page(page)?.visibility, 'private');
  });

  it('leaves evidence absent on a typed submission', () => {
    const graph = inhabitedGraph();
    makePage(graph, 'Escrita');

    assert.equal(graph.revisions().at(-1)?.evidence, undefined);
  });
});

describe('invariant BlockParentBelongsToSamePage', () => {
  it('holds after any sequence of changes', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        for (const block of graph.allBlocks()) {
          if (block.parent === null) continue;
          assert.equal(graph.block(block.parent)?.page, block.page);
        }
      }),
    );
  });

  it('carries a subtree with its root when the root moves to another page', () => {
    const graph = inhabitedGraph();
    const here = makePage(graph, 'Aqui');
    const there = makePage(graph, 'Alla');
    const root = makeBlock(graph, here, 'raiz');
    const child = makeBlock(graph, here, 'hijo', { parent: root });

    submit(graph, { kind: 'move_block', block: root, page: there, parent: null, position: 0 });

    assert.equal(graph.block(child)?.page, there);
    assert.equal(graph.block(child)?.parent, root, 'the subtree keeps its shape');
  });
});

describe('invariant PrivatePagesAreNeverPublished', () => {
  it('refuses to publish a private page', () => {
    const graph = inhabitedGraph();
    const site = makeSite(graph);
    const page = makePage(graph, 'Privada');

    assert.throws(
      () => graph.publish({ site, page, path: 'privada', participant: OWNER }),
      /private|visibility/i,
    );
  });

  it('publishes a public page for its human owner', () => {
    const graph = inhabitedGraph();
    const site = makeSite(graph);
    const page = makePage(graph, 'Publica', 'public');

    const publication = graph.publish({ site, page, path: '/publica/', participant: OWNER });

    assert.equal(publication.page, page);
    assert.equal(publication.site, site);
    assert.equal(publication.path, 'publica');
    assert.equal(publication.publishedBy, OWNER);
  });

  it('keeps the site entry point empty until its owner chooses a published page', () => {
    const graph = inhabitedGraph();
    const site = makeSite(graph);
    const page = makePage(graph, 'Portada', 'public');

    assert.equal(graph.site(site)?.entryPoint, null);
    assert.throws(
      () => graph.setSiteEntryPoint({ site, page, participant: OWNER }),
      /published/i,
    );

    graph.publish({ site, page, path: 'portada', participant: OWNER });
    graph.setSiteEntryPoint({ site, page, participant: OWNER });

    assert.equal(graph.site(site)?.entryPoint, page);
  });

  it('refuses to let an agent publish', () => {
    const graph = inhabitedGraph();
    const site = makeSite(graph);
    const page = makePage(graph, 'Publica', 'public');

    assert.throws(
      () => graph.publish({ site, page, path: 'publica', participant: AGENT }),
      /human|owner/i,
    );
  });

  it('holds after any sequence of changes', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        for (const publication of graph.publications()) {
          assert.equal(graph.page(publication.page)?.visibility, 'public');
        }
      }),
    );
  });
});

describe('invariant PublicationBarriersAreNeverCrossed', () => {
  it('inherits an explicit prohibition through nested membership', () => {
    const graph = inhabitedGraph();
    const work = makePage(graph, 'Vida personal y familiar');
    const project = makePage(graph, 'Casa de Reñaca');
    const note = makePage(graph, 'Recolectadores');
    submit(graph, {
      kind: 'set_property', page: work,
      propertyKey: 'publicación prohibida', propertyValue: 'sí',
    });
    submit(graph, {
      kind: 'create_crossing', fromPage: project, toPage: work,
      content: 'La casa pertenece a la vida personal.', term: 'forma parte de',
    });
    submit(graph, {
      kind: 'create_crossing', fromPage: note, toPage: project,
      content: 'Este dato pertenece a la casa.', term: 'forma parte de',
    });

    const outcome = submit(graph, { kind: 'set_page_visibility', page: note, visibility: 'public' });

    assert.equal(outcome.status, 'rejected');
    assert.match('reason' in outcome ? outcome.reason : '', /publicación.*prohibida/i);
    assert.deepEqual(checkInvariants(graph), []);
  });

  it('does not turn a contribution into membership', () => {
    const graph = inhabitedGraph();
    const work = makePage(graph, 'Vida personal y familiar');
    const essay = makePage(graph, 'Ensayo público');
    submit(graph, {
      kind: 'set_property', page: work,
      propertyKey: 'publicación prohibida', propertyValue: 'sí',
    });
    submit(graph, {
      kind: 'create_crossing', fromPage: essay, toPage: work,
      content: 'El ensayo contribuye a pensar la vida cotidiana.', term: 'contribuye a',
    });

    const outcome = submit(graph, { kind: 'set_page_visibility', page: essay, visibility: 'public' });

    assert.equal(outcome.status, 'applied');
    assert.deepEqual(checkInvariants(graph), []);
  });

  it('refuses to activate a barrier over an already public member', () => {
    const graph = inhabitedGraph();
    const work = makePage(graph, 'Vida personal y familiar');
    const member = makePage(graph, 'Dato expuesto', 'public');
    submit(graph, {
      kind: 'create_crossing', fromPage: member, toPage: work,
      content: 'Pertenece al ámbito.', term: 'forma parte de',
    });

    const outcome = submit(graph, {
      kind: 'set_property', page: work,
      propertyKey: 'publicación prohibida', propertyValue: 'sí',
    });

    assert.equal(outcome.status, 'rejected');
    assert.match('reason' in outcome ? outcome.reason : '', /páginas públicas/i);
  });
});

// Publicar es una operación con sitio, frontera, dirección, fecha y mano. Una
// página pública es *elegible*; lo que la pone en un sitio es que alguien la
// publique ahí. @guarantee HumanPublicationAuthority, @invariant
// SiteMembershipIsExplicit (personal-site-projection.allium).
describe('rule PublishVisiblePage', () => {
  it('lets only the owner correct the site title and canonical URL', () => {
    const graph = inhabitedGraph();
    const site = makeSite(graph);

    const configured = graph.configureSite({
      site,
      participant: OWNER,
      title: '  Vera pública  ',
      canonicalDomain: 'https://publica.example/',
    });

    assert.equal(configured.title, 'Vera pública');
    assert.equal(configured.canonicalDomain, 'https://publica.example');
    assert.throws(
      () => graph.configureSite({
        site,
        participant: AGENT,
        title: 'Otra',
        canonicalDomain: 'https://otra.example',
      }),
      /owner/i,
    );
    assert.throws(
      () => graph.configureSite({
        site,
        participant: OWNER,
        title: 'Vera',
        canonicalDomain: 'javascript:alert(1)',
      }),
      /HTTP/i,
    );
  });

  it('keeps the first public revision while later revisions join the public life', () => {
    const graph = inhabitedGraph();
    const site = makeSite(graph);
    const page = makePage(graph, 'Publica', 'public');
    const block = makeBlock(graph, page, 'primera version');

    const first = graph.publish({ site, page, path: 'publica', participant: OWNER });

    submit(graph, { kind: 'edit_block', block, content: 'segunda version' });

    assert.equal(
      graph.publicationsOf(site)[0]?.firstRevision,
      first.firstRevision,
      'editing after publishing does not move the public boundary',
    );

    const again = graph.publish({ site, page, path: 'publica', participant: OWNER });
    assert.equal(again.firstRevision, first.firstRevision, 'publishing again preserves the boundary');
    assert.equal(graph.publicationsOf(site).length, 1, 'the address holds one living page');
  });

  it('refuses a revision that belongs to another page', () => {
    const graph = inhabitedGraph();
    const site = makeSite(graph);
    const here = makePage(graph, 'Aqui', 'public');
    const there = makePage(graph, 'Alla', 'public');
    const elsewhere = graph.revisions().find((revision) => revision.page === there)?.operation;
    assert.ok(elsewhere !== undefined);

    assert.throws(
      () =>
        graph.publish({ site, page: here, path: 'aqui', participant: OWNER, firstRevision: elsewhere }),
      /another page/i,
    );
  });

  it('refuses to hand one address to two pages', () => {
    const graph = inhabitedGraph();
    const site = makeSite(graph);
    const first = makePage(graph, 'Primera', 'public');
    const second = makePage(graph, 'Segunda', 'public');

    graph.publish({ site, page: first, path: 'obra', participant: OWNER });

    assert.throws(
      () => graph.publish({ site, page: second, path: 'obra', participant: OWNER }),
      /already publishes/i,
    );
  });

  it('refuses a path that climbs out of the site', () => {
    const graph = inhabitedGraph();
    const site = makeSite(graph);
    const page = makePage(graph, 'Publica', 'public');

    assert.throws(
      () => graph.publish({ site, page, path: '../../etc/passwd', participant: OWNER }),
      /traverse/i,
    );
  });

  it('refuses to publish to a site owned by someone else', () => {
    const graph = inhabitedGraph();
    graph.addParticipant({ id: OUTSIDER, name: 'Otra', kind: 'human' });
    graph.admit(OUTSIDER);
    const site = graph.createSite({
      owner: OUTSIDER,
      title: 'Otro sitio',
      canonicalDomain: 'https://otro.example',
    }).id;
    const page = makePage(graph, 'Publica', 'public');

    assert.throws(
      () => graph.publish({ site, page, path: 'publica', participant: OWNER }),
      /site owner/i,
    );
  });

  // @guarantee BuildHasNoUnassignedPublicInput: una página pública asignada a
  // otro sitio está tan ausente de este build como una privada.
  it('keeps a public page out of a site nobody published it to', () => {
    const graph = inhabitedGraph();
    const mine = makeSite(graph, { domain: 'https://vera.mediafranca.net' });
    const other = makeSite(graph, { title: 'Otro', domain: 'https://otro.example' });
    const page = makePage(graph, 'Publica', 'public');

    graph.publish({ site: other, page, path: 'publica', participant: OWNER });

    assert.deepEqual(graph.publicationsOf(mine), []);
    assert.equal(graph.publicationsOf(other).length, 1);
  });

  it('withdraws a publication without touching the page', () => {
    const graph = inhabitedGraph();
    const site = makeSite(graph);
    const page = makePage(graph, 'Publica', 'public');
    graph.publish({ site, page, path: 'publica', participant: OWNER });
    graph.setSiteEntryPoint({ site, page, participant: OWNER });

    assert.equal(graph.unpublish({ site, path: 'publica', participant: OWNER }), true);
    assert.deepEqual(graph.publicationsOf(site), []);
    assert.equal(graph.site(site)?.entryPoint, null, 'withdrawing the cover clears the entry point');
    assert.equal(graph.page(page)?.visibility, 'public', 'the page survives its withdrawal');
  });

  it('requires withdrawal before a published page can become private', () => {
    const graph = inhabitedGraph();
    const site = makeSite(graph);
    const page = makePage(graph, 'Publica', 'public');
    graph.publish({ site, page, path: 'publica', participant: OWNER });

    const outcome = graph.submitOperation({
      originId: 'privatizar-publicada',
      participant: OWNER,
      channel: 'typed_text',
      change: { kind: 'set_page_visibility', page, visibility: 'private' },
    });

    assert.equal(outcome.status, 'rejected');
    assert.equal(graph.page(page)?.visibility, 'public');
  });

  it('survives replaying the log, which does not contain it', () => {
    const graph = inhabitedGraph();
    const site = makeSite(graph);
    const page = makePage(graph, 'Publica', 'public');
    graph.publish({ site, page, path: 'publica', participant: OWNER });

    const replayed = graph.replayFromLog();

    assert.equal(replayed.publicationsOf(site).length, 1);
    assert.equal(replayed.site(site)?.canonicalDomain, 'https://vera.mediafranca.net');
    assert.deepEqual(checkInvariants(replayed), []);
  });

  it('leaves the graph free of violations', () => {
    const graph = inhabitedGraph();
    const site = makeSite(graph);
    const page = makePage(graph, 'Publica', 'public');
    graph.publish({ site, page, path: 'publica', participant: OWNER });

    assert.deepEqual(checkInvariants(graph), []);
  });
});

describe('surface GraphParticipation', () => {
  it('exposes the graph name and its pages to an active participant', () => {
    const graph = inhabitedGraph();
    makePage(graph, 'Visible');

    const view = graph.participationSurface(AGENT);

    assert.equal(view.name, 'mind');
    assert.equal(view.pages.length, 1);
  });

  it('is absent for a participant with no membership', () => {
    const graph = inhabitedGraph();

    assert.throws(() => graph.participationSurface(OUTSIDER));
  });

  it('is absent for a suspended participant', () => {
    const graph = inhabitedGraph();
    graph.suspend(AGENT);

    assert.throws(() => graph.participationSurface(AGENT));
  });
});

describe('the invariant checker itself', () => {
  it('reports nothing on a graph built only through the write path', () => {
    fc.assert(
      fc.property(intents, (list) => {
        assert.deepEqual(checkInvariants(runIntents(list)), []);
      }),
    );
  });

  it('names the invariant it caught when state is corrupted directly', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Corrupta');
    const a = makeBlock(graph, page, 'uno');
    const b = makeBlock(graph, page, 'dos');

    // Deliberately bypassing submitOperation: this is the situation the checker exists for.
    graph.unsafeSetBlockStableId(b, a);

    const violations = checkInvariants(graph);
    assert.ok(violations.some((v) => v.invariant === 'BlockStableIdentityIsUnique'));
  });
});
