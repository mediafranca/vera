import type {
  BlockId, ContributionChannel, NeighbourhoodEdge, NeighbourhoodPathStep, PageId, ParticipantId,
} from '@vera/core';
import { VeraGraph } from '@vera/core';

export interface LibrarianContextPolicy {
  budgetCharacters: number;
  neighbourDepth: number;
  searchLimit: number;
  allowedRelations?: readonly string[];
  maxDegree?: number;
}

interface Provenance {
  revision: string | null;
  authoredBy: ParticipantId | null;
  channel: ContributionChannel | null;
}

interface ContextBlock extends Provenance {
  id: BlockId;
  page: PageId;
  parent: BlockId | null;
  position: number;
  content: string;
  reason: string;
  found_by: Array<'focus' | 'structure' | 'text_match' | 'page_start'>;
}

interface ContextExcerpt extends Provenance {
  content: string;
  block: BlockId | null;
  field: string;
}

interface ContextPage extends Provenance {
  id: PageId;
  title: string;
  reasons: string[];
  found_by: Array<'graph_neighbour' | 'text_match'>;
  distance: number | null;
  path: ContextPathStep[];
  score: number;
  signals: ContextRankingSignal[];
  properties: Array<{ key: string; value: string }>;
  excerpts: ContextExcerpt[];
}

interface ContextRankingSignal {
  kind: 'graph_distance' | 'text_relevance';
  contribution: number;
  detail: string;
}

interface ContextRelation {
  kind: NeighbourhoodEdge['evidence']['kind'];
  relation: string;
  source: PageId;
  target: PageId;
  block: BlockId;
  phrase: string;
  revision: string | null;
  found_by: 'graph_neighbour';
  reason: string;
}

interface ContextPathStep extends ContextRelation {
  from: PageId;
  to: PageId;
}

export interface LibrarianContextReceipt {
  version: 4;
  participant: ParticipantId;
  request: string;
  within: PageId[];
  page: {
    id: PageId; title: string; revision: string | null;
    authoredBy: ParticipantId | null; channel: ContributionChannel | null;
    properties: Array<{ key: string; value: string }>;
  };
  focus: { id: BlockId; content: string; parent: BlockId | null } | null;
  blocks: ContextBlock[];
  library: { pages: Array<Omit<ContextPage, 'excerpts'> & { excerpts: string[] }> };
  items: Array<({ kind: 'block' } & ContextBlock) | ({ kind: 'page' } & ContextPage)>;
  relations: ContextRelation[];
  used: { characters: number; identities: number };
  omitted: { pageBlocks: number; libraryPages: number; degreeEdges: number };
  warnings: string[];
  continuation: { page: PageId; nextPageBlock: number; nextLibraryPage: number } | null;
  selection: {
    reason: string; budgetCharacters: number; usedCharacters: number;
    omittedPageBlocks: number; omittedLibraryPages: number; focusMayExceedBudget: boolean;
    neighbourDepth: number; allowedRelations: string[]; maxDegree: number;
  };
}

const folded = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const ignored = new Set(['como', 'para', 'este', 'esta', 'esto', 'desde', 'sobre', 'quiero', 'puede', 'podemos']);
const termsOf = (text: string): string[] => [...new Set((folded(text).match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  .filter((term) => !ignored.has(term)))].slice(0, 8);

const provenance = (graph: VeraGraph, subject: { page?: PageId; block?: BlockId }): Provenance => {
  const revision = graph.revisions().filter((one) => subject.block === undefined
    ? one.page === subject.page
    : one.block === subject.block).at(-1);
  const hand = subject.block === undefined ? undefined : graph.authorship(subject.block);
  return {
    revision: revision?.operation ?? null,
    authoredBy: hand?.participant ?? revision?.authoredBy ?? null,
    channel: hand?.channel ?? revision?.channel ?? null,
  };
};

/** Ajusta el volumen hasta que el propio recibo diga exactamente cuánto mide. */
const measured = (receipt: LibrarianContextReceipt): string => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const serialized = JSON.stringify(receipt);
    if (receipt.used.characters === serialized.length && receipt.selection.usedCharacters === serialized.length) {
      return serialized;
    }
    receipt.used.characters = serialized.length;
    receipt.selection.usedCharacters = serialized.length;
  }
  return JSON.stringify(receipt);
};

/** Compone un recibo auditable sin persistir otro índice del corpus. */
export function composeLibrarianContextReceipt(input: {
  graph: VeraGraph;
  participant: ParticipantId;
  page: PageId;
  focus?: BlockId | null;
  request: string;
  policy: LibrarianContextPolicy;
  canRead?: (page: PageId) => boolean;
}): LibrarianContextReceipt {
  const page = input.graph.page(input.page);
  if (page === undefined) throw new Error('la página de contexto no existe');
  const canRead = input.canRead ?? (() => true);
  if (!canRead(page.id)) throw new Error('la página de contexto queda fuera del territorio legible');
  const allowedRelations = [...new Set((input.policy.allowedRelations ?? ['link'])
    .map((one) => one.trim()).filter((one) => one !== ''))];
  const maxDegree = Math.max(0, Math.floor(input.policy.maxDegree ?? 12));

  const all = input.graph.blocksOf(page.id);
  const byId = new Map(all.map((block) => [block.stableId, block]));
  const focus = input.focus == null ? undefined : byId.get(input.focus);
  const terms = termsOf(input.request);
  const required = new Set<BlockId>();
  if (focus !== undefined) {
    required.add(focus.stableId);
    let parent = focus.parent;
    while (parent !== null) {
      required.add(parent);
      parent = byId.get(parent)?.parent ?? null;
    }
    const siblings = all.filter((block) => block.parent === focus.parent).sort((a, b) => a.position - b.position);
    const at = siblings.findIndex((block) => block.stableId === focus.stableId);
    for (const sibling of siblings.slice(Math.max(0, at - 2), at + 3)) required.add(sibling.stableId);
    for (const child of all.filter((block) => block.parent === focus.stableId)
      .sort((a, b) => a.position - b.position).slice(0, 4)) required.add(child.stableId);
  }
  const scored = all.map((block, index) => ({
    block, index,
    score: (required.has(block.stableId) ? 10000 : 0) +
      terms.reduce((sum, term) => sum + (folded(block.content).includes(term) ? term.length : 0), 0) +
      (index < 8 ? 8 - index : 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: ContextBlock[] = [];
  let estimated = 1500;
  for (const candidate of scored) {
    const foundBy = required.has(candidate.block.stableId)
      ? (candidate.block.stableId === focus?.stableId ? 'focus' : 'structure')
      : candidate.score > 8 ? 'text_match' : 'page_start';
    const reason = foundBy === 'focus' ? 'foco exacto'
      : foundBy === 'structure' ? 'estructura alrededor del foco'
      : foundBy === 'text_match' ? 'coincidencia con la solicitud' : 'inicio de la página';
    const exactFocus = foundBy === 'focus';
    const content = exactFocus || candidate.block.content.length <= 4000
      ? candidate.block.content
      : candidate.block.content.slice(0, 2000) + '…' + candidate.block.content.slice(-2000);
    const projected = content.length + 320;
    if (!exactFocus && estimated + projected > input.policy.budgetCharacters * 0.55) continue;
    selected.push({
      id: candidate.block.stableId, page: page.id, parent: candidate.block.parent,
      position: candidate.block.position, content, reason, found_by: [foundBy],
      ...provenance(input.graph, { block: candidate.block.stableId }),
    });
    estimated += projected;
  }
  selected.sort((a, b) =>
    all.findIndex((block) => block.stableId === a.id) - all.findIndex((block) => block.stableId === b.id));

  const neighbourhood = input.policy.neighbourDepth > 0
    ? input.graph.neighbourhood({
      centre: page.id,
      depth: input.policy.neighbourDepth,
      participant: input.participant,
      canRead,
      allowedRelations,
      maxDegree,
    })
    : null;
  const macro = new Map<PageId, {
    id: PageId; title: string; reasons: string[];
    found_by: Array<'graph_neighbour' | 'text_match'>;
    distance: number | null; path: ContextPathStep[];
    score: number; signals: ContextRankingSignal[]; excerpts: ContextExcerpt[];
  }>();
  for (const node of neighbourhood?.nodes ?? []) {
    if (node.page === page.id || !canRead(node.page)) continue;
    const neighbour = input.graph.page(node.page);
    if (neighbour === undefined) continue;
    // Una arista pedida explícitamente es evidencia estructural, no una pista
    // textual más. Debe entrar antes que coincidencias incidentales cuando el
    // presupuesto obliga a elegir; la distancia conserva el orden interno.
    const graphContribution = Math.max(400, 1_200 - node.distance * 200);
    macro.set(node.page, {
      id: node.page, title: neighbour.title,
      reasons: ['vecindad del grafo a distancia ' + node.distance],
      found_by: ['graph_neighbour'], distance: node.distance,
      path: node.path.map((step: NeighbourhoodPathStep) => ({
        kind: step.evidence.kind,
        relation: step.evidence.relation,
        source: step.source,
        target: step.target,
        from: step.from,
        to: step.to,
        block: step.evidence.block,
        phrase: step.evidence.phrase,
        revision: step.evidence.revision,
        found_by: 'graph_neighbour',
        reason: `paso ${step.evidence.relation} en el camino autorizado`,
      })),
      score: graphContribution,
      signals: [{
        kind: 'graph_distance', contribution: graphContribution,
        detail: `vecindad autorizada a distancia ${node.distance}: ` +
          node.path.map((step) => step.evidence.relation).join(' → '),
      }],
      excerpts: [],
    });
  }
  if (input.policy.searchLimit > 0 && terms.length > 0) {
    let textualPages = 0;
    search: for (const term of terms) {
      for (const hit of input.graph.search({
        text: term, participant: input.participant, canRead,
      }).hits) {
        if (hit.page === page.id || !canRead(hit.page)) continue;
        const found = input.graph.page(hit.page);
        if (found === undefined) continue;
        const entry = macro.get(hit.page) ?? {
          id: hit.page, title: found.title, reasons: [],
          found_by: [] as Array<'graph_neighbour' | 'text_match'>,
          distance: null, path: [], score: 0, signals: [], excerpts: [],
        };
        if (!entry.reasons.includes('coincidencia textual con la solicitud')) {
          entry.reasons.push('coincidencia textual con la solicitud');
          entry.found_by.push('text_match');
          textualPages += 1;
        }
        if (!entry.excerpts.some((one) => one.content === hit.excerpt && one.block === hit.block)) {
          entry.excerpts.push({
            content: hit.excerpt, block: hit.block, field: hit.field,
            ...provenance(input.graph, hit.block === null ? { page: hit.page } : { block: hit.block }),
          });
        }
        const previousText = entry.signals.findIndex((signal) => signal.kind === 'text_relevance');
        const textSignal: ContextRankingSignal = {
          kind: 'text_relevance', contribution: hit.score,
          detail: hit.signals.map((signal) => `${signal.kind} +${signal.contribution}`).join(', '),
        };
        if (previousText < 0) entry.signals.push(textSignal);
        else if (entry.signals[previousText]!.contribution < hit.score) entry.signals[previousText] = textSignal;
        entry.score = entry.signals.reduce((sum, signal) => sum + signal.contribution, 0);
        macro.set(hit.page, entry);
        if (textualPages >= input.policy.searchLimit) break search;
      }
    }
  }

  const macroPages: ContextPage[] = [];
  for (const entry of [...macro.values()].sort((a, b) =>
    b.score - a.score || (a.distance ?? 99) - (b.distance ?? 99) ||
    a.title.localeCompare(b.title) || a.id.localeCompare(b.id))) {
    const candidate: ContextPage = {
      ...entry, ...provenance(input.graph, { page: entry.id }),
      properties: input.graph.propertiesOf(entry.id).map((one) => ({ key: one.key, value: one.value })),
      excerpts: entry.excerpts.slice(0, 3),
    };
    const projected = JSON.stringify(candidate).length * 2 + 160;
    if (estimated + projected > input.policy.budgetCharacters) continue;
    macroPages.push(candidate);
    estimated += projected;
  }

  const pageProvenance = provenance(input.graph, { page: page.id });
  const build = (): LibrarianContextReceipt => {
    const within = [page.id, ...macroPages.map((one) => one.id)].sort();
    const allowed = new Set(within);
    const relations: ContextRelation[] = (neighbourhood?.edges ?? [])
      .filter((edge) => allowed.has(edge.source) && allowed.has(edge.target))
      .map((edge) => ({
        kind: edge.evidence.kind,
        relation: edge.evidence.relation,
        source: edge.source,
        target: edge.target,
        block: edge.evidence.block,
        phrase: edge.evidence.phrase,
        revision: edge.evidence.revision,
        found_by: 'graph_neighbour' as const,
        reason: `${edge.evidence.relation} dentro de la vecindad autorizada`,
      }))
      .sort((a, b) => (a.source + '\\0' + a.target + '\\0' + a.relation)
        .localeCompare(b.source + '\\0' + b.target + '\\0' + b.relation));
    const omittedPageBlocks = Math.max(0, all.length - selected.length);
    const omittedLibraryPages = Math.max(0, macro.size - macroPages.length);
    const focusMayExceedBudget = focus !== undefined && focus.content.length > input.policy.budgetCharacters;
    const identities = new Set([
      ...within, ...selected.map((one) => one.id),
      ...macroPages.flatMap((one) => one.excerpts.flatMap((excerpt) => excerpt.block === null ? [] : [excerpt.block])),
      ...relations.map((relation) => relation.block),
    ]);
    return {
      version: 4, participant: input.participant, request: input.request, within,
      page: {
        id: page.id, title: page.title, ...pageProvenance,
        properties: input.graph.propertiesOf(page.id).map((one) => ({ key: one.key, value: one.value })),
      },
      focus: focus === undefined ? null : { id: focus.stableId, content: focus.content, parent: focus.parent },
      blocks: selected,
      library: { pages: macroPages.map(({ excerpts, ...one }) => ({
        ...one, excerpts: excerpts.map((excerpt) => excerpt.content),
      })) },
      items: [
        ...selected.map((one) => ({ kind: 'block' as const, ...one })),
        ...macroPages.map((one) => ({ kind: 'page' as const, ...one })),
      ],
      relations,
      used: { characters: 0, identities: identities.size },
      omitted: {
        pageBlocks: omittedPageBlocks,
        libraryPages: omittedLibraryPages,
        degreeEdges: neighbourhood?.omittedByDegree ?? 0,
      },
      warnings: [
        ...(omittedPageBlocks > 0
          ? [String(omittedPageBlocks) + ' bloque(s) de la página quedaron fuera por selección o presupuesto'] : []),
        ...(omittedLibraryPages > 0
          ? [String(omittedLibraryPages) + ' página(s) candidatas quedaron fuera por presupuesto'] : []),
        ...((neighbourhood?.omittedByDegree ?? 0) > 0
          ? [String(neighbourhood?.omittedByDegree) + ' arista(s) autorizadas quedaron fuera por límite de grado'] : []),
        ...(focusMayExceedBudget ? ['el foco exacto excede por sí solo el presupuesto y se conserva íntegro'] : []),
      ],
      continuation: omittedPageBlocks === 0 && omittedLibraryPages === 0 ? null : {
        page: page.id, nextPageBlock: selected.length, nextLibraryPage: macroPages.length,
      },
      selection: {
        reason: focus === undefined
          ? 'página de origen, pasajes pertinentes, vecindad y búsqueda en la biblioteca'
          : 'bloque de origen en su estructura, vecindad y búsqueda en la biblioteca',
        budgetCharacters: input.policy.budgetCharacters, usedCharacters: 0,
        omittedPageBlocks, omittedLibraryPages, focusMayExceedBudget,
        neighbourDepth: input.policy.neighbourDepth,
        allowedRelations,
        maxDegree,
      },
    };
  };

  let receipt = build();
  let serialized = measured(receipt);
  while (serialized.length > input.policy.budgetCharacters && macroPages.length > 0) {
    macroPages.pop();
    receipt = build();
    serialized = measured(receipt);
  }
  while (serialized.length > input.policy.budgetCharacters && selected.some((one) => !one.found_by.includes('focus'))) {
    const removable = [...selected].reverse().find((one) => !one.found_by.includes('focus'));
    if (removable === undefined) break;
    selected.splice(selected.findIndex((one) => one.id === removable.id), 1);
    receipt = build();
    serialized = measured(receipt);
  }
  if (serialized.length > input.policy.budgetCharacters) {
    receipt.warnings.push('el recibo excede el presupuesto por ' +
      String(serialized.length - input.policy.budgetCharacters) + ' carácter(es)');
    measured(receipt);
  }
  return receipt;
}

/** Compatibilidad: el snapshot durable sigue siendo JSON, ahora con recibo v4. */
export function composeLibrarianContext(input: Parameters<typeof composeLibrarianContextReceipt>[0]): string {
  return measured(composeLibrarianContextReceipt(input));
}

/** Identidades y volumen exactos para el registro compacto de exposición. */
export function librarianContextExposure(snapshot: string): { delivered: string[]; volume: number } {
  const parsed = JSON.parse(snapshot) as Pick<LibrarianContextReceipt, 'page' | 'items' | 'relations'>;
  return {
    delivered: [...new Set([
      parsed.page.id,
      ...parsed.items.map((item) => item.id),
      ...parsed.items.flatMap((item) => item.kind === 'page'
        ? item.excerpts.flatMap((excerpt) => excerpt.block === null ? [] : [excerpt.block])
        : []),
      ...parsed.relations.flatMap((relation) => [relation.source, relation.target, relation.block]),
    ])],
    volume: snapshot.length,
  };
}
