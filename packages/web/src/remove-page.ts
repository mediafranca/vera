// Borrar una página es vaciarla de abajo hacia arriba y quitarla al final, como
// un solo gesto canónico.
//
// El dominio rechaza tanto un bloque con hijos como una página con bloques. El
// lote conserva una operación auditable por ausencia, pero se confirma entero:
// una interrupción o una revisión concurrente no deja media página borrada.

import type { Change, PageView } from './api.ts';

export type PageRemovalPlan =
  | { status: 'ready'; changes: Change[]; ifRevisions: Record<string, string> }
  | { status: 'stale'; block: string };

export function pageRemovalPlan(
  page: Pick<PageView, 'id' | 'blocks'>,
): PageRemovalPlan {
  const parents = new Map(page.blocks.map((block) => [block.stableId, block.parent]));
  const depthOf = (id: string): number => {
    let depth = 0;
    let at = parents.get(id) ?? null;
    // Un corpus dañado no debe dejar al navegador atrapado en un ciclo.
    while (at !== null && depth < 1000) {
      depth += 1;
      at = parents.get(at) ?? null;
    }
    return depth;
  };
  const deepestFirst = [...page.blocks].sort(
    (left, right) => depthOf(right.stableId) - depthOf(left.stableId),
  );

  const ifRevisions: Record<string, string> = {};
  for (const block of deepestFirst) {
    if (block.revision === undefined || block.revision === '') {
      return { status: 'stale', block: block.stableId };
    }
    ifRevisions[block.stableId] = block.revision;
  }
  return {
    status: 'ready',
    changes: [
      ...deepestFirst.map((block): Change => ({ kind: 'remove_block', block: block.stableId })),
      { kind: 'remove_page', page: page.id },
    ],
    ifRevisions,
  };
}
