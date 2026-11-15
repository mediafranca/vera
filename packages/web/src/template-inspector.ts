import { api } from './api.ts';
import type {
  Change,
  LibrarianRequestView,
  ObjectDeclared,
  OntologyView,
  PageView,
  PropertyDeclared,
} from './api.ts';

export interface InspectedProperty {
  definition: PropertyDeclared;
  written: { key: string; value: string }[];
  expectedBy: 'global' | 'template';
}

export interface TemplateInspection {
  template: ObjectDeclared | null;
  kind: string | null;
  properties: InspectedProperty[];
  extra: { key: string; value: string }[];
  relations: OntologyView['relations'];
}

const normalized = (text: string): string => text.trim().toLocaleLowerCase();

/** La misma propiedad puede escribirse con cualquiera de sus rótulos lingüísticos. */
export function definitionForKey(
  definitions: readonly PropertyDeclared[],
  key: string,
): PropertyDeclared | undefined {
  const wanted = normalized(key);
  return definitions.find((one) =>
    normalized(one.name) === wanted ||
    Object.values(one.labels).some((label) => normalized(label) === wanted),
  );
}

const objectForName = (objects: readonly ObjectDeclared[], name: string): ObjectDeclared | null => {
  const wanted = normalized(name);
  return objects.find((one) =>
    normalized(one.name) === wanted ||
    Object.values(one.labels).some((label) => normalized(label) === wanted),
  ) ?? null;
};

/**
 * Confronta una instancia con la plantilla sin convertir la plantilla en una
 * puerta. Lo ausente se enseña; lo adicional permanece y se nombra como tal.
 */
export function inspectTemplate(
  page: Pick<PageView, 'properties' | 'crossingsOut' | 'crossingsIn'>,
  ontology: OntologyView,
  kindKey: string,
): TemplateInspection {
  const kindDefinition = definitionForKey(ontology.properties, kindKey);
  const kind = page.properties.find((one) => {
    const definition = definitionForKey(ontology.properties, one.key);
    return kindDefinition === undefined
      ? normalized(one.key) === normalized(kindKey)
      : definition?.block === kindDefinition.block;
  })?.value.trim() ?? null;
  const template = kind === null ? null : objectForName(ontology.objects, kind);
  const expected = new Map<string, InspectedProperty>();

  for (const definition of ontology.properties.filter((one) => one.subject === 'página' && one.global)) {
    expected.set(definition.block, { definition, written: [], expectedBy: 'global' });
  }
  for (const name of template?.properties ?? []) {
    const definition = definitionForKey(ontology.properties, name);
    if (definition !== undefined && !expected.has(definition.block)) {
      expected.set(definition.block, { definition, written: [], expectedBy: 'template' });
    }
  }

  const extra: { key: string; value: string }[] = [];
  for (const assignment of page.properties) {
    const definition = definitionForKey(ontology.properties, assignment.key);
    const inspected = definition === undefined ? undefined : expected.get(definition.block);
    if (inspected === undefined) extra.push(assignment);
    else inspected.written.push(assignment);
  }

  const domainAccepts = (domain: readonly string[]): boolean => {
    if (domain.length === 0) return true;
    if (template === null) return false;
    return domain.some((name) => objectForName([template], name) !== null);
  };
  const relations = ontology.relations.filter((one) =>
    normalized(one.status ?? '') !== 'obsoleta' && domainAccepts(one.domain),
  );

  return { template, kind, properties: [...expected.values()], extra, relations };
}

export type WriteTemplateChange = (change: Change) => Promise<boolean>;

export interface DerivedPropertySuggestion {
  value: string;
  reason: string;
}

/** Una derivación es una regla nominada y estrecha, nunca una semejanza silenciosa. */
export function derivedPropertySuggestion(
  page: Pick<PageView, 'title'>,
  kind: string | null,
  property: PropertyDeclared,
  dayKind = 'bitácora',
): DerivedPropertySuggestion | null {
  const isDate = property.field === 'fecha' && [property.name, ...Object.values(property.labels)]
    .some((name) => normalized(name) === 'fecha');
  if (!isDate || kind === null || normalized(kind) !== normalized(dayKind)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(page.title)) return null;
  return { value: page.title, reason: 'derivada del título canónico de esta bitácora' };
}

export interface TemplateInspectorActions {
  canAskLibrarian?: boolean;
  dayKind?: string;
  onReload?: () => void;
}

const proposalKey = (page: string, property: string, value: string): string =>
  `vera.dismissed-field-proposal:${page}:${property}:${value}`;

function dismissed(page: string, property: string, value: string): boolean {
  try { return localStorage.getItem(proposalKey(page, property, value)) === 'yes'; }
  catch { return false; }
}

function dismiss(page: string, property: string, value: string): void {
  try { localStorage.setItem(proposalKey(page, property, value), 'yes'); }
  catch { /* El rechazo sigue visible en esta composición aunque no se pueda retener. */ }
}

function renderLibrarianProposal(
  request: LibrarianRequestView,
  page: Pick<PageView, 'id' | 'properties'>,
  onReload?: () => void,
): HTMLElement | null {
  const proposal = request.reply?.proposal;
  if (proposal === null || proposal === undefined || proposal.status !== 'proposed') return null;
  const offered = proposal.changes.filter((change): change is Extract<Change, { kind: 'set_property' }> =>
    change.kind === 'set_property' && change.page === page.id && change.block === undefined);
  if (offered.length === 0) return null;

  const card = document.createElement('section');
  card.className = 'field-proposal librarian-field-proposal';
  const title = document.createElement('strong');
  title.textContent = 'Propuesta del bibliotecario';
  const reason = document.createElement('p');
  reason.textContent = request.text;
  const rows = document.createElement('div');
  rows.className = 'field-proposal-rows';
  const controls: Array<{ include: HTMLInputElement; value: HTMLInputElement; change: typeof offered[number]; base: string | null }> = [];
  for (const change of offered) {
    const row = document.createElement('label');
    row.className = 'field-proposal-row';
    const include = document.createElement('input');
    include.type = 'checkbox';
    include.checked = true;
    const name = document.createElement('span');
    name.textContent = change.propertyKey;
    const value = document.createElement('input');
    value.type = 'text';
    value.value = change.propertyValue;
    value.setAttribute('aria-label', `valor propuesto para ${change.propertyKey}`);
    const base = page.properties.find((property) =>
      normalized(property.key) === normalized(change.propertyKey))?.value ?? null;
    row.append(include, name, value);
    rows.append(row);
    controls.push({ include, value, change, base });
  }
  const actions = document.createElement('div');
  actions.className = 'field-proposal-actions';
  const reject = document.createElement('button');
  reject.type = 'button';
  reject.textContent = 'Rechazar';
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'field-proposal-accept';
  accept.textContent = 'Aceptar selección';
  const decide = (decision: 'accept' | 'reject'): void => {
    const chosen = controls.filter((one) => one.include.checked).map((one) => ({
      ...one.change,
      propertyValue: one.value.value,
    }));
    if (decision === 'accept' && chosen.length === 0) return;
    accept.disabled = true;
    reject.disabled = true;
    void api.decideLibrarianProposal(
      proposal.id,
      decision,
      decision === 'reject' ? undefined : {
        changes: chosen,
        bases: controls.filter((one) => one.include.checked).map((one) => ({
          page: one.change.page!, propertyKey: one.change.propertyKey, propertyValue: one.base,
        })),
      },
    ).then(() => {
      card.remove();
      onReload?.();
    }).catch(() => {
      accept.disabled = false;
      reject.disabled = false;
    });
  };
  reject.addEventListener('click', () => decide('reject'));
  accept.addEventListener('click', () => decide('accept'));
  actions.append(reject, accept);
  card.append(title, reason, rows, actions);
  return card;
}

/** Dibuja una ficha de plantilla pequeña dentro del front matter de la página. */
export function renderTemplateInspector(
  page: Pick<PageView, 'id' | 'title' | 'properties' | 'crossingsOut' | 'crossingsIn'>,
  ontology: OntologyView,
  kindKey: string,
  write: WriteTemplateChange,
  propertyTable?: HTMLDListElement,
  actions: TemplateInspectorActions = {},
): HTMLElement {
  const inspected = inspectTemplate(page, ontology, kindKey);
  const section = document.createElement('section');
  section.className = 'template-inspector';

  const head = document.createElement('div');
  head.className = 'template-inspector-head';
  const title = document.createElement('strong');
  title.textContent = inspected.template === null
    ? inspected.kind === null ? 'Ficha de nota' : `Ficha de «${inspected.kind}»`
    : `Ficha de ${inspected.template.labels['es'] ?? inspected.template.name}`;
  const missing = inspected.properties.filter((one) => one.written.length === 0);
  const summary = document.createElement('span');
  summary.textContent = missing.length === 0
    ? 'ficha completa'
    : `${missing.length} ${missing.length === 1 ? 'propiedad pendiente' : 'propiedades pendientes'}`;
  head.append(title, summary);
  if (actions.canAskLibrarian === true) {
    const ask = document.createElement('button');
    ask.type = 'button';
    ask.className = 'template-ask-librarian';
    ask.textContent = 'Proponer campos';
    ask.addEventListener('click', () => {
      ask.disabled = true;
      void api.askLibrarian({
        pageId: page.id,
        text: 'Inspecciona la plantilla y los metadatos de esta página. Propón sólo campos justificables y déjalos como propuesta revisable; no escribas ninguno automáticamente.',
      }).then(() => {
        ask.textContent = 'Solicitud enviada';
      }).catch(() => {
        ask.disabled = false;
        ask.textContent = 'Proponer campos';
      });
    });
    head.append(ask);
  }
  section.append(head);

  if (inspected.template === null && inspected.kind !== null) {
    const warning = document.createElement('p');
    warning.className = 'template-inspector-note';
    warning.textContent = 'Este tipo todavía no tiene una plantilla declarada en Gobierno.';
    section.append(warning);
  }

  /*
   * Una sola ficha, no una lista que repite la tabla superior.
   *
   * Las propiedades presentes ya viven en el `dl` canónico del front matter.
   * Sólo las faltantes se agregan allí, con el mismo ritmo clave/valor/acción.
   * El inspector conserva debajo únicamente el nombre de la plantilla y sus
   * relaciones posibles. Así «esperada» describe un hueco, nunca una segunda
   * representación de algo que ya está escrito.
   */
  if (propertyTable !== undefined) {
    for (const property of missing) {
      const name = document.createElement('dt');
      name.className = 'property-key template-property-missing';
      name.textContent = property.definition.labels['es'] ?? property.definition.name;
      const value = document.createElement('dd');
      value.className = 'property-value template-property-missing';
      const derived = derivedPropertySuggestion(
        page,
        inspected.kind,
        property.definition,
        actions.dayKind,
      );
      const suggested = derived !== null && !dismissed(
        page.id,
        property.definition.block,
        derived.value,
      ) ? derived : null;
      const reason = document.createElement('span');
      reason.className = 'template-property-reason';
      reason.textContent = suggested?.reason ?? (property.expectedBy === 'global'
        ? 'esperada en toda página'
        : 'esperada por la plantilla');
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'property-edit property-edit-visible';
      add.textContent = suggested === null ? 'Añadir' : 'Aceptar';
      add.setAttribute('aria-label', `Añadir ${property.definition.name}`);
      let proposed = suggested?.value ?? '';
      if (suggested !== null) {
        const input = document.createElement('input');
        input.className = 'template-property-proposed-value';
        input.value = proposed;
        input.setAttribute('aria-label', `valor propuesto para ${property.definition.name}`);
        input.addEventListener('input', () => { proposed = input.value; });
        value.append(input);
      }
      add.addEventListener('click', () => {
        add.disabled = true;
        void write({
          kind: 'set_property',
          page: page.id,
          propertyKey: property.definition.name,
          propertyValue: proposed,
        }).then((applied) => { if (!applied) add.disabled = false; });
      });
      value.append(reason, add);
      if (suggested !== null) {
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'template-property-reject';
        reject.textContent = 'Rechazar';
        reject.addEventListener('click', () => {
          dismiss(page.id, property.definition.block, suggested.value);
          name.remove();
          value.remove();
        });
        value.append(reject);
      }
      propertyTable.append(name, value);
    }
  }

  if (actions.canAskLibrarian === true) {
    const proposals = document.createElement('div');
    proposals.className = 'field-proposals';
    section.append(proposals);
    void api.librarianRequests(page.id).then((requests) => {
      if (!proposals.isConnected) return;
      for (const request of requests) {
        const card = renderLibrarianProposal(request, page, actions.onReload);
        if (card !== null) proposals.append(card);
      }
      if (proposals.children.length === 0) proposals.remove();
    }).catch(() => proposals.remove());
  }

  const relationHead = document.createElement('h3');
  relationHead.textContent = 'Relaciones';
  const relationList = document.createElement('ul');
  relationList.className = 'template-relation-list';
  const existing = new Set(
    [...(page.crossingsOut ?? []), ...(page.crossingsIn ?? [])]
      .flatMap((one) => one.term === null ? [] : [normalized(one.term)]),
  );
  const relationTypes = document.createElement('datalist');
  relationTypes.id = `relation-types-${page.id.replace(/[^a-z0-9_-]/gi, '-')}`;
  const type = document.createElement('input');
  type.className = 'structural-relation-type';
  type.setAttribute('list', relationTypes.id);
  type.placeholder = 'relación no declarada';
  type.setAttribute('aria-label', 'tipo de relación');
  for (const relation of inspected.relations) {
    const item = document.createElement('li');
    const choose = document.createElement('button');
    choose.type = 'button';
    const label = relation.labels['es'] ?? relation.name;
    choose.textContent = relation.range.length === 0
      ? label
      : `${label} → ${relation.range.join(', ')}`;
    choose.addEventListener('click', () => {
      type.value = relation.name;
      type.focus();
    });
    if (existing.has(normalized(relation.name)) || existing.has(normalized(label))) {
      item.classList.add('present');
      item.title = 'esta página ya usa esta relación';
    }
    item.append(choose);
    relationList.append(item);
    relationTypes.append(new Option(label, relation.name));
  }

  const composer = document.createElement('form');
  composer.className = 'structural-relation-composer';
  const target = document.createElement('input');
  target.className = 'structural-relation-target';
  target.placeholder = 'página relacionada';
  target.required = true;
  target.setAttribute('aria-label', 'página relacionada');
  const targets = document.createElement('datalist');
  targets.id = `relation-targets-${page.id.replace(/[^a-z0-9_-]/gi, '-')}`;
  target.setAttribute('list', targets.id);
  let knownPages: Awaited<ReturnType<typeof api.pages>> = [];
  void api.pages().then((pages) => {
    knownPages = pages.filter((candidate) => candidate.id !== page.id);
    for (const candidate of knownPages) targets.append(new Option(candidate.title, candidate.title));
  }).catch(() => undefined);
  const addRelation = document.createElement('button');
  addRelation.type = 'submit';
  addRelation.textContent = 'Añadir relación';
  const feedback = document.createElement('span');
  feedback.className = 'structural-relation-feedback';
  composer.append(type, relationTypes, target, targets, addRelation, feedback);
  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const destination = knownPages.find((candidate) => normalized(candidate.title) === normalized(target.value));
    if (destination === undefined) {
      feedback.textContent = 'elige una página existente';
      target.focus();
      return;
    }
    addRelation.disabled = true;
    feedback.textContent = '';
    const term = type.value.trim();
    void write({
      kind: 'create_crossing',
      fromPage: page.id,
      toPage: destination.id,
      content: '',
      ...(term === '' ? {} : { term }),
    }).then((applied) => {
      if (!applied) {
        addRelation.disabled = false;
        feedback.textContent = 'no se pudo crear la relación';
      }
    });
  });
  section.append(relationHead);
  if (relationList.children.length > 0) section.append(relationList);
  section.append(composer);
  return section;
}
