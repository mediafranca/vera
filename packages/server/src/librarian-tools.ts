import { randomUUID } from 'node:crypto';

import { checkInvariants, readQuery, type ParticipantId, type VeraGraph } from '@vera/core';
import type { Store } from '@vera/store';
import { clearanceForPage, pagesWithinClearance } from './library-clearance.ts';
import { createOperationReviewProposal } from './operation-proposals.ts';

export type LibrarianCapabilityName =
  | 'search_memory'
  | 'read_page'
  | 'query_graph'
  | 'inspect_relations'
  | 'check_invariants'
  | 'reply_to_request'
  | 'propose_edit'
  | 'apply_approved_edit';

export interface LibrarianCapability {
  name: LibrarianCapabilityName;
  title: string;
  revision: '1';
  readOnly: boolean;
  mutatesCorpus: boolean;
  destructive: boolean;
  approval: 'automatic' | 'confirm_each_call';
  projectedToModel: boolean;
  input: string;
}

export const LIBRARIAN_CAPABILITIES: readonly LibrarianCapability[] = [
  { name: 'search_memory', title: 'Buscar en la biblioteca', revision: '1', readOnly: true,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{"query":"texto"}' },
  { name: 'read_page', title: 'Leer una página', revision: '1', readOnly: true,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{"page":"título o id"}' },
  { name: 'query_graph', title: 'Consultar la estructura', revision: '1', readOnly: true,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{"query":"? tipo=… ; lista"}' },
  { name: 'inspect_relations', title: 'Inspeccionar relaciones', revision: '1', readOnly: true,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{"page":"título o id"}' },
  { name: 'check_invariants', title: 'Comprobar invariantes', revision: '1', readOnly: true,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{}' },
  { name: 'reply_to_request', title: 'Responder una solicitud', revision: '1', readOnly: false,
    mutatesCorpus: true, destructive: false, approval: 'automatic', projectedToModel: false,
    input: 'la respuesta final del turno reclamado' },
  { name: 'propose_edit', title: 'Proponer una corrección', revision: '1', readOnly: false,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{"block":"id","content":"texto completo","purpose":"motivo"}' },
  { name: 'apply_approved_edit', title: 'Aplicar una propuesta aprobada', revision: '1', readOnly: false,
    mutatesCorpus: true, destructive: false, approval: 'confirm_each_call', projectedToModel: false,
    input: 'una propuesta pendiente y la confirmación humana actual' },
] as const;

export interface LibrarianToolCall {
  name: LibrarianCapabilityName;
  arguments: Record<string, unknown>;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const pageNamed = (graph: VeraGraph, named: string) => graph.page(named) ?? graph.pageTitled(named);

export function librarianToolInstructions(): string {
  const tools = LIBRARIAN_CAPABILITIES.filter((one) => one.projectedToModel)
    .map((one) => `- ${one.name}: ${one.title}. Entrada ${one.input}`).join('\n');
  return [
    'Puedes pedir una herramienta devolviendo SOLAMENTE una línea JSON con esta forma:',
    '{"tool":"nombre","arguments":{...}}',
    'Herramientas disponibles:', tools,
    'Si ya puedes responder, escribe la respuesta normal en Markdown y no emitas JSON.',
    'No inventes resultados. Una observación de herramienta llegará en el siguiente turno.',
  ].join('\n');
}

export function readLibrarianToolCall(output: string): LibrarianToolCall | null {
  const trimmed = output.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed) as { tool?: unknown; arguments?: unknown };
    if (typeof parsed.tool !== 'string' || parsed.arguments === null || typeof parsed.arguments !== 'object' ||
      Array.isArray(parsed.arguments)) return null;
    const capability = LIBRARIAN_CAPABILITIES.find((one) =>
      one.name === parsed.tool && one.projectedToModel);
    return capability === undefined ? null : {
      name: capability.name,
      arguments: parsed.arguments as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export function runLibrarianTool(store: Store, graph: VeraGraph, agent: ParticipantId,
  call: LibrarianToolCall): { ok: true; result: string } | { ok: false; error: string } {
  const readable = pagesWithinClearance(store, graph, agent, 'read');
  if (call.name === 'search_memory') {
    const query = text(call.arguments['query']);
    if (query === '') return { ok: false, error: 'falta query' };
    const hits = graph.search({ text: query, participant: agent }).hits
      .filter((hit) => readable.has(hit.page)).slice(0, 12)
      .map((hit) => ({ page: graph.page(hit.page)?.title ?? hit.page, block: hit.block, excerpt: hit.excerpt }));
    return { ok: true, result: JSON.stringify({ count: hits.length, hits }) };
  }
  if (call.name === 'read_page') {
    const page = pageNamed(graph, text(call.arguments['page']));
    if (page === undefined) return { ok: false, error: 'la página no existe' };
    const decision = clearanceForPage(store, graph, agent, page.id, 'read');
    if (decision.outcome === 'refused') return { ok: false, error: decision.explanation };
    const blocks = graph.blocksOf(page.id).sort((a, b) => a.position - b.position)
      .map((block) => ({ id: block.stableId, parent: block.parent, position: block.position, content: block.content }));
    return { ok: true, result: JSON.stringify({ id: page.id, title: page.title, blocks }).slice(0, 60_000) };
  }
  if (call.name === 'query_graph') {
    const source = text(call.arguments['query']);
    const parsed = readQuery(source);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    const outcome = graph.query({ expression: parsed.expression, participant: agent, within: [...readable] });
    const pages = outcome.matchingPages.slice(0, 50).map((id) => ({ id, title: graph.page(id)?.title ?? id }));
    return { ok: true, result: JSON.stringify({ count: outcome.matchingPages.length, pages }) };
  }
  if (call.name === 'inspect_relations') {
    const page = pageNamed(graph, text(call.arguments['page']));
    if (page === undefined || !readable.has(page.id)) return { ok: false, error: 'la página no está en el territorio' };
    const backlinks = graph.backlinks(page.id).filter((one) => readable.has(one.sourcePage)).slice(0, 50)
      .map((one) => ({ page: graph.page(one.sourcePage)?.title ?? one.sourcePage, block: one.sourceBlock }));
    const out = graph.crossingsOut(page.id).filter((one) => one.toPage !== null && readable.has(one.toPage)).slice(0, 50)
      .map((one) => ({ term: one.term, page: graph.page(one.toPage!)?.title ?? one.toPage }));
    const incoming = graph.crossingsIn(page.id).filter((one) => readable.has(one.fromPage)).slice(0, 50)
      .map((one) => ({ term: one.term, page: graph.page(one.fromPage)?.title ?? one.fromPage }));
    return { ok: true, result: JSON.stringify({ page: page.title, backlinks, crossingsOut: out, crossingsIn: incoming }) };
  }
  if (call.name === 'check_invariants') {
    const violations = checkInvariants(graph).slice(0, 20);
    if (violations.length === 0) return { ok: true, result: 'SIN_NOVEDAD' };
    // Los detalles históricos de una invariante pueden nombrar páginas o
    // bloques fuera del territorio. Con alcance parcial se informa la clase y
    // la cantidad; el diagnóstico nominal queda para una persona con alcance
    // completo.
    return { ok: true, result: readable.size === graph.pages().length
      ? JSON.stringify(violations)
      : JSON.stringify({ count: violations.length,
          invariants: [...new Set(violations.map((one) => one.invariant))] }) };
  }
  if (call.name === 'propose_edit') {
    const block = graph.block(text(call.arguments['block']));
    const content = text(call.arguments['content']);
    const purpose = text(call.arguments['purpose']);
    if (block === undefined || content === '' || purpose === '') {
      return { ok: false, error: 'block, content y purpose son obligatorios' };
    }
    const decision = clearanceForPage(store, graph, agent, block.page, 'edit');
    if (decision.outcome === 'refused') return { ok: false, error: decision.explanation };
    const revision = graph.revisions().filter((one) => one.block === block.stableId).at(-1)?.operation;
    if (revision === undefined) return { ok: false, error: 'el bloque no tiene una revisión editable' };
    const made = createOperationReviewProposal(store, {
      proposedBy: agent,
      originId: `librarian-tool:${randomUUID()}`,
      channel: 'agent_generation',
      page: block.page,
      block: block.stableId,
      change: { kind: 'edit_block', block: block.stableId, content },
      targetRevision: revision,
      originalContent: block.content,
      purpose,
    });
    return { ok: true, result: JSON.stringify({ status: 'awaiting_human_confirmation', proposal: made.proposal.id }) };
  }
  return { ok: false, error: 'la herramienta requiere una confirmación humana fuera del modelo' };
}
