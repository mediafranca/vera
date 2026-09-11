// Tipos del dominio, traducidos 1:1 desde specs/core.allium y
// specs/change-application.allium. Los campos de las specs son snake_case; la
// superficie TypeScript es camelCase y la correspondencia es uno a uno.

export type ParticipantId = string;
export type GraphId = string;
export type PageId = string;
export type BlockId = string;
export type GlossId = string;
export type CrossingId = string;
export type OperationId = string;
export type PersonalSiteId = string;
export type PublicationId = string;

export const PARTICIPANT_KINDS = ['human', 'agent'] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];

export const PARTICIPANT_STATUSES = ['active', 'suspended'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

// Por qué vía llegó a Vera lo que un participante produjo.
//
// `walked` es el cuarto y el que menos se parece a los otros: no se tecleó, no
// se dijo y no lo generó nadie más. Es lo que alguien produjo andando por el
// corpus, y existe porque hay un texto de Vera que ninguno de los otros tres
// explicaría — el testimonio de un cruce, que dice cómo se pasó de una página a
// la siguiente. Admitirlo es afirmar que caminar es producir; la alternativa era
// que Vera firmara ese testimonio, y entonces habría texto en el corpus que
// ningún participante puso.
export const CONTRIBUTION_CHANNELS = [
  'typed_text',
  'authenticated_voice',
  'agent_generation',
  'import',
  'walked',
  /*
   * Lo hecho con la mano sobre una pantalla.
   *
   * De la misma clase que `authenticated_voice` y por la misma razón: son las
   * dos formas en que algo llega al corpus con denominación de origen humana.
   * Una grabación prueba que alguien habló; un trazo con su presión prueba que
   * alguien lo hizo con la mano. En un corpus donde también escriben máquinas,
   * eso no es cómo entró el contenido: es de dónde viene. Ver
   * specs/hand-drawing.allium.
   */
  'drawn',
] as const;
export type ContributionChannel = (typeof CONTRIBUTION_CHANNELS)[number];

export const VISIBILITIES = ['private', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

// El vocabulario de cambio que change-application.allium fijó. No incluye
// link_pages: los enlaces se derivan del contenido, así que son consecuencia de
// edit_block y nunca una operación que alguien envíe.
export const CHANGE_KINDS = [
  'create_page',
  'rename_page',
  'set_page_visibility',
  'recover_page_origin',
  'remove_page',
  'create_block',
  'edit_block',
  'move_block',
  'remove_block',
  'set_block_gloss',
  'create_crossing',
  'edit_crossing',
  'set_property',
  'remove_property',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export interface OriginEvidence {
  readonly reference: string;
  readonly capturedAt: number;
}

export type Change =
  | {
      readonly kind: 'create_page';
      readonly title: string;
      readonly visibility: Visibility;
      /**
       * Identidad propuesta por quien envía. Ver `create_block`, que la tenía
       * desde el principio para que la importación conservara las referencias de
       * Logseq.
       *
       * Una página la necesita por otra razón: un cliente que aplica el cambio
       * antes de enviarlo tiene que poder nombrar lo que crea para navegar hasta
       * ello y para colgarle bloques. Ver specs/offline-reconciliation.allium.
       */
      readonly stableId?: PageId | undefined;
    }
  | {
      readonly kind: 'recover_page_origin';
      readonly page: PageId;
      readonly originCreatedAt: number;
    }
  | { readonly kind: 'rename_page'; readonly page: PageId; readonly title: string }
  | {
      readonly kind: 'set_page_visibility';
      readonly page: PageId;
      readonly visibility: Visibility;
    }
  | { readonly kind: 'remove_page'; readonly page: PageId }
  | {
      readonly kind: 'create_block';
      readonly page: PageId;
      readonly crossing?: CrossingId | undefined;
      readonly parent: BlockId | null;
      readonly position: number;
      readonly content: string;
      /**
       * Identidad propuesta por quien envía. Sólo la usa la importación, para
       * adoptar los identificadores que el corpus ya traía en vez de inventar
       * otros y romper las referencias que existían fuera de Vera.
       */
      readonly stableId?: BlockId | undefined;
    }
  | { readonly kind: 'edit_block'; readonly block: BlockId; readonly content: string }
  | {
      readonly kind: 'move_block';
      readonly block: BlockId;
      readonly page: PageId;
      readonly crossing?: CrossingId | undefined;
      readonly parent: BlockId | null;
      readonly position: number;
    }
  | { readonly kind: 'remove_block'; readonly block: BlockId }
  | { readonly kind: 'set_block_gloss'; readonly block: BlockId; readonly content: string }
  | {
      readonly kind: 'create_crossing';
      readonly fromPage: PageId;
      readonly toPage: PageId;
      readonly content: string;
      readonly term?: string | null | undefined;
      readonly stableId?: CrossingId | undefined;
    }
  | {
      readonly kind: 'edit_crossing';
      readonly crossing: CrossingId;
      readonly content: string;
      readonly term?: string | null | undefined;
    }
  | {
      readonly kind: 'set_property';
      readonly page?: PageId | undefined;
      readonly block?: BlockId | undefined;
      readonly propertyKey: string;
      readonly propertyValue: string;
    }
  | {
      readonly kind: 'remove_property';
      readonly page?: PageId | undefined;
      readonly block?: BlockId | undefined;
      readonly propertyKey: string;
    };

export interface Participant {
  readonly id: ParticipantId;
  readonly name: string;
  readonly kind: ParticipantKind;
  status: ParticipantStatus;
}

export interface Page {
  readonly id: PageId;
  readonly graph: GraphId;
  title: string;
  visibility: Visibility;
  readonly createdAt: number;
  originCreatedAt: number | null;
}

export interface Block {
  /** La identidad que sobrevive a editar y mover. Nunca se reasigna. */
  readonly stableId: BlockId;
  /** Página contextual. En un bloque de relación es su extremo de origen, no su propietario. */
  page: PageId;
  /** Presente cuando el propietario del outline es una relación y no la página contextual. */
  crossing?: CrossingId | null;
  parent: BlockId | null;
  position: number;
  content: string;
  readonly createdAt: number;
}

/** La única marginalia canónica que acompaña a un bloque. */
export interface Gloss {
  readonly block: BlockId;
  content: string;
  readonly createdAt: number;
  updatedAt: number;
}

export interface PropertyAssignment {
  readonly graph: GraphId;
  readonly page: PageId | null;
  readonly block: BlockId | null;
  readonly key: string;
  value: string;
}

export interface Submission {
  readonly graph: GraphId;
  readonly originId: string;
  readonly submittedBy: ParticipantId;
  readonly change: Change;
  readonly channel: ContributionChannel;
  readonly evidence?: OriginEvidence | undefined;
  readonly submittedAt: number;
  readonly status: 'submitted' | 'accepted' | 'rejected';
}

export interface Revision {
  readonly graph: GraphId;
  /**
   * La operación que la produjo, que es también su identidad.
   *
   * Una operación aceptada deja exactamente una revisión, así que nombrar la
   * operación nombra la revisión sin inventar un segundo identificador que
   * habría que mantener de acuerdo con el primero. Es lo que permite a una
   * publicación decir qué revisión publicó.
   */
  readonly operation: OperationId;
  readonly page: PageId | null;
  readonly block: BlockId | null;
  readonly crossing: CrossingId | null;
  readonly authoredBy: ParticipantId;
  readonly channel: ContributionChannel;
  readonly evidence?: OriginEvidence | undefined;
  readonly recordedAt: number;
  readonly changeKind: ChangeKind;
  /** La voz autenticada prueba autoría, no verdad factual. */
  readonly originIsCanonical: boolean;
}

/**
 * De qué mano salió el texto que un bloque tiene ahora.
 *
 * @invariant GeneratedContentIsAlwaysDistinguishable: todo bloque la tiene, así
 * que saber si un pasaje se escribió o se generó nunca obliga a recorrer el
 * registro.
 *
 * Es cosa distinta de la denominación de origen. `SpokenOrigin` dice de dónde
 * vinieron las palabras y no cambia nunca; esto dice quién las escribió por
 * última vez y cambia con cada edición. Un bloque puede tener las dos y nombrar
 * participantes distintos: dictado por Herbert, reescrito por un agente.
 */
export interface Authorship {
  readonly block: BlockId;
  readonly participant: ParticipantId;
  readonly channel: ContributionChannel;
  readonly writtenAt: number;
}

export interface Operation {
  readonly id: OperationId;
  readonly originId: string;
  readonly submission: Submission;
  readonly sequence: number;
  /** La página o bloque que la operación creó o tocó. Permite reproducir el log. */
  readonly subjectId: string;
  readonly appliedAt: number;
}

export type SubmitOutcome =
  | { readonly status: 'applied'; readonly operation: Operation; readonly subjectId: string }
  | { readonly status: 'duplicate'; readonly operation: Operation }
  | { readonly status: 'rejected'; readonly reason: string };

export interface OperationInput {
  readonly originId: string;
  readonly participant: ParticipantId;
  readonly change: Change;
  readonly channel?: ContributionChannel | undefined;
  readonly evidence?: OriginEvidence | undefined;
  readonly submittedAt?: number | undefined;
  /**
   * Sobre qué recae, cuando ya se sabe.
   *
   * Sólo lo trae la reproducción del registro, que no está pidiendo un cambio
   * nuevo sino rehaciendo uno que ya ocurrió y del que se guardó el sujeto. Sin
   * esto, reproducir volvía a *derivar* los identificadores contando en el mismo
   * orden, y bastaba con que una regla consumiera un identificador de más para
   * que todo lo posterior se desplazara y el registro dejara de poder leerse.
   */
  readonly subjectId?: string | undefined;
  /**
   * Qué número llevaba, cuando ya lo llevaba.
   *
   * Igual que `subjectId`, sólo lo trae la reproducción. Contar las operaciones
   * reproducidas y numerarlas de nuevo parece lo mismo y no lo es: basta con que
   * el registro tenga un hueco —una operación que se aceptó y no se pudo
   * guardar— para que la cuenta quede por detrás del último número escrito, y
   * entonces la siguiente escritura reclama un número que ya existe. La base lo
   * rechaza, esa operación tampoco se guarda, y el hueco se hace más grande: un
   * corpus que se estropea más cuanto más se usa.
   */
  readonly sequence?: number | undefined;
  /**
   * Y con qué identidad quedó registrada.
   *
   * Por la misma razón: el identificador de una operación sale del mismo
   * contador que el de las páginas y los bloques, y reproducir no lo observaba.
   * El contador volvía a arrancar por detrás y la siguiente operación pedía un
   * identificador que ya estaba escrito.
   */
  readonly operationId?: string | undefined;
}

export interface PageLink {
  readonly id: string;
  readonly graph: GraphId;
  readonly sourcePage: PageId;
  readonly sourceBlock: BlockId;
  readonly targetTitle: string;
  target: PageId | null;
}

export interface UnportedQuery {
  readonly id: string;
  readonly graph: GraphId;
  readonly block: BlockId;
  sourceText: string;
  portedTo: unknown | null;
  portedBy: ParticipantId | null;
  portedAt: number | null;
}

/**
 * Un sitio al que se publica. No es «lo público del grafo»: es un destino con
 * dueño y dominio, y una página pública no entra en él por ser pública.
 *
 * @invariant SiteMembershipIsExplicit (personal-site-projection.allium)
 */
export interface PersonalSite {
  readonly id: PersonalSiteId;
  readonly graph: GraphId;
  readonly owner: ParticipantId;
  title: string;
  canonicalDomain: string;
  entryPoint: PageId | null;
  transparentBlockTraceability: boolean;
}

/**
 * Una página puesta en una dirección de un sitio, por alguien, en un momento.
 * Publicar es esta operación y no un atributo de la página.
 *
 * `firstRevision` nombra la revisión que estaba vigente al abrir la página al
 * público. Es una frontera temporal, no una instantánea congelada: las
 * revisiones posteriores forman parte de la vida pública del nodo.
 */
export interface Publication {
  readonly id: PublicationId;
  readonly site: PersonalSiteId;
  readonly page: PageId;
  readonly firstRevision: OperationId;
  readonly path: string;
  readonly publishedAt: number;
  readonly publishedBy: ParticipantId;
}

export type SearchableField =
  | 'page_title'
  | 'block_content'
  | 'property_value'
  | 'audio_transcript'
  | 'gloss_content';

export interface SearchHit {
  readonly page: PageId;
  readonly block: BlockId | null;
  readonly field: SearchableField;
  readonly excerpt: string;
  readonly rank: number;
}

export interface SearchOutcome {
  readonly graph: GraphId;
  readonly text: string;
  readonly searchedBy: ParticipantId;
  readonly hits: readonly SearchHit[];
}

export interface NeighbourhoodNode {
  readonly page: PageId;
  readonly distance: number;
  readonly degree: number;
  readonly blockCount: number;
}

export interface NeighbourhoodEdge {
  readonly source: PageId;
  readonly target: PageId;
}

export interface GraphNeighbourhood {
  readonly graph: GraphId;
  readonly centre: PageId;
  readonly depth: number;
  readonly nodes: readonly NeighbourhoodNode[];
  readonly edges: readonly NeighbourhoodEdge[];
}

export interface InvariantViolation {
  readonly invariant: string;
  readonly detail: string;
}
