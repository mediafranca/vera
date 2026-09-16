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
    assert.match(main, /if \(page === null\) \{[\s\S]*await revalidateUnstartedDay\(\)/);
    assert.match(main, /const arrived = dayPage\(route\.page\)/);
    assert.match(main, /openPage\(arrived\.id, null, \{ fromUrl: true, replaceRoute: true \}\)/);
    assert.match(main, /announce\(\);[\s\S]*await revalidateUnstartedDay\(\)/);
  });

  it('no confunde con un día vacío uno que falta en el índice local atrasado', () => {
    assert.match(main, /const unknownDay = route\.page !== null/);
    assert.match(main, /if \(unknownDay\) \{[\s\S]*const fresh = await api\.pages\(\)/);
    assert.match(main, /pages = byWeight\(fresh\);[\s\S]*held\.keepIndex\(fresh\)/);
  });

  it('abre el taller con el estado retenido sin esperar la salud canónica', () => {
    const start = main.slice(main.indexOf('async function start()'), main.indexOf('/**\n * Arrancar puede fallar'));
    assert.match(start, /const canonicalHealth = api\.health\(\)/);
    assert.match(start, /const rememberedCorpus = await held\.corpus\(\)/);
    assert.match(start, /useCorpus\(rememberedCorpus\)/);
    assert.match(start, /void canonicalHealth\.then/);
    assert.match(start, /await loadPages\(\);[\s\S]*await applyRoute\(\)/);
    assert.ok(
      start.indexOf('useCorpus(rememberedCorpus)') < start.indexOf('await loadPages()'),
      'el estado local debe gobernar antes de abrir la lista y la ruta',
    );
  });

  it('retiene el texto base antes de esperar relaciones y procedencia', () => {
    const opening = main.slice(main.indexOf('async function openPage('), main.indexOf('/** Abrir por título'));
    const keep = opening.indexOf('held.keepPage(openView)');
    const enrich = opening.indexOf('api.pageEnrichment(page.id');
    assert.ok(keep >= 0, 'la entrega legible debe quedar retenida');
    assert.ok(enrich >= 0, 'la información derivada debe seguir completándose');
    assert.ok(keep < enrich, 'retener el texto no puede depender del enriquecimiento');
  });
});
