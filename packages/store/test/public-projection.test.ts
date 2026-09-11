import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VeraGraph } from '@vera/core';
import type { Change } from '@vera/core';
import {
  projectPublicSite,
  projectPublicSiteAtomically,
  publicPathFor,
} from '../src/public-projection.ts';

const OWNER = 'participant:herbert';
const temporary: string[] = [];
const scratch = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'vera-public-'));
  temporary.push(directory);
  return directory;
};

after(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
});

function graph(): VeraGraph {
  const graph = VeraGraph.create({ name: 'mind' });
  graph.addParticipant({ id: OWNER, name: 'Herbert', kind: 'human' });
  graph.admit(OWNER);
  let sequence = 0;
  const write = (change: Change): string => {
    const outcome = graph.submitOperation({
      originId: `public:${++sequence}`,
      participant: OWNER,
      change,
    });
    if (outcome.status !== 'applied') throw new Error(JSON.stringify(outcome));
    return outcome.subjectId;
  };
  const visible = write({ kind: 'create_page', title: 'Página pública', visibility: 'public' });
  write({
    kind: 'create_block', page: visible, parent: null, position: 0, content: 'Texto <visible>',
  });
  const privatePage = write({
    kind: 'create_page', title: 'Secreto irrepetible', visibility: 'private',
  });
  write({
    kind: 'create_block', page: privatePage, parent: null, position: 0, content: 'No debe salir',
  });
  write({
    kind: 'create_block', page: visible, parent: null, position: 1,
    content: 'Ver [[Secreto irrepetible]]',
  });
  return graph;
}

function publicPage(corpus: VeraGraph): string {
  const page = corpus.pages().find((candidate) => candidate.title === 'Página pública');
  assert.ok(page);
  return page.id;
}

function published(
  corpus: VeraGraph,
  path = 'pagina-publica',
  entryPoint = false,
  transparentBlockTraceability = false,
) {
  const site = corpus.createSite({
    owner: OWNER, title: 'Vera', canonicalDomain: 'https://vera.mediafranca.net',
    transparentBlockTraceability,
  });
  const publication = corpus.publish({
    site: site.id, page: publicPage(corpus), path, participant: OWNER,
  });
  if (entryPoint) {
    corpus.setSiteEntryPoint({ site: site.id, page: publication.page, participant: OWNER });
  }
  return { site, publications: [publication] };
}

describe('proyección pública', () => {
  it('genera sólo publicaciones explícitas y escapa su HTML', () => {
    const target = scratch();
    const corpus = graph();
    const summary = projectPublicSite(corpus, target, published(corpus));
    assert.equal(summary.pages, 1);
    assert.deepEqual(readdirSync(target).sort(), ['index.html', 'pagina-publica']);
    const page = readFileSync(join(target, 'pagina-publica', 'index.html'), 'utf8');
    assert.match(page, /<p>Texto &lt;visible&gt;<\/p>/);
    assert.match(page, /https:\/\/vera\.mediafranca\.net\/pagina-publica\//);
  });

  it('lleva el runtime p5 local sólo cuando una página publicada lo usa', () => {
    const target = scratch();
    const corpus = graph();
    const page = publicPage(corpus);
    const created = corpus.submitOperation({
      originId: 'public:p5', participant: OWNER,
      change: {
        kind: 'create_block', page, parent: null, position: 3,
        content: '```p5js\nfunction setup(){ createCanvas(40, 40) }\n```',
      },
    });
    assert.equal(created.status, 'applied');

    const summary = projectPublicSite(corpus, target, published(corpus));
    assert.ok(summary.files.includes('p5.min.js'));
    assert.ok(summary.files.includes('p5-frame.html'));
    assert.ok(readFileSync(join(target, 'p5.min.js')).byteLength > 100_000);
    assert.match(
      readFileSync(join(target, 'pagina-publica', 'index.html'), 'utf8'),
      /src="\/p5-frame\.html#/,
    );
  });

  it('no filtra título, contenido ni manifiesto de páginas privadas', () => {
    const target = scratch();
    const corpus = graph();
    projectPublicSite(corpus, target, published(corpus));
    const all = [
      readFileSync(join(target, 'index.html'), 'utf8'),
      readFileSync(join(target, 'pagina-publica', 'index.html'), 'utf8'),
    ].join('\n');
    assert.doesNotMatch(all, /data-page="Secreto irrepetible"|No debe salir|block:|page:/);
    assert.match(all, /<span class="wiki unavailable">Secreto irrepetible<\/span>/);
    assert.ok(!readdirSync(target).includes('manifest.json'));
  });

  it('propone rutas sin diacríticos cuando una persona publica', () => {
    assert.equal(publicPathFor('VERA — Instanciación'), 'vera-instanciacion');
  });

  it('conserva la dirección publicada aunque cambie el título', () => {
    const corpus = graph();
    const options = published(corpus, 'historia/vera');
    const renamed = corpus.submitOperation({
      originId: 'public:renamed', participant: OWNER,
      change: { kind: 'rename_page', page: publicPage(corpus), title: 'Otro título' },
    });
    assert.equal(renamed.status, 'applied');
    const target = scratch();
    projectPublicSite(corpus, target, options);
    assert.match(
      readFileSync(join(target, 'historia', 'vera', 'index.html'), 'utf8'),
      /https:\/\/vera\.mediafranca\.net\/historia\/vera\//,
    );
  });

  it('proyecta la marca como favicon, icono instalable y vista social', () => {
    const target = scratch();
    const branding = scratch();
    for (const filename of [
      'apple-touch-icon.png', 'favicon.ico', 'icon-16.png', 'icon-32.png',
      'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
    ]) {
      writeFileSync(join(branding, filename), filename);
    }
    const corpus = graph();
    projectPublicSite(corpus, target, { ...published(corpus), brandingAssets: branding });

    const index = readFileSync(join(target, 'index.html'), 'utf8');
    assert.match(index, /rel="manifest" href="\/site\.webmanifest"/);
    assert.match(index, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
    assert.match(index, /property="og:image" content="https:\/\/vera\.mediafranca\.net\/icon-512\.png"/);
    assert.equal(readFileSync(join(target, 'icon-512.png'), 'utf8'), 'icon-512.png');
  });

  it('proyecta la portada persistida en la raíz del sitio', () => {
    const corpus = graph();
    const target = scratch();
    projectPublicSite(corpus, target, published(corpus, 'pagina-publica', true));
    const index = readFileSync(join(target, 'index.html'), 'utf8');
    assert.match(index, /<h1>Página pública<\/h1>/);
    assert.match(index, /<p>Texto &lt;visible&gt;<\/p>/);
    assert.match(index, /rel="canonical" href="https:\/\/vera\.mediafranca\.net\/"/);
  });

  it('abre en la viñeta sólo la historia trazable desde la publicación cuando la superficie lo permite', () => {
    const corpus = graph();
    const block = corpus.blocksOf(publicPage(corpus))[0];
    assert.ok(block);
    corpus.submitOperation({
      originId: 'public:draft', participant: OWNER,
      change: { kind: 'edit_block', block: block.stableId, content: 'borrador privado' },
    });
    corpus.submitOperation({
      originId: 'public:opening', participant: OWNER,
      change: { kind: 'edit_block', block: block.stableId, content: 'versión al publicar' },
    });
    const options = published(corpus, 'pagina-publica', false, true);
    corpus.submitOperation({
      originId: 'public:later', participant: OWNER,
      change: { kind: 'edit_block', block: block.stableId, content: 'versión posterior' },
    });
    const target = scratch();
    projectPublicSite(corpus, target, options);
    const html = readFileSync(join(target, 'pagina-publica', 'index.html'), 'utf8');
    assert.match(html, /class="traceable-block"/);
    assert.match(html, /versión al publicar/);
    assert.match(html, /versión posterior/);
    assert.doesNotMatch(html, /borrador privado/);
  });

  it('rechaza una portada que no pertenece a sus publicaciones', () => {
    const corpus = graph();
    const site = corpus.createSite({
      owner: OWNER, title: 'Vera', canonicalDomain: 'https://vera.mediafranca.net',
    });
    site.entryPoint = publicPage(corpus);
    assert.throws(
      () => projectPublicSite(corpus, scratch(), { site, publications: [] }),
      /entry point must be an explicitly published public page/,
    );
  });

  it('omite una página pública no asignada a este sitio', () => {
    const corpus = graph();
    const target = scratch();
    const site = corpus.createSite({
      owner: OWNER, title: 'Vera', canonicalDomain: 'https://vera.mediafranca.net',
    });
    const summary = projectPublicSite(corpus, target, { site, publications: [] });
    assert.equal(summary.pages, 0);
    assert.deepEqual(readdirSync(target), ['index.html']);
    assert.doesNotMatch(readFileSync(join(target, 'index.html'), 'utf8'), /Página pública/);
  });

  it('reemplaza la salida sólo después de terminar el nuevo build', () => {
    const corpus = graph();
    const target = scratch();
    writeFileSync(join(target, 'anterior.txt'), 'anterior');
    projectPublicSiteAtomically(corpus, target, published(corpus));
    assert.ok(!readdirSync(target).includes('anterior.txt'));
    assert.ok(readdirSync(target).includes('index.html'));
  });
});
