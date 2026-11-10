import type { ParticipantId, PageId, BlockId } from '@vera/core';
import { VeraGraph } from '@vera/core';

export interface LibrarianContextPolicy {
  budgetCharacters: number;
  neighbourDepth: number;
  searchLimit: number;
}

interface ContextBlock {
  id: string;
  parent: string | null;
  position: number;
  content: string;
  reason: string;
}

const folded = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const ignored = new Set(['como', 'para', 'este', 'esta', 'esto', 'desde', 'sobre', 'quiero', 'puede', 'podemos']);
const termsOf = (text: string): string[] => [...new Set((folded(text).match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  .filter((term) => !ignored.has(term)))].slice(0, 8);

/** Compone el contexto durable que un runtime externo lee desde Vera. */
export function composeLibrarianContext(input: {
  graph: VeraGraph;
  participant: ParticipantId;
  page: PageId;
  focus?: BlockId | null;
  request: string;
  policy: LibrarianContextPolicy;
  canRead?: (page: PageId) => boolean;
}): string {
  const page = input.graph.page(input.page);
  if (page === undefined) throw new Error('la página de contexto no existe');
  const all = input.graph.blocksOf(page.id);
  const byId = new Map(all.map((block) => [block.stableId, block]));
  const focus = input.focus == null ? undefined : byId.get(input.focus);
  const terms = termsOf(input.request);
  const required = new Set<string>();
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
    block,
    index,
    score: (required.has(block.stableId) ? 10_000 : 0) +
      terms.reduce((sum, term) => sum + (folded(block.content).includes(term) ? term.length : 0), 0) +
      (index < 8 ? 8 - index : 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: ContextBlock[] = [];
  let used = 1_000;
  for (const candidate of scored) {
    const reason = required.has(candidate.block.stableId)
      ? (candidate.block.stableId === focus?.stableId ? 'foco exacto' : 'estructura alrededor del foco')
      : candidate.score > 8 ? 'coincidencia con la solicitud' : 'inicio de la página';
    const exactFocus = candidate.block.stableId === focus?.stableId;
    const content = exactFocus || candidate.block.content.length <= 4_000
      ? candidate.block.content
      : `${candidate.block.content.slice(0, 2_000)}…${candidate.block.content.slice(-2_000)}`;
    const projected = content.length + 120;
    if (!exactFocus && used + projected > input.policy.budgetCharacters * 0.65) continue;
    selected.push({ id: candidate.block.stableId, parent: candidate.block.parent,
      position: candidate.block.position, content, reason });
    used += projected;
  }
  selected.sort((a, b) => {
    const left = all.findIndex((block) => block.stableId === a.id);
    const right = all.findIndex((block) => block.stableId === b.id);
    return left - right;
  });

  const macro = new Map<string, { id: string; title: string; reasons: string[]; distance: number | null; excerpts: string[] }>();
  const canRead = input.canRead ?? (() => true);
  if (input.policy.neighbourDepth > 0) {
    for (const node of input.graph.neighbourhood({
      centre: page.id, depth: input.policy.neighbourDepth, participant: input.participant,
    }).nodes) {
      if (node.page === page.id || !canRead(node.page)) continue;
      const neighbour = input.graph.page(node.page);
      if (neighbour === undefined) continue;
      macro.set(node.page, { id: node.page, title: neighbour.title,
        reasons: [`vecindad del grafo a distancia ${node.distance}`], distance: node.distance, excerpts: [] });
    }
  }
  if (input.policy.searchLimit > 0 && terms.length > 0) {
    search: for (const term of terms) {
      for (const hit of input.graph.search({ text: term, participant: input.participant }).hits) {
        if (hit.page === page.id || !canRead(hit.page)) continue;
        const found = input.graph.page(hit.page);
        if (found === undefined) continue;
        const entry = macro.get(hit.page) ?? { id: hit.page, title: found.title, reasons: [], distance: null, excerpts: [] };
        if (!entry.reasons.includes('coincidencia textual con la solicitud')) entry.reasons.push('coincidencia textual con la solicitud');
        if (!entry.excerpts.includes(hit.excerpt)) entry.excerpts.push(hit.excerpt);
        macro.set(hit.page, entry);
        if ([...macro.values()].filter((one) => one.reasons.includes('coincidencia textual con la solicitud')).length >= input.policy.searchLimit) break search;
      }
    }
  }
  const macroPages = [] as Array<{ id: string; title: string; reasons: string[]; distance: number | null;
    properties: Array<{ key: string; value: string }>; excerpts: string[] }>;
  for (const entry of [...macro.values()].sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99) || a.title.localeCompare(b.title))) {
    const candidate = { ...entry,
      properties: input.graph.propertiesOf(entry.id as PageId).map((one) => ({ key: one.key, value: one.value })),
      excerpts: entry.excerpts.slice(0, 3),
    };
    const projected = JSON.stringify(candidate).length;
    if (used + projected > input.policy.budgetCharacters) continue;
    macroPages.push(candidate); used += projected;
  }

  const latest = input.graph.revisions().filter((one) => one.page === page.id).at(-1)?.operation ?? null;
  return JSON.stringify({
    version: 2,
    page: { id: page.id, title: page.title, revision: latest,
      properties: input.graph.propertiesOf(page.id).map((one) => ({ key: one.key, value: one.value })) },
    focus: focus === undefined ? null : { id: focus.stableId, content: focus.content, parent: focus.parent },
    blocks: selected,
    library: { pages: macroPages },
    selection: {
      reason: focus === undefined
        ? 'página de origen, pasajes pertinentes, vecindad y búsqueda en la biblioteca'
        : 'bloque de origen en su estructura, vecindad y búsqueda en la biblioteca',
      budgetCharacters: input.policy.budgetCharacters,
      usedCharacters: used,
      omittedPageBlocks: Math.max(0, all.length - selected.length),
      omittedLibraryPages: Math.max(0, macro.size - macroPages.length),
      focusMayExceedBudget: focus !== undefined && focus.content.length > input.policy.budgetCharacters,
    },
  });
}
