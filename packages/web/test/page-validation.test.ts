import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PageView } from '../src/api.ts';
import { sameReadablePage } from '../src/page-validation.ts';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

const page = (content: string, lastEditedAt = 10): PageView => ({
  id: 'page:hypomnemata',
  title: 'Hypomnemata',
  visibility: 'private',
  createdAt: 1,
  originCreatedAt: null,
  lastEditedAt,
  properties: [],
  blockProperties: {},
  domains: {},
  blocks: [{ stableId: 'block:1', parent: null, position: 0, content }],
  backlinks: [],
  references: [],
  crossingsOut: [],
  crossingsIn: [],
  assets: [],
  blockRefs: [],
  folded: [],
});

describe('retained page validation', () => {
  it('recognises an unchanged readable page', () => {
    assert.equal(sameReadablePage(page('cuaderno'), page('cuaderno')), true);
  });

  it('detects changed prose even when the block count stayed equal', () => {
    assert.equal(sameReadablePage(page(''), page('cuaderno')), false);
  });

  it('detects a changed canonical revision even when prose looks equal', () => {
    assert.equal(sameReadablePage(page('cuaderno'), page('cuaderno', 11)), false);
  });

  it('conserva una copia incompleta hasta recuperar la canónica y permite reintentar', () => {
    assert.doesNotMatch(main, /summary\.blockCount !== kept\.blocks\.length[\s\S]{0,120}forgetPage/);
    assert.match(main, /Recuperar desde el corpus/);
    assert.match(main, /canonicalPage\(page\)\.then\(\(canonical\) => acceptCanonical\(canonical, true\)\)/);
    assert.match(main, /event\.stopPropagation\(\)/);
  });

  it('resuelve por título cuando la identidad de la copia no existe en el corpus', () => {
    assert.match(main, /readablePage\(kept\.id, signal\)/);
    assert.match(main, /no such page/);
    assert.match(main, /readablePage\(kept\.title, signal\)/);
    assert.match(main, /validation = canonicalPage\(kept, delivery\.signal\)/);
    assert.match(main, /workspace\.activePage !== page\.id/);
    assert.match(main, /forgetPage\(page\.id\)/);
  });

  it('vuelve a comprobar la página visible al reanudar una PWA móvil', () => {
    assert.match(main, /async function resumeVisiblePage\(\)/);
    assert.match(main, /await catchUpWithCorpus\(\);[\s\S]*await api\.drain\(\)/);
    assert.match(main, /document\.visibilityState === 'visible'\) void resumeVisiblePage\(\)/);
    assert.match(main, /writing\) return;[\s\S]*await openPage\(page, null, \{ fromUrl: true, replaceRoute: true \}\)/);
  });

  it('no confunde con un día vacío uno que falta en el índice local atrasado', () => {
    assert.match(main, /const unknownDay = route\.page !== null/);
    assert.match(main, /if \(unknownDay\) \{[\s\S]*const fresh = await api\.pages\(\)/);
    assert.match(main, /pages = byWeight\(fresh\);[\s\S]*held\.keepIndex\(fresh\)/);
  });
});
