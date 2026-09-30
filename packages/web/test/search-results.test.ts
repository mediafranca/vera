import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pageSearchResults } from '../src/search-results.ts';

const pages = [
  { id: 'page:one', title: 'Una página' },
  { id: 'page:many', title: 'Otra página' },
  { id: 'page:title', title: 'Memoria soberana' },
];

describe('resultados del buscador', () => {
  it('colapsa varias coincidencias de una página y la hace subir', () => {
    const results = pageSearchResults('memoria', pages, [
      { page: 'page:one', block: 'block:1', field: 'block_content', excerpt: 'memoria', rank: 1 },
      { page: 'page:many', block: 'block:2', field: 'block_content', excerpt: 'memoria una', rank: 2 },
      { page: 'page:many', block: 'block:3', field: 'block_content', excerpt: 'memoria dos', rank: 3 },
      { page: 'page:many', block: 'block:4', field: 'gloss_content', excerpt: 'memoria tres', rank: 4 },
    ]);

    assert.deepEqual(
      results.filter((result) => result.matches > 0).map((result) => [result.page.id, result.matches]),
      [
        ['page:many', 3],
        ['page:one', 1],
      ],
    );
    assert.equal(results.filter((result) => result.page.id === 'page:many').length, 1);
  });

  it('combina título y contenido sin duplicar la página', () => {
    const results = pageSearchResults('memoria', pages, [
      { page: 'page:title', block: null, field: 'page_title', excerpt: 'Memoria soberana', rank: 1 },
      { page: 'page:title', block: 'block:1', field: 'block_content', excerpt: 'esta memoria', rank: 2 },
    ]);

    assert.equal(results.length, 1);
    assert.equal(results[0]?.page.id, 'page:title');
    assert.equal(results[0]?.matches, 1);
    assert.equal(results[0]?.excerpt, 'esta memoria');
  });

  it('mantiene arriba una coincidencia exacta de título', () => {
    const exact = { id: 'page:exact', title: 'Memoria' };
    const hits = Array.from({ length: 30 }, (_, at) => ({
      page: 'page:many',
      block: `block:${at}`,
      field: 'block_content',
      excerpt: 'memoria',
      rank: at + 1,
    }));

    assert.equal(pageSearchResults('memoria', [...pages, exact], hits)[0]?.page.id, 'page:exact');
  });

  it('acepta evidencia ya resumida sin perder el total de coincidencias', () => {
    const results = pageSearchResults('memoria', pages, [{
      page: 'page:many', block: 'block:2', field: 'block_content',
      excerpt: 'memoria resumida', rank: 1, matches: 17,
    }]);
    assert.equal(results.find((result) => result.page.id === 'page:many')?.matches, 17);
  });
});
