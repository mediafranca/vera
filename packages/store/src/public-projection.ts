// Proyección pública estática.
//
// No es una variante de projectGraph: aquella proyección es un espejo privado
// y reconstruible. Esta cara sólo recibe páginas declaradas públicas y produce
// HTML sin identificadores internos, manifiesto del corpus, API ni acceso a la base.

import {
  copyFileSync,
  cpSync,
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
  /** Biblioteca de diseños v2 de la persona dueña, proyectada sin otro estado privado. */
  ownerDesignLibrary?: string | null;
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

interface PublicDesignToken {
  name: string;
  light: string;
  dark: string;
}

interface PublicDesign {
  id: string;
  name: string;
  tokens: PublicDesignToken[];
}

interface PublicDesignLibrary {
  active: string;
  common: PublicDesignToken[];
  designs: PublicDesign[];
}

const PUBLIC_TOKEN_NAMES = new Set([
  '--bg', '--bg-raised', '--text', '--text-dim', '--rule', '--accent',
  '--node-central', '--node-text', '--link-stroke', '--link-in', '--link-out',
  '--warm', '--voice', '--success', '--warning', '--danger', '--phone-scale',
  '--text-size', '--line-height', '--content-width', '--indent',
  '--font-body', '--font-ui', '--font-mono',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function safePublicToken(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 512 &&
    !/[\u0000-\u001f\u007f{};<>]/.test(value) && !/url\s*\(|@import/i.test(value);
}

function publicDesignTokens(value: unknown): PublicDesignToken[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tokens: PublicDesignToken[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry['name'] !== 'string') continue;
    const name = entry['name'];
    if (!PUBLIC_TOKEN_NAMES.has(name) || seen.has(name) ||
        !safePublicToken(entry['light']) || !safePublicToken(entry['dark'])) continue;
    seen.add(name);
    tokens.push({ name, light: entry['light'], dark: entry['dark'] });
  }
  return tokens;
}

function publicDesignLibrary(source: string | null | undefined): PublicDesignLibrary | null {
  if (source === null || source === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isRecord(value) || value['format'] !== 'vera.designs' || value['version'] !== 2 ||
      !Array.isArray(value['designs'])) return null;
  const designs: PublicDesign[] = [];
  const seen = new Set<string>();
  for (const entry of value['designs']) {
    if (!isRecord(entry) || typeof entry['id'] !== 'string' ||
        typeof entry['name'] !== 'string') continue;
    const id = entry['id'].trim();
    const name = entry['name'].trim();
    if (id === '' || name === '' || id.length > 160 || name.length > 120 || seen.has(id)) continue;
    seen.add(id);
    designs.push({ id, name, tokens: publicDesignTokens(entry['tokens']) });
  }
  if (designs.length === 0) return null;
  const asked = typeof value['active'] === 'string' ? value['active'] : '';
  const active = designs.some((design) => design.id === asked) ? asked : designs[0]!.id;
  return { active, common: publicDesignTokens(value['common']), designs };
}

function tokensFor(design: PublicDesign, common: PublicDesignToken[], scheme: 'light' | 'dark'):
  Record<string, string> {
  return Object.fromEntries([...common, ...design.tokens].map((token) => [token.name, token[scheme]]));
}

function cssDeclarations(tokens: Record<string, string>): string {
  return Object.entries(tokens).map(([name, value]) => `${name}:${value}`).join(';');
}

function publicAppearance(library: PublicDesignLibrary | null): {
  attributes: string;
  controls: string;
  css: string;
  script: string;
  theme: string;
} {
  if (library === null) return { attributes: '', controls: '', css: '', script: '', theme: '#202224' };
  const active = library.designs.find((design) => design.id === library.active) ?? library.designs[0]!;
  const light = tokensFor(active, library.common, 'light');
  const dark = tokensFor(active, library.common, 'dark');
  const serialised = JSON.stringify(library).replace(/</g, '\\u003c');
  const options = library.designs.map((design) =>
    `<option value="${escapeHtml(design.id)}"${design.id === active.id ? ' selected' : ''}>${escapeHtml(design.name)}</option>`
  ).join('');
  const controls = `<aside class="public-appearance" aria-label="Apariencia"><label>Diseño<select id="public-design" aria-label="Diseño">${options}</select></label><label>Color<select id="public-scheme" aria-label="Esquema de color"><option value="system">Sistema</option><option value="light">Claro</option><option value="dark">Oscuro</option></select></label></aside>`;
  const css = [
    `:root{${cssDeclarations(light)}}`,
    `:root[data-scheme="dark"]{${cssDeclarations(dark)}}`,
    `@media(prefers-color-scheme:dark){:root:not([data-scheme]){${cssDeclarations(dark)}}}`,
  ].join('\n');
  const script = `<script type="application/json" id="vera-public-designs">${serialised}</script>
<script>(()=>{
const root=document.documentElement,designKey='vera.public.design',schemeKey='vera.public.scheme';
const library=JSON.parse(document.getElementById('vera-public-designs').textContent),designInput=document.getElementById('public-design'),schemeInput=document.getElementById('public-scheme');
const byId=id=>library.designs.find(design=>design.id===id),read=key=>{try{return localStorage.getItem(key)}catch{return null}},write=(key,value)=>{try{localStorage.setItem(key,value)}catch{}};
const resolvedScheme=choice=>choice==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):choice;
const apply=()=>{const design=byId(designInput.value)||byId(library.active)||library.designs[0],choice=schemeInput.value,scheme=resolvedScheme(choice),tokens=[...library.common,...design.tokens],names=new Set([...library.common,...library.designs.flatMap(one=>one.tokens)].map(token=>token.name));root.dataset.design=design.id;root.dataset.scheme=scheme;for(const name of names)root.style.removeProperty(name);for(const token of tokens)root.style.setProperty(token.name,token[scheme]);const theme=document.querySelector('meta[name="theme-color"]');if(theme)theme.content=getComputedStyle(root).getPropertyValue('--bg').trim();dispatchEvent(new CustomEvent('vera-public-appearance'));};
const rememberedDesign=read(designKey),rememberedScheme=read(schemeKey);designInput.value=byId(rememberedDesign)?.id||library.active;schemeInput.value=['system','light','dark'].includes(rememberedScheme)?rememberedScheme:'system';
designInput.addEventListener('change',()=>{write(designKey,designInput.value);apply()});schemeInput.addEventListener('change',()=>{write(schemeKey,schemeInput.value);apply()});matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(schemeInput.value==='system')apply()});apply();
})();</script>`;
  return {
    attributes: ` data-design="${escapeHtml(active.id)}"`, controls, css, script,
    theme: light['--bg'] ?? '#202224',
  };
}

export const publicPathFor = suggestedPathFor;

/** Únicos dos artefactos que necesita un sketch; ambos viajan con Vera. */
export const p5RuntimePath = process.env['VERA_P5_RUNTIME'] ??
  fileURLToPath(new URL('../lib/p5.min.js', import.meta.resolve('p5')));
export const p5FrameDocument = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'">
<style>:root{color-scheme:light dark;--bg:transparent;--text:currentColor;--font-body:system-ui,sans-serif}html,body{margin:0;min-height:100%;overflow:hidden;background:var(--bg);color:var(--text);font:var(--text-size,16px)/var(--line-height,1.55) var(--font-body)}canvas{display:block;max-width:100%;height:auto!important}html[data-presentation="true"],html[data-presentation="true"] body{width:100%;height:100%}html[data-presentation="true"] canvas{width:100%!important;height:auto!important;max-width:none;max-height:100%;object-fit:contain}pre{white-space:pre-wrap;color:var(--accent,#a00);padding:1rem}</style>
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
  if (typeof appearance.fontFaces === 'string') {
    let fonts = document.getElementById('vera-frame-fonts');
    if (fonts === null) {
      fonts = document.createElement('style');
      fonts.id = 'vera-frame-fonts';
      document.head.append(fonts);
    }
    if (fonts.textContent !== appearance.fontFaces) fonts.textContent = appearance.fontFaces;
  }
  document.documentElement.dataset.scheme = appearance.scheme === 'dark' ? 'dark' : 'light';
  document.documentElement.style.colorScheme = appearance.scheme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.presentation = event.data.presentation === true ? 'true' : 'false';
  if (event.data.active === false) window.noLoop?.();
  else if (event.data.active === true) window.loop?.();
  report();
});
// p5 crea el canvas después de que el documento ya terminó de cargar. Observar
// sólo la raíz no basta: con overflow:hidden su caja puede conservar las seis
// líneas iniciales aunque el canvas ya desborde. La mutación descubre la
// inserción y el ResizeObserver del body acompaña cambios posteriores.
new ResizeObserver(report).observe(document.documentElement);
new ResizeObserver(report).observe(document.body);
new MutationObserver(report).observe(document.body, { childList: true, subtree: true });
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
    for (const name of [
      '--bg','--bg-raised','--text','--text-dim','--rule','--accent',
      '--node-central','--node-text','--link-stroke','--link-in','--link-out',
      '--warm','--voice','--success','--warning','--danger','--phone-scale',
      '--text-size','--line-height','--content-width','--indent',
      '--font-body','--font-ui','--font-mono'
    ]) tokens[name] = style.getPropertyValue(name).trim();
    return { scheme: document.documentElement.dataset.scheme === 'dark' ? 'dark' : 'light', tokens };
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
  addEventListener('vera-public-appearance', () => frames().forEach(send));
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
  publication: Publication,
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

  const operations = graph.operations();
  const boundary = operations.find((one) => one.id === publication.firstRevision)?.sequence ?? 0;
  const publicHistory = (block: Block): string => {
    if (!publication || !graph.site(publication.site)?.transparentBlockTraceability) return '';
    const changes = operations.filter((one) => {
      const change = one.submission.change;
      return one.sequence >= boundary && (
        (change.kind === 'create_block' && one.subjectId === block.stableId) ||
        ((change.kind === 'edit_block' || change.kind === 'move_block' ||
          change.kind === 'remove_block') && change.block === block.stableId)
      );
    });
    const before = [...operations].reverse().find((one) => {
      const change = one.submission.change;
      return one.sequence < boundary && (
        (change.kind === 'create_block' && one.subjectId === block.stableId) ||
        (change.kind === 'edit_block' && change.block === block.stableId)
      );
    });
    const initial = before === undefined || changes.some((one) => one.sequence === boundary) ? [] : [{
      at: publication.publishedAt,
      by: graph.participant(before.submission.submittedBy)?.name ?? 'autor desconocido',
      what: 'al publicarse',
      content: before.submission.change.kind === 'create_block' ||
        before.submission.change.kind === 'edit_block'
        ? before.submission.change.content
        : null,
    }];
    const states = [...initial, ...changes.map((one) => {
      const change = one.submission.change;
      return {
        at: one.appliedAt,
        by: graph.participant(one.submission.submittedBy)?.name ?? 'autor desconocido',
        what: change.kind === 'create_block' ? 'nació' : change.kind === 'edit_block'
          ? 'se escribió' : change.kind === 'move_block' ? 'se mudó' : 'se borró',
        content: change.kind === 'create_block' || change.kind === 'edit_block'
          ? change.content : null,
      };
    })];
    const rows = states.map((state) => `<li><time datetime="${new Date(state.at).toISOString()}">${
      new Date(state.at).toISOString().slice(0, 10)
    }</time> · ${escapeHtml(state.what)} · ${escapeHtml(state.by)}${
      state.content === null ? '' : `<div>${renderBlockMarkdown(state.content)}</div>`
    }</li>`).join('');
    return `<ol class="block-history">${rows || '<li>Sin cambios desde que se publicó.</li>'}</ol>`;
  };

  const render = (parent: string | null): string => {
    const children = sorted(byParent.get(parent) ?? []);
    if (children.length === 0) return '';
    return `<ul>${children
      .map((block) => graph.site(publication.site)?.transparentBlockTraceability
        ? `<li><details class="traceable-block"><summary>${renderBlockMarkdown(block.content)}</summary>${
            publicHistory(block)
          }</details>${render(block.stableId)}</li>`
        : `<li>${renderBlockMarkdown(block.content)}${render(block.stableId)}</li>`)
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
  designLibrary: PublicDesignLibrary | null;
}): string {
  const title = escapeHtml(input.title);
  const site = escapeHtml(input.siteTitle);
  const url = escapeHtml(input.canonicalUrl);
  const appearance = publicAppearance(input.designLibrary);
  const branding = input.branded
    ? [
        '<link rel="manifest" href="/site.webmanifest">',
        `<meta name="theme-color" content="${escapeHtml(appearance.theme)}">`,
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
    `<html lang="es"${appearance.attributes}>`,
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
    '@font-face{font-family:"IBM Plex Sans";src:url("/fonts/plex-sans-variable.woff2") format("woff2");font-weight:100 700;font-style:normal;font-display:swap}',
    '@font-face{font-family:"IBM Plex Sans";src:url("/fonts/plex-sans-variable-italic.woff2") format("woff2");font-weight:100 700;font-style:italic;font-display:swap}',
    '@font-face{font-family:"IBM Plex Mono";src:url("/fonts/plex-mono-400.woff2") format("woff2");font-weight:400;font-style:normal;font-display:swap}',
    '@font-face{font-family:"IBM Plex Mono";src:url("/fonts/plex-mono-600.woff2") format("woff2");font-weight:600;font-style:normal;font-display:swap}',
    ':root{color-scheme:light dark;font-family:var(--font-body,ui-serif,Georgia,Cambria,"Times New Roman",serif);line-height:var(--line-height,1.58);background:var(--bg,#f7f5ef);color:var(--text,#24231f)}',
    appearance.css,
    '*{box-sizing:border-box}',
    'body{margin:0}',
    'main{max-width:48rem;margin:0 auto;padding:clamp(2rem,7vw,6rem) clamp(1.25rem,5vw,3rem) 8rem}',
    'h1{font-size:clamp(2.7rem,8vw,5rem);line-height:.95;letter-spacing:-.045em;margin:0 0 3rem}',
    'h2,h3{font-family:var(--font-ui,ui-sans-serif,system-ui,sans-serif);line-height:1.15;letter-spacing:-.025em;margin:3rem 0 1rem}',
    'h3{font-size:clamp(1.35rem,3vw,1.75rem)}',
    'p{font-size:clamp(1.08rem,2vw,1.28rem);margin:0 0 1.35rem}',
    '.poem{font-family:"Roboto Serif",Georgia,"Times New Roman",ui-serif,serif;font-size:1.6em;line-height:1.18;font-weight:300;font-optical-sizing:auto;white-space:pre-wrap;overflow-wrap:normal;word-break:normal}',
    'strong{font-weight:700}',
    'ul{list-style:none;margin:0;padding:0}',
    'li>ul{border-left:1px solid color-mix(in srgb,currentColor 20%,transparent);padding-left:1.25rem}',
    '.public-appearance{position:sticky;z-index:2;top:0;display:flex;justify-content:flex-end;gap:.7rem;padding:.6rem clamp(1rem,4vw,2rem);border-bottom:1px solid var(--rule,color-mix(in srgb,currentColor 20%,transparent));background:color-mix(in srgb,var(--bg,#f7f5ef) 92%,transparent);backdrop-filter:blur(12px);font:clamp(.76rem,1.5vw,.88rem)/1.2 var(--font-ui,ui-sans-serif,system-ui,sans-serif)}',
    '.public-appearance label{display:flex;align-items:center;gap:.4rem;color:var(--text-dim,currentColor)}.public-appearance select{min-height:2.2rem;padding:.35rem 1.8rem .35rem .55rem;border:1px solid var(--rule,color-mix(in srgb,currentColor 22%,transparent));border-radius:.25rem;background:var(--bg-raised,var(--bg,#f7f5ef));color:var(--text,currentColor);font:inherit}',
    '.traceable-block>summary{cursor:pointer;list-style-position:outside;margin-left:1rem;padding-left:.25rem}',
    '.traceable-block>summary::marker{color:color-mix(in srgb,currentColor 58%,transparent)}',
    '.traceable-block>summary>p{display:inline}',
    '.block-history{margin:.65rem 0 1rem 1.25rem;padding-left:1rem;border-left:1px solid color-mix(in srgb,currentColor 20%,transparent);font:clamp(.78rem,1.6vw,.9rem)/1.5 ui-sans-serif,system-ui,sans-serif;color:color-mix(in srgb,currentColor 76%,transparent)}',
    '.block-history li{margin:.45rem 0}.block-history p{font:inherit;margin:.2rem 0;color:inherit}',
    'a{color:inherit;text-decoration-thickness:.08em;text-underline-offset:.18em}',
    '.unavailable{color:color-mix(in srgb,currentColor 72%,transparent)}',
    '.executable{margin:1.25rem 0}.executable iframe{display:block;width:100%;height:6rem;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:.3rem;background:inherit}.executable summary{cursor:pointer;font-family:ui-sans-serif,system-ui,sans-serif;font-size:.85rem;margin-top:.45rem}.executable pre{overflow:auto}',
    'nav{border-top:1px solid color-mix(in srgb,currentColor 20%,transparent);margin-top:4rem;padding-top:2rem;font-family:var(--font-ui,ui-sans-serif,system-ui,sans-serif)}',
    '@media(prefers-color-scheme:dark){:root:not([data-design]){background:#1c1b18;color:#ece8df}}',
    '@media(max-width:520px){.public-appearance{justify-content:stretch}.public-appearance label{flex:1;display:grid}.public-appearance select{width:100%}}',
    '</style>',
    '</head>',
    '<body>',
    appearance.controls,
    input.body,
    publicExecutableFrames,
    appearance.script,
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
  const fontFiles = readdirSync(join(source, 'fonts'));
  cpSync(join(source, 'fonts'), join(target, 'fonts'), { recursive: true });
  writeFileSync(
    join(target, 'site.webmanifest'),
    `${JSON.stringify(
      {
        name: siteTitle,
        short_name: siteTitle,
        start_url: '/',
        display: 'standalone',
        background_color: '#202224',
        theme_color: '#202224',
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
  return [...BRAND_ASSETS, ...fontFiles.map((filename) => `fonts/${filename}`), 'site.webmanifest'];
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
  const designLibrary = publicDesignLibrary(options.ownerDesignLibrary);

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
        body: `<main><h1>${escapeHtml(page.title)}</h1>${renderBlocks(graph, page, publishedByTitle, publication)}</main>`,
        branded: options.brandingAssets !== undefined,
        designLibrary,
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
      : `<main><h1>${escapeHtml(entryPoint.page.title)}</h1>${renderBlocks(graph, entryPoint.page, publishedByTitle, entryPoint.publication)}${
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
      designLibrary,
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
