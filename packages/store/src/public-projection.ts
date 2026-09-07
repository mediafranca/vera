// Proyección pública estática.
//
// No es una variante de projectGraph: aquella proyección es un espejo privado
// y reconstruible. Esta cara sólo recibe páginas declaradas públicas y produce
// HTML sin identificadores internos, manifiesto del corpus, API ni acceso a la base.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalUrl, renderMarkdown, suggestedPathFor } from '@vera/core';
import type { Block, Page, PersonalSite, Publication, VeraGraph } from '@vera/core';

export interface PublicProjectionOptions {
  site: PersonalSite;
  /** Publicaciones de este sitio, ya separadas de cualquier otro destino. */
  publications: readonly Publication[];
  /** Directorio de la marca pública, compartido con la PWA. */
  brandingAssets?: string;
}

export interface PublicProjectionSummary {
  pages: number;
  files: string[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const publicPathFor = suggestedPathFor;

/** Únicos dos artefactos que necesita un sketch; ambos viajan con Vera. */
export const p5RuntimePath = process.env['VERA_P5_RUNTIME'] ??
  fileURLToPath(new URL('../lib/p5.min.js', import.meta.resolve('p5')));
export const p5FrameDocument = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'">
<style>:root{color-scheme:light dark;--bg:transparent;--text:currentColor;--font-body:system-ui,sans-serif}html,body{margin:0;min-height:100%;overflow:hidden;background:var(--bg);color:var(--text);font:var(--text-size,16px)/var(--line-height,1.55) var(--font-body)}canvas{display:block;max-width:100%;height:auto!important}pre{white-space:pre-wrap;color:var(--accent,#a00);padding:1rem}</style>
<script src="/p5.min.js"></script></head><body><script>
const veraFrame = 'vera-executable-frame';
const report = () => parent.postMessage({ type: veraFrame, height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) }, '*');
addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== veraFrame) return;
  const appearance = event.data.appearance;
  if (appearance === null || typeof appearance !== 'object') return;
  for (const [name, value] of Object.entries(appearance.tokens ?? {})) {
    if (/^--[a-z0-9-]+$/.test(name) && typeof value === 'string') document.documentElement.style.setProperty(name, value);
  }
  document.documentElement.dataset.scheme = appearance.scheme === 'dark' ? 'dark' : 'light';
  document.documentElement.style.colorScheme = appearance.scheme === 'dark' ? 'dark' : 'light';
  if (event.data.active === false) window.noLoop?.();
  else if (event.data.active === true) window.loop?.();
  report();
});
new ResizeObserver(report).observe(document.documentElement);
const source = decodeURIComponent(location.hash.slice(1));
const fail = error => { document.body.innerHTML = '<pre></pre>'; document.querySelector('pre').textContent = String(error?.message ?? error) + '\\n\\n' + source; };
addEventListener('error', event => fail(event.error ?? event.message));
try { (0, eval)(source); } catch (error) { fail(error); }
addEventListener('load', report);
document.fonts?.ready.then(report);
report();
</script></body></html>`;

const publicExecutableFrames = `<script>
(() => {
  const type = 'vera-executable-frame';
  const appearance = () => {
    const style = getComputedStyle(document.documentElement);
    const tokens = {};
    for (const name of ['--bg','--text','--text-dim','--rule','--accent','--text-size','--line-height','--font-body','--font-ui','--font-mono']) tokens[name] = style.getPropertyValue(name).trim();
    return { scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', tokens };
  };
  const frames = () => [...document.querySelectorAll('iframe[data-executable-frame]')];
  const send = frame => frame.contentWindow?.postMessage({ type, appearance: appearance() }, '*');
  addEventListener('message', event => {
    if (event.data?.type !== type) return;
    const frame = frames().find(one => one.contentWindow === event.source);
    if (!frame) return;
    const asked = Number.isFinite(event.data.height) ? event.data.height : 24;
    frame.style.height = Math.min(2400, Math.max(24, Math.ceil(asked))) + 'px';
    send(frame);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => frames().forEach(send));
})();
</script>`;

function sorted(blocks: Block[]): Block[] {
  return [...blocks].sort(
    (a, b) => a.position - b.position || a.stableId.localeCompare(b.stableId),
  );
}

function renderBlocks(
  graph: VeraGraph,
  page: Page,
  published: ReadonlyMap<string, { page: Page; path: string }>,
): string {
  const byParent = new Map<string | null, Block[]>();
  for (const block of graph.blocksOf(page.id)) {
    const siblings = byParent.get(block.parent) ?? [];
    siblings.push(block);
    byParent.set(block.parent, siblings);
  }

  const renderBlockMarkdown = (source: string): string =>
    renderMarkdown(source, { pageExists: (title) => published.has(title) })
      .replace(
        /<a class="wiki([^"]*) pending" data-page="[^"]*" href="#">([\s\S]*?)<\/a>/g,
        '<span class="wiki$1 unavailable">$2</span>',
      )
      .replace(
        /<a class="wiki([^"]*)" data-page="([^"]+)" href="#">([\s\S]*?)<\/a>/g,
        (_whole, extra: string, title: string, label: string) => {
          const destination = published.get(title);
          return destination === undefined
            ? `<span class="wiki${extra} unavailable">${label}</span>`
            : `<a class="wiki${extra}" href="/${destination.path}/">${label}</a>`;
        },
      );

  const render = (parent: string | null): string => {
    const children = sorted(byParent.get(parent) ?? []);
    if (children.length === 0) return '';
    return `<ul>${children
      .map((block) => `<li>${renderBlockMarkdown(block.content)}${render(block.stableId)}</li>`)
      .join('')}</ul>`;
  };
  return render(null);
}

function document(input: {
  title: string;
  siteTitle: string;
  canonicalUrl: string;
  brandImageUrl: string;
  body: string;
  branded: boolean;
}): string {
  const title = escapeHtml(input.title);
  const site = escapeHtml(input.siteTitle);
  const url = escapeHtml(input.canonicalUrl);
  const branding = input.branded
    ? [
        '<link rel="manifest" href="/site.webmanifest">',
        '<meta name="theme-color" content="#2e0024">',
        '<link rel="icon" href="/icon-16.png" sizes="16x16" type="image/png">',
        '<link rel="icon" href="/icon-32.png" sizes="32x32" type="image/png">',
        '<link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png">',
        '<link rel="shortcut icon" href="/favicon.ico">',
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
        `<meta property="og:image" content="${escapeHtml(input.brandImageUrl)}">`,
      ]
    : [];
  return [
    '<!doctype html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${title} · ${site}</title>`,
    `<link rel="canonical" href="${url}">`,
    '<meta name="robots" content="index,follow">',
    ...branding,
    '<style>',
    '@font-face{font-family:"Roboto Serif";src:url("/fonts/robotoserif-latin-wghtwdthgrad-normal.woff2") format("woff2");font-weight:100 900;font-stretch:62.5% 100%;font-style:normal;font-display:swap}',
    '@font-face{font-family:"Roboto Serif";src:url("/fonts/robotoserif-latin-wghtwdthgrad-italic.woff2") format("woff2");font-weight:100 900;font-stretch:62.5% 100%;font-style:italic;font-display:swap}',
    ':root{color-scheme:light dark;font-family:ui-serif,Georgia,Cambria,"Times New Roman",serif;line-height:1.58;background:#f7f5ef;color:#24231f}',
    '*{box-sizing:border-box}',
    'body{margin:0}',
    'main{max-width:48rem;margin:0 auto;padding:clamp(2rem,7vw,6rem) clamp(1.25rem,5vw,3rem) 8rem}',
    'h1{font-size:clamp(2.7rem,8vw,5rem);line-height:.95;letter-spacing:-.045em;margin:0 0 3rem}',
    'h2,h3{font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.15;letter-spacing:-.025em;margin:3rem 0 1rem}',
    'h3{font-size:clamp(1.35rem,3vw,1.75rem)}',
    'p{font-size:clamp(1.08rem,2vw,1.28rem);margin:0 0 1.35rem}',
    '.poem{font-family:"Roboto Serif",Georgia,"Times New Roman",ui-serif,serif;font-size:1.6em;line-height:1.18;font-weight:300;font-optical-sizing:auto;white-space:pre-wrap;overflow-wrap:normal;word-break:normal}',
    'strong{font-weight:700}',
    'ul{list-style:none;margin:0;padding:0}',
    'li>ul{border-left:1px solid color-mix(in srgb,currentColor 20%,transparent);padding-left:1.25rem}',
    'a{color:inherit;text-decoration-thickness:.08em;text-underline-offset:.18em}',
    '.unavailable{color:color-mix(in srgb,currentColor 72%,transparent)}',
    '.executable{margin:1.25rem 0}.executable iframe{display:block;width:100%;height:6rem;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:.3rem;background:inherit}.executable summary{cursor:pointer;font-family:ui-sans-serif,system-ui,sans-serif;font-size:.85rem;margin-top:.45rem}.executable pre{overflow:auto}',
    'nav{border-top:1px solid color-mix(in srgb,currentColor 20%,transparent);margin-top:4rem;padding-top:2rem;font-family:ui-sans-serif,system-ui,sans-serif}',
    '@media(prefers-color-scheme:dark){:root{background:#1c1b18;color:#ece8df}}',
    '</style>',
    '</head>',
    '<body>',
    input.body,
    publicExecutableFrames,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

const BRAND_ASSETS = [
  'apple-touch-icon.png',
  'favicon.ico',
  'icon-16.png',
  'icon-32.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
] as const;

function projectBranding(target: string, source: string, siteTitle: string): string[] {
  for (const filename of BRAND_ASSETS) copyFileSync(join(source, filename), join(target, filename));
  writeFileSync(
    join(target, 'site.webmanifest'),
    `${JSON.stringify(
      {
        name: siteTitle,
        short_name: siteTitle,
        start_url: '/',
        display: 'standalone',
        background_color: '#2e0024',
        theme_color: '#2e0024',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return [...BRAND_ASSETS, 'site.webmanifest'];
}

function clear(target: string): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(target);
  } catch {
    return;
  }
  for (const entry of entries) rmSync(join(target, entry), { recursive: true, force: true });
}

export function projectPublicSite(
  graph: VeraGraph,
  target: string,
  options: PublicProjectionOptions,
): PublicProjectionSummary {
  mkdirSync(target, { recursive: true });
  clear(target);

  const pages = options.publications
    .map((publication) => {
      if (publication.site !== options.site.id) {
        throw new Error(`publication ${publication.id} belongs to another site`);
      }
      const page = graph.page(publication.page);
      if (page === undefined || page.visibility !== 'public') {
        throw new Error(`publication ${publication.id} does not name a public page`);
      }
      return { page, publication };
    })
    .sort((a, b) => a.page.title.localeCompare(b.page.title));
  const files: string[] = [];
  const occupiedPaths = new Map<string, string>();
  const entryPoint =
    options.site.entryPoint === null
      ? null
      : pages.find(({ page }) => page.id === options.site.entryPoint) ?? null;
  if (options.site.entryPoint !== null && entryPoint === null) {
    throw new Error('entry point must be an explicitly published public page');
  }
  const publishedByTitle = new Map(
    pages.map(({ page, publication }) => [page.title, { page, path: publication.path }]),
  );

  for (const { page, publication } of pages) {
    const path = publication.path;
    const occupiedBy = occupiedPaths.get(path);
    if (occupiedBy !== undefined) {
      throw new Error(`public path collision: ${occupiedBy} and ${page.title} both become /${path}/`);
    }
    occupiedPaths.set(path, page.title);
    const directory = join(target, path);
    mkdirSync(directory, { recursive: true });
    const relative = `${path}/index.html`;
    writeFileSync(
      join(target, relative),
      document({
        title: page.title,
        siteTitle: options.site.title,
        canonicalUrl: canonicalUrl(options.site.canonicalDomain, path),
        brandImageUrl: `${options.site.canonicalDomain.replace(/\/+$/, '')}/icon-512.png`,
        body: `<main><h1>${escapeHtml(page.title)}</h1>${renderBlocks(graph, page, publishedByTitle)}</main>`,
        branded: options.brandingAssets !== undefined,
      }),
      'utf8',
    );
    files.push(relative);
  }

  const links = pages
    .filter(({ page }) => page.id !== entryPoint?.page.id)
    .map(({ page, publication }) => `<li><a href="./${publication.path}/">${escapeHtml(page.title)}</a></li>`)
    .join('');
  const indexTitle = entryPoint?.page.title ?? options.site.title;
  const indexBody =
    entryPoint === null
      ? `<main><h1>${escapeHtml(options.site.title)}</h1><ul>${links}</ul></main>`
      : `<main><h1>${escapeHtml(entryPoint.page.title)}</h1>${renderBlocks(graph, entryPoint.page, publishedByTitle)}${
          links === '' ? '' : `<nav aria-label="Páginas publicadas"><ul>${links}</ul></nav>`
        }</main>`;
  writeFileSync(
    join(target, 'index.html'),
    document({
      title: indexTitle,
      siteTitle: options.site.title,
      canonicalUrl: canonicalUrl(options.site.canonicalDomain, ''),
      brandImageUrl: `${options.site.canonicalDomain.replace(/\/+$/, '')}/icon-512.png`,
      body: indexBody,
      branded: options.brandingAssets !== undefined,
    }),
    'utf8',
  );
  files.unshift('index.html');
  const needsP5 = pages.some(({ page }) =>
    graph.blocksOf(page.id).some((block) => /^\s*(`{3,}|~{3,})\s*p5js\s*$/im.test(block.content))
  );
  if (needsP5) {
    copyFileSync(p5RuntimePath, join(target, 'p5.min.js'));
    writeFileSync(join(target, 'p5-frame.html'), p5FrameDocument, 'utf8');
    files.push('p5.min.js', 'p5-frame.html');
  }
  if (options.brandingAssets !== undefined) {
    files.push(...projectBranding(target, options.brandingAssets, options.site.title));
  }

  return { pages: pages.length, files };
}

/** Construye al lado y sólo cambia la salida visible cuando el build terminó entero. */
export function projectPublicSiteAtomically(
  graph: VeraGraph,
  target: string,
  options: PublicProjectionOptions,
): PublicProjectionSummary {
  const next = `${target}.next`;
  const previous = `${target}.previous`;
  rmSync(next, { recursive: true, force: true });
  rmSync(previous, { recursive: true, force: true });
  try {
    const summary = projectPublicSite(graph, next, options);
    if (existsSync(target)) renameSync(target, previous);
    renameSync(next, target);
    rmSync(previous, { recursive: true, force: true });
    return summary;
  } catch (error) {
    rmSync(next, { recursive: true, force: true });
    if (!existsSync(target) && existsSync(previous)) renameSync(previous, target);
    throw error;
  }
}
