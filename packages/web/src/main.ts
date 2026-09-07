// El espacio de trabajo de Vera.
//
// Texto y grafo comparten página activa e historial, así que cambiar de
// disposición no pierde el lugar en el grafo (@guarantee NavigableGraphContext).

import './styles.css';
import './executable-frames.ts';

import {
  api,
  onSubmissionActivity,
  type CorpusHealth,
  type Hit,
  type PageSummary,
  type PageView,
} from './api.ts';
import { heldHere, holdsNothing, type Held } from './held.ts';
import { countInto, type Counting } from './waiting.ts';
import {
  applyLocally,
  blockPropertiesOf,
  blocksOf,
  pagePropertiesOf,
  seed,
  type Replica,
} from './replica.ts';
import { createOutbox, durableOrNot, inOrder, type Outbox } from './outbox.ts';
import {
  allowEmbedsFrom,
  foldsWhileRevealing,
  nameProperties,
  renderOutliner,
  speakInto,
  type OutlinerCallbacks,
} from './outliner.ts';
import { holdViewport as holdTextViewport, restoreViewport as restoreTextViewport } from './viewport.ts';
import { onRecording } from './audio-block.ts';
import { isDay, today } from './autocomplete.ts';
import { GOVERNING_KINDS } from './governing-table.ts';
import { renderFilesAdministration, renderSettings, renderSharingAdministration, type Section } from './settings.ts';
import { parseRoute, routeTo, searchRoute } from './router.ts';
import { voice } from './voice.ts';
import { brandMark, icon, type IconName } from './icons.ts';
import { is } from './bindings.ts';
import { pageSearchResults } from './search-results.ts';
import { createPage } from './pages.ts';
import { changesGraphMeaning } from './invalidation.ts';
import { sameReadablePage } from './page-validation.ts';
import { behind, disagreements, said, type Behind } from './behind.ts';
import { applyResolutions, askAboutDisagreements } from './reconcile.ts';
import { forgetPositions, renderGraph, selectNode, type ThreadSettings } from './graph/render.ts';
import { renderGraph3D, cleanupGraph3D, forgetCamera, selectNode3D } from './graph/render3d.ts';
import { renderGraphD4 } from './graph/renderD4.ts';
import { journalsInMap } from './graph/journals.ts';
import {
  applyTokens,
  loadTokens,
  saveTokens,
  session,
  syncPresentation,
  type ColourScheme,
  type GraphViewMode,
  type WorkspaceLayout,
} from './tokens.ts';
import {
  clearTrace,
  dropped,
  loadTrace,
  movedTo,
  pagesOf,
  saveTrace,
  walked,
  type NavigationGesture,
  type TraceStep,
} from './trace.ts';
import {
  TESTIMONY_KEY,
  blocksFor,
  fillTraceCrossings,
  provisionalTitle,
  seedTrail,
} from './promote.ts';
import { renderMarkdown } from '@vera/core';
import { handlesSharedAccess } from './shared-access.ts';

const PHONE = 640;

interface Workspace {
  activePage: string | null;
  layout: WorkspaceLayout;
  graphView: GraphViewMode;
  /** Qué parte del grafo mira el dueño; no cambia quién es ni qué puede hacer. */
  mapScope: 'own_space' | 'published';
  /** Bloque en el que está enraizada la vista, o null para la página entera. */
  focusRoot: string | null;
  scheme: ColourScheme;
  divider: number;
  /**
   * El rastro: por dónde se ha pasado, y cómo. Llegadas y no páginas — ver
   * trace.ts. @guarantee TheTraceRemembersHowAndNotOnlyWhere.
   */
  trace: TraceStep[];
  depth: number;
  /** Si el diario que ocupa el foco puede aparecer en el mapa. */
  graphJournals: boolean;
}

const workspace: Workspace = {
  activePage: null,
  layout: session.layout(),
  graphView: session.graphView(),
  mapScope: 'own_space',
  focusRoot: null,
  scheme: session.scheme(),
  divider: session.divider(),
  trace: loadTrace(),
  depth: session.reach(),
  graphJournals: session.graphJournals(),
};

/**
 * Si el menú del mapa está abierto ahora mismo.
 *
 * No se recuerda entre visitas, y ese es el punto: un menú es transitorio. Se
 * guardaba, así que quien lo hubiera abierto una vez lo encontraba abierto para
 * siempre —tapando el mapa— y el ojo dejaba de tener nada que desplegar. Un menú
 * que persiste abierto no es un menú, es un panel.
 */
let mapPanelOpen = false;

let tokens = loadTokens();
let pages: PageSummary[] = [];

/** La apertura vigente; una respuesta tardía de la anterior no puede tocarla. */
let opening = 0;
/** La entrega que sigue siendo útil; navegar abandona de inmediato la anterior. */
let pageDelivery: AbortController | null = null;

/**
 * Lo que la barra dice cuando no está mandando nada.
 *
 * Vive fuera de `wireSubmissionState` porque quien lo escribe es la puesta al día
 * y quien lo pinta es la barra, y son dos cosas que ocurren en momentos distintos.
 */
let announcing: { state: string; message: string; title: string } | null = null;

/** Repinta la barra. Lo instala `wireSubmissionState`, que es quien tiene el nodo. */
let paintSync: () => void = () => {};

function wireSubmissionState(): void {
  const indicator = $('#sync-state');
  const pending = new Set<string>();
  /** Los que ya están aplicados aquí, para no llamar espera a lo que no lo es. */
  const here = new Set<string>();
  let clearTimer: number | undefined;

  /*
   * El mismo sitio dice dos cosas, y hay que repartirlo.
   *
   * Lo que este aparato está mandando es efímero y se apaga solo; lo que espera a
   * ser traído no se apaga hasta que alguien lo trae. Mandar manda mientras dura, y
   * al terminar no se esconde la barra: se deja ver lo que esperaba debajo. Sin
   * esto, guardar una letra borraba el aviso de que el bibliotecario había reescrito la
   * página. @invariant WaitingWorkIsNeverReportedAsSynchronised.
   */
  paintSync = (): void => {
    if (announcing === null) {
      indicator.hidden = true;
      indicator.onclick = null;
      indicator.classList.remove('pressable');
      return;
    }
    indicator.dataset['state'] = announcing.state;
    indicator.textContent = announcing.message;
    indicator.title = announcing.title;
    indicator.hidden = false;
    indicator.classList.add('pressable');
    indicator.onclick = () => {
      if (takingNow) return;
      indicator.dataset['state'] = 'synchronising';
      indicator.textContent = 'trayendo…';
      indicator.onclick = null;
      void takeWaitingWork();
    };
  };

  const say = (state: string, message: string, title = ''): void => {
    indicator.dataset['state'] = state;
    indicator.textContent = message;
    indicator.title = title;
    indicator.hidden = false;
    // Mientras algo se manda, la barra no es un botón: pulsarla traería el corpus
    // encima de lo que todavía está saliendo.
    indicator.onclick = null;
    indicator.classList.remove('pressable');
  };

  onSubmissionActivity((activity) => {
    window.clearTimeout(clearTimer);

    /*
     * Aplicado en casa: hecho, y todavía sin viajar.
     *
     * No se dice «guardando», porque no se está esperando nada para poder
     * seguir; se dice que está aquí. Y no se dice «sincronizado», porque eso es
     * lo que dirá cuando el corpus lo confirme: está a salvo de cerrar la pestaña
     * —la bandeja es durable— y todavía no lo saben los demás aparatos.
     * @invariant SilenceNeverPretendsToBeSuccess.
     */
    /*
     * Y queda anotado que este origen salió de aquí.
     *
     * El registro canónico es uno solo, así que lo propio vuelve en la respuesta a
     * «¿qué ha pasado desde mi cursor?». Sin anotarlo, escribir una letra encendería
     * el aviso de que la página cambió — y tendría razón, y sería inútil.
     */
    void held.noteSent(activity.originId);

    if (activity.phase === 'local') {
      pending.add(activity.originId);
      here.add(activity.originId);
      say(
        'local',
        pending.size === 1 ? 'aquí' : `aquí · ${pending.size}`,
        'Aplicado en este aparato. Viajando al corpus.',
      );
      return;
    }

    /*
     * Que algo esté viajando no es una espera si ya está aplicado aquí.
     *
     * Decir «guardando…» sobre un cambio que ya ocurrió invita a esperar a que
     * termine algo que no hace falta esperar, y ése era justo el hábito que la
     * fase local-first viene a quitar. Sólo lo que no se pudo aplicar en casa
     * —crear una página, renombrarla— es una espera de verdad, y ésa se dice.
     */
    if (activity.phase === 'sending') {
      pending.add(activity.originId);
      if (here.has(activity.originId)) return;
      say('synchronising', pending.size === 1 ? 'guardando…' : `guardando ${pending.size}…`);
      return;
    }

    pending.delete(activity.originId);
    const wasLocal = here.delete(activity.originId);
    if (activity.phase === 'offline') {
      say(
        'offline',
        'sin conexión',
        wasLocal
          ? 'Aplicado y guardado en este aparato. Sale solo cuando vuelva la red, aunque se cierre.'
          : 'Lo escrito sigue en el editor, pero aún no está guardado.',
      );
      return;
    }
    if (activity.phase === 'rejected') {
      say('rejected', 'rechazado', activity.reason);
      return;
    }
    if (activity.phase === 'proposed') {
      say('proposed', 'en revisión', 'La propuesta fue enviada; el corpus no cambia hasta que sea aceptada.');
      clearTimer = window.setTimeout(() => { indicator.hidden = true; }, 5000);
      return;
    }
    if (pending.size > 0) {
      say('synchronising', `guardando ${pending.size}…`);
      return;
    }

    say('synchronised', 'sincronizado', `Confirmado por el servidor en ${Math.round(activity.durationMs)} ms`);
    clearTimer = window.setTimeout(paintSync, 1800);
  });
}
/** Cierra los ajustes. Vive aquí porque Memoria también necesita cerrarlos: una
 *  de sus entradas lleva a una página, y quedarse encima de ella no serviría. */
function closeSettings(): void {
  const panel = $('#tokens');
  panel.hidden = true;
  panel.innerHTML = '';
  document.body.classList.remove('settings-open');
}

/** Lo que el grafo tiene. Se pide al arrancar y se enseña en Memoria. */
let corpus: CorpusHealth | null = null;

const isAnybody = (): boolean => corpus?.access === 'anybody';
const isReadOnly = (): boolean => isAnybody() && corpus?.canEdit !== true && corpus?.canContribute !== true;

async function openHome(): Promise<void> {
  if (isAnybody() && corpus?.entryPoint != null) {
    await openPage(corpus.entryPoint);
    return;
  }
  await openToday();
}

/**
 * Lo que este aparato ya tenía guardado de lo leído.
 *
 * Empieza sin nada y se sustituye al arrancar por la de verdad, si la hay. Que
 * exista desde el principio es lo que permite llamarla sin preguntar antes si
 * está: la que no retiene nada contesta «no tengo» a todo.
 */
let held: Held = holdsNothing();

/** Si lo que está a la vista salió de ahí y no del corpus. */
let showingKept = false;

/**
 * Memoria: el estado del corpus y su índice.
 *
 * Vivía en un panel lateral permanente que gastaba 15rem de cada pantalla para
 * decir algo que se mira de vez en cuando. Ese ancho es ahora del mapa y del
 * texto, que es lo que se está haciendo cuando se usa Vera.
 */
function drawMemory(host: HTMLElement): void {
  const status = document.createElement('div');
  status.id = 'status';
  status.textContent =
    corpus === null
      ? 'todavía sin datos del grafo'
      : `${corpus.pages} páginas · ${corpus.blocks} bloques · secuencia ${corpus.lastSequence}`;
  host.append(status);

  /*
   * Aquí vivía «Voz sin lugar», y ya no.
   *
   * Listaba las grabaciones sin bloque para poder traerlas al día de hoy. El
   * problema no era la lista: era que ese estado pudiera existir. La clave ajena
   * declaraba `ON DELETE SET NULL`, así que borrar un bloque dejaba viva a su
   * grabación y sin sitio; y como nada en todo el repositorio borraba una
   * grabación, esa fila era permanente. Se borraba el bloque, reaparecía la voz,
   * se volvía a borrar, volvía a aparecer.
   *
   * Ahora la grabación se va con su bloque —ver removeRecording en el store— y
   * una voz sin lugar no puede nacer. Una pantalla que repara un estado
   * imposible es una pantalla que enseña a desconfiar del resto.
   */

  // Las páginas mediante las que Vera hace visible su gobierno.
  //
  // El listado de las doscientas más conectadas que había aquí era un índice de
  // todo, y un índice de todo no es un índice: para eso está el buscador, que
  // encuentra por lo que uno recuerda en vez de obligar a reconocer un título en
  // una lista. Lo que sí pertenece a Memoria es lo que decide cómo funciona esta
  // instancia.
  //
  // Se dibuja lo que el corpus declara, y no las clases que este archivo
  // enumere. @invariant SpecialityIsDeclaredNotGuessed: una página es especial
  // porque lo dice en una propiedad que cualquiera puede leer, y un panel que
  // sólo sabe enseñar tres clases escritas aquí convierte esa declaración en
  // decorado. Es lo que pasaba: «Propiedades», «Objetos» y «Zotero» gobiernan de
  // verdad —el servidor las lee en cada petición— y no aparecían en ninguna
  // parte, mientras el renglón de «Ontología» seguía diciendo que gobernaba los
  // tipos y las propiedades, que se habían mudado a esas dos páginas.
  //
  // Los nombres legibles de cada clase salen de `GOVERNING_KINDS`, que es de
  // donde los toma también la cabecera de esas páginas. Escritos dos veces
  // acabarían diciendo dos cosas.
  const KNOWN = GOVERNING_KINDS;

  const heading = document.createElement('h3');
  heading.className = 'settings-group';
  heading.textContent = 'Gobierno de Vera';
  host.append(heading);

  const explanation = document.createElement('p');
  explanation.className = 'settings-note';
  explanation.textContent = 'Distingue lo que rige el software de las superficies, proyecciones y documentos que sólo lo explican.';
  host.append(explanation);

  const special = document.createElement('div');
  special.id = 'special-pages';
  host.append(special);

  void api.specialPages().then((found) => {
    const row = (label: string, what: string): HTMLButtonElement => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'index-item';
      const name = document.createElement('span');
      name.textContent = label;
      const said = document.createElement('span');
      said.className = 'count';
      said.textContent = what;
      item.append(name, said);
      special.append(item);
      return item;
    };

    // Por el orden en que se leen, no por el orden en que el corpus las
    // devuelva: el vocabulario antes que lo que se declara con él, y las
    // conexiones al final. Lo que este cliente no conozca va después de todo.
    const rank = (kind: string): number => {
      const at = KNOWN.findIndex((one) => one.key === kind);
      return at === -1 ? KNOWN.length : at;
    };

    const declared = [...found].sort(
      (a, b) => rank(a.kind) - rank(b.kind) || a.title.localeCompare(b.title, 'es'),
    );

    for (const page of declared) {
      // Varias de una misma clase es normal y no un conflicto: un corpus puede
      // hablar con dos servicios. Se dibujan las que haya, cada una con su
      // título, que es lo que la distingue de la otra.
      const known = KNOWN.find((one) => one.key === page.kind);
      const item = row(
        page.title,
        known === undefined ? `clase no reconocida · ${page.kind}` : `${known.mode} · ${known.what}`,
      );
      item.addEventListener('click', () => {
        closeSettings();
        // Del menú: se llegó de fuera, sin que nada de lo leído lo explique.
        void openPage(page.id, null, { gesture: 'opened_directly' });
      });
    }

    /*
     * Y las que podrían gobernar y no gobiernan.
     *
     * Que falte no es un error: lo que la página diría tiene un valor por
     * defecto en el código —@invariant DefaultsLiveInTheCode—, y decirlo aquí es
     * la única forma de que alguien sepa que ese sitio existe y está libre.
     *
     * `service` no se ofrece: un corpus sin ninguna conexión no tiene un
     * servicio pendiente de escribir, tiene ninguno, y un renglón que invitara a
     * escribirlo estaría pidiendo una decisión que nadie tomó.
     */
    for (const kind of KNOWN) {
      if (kind.key === 'service') continue;
      if (found.some((page) => page.kind === kind.key)) continue;
      const item = row(`${kind.label} — sin definir`, `${kind.mode} · ${kind.what}`);
      item.title = `Todavía no hay una página especial de ${kind.label.toLowerCase()}. Su modo previsto es ${kind.mode}.`;
      item.disabled = true;
    }
  });
}

const $ = <T extends HTMLElement>(selector: string): T =>
  document.querySelector<T>(selector) as T;

const isPhone = (): boolean => window.innerWidth <= PHONE;

// ---------------------------------------------------------------------------
// Disposición
// ---------------------------------------------------------------------------

function applyLayout(): void {
  const root = $('#vera-root');
  // @invariant SinglePaneOnNarrowScreens: en un teléfono nunca hay vista dividida.
  const effective: WorkspaceLayout =
    isPhone() && workspace.layout === 'split' ? 'text_only' : workspace.layout;

  root.dataset['layout'] = effective;
  root.style.setProperty('--divider', String(workspace.divider));

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-layout]')) {
    const here = button.dataset['layout'] === workspace.layout;
    button.setAttribute('aria-pressed', String(here));
    // El switch marca su posición con la clase; `aria-pressed` sigue siendo lo
    // que se lee en voz alta.
    button.classList.toggle('selected', here);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset['view'] === workspace.graphView));
  }

  if (effective !== 'text_only') drawGraph();
  else cleanupGraph3D();
}

function setLayout(layout: WorkspaceLayout): void {
  workspace.layout = layout;
  session.setLayout(layout);
  applyLayout();
}

// ---------------------------------------------------------------------------
// El día de hoy
// ---------------------------------------------------------------------------

/** La página del día, si el día ya existe. */
function dayPage(date = today()): PageSummary | undefined {
  return pages.find((page) => page.title === date);
}

/**
 * Abre el día en curso.
 *
 * Si todavía no hay nada escrito hoy, no se crea nada: se enseña el día vacío y
 * la página nace con el primer bloque. Crearla al mirarla llenaría el corpus de
 * días en blanco —uno por cada vez que alguien abre Vera sin escribir— y un día
 * vacío no es un hecho sobre una vida, es un hecho sobre un calendario.
 *
 * @invariant ADayExistsBecauseSomethingArrived, de daily-log.allium.
 */
async function openToday(): Promise<void> {
  const date = today();
  const existing = dayPage(date);
  if (existing !== undefined) {
    await openPage(existing.id, null, { gesture: 'opened_directly' });
    return;
  }
  drawUnstartedDay(date);
}

/**
 * El día que aún no empieza.
 *
 * Un solo gesto, que es el que crea el día: escribir. Deliberadamente no hay más
 * que eso, porque la razón de que «hoy» sea el origen es no tener que decidir
 * nada antes de ponerse a escribir.
 */
function drawUnstartedDay(date: string): void {
  $('#vera-root').classList.remove('special-surface');
  workspace.activePage = null;
  // Todavía no hay página, pero sí hay sitio: el día que se está mirando. Dejar
  // sólo «Vera» aquí haría que la ventana perdiera el nombre justo al abrirla,
  // que es cuando más se está mirando la barra.
  nameWindow(date);
  const url = `/p/${encodeURIComponent(date)}`;
  if (window.location.pathname !== url) window.history.pushState({}, '', url);

  const host = $('#text');
  host.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'page-header';
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = date;
  header.append(title);
  host.append(header);

  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent = 'Hoy todavía no tiene nada. El día empieza a existir con lo primero que escribas.';
  host.append(note);

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'first-block';
  start.textContent = 'escribir';
  start.addEventListener('click', () => void startDay(date));
  host.append(start);

  drawGraph();
}

/**
 * Hace nacer el día y devuelve su primer bloque, listo para escribir.
 *
 * Es el único camino por el que un día entra en la base, y por eso lo usan tanto
 * el botón de escribir como la grabación de voz: hablar en el día también es
 * haber escrito en él.
 */
async function startDay(date: string, content = ''): Promise<string | null> {
  const existing = dayPage(date);
  let pageId = existing?.id ?? null;

  if (pageId === null) {
    const born = await createPage(date);
    if (born.status === 'rejected') {
      notice(`no se pudo abrir el día: ${born.reason}`);
      return null;
    }
    pageId = born.subjectId;
    // Un día es una bitácora, y lo dice desde que nace. Es lo que permite
    // preguntar por los días como clase —«qué escribí en julio»— sin que haya
    // que reconocer una fecha en un título, y lo que hace que un día importado
    // de otra parte y uno nacido aquí se parezcan.
    // Con qué palabras, lo dice el corpus: el papel es «la clase de una página»
    // y «un día», y cómo se llamen aquí no lo decide Vera.
    await api.submit({
      kind: 'set_property',
      page: pageId,
      propertyKey: corpus?.names?.kind ?? 'tipo',
      propertyValue: corpus?.names?.day ?? 'bitácora',
    });
    // El índice en memoria tiene que enterarse, o el día parecería no existir
    // hasta la próxima recarga.
    pages.unshift({ id: pageId, title: date, visibility: 'private', blockCount: 0, linkCount: 0 });
  }

  const block = await api.submit({
    kind: 'create_block',
    page: pageId,
    parent: null,
    position: Number.MAX_SAFE_INTEGER,
    content,
  });
  if (block.status === 'rejected') {
    notice(`no se pudo escribir en el día: ${block.reason}`);
    return null;
  }
  await openPage(pageId, { block: block.subjectId, at: 0 }, { gesture: 'opened_directly' });
  return block.subjectId;
}

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------

/**
 * Abre una página.
 *
 * `options.gesture` decide si esto es una navegación o un redibujado, y no hay
 * valor por defecto a propósito. @invariant RedrawingAPageIsNotWalkingToIt:
 * volver a dibujar la página en la que ya se está —porque se guardó algo, porque
 * cambió el foco— no es navegar y no deja paso en el rastro. Sin gesto, no hay
 * paso; con gesto, lo pone quien lo recibió y nadie lo deduce después.
 */
/**
 * Cómo se llama la ventana.
 *
 * Instalada como aplicación, Vera no tiene barra de direcciones: la única cosa
 * que dice dónde se está es el título de la ventana, y decía «Vera» siempre. Con
 * tres ventanas abiertas —el diario, una lectura y algo que se está escribiendo—
 * las tres se llamaban igual, en la barra de tareas y en el conmutador del
 * sistema, y no había forma de elegir sin abrirlas.
 *
 * El nombre de la aplicación va delante y el de la página detrás porque en un
 * conmutador los títulos se cortan por la derecha; al revés, todas empezarían
 * por «Vera» y volverían a ser indistinguibles justo donde importa.
 *
 * Sin página abierta, sólo el nombre: no hay nada más que decir todavía.
 */
function nameWindow(title: string | null): void {
  document.title = title === null || title.trim() === '' ? 'VERA' : `VERA — ${title}`;
}

/**
 * Cuánto se aguanta sin decir nada.
 *
 * Por debajo de esto, enseñar un hueco y quitarlo enseguida es un parpadeo que
 * molesta más que la espera. Por encima, el silencio se lee como que el clic no
 * entró.
 */
const PATIENCE = 300;

/**
 * El aviso: el título de lo que viene, en el sitio donde va a aparecer.
 *
 * No dice «espera» ni imita el contenido con rectángulos grises —un esqueleto
 * finge una página que todavía no existe—. Dice qué está cargando y dónde, que
 * es lo que uno quiere saber, y cuando llega el texto el título ya está puesto y
 * sólo se rellena debajo.
 *
 * Y debajo del título, cuánto lleva. Sin eso, una página que tarda cuatro
 * segundos se veía igual que una que tarda cuarenta, y el título atenuado y
 * quieto se lee, pasado un rato, como que la navegación se rompió. Devuelve la
 * cuenta para que quien pidió la página pueda cerrarla: una espera que sobrevive
 * a su trabajo es la peor mentira disponible.
 */
function awaiting(title: string | null, since: number): Counting {
  const text = $('#text');
  text.innerHTML = '';
  const holder = document.createElement('div');
  holder.className = 'page awaiting';
  const header = document.createElement('header');
  header.className = 'page-header';
  const heading = document.createElement('h1');
  heading.className = 'page-title';
  heading.textContent = title ?? 'abriendo…';
  const elapsed = document.createElement('span');
  elapsed.className = 'awaiting-elapsed';
  header.append(heading, elapsed);
  holder.append(header);
  text.append(holder);
  /*
   * Sin nombre para recordar.
   *
   * Una página de cuatro bloques y una de mil no son la misma espera, y guardar
   * las dos juntas haría que Vera prometiera una mediana que no describe a
   * ninguna. Se cuenta —que no puede equivocarse— y no se nombra. Ver waiting.ts.
   */
  return countInto(elapsed, '', null, { since });
}

/**
 * Decir de dónde salió lo que se está leyendo.
 *
 * Lo retenido y lo canónico se ven exactamente igual, y ésa es justo la razón por
 * la que hay que decirlo: quien lee sin red tiene que poder saber que lo que tiene
 * delante es de la última vez que hubo, y no lo que el corpus dice ahora.
 *
 * Va debajo del título, que es donde empieza la lectura, y no en el rincón del
 * estado: no es una noticia sobre la máquina, es una advertencia sobre el texto.
 */
/**
 * De dónde salió lo que se está leyendo. `replica.showing` de la spec.
 *
 * Se dice y no se deduce: quien lee tiene que poder saberlo, y «se ve igual» es
 * exactamente la razón por la que no puede.
 *
 * Dos textos y no uno, y la distinción es nueva. Antes leer de lo retenido sólo
 * pasaba sin red, así que el cartel decía «sin conexión con el corpus» y era cierto.
 * Ahora es el camino normal —rule ShowRetainedPageAtOnce— y decir eso con la red
 * puesta sería mentir sobre el estado de la máquina para explicar de dónde salió un
 * texto.
 */
function markShowing(
  text: HTMLElement,
  kept: boolean,
  validation: 'checking' | 'current' | 'divergent' | 'unreachable' = 'checking',
  recover?: () => void,
): void {
  text.querySelector('.page-kept')?.remove();
  if (!kept) return;
  const offline = !navigator.onLine;
  const said = document.createElement('p');
  said.className = `page-kept ${offline ? 'offline' : ''} ${validation}`.trim();
  if (offline || validation === 'unreachable') {
    said.textContent = 'copia de este aparato · no se pudo verificar con el corpus';
    said.title = 'Se puede seguir leyendo. Antes de escribir, conviene recuperar la conexión para comprobar que esta copia sigue vigente.';
    if (recover !== undefined) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'page-kept-recover';
      button.textContent = 'Recuperar desde el corpus';
      button.addEventListener('click', (event) => {
        // La cabecera y el outliner tienen gestos propios. Recuperar pertenece a
        // este control y no debe convertirse además en edición o navegación.
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        button.textContent = 'Recuperando…';
        recover();
      });
      said.append(' · ', button);
    }
  } else if (validation === 'divergent') {
    said.textContent = 'atención · esta copia difiere del corpus';
    said.title = 'Vera conservó lo que está en el editor y no lo sustituyó. Hay otra versión canónica que debe reconciliarse.';
  } else if (validation === 'current') {
    said.textContent = 'copia local verificada con el corpus';
    said.title = 'Esta página se abrió desde este aparato y Vera comprobó que coincide con la versión canónica.';
  } else {
    said.textContent = 'copia de este aparato · verificando con el corpus…';
    said.title = 'La página ya se puede leer. Vera está comprobando que esta copia retenida siga siendo la canónica.';
  }
  (text.querySelector('.page-header') ?? text.firstElementChild)?.append(said);
}

/**
 * Encontrar en el corpus la página de la que nació una copia retenida.
 *
 * La identidad local no siempre sobrevive a la escritura canónica: una página
 * puede quedar retenida mientras la operación que la crea recibe otra identidad
 * en el corpus. Repetir indefinidamente la consulta por el id viejo hacía que
 * «Recuperar» no recuperara nada. El título es la segunda identidad que la ruta
 * de páginas admite expresamente; se usa sólo cuando el id ya no existe, para no
 * convertir un renombrado en una resolución ambigua.
 */
async function canonicalPage(
  kept: Pick<PageView, 'id' | 'title'>,
  signal?: AbortSignal,
): Promise<PageView> {
  try {
    return await api.readablePage(kept.id, signal);
  } catch (error) {
    if (!(error instanceof Error) || !/no such page/i.test(error.message) || kept.title === kept.id) throw error;
    return api.readablePage(kept.title, signal);
  }
}

/**
 * Cuenta con palabras qué sigue haciendo Vera después de entregar la escritura.
 * Es estado de esta lectura, no del corpus, y vive junto al título que califica.
 */
function markEnrichment(
  text: HTMLElement,
  state: 'working' | 'failed',
  detail = '',
): void {
  text.querySelector('.page-enrichment')?.remove();
  const said = document.createElement('p');
  said.className = `page-enrichment ${state}`;
  said.textContent = state === 'working'
    ? 'página lista · completando relaciones, referencias y procedencia…'
    : 'página lista · no se pudo completar la información derivada';
  said.title = state === 'working'
    ? 'Ya puedes leer y escribir. Vera está calculando en segundo plano lo que depende del resto del grafo: retroenlaces, relaciones, pertenencia conceptual y procedencia.'
    : `El título, las propiedades y los bloques siguen disponibles.${detail === '' ? '' : ` ${detail}`}`;
  (text.querySelector('.page-header') ?? text.firstElementChild)?.append(said);
}

async function openPage(
  id: string,
  focus: { block: string; at: number | null } | null = null,
  options: {
    fromUrl?: boolean;
    reveal?: string | null;
    gesture?: NavigationGesture;
    /** Cómo se llama lo que viene, cuando quien llama ya lo sabe. */
    title?: string;
    /** Un renombrado corrige la dirección actual; no es una navegación nueva. */
    replaceRoute?: boolean;
    crossing?: { id: string; revision: string; content: string } | null;
    /** Entrega canónica ya obtenida al validar una copia retenida. */
    delivered?: PageView;
  } = {},
): Promise<void> {
  const thisOpening = ++opening;
  pageDelivery?.abort();
  const delivery = new AbortController();
  pageDelivery = delivery;
  $('#vera-root').classList.remove('special-surface');
  let page: PageView | undefined;
  /*
   * Si el corpus tarda, se dice qué se está abriendo.
   *
   * El temporizador se cancela pase lo que pase: un aviso que sobrevive a la
   * respuesta deja la página anterior borrada y un título colgando.
   */
  /*
   * Y por título además de por identidad.
   *
   * `/p/2026-08-11` nombra la página por su título, que es la forma en que llega
   * casi toda navegación desde fuera —una dirección pegada, un marcador, volver
   * atrás—. Buscando sólo por identidad no se encontraba nada y el aviso decía
   * «abriendo…» justo en el caso en que el título ya se sabía: estaba escrito en
   * la barra de direcciones.
   */
  const key = id.toLowerCase();
  const named =
    options.title ??
    pages.find((one) => one.id === id || one.title.toLowerCase() === key)?.title ??
    null;
  /*
   * Sólo al ir a otra página, nunca al redibujar la misma.
   *
   * Cada guardado vuelve a abrir la página en la que se está, y con el aviso
   * puesto ahí el texto se borraría y volvería en cada pulsación. La dirección
   * puede nombrarla por su título, así que se comparan las dos formas.
   */
  const here =
    id === workspace.activePage ||
    pages.find((one) => one.id === workspace.activePage)?.title === id;
  const asked = Date.now();
  /*
   * La cuenta del aviso, si llegó a pintarse.
   *
   * En una caja y no en una variable suelta porque quien la asigna es un
   * temporizador: el análisis de flujo no ve esa asignación y daría por hecho que
   * sigue vacía, dejando pasar sin avisar el cierre que la quita.
   */
  const shown: { counting: Counting | null } = { counting: null };
  const slow = here
    ? null
    : setTimeout(() => {
        shown.counting = awaiting(named, asked);
      }, PATIENCE);
  /** Si esta página salió de lo retenido y no del corpus. */
  let fromKept = false;
  let needsEnrichment = false;
  let validation: Promise<PageView> | null = null;

  /*
   * Lo que este aparato ya tenía, antes de preguntar nada.
   *
   * rule ShowRetainedPageAtOnce. Y es un cambio de fondo respecto de lo que había:
   * lo retenido se consultaba en el `catch`, o sea sólo cuando la red *fallaba*, y
   * un `catch` no se dispara porque algo tarde. Vera tenía la página guardada y se
   * quedaba mirando la red igual.
   *
   * El costo no era teórico. Abrir una página muy escrita del corpus real son 0,81 s
   * y 512 KB, pagados otra vez en cada visita, porque no hay lectura condicional en
   * ninguna parte: nadie pregunta si la copia que ya se tiene sigue valiendo. Una
   * página del rastro, abierta por quincuagésima vez, los pagaba cincuenta veces.
   *
   * Lo que va detrás no es volver a pedir la página: es la pregunta barata de qué
   * ha pasado desde el cursor. Ver `catchUpWithCorpus`.
   */
  let kept = options.delivered !== undefined || here || isAnybody() ? null : await held.page(id);
  /*
   * Incluso una copia incompleta se conserva hasta que la canónica haya llegado.
   * Antes se soltaba apenas el índice anunciaba otra cantidad de bloques. Si la
   * lectura del corpus fallaba después, Vera había destruido su única vía de
   * degradación y dejaba una página vacía. La discrepancia sirve para exigir la
   * validación, nunca para borrar antes de recuperar.
   */
  const retained = kept;
  if (kept !== null) {
    if (slow !== null) clearTimeout(slow);
    fromKept = true;
    page = kept;
    if (navigator.onLine) validation = canonicalPage(kept, delivery.signal);
  }

  try {
    if (options.delivered !== undefined) {
      page = options.delivered;
      needsEnrichment = true;
    } else if (page === undefined) {
      page = await api.readablePage(id, delivery.signal);
      needsEnrichment = true;
      // Leerla es lo que hace que se retenga. rule RetainDeliveredPage.
      // La copia durable se escribe al llegar la vista completa: una copia
      // parcial no debe hacerse pasar mañana por la página recordada.
    }
  } catch (error) {
    if (delivery.signal.aborted) return;
    /*
     * Sin servidor, lo que este aparato guardó de esta página.
     *
     * Y con ella se siembra la réplica igual que con una recién entregada, así que
     * se puede escribir dentro: lo que se escriba cae en la bandeja y sale cuando
     * vuelva la red. rule ShowRetainedPageAtOnce.
     *
     * Se vuelve a preguntar aquí y no sólo arriba porque `here` —redibujar la misma
     * página— salta el atajo a propósito: al guardar hay que volver a mirar el
     * corpus, y si el corpus no está, lo retenido sigue siendo la respuesta.
     */
    const remembered = isAnybody() ? null : await held.page(id);
    if (remembered === null) {
      // Una página que no se pudo traer ni se tenía se dice; no se deja la vista
      // anterior fingiendo que la navegación ocurrió.
      notice(`No se pudo abrir la página: ${error instanceof Error ? error.message : 'error'}.`);
      // Si el aviso llegó a pintarse, no puede quedarse: un título solo, sin
      // texto y sin explicación, se lee como una página vacía y no como un fallo.
      if (shown.counting !== null) {
        const said = document.createElement('p');
        said.className = 'awaiting-failed';
        said.textContent = 'no se pudo abrir';
        $('#text').querySelector('.awaiting')?.append(said);
      }
      return;
    }
    page = remembered;
    fromKept = true;
  } finally {
    if (slow !== null) clearTimeout(slow);
    // La cuenta se va con la espera, saliera como saliera. Si no llegó a
    // pintarse no hay nada que cerrar, que es el caso corriente.
    shown.counting?.close();
  }

  // De dónde se venía, antes de que activePage deje de decirlo.
  const from = workspace.activePage;

  // El índice local debe aprender el título canónico a la vez que la página.
  // Mapa, rastro y resolución por nombre leen esta lista; dejar aquí el nombre
  // anterior hacía que un renombrado pareciera ocurrir en unas vistas y no en
  // otras hasta el siguiente refresco del corpus.
  const listed = pages.find((one) => one.id === page.id);
  if (listed !== undefined) listed.title = page.title;

  /*
   * Redibujar la página en la que ya se está no debe mover la vista.
   *
   * Cada guardado, cada propiedad, cada plegado rehace `#text` entero —es lo
   * correcto: el grafo es quien sabe cómo quedó el árbol— y rehacerlo pone el
   * desplazamiento a cero. En una página corta se nota poco; en un diario leído
   * de corrido devuelve al principio de la jornada de hoy desde donde fuera que
   * se estuviera escribiendo, y hay que volver a bajar a mano cada vez.
   *
   * Sólo cuando es la misma página. Navegar a otra sí empieza arriba, que es
   * donde empieza un texto que no se había leído.
   */
  const text = $('#text');
  const staying = from === page.id;
  const keptScroll = staying ? text.scrollTop : 0;

  // La identidad manda a partir de aquí: la URL pudo nombrarla por su título.
  workspace.activePage = page.id;
  id = page.id;
  openTrail =
    page.trail == null || page.trail.route.length < 2
      ? null
      : {
          page: page.id,
          stops: page.trail.route.map((one) => ({ page: one.page, ordinal: one.ordinal })),
          kinds: page.trail.crossings.map((one) => one.kind),
        };
  nameWindow(page.title);

  // La dirección sigue a la página, salvo cuando es la dirección la que trajo
  // aquí: entonces escribirla otra vez apilaría una entrada por navegación y el
  // botón de atrás dejaría de deshacer un paso.
  if (options.fromUrl !== true) {
    const url = routeTo(page, {
      focus: workspace.focusRoot,
      block: options.reveal ?? null,
      // En un espacio público la ruta pertenece al espacio, no a la publicación
      // canónica de la raíz. El índice ya trae el camino cercado
      // `s/<slug>/p/<título>`; usar `page.publication.path` aquí sacaba la barra
      // de direcciones del subgrafo aunque la API siguiera negando lo exterior.
      publicPath: isAnybody()
        ? (pages.find((one) => one.id === page.id)?.publicationPath ?? null)
        : null,
    });
    if (window.location.pathname + window.location.search + window.location.hash !== url) {
      if (options.replaceRoute === true) window.history.replaceState({}, '', url);
      else window.history.pushState({}, '', url);
    }
  }

  // El breadcrumb guarda una sola llegada por página. Volver a un sitio mueve
  // su paso al final y reemplaza el gesto anterior; nunca suma otra instancia.
  if (options.gesture !== undefined) {
    workspace.trace = walked(workspace.trace, {
      page: id,
      from,
      gesture: options.gesture,
      crossing: options.crossing ?? null,
      at: Date.now(),
    });
    saveTrace(workspace.trace);
  }

  /*
   * Y la réplica de lo que se acaba de abrir.
   *
   * Se siembra con lo que el servidor entregó y a partir de aquí es ella la que
   * contesta qué pasó al aplicar un gesto. @invariant TheHandNeverWaitsForTheNetwork.
   */
  openView = page;
  replica = seed(page);
  /*
   * Y encima, lo que quedó pendiente y todavía no es canónico.
   *
   * rule RestoreDurableLocalWork: abrir restituye primero lo que hay guardado
   * aquí. Sin esto, volver a abrir con algo sin mandar enseñaría la versión del
   * servidor —sin lo escrito— y la bandeja lo aplicaría después: un parpadeo
   * que se lee como que el trabajo se había perdido.
   *
   * Lo que no sea de esta página se difiere solo, así que no hay que filtrar.
   */
  for (const one of inOrder(outbox?.pending() ?? [])) {
    if (one.status === 'rejected') continue;
    applyLocally(replica, one.change, one.originId);
  }
  page.blocks = blocksOf(replica);
  page.blockProperties = blockPropertiesOf(replica);
  page.properties = pagePropertiesOf(replica);
  page.visibility = replica.graph.page(replica.page)?.visibility ?? page.visibility;

  // Una referencia nombra un bloque aunque alguno de sus ancestros estuviera
  // plegado. Se abre sólo ese camino en esta composición; de otro modo el
  // destino jamás entraría al DOM y ningún desplazamiento podría encontrarlo.
  if (options.reveal !== undefined && options.reveal !== null) {
    page.folded = foldsWhileRevealing(page.blocks, page.folded, options.reveal);
  }

  derivedStale = false;
  window.clearTimeout(catchUpTimer);

  renderOutliner(text, page, callbacksFor(page), focus, workspace.focusRoot, isReadOnly());
  if (options.reveal !== undefined && options.reveal !== null) {
    revealBlock(options.reveal, page.id);
  }
  showingKept = fromKept;
  markShowing(text, fromKept);

  /*
   * Una copia retenida abre primero, pero ya no pasa por canónica por silencio.
   *
   * El cursor incremental sigue siendo la forma barata de saber qué ocurrió
   * mientras se lee. Al abrir, sin embargo, hay que validar una vez la página
   * exacta: el cursor y el índice también pueden ser copias viejas, y comparar
   * sólo la cantidad de bloques dejó pasar cambios de contenido con la misma
   * forma. Ver ConfirmRetainedPageIsCurrent y las dos reglas de divergencia.
   */
  if (validation !== null) {
    const acceptCanonical = (canonical: PageView, force = false): void => {
      // La página activa todavía lleva la identidad de la copia. Exigir aquí la
      // identidad canónica anulaba precisamente la recuperación por título.
      if (opening !== thisOpening || workspace.activePage !== page.id || openView === null) return;
      if (!force && sameReadablePage(retained as PageView, canonical)) {
        showingKept = false;
        markShowing(text, true, 'current');
        return;
      }

      // Se descarta la llave vieja; la canónica se retendrá al abrirla.
      void held.forgetPage(page.id);
      const active = document.activeElement;
      const writing = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      const blockIds = new Set(openView.blocks.map((block) => block.stableId));
      const pendingHere = (outbox?.pending() ?? []).some((one) => {
        const change = one.change;
        if ('page' in change && change.page === canonical.id) return true;
        if ('block' in change && typeof change.block === 'string' && blockIds.has(change.block)) return true;
        return false;
      });

      if (writing || pendingHere) {
        markShowing(text, true, 'divergent');
        announcing = {
          state: 'attention-required',
          message: 'dos versiones aquí',
          title: 'La copia en la que escribes difiere del corpus. Vera conservó tu texto y no sustituyó ninguna versión.',
        };
        paintSync();
        return;
      }

      void openPage(canonical.id, null, {
        fromUrl: true,
        replaceRoute: true,
        delivered: canonical,
      }).then(() => notice('La copia local estaba desactualizada; Vera trajo la versión canónica.'));
    };
    const retryValidation = (): void => {
      if (opening !== thisOpening || workspace.activePage !== page.id) return;
      markShowing(text, true, 'checking');
      // Un gesto explícito de recuperación siempre recompone la página desde la
      // respuesta canónica. Comparar y limitarse a cambiar el rótulo podía dejar
      // en pantalla una composición local rota aunque sus datos comparasen igual.
      void canonicalPage(page).then((canonical) => acceptCanonical(canonical, true)).catch((error) => {
        if (opening !== thisOpening || workspace.activePage !== page.id) return;
        markShowing(text, true, 'unreachable', retryValidation);
        notice(`No se pudo recuperar desde el corpus: ${error instanceof Error ? error.message : 'error'}.`);
      });
    };
    void validation.then(acceptCanonical).catch(() => {
      if (opening !== thisOpening || workspace.activePage !== page.id) return;
      markShowing(text, true, 'unreachable', retryValidation);
    });
  }
  if (needsEnrichment) {
    markEnrichment(text, 'working');
    void api.pageEnrichment(page.id, delivery.signal).then((complete) => {
      if (opening !== thisOpening || workspace.activePage !== complete.id || openView === null) return;

      // La escritura puede haber cambiado localmente mientras el servidor
      // calculaba. Se incorporan sólo las lecturas derivadas; título, bloques,
      // propiedades y pliegues siguen gobernados por la réplica que ya se usa.
      openView.domains = complete.domains;
      openView.concept = complete.concept ?? null;
      openView.pendingLinks = complete.pendingLinks ?? [];
      openView.backlinks = complete.backlinks;
      openView.references = complete.references;
      openView.crossingsOut = complete.crossingsOut;
      openView.crossingsIn = complete.crossingsIn;
      openView.trail = complete.trail ?? null;
      if (!isAnybody()) void held.keepPage(openView);

      const finish = (): void => {
        if (opening !== thisOpening || workspace.activePage !== complete.id || openView === null) return;
        const active = document.activeElement;
        const writing = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement ||
          (active instanceof HTMLElement && active.isContentEditable);
        if (writing) {
          window.setTimeout(finish, 500);
          return;
        }
        const viewport = holdTextViewport(text);
        renderOutliner(text, openView, callbacksFor(openView), null, workspace.focusRoot, isReadOnly());
        restoreTextViewport(text, viewport);
      };
      finish();
    }).catch((error) => {
      if (opening !== thisOpening || workspace.activePage !== page.id) return;
      markEnrichment(text, 'failed', error instanceof Error ? error.message : 'Error desconocido.');
    });
  }

  // Un día no se lee solo: se sigue leyendo hacia atrás. Ver `continueBackwards`.
  //
  // Se corta siempre antes de decidir, y no sólo cuando hay una continuación
  // nueva que empezar: lo que hay que garantizar es que ninguna página herede el
  // hilo de la anterior, y eso incluye a las que no son días y a un día abierto
  // por un bloque, que tampoco continúa.
  stopJournalPull();
  if (isDay(page.title) && workspace.focusRoot === null) {
    continueBackwards(page.title, staying ? keptScroll : 0);
  } else if (staying && focus === null) {
    // Con bloque enfocado no se toca: el propio outliner lo trae a la vista, y
    // eso es más preciso que devolver un número de píxeles.
    text.scrollTop = keptScroll;
  }

  /*
   * Si el mapa está visible, sigue a la página abierta cualquiera sea el ancho.
   *
   * Antes se usaba `!isPhone()`: en un iPad con PWA, Split View o una ventana
   * estrecha Vera podía clasificar el viewport como teléfono aunque el mapa
   * siguiera siendo la superficie visible. La página cambiaba, pero D4 retenía
   * el `central` anterior —borde naranja y vecindario de otra página— hasta el
   * siguiente redibujado manual. La geometría efectiva ya está escrita en el
   * DOM por `applyLayout`; ésa es la verdad que importa aquí.
   */
  if ($('#vera-root').dataset['layout'] !== 'text_only') void drawGraph();

  // Y detrás, la pregunta barata. rule PullOperationsAfterCursor: no pide la
  // página otra vez, pregunta qué pasó desde el cursor.
  void catchUpWithCorpus();
}

/**
 * La bitácora se lee de corrido, no día por día.
 *
 * Un día no es un documento: es un tramo de algo que sigue. Abrir el martes y
 * tener que volver, buscar el lunes y abrirlo convierte en tres gestos lo que en
 * un cuaderno es bajar la vista, y rompe justo lo que un diario tiene de útil,
 * que es la continuidad. Debajo del día abierto se van montando los anteriores a
 * medida que se llega a ellos.
 *
 * Hacia atrás y no hacia delante porque el futuro no está escrito: bajar es ir
 * hacia lo que ya pasó, que es el único sitio donde hay algo que leer.
 *
 * Sólo los días que existen. Un día sin nada escrito no es una jornada en
 * blanco que haya que mostrar: es un día en el que no pasó nada digno de
 * escribirse, y dibujarlo sería llenar el desplazamiento de vacío.
 *
 * La dirección no cambia al bajar. Lo que se abrió es el día que se pidió; lo de
 * abajo es contexto que se alcanzó leyendo, y reescribir la URL por desplazarse
 * dejaría el botón de atrás contando pasos que nadie dio.
 */
/**
 * Hasta qué día se había llegado leyendo hacia atrás.
 *
 * Se recuerda porque redibujar la página rehace `#text` entero y se lleva los
 * tramos por delante. Sin esto, guardar un bloque del martes en un diario donde
 * se había bajado hasta la semana pasada devolvía la columna a un solo día:
 * conservar el desplazamiento no habría servido de nada, porque ya no había
 * dónde desplazarse.
 */
let journalDepth = 0;

/** El oyente del desplazamiento en curso, para no apilar uno por redibujado. */
let journalPull: (() => void) | null = null;

/*
 * Dejar de tirar del hilo del diario.
 *
 * Tiene que poder llamarse desde fuera de `continueBackwards`, y ése era el
 * fallo: el oyente sólo se quitaba al empezar una continuación nueva, o sea sólo
 * al abrir otro día. Al salir de una bitácora hacia una página cualquiera nadie
 * lo desconectaba. `#text` se vacía y se vuelve a llenar, pero el elemento es el
 * mismo y su oyente sigue ahí, así que al desplazarse por una página de algo se
 * seguían montando debajo los días de la lectura anterior —desde donde se hubiera
 * quedado, que es por lo que ni siquiera era el de hoy.
 *
 * No toca `journalDepth`: hasta dónde se había bajado leyendo es lo que permite
 * reponer los tramos al redibujar el mismo día, y borrarlo aquí dejaría esa
 * reposición en nada.
 */
function stopJournalPull(): void {
  if (journalPull === null) return;
  $('#text').removeEventListener('scroll', journalPull);
  journalPull = null;
}

function continueBackwards(from: string, keptScroll: number): void {
  const text = $('#text');

  stopJournalPull();

  // Los días que hay, del más reciente al más antiguo. `YYYY-MM-DD` ordena igual
  // como texto que como fecha, así que no hace falta interpretarlo.
  const days = pages
    .filter((candidate) => isDay(candidate.title))
    .sort((a, b) => b.title.localeCompare(a.title));

  const here = days.findIndex((candidate) => candidate.title === from);
  let next = here + 1;

  // Reponer sólo si se estaba en esta misma página. Llegar de nuevo a un día
  // —desde el mapa, desde un enlace— es empezar a leerlo, no continuar.
  const refill = keptScroll > 0 ? journalDepth : 0;
  journalDepth = 0;

  let settled = refill === 0;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    text.scrollTop = keptScroll;
  };

  if (here < 0 || next >= days.length) {
    text.scrollTop = keptScroll;
    return;
  }

  const CERCA = 600;
  let loading = false;

  const pull = (): void => {
    if (loading || next >= days.length) return;
    // Mientras queden tramos por reponer se tira sin mirar la distancia al
    // fondo: la vista todavía no está donde debe, así que medirla no diría nada.
    const reponiendo = journalDepth < refill;
    if (!reponiendo && text.scrollHeight - text.scrollTop - text.clientHeight > CERCA) return;

    const day = days[next];
    next += 1;
    if (day === undefined) return;
    loading = true;

    void api
      .page(day.id)
      .then((older) => {
        const slice = document.createElement('section');
        slice.className = 'day-slice';
        // Cada tramo se dibuja con el mismo outliner que el día de arriba: se
        // edita igual, se pliega igual y habla con las mismas teclas. Un diario
        // que sólo se pudiera leer hacia atrás sería un archivo, no un cuaderno.
        renderOutliner(slice, older, callbacksForJournalSlice(older, slice), null, null, isReadOnly());
        text.append(slice);
        journalDepth += 1;
        if (journalDepth >= refill) settle();
      })
      .catch(() => {
        // Sin red se deja de tirar del hilo y lo ya leído se queda: insistir
        // contra un servidor que no está sólo llenaría la consola.
        next = days.length;
        settle();
      })
      .finally(() => {
        loading = false;
        // Encadena: si el tramo recién puesto tampoco llena la pantalla, sigue.
        pull();
      });
  };

  journalPull = pull;
  text.addEventListener('scroll', pull, { passive: true });
  pull();
}

/**
 * Un día anterior comparte pantalla con el día abierto, no su identidad activa.
 *
 * Los callbacks generales redibujan `workspace.activePage`, que es correcto para
 * la página superior y falso para cada tramo añadido debajo. Guardar allí abría
 * de nuevo el día superior y desmontaba precisamente el tramo que se estaba
 * editando. Cada tramo vuelve a pedir y redibuja sólo su propia página, sin
 * cambiar URL, página activa ni profundidad del diario.
 */
function callbacksForJournalSlice(page: PageView, slice: HTMLElement): OutlinerCallbacks {
  const callbacks = callbacksFor(page);
  callbacks.onReload = (focus) => {
    void api.page(page.id).then((fresh) => {
      if (!slice.isConnected) return;
      const text = $('#text');
      const viewport = holdTextViewport(text);
      renderOutliner(slice, fresh, callbacksForJournalSlice(fresh, slice), focus, null, isReadOnly());
      restoreTextViewport(text, viewport);
    }).catch((error) => {
      notice(`No se pudo actualizar ${page.title}: ${error instanceof Error ? error.message : 'error'}.`);
    });
  };
  return callbacks;
}

/**
 * Lo que el outliner puede pedirle al espacio de trabajo, para una página dada.
 *
 * Era un literal dentro de `openPage`, y sirvió mientras se dibujaba una página
 * por vez. La lectura continua monta varios días en la misma pantalla y cada uno
 * necesita los suyos: algunos cierran sobre la página —hablar en un bloque
 * necesita saber de cuál es hijo— y compartirlos habría hecho que escribir en el
 * día de abajo creara bloques en el de arriba.
 */
/**
 * Lo derivado se pone al día cuando nadie está escribiendo.
 *
 * La réplica sabe cómo quedó el árbol y no sabe quién nombra a esta página desde
 * el resto del corpus. Eso hay que ir a buscarlo, y no puede hacerse en el camino
 * del gesto —sería volver a esperar a la red, que es lo que se vino a quitar—.
 *
 * Se espera a que el cursor no esté en ninguna parte. Volver a dibujar la página
 * con alguien escribiendo dentro le quitaría el foco a mitad de una frase, y un
 * retroenlace que llega dos segundos tarde no vale eso. Mientras haya un cursor
 * puesto, se vuelve a esperar.
 */
function catchUp(): void {
  if (!derivedStale) return;
  window.clearTimeout(catchUpTimer);
  catchUpTimer = window.setTimeout(() => {
    const at = document.activeElement;
    const writing =
      at instanceof HTMLTextAreaElement || at instanceof HTMLInputElement ||
      (at instanceof HTMLElement && at.isContentEditable);
    if (writing) {
      catchUp();
      return;
    }
    derivedStale = false;
    if (workspace.activePage !== null) void openPage(workspace.activePage);
  }, 2000);
}

function callbacksFor(page: PageView): OutlinerCallbacks {
  return {
    // Pulsar el nombre de otra página dentro del texto que se lee.
    onNavigate: (title) => void openTitle(title, 'followed_reference'),
    pageTitles: () => pages,
    onOpen: (target, gesture, crossing) => void openPage(
      target,
      null,
      crossing === undefined ? { gesture } : { gesture, crossing },
    ),
    onDeleted: async (deleted) => {
      const prior = [...workspace.trace]
        .reverse()
        .find((step) => step.page !== deleted.id && pages.some((one) => one.id === step.page));

      pages = pages.filter((one) => one.id !== deleted.id);
      workspace.trace = workspace.trace.filter((step) => step.page !== deleted.id);
      saveTrace(workspace.trace);
      await held.forgetPage(deleted.id);
      await held.keepIndex(pages);
      workspace.activePage = null;
      workspace.focusRoot = null;
      openView = null;
      replica = null;

      if (prior !== undefined) {
        await openPage(prior.page, null, { gesture: 'returned', replaceRoute: true });
        return;
      }
      const fallback = pages.find((one) => one.title === today())
        ?? pages.find((one) => one.title === 'VERA: Registro de Actividad');
      if (fallback !== undefined) {
        await openPage(fallback.id, null, { gesture: 'opened_directly', replaceRoute: true });
        return;
      }
      await openTitle(today(), 'opened_directly');
    },
    onUndo: (direction) => undoLast(direction),
    onChanged: (before, after) => {
      if (changesGraphMeaning(before, after)) void refreshGraph();
    },
    // @invariant ReferenceResolvesToItsBlock: seguir una referencia deja al
    // participante en el bloque que nombra, no sólo en su página. Llegar a una
    // página de cien bloques y tener que buscarlo no es haberla seguido.
    onOpenBlock: (target, block) => {
      void openPage(target, null, { reveal: block, gesture: 'followed_reference' });
    },
    /*
     * Un cambio estructural rehace la página desde el modelo y devuelve el cursor
     * donde el modelo dice que quedó.
     *
     * Desde el modelo local, no desde el servidor. Esto decía —y era cierto—
     * que parchear el árbol dibujado sería mantener una segunda idea de cómo
     * quedó; la conclusión era volver a pedir la página, y costaba 125 ms y 62 KB
     * por cada Enter. La segunda idea no hacía falta: el dominio corre aquí, así
     * que hay un modelo de verdad al que preguntarle, y es el mismo que el
     * servidor va a aplicar. @invariant TheHandNeverWaitsForTheNetwork.
     *
     * Lo derivado —quién nombra a esta página, qué cruces tiene— no sale de una
     * página sola, así que se pone al día aparte y sin prisa. Ver `catchUp`.
     */
    onReload: (focus, options) => {
      const text = $('#text');
      const viewport = holdTextViewport(text);
      /*
       * Renombrar es el único cambio corriente que la réplica de una página
       * difiere a propósito: también reescribe referencias del resto del grafo.
       * Si se redibuja desde esa réplica, reaparece el título provisional aunque
       * el servidor ya haya aceptado el nuevo. En ese caso se vuelve al corpus
       * por la identidad estable y se reemplaza la ruta actual.
       */
      if (options?.fromCorpus === true) {
        if (workspace.activePage !== null) {
          void openPage(
            workspace.activePage,
            focus,
            options.replaceRoute === true ? { replaceRoute: true } : {},
          );
        }
        return;
      }
      if (replica !== null && openView !== null && workspace.activePage === replica.page) {
        openView.blocks = blocksOf(replica);
        openView.blockProperties = blockPropertiesOf(replica);
        openView.properties = pagePropertiesOf(replica);
        openView.visibility = replica.graph.page(replica.page)?.visibility ?? openView.visibility;
        renderOutliner(text, openView, callbacksFor(openView), focus, workspace.focusRoot, isReadOnly());
        restoreTextViewport(text, viewport);
        catchUp();
        return;
      }
      if (workspace.activePage !== null) void openPage(workspace.activePage, focus);
    },
    // @invariant FocusBoundsTheStructure: con la vista enraizada en un bloque,
    // sólo se dibuja su subárbol, así que desindentar, fusionar y mover se
    // detienen ahí sin que ninguna tecla tenga que saberlo.
    onFocusBlock: (block) => {
      workspace.focusRoot = block;
      if (workspace.activePage !== null) void openPage(workspace.activePage);
    },
    // Hablar donde se estaba escribiendo. La grabación necesita un bloque vacío
    // que le guarde el lugar: si el bloque tenía texto, se le deja lo escrito y
    // el que habla es uno nuevo debajo, para que la transcripción no caiga
    // encima de palabras que nadie aceptó perder.
    onSpeak: async (block, rest) => {
      let place = block;
      if (rest !== '') {
        const kept = await api.submit({ kind: 'edit_block', block, content: rest });
        if (kept.status === 'rejected') {
          notice(`rechazado: ${kept.reason}`);
          return;
        }
        const near = page.blocks.find((candidate) => candidate.stableId === block);
        const born = await api.submit({
          kind: 'create_block',
          page: page.id,
          parent: near?.parent ?? null,
          position: (near?.position ?? 0) + 1,
          content: '',
        });
        if (born.status === 'rejected') {
          notice(`rechazado: ${born.reason}`);
          return;
        }
        place = born.subjectId;
      } else if (page.blocks.find((c) => c.stableId === block)?.content !== '') {
        const emptied = await api.submit({ kind: 'edit_block', block, content: '' });
        if (emptied.status === 'rejected') {
          notice(`rechazado: ${emptied.reason}`);
          return;
        }
      }
      speakInto(place, page.title);
      if (workspace.activePage !== null) await openPage(workspace.activePage);
    },
  };
}

/**
 * Abre lo que la dirección dice, sin volver a escribirla.
 *
 * Es lo que corre al arrancar y cada vez que el botón de atrás cambia la URL,
 * así que el historial del navegador y el de Vera cuentan lo mismo.
 */
async function applyRoute(): Promise<void> {
  if (window.location.pathname === '/compartir') {
    await openSharingAdministration();
    return;
  }
  if (window.location.pathname === '/archivos') {
    await openFilesAdministration();
    return;
  }
  const here = new URL(window.location.href);
  let route = parseRoute(here);
  if (route.search !== null) {
    await openSearchResults(route.search, false);
    return;
  }
  if (route.page === null && isAnybody() && here.pathname !== '/') {
    let asked = '';
    try {
      asked = decodeURIComponent(here.pathname).replace(/^\/+|\/+$/g, '');
    } catch {
      asked = '';
    }
    const publication = pages.find((page) => page.publicationPath === asked);
    if (publication !== undefined) {
      route = {
        page: publication.id,
        focus: here.searchParams.get('focus'),
        block: here.hash === '' ? null : decodeURIComponent(here.hash.slice(1)),
        search: null,
      };
    }
  }
  if (route.page === null) {
    // La raíz es hoy. Antes era la página más conectada del corpus, que es una
    // buena portada y un mal sitio donde llegar: para escribir algo había que
    // decidir primero dónde, y esa decisión es justo la que un diario ahorra.
    await openHome();
    return;
  }

  // Una fecha que todavía no tiene página no es un error: es un día que no ha
  // empezado. Enseñarlo vacío es lo que permite escribir en él.
  if (/^\d{4}-\d{2}-\d{2}$/.test(route.page) && dayPage(route.page) === undefined) {
    drawUnstartedDay(route.page);
    return;
  }

  workspace.focusRoot = route.focus;
  const presentationBlock = here.searchParams.get('present');
  // Una dirección pegada, un enlace de fuera o el botón de atrás. Vera no puede
  // distinguirlos y no los distingue: los tres son llegar sin venir de dentro.
  await openPage(route.page, null, {
    fromUrl: true,
    reveal: presentationBlock === null ? route.block : null,
    gesture: 'opened_directly',
  });
  if (presentationBlock !== null) {
    const present = document.querySelector<HTMLButtonElement>('.present-page');
    if (present !== null) {
      present.dataset['initialBlock'] = presentationBlock;
      present.click();
    }
  }
}

async function openSharingAdministration(push = false): Promise<void> {
  workspace.activePage = null;
  workspace.focusRoot = null;
  nameWindow('Espacios compartidos');
  if (push && window.location.pathname !== '/compartir') window.history.pushState({}, '', '/compartir');
  $('#vera-root').classList.add('special-surface');
  closeSettings();
  await renderSharingAdministration($('#text'));
}

async function openFilesAdministration(push = false): Promise<void> {
  workspace.activePage = null;
  workspace.focusRoot = null;
  nameWindow('Administración de archivos');
  if (push && window.location.pathname !== '/archivos') window.history.pushState({}, '', '/archivos');
  $('#vera-root').classList.add('special-surface');
  closeSettings();
  await renderFilesAdministration($('#text'));
}

/**
 * Lleva a la vista el bloque que una referencia nombra y lo señala un momento.
 *
 * El destello es lo que convierte «esta es la página» en «este es el bloque».
 * Se retira solo, porque un resalte permanente se confundiría con estado.
 */
function revealBlock(stableId: string, page: string): void {
  const text = $('#text');
  const selector = `.block[data-id="${CSS.escape(stableId)}"]`;
  let observer: MutationObserver | null = null;
  let expiry = 0;
  const land = (): boolean => {
    // Una composición anterior no puede aterrizar sobre una página posterior.
    if (workspace.activePage !== page) {
      observer?.disconnect();
      window.clearTimeout(expiry);
      return true;
    }
    const row = text.querySelector<HTMLElement>(selector);
    if (row === null) return false;
  /*
   * Deslizándose sólo si hay poco que recorrer.
   *
   * Un `behavior: smooth` de decenas de miles de píxeles Chrome no lo hace: se
   * queda donde estaba, y quien pulsó una referencia a un bloque del final de
   * una página larga no llegaba a ninguna parte. Medido con un índice de treinta
   * entradas sobre un documento de cuarenta y cinco mil píxeles de alto.
   *
   * Y por debajo de una pantalla de distancia el deslizamiento sigue diciendo
   * algo que un salto no dice: hacia dónde se fue.
   */
    const cerca = Math.abs(row.getBoundingClientRect().top) < window.innerHeight * 2;
    row.scrollIntoView({ block: 'center', ...(cerca ? { behavior: 'smooth' as const } : {}) });
    row.classList.add('landed');
    window.setTimeout(() => row.classList.remove('landed'), 2000);
    observer?.disconnect();
    window.clearTimeout(expiry);
    return true;
  };

  // Las páginas pequeñas ya están completas. Las grandes se componen por lotes
  // en cuadros sucesivos: se espera la aparición efectiva del bloque en vez de
  // confundir «terminó la petición» con «terminó de existir en pantalla».
  if (land()) return;
  observer = new MutationObserver(() => land());
  observer.observe(text, { childList: true, subtree: true });
  expiry = window.setTimeout(() => observer?.disconnect(), 10_000);
}

/** Un aviso a la vez, en texto plano: el corpus no dicta marcado. */
function notice(message: string): void {
  const text = $('#text');
  text.querySelector('.notice')?.remove();
  const paragraph = document.createElement('p');
  paragraph.className = 'notice';
  paragraph.textContent = message;
  text.prepend(paragraph);
}

/**
 * El índice de títulos que la sesión lleva en memoria.
 *
 * Ordenado por conectividad y no por tamaño: la página más grande del corpus es
 * una transcripción sin un solo enlace, y abrirla de entrada mostraría un mapa
 * vacío. Se vuelve a pedir cuando nace una página, o el autocompletado seguiría
 * sin conocerla el resto de la sesión.
 */
/** Ordena el índice como se usa: lo más enlazado y lo más escrito primero. */
const byWeight = (all: PageSummary[]): PageSummary[] =>
  [...all].sort((a, b) => b.linkCount - a.linkCount || b.blockCount - a.blockCount);

async function loadPages(): Promise<void> {
  /*
   * El índice de la última vez, y sin esperar a nadie.
   *
   * Son 197 KB sobre un corpus de dos mil páginas —el doble de lo que pesa una
   * página larga— y se pedían **antes de dibujar nada**, en cada arranque. De los
   * ~694 KB que hay que bajar para ver el primer bloque de una página nueva, éste
   * es el trozo más grande, y es el único que este aparato ya tiene entero.
   *
   * Lo que se pierde es que una página creada en otro aparato hace un minuto no
   * esté en la lista todavía: el autocompletado no la ofrece hasta que llegue la
   * lista de verdad, unos segundos después. Abrirla por su título sigue
   * funcionando, porque eso lo resuelve el servidor y no la lista.
   */
  const remembered = isAnybody() ? null : await held.index();
  if (remembered !== null) {
    pages = byWeight(remembered);
    // Y detrás, la de verdad, sin que nadie la espere.
    void api
      .pages()
      .then((fresh) => {
        pages = byWeight(fresh);
        if (!isAnybody()) void held.keepIndex(fresh);
      })
      .catch(() => undefined);
    return;
  }

  try {
    pages = byWeight(await api.pages());
    if (!isAnybody()) void held.keepIndex(pages);
    return;
  } catch (error) {
    /*
     * Sin servidor, la lista de la última vez.
     *
     * No es un adorno: de ella salen el autocompletado de `[[enlaces]]`, resolver
     * una dirección escrita por título y saber si una página existe antes de
     * crearla. Sin lista, abrir sin red dejaría a Vera sabiendo leer una página y
     * sin saber cómo se llama ninguna otra.
     */
    const otra = isAnybody() ? null : await held.index();
    if (otra === null) throw error;
    pages = byWeight(otra);
  }
}

/** Abrir por título es lo que hace un [[enlace]]. */
async function openTitle(title: string, gesture: NavigationGesture): Promise<void> {
  const found = pages.find((page) => page.title.toLowerCase() === title.toLowerCase());
  if (found !== undefined) {
    await openPage(found.id, null, { gesture });
    return;
  }

  if (isAnybody()) {
    notice(`«${title}» no forma parte de este sitio público.`);
    return;
  }

  /*
   * Un enlace a una página que no existe la crea al pulsarlo.
   *
   * Antes se avisaba —«aún no existe, la referencia queda esperando»— y ahí
   * moría: para escribir sobre eso había que ir a crear la página por otro
   * camino, con su título escrito otra vez a mano y sin que nada la conectara
   * con el enlace que la nombró. El enlace quedaba esperando para siempre,
   * porque nadie completa a mano lo que ya había dicho al escribirlo.
   *
   * Escribir `[[algo]]` es nombrar algo que existe en la cabeza de quien
   * escribe; pulsarlo es ir a ello. No hay ambigüedad que proteger: nace vacía
   * y privada, y una página vacía no afirma nada. Que se cree al seguirla y no
   * al escribirla sí importa —el texto se corrige, y un enlace tecleado por
   * error no debe dejar rastro— pero pulsar es haber decidido.
   */
  let created;
  try {
    created = await createPage(title);
  } catch {
    notice(`no se pudo crear «${title}»: sin conexión con el servidor`);
    return;
  }

  if (created.status === 'rejected') {
    notice(`no se pudo crear «${title}»: ${created.reason}`);
    return;
  }

  /*
   * El índice se corrige aquí mismo, sin volver a pedirlo.
   *
   * Pedía `/pages` entero —197 KB sobre un corpus de dos mil páginas— para añadir
   * una fila que ya se conoce: el título es el que se acaba de escribir y la
   * identidad la acuñó este aparato. Era el tramo más largo de un gesto que
   * debería no tener ninguno.
   */
  pages = [
    { id: created.subjectId, title, visibility: 'private', blockCount: 0, linkCount: 0 },
    ...pages,
  ];
  void held.keepIndex(pages);

  /*
   * Y se retiene vacía, para que abrirla no vuelva a viajar.
   *
   * Una página que acaba de nacer aquí está vacía, y eso no es una suposición:
   * es lo que este aparato acaba de hacer. Retenerla es decir la verdad, y hace
   * que `openPage` la dibuje al instante en vez de ir a preguntar por una página
   * cuyo contenido conoce entero. rule ShowRetainedPageAtOnce.
   */
  await held.keepPage(blankPage(created.subjectId, title));
  await openPage(created.subjectId, null, { gesture });
}

/** Una página recién nacida: su nombre, y nada más. */
function blankPage(id: string, title: string): PageView {
  const now = Date.now();
  return {
    id,
    title,
    visibility: 'private',
    createdAt: now,
    originCreatedAt: null,
    lastEditedAt: null,
    properties: [],
    domains: {},
    blocks: [],
    assets: [],
    blockRefs: [],
    folded: [],
    spokenOrigins: [],
    authorship: {},
    backlinks: [],
    references: [],
    crossingsOut: [],
    crossingsIn: [],
  };
}

/*
 * El rastro ya no se dibuja en la barra: al lado de la marca era un texto que
 * repetía el título que la página ya tiene debajo. `workspace.trace` se sigue
 * llevando, porque el rastro vuelve —como nav-pills en el panel del mapa, donde
 * pertenece: el mapa es donde uno se ubica.
 */

// ---------------------------------------------------------------------------
// Grafo
// ---------------------------------------------------------------------------

/**
 * Cada dibujo del mapa lleva turno, igual que cada búsqueda.
 *
 * Pedir el grafo tarda, y en ese rato se puede pedir otro: cambiar de dimensión,
 * mover el alcance, abrir otra página. Sin turno, la respuesta que llegue última
 * dibuja, aunque sea la de la pregunta vieja.
 */
/*
 * El recorrido que está abierto, para que el mapa dibuje su hilo.
 *
 * Vive aquí y no en el workspace porque no es estado del taller que haya que
 * conservar: es lo que la página abierta resultó ser, y cambia con ella. Se pone
 * al abrir la página y se quita al abrir cualquier otra — cerrado, un recorrido
 * vuelve a ser una página como las demás, con su nodo y sus enlaces, y así es
 * como se le encuentra sin saber que existía.
 */
/*
 * La réplica de la página abierta, y la página tal como se está mirando.
 *
 * Una réplica no sobrevive a cambiar de página: sostiene un árbol, y al abrir
 * otra deja de describir lo que hay delante. Ver specs/offline-reconciliation.allium
 * y docs/plan-local-first.md.
 */
let replica: Replica | null = null;
let openView: PageView | null = null;
/**
 * Lo derivado que dejó de ser cierto: retroenlaces, referencias, cruces.
 *
 * La réplica sostiene una página y eso no alcanza para recalcular a quién nombra
 * el corpus entero. @invariant RenderingFollowsChangedMeaning: se marca cuando
 * cambió el texto —que es lo único que produce enlaces— y no cada vez que pasa
 * algo.
 */
let derivedStale = false;
let catchUpTimer: number | undefined;
/** Lo pendiente que sobrevive a cerrar. Ver outbox.ts y el paso 3 del plan. */
let outbox: Outbox | null = null;

let openTrail: ThreadSettings | null = null;

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Lo que pasó en el corpus mientras se leía.
 *
 * Ver specs/offline-reconciliation.allium, fases 3 y 4, y behind.ts para la
 * aritmética. Aquí está lo que la aritmética no puede tener: el cursor durable, la
 * barra, y el acto de tomar.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Lo que se sabe y no se ha tomado. Nulo mientras no se haya preguntado. */
let waiting: Behind | null = null;

/**
 * Los bloques donde ya se sabe que hay dos versiones.
 *
 * Lo pendiente sobre ellos no sale hasta que alguien decida. Es lo que impide que
 * volver la red mande lo mío por encima de lo que otra mano escribió, sin que nadie
 * haya elegido — que es la pérdida silenciosa que rule ExposeConcurrentConflict
 * viene a evitar, y que ocurría por una carrera entre el drenaje y la pregunta.
 */
let contested = new Set<string>();

/**
 * Pregunta qué ha pasado desde el cursor, y no aplica nada.
 *
 * rule PullOperationsAfterCursor. Es la única petición que se hace sola, y es
 * barata a propósito: las últimas veinte operaciones del corpus real son 3,8 KB;
 * volver a pedir una página muy escrita son 512 KB.
 * @guarantee KnowingIsCheapAndTakingIsNot.
 */
async function catchUpWithCorpus(): Promise<void> {
  if (isAnybody()) return;
  if (!navigator.onLine) return;

  const cursor = await held.cursor();
  /*
   * La primera vez no se anuncia nada.
   *
   * Sin cursor, «lo que ha pasado» es el corpus entero, y decirle a alguien que
   * acaba de instalar Vera que tiene setenta mil operaciones esperando sería cierto
   * y absurdo. Se toma la posición de ahora como punto de partida.
   */
  if (cursor === null) {
    if (corpus?.lastSequence !== undefined) await held.keepCursor(corpus.lastSequence);
    return;
  }

  let ops;
  try {
    ops = await api.ops(cursor);
  } catch {
    // Sin red no hay noticias, que no es lo mismo que no haberlas. El aviso que
    // hubiera se queda como estaba.
    return;
  }

  waiting = behind(ops, {
    mine: new Set(await held.sent()),
    openPage: workspace.activePage,
    retained: new Set(await held.retained()),
  });

  /*
   * Y se retiene lo que no puede salir todavía.
   *
   * Un bloque que este aparato tiene sin mandar y que el corpus ya cambió tiene dos
   * versiones, y mandarlo sería elegir una sin preguntar. Se calcula aquí porque es
   * donde se sabe qué llegó, y se aplica en el drenaje, que es donde saldría.
   */
  const touched = new Set(
    waiting.waiting.map((one) => one.op.subjectId).filter((id): id is string => id !== null),
  );
  contested = new Set(
    (outbox?.pending() ?? [])
      .filter((one) => one.change.kind === 'edit_block' && touched.has(one.change.block as string))
      .map((one) => (one.change as { block: string }).block),
  );

  /*
   * Si sólo volvió lo propio, el cursor avanza y no se dice nada.
   *
   * Sin esto se preguntaría por lo mismo para siempre, y cada escritura propia
   * dejaría un aviso encendido sobre algo que uno acaba de hacer.
   */
  if (waiting.waiting.length === 0) {
    // Que no haya nada que anunciar no vuelve vigente un snapshot viejo. Las
    // operaciones propias también pueden haber cambiado una página retenida.
    for (const page of waiting.staleElsewhere) await held.forgetPage(page);
    if (waiting.upTo > cursor) await held.keepCursor(waiting.upTo);
    waiting = null;
  }
  announce();
}

/** Enciende —o apaga— el aviso de la barra. rule AnnounceWaitingCanonicalWork. */
function announce(): void {
  const dicho = waiting === null ? null : said(waiting);
  announcing =
    dicho === null
      ? null
      : {
          state: (waiting?.here ?? 0) > 0 ? 'waiting-here' : 'waiting',
          message: dicho.message,
          title: dicho.title,
        };
  paintSync();
}

/**
 * Trae lo que esperaba. rule TakeWaitingCanonicalWork.
 *
 * Es el único camino por el que algo del corpus entra en lo que hay en pantalla.
 * @guarantee WhatArrivesIsAnnouncedAndNotImposed.
 */
/** Si hay una toma en marcha, para que pulsar dos veces no la duplique. */
let takingNow = false;

async function takeWaitingWork(): Promise<void> {
  if (waiting === null || takingNow) return;
  const taking = waiting;
  takingNow = true;
  /*
   * Pase lo que pase, la barra vuelve a decir la verdad.
   *
   * Sin esto, cualquier salida que no fuera el éxito dejaba el botón en «trayendo…»
   * para siempre: apagado, sin color, y sin forma de saber si había pasado algo. Un
   * botón que se apaga y no vuelve es peor que no tenerlo, porque además de no
   * traer nada convence de que ya se trajo.
   */
  try {
    await bringItOver(taking);
  } finally {
    takingNow = false;
    announce();
  }
}

async function bringItOver(taking: Behind): Promise<void> {

  /*
   * Lo retenido de otras páginas que dejó de valer se suelta.
   *
   * Soltar no es perder —lo canónico está en el corpus— y es lo único honesto que
   * se puede hacer con una copia que se sabe vieja: la próxima visita la traerá
   * entera, una vez, en vez de enseñarla al instante y equivocada.
   */
  for (const page of taking.staleElsewhere) await held.forgetPage(page);

  const open = workspace.activePage;
  if (taking.here > 0 && open !== null) {
    /*
     * Con plazo. Un `fetch` sin él no falla nunca sobre un túnel a medias: se queda.
     * Diez segundos son de sobra para la página más escrita de este corpus —0,81 s
     * en bucle local— y poco para que alguien crea que se colgó.
     */
    let canonical;
    try {
      canonical = await api.page(open, 10_000);
    } catch (error) {
      /*
       * Que ya no esté es una respuesta, y hay que tratarla como tal.
       *
       * Otra mano puede haber borrado la página que se estaba leyendo. Aquí se
       * seguía enseñando lo retenido de ella y el aviso volvía a encenderse con
       * lo mismo cada vez, sin manera de traerlo ni de quitarlo: pedirla otra
       * vez sólo podía volver a fallar. Se suelta lo que este aparato guardaba,
       * se avanza el cursor —porque lo que esperaba ya se sabe— y se dice.
       */
      const gone = error instanceof Error && /no such page/i.test(error.message);
      if (gone) {
        await held.forgetPage(open);
        await held.keepCursor(taking.upTo);
        waiting = null;
        notice(
          'La página que estabas leyendo ya no está en el corpus. Se soltó lo que ' +
            'este aparato guardaba de ella; lo que escribiste sigue en la bandeja.',
        );
        return;
      }
      const why = error instanceof Error && error.name === 'TimeoutError'
        ? 'el corpus tardó demasiado'
        : error instanceof Error
          ? error.message
          : 'no contestó';
      notice(`No se pudo traer lo que cambió: ${why}. Lo que esperaba sigue esperando.`);
      return;
    }

    /*
     * Dónde las dos manos dicen cosas distintas del mismo bloque.
     *
     * Sólo cuenta lo que todavía no ha llegado al corpus: si lo mío ya está
     * confirmado, lo que el corpus dice *es* lo mío y no hay nada que preguntar.
     */
    const pending = (outbox?.pending() ?? [])
      .filter((one) => one.status !== 'rejected')
      .flatMap((one) =>
        one.change.kind === 'edit_block'
          ? [{ block: one.change.block as string, content: one.change.content as string }]
          : [],
      );
    const found = disagreements(
      new Map(canonical.blocks.map((one) => [one.stableId, one.content])),
      pending,
      new Map(
        Object.entries(canonical.authorship ?? {}).map(([block, who]) => [block, who.participant]),
      ),
    );

    if (found.length > 0) {
      const decided = await askAboutDisagreements(found);
      // Dejarlo no es elegir: lo pendiente sigue pendiente y el aviso encendido.
      if (decided === null) return;
      const applied = await applyResolutions(found, decided, {
        outbox,
        submit: (change) => api.submit(change),
        notice,
      });
      if (!applied) return;
    }
  }

  await held.keepCursor(taking.upTo);
  waiting = null;
  contested = new Set();
  // Y ahora sí sale lo que estaba retenido: ya se decidió qué hacer con ello.
  await api.drain();

  // Y ahora sí se vuelve a abrir: lo que se paga una vez, cuando hubo motivo.
  if (taking.here > 0 && open !== null) {
    await openPage(open);
    return;
  }

  /*
   * Y si lo que cambió no era de esta página, se dice.
   *
   * Pulsar y que no pase nada visible es indistinguible de pulsar y que falle. Lo
   * que ocurrió es real —el cursor avanzó, lo retenido que envejeció se soltó— y no
   * tiene por qué verse en la página que se está mirando.
   */
  const cuantas = taking.staleElsewhere.length;
  notice(
    cuantas === 0
      ? 'Al día. Lo que cambió no era de esta página.'
      : cuantas === 1
        ? 'Al día. Lo que cambió era de otra página, que se traerá entera al abrirla.'
        : `Al día. Lo que cambió era de otras ${cuantas} páginas, que se traerán al abrirlas.`,
  );
}

let graphTurn = 0;
let graphDelivery: AbortController | null = null;

async function drawGraph(): Promise<void> {
  if (workspace.activePage === null) return;
  const container = $('#graph');
  const turn = ++graphTurn;
  graphDelivery?.abort();
  const delivery = new AbortController();
  graphDelivery = delivery;
  if (
    workspace.mapScope === 'published' &&
    openView?.publication?.publishedAt == null
  ) {
    workspace.mapScope = 'own_space';
    notice('Esta página no está publicada; el mapa vuelve a mostrar tu espacio.');
  }
  let data;
  try {
    data = await api.graph(
      workspace.activePage,
      workspace.depth,
      workspace.mapScope === 'published',
      delivery.signal,
    );
    data = journalsInMap(data, workspace.activePage, workspace.graphJournals);
  } catch {
    if (delivery.signal.aborted) return;
    /*
     * El mapa es lo único que no se puede leer sin corpus, y hay que decirlo.
     *
     * Una página retenida es esa página entera; el vecindario no lo es: quién
     * enlaza a quién a dos saltos se calcula sobre el grafo completo, y este
     * aparato no lo tiene. Retenerlo no es opción —sería replicar el corpus, que
     * es justo lo que retener por lectura evita.
     *
     * Antes esto se rompía sin más: la promesa se rechazaba, nadie la recogía y
     * el mapa se quedaba con el vecindario de la página anterior sin decirlo —un
     * grafo verdadero, de otra cosa. Ahora se queda igual pero atenuado y con la
     * razón escrita, que es lo que lo separa de una mentira: sigue sirviendo para
     * orientarse y ya no se lee como el vecindario de lo que está abierto.
     * @invariant SilenceNeverPretendsToBeSuccess.
     */
    if (turn !== graphTurn) return;
    container.classList.add('map-stale');
    container.querySelector('.map-unavailable')?.remove();
    const said = document.createElement('p');
    said.className = 'map-unavailable';
    said.textContent = 'el mapa necesita el corpus · sin conexión';
    container.append(said);
    return;
  }
  container.classList.remove('map-stale');
  container.querySelector('.map-unavailable')?.remove();
  // Mientras se pedía éste, alguien pidió otro: el que manda es el último.
  if (turn !== graphTurn) return;

  /*
   * El ojo y el rastro se apartan aquí, y no antes de pedir el grafo.
   *
   * Viven dentro del mapa y el renderizador vacía su contenedor, así que hay que
   * sacarlos y devolverlos. Lo que importa es dónde: mientras se apartaban antes
   * de la espera, un segundo dibujo que empezara durante esa espera no los
   * encontraba en el DOM —`$` devolvía null y `null.remove()` cortaba el dibujo
   * a la mitad—. Se quedaban fuera para siempre: el mapa en blanco y sin
   * controles con que salir de ahí. Bastaba pulsar 2D y 3D seguido.
   *
   * De aquí al `append` del final no hay ninguna espera, así que nadie puede
   * colarse entre sacarlos y devolverlos. El turno de más arriba se encarga de
   * que sólo el último dibujo llegue hasta aquí.
   */
  const controls = $('#map-controls');
  const trail = $('#map-trail');
  controls.remove();
  trail.remove();

  // La página que se está leyendo es el nodo señalado: las dos vistas hablan de
  // lo mismo y deben decirlo a la vez.
  selectNode(workspace.activePage);
  selectNode3D(workspace.activePage);

  const onClick = (id: string): void => {
    // @invariant GraphNodeOpensTextPage: en un teléfono, tocar un nodo abre su
    // página y cambia a la vista de texto.
    void openPage(id, null, { gesture: 'pressed_on_the_map' }).then(() => {
      if (isPhone()) setLayout('text_only');
    });
  };

  const settings = {
    dark: workspace.scheme === 'dark',
    // El mapa colorea por dónde se ha pasado, y para eso le basta la lista de
    // páginas. El rastro guarda llegadas —con su gesto y de dónde se venía—,
    // que es más de lo que el mapa necesita y menos de lo que sabría usar.
    history: pagesOf(workspace.trace),
    showEdges: true,
    showTitles: true,
    // El nodo es su nombre. @guarantee GraphNodesAreTheirNames: un círculo al
    // lado no dice nada que el nombre no diga, y gasta el mismo sitio diciendo
    // menos. En 2D los nombres no se traslapan: dos nombres uno encima de otro
    // no son ninguno de los dos.
    nodeStyle: 'title' as const,
    // Si lo abierto es un recorrido, su hilo. Ver ThreadSettings en render.ts.
    thread: openTrail,
    fontFamily:
      getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() ||
      'system-ui, sans-serif',
  };

  /*
   * Los controles del mapa vuelven pase lo que pase con el dibujo.
   *
   * Estaban fuera del `try` y se sacan del panel antes de dibujar: si dibujar
   * fallaba, no se volvían a poner, y el mapa quedaba en blanco *y sin el ojo*,
   * o sea sin manera de volver a 2D ni de cambiar el alcance. Un fallo al pintar
   * dejaba la aplicación sin la salida de ese fallo, que es la peor forma de
   * romperse: la que se lleva por delante el remedio.
   */
  try {
    if (data.nodes.length === 0) {
      cleanupGraph3D();
      container.innerHTML = '<p class="map-aviso">Los diarios están apagados.</p>';
    } else if (workspace.graphView === 'graph_3d') {
      renderGraph3D(container, data, onClick, settings);
    } else if (workspace.graphView === 'graph_d4') {
      cleanupGraph3D();
      renderGraphD4(container, data, onClick, {
        ...settings,
        relations: {
          editBlock: async (block: string, content: string): Promise<boolean> => {
            const result = await api.submit({ kind: 'edit_block', block, content });
            if (result.status === 'rejected') notice(`No se pudo editar la relación: ${result.reason}`);
            return result.status !== 'rejected';
          },
          createBlock: async (
            crossing: string,
            page: string,
            parent: string | null,
            position: number,
          ): Promise<boolean> => {
            const result = await api.submit({
              kind: 'create_block', page, crossing, parent, position, content: '',
            });
            if (result.status === 'rejected') {
              notice(`No se pudo añadir el bloque: ${result.reason}`);
              return false;
            }
            await drawGraph();
            return true;
          },
          createRelation: async (fromPage: string, toPage: string): Promise<string | null> => {
            const result = await api.submit({
              kind: 'create_crossing', fromPage, toPage, content: '',
            });
            if (result.status === 'rejected') {
              notice(`No se pudo crear la relación: ${result.reason}`);
              return null;
            }
            return result.subjectId;
          },
          refresh: drawGraph,
        },
      });
    } else {
      cleanupGraph3D();
      renderGraph(container, data, onClick, settings);
    }
  } finally {
    container.append(controls, trail);
    drawTrail();
  }
}

/**
 * Por dónde se ha pasado, acumulándose.
 *
 * Vive en el mapa y no en la barra porque el mapa es la superficie de saber
 * dónde está uno: el rastro es una respuesta a esa misma pregunta.
 * @guarantee TheTraceIsWhereOneIsLocated.
 */
function drawTrail(): void {
  const trail = $('#map-trail');
  trail.innerHTML = '';
  let draggedFrom: number | null = null;

  const reorder = (from: number, to: number): void => {
    workspace.trace = movedTo(workspace.trace, from, to);
    saveTrace(workspace.trace);
    drawTrail();
  };

  for (const [index, step] of workspace.trace.entries()) {
    const id = step.page;
    const page = pages.find((candidate) => candidate.id === id);
    const item = document.createElement('span');
    item.className = 'trail-step';
    item.dataset['traceIndex'] = String(index);

    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'trail-grip';
    grip.innerHTML = icon('more-vertical');
    grip.title = `mover ${page?.title ?? id}`;
    grip.setAttribute('aria-label', `mover ${page?.title ?? id}`);

    let pointerTarget = index;
    grip.addEventListener('pointerdown', (event) => {
      pointerTarget = index;
      grip.setPointerCapture(event.pointerId);
      item.classList.add('moving');
    });
    grip.addEventListener('pointermove', (event) => {
      if (!grip.hasPointerCapture(event.pointerId)) return;
      const under = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.trail-step');
      const target = Number(under?.dataset['traceIndex']);
      if (Number.isInteger(target)) pointerTarget = target;
    });
    grip.addEventListener('pointerup', (event) => {
      if (!grip.hasPointerCapture(event.pointerId)) return;
      grip.releasePointerCapture(event.pointerId);
      item.classList.remove('moving');
      if (pointerTarget !== index) reorder(index, pointerTarget);
    });

    item.draggable = true;
    item.addEventListener('dragstart', (event) => {
      draggedFrom = index;
      event.dataTransfer?.setData('text/plain', String(index));
      item.classList.add('moving');
    });
    item.addEventListener('dragend', () => {
      draggedFrom = null;
      item.classList.remove('moving');
    });
    item.addEventListener('dragover', (event) => event.preventDefault());
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      const from = draggedFrom ?? Number(event.dataTransfer?.getData('text/plain'));
      if (Number.isInteger(from) && from !== index) reorder(from, index);
    });

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = id === workspace.activePage ? 'trail-pill here' : 'trail-pill';
    pill.textContent = page?.title ?? id;
    pill.addEventListener('click', () => void openPage(id));
    /*
     * Y desde cualquier parada, guardar el tramo que va de ahí hasta aquí.
     *
     * Con el botón secundario y no con uno propio: el rastro es para volver, y
     * un botón por paso al lado de cada nombre convertiría la fila en una
     * botonera. Quien quiera promover lo hace pulsando donde quiere empezar.
     */
    pill.title = `volver a ${page?.title ?? id} · con el botón derecho, guardar el recorrido desde aquí`;
    pill.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      void promoteTrace(index);
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'trail-remove';
    remove.innerHTML = icon('x');
    remove.title = `quitar ${page?.title ?? id} del rastro`;
    remove.setAttribute('aria-label', `quitar ${page?.title ?? id} del rastro`);
    remove.addEventListener('click', () => {
      workspace.trace = dropped(workspace.trace, index);
      saveTrace(workspace.trace);
      drawTrail();
    });

    item.append(grip, pill, remove);
    trail.append(item);
  }

  /*
   * Guardar lo andado.
   *
   * Uno solo y al final de la fila: el gesto corriente sobre el rastro es
   * volver, y promover es el que se hace de vez en cuando. Guarda el rastro
   * entero; para empezar más tarde se pulsa con el botón derecho en la parada
   * por donde se quiere empezar.
   */
  if (workspace.trace.length >= 2) {
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'trail-keep';
    // El icono y no la palabra: la fila del rastro son nombres de páginas, y un
    // botón con texto ahí dentro compite con ellos por lo mismo que uno viene a
    // leer. Lo que dice la palabra va en el título, donde no estorba.
    keep.innerHTML = icon('steps-1');
    keep.title = 'guardar como recorrido: lo andado se convierte en una página con sus paradas y sus huecos';
    keep.setAttribute('aria-label', 'guardar como recorrido');
    keep.addEventListener('click', () => void promoteTrace(null));
    trail.append(keep);
  }

  if (workspace.trace.length > 0) {
    const booklet = document.createElement('button');
    booklet.type = 'button';
    booklet.className = 'trail-booklet';
    booklet.innerHTML = icon('book');
    booklet.title = 'exportar lo andado como un solo PDF en formato librillo';
    booklet.setAttribute('aria-label', 'exportar el rastro como librillo PDF');
    booklet.addEventListener('click', () => void exportTraceBooklet());
    trail.append(booklet);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'trail-clear';
    clear.innerHTML = icon('wash-dryclean-off');
    clear.title = 'limpiar rastro';
    clear.setAttribute('aria-label', 'limpiar rastro');
    clear.addEventListener('click', () => {
      if (!globalThis.confirm('¿Limpiar todo el rastro de este dispositivo?')) return;
      workspace.trace = [];
      clearTrace();
      drawTrail();
      void drawGraph();
    });
    trail.append(clear);
  }
}

/** Descarga las paradas del breadcrumb, en su orden visible, como un documento. */
async function exportTraceBooklet(): Promise<void> {
  const ids = workspace.trace.map((step) => step.page);
  if (ids.length === 0) return;
  const query = new URLSearchParams();
  for (const id of ids) query.append('page', id);
  query.set('title', 'Recorrido de Vera');
  notice('componiendo el librillo…');
  try {
    const answer = await fetch(`/booklet/pdf?${query.toString()}`);
    if (!answer.ok) {
      const said = await answer.json().catch(() => ({})) as { error?: string };
      notice(said.error ?? 'no se pudo componer el librillo');
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await answer.blob());
    link.download = 'Recorrido de Vera.pdf';
    link.click();
    URL.revokeObjectURL(link.href);
    notice('librillo descargado');
  } catch {
    notice('no se pudo componer el librillo');
  }
}

/**
 * Convierte lo andado en un recorrido, desde una parada o desde el principio.
 *
 * Guardar un tramo no vacía el rastro ni lo marca: se sigue andando y se sigue
 * acumulando, y el mismo tramo se puede guardar dos veces si a alguien le da por
 * contar dos cosas distintas con el mismo paseo.
 * @invariant TheTraceItselfIsNotConsumed.
 */
async function promoteTrace(from: number | null): Promise<void> {
  const walkedTrace = workspace.trace.slice(from === null ? 0 : Math.max(0, from));
  const sourcePages = await Promise.all(
    [...new Set(walkedTrace.slice(0, -1).map((step) => step.page))]
      .map((id) => api.page(id)),
  );
  const relations = new Map<string, { id: string; revision: string; content: string }>();
  for (const source of sourcePages) {
    for (const crossing of source.crossingsOut) {
      if (crossing.toPage === null || crossing.revision === null) continue;
      relations.set(`${source.id}->${crossing.toPage}`, {
        id: crossing.stableId,
        revision: crossing.revision,
        content: crossing.said,
      });
    }
  }
  const trace = fillTraceCrossings(
    walkedTrace,
    (source, target) => relations.get(`${source}->${target}`) ?? null,
  );
  if (trace.length === 0) {
    notice('No hay nada andado que guardar.');
    return;
  }

  const titleOf = (id: string): string =>
    pages.find((one) => one.id === id)?.title ?? id;
  const title = provisionalTitle(new Date(), (name) =>
    pages.some((one) => one.title.trim().toLowerCase() === name.trim().toLowerCase()),
  );

  const seed = seedTrail(trace, { title });
  // Promover es una sola secuencia dependiente: la página debe existir en el
  // corpus antes de declararla argumento, y la declaración antes de abrirla.
  // La cola local sirve para la mano corriente; aquí permitiría que `openPage`
  // llegara antes que el tipo y restituyera una página ordinaria o incompleta.
  const born = await api.submitConfirmed(seed.page as never);
  if (born.status !== 'applied') {
    notice(`No se pudo crear el recorrido: ${born.status === 'rejected' ? born.reason : 'error'}.`);
    return;
  }
  const page = born.subjectId;

  const write = async (
    change: unknown,
    channel: 'typed_text' | 'walked' = 'typed_text',
  ) => api.submitConfirmed(change as never, channel);

  for (const change of seed.properties(page)) {
    const written = await write(change);
    if (written.status === 'rejected') {
      notice(`El recorrido nació, pero no pudo declararse argumento: ${written.reason}.`);
      return;
    }
  }

  let position = 0;
  for (const one of blocksFor(trace, titleOf)) {
    position += 1;
    const block = await write({
      kind: 'create_block',
      page,
      parent: null,
      position,
      content: one.content,
    });
    if (block.status === 'rejected') {
      notice(`El recorrido quedó incompleto: ${block.reason}.`);
      return;
    }
    // La promoción se confirma de punta a punta antes de abrirse. El testimonio
    // entra por `walked`: no lo tecleó nadie, ocurrió al andar.
    if (block.status === 'applied' && one.testimony !== null) {
      const testimony = await write(
        {
          kind: 'set_property',
          block: block.subjectId,
          propertyKey: TESTIMONY_KEY,
          propertyValue: one.testimony,
        },
        'walked',
      );
      if (testimony.status === 'rejected') {
        notice(`El recorrido quedó sin uno de sus testimonios: ${testimony.reason}.`);
        return;
      }
      if (one.crossing != null) {
        for (const [propertyKey, propertyValue] of [
          ['conectiva', one.crossing.id],
          ['revisión de conectiva', one.crossing.revision],
        ] as const) {
          const cited = await write(
            { kind: 'set_property', block: block.subjectId, propertyKey, propertyValue },
            'walked',
          );
          if (cited.status === 'rejected') {
            notice(`El recorrido quedó sin citar una conectiva: ${cited.reason}.`);
            return;
          }
        }
      }
    }
  }

  await loadPages();
  await openPage(page, null, { gesture: 'opened_directly' });
  notice('Guardado. Falta lo que hay entre una parada y la siguiente: eso es el argumento.');
}

async function refreshGraph(): Promise<void> {
  if (workspace.layout !== 'text_only') await drawGraph();
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

let searchTimer: number | undefined;
/** Cada búsqueda lleva turno: una respuesta lenta no pisa a una más reciente. */
let searchTurn = 0;

/**
 * La búsqueda comprometida: una superficie y una dirección, no un menú grande.
 *
 * El menú ayuda mientras se escribe. Esta página contesta lo que se preguntó,
 * conserva la consulta al recargar y enseña también la ausencia de resultados.
 */
async function openSearchResults(text: string, push = true): Promise<void> {
  const query = text.trim();
  if (query === '') return;

  opening += 1;
  pageDelivery?.abort();
  pageDelivery = null;
  graphDelivery?.abort();
  workspace.activePage = null;
  workspace.focusRoot = null;
  openView = null;
  replica = null;
  closeSettings();
  $('#vera-root').classList.add('special-surface');
  nameWindow(`Buscar: ${query}`);

  const url = searchRoute(query);
  if (push && window.location.pathname + window.location.search !== url) {
    window.history.pushState({}, '', url);
  }

  const barInput = $<HTMLInputElement>('#search');
  // La consulta ya vive en la página y en su URL. Conservarla además en el
  // campo transitorio mantiene `#bar.searching` abierto en móvil y tapa Atrás,
  // inicio, voz y vistas después de terminada la búsqueda.
  barInput.value = '';
  $('#bar').classList.remove('searching');
  const menu = $('#results');
  menu.innerHTML = '';
  menu.hidden = true;

  const host = $('#text');
  host.innerHTML = '';
  const header = document.createElement('header');
  header.className = 'search-page-header';
  const title = document.createElement('h1');
  title.textContent = 'Resultados de búsqueda';
  const form = document.createElement('form');
  form.className = 'search-page-form';
  const field = document.createElement('input');
  field.type = 'search';
  field.value = query;
  field.setAttribute('aria-label', 'Buscar en Vera');
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Buscar';
  form.append(field, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void openSearchResults(field.value);
  });
  header.append(title, form);
  host.append(header);

  const status = document.createElement('p');
  status.className = 'search-page-status';
  status.textContent = `Buscando “${query}”…`;
  status.setAttribute('aria-live', 'polite');
  host.append(status);
  const counting = countInto(status, `Buscando “${query}”…`, 'search:corpus');

  let hits: Hit[];
  try {
    hits = await api.search(query);
  } catch {
    counting.close('failed');
    status.textContent = `No se pudo completar la búsqueda de “${query}”.`;
    return;
  }
  counting.close();
  // Otra búsqueda pudo reemplazar ésta mientras llegaba la red.
  if (new URL(window.location.href).searchParams.get('q')?.trim() !== query) return;

  const found = pageSearchResults(query, pages, hits);
  status.textContent = found.length === 0
    ? `No hay resultados para “${query}”.`
    : `${found.length} ${found.length === 1 ? 'página' : 'páginas'} para “${query}”.`;
  if (found.length === 0) return;

  const list = document.createElement('ol');
  list.className = 'search-page-results';
  for (const result of found) {
    const item = document.createElement('li');
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'search-page-result';
    const heading = document.createElement('strong');
    heading.textContent = result.page.title;
    const evidence = document.createElement('span');
    evidence.className = 'search-page-excerpt';
    const count = result.matches === 1 ? '1 coincidencia interna' : `${result.matches} coincidencias internas`;
    evidence.innerHTML = renderMarkdown(result.excerpt === null ? count : `${result.excerpt} · ${count}`);
    link.append(heading, evidence);
    link.addEventListener('click', () => {
      barInput.value = '';
      void openPage(result.page.id, null, { gesture: 'searched', title: result.page.title });
    });
    item.append(link);
    list.append(item);
  }
  host.append(list);
}

function wireSearch(): void {
  const input = $<HTMLInputElement>('#search');
  const results = $('#results');
  const wrap = $('#search-wrap');

  const close = (): void => {
    results.innerHTML = '';
    results.hidden = true;
  };

  /*
   * Dónde empieza la lista, medido y no supuesto.
   *
   * En un teléfono la lista va `fixed` —tiene que salirse de la barra, que
   * recorta— y entonces su sitio no lo puede saber la hoja de estilo: la barra
   * crece con lo que lleve dentro y con el hueco que reserva el aparato arriba.
   * Se mide el campo, que es lo que la lista continúa.
   */
  const place = (): void => {
    const under = Math.round(input.getBoundingClientRect().bottom) + 4;
    results.style.setProperty('--results-top', `${under}px`);
  };

  /*
   * Lo señalado ahora mismo, para poder abrirlo con Enter.
   *
   * Sin esto, en un teléfono hay que apuntar con el dedo a un renglón de una
   * lista que acaba de aparecer, y en un teclado no hay forma de llegar al
   * primer resultado sin soltar las manos.
   */
  const pick = (delta: number): void => {
    const items = [...results.querySelectorAll<HTMLElement>('.hit')];
    if (items.length === 0) return;
    const at = items.findIndex((one) => one.classList.contains('picked'));
    const next = at === -1 ? (delta > 0 ? 0 : items.length - 1) : (at + delta + items.length) % items.length;
    items.forEach((one) => one.classList.remove('picked'));
    items[next]?.classList.add('picked');
    items[next]?.scrollIntoView({ block: 'nearest' });
  };

  const row = (className: string): HTMLDivElement => {
    const item = document.createElement('div');
    item.className = className;
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    return item;
  };

  /*
   * Una sugerencia por página, aunque el asunto aparezca en muchos bloques.
   *
   * Los títulos se pueden responder inmediatamente con el índice retenido. Al
   * llegar la búsqueda completa, la misma lista suma la evidencia interior y
   * vuelve a ordenarse: repetir un asunto vuelve más pertinente a la página, no
   * más larga a la lista.
   */
  const suggest = (text: string, hits: readonly Hit[] = []): void => {
    const suggestions = pageSearchResults(text, pages, hits).slice(0, 24);
    results.innerHTML = '';
    for (const suggestion of suggestions) {
      const page = suggestion.page;
      const item = row('hit hit-title');
      const where = document.createElement('span');
      where.className = 'hit-page';
      where.textContent = page.title;
      const what = document.createElement('span');
      what.className = 'hit-excerpt';
      const count = suggestion.matches === 1 ? '1 coincidencia' : `${suggestion.matches} coincidencias`;
      const excerpt =
        suggestion.excerpt === null
          ? isDay(page.title)
            ? 'un día de la bitácora'
            : 'página'
          : `${suggestion.excerpt} · ${count}`;
      what.innerHTML = renderMarkdown(excerpt);
      what.addEventListener('click', (event) => {
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a.wiki[data-page]');
        if (link === null) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        void openPage(link.dataset['page'] ?? '', null, { gesture: 'searched' });
      });
      item.append(where, what);
      const open = (): void => {
        close();
        /*
         * El acuse: lo elegido se queda escrito hasta que la página llega.
         *
         * Vaciaba el campo y cerraba la lista, así que entre el clic y la página
         * no quedaba en pantalla ni una señal de que el clic hubiera entrado.
         * Dejar puesto el título cuesta nada y contesta la primera pregunta —¿me
         * ha oído?— sin prometer nada sobre la segunda —¿cuánto falta?—.
         */
        input.value = page.title;
        void openPage(page.id, null, { gesture: 'searched', title: page.title }).then(() => {
          if (input.value === page.title) input.value = '';
        });
      };
      item.addEventListener('click', (event) => {
        // Un enlace Markdown dentro del extracto conserva su propio destino.
        // El resto del renglón abre la página que produjo el resultado.
        if ((event.target as HTMLElement).closest('a') !== null) return;
        open();
      });
      item.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      });
      results.append(item);
    }
    if (suggestions.length === 0) return;
    place();
    results.hidden = false;
  };

  input.addEventListener('input', () => {
    const text = input.value.trim();
    if (text === '') {
      window.clearTimeout(searchTimer);
      close();
      return;
    }

    // Los títulos, ya: no esperan a nada. Cuando llegue el contenido se funde
    // con ellos y la lista se reordena por página.
    suggest(text);

    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(async () => {
      const turn = ++searchTurn;
      let hits;
      try {
        hits = await api.search(text);
      } catch {
        return;
      }
      if (turn !== searchTurn || input.value.trim() !== text) return;

      const complete = pageSearchResults(text, pages, hits);
      if (complete.length === 0) {
        close();
        void openSearchResults(text);
        return;
      }
      suggest(text, hits);
    }, 120);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.value = '';
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      pick(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results.querySelector<HTMLElement>('.hit.picked');
      if (chosen !== null) {
        chosen.click();
        return;
      }
      close();
      void openSearchResults(input.value);
    }
  });

  document.addEventListener('pointerdown', (event) => {
    // El campo y su lista son dos elementos, no uno: la lista cuelga de la barra
    // para poder ocupar su ancho. Preguntar sólo por el campo dejaba «fuera» a
    // los propios resultados, y pulsar uno los borraba antes de que el clic
    // llegara a abrir la página.
    const target = event.target as Node;
    if (!wrap.contains(target) && !results.contains(target)) close();
  });
}

// ---------------------------------------------------------------------------
// Tema
// ---------------------------------------------------------------------------

function wireTheme(): void {
  applyTokens(tokens, workspace.scheme);

  // La marca y el micrófono no cambian nunca, así que se dibujan una vez.
  $('#brand').innerHTML = brandMark();
  $('#insert-voice').innerHTML = icon('mic');
  $('#search-open').innerHTML = icon('search');
  $('#search-close').innerHTML = icon('x');
  $('#settings').innerHTML = icon('settings');

  // Atrás y adelante son los del navegador, no un rastro propio: cada documento
  // tiene dirección, así que el historial que ya existe es el correcto y no hay
  // dos ideas de dónde se estuvo.
  $('#back').innerHTML = icon('chevron-left');
  $('#forward').innerHTML = icon('chevron-right');

  // Hoy es un calendario. Escrita, la fecha ocupaba en la barra el sitio de algo
  // que se lee una vez —el día ya está en el título de la página que se abre— y
  // obligaba además a un temporizador para que no mintiera pasada la medianoche.
  // El icono no puede quedar viejo: nombra el destino, no lo enseña.
  $('#back').addEventListener('click', () => window.history.back());
  $('#forward').addEventListener('click', () => window.history.forward());
  $('#brand').addEventListener('click', () => void openHome());

  /*
   * El ojo abre y cierra el panel de controles del mapa.
   *
   * No oculta el mapa: lo que se aparta es lo que se le pone encima. Un mapa es
   * para mirarlo, y sus propios controles no pueden quedarse ocupando sitio
   * sobre lo que se está mirando. Para dejar de ver el mapa está el switch de la
   * vista, que es donde vive esa decisión.
   */
  const panelToggle = $('#map-panel-toggle');
  const mapPanel = $('#map-panel');

  const drawPanel = (): void => {
    mapPanel.hidden = !mapPanelOpen;
    panelToggle.setAttribute('aria-expanded', String(mapPanelOpen));
    // Siempre el mismo ojo. Tacharlo diría «no se ve» de algo que sí se ve —el
    // mapa— y el estado del menú ya lo dice el menú, que está o no está.
    panelToggle.innerHTML = icon('eye');
    panelToggle.title = mapPanelOpen ? 'Ocultar los controles' : 'Controles del mapa';
  };
  drawPanel();

  const setPanel = (open: boolean): void => {
    if (mapPanelOpen === open) return;
    mapPanelOpen = open;
    drawPanel();
  };

  panelToggle.addEventListener('click', (event) => {
    // Sin esto, el mismo clic que lo abre llega al documento y lo cierra.
    event.stopPropagation();
    setPanel(!mapPanelOpen);
  });

  /*
   * Un menú abierto se cierra pulsando fuera, como cualquier menú.
   *
   * Es lo que la mano ya espera, y aquí además hace falta: el menú del mapa no
   * tiene botón de cerrar —es un ojo, no un diálogo— así que sin esto la única
   * forma de recogerlo sería volver a dar con el mismo botón.
   */
  document.addEventListener('click', (event) => {
    if (!mapPanelOpen) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('#map-controls') != null) return;
    setPanel(false);
  });

  /*
   * El alcance: cuántos saltos desde la página en foco.
   *
   * @guarantee TheMapIsBoundedByReach. Saltos y no cantidad de nodos, porque la
   * pregunta que uno se hace es «qué tan lejos de aquí». Y por eso mismo se pide
   * de uno en uno: aquí había un deslizador, que sirve para apuntar dentro de un
   * continuo, y esto no es un continuo —son tres valores— ni una magnitud.
   * Cada flecha es un salto, que es la unidad de la que habla la garantía.
   *
   * Tres y no cuatro: al cuarto salto el mapa ya no dice «qué hay cerca de aquí»
   * sino «qué hay», y eso no cabe en la mirada.
   */
  const REACH_MIN = 1;
  const REACH_MAX = 3;
  const reachLess = $<HTMLButtonElement>('#map-reach-less');
  const reachMore = $<HTMLButtonElement>('#map-reach-more');
  const reachValue = $('#map-reach-value');
  reachLess.innerHTML = icon('chevron-left');
  reachMore.innerHTML = icon('chevron-right');

  /** El número y qué flechas quedan por dar. */
  const showReach = (): void => {
    reachValue.textContent = String(workspace.depth);
    // Una flecha que no lleva a ninguna parte se apaga en vez de no hacer nada:
    // que el control diga dónde se acaba es parte de decir dónde se está.
    reachLess.disabled = workspace.depth <= REACH_MIN;
    reachMore.disabled = workspace.depth >= REACH_MAX;
  };

  const stepReach = (by: number): void => {
    const next = Math.min(REACH_MAX, Math.max(REACH_MIN, workspace.depth + by));
    if (next === workspace.depth) return;
    workspace.depth = next;
    session.setReach(next);
    showReach();
    // El alcance cambia qué nodos hay, así que lo colocado deja de valer, y
    // tampoco tiene sentido volver a la cámara de un grafo que ya no es ese.
    forgetPositions();
    forgetCamera();
    void refreshGraph();
  };

  reachLess.addEventListener('click', () => stepReach(-1));
  reachMore.addEventListener('click', () => stepReach(+1));
  showReach();

  /*
   * Los diarios no son ruido opcional dentro de una vecindad. El interruptor
   * sólo autoriza a dibujar el día que ya está seleccionado y ocupa el foco;
   * ningún otro día aparece jamás como vecino.
   */
  const journalSwitch = $<HTMLButtonElement>('#map-journals');
  const showJournals = (): void => {
    journalSwitch.setAttribute('aria-checked', String(workspace.graphJournals));
    journalSwitch.textContent = workspace.graphJournals ? 'encendido' : 'apagado';
  };
  journalSwitch.addEventListener('click', () => {
    workspace.graphJournals = !workspace.graphJournals;
    session.setGraphJournals(workspace.graphJournals);
    showJournals();
    forgetPositions();
    forgetCamera();
    void refreshGraph();
  });
  showJournals();

  // El switch de la vista, en el orden del espacio que gobierna.
  const SWITCH: Record<string, IconName> = {
    graph_only: 'affiliate',
    split: 'spread',
    text_only: 'text',
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>('#view-switch [data-layout]')) {
    const shape = SWITCH[button.dataset['layout'] ?? ''];
    if (shape !== undefined) button.innerHTML = icon(shape);
  }

  // La configuración vive en su propia superficie, no en un panel suelto: son
  // varias secciones y van a ser más.
  const panel = $('#tokens');
  let section: Section = 'memoria';


  const openSettings = (): void => {
    if (isAnybody()) section = 'apariencia';
    renderSettings(panel, tokens, section, {
      drawMemory,
      scheme: () => workspace.scheme,
      onScheme: (next) => {
        if (next === workspace.scheme) return;
        workspace.scheme = next;
        if (isAnybody()) session.setPublicScheme(next);
        else session.setScheme(next);
        applyTokens(tokens, next);
        void refreshGraph();
        // Se redibuja la página: el texto sigue al tema por variables CSS, pero
        // un diagrama Mermaid ya está pintado con los colores del anterior y no
        // puede repintarse solo.
        if (workspace.activePage !== null) void openPage(workspace.activePage);
        openSettings();
      },
      onTokenChange: (token, value) => {
        // Cada token guarda su valor por esquema, así que editar el oscuro no
        // puede pisar el claro.
        if (workspace.scheme === 'dark') token.dark = value;
        else token.light = value;
        saveTokens(tokens);
        applyTokens(tokens, workspace.scheme);
        void refreshGraph();
      },
      onReset: () => {
        localStorage.removeItem('vera.tokens');
        tokens = loadTokens();
        applyTokens(tokens, workspace.scheme);
        openSettings();
      },
      onClose: closeSettings,
      onOpenFiles: () => void openFilesAdministration(true),
      onOpenSharing: () => void openSharingAdministration(true),
    });
    document.body.classList.add('settings-open');
    // Recordar la sección entre aperturas: se vuelve a la misma que se dejó.
    panel.querySelectorAll('.settings-tab').forEach((tab, at) => {
      if (isAnybody() && tab.textContent !== 'Apariencia') {
        (tab as HTMLElement).hidden = true;
      }
      tab.addEventListener('click', () => {
        section = (['memoria', 'archivos', 'teclado', 'apariencia'] as Section[])[at] ?? 'memoria';
      });
    });
  };

  /**
   * Hablar, desde la barra.
   *
   * Lo grabado cae en el día de hoy, y por el mismo camino que `/audio`: un
   * bloque del día le guarda el lugar y ahí se recorre la cascada. Que sea el
   * mismo camino importa más de lo que parece — es lo que hace que ninguna
   * grabación pueda volver a quedar flotando sin página, porque todas nacen con
   * un día.
   *
   * En un teléfono es la razón de ser de la aplicación: se saca del bolsillo, se
   * habla, y lo dicho ya está en el día que le corresponde.
   */
  /*
   * El buscador plegado, en un teléfono.
   *
   * Se despliega al pulsar la lupa y se recoge al terminar. En un teléfono,
   * salir del campo también termina la búsqueda: conservar el texto dentro del
   * campo ocultaba Atrás, inicio, voz y vistas aunque la persona ya estuviera
   * actuando en otra parte. En pantalla ancha el campo sigue siendo persistente,
   * porque allí no reemplaza a la barra.
   *
   * La clase va en la barra y no en el campo: lo que cambia es la barra entera
   * —el campo pasa a ocuparla— y el CSS de una pantalla ancha la ignora, donde
   * el buscador está siempre a la vista porque ahí sí cabe.
   */
  const bar = $('#bar');
  const search = $<HTMLInputElement>('#search');

  const openSearch = (): void => {
    bar.classList.add('searching');
    search.focus();
  };
  const closeSearch = (cancel = false): void => {
    if (!cancel && search.value !== '') return;
    if (cancel) {
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    bar.classList.remove('searching');
    search.blur();
  };

  $('#search-open').addEventListener('click', () => {
    if (bar.classList.contains('searching')) closeSearch();
    else openSearch();
  });
  $('#search-close').addEventListener('click', () => closeSearch(true));
  search.addEventListener('blur', () => {
    window.setTimeout(() => closeSearch(window.matchMedia('(max-width: 640px)').matches), 120);
  });
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // El propio buscador ya vacía el campo con Escape; esto recoge lo que queda.
    window.setTimeout(() => bar.classList.remove('searching'), 0);
  });

  // La barra dice si se está grabando. Ver `onRecording` en audio-block.ts: el
  // estado lo lleva quien lo conoce, y aquí sólo se pinta.
  onRecording((on) => $('#insert-voice').classList.toggle('live', on));

  $('#insert-voice').addEventListener('click', () => {
    if (isAnybody()) return;
    void (async () => {
      const block = await startDay(today());
      if (block === null) return;
      speakInto(block, today());
      if (workspace.activePage !== null) await openPage(workspace.activePage);
    })();
  });

  $('#settings').addEventListener('click', () => {
    if (panel.hidden) openSettings();
    else closeSettings();
  });

  /*
   * La configuración se cierra pulsando fuera, igual que el menú del mapa.
   *
   * `mousedown` y no `click`: mientras se edita un token, soltar el ratón fuera
   * del panel tras arrastrar un selector de color llegaría como un clic de
   * cierre, y el panel se iría a mitad de un ajuste.
   */
  document.addEventListener('mousedown', (event) => {
    if (panel.hidden) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('#tokens, #settings') != null) return;
    closeSettings();
  });

  // Escape cierra la configuración, como cierra cualquier cosa abierta encima.
  // Se pregunta a `bindings` y no a la tecla: es la misma lista que la página de
  // configuración enseña, así que lo que dice allí no puede dejar de ser verdad.
  document.addEventListener('keydown', (event) => {
    if (!is('close', event)) return;
    if (!panel.hidden) closeSettings();
    if (mapPanelOpen) setPanel(false);
  });

  /*
   * Deshacer lo último, fuera del editor.
   *
   * Dentro de un campo manda el deshacer del navegador: mientras se escribe,
   * Ctrl+Z tiene que devolver la palabra que se acaba de borrar y no la página
   * al momento anterior. Son dos deshaceres a escalas distintas y cada uno vive
   * donde se le espera.
   */
  document.addEventListener('keydown', (event) => {
    const undoing = is('undo', event);
    const redoing = is('redo', event);
    if (!undoing && !redoing) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable]') !== null) return;
    event.preventDefault();
    void undoLast(undoing ? 'deshacer' : 'rehacer');
  });

}

/**
 * Deshace el último gesto y cuenta qué deshizo.
 *
 * Lo calcula el servidor leyendo el registro hacia atrás —no hay pila de
 * deshacer, no hace falta: los estados anteriores ya están todos guardados— y lo
 * que aplica son operaciones nuevas. Por eso queda dicho quién deshizo y cuándo,
 * y por eso deshacer se puede deshacer.
 */
export async function undoLast(direction: 'deshacer' | 'rehacer' = 'deshacer'): Promise<void> {
  if (workspace.activePage === null) return;
  const said = await api.undo(workspace.activePage, direction);
  if (said.error !== undefined) {
    notice(said.error);
    return;
  }
  if (said.nothing !== undefined) {
    notice(said.nothing);
    return;
  }
  const done = said.done ?? [];
  notice(done.length === 0 ? 'No había nada que deshacer.' : `Deshecho: ${done.join(' · ')}.`);
  // Se rehace la página entera: deshacer un gesto puede haber movido bloques de
  // sitio, devuelto uno que no estaba y cambiado el texto de otro a la vez.
  if (workspace.activePage !== null) await openPage(workspace.activePage);
}

// ---------------------------------------------------------------------------
// Divisor
// ---------------------------------------------------------------------------

function wireDivider(): void {
  const handle = $('#divider');
  let dragging = false;

  handle.addEventListener('pointerdown', (event) => {
    dragging = true;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const at = Math.min(0.85, Math.max(0.15, event.clientX / window.innerWidth));
    workspace.divider = at;
    $('#vera-root').style.setProperty('--divider', String(at));
  });
  handle.addEventListener('pointerup', () => {
    dragging = false;
    session.setDivider(workspace.divider);
    void refreshGraph();
  });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  wireTheme();
  wireSubmissionState();

  /*
   * Quién aplica un cambio en casa antes de que salga a la red.
   *
   * `api` no sabe qué es una réplica y no debe saberlo: es el transporte. Aquí
   * se le dice a quién preguntar, y la respuesta gobierna si el gesto espera.
   * Ver specs/offline-reconciliation.allium, rule AcceptChangeIntoAvailableReplica.
   */
  /*
   * La bandeja durable, antes que nada.
   *
   * Se abre y se restituye lo que hubiera quedado: lo que se estaba mandando
   * vuelve a estar sólo aplicado aquí, porque reenviarlo es inocuo. Después se
   * drena. Ver rule ReturnPendingChangeAfterRestart.
   *
   * Si no hay dónde guardar —navegación privada, permiso denegado— se sigue con
   * un almacén de memoria: perder lo pendiente al cerrar es peor que hoy, pero
   * no poder escribir sería mucho peor que eso.
   */
  void durableOrNot().then(async ({ store, durable }) => {
    outbox = createOutbox(store);
    await outbox.restore();
    api.usesOutbox(outbox);
    if (!durable) {
      notice('Este navegador no deja guardar lo pendiente, así que lo que se escriba sin red se pierde al cerrar.');
    }
    /*
     * Y no se drena aquí.
     *
     * Lo pendiente sale al final del arranque, después de la primera pregunta al
     * corpus. Drenar aquí era una carrera perdida: lo que este aparato tenía sin
     * mandar salía antes de que nadie supiera que el corpus ya había cambiado ese
     * mismo bloque, y ganaba por ser posterior. La otra versión se perdía sin que
     * se dijera, que es lo que rule ExposeConcurrentConflict existe para impedir.
     */
  });

  /*
   * Y cuando vuelve la red, lo que quedó sale solo — y lo que se leía se pone al
   * día.
   *
   * El orden importa: primero drena y después vuelve a abrir. Al revés, la página
   * llegaría del servidor sin lo que todavía está en la bandeja y lo escrito sin
   * red parpadearía fuera de la vista antes de volver.
   *
   * Sólo si lo que hay delante venía de lo retenido. Volver a abrir una página que
   * ya era canónica sería pedirle al servidor algo que no cambió, cada vez que un
   * túnel de metro devuelve la señal.
   */
  /*
   * Y cada tanto, mientras se lee.
   *
   * Un minuto, que es poco para una lectura y mucho para 4 KB. Es lo que hace que
   * el aviso aparezca mientras se está mirando la página y no sólo al abrirla:
   * otra mano puede escribir en cualquier momento, y enterarse al rato es la
   * diferencia entre un aviso y un archivo.
   */
  window.setInterval(() => void catchUpWithCorpus(), 60_000);

  /*
   * Al volver la red: primero se pregunta, después se manda.
   *
   * En ese orden y no al revés. Drenando primero, una edición que este aparato tenía
   * sin mandar salía antes de que nadie supiera que el corpus ya había cambiado ese
   * mismo bloque, y ganaba por ser posterior: la otra versión se perdía sin que se
   * dijera. Preguntando primero, el bloque queda retenido y el aviso se enciende.
   */
  window.addEventListener('online', () => {
    void catchUpWithCorpus().then(() =>
      api.drain().then(() => {
        if (!showingKept || workspace.activePage === null) return;
        void openPage(workspace.activePage);
      }),
    );
  });

  /*
   * Y qué no puede salir mientras haya un desacuerdo sin resolver.
   *
   * Ver `contested`. Se instala aquí, junto a lo demás que el espacio de trabajo le
   * presta al transporte.
   */
  api.holdsBack(
    (pending) => pending.change.kind === 'edit_block' && contested.has(pending.change.block as string),
  );

  api.writesLocally((change, origin) => {
    if (replica === null) return null;
    const said = applyLocally(replica, change, origin);
    if (said.kind === 'defer') return null;
    if (said.kind === 'rejected') return { applied: false, reason: said.reason };
    if (said.staleDerived) derivedStale = true;
    return { applied: true, subjectId: said.subjectId };
  });

  // Lo recordado del participante llega del servidor y puede diferir de lo que
  // este navegador tenía. Se pide después de pintar, no antes: dibujar con lo
  // local es instantáneo, y esperar al servidor haría que abrir Vera empezara
  // por una pantalla en blanco.
  void syncPresentation().then((changed) => {
    if (!changed) return;
    tokens = loadTokens();
    workspace.scheme = isAnybody() ? session.publicScheme() : session.scheme();
    workspace.layout = session.layout();
    workspace.graphView = isAnybody() ? session.publicGraphView() : session.graphView();
    workspace.divider = session.divider();
    applyTokens(tokens, workspace.scheme);
    applyLayout();
  });
  wireSearch();
  wireDivider();

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-layout]')) {
    button.addEventListener('click', () => setLayout(button.dataset['layout'] as WorkspaceLayout));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    button.addEventListener('click', () => {
      workspace.graphView = button.dataset['view'] as GraphViewMode;
      if (isAnybody()) session.setPublicGraphView(workspace.graphView);
      else session.setGraphView(workspace.graphView);
      applyLayout();
    });
  }

  // Atrás y adelante del navegador. Sin esto la dirección cambiaría y la
  // aplicación se quedaría enseñando otra cosa.
  window.addEventListener('popstate', () => void applyRoute());

  // Redibujar el grafo pide datos al servidor: un arrastre del borde de la
  // ventana no puede disparar una petición por cuadro.
  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => applyLayout(), 150);
  });

  /*
   * Lo que este aparato ya tenía, antes de preguntarle nada a la red.
   *
   * rule OpenWorkspaceWithoutTheServer: abrir no puede depender de una respuesta.
   * Se pide primero porque todo lo que viene después quiere poder caer aquí.
   */
  held = await heldHere();

  // El estado del corpus se guarda, no se dibuja: ahora vive en Ajustes →
  // Memoria y se pinta cuando alguien lo abre.
  try {
    corpus = await api.health();
    document.documentElement.dataset['access'] = corpus.access ?? 'owner';
    if (isAnybody()) {
      workspace.trace = [];
      workspace.scheme = session.publicScheme();
      workspace.graphView = session.publicGraphView();
      applyTokens(tokens, workspace.scheme);
    }
    if (isAnybody()) {
      $('#brand').title = 'Portada publicada';
      $('#brand').setAttribute('aria-label', 'Ir a la portada publicada');
    }
    $('#insert-voice').hidden = isAnybody();
    $('#sync-state').hidden = isAnybody();
    if (!isAnybody()) void held.keepCorpus(corpus);
  } catch (error) {
    /*
     * El servidor no está. Si este aparato ya abrió Vera alguna vez, se sigue.
     *
     * Y si no —una instalación nueva, sin nada retenido— no hay nada que enseñar
     * y el fallo sube a `boot`, que es quien sabe avisar y reintentar. Fingir un
     * corpus vacío sería peor que decir que no se pudo: enseñaría una Vera sin
     * páginas a quien tiene mil novecientas.
     */
    const remembered = isAnybody() ? null : await held.corpus();
    if (remembered === null) throw error;
    corpus = remembered;
    showingKept = true;
  }
  // Las palabras del corpus, antes de dibujar nada: la cabecera de una página
  // las necesita para llamar a sus renglones como los llame quien escribe.
  if (corpus?.names !== undefined) nameProperties(corpus.names);
  if (corpus?.embedHosts !== undefined) allowEmbedsFrom(corpus.embedHosts);

  await loadPages();

  applyLayout();
  await applyRoute();

  /*
   * Y ahora sí: primero qué ha pasado, después lo que estaba por salir.
   *
   * En ese orden, y es la última pieza de lo mismo: preguntar es lo que descubre
   * que un bloque tiene dos versiones, y descubrirlo es lo que retiene la mía en la
   * bandeja hasta que alguien elija.
   */
  await catchUpWithCorpus();
  await api.drain();
}

/**
 * Arrancar puede fallar, y hasta ahora fallaba en silencio.
 *
 * `start()` pedía `/health` sin recoger el error: bastaba que el servidor
 * estuviera un segundo caído —un reinicio, la máquina despertando, Tailscale
 * reconectando— para que la promesa se rechazara, no se dibujara nada, y la
 * aplicación quedara en blanco sin decir por qué ni recuperarse sola.
 *
 * Ahora lo dice y lo reintenta. Un servidor que vuelve en unos segundos no
 * debería costar una recarga a mano.
 */
async function boot(attempt = 1): Promise<void> {
  // El aviso del HTML sólo tiene sentido mientras el guion no haya arrancado.
  // Que lo retire esto y no el HTML es lo que lo vuelve fiable: aparece salvo
  // que este código llegue a correr.
  document.querySelector('#sin-arranque')?.remove();
  try {
    await start();
  } catch (error) {
    const why = error instanceof Error ? error.message : 'error desconocido';
    const wait = Math.min(attempt * 2, 10);

    const root = $('#text');
    root.innerHTML = '';
    const message = document.createElement('p');
    message.className = 'notice';
    message.textContent =
      `No se pudo hablar con el servidor de Vera (${why}). ` +
      `Reintentando en ${wait} segundos…`;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'notice-retry';
    retry.textContent = 'reintentar ahora';
    let timer: number | undefined;
    const again = (): void => {
      window.clearTimeout(timer);
      void boot(attempt + 1);
    };
    retry.addEventListener('click', again);
    message.append(' ', retry);
    root.append(message);

    timer = window.setTimeout(again, wait * 1000);
  }
}

if (!handlesSharedAccess()) void boot();

/*
 * Registrar el service worker, y además ocuparse de que se renueve.
 *
 * Registrarlo y nada más basta en una pestaña, que se abre y se cierra todo el
 * tiempo. No basta en una Vera instalada como aplicación del sistema: esa se
 * lanza una vez y se queda semanas abierta, y en ese régimen el navegador sólo
 * va a mirar si hay un worker nuevo cada tantas horas. El código nuevo existía
 * en el servidor y la aplicación seguía corriendo el viejo, sin nada que
 * indicara la diferencia; la única salida era desinstalarla y volver a
 * instalarla, que es pedirle a la persona que haga de mecanismo de despliegue.
 *
 * Así que se pregunta cuando hay motivo para preguntar: al arrancar y cada vez
 * que la ventana vuelve al frente. Es cuando alguien acaba de volver a Vera, y
 * es exactamente cuando conviene que lo que vea ya sea lo último.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      const ask = (): void => {
        if (document.visibilityState === 'visible') void registration.update();
      };
      ask();
      document.addEventListener('visibilitychange', ask);
    });
  });

  /*
   * Un worker nuevo toma el control: la página que está a la vista es vieja.
   *
   * El worker se activa solo —hace `skipWaiting`— pero eso cambia quién sirve
   * los archivos, no lo que ya está corriendo en la ventana. Sin recargar, la
   * aplicación se queda con el JavaScript de la versión anterior hasta que
   * alguien la cierre, que es el problema entero visto desde el otro lado.
   *
   * La guarda del control previo es lo que evita el bucle: en la primera visita
   * el worker también toma el control —no había ninguno— y recargar ahí sería
   * recargar cada vez que alguien abre Vera por primera vez.
   */
  let renewing = false;
  const hadWorker = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadWorker || renewing) return;
    renewing = true;
    window.location.reload();
  });
}

/*
 * Si el compilado que sirve el servidor ya no es el que esta ventana cargó,
 * recargar.
 *
 * Renovar el service worker no alcanza, y conviene entender por qué: el worker
 * se reemplaza cuando cambian los bytes de `sw.js`, y un cambio en una hoja de
 * estilo o en este mismo archivo no lo toca. Con sólo aquello, una Vera
 * instalada y dejada abierta puede pasar semanas corriendo la versión del día
 * que se abrió mientras el servidor sirve otra, sin ninguna señal.
 *
 * Lo que sí distingue una versión de otra es la huella de lo compilado. El
 * `index.html` del servidor nombra el suyo, y compararlo con el que esta
 * ventana está corriendo responde la pregunta exacta: ¿lo que tengo a la vista
 * es todavía lo que hay?
 *
 * Se pregunta al volver al frente, no en un temporizador: recargar es descartar
 * la ventana entera y no puede caer encima de alguien que está escribiendo.
 * Quien acaba de volver de otra aplicación no lo está.
 */
const running = document
  .querySelector<HTMLScriptElement>('script[type="module"][src^="/build/"]')
  ?.getAttribute('src');

/*
 * La hoja de estilo con hash, además del script de entrada.
 *
 * Antes se comparaba sólo el `.js`, y un recompilado que tocara únicamente el
 * CSS —lo más habitual mientras se ajusta la interfaz— dejaba el mismo script:
 * la huella no cambiaba y la ventana se quedaba con el estilo viejo sin
 * enterarse. La hoja también lleva su hash en la ruta, así que mirarla cierra
 * ese hueco sin depender de que el bundle haya cambiado.
 */
const runningCss = document
  .querySelector<HTMLLinkElement>('link[rel="stylesheet"][href^="/build/"]')
  ?.getAttribute('href');

if (running != null) {
  let checking = false;
  let stale = false;

  const compareBuild = async (): Promise<void> => {
    if (checking || stale || document.visibilityState !== 'visible') return;
    checking = true;
    try {
      // `fresh` esquiva al service worker —que si no devolvería su propia copia
      // del index y haría la comparación siempre verdadera— y `no-store` evita
      // que la respuesta se quede en ningún caché: es una pregunta, no un dato.
      const response = await fetch('/index.html?fresh=1', { cache: 'no-store' });
      if (!response.ok) return;
      const html = await response.text();
      const servedJs = /src="(\/build\/[^"]+\.js)"/.exec(html)?.[1];
      const servedCss = /href="(\/build\/[^"]+\.css)"/.exec(html)?.[1];
      // Basta con que cambie uno, el script o la hoja. Se compara sólo lo que el
      // servido nombra: medir contra un `undefined` diría siempre que hay cambio
      // y recargaría en vano ante una respuesta a medias.
      const jsStale = servedJs !== undefined && servedJs !== running;
      const cssStale = servedCss !== undefined && servedCss !== runningCss;
      if (!jsStale && !cssStale) return;
      stale = true;
      window.location.reload();
    } catch {
      // Sin red no hay nada que comparar, y no saber si hay versión nueva no es
      // motivo para molestar a nadie: se vuelve a preguntar la próxima vez.
    } finally {
      checking = false;
    }
  };

  document.addEventListener('visibilitychange', () => void compareBuild());
  window.addEventListener('focus', () => void compareBuild());

  /*
   * Y además cada tanto, porque hay ventanas que nunca hacen ninguna de las dos
   * cosas.
   *
   * Volver al frente y recibir el foco son transiciones: sirven para quien deja
   * Vera y vuelve. No sirven para una Vera instalada que se queda abierta en una
   * segunda pantalla, visible y enfocada durante días — no pierde la visibilidad
   * porque se ve, ni recupera el foco porque nunca lo perdió, así que no había
   * nada que la hiciera preguntar y se quedaba con la versión del día que se
   * abrió. Es exactamente el caso que este mecanismo existe para resolver.
   *
   * Un cuarto de hora entre preguntas: la respuesta son siete kilobytes contra
   * el servidor de uno mismo. La comprobación se abstiene sola si la ventana no
   * está a la vista, así que una dejada de fondo no pregunta nada.
   */
  const CADA = 15 * 60 * 1000;
  window.setInterval(() => void compareBuild(), CADA);
}
