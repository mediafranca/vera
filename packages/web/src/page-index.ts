import { titleKey } from '@vera/core';
import type { PageSummary } from './api.ts';

/**
 * El índice que una superficie puede usar sin confundir dos copias con dos cosas.
 *
 * El corpus impide que dos páginas canónicas compartan título, pero el índice
 * retenido de un cliente puede conservar durante un rato una identidad anterior
 * y la identidad que la reemplazó. La página con más tejido y escritura es la
 * mejor representación disponible; la otra no es otra página que haya que
 * dibujar, sino una copia obsoleta del mismo nombre.
 */
export function byWeight(all: readonly PageSummary[]): PageSummary[] {
  const ranked = [...all].sort(
    (a, b) => b.linkCount - a.linkCount || b.blockCount - a.blockCount,
  );
  const seen = new Set<string>();
  return ranked.filter((page) => {
    const key = titleKey(page.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Si cambió la identidad con que el índice representa algún día. */
export function changedDays(
  before: readonly PageSummary[],
  after: readonly PageSummary[],
  isDay: (title: string) => boolean,
): boolean {
  const identities = (pages: readonly PageSummary[]): string =>
    byWeight(pages)
      .filter((page) => isDay(page.title))
      .map((page) => `${titleKey(page.title)}\u0000${page.id}`)
      .sort()
      .join('\n');
  return identities(before) !== identities(after);
}
