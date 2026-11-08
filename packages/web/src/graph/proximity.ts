import type { GraphLens, GraphLink, GraphNode } from './types.ts';

const endpoint = (value: string | GraphNode): string =>
  typeof value === 'string' ? value : value.id;

/** Explica la geometría respecto de la página en foco sin fingir precisión. */
export function proximityExplanation(
  node: GraphNode,
  focus: GraphNode,
  links: GraphLink[],
  lens: GraphLens,
): string | null {
  if (node.id === focus.id) return null;
  const linked = links.some((link) => {
    const source = endpoint(link.source);
    const target = endpoint(link.target);
    return (source === focus.id && target === node.id) ||
      (source === node.id && target === focus.id);
  });
  const focusConcepts = new Map(
    (focus.concepts ?? []).map((concept) => [concept.trim().toLocaleLowerCase('es'), concept.trim()]),
  );
  const shared = (node.concepts ?? [])
    .map((concept) => focusConcepts.get(concept.trim().toLocaleLowerCase('es')))
    .filter((concept): concept is string => concept !== undefined);
  const reasons: string[] = [];
  if (lens !== 'concepts' && linked) reasons.push('enlace directo');
  if (lens !== 'links' && shared.length > 0) {
    reasons.push(`conceptos ${shared.map((concept) => `«${concept}»`).join(' y ')}`);
  }
  return reasons.length === 0 ? null : `Cercanía: ${reasons.join(' + ')}`;
}
