import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isMissingPageError, recoveryAfterPageDeletion } from '../src/deleted-page-recovery.ts';

const pages = [
  { id: 'page:today', title: '2026-10-27' },
  { id: 'page:before', title: 'Antes' },
  { id: 'page:deleted', title: 'Borrada' },
];

describe('recovering a route to a deleted page', () => {
  it('distinguishes canonical absence from a transport failure', () => {
    assert.equal(isMissingPageError(new Error('no such page page:gone')), true);
    assert.equal(isMissingPageError(new Error('fetch failed')), false);
    assert.equal(isMissingPageError(new Error('service unavailable')), false);
  });

  it('keeps the page that was already being read when browser history reaches a dead route', () => {
    const recovered = recoveryAfterPageDeletion(
      pages.filter((page) => page.id !== 'page:deleted'),
      [{ page: 'page:before' }, { page: 'page:deleted' }],
      'page:deleted',
      'page:before',
      ['2026-10-27'],
    );

    assert.equal(recovered.target, 'page:before');
    assert.equal(recovered.returned, true);
    assert.deepEqual(recovered.trace, [{ page: 'page:before' }]);
  });

  it('returns to the latest living trace step when the deleted page was active', () => {
    const recovered = recoveryAfterPageDeletion(
      pages.filter((page) => page.id !== 'page:deleted'),
      [{ page: 'page:before' }, { page: 'page:deleted' }],
      'page:deleted',
      'page:deleted',
      ['2026-10-27'],
    );

    assert.equal(recovered.target, 'page:before');
    assert.equal(recovered.returned, true);
  });

  it('uses today only when no preceding living page remains', () => {
    const recovered = recoveryAfterPageDeletion(
      pages.filter((page) => page.id !== 'page:deleted'),
      [{ page: 'page:deleted' }],
      'page:deleted',
      null,
      ['2026-10-27', 'VERA: Registro de Actividad'],
    );

    assert.equal(recovered.target, 'page:today');
    assert.equal(recovered.returned, false);
    assert.deepEqual(recovered.trace, []);
  });

  it('drops every stale trace step disclosed by a fresh canonical index', () => {
    const recovered = recoveryAfterPageDeletion(
      [{ id: 'page:today', title: '2026-10-27' }],
      [{ page: 'page:another-deleted' }, { page: 'page:deleted' }],
      'page:deleted',
      null,
      ['2026-10-27'],
    );

    assert.equal(recovered.target, 'page:today');
    assert.deepEqual(recovered.trace, []);
  });
});
