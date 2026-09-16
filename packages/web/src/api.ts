// Cliente HTTP del servidor de Vera.
//
// Toda escritura pasa por submitOperation, igual que en el servidor y en el
// dominio: el cliente no tiene ninguna vía propia para cambiar el grafo.

import type { Trail } from '@vera/core';
import type { GraphData } from './graph/types.ts';
import type { Recording } from './voice.ts';
import type { CanonicalOp } from './behind.ts';
import { nextToSend, type Outbox, type Pending } from './outbox.ts';

export interface PageSummary {
  id: string;
  title: string;
  visibility: 'private' | 'public';
  /** Ruta canónica sólo en el sitio público; nula en la memoria privada. */
  publicationPath?: string | null;
  blockCount: number;
  linkCount: number;
}

export interface YoutubeTranscriptChoice {
  language: string;
  label: string;
  source: 'published' | 'automatic';
  translated: boolean;
  originalLanguage: string | null;
}

export interface YoutubeTranscriptCatalog {
  video: { id: string; title: string; author: string; description: string; originalLanguage: string | null };
  choices: YoutubeTranscriptChoice[];
}

export interface YoutubeTranscriptResult {
  video: { id: string; title: string; author: string; originalLanguage: string | null };
  choice: YoutubeTranscriptChoice;
  segments: { startMs: number; durationMs: number; text: string }[];
}

export interface BlockView {
  stableId: string;
  parent: string | null;
  position: number;
  content: string;
}

export interface PublicationView {
  site: string | null;
  siteTitle: string;
  canonicalDomain: string;
  path: string;
  url: string;
  publishedAt: number | null;
  entryPoint: boolean;
}

export interface PublicationSiteView {
  site: string | null;
  title: string;
  canonicalDomain: string;
  entryPoint: string | null;
  transparentBlockTraceability: boolean;
  previewUrl: string | null;
  projectionError?: string;
  publications: {
    page: string;
    title: string;
    path: string;
    url: string;
    firstRevision: string;
    publishedAt: number;
    publishedBy: string;
    entryPoint: boolean;
  }[];
}

/**
 * Una ruta del Markdown y el objeto al que resuelve. El bloque sigue diciendo
 * `../assets/foo.png`; la traducción ocurre al presentar, así que la fuente no
 * se toca y la proyección Markdown sigue siendo portable fuera de Vera.
 */
export interface AssetView {
  path: string;
  url: string;
  mediaType: string;
  description?: string | null;
  alternativeText?: string | null;
}

export interface CatalogAsset extends AssetView {
  hash: string;
  byteSize: number;
  originalName: string | null;
  createdAt: number;
  usages: { block: string; page: string; pageTitle: string }[];
}

/** Una referencia `((stable_id))` ya resuelta al bloque que nombra. */
export interface BlockRefView {
  id: string;
  page: string;
  excerpt: string;
}

export interface PageView {
  id: string;
  title: string;
  /**
   * La página leída como recorrido, cuando dice que su orden es un argumento.
   *
   * Viaja con la página porque leer un recorrido es leer su página. Nulo en las
   * demás, que son casi todas. Ver packages/core/src/trail.ts.
   */
  trail?: Trail | null;
  visibility: 'private' | 'public';
  /** Nulo cuando esta instancia no tiene un sitio público configurado. */
  publication?: PublicationView | null;
  createdAt: number;
  originCreatedAt: number | null;
  lastEditedAt: number | null;
  properties: { key: string; value: string }[];
  /**
   * Lo que cuelga de cada bloque, por su identidad.
   *
   * Sólo los bloques que llevan alguna. El corpus las trae de Logseq y son lo
   * que sostiene el plazo de una tarea y el testimonio de un cruce.
   */
  blockProperties?: Record<string, { key: string; value: string }[]>;
  /**
   * Lo que el corpus ya contesta a cada clave de esta página, por uso.
   *
   * Es lo que se ofrece en el desplegable. Vocabulario observado y no declarado:
   * la ontología que lo gobernaría todavía no existe, y hasta que exista lo que
   * el corpus dice es mejor guía que una lista inventada.
   */
  domains: Record<string, { value: string; uses: number }[]>;
  blocks: BlockView[];
  /** Vista derivada de una página cuyo tipo es `concepto`. */
  concept?: {
    members: {
      page: string;
      title: string;
      excerpt: string;
      declared: boolean;
      linked: boolean;
      mentioned: boolean;
      formalization: {
        block: string;
        content: string;
        next: string;
        written: string;
      } | null;
    }[];
  } | null;
  assets: AssetView[];
  blockRefs: BlockRefView[];
  /** Los bloques que este participante tiene plegados. No es contenido. */
  folded: string[];
  /** Los títulos nombrados desde esta página que todavía no tienen página. */
  pendingLinks?: string[];
  /** La denominación de origen: qué bloques vinieron de qué grabación. */
  spokenOrigins: { block: string; recording: string }[];
  /**
   * Lo hablado que tiene lugar en esta página: la grabación y el bloque que le
   * guarda el sitio mientras se recorre la cascada.
   *
   * @guarantee NothingSpokenIsStrandedFromTheWriting: viaja con la página para
   * que el audio se vea donde se habló.
   */
  recordings?: Recording[];
  /**
   * De qué mano salió el texto de cada bloque, indexado por su identidad.
   *
   * @invariant GeneratedContentIsAlwaysDistinguishable: viaja con la página, no
   * en una petición aparte, porque distinguir lo escrito de lo generado tiene
   * que costar lo mismo que leer.
   */
  authorship: Record<
    string,
    { participant: string; kind: 'human' | 'agent' | null; channel: string; writtenAt: number }
  >;
  /** La única glosa canónica de cada bloque que la tenga. */
  glosses?: Record<string, { content: string; createdAt: number; updatedAt: number }>;
  backlinks: Backlink[];
  /** A quién nombra esta página: una fila por página nombrada, no por mención. */
  references: Reference[];
  /** Lo que esta página afirma sobre otras. */
  crossingsOut: CrossingRow[];
  /** Y lo que otras afirman sobre ella, leído desde este lado. */
  crossingsIn: CrossingRow[];
}

export interface LibrarianRequestView {
  id: string;
  conversationId: string;
  askedBy: string;
  modality: 'block' | 'page';
  text: string;
  sourcePageId: string | null;
  sourceBlockId: string | null;
  status: 'queued' | 'working' | 'answered' | 'failed' | 'cancelled';
  dispatchStatus: 'pending' | 'delivered' | 'failed';
  dispatchAttempts: number;
  createdAt: number;
  failureReason: string | null;
  reply: null | {
    id: string;
    answeredBy: string;
    text: string;
    createdAt: number;
    proposal: null | {
      id: string;
      changes: Change[];
      status: 'proposed' | 'accepted' | 'rejected';
    };
  };
}

export type PageEnrichment = Pick<
  PageView,
  | 'id'
  | 'domains'
  | 'concept'
  | 'pendingLinks'
  | 'backlinks'
  | 'references'
  | 'crossingsOut'
  | 'crossingsIn'
  | 'trail'
>;

/**
 * Una relación explicada, lista para leerse en su columna.
 *
 * `reads` es el término tal como se lee desde esta página: el término en la
 * columna de salientes y su recíproco en la de entrantes. Lo que A afirma es que
 * contradice a B; lo que B tiene que leer es que es contradicha por A.
 */
export interface CrossingRow {
  /** Identidad estable de la conectiva. */
  stableId: string;
  /** Operación de la revisión cuyo texto se está mostrando. */
  revision: string | null;
  connective: string;
  /** Lo dicho. */
  said: string;
  /** El outline canónico de la relación. */
  blocks: BlockView[];
  /** El bloque desde el que se afirma. */
  fromBlock: string | null;
  fromPage: string;
  /** La página del otro extremo, nula mientras nadie la haya escrito. */
  toPage: string | null;
  targetTitle: string;
  /** Cómo se llama la otra página desde aquí. */
  title: string;
  sense: 'directed';
  term: string | null;
  reads: string | null;
  /** El extracto del bloque desde el que se afirma: el sujeto de la afirmación. */
  says: string;
}

/** Una página que ésta nombra. `page` es nulo mientras nadie la haya escrito. */
export interface Reference {
  page: string | null;
  title: string;
  /** El bloque donde se la nombra por primera vez, que es donde se presenta. */
  block: string;
  excerpt: string;
}

export interface Backlink {
  page: string;
  block: string;
  /** Título de la página que refiere, para poder nombrarla sin otra petición. */
  title: string;
  /** Texto del bloque donde ocurre la referencia. */
  excerpt: string;
}

export interface Hit {
  page: string;
  block: string | null;
  field: string;
  excerpt: string;
  rank: number;
}

/** Un estado por el que pasó un bloque. */
export interface BlockState {
  sequence: number;
  at: number;
  by: string;
  participant: string;
  channel: string;
  what: string;
  content: string | null;
}

export interface BlockHistory {
  block: string;
  alive: boolean;
  now: string | null;
  states: BlockState[];
}

/** Una propiedad declarada, con qué clase de campo es. */
export interface PropertyDeclared {
  /**
   * El bloque que la declara, por su identidad estable.
   *
   * Es lo que permite que la tabla de la página especial no sea una copia:
   * corregir una celda escribe en el bloque del que salió, y no en un sitio
   * aparte que después habría que reconciliar.
   */
  block: string;
  name: string;
  field: string | null;
  many: boolean;
  role: string | null;
  /**
   * De qué cuelga: de un bloque o de una página.
   *
   * Lo declara el corpus con `sujeto::` y, si no lo dice, sale del papel. Es lo
   * que permite leer `término` como lo que es —una clave que un bloque escribe
   * para explicar una relación entre dos páginas— y no como un atributo de una
   * página al lado de `cargo`.
   */
  subject: 'bloque' | 'página';
  values: string[];
  says: string | null;
  /**
   * Cuántas veces la usa el corpus. Declarar no es usar: de las declaradas aquí,
   * la mitad no aparece en ninguna página, y ofrecerlas todas con el mismo peso
   * es lo que volvía inservible el menú de `+ propiedad`.
   */
  uses: number;
}

/** Una clase de cosa, con qué propiedades la constituyen. */
export interface ObjectDeclared {
  /** El bloque que la declara. Ver `PropertyDeclared.block`. */
  block: string;
  name: string;
  properties: string[];
  /**
   * Qué papel del código cumple esta clase, si cumple alguno.
   *
   * Una clase puede cumplir uno: `day` no nombra una propiedad sino la clase con
   * que nace un día. Ver `ObjectDeclaration.role`.
   */
  role: string | null;
  says: string | null;
}

export interface OntologyView {
  properties: PropertyDeclared[];
  objects: ObjectDeclared[];
  relations: {
    block: string;
    name: string;
    inverse: string;
    domain: string[];
    range: string[];
    symmetric: boolean | null;
    transitive: boolean | null;
    status: string | null;
    says: string | null;
    external: string[];
  }[];
  names: Record<string, string>;
  fields: string[];
  /** Las que el corpus usa sin haberlas declarado, con cuántas veces. */
  undeclared: { key: string; uses: number }[];
}

/** Lo que se sabe de una clave guardada sin enseñarla. */
export interface ServiceSecret {
  name: string;
  /** Los últimos caracteres, para reconocerla. Vacío si es demasiado corta. */
  tail: string;
  savedAt: number;
  lastUsedAt: number | null;
}

/** Una conexión con algo de fuera, gobernada por una página del corpus. */
export interface ServiceView {
  id: string;
  title: string;
  service: string;
  library: string | null;
  collections: string[];
  secrets: ServiceSecret[];
  /** Cuántas páginas del corpus vinieron de ahí. Se cuenta, no se guarda. */
  pages: number;
}

export interface ServiceCheck {
  page: string;
  service: string;
  library: string;
  declared: boolean;
  identity: {
    userId: number;
    username: string;
    access: { library: boolean; notes: boolean; write: boolean; groups: number };
  };
}

/** Un ítem bibliográfico tal como se ofrece para citarlo. */
export interface ServiceItem {
  key: string;
  version: number;
  itemType: string;
  title: string;
  creators: string[];
  date: string | null;
  publication: string | null;
  publisher: string | null;
  doi: string | null;
  isbn: string | null;
  url: string | null;
  abstract: string | null;
  tags: string[];
  /** Si ya está en el corpus, qué página es. Nulo si todavía no vino. */
  alreadyHere: { page: string; version: number } | null;
}

export interface ServiceSearch {
  page: string;
  library: string;
  total: number;
  items: ServiceItem[];
}

export interface BroughtItem {
  page: string;
  title: string;
  created: boolean;
  refreshed: boolean;
}

export type Change =
  | {
      kind: 'create_page';
      title: string;
      visibility: 'private' | 'public';
      /** El nombre que le pone quien la crea. Ver `named` y `mint`. */
      stableId?: string | undefined;
    }
  | { kind: 'rename_page'; page: string; title: string }
  | { kind: 'set_page_visibility'; page: string; visibility: 'private' | 'public' }
  | { kind: 'recover_page_origin'; page: string; originCreatedAt: number }
  // Sólo se borra una página vacía. Vaciarla es una secuencia de `remove_block`,
  // cada uno ordenado y auditable por separado, y ese es el punto: borrar una
  // página no es un acto único que se traga cuanto hubiera dentro sin dejar
  // rastro de qué había.
  | { kind: 'remove_page'; page: string }
  | {
      kind: 'create_block';
      page: string;
      crossing?: string | undefined;
      parent: string | null;
      position: number;
      content: string;
      /** El nombre que le pone quien lo crea. Ver `named` y `mint`. */
      stableId?: string | undefined;
    }
  | { kind: 'edit_block'; block: string; content: string }
  // Indentar, desindentar y mudar a los hijos de un bloque que se fusiona son
  // todos el mismo cambio: el bloque pasa a colgar de otro padre, en un índice.
  | { kind: 'move_block'; block: string; page: string; crossing?: string | undefined; parent: string | null; position: number }
  | { kind: 'remove_block'; block: string }
  | { kind: 'set_block_gloss'; block: string; content: string }
  | {
      kind: 'create_crossing';
      fromPage: string;
      toPage: string;
      content: string;
      term?: string | undefined;
      stableId?: string | undefined;
    }
  | { kind: 'edit_crossing'; crossing: string; content: string; term?: string | undefined }
  // El front matter de una página son propiedades, y se editan como todo lo
  // demás: enviando una operación.
  | { kind: 'set_property'; page?: string; block?: string; propertyKey: string; propertyValue: string }
  | { kind: 'remove_property'; page?: string; block?: string; propertyKey: string };

/** Una página que cumple una pregunta, con lo que hace falta para leerla. */
export interface QueryHit {
  id: string;
  title: string;
  /** Lo que la página dice ser, para la columna de la tabla. Puede no decirlo. */
  type: string | null;
  /** De qué trata, ya partido: cada respuesta es una y lleva a su página. */
  topic: string[];
  /** Cuándo nació. */
  created: number;
  /** Cuándo se la tocó por última vez. */
  updated: number | null;
  /** Dónde lo dice, cuando la pregunta era por texto. */
  says: { block: string; excerpt: string } | null;
}

export interface QueryBlockHit {
  id: string;
  content: string;
  parent: string | null;
  position: number;
  page: { id: string; title: string };
}

export interface ActivityItem {
  sequence: number;
  at: number;
  by: string;
  participant: string;
  channel: string;
  kind: Change['kind'];
  subjectId: string;
  page: { id: string; title: string } | null;
  block: string | null;
  summary: string;
  excerpt: string | null;
}

export interface DeletedPageActivity {
  page: string;
  title: string;
  deletedAt: number;
  sequence: number;
  by: string;
  participant: string;
  blocks: number;
  restorable: boolean;
  refusal: string | null;
  changes: Change[];
}

export interface ActivityView {
  activity: ActivityItem[];
  deletedPages: DeletedPageActivity[];
  participant: { id: string; name: string; kind: 'human' | 'agent' } | null;
  nextBefore: number | null;
}

/** Por qué columna se está mirando una tabla, y en qué sentido. */
export interface QuerySort {
  by: 'title' | 'type' | 'topic' | 'created' | 'updated';
  desc: boolean;
}

export type QueryAnswer =
  | {
      view: 'list' | 'table';
      /** La pregunta tal como Vera la entendió, vuelta a escribir. */
      asked: string;
      /** Cómo llama este corpus a lo que las columnas enseñan. */
      names: { kind: string; topic: string };
      sort: QuerySort;
      count: number;
      pages: QueryHit[];
      /** Cuántas cumplen y no viajaron. Recortar en silencio sería mentir. */
      more: number;
    }
  | {
      view: 'blocks';
      asked: string;
      count: number;
      blocks: QueryBlockHit[];
      more: number;
    }
  | { error: string; at: number; near: string };

export type SubmitResult =
  | { status: 'applied'; sequence: number; subjectId: string }
  | { status: 'duplicate'; sequence: number; subjectId: string }
  | { status: 'rejected'; reason: string };

export type SubmissionActivity =
  /**
   * Aplicado en casa, todavía sin viajar.
   *
   * No es «guardando»: es que ya está hecho donde se está trabajando, y lo que
   * falta es que otros aparatos se enteren. Mientras la bandeja no sea durable
   * —paso 3 de docs/plan-local-first.md— esto sigue siendo una promesa que
   * cerrar la pestaña rompe, y por eso se dice aparte de `synchronised`.
   */
  | { phase: 'local'; originId: string }
  | { phase: 'sending'; originId: string; startedAt: number }
  | { phase: 'synchronised'; originId: string; durationMs: number; sequence: number }
  | { phase: 'proposed'; originId: string; durationMs: number; proposal: string }
  | { phase: 'rejected'; originId: string; durationMs: number; reason: string }
  | { phase: 'offline'; originId: string; durationMs: number };

const submissionListeners = new Set<(activity: SubmissionActivity) => void>();

/**
 * Observa el trayecto de una escritura sin gobernarlo.
 *
 * La fase local-first completa tendrá una bandeja durable. Mientras tanto esto
 * hace visible la verdad del cliente actual: la operación está viajando, fue
 * confirmada, rechazada o ni siquiera alcanzó el servidor.
 */
export function onSubmissionActivity(listener: (activity: SubmissionActivity) => void): () => void {
  submissionListeners.add(listener);
  return () => submissionListeners.delete(listener);
}

function reportSubmission(activity: SubmissionActivity): void {
  for (const listener of submissionListeners) listener(activity);
}

/**
 * Identificador de origen. Se genera aquí, en el dispositivo, porque es la
 * clave de idempotencia: reenviar la misma operación tras un corte de red no
 * puede aplicarla dos veces.
 */
function originId(): string {
  return `web:${crypto.randomUUID()}`;
}

/**
 * La identidad de lo que se acaba de crear, acuñada aquí.
 *
 * Sin coordinación con nadie, porque coordinarse es esperar. El servidor cuenta
 * —`block:1`, `block:2`— y por eso ésta no cuenta: un sufijo que no es un número
 * no puede chocar con el suyo ni mover su contador, que sólo mira los números
 * para no repetirlos. Ver `#observeId` en graph.ts.
 *
 * @invariant TheHandNeverWaitsForTheNetwork: sin esto, crear algo obliga a
 * preguntar cómo se llama lo creado, y preguntar es esperar.
 */
export function mint(prefix: 'block' | 'page'): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

/**
 * Un cambio que crea algo, con el nombre de lo que crea ya puesto.
 *
 * Lo que ya venía bautizado se respeta: la importación trae los identificadores
 * que el corpus tenía en Logseq, y reescribirlos rompería las referencias que
 * existían fuera de Vera.
 */
export function named(change: Change): Change {
  if (change.kind === 'create_block' && change.stableId === undefined) {
    return { ...change, stableId: mint('block') };
  }
  if (change.kind === 'create_page' && change.stableId === undefined) {
    return { ...change, stableId: mint('page') };
  }
  return change;
}

/**
 * Quién aplica un cambio en casa antes de que salga a la red.
 *
 * Lo instala el espacio de trabajo, que es quien sostiene la réplica de la página
 * abierta; `api` no sabe qué es una réplica y no debe saberlo. Devolver `null`
 * —o que no haya ninguno puesto— deja el camino de siempre: preguntar y esperar.
 */
export type LocalWrite = (
  change: Change,
  originId: string,
) => { applied: true; subjectId: string } | { applied: false; reason: string } | null;

let writeLocally: LocalWrite | null = null;
let proposeInsteadOfWriting = false;

function setLocalWriter(writer: LocalWrite | null): void {
  writeLocally = writer;
}

/**
 * La bandeja durable, cuando el espacio de trabajo la instala.
 *
 * Sin bandeja todo sigue funcionando: se aplica en casa y se manda, y lo que no
 * llegue se pierde al cerrar. Con bandeja, no. Ver outbox.ts.
 */
let outbox: Outbox | null = null;
let draining = false;

function usesOutbox(box: Outbox | null): void {
  outbox = box;
}

/**
 * Manda lo pendiente, de uno en uno y en su orden.
 *
 * De uno en uno porque el orden es parte de lo que se está mandando: crear un
 * bloque y escribir dentro sólo tienen sentido juntos, y en paralelo el segundo
 * llegaría a un sitio que todavía no existe.
 *
 * Sin red se para y se queda todo donde está. No hay reintento con espera
 * creciente ni nada parecido: quien vuelve a intentarlo es el navegador cuando
 * avisa de que hay red otra vez, y mientras tanto insistir sólo gastaría batería.
 */
/**
 * Lo que no puede salir todavía porque hay una decisión pendiente.
 *
 * Lo instala el espacio de trabajo. Sin esto, al volver la red lo pendiente se
 * mandaba antes de que nadie preguntara nada, y una edición propia pisaba en
 * silencio la que otra mano había hecho entretanto — que es exactamente la pérdida
 * que rule ExposeConcurrentConflict existe para impedir. Se vio en el navegador y
 * no en una prueba: el drenaje le ganaba a la pregunta por una carrera.
 *
 * No se descarta ni se marca como rechazado: se queda donde está, intacto, hasta
 * que el desacuerdo se resuelva. Retener no es perder.
 */
let heldBack: (pending: Pending) => boolean = () => false;

function holdsBack(fn: (pending: Pending) => boolean): void {
  heldBack = fn;
}

async function drain(): Promise<void> {
  if (draining || outbox === null) return;
  draining = true;
  try {
    for (;;) {
      const box = outbox;
      if (box === null) return;
      const next = nextToSend(box.pending().filter((one) => !heldBack(one)));
      if (next === null) return;

      await box.mark(next.originId, 'sending');
      let said: SubmitResult;
      try {
        // `api` todavía no está construido cuando esto se define, y sí lo está
        // cuando esto corre: el drenaje siempre ocurre después de una escritura.
        said = await api.send(next.change, next.channel, next.originId);
      } catch {
        // No llegó. Vuelve a estar sólo aplicado aquí, que es la verdad, y
        // reenviarlo después es inocuo porque el origen es la llave.
        await box.mark(next.originId, 'local');
        return;
      }

      if (said.status === 'rejected') {
        // @invariant PreserveRejectedLocalChange: se queda con su motivo. Y se
        // sigue con el resto: un rechazo no detiene lo que no depende de él.
        await box.mark(next.originId, 'rejected', said.reason);
        continue;
      }
      await box.settle(next.originId);
    }
  } finally {
    draining = false;
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(
    path,
    init === undefined
      ? undefined
      : init.method === undefined
        ? init
        : { headers: { 'content-type': 'application/json' }, ...init },
  );
  /*
   * Un error del servidor viaja con su explicación, y la explicación importa.
   *
   * Una negativa de cerco dice qué cerco es y qué quedaba fuera —@guarantee
   * RefusalsSayWhy—, y perderla para dejar sólo «403 en /agents/…» obligaría a
   * abrir la consola de red para saber qué pasó.
   */
  if (!response.ok) {
    const said = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(said?.error ?? `${response.status} en ${path}`);
  }
  return (await response.json()) as T;
}

/**
 * Lo que el grafo dice de sí mismo.
 *
 * Tiene nombre propio porque ya no se usa sólo al arrancar: se retiene en el
 * aparato para poder abrir Vera sin servidor, y una forma anónima no se puede
 * nombrar en la firma de quien la guarda. Ver `held.ts`.
 */
export interface CorpusHealth {
  graph: string;
  /** `anybody` es la sesión pública anónima y nunca puede escribir. */
  access?: 'owner' | 'anybody';
  /** Una sesión invitada puede escribir sin dejar de estar cercada al espacio. */
  canEdit?: boolean;
  /** Una sesión invitada puede proponer sin modificar todavía el corpus. */
  canContribute?: boolean;
  /** Falso en el origen público: anybody nunca puede elevarse desde allí. */
  canViewOwner?: boolean;
  /** Portada del sitio cuando la lectura ocurre por el origen público. */
  entryPoint?: string | null;
  /** La superficie pública permite abrir la historia pública desde la viñeta. */
  transparentBlockTraceability?: boolean;
  pages: number;
  blocks: number;
  lastSequence: number;
  /** Cómo llama este corpus a las propiedades que Vera necesita conocer. */
  names: {
    kind: string;
    topic: string;
    explains: string;
    term: string;
    sense: string;
    day: string;
    created: string;
    updated: string;
    visible: string;
  };
  /** Y de qué servidores acepta incrustaciones. */
  embedHosts?: string[];
}

export const api = {
  health: async (): Promise<CorpusHealth> => {
    const health = await json<CorpusHealth>('/health');
    proposeInsteadOfWriting = health.canContribute === true && health.canEdit !== true;
    return health;
  },

  /** Incorpora el estado y los objetos de otro archivo portable de Vera. */
  importVera: async (
    file: File,
  ): Promise<{ pages: number; assets: number; operations: number } | { error: string; detail?: string }> => {
    try {
      const response = await fetch('/import/vera', {
        method: 'POST',
        headers: {
          'content-type': 'application/vnd.vera.graph+json',
          'x-filename': encodeURIComponent(file.name),
        },
        body: await file.arrayBuffer(),
      });
      const body = await response.json() as { pages?: number; assets?: number; operations?: number; error?: string; detail?: string };
      return response.ok
        ? { pages: body.pages ?? 0, assets: body.assets ?? 0, operations: body.operations ?? 0 }
        : { error: body.error ?? `error ${response.status}`, ...(body.detail === undefined ? {} : { detail: body.detail }) };
    } catch {
      return { error: 'sin conexión con el servidor' };
    }
  },

  pages: () => json<PageSummary[]>('/pages'),

  askLibrarian: (said: { pageId: string; blockId?: string; text: string }) =>
    json<LibrarianRequestView>('/librarian/requests', {
      method: 'POST',
      body: JSON.stringify(said),
    }),

  librarianRequests: (pageId: string, blockId?: string | null) => {
    const query = new URLSearchParams({ page: pageId });
    if (blockId !== undefined) query.set('block', blockId ?? '');
    return json<LibrarianRequestView[]>(`/librarian/requests?${query.toString()}`);
  },

  /*
   * Las conexiones con servicios de fuera.
   *
   * Cada una es una página especial del corpus; lo que viaja aquí es lo que de
   * ella se puede saber sin abrirla, incluido el estado de su clave —que está
   * guardada o no lo está, cuándo se usó, y sus últimos caracteres— pero nunca
   * la clave. Ver specs/service-connections.allium.
   */
  services: () => json<ServiceView[]>('/services'),

  /*
   * La puerta MCP: lo que su página declara y lo que el registro observó.
   *
   * Las dos cosas juntas porque la página las pone en la misma fila, y ahí está
   * lo que hay que ver: dónde lo decidido y lo que pasa no coinciden.
   */
  mcp: () => json<MCPView>('/mcp'),

  applyDiscards: (decisions: readonly DiscardDecision[]) =>
    json<{ applied: DiscardDecision[] }>('/mcp/discards', {
      method: 'POST',
      body: JSON.stringify({ decisions }),
    }),

  /*
   * Las credenciales, sin secretos: @guarantee TheSecretIsShownOnce.
   *
   * El secreto sólo viaja en la respuesta de `issueCredential`, la única vez que
   * existe fuera de su resumen. Si se pierde, se emite otra y se retira ésta; no
   * hay forma de volver a leerlo y es a propósito.
   */
  credentials: () => json<CredentialView[]>('/agents/credentials'),

  issueCredential: (said: {
    participant: string;
    scopes: string[];
    label: string;
  }): Promise<(CredentialView & { secret: string }) | { error: string }> =>
    json('/agents/credentials', { method: 'POST', body: JSON.stringify(said) }),

  revokeCredential: (id: string) =>
    json<CredentialView>(`/agents/credentials/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
    }),

  /** Cercar una credencial: qué clase puede plantar y con qué se marca lo suyo. */
  confine: (id: string, said: { kind: string; source: string | null }) =>
    json(`/agents/credentials/${encodeURIComponent(id)}/confinement`, {
      method: 'POST',
      body: JSON.stringify(said),
    }),

  /** Y quitarle el cerco, que es ampliarle el permiso y no retirárselo. */
  unconfine: (id: string) =>
    json(`/agents/credentials/${encodeURIComponent(id)}/confinement`, { method: 'DELETE' }),

  /** Admitir un agente al grafo, para poder emitirle una credencial. */
  admitAgent: (said: { id: string; name: string }) =>
    json('/agents', { method: 'POST', body: JSON.stringify(said) }),

  /**
   * Conectar una IA nueva: participante, credencial, cerco y su fila, de una vez.
   *
   * Cinco escrituras y ninguna sirve sola, así que van juntas y en el servidor.
   * Devuelve el secreto, y es la única vez que sale: ver TheSecretIsShownOnce.
   */
  connect: (said: {
    name: string;
    client: string;
    deal: 'leer' | 'propio' | 'todo';
    kind?: string;
    source?: string;
    says?: string;
  }) =>
    json<CredentialView & { secret: string; block: string; participant: string; client: string }>(
      '/mcp/connections',
      { method: 'POST', body: JSON.stringify(said) },
    ),

  /**
   * La clave entera, cuando su dueño pulsa el ojo.
   *
   * Se pide aparte y no viaja con la página: así no está en la respuesta que el
   * navegador guarda ni en la que uno pega al depurar. Y queda anotada en el
   * registro de exposición, porque mirar una clave es de lo que uno quiere poder
   * ver que ocurrió.
   */
  revealSecret: async (page: string, name = 'clave'): Promise<string | { error: string }> => {
    const answer = await fetch(
      `/services/${encodeURIComponent(page)}/secret?name=${encodeURIComponent(name)}`,
    );
    const said = (await answer.json()) as { secret?: string; error?: string };
    if (!answer.ok || typeof said.secret !== 'string') {
      return { error: said.error ?? 'no se pudo leer la clave' };
    }
    return said.secret;
  },

  /**
   * De qué está hecho este corpus: sus propiedades y sus objetos.
   *
   * Sale de las dos páginas que lo declaran y se pide cuando hace falta, no al
   * arrancar: se editan como cualquier otra página, y una copia guardada al
   * principio de la sesión diría lo de antes.
   */
  ontology: () => json<OntologyView>('/ontology'),

  /**
   * Todo lo que un bloque dijo, y cuándo.
   *
   * Sale del registro, que ya lo tenía. No había forma de mirarlo sin abrir la
   * base de datos, y un corpus que promete que nada se pierde tiene que poder
   * enseñarlo: si no, la promesa hay que creérsela.
   */
  history: (block: string) =>
    json<BlockHistory>(`/blocks/${encodeURIComponent(block)}/history`),

  /**
   * Qué se desharía, sin deshacerlo.
   *
   * Existe para poder decirlo antes: «deshacer» a secas obliga a mirar la
   * pantalla después para saber qué pasó.
   */
  whatUndo: (page: string) =>
    json<{ says?: string[]; nothing?: string; operations?: number }>(
      `/undo?pagina=${encodeURIComponent(page)}`,
    ),

  /**
   * Y deshacerlo, que son operaciones nuevas y no un borrado del registro.
   *
   * Sobre la página que se está mirando: deshacer es «vuelve esto al momento
   * anterior», y «esto» es lo que se tiene delante.
   */
  undo: async (
    page: string,
    direction: 'deshacer' | 'rehacer' = 'deshacer',
  ): Promise<{ done?: string[]; nothing?: string; error?: string }> => {
    const again = direction === 'rehacer' ? '&rehacer' : '';
    const answer = await fetch(`/undo?pagina=${encodeURIComponent(page)}${again}`, {
      method: 'POST',
    });
    return (await answer.json().catch(() => ({ error: 'no se pudo deshacer' }))) as {
      done?: string[];
      nothing?: string;
      error?: string;
    };
  },

  /**
   * Guarda la clave de un servicio.
   *
   * No pasa por `POST /operations` y es deliberado: no es una operación, no deja
   * revisión y no viaja al Markdown ni a la proyección. El log es append-only, y
   * una clave escrita en él no se puede desescribir nunca.
   */
  saveSecret: async (page: string, secret: string, name = 'clave'): Promise<ServiceSecret[] | { error: string }> => {
    const answer = await fetch(`/services/${encodeURIComponent(page)}/secret`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, secret }),
    });
    const said = (await answer.json().catch(() => ({}))) as { secrets?: ServiceSecret[]; error?: string };
    return answer.ok && said.secrets !== undefined ? said.secrets : { error: said.error ?? 'no se pudo guardar' };
  },

  /** La borra de verdad: aquí olvidar significa olvidar. */
  forgetSecret: async (page: string, name = 'clave'): Promise<boolean> => {
    const answer = await fetch(
      `/services/${encodeURIComponent(page)}/secret?name=${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
    return answer.ok;
  },

  checkService: async (page: string): Promise<ServiceCheck | { error: string }> => {
    const answer = await fetch(`/services/${encodeURIComponent(page)}/check`, { method: 'POST' });
    const said = (await answer.json().catch(() => ({}))) as ServiceCheck & { error?: string };
    return answer.ok ? said : { error: said.error ?? 'no se pudo probar la conexión' };
  },

  searchService: async (page: string, text: string): Promise<ServiceSearch | { error: string }> => {
    const answer = await fetch(
      `/services/${encodeURIComponent(page)}/search?q=${encodeURIComponent(text)}`,
    );
    const said = (await answer.json().catch(() => ({}))) as ServiceSearch & { error?: string };
    return answer.ok ? said : { error: said.error ?? 'no se pudo buscar' };
  },

  bringItem: async (page: string, item: string): Promise<BroughtItem | { error: string }> => {
    const answer = await fetch(`/services/${encodeURIComponent(page)}/bring`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item }),
    });
    const said = (await answer.json().catch(() => ({}))) as BroughtItem & { error?: string };
    return answer.ok ? said : { error: said.error ?? 'no se pudo traer' };
  },

  /**
   * Una página del corpus.
   *
   * `within` acota la espera cuando quien pregunta no puede quedarse colgado. Un
   * `fetch` no tiene plazo por omisión: sobre un túnel, una conexión que se queda a
   * medias no falla ni contesta, y quien la espera se queda esperando para siempre.
   * Eso convertía «traer lo que cambió» en un botón que se apagaba y no volvía.
   */
  page: (id: string, within?: number) =>
    json<PageView>(
      `/pages/${encodeURIComponent(id)}`,
      within === undefined ? undefined : { signal: AbortSignal.timeout(within) },
    ),

  /**
   * La parte que hace que una página ya sea una página: título, propiedades
   * y escritura. Las lecturas que exigen mirar el resto del grafo llegan por
   * `page` después, sin mantener este primer bloque detrás de ellas.
   */
  readablePage: (id: string, signal?: AbortSignal) =>
    json<PageView>(
      `/pages/${encodeURIComponent(id)}?stage=readable`,
      signal === undefined ? undefined : { signal },
    ),

  /** Sólo lo derivado del resto del grafo; nunca retransmite la escritura. */
  pageEnrichment: (id: string, signal?: AbortSignal) =>
    json<PageEnrichment>(
      `/pages/${encodeURIComponent(id)}?stage=enrichment`,
      signal === undefined ? undefined : { signal },
    ),

  publish: (page: string, path: string, entryPoint = false) =>
    json<PublicationView>(`/publications/${encodeURIComponent(page)}`, {
      method: 'POST',
      body: JSON.stringify({ path, entryPoint }),
    }),

  unpublish: (page: string) =>
    json<PublicationView>(`/publications/${encodeURIComponent(page)}`, { method: 'DELETE' }),

  publicationSite: () => json<PublicationSiteView>('/publication-site'),

  configurePublicationSite: (input: {
    title: string;
    canonicalDomain: string;
    entryPoint: string | null;
    transparentBlockTraceability: boolean;
  }) =>
    json<PublicationSiteView>('/publication-site', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  /** Las páginas que gobiernan a Vera, por lo que declaran gobernar. */
  specialPages: () => json<{ id: string; title: string; kind: string }[]>('/special-pages'),

  search: (text: string) => json<Hit[]>(`/search?q=${encodeURIComponent(text)}`),

  youtubeTranscripts: (url: string) =>
    json<YoutubeTranscriptCatalog>(`/youtube/transcripts?url=${encodeURIComponent(url)}`),

  youtubeTranscript: async (
    url: string,
    choice: YoutubeTranscriptChoice,
  ): Promise<YoutubeTranscriptResult> => {
    const response = await fetch('/youtube/transcripts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, language: choice.language, source: choice.source }),
    });
    const body = await response.json() as YoutubeTranscriptResult & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `error ${response.status}`);
    return body;
  },

  /**
   * Le pregunta al grafo.
   *
   * La pregunta va en el cuerpo y no en la dirección: una dirección se guarda
   * —en el historial, en lo que se copia al compartir— y una consulta puede
   * nombrar a una persona o un asunto que no tiene por qué quedar escrito fuera
   * del corpus.
   */
  query: async (source: string, sort?: QuerySort): Promise<QueryAnswer> => {
    try {
      const response = await fetch('/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // El orden viaja aparte de la pregunta: es cómo se está mirando y no qué
        // se seleccionó, así que no se escribe en el bloque de nadie.
        body: JSON.stringify(sort === undefined ? { source } : { source, sort }),
      });
      return (await response.json()) as QueryAnswer;
    } catch {
      return { error: 'no se pudo preguntar: el servidor no contestó', at: 0, near: '' };
    }
  },

  /**
   * Trae un documento de fuera y devuelve la página que salió de él.
   *
   * Los bytes van en el cuerpo y el nombre en una cabecera, como en las
   * grabaciones: al lado de un binario no cabe nada más. El nombre se codifica
   * porque una cabecera HTTP no admite acentos, y los archivos de alguien que
   * escribe en español los llevan.
   */
  importDocument: async (
    file: File,
  ): Promise<
    { page: string; title: string; blocks: number; format: string; losses: string[] } | { error: string }
  > => {
    try {
      const response = await fetch('/import', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-filename': encodeURIComponent(file.name),
        },
        body: await file.arrayBuffer(),
      });
      const body = (await response.json()) as { error?: string } & Record<string, unknown>;
      if (!response.ok) return { error: body.error ?? `error ${response.status}` };
      return body as unknown as { page: string; title: string; blocks: number; format: string; losses: string[] };
    } catch {
      return { error: 'sin conexión con el servidor' };
    }
  },

  uploadMedia: async (file: File): Promise<AssetView | { error: string }> => {
    try {
      const response = await fetch('/media', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-filename': encodeURIComponent(file.name || 'archivo'),
        },
        body: await file.arrayBuffer(),
      });
      const body = (await response.json()) as AssetView & { error?: string };
      return response.ok ? body : { error: body.error ?? `error ${response.status}` };
    } catch {
      return { error: 'sin conexión con el servidor' };
    }
  },

  media: () => json<CatalogAsset[]>('/media'),

  deleteMedia: async (hash: string): Promise<{ deleted: true } | { error: string }> => {
    const response = await fetch(`/media/${encodeURIComponent(hash)}`, { method: 'DELETE' });
    return await response.json() as { deleted: true } | { error: string };
  },

  describeMedia: async (
    hash: string,
    metadata: { description: string; alternativeText: string },
  ): Promise<{ description: string | null; alternativeText: string | null } | { error: string }> => {
    try {
      const response = await fetch(`/media/${encodeURIComponent(hash)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(metadata),
      });
      const body = (await response.json()) as { description?: string | null; alternativeText?: string | null; error?: string };
      return response.ok
        ? { description: body.description ?? null, alternativeText: body.alternativeText ?? null }
        : { error: body.error ?? `error ${response.status}` };
    } catch {
      return { error: 'sin conexión con el servidor' };
    }
  },

  /**
   * Plegar no es un cambio del grafo, así que no pasa por submit: no genera
   * operación ni revisión, y por eso tiene su propia ruta.
   */
  fold: (block: string, folded: boolean) =>
    fetch('/folds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ block, folded }),
    }),

  graph: (centre: string, depth: number, published = false, signal?: AbortSignal) =>
    json<GraphData>(
      `/graph/${encodeURIComponent(centre)}?depth=${depth}${published ? '&published=1' : ''}`,
      signal === undefined ? undefined : { signal },
    ),

  /**
   * Qué ha pasado en el corpus desde una posición del registro.
   *
   * La pregunta barata, y la única que se hace sola. Contesta con las operaciones
   * —pequeñas: las últimas veinte del corpus real son 3,8 KB— y no con las páginas
   * que tocaron, que no lo son: una muy escrita son 512 KB.
   * @guarantee KnowingIsCheapAndTakingIsNot. Ver behind.ts.
   */
  ops: (since: number) =>
    json<CanonicalOp[]>(`/ops?since=${since}`, { signal: AbortSignal.timeout(8_000) }),

  /** El log canónico plegado como registro humano, incluidas sus tumbas. */
  activity: (before?: number, participant?: string | null) => {
    const query = new URLSearchParams();
    if (before !== undefined) query.set('before', String(before));
    if (participant != null && participant !== '') query.set('participant', participant);
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    return json<ActivityView>(`/activity${suffix}`);
  },

  /**
   * Escritura destructiva o restauradora confirmada por el corpus.
   * No pasa por la cola local: el siguiente paso sólo empieza cuando éste ya
   * tiene secuencia canónica. Así una página nunca se intenta quitar antes de
   * que el servidor haya quitado sus bloques.
   */
  submitConfirmed(
    change: Change,
    channel: 'typed_text' | 'drawn' | 'walked' = 'typed_text',
  ): Promise<SubmitResult> {
    return this.send(named(change), channel, originId());
  },

  /**
   * Escribe un cambio.
   *
   * El canal dice cómo se produjo lo que va dentro, y casi siempre es tecleado.
   * `drawn` es la excepción que hay que nombrar: lo hecho con la mano sobre una
   * pantalla llega con denominación de origen humana, como una grabación, y el
   * bloque lo conserva. Ver specs/hand-drawing.allium.
   */
  /**
   * Quién aplica un cambio en casa antes de que salga a la red.
   *
   * Lo instala el espacio de trabajo, que es quien sostiene la réplica de la
   * página abierta. Sin nadie puesto, todo sigue el camino de siempre.
   */
  writesLocally: setLocalWriter,

  /** Dónde queda lo pendiente para que sobreviva a cerrar. Ver outbox.ts. */
  usesOutbox,
  /** Qué no puede salir mientras haya un desacuerdo que resolver. */
  holdsBack,
  /** Manda lo que quede pendiente. Lo llama el arranque y la vuelta de la red. */
  drain,

  async submit(
    change: Change,
    /*
     * `walked` es la otra excepción: lo que Vera transcribe de por dónde se
     * pasó al promover un rastro. No lo tecleó nadie y no lo generó un modelo;
     * ocurrió. Ver promote.ts y specs/trail.allium.
     */
    channel: 'typed_text' | 'drawn' | 'walked' = 'typed_text',
  ): Promise<SubmitResult> {
    const origin = originId();

    /*
     * Lo que se crea se bautiza aquí, siempre.
     *
     * Y «siempre» no es por gusto: sin esto, la réplica le pone al bloque nuevo
     * el nombre que dice su propio contador —`block:1`— y el servidor le pone el
     * suyo —`block:8`—, y a partir de ahí las dos hablan de cosas distintas.
     * Costó verlo una vez en el navegador: se escribía una palabra en el bloque
     * recién creado, la pantalla la enseñaba, y el servidor rechazaba la edición
     * con «no such block» porque ese nombre allí no existía. La palabra se
     * perdía, y la pantalla seguía enseñándola.
     *
     * Bautizar antes de aplicar cierra eso de raíz: hay un solo nombre desde el
     * principio, y es el que viaja.
     */
    change = named(change);

    // Una propuesta todavía no es parte del corpus. No se aplica a la réplica
    // optimista ni entra a su bandeja de sincronización como si lo fuera.
    if (proposeInsteadOfWriting) return this.send(change, channel, origin);

    /*
     * Primero en casa, y la red después.
     *
     * @invariant TheHandNeverWaitsForTheNetwork. Lo que la réplica sabe aplicar
     * se aplica aquí y se contesta aquí; el viaje ocurre sin que nadie lo espere.
     * Lo que no sabe —crear una página, renombrarla: cosas que tocan enlaces que
     * la réplica de una página no tiene— sigue el camino de siempre, porque una
     * respuesta local que no puede ser correcta es peor que esperar.
     *
     * Una negativa local no viaja. Es la misma que habría dado el servidor
     * —sale del mismo dominio, no de una comprobación paralela— así que mandarla
     * a preguntar sólo añadiría el tiempo de que se la repitan.
     */
    const local = writeLocally?.(change, origin) ?? null;
    if (local !== null && !local.applied) {
      return { status: 'rejected', reason: local.reason };
    }
    if (local !== null) {
      /*
       * Guardado antes de decir que está guardado.
       *
       * @invariant LocalDurabilityPrecedesSavedFeedback: la fase `local` no se
       * anuncia hasta que el cambio y su origen han quedado escritos donde
       * sobreviven a cerrar. Aplicar no espera a eso —la mano ya siguió—; lo que
       * espera es la afirmación de que está a salvo, que es lo que no puede
       * adelantarse.
       */
      const pending: Pending = {
        originId: origin,
        change,
        channel,
        at: Date.now(),
        status: 'local',
      };
      const kept = outbox === null ? Promise.resolve() : outbox.remember(pending);
      void kept
        .catch(() => {
          // Sin sitio donde guardar, lo aplicado sigue aplicado y deja de estar a
          // salvo. Se dice como lo que es en vez de anunciarlo como guardado.
        })
        .then(() => {
          reportSubmission({ phase: 'local', originId: origin });
          if (outbox !== null) return drain();
          return this.send(change, channel, origin).then(
            () => undefined,
            () => undefined,
          );
        });
      return { status: 'applied', sequence: 0, subjectId: local.subjectId };
    }

    return this.send(change, channel, origin);
  },

  /**
   * Escribe directamente en el corpus canónico cuando el cambio apunta a una
   * página que la réplica abierta no contiene.
   *
   * Sigue usando POST /operations; sólo evita pedirle a la réplica de la página
   * actual que aplique un bloque de otra página y lo rechace como inexistente.
   */
  submitCanonical(
    change: Change,
    channel: 'typed_text' | 'drawn' | 'walked' = 'typed_text',
  ): Promise<SubmitResult> {
    return this.send(change, channel, originId());
  },

  /** El viaje, que a partir de ahora puede ocurrir con nadie esperándolo. */
  async send(
    change: Change,
    channel: 'typed_text' | 'drawn' | 'walked',
    origin: string,
  ): Promise<SubmitResult> {
    const startedAt = performance.now();
    reportSubmission({ phase: 'sending', originId: origin, startedAt });

    if (proposeInsteadOfWriting) {
      try {
        const response = await fetch('/shared-proposals', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ originId: origin, channel, change }),
        });
        const said = await response.json() as { proposal?: string; page?: string; error?: string };
        if (!response.ok || said.proposal === undefined) {
          const reason = said.error ?? `el servidor contestó ${response.status}`;
          reportSubmission({ phase: 'rejected', originId: origin,
            durationMs: performance.now() - startedAt, reason });
          return { status: 'rejected', reason };
        }
        reportSubmission({ phase: 'proposed', originId: origin,
          durationMs: performance.now() - startedAt, proposal: said.proposal });
        const target = change as Change & { stableId?: string; block?: string; page?: string };
        return { status: 'applied', sequence: 0,
          subjectId: target.stableId ?? target.block ?? target.page ?? said.page ?? '' };
      } catch (error) {
        reportSubmission({ phase: 'offline', originId: origin, durationMs: performance.now() - startedAt });
        throw error;
      }
    }

    let response: Response;
    try {
      response = await fetch('/operations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      /*
       * El cuerpo no dice quién escribe, y por eso funciona en cualquier
       * instancia.
       *
       * Lo decía —con un nombre fijo— y el servidor rechaza con 403 cuando el
       * cuerpo nombra a alguien que no es el dueño de ese grafo. En la instancia
       * donde ese nombre era el dueño no se notaba nunca; en cualquier otra,
       * toda escritura fallaba. Quién escribe lo decide el servidor a partir de
       * la credencial o, sin ella, del dueño del grafo: es lo que su propio
       * código ya declara, y afirmarlo aquí sólo podía contradecirlo.
       */
        body: JSON.stringify({
          originId: origin,
          channel,
          change,
        }),
      });
    } catch (error) {
      reportSubmission({ phase: 'offline', originId: origin, durationMs: performance.now() - startedAt });
      throw error;
    }

    /*
     * Un fallo del servidor también es una respuesta, y tiene que tener la misma
     * forma que un rechazo del dominio.
     *
     * Cuando persistir falla, el servidor contesta 500 con `{error, detail}` y
     * sin `status`. Quien llamaba leía `status`, veía `undefined`, lo tomaba por
     * «no rechazado» y seguía con un identificador vacío: el error que acababa
     * enseñándose era el de la operación siguiente, que no tenía nada que ver
     * con lo que había pasado. Una sola forma de respuesta lo evita en todos los
     * sitios a la vez, y no sólo donde alguien se acuerde de mirar.
     */
    const said = (await response.json()) as
      | SubmitResult
      | { error?: string; detail?: string };
    // Un rechazo del dominio ya viene con su motivo, y el motivo es lo único
    // que sirve: «una página ya lleva ese título» dice qué hacer, y «el servidor
    // contestó 422» no dice nada. Sólo se inventa una respuesta cuando el
    // servidor no mandó ninguna que se pueda leer.
    if ('status' in said) {
      const durationMs = performance.now() - startedAt;
      if (said.status === 'rejected') {
        reportSubmission({ phase: 'rejected', originId: origin, durationMs, reason: said.reason });
      } else {
        reportSubmission({
          phase: 'synchronised',
          originId: origin,
          durationMs,
          sequence: said.sequence,
        });
      }
      return said;
    }
    const why = said.error ?? `el servidor contestó ${response.status}`;
    const reason = said.detail === undefined ? why : `${why}: ${said.detail}`;
    reportSubmission({
      phase: 'rejected',
      originId: origin,
      durationMs: performance.now() - startedAt,
      reason,
    });
    return { status: 'rejected', reason };
  },
};


/** Lo que el registro vio de un cliente, agregado. */
export interface SeenClient {
  client: string | null;
  participant: string;
  /** El nombre del participante, para no poner un identificador en una celda. */
  name: string;
  deliveries: number;
  volume: number;
  firstAt: number;
  lastAt: number;
}

/** Una conexión declarada en la página de la puerta, con lo que se observó. */
export interface MCPConnection {
  block: string;
  name: string;
  client: string;
  participant: string | null;
  participantName: string | null;
  permission: string | null;
  says: string | null;
  seen: SeenClient | null;
}

/**
 * Con qué datos se enchufa una IA a esta instancia.
 *
 * No son decisiones: son hechos de este despliegue, calculados por el servidor.
 * Ver packages/server/src/mcp-connect.ts.
 */
export interface MCPConnect {
  transport: 'stdio';
  command: string;
  args: string[];
  cwd: string;
  url: string;
  /** Y desde otro equipo, cuando alguien lo declaró. Nulo si no se sabe. */
  reachableAt: string | null;
  /** URL HTTPS pública de Streamable HTTP, cuando M5 está publicado. */
  publicMcp: string | null;
  node: string;
  /**
   * Con qué se entra a este equipo desde otro para lanzar la puerta aquí.
   *
   * Es lo que permite dictar la configuración de un cliente que corre en otra
   * máquina sin pedirle que mantenga una copia del repositorio: abre una tubería
   * por ssh y el proceso nace al lado de Vera.
   */
  login: string;
  /** Credencial cifrada que puede abrirse en la máquina remota sin copiar el secreto. */
  remoteCredential: { client: string; file: string; name: string } | null;
  /** Si la puerta está donde se dice que está. */
  present: boolean;
}

/** Una credencial, sin su secreto, con el cerco que lleve. */
export interface CredentialView {
  id: string;
  participant: string;
  scopes: string[];
  status: 'active' | 'revoked';
  label: string;
  issuedAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  /** Qué clase puede plantar y con qué se marca. Nulo cuando escribe sin cerco. */
  confinement: {
    token: string;
    kind: string;
    source: string | null;
    grantedBy: string;
    grantedAt: number;
  } | null;
}

/**
 * Una página que alguien pidió que se fuera.
 *
 * Una credencial cercada no borra —dejaría una ausencia, y una ausencia no se
 * revisa—, así que lo que puede hacer con una página suya que ya no sirve es
 * decirlo con su motivo. Ver specs/confined-writing.allium.
 */
export interface DiscardRequest {
  page: string;
  title: string;
  reason: string;
  by: string | null;
  byName: string | null;
  at: number | null;
}

export interface DiscardDecision {
  page: string;
  decision: 'delete' | 'keep';
}

export interface MCPView {
  id: string | null;
  title?: string;
  stage?: string | null;
  connections: MCPConnection[];
  undeclared: SeenClient[];
  connect?: MCPConnect;
  marked?: DiscardRequest[];
  /** Con qué palabra se marca en este corpus. La declara la ontología. */
  markKey?: string;
}
