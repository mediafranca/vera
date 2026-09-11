// El grafo de Vera materializado en memoria.
//
// Regla que gobierna este archivo: submitOperation() es la única vía de
// escritura. Todo lo demás es lectura. Eso es lo que materializa
// @guarantee EqualMutationPath: humanos y agentes cruzan la misma frontera, y
// ninguno tiene una puerta trasera.

import { answersIn } from './vocabulary.ts';
import { normaliseCanonicalDomain, normalisePublicPath } from './site.ts';
import { looksLikeQuery, readQuery } from './query-source.ts';
import { relationKeyOf, senseIn, titleIn } from './relations.ts';
import type { Crossing } from './relations.ts';
import { DEFAULT_PROPERTY_NAMES, derivedRole } from './property-names.ts';
import type { PropertyNames, PropertyRole } from './property-names.ts';
import {
  calendarDay,
  excerpt,
  isDateTitle,
  matches,
  queryMacroText,
  referencedTags,
  referencedTitles,
  retitleLinks,
  titleKey,
} from './text.ts';
import type { QueryExpression } from './query.ts';
import type {
  Authorship,
  Block,
  BlockId,
  Change,
  ContributionChannel,
  CrossingId,
  GraphId,
  GraphNeighbourhood,
  NeighbourhoodEdge,
  NeighbourhoodNode,
  OperationInput,
  Operation,
  Page,
  PageId,
  PageLink,
  Participant,
  ParticipantId,
  ParticipantKind,
  PersonalSite,
  PersonalSiteId,
  PropertyAssignment,
  Gloss,
  OperationId,
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

const FIELD_ORDER: Record<SearchableField, number> = {
  page_title: 0,
  block_content: 1,
  property_value: 2,
  audio_transcript: 3,
  gloss_content: 4,
};

export class VeraGraph {
  readonly id: GraphId;
  readonly name: string;

  #participants = new Map<ParticipantId, Participant>();
  #memberships = new Map<ParticipantId, 'active' | 'suspended'>();
  #owner: ParticipantId | null = null;

  // @invariant EveryBlockNamesItsHand. Se mantiene junto al bloque y no dentro
  // de él porque responde otra pregunta: el bloque dice qué palabras hay, esto
  // dice de quién son.
  #authorship = new Map<BlockId, Authorship>();

  /*
   * Cómo llama este corpus a las propiedades que el dominio necesita conocer.
   *
   * Lo trae quien carga el grafo, leído de la página de ontología. Aquí sólo
   * está el mínimo que rige mientras esa página no diga otra cosa: escribir la
   * palabra dentro del código convertía en decisión de Vera algo que es del
   * corpus y de la lengua de quien lo escribe.
   */
  #names: PropertyNames = DEFAULT_PROPERTY_NAMES;

  namesProperties(names: PropertyNames): void {
    this.#names = names;
    this.#queryResultLinksCache = null;
  }

  get propertyNames(): PropertyNames {
    return this.#names;
  }

  #pages = new Map<PageId, Page>();
  /** Cuándo se tocó por última vez cada página. Ver #apply. */
  #updatedAt = new Map<PageId, number>();
  #blocks = new Map<BlockId, Block>();
  #glosses = new Map<BlockId, Gloss>();
  #crossings = new Map<CrossingId, Crossing>();
  #tags = new Map<BlockId, string[]>();

  // Índices. Sin ellos cada bloque nuevo recorre todos los enlaces existentes,
  // y el corpus de 42.000 bloques tarda segundos en importarse en vez de
  // milisegundos. Los mantiene #setLinkTarget y compañía; nada más los toca.
  #blocksByPage = new Map<PageId, Set<BlockId>>();
  #blocksByCrossing = new Map<CrossingId, Set<BlockId>>();
  #childrenByParent = new Map<BlockId, Set<BlockId>>();
  #pageByTitleKey = new Map<string, PageId>();
  #propertiesBySubject = new Map<string, PropertyAssignment[]>();
  #linksByBlock = new Map<BlockId, PageLink[]>();
  /** Consultas alojadas cuyo resultado vigente proyecta relaciones derivadas. */
  #queryBlocks = new Set<BlockId>();
  #queryResultLinksCache: PageLink[] | null = null;
  #linksByTarget = new Map<PageId, Set<PageLink>>();
  #unresolvedByTitleKey = new Map<string, Set<PageLink>>();
  #unportedByBlock = new Map<BlockId, UnportedQuery>();
  #sites = new Map<PersonalSiteId, PersonalSite>();
  #publications: Publication[] = [];

  /*
   * Reproducir no es someter.
   *
   * Hay dos clases de negativa y confundirlas rompe el registro. Una es
   * estructural —no existe esa página, no existe ese bloque—: si aparece al
   * reproducir, el registro está corrupto y hay que parar. La otra es de
   * política —un día no se queda sin su tipo, un miembro suspendido no escribe—:
   * dice qué se permite hoy, y lo que se permitía ayer ya ocurrió. Aplicarla al
   * reproducir haría que cada regla nueva invalidara la historia anterior a ella,
   * y el grafo dejaría de levantar por haber tenido razón.
   *
   * El precedente ya estaba en loadGraph, que vuelve a suspender a los
   * participantes después de reproducir y no antes, por esta misma razón.
   */
  #replaying = false;

  beginReplay(): void {
    this.#replaying = true;
  }

  endReplay(): void {
    this.#replaying = false;
  }

  #operations: Operation[] = [];
  #revisions: Revision[] = [];
  #origins = new Map<string, Operation>();
  #lastSequence = 0;
  #counter = 0;

  private constructor(id: GraphId, name: string) {
    this.id = id;
    this.name = name;
  }

  static create(options: { name: string; id?: string }): VeraGraph {
    return new VeraGraph(options.id ?? 'graph:1', options.name);
  }

  // -------------------------------------------------------------------------
  // Participación (identity-access.allium)
  // -------------------------------------------------------------------------

  addParticipant(input: { id: ParticipantId; name: string; kind: ParticipantKind }): void {
    this.#participants.set(input.id, { ...input, status: 'active' });
    // El primer humano funda la instancia y es su dueño soberano.
    if (this.#owner === null && input.kind === 'human') this.#owner = input.id;
  }

  admit(participant: ParticipantId): void {
    if (!this.#participants.has(participant)) {
      throw new Error(`unknown participant ${participant}`);
    }
    this.#memberships.set(participant, 'active');
  }

  /** @guarantee OwnerCannotBeRemoved */
  suspend(participant: ParticipantId): void {
    if (participant === this.#owner) {
      throw new Error('the sovereign owner cannot be suspended or removed');
    }
    if (!this.#memberships.has(participant)) {
      throw new Error(`no membership for ${participant}`);
    }
    this.#memberships.set(participant, 'suspended');
    const held = this.#participants.get(participant);
    // @invariant HistoricalIdentitySurvivesRemoval: la identidad permanece.
    if (held) held.status = 'suspended';
  }

  get owner(): ParticipantId | null {
    return this.#owner;
  }

  participant(id: ParticipantId): Participant | undefined {
    return this.#participants.get(id);
  }

  #isActive(participant: ParticipantId): boolean {
    return this.#memberships.get(participant) === 'active';
  }

  /** surface GraphParticipation */
  participationSurface(participant: ParticipantId): { name: string; pages: Page[] } {
    if (!this.#isActive(participant)) {
      throw new Error(`${participant} has no active membership in this graph`);
    }
    return { name: this.name, pages: this.pages() };
  }

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  pages(): Page[] {
    return [...this.#pages.values()];
  }

  page(id: PageId): Page | undefined {
    return this.#pages.get(id);
  }

  allBlocks(): Block[] {
    return [...this.#blocks.values()];
  }

  block(id: BlockId): Block | undefined {
    return this.#blocks.get(id);
  }

  gloss(block: BlockId): Gloss | undefined {
    return this.#glosses.get(block);
  }

  glosses(): Gloss[] {
    return [...this.#glosses.values()];
  }

  crossing(id: CrossingId): Crossing | undefined {
    const crossing = this.#crossings.get(id);
    return crossing === undefined ? undefined : this.#withOutline(crossing);
  }

  declaredCrossings(): Crossing[] {
    return [...this.#crossings.values()].map((crossing) => this.#withOutline(crossing));
  }

  blocksOf(page: PageId): Block[] {
    return this.#idsToBlocks(this.#blocksByPage.get(page));
  }

  blocksOfCrossing(crossing: CrossingId): Block[] {
    return this.#idsToBlocks(this.#blocksByCrossing.get(crossing));
  }

  #withOutline(crossing: Crossing): Crossing {
    const blocks = this.blocksOfCrossing(crossing.stableId);
    const roots = blocks.filter((block) => block.parent === null).sort((a, b) => a.position - b.position);
    const lines: string[] = [];
    const write = (block: Block, depth: number): void => {
      lines.push(`${'  '.repeat(depth)}${block.content}`);
      for (const child of this.childrenOf(block.stableId).sort((a, b) => a.position - b.position)) {
        write(child, depth + 1);
      }
    };
    for (const root of roots) write(root, 0);
    return { ...crossing, blocks, said: lines.join('\n') };
  }

  childrenOf(block: BlockId): Block[] {
    return this.#idsToBlocks(this.#childrenByParent.get(block));
  }

  #idsToBlocks(ids: Set<BlockId> | undefined): Block[] {
    if (ids === undefined) return [];
    const out: Block[] = [];
    for (const id of ids) {
      const block = this.#blocks.get(id);
      if (block !== undefined) out.push(block);
    }
    return out;
  }

  descendantsOf(block: BlockId): Block[] {
    const out: Block[] = [];
    const queue = [block];
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      for (const child of this.childrenOf(next)) {
        out.push(child);
        queue.push(child.stableId);
      }
    }
    return out;
  }

  propertiesOf(subject: PageId | BlockId): PropertyAssignment[] {
    return [...(this.#propertiesBySubject.get(subject) ?? [])];
  }

  #allProperties(): PropertyAssignment[] {
    return [...this.#propertiesBySubject.values()].flat();
  }

  /**
   * Qué valores se le han dado ya a una propiedad, y cuántas veces cada uno.
   *
   * El vocabulario real de un corpus heredado no está declarado en ninguna
   * parte: está en lo que se escribió durante años. Esto lo lee, que es lo que
   * permite ofrecer respuestas antes de que exista una ontología que las
   * gobierne — y lo que después alimenta a rule ProposePropertyDomainFromUsage,
   * cuando la haya.
   *
   * Sale ordenado por uso y luego alfabético: lo más dicho primero, porque es lo
   * más probable, y el desempate estable para que la lista no baile entre dos
   * lecturas.
   */
  observedValuesOf(key: string): { value: string; uses: number }[] {
    const counts = new Map<string, number>();
    for (const property of this.#allProperties()) {
      if (property.key !== key) continue;
      for (const value of answersIn(property.value)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    return [...counts]
      .map(([value, uses]) => ({ value, uses }))
      .sort((a, b) => b.uses - a.uses || a.value.localeCompare(b.value));
  }

  links(): PageLink[] {
    return [...this.#writtenLinks(), ...this.#queryResultLinks()];
  }

  backlinks(target: PageId): PageLink[] {
    return this.links().filter((link) => link.target === target);
  }

  /** Enlaces afirmados por contenido ordinario, sin respuestas de consultas. */
  #writtenLinks(): PageLink[] {
    return [...this.#linksByBlock.values()].flat();
  }

  /** Relaciones derivadas desde cada consulta alojada hacia su respuesta vigente. */
  #queryResultLinks(onlyBlock?: BlockId): PageLink[] {
    if (this.#queryResultLinksCache !== null) {
      return onlyBlock === undefined
        ? [...this.#queryResultLinksCache]
        : this.#queryResultLinksCache.filter((link) => link.sourceBlock === onlyBlock);
    }
    const links: PageLink[] = [];
    for (const id of this.#queryBlocks) {
      if (onlyBlock !== undefined && id !== onlyBlock) continue;
      const block = this.#blocks.get(id);
      if (block === undefined) continue;
      const read = readQuery(block.content);
      if ('error' in read) continue;
      for (const target of this.#select(read.expression)) {
        const page = this.#pages.get(target);
        if (page === undefined) continue;
        links.push({
          id: `query-link:${id}:${target}`,
          graph: this.id,
          sourcePage: block.page,
          sourceBlock: id,
          targetTitle: page.title,
          target,
        });
      }
    }
    this.#queryResultLinksCache = links;
    return onlyBlock === undefined
      ? [...links]
      : links.filter((link) => link.sourceBlock === onlyBlock);
  }

  // -------------------------------------------------------------------------
  // La relación explicada (trail.allium)
  // -------------------------------------------------------------------------

  /*
   * Los cruces no se guardan: se ven.
   *
   * Un bloque que lleva `explica:: [[Página]]` está afirmando algo sobre esa
   * página, y eso es todo lo que hace falta para que haya un cruce. No hay
   * entidad que mantener, ni tabla, ni operación de crear: se escribe el bloque
   * y hay relación; se borra el bloque y no la hay.
   *
   * La clave es el bloque y la página, y no el enlace derivado, porque
   * @invariant EdgesAreDerivedFromContent manda que ningún enlace sobreviva a la
   * frase que lo produjo: una explicación colgada de ahí moriría al corregir una
   * tilde, y con ella una grabación que quizá costó decir.
   */
  crossings(): Crossing[] {
    const found: Crossing[] = this.declaredCrossings();
    const seen = new Set(
      found.map((crossing) => `${crossing.fromPage}→${crossing.toPage ?? titleKey(crossing.targetTitle)}`),
    );

    for (const [subject, properties] of this.#propertiesBySubject) {
      const block = this.#blocks.get(subject);
      if (block === undefined || block.page === null) continue;

      let target: string | null = null;
      let term: string | null = null;
      let sense: string | null = null;
      for (const property of properties) {
        const role = relationKeyOf(property.key, this.#names);
        if (role === 'explains') target = property.value;
        else if (role === 'term') term = property.value;
        else if (role === 'sense') sense = property.value;
      }
      if (target === null) continue;

      const title = titleIn(target);
      if (title === '') continue;
      const to = this.#pageTitled(title);

      // Una página no se explica respecto de sí misma: no diría nada.
      if (to !== undefined && to.id === block.page) continue;

      // @invariant OneCrossingPerBlockAndTarget: un bloque dice una sola cosa
      // sobre una página. Si hay dos, rige la primera en el orden del grafo y la
      // otra no se cuenta dos veces; lo que haya que añadir se añade a la
      // conectiva, que es un bloque y crece.
      const from = block.parent ?? block.stableId;
      const key = `${block.page}→${to?.id ?? titleKey(title)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      found.push({
        stableId: block.stableId,
        connective: block.stableId,
        said: block.content,
        blocks: [block],
        fromBlock: from,
        fromPage: block.page,
        targetTitle: title,
        toPage: to?.id ?? null,
        sense: senseIn(sense),
        term: term === null || term.trim() === '' ? null : term.trim(),
        createdAt: block.createdAt,
        updatedAt: this.#updatedAt.get(block.page) ?? block.createdAt,
      });
    }

    return found;
  }

  /** Lo que esta página afirma sobre otras. */
  crossingsOut(page: PageId): Crossing[] {
    return this.crossings().filter((crossing) => crossing.fromPage === page);
  }

  /** Lo que otras páginas afirman sobre ésta. */
  crossingsIn(page: PageId): Crossing[] {
    return this.crossings().filter((crossing) => crossing.toPage === page);
  }

  /** Enlaces que nacen de un bloque, sin recorrer todos los del grafo. */
  linksOf(block: BlockId): PageLink[] {
    return [
      ...(this.#linksByBlock.get(block) ?? []),
      ...this.#queryResultLinks(block),
    ];
  }

  tagsOf(block: BlockId): string[] {
    return this.#tags.get(block) ?? [];
  }

  unportedQueries(): UnportedQuery[] {
    return [...this.#unportedByBlock.values()];
  }

  operations(): Operation[] {
    return [...this.#operations];
  }

  revisions(): Revision[] {
    return [...this.#revisions];
  }

  /** Última revisión real de una página; recuperar procedencia no la edita. */
  lastEditedAt(page: PageId): number | null {
    const times = this.#revisions
      .filter((revision) => revision.page === page && revision.changeKind !== 'recover_page_origin')
      .map((r) => r.recordedAt);
    return times.length === 0 ? null : Math.max(...times);
  }

  publications(): Publication[] {
    return [...this.#publications];
  }

  log(): { lastSequence: number } {
    return { lastSequence: this.#lastSequence };
  }

  // -------------------------------------------------------------------------
  // Escritura: la única vía
  // -------------------------------------------------------------------------

  submitOperation(input: OperationInput): SubmitOutcome {
    const channel = input.channel ?? 'typed_text';

    // rule AcceptParticipantSubmission
    if (!this.#isActive(input.participant)) {
      return { status: 'rejected', reason: 'no active membership in this graph' };
    }
    if (channel === 'authenticated_voice' && input.evidence === undefined) {
      return { status: 'rejected', reason: 'authenticated voice requires origin evidence' };
    }

    // @invariant ChannelFollowsParticipantKind: la procedencia no la elige quien
    // escribe. Un agente no puede presentar su generación como texto tecleado, y
    // una persona no puede firmar como generada la frase que escribió a mano. Si
    // el canal fuese seleccionable registraría intención, no hecho, y entonces
    // distinguir lo escrito de lo generado dejaría de significar nada.
    const kind = this.#participants.get(input.participant)?.kind;
    if (kind === 'agent' && channel !== 'agent_generation') {
      return {
        status: 'rejected',
        reason: `an agent submits through agent_generation, not ${channel}`,
      };
    }
    if (kind === 'human' && channel === 'agent_generation') {
      return { status: 'rejected', reason: 'agent_generation belongs to agent participants' };
    }

    // @invariant OriginIdentityIsTheIdempotencyKey
    const seen = this.#origins.get(input.originId);
    if (seen !== undefined) {
      return { status: 'duplicate', operation: seen };
    }

    const refusal = this.#validate(input.change);
    if (refusal !== null) {
      return { status: 'rejected', reason: refusal };
    }

    // Quien envía puede saber cuándo ocurrió esto —lo sabe la importación, y lo
    // sabe la reproducción del registro—. Si no lo sabe nadie, es ahora.
    const at = input.submittedAt ?? Date.now();
    const subjectId = this.#apply(input.change, input.subjectId ?? null, at);
    this.#recordAuthorship(input.change, subjectId, input.participant, channel, at);

    const submission: Submission = {
      graph: this.id,
      originId: input.originId,
      submittedBy: input.participant,
      change: input.change,
      channel,
      evidence: input.evidence,
      submittedAt: at,
      status: 'accepted',
    };

    /*
     * rule RecordAcceptedSubmission: la secuencia se asigna aquí y sólo aquí.
     *
     * Salvo al reproducir, que no asigna sino que recuerda. Numerar de nuevo lo
     * ya numerado parece inofensivo y no lo es: un hueco en el registro —una
     * operación aceptada que no se pudo guardar— deja la cuenta por detrás del
     * último número escrito, y la siguiente escritura reclama un número que ya
     * existe. La base la rechaza, esa tampoco se guarda, y el hueco crece.
     */
    this.#lastSequence = input.sequence ?? this.#lastSequence + 1;
    if (input.operationId !== undefined) this.#observeId(input.operationId);
    // El identificador se resuelve antes de anotar la revisión porque la
    // revisión lo lleva: es la operación la que la nombra.
    const operationId = input.operationId ?? this.#nextId('op');
    this.#recordRevision(submission, subjectId, at, operationId);
    const operation: Operation = {
      id: operationId,
      originId: input.originId,
      submission,
      sequence: this.#lastSequence,
      subjectId,
      appliedAt: at,
    };
    this.#operations.push(operation);
    this.#origins.set(input.originId, operation);

    return { status: 'applied', operation, subjectId };
  }

  /**
   * rule WritingRecordsItsHand y rule RewritingTransfersTheHand.
   *
   * Sólo escribir cambia la mano. Mover un bloque de una página a otra no es
   * haber escrito una palabra suya, así que `move_block` no aparece aquí: es
   * @invariant... bueno, es rule MovingLeavesTheHandAlone, escrita como el
   * silencio deliberado de este switch. Un bibliotecario que ordena no firma.
   */
  #recordAuthorship(
    change: Change,
    subjectId: string,
    participant: ParticipantId,
    channel: ContributionChannel,
    at: number,
  ): void {
    let block = subjectId;
    if (change.kind === 'create_crossing' || change.kind === 'edit_crossing') {
      block = this.blocksOfCrossing(subjectId)
        .filter((one) => one.parent === null)
        .sort((a, b) => a.position - b.position)[0]?.stableId ?? '';
    } else if (change.kind !== 'create_block' && change.kind !== 'edit_block') return;
    if (block === '') return;
    this.#authorship.set(block, {
      block,
      participant,
      channel,
      writtenAt: at,
    });
  }

  /** De qué mano salió el texto que este bloque tiene ahora. */
  authorship(block: BlockId): Authorship | undefined {
    return this.#authorship.get(block);
  }

  /** Toda la autoría del grafo, para materializarla y para verificarla. */
  authorships(): Authorship[] {
    return [...this.#authorship.values()];
  }

  #recordRevision(
    submission: Submission,
    subjectId: string,
    at: number,
    operation: OperationId,
  ): void {
    const change = submission.change;
    const isBlockChange =
      change.kind === 'create_block' ||
      change.kind === 'edit_block' ||
      change.kind === 'move_block' ||
      change.kind === 'remove_block' ||
      change.kind === 'set_block_gloss';

    let page: PageId | null = null;
    let block: BlockId | null = null;
    let crossing: CrossingId | null = null;
    if (isBlockChange) {
      block = subjectId;
      page = this.#blocks.get(subjectId)?.page ?? null;
      crossing = this.#blocks.get(subjectId)?.crossing ?? null;
    } else if (change.kind === 'create_crossing' || change.kind === 'edit_crossing') {
      crossing = subjectId;
      page = this.#crossings.get(subjectId)?.fromPage ?? null;
    } else if (change.kind === 'set_property' || change.kind === 'remove_property') {
      page = change.page ?? null;
      block = change.block ?? null;
    } else {
      page = subjectId;
    }

    this.#revisions.push({
      graph: this.id,
      operation,
      page,
      block,
      crossing,
      authoredBy: submission.submittedBy,
      channel: submission.channel,
      evidence: submission.evidence,
      recordedAt: at,
      changeKind: change.kind,
      // La voz autenticada prueba autoría, no verdad factual.
      originIsCanonical:
        submission.channel === 'authenticated_voice' && submission.evidence !== undefined,
    });
  }

  // -------------------------------------------------------------------------
  // Precondiciones: los `requires` de change-application.allium
  // -------------------------------------------------------------------------

  #validate(change: Change): string | null {
    switch (change.kind) {
      case 'create_page': {
        if (change.title.trim() === '') return 'a page needs a title';
        if (this.#pageTitled(change.title) !== undefined) {
          return `a page already carries the title ${change.title}`;
        }
        // La identidad que trae quien envía sólo vale si está libre. Aceptar una
        // tomada sería crear escribiendo encima, y eso pierde algo sin dejar
        // rastro. @invariant StableIdentityAcrossApplication.
        if (change.stableId !== undefined && this.#pages.has(change.stableId)) {
          return `a page already holds the stable id ${change.stableId}`;
        }
        return null;
      }
      case 'recover_page_origin':
        if (!this.#pages.has(change.page)) return 'no such page';
        if (!Number.isFinite(change.originCreatedAt) || change.originCreatedAt <= 0) {
          return 'originCreatedAt must be a positive timestamp';
        }
        return null;
      case 'rename_page': {
        if (!this.#pages.has(change.page)) return 'no such page';
        if (change.title.trim() === '') return 'a page needs a title';
        const held = this.#pageTitled(change.title);
        if (held !== undefined && held.id !== change.page) {
          return `a page already carries the title ${change.title}`;
        }
        return null;
      }
      case 'set_page_visibility':
        if (!this.#pages.has(change.page)) return 'no such page';
        if (
          change.visibility === 'private' &&
          this.#publications.some((publication) => publication.page === change.page)
        ) {
          return 'a published page must be withdrawn before it becomes private';
        }
        return null;
      case 'remove_page': {
        if (!this.#pages.has(change.page)) return 'no such page';
        if (this.#publications.some((publication) => publication.page === change.page)) {
          return 'a published page must be withdrawn before it is removed';
        }
        if (this.blocksOf(change.page).length > 0) {
          return 'a page is removable only once it is empty';
        }
        if ([...this.#crossings.values()].some((one) =>
          one.fromPage === change.page || one.toPage === change.page)) {
          return 'a page with declared crossings is not removable';
        }
        return null;
      }
      case 'create_block': {
        if (!this.#pages.has(change.page)) return 'no such page';
        if (change.crossing !== undefined && !this.#crossings.has(change.crossing)) return 'no such crossing';
        if (change.crossing !== undefined && this.#crossings.get(change.crossing)?.fromPage !== change.page) {
          return 'the contextual page is not the crossing origin';
        }
        if (change.parent !== null) {
          const parent = this.#blocks.get(change.parent);
          if (parent === undefined) return 'no such parent block';
          if (parent.page !== (change.page ?? null) || parent.crossing !== (change.crossing ?? null)) {
            return 'the parent lives in another outline';
          }
        }
        if (change.stableId !== undefined && this.#blocks.has(change.stableId)) {
          return `a block already holds the stable id ${change.stableId}`;
        }
        return null;
      }
      case 'edit_block':
        return this.#blocks.has(change.block) ? null : 'no such block';
      case 'move_block': {
        const block = this.#blocks.get(change.block);
        if (block === undefined) return 'no such block';
        if (!this.#pages.has(change.page)) return 'no such page';
        if (change.crossing !== undefined && !this.#crossings.has(change.crossing)) return 'no such crossing';
        if (change.crossing !== undefined && this.#crossings.get(change.crossing)?.fromPage !== change.page) {
          return 'the contextual page is not the crossing origin';
        }
        if (change.parent === change.block) return 'a block cannot be its own parent';
        if (change.parent !== null) {
          const parent = this.#blocks.get(change.parent);
          if (parent === undefined) return 'no such parent block';
          if (parent.page !== (change.page ?? null) || parent.crossing !== (change.crossing ?? null)) {
            return 'the parent lives in another outline';
          }
          if (this.descendantsOf(change.block).some((d) => d.stableId === change.parent)) {
            return 'a block cannot be moved beneath itself';
          }
        }
        return null;
      }
      case 'remove_block': {
        if (!this.#blocks.has(change.block)) return 'no such block';
        if (this.childrenOf(change.block).length > 0) {
          return 'only a leaf is removable; remove its children first';
        }
        return null;
      }
      case 'set_block_gloss':
        if (!this.#blocks.has(change.block)) return 'no such block';
        if (change.content === this.#glosses.get(change.block)?.content) return 'the gloss is unchanged';
        return null;
      case 'create_crossing': {
        if (!this.#pages.has(change.fromPage) || !this.#pages.has(change.toPage)) return 'no such crossing endpoint';
        if (change.fromPage === change.toPage) return 'a page cannot relate to itself';
        if (change.content.trim() === '') return 'a crossing needs content';
        if (change.stableId !== undefined && this.#crossings.has(change.stableId)) {
          return `a crossing already holds the stable id ${change.stableId}`;
        }
        if ([...this.#crossings.values()].some((one) =>
          one.fromPage === change.fromPage && one.toPage === change.toPage)) {
          return 'there is already a crossing for this ordered pair';
        }
        return null;
      }
      case 'edit_crossing': {
        if (!this.#crossings.has(change.crossing)) return 'no such crossing';
        if (change.content.trim() === '') return 'a crossing needs content';
        return null;
      }
      case 'set_property': {
        const refusal = this.#validateSubject(change.page, change.block);
        if (refusal !== null) return refusal;
        if (change.propertyKey.trim() === '') return 'a property needs a key';
        return null;
      }
      case 'remove_property': {
        const refusal = this.#validateSubject(change.page, change.block);
        if (refusal !== null) return refusal;
        if (this.#findProperty(change.page, change.block, change.propertyKey) === undefined) {
          return 'no such property assignment';
        }
        // rule ADayKeepsItsKind: quitar el tipo de un día no hace que la página
        // deje de ser el 6 de agosto; hace que deje de contestar cuando se
        // pregunta por los días, y nada avisa. Se rechaza aquí y no en la
        // interfaz porque una regla que sólo vive en un botón no es una regla.
        //
        // Es política y no estructura: gobierna lo que se somete hoy, no lo que
        // se sometió antes de que existiera. Ver #replaying.
        if (!this.#replaying && change.propertyKey === this.#names.kind && change.page !== undefined) {
          const page = this.#pages.get(change.page);
          if (page !== undefined && isDateTitle(page.title)) {
            return 'un día es una bitácora; su tipo no se quita';
          }
        }
        return null;
      }
    }
  }

  // invariant PropertyTargetsOneSubject
  #validateSubject(page: PageId | undefined, block: BlockId | undefined): string | null {
    const hasPage = page !== undefined;
    const hasBlock = block !== undefined;
    if (hasPage === hasBlock) {
      return 'a property assignment names exactly one of a page or a block';
    }
    if (hasPage && !this.#pages.has(page)) return 'no such page';
    if (hasBlock && !this.#blocks.has(block)) return 'no such block';
    return null;
  }

  #findProperty(
    page: PageId | undefined,
    block: BlockId | undefined,
    key: string,
  ): PropertyAssignment | undefined {
    const subject = page ?? block;
    if (subject === undefined) return undefined;
    return this.#propertiesBySubject.get(subject)?.find((p) => p.key === key);
  }

  /**
   * La página que lleva ese título, sin distinguir mayúsculas ni acentos.
   *
   * Pública porque una URL la nombra por su título: [[LogSeq]] y [[Logseq]] son
   * la misma página, y una dirección escrita a mano también debería serlo.
   */
  pageTitled(title: string): Page | undefined {
    return this.#pageTitled(title);
  }

  #pageTitled(title: string): Page | undefined {
    const id = this.#pageByTitleKey.get(titleKey(title));
    return id === undefined ? undefined : this.#pages.get(id);
  }

  // -------------------------------------------------------------------------
  // Aplicación: los `ensures` de change-application.allium
  // -------------------------------------------------------------------------

  /**
   * `at` es cuándo ocurrió la operación, no cuándo se está aplicando.
   *
   * Importa porque aplicar pasa dos veces: al enviarse y al reproducir el
   * registro, que es como se levanta el grafo en cada arranque. Con el reloj de
   * la máquina, la segunda vez volvía a estampar cada página con la hora de
   * arranque, y un corpus de años terminaba diciendo que nació hoy. Con la fecha
   * de la operación, reproducir devuelve el mismo grafo — que es lo que
   * @invariant ReplayReconstructsState pide, y esto lo estaba incumpliendo en
   * silencio porque el único síntoma era una fecha.
   */
  /*
   * Aplicar, y anotar cuándo se tocó la página.
   *
   * `Page` tiene fecha de creación y no de actualización, y hacía falta una: una
   * lista de páginas ordenada por cuándo se escribió por última vez es media
   * razón para tener consultas. Se lleva aquí y no en una columna porque el grafo
   * se reconstruye reproduciendo el registro —cada operación trae su fecha— y
   * entonces la cuenta sale sola y no puede discrepar de lo que pasó.
   *
   * La página que una operación toca es la suya si la nombra, la del bloque si
   * nombra un bloque —mirada antes de aplicar, porque borrarlo se lo lleva— y el
   * sujeto mismo cuando el sujeto es una página.
   */
  #apply(change: Change, recordedSubject: string | null, at: number): string {
    // Toda operación puede cambiar la selección o mover la consulta que la aloja.
    this.#queryResultLinksCache = null;
    const beforehand =
      'block' in change && typeof change.block === 'string'
        ? (this.#blocks.get(change.block)?.page ?? null)
        : 'crossing' in change && typeof change.crossing === 'string'
          ? (this.#crossings.get(change.crossing)?.fromPage ?? null)
          : null;
    const subjectId = this.#applyChange(change, recordedSubject, at);

    const touched =
      ('page' in change && typeof change.page === 'string' ? change.page : null) ??
      beforehand ??
      (this.#pages.has(subjectId)
        ? subjectId
        : (this.#blocks.get(subjectId)?.page ?? this.#crossings.get(subjectId)?.fromPage ?? null));
    if (touched !== null && this.#pages.has(touched)) {
      this.#updatedAt.set(touched, Math.max(at, this.#updatedAt.get(touched) ?? 0));
    }
    const related = this.#blocks.get(subjectId)?.crossing ??
      ('block' in change && typeof change.block === 'string'
        ? this.#blocks.get(change.block)?.crossing
        : null);
    if (related != null) {
      const crossing = this.#crossings.get(related);
      if (crossing !== undefined) crossing.updatedAt = at;
    }
    return subjectId;
  }

  #applyChange(change: Change, recordedSubject: string | null, at: number): string {
    if (recordedSubject !== null) this.#observeId(recordedSubject);
    switch (change.kind) {
      case 'create_page': {
        // Igual que en `create_block`: la identidad propuesta gana. La trae la
        // importación, para conservar la que el corpus ya tenía, y la trae un
        // cliente que aplicó el cambio antes de enviarlo, para poder nombrar lo
        // que acaba de crear sin preguntar.
        const id = recordedSubject ?? change.stableId ?? this.#nextId('page');
        this.#pages.set(id, {
          id,
          graph: this.id,
          title: change.title,
          visibility: change.visibility,
          createdAt: at,
          originCreatedAt: null,
        });
        this.#pageByTitleKey.set(titleKey(change.title), id);
        this.#resolveWaitingLinks(id);
        return id;
      }
      case 'recover_page_origin': {
        const page = this.#pages.get(change.page);
        if (page !== undefined) page.originCreatedAt = change.originCreatedAt;
        return change.page;
      }
      case 'rename_page': {
        const page = this.#pages.get(change.page);
        if (page === undefined) return change.page;
        const before = page.title;

        /*
         * Renombrar arrastra a los enlaces que la nombraban.
         *
         * Antes no: la frase que decía el título viejo no había cambiado, así
         * que su enlace volvía a quedar esperando. Era coherente y dejaba el
         * grafo peor, porque un enlace roto no le sirve a nadie: la conexión
         * existía, nadie la deshizo, y la única razón de que se perdiera era que
         * el nombre se escribe en dos sitios. Que Vera sepa cuáles son esos dos
         * sitios es exactamente lo que la hace capaz de repararlo.
         *
         * Se reescribe sólo lo que está entre corchetes. El mismo nombre suelto
         * en la prosa no es un enlace y no se toca: cambiarlo sería reescribir
         * lo que alguien dijo, no a dónde apuntaba.
         *
         * Va dentro de aplicar el renombrado y no como operaciones aparte. Un
         * corpus donde renombrar deja treinta `edit_block` a nombre de quien
         * renombró convierte un gesto en treinta hechos falsos sobre quién
         * escribió qué. Aquí es un solo hecho —se renombró— con la consecuencia
         * que le corresponde, y @invariant ReplayReconstructsState se sostiene
         * porque reproducir el registro vuelve a hacer la misma reescritura.
         */
        const naming = [...(this.#linksByTarget.get(change.page) ?? [])].map(
          (link) => link.sourceBlock,
        );

        this.#pageByTitleKey.delete(titleKey(before));
        page.title = change.title;
        this.#pageByTitleKey.set(titleKey(change.title), change.page);

        for (const id of new Set(naming)) {
          const block = this.#blocks.get(id);
          if (block === undefined) continue;
          const next = retitleLinks(block.content, before, change.title);
          if (next === block.content) continue;
          block.content = next;
          // Recalcular el bloque entero, como cualquier otro cambio de texto:
          // así el enlace nuevo nace por el mismo camino que los demás.
          this.#settleBlock(id);
        }

        // Lo que quede nombrando el título viejo —prosa que el corchete no
        // cubría, o un enlace que ya esperaba— se recoloca aquí.
        for (const link of [...(this.#linksByTarget.get(change.page) ?? [])]) {
          if (titleKey(link.targetTitle) !== titleKey(change.title)) {
            this.#setLinkTarget(link, null);
          }
        }
        this.#resolveWaitingLinks(change.page);
        return change.page;
      }
      case 'set_page_visibility': {
        const page = this.#pages.get(change.page);
        if (page) page.visibility = change.visibility;
        return change.page;
      }
      case 'remove_page': {
        const page = this.#pages.get(change.page);
        if (page) this.#pageByTitleKey.delete(titleKey(page.title));
        this.#pages.delete(change.page);
        this.#blocksByPage.delete(change.page);
        // La referencia sobrevive a su destino, igual que una página nunca escrita.
        for (const link of [...(this.#linksByTarget.get(change.page) ?? [])]) {
          this.#setLinkTarget(link, null);
        }
        return change.page;
      }
      case 'create_block': {
        // La identidad propuesta por la importación gana: adoptar la que el
        // corpus ya traía es lo que hace que sus referencias sobrevivan.
        const id = recordedSubject ?? change.stableId ?? this.#nextId('block');
        this.#blocks.set(id, {
          stableId: id,
          page: change.page,
          crossing: change.crossing ?? null,
          parent: change.parent,
          position: change.position,
          content: change.content,
          createdAt: at,
        });
        this.#indexBlock(id, change.page, change.crossing ?? null, change.parent);
        this.#reseat(change.page, change.crossing ?? null, change.parent, id, change.position);
        this.#settleBlock(id);
        return id;
      }
      case 'edit_block': {
        const block = this.#blocks.get(change.block);
        // stableId, page, parent y position no se tocan: esa ausencia es la garantía.
        if (block) block.content = change.content;
        this.#settleBlock(change.block);
        return change.block;
      }
      case 'move_block': {
        const block = this.#blocks.get(change.block);
        if (block) {
          const fromPage = block.page;
          const fromCrossing = block.crossing ?? null;
          const fromParent = block.parent;
          this.#deindexBlock(change.block, fromPage, fromCrossing, fromParent);
          block.page = change.page;
          block.crossing = change.crossing ?? null;
          block.parent = change.parent;
          this.#indexBlock(change.block, block.page, block.crossing, change.parent);
          // El grupo que deja atrás cierra su hueco; el que lo recibe lo sienta
          // en el índice pedido. Las dos renumeraciones son parte de aplicar
          // esta operación, no operaciones aparte.
          this.#renumber(fromPage, fromCrossing, fromParent);
          this.#reseat(block.page, block.crossing, change.parent, change.block, change.position);
        }
        // El subárbol viaja con su raíz: el padre debe vivir en la misma página.
        for (const descendant of this.descendantsOf(change.block)) {
          this.#deindexBlock(descendant.stableId, descendant.page, descendant.crossing ?? null, descendant.parent);
          descendant.page = block!.page;
          descendant.crossing = change.crossing ?? null;
          this.#indexBlock(descendant.stableId, descendant.page, descendant.crossing ?? null, descendant.parent);
          this.#settleBlock(descendant.stableId);
        }
        this.#settleBlock(change.block);
        return change.block;
      }
      case 'remove_block': {
        const block = this.#blocks.get(change.block);
        const page = block?.page;
        const parent = block?.parent ?? null;
        const crossing = block?.crossing;
        if (block) this.#deindexBlock(change.block, block.page, block.crossing ?? null, block.parent);
        this.#blocks.delete(change.block);
        this.#clearLinksOf(change.block);
        this.#tags.delete(change.block);
        this.#unportedByBlock.delete(change.block);
        this.#glosses.delete(change.block);
        // El grupo cierra el hueco: las posiciones de un grupo de hermanos son
        // densas, y un hueco haría que el siguiente índice pedido cayera mal.
        if (page !== undefined || crossing !== undefined) this.#renumber(page ?? null, crossing ?? null, parent);
        return change.block;
      }
      case 'create_crossing': {
        const id = recordedSubject ?? change.stableId ?? this.#nextId('crossing');
        const to = this.#pages.get(change.toPage)!;
        this.#crossings.set(id, {
          stableId: id,
          connective: id,
          said: change.content,
          blocks: [],
          fromBlock: null,
          fromPage: change.fromPage,
          targetTitle: to.title,
          toPage: change.toPage,
          sense: 'directed',
          term: change.term?.trim() || null,
          createdAt: at,
          updatedAt: at,
        });
        const first = `block:${id.replace(/^crossing:/, 'crossing-')}:root`;
        this.#observeId(first);
        this.#blocks.set(first, {
          stableId: first,
          page: change.fromPage,
          crossing: id,
          parent: null,
          position: 0,
          content: change.content,
          createdAt: at,
        });
        this.#indexBlock(first, null, id, null);
        return id;
      }
      case 'edit_crossing': {
        const crossing = this.#crossings.get(change.crossing);
        if (crossing !== undefined) {
          const root = this.blocksOfCrossing(change.crossing)
            .filter((block) => block.parent === null)
            .sort((a, b) => a.position - b.position)[0];
          if (root !== undefined) root.content = change.content;
          crossing.said = change.content;
          crossing.term = change.term?.trim() || null;
          crossing.updatedAt = at;
        }
        return change.crossing;
      }
      case 'set_block_gloss': {
        const held = this.#glosses.get(change.block);
        if (held === undefined) {
          this.#glosses.set(change.block, {
            block: change.block,
            content: change.content,
            createdAt: at,
            updatedAt: at,
          });
        } else {
          held.content = change.content;
          held.updatedAt = at;
        }
        return change.block;
      }
      case 'set_property': {
        const held = this.#findProperty(change.page, change.block, change.propertyKey);
        if (held !== undefined) {
          held.value = change.propertyValue;
        } else {
          const subject = change.page ?? change.block ?? '';
          const held = this.#propertiesBySubject.get(subject) ?? [];
          held.push({
            graph: this.id,
            page: change.page ?? null,
            block: change.block ?? null,
            key: change.propertyKey,
            value: change.propertyValue,
          });
          this.#propertiesBySubject.set(subject, held);
        }
        return change.page ?? change.block ?? '';
      }
      case 'remove_property': {
        const subject = change.page ?? change.block ?? '';
        const held = this.#propertiesBySubject.get(subject);
        if (held !== undefined) {
          this.#propertiesBySubject.set(
            subject,
            held.filter((p) => p.key !== change.propertyKey),
          );
        }
        return change.page ?? change.block ?? '';
      }
    }
  }

  // -------------------------------------------------------------------------
  // Índices derivados (graph-navigation.allium, query-language.allium)
  // -------------------------------------------------------------------------

  /**
   * rule RecomputeLinksForSettledBlock. Recalcula el bloque entero en vez de
   * diferenciarlo: así no hay camino por el que un enlace sobreviva a la frase
   * que lo creó.
   */
  #settleBlock(id: BlockId): void {
    const block = this.#blocks.get(id);
    if (block === undefined) return;

    this.#clearLinksOf(id);

    // Las menciones de una conectiva pertenecen al discurso de la relación.
    // Hasta que exista su índice propio no se atribuyen al extremo de origen.
    if (block.crossing != null) {
      this.#queryBlocks.delete(id);
      this.#linksByBlock.set(id, []);
      this.#tags.set(id, []);
      this.#unportedByBlock.delete(id);
      return;
    }

    /*
     * Un bloque que pregunta no aporta enlaces ni etiquetas.
     *
     * `? ->[[Ciudad Abierta]]` nombra esa página, y aun así preguntar por algo no
     * es hablar de algo: con seis consultas en una portada, los retroenlaces de
     * la página más consultada se llenan de preguntas que no dicen nada de ella,
     * y el vecindario del mapa se puebla de aristas que sólo cuentan que alguien
     * quiso una lista. Lo decidió Herbert el 7 de agosto de 2026, mirando a
     * «Vera» aparecer entre los retroenlaces de sí misma por una consulta.
     *
     * El enlace se sigue viendo y se sigue pulsando en el texto de la pregunta:
     * lo que no ocurre es que cuente como un enlace del corpus.
     */
    if (looksLikeQuery(block.content)) {
      this.#queryBlocks.add(id);
      this.#linksByBlock.set(id, []);
      this.#tags.set(id, []);
      this.#unportedByBlock.delete(id);
      return;
    }

    this.#queryBlocks.delete(id);

    const fresh: PageLink[] = [];
    for (const title of referencedTitles(block.content)) {
      const target = this.#pageTitled(title);
      const link: PageLink = {
        id: this.#nextId('link'),
        graph: this.id,
        sourcePage: block.page,
        sourceBlock: id,
        targetTitle: title,
        target: null,
      };
      fresh.push(link);
      this.#registerLink(link, target?.id ?? null);
    }
    this.#linksByBlock.set(id, fresh);

    this.#tags.set(id, referencedTags(block.content));

    // @invariant NoSilentTranslation: se preserva el literal, no se traduce.
    this.#unportedByBlock.delete(id);
    const macro = queryMacroText(block.content);
    if (macro !== null) {
      this.#unportedByBlock.set(id, {
        id: this.#nextId('unported'),
        graph: this.id,
        block: id,
        sourceText: macro,
        portedTo: null,
        portedBy: null,
        portedAt: null,
      });
    }
  }

  /** rule ResolveWaitingLinksToNewPage */
  #resolveWaitingLinks(page: PageId): void {
    const held = this.#pages.get(page);
    if (held === undefined) return;
    const waiting = this.#unresolvedByTitleKey.get(titleKey(held.title));
    if (waiting === undefined) return;
    for (const link of [...waiting]) this.#setLinkTarget(link, page);
  }

  // -------------------------------------------------------------------------
  // Mantenimiento de índices
  // -------------------------------------------------------------------------

  /** Los hermanos de un bloque: los hijos de su padre, o las raíces de la página. */
  #siblings(page: PageId | null, crossing: CrossingId | null, parent: BlockId | null): Block[] {
    const group =
      parent === null
        ? (crossing !== null ? this.blocksOfCrossing(crossing) : this.blocksOf(page!))
            .filter((block) => block.parent === null)
        : this.childrenOf(parent);
    return group.sort((a, b) => a.position - b.position);
  }

  /**
   * Sienta un bloque en el índice pedido entre sus hermanos y renumera el grupo.
   *
   * `position` en un cambio es el lugar que se pide, no un número que se copia.
   * Renumerar aquí es lo que permite que insertar en medio sea UNA operación: si
   * el emisor tuviera que correr a los hermanos, pulsar Enter en una página con
   * treinta bloques se registraría como treinta cambios, y el log dejaría de
   * decir qué hizo alguien para decir cómo lo hizo la interfaz.
   */
  #reseat(page: PageId | null, crossing: CrossingId | null, parent: BlockId | null, moved: BlockId, index: number): void {
    const block = this.#blocks.get(moved);
    if (block === undefined) return;

    const order = this.#siblings(page, crossing, parent).filter((sibling) => sibling.stableId !== moved);
    const at = Math.max(0, Math.min(Math.trunc(index), order.length));
    order.splice(at, 0, block);

    for (const [position, sibling] of order.entries()) sibling.position = position;
  }

  /** Cierra el hueco que deja un bloque al salir de su grupo de hermanos. */
  #renumber(page: PageId | null, crossing: CrossingId | null, parent: BlockId | null): void {
    const order = this.#siblings(page, crossing, parent);
    for (const [position, sibling] of order.entries()) sibling.position = position;
  }

  #indexBlock(id: BlockId, page: PageId | null, crossing: CrossingId | null, parent: BlockId | null): void {
    const index: Map<string, Set<BlockId>> = crossing !== null ? this.#blocksByCrossing : this.#blocksByPage;
    const owner = crossing ?? page!;
    let held = index.get(owner);
    if (held === undefined) {
      held = new Set();
      index.set(owner, held);
    }
    held.add(id);
    if (parent !== null) {
      let siblings = this.#childrenByParent.get(parent);
      if (siblings === undefined) {
        siblings = new Set();
        this.#childrenByParent.set(parent, siblings);
      }
      siblings.add(id);
    }
  }

  #deindexBlock(id: BlockId, page: PageId | null, crossing: CrossingId | null, parent: BlockId | null): void {
    if (crossing !== null) this.#blocksByCrossing.get(crossing)?.delete(id);
    else this.#blocksByPage.get(page!)?.delete(id);
    if (parent !== null) this.#childrenByParent.get(parent)?.delete(id);
  }

  /** Registra un enlace nuevo en el índice que le corresponde según resuelva o no. */
  #registerLink(link: PageLink, target: PageId | null): void {
    link.target = target;
    if (target === null) {
      const key = titleKey(link.targetTitle);
      let waiting = this.#unresolvedByTitleKey.get(key);
      if (waiting === undefined) {
        waiting = new Set();
        this.#unresolvedByTitleKey.set(key, waiting);
      }
      waiting.add(link);
    } else {
      let inbound = this.#linksByTarget.get(target);
      if (inbound === undefined) {
        inbound = new Set();
        this.#linksByTarget.set(target, inbound);
      }
      inbound.add(link);
    }
  }

  /** Mueve un enlace entre el índice de resueltos y el de los que esperan. */
  #setLinkTarget(link: PageLink, target: PageId | null): void {
    if (link.target !== null) this.#linksByTarget.get(link.target)?.delete(link);
    else this.#unresolvedByTitleKey.get(titleKey(link.targetTitle))?.delete(link);
    this.#registerLink(link, target);
  }

  #clearLinksOf(block: BlockId): void {
    for (const link of this.#linksByBlock.get(block) ?? []) {
      if (link.target !== null) this.#linksByTarget.get(link.target)?.delete(link);
      else this.#unresolvedByTitleKey.get(titleKey(link.targetTitle))?.delete(link);
    }
    this.#linksByBlock.delete(block);
  }

  /** rule PortLegacyQueryToVeraExpression */
  portLegacyQuery(input: {
    unported: string;
    expression: QueryExpression;
    participant: ParticipantId;
  }): void {
    if (!this.#isActive(input.participant)) {
      throw new Error(`${input.participant} has no active membership in this graph`);
    }
    const held = this.unportedQueries().find((u) => u.id === input.unported);
    if (held === undefined) throw new Error('no such unported query');
    if (held.portedTo !== null) throw new Error('this query has already been ported');
    held.portedTo = input.expression;
    held.portedBy = input.participant;
    held.portedAt = Date.now();
  }

  // -------------------------------------------------------------------------
  // Búsqueda (search-index.allium)
  // -------------------------------------------------------------------------

  search(input: { text: string; participant: ParticipantId }): SearchOutcome {
    if (!this.#isActive(input.participant)) {
      throw new Error(`${input.participant} has no active membership in this graph`);
    }

    const found: Omit<SearchHit, 'rank'>[] = [];
    if (input.text !== '') {
      for (const page of this.pages()) {
        if (matches(page.title, input.text)) {
          found.push({
            page: page.id,
            block: null,
            field: 'page_title',
            excerpt: excerpt(page.title, input.text),
          });
        }
      }
      for (const block of this.allBlocks()) {
        if (matches(block.content, input.text)) {
          found.push({
            page: block.page,
            block: block.stableId,
            field: 'block_content',
            excerpt: excerpt(block.content, input.text),
          });
        }
      }
      for (const property of this.#allProperties()) {
        if (!matches(property.value, input.text)) continue;
        const page = property.page ?? this.#blocks.get(property.block ?? '')?.page;
        if (page === undefined) continue;
        found.push({
          page,
          block: property.block,
          field: 'property_value',
          excerpt: `${property.key}: ${property.value}`,
        });
      }
      for (const gloss of this.glosses()) {
        if (!matches(gloss.content, input.text)) continue;
        const page = this.#blocks.get(gloss.block)?.page;
        if (page === undefined) continue;
        found.push({
          page,
          block: gloss.block,
          field: 'gloss_content',
          excerpt: excerpt(gloss.content, input.text),
        });
      }
    }

    // @invariant StableOrdering: desempate determinista, para que dos búsquedas
    // idénticas no cambien de orden entre sí.
    found.sort((a, b) => {
      const byField = FIELD_ORDER[a.field] - FIELD_ORDER[b.field];
      if (byField !== 0) return byField;
      if (a.page !== b.page) return a.page < b.page ? -1 : 1;
      return (a.block ?? '') < (b.block ?? '') ? -1 : (a.block ?? '') > (b.block ?? '') ? 1 : 0;
    });

    return {
      graph: this.id,
      text: input.text,
      searchedBy: input.participant,
      hits: found.map((hit, at) => ({ ...hit, rank: at + 1 })),
    };
  }

  // -------------------------------------------------------------------------
  // Consulta (query-language.allium)
  // -------------------------------------------------------------------------

  /** Cuándo se tocó por última vez una página. Sin haberla tocado, cuándo nació. */
  updatedAt(page: PageId): number | null {
    const held = this.#pages.get(page);
    if (held === undefined) return null;
    return this.#updatedAt.get(page) ?? held.createdAt;
  }

  query(input: {
    expression: QueryExpression;
    participant: ParticipantId;
    /** Universo visible para esta lectura; sin él rige el grafo entero. */
    within?: readonly PageId[];
  }): { graph: GraphId; matchingPages: PageId[]; matchingBlocks: BlockId[] } {
    if (!this.#isActive(input.participant)) {
      throw new Error(`${input.participant} has no active membership in this graph`);
    }
    const scope = input.within === undefined ? null : new Set(input.within);
    const selected = this.#select(input.expression, scope);
    const pages = this.pages().filter((p) => selected.has(p.id) && (scope === null || scope.has(p.id)));
    return {
      graph: this.id,
      matchingPages: pages.map((p) => p.id),
      matchingBlocks: this.#evidence(input.expression, pages),
    };
  }

  /*
   * Los bloques que dicen lo que se preguntó.
   *
   * Una consulta selecciona páginas, pero cuando la pregunta era por texto o por
   * etiqueta hay un bloque concreto que la contesta, y devolver sólo la página
   * obliga a quien lee a buscar otra vez a mano lo que aquí ya se encontró.
   *
   * Sólo los términos en positivo: un `!~borrador` no tiene bloque que enseñar
   * —lo que selecciona es la ausencia— y sacar el bloque de una negación diría
   * exactamente lo contrario de lo que la pregunta pedía.
   *
   * Y son evidencia, no prueba: en una pregunta con `*`, una página puede haber
   * entrado por la otra rama y contener además la palabra. Lo que esto afirma es
   * «aquí lo dice», no «por esto entró».
   */
  #evidence(expression: QueryExpression, pages: Page[]): BlockId[] {
    const texts: string[] = [];
    const tags: string[] = [];
    const walk = (node: QueryExpression, negated: boolean): void => {
      switch (node.kind) {
        case 'ContentTerm':
          if (!negated) texts.push(node.text);
          return;
        case 'TagTerm':
          if (!negated) tags.push(node.tag);
          return;
        case 'NotTerm':
          walk(node.operand, !negated);
          return;
        case 'AndTerm':
        case 'OrTerm':
          for (const operand of node.operands) walk(operand, negated);
          return;
        default:
          return;
      }
    };
    walk(expression, false);
    if (texts.length === 0 && tags.length === 0) return [];

    const found: BlockId[] = [];
    for (const page of pages) {
      for (const block of this.blocksOf(page.id)) {
        const says =
          texts.some((text) => matches(block.content, text)) ||
          tags.some((tag) => this.tagsOf(block.stableId).includes(tag));
        if (says) found.push(block.stableId);
      }
    }
    return found;
  }

  #select(expression: QueryExpression, scope: ReadonlySet<PageId> | null = null): Set<PageId> {
    switch (expression.kind) {
      case 'TitleTerm':
        return this.#pagesWhere((page) => matches(page.title, expression.text), scope);
      case 'ContentTerm':
        return this.#pagesWhere(
          (page) => this.blocksOf(page.id).some((b) => matches(b.content, expression.text)),
          scope,
        );
      case 'TagTerm':
        return this.#pagesWhere(
          (page) => this.blocksOf(page.id).some((b) => this.tagsOf(b.stableId).includes(expression.tag)),
          scope,
        );
      case 'PropertyTerm': {
        /*
         * Tres claves no están escritas en ninguna propiedad y se contestan
         * igual: cuándo nació la página, cuándo se la tocó y si es pública.
         *
         * Se miran antes que lo escrito porque son las que el pie de la página
         * enseña como propiedades: lo que se ve como propiedad tiene que poder
         * preguntarse como propiedad, y guardarlas además en una tabla daría dos
         * sitios diciendo lo mismo. Ver DERIVED en property-names.ts.
         */
        const derived = derivedRole(expression.key, this.#names);
        if (derived !== null) {
          return this.#pagesWhere((page) => {
            const said = this.#derivedValue(page, derived);
            return expression.value === null
              ? said !== null
              : said !== null && said.toLowerCase() === expression.value.toLowerCase();
          }, scope);
        }
        return this.#pagesWhere(
          (page) => this.propertiesOf(page.id).some(
            (p) =>
              p.key === expression.key &&
              (expression.value === null || p.value === expression.value),
          ),
          scope,
        );
      }
      /*
       * Los enlaces se comparan por título y con el mismo plegado que el resto
       * del grafo: `[[ciudad abierta]]` y `[[Ciudad Abierta]]` son el mismo
       * enlace, y preguntar por uno tiene que encontrar el otro.
       *
       * Por título y no por identidad a propósito: un enlace guarda lo que se
       * escribió aunque no resuelva, así que esto encuentra también las páginas
       * que apuntan a algo que nadie ha escrito todavía. Un título que ninguna
       * página lleva selecciona vacío, que es la respuesta y no un error.
       */
      case 'LinksToTerm': {
        const wanted = titleKey(expression.targetTitle);
        return new Set(
          this.#writtenLinks()
            .filter((l) => titleKey(l.targetTitle) === wanted && (scope === null || scope.has(l.sourcePage)))
            .map((l) => l.sourcePage),
        );
      }
      case 'LinkedFromTerm': {
        const from = this.#pageTitled(expression.originTitle);
        if (from === undefined || (scope !== null && !scope.has(from.id))) return new Set<PageId>();
        return new Set(
          this.#writtenLinks()
            .filter((l) => l.sourcePage === from.id && l.target !== null && (scope === null || scope.has(l.target)))
            .map((l) => l.target as PageId),
        );
      }
      case 'AndTerm': {
        const sets = expression.operands.map((o) => this.#select(o, scope));
        const first = sets[0] ?? new Set<PageId>();
        return new Set([...first].filter((p) => sets.every((s) => s.has(p))));
      }
      case 'OrTerm': {
        const union = new Set<PageId>();
        for (const operand of expression.operands) {
          for (const page of this.#select(operand, scope)) union.add(page);
        }
        return union;
      }
      case 'NotTerm': {
        // @invariant NegationIsGraphScoped: el complemento es dentro de este grafo.
        const excluded = this.#select(expression.operand, scope);
        return this.#pagesWhere((page) => !excluded.has(page.id), scope);
      }
    }
  }

  /*
   * Lo que una propiedad derivada contesta de una página.
   *
   * Las fechas se dicen como se titula un día —`2026-08-07`— porque es como se
   * escriben en este corpus y porque así preguntar por una fecha y enlazar a su
   * bitácora se escriben igual. Lo público se dice sí o no: es lo que la
   * cabecera enseña y lo que alguien escribiría al preguntarlo.
   */
  #derivedValue(page: Page, role: PropertyRole): string | null {
    if (role === 'created') return calendarDay(page.createdAt);
    if (role === 'updated') {
      const when = this.updatedAt(page.id);
      return when === null ? null : calendarDay(when);
    }
    if (role === 'visible') return page.visibility === 'public' ? 'sí' : 'no';
    return null;
  }

  #pagesWhere(predicate: (page: Page) => boolean, scope: ReadonlySet<PageId> | null = null): Set<PageId> {
    return new Set(this.pages().filter((page) => (scope === null || scope.has(page.id)) && predicate(page)).map((p) => p.id));
  }

  // -------------------------------------------------------------------------
  // Vecindad (graph-navigation.allium)
  // -------------------------------------------------------------------------

  neighbourhood(input: {
    centre: PageId;
    depth: number;
    participant: ParticipantId;
  }): GraphNeighbourhood {
    if (!this.#isActive(input.participant)) {
      throw new Error(`${input.participant} has no active membership in this graph`);
    }
    if (!this.#pages.has(input.centre)) throw new Error('no such page');
    if (input.depth < 0) throw new Error('depth cannot be negative');

    // Aristas no dirigidas entre páginas, sólo desde enlaces resueltos.
    const adjacency = new Map<PageId, Set<PageId>>();
    const connect = (a: PageId, b: PageId): void => {
      if (a === b) return;
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a)?.add(b);
      adjacency.get(b)?.add(a);
    };
    for (const link of this.links()) {
      if (link.target !== null) connect(link.sourcePage, link.target);
    }

    // Expansión por anchura, acotada: termina en cualquier grafo, también cíclico.
    const distance = new Map<PageId, number>([[input.centre, 0]]);
    let frontier: PageId[] = [input.centre];
    for (let step = 0; step < input.depth; step += 1) {
      const next: PageId[] = [];
      for (const page of frontier) {
        for (const neighbour of adjacency.get(page) ?? []) {
          if (distance.has(neighbour) || !this.#pages.has(neighbour)) continue;
          distance.set(neighbour, step + 1);
          next.push(neighbour);
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }

    const included = new Set(distance.keys());
    const seenEdge = new Set<string>();
    const edges: NeighbourhoodEdge[] = [];
    for (const link of this.links()) {
      const target = link.target;
      if (target === null) continue;
      if (!included.has(link.sourcePage) || !included.has(target)) continue;
      if (link.sourcePage === target) continue;
      const key = [link.sourcePage, target].sort().join('||');
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push({ source: link.sourcePage, target });
    }

    const nodes: NeighbourhoodNode[] = [...distance.entries()].map(([page, at]) => ({
      page,
      distance: at,
      degree: edges.filter((e) => e.source === page || e.target === page).length,
      blockCount: this.blocksOf(page).length,
    }));

    return { graph: this.id, centre: input.centre, depth: input.depth, nodes, edges };
  }

  // -------------------------------------------------------------------------
  // Publicación (core.allium)
  //
  // Publicar es un acto, no un atributo. Que una página sea pública la hace
  // elegible; lo que la pone en un sitio es que alguien la publique ahí, y eso
  // queda escrito con sitio, frontera inicial, dirección, fecha y mano.
  // @guarantee HumanPublicationAuthority
  // -------------------------------------------------------------------------

  /** rule CreatePersonalSite — un destino de publicación con dueño y dominio. */
  createSite(input: {
    owner: ParticipantId;
    title: string;
    canonicalDomain: string;
    id?: PersonalSiteId;
  }): PersonalSite {
    const owner = this.#participants.get(input.owner);
    if (owner === undefined || owner.kind !== 'human') {
      throw new Error('a personal site belongs to a human participant');
    }
    if (this.#memberships.get(input.owner) !== 'active') {
      throw new Error('the site owner is not an active member of this graph');
    }
    if (input.id !== undefined) this.#observeId(input.id);
    const title = input.title.trim();
    if (title === '') throw new Error('a personal site needs a title');
    const canonicalDomain = normaliseCanonicalDomain(input.canonicalDomain);
    if (this.sites().some((candidate) => candidate.canonicalDomain === canonicalDomain)) {
      throw new Error(`a site already uses ${canonicalDomain}`);
    }
    const site: PersonalSite = {
      id: input.id ?? this.#nextId('site'),
      graph: this.id,
      owner: input.owner,
      title,
      canonicalDomain,
      entryPoint: null,
    };
    this.#sites.set(site.id, site);
    return site;
  }

  sites(): PersonalSite[] {
    return [...this.#sites.values()];
  }

  site(id: PersonalSiteId): PersonalSite | undefined {
    return this.#sites.get(id);
  }

  /** El sitio nombrado por su dominio canónico, que es como lo nombra quien publica. */
  siteByDomain(domain: string): PersonalSite | undefined {
    let wanted: string;
    try {
      wanted = normaliseCanonicalDomain(domain);
    } catch {
      return undefined;
    }
    return this.sites().find((site) => site.canonicalDomain === wanted);
  }

  /** El dueño corrige la identidad pública del sitio sin reemplazarlo. */
  configureSite(input: {
    site: PersonalSiteId;
    participant: ParticipantId;
    title: string;
    canonicalDomain: string;
  }): PersonalSite {
    const site = this.#sites.get(input.site);
    if (site === undefined) throw new Error(`no such site ${input.site}`);
    if (site.owner !== input.participant) throw new Error('only the site owner configures it');
    const title = input.title.trim();
    if (title === '') throw new Error('a personal site needs a title');
    const canonicalDomain = normaliseCanonicalDomain(input.canonicalDomain);
    if (
      this.sites().some(
        (candidate) => candidate.id !== site.id && candidate.canonicalDomain === canonicalDomain,
      )
    ) {
      throw new Error(`a site already uses ${canonicalDomain}`);
    }
    site.title = title;
    site.canonicalDomain = canonicalDomain;
    return site;
  }

  /** La portada siempre es una página que este mismo sitio ya publica. */
  setSiteEntryPoint(input: {
    site: PersonalSiteId;
    page: PageId | null;
    participant: ParticipantId;
  }): PersonalSite {
    const site = this.#sites.get(input.site);
    if (site === undefined) throw new Error(`no such site ${input.site}`);
    if (site.owner !== input.participant) {
      throw new Error('only the site owner chooses its entry point');
    }
    if (
      input.page !== null &&
      !this.#publications.some(
        (publication) => publication.site === site.id && publication.page === input.page,
      )
    ) {
      throw new Error('the entry point must already be published on this site');
    }
    site.entryPoint = input.page;
    return site;
  }

  /**
   * rule PublishVisiblePage.
   *
   * `firstRevision` sólo se recibe al rehidratar una publicación persistida. Al
   * publicar normalmente, la revisión vigente abre la frontera pública.
   */
  publish(input: {
    site: PersonalSiteId;
    page: PageId;
    path: string;
    participant: ParticipantId;
    firstRevision?: OperationId;
    id?: PublicationId;
    at?: number;
  }): Publication {
    const participant = this.#participants.get(input.participant);
    if (participant === undefined || participant.kind !== 'human') {
      throw new Error('only a human participant may publish');
    }
    if (this.#memberships.get(input.participant) !== 'active') {
      throw new Error('a suspended member does not publish');
    }
    const site = this.#sites.get(input.site);
    if (site === undefined) throw new Error(`no such site ${input.site}`);
    if (site.owner !== input.participant) {
      throw new Error('only the site owner may publish');
    }
    const page = this.#pages.get(input.page);
    if (page === undefined) throw new Error('no such page');
    // @invariant PublicationBelongsToSiteGraph
    if (page.graph !== site.graph) {
      throw new Error('the page belongs to another graph than the site');
    }
    // @invariant PrivatePagesAreNeverPublished
    if (page.visibility !== 'public') {
      throw new Error('a private page is never published; set its visibility first');
    }

    const path = normalisePublicPath(input.path);
    if (path === '') throw new Error('a publication needs a path');
    // @invariant PublicationPathIsUniqueWithinSite: dos publicaciones en la misma
    // dirección no son dos, son una que perdió a la otra.
    const occupied = this.#publications.find((p) => p.site === site.id && p.path === path);
    if (occupied !== undefined && occupied.page !== page.id) {
      throw new Error(`the path /${path}/ already publishes another page on this site`);
    }
    // Una página ya publicada en esa dirección sigue siendo la misma vida
    // pública. Volver a pulsar publicar no puede borrar su comienzo.
    if (occupied !== undefined) return occupied;

    // @invariant PublicationBeginsAtARevisionOfItsPage
    const firstRevision = input.firstRevision ?? this.#lastRevisionOf(page.id);
    if (firstRevision === null) {
      throw new Error('the page has no revision to publish');
    }
    if (input.firstRevision !== undefined) {
      const named = this.#revisions.find((r) => r.operation === input.firstRevision);
      if (named === undefined) throw new Error(`no such revision ${input.firstRevision}`);
      if (named.page !== page.id) throw new Error('that revision belongs to another page');
    }

    if (input.id !== undefined) this.#observeId(input.id);
    const publication: Publication = {
      id: input.id ?? this.#nextId('publication'),
      site: site.id,
      page: page.id,
      firstRevision,
      path,
      publishedAt: input.at ?? Date.now(),
      publishedBy: input.participant,
    };
    this.#publications.push(publication);
    return publication;
  }

  /** Lo que un build de este sitio recibe: sus publicaciones y nada más. */
  publicationsOf(site: PersonalSiteId): Publication[] {
    return this.#publications.filter((publication) => publication.site === site);
  }

  /** Retira una publicación. La página sigue existiendo; deja de estar en el sitio. */
  unpublish(input: { site: PersonalSiteId; path: string; participant: ParticipantId }): boolean {
    const site = this.#sites.get(input.site);
    if (site === undefined) throw new Error(`no such site ${input.site}`);
    if (site.owner !== input.participant) {
      throw new Error('only the site owner may withdraw a publication');
    }
    const path = normalisePublicPath(input.path);
    const before = this.#publications.length;
    this.#publications = this.#publications.filter(
      (p) => !(p.site === input.site && p.path === path),
    );
    if (
      this.#publications.length < before &&
      site.entryPoint !== null &&
      !this.#publications.some(
        (publication) => publication.site === site.id && publication.page === site.entryPoint,
      )
    ) {
      site.entryPoint = null;
    }
    return this.#publications.length < before;
  }

  #lastRevisionOf(page: PageId): OperationId | null {
    let latest: Revision | null = null;
    for (const revision of this.#revisions) {
      if (revision.page !== page) continue;
      if (latest === null || revision.recordedAt >= latest.recordedAt) latest = revision;
    }
    return latest?.operation ?? null;
  }

  // -------------------------------------------------------------------------
  // Reproducción del log (@invariant ReplayReconstructsState)
  // -------------------------------------------------------------------------

  replayFromLog(): VeraGraph {
    const replayed = new VeraGraph(this.id, this.name);
    for (const participant of this.#participants.values()) {
      replayed.addParticipant(participant);
    }
    for (const [id, status] of this.#memberships) {
      replayed.#memberships.set(id, status);
    }
    replayed.#owner = this.#owner;

    // Publicar no es un cambio del corpus y por eso no está en el registro de
    // operaciones: el log dice qué se escribió, y una publicación dice qué de lo
    // escrito se puso en un sitio. Se conserva como las membresías —copiada, no
    // reproducida—, porque reproducir el log no puede inventar lo que el log no
    // contiene.
    for (const [id, site] of this.#sites) replayed.#sites.set(id, site);
    replayed.#publications = [...this.#publications];

    // Las operaciones ya fueron validadas al admitirse: reproducir es aplicar,
    // reutilizando el sujeto que quedó registrado.
    for (const operation of [...this.#operations].sort((a, b) => a.sequence - b.sequence)) {
      replayed.#apply(operation.submission.change, operation.subjectId, operation.appliedAt);
      // La autoría es materialización del registro, no un hecho aparte: se
      // reconstruye reproduciendo, o @invariant ReplayReconstructsState dejaría
      // de cubrirla y el grafo reproducido no sabría de quién son las palabras.
      replayed.#recordAuthorship(
        operation.submission.change,
        operation.subjectId,
        operation.submission.submittedBy,
        operation.submission.channel,
        operation.appliedAt,
      );
      replayed.#recordRevision(
        operation.submission,
        operation.subjectId,
        operation.appliedAt,
        operation.id,
      );
      replayed.#lastSequence = operation.sequence;
      replayed.#operations.push(operation);
      replayed.#origins.set(operation.originId, operation);
    }
    replayed.#counter = this.#counter;
    return replayed;
  }

  // -------------------------------------------------------------------------
  // Sólo para pruebas del verificador de invariantes
  // -------------------------------------------------------------------------

  /** Corrompe el estado a propósito, saltándose la vía de escritura. */
  unsafeSetBlockStableId(block: BlockId, stableId: BlockId): void {
    const held = this.#blocks.get(block);
    if (held === undefined) throw new Error('no such block');
    (held as { stableId: BlockId }).stableId = stableId;
  }

  #nextId(prefix: string): string {
    this.#counter += 1;
    return `${prefix}:${this.#counter}`;
  }

  /**
   * Mantiene el contador por delante de un identificador que vino dado.
   *
   * Al reproducir el registro los identificadores salen de él y no del contador,
   * así que el contador no avanza solo. Sin esto, lo primero que se creara
   * después de arrancar tomaría un número ya usado y pisaría algo.
   */
  #observeId(id: string): void {
    const n = Number(id.slice(id.indexOf(':') + 1));
    if (Number.isFinite(n) && n > this.#counter) this.#counter = n;
  }
}
