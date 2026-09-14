import Reveal from 'reveal.js';
import RevealNotes from 'reveal.js/plugin/notes';

import { renderMarkdown, type RenderOptions } from '@vera/core';
import { api, type BlockView, type PageView } from './api.ts';
import { decorateCodeBlocks } from './code-copy.ts';
import { icon, type IconName } from './icons.ts';
import { renderMermaid } from './mermaid.ts';
import {
  DEFAULT_PRESENTATION_STYLESHEET,
  presentationThemeTitle,
  scopedPresentationStylesheet,
  stylesheetSource,
  validateStylesheetSource,
} from './presentation-style.ts';

interface PresentationNode {
  block: BlockView;
  children: PresentationNode[];
}

const STYLE_CACHE_PREFIX = 'vera.presentation.stylesheet.';

interface LoadedPresentationStyle {
  css: string;
  warnings: string[];
}

export function presentationRevision(page: Pick<PageView, 'lastEditedAt' | 'blocks'>): string {
  return `${page.lastEditedAt ?? 0}:${page.blocks.length}`;
}

export function presentationLocation(source: URL, block: string, active: boolean): string {
  const url = new URL(source);
  url.searchParams.delete('present');
  url.hash = '';
  if (active) url.searchParams.set('present', block);
  else if (block !== '') url.hash = encodeURIComponent(block);
  return `${url.pathname}${url.search}${url.hash}`;
}

async function loadStylesheet(title: string): Promise<{ css: string; warning: string | null }> {
  const cacheKey = `${STYLE_CACHE_PREFIX}${title}`;
  try {
    const page = await api.page(title, 4_000);
    const source = stylesheetSource(page);
    const validation = validateStylesheetSource(source);
    if (!validation.valid) {
      return {
        css: localStorage.getItem(cacheKey) ?? '',
        warning: `${title}: ${validation.reason}; se conserva la última versión válida`,
      };
    }
    localStorage.setItem(cacheKey, source);
    return { css: source, warning: null };
  } catch {
    const held = localStorage.getItem(cacheKey);
    return {
      css: held ?? '',
      warning: held === null ? `${title}: no se pudo leer la hoja` : `${title}: se usa la última versión disponible`,
    };
  }
}

async function presentationStyles(page: PageView): Promise<LoadedPresentationStyle> {
  const chosen = presentationThemeTitle(page.properties);
  const titles = chosen === null || chosen === DEFAULT_PRESENTATION_STYLESHEET
    ? [DEFAULT_PRESENTATION_STYLESHEET]
    : [DEFAULT_PRESENTATION_STYLESHEET, chosen];
  const loaded = await Promise.all(titles.map(loadStylesheet));
  return {
    css: loaded.map((one) => one.css).filter(Boolean).join('\n'),
    warnings: loaded.flatMap((one) => one.warning === null ? [] : [one.warning]),
  };
}

export function isPresentation(
  properties: readonly { key: string; value: string }[],
  kindProperty: string,
): boolean {
  // La ontología nombra la clase; este adaptador le da una proyección. Reveal
  // no forma parte del significado guardado en el corpus.
  // @guarantee DeclaredPresentationsOfferPresentationProminently
  const kind = properties
    .find((property) => property.key.trim().toLowerCase() === kindProperty.trim().toLowerCase())
    ?.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return kind === 'presentacion';
}

function treeOf(blocks: readonly BlockView[]): PresentationNode[] {
  const nodes = new Map<string, PresentationNode>();
  for (const block of blocks) nodes.set(block.stableId, { block, children: [] });
  const roots: PresentationNode[] = [];
  for (const block of blocks) {
    const node = nodes.get(block.stableId)!;
    const parent = block.parent === null ? undefined : nodes.get(block.parent);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  const sort = (held: PresentationNode[]): void => {
    held.sort((a, b) => a.block.position - b.block.position);
    for (const node of held) sort(node.children);
  };
  sort(roots);
  return roots;
}

function renderNode(node: PresentationNode, options: RenderOptions, depth = 0): HTMLElement {
  const host = document.createElement('div');
  host.className = `presentation-block presentation-depth-${Math.min(depth, 4)}`;
  host.dataset['block'] = node.block.stableId;
  const body = document.createElement('div');
  body.className = 'body';
  body.innerHTML = renderMarkdown(node.block.content, options);
  host.append(body);
  if (node.children.length > 0) {
    const children = document.createElement('div');
    children.className = 'presentation-children';
    for (const child of node.children) children.append(renderNode(child, options, depth + 1));
    host.append(children);
  }
  return host;
}

export async function presentPage(
  page: PageView,
  options: RenderOptions,
  onNavigate: (title: string) => void,
  initialBlock: string | null = null,
  appearance: {
    scheme?: (() => 'light' | 'dark') | undefined;
    onScheme?: ((scheme: 'light' | 'dark') => void) | undefined;
  } = {},
): Promise<void> {
  // @invariant ThePageRemainsTheSource
  // @invariant PresentationDoesNotFlattenTheOutline
  // @invariant PresenterNotesAreGlosses
  document.querySelector('.vera-presentation')?.remove();
  let sourcePage = page;
  let roots = treeOf(sourcePage.blocks);
  if (roots.length === 0) return;
  const governedStyle = await presentationStyles(sourcePage);
  const syncFrames = (): void => { dispatchEvent(new Event('vera-sync-executable-frames')); };

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const overlay = document.createElement('div');
  overlay.className = 'vera-presentation';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Presentación: ${page.title}`);

  if (governedStyle.css !== '') {
    const style = document.createElement('style');
    style.dataset['veraPresentationStyle'] = 'governed';
    style.textContent = scopedPresentationStylesheet(governedStyle.css);
    overlay.append(style);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'presentation-close';
  close.innerHTML = icon('x');
  close.title = 'Salir';
  close.setAttribute('aria-label', 'Salir de la presentación');

  const toolbar = document.createElement('div');
  toolbar.className = 'presentation-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Controles de la presentación');
  const control = (label: string, symbol: IconName): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = icon(symbol);
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
  };
  const previous = control('Anterior', 'chevron-left');
  const next = control('Siguiente', 'chevron-right');
  const overview = control('Vista general', 'grid');
  const notesToggle = control('Notas', 'feather');
  notesToggle.setAttribute('aria-pressed', 'false');
  const fullscreen = control('Pantalla completa', 'maximize');
  const scheme = control('Modo claro', 'sun');
  scheme.className = 'presentation-scheme';
  const showScheme = (): void => {
    const dark = (appearance.scheme?.() ?? document.documentElement.dataset['scheme']) === 'dark';
    const label = dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
    scheme.innerHTML = icon(dark ? 'sun' : 'moon');
    scheme.title = label;
    scheme.setAttribute('aria-label', label);
    scheme.setAttribute('aria-pressed', String(dark));
  };
  showScheme();
  const refresh = control('Actualizar', 'refresh-cw');
  refresh.hidden = true;

  const reveal = document.createElement('div');
  reveal.className = 'reveal';
  const stage = document.createElement('div');
  stage.className = 'presentation-stage';
  const slides = document.createElement('div');
  slides.className = 'slides';
  reveal.append(slides);
  stage.append(reveal);
  const privateNotes = document.createElement('aside');
  privateNotes.className = 'presentation-private-notes';
  privateNotes.hidden = true;
  privateNotes.setAttribute('aria-label', 'Glosa de la lámina');
  toolbar.append(previous, next, overview, notesToggle, fullscreen, scheme, refresh, close);
  overlay.append(stage, privateNotes, toolbar);
  if (governedStyle.warnings.length > 0) {
    const warning = document.createElement('p');
    warning.className = 'presentation-style-warning';
    warning.setAttribute('role', 'status');
    warning.textContent = governedStyle.warnings.join(' · ');
    overlay.append(warning);
  }
  document.body.append(overlay);

  const fillSlides = (): void => {
    slides.replaceChildren();
    for (const root of roots) {
      const column = document.createElement('section');
      // Una raíz con hijos nombra y ordena una columna; no añade por obligación
      // una portada antes de su primer contenido. Así una columna cuyo primer
      // hijo es un iframe empieza efectivamente por el iframe.
      const members = root.children.length === 0 ? [root] : root.children;
      for (const member of members) {
        const slide = document.createElement('section');
        slide.dataset['block'] = member.block.stableId;
        slide.append(renderNode(member, options));
        const gloss = sourcePage.glosses?.[member.block.stableId]?.content.trim() ?? '';
        if (gloss !== '') {
          const notes = document.createElement('aside');
          notes.className = 'notes';
          notes.innerHTML = renderMarkdown(gloss, options);
          slide.append(notes);
        }
        column.append(slide);
      }
      if (members.length === 1) {
        const slide = column.firstElementChild!;
        slides.append(slide);
      } else {
        column.dataset['block'] = root.block.stableId;
        column.dataset['presentationColumn'] = 'true';
        column.dataset['presentationTitle'] = root.block.content;
        column.setAttribute('aria-label', root.block.content);
        slides.append(column);
      }
    }
  };
  fillSlides();

  decorateCodeBlocks(overlay);
  await renderMermaid(overlay);

  const deck = new Reveal(reveal, {
    embedded: true,
    // El escenario de Vera ya es el viewport completo. Reveal no necesita
    // imponer además su lienzo histórico de 960 × 700 ni reservar otro margen:
    // hacerlo encoge y desplaza contenido que debería aprovechar la pantalla.
    width: '100%',
    height: '100%',
    margin: 0,
    controls: true,
    progress: true,
    // Una lámina es una página legible, no una tarjeta que siempre quepa. El
    // centrado de Reveal convertía el exceso de altura de SVG, p5.js e iframes
    // en un gran vacío superior y dejaba el comienzo fuera de alcance.
    center: false,
    hash: false,
    history: false,
    transition: 'slide',
    backgroundTransition: 'fade',
    plugins: [RevealNotes],
  });

  let closed = false;
  let revisionWatch = 0;
  let heldRevision = presentationRevision(sourcePage);
  const sourceUrl = new URL(window.location.href);
  sourceUrl.searchParams.delete('present');
  const currentBlock = (): string | null => deck.getCurrentSlide()?.dataset['block'] ?? null;
  const updateNotes = (): void => {
    const block = currentBlock();
    const gloss = block === null ? '' : sourcePage.glosses?.[block]?.content.trim() ?? '';
    privateNotes.innerHTML = gloss === '' ? '<p>Esta lámina no tiene glosa.</p>' : renderMarkdown(gloss, options);
  };
  const writeDeepLink = (): void => {
    const block = currentBlock();
    if (block === null) return;
    history.replaceState(history.state, '', presentationLocation(sourceUrl, block, true));
  };
  const leave = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    window.clearInterval(revisionWatch);
    removeEventListener('keydown', onKey, true);
    const block = currentBlock();
    await deck.destroy();
    overlay.remove();
    document.documentElement.classList.remove('presenting');
    if (document.fullscreenElement !== null) await document.exitFullscreen().catch(() => undefined);
    history.replaceState(history.state, '', presentationLocation(sourceUrl, block ?? '', false));
    const source = block === null ? null : document.querySelector<HTMLElement>(`[data-block="${CSS.escape(block)}"]`);
    if (source !== null) {
      source.scrollIntoView({ block: 'center' });
      source.focus({ preventScroll: true });
    } else previousFocus?.focus({ preventScroll: true });
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void leave();
  };

  close.addEventListener('click', () => void leave());
  previous.addEventListener('click', () => deck.prev());
  next.addEventListener('click', () => deck.next());
  overview.addEventListener('click', () => deck.toggleOverview());
  scheme.addEventListener('click', () => {
    const current = (appearance.scheme?.() ?? document.documentElement.dataset['scheme']) === 'dark'
      ? 'dark'
      : 'light';
    appearance.onScheme?.(current === 'dark' ? 'light' : 'dark');
    showScheme();
    void renderMermaid(overlay);
  });
  notesToggle.addEventListener('click', () => {
    privateNotes.hidden = !privateNotes.hidden;
    notesToggle.setAttribute('aria-pressed', String(!privateNotes.hidden));
    updateNotes();
  });
  fullscreen.addEventListener('click', () => {
    void (document.fullscreenElement === null ? overlay.requestFullscreen() : document.exitFullscreen());
  });
  refresh.addEventListener('click', () => {
    const block = currentBlock();
    void api.page(sourcePage.id, 4_000).then(async (newer) => {
      const newerRoots = treeOf(newer.blocks);
      if (newerRoots.length === 0) {
        refresh.title = 'Actualización rechazada: página vacía';
        refresh.setAttribute('aria-label', refresh.title);
        return;
      }
      sourcePage = newer;
      roots = newerRoots;
      heldRevision = presentationRevision(newer);
      fillSlides();
      deck.sync();
      if (block !== null) {
        const index = roots.findIndex((root) => root.block.stableId === block);
        if (index >= 0) deck.slide(index);
      }
      refresh.hidden = true;
      refresh.title = 'Actualizar';
      refresh.setAttribute('aria-label', refresh.title);
      updateNotes();
    }).catch(() => {
      refresh.title = 'No se pudo actualizar';
      refresh.setAttribute('aria-label', refresh.title);
    });
  });
  overlay.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a.wiki');
    if (link === null) return;
    event.preventDefault();
    const title = link.dataset['page'] ?? '';
    void leave().then(() => onNavigate(title));
  });
  addEventListener('keydown', onKey, true);
  document.documentElement.classList.add('presenting');
  await deck.initialize();
  deck.on('overviewshown', () => {
    // En lectura corriente los recintos siguen siendo perezosos. Sólo al pedir
    // la vista general Safari recibe la orden de producir una miniatura de cada
    // uno; el puente de p5 detiene enseguida los que no están activos.
    for (const frame of overlay.querySelectorAll<HTMLIFrameElement>('iframe[loading="lazy"]')) {
      frame.loading = 'eager';
    }
    syncFrames();
  });
  deck.on('overviewhidden', syncFrames);
  if (initialBlock !== null) {
    const initial = deck.getSlides().find((slide) => slide.dataset['block'] === initialBlock);
    if (initial !== undefined) {
      const indices = deck.getIndices(initial);
      deck.slide(indices.h, indices.v);
    }
  }
  deck.on('slidechanged', () => { updateNotes(); writeDeepLink(); syncFrames(); });
  updateNotes();
  writeDeepLink();
  revisionWatch = window.setInterval(() => {
    void api.page(sourcePage.id, 4_000).then((newer) => {
      refresh.hidden = presentationRevision(newer) === heldRevision;
    }).catch(() => undefined);
  }, 15_000);
  close.focus({ preventScroll: true });
}
