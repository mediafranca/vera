// Los `invariant` de las specs, ejecutables sobre un grafo real.
//
// Cada función lleva el nombre exacto del invariante en la spec, de modo que un
// fallo señale la línea que se violó y no una descripción aproximada.

import type { VeraGraph } from './graph.ts';
import { titleKey } from './text.ts';
import type { InvariantViolation } from './types.ts';

type Check = (graph: VeraGraph, report: (invariant: string, detail: string) => void) => void;

// --- core.allium -----------------------------------------------------------

const pageTitleIsUniqueWithinGraph: Check = (graph, report) => {
  const seen = new Set<string>();
  for (const page of graph.pages()) {
    const key = titleKey(page.title);
    if (seen.has(key)) {
      report('PageTitleIsUniqueWithinGraph', `two pages carry the title ${page.title}`);
    }
    seen.add(key);
  }
};

const blockStableIdentityIsUnique: Check = (graph, report) => {
  const seen = new Set<string>();
  for (const block of graph.allBlocks()) {
    if (seen.has(block.stableId)) {
      report('BlockStableIdentityIsUnique', `two blocks share the stable id ${block.stableId}`);
    }
    seen.add(block.stableId);
  }
};

/**
 * Las posiciones de un grupo de hermanos son 0, 1, 2 … sin huecos ni repetidos.
 *
 * De esto depende que `position` en un cambio pueda significar «el lugar que
 * pido»: con un hueco o un empate, insertar en el índice 3 dejaría de caer donde
 * el participante lo vio.
 */
const siblingOrderIsDenseAndUnique: Check = (graph, report) => {
  const groups = new Map<string, number[]>();
  for (const block of graph.allBlocks()) {
    const owner = block.crossing == null ? `page:${block.page}` : `crossing:${block.crossing}`;
    const key = `${owner}\u0000${block.parent ?? ''}`;
    const positions = groups.get(key);
    if (positions === undefined) groups.set(key, [block.position]);
    else positions.push(block.position);
  }

  for (const [key, positions] of groups) {
    const sorted = [...positions].sort((a, b) => a - b);
    for (const [expected, actual] of sorted.entries()) {
      if (actual !== expected) {
        report(
          'SiblingOrderIsDenseAndUnique',
          `los hermanos de ${key.replace('\u0000', '/')} llevan las posiciones ` +
            `${sorted.join(', ')} y deberían ser 0…${sorted.length - 1}`,
        );
        break;
      }
    }
  }
};

const blockParentBelongsToSamePage: Check = (graph, report) => {
  for (const block of graph.allBlocks()) {
    if (block.parent === null) continue;
    const parent = graph.block(block.parent);
    if (parent === undefined) {
      report('BlockParentBelongsToSamePage', `block ${block.stableId} points at a missing parent`);
    } else if (parent.page !== block.page || (parent.crossing ?? null) !== (block.crossing ?? null)) {
      report(
        'BlockParentBelongsToSamePage',
        `block ${block.stableId} and its parent belong to different outlines`,
      );
    }
  }
};

const blockBelongsToAnExistingPage: Check = (graph, report) => {
  for (const block of graph.allBlocks()) {
    if (graph.page(block.page) === undefined) {
      report('BlockBelongsToAnExistingPage', `block ${block.stableId} sits on a removed page`);
    }
  }
};

const propertyTargetsOneSubject: Check = (graph, report) => {
  for (const page of graph.pages()) {
    for (const property of graph.propertiesOf(page.id)) {
      if ((property.page === null) === (property.block === null)) {
        report(
          'PropertyTargetsOneSubject',
          `property ${property.key} names ${property.page === null ? 'neither' : 'both'} subjects`,
        );
      }
    }
  }
};

const propertyKeyIsUniquePerSubject: Check = (graph, report) => {
  for (const page of graph.pages()) {
    const seen = new Set<string>();
    for (const property of graph.propertiesOf(page.id)) {
      if (seen.has(property.key)) {
        report(
          'PropertyKeyIsUniquePerSubject',
          `page ${page.id} carries ${property.key} more than once`,
        );
      }
      seen.add(property.key);
    }
  }
};

const revisionParticipantBelongsToGraph: Check = (graph, report) => {
  for (const revision of graph.revisions()) {
    if (graph.participant(revision.authoredBy) === undefined) {
      report(
        'RevisionParticipantBelongsToGraph',
        `revision attributed to unknown participant ${revision.authoredBy}`,
      );
    }
  }
};

const voiceCanonicalityRequiresEvidence: Check = (graph, report) => {
  for (const revision of graph.revisions()) {
    if (revision.originIsCanonical && revision.evidence === undefined) {
      report('VoiceCanonicalityRequiresEvidence', 'a canonical revision carries no evidence');
    }
  }
};

const privatePagesAreNeverPublished: Check = (graph, report) => {
  for (const publication of graph.publications()) {
    if (graph.page(publication.page)?.visibility !== 'public') {
      report('PrivatePagesAreNeverPublished', `${publication.page} is published but not public`);
    }
  }
};

const publicationBarriersAreNeverCrossed: Check = (graph, report) => {
  for (const page of graph.pages()) {
    if (page.visibility === 'public' && graph.isPublicationProhibited(page.id)) {
      report(
        'PublicationBarriersAreNeverCrossed',
        `${page.id} is public inside an ambit whose publication is prohibited`,
      );
    }
  }
  for (const publication of graph.publications()) {
    if (graph.isPublicationProhibited(publication.page)) {
      report(
        'PublicationBarriersAreNeverCrossed',
        `${publication.page} is published inside an ambit whose publication is prohibited`,
      );
    }
  }
};

const onlySiteOwnerPublishes: Check = (graph, report) => {
  for (const publication of graph.publications()) {
    const site = graph.site(publication.site);
    if (site === undefined) {
      report('PublicationBelongsToSiteGraph', `${publication.id} names no site`);
      continue;
    }
    if (site.owner !== publication.publishedBy) {
      report('OnlySiteOwnerPublishes', `${publication.id} was not published by the site owner`);
    }
    if (graph.participant(site.owner)?.kind !== 'human') {
      report('OnlySiteOwnerPublishes', `site ${site.id} is owned by a non-human participant`);
    }
  }
};

const publicationRecordsItsHumanPublisher: Check = (graph, report) => {
  for (const publication of graph.publications()) {
    if (graph.participant(publication.publishedBy)?.kind !== 'human') {
      report(
        'PublicationRecordsItsHumanPublisher',
        `${publication.id} records a non-human publisher`,
      );
    }
  }
};

const publicationBelongsToSiteGraph: Check = (graph, report) => {
  for (const publication of graph.publications()) {
    const site = graph.site(publication.site);
    const page = graph.page(publication.page);
    if (site === undefined || page === undefined) continue;
    if (page.graph !== site.graph) {
      report('PublicationBelongsToSiteGraph', `${publication.id} crosses graphs`);
    }
  }
};

const publicationBeginsAtARevisionOfItsPage: Check = (graph, report) => {
  const revisions = new Map(graph.revisions().map((revision) => [revision.operation, revision]));
  for (const publication of graph.publications()) {
    const revision = revisions.get(publication.firstRevision);
    if (revision === undefined || revision.page !== publication.page) {
      report(
        'PublicationBeginsAtARevisionOfItsPage',
        `${publication.id} begins at a revision of another page`,
      );
    }
  }
};

// Una dirección que nombra a dos páginas no es canónica, y el sitio no tendría
// con qué elegir entre ellas.
const publicationPathIsUniqueWithinSite: Check = (graph, report) => {
  const taken = new Set<string>();
  for (const publication of graph.publications()) {
    const key = `${publication.site}\0${publication.path}`;
    if (taken.has(key)) {
      report(
        'PublicationPathIsUniqueWithinSite',
        `two publications share /${publication.path}/ on ${publication.site}`,
      );
    }
    taken.add(key);
  }
};

const siteEntryPointIsPublishedInItsOwnGraph: Check = (graph, report) => {
  for (const site of graph.sites()) {
    if (site.entryPoint === null) continue;
    const page = graph.page(site.entryPoint);
    const published = graph
      .publicationsOf(site.id)
      .some((publication) => publication.page === site.entryPoint);
    if (page?.graph !== site.graph || !published) {
      report(
        'SiteEntryPointIsPublishedInItsOwnGraph',
        `${site.id} names ${site.entryPoint} without publishing it`,
      );
    }
  }
};

// --- change-application.allium ---------------------------------------------

const operationSequenceIsUniqueWithinLog: Check = (graph, report) => {
  const seen = new Set<number>();
  for (const operation of graph.operations()) {
    if (seen.has(operation.sequence)) {
      report('OperationSequenceIsUniqueWithinLog', `sequence ${operation.sequence} repeats`);
    }
    seen.add(operation.sequence);
  }
};

const operationOriginIsUniqueWithinLog: Check = (graph, report) => {
  const seen = new Set<string>();
  for (const operation of graph.operations()) {
    if (seen.has(operation.originId)) {
      report('OperationOriginIsUniqueWithinLog', `origin ${operation.originId} repeats`);
    }
    seen.add(operation.originId);
  }
};

const sequenceNeverExceedsLogPosition: Check = (graph, report) => {
  const last = graph.log().lastSequence;
  for (const operation of graph.operations()) {
    if (operation.sequence < 1 || operation.sequence > last) {
      report(
        'SequenceNeverExceedsLogPosition',
        `sequence ${operation.sequence} falls outside 1..${last}`,
      );
    }
  }
};

const operationRecordsItsSubmissionOrigin: Check = (graph, report) => {
  for (const operation of graph.operations()) {
    if (operation.originId !== operation.submission.originId) {
      report('OperationRecordsItsSubmissionOrigin', `operation ${operation.id} disagrees`);
    }
  }
};

const appliedOperationsAreAccepted: Check = (graph, report) => {
  for (const operation of graph.operations()) {
    if (operation.submission.status !== 'accepted') {
      report('AppliedOperationsAreAccepted', `operation ${operation.id} was not accepted`);
    }
  }
};

const everyOperationHasARevision: Check = (graph, report) => {
  if (graph.operations().length !== graph.revisions().length) {
    report(
      'AttributedHistory',
      `${graph.operations().length} operations but ${graph.revisions().length} revisions`,
    );
  }
};

// --- graph-navigation.allium -----------------------------------------------

const linkSourceBlockBelongsToSourcePage: Check = (graph, report) => {
  for (const link of graph.links()) {
    const block = graph.block(link.sourceBlock);
    if (block === undefined) {
      report('LinkSourceBlockBelongsToSourcePage', `link ${link.id} outlived its block`);
    } else if (block.page !== link.sourcePage) {
      report('LinkSourceBlockBelongsToSourcePage', `link ${link.id} names the wrong source page`);
    }
  }
};

const resolvedLinkMatchesTheTitleItNamed: Check = (graph, report) => {
  for (const link of graph.links()) {
    if (link.target === null) continue;
    const target = graph.page(link.target);
    if (target === undefined) {
      report('ResolvedLinkStaysWithinOneGraph', `link ${link.id} points at a removed page`);
    } else if (titleKey(target.title) !== titleKey(link.targetTitle)) {
      report(
        'ResolvedLinkMatchesTheTitleItNamed',
        `link ${link.id} named ${link.targetTitle} but resolves to ${target.title}`,
      );
    }
  }
};

// --- query-language.allium -------------------------------------------------

const oneUnportedRecordPerBlock: Check = (graph, report) => {
  const seen = new Set<string>();
  for (const unported of graph.unportedQueries()) {
    if (seen.has(unported.block)) {
      report('OneUnportedRecordPerBlock', `block ${unported.block} holds two unported records`);
    }
    seen.add(unported.block);
  }
};

const portingIsAttributed: Check = (graph, report) => {
  for (const unported of graph.unportedQueries()) {
    if (unported.portedTo !== null && unported.portedBy === null) {
      report('PortingIsAttributed', `unported query ${unported.id} was ported by nobody`);
    }
  }
};

// --- agent-participation.allium --------------------------------------------

/**
 * Todo bloque dice de qué mano salió su texto.
 *
 * Es el invariante que sostiene la promesa entera. Si un bloque pudiera no
 * llevar autoría, distinguir lo escrito de lo generado dependería de que ese
 * bloque en concreto resultara tener el dato, y una distinción que a veces falta
 * no distingue nada.
 */
const everyBlockNamesItsHand: Check = (graph, report) => {
  for (const block of graph.allBlocks()) {
    if (graph.authorship(block.stableId) === undefined) {
      report('EveryBlockNamesItsHand', `el bloque ${block.stableId} no dice quién lo escribió`);
    }
  }
};

const agentWritingIsAlwaysMarked: Check = (graph, report) => {
  for (const authorship of graph.authorships()) {
    const kind = graph.participant(authorship.participant)?.kind;
    if (kind === 'agent' && authorship.channel !== 'agent_generation') {
      report(
        'AgentWritingIsAlwaysMarked',
        `${authorship.block} lo escribió el agente ${authorship.participant} ` +
          `por el canal ${authorship.channel}`,
      );
    }
  }
};

const agentOperationsCarryTheGeneratedChannel: Check = (graph, report) => {
  for (const operation of graph.operations()) {
    const { submittedBy, channel } = operation.submission;
    if (graph.participant(submittedBy)?.kind === 'agent' && channel !== 'agent_generation') {
      report(
        'AgentOperationsCarryTheGeneratedChannel',
        `la operación ${operation.id} viene del agente ${submittedBy} por el canal ${channel}`,
      );
    }
  }
};

const humanOperationsNeverClaimGeneration: Check = (graph, report) => {
  for (const operation of graph.operations()) {
    const { submittedBy, channel } = operation.submission;
    if (channel === 'agent_generation' && graph.participant(submittedBy)?.kind === 'human') {
      report(
        'HumanOperationsNeverClaimGeneration',
        `la operación ${operation.id} la firma como generada la persona ${submittedBy}`,
      );
    }
  }
};

const CHECKS: readonly Check[] = [
  pageTitleIsUniqueWithinGraph,
  blockStableIdentityIsUnique,
  blockParentBelongsToSamePage,
  blockBelongsToAnExistingPage,
  siblingOrderIsDenseAndUnique,
  propertyTargetsOneSubject,
  propertyKeyIsUniquePerSubject,
  revisionParticipantBelongsToGraph,
  voiceCanonicalityRequiresEvidence,
  privatePagesAreNeverPublished,
  publicationBarriersAreNeverCrossed,
  onlySiteOwnerPublishes,
  publicationRecordsItsHumanPublisher,
  publicationBelongsToSiteGraph,
  publicationBeginsAtARevisionOfItsPage,
  publicationPathIsUniqueWithinSite,
  siteEntryPointIsPublishedInItsOwnGraph,
  operationSequenceIsUniqueWithinLog,
  operationOriginIsUniqueWithinLog,
  sequenceNeverExceedsLogPosition,
  operationRecordsItsSubmissionOrigin,
  appliedOperationsAreAccepted,
  everyOperationHasARevision,
  linkSourceBlockBelongsToSourcePage,
  resolvedLinkMatchesTheTitleItNamed,
  oneUnportedRecordPerBlock,
  portingIsAttributed,
  everyBlockNamesItsHand,
  agentWritingIsAlwaysMarked,
  agentOperationsCarryTheGeneratedChannel,
  humanOperationsNeverClaimGeneration,
];

/**
 * Verifica todos los invariantes de v0 sobre un grafo. Devuelve la lista vacía
 * cuando el grafo está sano. Es lo que ejecutan las pruebas de propiedad tras
 * cada secuencia de operaciones.
 */
export function checkInvariants(graph: VeraGraph): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const report = (invariant: string, detail: string): void => {
    violations.push({ invariant, detail });
  };
  for (const check of CHECKS) check(graph, report);
  return violations;
}
