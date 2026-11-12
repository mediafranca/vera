import type { Change, ObjectDeclared, OntologyView, PageView, PropertyDeclared } from './api.ts';

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

/** Dibuja una ficha de plantilla pequeña dentro del front matter de la página. */
export function renderTemplateInspector(
  page: Pick<PageView, 'id' | 'properties' | 'crossingsOut' | 'crossingsIn'>,
  ontology: OntologyView,
  kindKey: string,
  write: WriteTemplateChange,
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
  const answered = inspected.properties.filter((one) => one.written.length > 0).length;
  const summary = document.createElement('span');
  summary.textContent = `${answered} de ${inspected.properties.length} propiedades presentes`;
  head.append(title, summary);
  section.append(head);

  if (inspected.template === null && inspected.kind !== null) {
    const warning = document.createElement('p');
    warning.className = 'template-inspector-note';
    warning.textContent = 'Este tipo todavía no tiene una plantilla declarada en Gobierno.';
    section.append(warning);
  }

  const properties = document.createElement('ul');
  properties.className = 'template-property-list';
  for (const property of inspected.properties) {
    const item = document.createElement('li');
    item.className = property.written.length === 0 ? 'missing' : 'present';
    const name = document.createElement('span');
    name.className = 'template-property-name';
    name.textContent = property.definition.labels['es'] ?? property.definition.name;
    const value = document.createElement('span');
    value.className = 'template-property-value';
    value.textContent = property.written.length === 0
      ? property.expectedBy === 'global' ? 'esperada en toda página' : 'esperada por la plantilla'
      : property.written.map((one) => one.value === '' ? 'sin respuesta' : one.value).join(' · ');
    item.append(name, value);
    if (property.written.length === 0) {
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = 'Añadir';
      add.setAttribute('aria-label', `Añadir ${property.definition.name}`);
      add.addEventListener('click', () => {
        add.disabled = true;
        void write({
          kind: 'set_property',
          page: page.id,
          propertyKey: property.definition.name,
          propertyValue: '',
        }).then((applied) => { if (!applied) add.disabled = false; });
      });
      item.append(add);
    }
    properties.append(item);
  }
  section.append(properties);

  if (inspected.relations.length > 0) {
    const relationHead = document.createElement('h3');
    relationHead.textContent = 'Relaciones posibles';
    const relationList = document.createElement('ul');
    relationList.className = 'template-relation-list';
    const existing = new Set(
      [...(page.crossingsOut ?? []), ...(page.crossingsIn ?? [])]
        .flatMap((one) => one.term === null ? [] : [normalized(one.term)]),
    );
    for (const relation of inspected.relations) {
      const item = document.createElement('li');
      const label = relation.labels['es'] ?? relation.name;
      item.textContent = relation.range.length === 0
        ? label
        : `${label} → ${relation.range.join(', ')}`;
      if (existing.has(normalized(relation.name)) || existing.has(normalized(label))) {
        item.classList.add('present');
        item.title = 'esta página ya usa esta relación';
      }
      relationList.append(item);
    }
    section.append(relationHead, relationList);
  }
  return section;
}
