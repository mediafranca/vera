// Resolver nombres es proponer una arista, no declarar que dos páginas son una.
//
// Este módulo sólo calcula candidatos sobre el territorio ya autorizado. Una
// coincidencia única puede producir un borrador de edición; una ambigua queda
// visible con todas sus alternativas. Nada aquí escribe el corpus.

import { createHash } from 'node:crypto';
import { answersIn, titleKey, type VeraGraph } from '@vera/core';

export type EntityResolutionKind = 'pending_link' | 'unlinked_mention' | 'possible_equivalence';
export type EntityResolutionStatus = 'proposable' | 'ambiguous' | 'review_only';

export interface EntityResolutionMatch {
  page: string;
  title: string;
  label: string;
  matchedBy: 'canonical_title' | 'alternative_label' | 'normalized_variant';
}

export interface EntityResolutionDraft {
  block: string;
  content: string;
  next: string;
  target: string;
  purpose: string;
}

export interface EntityResolutionCandidate {
  id: string;
  kind: EntityResolutionKind;
  status: EntityResolutionStatus;
  sourcePage: string;
  sourceBlock: string | null;
  written: string;
  matches: EntityResolutionMatch[];
  explanation: string;
  draft: EntityResolutionDraft | null;
}

interface Label {
  page: string;
  title: string;
  label: string;
  kind: 'canonical_title' | 'alternative_label';
}

const ALIAS_KEYS = new Set(['alias', 'rotulo alternativo', 'nombre alternativo']);
const WIKI = /\[\[([^\]]+)\]\]/g;
const PROTECTED = [
  /\[\[[^\]]*\]\]/g,
  /\[[^\]]*\]\([^)]*\)/g,
  /`[^`]*`/g,
  /\bhttps?:\/\/\S+/g,
  /^[^\s:]+::/gm,
];

const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 20);

const variantKey = (value: string): string => titleKey(value)
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const reference = (inner: string): { title: string; label: string } | null => {
  const divider = inner.indexOf('|');
  const title = (divider < 0 ? inner : inner.slice(0, divider)).trim();
  if (title === '') return null;
  const label = divider < 0 ? title : inner.slice(divider + 1).trim() || title;
  return { title, label };
};

const protectedSpans = (content: string): Array<[number, number]> => {
  const spans: Array<[number, number]> = [];
  for (const pattern of PROTECTED) {
    for (const found of content.matchAll(pattern)) {
      if (found.index !== undefined) spans.push([found.index, found.index + found[0].length]);
    }
  }
  return spans;
};

const folded = (content: string): { text: string; at: number[] } => {
  let text = '';
  const at: number[] = [];
  for (let index = 0; index < content.length; index += 1) {
    const one = content[index] ?? '';
    for (const character of one.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()) {
      text += character;
      at.push(index);
    }
  }
  at.push(content.length);
  return { text, at };
};

const whole = (text: string, from: number, to: number): boolean => {
  const letter = /[\p{L}\p{N}]/u;
  return (text[from - 1] === undefined || !letter.test(text[from - 1]!)) &&
    (text[to] === undefined || !letter.test(text[to]!));
};

function mention(content: string, label: string): { written: string; from: number; to: number } | null {
  const wanted = titleKey(label);
  if (wanted.length < 4) return null;
  const view = folded(content);
  const spans = protectedSpans(content);
  let index = view.text.indexOf(wanted);
  while (index >= 0) {
    const from = view.at[index] ?? 0;
    const to = view.at[index + wanted.length] ?? content.length;
    const covered = spans.some(([start, end]) => from < end && to > start);
    if (!covered && whole(view.text, index, index + wanted.length)) {
      return { written: content.slice(from, to), from, to };
    }
    index = view.text.indexOf(wanted, index + 1);
  }
  return null;
}

function rewritePending(content: string, writtenTitle: string, targetTitle: string): string | null {
  let changed = false;
  const next = content.replace(WIKI, (wholeLink, inner: string) => {
    if (changed) return wholeLink;
    const parsed = reference(inner);
    if (parsed === null || titleKey(parsed.title) !== titleKey(writtenTitle)) return wholeLink;
    changed = true;
    const visible = parsed.label;
    return titleKey(visible) === titleKey(targetTitle)
      ? `[[${targetTitle}]]`
      : `[[${targetTitle}|${visible}]]`;
  });
  return changed ? next : null;
}

function labelsOf(graph: VeraGraph, canRead: (page: string) => boolean): Label[] {
  const labels: Label[] = [];
  for (const page of graph.pages()) {
    if (!canRead(page.id)) continue;
    labels.push({ page: page.id, title: page.title, label: page.title, kind: 'canonical_title' });
    for (const property of graph.propertiesOf(page.id)) {
      if (!ALIAS_KEYS.has(titleKey(property.key))) continue;
      for (const alias of answersIn(property.value)) {
        const clean = alias.trim();
        if (clean !== '') labels.push({ page: page.id, title: page.title, label: clean, kind: 'alternative_label' });
      }
    }
  }
  return labels;
}

function matchesFor(labels: readonly Label[], written: string, self: string): EntityResolutionMatch[] {
  const exact = labels.filter((label) => titleKey(label.label) === titleKey(written));
  const held = exact.length > 0
    ? exact
    : labels.filter((label) => variantKey(label.label) === variantKey(written));
  const byPage = new Map<string, EntityResolutionMatch>();
  const rank = (label: Label, matchedBy: EntityResolutionMatch['matchedBy']): number =>
    (label.label === written ? 4 : 0) +
    (matchedBy === 'alternative_label' ? 2 : matchedBy === 'canonical_title' ? 1 : 0);
  const ranks = new Map<string, number>();
  for (const label of held) {
    if (label.page === self) continue;
    const matchedBy = titleKey(label.label) === titleKey(written)
      ? label.kind
      : 'normalized_variant';
    const previous = byPage.get(label.page);
    const nextRank = rank(label, matchedBy);
    if (previous === undefined || nextRank > (ranks.get(label.page) ?? -1)) {
      byPage.set(label.page, { page: label.page, title: label.title, label: label.label, matchedBy });
      ranks.set(label.page, nextRank);
    }
  }
  return [...byPage.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function candidate(input: Omit<EntityResolutionCandidate, 'id'>): EntityResolutionCandidate {
  return {
    ...input,
    id: `entity-resolution:${digest(JSON.stringify([
      input.kind, input.sourcePage, input.sourceBlock, input.written,
      input.matches.map((one) => one.page),
    ]))}`,
  };
}

export function entityResolutionCandidates(input: {
  graph: VeraGraph;
  page: string;
  canRead: (page: string) => boolean;
  most?: number;
}): EntityResolutionCandidate[] {
  const { graph, page, canRead } = input;
  if (!canRead(page) || graph.page(page) === undefined) return [];
  const labels = labelsOf(graph, canRead);
  const out: EntityResolutionCandidate[] = [];
  const usedBlocks = new Set<string>();

  for (const link of graph.links().filter((one) => one.sourcePage === page && one.target === null)) {
    const block = graph.block(link.sourceBlock);
    if (block === undefined) continue;
    const matches = matchesFor(labels, link.targetTitle, page);
    if (matches.length === 0) continue;
    const chosen = matches.length === 1 ? matches[0]! : null;
    const next = chosen === null ? null : rewritePending(block.content, link.targetTitle, chosen.title);
    out.push(candidate({
      kind: 'pending_link',
      status: chosen !== null && next !== null ? 'proposable' : 'ambiguous',
      sourcePage: page,
      sourceBlock: block.stableId,
      written: link.targetTitle,
      matches,
      explanation: chosen === null
        ? `«${link.targetTitle}» nombra ${matches.length} páginas autorizadas; hace falta elegir una.`
        : `El enlace pendiente «${link.targetTitle}» coincide con ${chosen.matchedBy === 'alternative_label' ? 'un rótulo alternativo' : 'el título'} de «${chosen.title}».`,
      draft: chosen !== null && next !== null ? {
        block: block.stableId,
        content: block.content,
        next,
        target: chosen.page,
        purpose: `Resolver «${link.targetTitle}» como enlace a «${chosen.title}» sin fusionar páginas.`,
      } : null,
    }));
    usedBlocks.add(block.stableId);
  }

  const groups = new Map<string, Label[]>();
  for (const label of labels) {
    if (label.page === page || titleKey(label.label).length < 4) continue;
    const key = titleKey(label.label);
    const group = groups.get(key) ?? [];
    group.push(label);
    groups.set(key, group);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
  const mentionable = (label: string): boolean => {
    const clean = label.trim();
    return /\s/u.test(clean) || /^\p{Lu}/u.test(clean);
  };
  for (const block of graph.blocksOf(page)) {
    if (usedBlocks.has(block.stableId) || block.content.trim() === '') continue;
    for (const [, group] of ordered) {
      const representative = group.find((one) => mentionable(one.label));
      if (representative === undefined) continue;
      const hit = mention(block.content, representative.label);
      if (hit === null) continue;
      if (!/\s/u.test(representative.label.trim()) && hit.written !== representative.label) continue;
      const matches = matchesFor(labels, hit.written, page);
      if (matches.length === 0) continue;
      const chosen = matches.length === 1 ? matches[0]! : null;
      const next = chosen === null ? null
        : `${block.content.slice(0, hit.from)}[[${chosen.title}|${hit.written}]]${block.content.slice(hit.to)}`;
      out.push(candidate({
        kind: 'unlinked_mention',
        status: chosen === null ? 'ambiguous' : 'proposable',
        sourcePage: page,
        sourceBlock: block.stableId,
        written: hit.written,
        matches,
        explanation: chosen === null
          ? `La mención «${hit.written}» coincide con ${matches.length} páginas autorizadas; no se eligió ninguna.`
          : `La mención «${hit.written}» coincide con ${chosen.matchedBy === 'alternative_label' ? 'un rótulo alternativo' : 'el título'} de «${chosen.title}».`,
        draft: chosen === null || next === null ? null : {
          block: block.stableId,
          content: block.content,
          next,
          target: chosen.page,
          purpose: `Formalizar «${hit.written}» como enlace a «${chosen.title}» sin fusionar páginas.`,
        },
      }));
      usedBlocks.add(block.stableId);
      break;
    }
  }

  const source = graph.page(page)!;
  const ownAliases = labels.filter((one) => one.page === page && one.kind === 'alternative_label');
  for (const alias of ownAliases) {
    const matches = matchesFor(labels, alias.label, page);
    if (matches.length === 0) continue;
    out.push(candidate({
      kind: 'possible_equivalence',
      status: 'review_only',
      sourcePage: page,
      sourceBlock: null,
      written: alias.label,
      matches,
      explanation: `«${source.title}» comparte el rótulo «${alias.label}» con ${matches.map((one) => `«${one.title}»`).join(', ')}. Es evidencia para revisar, no una fusión.`,
      draft: null,
    }));
  }

  return out.slice(0, Math.max(1, Math.min(100, input.most ?? 24)));
}
