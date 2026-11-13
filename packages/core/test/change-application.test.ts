// Propagated from specs/change-application.allium and specs/core.allium.
//
// These are the obligations that carry Vera's distinguishing guarantees:
// stable block identity, idempotent submission and a totally ordered log.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { checkInvariants } from '@vera/core';
import {
  AGENT,
  OUTSIDER,
  OWNER,
  applied,
  inhabitedGraph,
  intents,
  makeBlock,
  makePage,
  originId,
  runIntents,
  submit,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// @guarantee StableIdentityAcrossApplication
// The single most important property in the system.
// ---------------------------------------------------------------------------

describe('stable block identity', () => {
  it('survives editing the block content', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Amereida');
    const block = makeBlock(graph, page, 'el mar interior');

    applied(submit(graph, { kind: 'edit_block', block, content: 'la mar interior' }));

    assert.equal(graph.block(block)?.stableId, block);
    assert.equal(graph.block(block)?.content, 'la mar interior');
  });

  it('survives moving the block to another page and another parent', () => {
    const graph = inhabitedGraph();
    const origin = makePage(graph, 'Travesia');
    const destination = makePage(graph, 'Observacion');
    const parent = makeBlock(graph, destination, 'raiz');
    const block = makeBlock(graph, origin, 'apunte');

    applied(
      submit(graph, { kind: 'move_block', block, page: destination, parent, position: 0 }),
    );

    const moved = graph.block(block);
    assert.equal(moved?.stableId, block, 'moving must not mint a new identity');
    assert.equal(moved?.page, destination);
    assert.equal(moved?.parent, parent);
  });

  it('survives renaming the page the block lives on', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Antes');
    const block = makeBlock(graph, page, 'contenido');

    applied(submit(graph, { kind: 'rename_page', page, title: 'Despues' }));

    assert.equal(graph.block(block)?.stableId, block);
    assert.equal(graph.page(page)?.title, 'Despues');
  });

  it('never reuses a stable id across any sequence of changes', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        const ids = graph.allBlocks().map((b) => b.stableId);
        assert.equal(new Set(ids).size, ids.length, 'invariant BlockStableIdentityIsUnique');
      }),
    );
  });

  it('keeps every surviving block reachable by the id it was created with', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        for (const block of graph.allBlocks()) {
          assert.equal(graph.block(block.stableId)?.stableId, block.stableId);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// @invariant OriginIdentityIsTheIdempotencyKey
// ---------------------------------------------------------------------------

describe('idempotent submission', () => {
  it('reports a resubmitted origin_id as a duplicate rather than applying it twice', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Idempotencia');
    const origin = originId('fixed');
    const change = { kind: 'create_block', page, parent: null, position: 0, content: 'uno' } as const;

    const first = submit(graph, change, { origin });
    const second = submit(graph, change, { origin });

    assert.equal(first.status, 'applied');
    assert.equal(second.status, 'duplicate');
    assert.equal(graph.blocksOf(page).length, 1, 'the block must exist exactly once');
  });

  it('consumes no sequence number for a duplicate', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Secuencia');
    const origin = originId('fixed');
    const change = { kind: 'create_block', page, parent: null, position: 0, content: 'uno' } as const;

    submit(graph, change, { origin });
    const before = graph.log().lastSequence;
    submit(graph, change, { origin });

    assert.equal(graph.log().lastSequence, before);
  });

  it('records no second revision for a duplicate', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Procedencia');
    const origin = originId('fixed');
    const change = { kind: 'edit_block', block: makeBlock(graph, page, 'a'), content: 'b' } as const;

    submit(graph, change, { origin });
    const before = graph.revisions().length;
    submit(graph, change, { origin });

    assert.equal(graph.revisions().length, before);
  });

  it('resolves a duplicate to the same operation the first submission produced', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Misma');
    const origin = originId('fixed');
    const change = { kind: 'create_block', page, parent: null, position: 0, content: 'x' } as const;

    const first = submit(graph, change, { origin });
    const second = submit(graph, change, { origin });

    assert.equal(first.status, 'applied');
    assert.equal(second.status, 'duplicate');
    if (first.status === 'applied' && second.status === 'duplicate') {
      assert.equal(second.operation.sequence, first.operation.sequence);
    }
  });

  it('is idempotent however many times the same origin arrives', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), (times) => {
        const graph = inhabitedGraph();
        const page = makePage(graph, 'Reintento');
        const origin = originId('retry');
        const change = {
          kind: 'create_block',
          page,
          parent: null,
          position: 0,
          content: 'uno',
        } as const;

        for (let n = 0; n < times; n += 1) submit(graph, change, { origin });

        assert.equal(graph.blocksOf(page).length, 1);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// @invariant TotalOrderWithinOneGraph
// ---------------------------------------------------------------------------

describe('total ordering of the change log', () => {
  it('assigns strictly increasing sequence numbers starting at one', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        const sequences = graph.operations().map((o) => o.sequence);
        assert.deepEqual(
          sequences,
          [...sequences].sort((a, b) => a - b),
          'operations must be readable in application order',
        );
        assert.equal(new Set(sequences).size, sequences.length);
        if (sequences.length > 0) {
          assert.equal(Math.min(...sequences), 1);
          assert.equal(Math.max(...sequences), graph.log().lastSequence);
        }
      }),
    );
  });

  it('gives every operation the origin id of its submission', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        for (const operation of graph.operations()) {
          assert.equal(operation.originId, operation.submission.originId);
        }
      }),
    );
  });

  it('holds every invariant of every v0 spec after any sequence of changes', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        assert.deepEqual(checkInvariants(graph), []);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// @invariant ReplayReconstructsState
// ---------------------------------------------------------------------------

describe('replay', () => {
  it('reconstructs the state that existed at a specific sequence', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Decisión temporal');
    const block = makeBlock(graph, page, 'estado:: propuesto');
    const anchor = graph.operations().at(-1)?.sequence;
    assert.notEqual(anchor, undefined);

    applied(submit(graph, { kind: 'edit_block', block, content: 'estado:: aprobado' }));

    const then = graph.replayFromLog(anchor);
    assert.equal(then.block(block)?.content, 'estado:: propuesto');
    assert.equal(graph.block(block)?.content, 'estado:: aprobado');
    assert.equal(then.operations().at(-1)?.sequence, anchor);
  });

  it('reconstructs the same pages and blocks from the log alone', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const live = runIntents(list);
        const replayed = live.replayFromLog();

        // createdAt entra en la comparación a propósito. Sin él, reproducir
        // volvía a estampar cada página con la hora del arranque y el test
        // pasaba igual: el corpus entero decía haber nacido hoy y nada lo
        // notaba, porque «el mismo grafo» se estaba comprobando sin las fechas.
        assert.deepEqual(
          replayed.allBlocks().map((b) => [b.stableId, b.content, b.page, b.createdAt]).sort(),
          live.allBlocks().map((b) => [b.stableId, b.content, b.page, b.createdAt]).sort(),
        );
        assert.deepEqual(
          replayed.pages().map((p) => [p.id, p.title, p.visibility, p.createdAt, p.originCreatedAt]).sort(),
          live.pages().map((p) => [p.id, p.title, p.visibility, p.createdAt, p.originCreatedAt]).sort(),
        );
      }),
    );
  });

  it('keeps the date the submission carried, not the date of the replay', () => {
    const escrito = Date.parse('2024-03-15T10:00:00Z');
    const live = inhabitedGraph();

    const outcome = live.submitOperation({
      originId: 'o1',
      participant: OWNER,
      change: { kind: 'create_page', title: 'Una página de 2024', visibility: 'private' },
      submittedAt: escrito,
    });
    assert.equal(outcome.status, 'applied');

    assert.equal(live.pages()[0]?.createdAt, escrito);
    assert.equal(live.replayFromLog().pages()[0]?.createdAt, escrito);
  });

  it('recovers an origin date without pretending the page was edited then', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Página importada');
    const before = graph.lastEditedAt(page);
    const origin = Date.parse('2024-03-15T00:00:00Z');

    applied(submit(graph, { kind: 'recover_page_origin', page, originCreatedAt: origin }));

    assert.equal(graph.page(page)?.originCreatedAt, origin);
    assert.equal(graph.lastEditedAt(page), before);
    assert.equal(graph.replayFromLog().page(page)?.originCreatedAt, origin);
  });
});

// ---------------------------------------------------------------------------
// Rule preconditions. These are the rule_failure obligations, 68 of them in v0;
// the ones below are the cases the workspace can actually reach.
// ---------------------------------------------------------------------------

describe('rule AcceptParticipantSubmission', () => {
  it('rejects a participant with no membership in the graph', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Cerrada');

    const outcome = submit(
      graph,
      { kind: 'create_block', page, parent: null, position: 0, content: 'x' },
      { participant: OUTSIDER },
    );

    assert.equal(outcome.status, 'rejected');
  });

  it('rejects a suspended participant', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Suspendida');
    graph.suspend(AGENT);

    const outcome = submit(
      graph,
      { kind: 'create_block', page, parent: null, position: 0, content: 'x' },
      { participant: AGENT },
    );

    assert.equal(outcome.status, 'rejected');
  });

  it('rejects authenticated voice with no origin evidence', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Voz');

    const outcome = submit(
      graph,
      { kind: 'create_block', page, parent: null, position: 0, content: 'dicho' },
      { channel: 'authenticated_voice' },
    );

    assert.equal(outcome.status, 'rejected');
  });

  it('accepts authenticated voice carrying evidence', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Voz');

    const outcome = submit(
      graph,
      { kind: 'create_block', page, parent: null, position: 0, content: 'dicho' },
      {
        channel: 'authenticated_voice',
        evidence: { reference: 'audio:sha256-abc', capturedAt: 1_754_000_000_000 },
      },
    );

    assert.equal(outcome.status, 'applied');
  });

  // @guarantee EqualMutationPath
  it('gives an agent the same write path as a human, not a privileged one', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Contrato');

    const byAgent = submit(
      graph,
      { kind: 'create_block', page, parent: null, position: 0, content: 'propuesta' },
      { participant: AGENT, channel: 'agent_generation' },
    );

    assert.equal(byAgent.status, 'applied');
    const revision = graph.revisions().at(-1);
    assert.equal(revision?.authoredBy, AGENT);
    assert.equal(revision?.channel, 'agent_generation');
  });
});

describe('rule ApplyRemoveBlock', () => {
  it('refuses to remove a block that still has children', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Arbol');
    const parent = makeBlock(graph, page, 'raiz');
    makeBlock(graph, page, 'hoja', { parent, position: 0 });

    const outcome = submit(graph, { kind: 'remove_block', block: parent });

    assert.equal(outcome.status, 'rejected');
  });

  it('removes a leaf', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Arbol');
    const leaf = makeBlock(graph, page, 'hoja');

    assert.equal(submit(graph, { kind: 'remove_block', block: leaf }).status, 'applied');
    assert.equal(graph.block(leaf), undefined);
  });

  it('leaves no block pointing at a parent that no longer exists', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        for (const block of graph.allBlocks()) {
          if (block.parent !== null) {
            assert.notEqual(graph.block(block.parent), undefined);
          }
        }
      }),
    );
  });
});

describe('rule ApplyRemovePage', () => {
  it('refuses to remove a page that still holds blocks', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Poblada');
    makeBlock(graph, page, 'contenido');

    assert.equal(submit(graph, { kind: 'remove_page', page }).status, 'rejected');
  });

  it('removes an empty page', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Vacia');

    assert.equal(submit(graph, { kind: 'remove_page', page }).status, 'applied');
    assert.equal(graph.page(page), undefined);
  });
});

describe('rule ApplyMoveBlock', () => {
  it('refuses to make a block its own parent', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Ciclo');
    const block = makeBlock(graph, page, 'x');

    const outcome = submit(graph, {
      kind: 'move_block',
      block,
      page,
      parent: block,
      position: 0,
    });

    assert.equal(outcome.status, 'rejected');
  });

  it('refuses a parent that lives on a different page', () => {
    const graph = inhabitedGraph();
    const here = makePage(graph, 'Aqui');
    const there = makePage(graph, 'Alla');
    const block = makeBlock(graph, here, 'x');
    const foreign = makeBlock(graph, there, 'y');

    const outcome = submit(graph, {
      kind: 'move_block',
      block,
      page: here,
      parent: foreign,
      position: 0,
    });

    assert.equal(outcome.status, 'rejected');
  });
});

describe('rule ApplySetProperty', () => {
  it('updates in place rather than accumulating a second assignment for one key', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Propiedades');

    submit(graph, { kind: 'set_property', page, propertyKey: 'status', propertyValue: 'draft' });
    submit(graph, { kind: 'set_property', page, propertyKey: 'status', propertyValue: 'done' });

    const held = graph.propertiesOf(page).filter((p) => p.key === 'status');
    assert.equal(held.length, 1, 'invariant PropertyKeyIsUniquePerSubject');
    assert.equal(held[0]?.value, 'done');
  });

  it('refuses a change naming both a page and a block', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Ambigua');
    const block = makeBlock(graph, page, 'x');

    const outcome = submit(graph, {
      kind: 'set_property',
      page,
      block,
      propertyKey: 'status',
      propertyValue: 'draft',
    });

    assert.equal(outcome.status, 'rejected');
  });

  it('refuses to remove a property that was never set', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Ausente');

    assert.equal(
      submit(graph, { kind: 'remove_property', page, propertyKey: 'status' }).status,
      'rejected',
    );
  });
});

// ---------------------------------------------------------------------------
// @guarantee AttributedHistory
// ---------------------------------------------------------------------------

describe('provenance', () => {
  it('attributes every applied change to a participant and a channel', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        assert.equal(graph.revisions().length, graph.operations().length);
        for (const revision of graph.revisions()) {
          assert.ok(revision.authoredBy, 'a revision without an author is unauditable');
          assert.ok(revision.channel);
          assert.notEqual(graph.participant(revision.authoredBy), undefined);
        }
      }),
    );
  });

  it('marks a revision canonical only when authenticated voice carries evidence', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Canonica');

    submit(
      graph,
      { kind: 'create_block', page, parent: null, position: 0, content: 'dicho' },
      {
        channel: 'authenticated_voice',
        evidence: { reference: 'audio:sha256-abc', capturedAt: 1_754_000_000_000 },
      },
    );

    const revision = graph.revisions().at(-1);
    assert.equal(revision?.originIsCanonical, true);
    assert.notEqual(revision?.evidence, undefined);
  });

  it('never marks a typed revision canonical', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        for (const revision of graph.revisions()) {
          if (revision.channel !== 'authenticated_voice') {
            assert.equal(revision.originIsCanonical, false);
          }
        }
      }),
    );
  });

  it('leaves no write path that bypasses the operation log', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        // Every page and block in the graph must be traceable to an operation.
        const subjects = new Set(graph.operations().map((o) => o.subjectId));
        for (const page of graph.pages()) assert.ok(subjects.has(page.id));
        for (const block of graph.allBlocks()) assert.ok(subjects.has(block.stableId));
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// identity-access.allium: only the owner administers participants
// ---------------------------------------------------------------------------

describe('participant administration', () => {
  it('preserves a removed participant on the revisions they authored', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Historia');
    submit(
      graph,
      { kind: 'create_block', page, parent: null, position: 0, content: 'aporte' },
      { participant: AGENT, channel: 'agent_generation' },
    );

    graph.suspend(AGENT);

    const authored = graph.revisions().filter((r) => r.authoredBy === AGENT);
    assert.ok(authored.length > 0, '@invariant HistoricalIdentitySurvivesRemoval');
    assert.notEqual(graph.participant(AGENT), undefined);
  });

  it('refuses to suspend the sovereign owner', () => {
    const graph = inhabitedGraph();
    assert.throws(() => graph.suspend(OWNER), /owner/i);
  });
});
