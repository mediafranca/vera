// @vera/core — el dominio de Vera.
//
// Traducido desde specs/core.allium, change-application.allium,
// query-language.allium, search-index.allium y graph-navigation.allium.
// No conoce SQL, HTTP ni el sistema de archivos: eso lo aportan packages/store,
// packages/server y packages/importer sobre esta base.

export { VeraGraph } from './graph.ts';
export { checkInvariants } from './invariants.ts';

export {
  and,
  contentTerm,
  linkedFrom,
  linksTo,
  not,
  or,
  propertyTerm,
  tagTerm,
  titleTerm,
} from './query.ts';
export type { QueryExpression } from './query.ts';

export { looksLikeQuery, readQuery, writeQuery } from './query-source.ts';

/*
 * Deshacer lo último, calculado sobre el registro y no sobre una pila en
 * memoria: los estados anteriores ya están todos guardados. Ver undo.ts.
 */
export {
  GESTURE_GAP,
  UNDO_ORIGIN,
  blockBefore,
  contraryOf,
  gesturesIn,
  invert,
  lastGesture,
  nextToRedo,
  nextToUndo,
  pageOf,
  pagesOf,
  runOf,
} from './undo.ts';
export type { Inverse, Undoing, World } from './undo.ts';

/*
 * Las dos páginas que dicen de qué está hecho este corpus: qué propiedades hay y
 * qué clase de campo es cada una, y qué objetos hay y qué propiedades los
 * constituyen. Ver ontology.ts.
 */
export {
  FIELD_KINDS,
  fieldKindOf,
  missingFor,
  readObjectDeclarations,
  readPropertyDeclarations,
  readRelationDeclarations,
} from './ontology.ts';
export type {
  DeclaredBlock,
  FieldKind,
  ObjectDeclaration,
  PropertyDeclaration,
  PropertySubject,
  RelationDeclaration,
} from './ontology.ts';

/*
 * Cómo se lee un bloque escrito en Markdown.
 *
 * Está en el dominio porque lo necesitan dos superficies —la pantalla y el
 * papel— y una segunda copia habría acabado diciendo otra cosa del mismo texto.
 */
export {
  embedIn,
  headingAnchor,
  inlineMarkdown,
  renderMarkdown,
  uniqueAnchors,
} from './markdown.ts';

/*
 * Lo dibujado a mano: sus trazos son el texto de su bloque. Ver drawing.ts y
 * specs/hand-drawing.allium.
 */
export {
  DRAWING_FENCE,
  NIB,
  drawingSvg,
  extentsOf,
  looksLikeDrawing,
  readDrawing,
  segmentsOf,
  widthAt,
  writeDrawing,
} from './drawing.ts';
export type { DrawnSvg, Extents, Nib, Point, Segment, Stroke } from './drawing.ts';
export type { RenderOptions } from './markdown.ts';
export { answersIn } from './vocabulary.ts';

export {
  STARTER_RELATIONS,
  inverseOf,
  isSymmetric,
  relationKeyOf,
  senseIn,
  titleIn,
} from './relations.ts';
export {
  DEFAULT_PROPERTY_NAMES,
  DERIVED,
  SPECIAL_KIND,
  derivedRole,
  namesFromRoles,
  readPropertyNames,
} from './property-names.ts';
export type { PropertyNames, PropertyRole } from './property-names.ts';
export type { Crossing, CrossingSense, RelationTerm } from './relations.ts';
export type { QuerySource, QueryUnreadable, QueryView } from './query-source.ts';

export {
  suggestTitles,
  calendarDay,
  excerpt,
  isDateTitle,
  matches,
  queryMacroText,
  referencedTags,
  referencedTitles,
  titleKey,
} from './text.ts';

/*
 * Cómo se escribe la dirección pública de una publicación. En el dominio porque
 * la usan quien publica y el generador del sitio, y dos versiones de la misma
 * regla acabarían sirviendo una URL distinta de la que se prometió.
 */
export {
  canonicalUrl,
  normaliseCanonicalDomain,
  normalisePublicPath,
  suggestedPathFor,
} from './site.ts';

export {
  CHANGE_KINDS,
  CONTRIBUTION_CHANNELS,
  PARTICIPANT_KINDS,
  PARTICIPANT_STATUSES,
  VISIBILITIES,
} from './types.ts';

export type {
  Authorship,
  Block,
  BlockId,
  Change,
  ChangeKind,
  ContributionChannel,
  CrossingId,
  GraphId,
  GraphNeighbourhood,
  InvariantViolation,
  NeighbourhoodEdge,
  NeighbourhoodNode,
  Operation,
  OperationInput,
  OriginEvidence,
  Page,
  PageId,
  PageLink,
  Participant,
  ParticipantId,
  ParticipantKind,
  ParticipantStatus,
  PersonalSite,
  PersonalSiteId,
  PropertyAssignment,
  Publication,
  PublicationId,
  Revision,
  SearchHit,
  SearchOutcome,
  SearchableField,
  Submission,
  SubmitOutcome,
  UnportedQuery,
  Visibility,
} from './types.ts';

export {
  TESTIMONY_KEY,
  TRAIL_KIND,
  isTrail,
  readTrail,
  readingOrder,
  type CrossingKind,
  type Trail,
  type TrailBlock,
  type TrailCrossing,
  type TrailNode,
  type TrailReading,
} from './trail.ts';

export {
  LIST_KEY,
  NUMBERED,
  hasTypedOrdinal,
  readChildListStyle,
  withoutTypedOrdinal,
  type ChildListStyle,
} from './list.ts';

export {
  DEADLINE_KEY,
  MARKS,
  TASK_STATES,
  convertLegacy,
  looksLegacy,
  nextState,
  readTask,
  writeTask,
  type Converted,
  type Task,
  type TaskState,
} from './task.ts';
