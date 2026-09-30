import type { Hit } from './api.ts';

export interface SearchPage {
  id: string;
  title: string;
}

export interface PageSearchResult<T extends SearchPage = SearchPage> {
  page: T;
  excerpt: string | null;
  matches: number;
  score: number;
}

const folded = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();

/**
 * Convierte la evidencia por bloque en sugerencias de páginas.
 *
 * El título aporta una señal fuerte, pero cada coincidencia interna suma. Así
 * una página que desarrolla mucho un asunto sube en la lista sin ocuparla con
 * veinte renglones iguales. El primer extracto conserva evidencia de por qué
 * apareció.
 */
export function pageSearchResults<T extends SearchPage>(
  query: string,
  pages: readonly T[],
  hits: readonly Hit[],
): PageSearchResult<T>[] {
  const needle = folded(query);
  if (needle === '') return [];

  const byId = new Map(pages.map((page, at) => [page.id, { page, at }]));
  const found = new Map<string, PageSearchResult<T> & { at: number; bestRank: number }>();

  const titleScore = (title: string): number => {
    const key = folded(title);
    if (key === needle) return 100_000;
    if (key.startsWith(needle)) return 10_000;
    if (key.split(/[\s—–:·,()/]+/).some((word) => word.startsWith(needle))) return 5_000;
    if (key.includes(needle)) return 2_500;
    return 0;
  };

  for (const { page, at } of byId.values()) {
    const score = titleScore(page.title);
    if (score > 0) found.set(page.id, { page, excerpt: null, matches: 0, score, at, bestRank: Infinity });
  }

  for (const hit of hits) {
    const known = byId.get(hit.page);
    if (known === undefined) continue;
    const existing = found.get(hit.page) ?? {
      page: known.page,
      excerpt: null,
      matches: 0,
      score: 0,
      at: known.at,
      bestRank: Infinity,
    };
    // El título ya se contó como señal; matches describe lo encontrado dentro.
    if (hit.field !== 'page_title') {
      const matches = hit.matches ?? 1;
      existing.matches += matches;
      existing.score += 100 * matches;
      if (hit.rank < existing.bestRank) {
        existing.excerpt = hit.excerpt;
        existing.bestRank = hit.rank;
      }
    }
    found.set(hit.page, existing);
  }

  return [...found.values()]
    .sort((a, b) => b.score - a.score || a.bestRank - b.bestRank || a.at - b.at)
    .map(({ at: _at, bestRank: _bestRank, ...result }) => result);
}
