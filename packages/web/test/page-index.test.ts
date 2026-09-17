import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PageSummary } from '../src/api.ts';
import { byWeight, changedDays } from '../src/page-index.ts';

const page = (
  id: string,
  title: string,
  blockCount = 0,
  linkCount = 0,
): PageSummary => ({
  id,
  title,
  visibility: 'private',
  blockCount,
  linkCount,
});

describe('índice de páginas retenido', () => {
  it('una identidad local obsoleta no dibuja un segundo día vacío', () => {
    const pages = byWeight([
      page('page:vacía', '2026-09-16'),
      page('page:canónica', '2026-09-16', 52, 16),
      page('page:hoy', '2026-09-17', 2, 1),
    ]);

    assert.deepEqual(
      pages.map(({ id, title }) => ({ id, title })),
      [
        { id: 'page:canónica', title: '2026-09-16' },
        { id: 'page:hoy', title: '2026-09-17' },
      ],
    );
  });

  it('usa la misma identidad de título que el corpus', () => {
    const pages = byWeight([
      page('page:vieja', 'Página  Única'),
      page('page:viva', 'pagina unica', 3, 2),
    ]);
    assert.deepEqual(pages.map((one) => one.id), ['page:viva']);
  });

  it('advierte cuando el índice canónico reemplaza la identidad de un día', () => {
    assert.equal(
      changedDays(
        [page('page:vacía', '2026-09-16')],
        [page('page:canónica', '2026-09-16', 52, 16)],
        (title) => /^\d{4}-\d{2}-\d{2}$/.test(title),
      ),
      true,
    );
  });
});
