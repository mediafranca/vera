import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VeraGraph } from '@vera/core';

import { initializeStarterMemory } from '../src/starter-memory.ts';
import { listen } from '../src/server.ts';
import { readLibrarianToolCall } from '../src/librarian-tools.ts';
import {
  composeLibrarianContext,
  LibrarianContextCursorError,
  librarianContextExposure,
  librarianSelectionReceipt,
  type LibrarianContextReceipt,
} from '../src/librarian-context.ts';
import {
  compactLibrarianManifestDocument,
  compactLibrarianPromptContext,
  formativePracticeFor,
  librarianRequestDispositionFor,
  librarianContributionLineageFor,
} from '../src/librarian-runtime.ts';

const directories: string[] = [];

describe('frontera formativa de la dialéctica', () => {
  it('activa historia, conserva contradicciones atribuidas y compone as of sequence', () => {
    const graph = VeraGraph.create({ name: 'Vera temporal' });
    graph.addParticipant({ id: 'participant:owner', name: 'Dueña', kind: 'human' });
    graph.addParticipant({ id: 'participant:agent', name: 'Agente', kind: 'agent' });
    graph.admit('participant:owner'); graph.admit('participant:agent');
    const write = (originId: string, change: Parameters<typeof graph.submitOperation>[0]['change'],
      participant = 'participant:owner'): void => {
      assert.notEqual(graph.submitOperation({ originId, participant, change }).status, 'rejected');
    };
    write('page:decision', {
      kind: 'create_page', stableId: 'page:decision', title: 'Decisión', visibility: 'private',
    });
    write('block:decision', {
      kind: 'create_block', stableId: 'block:decision', page: 'page:decision', parent: null, position: 0,
      content: 'estado:: propuesto',
    });
    const anchor = graph.operations().at(-1)?.sequence ?? 0;
    write('edit:decision', {
      kind: 'edit_block', block: 'block:decision', content: 'estado:: aprobado',
    });
    const currentSequence = graph.operations().at(-1)?.sequence ?? 0;

    const now = JSON.parse(composeLibrarianContext({
      graph, participant: 'participant:agent', page: 'page:decision',
      request: '¿Qué cambió y qué se sabía antes?',
      policy: { budgetCharacters: 8_000, neighbourDepth: 0, searchLimit: 0 },
    })) as LibrarianContextReceipt;
    assert.equal(now.version, 6);
    assert.equal(now.temporal.active, true);
    assert.equal(now.temporal.mode, 'history');
    assert.deepEqual(now.temporal.history[0]?.states.map((one) => [one.content, one.participant]), [
      ['estado:: propuesto', 'participant:owner'],
      ['estado:: aprobado', 'participant:owner'],
    ]);
    assert.equal(now.temporal.contradictions[0]?.field, 'estado');
    assert.equal(now.temporal.contradictions[0]?.earlier.content, 'estado:: propuesto');
    assert.equal(now.temporal.contradictions[0]?.later.content, 'estado:: aprobado');

    const thenGraph = graph.replayFromLog(anchor);
    const then = JSON.parse(composeLibrarianContext({
      graph: thenGraph, participant: 'participant:agent', page: 'page:decision',
      request: '¿Qué se sabía entonces?', asOfSequence: anchor, currentSequence,
      policy: { budgetCharacters: 8_000, neighbourDepth: 0, searchLimit: 0 },
    })) as LibrarianContextReceipt;
    assert.equal(then.temporal.mode, 'as_of_sequence');
    assert.equal(then.temporal.effectiveSequence, anchor);
    assert.equal(then.temporal.currentSequence, currentSequence);
    assert.equal(then.blocks[0]?.content, 'estado:: propuesto');
    assert.equal(JSON.stringify(then).includes('estado:: aprobado'), false);
  });

  it('compone microcontexto de la página y macrocontexto explicable de la biblioteca', () => {
    const graph = VeraGraph.create({ name: 'Vera de prueba' });
    graph.addParticipant({ id: 'participant:herbert', name: 'Herbert', kind: 'human' });
    graph.addParticipant({ id: 'participant:lucienne', name: 'Lucienne', kind: 'agent' });
    graph.admit('participant:herbert'); graph.admit('participant:lucienne');
    const write = (originId: string, change: Parameters<typeof graph.submitOperation>[0]['change']): void => {
      const result = graph.submitOperation({ originId, participant: 'participant:herbert', change });
      assert.notEqual(result.status, 'rejected');
    };
    write('page:source', { kind: 'create_page', stableId: 'page:source', title: 'Fuente', visibility: 'private' });
    write('page:macro', { kind: 'create_page', stableId: 'page:macro', title: 'Diseño participativo', visibility: 'private' });
    write('page:search', { kind: 'create_page', stableId: 'page:search', title: 'Talleres', visibility: 'private' });
    write('block:parent', { kind: 'create_block', stableId: 'block:parent', page: 'page:source', parent: null, position: 0,
      content: 'Marco del proyecto [[Diseño participativo]]' });
    write('block:focus', { kind: 'create_block', stableId: 'block:focus', page: 'page:source', parent: 'block:parent', position: 0,
      content: 'La solicitud nace en este pasaje.' });
    write('block:sibling', { kind: 'create_block', stableId: 'block:sibling', page: 'page:source', parent: 'block:parent', position: 1,
      content: 'Este hermano aclara el microcontexto.' });
    write('block:macro', { kind: 'create_block', stableId: 'block:macro', page: 'page:macro', parent: null, position: 0,
      content: 'Los talleres conectan investigación y práctica.' });
    write('block:search', { kind: 'create_block', stableId: 'block:search', page: 'page:search', parent: null, position: 0,
      content: 'Un inventario independiente de talleres.' });
    const snapshot = composeLibrarianContext({
      graph, participant: 'participant:lucienne', page: 'page:source', focus: 'block:focus',
      request: 'Relaciona este pasaje con los talleres de diseño participativo.',
      policy: { budgetCharacters: 8_000, neighbourDepth: 1, searchLimit: 8 },
    });
    const parsed = JSON.parse(snapshot) as LibrarianContextReceipt;
    assert.equal(parsed.version, 6);
    assert.equal(parsed.focus?.id, 'block:focus');
    assert.ok(parsed.blocks.some((block) => block.id === 'block:parent'));
    assert.ok(parsed.blocks.some((block) => block.id === 'block:sibling'));
    assert.ok(parsed.library.pages.some((page) => page.id === 'page:macro' && page.reasons.some((reason) => reason.includes('vecindad'))));
    assert.ok(parsed.library.pages.some((page) => page.id === 'page:search' && page.reasons.includes('coincidencia textual con la solicitud')));
    assert.ok(parsed.library.pages.every((page) => page.score > 0 && page.signals.length > 0));
    assert.ok(parsed.library.pages.every((page) => page.score ===
      page.signals.reduce((sum, signal) => sum + signal.contribution, 0)));
    assert.ok(parsed.library.pages.some((page) =>
      page.signals.some((signal) => signal.kind === 'graph_distance')));
    assert.ok(parsed.library.pages.some((page) =>
      page.signals.some((signal) => signal.kind === 'text_relevance')));
    const graphRank = parsed.library.pages.find((page) => page.id === 'page:macro')?.score ?? 0;
    const textRank = parsed.library.pages.find((page) => page.id === 'page:search')?.score ?? 0;
    assert.ok(graphRank > textRank,
      'la relación solicitada debe sobrevivir al presupuesto antes que texto incidental');
    assert.equal(parsed.selection.budgetCharacters, 8_000);
    assert.equal(parsed.used.characters, snapshot.length);
    assert.equal(parsed.selection.usedCharacters, snapshot.length);
    assert.ok(parsed.items.every((item) => parsed.within.includes(item.kind === 'block' ? item.page : item.id)));
    assert.ok(parsed.relations.every((relation) =>
      parsed.within.includes(relation.source) && parsed.within.includes(relation.target)));
    assert.ok(parsed.relations.every((relation) =>
      relation.block !== '' && relation.phrase !== '' && relation.revision !== null));
    assert.ok(parsed.items.every((item) => item.revision !== null && item.authoredBy !== null));
    assert.ok(parsed.items.every((item) => item.found_by.length > 0));
    const exposure = librarianContextExposure(snapshot);
    assert.equal(exposure.volume, parsed.used.characters);
    assert.equal(exposure.delivered.length, parsed.used.identities);
    assert.equal(composeLibrarianContext({
      graph, participant: 'participant:lucienne', page: 'page:source', focus: 'block:focus',
      request: 'Relaciona este pasaje con los talleres de diseño participativo.',
      policy: { budgetCharacters: 8_000, neighbourDepth: 1, searchLimit: 8 },
    }), snapshot, 'la misma consulta sobre la misma revisión debe producir el mismo recibo');
    const selection = librarianSelectionReceipt(snapshot);
    assert.deepEqual(selection.authorizedUniverse, parsed.within);
    assert.equal(selection.source.page, parsed.page.id);
    assert.equal(selection.source.focus, parsed.focus?.id);
    assert.equal(selection.cost.characters, parsed.used.characters);
    assert.equal(selection.cost.budgetCharacters, parsed.selection.budgetCharacters);
    assert.deepEqual(selection.selections.map((one) => one.id), parsed.items.map((one) => one.id));
    assert.ok(selection.selections.every((one) => one.revision !== null && one.reasons.length > 0));
    const legacy = librarianSelectionReceipt(JSON.stringify({
      page: { id: 'page:legacy', title: 'Página heredada', revision: 'op:1' },
      focus: { id: 'block:legacy' }, blocks: [{ id: 'block:legacy', content: 'texto' }],
    }));
    assert.equal(legacy.available, false);
    assert.equal(legacy.source.page, 'page:legacy');
    assert.match(legacy.warnings[0] ?? '', /anterior al recibo justificable v6/);
    for (const item of parsed.items.filter((one) => one.kind === 'page')) {
      for (const excerpt of item.excerpts.filter((one) => one.block !== null)) {
        const current = graph.block(excerpt.block!);
        assert.equal(excerpt.content, current?.content,
          'la evidencia textual debe conservar entero el bloque cuya revisión cita');
      }
    }
  });

  it('compone dos saltos autorizados con allowlist, grado y camino verificable', () => {
    const graph = VeraGraph.create({ name: 'Vera relacional' });
    graph.addParticipant({ id: 'participant:owner', name: 'Dueña', kind: 'human' });
    graph.addParticipant({ id: 'participant:agent', name: 'Agente', kind: 'agent' });
    graph.admit('participant:owner'); graph.admit('participant:agent');
    const write = (originId: string, change: Parameters<typeof graph.submitOperation>[0]['change']): void => {
      assert.notEqual(graph.submitOperation({ originId, participant: 'participant:owner', change }).status, 'rejected');
    };
    for (const [id, title] of [
      ['page:source', 'Fuente'], ['page:middle', 'Puente'], ['page:target', 'Destino'], ['page:hidden', 'Oculta'],
    ] as const) write(id, { kind: 'create_page', stableId: id, title, visibility: 'private' });
    write('crossing:source-hidden', {
      kind: 'create_crossing', stableId: 'crossing:source-hidden',
      fromPage: 'page:source', toPage: 'page:hidden', term: 'respalda', content: 'La fuente respalda el secreto.',
    });
    write('crossing:source-middle', {
      kind: 'create_crossing', stableId: 'crossing:source-middle',
      fromPage: 'page:source', toPage: 'page:middle', term: 'respalda', content: 'La fuente respalda el puente.',
    });
    write('crossing:middle-target', {
      kind: 'create_crossing', stableId: 'crossing:middle-target',
      fromPage: 'page:middle', toPage: 'page:target', term: 'respalda', content: 'El puente respalda el destino.',
    });

    const snapshot = composeLibrarianContext({
      graph, participant: 'participant:agent', page: 'page:source', request: '¿Qué respalda esta fuente?',
      policy: {
        budgetCharacters: 12_000, neighbourDepth: 2, searchLimit: 0,
        allowedRelations: ['respalda'], maxDegree: 1,
      },
      canRead: (page) => page !== 'page:hidden',
    });
    const receipt = JSON.parse(snapshot) as LibrarianContextReceipt;
    const target = receipt.items.find((item) => item.kind === 'page' && item.id === 'page:target');

    assert.equal(target?.kind, 'page');
    assert.equal(target?.kind === 'page' ? target.path.length : 0, 2);
    assert.ok(receipt.relations.every((relation) =>
      relation.relation === 'respalda' && relation.block !== '' &&
      relation.phrase !== '' && relation.revision !== null));
    assert.ok(!snapshot.includes('page:hidden'));
    assert.deepEqual(receipt.selection.allowedRelations, ['respalda']);
    assert.equal(receipt.selection.maxDegree, 1);
    assert.equal(receipt.omitted.degreeEdges, 0,
      'la relación oculta se autoriza fuera antes de consumir el grado');
    assert.ok(receipt.relations.every((relation) =>
      librarianContextExposure(snapshot).delivered.includes(relation.block)));
  });

  it('excluye antes de componer y hace visibles presupuesto, omisiones y continuación', () => {
    const graph = VeraGraph.create({ name: 'Vera cercada' });
    graph.addParticipant({ id: 'participant:owner', name: 'Dueña', kind: 'human' });
    graph.addParticipant({ id: 'participant:agent', name: 'Agente', kind: 'agent' });
    graph.admit('participant:owner'); graph.admit('participant:agent');
    const write = (originId: string, change: Parameters<typeof graph.submitOperation>[0]['change']): void => {
      assert.notEqual(graph.submitOperation({ originId, participant: 'participant:owner', change }).status, 'rejected');
    };
    write('page:allowed', { kind: 'create_page', stableId: 'page:allowed', title: 'Permitida', visibility: 'private' });
    write('page:hidden', { kind: 'create_page', stableId: 'page:hidden', title: 'Oculta', visibility: 'private' });
    for (let index = 0; index < 24; index += 1) write('block:allowed:' + index, {
      kind: 'create_block', stableId: 'block:allowed:' + index, page: 'page:allowed', parent: null, position: index,
      content: 'Pasaje permitido ' + index + ' '.repeat(160),
    });
    write('block:hidden', { kind: 'create_block', stableId: 'block:hidden', page: 'page:hidden', parent: null, position: 0,
      content: 'Secreto territorial enlazado desde [[Permitida]].' });
    const snapshot = composeLibrarianContext({
      graph, participant: 'participant:agent', page: 'page:allowed', request: 'secreto territorial',
      policy: { budgetCharacters: 8_000, neighbourDepth: 1, searchLimit: 8 },
      canRead: (page) => page === 'page:allowed',
    });
    const receipt = JSON.parse(snapshot) as LibrarianContextReceipt;
    assert.ok(snapshot.length <= 8_000);
    assert.deepEqual(receipt.within, ['page:allowed']);
    assert.ok(!snapshot.includes('page:hidden'));
    assert.ok(receipt.omitted.pageBlocks > 0);
    assert.ok(receipt.warnings.length > 0);
    assert.notEqual(receipt.continuation, null);
  });

  it('reanuda unidades completas sin duplicar ni omitir y rechaza el cursor cuando cambia la fuente', () => {
    const graph = VeraGraph.create({ name: 'Vera paginada' });
    graph.addParticipant({ id: 'participant:owner', name: 'Dueña', kind: 'human' });
    graph.addParticipant({ id: 'participant:agent', name: 'Agente', kind: 'agent' });
    graph.admit('participant:owner'); graph.admit('participant:agent');
    const write = (originId: string, change: Parameters<typeof graph.submitOperation>[0]['change']): void => {
      assert.notEqual(graph.submitOperation({ originId, participant: 'participant:owner', change }).status, 'rejected');
    };
    write('page:long', { kind: 'create_page', stableId: 'page:long', title: 'Página extensa', visibility: 'private' });
    const originals = new Map<string, string>();
    for (let index = 0; index < 7; index += 1) {
      const id = `block:long:${index}`;
      const content = `INICIO ${index} ` + String(index).repeat(2_100) + ` FIN ${index}`;
      originals.set(id, content);
      write(id, {
        kind: 'create_block', stableId: id, page: 'page:long', parent: null, position: index, content,
      });
    }
    const policy = { budgetCharacters: 4_000, neighbourDepth: 0, searchLimit: 0 };
    const receipts: LibrarianContextReceipt[] = [];
    let cursor: string | null = null;
    do {
      const receipt = JSON.parse(composeLibrarianContext({
        graph, participant: 'participant:agent', page: 'page:long', request: 'Lee la página completa.',
        policy, ...(cursor === null ? {} : { cursor }),
      })) as LibrarianContextReceipt;
      receipts.push(receipt);
      cursor = receipt.continuation?.cursor ?? null;
      assert.ok(receipts.length < 12, 'la continuación debe avanzar');
    } while (cursor !== null);

    const delivered = receipts.flatMap((receipt) =>
      receipt.items.filter((item) => item.kind === 'block').map((item) => item.id));
    assert.equal(new Set(delivered).size, delivered.length, 'ningún bloque se repite');
    assert.deepEqual(new Set(delivered), new Set(originals.keys()), 'ningún bloque se omite');
    for (const receipt of receipts) {
      for (const item of receipt.items.filter((one) => one.kind === 'block')) {
        assert.equal(item.content, originals.get(item.id), 'cada bloque viaja completo');
      }
    }
    assert.ok(receipts.some((receipt) =>
      receipt.warnings.some((warning) => warning.includes('no fue recortada'))));
    assert.ok(receipts.slice(0, -1).every((receipt) => receipt.continuation !== null));
    assert.equal(receipts.at(-1)?.continuation, null);

    const first = receipts[0]!;
    const staleCursor = first.continuation?.cursor;
    assert.ok(staleCursor);
    write('edit:long:0', { kind: 'edit_block', block: 'block:long:0', content: 'La fuente cambió.' });
    assert.throws(() => composeLibrarianContext({
      graph, participant: 'participant:agent', page: 'page:long', request: 'Lee la página completa.',
      policy, cursor: staleCursor,
    }), (error) => error instanceof LibrarianContextCursorError && error.code === 'stale_context_cursor');
  });

  it('distingue mediación, derivación, coautoría y juicio propio antes de escribir', () => {
    const request = (text: string, modality: 'audio' | 'page' = 'page') => ({
      id: 'agent-request:1', askedBy: 'participant:herbert', text, modality,
      recordingId: modality === 'audio' ? 'recording:1' : null,
      sourceBlockId: null,
    }) as Parameters<typeof librarianContributionLineageFor>[0];
    assert.equal(librarianContributionLineageFor(request('Ordena este audio en puntos', 'audio')).relation, 'derived');
    assert.equal(librarianContributionLineageFor(request('Redacta una carta en mi nombre')).relation, 'mediated');
    assert.equal(librarianContributionLineageFor(request('Escribamos juntos esta sección')).relation, 'coauthored');
    assert.deepEqual(librarianContributionLineageFor(request('Investiga el origen y juzga la evidencia')), {
      relation: 'direct', sourceKind: 'conversation', sourceReference: 'agent-request:1',
    });
    const pageRequest = { ...request('Resume esto'), sourcePageId: 'page:contexto' };
    assert.deepEqual(librarianContributionLineageFor(pageRequest, 'derived'), {
      relation: 'derived', relatedParticipant: 'participant:herbert',
      sourceKind: 'page', sourceReference: 'page:contexto',
    });
    assert.deepEqual(librarianContributionLineageFor(pageRequest, 'coauthored'), {
      relation: 'coauthored', relatedParticipant: 'participant:herbert',
      sourceKind: 'page', sourceReference: 'page:contexto',
    });
  });
  it('reconoce las seis prácticas y deja fluidas las tareas operativas', () => {
    assert.equal(formativePracticeFor('Lee este texto por mí.'), 'reading');
    assert.equal(formativePracticeFor('Elige los pasajes más importantes.'), 'selection');
    assert.equal(formativePracticeFor('Interpreta este argumento.'), 'interpretation');
    assert.equal(formativePracticeFor('Compara estas dos posiciones.'), 'comparison');
    assert.equal(formativePracticeFor('Hazme una síntesis completa.'), 'synthesis');
    assert.equal(formativePracticeFor('Saca una conclusión.'), 'conclusion');
    assert.equal(formativePracticeFor('Ordena alfabéticamente estas referencias.'), null);
  });

  it('reconoce una primera posición explícita y permite contrastarla directamente', () => {
    assert.equal(formativePracticeFor('Mi lectura es que la soberanía exige límites; contrástala.'), null);
    assert.equal(formativePracticeFor('Creo que el texto concluye otra cosa. Compara mi hipótesis con el corpus.'), null);
  });

  it('sirve directamente una fuente identificable, una tarea mixta y una insistencia', () => {
    const source = 'Busca la fuente de “Remember, remember the fifth of November” y completa la referencia.';
    assert.deepEqual(librarianRequestDispositionFor(source), { mode: 'answer', reason: 'contribution' });
    assert.equal(formativePracticeFor(source), null);
    assert.deepEqual(librarianRequestDispositionFor('Busca las fuentes y sintetiza sus fechas.'),
      { mode: 'answer', reason: 'mixed' });
    assert.deepEqual(librarianRequestDispositionFor('Esta vez necesito que sintetices directamente.'),
      { mode: 'answer', reason: 'explicit_direct' });
    assert.deepEqual(librarianRequestDispositionFor(
      'Quiero que en la Bitácora de hoy me expliques todas las páginas de PICTOS en el contexto de mi doctorado y de los talleres de diseño participativo; sintetiza los proyectos y tareas y propón su reordenamiento y etiquetado.'),
    { mode: 'answer', reason: 'mixed' });
  });

  it('reconoce una llamada de herramienta aunque el modelo la cerque como JSON', () => {
    assert.deepEqual(readLibrarianToolCall('```json\n{"tool":"read_page","arguments":{"page":"PICTOS"}}\n```'), {
      name: 'read_page', arguments: { page: 'PICTOS' },
    });
  });

  it('acota una página grande sin perder el bloque pertinente ni mutilar el recibo', () => {
    const snapshot = JSON.stringify({
      page: { id: 'page:markdown', title: 'Markdown' },
      focus: null,
      blocks: Array.from({ length: 80 }, (_, index) => ({
        id: `block:${index}`, parent: null, position: index,
        content: index === 79 ? 'La grafía e[ad] necesita tratamiento sintáctico.' : `Contenido de relleno ${index} `.repeat(30),
      })),
    });
    const compacted = compactLibrarianPromptContext(snapshot,
      '¿cómo resolvemos el problema de sintaxis al escribir e[ad] en Markdown?', 4_000);
    assert.ok(compacted.length <= 4_000);
    assert.match(compacted, /e\[ad\]/);
    assert.equal(JSON.parse(compacted).compacted, true);
    assert.ok(JSON.parse(compacted).omittedBlocks > 0);
    assert.match(snapshot, /block:79/);
  });

  it('acota un manifiesto grande conservando identidad, gobierno y reglas pertinentes', () => {
    const manifest = {
      schemaVersion: 1 as const, source: 'vera' as const, graph: 'graph:1',
      agent: { id: 'participant:lucienne', name: 'Lucienne', human: { id: 'participant:herbert', name: 'Herbert' } },
      generatedAt: 1,
      constitution: [{
        page: 'page:lucienne', title: 'Lucienne', role: 'identity' as const, revision: 'op:1', properties: [],
        blocks: [
          { id: 'principle', parent: null, position: 0, content: '**Servicio directo.** Resuelve búsquedas y problemas de Markdown.' },
          ...Array.from({ length: 70 }, (_, index) => ({
            id: `filler:${index}`, parent: null, position: index + 1, content: `Relleno constitucional ${index} `.repeat(30),
          })),
        ],
      }],
      guarantees: { secrets: 'references-only' as const, authority: 'human-principal' as const,
        history: 'append-only-manifests' as const, writing: { representation: 'ordered-stable-block-tree' as const,
          mutation: 'minimal-block-operations' as const, foreignWords: 'proposal' as const, flattening: 'rejected' as const } },
    };
    const compacted = compactLibrarianManifestDocument(manifest, '¿Cómo escribir e[ad] en Markdown?', 4_000);
    assert.ok(compacted.length <= 4_000);
    const parsed = JSON.parse(compacted) as { agent: { name: string }; compacted: boolean; omittedBlocks: number;
      guarantees: { authority: string }; constitution: Array<{ blocks: Array<{ id: string }> }> };
    assert.equal(parsed.agent.name, 'Lucienne');
    assert.equal(parsed.guarantees.authority, 'human-principal');
    assert.equal(parsed.compacted, true);
    assert.ok(parsed.omittedBlocks > 0);
    assert.ok(parsed.constitution[0]!.blocks.some((block) => block.id === 'principle'));
  });
});

afterEach(() => {
  delete process.env['VERA_TEST_LIBRARIAN_KEY'];
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('runtime embebido de la bibliotecaria', () => {
  it('se constituye, responde una solicitud y ejecuta una ronda con recibos', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vera-librarian-runtime-'));
    directories.push(directory);
    const databasePath = join(directory, 'vera.sqlite');
    const owner = { id: 'participant:owner-runtime', name: 'Dueña' };
    initializeStarterMemory({ databasePath, owner, libraryName: 'Biblioteca de prueba', ownerLibrarianName: 'Lucienne' });

    let inferenceCalls = 0;
    let inferencePrompt = '';
    const inference = createHttpServer(async (request, response) => {
      assert.equal(request.url, '/v1/responses');
      assert.equal(request.headers.authorization, 'Bearer test-secret');
      for await (const chunk of request) inferencePrompt += chunk.toString();
      inferenceCalls += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ output_text: 'Respuesta de Aster.' }));
    });
    await new Promise<void>((resolve) => inference.listen(4399, '127.0.0.1', resolve));
    process.env['VERA_TEST_LIBRARIAN_KEY'] = 'test-secret';
    const running = listen({ port: 4398, databasePath });
    const base = 'http://127.0.0.1:4398';
    const call = async (path: string, options: { method?: string; body?: unknown; secret?: string } = {}) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.secret !== undefined) headers['authorization'] = `Bearer ${options.secret}`;
      const response = await fetch(`${base}${path}`, {
        method: options.method ?? 'GET', headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return { status: response.status, json: await response.json() as Record<string, unknown> };
    };
    try {
      const constituted = await call('/librarian/runtime/constitute', { method: 'POST', body: { name: 'Lucienne' } });
      assert.equal(constituted.status, 201, JSON.stringify(constituted.json));
      const librarian = constituted.json['librarian'] as Record<string, string>;
      assert.equal(librarian.name, 'Lucienne');
      const librarianAgent = librarian.agent;
      assert.ok(librarianAgent);

      const renamed = await call(`/participants/${encodeURIComponent(librarianAgent)}`, {
        method: 'PATCH', body: { name: 'Aster' },
      });
      assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
      const renamedRuntime = await call('/librarian/runtime');
      assert.equal((renamedRuntime.json['librarian'] as Record<string, string>).name, 'Aster');
      assert.equal((renamedRuntime.json['librarian'] as Record<string, string>).agent, librarianAgent);
      const renamedHealth = await call('/health');
      assert.deepEqual(renamedHealth.json['librarian'], { id: librarianAgent, name: 'Aster' });
      const renamedConversation = await call('/librarian/conversation');
      assert.equal((renamedConversation.json['agent'] as Record<string, string>).name, 'Aster');

      const configured = await call('/librarian/runtime', {
        method: 'PUT', body: {
          enabled: true,
          model: 'openai:test-model',
          endpoint: 'http://127.0.0.1:4399/v1',
          secretReference: 'VERA_TEST_LIBRARIAN_KEY',
          permissions: ['read_request_context', 'reply', 'daily_round'],
          routine: { enabled: false, hour: 9, timezone: 'local' },
        },
      });
      assert.equal(configured.status, 200, JSON.stringify(configured.json));
      assert.equal(configured.json['status'], 'ready');
      assert.equal((configured.json['harness'] as any).version, 'vera-librarian-harness:5');
      assert.deepEqual((configured.json['harness'] as any).capabilities.map((one: any) => one.name), [
        'search_memory', 'survey_topic', 'read_page', 'query_graph', 'inspect_relations',
        'inspect_ontology', 'inspect_page_schema', 'check_invariants', 'reply_to_request',
        'propose_edit', 'propose_page_properties', 'apply_approved_edit',
      ]);

      const made = await call('/operations', { method: 'POST', body: {
        originId: 'runtime-test:page', participant: owner.id,
        change: { kind: 'create_page', title: 'Consulta a Aster', visibility: 'private' },
      } });
      assert.equal(made.status, 201, JSON.stringify(made.json));
      const page = made.json['subjectId'] as string;
      const requested = await call('/librarian/requests', {
        method: 'POST', body: { pageId: page, text: '¿Qué ves aquí?' },
      });
      assert.equal(requested.status, 201, JSON.stringify(requested.json));
      const requestId = requested.json['id'] as string;

      let answered: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await call(`/librarian/requests/${encodeURIComponent(requestId)}`);
        if (current.json['status'] === 'answered') { answered = current.json; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(answered, 'Aster no respondió la solicitud');
      assert.equal((answered['reply'] as Record<string, unknown>)['answeredBy'], librarianAgent);
      assert.ok((answered['events'] as Array<Record<string, string>>)
        .some((event) => event.text === 'Aster leyó la solicitud'));
      assert.match(inferencePrompt, /Eres Aster, agente de biblioteca residente de esta Vera/);
      const pageView = await call(`/pages/${encodeURIComponent(page)}`);
      assert.match(JSON.stringify(pageView.json), /Respuesta de Aster/);
      const exposures = await call(`/exposures?participant=${encodeURIComponent(librarianAgent)}`);
      const contextExposure = (exposures.json['exposures'] as Array<Record<string, unknown>>)
        .find((one) => one['surface'] === 'resident-librarian/context' && one['subject'] === requestId);
      assert.ok(contextExposure, 'la inferencia no dejó exposición de su recibo de contexto');
      assert.equal(contextExposure['volume'], String(answered['contextSnapshot']).length);
      assert.equal(contextExposure['deliveredCount'],
        librarianContextExposure(String(answered['contextSnapshot'])).delivered.length);
      const visibleReceipt = answered['contextReceipt'] as Record<string, unknown>;
      assert.equal((visibleReceipt['source'] as Record<string, unknown>)['page'], page);
      assert.equal((visibleReceipt['cost'] as Record<string, unknown>)['characters'],
        String(answered['contextSnapshot']).length);
      const conversationReceipt = ((await call('/librarian/conversation')).json['turns'] as Array<Record<string, unknown>>)
        .find((turn) => turn['id'] === requestId)?.['contextReceipt'];
      assert.deepEqual(conversationReceipt, visibleReceipt,
        'la conversación debe conservar el mismo recibo que recibió el worker');

      const routine = await call('/librarian/runtime/routine', { method: 'POST' });
      assert.equal(routine.status, 202, JSON.stringify(routine.json));
      let finalView: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await call('/librarian/runtime');
        const runs = current.json['runs'] as Array<Record<string, unknown>>;
        if (runs.some((run) => run.kind === 'routine' && run.status === 'completed')) {
          finalView = current.json; break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(finalView, 'la ronda no dejó recibo completo');
      const runs = finalView['runs'] as Array<Record<string, unknown>>;
      assert.ok(runs.some((run) => run.kind === 'request' && run.status === 'completed'));
      assert.ok(runs.some((run) => run.kind === 'routine' && run.output === 'SIN_NOVEDAD'));
      assert.equal(inferenceCalls, 1, 'una ronda sin evidencia no consulta al modelo ni le permite inventarla');

      const priorConversation = await call('/librarian/conversation');
      const priorConversationId = (priorConversation.json['conversation'] as Record<string, string>).id;
      assert.ok(priorConversationId);
      const admitted = await call('/agents', { method: 'POST', body: {
        id: 'participant:successor-runtime', name: 'Archivista', principal: owner.id,
      } });
      assert.equal(admitted.status, 201, JSON.stringify(admitted.json));
      const chosen = await call('/agents/participant%3Asuccessor-runtime/constitution', {
        method: 'PUT', body: { sources: [{ page, role: 'identity' }] },
      });
      assert.equal(chosen.status, 200, JSON.stringify(chosen.json));
      const built = await call('/agents/participant%3Asuccessor-runtime/manifests', { method: 'POST' });
      assert.equal(built.status, 201, JSON.stringify(built.json));
      const successorManifest = (built.json['manifest'] as Record<string, string>).id;
      assert.ok(successorManifest);
      const activated = await call(`/agents/participant%3Asuccessor-runtime/manifests/${encodeURIComponent(successorManifest)}/activate`, { method: 'POST' });
      assert.equal(activated.status, 200, JSON.stringify(activated.json));

      const eligible = await call('/librarian/runtime');
      assert.deepEqual(eligible.json['eligible'], [{ agent: 'participant:successor-runtime', name: 'Archivista' }]);
      const outsider = await call('/participants', {
        method: 'POST', body: { name: 'Otra persona', kind: 'human' },
      });
      assert.equal(outsider.status, 201, JSON.stringify(outsider.json));
      const outsiderId = (outsider.json['participant'] as Record<string, string>).id;
      assert.ok(outsiderId);
      const outsiderAgent = await call('/agents', { method: 'POST', body: {
        id: 'participant:outsider-agent', name: 'Agente ajeno', principal: outsiderId,
      } });
      assert.equal(outsiderAgent.status, 201, JSON.stringify(outsiderAgent.json));
      const credential = await call('/agents/credentials', {
        method: 'POST', body: { participant: 'participant:outsider-agent', scopes: ['read', 'write'], label: 'agente ajeno' },
      });
      assert.equal(credential.status, 201, JSON.stringify(credential.json));
      const outsiderSecret = credential.json['secret'] as string | undefined;
      assert.ok(outsiderSecret);
      const forbidden = await call('/librarian/runtime/designate', {
        method: 'POST', secret: outsiderSecret, body: { agent: 'participant:successor-runtime' },
      });
      assert.equal(forbidden.status, 403);
      const designated = await call('/librarian/runtime/designate', {
        method: 'POST', body: { agent: 'participant:successor-runtime' },
      });
      assert.equal(designated.status, 200, JSON.stringify(designated.json));
      assert.equal((designated.json['librarian'] as Record<string, string>).name, 'Archivista');
      assert.equal((designated.json['configuration'] as Record<string, unknown>)['model'], 'openai:test-model');
      assert.equal(designated.json['territory'], null, 'designar no concede el territorio del ocupante anterior');
      assert.deepEqual((designated.json['history'] as Array<Record<string, unknown>>).map((entry) => entry.status),
        ['active', 'replaced']);
      assert.ok((designated.json['runs'] as Array<Record<string, any>>)
        .every((run) => run.agent.id === librarianAgent), 'las ejecuciones anteriores conservan su agente');
      const successorConversation = await call('/librarian/conversation');
      assert.equal(successorConversation.json['conversation'], null, 'el sucesor comienza una conversación propia');
      const inheritedConversation = await call(`/librarian/conversation?id=${encodeURIComponent(priorConversationId)}`);
      assert.equal(inheritedConversation.status, 404, 'la conversación anterior no se transfiere al sucesor');

      const withoutManifest = await call('/agents', { method: 'POST', body: {
        id: 'participant:unconstituted-successor', name: 'Sin manifiesto', principal: owner.id,
      } });
      assert.equal(withoutManifest.status, 201, JSON.stringify(withoutManifest.json));
      const refused = await call('/librarian/runtime/designate', {
        method: 'POST', body: { agent: 'participant:unconstituted-successor' },
      });
      assert.equal(refused.status, 409);
      assert.match(String(refused.json['error']), /manifiesto activo/);

      const granted = await call('/territories/participant%3Asuccessor-runtime', {
        method: 'PUT', body: { mode: 'all', includeGeneral: true, rules: [] },
      });
      assert.equal(granted.status, 200, JSON.stringify(granted.json));
      const formative = await call('/librarian/requests', {
        method: 'POST', body: { pageId: page, text: 'Hazme una síntesis completa.' },
      });
      assert.equal(formative.status, 201, JSON.stringify(formative.json));
      let challenged = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await call(`/librarian/requests/${encodeURIComponent(String(formative.json['id']))}`);
        if (current.json['status'] === 'answered') { challenged = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(challenged, true, 'el umbral formativo no llegó a abrirse');
      const busy = await call('/librarian/runtime/designate', {
        method: 'POST', body: { agent: librarianAgent },
      });
      assert.equal(busy.status, 409);
      assert.match(String(busy.json['error']), /trabajo abierto/);
    } finally {
      await running.close();
      await new Promise<void>((resolve, reject) => inference.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it('usa una herramienta de lectura, observa su resultado y recién entonces responde', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vera-librarian-tools-'));
    directories.push(directory);
    const databasePath = join(directory, 'vera.sqlite');
    const owner = { id: 'participant:tool-owner', name: 'Dueña' };
    initializeStarterMemory({ databasePath, owner, ownerLibrarianName: 'Lucienne' });
    const prompts: string[] = [];
    const inference = createHttpServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      prompts.push(body);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ output_text: prompts.length === 1
        ? '```json\n{"tool":"search_memory","arguments":{"query":"aguja bibliográfica"}}\n```'
        : 'Encontré la aguja bibliográfica en la página consultada.' }));
    });
    await new Promise<void>((resolve) => inference.listen(4394, '127.0.0.1', resolve));
    process.env['VERA_TEST_LIBRARIAN_KEY'] = 'test-secret';
    const running = listen({ port: 4393, databasePath });
    const call = async (path: string, options: { method?: string; body?: unknown } = {}) => {
      const response = await fetch(`http://127.0.0.1:4393${path}`, {
        method: options.method ?? 'GET', headers: { 'content-type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return { status: response.status, json: await response.json() as Record<string, any> };
    };
    try {
      await call('/librarian/runtime/constitute', { method: 'POST', body: {} });
      await call('/librarian/runtime', { method: 'PUT', body: {
        enabled: true, model: 'openai:test', endpoint: 'http://127.0.0.1:4394/v1',
        secretReference: 'VERA_TEST_LIBRARIAN_KEY', permissions: ['read_request_context', 'reply'],
        routine: { enabled: false, hour: 9, timezone: 'local' },
      } });
      const made = await call('/operations', { method: 'POST', body: {
        originId: 'tool-test:page', change: { kind: 'create_page', title: 'Aguja', visibility: 'private' },
      } });
      const page = made.json.subjectId as string;
      await call('/operations', { method: 'POST', body: {
        originId: 'tool-test:block', change: { kind: 'create_block', page, parent: null, position: 0,
          content: 'Aquí está la aguja bibliográfica.' },
      } });
      const requested = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, text: 'Busca la aguja bibliográfica y dime si existe.',
      } });
      let answered: Record<string, any> | null = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await call(`/librarian/requests/${encodeURIComponent(requested.json.id)}`);
        if (current.json.status === 'answered') { answered = current.json; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(answered, 'Lucienne no cerró el turno después de usar la herramienta');
      assert.equal(prompts.length, 2);
      assert.match(prompts[1] ?? '', /Observación:.*Aguja/s);
      assert.ok(answered.events.some((one: any) => one.kind === 'tool' && /search_memory/.test(one.text)));
      assert.match(answered.reply.text, /Encontré la aguja bibliográfica/);
    } finally {
      await running.close();
      await new Promise<void>((resolve, reject) => inference.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it('investiga PICTOS antes de responder y escribe en su propia bitácora diaria', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vera-librarian-pictos-'));
    directories.push(directory);
    const databasePath = join(directory, 'vera.sqlite');
    const owner = { id: 'participant:pictos-owner', name: 'Herbert' };
    initializeStarterMemory({ databasePath, owner, ownerLibrarianName: 'Lucienne' });
    const prompts: string[] = [];
    const inference = createHttpServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      prompts.push(body);
      response.writeHead(200, { 'content-type': 'application/json' });
      const outputs = [
        'No se encuentran páginas de PICTOS ni datos de los talleres.',
        'No hay evidencia de páginas PICTOS vinculadas con el doctorado.',
        '```json\n{"tool":"propose_page_properties","arguments":{"page":"PICTOS","properties":{"concepto":"[[PICTOS]]"},"purpose":"normalizar la referencia temática"}}\n```',
        'Preparé una propuesta revisable para normalizar el concepto de PICTOS.',
      ];
      response.end(JSON.stringify({ output_text: outputs[prompts.length - 1] ?? 'Respuesta inesperada.' }));
    });
    await new Promise<void>((resolve) => inference.listen(4388, '127.0.0.1', resolve));
    process.env['VERA_TEST_LIBRARIAN_KEY'] = 'test-secret';
    const running = listen({ port: 4387, databasePath });
    const call = async (path: string, options: { method?: string; body?: unknown } = {}) => {
      const response = await fetch(`http://127.0.0.1:4387${path}`, {
        method: options.method ?? 'GET', headers: { 'content-type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return { status: response.status, json: await response.json() as Record<string, any> };
    };
    const createPage = async (originId: string, title: string, content: string): Promise<string> => {
      const made = await call('/operations', { method: 'POST', body: {
        originId: `${originId}:page`, change: { kind: 'create_page', title, visibility: 'private' },
      } });
      const page = made.json.subjectId as string;
      await call('/operations', { method: 'POST', body: {
        originId: `${originId}:block`, change: { kind: 'create_block', page, parent: null, position: 0, content },
      } });
      return page;
    };
    try {
      await call('/librarian/runtime/constitute', { method: 'POST', body: {} });
      await call('/librarian/runtime', { method: 'PUT', body: {
        enabled: true, model: 'openai:test', endpoint: 'http://127.0.0.1:4388/v1',
        secretReference: 'VERA_TEST_LIBRARIAN_KEY', permissions: ['read_request_context', 'reply'],
        dialectic: { enabled: true }, routine: { enabled: false, hour: 9, timezone: 'local' },
      } });
      const source = await createPage('pictos-test:source', 'Consulta PICTOS', 'Prueba del oficio bibliotecario.');
      const pictos = await createPage('pictos-test:main', 'PICTOS', 'Proyecto de pictogramas y participación.');
      await createPage('pictos-test:workshops', 'PICTOS — Talleres participativos',
        'Convocatoria de participantes, guion de taller, materiales y coordinación logística.');
      await createPage('pictos-test:thesis', 'PICTOS y doctorado',
        'El proyecto PICTOS forma parte del doctorado y produce tareas y jornadas de diseño participativo.');
      const requested = await call('/librarian/requests', { method: 'POST', body: {
        pageId: source,
        text: 'Quiero que en la Bitácora de hoy me expliques todas las páginas de PICTOS en el contexto de mi doctorado y, en específico, de los talleres de diseño participativo. Los proyectos y tareas derivados y me hagas una síntesis, así como una propuesta de reordenamiento y etiquetado de las páginas.',
      } });
      let answered: Record<string, any> | null = null;
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const current = await call(`/librarian/requests/${encodeURIComponent(requested.json.id)}`);
        if (current.json.status === 'answered') { answered = current.json; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(answered, 'Lucienne no resolvió el encargo PICTOS');
      assert.equal(prompts.length, 2, 'la falsa ausencia debe forzar una respuesta corregida');
      assert.match(prompts[0] ?? '', /PICTOS — Talleres participativos/);
      assert.doesNotMatch(answered.reply.text, /No se encuentran|No hay evidencia/);
      assert.match(answered.reply.text, /Síntesis del levantamiento/);
      assert.ok(answered.events.some((one: any) => one.kind === 'tool' && /survey_topic/.test(one.text)));
      assert.match(prompts[0] ?? '', /inspect_ontology: Leer la ontología y gramática vigentes/);
      const daily = running.vera.graph.pages().find((page) =>
        running.vera.graph.blocksOf(page.id).some((block) => block.content === '**Bitácora de Lucienne:**'));
      assert.ok(daily, 'Lucienne no creó su apartado diario');
      assert.ok(running.vera.graph.propertiesOf(daily.id)
        .some((property) => property.key === 'tipo' && property.value === 'bitácora'));
      const root = running.vera.graph.blocksOf(daily.id)
        .find((block) => block.content === '**Bitácora de Lucienne:**')!;
      const inscription = running.vera.graph.blocksOf(daily.id)
        .find((block) => block.parent === root.stableId && /Síntesis del levantamiento/.test(block.content));
      assert.ok(inscription);
      assert.ok(running.vera.graph.blocksOf(daily.id)
        .some((block) => block.parent === inscription.stableId), 'la síntesis volvió a quedar como un bloque único');
      assert.ok(running.vera.graph.blocksOf(daily.id)
        .filter((block) => block.stableId.startsWith('block:librarian-output:'))
        .every((block) => !/\n\s*(?:#{1,6}\s|[-+*]\s|\d+[.)]\s)/m.test(block.content)),
      'un bloque de la inscripción escondió nuevamente un outline Markdown');

      const proposalRequest = await call('/librarian/requests', { method: 'POST', body: {
        pageId: pictos, conversationId: answered.conversationId,
        text: 'Corrige los metadatos de la página PICTOS y deja una propuesta revisable.',
      } });
      let proposed: Record<string, any> | null = null;
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const current = await call(`/librarian/requests/${encodeURIComponent(proposalRequest.json.id)}`);
        if (current.json.status === 'answered') { proposed = current.json; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(proposed?.reply.proposal, 'la corrección semántica no quedó como propuesta revisable');
      assert.deepEqual(proposed.reply.proposal.changes, [{
        kind: 'set_property', page: pictos, propertyKey: 'concepto', propertyValue: 'PICTOS',
      }]);
      assert.equal(prompts.length, 4);
      assert.match(prompts[2] ?? '', /Historial efectivo de la conversación:[\s\S]*Bitácora de hoy/);
    } finally {
      await running.close();
      await new Promise<void>((resolve, reject) => inference.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it('abre un umbral formativo, espera la tentativa y permite un bypass explícito', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vera-librarian-dialectic-'));
    directories.push(directory);
    const databasePath = join(directory, 'vera.sqlite');
    const owner = { id: 'participant:dialectic-owner', name: 'Dueña' };
    initializeStarterMemory({ databasePath, owner, ownerLibrarianName: 'Lucienne' });
    const outputs = [
      JSON.stringify({ dialectic: 'answer', text: 'Tu lectura distingue tres ideas; el corpus añade una cuarta tensión.' }),
      JSON.stringify({ dialectic: 'answer', text: 'Selección directa preparada esta vez.' }),
      JSON.stringify({ dialectic: 'challenge', practice: 'reading', text: 'Dime primero qué fuente buscarías.' }),
      'Localicé la fuente identificada y completé la referencia.',
      'Ordené las referencias alfabéticamente.',
    ];
    const inference = createHttpServer(async (_request, response) => {
      for await (const _chunk of _request) { /* consume body */ }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ output_text: outputs.shift() ?? 'Respuesta inesperada.' }));
    });
    await new Promise<void>((resolve) => inference.listen(4392, '127.0.0.1', resolve));
    process.env['VERA_TEST_LIBRARIAN_KEY'] = 'test-secret';
    const running = listen({ port: 4391, databasePath });
    const call = async (path: string, options: { method?: string; body?: unknown } = {}) => {
      const response = await fetch(`http://127.0.0.1:4391${path}`, {
        method: options.method ?? 'GET', headers: { 'content-type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return { status: response.status, json: await response.json() as Record<string, any> };
    };
    const waitAnswered = async (id: string): Promise<Record<string, any>> => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await call(`/librarian/requests/${encodeURIComponent(id)}`);
        if (current.json.status === 'answered') return current.json;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Lucienne no respondió ${id}`);
    };
    try {
      await call('/librarian/runtime/constitute', { method: 'POST', body: {} });
      await call('/librarian/runtime', { method: 'PUT', body: {
        enabled: true, model: 'openai:test', endpoint: 'http://127.0.0.1:4392/v1',
        secretReference: 'VERA_TEST_LIBRARIAN_KEY', permissions: ['read_request_context', 'reply'],
        dialectic: { enabled: true }, routine: { enabled: false, hour: 9, timezone: 'local' },
      } });
      const made = await call('/operations', { method: 'POST', body: {
        originId: 'dialectic-test:page', change: { kind: 'create_page', title: 'Lectura formativa', visibility: 'private' },
      } });
      const page = made.json.subjectId as string;

      const opened = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, text: 'Hazme una síntesis completa.',
      } });
      const challenge = await waitAnswered(opened.json.id);
      assert.match(challenge.reply.text, /tres ideas centrales/);
      assert.equal(challenge.dialectic.status, 'open');
      assert.equal(challenge.dialectic.practice, 'synthesis');
      const beforeContribution = await call(`/pages/${encodeURIComponent(page)}`);
      assert.doesNotMatch(JSON.stringify(beforeContribution.json), /tres ideas centrales/,
        'el desafío conversacional no se deposita como respuesta final en la página');

      const contribution = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, conversationId: challenge.conversationId,
        text: 'Veo soberanía, autoría y una tensión entre fluidez y formación.',
      } });
      const completed = await waitAnswered(contribution.json.id);
      assert.match(completed.reply.text, /cuarta tensión/);
      assert.equal(completed.dialectic.status, 'fulfilled');
      assert.equal(completed.dialectic.closingMode, 'contribution');

      const second = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, conversationId: challenge.conversationId, text: 'Elige los pasajes más importantes.',
      } });
      const secondChallenge = await waitAnswered(second.json.id);
      assert.equal(secondChallenge.dialectic.status, 'open');
      const bypass = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, conversationId: challenge.conversationId,
        text: 'Esta vez necesito resolver la tarea directamente.', dialecticBypass: true,
      } });
      const bypassed = await waitAnswered(bypass.json.id);
      assert.match(bypassed.reply.text, /Selección directa/);
      assert.equal(bypassed.dialectic.status, 'bypassed');
      assert.equal(bypassed.dialectic.closingMode, 'bypass');

      const source = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, conversationId: challenge.conversationId,
        text: 'Busca la fuente de “Remember, remember the fifth of November” y completa la referencia.',
      } });
      const sourced = await waitAnswered(source.json.id);
      assert.match(sourced.reply.text, /Localicé la fuente/);
      assert.equal(sourced.dialectic, null);

      const operational = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, conversationId: challenge.conversationId, text: 'Ordena alfabéticamente estas referencias.',
      } });
      const direct = await waitAnswered(operational.json.id);
      assert.match(direct.reply.text, /Ordené/);
      assert.equal(direct.dialectic, null);
      assert.equal(outputs.length, 0);
    } finally {
      await running.close();
      await new Promise<void>((resolve, reject) => inference.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it('rechaza activar un runtime sin permisos mínimos', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vera-librarian-runtime-permissions-'));
    directories.push(directory);
    const databasePath = join(directory, 'vera.sqlite');
    initializeStarterMemory({
      databasePath,
      owner: { id: 'participant:permissions', name: 'Persona' },
      ownerLibrarianName: 'Lucienne',
    });
    const running = listen({ port: 4397, databasePath });
    try {
      await fetch('http://127.0.0.1:4397/librarian/runtime/constitute', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      const response = await fetch('http://127.0.0.1:4397/librarian/runtime', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: true, model: 'openai:test', secretReference: 'VERA_TEST_LIBRARIAN_KEY',
          permissions: ['reply'], routine: { enabled: false, hour: 9, timezone: 'local' },
        }),
      });
      assert.equal(response.status, 409);
      assert.match(JSON.stringify(await response.json()), /leer el contexto/);
    } finally {
      await running.close();
    }
  });

  it('usa un agente externo con identidad propia y puede volver al runtime embebido', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vera-librarian-runtime-bridge-'));
    directories.push(directory);
    const databasePath = join(directory, 'vera.sqlite');
    const owner = { id: 'participant:bridge-owner', name: 'Persona' };
    initializeStarterMemory({ databasePath, owner, ownerLibrarianName: 'Lucienne' });
    let wake = '';
    let wakeEnvelope: Record<string, unknown> = {};
    const hook = createHttpServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      wakeEnvelope = JSON.parse(body) as Record<string, unknown>;
      wake = String(wakeEnvelope['requestId'] ?? '');
      response.writeHead(202).end();
    });
    const inference = createHttpServer(async (request, response) => {
      for await (const _chunk of request) { /* consume body */ }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ output_text: 'Respondió Lucienne desde el runtime residente.' }));
    });
    await new Promise<void>((resolve) => hook.listen(4396, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => inference.listen(4389, '127.0.0.1', resolve));
    process.env['VERA_TEST_LIBRARIAN_KEY'] = 'test-secret';
    const running = listen({
      port: 4395, databasePath,
      librarianHook: { url: 'http://127.0.0.1:4396/wake', token: 'hook-token' },
    });
    const call = async (path: string, options: { method?: string; body?: unknown; secret?: string } = {}) => {
      const response = await fetch(`http://127.0.0.1:4395${path}`, {
        method: options.method ?? 'GET', headers: {
          'content-type': 'application/json',
          ...(options.secret === undefined ? {} : { authorization: `Bearer ${options.secret}` }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return { status: response.status, json: await response.json() as Record<string, unknown> };
    };
    try {
      const constituted = await call('/librarian/runtime/constitute', { method: 'POST', body: {} });
      const lucienne = (constituted.json['librarian'] as Record<string, string>).agent;
      assert.ok(lucienne);
      const issued = await call('/agents/credentials', {
        method: 'POST', body: { participant: lucienne, scopes: ['read', 'write', 'discard'], label: 'runtime externo' },
      });
      const secret = issued.json['secret'] as string;
      const external = await call('/librarian/runtime', { method: 'PUT', body: {
        enabled: true, adapter: 'external_agent', externalAgent: 'lucienne',
        model: 'openai:gpt-5.6-sol', endpoint: null,
        secretReference: null, permissions: ['read_request_context', 'reply'],
        dialectic: { enabled: true }, routine: { enabled: false, hour: 9, timezone: 'local' },
      } });
      assert.equal(external.status, 200, JSON.stringify(external.json));
      assert.equal((external.json['configuration'] as Record<string, unknown>)['adapter'], 'external_agent');
      assert.equal((external.json['configuration'] as Record<string, unknown>)['externalAgent'], 'lucienne');
      assert.equal((external.json['configuration'] as Record<string, unknown>)['model'], 'openai:gpt-5.6-sol');
      const made = await call('/operations', { method: 'POST', body: {
        originId: 'bridge-test:page', participant: owner.id,
        change: { kind: 'create_page', title: 'Puente transparente', visibility: 'private' },
      } });
      const page = made.json['subjectId'] as string;
      const requested = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, text: 'Responde por el puente y escribe el resultado en la Bitácora de hoy.',
      } });
      const requestId = requested.json['id'] as string;
      for (let attempt = 0; attempt < 50 && wake === ''; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(wake, requestId);
      assert.deepEqual(wakeEnvelope, { requestId },
        'el despertar no debe transportar corpus ni un resumen derivado');
      const claimed = await call(`/librarian/requests/${encodeURIComponent(requestId)}/claim`, {
        method: 'POST', secret,
      });
      assert.equal(claimed.status, 200);
      const bridgeExposures = await call(`/exposures?participant=${encodeURIComponent(lucienne)}`);
      const bridgeContext = (bridgeExposures.json['exposures'] as Array<Record<string, unknown>>)
        .find((one) => one['surface'] === 'external-librarian/context' && one['subject'] === requestId);
      assert.equal(bridgeContext?.['volume'], String(claimed.json['contextSnapshot']).length);
      assert.equal(bridgeContext?.['deliveredCount'],
        librarianContextExposure(String(claimed.json['contextSnapshot'])).delivered.length);
      assert.deepEqual(claimed.json['contextReceipt'],
        librarianSelectionReceipt(String(claimed.json['contextSnapshot'])),
        'el worker debe poder justificar exactamente el snapshot autorizado que reclamó');
      const malformedMove = await call(`/librarian/requests/${encodeURIComponent(requestId)}/reply`, {
        method: 'POST', secret, body: {
          text: 'Moví el bloque.', blocks: [], lineageRelation: 'direct',
          changes: [{ kind: 'move_block', page, parent: null, position: 0 }],
          ifRevisions: {}, removals: [],
        },
      });
      assert.equal(malformedMove.status, 422, JSON.stringify(malformedMove.json));
      assert.match(String(malformedMove.json['error']), /move_block.*malformed|malformada/i);
      const answered = await call(`/librarian/requests/${encodeURIComponent(requestId)}/reply`, {
        method: 'POST', secret, body: {
          text: 'Organicé la respuesta en la Bitácora de Lucienne.',
          lineageRelation: 'direct',
          blocks: [
            { key: 'respuesta', page: 'bitacora_hoy', content: 'PICTOS en el doctorado' },
            { key: 'cobertura', parent: 'respuesta', position: 0, content: 'Cobertura investigada' },
            { key: 'talleres', parent: 'respuesta', position: 1, content: 'Talleres de diseño participativo' },
            { key: 'logistica', parent: 'talleres', content: 'Planificación y coordinación logística' },
            { key: 'conclusion', parent: 'respuesta', position: 2, content: 'Conclusión' },
          ],
          changes: [], ifRevisions: {}, removals: [],
        },
      });
      assert.equal(answered.status, 201, JSON.stringify(answered.json));
      assert.equal((answered.json['reply'] as Record<string, unknown>)['answeredBy'], lucienne);
      const daily = running.vera.graph.pages().find((candidate) =>
        running.vera.graph.blocksOf(candidate.id)
          .some((block) => block.content === '**Bitácora de Lucienne:**'));
      assert.ok(daily, 'el runtime externo no creó el apartado diario de Lucienne');
      const root = running.vera.graph.blocksOf(daily.id)
        .find((block) => block.content === '**Bitácora de Lucienne:**')!;
      const response = running.vera.graph.blocksOf(daily.id).find((block) =>
        block.parent === root.stableId && block.content === 'PICTOS en el doctorado');
      assert.ok(response, 'la salida no quedó como hija de la bitácora de Lucienne');
      const workshops = running.vera.graph.blocksOf(daily.id).find((block) =>
        block.parent === response.stableId && block.content === 'Talleres de diseño participativo');
      assert.ok(workshops, 'la salida perdió su segundo nivel jerárquico');
      assert.deepEqual(
        running.vera.graph.blocksOf(daily.id)
          .filter((block) => block.parent === response.stableId)
          .sort((a, b) => a.position - b.position)
          .map((block) => block.content),
        ['Cobertura investigada', 'Talleres de diseño participativo', 'Conclusión'],
        'la inscripción perdió el orden semántico declarado por el agente',
      );
      assert.ok(running.vera.graph.blocksOf(daily.id).some((block) =>
        block.parent === workshops.stableId && block.content === 'Planificación y coordinación logística'));
      assert.equal((answered.json['reply'] as Record<string, unknown>)['text'],
        'Organicé la respuesta en la Bitácora de Lucienne.');
      const observed = await call('/librarian/runtime');
      const externalRun = (observed.json['runs'] as Array<Record<string, unknown>>)
        .find((run) => run['request'] === requestId);
      assert.equal(externalRun?.['status'], 'completed');
      assert.equal(typeof externalRun?.['queueMilliseconds'], 'number');
      assert.equal(typeof externalRun?.['workMilliseconds'], 'number');
      assert.equal(typeof externalRun?.['totalMilliseconds'], 'number');

      const rootRevision = running.vera.graph.operations().filter((operation) => operation.subjectId === root.stableId).at(-1)?.id;
      const protectedRoot = await call('/operations', { method: 'POST', secret, body: {
        originId: 'bridge-test:mutate-daily-root',
        ifRevision: rootRevision,
        change: { kind: 'edit_block', block: root.stableId, content: '**Bitácora alterada:**' },
      } });
      assert.equal(protectedRoot.status, 403, JSON.stringify(protectedRoot.json));

      const corruptedRoot = await call('/operations', { method: 'POST', body: {
        originId: 'bridge-test:corrupt-daily-root', participant: owner.id,
        ifRevision: rootRevision,
        change: {
          kind: 'edit_block', block: root.stableId,
          content: '**Bitácora de Lucienne:**\n\tTexto que no pertenece al encabezado',
        },
      } });
      assert.equal(corruptedRoot.status, 201, JSON.stringify(corruptedRoot.json));
      const corruptedRevision = running.vera.graph.operations()
        .filter((operation) => operation.subjectId === root.stableId).at(-1)?.id;
      const restoredRoot = await call('/operations', { method: 'POST', secret, body: {
        originId: 'bridge-test:restore-own-daily-root',
        ifRevision: corruptedRevision,
        change: { kind: 'edit_block', block: root.stableId, content: '**Bitácora de Lucienne:**' },
      } });
      assert.equal(restoredRoot.status, 201, JSON.stringify(restoredRoot.json));
      assert.equal(running.vera.graph.block(root.stableId)?.content, '**Bitácora de Lucienne:**');

      const disposable = await call('/operations', { method: 'POST', body: {
        originId: 'bridge-test:disposable', participant: owner.id,
        change: { kind: 'create_block', page, parent: null, position: 0, content: 'Bloque descartable' },
      } });
      const disposableBlock = disposable.json['subjectId'] as string;
      const deletion = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, conversationId: answered.json['conversationId'],
        text: 'Retira el bloque descartable y deja constancia.',
      } });
      const deletionId = deletion.json['id'] as string;
      assert.equal((await call(`/librarian/requests/${encodeURIComponent(deletionId)}/claim`, {
        method: 'POST', secret,
      })).status, 200);
      const silentRemoval = await call(`/librarian/requests/${encodeURIComponent(deletionId)}/reply`, {
        method: 'POST', secret, body: {
          text: 'Listo.', blocks: [], lineageRelation: 'direct',
          changes: [{ kind: 'remove_block', block: disposableBlock }],
          ifRevisions: {}, removals: [],
        },
      });
      assert.equal(silentRemoval.status, 422, JSON.stringify(silentRemoval.json));
      assert.ok(running.vera.graph.block(disposableBlock), 'el retiro silencioso alcanzó a borrar el bloque');
      const revision = running.vera.graph.operations().filter((operation) => operation.subjectId === disposableBlock).at(-1)?.id;
      const declaredRemoval = await call(`/librarian/requests/${encodeURIComponent(deletionId)}/reply`, {
        method: 'POST', secret, body: {
          text: `Retiré ${disposableBlock}: era un bloque descartable de prueba.`, blocks: [], lineageRelation: 'direct',
          changes: [{ kind: 'remove_block', block: disposableBlock }],
          ifRevisions: { [disposableBlock]: revision },
          removals: [{ subject: disposableBlock, reason: 'era un bloque descartable de prueba' }],
        },
      });
      assert.equal(declaredRemoval.status, 201, JSON.stringify(declaredRemoval.json));
      assert.equal(running.vera.graph.block(disposableBlock), undefined);
      assert.ok(running.vera.graph.blocksOf(daily.id).some((block) =>
        block.parent === root.stableId && block.content.includes(`Retiro declarado: ${disposableBlock}`)));
      const conversation = await call('/librarian/conversation');
      assert.equal((conversation.json['agent'] as Record<string, unknown>)['id'], lucienne);

      const configured = await call('/librarian/runtime', { method: 'PUT', body: {
        enabled: true, adapter: 'embedded_model', model: 'openai:test', endpoint: 'http://127.0.0.1:4389/v1',
        secretReference: 'VERA_TEST_LIBRARIAN_KEY', permissions: ['read_request_context', 'reply'],
        dialectic: { enabled: true }, routine: { enabled: false, hour: 9, timezone: 'local' },
      } });
      assert.equal(configured.status, 200, JSON.stringify(configured.json));
      wake = '';
      const resident = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, text: 'Ordena esta referencia.',
      } });
      const residentId = resident.json['id'] as string;
      let residentAnswer: Record<string, any> | null = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await call(`/librarian/requests/${encodeURIComponent(residentId)}`);
        if (current.json['status'] === 'answered') { residentAnswer = current.json; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(residentAnswer, 'Lucienne no atendió la solicitud cuando su runtime estaba listo');
      assert.equal(wake, '', 'el puente no compite con el runtime residente');
      assert.equal(residentAnswer.reply.answeredBy, lucienne);
    } finally {
      await running.close();
      await new Promise<void>((resolve, reject) => hook.close((error) => error === undefined ? resolve() : reject(error)));
      await new Promise<void>((resolve, reject) => inference.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });
});
