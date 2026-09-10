// Outliner de bloques con edición Markdown nativa.
//
// @invariant SourceRemainsMarkdown: al editar se ve y se guarda el Markdown del
// bloque, no un formato opaco.
//
// @invariant EditingRevealsTheSource: enfocar un bloque reemplaza su
// presentación renderizada por la fuente exacta que la produjo. Lo renderizado
// nunca se guarda, así que ninguna edición pasa de ida y vuelta por el
// renderizador.
//
// Cada edición emite una operación. No hay guardado implícito ni estado local
// que pueda divergir del grafo.

import {
  DEFAULT_PROPERTY_NAMES,
  SPECIAL_KIND,
  answersIn,
  looksLikeDrawing,
  looksLikeQuery,
  readDrawing,
  renderMarkdown,
  suggestTitles,
  titleKey,
  uniqueAnchors,
  type RenderOptions,
} from '@vera/core';
import {
  api,
  type BlockView,
  type CatalogAsset,
  type Change,
  type CrossingRow,
  type LibrarianRequestView,
  type PageSummary,
  type PageView,
  type SubmitResult,
  type YoutubeTranscriptChoice,
  type YoutubeTranscriptResult,
} from './api.ts';

import { scrollDeltaFor, sourceOffsetFor } from './caret.ts';
import { parseOutlineClipboard } from './outline-clipboard.ts';
import { selectedSiblingMove } from './selection-movement.ts';
import { sourceSelection, type SourceSelection } from './source-selection.ts';
import { completeInPlace, editInPlace, placeNear, type Choice } from './fields.ts';
import { governingKind, kindSays, renderGoverning } from './governing-table.ts';
import { answerQueryBlock } from './query-block.ts';
import { renderMermaid } from './mermaid.ts';
import { decorateCodeBlocks } from './code-copy.ts';
import { is, isTextComposing } from './bindings.ts';
import { icon, type IconName } from './icons.ts';
import { when } from './dates.ts';
import { isMCPPage, renderMCP } from './mcp-page.ts';
import { isActivityPage, participantActivityPath, renderActivityPage } from './activity-page.ts';
import { isServicePage, pickBibliography, renderService } from './service-page.ts';
import { isPublicationPage, renderPageSharing, renderPublicationPage } from './publication-page.ts';
import {
  DEADLINE_KEY,
  LIST_KEY,
  NUMBERED,
  TRAIL_KIND,
  nextState,
  readChildListStyle,
  readTask,
  withoutTypedOrdinal,
  writeTask,
} from '@vera/core';
import { renderTrailBand, trailMarks, type TrailMark } from './trail-page.ts';
import { pendingLine, saySeconds } from './waiting.ts';
import { createPage } from './pages.ts';
import { isPresentation, presentPage } from './presentation.ts';
import { removePageAndBlocks } from './remove-page.ts';
import { createSession, type SaveIntent } from './session.ts';
import {
  actionOf,
  completionFor,
  detectTrigger,
  isDay,
  matchingCommands,
  queryOf,
  today,
  type Open,
} from './autocomplete.ts';
import {
  renderAudioBlock,
  renderRecorder,
  type AudioBlockHandlers,
} from './audio-block.ts';
import { audioUrl, voice, type Recording } from './voice.ts';
import { type NavigationGesture } from './trace.ts';
import { openMediaDetails } from './media-dialog.ts';
import { holdViewport, restoreViewport } from './viewport.ts';
import { session } from './tokens.ts';
import {
  resolveArrow,
  resolveBackspaceAtStart,
  resolveDelimiter,
  resolveDrawingKey,
  resolveEnter,
  resolveBlockFormat,
  resolveFormat,
  resolveInternalLink,
  resolveLink,
  resolveTab,
  type KeyOutcome,
  type Neighbourhood,
} from './keys.ts';

/*
 * Cómo llama este corpus a lo que Vera necesita nombrar.
 *
 * Lo trae el arranque, leído de la página de ontología, y se guarda aquí para
 * que dibujar una página no tenga que preguntarlo. Mientras no llegue rige lo
 * que Vera trae, que es lo mismo que rige en el servidor.
 */
let names = { ...DEFAULT_PROPERTY_NAMES };

export function nameProperties(said: Partial<typeof names>): void {
  names = { ...names, ...said };
}

const corpusNames = (): typeof names => names;

/**
 * Una página de gobierno no es material para clasificar, recorrer ni desechar.
 *
 * `special-kind` es la junta canónica con el programa; `tipo=página especial`
 * es la declaración legible que Herbert usa en el corpus. Cualquiera de las dos
 * basta para que la interfaz sea conservadora durante una migración incompleta.
 */
export function isSpecialPage(properties: readonly { key: string; value: string }[]): boolean {
  const folded = (value: string): string =>
    value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
  return properties.some(
    (property) =>
      property.key === SPECIAL_KIND ||
      (folded(property.key) === folded(corpusNames().kind) && folded(property.value) === 'pagina especial'),
  );
}

/*
 * Y de qué servidores acepta este corpus una incrustación.
 *
 * Vacía mientras el arranque no diga otra cosa: lo que no está declarado se lee
 * como el texto que es. Ver specs/executable-content-sandbox.allium.
 */
let embedHosts: readonly string[] = [];

export function allowEmbedsFrom(hosts: readonly string[]): void {
  embedHosts = [...hosts];
}

/** Una dirección HTTP que sale del origen de Vera, o nada si el enlace es interno. */
export function externalDestination(raw: string, here = window.location.href): string | null {
  try {
    const destination = new URL(raw, here);
    const origin = new URL(here).origin;
    return /^https?:$/.test(destination.protocol) && destination.origin !== origin
      ? destination.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Pregunta antes de abandonar Vera y conserva visible la dirección completa.
 *
 * La salida es un enlace real con `target=_blank`, no una navegación simulada
 * por JavaScript ni un protocolo particular de una plataforma. Conserva la
 * activación del usuario, pero no promete escoger navegador: una PWA sigue
 * perteneciendo al navegador que la instaló y la Web no puede saltárselo.
 */
function openExternalLink(url: string): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'external-link-dialog';

  const title = document.createElement('h2');
  title.textContent = 'Enlace externo';
  const destination = document.createElement('p');
  destination.className = 'external-link-destination';
  destination.textContent = url;

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancelar';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copiar URL';
  const open = document.createElement('a');
  open.className = 'dialog-primary-action';
  open.href = url;
  open.target = '_blank';
  open.rel = 'noopener noreferrer external';
  open.textContent = 'Abrir enlace';

  cancel.addEventListener('click', () => dialog.close());
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(url).then(() => {
      copy.textContent = 'Copiada';
      window.setTimeout(() => { copy.textContent = 'Copiar URL'; }, 1200);
    }).catch(() => toast('no se pudo copiar la URL'));
  });
  open.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());

  actions.append(cancel, copy, open);
  dialog.append(title, destination, actions);
  document.body.append(dialog);
  dialog.showModal();
}

/** Intercepta sólo enlaces web salientes; páginas, anclas y archivos siguen igual. */
function wireExternalLinks(container: HTMLElement): void {
  container.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
    if (link === null) return;
    const destination = externalDestination(link.getAttribute('href') ?? '');
    if (destination === null) return;
    event.preventDefault();
    event.stopPropagation();
    openExternalLink(destination);
  });
}

export interface OutlinerCallbacks {
  onNavigate(title: string): void;
  /** Apariencia compartida con el presentador, para que no invente una segunda
   * preferencia local mientras ocupa toda la pantalla. */
  scheme?(): 'light' | 'dark';
  onScheme?(scheme: 'light' | 'dark'): void;
  /** El índice que ya vive en el taller. Autocompletar una página no consulta
   *  el corpus por cada tecla: escribir tiene que seguir a la mano. */
  pageTitles?(): readonly PageSummary[];
  /** La página ya no existe: el espacio de trabajo poda sus copias y decide adónde volver. */
  onDeleted?(page: { id: string; title: string }): void | Promise<void>;
  /** Deshacer el último gesto de esta página, o rehacerlo. Lo calcula el
   *  servidor leyendo el registro hacia atrás. */
  onUndo?(direction: 'deshacer' | 'rehacer'): void | Promise<void>;
  /**
   * Abrir otra página, diciendo por qué gesto.
   *
   * El gesto lo nombra quien lo recibió —este módulo, que sabe si se pulsó un
   * backlink o un resultado de búsqueda— y no quien navega, que ya no puede
   * saberlo. @invariant TheGestureIsObservedAndNeverInferred.
   */
  onOpen(
    page: string,
    gesture: NavigationGesture,
    crossing?: { id: string; revision: string; content: string } | null,
  ): void;
  /** El contenido anterior y el nuevo permiten invalidar sólo las proyecciones
   *  cuyo significado cambió. Sin argumentos, el cambio se considera
   *  estructural y por tanto relevante para el mapa. */
  onChanged(before?: string, after?: string): void;
  /** Seguir una referencia hasta el bloque que nombra. */
  onOpenBlock?(page: string, block: string): void;
  /**
   * Vuelve a traer la página y sigue editando donde diga el foco.
   *
   * Un cambio estructural mueve bloques que ya estaban dibujados, así que la
   * vista se rehace desde el grafo en vez de intentar parchearla: el grafo es
   * quien sabe cómo quedó el árbol.
   */
  onReload(
    focus: { block: string; at: number | null } | null,
    options?: ReloadOptions,
  ): void;
  /** Reenraizar la vista en un bloque; sin bloque, volver a la página entera. */
  onFocusBlock?(block: string | null): void;
  /**
   * Hablar en este punto de la escritura, tras `/audio`.
   *
   * `rest` es lo que quedaba escrito en el bloque. Si hay algo, la grabación
   * necesita un bloque nuevo debajo: uno que ya tiene texto no puede guardarle el
   * lugar sin que la transcripción caiga encima de lo escrito.
   */
  onSpeak?(block: string, rest: string): Promise<void>;
}

export interface ReloadOptions {
  fromCorpus?: boolean;
  replaceRoute?: boolean;
}

/** Renombrar alcanza fuera de la réplica de una página y exige volver al corpus. */
export function reloadOptionsFor(change: Change): ReloadOptions | undefined {
  return change.kind === 'rename_page'
    ? { fromCorpus: true, replaceRoute: true }
    : undefined;
}

/**
 * Una escritura que ocurrió fuera de la réplica abierta sólo puede verse
 * volviendo una vez al corpus canónico.
 *
 * Procesar un bloque y transcribir audio escriben desde el servidor después de
 * que un modelo termina. Ninguna de esas operaciones pasó por `applyLocally`,
 * así que un redibujado corriente reconstruiría la página desde la versión
 * anterior y haría parecer que la transformación no ocurrió.
 */
export function reloadAfterServerWriting(): ReloadOptions {
  return { fromCorpus: true };
}

/**
 * El bloque donde hay que empezar a grabar en cuanto se dibuje.
 *
 * `/audio` ocurre en un editor que el redibujado se lleva por delante, así que
 * la intención sobrevive aquí hasta que el bloque exista en la página. Se
 * consume al usarla: volver a dibujar no vuelve a grabar.
 */
let speakingIn: { block: string; destination: string } | null = null;

function stamp(milliseconds: number): string {
  const total = Math.floor(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Una lectura cómoda: conserva acceso temporal sin crear dos mil bloques. */
function transcriptBlock(source: string, result: YoutubeTranscriptResult): string {
  const chunks: { startMs: number; text: string[] }[] = [];
  for (const segment of result.segments) {
    const last = chunks.at(-1);
    if (last === undefined || segment.startMs - last.startMs >= 15_000) {
      chunks.push({ startMs: segment.startMs, text: [segment.text] });
    } else if (last.text.at(-1) !== segment.text) {
      last.text.push(segment.text);
    }
  }
  const provenance = result.choice.translated
    ? `traducción automática desde ${result.video.originalLanguage ?? 'idioma original'}`
    : result.choice.source === 'automatic' ? 'subtítulos automáticos originales' : 'subtítulos publicados';
  const lines = chunks.map((chunk) => {
    const seconds = Math.floor(chunk.startMs / 1000);
    return `[${stamp(chunk.startMs)}](${source.replace(/[?&]t=\d+s?/, '')}${source.includes('?') ? '&' : '?'}t=${seconds}s) ${chunk.text.join(' ')}`;
  });
  return [
    `**Transcripción: ${result.video.title}**`,
    `idioma:: ${result.choice.label}`,
    `idioma original:: ${result.video.originalLanguage ?? 'no declarado'}`,
    `procedencia:: ${provenance}`,
    `fuente:: ${source}`,
    `extraída:: ${new Date().toISOString()}`,
    '',
    ...lines,
  ].join('\n');
}

function chooseTranscript(choices: YoutubeTranscriptChoice[]): Promise<YoutubeTranscriptChoice | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'youtube-transcript-dialog';
    const title = document.createElement('h2');
    title.textContent = 'Traer transcripción';
    const explain = document.createElement('p');
    explain.textContent = 'Elige la pista que se guardará bajo el video. Se conservarán idioma, procedencia y marcas temporales.';
    const preferred = localStorage.getItem('vera.youtube-transcript-choice');
    let picked = choices.find((choice) => `${choice.source}:${choice.language}` === preferred)
      ?? choices.find((choice) => choice.language === 'es')
      ?? choices.find((choice) => !choice.translated)
      ?? choices[0]
      ?? null;
    const catalogue = document.createElement('div');
    catalogue.className = 'transcript-catalogue';
    catalogue.setAttribute('aria-label', 'transcripciones disponibles');
    const groups = [
      ['Pistas publicadas', choices.filter((one) => one.source === 'published')],
      ['Originales automáticas', choices.filter((one) => one.source === 'automatic' && !one.translated)],
      ['Traducciones automáticas', choices.filter((one) => one.translated)],
    ] as const;
    for (const [label, items] of groups) {
      if (items.length === 0) continue;
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = `${label} · ${items.length}`;
      const tokens = document.createElement('div');
      tokens.className = 'transcript-tokens';
      for (const choice of items) {
        const token = document.createElement('button');
        token.type = 'button';
        token.className = choice === picked ? 'transcript-token selected' : 'transcript-token';
        token.textContent = choice.label;
        token.title = `${choice.label} · ${choice.language}`;
        token.setAttribute('aria-pressed', choice === picked ? 'true' : 'false');
        token.addEventListener('click', () => {
          picked = choice;
          for (const other of catalogue.querySelectorAll<HTMLButtonElement>('.transcript-token')) {
            const selected = other === token;
            other.classList.toggle('selected', selected);
            other.setAttribute('aria-pressed', selected ? 'true' : 'false');
          }
        });
        tokens.append(token);
      }
      section.append(heading, tokens);
      catalogue.append(section);
    }
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancelar';
    const take = document.createElement('button');
    take.type = 'button'; take.className = 'primary'; take.textContent = 'Traer';
    take.disabled = picked === null;
    cancel.addEventListener('click', () => dialog.close('cancel'));
    take.addEventListener('click', () => dialog.close('take'));
    dialog.addEventListener('close', () => {
      const chosen = dialog.returnValue === 'take' ? picked : null;
      if (chosen !== null) localStorage.setItem('vera.youtube-transcript-choice', `${chosen.source}:${chosen.language}`);
      dialog.remove();
      resolve(chosen);
    });
    actions.append(cancel, take);
    dialog.append(title, explain, catalogue, actions);
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Deja dicho que en este bloque se va a hablar. */
export function speakInto(block: string, destination = 'este bloque'): void {
  speakingIn = { block, destination };
}

/**
 * El menú de un bloque. Sólo puede haber uno abierto: el segundo clic en otro
 * bullet cierra el primero, y un clic en cualquier otro sitio los cierra todos.
 */
let openMenu: HTMLElement | null = null;

function closeMenu(): void {
  openMenu?.remove();
  openMenu = null;
}

let dismissalBound = false;

/**
 * Los oyentes que cierran el menú se registran al abrir el primero, no al
 * importar el módulo. Importar no debe hacer nada: con estas dos líneas en el
 * cuerpo del archivo, cargar el outliner fuera de un navegador —como hacen sus
 * propias pruebas— fallaba antes de llegar a ninguna función.
 */
function bindDismissal(): void {
  if (dismissalBound) return;
  dismissalBound = true;

  document.addEventListener('click', (event) => {
    if (openMenu === null) return;
    const target = event.target as HTMLElement;
    if (!openMenu.contains(target) && !target.classList.contains('bullet')) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
}

interface MenuAction {
  label: string;
  /**
   * El dibujo de la acción, cuando la acción es una acción.
   *
   * Opcional porque no todo lo que se abre así es un verbo: el selector de
   * valores de una propiedad lista palabras del corpus, y ponerle un icono a
   * cada una diría que son botones de la interfaz cuando son vocabulario de
   * quien escribe.
   */
  icon?: IconName;
  /** Por qué no se puede, cuando no se puede. La acción no ocupa sitio. */
  blocked?: string;
  run(): void | Promise<void>;
}

/**
 * Ejecuta una acción sin dejar que el clic que la eligió cierre también el
 * menú que esa acción pueda abrir.
 *
 * El orden importa: un «Copiar…» crea otro menú durante `run`; si el clic
 * alcanza después el listener global, ese listener ve el menú nuevo como algo
 * ajeno al blanco original y lo elimina en el mismo gesto.
 */
export function invokeMenuAction(
  event: Pick<Event, 'stopPropagation'>,
  action: Pick<MenuAction, 'run'>,
): void {
  event.stopPropagation();
  closeMenu();
  void action.run();
}

/**
 * Un menú, por grupos.
 *
 * Los grupos son la firma y no una lista con separadores metidos dentro: así lo
 * que hay que decidir al añadir una acción es a qué se parece, y no en qué
 * renglón cae. Un grupo vacío no dibuja nada —una raya suelta al final es peor
 * que no agrupar— y por eso se filtran antes de contar.
 */
function openBlockMenu(anchor: HTMLElement, groups: MenuAction[][]): void {
  bindDismissal();
  closeMenu();

  const menu = document.createElement('div');
  menu.className = 'block-menu';
  menu.setAttribute('role', 'menu');

  const available = groups
    .map((group) => group.filter((action) => action.blocked === undefined))
    .filter((group) => group.length > 0);
  for (const group of available) {
    if (menu.childElementCount > 0) {
      const rule = document.createElement('div');
      rule.className = 'block-menu-rule';
      // Decorativa: lo que separa los grupos ya se lee en el orden y en las
      // etiquetas. Anunciarla sería un renglón vacío cada tres.
      rule.setAttribute('role', 'presentation');
      menu.append(rule);
    }

    for (const action of group) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'block-menu-item';
      item.setAttribute('role', 'menuitem');
      // El icono va como marcado y la etiqueta como texto: lo segundo puede
      // venir del corpus —los valores de una propiedad los escribió alguien— y
      // ahí no entra marcado.
      if (action.icon !== undefined) item.insertAdjacentHTML('afterbegin', icon(action.icon));
      const said = document.createElement('span');
      said.textContent = action.label;
      item.append(said);
      // El cambio de foco ocurre en mousedown, antes del click. Si el bloque
      // que estaba editándose aprovecha ese blur para guardarse y redibujar la
      // página, el botón desaparece antes de recibir su primer click. Conservar
      // el foco hasta ejecutar la acción evita ese primer gesto perdido.
      item.addEventListener('mousedown', (event) => event.preventDefault());
      item.addEventListener('click', (event) => invokeMenuAction(event, action));
      menu.append(item);
    }
  }

  // Se mide puesto y escondido, y se coloca después. Ver `placeNear`.
  menu.style.visibility = 'hidden';
  document.body.append(menu);
  placeNear(menu, anchor, { gap: 4, alignRight: true });
  menu.style.visibility = '';

  openMenu = menu;
  menu.querySelector('button')?.focus();
}

const foldedForSearch = (text: string): string =>
  text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();

export function matchingMovePages(
  query: string,
  pages: readonly PageSummary[],
  currentPage: string,
): PageSummary[] {
  const needle = foldedForSearch(query);
  return pages
    .filter((page) => page.id !== currentPage)
    .filter((page) => needle === '' || foldedForSearch(page.title).includes(needle))
    .sort((a, b) => {
      const left = foldedForSearch(a.title);
      const right = foldedForSearch(b.title);
      const leftRank = left === needle ? 0 : left.startsWith(needle) ? 1 : 2;
      const rightRank = right === needle ? 0 : right.startsWith(needle) ? 1 : 2;
      return leftRank - rightRank || a.title.localeCompare(b.title, 'es');
    });
}

async function chooseMovePage(currentPage: string): Promise<PageSummary | null> {
  const pages = await api.pages();
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'block-choice-dialog';
    const title = document.createElement('h2');
    title.textContent = 'Mover a otra página';
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Buscar página';
    search.setAttribute('aria-label', 'buscar página de destino');
    const results = document.createElement('div');
    results.className = 'block-choice-results';
    let settled = false;
    const finish = (page: PageSummary | null): void => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(page);
    };
    const draw = (): void => {
      results.innerHTML = '';
      for (const page of matchingMovePages(search.value, pages, currentPage).slice(0, 30)) {
        const option = document.createElement('button');
        option.type = 'button';
        option.textContent = page.title;
        option.addEventListener('click', () => finish(page));
        results.append(option);
      }
    };
    search.addEventListener('input', draw);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.append(title, search, results);
    document.body.append(dialog);
    draw();
    dialog.showModal();
    search.focus();
  });
}

async function moveBlockToPage(
  block: BlockView,
  currentPage: string,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  let destination: PageSummary | null;
  try {
    destination = await chooseMovePage(currentPage);
  } catch {
    toast('no se pudieron traer las páginas');
    return;
  }
  if (destination === null) return;
  const result = await api.submit({
    kind: 'move_block',
    block: block.stableId,
    page: destination.id,
    parent: null,
    position: destination.blockCount,
  });
  if (result.status === 'rejected') {
    toast(`no se pudo mover: ${result.reason}`);
    return;
  }
  callbacks.onChanged();
  callbacks.onOpen(destination.id, 'searched');
}

let toastTimer: number | undefined;

/** Un aviso breve. Nunca lleva marcado: el corpus no dicta la interfaz. */
function toast(message: string): void {
  let element = document.querySelector<HTMLElement>('.toast');
  if (element === null) {
    element = document.createElement('div');
    element.className = 'toast';
    element.setAttribute('role', 'status');
    document.body.append(element);
  }
  element.textContent = message;
  element.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (element !== null) element.hidden = true;
  }, 3000);
}

async function askLibrarian(
  page: PageView,
  block: BlockView | null,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  const instruction = window.prompt(
    block === null ? `¿Qué quieres pedirle al bibliotecario sobre «${page.title}»?` : '¿Qué quieres pedirle al bibliotecario sobre este bloque?',
  )?.trim();
  if (!instruction) return;
  try {
    const request = await api.askLibrarian({
      pageId: page.id,
      ...(block === null ? {} : { blockId: block.stableId }),
      text: instruction,
    });
    toast(request.dispatchStatus === 'failed'
      ? 'pedido guardado; el bibliotecario está desconectado y podrá retomarlo'
      : 'pedido enviado al bibliotecario');
    callbacks.onReload(null);
  } catch {
    toast('no se pudo guardar la solicitud');
  }
}

function librarianTurn(request: LibrarianRequestView): HTMLElement {
  const turn = document.createElement('aside');
  turn.className = `librarian-turn librarian-${request.status}`;
  turn.dataset['request'] = request.id;
  const asked = document.createElement('div');
  asked.className = 'librarian-request';
  asked.textContent = request.text;
  const state = document.createElement('div');
  state.className = 'librarian-state';
  state.textContent = request.status === 'answered'
    ? 'El bibliotecario respondió'
    : request.status === 'working'
      ? 'El bibliotecario está trabajando'
      : request.dispatchStatus === 'failed'
        ? 'guardado; esperando reconexión'
        : 'en cola para el bibliotecario';
  turn.append(asked, state);
  if (request.reply !== null) {
    const reply = document.createElement('div');
    reply.className = 'librarian-reply';
    reply.innerHTML = renderMarkdown(request.reply.text);
    decorateCodeBlocks(reply);
    turn.append(reply);
    if (request.reply.proposal !== null) {
      const count = request.reply.proposal.changes.length;
      const proposal = document.createElement('div');
      proposal.className = 'librarian-proposal';
      proposal.textContent = `${count} cambio${count === 1 ? '' : 's'} propuesto${count === 1 ? '' : 's'} · todavía no aplicado`;
      turn.append(proposal);
    }
  }
  return turn;
}

const librarianOverlayCorners = ['bottom-right', 'bottom-left', 'top-left', 'top-right'] as const;
type LibrarianOverlayCorner = typeof librarianOverlayCorners[number];

function rememberedLibrarianCorner(): LibrarianOverlayCorner {
  const remembered = window.localStorage.getItem('vera:librarian-overlay-corner');
  return librarianOverlayCorners.includes(remembered as LibrarianOverlayCorner)
    ? remembered as LibrarianOverlayCorner
    : 'bottom-right';
}

/**
 * Una solicitud en curso es estado de la interfaz, no contenido de la página.
 * Vive una sola vez sobre el documento y puede apartarse si tapa justo lo que
 * se está leyendo. Las respuestas terminadas sí vuelven a su lugar de origen.
 */
function showLibrarianOverlay(requests: LibrarianRequestView[]): void {
  document.querySelector('.librarian-active-overlay')?.remove();
  if (requests.length === 0) return;

  const latest = [...requests].sort((a, b) => b.createdAt - a.createdAt)[0]!;
  const overlay = document.createElement('aside');
  overlay.className = 'librarian-active-overlay';
  overlay.dataset['corner'] = rememberedLibrarianCorner();
  overlay.dataset['request'] = latest.id;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');

  const heading = document.createElement('div');
  heading.className = 'librarian-overlay-heading';
  const title = document.createElement('strong');
  title.textContent = latest.status === 'working'
    ? 'El bibliotecario está trabajando'
    : latest.dispatchStatus === 'failed'
      ? 'Solicitud guardada'
      : 'El bibliotecario está recibiendo la solicitud';
  const move = document.createElement('button');
  move.type = 'button';
  move.className = 'librarian-overlay-move';
  move.textContent = 'Reubicar';
  move.title = 'Mover el aviso a otra esquina';
  move.setAttribute('aria-label', 'Mover el aviso del bibliotecario a otra esquina');
  move.addEventListener('click', () => {
    const at = librarianOverlayCorners.indexOf(overlay.dataset['corner'] as LibrarianOverlayCorner);
    const corner = librarianOverlayCorners[(at + 1) % librarianOverlayCorners.length]!;
    overlay.dataset['corner'] = corner;
    window.localStorage.setItem('vera:librarian-overlay-corner', corner);
  });
  heading.append(title, move);

  const asked = document.createElement('div');
  asked.className = 'librarian-overlay-request';
  asked.textContent = latest.text;
  overlay.append(heading, asked);

  if (requests.length > 1) {
    const count = document.createElement('div');
    count.className = 'librarian-overlay-count';
    count.textContent = `${requests.length - 1} solicitud${requests.length === 2 ? '' : 'es'} más en curso`;
    overlay.append(count);
  }
  document.body.append(overlay);
}

async function showLibrarianTurns(
  container: HTMLElement,
  page: PageView,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  let requests: LibrarianRequestView[];
  try { requests = await api.librarianRequests(page.id); }
  catch { return; }
  // Una lectura iniciada por la página anterior no debe dejar su aviso sobre
  // la página que la reemplazó mientras esperaba la red.
  if (container.dataset['page'] !== page.id) return;
  // El servidor no debiera repetir identidades, pero esta superficie tampoco
  // debe convertir una repetición de transporte en dos avisos iguales.
  const unique = [...new Map(requests.map((request) => [request.id, request])).values()];
  const active = unique.filter((request) => request.status === 'queued' || request.status === 'working');
  showLibrarianOverlay(active);
  // Un pedido sobre un bloque es una transformación delegada: el bibliotecario reemplaza
  // el bloque y la versión anterior queda en el historial. Nunca se monta una
  // conversación al costado del texto que acaba de transformar.
  for (const request of unique.filter((request) =>
    request.sourceBlockId === null && request.status !== 'queued' && request.status !== 'working').reverse()) {
    const turn = librarianTurn(request);
    container.querySelector('.page-header')?.after(turn);
  }
  if (active.length > 0) {
    window.setTimeout(() => callbacks.onReload(null), 3_000);
  }
}

/**
 * Copiar al portapapeles exige contexto seguro. En `localhost` y bajo el HTTPS
 * de Tailscale lo hay; si algún día no, se dice en vez de fallar en silencio y
 * dejar al participante creyendo que copió.
 */
async function copyText(text: string, notify: (message: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify(`copiado: ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`);
  } catch {
    notify(`no se pudo copiar. El texto es: ${text}`);
  }
}

/**
 * Los binarios del corpus ya viven dentro de Vera, pero una referencia puede
 * seguir sin resolver: el corpus nombra archivos que no están en `assets/`, y
 * una imagen remota depende de un servidor ajeno.
 *
 * Cuando eso pasa se declara lo que es —una fuente que falta, con su ruta a la
 * vista— en vez de dejar el icono roto del navegador, que no dice si el error
 * es del archivo, de la ruta o de Vera.
 */
function markMissingImages(root: HTMLElement): void {
  for (const image of root.querySelectorAll('img')) {
    image.addEventListener(
      'error',
      () => {
        const missing = document.createElement('span');
        missing.className = 'media-missing';
        const label = image.getAttribute('alt');
        missing.textContent =
          label === null || label === '' ? image.getAttribute('src') ?? 'imagen' : label;
        missing.title = `no se pudo cargar: ${image.getAttribute('src') ?? ''}`;
        image.replaceWith(missing);
      },
      { once: true },
    );
  }
}

/**
 * Elimina un bloque del grafo.
 *
 * @invariant DiscardingIsAnOrdinaryChange: sale la misma operación
 * `remove_block` que enviaría cualquier participante, con la misma procedencia
 * y el mismo orden. La interfaz no tiene un camino más corto hasta el grafo.
 */
async function removeBlock(
  node: Node,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  const order = blockRemovalOrder(node);
  const children = order.length - 1;
  if (
    children > 0 &&
    !window.confirm(
      `Vas a borrar este bloque con ${children} ${children === 1 ? 'hijo' : 'hijos'}. No se puede deshacer.`,
    )
  ) {
    return;
  }

  for (const block of order) {
    let result;
    try {
      result = await api.submit({ kind: 'remove_block', block });
    } catch {
      toast('no se pudo eliminar: sin conexión con el servidor');
      return;
    }

    if (result.status === 'rejected') {
      // El dominio manda. Si dice que no, se dice por qué y no se toca la vista.
      toast(`rechazado: ${result.reason}`);
      return;
    }
  }

  /*
   * Se vuelve a dibujar la página, no se recorta la fila.
   *
   * Quitaba el `<div>` del DOM y ya. Con eso basta mientras quede algo, pero si
   * el bloque era el último la página quedaba literalmente muerta: una lista
   * vacía, sin nada donde pulsar, sin forma de volver a escribir. El sitio donde
   * una página vacía ofrece dónde empezar vive dentro del dibujo, y recortando a
   * mano no se pasaba nunca por ahí — recargar la página lo arreglaba, que es
   * tanto como no tener arreglo.
   *
   * La fila vieja se deja puesta hasta el repintado. Quitándola antes, el
   * navegador ya había recolocado la página cuando `onReload` intentaba guardar
   * el lugar; conservándola, el testigo siguiente sabe exactamente dónde estaba
   * antes de que desapareciera éste.
   */
  callbacks.onReload(null);
  callbacks.onChanged();
}

/**
 * Dice si los hijos de un bloque se leen numerados o con viñeta.
 *
 * Ver specs/block-editing.allium, rule NumberTheChildren. Un hecho en el padre y
 * ninguno en los hijos, así que un hijo que nazca después ya está numerado.
 *
 * El orden importa y no es arbitrario. Primero la propiedad, después limpiar los
 * números escritos a mano. Al revés, un fallo a mitad dejaría el texto de alguien
 * sin sus números y la lista sin numerar —una pérdida, aunque sea recuperable—;
 * así, un fallo a mitad deja un «1. 1.» a la vista, que es feo, no pierde nada y
 * se arregla repitiendo el gesto.
 */
async function markChildren(
  block: BlockView,
  children: readonly BlockView[],
  numbered: boolean,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  const said = async (change: Change): Promise<boolean> => {
    let result;
    try {
      result = await api.submit(change);
    } catch {
      toast('no se pudo: sin conexión con el servidor');
      return false;
    }
    if (result.status === 'rejected') {
      toast(`rechazado: ${result.reason}`);
      return false;
    }
    return true;
  };

  if (!numbered) {
    /*
     * Volver a viñetas quita la marca y no repone los números en el texto.
     *
     * Lo que se quitó al numerar era la copia congelada de una posición, y
     * reponerla escribiría otra vez el problema que numerar vino a resolver. Lo
     * que decía cada bloque está en sus revisiones.
     */
    if (!(await said({ kind: 'remove_property', block: block.stableId, propertyKey: LIST_KEY }))) {
      return;
    }
    callbacks.onReload(null);
    callbacks.onChanged();
    return;
  }

  if (!(await said({
    kind: 'set_property',
    block: block.stableId,
    propertyKey: LIST_KEY,
    propertyValue: NUMBERED,
  }))) {
    return;
  }

  /*
   * Y los números que alguien escribió a mano dejan de estar en el texto.
   *
   * @invariant NumberingAbsorbsATypedOrdinal. Una edición corriente por hijo, con
   * su revisión y su deshacer: dejarlos dibujaría el número dos veces, y
   * esconderlos sin quitarlos dejaría al texto y a la lista discrepando sobre
   * cuál de los dos números es el de verdad.
   *
   * Sólo los que de verdad lo llevan. `withoutTypedOrdinal` devuelve el texto
   * idéntico cuando no hay nada que quitar, así que numerar una lista limpia no
   * genera una sola operación.
   */
  let cleaned = 0;
  for (const child of children) {
    const without = withoutTypedOrdinal(child.content);
    if (without === child.content) continue;
    if (await said({ kind: 'edit_block', block: child.stableId, content: without })) cleaned += 1;
  }
  if (cleaned > 0) {
    toast(
      cleaned === 1
        ? 'el número que estaba escrito pasó a ser de la lista'
        : `los ${cleaned} números que estaban escritos pasaron a ser de la lista`,
    );
  }

  callbacks.onReload(null);
  callbacks.onChanged();
}

/**
 * Pliega o despliega un bloque.
 *
 * @invariant FoldingIsNotAChange: no pasa por `submit`. No genera operación, no
 * aparece en ninguna revisión, y el registro no se entera. Es lo que esta
 * persona está mirando, no lo que dice el grafo.
 */
async function toggleFold(
  block: string,
  folded: boolean,
  page: PageView,
  callbacks: OutlinerCallbacks,
  returnTo: { block: string; at: number } | null,
): Promise<void> {
  try {
    const response = await api.fold(block, folded);
    if (!response.ok) throw new Error(`fold failed: ${response.status}`);
  } catch {
    toast('no se pudo plegar: sin conexión con el servidor');
    return;
  }
  // `onReload` normalmente repinta desde la réplica local. El plegado no forma
  // parte de esa réplica porque es estado de lectura y no una operación del
  // grafo; si no proyectamos aquí la respuesta, el repintado conserva la lista
  // anterior y deshace visualmente el clic aunque el servidor sí lo guardó.
  page.folded = foldedState(page.folded, block, folded);
  // Plegar no es abandonar el lugar. El foco nulo dentro de este anclaje pide
  // volver al control del mismo bloque sin abrir su editor. Además evita que
  // una página larga vuelva a componerse progresivamente desde arriba.
  callbacks.onReload(returnTo ?? { block, at: null });
  const row = document.querySelector<HTMLElement>(`.block[data-id="${CSS.escape(block)}"]`);
  if (row !== null) {
    if (returnTo === null) row.querySelector<HTMLButtonElement>('.fold')?.focus({ preventScroll: true });
  }
}

/** El lugar de escritura que un plegado puede conservar tras repintar. */
function focusAfterFold(block: string, folded: boolean): { block: string; at: number } | null {
  const editor = document.activeElement;
  if (!(editor instanceof HTMLTextAreaElement) || !editor.classList.contains('editor')) return null;
  const editedRow = editor.closest<HTMLElement>('.block[data-id]');
  const foldedRow = document.querySelector<HTMLElement>(`.block[data-id="${CSS.escape(block)}"]`);
  const edited = editedRow?.dataset['id'];
  if (edited === undefined) return null;
  // Si el bloque editado va a quedar oculto, el único foco honesto es el
  // control que acaba de cerrar su ancestro.
  if (folded && foldedRow !== null && editedRow !== foldedRow && foldedRow.contains(editedRow)) return null;
  return { block: edited, at: editor.selectionStart };
}

/** Proyecta localmente el estado personal de plegado, sin duplicados. */
export function foldedState(current: string[], block: string, folded: boolean): string[] {
  const next = new Set(current);
  if (folded) next.add(block);
  else next.delete(block);
  return [...next];
}

/**
 * Abre sólo el camino necesario para que un bloque referido pueda dibujarse.
 *
 * El plegado es una preferencia de lectura, pero no puede volver inexistente el
 * destino de una referencia. No se abre todo el árbol: únicamente sus ancestros.
 */
export function foldsWhileRevealing(
  blocks: BlockView[],
  folded: string[],
  target: string,
): string[] {
  const parentOf = new Map(blocks.map((block) => [block.stableId, block.parent]));
  const ancestors = new Set<string>();
  let parent = parentOf.get(target) ?? null;
  while (parent !== null && !ancestors.has(parent)) {
    ancestors.add(parent);
    parent = parentOf.get(parent) ?? null;
  }
  return folded.filter((block) => !ancestors.has(block));
}

/**
 * Sube o baja un bloque intercambiándolo con su hermano.
 *
 * @invariant SubtreesTravelWithTheirRoot: `move_block` arrastra el subárbol, así
 * que basta con pedir el índice del hermano. Un bloque que adelantara a sus
 * propios hijos los dejaría describiendo algo que ya no está encima.
 */
async function moveBlock(
  block: BlockView,
  page: string,
  near: Neighbourhood,
  up: boolean,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  const target = up ? near.index - 1 : near.index + 1;
  if (target < 0) {
    toast('el bloque ya es el primero de su nivel');
    return;
  }

  let result;
  try {
    result = await api.submit({
      kind: 'move_block',
      block: block.stableId,
      page,
      parent: near.parent,
      position: target,
    });
  } catch {
    toast('no se pudo mover: sin conexión con el servidor');
    return;
  }

  if (result.status === 'rejected') {
    toast(`rechazado: ${result.reason}`);
    return;
  }
  callbacks.onReload({ block: block.stableId, at: 0 });
}

/**
 * Edita un texto donde está, sin abrir nada aparte.
 *
 * Sirve para el título y para las propiedades: son campos de una línea, y un
 * editor de bloque completo sería desproporcionado. `commit` devuelve si el
 * cambio se aplicó; si no, el texto vuelve a lo que era y no se pierde nada.
 */
/** Cuántas respuestas se ofrecen sin que el menú deje de leerse de un vistazo. */
const OFFERED_AT_MOST = 12;

/** Qué parte del uso tienen que concentrar para que la pregunta sea cerrada. */
const CLOSED_QUESTION_SHARE = 0.6;

/**
 * Si una propiedad se contesta eligiendo o escribiendo.
 *
 * Provisional, y a la vista de que lo es: lo correcto es que la ontología
 * declare el dominio de cada propiedad, y eso todavía no existe en el almacén.
 * Mientras tanto se infiere de lo que el corpus ya dice, que es la misma
 * evidencia desde la que rule ProposePropertyDomainFromUsage lo propondrá.
 *
 * Lo que decide no es cuántos valores hay sino si unos pocos concentran el uso.
 * Contar valores distintos parece lo natural y se equivoca justo donde importa:
 * `type` toma treinta y ocho valores en este corpus y aun así es una pregunta
 * cerrada, porque doce de ellos cubren el 94% y el resto es cola —erratas,
 * sinónimos, cosas dichas una vez—. `tags`, con quinientos sesenta y cinco, no
 * concentra nada: sus doce más usados cubren el 7%, y eso no es un vocabulario
 * sino texto.
 *
 * La cola, además, no es ruido que ocultar: es exactamente lo que la ronda del
 * bibliotecario tiene que traer. «`bibliography` aparece una vez y `bibliografia`
 * treinta» es una decisión que alguien puede tomar.
 */
function isChoosable(offered: { value: string; uses: number }[]): boolean {
  if (offered.length < 2) return false;
  const total = offered.reduce((sum, option) => sum + option.uses, 0);
  if (total === 0) return false;
  const head = offered.slice(0, OFFERED_AT_MOST).reduce((sum, option) => sum + option.uses, 0);
  return head / total >= CLOSED_QUESTION_SHARE;
}

/**
 * Elegir un día en el calendario.
 *
 * Usa el selector del propio navegador y no uno dibujado aquí. Un calendario es
 * de las pocas cosas que todo sistema ya resuelve bien y en el idioma y con la
 * semana que quien mira espera —lunes o domingo primero, según dónde viva—, y
 * reimplementarlo sería reimplementar eso también, peor.
 *
 * Se descarta al perder el foco y no deja rastro: mientras no se elija un día,
 * no ha pasado nada.
 */
function pickDate(anchor: HTMLElement, onPick: (date: string) => void): void {
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'date-picker';
  input.value = today();

  const rect = anchor.getBoundingClientRect();
  input.style.left = `${Math.round(rect.left + window.scrollX)}px`;
  input.style.top = `${Math.round(rect.bottom + window.scrollY)}px`;

  const dismiss = (): void => input.remove();
  input.addEventListener('change', () => {
    const chosen = input.value;
    dismiss();
    if (chosen !== '') onPick(chosen);
  });
  input.addEventListener('blur', dismiss);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      dismiss();
      anchor.focus();
    }
  });

  document.body.append(input);
  input.focus();
  // Abrir el calendario sin obligar a pulsar el iconito. No todos los
  // navegadores lo permiten, y donde no, el campo sigue sirviendo.
  try {
    (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
  } catch {
    // El navegador exige un gesto suyo para abrirlo. El campo ya está enfocado.
  }
}

/** Envía un cambio sin recargar. Devuelve si se aplicó. */
async function submitQuietly(change: Change): Promise<boolean> {
  let result;
  try {
    result = await api.submit(change);
  } catch {
    toast('sin conexión con el servidor');
    return false;
  }
  if (result.status === 'rejected') {
    toast(`rechazado: ${result.reason}`);
    return false;
  }
  return true;
}

/** Envía un cambio y rehace la página desde el grafo. */
async function submitAndReload(
  change: Change,
  callbacks: OutlinerCallbacks,
): Promise<boolean> {
  const applied = await submitQuietly(change);
  if (applied) callbacks.onReload(null, reloadOptionsFor(change));
  return applied;
}

/**
 * Pregunta un título, crea la página y la abre.
 *
 * Nace privada y sin bloques: `createPage` es el acto, y el primer bloque lo
 * escribe quien la abra. Ponerle contenido de plantilla sería inventar texto que
 * nadie escribió, y en un corpus con procedencia eso no es inocuo.
 */
async function askForNewPage(callbacks: OutlinerCallbacks): Promise<void> {
  const title = window.prompt('Título de la página nueva');
  if (title === null || title.trim() === '') return;

  let result;
  try {
    result = await createPage(title.trim());
  } catch {
    toast('no se pudo crear: sin conexión con el servidor');
    return;
  }

  if (result.status === 'rejected') {
    // El dominio exige título único dentro del grafo, y lo dice él.
    toast(`rechazado: ${result.reason}`);
    return;
  }
  // Una página recién creada desde el buscador de la barra: se llegó a por
  // ella, no siguiendo nada de lo que se estaba leyendo.
  callbacks.onOpen(result.subjectId, 'searched');
}


/**
 * Vaciar una pagina y despues quitarla.
 *
 * El dominio solo borra una pagina vacia, y solo borra un bloque que no tenga
 * hijos —`rule ApplyRemovePage` y la validacion de `remove_block`—. Asi que esto
 * no es una operacion sino una secuencia: las hojas primero, subiendo, y al
 * final la pagina. Cada paso queda en el registro con su propio numero de
 * secuencia.
 *
 * Que sea una secuencia y no un acto unico es deliberado en la spec: «emptying
 * it is a sequence of remove_block operations, each separately ordered and
 * separately auditable». Borrar una pagina no puede tragarse lo que hubiera
 * dentro sin dejar constancia de que habia.
 *
 * Si un paso falla se para ahi. Queda una pagina a medio vaciar, que es
 * visiblemente reparable; nunca una pagina borrada con bloques huerfanos.
 */
async function deletePage(
  page: PageView,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  const cuantos = page.blocks.filter((b) => b.content.trim() !== '').length;
  const dentro =
    cuantos === 0 ? '' : cuantos === 1 ? ' y el bloque que tiene escrito' : ` y sus ${cuantos} bloques escritos`;

  /*
   * Un recorrido se avisa distinto, y no por cortesía.
   *
   * Sus bloques *son* sus paradas —cada uno nombra una página—, así que decir «y
   * sus ocho bloques escritos» se lee como «y sus ocho paradas». No es lo que pasa
   * y no puede pasar: una parada es una página del corpus, y borrar un bloque que
   * la nombra no toca a la página nombrada más de lo que la tocaría borrar
   * cualquier otra frase que la mencione. Lo que se pierde es el argumento —el
   * orden y las conectivas—, que es bastante, y conviene que sea eso lo que se
   * está decidiendo perder.
   */
  const paradas = page.trail?.route.length ?? 0;
  const aviso =
    page.trail != null && paradas > 0
      ? `Se va a eliminar el recorrido «${page.title}»: su orden y lo que dice entre una parada y la siguiente.\n\n` +
        `Sus ${paradas} ${paradas === 1 ? 'parada' : 'paradas'} no se tocan: son páginas del corpus y siguen donde están.\n\n` +
        'No se puede deshacer.'
      : `Se va a eliminar «${page.title}»${dentro}. No se puede deshacer.`;
  if (!window.confirm(aviso)) return;

  const confirmed = async (change: Change): Promise<boolean> => {
    try {
      const result = await api.submitConfirmed(change);
      if (result.status === 'rejected') {
        toast(`rechazado: ${result.reason}`);
        return false;
      }
      return true;
    } catch {
      toast('sin conexión con el servidor');
      return false;
    }
  };
  if (!(await removePageAndBlocks(page, confirmed))) return;

  toast(`eliminada: ${page.title}`);
  if (callbacks.onDeleted !== undefined) await callbacks.onDeleted({ id: page.id, title: page.title });
  else callbacks.onNavigate(today());
}

/** El Markdown de la página, pedido al servidor para que sea el mismo que git recibiría. */
async function pageMarkdown(page: string): Promise<string | null> {
  try {
    const response = await fetch(`/pages/${encodeURIComponent(page)}/markdown`);
    if (!response.ok) throw new Error(String(response.status));
    return await response.text();
  } catch {
    toast('no se pudo traer el Markdown de la página');
    return null;
  }
}

/** Lo que procesar devolvió. Proposiciones, ninguna decisión. */
interface PageReading {
  links: {
    url: string;
    title: string | null;
    kind: string | null;
    unreachable: string | null;
    /** El bloque que lleva esta dirección, para poder arreglarla donde está. */
    block: string | null;
    /** Y lo que ese bloque dice ahora, que es sobre lo que se propone el cambio. */
    content: string | null;
  }[];
  types: string[];
  /** Cómo llama este corpus a lo que se propone. */
  names?: { kind: string; topic: string };
  /** Cada concepto, y si el corpus ya lo tiene como página. */
  concepts: { value: string; page: string | null; backlinks: number }[];
  /** Páginas que esta página nombra y no enlaza. */
  mentions: {
    title: string;
    page: string;
    block: string;
    content: string;
    next: string;
    written: string;
    backlinks: number;
  }[];
  /** Una jerarquía latente propuesta por el modelo, nunca aplicada sola. */
  hierarchy?: { changes: Change[]; explanation: string };
  notDone: string[];
}

/**
 * Un cambio propuesto, con su decisión.
 *
 * Nace aprobado. La decisión que Vera protege es la de *aplicar* —que es un acto
 * aparte, explícito y con su propio botón— y no la de cada renglón: obligar a
 * marcar veinte casillas para aceptar veinte títulos de enlace que ya se están
 * leyendo convierte en trabajo lo que era una revisión. Lo que hace falta es
 * poder decir que no a los que sobren, y eso es «ignorar».
 */
interface Suggestion {
  /** Qué se lee en el renglón. */
  what: string;
  /** El detalle, en gris: de dónde sale o en qué se convierte. */
  detail: string;
  /*
   * Lo que hay que escribir para que el renglón ocurra.
   *
   * Casi siempre es una operación, pero no siempre: «borrar los doce bloques
   * vacíos» son doce, y partirlo en doce renglones convertiría en trabajo lo
   * que es una sola decisión. Lo que se decide es el renglón; cuántas
   * operaciones hagan falta es del código.
   */
  changes: Change[];
  approved: boolean;
}

/*
 * Las claves con que se guarda lo que el bibliotecario propone no están aquí:
 * las dice el corpus y viajan con el resultado del procesamiento.
 *
 * Escribirlas en el cliente convertía en decisión de Vera algo que es de quien
 * escribe: quien lleve su corpus en otra lengua no tiene por qué recibir
 * sugerencias que le escriban `type` en sus páginas.
 */
const DEFAULT_NAMES = { kind: 'tipo', topic: 'concepto' };
/**
 * Procesa la página, cuenta lo que va haciendo, y propone cambios.
 *
 * @invariant ProcessingProposesAndNothingMore: nada se escribe aquí. Lo que
 * aparece son proposiciones, y hasta que alguien pulsa «aplicar» la página está
 * exactamente como estaba. Cerrar el panel la deja igual.
 */
/*
 * Los defectos de forma, dichos en palabras.
 *
 * El dominio los nombra en inglés y con guiones bajos porque son un enum; aquí
 * se dicen como se leen. Y se dicen como observaciones —«párrafos largos sin
 * partir»— y no como órdenes —«partir los párrafos»—, que es la diferencia entre
 * describir una página y decidir por quien la escribió.
 */
/** Cómo se llama cada estado en la hoja de estilo. Sin espacios ni tildes. */
const TASK_CLASS: Record<string, string> = {
  'por hacer': 'todo',
  haciendo: 'doing',
  hecho: 'done',
};

const DEFECTS: Record<string, string> = {
  empty_block: 'bloques vacíos',
  monolithic_paragraph: 'párrafos largos sin partir',
  implicit_heading: 'bloques que se comportan como título sin serlo',
  flat_list: 'listas sin ninguna profundidad',
  inconsistent_hierarchy: 'encabezados colgando de otro más hondo',
  mixed_units: 'bloques con más de una unidad dentro',
};

/** Cuántos de cada clase, en el orden en que aparecieron. */
function countBy(seen: { defect: string }[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const one of seen) counts.set(one.defect, (counts.get(one.defect) ?? 0) + 1);
  return [...counts];
}

async function processPage(
  page: { id: string; title: string; properties?: { key: string; value: string }[] },
  notify: (message: string) => void,
  callbacks?: OutlinerCallbacks,
): Promise<void> {
  const panel = document.querySelector<HTMLElement>('#tokens');
  if (panel === null) return;
  panel.hidden = false;
  panel.innerHTML = '';

  const head = document.createElement('header');
  head.className = 'settings-head';
  const title = document.createElement('h2');
  title.textContent = `Procesando «${page.title}»`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'settings-close';
  close.setAttribute('aria-label', 'Cerrar');
  close.title = 'Cerrar';
  close.innerHTML = icon('x');
  const shut = (): void => {
    panel.hidden = true;
    panel.innerHTML = '';
  };
  close.addEventListener('click', shut);
  head.append(title, close);
  panel.append(head);

  const body = document.createElement('div');
  body.className = 'settings-body';
  panel.append(body);

  /*
   * La bitácora de lo que está pasando.
   *
   * Se escribe según ocurre y se queda cuando termina. Lo que cuenta no es que
   * algo avanza —para eso basta una animación, y una animación miente cuando el
   * proceso se cuelga— sino qué está haciendo: qué dirección consulta ahora,
   * cuál no contestó, si el modelo local está. Cuando algo sale mal, esta lista
   * es la única explicación que va a haber.
   */
  const log = document.createElement('ol');
  log.className = 'process-log';
  body.append(log);

  /*
   * Y debajo del registro, qué se está esperando.
   *
   * Lo hecho se acumula encima y lo que falta está en un solo sitio. Lleva su
   * cuenta de segundos, que es lo que faltaba: un paso que lleva doce segundos
   * se veía igual que uno que lleva doscientos milisegundos, y el silencio entre
   * dos líneas no se distinguía de un proceso muerto. Ver waiting.ts.
   */
  const pending = pendingLine(log);
  pending.say('pidiendo al servidor que la procese', 'process:start');
  /** Si el proceso se cortó a mitad, para no recordar un fallo como una duración. */
  let broke = false;

  const step = (text: string, kind: 'doing' | 'ok' | 'bad' | 'note' = 'doing'): HTMLElement => {
    const line = document.createElement('li');
    line.className = `process-step ${kind}`;
    line.textContent = text;
    // Por encima de la línea de espera, que es siempre la última.
    log.insertBefore(line, pending.element);
    line.scrollIntoView({ block: 'nearest' });
    return line;
  };

  let reading: PageReading | null = null;

  try {
    const answer = await fetch(`/pages/${encodeURIComponent(page.id)}/process`, { method: 'POST' });
    if (!answer.ok || answer.body === null) {
      step('no se pudo procesar la página', 'bad');
      return;
    }

    // NDJSON: una línea por hecho. Se lee según llega, que es lo que permite
    // contarlo mientras pasa en vez de al final.
    const decoder = new TextDecoder();
    const stream = answer.body.getReader();
    let rest = '';

    for (;;) {
      const { value, done } = await stream.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        const event = JSON.parse(line) as Record<string, unknown>;
        switch (event['step']) {
          case 'reading':
            step(`leídos ${String(event['blocks'])} bloques · ${String(event['chars'])} caracteres`, 'ok');
            pending.say('mirando la forma de la página');
            break;
          /*
           * La forma de la página, leída contando y sin modelo.
           *
           * @guarantee WhatWasFoundIsNotYetAProposal: esto se enseña como lo que
           * es —una descripción— y no como algo que aplicar. No lleva botón, no
           * viene preseleccionado y no promete un arreglo, porque qué hacer con
           * un párrafo monolítico es una decisión que Herbert dejó abierta a
           * propósito y enseñarla como sugerencia la tomaría por él.
           */
          case 'structure': {
            step(`forma: ${String(event['summary'])}`, 'ok');
            pending.say('el servidor sigue trabajando');
            const seen = (event['observations'] ?? []) as { defect: string; evidence: string }[];
            for (const [defect, count] of countBy(seen)) {
              step(`${count} × ${DEFECTS[defect] ?? defect}`, 'note');
            }
            break;
          }
          /*
           * La puesta en forma, que ocurre sin preguntar.
           *
           * Es lo único que procesar cambia por su cuenta: partir párrafos
           * largos, marcar títulos implícitos, enderezar jerarquías torcidas,
           * separar unidades pegadas y borrar los huecos. Ninguna añade ni quita
           * sentido —el texto no se reescribe: se corta, se prefija un `#` y se
           * cambia de sitio—, y por eso no hay nada que decidir.
           *
           * Se aplica aquí, operación por operación y contra POST /operations,
           * porque ésa es la única entrada de escritura de VERA: cada paso queda
           * en el log con su autoría y su secuencia, como cualquier edición
           * hecha a mano. Sin botón de deshacer y sin capa de inversas: lo que
           * quedó mal se corrige escribiendo, como todo lo demás.
           *
           * En orden y parándose al primer rechazo: las posiciones de cada paso
           * cuentan con que el anterior entró.
           */
          case 'plan': {
            const changes = (event['changes'] ?? []) as Change[];
            const did = (event['did'] ?? []) as string[];
            if (changes.length === 0) {
              step('la forma ya estaba bien; no se tocó nada', 'note');
              break;
            }
            let escritas = 0;
            for (const change of changes) {
              const result = await api.submit(change);
              if (result.status === 'rejected') {
                step(`la puesta en forma se detuvo: ${result.reason}`, 'bad');
                break;
              }
              escritas += 1;
            }
            if (escritas === changes.length) {
              for (const line of did) step(line, 'ok');
            } else {
              step(`puesta en forma a medias: ${escritas} de ${changes.length} operaciones`, 'bad');
            }
            if (escritas > 0) callbacks?.onReload(null);
            pending.say('el servidor sigue trabajando');
            break;
          }
          /*
           * La lectura de sentido, que va por partes.
           *
           * @invariant ReadingInPartsIsSaidInParts: una página larga se lee en
           * varias veces porque el modelo no la aguanta entera, y eso tarda. Que
           * se vea por cuál parte va y de qué sección es la diferencia entre
           * tardar y parecer colgado.
           */
          case 'model': {
            const of = Number(event['of'] ?? 1);
            const which = Number(event['pass'] ?? 1);
            const section = String(event['section'] ?? '');
            const part =
              of > 1 ? ` · parte ${which} de ${of}${section === '' ? '' : ` · «${section}»`}` : '';
            if (event['state'] === 'structuring') {
              pending.say('preguntando cómo se relacionan los bloques planos', 'process:model');
            } else if (event['state'] === 'structure_failed') {
              step(String(event['why']), 'bad');
              pending.say('el servidor sigue trabajando');
            } else if (event['state'] === 'structured') {
              const moves = Number(event['moves'] ?? 0);
              step(
                moves === 0 ? 'no encontró una jerarquía clara' : `propuso tabular ${moves} bloques`,
                moves === 0 ? 'note' : 'ok',
              );
              pending.say('el servidor sigue trabajando');
            } else if (event['state'] === 'asking') {
              /*
               * La espera larga del proceso, y la única de la que se sabe de
               * antemano que va a serlo.
               *
               * Se recuerda con una clave que no incluye la parte —«parte 2 de
               * 3» es la misma espera que «parte 1 de 3»— para que las medidas
               * de todas las llamadas al modelo promedien juntas.
               */
              pending.say(`preguntando al modelo local qué es y de qué trata${part}`, 'process:model');
            } else if (event['state'] === 'failed') {
              step(String(event['why']), 'bad');
              pending.say('el servidor sigue trabajando');
            } else {
              /*
               * Lo que tardó se queda en el registro.
               *
               * La línea de espera se va con el proceso, y sin esto el registro
               * terminado no decía nada de lo que costó: «el modelo contestó»
               * se lee igual si tardó medio segundo o cuarenta. Ver el comentario
               * del registro: cuando algo sale mal, esta lista es la única
               * explicación que va a haber.
               */
              const took = pending.elapsed();
              step(`el modelo contestó${took > 1500 ? ` · ${saySeconds(took)}` : ''}`, 'ok');
              pending.say('buscando qué páginas nombra sin enlazar');
            }
            break;
          }
          case 'mentions': {
            const found = Number(event['found'] ?? 0);
            const titles = (event['titles'] ?? []) as string[];
            step(
              found === 0
                ? 'no nombra ninguna página del corpus sin enlazar'
                : `nombra sin enlazar: ${titles.join(' · ')}`,
              found === 0 ? 'note' : 'ok',
            );
            pending.say('el servidor sigue trabajando');
            break;
          }
          case 'link': {
            const url = String(event['url']);
            const where = `${String(event['done'])}/${String(event['total'])}`;
            if (event['unreachable'] !== null) step(`${where} · no contestó · ${url}`, 'bad');
            else step(`${where} · ${String(event['title'] ?? event['kind'] ?? 'sin título')} · ${url}`, 'ok');
            // Cada enlace es una petición a un servidor de fuera, y algunos
            // tardan lo suyo. Sin esto, entre un enlace y el siguiente no había
            // nada que dijera que se seguía esperando a alguien.
            if (Number(event['done']) < Number(event['total'])) {
              pending.say(
                `consultando enlaces · ${String(event['done'])} de ${String(event['total'])}`,
                'process:link',
              );
            } else {
              pending.say('el servidor sigue trabajando');
            }
            break;
          }
          case 'done':
            reading = event as unknown as PageReading;
            step('terminado', 'ok');
            break;
          default:
            break;
        }
      }
    }
  } catch {
    step('se perdió la conexión con el servidor a mitad', 'bad');
    broke = true;
    return;
  } finally {
    // Una línea de espera que sobrevive al proceso es la peor forma de mentir:
    // parece que sigue habiendo algo.
    //
    // Y lo que se cortó a mitad no se anota como medida: si perder la conexión
    // al segundo tres contara, unas cuantas caídas convencerían a Vera de que el
    // modelo local contesta en tres segundos, y se lo prometería a quien mire.
    pending.close(broke ? 'failed' : 'succeeded');
  }

  if (reading === null) {
    step('el servidor no llegó a decir qué encontró', 'bad');
    return;
  }

  for (const line of reading.notDone) step(line, 'bad');

  /*
   * De la lectura a las proposiciones.
   *
   * No se propone lo que la página ya dice: repetir una propiedad que ya está
   * no es un cambio, y ofrecerlo obligaría a descartarlo una vez por proceso.
   */
  const names = reading.names ?? DEFAULT_NAMES;
  const already = new Set((page.properties ?? []).map((p) => `${p.key}=${p.value}`));
  const suggestions: Suggestion[] = [];

  for (const value of reading.types) {
    if (already.has(`${names.kind}=${value}`)) continue;
    suggestions.push({
      what: `qué es: ${value}`,
      detail: `${names.kind}:: ${value}`,
      changes: [
        { kind: 'set_property', page: page.id, propertyKey: names.kind, propertyValue: value },
      ],
      approved: true,
    });
  }

  /*
   * De qué trata, dicho de forma que una a la página con el corpus.
   *
   * Un concepto que ya es una página del grafo no es lo mismo que uno nuevo: el
   * primero mete esta página en un vecindario que ya existe —y por eso el
   * renglón dice cuántas páginas lo enlazan ya—, el segundo abre un nombre que
   * hasta ahora no estaba. Aceptar los dos es legítimo; confundirlos es lo que
   * hace que un corpus tenga «diseño», «Diseño» y «diseños» y ninguno de los
   * tres reúna lo que el otro tiene.
   */
  for (const concept of reading.concepts) {
    if (already.has(`${names.topic}=${concept.value}`)) continue;
    suggestions.push({
      what: `de qué trata: ${concept.value}`,
      detail:
        concept.page === null
          ? `${names.topic}:: ${concept.value} · nuevo en el corpus`
          : `${names.topic}:: ${concept.value} · ya es página${
              concept.backlinks > 0 ? `, con ${concept.backlinks} enlaces` : ''
            }`,
      changes: [
        {
          kind: 'set_property',
          page: page.id,
          propertyKey: names.topic,
          propertyValue: concept.value,
        },
      ],
      approved: true,
    });
  }

  /*
   * Lo que la página nombra y el corpus ya tiene, propuesto como enlace.
   *
   * Es lo que la vuelve encontrable desde el otro lado: una página que dice
   * «Ciudad Abierta» sin enlazarla no aparece entre los enlaces entrantes de
   * Ciudad Abierta, y quien recorra el corpus desde allí no llegará nunca. La
   * dirección del texto no se toca: se envuelve la palabra tal como está escrita
   * —el grafo resuelve el enlace sin distinguir mayúsculas ni tildes—, que es la
   * misma promesa que con los enlaces externos.
   */
  // Un bloque con un cambio propuesto ya no admite otro: los dos se proponen
  // como el texto entero que el bloque tendría, y aceptar los dos deja el
  // segundo. La mención que se cae vuelve a proponerse la próxima vez.
  const tocados = new Set(
    suggestions
      .flatMap((one) => one.changes)
      .map((one) => (one.kind === 'edit_block' ? one.block : null))
      .filter((one): one is string => one !== null),
  );

  for (const mention of reading.mentions ?? []) {
    if (tocados.has(mention.block)) continue;
    tocados.add(mention.block);
    suggestions.push({
      what: `enlazar con «${mention.title}»`,
      detail:
        mention.backlinks > 0
          ? `dice «${mention.written}» · ${mention.backlinks} páginas ya la enlazan`
          : `dice «${mention.written}»`,
      changes: [{ kind: 'edit_block', block: mention.block, content: mention.next }],
      approved: true,
    });
  }

  if ((reading.hierarchy?.changes.length ?? 0) > 0) {
    suggestions.push({
      what: `estructurar ${reading.hierarchy?.changes.length ?? 0} bloques`,
      detail: reading.hierarchy?.explanation ?? '',
      changes: reading.hierarchy?.changes ?? [],
      approved: true,
    });
  }

  // Una dirección desnuda pasa a llevar su título. La dirección no se toca:
  // @guarantee ALinkResolvedKeepsItsAddress — se envuelve, no se sustituye.
  for (const link of reading.links) {
    if (link.title === null || link.block === null || link.content === null) continue;
    // Ya tiene título: envolver otra vez lo rompería.
    if (link.content.includes(`](${link.url})`)) continue;
    const next = link.content.split(link.url).join(`[${link.title}](${link.url})`);
    if (next === link.content) continue;
    suggestions.push({
      what: `titular el enlace: ${link.title}`,
      detail: link.url,
      changes: [{ kind: 'edit_block', block: link.block, content: next }],
      approved: true,
    });
  }

  if (suggestions.length === 0) {
    const none = document.createElement('p');
    none.className = 'settings-note';
    none.textContent = 'Nada que proponer: lo que se leyó ya está en la página.';
    body.append(none);
    return;
  }

  const heading = document.createElement('h3');
  heading.className = 'settings-group';
  heading.textContent = `Sugerencias (${suggestions.length})`;
  body.append(heading);

  const list = document.createElement('div');
  list.className = 'suggestions';
  body.append(list);

  /** Las que siguen a la vista, sin decidir. */
  const abiertas = new Set<Suggestion>();

  /*
   * Lo que la página ya dice, para no pisarlo y para poder sumar.
   *
   * `set_property` guarda un valor por clave, así que escribir un tipo nuevo sin
   * mirar lo que había borraría los anteriores. Se lleva aquí el estado y se
   * actualiza a cada escritura: así aplicar de una en una acumula igual que
   * aplicar todas de golpe, que es lo que alguien espera al pulsar dos vistos
   * seguidos.
   */
  const held = new Map<string, string[]>();
  for (const property of page.properties ?? []) {
    held.set(
      property.key,
      property.value.split(',').map((v) => v.trim()).filter((v) => v !== ''),
    );
  }

  /** Escribe un grupo de sugerencias. Devuelve si todo lo pedido se escribió. */
  const escribir = async (chosen: Suggestion[]): Promise<boolean> => {
    const byKey = new Map<string, string[]>();
    const others: { suggestion: Suggestion; change: Change }[] = [];
    for (const suggestion of chosen) {
      for (const change of suggestion.changes) {
        if (change.kind !== 'set_property') {
          others.push({ suggestion, change });
          continue;
        }
        const key = change.propertyKey;
        const values = byKey.get(key) ?? [...(held.get(key) ?? [])];
        if (!values.includes(change.propertyValue)) values.push(change.propertyValue);
        byKey.set(key, values);
      }
    }

    let entero = true;

    for (const [key, values] of byKey) {
      const result = await api.submit({
        kind: 'set_property',
        page: page.id,
        propertyKey: key,
        propertyValue: values.join(', '),
      });
      if (result.status === 'rejected') {
        step(`rechazado: ${result.reason} · ${key}`, 'bad');
        entero = false;
        continue;
      }
      held.set(key, values);
      step(`${key}:: ${values.join(', ')}`, 'ok');
    }

    const dicho = new Set<Suggestion>();
    for (const { suggestion, change } of others) {
      const result = await api.submit(change);
      if (result.status === 'rejected') {
        step(`rechazado: ${result.reason} · ${suggestion.what}`, 'bad');
        entero = false;
        continue;
      }
      // Un renglón se cuenta una vez aunque hayan hecho falta doce operaciones.
      if (!dicho.has(suggestion)) {
        dicho.add(suggestion);
        step(suggestion.what, 'ok');
      }
    }

    return entero;
  };

  /*
   * Las escrituras van en fila de a una.
   *
   * Una propiedad guarda un valor por clave, así que aceptar un tipo es leer lo
   * que la página ya tiene, añadir el nuevo y escribir la lista entera. Dos de
   * esas a la vez leen las dos lo mismo, y la que llega segunda escribe una
   * lista donde la primera no está: se acepta una sugerencia, se ve aplicada, y
   * al recargar no está. Aceptar tres seguidas —que es lo natural cuando las
   * sugerencias son tres— dejaba sólo la última.
   *
   * No hace falta un modo distinto ni juntarlo todo para el final: hace falta
   * que la segunda escritura empiece cuando la primera ya terminó, que es lo que
   * hace esta fila. Cada acepta se aplica en el acto, y ninguna pisa a otra.
   */
  let cola: Promise<unknown> = Promise.resolve();
  const write = (chosen: Suggestion[]): Promise<boolean> => {
    const turno = cola.then(() => escribir(chosen));
    // La fila no puede romperse por un fallo: si una escritura revienta, la
    // siguiente tiene que poder correr igual.
    cola = turno.catch(() => undefined);
    return turno;
  };

  for (const suggestion of suggestions) {
    const row = document.createElement('div');
    row.className = 'suggestion';

    const text = document.createElement('div');
    text.className = 'suggestion-text';
    const what = document.createElement('span');
    what.className = 'suggestion-what';
    what.textContent = suggestion.what;
    const detail = document.createElement('span');
    detail.className = 'suggestion-detail';
    detail.textContent = suggestion.detail;
    text.append(what, detail);

    /*
     * Dos botones y no un interruptor.
     *
     * Aceptar y descartar son dos gestos distintos, no dos estados de uno: con
     * un interruptor hay que leer qué dice ahora para saber qué va a hacer, y
     * eso es una pregunta de más por cada renglón. Con la cruz y el visto se
     * pulsa lo que se quiere hacer.
     *
     * Los dos hacen desaparecer la fila, y por la misma razón: una vez decidido
     * ya no es una sugerencia. Lo aplicado está en la página, que es donde se
     * lee; lo descartado no está en ninguna parte, que es lo que se pidió.
     */
    const decide = document.createElement('div');
    decide.className = 'suggestion-decide';

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'suggestion-no';
    drop.innerHTML = icon('x');
    drop.setAttribute('aria-label', `Descartar: ${suggestion.what}`);
    drop.title = 'Descartar';
    drop.addEventListener('click', () => {
      suggestion.approved = false;
      row.remove();
      abiertas.delete(suggestion);
      count();
    });

    const take = document.createElement('button');
    take.type = 'button';
    take.className = 'suggestion-yes';
    take.innerHTML = icon('check');
    take.setAttribute('aria-label', `Aplicar: ${suggestion.what}`);
    take.title = 'Aplicar';
    take.addEventListener('click', () => {
      void (async () => {
        take.disabled = true;
        drop.disabled = true;
        // Sale de las abiertas al pulsar y no al escribirse: mientras espera su
        // turno en la fila ya está decidida, y «aplicar los que quedan» no puede
        // volver a incluirla.
        abiertas.delete(suggestion);
        escribiendo += 1;
        count();
        const ok = await write([suggestion]);
        escribiendo -= 1;
        if (!ok) {
          take.disabled = false;
          drop.disabled = false;
          abiertas.add(suggestion);
          count();
          return;
        }
        row.remove();
        count();
        callbacks?.onReload(null);
      })();
    });

    decide.append(drop, take);
    row.append(text, decide);
    list.append(row);
    abiertas.add(suggestion);
  }

  /*
   * Aplicar y cancelar, a la izquierda y como texto.
   *
   * No son botones porque no compiten: aplicar es la consecuencia de lo que
   * acaba de decidirse renglón a renglón, y dibujarlo como un botón grande lo
   * convertiría en la acción principal de un panel cuya acción principal es
   * leer. A la izquierda porque es donde termina la lectura de cada renglón.
   */
  const foot = document.createElement('div');
  foot.className = 'suggestions-foot';

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'suggestion-apply';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'suggestion-cancel';
  cancel.textContent = 'cancelar';
  cancel.addEventListener('click', shut);

  foot.append(apply, cancel);

  /** Cuántas escrituras hay en curso o esperando su turno en la fila. */
  let escribiendo = 0;

  const count = (): void => {
    const n = abiertas.size;
    apply.textContent = n === 1 ? 'aplicar' : `aplicar los ${n}`;
    apply.disabled = n === 0;
    // Sin nada que decidir, el panel deja de ser un panel de sugerencias. Pero
    // sólo cuando además no queda ninguna escribiéndose: si la última falla hay
    // que poder verla volver, y no se ve volver a una lista que ya se retiró.
    if (n === 0 && escribiendo === 0) {
      heading.remove();
      list.remove();
      foot.remove();
    }
  };

  apply.addEventListener('click', () => {
    void (async () => {
      apply.disabled = true;
      cancel.disabled = true;
      const chosen = [...abiertas];
      step(`aplicando ${chosen.length} sugerencias…`);

      const entero = await write(chosen);
      for (const suggestion of chosen) abiertas.delete(suggestion);

      // Aplicado deja de ser sugerencia: la lista se retira entera, y lo que se
      // escribió está ya en la página, que es donde se lee.
      list.remove();
      heading.remove();
      foot.remove();
      step(entero ? 'aplicadas todas' : 'algunas no se pudieron aplicar', entero ? 'ok' : 'bad');
      notify(`procesada «${page.title}»`);
      callbacks?.onReload(null);
    })();
  });

  body.append(foot);
  count();
}

async function copyPageMarkdown(page: string): Promise<void> {
  const text = await pageMarkdown(page);
  if (text === null) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(`copiado: ${text.length} caracteres`);
  } catch {
    toast('no se pudo copiar; el portapapeles exige contexto seguro');
  }
}

async function downloadPage(page: { id: string; title: string }): Promise<void> {
  const text = await pageMarkdown(page.id);
  if (text === null) return;

  // El nombre del archivo lleva el título, no el identificador: lo exportado se
  // abre fuera de Vera y ahí `page:31015` no le dice nada a nadie. Los caracteres
  // que un sistema de archivos no admite se sustituyen, como hace Logseq.
  const name = `${page.title.replace(/[/\\?%*:|"<>]/g, '_').trim() || page.id}.md`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  toast(`exportado ${name}`);
}

/**
 * Trae el PDF que compuso el servidor y lo deja descargado.
 *
 * No se imprime desde aquí. Imprimir dejaba el resultado en manos de quien lo
 * pidiera —márgenes del sistema, encabezados con la fecha y la dirección, el
 * tamaño de papel de la impresora que hubiera— y un PDF que se guarda no puede
 * depender de eso. El servidor lo compone en carta, sin fondo, sin las
 * propiedades de la cabecera y sin las referencias del pie. Ver paper.ts.
 */
async function downloadPdf(
  page: { id: string; title: string },
  notify: (message: string) => void,
): Promise<void> {
  notify('componiendo el PDF…');
  try {
    const answer = await fetch(`/pages/${encodeURIComponent(page.id)}/pdf`);
    if (!answer.ok) {
      const said = (await answer.json().catch(() => ({}))) as { error?: string };
      notify(said.error ?? 'no se pudo componer el PDF');
      return;
    }
    const name = `${page.title.replace(/[/\\?%*:|"<>]/g, '_').trim() || page.id}.pdf`;
    const url = URL.createObjectURL(await answer.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    notify(`exportado ${name}`);
  } catch {
    notify('no se pudo componer el PDF');
  }
}

/**
 * Le da el bloque al modelo local como pedido y espera su respuesta.
 *
 * Puede tardar: el modelo corre en esta máquina, que es lo que hace que el
 * pedido no salga de casa. Mientras tanto el bloque se marca —una animación
 * miente cuando el proceso se cuelga, pero un bloque marcado dice cuál está
 * ocupado— y al terminar se rehace la página, porque lo que cambió no es sólo
 * ese bloque sino lo que cuelga de él.
 */
async function processBlock(
  block: { stableId: string },
  row: HTMLElement,
  notify: (message: string) => void,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  row.classList.add('thinking');
  notify('el modelo está leyendo el bloque…');
  try {
    const answer = await fetch(`/blocks/${encodeURIComponent(block.stableId)}/process`, {
      method: 'POST',
    });
    const said = (await answer.json().catch(() => ({}))) as {
      error?: string;
      title?: string;
      items?: number;
    };
    if (!answer.ok) {
      notify(said.error ?? 'el modelo no pudo procesar el bloque');
      return;
    }
    notify(
      said.items === undefined || said.items === 0
        ? `contestado: ${said.title ?? ''}`
        : `contestado: ${said.title ?? ''} · ${said.items} ítems`,
    );
    callbacks.onReload(null, reloadAfterServerWriting());
  } catch {
    notify('el modelo no pudo procesar el bloque');
  } finally {
    row.classList.remove('thinking');
  }
}

/**
 * Enseña por qué estados pasó un bloque, junto al bloque.
 *
 * Junto a él y no en otra pantalla: lo que se está preguntando es «¿qué decía
 * esto antes?», y esa pregunta se hace mirándolo. Cada estado se puede copiar;
 * ninguno se aplica solo, porque volver a un estado anterior es escribir y se
 * escribe a mano o se deshace, que ya existe.
 */
async function showHistory(
  block: string,
  row: HTMLElement,
  notify: (message: string) => void,
): Promise<void> {
  row.querySelector('.history')?.remove();
  let said;
  try {
    said = await api.history(block);
  } catch {
    notify('no se pudo leer la historia de este bloque');
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'history';
  const head = document.createElement('div');
  head.className = 'history-head';
  head.textContent =
    said.states.length === 1
      ? 'nació así y no se ha tocado'
      : `${said.states.length} estados${said.alive ? '' : ' · el bloque ya no está'}`;
  const shut = document.createElement('button');
  shut.type = 'button';
  shut.className = 'history-close';
  shut.textContent = 'cerrar';
  shut.addEventListener('click', () => panel.remove());
  head.append(shut);
  panel.append(head);

  for (const state of [...said.states].reverse()) {
    const line = document.createElement('div');
    line.className = state.content === said.now ? 'history-state now' : 'history-state';
    const when = document.createElement('span');
    when.className = 'history-when';
    when.append(`${new Date(state.at).toISOString().slice(0, 16).replace('T', ' ')} · ${state.what} · `);
    const author = document.createElement('a');
    author.href = participantActivityPath(state.participant);
    author.textContent = state.by;
    author.title = `Ver las contribuciones de ${state.by}`;
    when.append(author);
    line.append(when);
    if (state.content !== null) {
      const text = document.createElement('div');
      text.className = 'history-text';
      text.textContent = state.content === '' ? '(vacío)' : state.content;
      line.append(text);
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'history-copy';
      copy.textContent = 'copiar';
      copy.addEventListener('click', () => copyText(state.content ?? '', notify));
      line.append(copy);
    }
    panel.append(line);
  }
  row.append(panel);
}

/**
 * El lienzo, o el motivo por el que no va a haberlo.
 *
 * Se carga aparte, y sólo cuando alguien dibuja: es un archivo que no tiene por
 * qué viajar con la primera pantalla. La contrapartida es que puede no llegar.
 * Un cliente compilado hace rato pide un trozo con una huella que el servidor ya
 * no tiene, y la petición vuelve 404 —le pasa a la pestaña que se quedó abierta
 * desde antes de la última compilación, y al armazón que el service worker
 * guardó—.
 *
 * Sin esto el rechazo caía dentro de un `void` y el navegador lo escribía en una
 * consola que nadie mira: el comando borraba `/dibujo` del bloque, no abría
 * nada, y no decía por qué. Un fallo que no habla es indistinguible de un
 * comando que no existe, y manda a buscar el error donde no está.
 *
 * @guarantee ACanvasThatCannotOpenSaysSo.
 */
async function canvasModule(
  notify: (message: string) => void,
): Promise<typeof import('./canvas.ts') | null> {
  try {
    return await import('./canvas.ts');
  } catch {
    // Qué hacer, y no sólo qué pasó: recargar trae el cliente nuevo, y es lo
    // único que quien mira puede hacer al respecto.
    notify('no se pudo abrir el lienzo: este cliente quedó viejo, recarga la página');
    return null;
  }
}

/**
 * Escribe un dibujo, y dice en voz alta cuando no pudo.
 *
 * Un dibujo sólo existe dentro del lienzo hasta que se guarda, y el lienzo ya se
 * cerró cuando esto corre: si la escritura falla callando, lo dibujado se perdió
 * sin que nadie se enterara. Un rechazo del dominio y una red caída son sucesos
 * distintos, pero desde aquí dicen lo mismo —no quedó escrito— y las dos formas
 * de fallar tienen que llegar a quien dibujó.
 *
 * @guarantee ADrawingThatDidNotGetWrittenSaysSo.
 */
async function drawingSaved(
  write: () => Promise<SubmitResult>,
  notify: (message: string) => void,
): Promise<boolean> {
  let said;
  try {
    said = await write();
  } catch {
    notify('no se pudo guardar el dibujo: sin conexión con el servidor');
    return false;
  }
  if (said.status === 'rejected') {
    notify(`no se pudo guardar el dibujo: ${said.reason}`);
    return false;
  }
  return true;
}

/**
 * Abre el lienzo y deja lo dibujado en un bloque.
 *
 * Si el bloque estaba vacío —lo normal: se escribió `/dibujo` y nada más—, el
 * dibujo lo ocupa. Si había algo escrito, eso se queda donde está y el dibujo
 * nace debajo: los trazos son el texto de un bloque de dibujo, así que una frase
 * y un dibujo no caben en el mismo.
 *
 * Se escribe por el canal `drawn`, que no es un detalle de cómo entró: un trazo
 * con su presión es prueba de que alguien lo hizo con la mano.
 * @invariant AHandLeavesItsName.
 */
async function drawInto(
  block: string,
  page: string,
  written: string,
  callbacks: OutlinerCallbacks,
  notify: (message: string) => void,
): Promise<void> {
  const canvas = await canvasModule(notify);
  if (canvas === null) return;
  const drawn = await canvas.openCanvas();
  if (drawn.content === '') {
    // @invariant AnEmptyCanvasWritesNothing: mirar el lienzo no es escribir. Lo
    // que hubiera escrito vuelve como estaba, sin el comando.
    const back = await drawingSaved(
      () => api.submit({ kind: 'edit_block', block, content: written }),
      notify,
    );
    if (back) callbacks.onReload(null);
    return;
  }

  const saved = await drawingSaved(
    written === ''
      ? () => api.submit({ kind: 'edit_block', block, content: drawn.content }, 'drawn')
      : async () => {
          await api.submit({ kind: 'edit_block', block, content: written });
          return api.submit(
            {
              kind: 'create_block',
              page,
              parent: null,
              position: Number.MAX_SAFE_INTEGER,
              content: drawn.content,
            },
            'drawn',
          );
        },
    notify,
  );
  if (!saved) return;
  callbacks.onReload(null);
}

/**
 * Vuelve a dibujar sobre un dibujo terminado.
 *
 * Con lo que ya había dentro: seguir dibujando es seguir, no empezar otro. Es lo
 * que hace que tocar un dibujo abra el lienzo y no un campo con sus coordenadas.
 * @invariant EditingADrawingOpensTheCanvas.
 */
async function redraw(
  block: BlockView,
  callbacks: OutlinerCallbacks,
  notify: (message: string) => void,
): Promise<void> {
  const canvas = await canvasModule(notify);
  if (canvas === null) return;
  const drawn = await canvas.openCanvas(readDrawing(block.content));
  // Borrar todos los trazos y salir deja el bloque vacío, no lo borra: quitar un
  // bloque es otra decisión y tiene su propio gesto.
  const saved = await drawingSaved(
    () => api.submit({ kind: 'edit_block', block: block.stableId, content: drawn.content }, 'drawn'),
    notify,
  );
  if (!saved) return;
  callbacks.onReload(null);
}

export interface Node {
  block: BlockView;
  children: Node[];
}

/** El orden auditable en que desaparece un subárbol: hojas antes que padres. */
export function blockRemovalOrder(node: Node): string[] {
  return [...node.children.flatMap(blockRemovalOrder), node.block.stableId];
}

/**
 * Markdown portable de un bloque completo.
 *
 * Copiar un bloque padre sin sus hijos amputa la unidad que se ve plegada bajo
 * él. El bloque escogido sale como raíz y cada descendiente como viñeta
 * sangrada; así pegarlo conserva tanto el texto como la estructura, sin filtrar
 * identidades internas al portapapeles.
 */
export function nodeMarkdown(node: Node): string {
  const lines: string[] = [node.block.content];
  const descend = (children: Node[], depth: number): void => {
    for (const child of children) {
      const content = child.block.content.replace(/\n/g, `\n${'  '.repeat(depth)}  `);
      lines.push(`${'  '.repeat(depth)}- ${content}`);
      descend(child.children, depth + 1);
    }
  };
  descend(node.children, 0);
  return lines.join('\n');
}

/**
 * Los bloques escogidos ahora mismo, y desde donde se empezo a escoger.
 *
 * @invariant NothingIsSelectedWhileWriting. Un cursor y una seleccion son dos
 * respuestas distintas a «sobre que actua la siguiente tecla», y solo una puede
 * ser cierta: empezar a escribir vacia la seleccion, y escoger deja la escritura.
 *
 * Vive fuera del dibujo porque el dibujo se rehace entero en cada cambio, y una
 * seleccion que se perdiera en cada repintado no serviria para nada. Se limpia
 * al cambiar de pagina, que es cuando deja de querer decir algo.
 */
const picked = new Set<string>();
let pickedOn: string | null = null;
/**
 * El extremo que se mueve, que no es el mismo que el ancla.
 *
 * Sin recordarlo, estirar y recoger no son operaciones inversas: si el borde se
 * dedujera del tramo —el mayor indice al bajar, el menor al subir— entonces
 * Shift+arriba sobre un tramo que crecio hacia abajo se iria al otro lado del
 * ancla en vez de recogerlo. Un extremo es una posicion, no una consecuencia.
 */
let pickedTo: string | null = null;
let pickedPage: string | null = null;
/** Retira el oyente de teclado del dibujo anterior. */
let dropPickedKeys: (() => void) | null = null;

/** Deshace la seleccion. Lo llama todo lo que empieza a escribir. */
export function clearPicked(): void {
  picked.clear();
  pickedOn = null;
  pickedTo = null;
  for (const row of document.querySelectorAll('.block.picked')) row.classList.remove('picked');
}

/** Busca un nodo por su identidad en cualquier profundidad del árbol. */
function findNode(nodes: Node[], id: string): Node | null {
  for (const node of nodes) {
    if (node.block.stableId === id) return node;
    const found = findNode(node.children, id);
    if (found !== null) return found;
  }
  return null;
}

export function buildTree(blocks: BlockView[]): Node[] {
  const nodes = new Map<string, Node>();
  for (const block of blocks) nodes.set(block.stableId, { block, children: [] });

  const roots: Node[] = [];
  for (const block of blocks) {
    const node = nodes.get(block.stableId);
    if (node === undefined) continue;
    const parent = block.parent === null ? undefined : nodes.get(block.parent);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }

  const sort = (list: Node[]): void => {
    list.sort((a, b) => a.block.position - b.block.position);
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

/**
 * El mismo árbol de bloques, contenido por la arista en vez de por una página.
 * Esta superficie compacta conserva las operaciones fundamentales del outliner:
 * escribir, partir, anidar, desanidar, añadir y borrar hojas.
 */
function renderRelationOutline(
  host: HTMLElement,
  relation: CrossingRow,
  callbacks: OutlinerCallbacks,
  readOnly: boolean,
  previewOf: (host: HTMLElement, content: string) => void,
): void {
  host.className = 'relation-outline';
  host.dataset['crossing'] = relation.stableId;
  const nodes = buildTree(relation.blocks ?? []);
  const siblingsOf = (block: BlockView): BlockView[] => (block.parent === null
    ? relation.blocks.filter((one) => one.parent === null)
    : relation.blocks.filter((one) => one.parent === block.parent)
  ).sort((a, b) => a.position - b.position);

  const create = async (parent: string | null, position: number, content = ''): Promise<void> => {
    const born = await api.submit({
      kind: 'create_block', page: relation.fromPage, crossing: relation.stableId,
      parent, position, content,
    });
    if (born.status === 'applied') callbacks.onReload({ block: born.subjectId, at: 0 });
  };

  const draw = (node: Node, depth: number): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'relation-outline-node';
    wrap.style.setProperty('--relation-depth', String(depth));
    const line = document.createElement('div');
    line.className = 'relation-outline-line';
    const bullet = document.createElement('span');
    bullet.className = 'relation-outline-bullet';
    bullet.textContent = '•';
    const editor = document.createElement('div');
    editor.className = 'relation-outline-editor';
    editor.contentEditable = readOnly ? 'false' : 'plaintext-only';
    editor.spellcheck = true;
    editor.textContent = node.block.content;
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-label', 'bloque de la relación');
    const preview = document.createElement('div');
    preview.className = 'relation-outline-preview markdown-preview';
    previewOf(preview, node.block.content);
    const beginEditing = (): void => {
      if (readOnly) return;
      preview.hidden = true;
      editor.hidden = false;
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    preview.addEventListener('click', beginEditing);
    if (node.block.content === '' && !readOnly) {
      preview.hidden = true;
    } else {
      editor.hidden = true;
    }

    const save = async (): Promise<boolean> => {
      const content = editor.textContent ?? '';
      if (content === node.block.content) return true;
      const result = await api.submit({ kind: 'edit_block', block: node.block.stableId, content });
      if (result.status === 'applied') {
        node.block.content = content;
        callbacks.onChanged();
        return true;
      }
      return false;
    };
    editor.addEventListener('blur', () => {
      void save().then(() => {
        preview.innerHTML = '';
        previewOf(preview, node.block.content);
        editor.hidden = true;
        preview.hidden = false;
      });
    });
    editor.addEventListener('keydown', (event) => {
      if (readOnly) return;
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void save().then((ok) => {
          if (!ok) return;
          void create(node.block.parent, node.block.position + 1);
        });
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        const siblings = siblingsOf(node.block);
        const at = siblings.findIndex((one) => one.stableId === node.block.stableId);
        if (!event.shiftKey && at > 0) {
          const parent = siblings[at - 1]!;
          void api.submit({
            kind: 'move_block', block: node.block.stableId, page: relation.fromPage,
            crossing: relation.stableId, parent: parent.stableId,
            position: relation.blocks.filter((one) => one.parent === parent.stableId).length,
          }).then((result) => { if (result.status === 'applied') callbacks.onReload(null); });
        } else if (event.shiftKey && node.block.parent !== null) {
          const parent = relation.blocks.find((one) => one.stableId === node.block.parent);
          if (parent !== undefined) void api.submit({
            kind: 'move_block', block: node.block.stableId, page: relation.fromPage,
            crossing: relation.stableId, parent: parent.parent, position: parent.position + 1,
          }).then((result) => { if (result.status === 'applied') callbacks.onReload(null); });
        }
        return;
      }
      if (event.key === 'Backspace' && (editor.textContent ?? '') === '' && node.children.length === 0) {
        event.preventDefault();
        void api.submit({ kind: 'remove_block', block: node.block.stableId })
          .then((result) => { if (result.status === 'applied') callbacks.onReload(null); });
      }
    });
    const body = document.createElement('div');
    body.className = 'relation-outline-body';
    body.append(preview, editor);
    line.append(bullet, body);
    wrap.append(line);
    for (const child of node.children) wrap.append(draw(child, depth + 1));
    return wrap;
  };
  for (const node of nodes) host.append(draw(node, 0));
  if (!readOnly) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'relation-outline-add';
    add.textContent = 'Añadir bloque';
    add.addEventListener('click', () => { void create(null, nodes.length); });
    host.append(add);
  }
}

export const PRESENTATION_KEY = 'presentación';
export const OUTGOING_REFERENCES_PRESENTATION = 'referencias salientes';

/**
 * El cuerpo legible de una página, sin los aparatos que ella misma manda al pie.
 *
 * Una raíz marcada como `presentación:: referencias salientes` y todo lo que
 * cuelga de ella siguen en la página: conservan identidad, autoría, historia y
 * enlaces. Sólo cambian de sitio al leer. Si se enfoca uno de esos bloques se
 * devuelve el cuerpo entero, porque enfocar es pedir explícitamente verlo y
 * editarlo en su lugar canónico.
 */
export function bodyBlocks(page: Pick<PageView, 'blocks' | 'blockProperties'>, focusRoot: string | null): BlockView[] {
  if (focusRoot !== null) return page.blocks;
  const projectedRoots = new Set(
    page.blocks
      .filter((block) =>
        (page.blockProperties?.[block.stableId] ?? []).some(
          (property) =>
            property.key.trim().toLocaleLowerCase() === PRESENTATION_KEY &&
            property.value.trim().toLocaleLowerCase() === OUTGOING_REFERENCES_PRESENTATION,
        ),
      )
      .map((block) => block.stableId),
  );
  if (projectedRoots.size === 0) return page.blocks;

  const hidden = new Set(projectedRoots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of page.blocks) {
      if (block.parent !== null && hidden.has(block.parent) && !hidden.has(block.stableId)) {
        hidden.add(block.stableId);
        changed = true;
      }
    }
  }
  return page.blocks.filter((block) => !hidden.has(block.stableId));
}

/** El texto íntegro de una conectiva proyectada; los demás enlaces conservan su extracto. */
export function projectedReferenceText(
  page: Pick<PageView, 'blocks' | 'blockProperties'>,
  block: string,
  excerpt: string,
): string {
  const held = page.blocks.find((candidate) => candidate.stableId === block);
  if (held === undefined) return excerpt;
  let at = held.parent;
  while (at !== null) {
    const properties = page.blockProperties?.[at] ?? [];
    if (properties.some(
      (property) =>
        property.key.trim().toLocaleLowerCase() === PRESENTATION_KEY &&
        property.value.trim().toLocaleLowerCase() === OUTGOING_REFERENCES_PRESENTATION,
    )) return held.content;
    at = page.blocks.find((candidate) => candidate.stableId === at)?.parent ?? null;
  }
  return excerpt;
}

/**
 * Traduce las rutas del corpus a los objetos que Vera guarda.
 *
 * La página trae ya resueltas las suyas, así que no hay una petición por
 * imagen ni el cliente tiene que saber cómo se direcciona el almacén.
 */
export function assetResolver(page: PageView): RenderOptions['resolveAsset'] {
  return (path) => {
    // Se consulta la colección viva. Un medio pegado manualmente puede
    // resolverse después de que empezó la edición, sin reconstruir el editor.
    const byPath = new Map(page.assets.map((asset) => [asset.path, asset]));
    const found = byPath.get(path);
    if (found !== undefined) return { url: found.url, mediaType: found.mediaType };
    // El corpus escribe algunas rutas con caracteres codificados y otras no.
    try {
      const decoded = byPath.get(decodeURIComponent(path));
      return decoded === undefined ? null : { url: decoded.url, mediaType: decoded.mediaType };
    } catch {
      return null;
    }
  };
}

/** @invariant ReferenceResolvesToItsBlock: la página trae ya resuelto a quién nombra. */
export function blockResolver(page: PageView): RenderOptions['resolveBlock'] {
  if (page.blockRefs.length === 0) return undefined;
  const byId = new Map(page.blockRefs.map((ref) => [ref.id, ref]));
  return (stableId) => {
    const found = byId.get(stableId);
    return found === undefined ? null : { page: found.page, excerpt: found.excerpt };
  };
}

function wireCataloguedMedia(container: HTMLElement, page: PageView): void {
  for (const asset of page.assets) {
    for (const element of container.querySelectorAll<HTMLElement>(
      `[src="${CSS.escape(asset.url)}"], [href="${CSS.escape(asset.url)}"]`,
    )) {
      if (element.classList.contains('media-catalogued')) continue;
      element.classList.add('media-catalogued');
      element.title = 'Previsualizar y editar metadatos';
      element.addEventListener('click', (event) => {
        event.preventDefault();
        openMediaDetails(asset);
      });
    }
  }
}

export function renderOutliner(
  container: HTMLElement,
  page: PageView,
  callbacks: OutlinerCallbacks,
  focus: { block: string; at: number | null } | null = null,
  focusRoot: string | null = null,
  readOnly = false,
): void {
  document.querySelector('.librarian-active-overlay')?.remove();
  container.innerHTML = '';
  container.dataset['page'] = page.id;
  container.classList.toggle('read-only', readOnly);
  if (container.dataset['readOnlyGuard'] !== 'true') {
    container.dataset['readOnlyGuard'] = 'true';
    container.addEventListener('click', (event) => {
      if (!container.classList.contains('read-only')) return;
      const target = event.target as HTMLElement;
      if (target.closest('.page-title, .properties, .bullet, .drawn-edit, .gloss-text') === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });
  }
  dropPickedKeys?.();
  dropPickedKeys = null;
  // Una seleccion nombra bloques de una pagina; en otra no quiere decir nada.
  if (pickedPage !== page.id) {
    picked.clear();
    pickedOn = null;
    pickedPage = page.id;
  }
  /** Dónde quedó dibujado cada bloque, para poder devolverle el cursor. */
  const editors = new Map<string, { node: Node; body: HTMLElement }>();
  let draggedBlock: string | null = null;
  let draggedMoved = false;
  const clearDropMarks = (): void => {
    for (const marked of container.querySelectorAll('.drop-before, .drop-after, .drop-inside')) {
      marked.classList.remove('drop-before', 'drop-after', 'drop-inside');
    }
  };
  const folded = new Set(page.folded);
  const special = isSpecialPage(page.properties);
  // @invariant SpokenContentNamesItsRecording: un bloque hablado lo dice.
  const spoken = new Map((page.spokenOrigins ?? []).map((o) => [o.block, o.recording]));
  // Lo hablado que tiene lugar en esta página, por el bloque que se lo guarda.
  const held = new Map(
    (page.recordings ?? [])
      .filter((r): r is Recording & { placedInBlock: string } => r.placedInBlock !== null)
      .map((r) => [r.placedInBlock, r]),
  );
  // @invariant GeneratedContentIsAlwaysDistinguishable.
  //
  // Sólo se marca lo generado, no todo. El corpus es casi entero de Herbert, y
  // atribuir cada bloque a su autor lo convertiría en un muro de firmas donde
  // lo excepcional dejaría de verse. Lo que hay que poder distinguir de un
  // vistazo es lo que no escribió él.
  const hands = page.authorship ?? {};
  const audioHandlers: AudioBlockHandlers = {
    onSettled: () => callbacks.onReload(null),
    notify: toast,
    // Una grabación vive fuera de la réplica estructural. Si cambia su audio,
    // se incorpora la respuesta canónica a la vista abierta antes de repintar;
    // de otro modo `onReload` reconstruiría los bloques pero conservaría la
    // grabación vieja y la interfaz negaría un cambio que sí quedó guardado.
    onChanged: (recording) => {
      const recordings = page.recordings ?? [];
      const at = recordings.findIndex((held) => held.id === recording.id);
      const next = [...recordings];
      if (at === -1) next.push(recording);
      else next[at] = recording;
      page.recordings = next;
      callbacks.onReload(null);
    },
    onTranscribed: (recording, block, content) => {
      const recordings = page.recordings ?? [];
      const at = recordings.findIndex((held) => held.id === recording.id);
      const next = [...recordings];
      if (at === -1) next.push(recording);
      else next[at] = recording;
      page.recordings = next;

      const written = page.blocks.find((held) => held.stableId === block);
      if (written !== undefined) written.content = content;
      /*
       * La transcripción no pasó por la bandeja local de operaciones: la hizo
       * el servidor después de correr whisper. Un redibujado corriente vuelve
       * a sacar los bloques de la réplica y pisa este contenido con la versión
       * anterior; la grabación queda en «retranscribir», pero sus palabras
       * desaparecen de la pantalla. Volver una vez al corpus incorpora tanto
       * el bloque escrito como la operación que la réplica todavía no conoce.
       */
      callbacks.onReload(null, reloadAfterServerWriting());
    },
  };
  const options: RenderOptions = { embedHosts };
  const asset = assetResolver(page);
  if (asset !== undefined) options.resolveAsset = asset;
  const block = blockResolver(page);
  if (block !== undefined) options.resolveBlock = block;
  const pending = new Set(page.pendingLinks ?? []);
  if (pending.size > 0) options.pageExists = (title) => !pending.has(title);

  /**
   * Los extractos siguen siendo palabras del corpus, no texto de interfaz.
   *
   * Se renderizan con la misma gramática segura que un bloque y sus enlaces
   * internos conservan el viaje. Antes estas vistas usaban `textContent`: una
   * referencia como `[[Vera]]` aparecía con corchetes precisamente en el lugar
   * destinado a anticipar cómo se leería la página.
   */
  const renderPreview = (
    host: HTMLElement,
    source: string,
    gesture: 'followed_reference' | 'followed_backlink' = 'followed_reference',
  ): void => {
    host.innerHTML = renderMarkdown(source, options);
    decorateCodeBlocks(host);
    host.addEventListener('click', (event) => {
      const show = (event.target as HTMLElement).closest<HTMLButtonElement>('.linked-resource-show');
      if (show !== null) {
        event.preventDefault();
        event.stopPropagation();
        const url = show.dataset['resourceUrl'] ?? '';
        const kind = show.dataset['resourceKind'] ?? '';
        if (!/^https:\/\//i.test(url)) return;
        let media: HTMLElement;
        if (kind === 'pdf') {
          const frame = document.createElement('iframe');
          frame.src = url;
          frame.loading = 'lazy';
          frame.referrerPolicy = 'no-referrer';
          frame.title = 'PDF enlazado';
          media = frame;
        } else if (kind === 'image') {
          const image = document.createElement('img');
          image.src = url;
          image.alt = '';
          image.referrerPolicy = 'no-referrer';
          media = image;
        } else {
          const playable = document.createElement(kind === 'audio' ? 'audio' : 'video');
          playable.setAttribute('src', url);
          playable.setAttribute('controls', '');
          playable.setAttribute('preload', 'metadata');
          media = playable;
        }
        show.closest('.linked-resource')?.prepend(media);
        show.remove();
        return;
      }
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a');
      if (link === null) return;
      if (link.classList.contains('wiki')) {
        event.preventDefault();
        event.stopPropagation();
        callbacks.onOpen(link.dataset['page'] ?? '', gesture);
        return;
      }
      if (!link.classList.contains('block-ref')) return;
      event.preventDefault();
      event.stopPropagation();
      const id = link.dataset['block'] ?? '';
      const ref = page.blockRefs.find((candidate) => candidate.id === id);
      if (ref === undefined) toast('esa referencia no nombra ningún bloque de este grafo');
      else if (callbacks.onOpenBlock === undefined) callbacks.onOpen(ref.page, gesture);
      else callbacks.onOpenBlock(ref.page, ref.id);
    });
  };

  /**
   * Cierra el viaje de cada nota al pie sobre la página ya compuesta.
   *
   * El renderizador de un fragmento no sabe si otro bloque citó la misma nota.
   * Aquí sí están todas las apariciones: reciben anclas únicas, y cada salto de
   * ida prepara la flecha para volver exactamente a la aparición pulsada.
   */
  const wireFootnotes = (root: ParentNode): void => {
    const backs = new Map<string, HTMLAnchorElement[]>();
    for (const back of root.querySelectorAll<HTMLAnchorElement>('.footnote-back[data-footnote-back]')) {
      const id = back.dataset['footnoteBack'] ?? '';
      const held = backs.get(id) ?? [];
      held.push(back);
      backs.set(id, held);
    }

    const occurrences = new Map<string, number>();
    for (const reference of root.querySelectorAll<HTMLAnchorElement>('.fnref-link[data-footnote]')) {
      const id = reference.dataset['footnote'] ?? '';
      const occurrence = (occurrences.get(id) ?? 0) + 1;
      occurrences.set(id, occurrence);
      const anchor = `fnref-${encodeURIComponent(id)}-${occurrence}`;
      reference.id = anchor;

      const returns = backs.get(id) ?? [];
      if (occurrence === 1) {
        for (const back of returns) back.href = `#${anchor}`;
      }
      reference.addEventListener('click', () => {
        for (const back of returns) back.href = `#${anchor}`;
      });
    }
  };

  /**
   * Cierra los enlaces a anclas sobre la página ya compuesta.
   *
   * Como las notas al pie, y por la misma razón: el renderizador de un fragmento
   * no sabe qué encabezados tiene la página, y hacen falta todos —en orden— para
   * numerar los que se repiten. Aquí están.
   *
   * Un ancla que ningún encabezado produce no se deja como enlace. @invariant
   * AnchorsReachTheirHeading: un enlace que no lleva a ninguna parte es un
   * enlace que miente, y en un documento importado de fuera es lo más probable
   * que haya —índices que nombran secciones que no vinieron—.
   */
  const wireAnchors = (root: ParentNode): void => {
    const headings = [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
    const named = new Map<string, HTMLElement>();
    const anchors = uniqueAnchors(headings.map((heading) => heading.textContent ?? ''));
    for (const [index, anchor] of anchors.entries()) {
      const heading = headings[index];
      if (heading === undefined || anchor === '') continue;
      // El nombre queda también en el DOM: es lo que permite que un `id` sirva
      // para lo de siempre —copiar, inspeccionar, imprimir— sin depender de esto.
      heading.id = anchor;
      named.set(anchor, heading);
    }

    for (const link of root.querySelectorAll<HTMLAnchorElement>('a.anchor[data-anchor]')) {
      const raw = link.dataset['anchor'] ?? '';
      let wanted = raw;
      try {
        // Un índice escrito fuera puede traer el ancla con los acentos cifrados.
        wanted = decodeURIComponent(raw);
      } catch {
        wanted = raw;
      }
      const heading = named.get(wanted) ?? named.get(raw) ?? null;
      if (heading === null) {
        // Se queda a la vista y deja de ser enlace: dice que ese sitio no está
        // en esta página, que es más de lo que decía llevando a ninguna parte.
        link.dataset['dangling'] = 'true';
        link.title = `«${wanted}» no nombra ningún encabezado de esta página`;
        continue;
      }
      link.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        /*
         * Arriba y no en el centro, que es como llega una referencia a un
         * bloque. Un encabezado no es el sitio al que se va: es el sitio por
         * donde empieza lo que se va a leer, y eso está debajo de él.
         */
        /*
         * De golpe y no deslizándose. Un índice salta, y la distancia entre la
         * primera entrada y la última sección de un documento largo son decenas
         * de miles de píxeles: deslizarse por ellos es un viaje de varios
         * segundos por un texto que nadie está leyendo. Medido aquí, además,
         * Chrome directamente no lo hace —un `behavior: smooth` de 23.000
         * píxeles se queda donde estaba— así que el índice no llevaba a ninguna
         * parte por una razón distinta de la que se acababa de arreglar.
         */
        heading.scrollIntoView({ block: 'start' });
        // Y el mismo destello con que se señala un bloque al llegar a él: sin
        // esto se llega y no se sabe a qué de lo que hay en pantalla se llegó.
        const row = heading.closest('.block');
        if (row === null) return;
        row.classList.add('landed');
        window.setTimeout(() => row.classList.remove('landed'), 2000);
      });
    }
  };

  const glosses = page.glosses ?? {};

  /** Contenido que, a diferencia de la prosa, usa el ancho entero del bloque. */
  const hasWideContent = (body: HTMLElement): boolean =>
    body.matches('.drawn-body') ||
    body.querySelector(
      ':is(.table-scroll, table, img, .drawn, .mermaid-figure, code.language-mermaid, pre, .audio-block, iframe, video)',
    ) !== null;

  /**
   * La glosa comparte bloque, pero no su contenido ni su editor.
   *
   * Si todavía no existe, no deja una puerta vacía en cada renglón: se empieza
   * desde el menú del bloque. Si existe, se lee como texto y se edita pulsando
   * ese mismo texto. En poco ancho la marca sólo revela lo que ya existe.
   */
  const renderGloss = (row: HTMLElement, body: HTMLElement, block: string): (() => void) => {
    const held = glosses[block]?.content ?? '';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = held === '' ? 'gloss-toggle empty' : 'gloss-toggle';
    toggle.innerHTML = icon('align-left');
    toggle.title = held === '' ? 'añadir glosa' : 'leer o editar glosa';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-expanded', 'false');

    const panel = document.createElement('aside');
    panel.className = held === '' ? 'block-gloss empty' : 'block-gloss';
    panel.setAttribute('aria-label', 'glosa del bloque');

    const text = document.createElement('div');
    // También es un cuerpo Markdown: comparte la gramática visual del bloque,
    // aunque su color, lugar y gesto de edición sigan siendo los de la glosa.
    text.className = 'gloss-text body';
    text.tabIndex = 0;
    text.title = 'editar glosa';
    text.setAttribute('role', 'button');
    text.setAttribute('aria-label', 'editar glosa del bloque');

    const editor = document.createElement('textarea');
    editor.className = 'gloss-editor';
    editor.value = held;
    editor.placeholder = 'Glosar este pasaje…';
    editor.rows = Math.max(1, held.split('\n').length);
    editor.setAttribute('aria-label', 'glosa del bloque');
    panel.append(text, editor);

    const paint = (content: string): void => {
      text.innerHTML = renderMarkdown(content, options);
      decorateCodeBlocks(text);
      markMissingImages(text);
      void renderMermaid(text);
    };
    paint(held);

    /**
     * Dónde cae realmente la línea base de una caja de texto.
     *
     * No se deduce del tamaño de letra: IBM Plex reserva ascenso y descenso, y
     * al reducir la glosa al 85% cambia también el reparto del leading. El
     * marcador de altura cero pregunta al propio motor tipográfico dónde puso
     * la baseline con esas métricas exactas. Así funciona igual en Safari y no
     * deja un número afinado para un solo tamaño de lectura.
     */
    const baseline = (style: CSSStyleDeclaration): number => {
      const probe = document.createElement('span');
      probe.setAttribute('aria-hidden', 'true');
      Object.assign(probe.style, {
        position: 'fixed',
        left: '-10000px',
        top: '0',
        visibility: 'hidden',
        whiteSpace: 'nowrap',
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontStyle: style.fontStyle,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
      });
      probe.textContent = 'Hg';
      const mark = document.createElement('i');
      Object.assign(mark.style, {
        display: 'inline-block',
        width: '0',
        height: '0',
        padding: '0',
        margin: '0',
        verticalAlign: 'baseline',
      });
      probe.append(mark);
      document.body.append(probe);
      const offset = mark.getBoundingClientRect().top - probe.getBoundingClientRect().top;
      probe.remove();
      return offset;
    };

    /** La primera línea de ambas voces comparte una baseline, no sólo un top. */
    const alignBaseline = (): void => {
      const source = body.querySelector<HTMLElement>('.body-text > :first-child')
        ?? body.querySelector<HTMLElement>('.body-text')
        ?? body;
      const gloss = text.firstElementChild instanceof HTMLElement ? text.firstElementChild : text;
      const sourceTop = source.getBoundingClientRect().top - row.getBoundingClientRect().top;
      const shift = sourceTop + baseline(getComputedStyle(source)) - baseline(getComputedStyle(gloss));
      panel.style.setProperty('--gloss-top', `${shift}px`);
    };
    alignBaseline();
    void document.fonts.ready.then(alignBaseline);

    // El ancho pertenece a la columna; el alto pertenece a lo escrito. Medir
    // scrollHeight incluye también las líneas blandas producidas al envolver,
    // que contar saltos de línea no ve.
    const sizeEditor = (): void => {
      editor.style.height = 'auto';
      editor.style.height = `${editor.scrollHeight}px`;
    };

    const edit = (): void => {
      panel.classList.add('open', 'editing');
      toggle.setAttribute('aria-expanded', 'true');
      editor.value = glosses[block]?.content ?? '';
      sizeEditor();
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    };

    let saving = false;
    const save = async (): Promise<void> => {
      const next = editor.value;
      if (saving) return;
      if (next === (glosses[block]?.content ?? '')) {
        panel.classList.remove('editing');
        if (next === '') {
          panel.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
        }
        return;
      }
      saving = true;
      editor.disabled = true;
      const applied = await submitQuietly({ kind: 'set_block_gloss', block, content: next });
      editor.disabled = false;
      saving = false;
      if (!applied) return;
      glosses[block] = {
        content: next,
        createdAt: glosses[block]?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      paint(next);
      panel.classList.toggle('empty', next === '');
      toggle.classList.toggle('empty', next === '');
      panel.classList.remove('editing');
      if (next === '') {
        panel.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    };

    editor.addEventListener('input', () => {
      sizeEditor();
    });
    editor.addEventListener('blur', () => void save());
    editor.addEventListener('keydown', (event) => {
      if (isTextComposing(event)) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void save();
      }
      if (event.key === 'Escape') {
        editor.value = glosses[block]?.content ?? '';
        panel.classList.remove('editing');
        if ((glosses[block]?.content ?? '') === '') {
          panel.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
        } else {
          text.focus();
        }
      }
    });

    text.addEventListener('click', (event) => {
      event.stopPropagation();
      const target = event.target as HTMLElement;
      const link = target.closest('a');
      if (link !== null) {
        if (link.classList.contains('wiki')) {
          event.preventDefault();
          callbacks.onNavigate?.(link.dataset['page'] ?? '');
        } else if (link.classList.contains('block-ref')) {
          event.preventDefault();
          const id = link.dataset['block'] ?? '';
          const ref = page.blockRefs.find((candidate) => candidate.id === id);
          if (ref === undefined) toast('esa referencia no nombra ningún bloque de este grafo');
          else if (callbacks.onOpenBlock === undefined) callbacks.onOpen(ref.page, 'followed_reference');
          else callbacks.onOpenBlock(ref.page, ref.id);
        }
        return;
      }
      edit();
    });
    text.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      edit();
    });

    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = !panel.classList.contains('open');
      panel.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open) text.focus();
    });

    row.append(toggle, panel);
    return edit;
  };

  const header = document.createElement('header');
  header.className = 'page-header';

  const day = isDay(page.title);
  const concept = page.concept !== undefined && page.concept !== null;

  /*
   * El título es contenido y se edita como contenido — salvo el de un día.
   *
   * @invariant ADayIsNamedByItsDate: el título de un día no es una etiqueta
   * puesta sobre él, es su identidad. Renombrarlo movería un testimonio a una
   * fecha en la que no ocurrió, y lo escrito el martes pasaría a decir que pasó
   * el jueves. Aquí se podía: el campo se abría igual que en cualquier otra
   * página, y el dominio habría aceptado el `rename_page` sin saber que estaba
   * mintiendo sobre cuándo pasaron las cosas.
   */
  const title = document.createElement('h1');
  title.className = `page-title${day ? ' day' : ''}${concept ? ' concept' : ''}`;
  title.textContent = page.title;
  if (concept) {
    title.title = 'concepto del corpus';
  } else if (!day && !readOnly) {
    title.tabIndex = 0;
    title.title = 'renombrar la página';
    title.addEventListener('click', () => {
      editInPlace(title, page.title, 'el título de la página', async (next) => {
        if (next.trim() === '' || next === page.title) return true;
        return submitAndReload(
          { kind: 'rename_page', page: page.id, title: next.trim() },
          callbacks,
        );
      });
    });
  }
  const heading = document.createElement('div');
  heading.className = 'page-heading';
  heading.append(title);

  /*
   * Las propiedades acompañan al título, pero no tienen que competir con él.
   *
   * Una página suele abrirse para leer lo que dice, no para inspeccionar su
   * ficha. La ficha sigue a un gesto de distancia y el control vive junto al
   * título, que es donde se entiende qué está describiendo. Antes todo el front
   * matter quedaba desplegado siempre en la aplicación privada y escondido tras
   * el menú de tres puntos en la pública: dos interfaces para la misma cosa.
   */
  const propertiesToggle = document.createElement('button');
  propertiesToggle.type = 'button';
  propertiesToggle.className = 'properties-toggle';
  propertiesToggle.innerHTML = icon('layout-navbar-expand');
  propertiesToggle.setAttribute('aria-label', 'Mostrar propiedades');
  propertiesToggle.setAttribute('aria-expanded', 'false');
  propertiesToggle.title = 'Mostrar propiedades';
  heading.append(propertiesToggle);
  {
    // @guarantee DeclaredPresentationsOfferPresentationProminently
    const declaredPresentation = isPresentation(page.properties, corpusNames().kind);
    heading.classList.toggle('has-presentation', declaredPresentation);
    const present = document.createElement('button');
    present.type = 'button';
    present.className = 'present-page';
    present.textContent = declaredPresentation ? 'Presentar' : 'Ver como presentación';
    present.hidden = !declaredPresentation;
    present.addEventListener('click', () => {
      void presentPage(page, options, callbacks.onNavigate, present.dataset['initialBlock'] ?? null, {
        scheme: callbacks.scheme,
        onScheme: callbacks.onScheme,
      });
      delete present.dataset['initialBlock'];
    });
    heading.append(present);
  }
  header.append(heading);

  // El front matter no es decoración: son propiedades del grafo, y se editan.
  const properties = document.createElement('dl');
  properties.className = 'properties';

  const metadata = document.createElement('div');
  metadata.className = 'page-metadata';
  metadata.hidden = true;

  const showProperties = (open: boolean): void => {
    metadata.hidden = !open;
    propertiesToggle.setAttribute('aria-expanded', String(open));
    propertiesToggle.setAttribute('aria-label', open ? 'Ocultar propiedades' : 'Mostrar propiedades');
    propertiesToggle.title = open ? 'Ocultar propiedades' : 'Mostrar propiedades';
    propertiesToggle.classList.toggle('open', open);
  };
  const chooseProperties = (open: boolean): void => {
    session.setFrontMatterOpen(open);
    showProperties(open);
  };
  showProperties(session.frontMatterOpen());
  propertiesToggle.addEventListener('click', () => chooseProperties(metadata.hidden));

  /*
   * Público o privado, entre las demás propiedades y no en un botón aparte.
   *
   * Era una marca al pie que decía «privada» mientras el front matter, dos
   * centímetros más arriba, decía `public:: false`. Dos sitios diciendo lo mismo
   * con palabras distintas, y ninguna forma de saber cuál mandaba — la respuesta
   * era ésta, y no se veía.
   *
   * Ahora es una fila más, y la única que además gobierna: lo que se lee aquí es
   * el estado de verdad, el que decide si la página se proyecta al sitio
   * personal. La propiedad de texto que traía el corpus importado no se dibuja
   * al lado, porque duplicarla es el problema que esto resuelve.
   *
   * Se ve distinta de las demás a propósito. Una propiedad de texto se edita
   * escribiendo; ésta se contesta con un interruptor porque su dominio no está
   * por decidir: es sí o no, y siempre lo fue. Ver el contrato PageFrontMatter
   * en workspace-interface.allium.
   */
  const publica = page.visibility === 'public';
  const publicada = page.publication?.publishedAt !== null && page.publication !== null && page.publication !== undefined;

  const visibilityKey = document.createElement('dt');
  visibilityKey.className = 'property-key';
  /*
   * Los tres renglones que no salen de una propiedad escrita.
   *
   * Se llaman como el corpus los llame —lo declara la ontología, igual que las
   * demás— porque lo que la cabecera enseña como propiedad tiene que poder
   * preguntarse como propiedad: `? público=sí`, `? creación=2026-08-07`. Lo que
   * no hacen es guardarse: la visibilidad tiene su operación y su columna, y las
   * dos fechas las sabe el registro. Dos sitios diciendo lo mismo acaban
   * diciendo cosas distintas.
   */
  const derived = corpusNames();
  visibilityKey.textContent = derived.visible;

  const visibilityValue = document.createElement('dd');
  visibilityValue.className = 'property-value governed';

  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = `visibility ${page.visibility}`;
  badge.textContent = publica ? 'pública' : 'privada';
  badge.setAttribute('role', 'switch');
  badge.setAttribute('aria-checked', String(publica));
  badge.title = publica
    ? publicada
      ? 'Pública y publicada: despublícala antes de hacerla privada.'
      : 'Pública: puede publicarse, pero todavía no está en el sitio.'
    : 'Privada: no puede publicarse.';
  badge.addEventListener('click', () => {
    if (publica && publicada) {
      toast('despublica la página antes de hacerla privada');
      return;
    }
    void submitAndReload(
      {
        kind: 'set_page_visibility',
        page: page.id,
        visibility: publica ? 'private' : 'public',
      },
      callbacks,
    );
  });
  visibilityValue.append(badge);
  // En un día tampoco va el interruptor: publicar una jornada entera no es un
  // gesto que se ofrezca de paso, y repetido sobre cada fecha de la lectura
  // continua sería la fila más ruidosa de todas.
  if (!day) properties.append(visibilityKey, visibilityValue);

  if (!day && publica && page.publication !== null && page.publication !== undefined) {
    const publicationKey = document.createElement('dt');
    publicationKey.className = 'property-key';
    publicationKey.textContent = 'sitio';

    const publicationValue = document.createElement('dd');
    publicationValue.className = 'property-value governed publication-state';
    const address = document.createElement('code');
    address.className = 'publication-address';
    address.textContent = page.publication.entryPoint
      ? `portada · /${page.publication.path}/`
      : `/${page.publication.path}/`;
    address.title = page.publication.url;

    const action = document.createElement('button');
    action.type = 'button';
    action.className = publicada ? 'publication-action published' : 'publication-action';
    action.textContent = publicada ? 'Despublicar' : 'Publicar';
    action.addEventListener('click', () => {
      if (publicada) {
        if (!window.confirm(`Retirar ${page.publication!.url} del sitio público?`)) return;
        action.disabled = true;
        void api
          .unpublish(page.id)
          .then((publication) => {
            page.publication = publication;
            toast('despublicada');
            callbacks.onReload(null);
          })
          .catch((error) => toast(error instanceof Error ? error.message : 'no se pudo despublicar'))
          .finally(() => { action.disabled = false; });
        return;
      }

      const chosen = window.prompt('Dirección estable dentro del sitio', page.publication!.path);
      if (chosen === null) return;
      action.disabled = true;
      void api
        .publish(page.id, chosen.trim())
        .then((publication) => {
          page.publication = publication;
          toast('publicada');
          callbacks.onReload(null);
        })
        .catch((error) => toast(error instanceof Error ? error.message : 'no se pudo publicar'))
        .finally(() => { action.disabled = false; });
    });
    publicationValue.append(address, action);

    if (publicada && !page.publication.entryPoint) {
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.className = 'publication-entry';
      entry.textContent = 'Hacer portada';
      entry.addEventListener('click', () => {
        entry.disabled = true;
        void api
          .publish(page.id, page.publication!.path, true)
          .then((publication) => {
            page.publication = publication;
            toast('ahora es la portada');
            callbacks.onReload(null);
          })
          .catch((error) => toast(error instanceof Error ? error.message : 'no se pudo elegir la portada'))
          .finally(() => { entry.disabled = false; });
      });
      publicationValue.append(entry);
    }
    properties.append(publicationKey, publicationValue);
  }

  /*
   * Fechas de solo lectura.
   *
   * No son propiedades que alguien mantenga a mano. La creación proviene del
   * corpus original cuando hay evidencia y, si no, muestra el techo cierto de
   * entrada a Vera. La actualización sale de la última revisión real: escribir,
   * mover o cambiar propiedades la mueve sola; recuperar procedencia no.
   */
  const journalDay = (at: number): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(at));
    const value = (part: string): string => parts.find((p) => p.type === part)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  };
  const temporal = (label: string, at: number | null, title: string): void => {
    if (at === null) return;
    const key = document.createElement('dt');
    key.className = 'property-key';
    key.textContent = label;
    const value = document.createElement('dd');
    value.className = 'property-value governed';
    const dayLink = document.createElement('button');
    dayLink.type = 'button';
    dayLink.className = 'property-word';
    dayLink.textContent = journalDay(at);
    dayLink.title = `${title} Ir a la bitácora de ese día.`;
    dayLink.addEventListener('click', () => callbacks.onNavigate(dayLink.textContent ?? ''));
    value.append(dayLink);
    properties.append(key, value);
  };
  temporal(
    derived.created,
    page.originCreatedAt ?? page.createdAt,
    page.originCreatedAt === null
      ? 'No se recuperó una fecha anterior: ésta es la fecha cierta de entrada a Vera.'
      : 'Recuperada del corpus de origen.',
  );
  temporal(
    derived.updated,
    page.lastEditedAt,
    'Derivada automáticamente de la última revisión de la página.',
  );

  // La `public::` heredada de Logseq no se dibuja: la fila de arriba dice lo
  // mismo y además manda. Sigue en el corpus hasta que se adopte, y adoptarla
  // es un acto aparte y deliberado — ver rule AdoptImportedVisibilityProperty.
  const written = page.properties.filter((property) => property.key !== 'public');

  const outward = (raw: string): string | null => {
    const text = raw.trim();
    const candidate = /^https?:\/\//i.test(text)
      ? text
      : /^(?:www\.)?[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(text)
        ? `https://${text}`
        : null;
    if (candidate === null) return null;
    try {
      const url = new URL(candidate);
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };

  for (const property of written) {
    const key = document.createElement('dt');
    key.className = 'property-key';
    // La clave, tal como está escrita en la página. Sin máscara: enseñar «tipo»
    // sobre una clave que se llama `type` obliga a saberse las dos para poder
    // preguntar por ella, y la que vale es la que el corpus dice.
    key.textContent = property.key;

    /*
     * La que dice qué gobierna esta página se ve y no se toca.
     *
     * Ni la clave ni el valor son del corpus: `special-kind` es la única palabra
     * que Vera no puede dejar que se declare —es con la que encuentra la página
     * donde el corpus declara las demás— y sus valores son la junta con el
     * código, como los papeles. Ofrecer un desplegable para elegir otro sería
     * ofrecer una decisión que no existe, y quitarla dejaría a la página
     * gobernando sin decirlo.
     *
     * Se dibuja igual, y ésa es la mitad que importa: esconderla haría que la
     * página gobernase en secreto, que es peor que enseñar algo intocable. Se
     * enseña lo que decide, con su valor literal al lado, atenuada y sin ninguno
     * de los gestos que en las demás filas prometen que se puede cambiar.
     */
    if (property.key === SPECIAL_KIND) {
      const said = kindSays(property.value);
      key.classList.add('property-fixed');
      key.title = 'La palabra con que Vera reconoce una página de gobierno. La pone el programa.';

      const value = document.createElement('dd');
      value.className = 'property-value property-fixed';
      value.title = key.title;

      const what = document.createElement('span');
      what.textContent = said?.what ?? `gobierna «${property.value}»`;
      const literal = document.createElement('code');
      literal.className = 'property-literal';
      literal.textContent = property.value;
      value.append(what, literal);

      properties.append(key, value);
      continue;
    }

    key.tabIndex = 0;
    key.title = 'renombrar la propiedad';
    key.addEventListener('click', () => {
      editInPlace(key, property.key, 'nombre de la propiedad', async (next) => {
        const name = next.trim();
        if (name === '' || name === property.key) return true;
        // Renombrar es quitar la vieja y poner la nueva: el dominio identifica
        // una propiedad por su clave, así que no hay un cambio que la renombre.
        const removed = await submitQuietly({
          kind: 'remove_property',
          page: page.id,
          propertyKey: property.key,
        });
        if (!removed) return false;
        return submitAndReload(
          { kind: 'set_property', page: page.id, propertyKey: name, propertyValue: property.value },
          callbacks,
        );
      });
    });

    const value = document.createElement('dd');
    value.className = 'property-value';

    const answer = async (next: string): Promise<boolean> => {
      if (next === property.value) return true;
      return submitAndReload(
        { kind: 'set_property', page: page.id, propertyKey: property.key, propertyValue: next },
        callbacks,
      );
    };

    const offered = page.domains?.[property.key] ?? [];
    const external = outward(property.value);

    if (external !== null) {
      const link = document.createElement('a');
      link.className = 'property-word property-external';
      link.href = external;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = property.value;
      link.title = 'abrir fuera de Vera · doble clic para editar';
      link.addEventListener('dblclick', (event) => {
        event.preventDefault();
        editInPlace(value, property.value, `valor de ${property.key}`, answer);
      });
      value.append(link);
    } else {

    /*
     * Dos preguntas distintas que estaban siendo una sola.
     *
     * La primera es si esto es una pregunta cerrada: si el corpus contesta esta
     * clave con unas pocas palabras, se contesta eligiendo de un menú. La
     * segunda es si el valor lleva varias respuestas dentro: si las lleva, cada
     * una es una palabra y cada palabra lleva a su página.
     *
     * Estaban anidadas —sólo se partía por comas dentro de la rama de
     * vocabulario— y por eso `concepto` se dibujaba como una cadena. Medido
     * sobre el corpus: mil cincuenta y una palabras distintas, y las doce más
     * usadas cubren el 19 % del uso. `concepto` es vocabulario abierto, como las
     * etiquetas: no es una pregunta cerrada y nunca lo será, y aun así sus
     * valores son varios y cada uno nombra algo que existe.
     *
     * Que una no sea la otra es lo que hace que `AAC`, `PictoNet` y `doctorado`
     * puedan seguirse por separado sin que nadie tenga que declarar un
     * vocabulario primero.
     */
    const answers = answersIn(property.value);
    const several = answers.length > 1;
    const openVocabulary = property.key === corpusNames().topic;

    if (isChoosable(offered) || several || openVocabulary) {
      /*
       * Un valor de vocabulario se contesta eligiendo y se sigue pulsando, y son
       * dos cosas distintas con dos sitios distintos.
       *
       * La palabra lleva a su página —qué es una bitácora, y todas las que hay—,
       * y el chevrón de al lado abre lo que se puede contestar. Compartir
       * destino los enfrentaría: quien sólo quiere saber qué significa
       * «bitácora» tendría que asignarla para averiguarlo. Ver @invariant
       * BothHalvesOfAPropertyAreFollowable.
       */
      /*
       * Un valor por palabra, no una cadena con comas dentro.
       *
       * Una propiedad de vocabulario puede llevar varios valores —una página es
       * varias cosas a la vez— y se guardan separados por comas, que es como el
       * corpus ya lo escribe. Dibujarlos como un solo botón los volvía una sola
       * palabra: se resaltaban juntos al pasar por encima, y pulsarlos llevaba a
       * una página llamada «entrada diaria, página especial», que no existe ni va
       * a existir.
       *
       * Aquí la coma es separador y no texto, porque los valores salen de un
       * vocabulario: ninguno lleva una coma dentro. Donde no hay vocabulario el
       * valor se deja entero, que ahí una coma sí puede ser parte de la frase.
       */
      const words = document.createElement('span');
      words.className = 'property-words';
      for (const one of answers) {
        const follow = document.createElement('button');
        follow.type = 'button';
        follow.className = 'property-word';
        follow.textContent = one;
        follow.title = `ir a ${one}`;
        follow.addEventListener('click', (event) => {
          event.stopPropagation();
          callbacks.onNavigate(one);
        });
        words.append(follow);
      }
      // Con vocabulario y sin valor queda el chevrón, pero el hueco donde irá la
      // palabra tiene que decir que está vacío: si no, la fila parece rota.
      if (words.children.length === 0) {
        const empty = document.createElement('button');
        empty.type = 'button';
        empty.className = 'property-word property-empty';
        empty.textContent = 'sin valor';
        empty.title = `escribir el valor de ${property.key}`;
        empty.addEventListener('click', (event) => {
          event.stopPropagation();
          editInPlace(value, '', `valor de ${property.key}`, answer);
        });
        words.append(empty);
      }
      const follow = words;

      /*
       * El chevrón sólo donde hay de dónde elegir.
       *
       * Un vocabulario abierto —`concepto`, con mil palabras— no cabe en un menú
       * de doce, y ofrecer las doce más usadas seria decir que la respuesta esta
       * entre ellas cuando cubren el diecinueve por ciento del uso. Ahí se
       * escribe, y para eso ya están las palabras: se pulsan y se editan.
       */
      value.append(follow);

      if (isChoosable(offered)) {
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.className = 'property-choose';
        choose.innerHTML = icon('chevron-down');
        choose.setAttribute('aria-label', `elegir ${property.key}`);
        choose.title = `elegir ${property.key}`;
        choose.addEventListener('click', (event) => {
          event.stopPropagation();
          // Dos grupos, porque son dos cosas: arriba el vocabulario que este
          // corpus ya usa, y debajo, separado, lo único que es un gesto de la
          // interfaz. Sin la raya, «escribir otro…» se lee como un valor más.
          openBlockMenu(choose, [
            // Los más dichos, y sólo esos. La cola larga de una propiedad son sus
            // erratas; ofrecerlas al mismo nivel que los términos las volvería a
            // sembrar, que es cómo se llegó a tener treinta y ocho tipos.
            offered.slice(0, OFFERED_AT_MOST).map((option) => ({
              label: option.value === property.value ? `${option.value} ·` : option.value,
              run: () => void answer(option.value),
            })),
            // Un vocabulario que no crece donde se usa deja de crecer, y con él
            // deja de etiquetarse. Ver @guarantee AVocabularyGrowsAtThePointOfUse.
            [
              {
                label: 'escribir otro…',
                run: () => editInPlace(value, property.value, `valor de ${property.key}`, answer),
              },
            ],
          ]);
        });
        value.append(choose);
      } else {
        /*
         * Sin de dónde elegir, no hay chevrón.
         *
         * Un vocabulario abierto —`concepto`, con mil palabras— no cabe en un
         * menú de doce, y ofrecer las doce más usadas diría que la respuesta
         * está entre ellas cuando cubren el diecinueve por ciento del uso. Aquí
         * se escribe, pulsando el hueco de la fila: las palabras no, que cada
         * una lleva a su página.
         */
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'property-edit';
        edit.innerHTML = icon('edit-2');
        edit.setAttribute('aria-label', `editar ${property.key}`);
        edit.title = `editar ${property.key}`;
        edit.addEventListener('click', (event) => {
          event.stopPropagation();
          const completion = {
            initial: property.value,
            choices: offered.map((option) => ({
              value: option.value,
              hint: option.uses === 1 ? '1 página' : `${option.uses} páginas`,
            })),
            ...(openVocabulary ? { separatedBy: ',' } : {}),
          };
          completeInPlace(value, `valor de ${property.key}`, answer, completion);
        });
        value.append(edit);
      }
    } else {
      /*
       * Un valor vacío se dibuja con una palabra, o no se puede pulsar.
       *
       * Una propiedad nace sin valor —el nombre se escribe primero y el valor
       * después— y hasta aquí eso dejaba un `dd` sin texto: sin texto no hay caja,
       * sin caja no hay dónde hacer clic, y la propiedad recién creada se quedaba
       * sin ninguna forma de recibir su valor. Y como su clave es nueva tampoco
       * tiene vocabulario observado, así que el chevrón que salva el otro caso
       * tampoco aparecía. Callejón sin salida, en el gesto más común.
       *
       * El texto suplente es del hueco y no del valor: se enseña, se puede pulsar,
       * y lo que se abre para escribir sigue empezando vacío.
       */
      const empty = property.value.trim() === '';
      value.textContent = empty ? 'sin valor' : property.value;
      if (empty) value.classList.add('property-empty');
      value.tabIndex = 0;
      value.title = empty ? 'escribir el valor' : 'editar el valor';
      value.addEventListener('click', () => {
        editInPlace(value, property.value, `valor de ${property.key}`, answer);
      });
    }
    }

    /*
     * El tipo de un día no se ofrece para quitar.
     *
     * rule ADayKeepsItsKind lo rechaza en el dominio, así que dibujar la cruz
     * sería ofrecer algo que el servidor va a negar. El valor sigue siendo
     * editable: lo que no se puede es dejar al día sin decir que es un día.
     */
    if (!(day && property.key === 'type')) {
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'property-drop';
      drop.innerHTML = icon('x');
      drop.setAttribute('aria-label', `quitar ${property.key}`);
      drop.title = `quitar ${property.key}`;
      drop.addEventListener('click', (event) => {
        event.stopPropagation();
        void submitAndReload(
          { kind: 'remove_property', page: page.id, propertyKey: property.key },
          callbacks,
        );
      });
      value.append(drop);
    }

    properties.append(key, value);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'property-add';
  add.textContent = '+ propiedad';
  /*
   * Poner una propiedad: primero las que esta clase de cosa espera.
   *
   * La ontología declara qué propiedades constituyen a un «Proyecto» o a una
   * «Persona» —ver [[Objetos]]— y aquí eso sirve para algo: lo que le falta a
   * esta página se ofrece primero y por su nombre. No se exige nada. Casi nada
   * de lo que uno escribe nace completo, y una memoria que pidiera la ficha
   * llena antes de dejar escribir obligaría a saber el final antes de empezar.
   * @guarantee TheShapeIsSaidAndNeverEnforced.
   */
  /*
   * Se abre el campo ya, y las opciones llegan cuando llegan.
   *
   * Antes se pedía la ontología primero y el menú salía al contestar el
   * servidor: entre pulsar y poder hacer algo había una petición, y quien pulsa
   * `+ propiedad` normalmente ya sabe qué va a escribir. Ahora el campo está
   * enfocado en el mismo gesto, escribir funciona desde el primer instante y la
   * lista aparece debajo cuando el servidor conteste. Si no contesta —o no hay
   * servidor— se escribe igual, que es lo que siempre se pudo hacer.
   */
  add.addEventListener('click', () => {
    /*
     * Mientras se nombra, la fila entera y sin columna de valor.
     *
     * Una propiedad que todavía no tiene nombre tampoco tiene valor, así que la
     * columna derecha no tiene nada que enseñar: el campo abarca las dos y la
     * lista que cuelga de él mide lo mismo que él. Antes ocupaba sólo la columna
     * del nombre —que mide lo que mide la palabra más larga— y la lista salía
     * más ancha que su propio campo, sobresaliendo por la derecha con un escalón
     * que la hacía parecer de otra cosa.
     *
     * Ninguna fila que ya tenga nombre cambia: esto vale sólo para la que se
     * está escribiendo, y desaparece con ella.
     */
    const key = document.createElement('dt');
    key.className = 'property-key property-naming';
    properties.append(key);

    const put = async (next: string): Promise<boolean> => {
      const said = next.trim();
      if (said === '') {
        key.remove();
        return true;
      }
      // Nace con valor vacío; el valor se escribe en el siguiente clic. El
      // dominio acepta una propiedad sin valor, así que no hace falta inventarlo.
      return submitAndReload(
        { kind: 'set_property', page: page.id, propertyKey: said, propertyValue: '' },
        callbacks,
      );
    };

    // Salir sin escribir nada retira la fila que se había preparado. Antes se
    // quedaba puesta y vacía: no se veía, pero estaba, y ocupaba una fila del
    // `dl` hasta la próxima vez que la página se rehiciera.
    const field = completeInPlace(key, 'nombre de la propiedad', put, {
      onCancel: () => key.remove(),
    });

    void api
      .ontology()
      .then((said) => {
        const names = corpusNames();
        const kind = page.properties.find((one) => one.key === names.kind)?.value.trim() ?? '';
        const object = said.objects.find((one) => one.name.toLowerCase() === kind.toLowerCase());
        const here = new Set(page.properties.map((one) => one.key.trim().toLowerCase()));

        /*
         * Primero lo que a esta clase de cosa le falta.
         *
         * La ontología declara qué propiedades constituyen a un «Proyecto» o a
         * una «Persona» —ver [[Objetos]]— y aquí eso sirve para algo. No se
         * exige nada: casi nada de lo que uno escribe nace completo, y una
         * memoria que pidiera la ficha llena antes de dejar escribir obligaría a
         * saber el final antes de empezar. @guarantee
         * TheShapeIsSaidAndNeverEnforced.
         */
        const missing: Choice[] = (object?.properties ?? [])
          .filter((one) => !here.has(one.toLowerCase()))
          .map((one) => ({ value: one, hint: `le falta a ${object?.name ?? kind}`, first: true }));
        const asked = new Set(missing.map((one) => one.value.toLowerCase()));

        /*
         * Y detrás, todo lo demás por cuánto se usa: lo declarado y lo que el
         * corpus escribe sin declarar, en la misma lista.
         *
         * Estaban separados y sólo se ofrecían las declaradas, con lo que el
         * menú era a la vez demasiado largo y ciego: de las treinta y tres
         * declaradas aquí, diecisiete no se usan en ninguna página, mientras que
         * ochenta y seis claves que el corpus sí usa no se ofrecían nunca. Se
         * buscaba una propiedad escrita hace meses y no aparecía.
         *
         * Cada una dice de dónde viene. Que `bibliografia` salga con una sola
         * página al lado de `bibliografía` con treinta es lo que permite darse
         * cuenta en el momento de elegir, que es cuando se puede hacer algo.
         */
        const said_ = (uses: number): string => (uses === 1 ? '1 página' : `${uses} páginas`);
        // El uso viaja aparte del renglón: ordena la lista y no se dibuja como
        // tal, porque en la pantalla ya está dentro de la aclaración.
        type Ranked = Choice & { uses: number };
        const declared: Ranked[] = said.properties
          .filter((one) => !here.has(one.name.toLowerCase()) && !asked.has(one.name.toLowerCase()))
          .map((one) => ({
            value: one.name,
            hint:
              one.uses === 0
                ? `${one.field ?? 'declarada'} · sin usar todavía`
                : `${one.field ?? 'declarada'} · ${said_(one.uses)}`,
            uses: one.uses,
          }));
        const undeclared: Ranked[] = said.undeclared
          .filter((one) => !here.has(one.key.toLowerCase()) && !asked.has(one.key.toLowerCase()))
          .map((one) => ({
            value: one.key,
            hint: `sin declarar · ${said_(one.uses)}`,
            uses: one.uses,
          }));

        const rest = [...declared, ...undeclared].sort(
          (a, b) => b.uses - a.uses || a.value.localeCompare(b.value, 'es'),
        );

        field.offer([...missing, ...rest]);
      })
      .catch(() => {
        // Sin ontología se escribe a ciegas, que es exactamente lo que se hacía
        // antes de que hubiera ninguna. El campo ya está abierto.
      });
  });


  /*
   * Un día no lleva front matter: lleva su fecha. Pero sí lleva propiedades.
   *
   * Antes se le retiraba `+ propiedad` para no repetir aparato encima de cada
   * jornada. El coste apareció en cuanto alguien quitó el tipo de un día: la
   * página quedaba sin ninguna forma de devolvérselo, porque el único sitio
   * desde el que se pone una propiedad era el botón que no se dibujaba. Una
   * puerta que sólo abre hacia fuera.
   *
   * Ver @guarantee TheKindIsRestorableWhereItIsRemovable: ninguna superficie
   * puede ofrecer quitar sin ofrecer poner. Lo que sigue fuera del día es la
   * marca de visibilidad, que no es una acción sino un estado.
   */
  metadata.append(properties);
  if (!readOnly) metadata.append(add);
  header.append(metadata);

  /*
   * Lo que se puede hacer con la página entera, en un menú.
   *
   * Sacar algo del documento —copiarlo, descargarlo, imprimirlo— es una
   * familia que va a crecer, y cada miembro puesto a la vista le quita sitio a
   * lo que la página dice. Lo que queda fuera del menú es `+ propiedad`, que no
   * saca nada sino que escribe, y la marca de visibilidad, que no es una acción
   * sino un estado y por eso se lee de un vistazo.
   */
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'page-more';
  more.setAttribute('aria-label', 'Más de esta página');
  more.setAttribute('aria-haspopup', 'menu');
  more.title = 'Más de esta página';
  more.innerHTML = icon('more-vertical');
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    if (readOnly) {
      openBlockMenu(more, [[
        {
          label: session.frontMatterOpen() ? 'ocultar propiedades' : 'mostrar propiedades',
          run: () => {
            chooseProperties(!session.frontMatterOpen());
          },
        },
        {
          label: 'Ver como presentación',
          icon: 'eye',
          run: () => void presentPage(page, options, callbacks.onNavigate, null, {
            scheme: callbacks.scheme,
            onScheme: callbacks.onScheme,
          }),
        },
        {
          label: 'Copiar el Markdown de la página',
          icon: 'copy',
          run: () => void copyPageMarkdown(page.id),
        },
        {
          label: 'Descargar como .md',
          icon: 'download',
          run: () => void downloadPage(page),
        },
        {
          label: 'Exportar a PDF',
          icon: 'file-text',
          run: () => void downloadPdf(page, toast),
        },
      ]]);
      return;
    }
    // Un solo grupo, todavía: el de la página no se ha ordenado ni se le han
    // puesto iconos, y media reforma se ve peor que ninguna.
    openBlockMenu(more, [
      [
      /*
       * Deshacer lo último, también desde aquí.
       *
       * Con Ctrl+Z fuera del editor y con este renglón, que es donde va a
       * buscarlo quien no se sabe los atajos. Lo mismo por dos puertas y no dos
       * cosas parecidas: las dos llaman a lo mismo.
       */
      {
        label: 'Deshacer lo último',
        icon: 'corner-up-left',
        run: () => void callbacks.onUndo?.('deshacer'),
      },
      {
        label: 'Rehacer',
        icon: 'corner-up-right',
        run: () => void callbacks.onUndo?.('rehacer'),
      },
      {
        /*
         * Declarar que el orden de esta página es un argumento, o retirarlo.
         *
         * No hay acto de creación de recorridos: hay una propiedad, y la escribe
         * quien escribe cualquier propiedad. Poner la propiedad no reordena
         * nada, no crea bloques y no cambia el mapa de nadie; lo único que
         * cambia es que a partir de ahí el orden se puede leer como ruta, porque
         * alguien ha dicho que era a propósito.
         * @invariant DeclaringNoticesAndDoesNotCreate.
         *
         * Y retirarlo deja el texto. Un argumento que uno ya no sostiene sigue
         * siendo una página que dice lo que decía; lo único que se retira es la
         * afirmación de que su orden hay que leerlo como ruta. Tiene que ser
         * barato o nadie lo retiraría nunca.
         * @invariant RetiringDestroysNothing.
         */
        label: trail === null ? 'Leer su orden como un recorrido' : 'Dejar de leerlo como recorrido',
        icon: 'steps-1',
        ...(special ? { blocked: 'una página especial gobierna Vera y no se lee como recorrido' } : {}),
        run: () => {
          void submitQuietly(
            trail === null
              ? {
                  kind: 'set_property',
                  page: page.id,
                  propertyKey: corpusNames().kind,
                  propertyValue: TRAIL_KIND,
                }
              : { kind: 'remove_property', page: page.id, propertyKey: corpusNames().kind },
          ).then((applied) => {
            if (applied) callbacks.onReload(null);
          });
        },
      },
      {
        label: 'Espacios compartidos de esta página',
        icon: 'affiliate',
        run: () => void renderPageSharing(page.id, page.title).then((panel) => {
          container.querySelector('.page-sharing')?.remove();
          header.after(panel);
        }),
      },
      {
        label: 'Solicitar al bibliotecario',
        icon: 'message-square',
        run: () => void askLibrarian(page, null, callbacks),
      },
      {
        // Deliberado y sobre esta página, nunca de oficio: resolver un enlace es
        // preguntarle al servidor que lo tiene, y eso le dice que aquí alguien
        // está leyendo sobre esto.
        label: 'Procesar la página',
        icon: 'cpu',
        ...(special ? { blocked: 'una página especial se edita deliberadamente y no se procesa' } : {}),
        run: () => void processPage(page, toast, callbacks),
      },
      {
        label: isPresentation(page.properties, corpusNames().kind) ? 'Presentar' : 'Ver como presentación',
        icon: 'eye',
        run: () => void presentPage(page, options, callbacks.onNavigate, null, {
          scheme: callbacks.scheme,
          onScheme: callbacks.onScheme,
        }),
      },
      {
        label: 'Copiar el Markdown de la página',
        icon: 'copy',
        run: () => void copyPageMarkdown(page.id),
      },
      {
        label: 'Descargar como .md',
        icon: 'download',
        run: () => void downloadPage(page),
      },
      {
        /*
         * El PDF lo compone el servidor y aquí sólo se descarga.
         *
         * Pedirle al navegador que imprima dejaba el resultado en manos de quien
         * lo pidiera. Lo que se guarda tiene que ser siempre el mismo documento.
         */
        label: 'Exportar a PDF',
        icon: 'file-text',
        run: () => void downloadPdf(page, toast),
      },
      {
        label: 'Eliminar la página',
        icon: 'trash-2',
        ...(special ? { blocked: 'las páginas especiales son parte permanente del gobierno de Vera' } : {}),
        run: () => void deletePage(page, callbacks),
      },
      ],
    ]);
  });
  header.append(more);

  container.append(header);

  /*
   * Si esta página gobierna una conexión, su panel va aquí: debajo de lo que la
   * página dice de sí misma y encima de lo que tenga escrito.
   *
   * Se pide después de dibujar y no antes porque el estado de la clave vive
   * fuera del corpus —no viaja con la página— y esperarlo para enseñar el texto
   * dejaría la página en blanco mientras tanto. Ver service-page.ts.
   */
  if (!readOnly && isServicePage(page.properties)) {
    void renderService(page.id, toast, (change) =>
      submitQuietly(change).then((applied) => {
        if (applied) callbacks.onReload(null);
        return applied;
      }),
    ).then((panel) => {
      if (panel !== null) header.after(panel);
    });
  }

  if (!readOnly && isPublicationPage(page.properties)) {
    void renderPublicationPage().then((panel) => {
      header.after(panel);
    });
  }

  /*
   * Y si la página dice que su orden es un argumento, su cinta va aquí.
   *
   * Encima del texto y no en su lugar: el recorrido se compone escribiendo, así
   * que el texto tiene que seguir siendo el texto. Ver trail-page.ts.
   */
  const trail = page.trail ?? null;
  const marks: Map<string, TrailMark> = trail === null ? new Map() : trailMarks(trail);
  if (trail !== null) {
    container.classList.add('is-trail');
    header.after(renderTrailBand(trail));
  }

  const list = document.createElement('div');
  list.className = 'blocks';
  container.append(list);

  if (isActivityPage(page.properties)) {
    list.hidden = true;
    const restore = async (changes: readonly Change[]): Promise<boolean> => {
      for (const change of changes) {
        try {
          const result = await api.submitConfirmed(change);
          if (result.status === 'rejected') {
            toast(`rechazado: ${result.reason}`);
            return false;
          }
        } catch {
          toast('sin conexión con el servidor');
          return false;
        }
      }
      toast('página restaurada');
      callbacks.onChanged();
      return true;
    };
    void renderActivityPage(restore, toast).then((made) => list.before(made));
  }

  /*
   * Si esta página declara de qué está hecho el corpus, sus fichas se dibujan
   * como una tabla y no como bloques sueltos.
   *
   * La lista se esconde hasta saberlo. La ontología se pide al servidor y llega
   * un instante después de dibujarse la página; enseñar entretanto los catorce
   * bloques para retirarlos en cuanto conteste haría parpadear la página entera
   * cada vez que se abre. Un blanco corto es menos ruidoso que un salto, y si la
   * petición falla la lista vuelve con todos sus bloques, que es exactamente lo
   * que la página era antes de que esto existiera.
   */
  /*
   * Y si es la página de la puerta MCP, sus conexiones son otra tabla.
   *
   * Se dibuja como la de la ontología y por el mismo motivo: las filas son los
   * bloques que declaran, así que los bloques se retiran y la tabla ocupa su
   * sitio. Ver mcp-page.ts.
   */
  if (isMCPPage(page.properties)) {
    list.hidden = true;
    void renderMCP(
      (change) =>
        submitQuietly(change).then((applied) => {
          if (applied) callbacks.onReload(null);
          return applied;
      }),
      toast,
      (title) => callbacks.onOpen(title, 'followed_reference'),
    ).then((made) => {
      list.hidden = false;
      if (made === null) return;
      const rows = [...list.querySelectorAll<HTMLElement>('.block')].filter((row) =>
        made.declaring.has(row.dataset['id'] ?? ''),
      );
      rows[0]?.before(made.element);
      for (const row of rows) row.remove();
    });
  }

  const governing = governingKind(page.properties);
  if (governing !== null) {
    list.hidden = true;
    void renderGoverning(governing, (change) => submitQuietly(change).then((applied) => {
      if (applied) callbacks.onReload(null);
      return applied;
    })).then((made) => {
      list.hidden = false;
      if (made === null) return;
      // Los bloques que declaran ya están dibujados: se retiran, y la tabla
      // ocupa el sitio del primero para que quede donde el documento la tenía.
      const rows = [...list.querySelectorAll<HTMLElement>('.block')].filter((row) =>
        made.declaring.has(row.dataset['id'] ?? ''),
      );
      rows[0]?.before(made.element);
      for (const row of rows) row.remove();
    });
  }

  /**
   * Dibuja un bloque. `ordinal` es su número cuando su padre dice que sus hijos
   * van numerados, y nulo cuando van con viñeta — que es casi siempre.
   */
  const drawBlock = (
    node: Node,
    depth: number,
    ordinal: number | null = null,
    descend = true,
  ): void => {
    const row = document.createElement('div');
    row.className = 'block';
    // La sangría sale de un token, y la hoja la encoge en pantallas estrechas.
    // Ver `--indent` en tokens.ts y `--indent-scale` en styles.css.
    row.style.setProperty(
      '--block-indent',
      `calc(var(--indent, 1.25rem) * var(--indent-scale, 1) * ${depth})`,
    );
    row.style.paddingLeft = 'var(--block-indent)';
    row.dataset['id'] = node.block.stableId;

    // @invariant OnlyParentsFold: el control sólo aparece donde hay algo que
    // plegar. Ofrecerlo en una hoja prometería algo que no puede pasar.
    const parent = node.children.length > 0;
    const shut = folded.has(node.block.stableId);
    /** Si este bloque dice que sus hijos van numerados. Gobierna su menú. */
    const numbering =
      readChildListStyle(page.blockProperties?.[node.block.stableId]) === 'numbered';

    if (parent) {
      const fold = document.createElement('button');
      fold.type = 'button';
      fold.className = shut ? 'fold shut' : 'fold';
      fold.innerHTML = icon(shut ? 'chevron-right' : 'chevron-down');
      fold.title = shut ? 'desplegar' : 'plegar';
      fold.setAttribute('aria-label', shut ? 'desplegar' : 'plegar');
      fold.setAttribute('aria-expanded', String(!shut));
      // El foco cambia en mousedown, antes del click. Logseq aplica este mismo
      // patrón a sus controles auxiliares: impedir el gesto nativo conserva el
      // editor y su selección hasta que el plegado pueda devolverlos al DOM
      // recién compuesto.
      fold.addEventListener('mousedown', (event) => event.preventDefault());
      fold.addEventListener('click', (event) => {
        event.stopPropagation();
        if (readOnly) {
          const viewport = holdViewport(container);
          page.folded = shut
            ? page.folded.filter((id) => id !== node.block.stableId)
            : [...page.folded, node.block.stableId];
          renderOutliner(container, page, callbacks, focus, focusRoot, true);
          restoreViewport(container, viewport);
          return;
        }
        void toggleFold(
          node.block.stableId,
          !shut,
          page,
          callbacks,
          focusAfterFold(node.block.stableId, !shut),
        );
      });
      row.append(fold);
    } else {
      // Un hueco del mismo ancho, para que las viñetas queden en columna.
      const gap = document.createElement('span');
      gap.className = 'fold empty';
      row.append(gap);
    }

    const bullet = document.createElement('button');
    bullet.type = 'button';
    const origin = spoken.get(node.block.stableId);
    const hand = hands[node.block.stableId];
    const generated = hand?.kind === 'agent';
    if (generated) row.classList.add('generated');

    bullet.className = [
      'bullet',
      shut ? 'folded' : '',
      origin === undefined ? '' : 'spoken',
      generated ? 'generated' : '',
    ].filter((part) => part !== '').join(' ');

    /*
     * En un recorrido, la viñeta de una parada es su número.
     *
     * Es lo que un recorrido tiene y una página no: sus referencias están en un
     * orden y ese orden es lo que se afirma. El número no se renumera cuando un
     * puente se corta —el argumento sigue teniendo siete paradas aunque la cuarta
     * ya no exista— y por eso se tacha en vez de desaparecer.
     * @invariant ABrokenBridgeIsDrawnBroken.
     */
    const mark = marks.get(node.block.stableId);
    if (mark !== undefined) {
      if (mark.ordinal !== null) {
        row.classList.add('trail-stop');
        bullet.dataset['ordinal'] = String(mark.ordinal);
        if (mark.broken) row.classList.add('trail-broken');
      }
      /*
       * Y la costura hasta aquí: continua por donde el corpus ya iba,
       * discontinua por donde sólo va este argumento. Es la aportación con
       * forma, y se lee sin contar nada.
       */
      if (mark.arriving !== null) {
        row.classList.add(mark.arriving === 'by_path' ? 'trail-seam' : 'trail-stitch');
        if (mark.connective) row.classList.add('trail-connective');
        if (mark.silent) row.classList.add('trail-silent');
      }
    }

    /*
     * Y si es un ítem de una lista numerada, su número ocupa el sitio del punto.
     *
     * Después de la marca de recorrido y sólo si aquélla no puso ninguna: las dos
     * escriben en el mismo sitio, y entre «parada 4 de un argumento» y «cuarto de
     * una lista» manda la primera, que es la que alguien afirmó. Coinciden casi
     * nunca y en silencio quedaría un número que no se sabe de qué es.
     */
    if (ordinal !== null && mark?.ordinal == null) {
      row.classList.add('numbered');
      bullet.dataset['ordinal'] = String(ordinal);
    }

    // Un bloque puede llevar las dos marcas y no se contradicen: dictado por
    // Herbert y reescrito después por un agente. Una dice de dónde vinieron las
    // palabras y la otra de quién son ahora.
    const said: string[] = [node.block.stableId];
    if (origin !== undefined) said.push(`dicho en voz: ${origin}`);
    if (generated) said.push(`escrito por ${hand.participant}`);
    if (mark?.ordinal !== null && mark?.ordinal !== undefined) {
      said.push(mark.broken ? `parada ${mark.ordinal}, ya no lleva a ninguna parte` : `parada ${mark.ordinal}`);
    }
    if (mark?.arriving === 'across_open_ground') said.push('se llega a campo través');
    if (mark?.arriving === 'by_path') said.push('se llega por un camino que ya existía');
    bullet.title = said.join(' · ');
    // El punto lo dibuja la hoja de estilo y no un carácter: llena si lo escribió
    // una mano y hueca si una máquina, del mismo tamaño las dos. Ver `.bullet`.
    bullet.setAttribute('aria-haspopup', 'menu');
    const blockSummary = node.block.content.trim().replace(/\s+/g, ' ').slice(0, 48);
    bullet.setAttribute('aria-label', blockSummary === ''
      ? `acciones del bloque vacío ${node.block.stableId}`
      : `acciones del bloque: ${blockSummary}`);

    if (!readOnly) {
      bullet.draggable = true;
      bullet.addEventListener('dragstart', (event) => {
        draggedBlock = node.block.stableId;
        draggedMoved = true;
        row.classList.add('dragging-block');
        event.dataTransfer?.setData('text/plain', node.block.stableId);
        if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = 'move';
      });
      bullet.addEventListener('dragend', () => {
        draggedBlock = null;
        row.classList.remove('dragging-block');
        clearDropMarks();
        // `dragend` precede al click en algunos navegadores.
        window.setTimeout(() => { draggedMoved = false; }, 0);
      });

      row.addEventListener('dragover', (event) => {
        const moved = draggedBlock;
        if (moved === null || moved === node.block.stableId) return;
        if (withDescendants(moved).includes(node.block.stableId)) return;
        event.preventDefault();
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move';
        clearDropMarks();
        const box = row.getBoundingClientRect();
        const bodyBox = body.getBoundingClientRect();
        const inside = event.clientX > bodyBox.left + 32;
        row.classList.add(inside
          ? 'drop-inside'
          : event.clientY < box.top + box.height / 2 ? 'drop-before' : 'drop-after');
      });

      row.addEventListener('dragleave', (event) => {
        if (event.relatedTarget instanceof globalThis.Node && row.contains(event.relatedTarget)) return;
        row.classList.remove('drop-before', 'drop-after', 'drop-inside');
      });

      row.addEventListener('drop', (event) => {
        const moved = draggedBlock ?? event.dataTransfer?.getData('text/plain') ?? null;
        if (moved === null || moved === '' || moved === node.block.stableId) return;
        event.preventDefault();
        event.stopPropagation();
        if (withDescendants(moved).includes(node.block.stableId)) {
          toast('un bloque no puede entrar dentro de lo que cuelga de él');
          clearDropMarks();
          return;
        }

        const inside = row.classList.contains('drop-inside');
        const after = row.classList.contains('drop-after');
        const parent = inside ? node.block.stableId : parentOf(node.block.stableId);
        const siblings = childrenOf(parent);
        let position = inside
          ? siblings.length
          : siblings.findIndex((candidate) => candidate.stableId === node.block.stableId) + (after ? 1 : 0);
        const oldParent = parentOf(moved);
        if (oldParent === parent) {
          const oldPosition = childrenOf(oldParent).findIndex((candidate) => candidate.stableId === moved);
          if (oldPosition >= 0 && oldPosition < position) position -= 1;
        }
        clearDropMarks();
        void submitQuietly({
          kind: 'move_block',
          block: moved,
          page: page.id,
          parent,
          position: Math.max(0, position),
        }).then((applied) => {
          if (applied) callbacks.onReload(null);
        });
      });
    }

    const body = document.createElement('div');
    body.className = 'body';

    /*
     * Un bloque con grabación enseña las dos cosas: el audio arriba y su texto
     * debajo, editable como cualquier otro.
     *
     * Antes el audio *reemplazaba* al bloque hasta que la cascada terminaba, y
     * terminarla se llevaba el audio por delante. Ahora conviven: el audio se
     * queda mientras no se borre, y el texto se escribe, se corrige y se parte
     * sin pedirle permiso a nada.
     */
    const attached = held.get(node.block.stableId);
    const speaking = speakingIn?.block === node.block.stableId;
    const speakingDestination = speakingIn?.destination ?? page.title;
    if (speaking) speakingIn = null;

    if (speaking) {
      renderRecorder(body, node.block.stableId, audioHandlers, speakingDestination);
    } else {
      if (attached !== undefined) {
        renderAudioBlock(body, attached, audioHandlers, node.block.content);
      }
      /*
       * Una tarea se dibuja como su casilla, y el texto sin la marca.
       *
       * La marca sigue estando en el bloque —es lo que se guarda y lo que viaja
       * al Markdown— y aquí sólo deja de leerse dos veces. Al editar vuelve a
       * verse, como se ven los corchetes de un enlace: lo que se edita es el
       * texto, y el texto la lleva.
       */
      const task = readTask(node.block.content);
      if (task !== null) {
        row.classList.add('task', `task-${TASK_CLASS[task.state]}`);
        const box = document.createElement('button');
        box.type = 'button';
        box.className = 'task-box';
        box.title = `${task.state} · pulsar para pasar a ${nextState(task.state)}`;
        box.setAttribute('aria-label', box.title);
        box.setAttribute('role', 'checkbox');
        box.setAttribute('aria-checked', task.state === 'hecho' ? 'true' : task.state === 'por hacer' ? 'false' : 'mixed');
        let state = task.state;
        box.addEventListener('click', (event) => {
          event.stopPropagation();
          // Pulsar es editar el bloque: una sola clase de operación, con su
          // historia y su deshacer. @invariant PressingIsEditing.
          const next = nextState(state);
          box.disabled = true;
          void submitQuietly({
            kind: 'edit_block',
            block: node.block.stableId,
            content: writeTask(next, task.said),
          }).then((applied) => {
            box.disabled = false;
            if (!applied) return;

            /*
             * Una casilla no cambia la estructura ni las palabras de la tarea.
             * Redibujar toda la página por ella desmontaba el botón enfocado y,
             * en páginas largas compuestas por tandas, restauraba el scroll
             * antes de que este bloque volviera a existir. WebKit limitaba
             * entonces la posición al breve contenido inicial y dejaba a la
             * persona arriba de la página.
             *
             * El modelo ya fue editado por `api.submit`; aquí sólo se pone al
             * día su representación presente. El mismo botón conserva así el
             * foco y el lugar de lectura. @invariant PressingKeepsItsPlace.
             */
            state = next;
            node.block.content = writeTask(state, task.said);
            row.classList.remove('task-todo', 'task-doing', 'task-done');
            row.classList.add(`task-${TASK_CLASS[state]}`);
            box.title = `${state} · pulsar para pasar a ${nextState(state)}`;
            box.setAttribute('aria-label', box.title);
            box.setAttribute('aria-checked', state === 'hecho' ? 'true' : state === 'por hacer' ? 'false' : 'mixed');
          });
        });
        body.append(box);
      }

      const text = document.createElement('div');
      text.className = 'body-text';
      text.innerHTML = renderMarkdown(task === null ? node.block.content : task.said, options);
      decorateCodeBlocks(text);
      markMissingImages(text);
      body.append(text);

      const transcript = text.querySelector<HTMLButtonElement>('button.youtube-transcript[data-youtube-source]');
      if (transcript !== null) {
        const already = node.children.some((child) => child.block.content.startsWith('**Transcripción:'));
        if (already) {
          transcript.textContent = 'Transcripción guardada';
          transcript.disabled = true;
        } else {
          transcript.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const source = transcript.dataset['youtubeSource'] ?? node.block.content.trim();
            transcript.disabled = true;
            transcript.textContent = 'Buscando pistas…';
            void api.youtubeTranscripts(source).then(async (catalog) => {
              const choice = await chooseTranscript(catalog.choices);
              if (choice === null) return;
              transcript.textContent = 'Trayendo…';
              const result = await api.youtubeTranscript(source, choice);
              const born = await api.submit({
                kind: 'create_block',
                page: page.id,
                parent: node.block.stableId,
                position: node.children.length,
                content: transcriptBlock(source, result),
              });
              if (born.status === 'rejected') throw new Error(born.reason);
              toast(`transcripción en ${choice.label} guardada bajo el video`);
              callbacks.onChanged();
              callbacks.onReload(null);
            }).catch((problem: unknown) => {
              toast(`no se pudo traer la transcripción: ${problem instanceof Error ? problem.message : 'error desconocido'}`);
            }).finally(() => {
              if (transcript.isConnected && !transcript.disabled) return;
              transcript.disabled = false;
              transcript.textContent = 'Traer transcripción';
            });
          });
        }
      }

      /*
       * El plazo, cuando lo hay.
       *
       * Al lado de la tarea y no debajo: es un dato de la línea y no una nota
       * que cuelgue. Lleva al día, que es una página, así que se puede ir a ver
       * qué más vence entonces.
       */
      const due = (page.blockProperties?.[node.block.stableId] ?? []).find(
        (one) => one.key.trim().toLowerCase() === DEADLINE_KEY,
      );
      if (task !== null && due !== undefined) {
        const when = document.createElement('a');
        when.className = 'task-due';
        when.href = `/p/${encodeURIComponent(due.value)}`;
        when.textContent = due.value;
        when.title = `vence el ${due.value}`;
        when.addEventListener('click', (event) => {
          event.preventDefault();
          callbacks.onNavigate?.(due.value);
        });
        body.append(when);
      }

      /*
       * Un bloque que pregunta se contesta al leerse.
       *
       * No hay nada que pulsar ni nada que guardar: se pregunta al dibujar la
       * página, contra el grafo como esté entonces. Guardar la respuesta sería
       * guardar una lista que envejece sin decirlo.
       */
      if (looksLikeQuery(node.block.content)) {
        answerQueryBlock(body, node.block.content, {
          onNavigate: callbacks.onNavigate,
          onEditBlock: (block, content) =>
            submitQuietly({ kind: 'edit_block', block, content }).then((applied) => {
              if (applied) callbacks.onReload(null);
              return applied;
            }),
        });
      }
    }

    // La glosa es marginalia privada y nota del presentador. En una lectura
    // pública no se ofrece siquiera su puerta: además de no recibir el texto,
    // la superficie no debe sugerir que allí hay una nota oculta.
    const editGloss = readOnly ? (): void => undefined : renderGloss(row, body, node.block.stableId);

    /** Abre un hermano vacío junto a este bloque y deja el cursor dentro. */
    const insertSibling = (position: number): void => {
      const near = neighbourhoods.get(node.block.stableId);
      if (near === undefined) return;
      void api
        .submit({
          kind: 'create_block',
          page: page.id,
          parent: near.parent,
          position,
          content: '',
        })
        .then((result) => {
          if (result.status === 'rejected') {
            toast(`rechazado: ${result.reason}`);
            return;
          }
          callbacks.onReload({ block: result.subjectId, at: 0 });
        })
        .catch(() => toast('no se pudo escribir el bloque: sin conexión con el servidor'));
    };

    bullet.addEventListener('click', (event) => {
      event.stopPropagation();
      if (draggedMoved) return;
      /*
       * Cinco grupos, y el orden de los cinco es un argumento.
       *
       * Primero lo que cambia lo que el bloque *dice* —glosarlo, explicar a qué
       * se ata, dárselo al modelo—, porque es lo que este menú ofrece y no
       * ofrece ningún otro sitio. Después lo que cambia dónde está. Después lo
       * que se lleva una copia y lo que sólo mira, que no tocan nada. Y al
       * final, solo y detrás de una raya, lo único que quita.
       *
       * El arco es ese: escribe, mueve, lee, borra. Quien abre el menú sin
       * saber qué busca baja por él y el riesgo crece hacia abajo, en vez de
       * repartirse por la lista.
       *
       * Y el primero es «glosa» también por una razón de teclado: al abrirse, el
       * foco cae en el primer renglón, así que un Enter distraído tiene que dar
       * en algo que se deshace solo cerrando el editor.
       */
      openBlockMenu(bullet, [
        [
          {
            label: glosses[node.block.stableId]?.content ? 'Editar glosa' : 'Agregar glosa',
            icon: 'message-square',
            run: editGloss,
          },
          /*
           * Explicar por qué esta página y aquélla se tocan.
           *
           * Desde aquí y no desde otro sitio: el momento en que alguien sabe por
           * qué dos páginas se tocan es el momento en que las está mirando
           * juntas. Lo que sale es un bloque hijo —la conectiva— que se escribe
           * como cualquier otro; lo que Vera pone es a dónde apunta y con qué
           * término, que es lo que hace que la relación se pueda leer desde el
           * otro extremo.
           */
          /*
           * El bloque como pedido: lo escrito se le da al modelo local y la
           * respuesta ocupa su sitio, con sus ítems colgando.
           *
           * El pedido no se pierde —queda en las revisiones del bloque— pero deja
           * de estar a la vista, porque lo que uno vuelve a leer es la lista y no
           * lo que pidió. Lo que sale queda firmado por el modelo y se dibuja como
           * lo que es: no lo escribió quien escribió el pedido.
           */
          {
            label: 'Solicitar al bibliotecario',
            icon: 'message-square',
            run: () => void askLibrarian(page, node.block, callbacks),
          },
          {
            label: 'Procesar el bloque',
            icon: 'cpu',
            ...(node.block.content.trim() === ''
              ? { blocked: 'un bloque vacío no pide nada' }
              : {}),
            run: () => void processBlock(node.block, row, toast, callbacks),
          },
        ],
        [
          {
            label: 'Insertar bloque arriba',
            icon: 'arrow-up',
            run: () => {
              const near = neighbourhoods.get(node.block.stableId);
              if (near !== undefined) insertSibling(near.index);
            },
          },
          {
            label: 'Insertar bloque abajo',
            icon: 'arrow-down',
            run: () => {
              const near = neighbourhoods.get(node.block.stableId);
              if (near !== undefined) insertSibling(near.index + 1);
            },
          },
          {
            label: picked.has(node.block.stableId) && picked.size > 1 ? 'Mover selección…' : 'Mover…',
            icon: 'corner-up-right',
            run: () => {
              if (picked.has(node.block.stableId) && picked.size > 1) {
                openBlockMenu(bullet, [[
                  { label: 'Arriba', icon: 'arrow-up', run: () => void movePickedVertically(true) },
                  { label: 'Abajo', icon: 'arrow-down', run: () => void movePickedVertically(false) },
                  { label: 'A otra página…', icon: 'search', run: () => void movePickedToPage() },
                ]]);
                return;
              }
              const near = neighbourhoods.get(node.block.stableId);
              const hasNextSibling = near !== undefined && [...neighbourhoods.values()].some(
                (candidate) => candidate.parent === near.parent && candidate.index === near.index + 1,
              );
              openBlockMenu(bullet, [[
                {
                  label: 'Arriba', icon: 'arrow-up',
                  ...(near?.index === 0 ? { blocked: 'ya es el primero' } : {}),
                  run: () => { if (near !== undefined) void moveBlock(node.block, page.id, near, true, callbacks); },
                },
                {
                  label: 'Abajo', icon: 'arrow-down',
                  ...(!hasNextSibling ? { blocked: 'ya es el último' } : {}),
                  run: () => { if (near !== undefined) void moveBlock(node.block, page.id, near, false, callbacks); },
                },
                {
                  label: 'A otra página…', icon: 'search',
                  run: () => void moveBlockToPage(node.block, page.id, callbacks),
                },
              ]]);
            },
          },
          /*
           * Que los hijos se lean numerados, o vuelvan a la viñeta.
           *
           * Desde el padre y no desde cada hijo: la lista es el padre y sus ítems
           * son sus hijos, así que hay un solo sitio donde decirlo y uno solo donde
           * está dicho. Ver rule NumberTheChildren.
           */
          {
            label: numbering ? 'Volver a viñetas' : 'Numerar los hijos',
            icon: 'list',
            // La regla del dominio todavía rechaza cualquier gesto imposible;
            // el menú, en cambio, sólo enumera lo que se puede hacer ahora.
            ...(parent ? {} : { blocked: 'este bloque no tiene hijos que numerar' }),
            run: () =>
              void markChildren(
                node.block,
                node.children.map((child) => child.block),
                !numbering,
                callbacks,
              ),
          },
        ],
        [
          {
            label: 'Copiar…',
            icon: 'copy',
            run: () => openBlockMenu(bullet, [[
              { label: 'Referencia', icon: 'link-2', run: () => copyText(`((${node.block.stableId}))`, toast) },
              { label: 'Identificador', icon: 'hash', run: () => copyText(node.block.stableId, toast) },
              {
                label: parent ? 'Bloque y sus hijos' : 'Markdown del bloque',
                icon: 'copy',
                run: () => copyText(nodeMarkdown(node), toast),
              },
            ]]),
          },
        ],
        [
          {
            label: 'Enfocar en este bloque',
            icon: 'crosshair',
            ...(parent ? {} : { blocked: 'un bloque sin hijos no tiene en qué enfocar' }),
            run: () => callbacks.onFocusBlock?.(node.block.stableId),
          },
          /*
           * Todo lo que este bloque dijo alguna vez.
           *
           * El registro lo tenía desde siempre y no había forma de mirarlo sin
           * abrir la base de datos. Un corpus que promete que nada se pierde tiene
           * que poder enseñarlo, o la promesa hay que creérsela; y cuando algo
           * parece perdido, éste es el sitio donde se comprueba que no.
           */
          {
            label: 'Ver la historia del bloque',
            icon: 'clock',
            run: () => void showHistory(node.block.stableId, row, toast),
          },
        ],
        [
          {
            label: 'Eliminar bloque',
            icon: 'trash-2',
            run: () => removeBlock(node, callbacks),
          },
        ],
      ]);
    });

    // Al enfocar, el bloque muestra su Markdown; al salir, su render.
    body.tabIndex = 0;
    body.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.classList.contains('wiki')) {
        event.preventDefault();
        callbacks.onNavigate(target.dataset['page'] ?? '');
        return;
      }
      if (target.classList.contains('block-ref')) {
        event.preventDefault();
        const id = target.dataset['block'] ?? '';
        const ref = page.blockRefs.find((candidate) => candidate.id === id);
        if (ref === undefined) {
          toast('esa referencia no nombra ningún bloque de este grafo');
          return;
        }
        // No sirve `a?.() ?? b()`: la primera devuelve void, así que el `??`
        // dispararía también la segunda y se navegaría dos veces.
        if (callbacks.onOpenBlock === undefined) callbacks.onOpen(ref.page, 'followed_reference');
        else callbacks.onOpenBlock(ref.page, ref.id);
        return;
      }
      if (target.tagName === 'A') return;
      // Pulsar el reproductor o sus botones no abre el editor; pulsar el texto
      // sí, que es lo que se espera de un texto.
      if (target.closest('.audio-block') !== null) return;
      if (readOnly) return;

      /*
       * Con Shift se escoge el tramo en vez de abrir el bloque.
       *
       * @invariant ASelectionIsWhatIsOnScreenBetweenTwoBlocks: el tramo corre
       * sobre lo dibujado. Y no se abre el editor, porque escoger y escribir son
       * respuestas distintas a la misma pregunta.
       */
      if (event.shiftKey) {
        event.preventDefault();
        const from = pickedOn ?? node.block.stableId;
        pickedOn = from;
        pickRange(from, node.block.stableId);
        window.getSelection()?.removeAllRanges();
        return;
      }
      // Empezar a escribir deshace lo escogido. @invariant NothingIsSelectedWhileWriting.
      if (picked.size > 0) clearPicked();
      pickedOn = node.block.stableId;
      pickedTo = node.block.stableId;
      const caret = caretFromClick(node.block, body, event);
      const readingSelection = window.getSelection();
      // Una selección de lectura que cruza bloques no pide editar el bloque en
      // que terminó el arrastre. Se conserva para copiarla o formatearla.
      if (readingSelection !== null
        && !readingSelection.isCollapsed
        && (readingSelection.anchorNode === null
          || readingSelection.focusNode === null
          || !body.contains(readingSelection.anchorNode)
          || !body.contains(readingSelection.focusNode))) return;
      const selected = readingSelection !== null
        && !readingSelection.isCollapsed
        && readingSelection.anchorNode !== null
        && readingSelection.focusNode !== null
        && body.contains(readingSelection.anchorNode)
        && body.contains(readingSelection.focusNode)
        ? sourceSelection(
            node.block.content,
            readingSelection.toString(),
            caret ?? Number.MAX_SAFE_INTEGER,
          )
        : null;
      openEditor(node, body, selected ?? caret);
    });

    /*
     * Un dibujo: el lápiz por donde se entra y las teclas por donde se sale.
     *
     * Los trazos son el texto del bloque, así que aquí no hay dónde poner el
     * cursor y ninguna tecla llegaba. Con un dibujo al final de una página eso
     * era el final de la página: no había manera de escribir debajo.
     *
     * Enfocado responde a las cuatro flechas y a Enter, y a nada más: escribir
     * una letra encima no escribe nada. @invariant TheCursorRestsOnItAndWritesNothing.
     */
    if (looksLikeDrawing(node.block.content)) {
      // Un dibujo enfocado no abre editor, así que sin esto no se vería que lo
      // está. La hoja le pone su señal. Ver `.drawn-body`.
      body.classList.add('drawn-body');

      /*
       * Debajo del dibujo, su pie: cuándo se hizo y por dónde se vuelve a él.
       *
       * No encima ni al lado. Un dibujo se ve del tamaño de sus trazos
       * —@invariant ItsOwnSizePlusAMargin— y un garabato de dos centímetros es un
       * tamaño legítimo: cualquier cosa puesta sobre él tapa justo el trazo que
       * alguien mira antes de decidir si lo retoca, y cualquier cosa puesta en el
       * canalón desalinea el dibujo del texto de los bloques vecinos.
       *
       * Al pie caben las dos cosas que hay que saber de un dibujo terminado. Las
       * dos se recogen a la derecha: información y gesto secundarios quedan
       * juntos y fuera del eje principal de la lectura.
       */
      const foot = document.createElement('div');
      foot.className = 'drawn-foot';

      /*
       * Cuándo se dibujó por última vez.
       *
       * Del registro de autoría, que ya viaja con la página y dice de qué mano
       * salió cada bloque y cuándo. No hace falta una fecha nueva: redibujar es
       * escribir el bloque, así que la última escritura es el último trazo.
       */
      const stamp = document.createElement('span');
      stamp.className = 'drawn-when';
      stamp.textContent = when(hand?.writtenAt ?? null);
      foot.append(stamp);

      // Y el lápiz, que se ve al enfocar o al pasar por encima y no siempre.
      // @invariant WhatIsFocusedShowsTheWayIn.
      const pencil = document.createElement('button');
      pencil.type = 'button';
      pencil.className = 'drawn-edit';
      pencil.innerHTML = icon('edit-filled');
      pencil.title = 'seguir dibujando';
      pencil.setAttribute('aria-label', 'seguir dibujando en este bloque');
      pencil.addEventListener('click', (event) => {
        event.stopPropagation();
        void redraw(node.block, callbacks, toast);
      });
      foot.append(pencil);
      body.append(foot);

      /*
       * La decisión la toma `resolveDrawingKey`; aquí sólo se ejecuta.
       *
       * Es el mismo reparto que el resto de las teclas del outliner: en keys.ts
       * entra la vecindad y sale qué hacer, sin DOM y sin red, y por eso se
       * prueba sin navegador. Ver el encabezado de keys.ts.
       */
      body.addEventListener('keydown', (event) => {
        // Aquí sólo se responde cuando el foco está de verdad en el bloque y no
        // en algo suyo —el lápiz se lleva sus propias teclas—, y con las teclas
        // desnudas: los atajos con modificador son de la página, no del bloque.
        if (event.target !== body) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const near = neighbourhoods.get(node.block.stableId);
        if (near === undefined) return;

        const outcome = resolveDrawingKey(event.key, near);
        if (outcome.kind === 'ninguno') return;
        event.preventDefault();

        /*
         * Mover el foco no pasa por el servidor.
         *
         * El `mover-foco` de un bloque de texto recarga la página entera. Desde
         * aquí no hace falta: los dos bloques están dibujados y sus asientos
         * están en `editors`, así que mover el foco es mover el foco. Y
         * `openEditor` ya sabe qué hacer si el vecino resulta ser otro dibujo.
         */
        if (outcome.kind === 'mover-foco') {
          const seat = editors.get(outcome.block);
          if (seat === undefined) return;
          seat.body.closest('.block')?.scrollIntoView({ block: 'nearest' });
          openEditor(seat.node, seat.body, outcome.at === 'inicio' ? 0 : Number.MAX_SAFE_INTEGER);
          return;
        }

        void api
          .submit({
            kind: 'create_block',
            page: page.id,
            parent: outcome.parent,
            position: outcome.position,
            content: '',
          })
          .then((result) => {
            if (result.status === 'rejected') {
              toast(`rechazado: ${result.reason}`);
              return;
            }
            callbacks.onReload({ block: result.subjectId, at: 0 });
          })
          .catch(() => toast('no se pudo escribir el bloque: sin conexión con el servidor'));
      });

    }

    row.classList.toggle('wide-content', hasWideContent(body));
    // Dos carriles distintos, y no una fila accidental de controles.
    //
    // El chevron —o su hueco— ya es el primer hijo. La viñeta y el cuerpo se
    // insertan inmediatamente después, antes de la marca de glosa que
    // `renderGloss` añadió al extremo derecho. `append` dejaba esa marca entre
    // el chevron y la viñeta: visualmente parecía otro mando del outline cuando
    // en realidad abre una lectura lateral.
    row.firstElementChild?.after(bullet, body);
    list.append(row);
    editors.set(node.block.stableId, { node, body });
    // El orden de lectura, que es este y no el del arbol guardado.
    visible.push(node.block.stableId);
    rows.set(node.block.stableId, row);
    if (picked.has(node.block.stableId)) row.classList.add('picked');
    // Un subárbol plegado no se dibuja. Como la vecindad se calcula sobre el
    // árbol visible, las teclas que recorren bloques lo saltan sin saber nada
    // del plegado: no hay dos ideas de qué está a la vista.
    if (descend && !folded.has(node.block.stableId)) {
      /*
       * El número de un hijo es su sitio entre sus hermanos, y se calcula aquí.
       *
       * @invariant TheNumberBelongsToTheTreeAndNotToTheText: no hay ningún número
       * guardado. Insertar, mover o borrar un ítem renumera el resto sin tocar a
       * nadie, porque el que se lee se cuenta al dibujar.
       *
       * Se cuentan todos los hijos y no sólo los visibles: plegar es lo que una
       * persona está mirando y no lo que dice el grafo (@invariant
       * FoldingIsNotAChange), así que un subárbol plegado no puede cambiar la
       * numeración de la lista en la que está.
       */
      node.children.forEach((child, index) =>
        drawBlock(child, depth + 1, numbering ? index + 1 : null),
      );
    }
  };

  /**
   * @invariant FocusBoundsTheStructure: enfocar reenraiza el árbol, y todo lo
   * demás se calcula sobre el árbol. Ninguna tecla necesita saber que hay un
   * foco: fuera de él, simplemente, no hay bloques.
   */
  const whole = buildTree(bodyBlocks(page, focusRoot));
  const rooted = focusRoot === null ? null : findNode(whole, focusRoot);
  const tree = rooted === null ? whole : rooted.children;
  const neighbourhoods = buildNeighbourhoods(tree);

  if (rooted !== null) {
    const bar = document.createElement('div');
    bar.className = 'focused';
    const label = document.createElement('span');
    label.textContent = renderMarkdown(rooted.block.content, options).replace(/<[^>]*>/g, '').trim();
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'focused-out';
    out.textContent = 'salir del enfoque';
    out.addEventListener('click', () => callbacks.onFocusBlock?.(null));
    bar.append(label, out);
    container.append(bar);
  }

  // ---------------------------------------------------------------------
  // Escoger varios bloques.
  // ---------------------------------------------------------------------

  /*
   * El orden en que se lee, que no es el orden en que se guarda.
   *
   * @invariant ASelectionIsWhatIsOnScreenBetweenTwoBlocks. `drawBlock` va
   * anadiendo aqui, asi que esta lista es literalmente lo dibujado y en su
   * orden. Un subarbol plegado no se dibuja y por tanto no esta: nadie lo
   * escogio, porque nadie lo estaba viendo.
   */
  const visible: string[] = [];
  const rows = new Map<string, HTMLElement>();

  const paintPicked = (): void => {
    for (const [id, row] of rows) row.classList.toggle('picked', picked.has(id));
  };

  /** Todo lo que cuelga de un bloque, este dibujado o plegado. */
  const withDescendants = (id: string): string[] => {
    const node = findNode(tree, id);
    if (node === null) return [id];
    const out: string[] = [];
    const walk = (at: Node): void => {
      out.push(at.block.stableId);
      for (const child of at.children) walk(child);
    };
    walk(node);
    return out;
  };

  const pickRange = (from: string, to: string): void => {
    const a = visible.indexOf(from);
    const b = visible.indexOf(to);
    if (a < 0 || b < 0) return;
    picked.clear();
    for (const id of visible.slice(Math.min(a, b), Math.max(a, b) + 1)) picked.add(id);
    pickedTo = to;
    paintPicked();
  };

  /**
   * Mueve un bloque el extremo suelto del tramo, en el orden en que se lee.
   *
   * Mueve el extremo, no el borde de lo escogido: asi recoger deshace estirar,
   * y el tramo puede cruzar el ancla y crecer al otro lado, que es lo que hace
   * cualquier seleccion con Shift desde que existen las listas.
   */
  const stretch = (by: 1 | -1): void => {
    if (pickedOn === null) return;
    const at = visible.indexOf(pickedTo ?? pickedOn);
    if (at < 0) return;
    const next = visible[at + by];
    if (next === undefined) return;
    pickRange(pickedOn, next);
  };

  /** El padre de un bloque, segun la pagina y no segun el arbol dibujado. */
  const parentOf = (id: string): string | null =>
    page.blocks.find((b) => b.stableId === id)?.parent ?? null;

  /** Los hijos de alguien, en su orden. */
  const childrenOf = (parent: string | null): BlockView[] =>
    page.blocks.filter((b) => b.parent === parent).sort((a, b) => a.position - b.position);

  /**
   * Los escogidos que no cuelgan de otro escogido.
   *
   * Mover un padre se lleva a sus hijos por definicion, asi que mover ademas al
   * hijo seria moverlo dos veces y dejarlo donde no se pidio. En orden de
   * lectura, que es el que importa para decidir quien entra donde.
   */
  const pickedRoots = (): string[] => {
    const under = (id: string): boolean => {
      let at = parentOf(id);
      let hops = 0;
      while (at !== null && hops < 1000) {
        if (picked.has(at)) return true;
        at = parentOf(at);
        hops += 1;
      }
      return false;
    };
    return visible.filter((id) => picked.has(id) && !under(id));
  };

  /** Sube o baja un tramo de hermanos sin alterar su orden ni sus subárboles. */
  const movePickedVertically = async (up: boolean): Promise<void> => {
    const roots = pickedRoots();
    if (roots.length === 0) return;
    const parent = parentOf(roots[0] ?? '');
    if (roots.some((id) => parentOf(id) !== parent)) {
      toast('para mover un tramo, sus raíces deben ser hermanas');
      return;
    }
    const move = selectedSiblingMove(
      childrenOf(parent).map((block) => block.stableId),
      roots,
      up,
    );
    if (move === null) {
      toast(up ? 'el tramo ya está arriba' : 'el tramo ya está abajo');
      return;
    }
    if (!(await submitQuietly({
      kind: 'move_block',
      block: move.block,
      page: page.id,
      parent,
      position: move.position,
    }))) return;
    callbacks.onReload(null);
  };

  /** Lleva las raíces escogidas, en orden, al final de otra página. */
  const movePickedToPage = async (): Promise<void> => {
    const roots = pickedRoots();
    if (roots.length === 0) return;
    let destination: PageSummary | null;
    try {
      destination = await chooseMovePage(page.id);
    } catch {
      toast('no se pudieron traer las páginas');
      return;
    }
    if (destination === null) return;
    for (const id of roots) {
      if (!(await submitQuietly({
        kind: 'move_block',
        block: id,
        page: destination.id,
        parent: null,
        position: Number.MAX_SAFE_INTEGER,
      }))) return;
    }
    clearPicked();
    callbacks.onChanged();
    callbacks.onOpen(destination.id, 'searched');
  };

  /**
   * Indentar o desindentar lo escogido, con la misma semantica que un bloque suelto.
   *
   * Indentar: cada uno pasa a ser hijo del hermano de encima, al final de sus
   * hijos. Desindentar: cada uno pasa a colgar de su abuelo, justo detras de su
   * antiguo padre. Es literalmente lo que `resolveTab` decide para uno solo; lo
   * unico que anade un tramo es el orden en que se envian los movimientos.
   *
   * Indentando se va de arriba abajo: el hermano de encima de un tramo de
   * hermanos es el mismo para todos —el primero que no se esta moviendo— y al
   * anadirse al final por turnos conservan su orden. Desindentando se va de abajo
   * arriba: cada uno se mete justo detras del padre, asi que procesar al reves es
   * lo que los deja en el orden en que estaban.
   */
  const shiftPicked = async (deeper: boolean): Promise<void> => {
    const roots = pickedRoots();
    if (roots.length === 0) return;

    const moves: Change[] = [];
    for (const id of deeper ? roots : [...roots].reverse()) {
      const parent = parentOf(id);
      if (deeper) {
        const brothers = childrenOf(parent);
        const at = brothers.findIndex((b) => b.stableId === id);
        // El hermano de encima que no se este moviendo tambien.
        let into: string | null = null;
        for (let i = at - 1; i >= 0; i -= 1) {
          const candidate = brothers[i]?.stableId;
          if (candidate !== undefined && !picked.has(candidate)) {
            into = candidate;
            break;
          }
        }
        if (into === null) continue;
        moves.push({
          kind: 'move_block',
          block: id,
          page: page.id,
          parent: into,
          position: Number.MAX_SAFE_INTEGER,
        });
        continue;
      }
      if (parent === null) continue;
      const grand = parentOf(parent);
      const uncles = childrenOf(grand);
      const at = uncles.findIndex((b) => b.stableId === parent);
      moves.push({ kind: 'move_block', block: id, page: page.id, parent: grand, position: at + 1 });
    }

    if (moves.length === 0) {
      toast(deeper ? 'no hay un hermano encima al que entrar' : 'ya están en el primer nivel');
      return;
    }
    for (const move of moves) {
      if (!(await submitQuietly(move))) break;
    }
    // Lo escogido sigue escogido: se puede volver a pulsar Tab sin reapuntar.
    callbacks.onReload(null);
  };

  /*
   * Quitar lo escogido.
   *
   * @invariant ASelectionIsRemovedLeavesFirst. El grafo no quita un bloque que
   * todavia tenga hijos, asi que se va de abajo hacia arriba y con una operacion
   * por bloque: la secuencia queda auditable paso a paso, igual que vaciar una
   * pagina.
   *
   * @invariant SelectingAParentSelectsWhatHangsFromIt: un bloque escogido con su
   * subarbol plegado se lleva el subarbol, y el aviso lo dice antes.
   *
   * @invariant DiscardingASelectionIsDeliberate.
   */
  const dropPicked = async (): Promise<void> => {
    if (picked.size === 0) return;
    const all = new Set<string>();
    for (const id of picked) for (const each of withDescendants(id)) all.add(each);

    const written = [...all].filter((id) => {
      const node = findNode(tree, id);
      return node !== null && node.block.content.trim() !== '';
    }).length;

    if (written > 0) {
      const cuenta =
        all.size === picked.size
          ? `${all.size} bloques`
          : `${picked.size} bloques y lo que cuelga de ellos, ${all.size} en total`;
      if (!window.confirm(`Se van a eliminar ${cuenta}. No se puede deshacer.`)) return;
    }

    // Las hojas primero: profundidad descendente sobre el arbol de la pagina.
    const depthOf = (id: string): number => {
      let depth = 0;
      let at = page.blocks.find((b) => b.stableId === id)?.parent ?? null;
      while (at !== null && depth < 1000) {
        depth += 1;
        at = page.blocks.find((b) => b.stableId === at)?.parent ?? null;
      }
      return depth;
    };
    const order = [...all].sort((x, y) => depthOf(y) - depthOf(x));

    clearPicked();
    for (const id of order) {
      if (!(await submitQuietly({ kind: 'remove_block', block: id }))) break;
    }
    callbacks.onReload(null);
  };

  function openEditor(
    node: Node,
    body: HTMLElement,
    placement?: number | SourceSelection,
  ): void {
    /*
     * Un dibujo recibe el cursor y no el editor.
     *
     * Aquí y no en cada sitio que llama, porque son tres y llegan por caminos
     * distintos: pulsando el bloque, cayendo en él con la flecha desde el de
     * arriba, y volviendo a la página después de un cambio estructural. Los dos
     * últimos abrían un campo de texto con las coordenadas del dibujo dentro, que
     * es exactamente lo que @invariant EditingADrawingOpensTheCanvas prohíbe: el
     * invariante estaba comprobado en el clic, y el clic no era la única puerta.
     *
     * Enfocado y sin editor, el bloque responde a las flechas y a Enter —ver
     * `drawingKeys`— y enseña el lápiz por donde se entra al lienzo.
     * @invariant TouchingADrawingIsNotEditingIt.
     */
    if (looksLikeDrawing(node.block.content)) {
      body.focus();
      return;
    }
    const near = neighbourhoods.get(node.block.stableId);
    if (near === undefined) return;
    startEditing(
      node.block,
      body,
      callbacks,
      options,
      {
        page: page.id,
        view: page,
        near,
        children: node.children.map((child) => child.block.stableId),
      },
      placement,
    );
  }

  /*
   * Los bloques de primer nivel van siempre con viñeta.
   *
   * Numerarlos sería una propiedad de la página y no de un bloque, y el gesto que
   * existe es sobre un bloque. Queda anotado en la spec como pregunta abierta en
   * vez de resuelto a medias aquí.
   */
  /*
   * Una página grande se entrega como se lee: primero el comienzo y después lo
   * que sigue, sin retenerlo todo detrás de una composición monolítica.
   *
   * El servidor ya contestó y el contenido está completo en memoria; lo que se
   * reparte aquí es el trabajo de Markdown y DOM. Cada lote devuelve el turno al
   * navegador para que pueda pintar, desplazar y actualizar el progreso. Así una
   * página con tablas y cientos de bloques no se presenta como cuarenta segundos
   * de silencio seguidos por una aparición súbita.
   */
  interface DrawEntry { node: Node; depth: number; ordinal: number | null }
  const entries: DrawEntry[] = [];
  const queue = (node: Node, depth: number, ordinal: number | null): void => {
    entries.push({ node, depth, ordinal });
    if (folded.has(node.block.stableId)) return;
    const numbered = readChildListStyle(page.blockProperties?.[node.block.stableId]) === 'numbered';
    node.children.forEach((child, index) =>
      queue(child, depth + 1, numbered ? index + 1 : null),
    );
  };
  for (const root of tree) queue(root, 0, null);

  const progressive = focus === null && focusRoot === null && entries.length >= 100;
  if (!progressive) {
    for (const root of tree) drawBlock(root, 0);
    wireFootnotes(list);
    wireAnchors(list);
  } else {
    const progress = document.createElement('p');
    progress.className = 'page-compose-progress';
    progress.setAttribute('role', 'status');
    progress.setAttribute('aria-live', 'polite');
    list.append(progress);

    let at = 0;
    let first = true;
    const batch = (): void => {
      // Si se navegó mientras esta página se componía, su lista ya no está en
      // el documento. No se sigue trabajando ni se mezcla la página anterior
      // con la nueva.
      if (!list.isConnected) return;
      // El primer cuadro entrega ocho bloques. Los siguientes usan un pequeño
      // presupuesto temporal: una página de prosa sencilla no necesita ciento
      // cuarenta cuadros para componerse, pero una tabla costosa tampoco puede
      // secuestrar el hilo indefinidamente.
      const began = performance.now();
      const cap = Math.min(at + (first ? 8 : 64), entries.length);
      const minimum = Math.min(at + 8, entries.length);
      while (at < cap && (at < minimum || performance.now() - began < 8)) {
        const entry = entries[at];
        if (entry !== undefined) {
          drawBlock(entry.node, entry.depth, entry.ordinal, false);
          // `drawBlock` añade al final; el estado debe permanecer después de lo
          // ya compuesto y no intercalarse antes del lote siguiente.
          list.append(progress);
        }
        at += 1;
      }
      first = false;
      progress.textContent = `Componiendo la página… ${at} de ${entries.length} bloques`;
      if (at < entries.length) {
        window.requestAnimationFrame(batch);
        return;
      }
      wireFootnotes(list);
      wireAnchors(list);
      wireCataloguedMedia(container, page);
      progress.textContent = 'Componiendo diagramas…';
      void renderMermaid(list).finally(() => progress.remove());
    };
    // El primer lote se compone ahora: el título y el inicio llegan en la misma
    // pintura. Los siguientes sí ceden un cuadro entre sí.
    batch();
  }

  // Una página sin bloques no tenía dónde pulsar, así que crearla dejaba a
  // quien la creó mirando una página en la que no podía escribir.
  /*
   * Una página sin bloques ofrece dónde escribir, no un botón que lo prometa.
   *
   * Aquí había un botón que decía «escribir el primer bloque». Cumplía de
   * palabra y fallaba de hecho: obligaba a leer una etiqueta, apuntarle y
   * pulsarla para llegar al sitio donde se escribe, cuando el sitio donde se
   * escribe podía estar ahí desde el principio. Escribir es lo único que se
   * puede hacer en una página vacía; pedir un gesto para desbloquearlo es poner
   * una puerta delante de la única habitación.
   *
   * Así que se dibuja el bloque: su viñeta y su renglón, con el cursor dentro.
   * Es lo mismo que se ve al borrar el último bloque de una página, y es lo que
   * uno espera de un editor de bloques desde hace quince años.
   *
   * El bloque nace al recibir el foco, no al dibujarse. Crearlo por el mero
   * hecho de mirar dejaría una operación firmada en el registro cada vez que
   * alguien abre una página vacía, y el registro de Vera dice quién hizo qué:
   * no puede llenarse de cosas que nadie hizo. Poner el cursor ahí sí es haber
   * decidido escribir.
   */
  if (tree.length === 0) {
    const row = document.createElement('div');
    row.className = 'block';

    const mark = document.createElement('span');
    mark.className = 'bullet phantom';
    mark.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'body';

    const editor = document.createElement('textarea');
    editor.className = 'editor';
    editor.rows = 1;
    editor.setAttribute('aria-label', 'Escribir el primer bloque');
    editor.placeholder = 'escribe aquí';

    let born = false;
    editor.addEventListener('focus', () => {
      // Una sola vez: el foco vuelve a este campo mientras la página se rehace.
      if (born) return;
      born = true;
      void api
        .submit({ kind: 'create_block', page: page.id, parent: null, position: 0, content: '' })
        .then((result) => {
          if (result.status === 'rejected') {
            born = false;
            toast(`rechazado: ${result.reason}`);
            return;
          }
          callbacks.onReload({ block: result.subjectId, at: 0 });
        })
        .catch(() => {
          born = false;
          toast('no se pudo crear el bloque: sin conexión con el servidor');
        });
    });

    body.append(editor);
    row.append(mark, body);
    list.append(row);
  }

  // Un cambio estructural rehace la página y pide seguir editando donde el
  // modelo dice que quedó el cursor.
  if (focus !== null) {
    const seat = editors.get(focus.block);
    if (seat !== undefined) {
      const row = seat.body.closest<HTMLElement>('.block');
      if (focus.at === null) row?.querySelector<HTMLButtonElement>('.fold')?.focus({ preventScroll: true });
      else {
        row?.scrollIntoView({ block: 'nearest' });
        openEditor(seat.node, seat.body, focus.at);
      }
    }
  }

  /*
   * Las teclas que actuan sobre lo escogido.
   *
   * Cuelgan del documento y no de un elemento porque una seleccion no tiene
   * foco: no hay nada donde escribir mientras esta puesta, y ese es justo su
   * significado. Se retira el oyente al volver a dibujar, o se acumularia uno
   * por repintado.
   */
  const onPickedKeys = (event: KeyboardEvent): void => {
    // Escribiendo manda el cursor: la seleccion ya se deshizo al abrir el editor.
    const at = document.activeElement;
    if (at instanceof HTMLTextAreaElement || at instanceof HTMLInputElement) return;
    if (at instanceof HTMLElement && at.isContentEditable) return;

    if (event.key === 'Escape' && picked.size > 0) {
      event.preventDefault();
      clearPicked();
      return;
    }
    if (event.altKey && event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      if (picked.size === 0) return;
      event.preventDefault();
      void movePickedVertically(event.key === 'ArrowUp');
      return;
    }
    if (event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      if (pickedOn === null) return;
      event.preventDefault();
      // La primera vez escoge el bloque de partida; a partir de ahi, estira.
      if (picked.size === 0) {
        picked.add(pickedOn);
        pickedTo = pickedOn;
        paintPicked();
      }
      stretch(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && picked.size > 0) {
      event.preventDefault();
      void dropPicked();
      return;
    }
    if (event.key === 'Tab' && picked.size > 0) {
      // Sin esto, Tab se lleva el foco a otro control y la seleccion se queda
      // puesta sobre algo que ya no responde a las teclas.
      event.preventDefault();
      void shiftPicked(!event.shiftKey);
    }
  };
  document.addEventListener('keydown', onPickedKeys);
  dropPickedKeys = (): void => document.removeEventListener('keydown', onPickedKeys);

  // Los diagramas se dibujan después del texto: la biblioteca se carga sola y
  // la página no espera por ella para poder leerse.
  if (!progressive) void renderMermaid(list);

  /*
   * Una página `tipo:: concepto` es, además de su escritura ordinaria, el lugar
   * donde el grafo reúne todo lo que usa o menciona ese concepto. La lista no
   * se guarda en la página: llega derivada y se puede buscar sin salir de ella.
   */
  if (page.concept !== undefined && page.concept !== null) {
    const members = page.concept.members;
    const whole = document.createElement('section');
    whole.className = 'concept-members';
    const heading = document.createElement('h2');
    heading.textContent = `En el grafo (${members.length})`;
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Buscar dentro de estas páginas';
    search.setAttribute('aria-label', 'buscar dentro de las páginas vinculadas a este concepto');
    const results = document.createElement('ul');

    const draw = (): void => {
      const query = search.value.trim().toLocaleLowerCase();
      results.replaceChildren();
      for (const member of members.filter((one) =>
        query === '' || `${one.title} ${one.excerpt}`.toLocaleLowerCase().includes(query),
      )) {
        const row = document.createElement('li');
        const link = document.createElement('button');
        link.type = 'button';
        link.textContent = member.title;
        link.addEventListener('click', () => callbacks.onOpen(member.page, 'followed_reference'));
        const modes = document.createElement('span');
        modes.className = 'concept-member-kinds';
        modes.textContent = [
          member.declared ? 'declarado' : '',
          member.linked ? 'enlazado' : '',
          member.mentioned && !member.linked ? 'mención potencial' : '',
        ].filter(Boolean).join(' · ');
        row.append(link, modes);
        if (member.mentioned && !member.linked && member.formalization !== null) {
          const proposal = member.formalization;
          const formalize = document.createElement('button');
          formalize.type = 'button';
          formalize.className = 'concept-formalize';
          formalize.textContent = 'formalizar enlace';
          formalize.setAttribute(
            'aria-label',
            `Formalizar «${proposal.written}» como enlace a ${page.title}`,
          );
          formalize.addEventListener('click', () => {
            void (async () => {
              formalize.disabled = true;
              try {
                // La fila es derivada y puede haber envejecido. Se vuelve a leer
                // sólo la página fuente antes de escribir para no reemplazar una
                // edición posterior con el texto desde el que nació la sugerencia.
                const source = await api.page(member.page, 10_000);
                const current = source.blocks.find(
                  (block) => block.stableId === proposal.block,
                );
                if (current?.content !== proposal.content) {
                  toast('la mención cambió; se actualizó la lista sin escribir');
                  callbacks.onReload(null);
                  return;
                }
                const outcome = await api.submitCanonical({
                  kind: 'edit_block',
                  block: proposal.block,
                  content: proposal.next,
                });
                if (outcome.status === 'rejected') {
                  toast(`no se pudo formalizar: ${outcome.reason}`);
                  formalize.disabled = false;
                  return;
                }
                toast(`enlazada «${proposal.written}» con «${page.title}»`);
                callbacks.onReload(null);
              } catch {
                toast('no se pudo comprobar ni formalizar la mención');
                formalize.disabled = false;
              }
            })();
          });
          row.append(formalize);
        }
        if (member.excerpt !== '') {
          const said = document.createElement('div');
          said.className = 'markdown-preview';
          renderPreview(said, member.excerpt);
          row.append(said);
        }
        results.append(row);
      }
    };
    search.addEventListener('input', draw);
    draw();
    whole.append(heading, search, results);
    container.append(whole);
  }

  /*
   * Las dos columnas: lo que esta página afirma y lo que afirman sobre ella.
   *
   * Van antes de las referencias y no después, y son cosa distinta de ellas. Un
   * retroenlace dice que alguien nombró esta página; una relación dice qué dijo
   * al nombrarla. Se ven las relaciones explicadas existan o no menciones entre
   * las dos páginas, y no se ven las menciones que nadie explicó: son dos
   * preguntas distintas y ésta es la segunda.
   */
  for (const [rows, name, outgoing] of [
    [page.crossingsOut ?? [], 'Afirma sobre otras', true],
    [page.crossingsIn ?? [], 'Afirman sobre ésta', false],
  ] as [CrossingRow[], string, boolean][]) {
    if (rows.length === 0) continue;

    const folded = foldingSection(`rel:${name}`, `${name} (${rows.length})`, 2);
    folded.section.classList.add('relations');
    const section = folded.body;

    const list = document.createElement('ul');
    for (const row of rows) {
      const item = document.createElement('li');
      item.className = 'relation';

      // El término, cuando lo hay. Sin él la fila dice lo mismo con una palabra
      // menos: explicar no exige clasificar.
      if (row.reads !== null) {
        const term = document.createElement('span');
        term.className = 'relation-term';
        term.textContent = row.reads;
        item.append(term);
      }

      const other = document.createElement('button');
      other.type = 'button';
      other.className = 'relation-page';
      other.textContent = row.title;
      // Un destino que nadie ha escrito se ve como lo que es: la relación está
      // en pie y la página todavía no.
      if (outgoing && row.toPage === null) other.classList.add('unresolved');
      other.addEventListener('click', () => callbacks.onOpen(
        outgoing ? (row.toPage ?? row.targetTitle) : row.fromPage,
        outgoing ? 'followed_reference' : 'followed_backlink',
        row.revision === null ? null : { id: row.stableId, revision: row.revision, content: row.said },
      ));
      item.append(other);

      // Lo dicho, que es la relación misma, y debajo la frase desde la que se
      // afirma: una relación sin su frase es una flecha sin sujeto.
      const said = document.createElement('div');
      renderRelationOutline(
        said, row, callbacks, readOnly,
        (host, content) => renderPreview(host, content, outgoing ? 'followed_reference' : 'followed_backlink'),
      );
      item.append(said);

      const from = document.createElement('div');
      from.className = 'relation-from markdown-preview';
      renderPreview(from, row.says, outgoing ? 'followed_reference' : 'followed_backlink');
      item.append(from);

      // El botón anterior ya ofrece el destino. Si la cita vuelve a nombrar esa
      // misma página, conservar otro enlace idéntico multiplica paradas para el
      // teclado y el lector de pantalla sin añadir una acción nueva.
      const destination = (outgoing ? row.targetTitle : row.title).toLowerCase();
      for (const repeated of item.querySelectorAll<HTMLAnchorElement>('a.wiki')) {
        if ((repeated.dataset['page'] ?? repeated.textContent ?? '').toLowerCase() !== destination) continue;
        repeated.tabIndex = -1;
        repeated.setAttribute('aria-hidden', 'true');
      }

      list.append(item);
    }
    section.append(list);
    container.append(folded.section);
  }

  /*
   * Referencias: una sola sección, en los dos sentidos.
   *
   * El pie contestaba media pregunta —quién habla de esta página— y la otra
   * mitad, de qué habla ella, estaba sólo dentro del texto: para saber de qué es
   * vecina una página había que releerla entera.
   *
   * Las dos columnas van a la par porque son la misma pregunta mirada desde los
   * dos lados. Las que van en los dos sentidos van debajo y juntas, porque no
   * son dos hechos sino uno: dos páginas que se nombran mutuamente están
   * relacionadas de una manera que ninguna de las dos columnas dice por
   * separado, y repetirlas arriba las contaría dos veces.
   *
   * Y cada renglón lleva su pluma. El momento en que alguien sabe por qué dos
   * páginas se tocan es el momento en que las está mirando juntas, y aquí están
   * juntas: explicar desde otro sitio sería pedirle que se acuerde después.
   */
  {
    const out = new Map((page.references ?? []).map((one) => [one.title.toLowerCase(), one]));
    const back = new Map<string, (typeof page.backlinks)[number]>();
    for (const one of page.backlinks) {
      if (!back.has(one.title.toLowerCase())) back.set(one.title.toLowerCase(), one);
    }

    interface Row {
      title: string;
      page: string | null;
      excerpt: string;
      /** El bloque de esta página donde ocurre la mención, si ocurre aquí. */
      from: string | null;
      /** Y lo que la otra dice de ésta, cuando se nombran las dos. */
      says?: string;
    }

    const both: Row[] = [];
    for (const [key, one] of out) {
      const other = back.get(key);
      if (other === undefined) continue;
      both.push({
        title: one.title,
        page: one.page,
        excerpt: projectedReferenceText(page, one.block, one.excerpt),
        from: one.block,
        says: other.excerpt,
      });
    }
    const mutual = new Set(both.map((one) => one.title.toLowerCase()));
    const names: Row[] = [...out.values()]
      .filter((one) => !mutual.has(one.title.toLowerCase()))
      .map((one) => ({
        title: one.title,
        page: one.page,
        excerpt: projectedReferenceText(page, one.block, one.excerpt),
        from: one.block,
      }));
    const named: Row[] = [...back.values()]
      .filter((one) => !mutual.has(one.title.toLowerCase()))
      .map((one) => ({ title: one.title, page: one.page, excerpt: one.excerpt, from: null }));

    if (both.length + names.length + named.length > 0) {
      const whole = foldingSection(
        'referencias',
        `Referencias (${both.length + names.length + named.length})`,
        2,
      );
      whole.section.classList.add('references');
      const section = whole.body;

      /*
     * La explicación que esta referencia ya tiene, si la tiene.
     *
     * Se busca entre lo que la página afirma: una relación explicada apunta a
     * una página, y una referencia nombra a una página. Sin esto, la pluma abría
     * siempre una caja en blanco y lo escrito ayer no aparecía por ninguna parte
     * —parecía que no se hubiera guardado, y lo que pasaba es que no se enseñaba.
     */
    const explained = (row: Row): CrossingRow | undefined =>
      (page.crossingsOut ?? []).find((crossing) =>
        row.page !== null
          ? crossing.toPage === row.page
          : crossing.targetTitle.toLowerCase() === row.title.toLowerCase(),
      );

    const list = (rows: Row[], gesture: 'followed_reference' | 'followed_backlink'): HTMLElement => {
        const ul = document.createElement('ul');
        for (const row of rows) {
          const item = document.createElement('li');
          item.className = 'reference';

          /*
           * La pluma, arriba a la izquierda. Explicar por qué estas dos páginas
           * se tocan es escribir, y lo que escribe cuelga del bloque donde la
           * mención ocurre —o, si la mención está en la otra página, de un bloque
           * nuevo al final de ésta, porque la afirmación es de aquí.
           */
          const quill = document.createElement('button');
          quill.type = 'button';
          quill.className = 'reference-explain';
          quill.innerHTML = icon('feather');
          quill.title = `explicar por qué ${row.title} tiene que ver con esta página`;
          quill.setAttribute('aria-label', `explicar la relación con ${row.title}`);
          const held = explained(row);
          if (held !== undefined) {
            quill.classList.add('explained');
            quill.title = `cambiar por qué ${row.title} tiene que ver con esta página`;
          }
          quill.addEventListener('click', (event) => {
            event.stopPropagation();
            explainTowards(item, row.title, row.page, held, page, toast, callbacks);
          });

          const link = document.createElement('div');
          link.className = 'backlink';
          link.tabIndex = 0;
          link.setAttribute('role', 'button');

          const where = document.createElement('span');
          where.className = 'backlink-page';
          where.textContent = row.title;
          // Una página nombrada y todavía sin escribir es una deuda a la vista,
          // no un enlace roto: se dibuja como lo que es.
          if (row.page === null) where.classList.add('unwritten');

          const said = document.createElement('div');
          said.className = 'backlink-excerpt markdown-preview';
          renderPreview(said, row.excerpt, gesture);

          link.append(where, said);
          if (row.says !== undefined) {
            const answers = document.createElement('div');
            answers.className = 'backlink-excerpt reciprocal markdown-preview';
            renderPreview(answers, row.says, gesture);
            link.append(answers);
          }
          const open = (): void => callbacks.onOpen(
            row.page ?? row.title,
            gesture,
            held?.revision == null
              ? null
              : { id: held.stableId, revision: held.revision, content: held.said },
          );
          link.addEventListener('click', (event) => {
            if ((event.target as HTMLElement).closest('a') !== null) return;
            open();
          });
          link.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            open();
          });

          item.append(quill, link);

          // Y debajo, lo que se dijo de ella. Es la prueba de que lo escrito se
          // escribió: sin enseñarlo, guardar y no guardar se ven igual.
          if (held !== undefined) {
            const said = document.createElement('div');
            said.className = 'relation-said';
            if (held.term !== null) {
              const term = document.createElement('span');
              term.className = 'relation-term';
              term.textContent = held.term;
              said.append(term);
            }
            const explanation = document.createElement('div');
            renderRelationOutline(
              explanation, held, callbacks, readOnly,
              (host, content) => renderPreview(host, content, gesture),
            );
            said.append(explanation);
            item.append(said);
          }

          ul.append(item);
        }
        return ul;
      };

      const columns = document.createElement('div');
      columns.className = 'reference-columns';
      /*
       * Lo entrante a la izquierda y lo saliente a la derecha, en el orden en
       * que se lee: primero quién llegó hasta aquí y después hacia dónde sale
       * esta página. La flecha va de izquierda a derecha y las columnas también.
       */
      for (const [name, rows, gesture, way] of [
        ['La nombran', named, 'followed_backlink', 'in'],
        ['Nombra a', names, 'followed_reference', 'out'],
      ] as [string, Row[], 'followed_reference' | 'followed_backlink', 'in' | 'out'][]) {
        if (rows.length === 0) continue;
        const column = foldingSection(`ref:${name}`, `${name} (${rows.length})`, 3);
        column.section.classList.add('reference-column', `reference-${way}`);
        column.body.append(list(rows, gesture));
        columns.append(column.section);
      }
      if (columns.children.length > 0) section.append(columns);

      if (both.length > 0) {
        const mutuals = foldingSection(
          'ref:ambos',
          `En los dos sentidos (${both.length})`,
          3,
        );
        mutuals.section.classList.add('reference-mutual');
        mutuals.body.append(list(both, 'followed_reference'));
        section.append(mutuals.section);
      }

      container.append(whole.section);
    }
  }

  // Pulsar un medio presentado abre su ficha. No se usa doble clic: en lectura
  // una imagen no tiene otra acción primaria y la catalogación debe descubrirse.
  wireCataloguedMedia(container, page);
  wireExternalLinks(container);
  void showLibrarianTurns(container, page, callbacks);
}

/*
 * Lo plegado al pie, recordado mientras dure la sesión.
 *
 * Cada guardado redibuja la página entera, así que sin esto una sección plegada
 * se abriría sola en cuanto alguien escribiera una letra. No baja al corpus: qué
 * tiene uno plegado es del taller, como lo es dónde está el divisor.
 */
const shutBelow = new Set<string>();

/**
 * Una sección del pie que se pliega.
 *
 * `details` y `summary` del navegador y no un botón propio: traen el teclado, el
 * lector de pantalla y el triángulo sin que haya que escribirlos, y lo que se
 * pliega sigue estando en el documento —se encuentra buscando en la página.
 */
function foldingSection(name: string, label: string, level: 2 | 3): {
  section: HTMLElement;
  body: HTMLElement;
} {
  const section = document.createElement('details');
  section.className = 'folding';
  section.open = !shutBelow.has(name);
  section.addEventListener('toggle', () => {
    if (section.open) shutBelow.delete(name);
    else shutBelow.add(name);
  });

  const head = document.createElement('summary');
  const title = document.createElement(level === 2 ? 'h2' : 'h3');
  title.textContent = label;
  head.append(title);

  const body = document.createElement('div');
  body.className = 'folding-body';

  section.append(head, body);
  return { section, body };
}

/**
 * Explica una relación cuyo destino ya se sabe.
 *
 * Desde una referencia, la página del otro extremo no hay que preguntarla: está
 * ahí, es la que se está mirando. Lo que falta es lo único que Vera no puede
 * poner, así que la caja pide eso —la frase— y, delante de dos puntos, el
 * término si se quiere: `profundiza: su rejilla se vuelve generativa`.
 */
async function explainTowards(
  host: HTMLElement,
  title: string,
  target: string | null,
  held: CrossingRow | undefined,
  page: PageView,
  notify: (message: string) => void,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  if (host.querySelector('.relation-ask') !== null) return;

  /*
   * Una caja de escribir, no un renglón.
   *
   * Lo que se pide aquí es una frase —por qué estas dos páginas se tocan—, y una
   * frase no cabe en un campo de una línea: se escribe mirando un agujero por el
   * que sólo pasan seis palabras. Nace con el alto del renglón que explica y
   * crece con lo que se escriba.
   *
   * Y con la letra del extracto que tiene al lado, porque va a leerse junto a
   * él: dos tamaños distintos en la misma fila hacen que uno parezca un pie de
   * página del otro.
   */
  const asking = document.createElement('div');
  asking.className = 'relation-ask';

  const field = document.createElement('textarea');
  field.className = 'relation-field';
  field.rows = 2;
  field.placeholder = `por qué ${title} tiene que ver con esta página`;
  field.setAttribute('aria-label', field.placeholder);
  // Lo que ya había, para poder corregirlo en vez de escribirlo otra vez. El
  // término delante de los dos puntos, como se escribe.
  field.value = held === undefined ? '' : held.term === null ? held.said : `${held.term}: ${held.said}`;

  const hint = document.createElement('p');
  hint.className = 'relation-hint';
  hint.textContent = 'Enter guarda · Escape deja las cosas como estaban · un término delante de «:» si quieres';

  asking.append(field, hint);
  host.append(asking);

  const autosize = (): void => {
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  };
  field.addEventListener('input', autosize);
  field.focus();
  field.select();
  autosize();

  let settled = false;

  const save = async (): Promise<void> => {
    if (settled) return;
    settled = true;
    const clean = field.value.trim();

    // Vaciar la caja de una relación que existía es retirarla: se borra el
    // bloque, que es donde vivía. Ver crossings en el dominio — la relación era
    // el bloque.
    if (clean === '') {
      if (held !== undefined) {
        notify(held.fromBlock === null
          ? 'vaciar no retira una conectiva: todavía falta el gesto explícito de retiro'
          : 'vaciar retiraría el bloque antiguo; no se hizo ningún cambio');
      }
      asking.remove();
      return;
    }

    const split = termAndProse(clean);

    /*
     * Si ya había una, se corrige; si no, nace.
     *
     * Corregir y no crear otra es lo que hace que volver a la pluma sea volver a
     * lo escrito. Antes cada visita creaba una relación nueva y la anterior
     * seguía ahí, invisible, porque sólo se enseñaba la primera.
     */
    if (held !== undefined) {
      if (held.fromBlock === null) {
        const written = await api.submit({
          kind: 'edit_crossing',
          crossing: held.stableId,
          content: split.prose,
          term: split.term ?? undefined,
        });
        if (written.status === 'rejected') notify(`no se pudo guardar: ${written.reason}`);
        else {
          notify(`cambiada la conectiva con ${title}`);
          callbacks.onReload(null);
        }
        return;
      }
      const written = await api.submit({
        kind: 'edit_block',
        block: held.connective,
        content: split.prose,
      });
      if (written.status === 'rejected') {
        notify(`no se pudo guardar: ${written.reason}`);
        asking.remove();
        return;
      }
      if (split.term === null) {
        if (held.term !== null) {
          await api.submit({
            kind: 'remove_property',
            block: held.connective,
            propertyKey: names.term,
          });
        }
      } else {
        await api.submit({
          kind: 'set_property',
          block: held.connective,
          propertyKey: names.term,
          propertyValue: split.term,
        });
      }
      notify(`cambiada la relación con ${title}`);
      callbacks.onReload(null);
      return;
    }

    /*
     * Dónde cuelga lo que se escribe.
     *
     * Si la mención ocurre en esta página, del bloque que la dice: ahí es donde
     * la afirmación tiene sujeto. Si ocurre en la otra —alguien nos nombró—, lo
     * que se está escribiendo es texto nuevo de esta página, y va al final como
     * cualquier cosa que se escribe.
     */
    if (target === null) {
      notify(`primero tiene que existir la página ${title}`);
      asking.remove();
      return;
    }
    const born = await api.submit({
      kind: 'create_crossing',
      fromPage: page.id,
      toPage: target,
      content: split.prose,
      term: split.term ?? undefined,
    });
    if (born.status === 'rejected') {
      notify(`no se pudo explicar: ${born.reason}`);
      asking.remove();
      return;
    }
    notify(`explicada la conectiva con ${title}`);
    callbacks.onReload(null);
  };

  field.addEventListener('keydown', (event) => {
    // Enter guarda; con Shift, salta de línea. Es lo mismo que hace un bloque, y
    // aquí se está escribiendo la misma clase de cosa.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void save();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      settled = true;
      asking.remove();
    }
  });
  // Salir de la caja guarda, como salir de un bloque: nada de lo que se escribe
  // en Vera se pierde por mirar a otro lado.
  field.addEventListener('blur', () => void save());
}

/**
 * Parte «profundiza: la frase» en su término y su frase.
 *
 * Los dos puntos y no un espacio: el término puede llevarlos —«precede a»— y la
 * frase empieza por donde sea. Sin dos puntos, todo es frase: la prosa es
 * obligatoria y clasificar no.
 */
export function termAndProse(said: string): { term: string | null; prose: string } {
  const at = said.indexOf(':');
  if (at === -1) return { term: null, prose: said.trim() };
  const term = said.slice(0, at).trim();
  const prose = said.slice(at + 1).trim();
  // Unos dos puntos con media frase delante no son un término: son puntuación.
  if (term === '' || term.length > 24 || prose === '') return { term: null, prose: said.trim() };
  return { term, prose };
}

/**
 * Pregunta a qué página apunta esta relación, y con qué término.
 *
 * Se escribe en una línea —`profundiza [[Guemil]]`— porque son dos cosas y
 * pedirlas en dos pasos convertiría en trámite lo que es un apunte. El término
 * es lo que va delante y puede no ir: la prosa es obligatoria y clasificar no.
 */
export function explanationIn(said: string): { title: string; term: string | null } | null {
  const linked = /\[\[([^\]]+)\]\]/.exec(said);
  const title = (linked?.[1] ?? '').trim();
  if (title === '') {
    // Sin corchetes, lo escrito es el título entero y no hay término: adivinar
    // dónde acaba uno y empieza el otro sería inventarse una separación.
    const bare = said.trim();
    return bare === '' ? null : { title: bare, term: null };
  }
  const before = said.slice(0, linked?.index ?? 0).trim();
  return { title, term: before === '' ? null : before };
}

/**
 * Crea la conectiva: un bloque que cuelga de aquel desde el que se afirma.
 *
 * Tres operaciones ordinarias y ninguna propia —@guarantee
 * ComposingIsWritingAndNothingElse—: el bloque, a dónde apunta y, si se dijo,
 * con qué término. Después se abre para escribir, porque lo que falta es
 * justamente lo único que Vera no puede poner.
 */
async function explainFrom(
  host: HTMLElement,
  from: BlockView,
  page: string,
  notify: (message: string) => void,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  // Se pregunta donde se está leyendo, en un renglón bajo el bloque, y no en un
  // diálogo del navegador: lo que se está haciendo es escribir sobre lo que se
  // tiene delante, y un cuadro modal tapa justamente eso.
  const asking = document.createElement('div');
  asking.className = 'relation-ask';
  host.append(asking);

  editInPlace(asking, '', 'término y página, p. ej. profundiza [[Guemil]]', async (said) => {
    const asked = explanationIn(said);
    if (asked === null) {
      notify('hace falta una página a la que apuntar');
      asking.remove();
      return true;
    }

    const born = await api.submit({
      kind: 'create_block',
      page,
      parent: from.stableId,
      position: 0,
      content: '',
    });
    if (born.status === 'rejected') {
      notify(`no se pudo explicar: ${born.reason}`);
      asking.remove();
      return true;
    }

    const connective = born.subjectId;
    const puesta = await api.submit({
      kind: 'set_property',
      block: connective,
      propertyKey: 'explica',
      propertyValue: `[[${asked.title}]]`,
    });
    if (puesta.status === 'rejected') {
      notify(`no se pudo explicar: ${puesta.reason}`);
      asking.remove();
      return true;
    }

    if (asked.term !== null) {
      await api.submit({
        kind: 'set_property',
        block: connective,
        propertyKey: 'término',
        propertyValue: asked.term,
      });
    }

    notify(`explicada la relación con ${asked.title}`);
    // El cursor donde va lo que falta: la frase. Es lo único que Vera no puede
    // poner, y es la relación entera.
    callbacks.onReload({ block: connective, at: 0 });
    return true;
  });
}

/**
 * La vecindad de cada bloque de la página, calculada una vez por render.
 *
 * Las teclas estructurales necesitan saber quién está encima, quién es hermano
 * y quién es abuelo. Recorrer el árbol en cada pulsación sería recalcular lo
 * mismo una y otra vez.
 */
export function buildNeighbourhoods(roots: Node[]): Map<string, Neighbourhood> {
  interface Seat {
    node: Node;
    parent: string | null;
    index: number;
  }

  const flat: Seat[] = [];
  const walk = (nodes: Node[], parent: string | null): void => {
    for (const [index, node] of nodes.entries()) {
      flat.push({ node, parent, index });
      walk(node.children, node.block.stableId);
    }
  };
  walk(roots, null);

  const seats = new Map(flat.map((seat) => [seat.node.block.stableId, seat]));
  const near = new Map<string, Neighbourhood>();

  for (const [at, seat] of flat.entries()) {
    const id = seat.node.block.stableId;
    const before = flat[at - 1];
    const after = flat[at + 1];

    // El hermano anterior es el que comparte padre y va justo antes en el orden
    // de lectura; buscarlo hacia atrás lo encuentra saltándose a los hijos.
    let previousSibling: string | null = null;
    for (let back = at - 1; back >= 0; back -= 1) {
      const candidate = flat[back];
      if (candidate === undefined) break;
      if (candidate.parent === seat.parent) {
        previousSibling = candidate.node.block.stableId;
        break;
      }
    }

    const parentSeat = seat.parent === null ? undefined : seats.get(seat.parent);

    near.set(id, {
      block: id,
      parent: seat.parent,
      index: seat.index,
      hasChildren: seat.node.children.length > 0,
      previousSibling,
      previousVisible:
        before === undefined
          ? null
          : {
              block: before.node.block.stableId,
              content: before.node.block.content,
              hasChildren: before.node.children.length > 0,
            },
      nextVisible: after === undefined ? null : after.node.block.stableId,
      grandparent: parentSeat?.parent ?? null,
      parentIndex: parentSeat?.index ?? 0,
    });
  }

  return near;
}

/** Lo que hace falta para llevar a cabo una decisión de tecla. */
interface Structural {
  page: string;
  block: BlockView;
  near: Neighbourhood;
  children: string[];
  callbacks: OutlinerCallbacks;
}

/**
 * Lleva a cabo la decisión enviando operaciones.
 *
 * @invariant EveryKeystrokeChangeIsAnOperation: partir, fusionar e indentar
 * envían operaciones ordinarias, con la misma procedencia y el mismo orden que
 * cualquier otro cambio. La fluidez no compra ningún atajo hacia el grafo.
 */
async function perform(outcome: KeyOutcome, context: Structural): Promise<void> {
  const { page, block, near, children, callbacks } = context;

  try {
    switch (outcome.kind) {
      case 'ninguno':
        return;

      case 'rechazo':
        // @invariant RefusalsAreVisible: el silencio sería indistinguible de una
        // tecla que no registró.
        toast(outcome.reason);
        return;

      case 'partir': {
        // El bloque conserva su identidad y su cabeza; la cola nace aparte.
        await api.submit({ kind: 'edit_block', block: block.stableId, content: outcome.head });
        const created = await api.submit({
          kind: 'create_block',
          page,
          parent: outcome.parent,
          position: outcome.position,
          content: outcome.tail,
        });
        callbacks.onReload(
          created.status === 'rejected' ? null : { block: created.subjectId, at: 0 },
        );
        return;
      }

      case 'insertar-encima':
        await api.submit({
          kind: 'create_block',
          page,
          parent: outcome.parent,
          position: outcome.position,
          content: '',
        });
        callbacks.onReload({ block: block.stableId, at: 0 });
        return;

      case 'indentar':
      case 'desindentar': {
        const moved = await api.submit({
          kind: 'move_block',
          block: block.stableId,
          page,
          parent: outcome.parent,
          position: outcome.position,
        });
        if (moved.status === 'rejected') toast(`rechazado: ${moved.reason}`);
        callbacks.onReload({ block: block.stableId, at: 0 });
        return;
      }

      case 'quitar-encima': {
        const removed = await api.submit({ kind: 'remove_block', block: outcome.target });
        if (removed.status === 'rejected') toast(`rechazado: ${removed.reason}`);
        callbacks.onReload({ block: block.stableId, at: 0 });
        return;
      }

      case 'fusionar': {
        // Los hijos se mudan antes de quitar el bloque: sólo una hoja se puede
        // quitar, y así ninguno queda huérfano por un padre que desapareció.
        for (const child of children) {
          await api.submit({
            kind: 'move_block',
            block: child,
            page,
            parent: outcome.into,
            position: Number.MAX_SAFE_INTEGER,
          });
        }
        await api.submit({ kind: 'edit_block', block: outcome.into, content: outcome.content });
        const removed = await api.submit({ kind: 'remove_block', block: block.stableId });
        if (removed.status === 'rejected') {
          toast(`rechazado: ${removed.reason}`);
          callbacks.onReload(null);
          return;
        }
        callbacks.onReload({ block: outcome.into, at: outcome.caret });
        return;
      }

      case 'mover-foco':
        callbacks.onReload({
          block: outcome.block,
          at: outcome.at === 'inicio' ? 0 : Number.MAX_SAFE_INTEGER,
        });
        return;
    }
  } catch {
    toast('no se pudo aplicar el cambio: sin conexión con el servidor');
  }
  void near;
}


/** Una entrada ofrecida por el autocompletado. */
interface Candidate {
  /** Lo que se escribe al elegirla. */
  value: string;
  label: string;
  hint?: string;
}

/**
 * Busca candidatos para lo que hay abierto.
 *
 * Las páginas y los bloques se piden al servidor, que es quien sabe qué hay en
 * el grafo; los comandos son una lista fija que vive en el cliente porque no
 * dependen del contenido.
 */
async function candidatesFor(
  open: Open,
  query: string,
  pages: readonly PageSummary[] = [],
): Promise<Candidate[]> {
  if (open.trigger === 'comando') {
    return matchingCommands(query).map((command) => ({
      value: command.name,
      label: command.name,
      hint: command.hint,
    }));
  }

  if (query.trim() === '') return [];

  /*
   * Una referencia a página sólo necesita títulos.
   *
   * El índice ya está en memoria para navegar, resolver direcciones y completar
   * enlaces. Pedir `/search` aquí hacía una búsqueda de texto completo en cada
   * pulsación y dejaba varias peticiones compitiendo mientras se escribía. Las
   * etiquetas nombran páginas también, así que siguen exactamente este camino.
   */
  if (open.trigger === 'pagina' || open.trigger === 'etiqueta') {
    return suggestTitles(query, pages, 8).map((page) => ({
      value: page.title,
      label: page.title,
    }));
  }

  const hits = await api.search(query);
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const hit of hits) {
    if (open.trigger === 'bloque') {
      if (hit.block === null || seen.has(hit.block)) continue;
      seen.add(hit.block);
      out.push({ value: hit.block, label: hit.excerpt, hint: 'bloque' });
    } else {
      // Páginas y etiquetas se completan con un título, que es lo que va entre
      // corchetes; el hallazgo puede venir de un bloque de esa página.
      if (hit.field !== 'page_title' || seen.has(hit.excerpt)) continue;
      seen.add(hit.excerpt);
      out.push({ value: hit.excerpt, label: hit.excerpt });
    }
    if (out.length >= 8) break;
  }

  return out;
}

/** Cuánto silencio hace falta para que lo escrito baje al grafo. */
const EDITING_PAUSE = 900;

/**
 * Qué carácter del texto dibujado hay debajo del punto que se pulsó.
 *
 * El navegador sabe contestarlo por dos nombres: `caretPositionFromPoint` es el
 * estándar y `caretRangeFromPoint` es como lo llama WebKit. Con el nodo y su
 * desplazamiento, un rango desde el principio del bloque hasta ahí cuenta los
 * caracteres visibles que quedan detrás, que es lo único que hace falta saber.
 *
 * @invariant TheCaretBeginsWhereItWasPut.
 */
function visibleOffsetAt(root: HTMLElement, x: number, y: number): number | null {
  const doc = root.ownerDocument;
  const legacy = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  // `globalThis.Node` y no `Node` a secas: aquí dentro ese nombre es el nodo del
  // árbol de bloques, que es lo que este archivo dibuja.
  let node: globalThis.Node | null = null;
  let offset = 0;
  const position = doc.caretPositionFromPoint?.(x, y) ?? null;
  if (position !== null) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = legacy.caretRangeFromPoint?.(x, y) ?? null;
    if (range !== null) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }

  // Fuera del bloque no hay nada que contestar: pulsar el margen no es señalar
  // una palabra, y contestar cero mandaría el cursor al principio del texto.
  if (node === null || !root.contains(node)) return null;

  const counted = doc.createRange();
  counted.selectNodeContents(root);
  try {
    counted.setEnd(node, offset);
  } catch {
    return null;
  }
  return counted.toString().length;
}

/**
 * Dónde poner el cursor al empezar a escribir por haber señalado una palabra.
 *
 * Devuelve `undefined` cuando el gesto no nombra una posición —se pulsó el
 * margen, el bloque no dibuja texto, o lo dibujado no viene de este fuente— y
 * entonces el cursor va al final, que es lo que hacía siempre.
 *
 * @invariant TheCaretBeginsWhereItWasPut.
 */
function caretFromClick(block: BlockView, body: HTMLElement, event: MouseEvent): number | undefined {
  const text = body.querySelector<HTMLElement>('.body-text');
  if (text === null) return undefined;

  const at = visibleOffsetAt(text, event.clientX, event.clientY);
  if (at === null) return undefined;

  /*
   * Lo dibujado y el fuente no son el mismo texto.
   *
   * La marca de una tarea, los asteriscos de una negrita, los corchetes de una
   * referencia y la dirección de un enlace están en uno y no en el otro, así que
   * la posición hay que traducirla. Ver caret.ts.
   */
  return sourceOffsetFor(block.content, text.textContent ?? '', at) ?? undefined;
}

/** Las teclas que llevan el cursor a otro sitio sin cambiar el texto. */
const MOVES_CARET = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);

/** El ancestro que se desplaza. En Vera es `#text`, pero no se da por sabido. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node !== null) {
    const flow = getComputedStyle(node).overflowY;
    if (flow === 'auto' || flow === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/** Lo que mide una línea de este campo, con un respaldo si el estilo no lo dice. */
function lineHeightOf(editor: HTMLTextAreaElement): number {
  const style = getComputedStyle(editor);
  const declared = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(declared)) return declared;
  const size = Number.parseFloat(style.fontSize);
  return Number.isFinite(size) ? size * 1.5 : 24;
}

/**
 * A qué altura, dentro del campo, cae la línea donde está el cursor.
 *
 * Un `textarea` no lo dice: no hay manera de preguntarle dónde dibujó una
 * posición. Se compone un espejo —un elemento con sus mismas medidas y su mismo
 * texto hasta el cursor— y se mide dónde termina. Es la técnica de siempre para
 * esto, y es exacta mientras el espejo herede lo que decide el reparto de
 * líneas: la fuente, el ancho, el relleno y cómo se parten las palabras.
 *
 * Se paga un reflujo, así que sólo se llama cuando hace falta: un bloque que
 * cabe entero en el visor se resuelve con sus medidas y sin espejo.
 */
function caretTopIn(editor: HTMLTextAreaElement, at: number): number {
  const style = getComputedStyle(editor);
  const mirror = document.createElement('div');
  const copied = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'letterSpacing', 'wordSpacing', 'lineHeight', 'textIndent', 'textTransform',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'whiteSpace', 'overflowWrap', 'wordBreak', 'tabSize',
  ] as const;
  for (const property of copied) mirror.style[property] = style[property];
  mirror.style.boxSizing = 'border-box';
  mirror.style.width = `${editor.offsetWidth}px`;
  mirror.style.position = 'absolute';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.height = 'auto';
  mirror.style.visibility = 'hidden';
  // Un `textarea` reparte así aunque el estilo calculado diga otra cosa.
  if (mirror.style.whiteSpace === '' || mirror.style.whiteSpace === 'normal') {
    mirror.style.whiteSpace = 'pre-wrap';
  }

  mirror.textContent = editor.value.slice(0, at);
  const mark = document.createElement('span');
  // Un carácter sin ancho: marca la línea sin poder empujarla a la siguiente.
  mark.textContent = '​';
  mirror.append(mark);

  document.body.append(mirror);
  const top = mark.offsetTop;
  mirror.remove();
  return top;
}

/**
 * Trae a la vista la línea que se está escribiendo, y sólo si hace falta.
 *
 * @invariant WhatIsBeingWrittenStaysInSight. La decisión —si se mueve y cuánto—
 * está en caret.ts y se prueba sin navegador; aquí se toman las medidas y se
 * aplica.
 */
function keepCaretInSight(editor: HTMLTextAreaElement, at: number): void {
  const scroller = scrollerOf(editor);
  if (scroller === null) return;

  const view = scroller.clientHeight;
  if (view === 0) return;

  const box = editor.getBoundingClientRect();
  const frame = scroller.getBoundingClientRect();
  const line = lineHeightOf(editor);
  const margin = Math.max(16, line);
  const toolbar = document.querySelector<HTMLElement>('.format-bar');
  const topInset = toolbar === null ? margin : toolbar.getBoundingClientRect().height + 12;
  const tall = box.height + topInset + margin > view;

  const delta = scrollDeltaFor({
    top: box.top - frame.top,
    height: box.height,
    caret: tall ? caretTopIn(editor, at) : 0,
    line,
    view,
    margin,
    topInset,
  });
  if (delta !== 0) scroller.scrollTop += delta;
}

function startEditing(
  block: BlockView,
  body: HTMLElement,
  callbacks: OutlinerCallbacks,
  options: RenderOptions,
  context: { page: string; view: PageView; near: Neighbourhood; children: string[] },
  placement: number | SourceSelection = Number.MAX_SAFE_INTEGER,
): void {
  if (body.querySelector('textarea') !== null) return;
  const session = createSession(block.content);

  const editor = document.createElement('textarea');
  editor.className = 'editor';
  /*
   * El fuente, sin el blanco del final.
   *
   * @invariant EditingRevealsTheSource pide la fuente exacta que produjo lo que
   * se estaba leyendo, y un salto de línea al final no produce nada: el texto
   * dibujado es idéntico con él y sin él. Lo que sí produce es un campo dos
   * renglones más alto que el párrafo que estaba en su sitio, así que abrir un
   * bloque lo empujaba todo hacia abajo y al cerrarlo volvía. En el corpus hay
   * 55 bloques así, traídos de documentos.
   *
   * Recortarlo aquí y no en el grafo: abrir un bloque no es escribir en él, y
   * curar 55 bloques a base de operaciones que nadie pidió llenaría el registro
   * de cambios sin autor. Se curan solos cuando alguien los edite de verdad —ver
   * session.ts, que ya no guarda ese blanco—, y mientras tanto no se ven.
   */
  editor.value = block.content.trimEnd();
  editor.rows = 1;

  /*
   * El audio sobrevive a la edición de su texto.
   *
   * `body` tiene dos cosas cuando el bloque fue hablado: la grabación arriba y
   * su texto debajo. Editar vaciaba el `body` entero para poner el campo, así
   * que tocar el texto se llevaba el audio por delante, y al volver a la vista
   * normal ya no estaba. La grabación seguía en el grafo —pegada a su bloque,
   * intacta— pero no había forma de oírla sin recargar la página.
   *
   * Eso incumple @guarantee TheRecordingIsAlwaysReachable: mientras el audio
   * existe se oye desde donde se leen sus palabras, sin abrir nada. Una
   * grabación que hay que ir a buscar es una que se deja de contrastar, y
   * contrastar el texto con lo que se dijo es justo lo que uno hace mientras lo
   * corrige.
   *
   * Se aparta antes de vaciar y se devuelve: lo que se edita es el texto, y el
   * audio no es texto de nadie.
   */
  const spoken = body.querySelector('.audio-block');
  const formatBar = document.createElement('div');
  formatBar.className = 'format-bar';
  formatBar.setAttribute('role', 'toolbar');
  formatBar.setAttribute('aria-label', 'formato del bloque');
  body.innerHTML = '';
  if (spoken !== null) body.append(spoken);
  body.append(formatBar, editor);
  body.classList.add('editing');

  /**
   * El alto sigue al contenido.
   *
   * Contar los saltos de línea no alcanza: una línea larga se reparte en varias
   * al ajustarse al ancho de la columna, y el bloque más común del corpus es
   * justamente eso, un párrafo sin un solo salto. `scrollHeight` mide el texto
   * ya ajustado, así que vale para los dos casos.
   *
   * El `auto` previo es necesario: sin él, `scrollHeight` nunca baja de la
   * altura que ya tiene el campo, y borrar líneas dejaría un hueco.
   *
   * Al borde hay que sumarlo aparte. Con `box-sizing: border-box` la altura que
   * se fija lo incluye, pero `scrollHeight` no, así que asignar `scrollHeight`
   * a secas deja el contenido dos píxeles corto y el campo se desplaza.
   */
  const autosize = (): void => {
    editor.style.height = 'auto';
    const border = editor.offsetHeight - editor.clientHeight;
    editor.style.height = `${editor.scrollHeight + border}px`;
  };

  autosize();

  type FormatAction = (
    | { label: string; title: string; marker: string }
    | { label: string; title: string; prefix: '> ' }
    | { icon: IconName; title: string; link: 'internal' | 'external' }
  ) & { className?: string };
  const formatActions: FormatAction[] = [
    { label: 'B', title: 'negrita', marker: '**' },
    { label: 'I', title: 'cursiva', marker: '*', className: 'format-italic' },
    { label: 'S', title: 'tachado', marker: '~~', className: 'format-strike' },
    { label: 'U', title: 'subrayado', marker: '++', className: 'format-underline' },
    { label: 'X²', title: 'superíndice', marker: '^', className: 'format-superscript' },
    { label: 'X₂', title: 'subíndice', marker: '~', className: 'format-subscript' },
    { label: '❝', title: 'cita', prefix: '> ' },
    { label: '</>', title: 'código en línea', marker: '`' },
    { icon: 'brackets', title: 'enlace interno', link: 'internal' },
    { icon: 'external-link', title: 'enlace externo', link: 'external' },
  ];
  const applyFormat = (formatted: ReturnType<typeof resolveFormat>): void => {
    editor.value = formatted.buffer;
    editor.setSelectionRange(formatted.selectionStart, formatted.selectionEnd);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.focus();
  };

  for (const action of formatActions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `format-action${action.className === undefined ? '' : ` ${action.className}`}`;
    if ('icon' in action) button.innerHTML = icon(action.icon);
    else button.textContent = action.label;
    button.title = action.title;
    button.setAttribute('aria-label', action.title);
    // Mantener la selección del textarea es parte del gesto de formato.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const formatted = 'marker' in action
        ? resolveFormat(action.marker, editor.value, editor.selectionStart, editor.selectionEnd)
        : 'prefix' in action
          ? resolveBlockFormat(action.prefix, editor.value)
          : action.link === 'internal'
            ? resolveInternalLink(editor.value, editor.selectionStart, editor.selectionEnd)
            : resolveLink(editor.value, editor.selectionStart, editor.selectionEnd);
      applyFormat(formatted);
    });
    formatBar.append(button);
  }

  const headings = document.createElement('div');
  headings.className = 'format-heading';
  const headingButtons: HTMLButtonElement[] = [];
  const updateHeadingState = (): void => {
    const level = /^#{1,6} /.exec(editor.value)?.[0].trim().length ?? 0;
    for (const [index, button] of headingButtons.entries()) {
      button.setAttribute('aria-pressed', String(level === index + 1));
    }
  };
  const chooseHeading = (
    prefix: '# ' | '## ' | '### ' | '#### ' | '##### ' | '###### ',
  ): void => {
    applyFormat(resolveBlockFormat(prefix, editor.value));
    updateHeadingState();
  };
  const headingMain = document.createElement('button');
  headingMain.type = 'button';
  headingMain.className = 'format-action format-heading-main';
  headingMain.textContent = 'H₁';
  headingMain.title = 'encabezado de nivel 1';
  headingMain.setAttribute('aria-label', 'encabezado de nivel 1');
  headingMain.addEventListener('mousedown', (event) => event.preventDefault());
  headingMain.addEventListener('click', () => chooseHeading('# '));
  headingButtons.push(headingMain);

  const headingChoices = document.createElement('details');
  headingChoices.className = 'format-heading-choices';
  const headingToggle = document.createElement('summary');
  headingToggle.className = 'format-action format-heading-toggle';
  headingToggle.innerHTML = icon('chevron-down');
  headingToggle.title = 'otros niveles de encabezado';
  headingToggle.setAttribute('aria-label', 'otros niveles de encabezado');
  headingToggle.addEventListener('mousedown', (event) => event.preventDefault());
  const headingMenu = document.createElement('div');
  headingMenu.className = 'format-heading-menu';
  const headingLevels = ['## ', '### ', '#### ', '##### ', '###### '] as const;
  for (const [index, prefix] of headingLevels.entries()) {
    const heading = document.createElement('button');
    heading.type = 'button';
    heading.className = 'format-heading-option';
    heading.textContent = `H${index + 2}`;
    heading.setAttribute('aria-label', `encabezado de nivel ${index + 2}`);
    heading.addEventListener('mousedown', (event) => event.preventDefault());
    heading.addEventListener('click', () => {
      headingChoices.removeAttribute('open');
      chooseHeading(prefix);
    });
    headingButtons.push(heading);
    headingMenu.append(heading);
  }
  headingChoices.append(headingToggle, headingMenu);
  headings.append(headingMain, headingChoices);
  updateHeadingState();
  formatBar.prepend(headings);

  const requested = typeof placement === 'number' ? placement : placement.start;
  const at = Math.min(requested, editor.value.length);
  /*
   * El foco no desplaza; desplazar es cosa nuestra.
   *
   * El navegador, al enfocar, trae el campo a la vista por su cuenta y por su
   * criterio: el borde más cercano. En un bloque más alto que la ventana eso
   * deja el cursor justo donde no está, y además da un salto antes del nuestro.
   * Con `preventScroll` hay un solo movimiento y lo decide `keepCaretInSight`.
   */
  editor.focus({ preventScroll: true });
  if (typeof placement === 'number') editor.setSelectionRange(at, at);
  else {
    editor.setSelectionRange(
      Math.min(placement.start, editor.value.length),
      Math.min(placement.end, editor.value.length),
    );
  }
  keepCaretInSight(editor, typeof placement === 'number'
    ? at
    : Math.min(placement.end, editor.value.length));

  /** Volver a la vista de lectura, conservando la grabación por el mismo motivo. */
  const render = (content: string): void => {
    body.classList.remove('editing');
    const heldAudio = body.querySelector('.audio-block');
    body.innerHTML = '';
    if (heldAudio !== null) body.append(heldAudio);

    // El mismo envoltorio que usa el dibujo inicial. Antes esto escribía el
    // markdown directamente en `body`, así que un bloque recién editado tenía
    // una estructura distinta de la de su vecino y el audio no habría tenido
    // dónde volver.
    const text = document.createElement('div');
    text.className = 'body-text';
    text.innerHTML = renderMarkdown(content, options);
    decorateCodeBlocks(text);
    text.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a');
      if (link === null || link.classList.contains('media-file')) return;
      const destination = link.getAttribute('href') ?? '';
      if (!destination.startsWith('../assets/')) return;

      // Una referencia de archivo pegada a mano todavía no venía resuelta en
      // la PageView con que nació este editor. Dejar actuar al navegador la
      // interpreta como ruta de Vera y, peor, hace competir la navegación con
      // el guardado provocado por blur. Este clic primero asienta el texto,
      // después consulta el catálogo y sólo entonces abre el objeto.
      event.preventDefault();
      void (async () => {
        window.clearTimeout(timer);
        const saved = await flush(session.leave());
        if (!saved) return;
        let catalogue: CatalogAsset[];
        try {
          catalogue = await api.media();
        } catch {
          toast('el bloque quedó guardado, pero no se pudo abrir el archivo');
          return;
        }
        let decoded = destination;
        try { decoded = decodeURIComponent(destination); } catch { /* conserva la grafía original */ }
        const asset = catalogue.find((one) => one.path === destination || one.path === decoded);
        if (asset === undefined) {
          toast('el bloque quedó guardado, pero Vera no encontró ese archivo');
          return;
        }
        if (!context.view.assets.some((one) => one.path === asset.path)) context.view.assets.push(asset);
        render(session.saved());
        openMediaDetails(asset);
      })();
    });
    body.append(text);

    // Editada la pregunta, se vuelve a preguntar. Es lo mismo que hace el
    // dibujado inicial: la respuesta no vive en ninguna parte, así que no hay
    // nada que invalidar —sólo hay que volver a pedirla.
    if (looksLikeQuery(content)) {
      answerQueryBlock(body, content, {
        onNavigate: callbacks.onNavigate,
        onEditBlock: (block, nextContent) =>
          submitQuietly({ kind: 'edit_block', block, content: nextContent }).then((applied) => {
            if (applied) callbacks.onReload(null);
            return applied;
          }),
      });
    }

    markMissingImages(body);
    void renderMermaid(body);
  };

  let timer: number | undefined;
  let composing = false;
  // Abrir un selector de archivos quita el foco del textarea, pero no significa
  // que Herbert haya terminado de editar: el archivo elegido todavía tiene que
  // caer exactamente en ese bloque. Mientras el selector está abierto, ese blur
  // pertenece al gesto de adjuntar y no debe cerrar la edición.
  let choosingAttachment = false;
  // Una salida estructural no vuelve a dibujar aquí: la página se recarga entera
  // y sería dibujar algo que está a punto de desaparecer.
  let leaving = false;

  const flush = async (intent: SaveIntent): Promise<boolean> => {
    if (intent.action === 'nada') return true;

    let result;
    try {
      result = await api.submit({
        kind: 'edit_block',
        block: block.stableId,
        content: intent.content,
      });
    } catch {
      // Sin red no se pierde lo escrito: sigue pendiente y el siguiente intento
      // —otra pausa, o salir del bloque— vuelve a mandarlo.
      session.failed();
      editor.classList.add('failed');
      editor.title = 'no se pudo guardar: sin conexión con el servidor';
      return false;
    }

    if (result.status === 'rejected') {
      toast(`rechazado: ${result.reason}`);
      return false;
    }

    const before = block.content;
    session.settled(intent.content);
    block.content = intent.content;
    editor.classList.remove('failed');
    editor.removeAttribute('title');
    callbacks.onChanged(before, intent.content);
    return true;
  };

  /** @invariant TypingIsNeverLost: el texto baja al grafo mientras se escribe. */
  const scheduleSave = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void flush(session.pending()), EDITING_PAUSE);
  };

  const leave = (): void => {
    if (leaving) return;
    leaving = true;
    window.clearTimeout(timer);
    void flush(session.leave()).then(() => render(session.saved()));
  };

  /** Una tecla estructural guarda lo pendiente antes de cambiar el árbol. */
  const structural = (outcome: KeyOutcome): void => {
    if (outcome.kind === 'ninguno') return;
    leaving = true;
    window.clearTimeout(timer);
    void flush(session.pending()).then(() => {
      if (outcome.kind === 'rechazo') {
        // Un rechazo no cambia nada, así que se vuelve a la edición.
        leaving = false;
        toast(outcome.reason);
        return;
      }
      void perform(outcome, {
        page: context.page,
        block,
        near: context.near,
        children: context.children,
        callbacks,
      });
    });
  };

  // --- Autocompletado -------------------------------------------------------
  //
  // @invariant AutocompleteOwnsItsKeys: mientras hay uno abierto, las teclas que
  // lo recorren le pertenecen. Es lo que permite que Tab indente un bloque y
  // elija una entrada sin ambigüedad.

  let open: Open | null = null;
  let candidates: Candidate[] = [];
  let highlighted = 0;
  let list: HTMLElement | null = null;
  let queryTurn = 0;

  const closeList = (): void => {
    list?.remove();
    list = null;
    open = null;
    candidates = [];
    highlighted = 0;
  };

  const drawList = (): void => {
    if (candidates.length === 0) {
      list?.remove();
      list = null;
      return;
    }
    if (list === null) {
      list = document.createElement('div');
      list.className = 'complete';
      list.setAttribute('role', 'listbox');
      document.body.append(list);
    }
    list.innerHTML = '';
    for (const [at, candidate] of candidates.entries()) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = at === highlighted ? 'complete-item selected' : 'complete-item';
      item.setAttribute('role', 'option');
      const label = document.createElement('span');
      label.textContent = candidate.label;
      item.append(label);
      if (candidate.hint !== undefined) {
        const hint = document.createElement('span');
        hint.className = 'complete-hint';
        hint.textContent = candidate.hint;
        item.append(hint);
      }
      // `mousedown` y no `click`: el clic llegaría después del blur, que ya
      // habría cerrado la lista y salido del bloque.
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        accept(at);
      });
      list.append(item);
    }

    // Cabe en la ventana o no sirve, igual que el menú de un bloque: el editor
    // puede estar pegado al borde derecho o al pie, y la lista se salía.
    placeNear(list, editor, { gap: 2, alignRight: false });
  };

  const accept = (at: number): void => {
    const chosen = candidates[at];
    if (open === null || chosen === undefined) return;
    const acts = open.trigger === 'comando' ? actionOf(chosen.value) : undefined;
    const applied = completionFor(open, chosen.value, editor.value, editor.selectionStart);
    editor.value = applied.buffer;
    editor.setSelectionRange(applied.cursor, applied.cursor);
    session.type(editor.value);
    closeList();
    autosize();

    // Hablar no es escribir: el comando desaparece del texto y lo que ocurre
    // ocurre en el grafo. Lo que quedara escrito se guarda antes, porque la
    // grabación necesita un bloque vacío que le guarde el lugar.
    if (acts === 'hablar') {
      void callbacks.onSpeak?.(block.stableId, editor.value.trim());
      return;
    }

    // La barra ya pertenece al bloque que se está editando. `/formato` sólo la
    // nombra y devuelve el foco al texto; no inventa una segunda interfaz.
    if (acts === 'formato') {
      scheduleSave();
      editor.focus();
      return;
    }

    /*
     * Importar tampoco escribe aquí: trae una página y lleva a ella.
     *
     * El selector de archivos tiene que abrirse dentro del gesto que lo pidió, o
     * el navegador lo bloquea por venir de nadie. Por eso se abre ya y se espera
     * después, y no al revés.
     *
     * @guarantee TheImportedPageOpensAtOnce: al terminar se va a la página nueva.
     * Importar y luego tener que ir a buscar dónde quedó lo importado son dos
     * actos donde debería haber uno.
     */
    if (acts === 'importar') {
      const chooser = document.createElement('input');
      chooser.type = 'file';
      chooser.accept = '.md,.markdown,.txt,.docx,text/markdown,text/plain';
      chooser.style.display = 'none';
      document.body.append(chooser);
      chooser.addEventListener('change', () => {
        const file = chooser.files?.[0];
        chooser.remove();
        if (file === undefined) return;
        toast(`trayendo ${file.name}…`);
        void api.importDocument(file).then((brought) => {
          if ('error' in brought) {
            toast(brought.error);
            return;
          }
          // @guarantee WhatWasLostIsSaidOnArrival: si algo no se supo traer se
          // dice al llegar y en palabras, no semanas después al echarlo de menos.
          const missing = brought.losses.length === 0 ? '' : ` · ${brought.losses.join('; ')}`;
          toast(`${brought.title}: ${brought.blocks} bloques${missing}`);
          callbacks.onNavigate(brought.title);
        });
      });
      chooser.click();
      return;
    }

    if (acts === 'adjuntar') {
      const chooser = document.createElement('input');
      chooser.type = 'file';
      chooser.multiple = true;
      chooser.accept = 'image/*,audio/*,application/pdf';
      chooser.style.display = 'none';
      document.body.append(chooser);
      choosingAttachment = true;
      const finishChoosing = (): void => {
        choosingAttachment = false;
        chooser.remove();
        editor.focus();
      };
      chooser.addEventListener('change', () => {
        const files = admissibleFiles(chooser.files);
        finishChoosing();
        if (files.length > 0) void attach(files);
      });
      // `cancel` existe en los navegadores actuales y evita dejar la edición en
      // un limbo cuando se cierra el selector sin elegir nada.
      chooser.addEventListener('cancel', finishChoosing);
      chooser.click();
      return;
    }

    /*
     * Dibujar no escribe aquí: abre el lienzo y lo que salga es el bloque.
     *
     * El bloque entero, y no lo dibujado detrás de lo que hubiera escrito: los
     * trazos son el texto de un bloque de dibujo, así que un dibujo y una frase
     * no caben en el mismo. Lo que estuviera a medio escribir se queda donde
     * está y el dibujo nace en un bloque nuevo debajo.
     */
    if (acts === 'dibujar') {
      const written = editor.value.replace(/\/dibujo\s*$/, '').trimEnd();
      void drawInto(block.stableId, context.page, written, callbacks, toast);
      return;
    }

    /*
     * Citar de la bibliografía. Como el calendario: el sitio donde cae lo
     * elegido se guarda ahora, porque entre abrir el buscador y elegir un ítem
     * pasa tiempo y el cursor puede haberse ido a otra parte.
     */
    if (acts === 'zotero') {
      const at = applied.cursor;
      void pickBibliography(editor, toast, (picked) => {
        const written = `[[${picked.title}]]`;
        editor.value = editor.value.slice(0, at) + written + editor.value.slice(at);
        const after = at + written.length;
        editor.setSelectionRange(after, after);
        session.type(editor.value);
        autosize();
        scheduleSave();
        editor.focus();
      });
      return;
    }

    // Fechar algo es enlazarlo al día. El comando ya se borró a sí mismo, así
    // que lo elegido cae donde estaba escribiéndose. El sitio se guarda ahora y
    // no se vuelve a leer después: entre abrir el calendario y elegir un día
    // pasa tiempo, y el cursor puede haberse ido a otra parte.
    if (acts === 'elegir-fecha') {
      const at = applied.cursor;
      pickDate(editor, (date) => {
        const written = `[[${date}]]`;
        editor.value = editor.value.slice(0, at) + written + editor.value.slice(at);
        const after = at + written.length;
        editor.setSelectionRange(after, after);
        session.type(editor.value);
        autosize();
        scheduleSave();
        editor.focus();
      });
      return;
    }

    /*
     * El plazo se elige en el calendario y se escribe como propiedad del bloque.
     *
     * No en el texto: la marca dice en qué estado está y el texto dice qué es, y
     * meter además la fecha ahí obligaría a leer la línea con tres gramáticas a
     * la vez. Como propiedad es lo que Logseq ya escribía y lo que el corpus ya
     * trae. @invariant DueIsALinkToTheDay: el valor es un día, que es una página.
     */
    if (acts === 'poner-plazo') {
      pickDate(editor, (date) => {
        void submitQuietly({
          kind: 'set_property',
          block: block.stableId,
          propertyKey: DEADLINE_KEY,
          propertyValue: date,
        }).then((applied) => {
          if (applied) callbacks.onReload(null);
        });
      });
      return;
    }

    scheduleSave();
    editor.focus();
  };

  const refreshList = (): void => {
    const cursor = editor.selectionStart;
    if (open === null) open = detectTrigger(editor.value, cursor);
    if (open === null) {
      closeList();
      return;
    }

    const query = queryOf(open, editor.value, cursor);
    if (query === null) {
      closeList();
      return;
    }

    // Cada búsqueda lleva turno: una respuesta lenta no pisa a una más reciente.
    queryTurn += 1;
    const turn = queryTurn;
    void candidatesFor(open, query, callbacks.pageTitles?.() ?? []).then((found) => {
      if (turn !== queryTurn || open === null) return;
      candidates = found;
      highlighted = 0;
      drawList();
    });
  };

  async function attach(files: File[]): Promise<void> {
    for (const file of files) {
      toast(`guardando ${file.name || 'archivo'}…`);
      const uploaded = await api.uploadMedia(file);
      if ('error' in uploaded) {
        toast(uploaded.error);
        continue;
      }
      if (!context.view.assets.some((asset) => asset.path === uploaded.path)) context.view.assets.push(uploaded);
      const label = file.name || 'archivo';
      // Conserva el nombre humano en el almacén, pero escribe un destino
      // Markdown inequívoco. El resolvedor decodifica esta forma al presentar.
      const destination = uploaded.path.replace(/ /g, '%20');
      const markdown = uploaded.mediaType.startsWith('image/')
        ? `![${label}](${destination})`
        : `[${label}](${destination})`;
      const from = editor.selectionStart;
      const to = editor.selectionEnd;
      const separated =
        (from > 0 && !/\s$/.test(editor.value.slice(0, from)) ? '\n' : '') +
        markdown +
        (to < editor.value.length && !/^\s/.test(editor.value.slice(to)) ? '\n' : '');
      editor.setRangeText(separated, from, to, 'end');
      session.type(editor.value);
      autosize();
      // No se difiere: el selector ya produjo un archivo y la referencia es el
      // resultado de ese mismo gesto. Así no puede perderse por un blur o una
      // navegación inmediatamente posteriores a la subida.
      window.clearTimeout(timer);
      const inserted = await flush(session.pending());
      if (!inserted) {
        toast(`no se pudo incorporar ${label} al bloque`);
        continue;
      }
      toast(`adjuntado: ${label}`);
      openMediaDetails(uploaded);
    }
    if (!document.querySelector('dialog.media-metadata[open]')) editor.focus();
  }

  const admissibleFiles = (files: FileList | null): File[] =>
    [...(files ?? [])].filter(
      (file) =>
        file.type.startsWith('image/') ||
        file.type.startsWith('audio/') ||
        file.type === 'application/pdf' ||
        /\.(?:avif|gif|jpe?g|png|svg|webp|aac|flac|m4a|mp3|oga|ogg|opus|wav|webm|pdf)$/i.test(file.name),
    );

  editor.addEventListener('paste', (event) => {
    const files = admissibleFiles(event.clipboardData?.files ?? null);
    if (files.length > 0) {
      event.preventDefault();
      void attach(files);
      return;
    }

    const outline = parseOutlineClipboard(event.clipboardData?.getData('text/plain') ?? '');
    if (outline === null) return;
    event.preventDefault();

    void (async () => {
      const head = editor.value.slice(0, editor.selectionStart);
      const tail = editor.value.slice(editor.selectionEnd);
      const firstContent = `${head}${outline[0]?.content ?? ''}${tail}`;
      const edited = await api.submit({
        kind: 'edit_block',
        block: block.stableId,
        content: firstContent,
      });
      if (edited.status === 'rejected') {
        toast(`no se pudo pegar: ${edited.reason}`);
        return;
      }

      const parentAtDepth: string[] = [block.stableId];
      const nextPosition = new Map<string | null, number>([
        [context.near.parent, context.near.index + 1],
        [block.stableId, context.children.length],
      ]);
      let lastCreated = block.stableId;

      for (const item of outline.slice(1)) {
        const parent = item.depth === 0 ? context.near.parent : parentAtDepth[item.depth - 1] ?? null;
        if (item.depth > 0 && parent === null) {
          toast('no se pudo pegar: la jerarquía no tiene padre');
          return;
        }
        const position = nextPosition.get(parent) ?? 0;
        const created = await api.submit({
          kind: 'create_block',
          page: context.page,
          parent,
          position,
          content: item.content,
        });
        if (created.status === 'rejected') {
          toast(`pegado incompleto: ${created.reason}`);
          callbacks.onReload(null);
          return;
        }
        nextPosition.set(parent, position + 1);
        nextPosition.set(created.subjectId, 0);
        parentAtDepth[item.depth] = created.subjectId;
        parentAtDepth.length = item.depth + 1;
        lastCreated = created.subjectId;
      }
      callbacks.onReload({ block: lastCreated, at: Number.MAX_SAFE_INTEGER });
    })().catch(() => toast('no se pudo pegar: sin conexión con el servidor'));
  });

  editor.addEventListener('dragover', (event) => {
    if (admissibleFiles(event.dataTransfer?.files ?? null).length > 0) event.preventDefault();
  });

  editor.addEventListener('drop', (event) => {
    const files = admissibleFiles(event.dataTransfer?.files ?? null);
    if (files.length === 0) return;
    event.preventDefault();
    void attach(files);
  });

  editor.addEventListener('compositionstart', () => {
    composing = true;
  });

  editor.addEventListener('compositionend', () => {
    composing = false;
    session.type(editor.value);
    autosize();
    keepCaretInSight(editor, editor.selectionStart);
    scheduleSave();
    refreshList();
  });

  editor.addEventListener('input', (event) => {
    session.type(editor.value);
    autosize();
    // El campo acaba de crecer o menguar, así que la línea en la que se escribe
    // se movió con él. @invariant WhatIsBeingWrittenStaysInSight.
    keepCaretInSight(editor, editor.selectionStart);
    if (composing || (event instanceof InputEvent && event.isComposing)) return;
    scheduleSave();
    refreshList();
  });

  /*
   * Y también cuando el cursor se mueve sin escribir nada.
   *
   * Bajar con la flecha por un bloque largo lo saca de la vista igual que
   * escribir, y aquí no hay `input` que lo avise. Se mira al soltar la tecla:
   * al pulsarla el cursor todavía no ha llegado a donde va.
   */
  editor.addEventListener('keyup', (event) => {
    if (!MOVES_CARET.has(event.key)) return;
    keepCaretInSight(editor, editor.selectionStart);
  });

  editor.addEventListener('select', () => {
    keepCaretInSight(editor, editor.selectionDirection === 'backward'
      ? editor.selectionStart
      : editor.selectionEnd);
  });

  editor.addEventListener('blur', () => {
    closeList();
    if (choosingAttachment) return;
    leave();
  });

  editor.addEventListener('keydown', (event) => {
    if (isTextComposing(event)) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;

    if (is('bold', event) || is('italic', event)) {
      event.preventDefault();
      const formatted = resolveFormat(is('bold', event) ? '**' : '*', editor.value, start, end);
      editor.value = formatted.buffer;
      editor.setSelectionRange(formatted.selectionStart, formatted.selectionEnd);
      session.type(editor.value);
      autosize();
      scheduleSave();
      return;
    }

    // Con una lista abierta, estas teclas son suyas. Sin esto, Enter partiría el
    // bloque en mitad de una búsqueda y Tab lo indentaría.
    if (list !== null && candidates.length > 0) {
      if (is('complete-move', event)) {
        event.preventDefault();
        const paso = event.key === 'ArrowDown' ? 1 : -1;
        highlighted = (highlighted + paso + candidates.length) % candidates.length;
        drawList();
        return;
      }
      if (is('complete-accept', event)) {
        event.preventDefault();
        accept(highlighted);
        return;
      }
      if (is('complete-close', event)) {
        // La primera pulsación cierra la lista; la segunda ya sale del bloque.
        event.preventDefault();
        closeList();
        return;
      }
    }

    // Escape sale guardando. No descarta: para cuando se pulsa, la pausa ya dejó
    // el texto en el grafo, y ofrecer descartar sería mentir.
    if (is('leave', event)) {
      event.preventDefault();
      editor.blur();
      return;
    }

    if (is('split', event)) {
      event.preventDefault();
      session.type(editor.value);
      structural(resolveEnter(editor.value, start, end, context.near));
      return;
    }

    // Shift-Enter escribe un salto de línea dentro del bloque, que es la única
    // forma de tener un párrafo de varias líneas en un solo bloque.
    if (is('leave-cmd', event)) {
      event.preventDefault();
      editor.blur();
      return;
    }

    if (is('indent', event) || is('outdent', event)) {
      event.preventDefault();
      session.type(editor.value);
      structural(resolveTab(is('indent', event), context.near));
      return;
    }

    if (is('merge', event) && start === 0 && end === 0) {
      event.preventDefault();
      session.type(editor.value);
      structural(resolveBackspaceAtStart(editor.value, context.near));
      return;
    }

    if (is('up', event) || is('down', event)) {
      const outcome = resolveArrow(is('up', event), editor.value, start, context.near);
      if (outcome.kind === 'ninguno') return;
      event.preventDefault();
      session.type(editor.value);
      structural(outcome);
      return;
    }

    // Autopar. Se hace a mano porque hay que decidir entre envolver, emparejar y
    // saltar el cierre, y ninguna de las tres es lo que el navegador haría.
    const typed = resolveDelimiter(event.key, editor.value, start, end);
    if (typed !== null) {
      event.preventDefault();
      editor.value = typed.buffer;
      editor.setSelectionRange(typed.cursor, typed.cursor);
      session.type(editor.value);
      autosize();
      scheduleSave();
      // El autopar se come su propia tecla, así que aquí no llega ningún evento
      // `input` y nadie mira el disparador. Y el único instante en que `[[`
      // queda a la izquierda del cursor es exactamente éste: si pasa sin que se
      // consulte, ya no vuelve, porque a la siguiente letra el texto de delante
      // deja de terminar en el disparador. Por eso `[[` no completaba nada.
      refreshList();
    }
  });
}
