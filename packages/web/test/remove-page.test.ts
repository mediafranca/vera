import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { pageRemovalPlan } from '../src/remove-page.ts';
import type { BlockView } from '../src/api.ts';

const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');

const block = (stableId: string, parent: string | null): BlockView => ({
  stableId,
  parent,
  position: 0,
  content: stableId,
  revision: `revision:${stableId}`,
});

describe('pageRemovalPlan', () => {
  it('compone hojas, padres y página en un lote con todas sus revisiones', () => {
    const plan = pageRemovalPlan({
      id: 'page:one',
      blocks: [block('parent', null), block('leaf', 'parent'), block('root', null)],
    });

    assert.equal(plan.status, 'ready');
    if (plan.status !== 'ready') return;
    assert.deepEqual(plan.changes, [
      { kind: 'remove_block', block: 'leaf' },
      { kind: 'remove_block', block: 'parent' },
      { kind: 'remove_block', block: 'root' },
      { kind: 'remove_page', page: 'page:one' },
    ]);
    assert.deepEqual(plan.ifRevisions, {
      leaf: 'revision:leaf',
      parent: 'revision:parent',
      root: 'revision:root',
    });
  });

  it('rehúsa planificar si un bloque no tiene revisión canónica', () => {
    const local = block('local', null);
    delete local.revision;
    assert.deepEqual(pageRemovalPlan({ id: 'page:one', blocks: [local] }), {
      status: 'stale', block: 'local',
    });
  });

  it('compone directamente una página vacía', () => {
    assert.deepEqual(pageRemovalPlan({ id: 'page:empty', blocks: [] }), {
      status: 'ready',
      changes: [{ kind: 'remove_page', page: 'page:empty' }],
      ifRevisions: {},
    });
  });

  it('envía el plan una sola vez y con todas sus revisiones', () => {
    const deletion = outliner.slice(
      outliner.indexOf('async function deletePage('),
      outliner.indexOf('/** El Markdown de la página'),
    );
    assert.match(deletion, /api\.submitCanonicalBatch\([\s\S]*plan\.ifRevisions/);
    assert.doesNotMatch(deletion, /for \(const block/);
    assert.match(deletion, /sin conexión con el servidor; no se eliminó nada/);
  });
});
