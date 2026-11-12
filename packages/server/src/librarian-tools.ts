import { randomUUID } from 'node:crypto';

import {
  SPECIAL_KIND,
  checkInvariants,
  readObjectDeclarations,
  readPropertyDeclarations,
  readQuery,
  readRelationDeclarations,
  readTask,
  looksLegacy,
  titleKey,
  type Change,
  type DeclaredBlock,
  type ParticipantId,
  type VeraGraph,
} from '@vera/core';
import type { Store } from '@vera/store';
import { clearanceForPage, pagesWithinClearance } from './library-clearance.ts';
import { createOperationReviewProposal } from './operation-proposals.ts';

export type LibrarianCapabilityName =
  | 'search_memory'
  | 'survey_topic'
  | 'read_page'
  | 'query_graph'
  | 'inspect_relations'
  | 'inspect_ontology'
  | 'inspect_page_schema'
  | 'check_invariants'
  | 'reply_to_request'
  | 'propose_edit'
  | 'propose_page_properties'
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
  { name: 'survey_topic', title: 'Levantar un tema en la biblioteca', revision: '1', readOnly: true,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{"query":"tema","limit":24}' },
  { name: 'read_page', title: 'Leer una página', revision: '1', readOnly: true,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{"page":"título o id"}' },
  { name: 'query_graph', title: 'Consultar la estructura', revision: '1', readOnly: true,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{"query":"? tipo=… ; lista"}' },
  { name: 'inspect_relations', title: 'Inspeccionar relaciones', revision: '1', readOnly: true,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{"page":"título o id"}' },
  { name: 'inspect_ontology', title: 'Leer la ontología y gramática vigentes', revision: '1', readOnly: true,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{}' },
  { name: 'inspect_page_schema', title: 'Inspeccionar la clasificación de una página', revision: '1', readOnly: true,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{"page":"título o id"}' },
  { name: 'check_invariants', title: 'Comprobar invariantes', revision: '1', readOnly: true,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{}' },
  { name: 'reply_to_request', title: 'Responder e inscribir una solicitud', revision: '1', readOnly: false,
    mutatesCorpus: true, destructive: true, approval: 'automatic', projectedToModel: false,
    input: 'recibo breve, árbol de bloques, operaciones y declaraciones de retiro' },
  { name: 'propose_edit', title: 'Proponer una corrección', revision: '1', readOnly: false,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{"block":"id","content":"texto completo","purpose":"motivo"}' },
  { name: 'propose_page_properties', title: 'Proponer propiedades de página validadas', revision: '1', readOnly: false,
    mutatesCorpus: false, destructive: false, approval: 'automatic', projectedToModel: true,
    input: '{"page":"título o id","properties":{"tipo":"Proyecto","concepto":"PICTOS"},"purpose":"motivo"}' },
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

const folded = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const governingPage = (graph: VeraGraph, kind: string) => graph.pages().find((page) =>
  graph.propertiesOf(page.id).some((property) => property.key === SPECIAL_KIND && property.value === kind));

const declarationsIn = (graph: VeraGraph, kind: string): DeclaredBlock[] => {
  const page = governingPage(graph, kind);
  if (page === undefined) return [];
  return graph.blocksOf(page.id).map((block) => ({
    block: block.stableId,
    content: block.content,
    properties: graph.propertiesOf(block.stableId).map((property) => ({ key: property.key, value: property.value })),
  })).filter((block) => block.content.trim() !== '' && block.properties.length > 0);
};

const ontologyOf = (graph: VeraGraph) => ({
  properties: readPropertyDeclarations(declarationsIn(graph, 'properties')),
  objects: readObjectDeclarations(declarationsIn(graph, 'objects')),
  relations: readRelationDeclarations(declarationsIn(graph, 'relations')),
});

function unmarkPageReference(value: string): string {
  const marked = /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(value.trim());
  return (marked?.[1] ?? value).trim();
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(value)))
    : fallback;
}

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
  const raw = output.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(raw);
  const trimmed = (fenced?.[1] ?? raw).trim();
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

export function resemblesLibrarianToolCall(output: string): boolean {
  return /["']tool["']\s*:|```(?:json)?\s*\{\s*["']tool["']/i.test(output);
}

export type LibrarianToolResult =
  | { ok: true; result: string; proposedChanges?: Change[]; evidenceCount?: number }
  | { ok: false; error: string };

export function runLibrarianTool(store: Store, graph: VeraGraph, agent: ParticipantId,
  call: LibrarianToolCall): LibrarianToolResult {
  const readable = pagesWithinClearance(store, graph, agent, 'read');
  if (call.name === 'search_memory') {
    const query = text(call.arguments['query']);
    if (query === '') return { ok: false, error: 'falta query' };
    const hits = graph.search({ text: query, participant: agent, canRead: (page) => readable.has(page) }).hits
      .slice(0, 12)
      .map((hit) => ({
        page: graph.page(hit.page)?.title ?? hit.page, block: hit.block, excerpt: hit.excerpt,
        score: hit.score, signals: hit.signals,
      }));
    return { ok: true, result: JSON.stringify({ count: hits.length, hits }), evidenceCount: hits.length };
  }
  if (call.name === 'survey_topic') {
    const query = text(call.arguments['query']);
    if (query === '') return { ok: false, error: 'falta query' };
    const limit = boundedInteger(call.arguments['limit'], 24, 4, 40);
    const primary = query.split(/\s+/).find((one) => one.trim() !== '') ?? query;
    const key = titleKey(primary);
    const titled = graph.pages()
      .filter((page) => readable.has(page.id) && titleKey(page.title).includes(key))
      .sort((a, b) => {
        const aKey = titleKey(a.title);
        const bKey = titleKey(b.title);
        const aRank = aKey === key ? 0 : aKey.startsWith(key) ? 1 : 2;
        const bRank = bKey === key ? 0 : bKey.startsWith(key) ? 1 : 2;
        return aRank - bRank || a.title.localeCompare(b.title, 'es');
      });
    const searched = graph.search({
      text: primary, participant: agent, canRead: (page) => readable.has(page),
    }).hits;
    const ordered = new Map<string, { id: string; excerpt: string | null }>();
    for (const page of titled) ordered.set(page.id, { id: page.id, excerpt: null });
    for (const hit of searched) if (!ordered.has(hit.page)) ordered.set(hit.page, { id: hit.page, excerpt: hit.excerpt });
    const terms = folded(query).split(/\s+/).filter((one) => one.length >= 3);
    const candidates = [...ordered.values()].sort((a, b) => {
      const score = (candidate: { id: string; excerpt: string | null }): number => {
        const pageTitle = folded(graph.page(candidate.id)?.title ?? '');
        const excerpt = folded(candidate.excerpt ?? '');
        return terms.reduce((sum, term) => sum + (pageTitle.includes(term) ? term.length * 4 : 0) +
          (excerpt.includes(term) ? term.length : 0), 0) + (titleKey(graph.page(candidate.id)?.title ?? '') === key ? 30 : 0);
      };
      return score(b) - score(a) || (graph.page(a.id)?.title ?? '').localeCompare(graph.page(b.id)?.title ?? '', 'es');
    });
    const detailed = candidates.slice(0, limit).flatMap((candidate) => {
      const page = graph.page(candidate.id);
      if (page === undefined) return [];
      const blocks = graph.blocksOf(page.id).sort((a, b) => a.position - b.position);
      const scored = blocks.map((block, index) => ({ block, index,
        score: terms.reduce((sum, term) => sum + (folded(block.content).includes(term) ? term.length : 0), 0),
      })).sort((a, b) => b.score - a.score || b.block.content.length - a.block.content.length || a.index - b.index);
      const excerpts = scored.slice(0, 1).map(({ block }) => ({ id: block.stableId,
        content: block.content.length <= 240 ? block.content : `${block.content.slice(0, 237)}…`,
      }));
      const tasks = blocks.filter((block) => readTask(block.content) !== null || looksLegacy(block.content))
        .slice(0, 2).map((block) => ({ id: block.stableId, content: block.content.slice(0, 200) }));
      return [{
        title: page.title,
        properties: graph.propertiesOf(page.id).map((property) => `${property.key}:: ${property.value}`),
        excerpts: excerpts.map((excerpt) => excerpt.content),
        tasks: tasks.map((task) => task.content),
        backlinks: graph.backlinks(page.id).filter((link) => readable.has(link.sourcePage)).length,
        outgoing: graph.crossingsOut(page.id).filter((crossing) => crossing.toPage !== null && readable.has(crossing.toPage)).length,
      }];
    });
    const result = {
      query,
      count: candidates.length,
      titleMatches: titled.length,
      catalogue: candidates.slice(0, 40).map((candidate) => graph.page(candidate.id)?.title ?? candidate.id),
      pages: detailed,
      omitted: Math.max(0, candidates.length - detailed.length),
    };
    return { ok: true, result: JSON.stringify(result).slice(0, 10_000), evidenceCount: candidates.length };
  }
  if (call.name === 'read_page') {
    const page = pageNamed(graph, text(call.arguments['page']));
    if (page === undefined) return { ok: false, error: 'la página no existe' };
    const decision = clearanceForPage(store, graph, agent, page.id, 'read');
    if (decision.outcome === 'refused') return { ok: false, error: decision.explanation };
    const blocks = graph.blocksOf(page.id).sort((a, b) => a.position - b.position)
      .map((block) => ({ id: block.stableId, parent: block.parent, position: block.position, content: block.content }));
    const properties = graph.propertiesOf(page.id).map((property) => ({ key: property.key, value: property.value }));
    return { ok: true, result: JSON.stringify({ id: page.id, title: page.title, properties, blocks }).slice(0, 60_000), evidenceCount: 1 };
  }
  if (call.name === 'query_graph') {
    const source = text(call.arguments['query']);
    const parsed = readQuery(source);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    const outcome = graph.query({ expression: parsed.expression, participant: agent, within: [...readable] });
    const pages = outcome.matchingPages.slice(0, 50).map((id) => ({ id, title: graph.page(id)?.title ?? id }));
    return { ok: true, result: JSON.stringify({ count: outcome.matchingPages.length, pages }), evidenceCount: outcome.matchingPages.length };
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
    return { ok: true, result: JSON.stringify({ page: page.title, backlinks, crossingsOut: out, crossingsIn: incoming }), evidenceCount: 1 };
  }
  if (call.name === 'inspect_ontology') {
    const ontology = ontologyOf(graph);
    return { ok: true, result: JSON.stringify({
      properties: ontology.properties.map((one) =>
        `${one.name} [${one.subject}; ${one.field}${one.many ? '; varios' : ''}${one.role == null ? '' : `; ${one.role}`}]`),
      objects: ontology.objects.map((one) => one.name),
      relations: ontology.relations.map((one) => `${one.name} ↔ ${one.inverse}`),
      writing: {
        metadata: 'usar operaciones set_property; no insertar líneas clave:: valor como prosa',
        pageReferences: 'guardar el título canónico sin [[corchetes]] ni rótulo',
        distinction: 'tipo dice qué es la página; concepto dice de qué trata',
      },
    }), evidenceCount: ontology.properties.length + ontology.objects.length + ontology.relations.length };
  }
  if (call.name === 'inspect_page_schema') {
    const page = pageNamed(graph, text(call.arguments['page']));
    if (page === undefined || !readable.has(page.id)) return { ok: false, error: 'la página no está en el territorio' };
    const ontology = ontologyOf(graph);
    const properties = graph.propertiesOf(page.id).map((property) => ({ key: property.key, value: property.value }));
    const kind = ontology.properties.find((property) => property.role === 'kind');
    const currentType = properties.find((property) => kind !== undefined && titleKey(property.key) === titleKey(kind.name))?.value ?? null;
    const object = currentType === null ? null : ontology.objects.find((one) => titleKey(one.name) === titleKey(currentType)) ?? null;
    const present = new Set(properties.map((property) => titleKey(property.key)));
    const missing = object?.properties.filter((name) => !present.has(titleKey(name))) ?? [];
    return { ok: true, result: JSON.stringify({ page: { id: page.id, title: page.title }, currentType,
      object, properties, missing, propertyDefinitions: ontology.properties }), evidenceCount: 1 };
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
  if (call.name === 'propose_page_properties') {
    const page = pageNamed(graph, text(call.arguments['page']));
    const purpose = text(call.arguments['purpose']);
    const raw = call.arguments['properties'];
    if (page === undefined || purpose === '' || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'page, properties y purpose son obligatorios' };
    }
    const decision = clearanceForPage(store, graph, agent, page.id, 'edit');
    if (decision.outcome === 'refused') return { ok: false, error: decision.explanation };
    const ontology = ontologyOf(graph);
    const definitions = new Map(ontology.properties.map((definition) => [titleKey(definition.name), definition]));
    const entries = Object.entries(raw as Record<string, unknown>);
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalized: Record<string, string> = {};
    const proposedType = entries.find(([name]) => definitions.get(titleKey(name))?.role === 'kind');
    const existingType = (() => {
      const kind = ontology.properties.find((property) => property.role === 'kind');
      if (kind === undefined) return null;
      return graph.propertiesOf(page.id).find((property) => titleKey(property.key) === titleKey(kind.name))?.value ?? null;
    })();
    const pageType = proposedType === undefined ? existingType : text(proposedType[1]);
    const object = pageType === null ? null : ontology.objects.find((one) => titleKey(one.name) === titleKey(pageType)) ?? null;
    for (const [writtenName, writtenValue] of entries) {
      const definition = definitions.get(titleKey(writtenName));
      const value = text(writtenValue);
      if (definition === undefined) { errors.push(`propiedad no declarada: ${writtenName}`); continue; }
      if (definition.subject !== 'página') { errors.push(`${definition.name} pertenece a bloques, no a páginas`); continue; }
      if (value === '') { errors.push(`${definition.name} no puede quedar vacía`); continue; }
      let canonical = value;
      if (definition.field === 'enlace') {
        canonical = definition.many
          ? value.split(',').map(unmarkPageReference).filter((one) => one !== '').join(', ')
          : unmarkPageReference(value);
        for (const target of canonical.split(',').map((one) => one.trim()).filter((one) => one !== '')) {
          if (graph.pageTitled(target) === undefined) warnings.push(`la referencia ${definition.name} → ${target} todavía no resuelve a una página`);
        }
      }
      const allowed = definition.role === 'kind' ? ontology.objects.map((one) => one.name) : definition.values;
      if (definition.field === 'una de' && allowed.length > 0 && !allowed.some((one) => titleKey(one) === titleKey(canonical))) {
        errors.push(`${definition.name} admite: ${allowed.join(', ')}`);
        continue;
      }
      if (definition.role === 'kind') {
        const declared = ontology.objects.find((one) => titleKey(one.name) === titleKey(canonical));
        if (declared === undefined) { errors.push(`tipo no declarado: ${canonical}`); continue; }
        canonical = declared.name;
      }
      if (object !== null && definition.role !== 'kind' && !object.properties.some((name) => titleKey(name) === titleKey(definition.name))) {
        warnings.push(`${definition.name} está declarada, pero no figura entre las propiedades de ${object.name}`);
      }
      normalized[definition.name] = canonical;
    }
    if (errors.length > 0) return { ok: false, error: JSON.stringify({ errors, warnings }) };
    const proposedChanges: Change[] = Object.entries(normalized).map(([propertyKey, propertyValue]) => ({
      kind: 'set_property' as const, page: page.id, propertyKey, propertyValue,
    }));
    return { ok: true, result: JSON.stringify({ status: 'proposed_for_human_review', page: page.title,
      properties: normalized, warnings, purpose, changes: proposedChanges.length }), proposedChanges, evidenceCount: 1 };
  }
  return { ok: false, error: 'la herramienta requiere una confirmación humana fuera del modelo' };
}
