import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LibrarianSelectionReceipt } from '../src/api.ts';
import { librarianReceiptRows, librarianReceiptSummary } from '../src/librarian-receipt.ts';

const receipt: LibrarianSelectionReceipt = {
  version: 6,
  available: true,
  participant: 'participant:lucienne',
  authorizedUniverse: ['page:source', 'page:related'],
  source: { page: 'page:source', title: 'Página foco', revision: 'op:10', focus: 'block:focus' },
  selections: [{
    kind: 'page', id: 'page:related', page: 'page:related', title: 'Página relacionada', revision: 'op:9',
    reasons: ['vecindad autorizada a un salto'], foundBy: ['graph_neighbour'], score: 400,
  }],
  relations: [],
  cost: { characters: 3210, identities: 3, budgetCharacters: 8000 },
  omitted: { pageBlocks: 0, libraryPages: 0, degreeEdges: 0 },
  warnings: [],
  continuation: null,
  selectionReason: 'página de origen, vecindad y búsqueda en la biblioteca',
  temporal: { mode: 'current', effectiveSequence: 12, currentSequence: 12 },
};

describe('recibo visible de selección bibliotecaria', () => {
  it('declara costo y omisiones sin resumir el contenido recibido', () => {
    assert.equal(librarianReceiptSummary(receipt),
      'Contexto recibido · 1 selección · 3.210 caracteres · sin omisiones');
  });

  it('conserva foco, identidades, revisiones y razones exactas', () => {
    assert.deepEqual(librarianReceiptRows(receipt), [{
      kind: 'source', label: 'Página foco · foco block:focus', id: 'page:source', revision: 'op:10',
      reasons: ['página de origen, vecindad y búsqueda en la biblioteca'],
    }, {
      kind: 'page', label: 'Página relacionada', id: 'page:related', revision: 'op:9',
      reasons: ['vecindad autorizada a un salto'],
    }]);
  });
});
