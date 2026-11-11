// Las páginas que declaran de qué está hecho el corpus, leídas como tablas.
//
// «Objetos» y «Propiedades» son listas de fichas con la misma forma cada una: una
// clase de cosa con las propiedades que la constituyen, una propiedad con la
// clase de campo que es. Dibujadas como bloques sueltos, esa forma no se ve —hay
// que abrir uno por uno para saber qué declara— y comparar dos, que es lo que uno
// va a hacer ahí, exige recordar el anterior mientras se lee el siguiente. Una
// tabla enseña la forma y las diferencias a la vez, que es para lo que sirve.
//
// La tabla no es una copia de los bloques: es cómo se dibujan. Cada celda escribe
// en el bloque del que salió —`edit_block` para el nombre, `set_property` para lo
// demás— y por eso los bloques que declaran dejan de dibujarse aparte. Dos sitios
// diciendo lo mismo acaban diciendo cosas distintas, y aquí además serían dos
// sitios donde corregirlo.
//
// La prosa de la página no se toca: los bloques que explican de qué va la página
// y cómo se declara en ella siguen siendo bloques, se leen y se editan como
// siempre. Declara el que lleva propiedades colgando; el resto es texto.
//
// @invariant AnAgentProposesToASpecialPage, de special-pages.allium: esto es una
// superficie para una persona. Lo que un agente quiera cambiar aquí llega como
// propuesta, y eso lo decide el servidor, no esta tabla.

import { DEFAULT_PROPERTY_NAMES } from '@vera/core';
import { api, type Change, type OntologyView } from './api.ts';
import type { Choice } from './fields.ts';
import {
  cellIn,
  chipsCell,
  editableCell,
  rowIn,
  section,
  type EditableCellController,
  type TableBody,
} from './table.ts';

/**
 * Las clases de página que gobiernan, con cómo se leen.
 *
 * La clave es del programa y no del corpus. Es el mismo trato que llevan los
 * papeles —`kind`, `topic`, `day`—: el papel se nombra en inglés porque es del
 * programa, y la palabra del corpus es otra cosa. Aquí la palabra del corpus es
 * el título de la página, que se puede cambiar sin que nada se rompa, porque
 * `governing()` busca por la propiedad y nunca por el título.
 *
 * Y por eso mismo esto no se declara en ninguna página: no es configuración, es
 * la junta entre el corpus y el código. Lo que decide el código vive en el
 * código —@invariant DefaultsLiveInTheCode—; lo que hace falta explicar se
 * explica en el manual, no en un desplegable.
 *
 * Una clase que este cliente no conozca no desaparece: se dibuja con su clave a
 * la vista. Una lista privada de lo que se sabe enseñar sería la lista privada
 * que @invariant SpecialityIsDeclaredNotGuessed prohíbe.
 */
export type SpecialPageMode = 'rectora' | 'superficie' | 'derivada' | 'documentación';

export const GOVERNING_KINDS: {
  key: string;
  label: string;
  mode: SpecialPageMode;
  what: string;
}[] = [
  { key: 'properties', label: 'Propiedades', mode: 'rectora', what: 'cada propiedad y qué clase de campo es' },
  { key: 'objects', label: 'Objetos', mode: 'rectora', what: 'cada clase de cosa y qué propiedades la constituyen' },
  { key: 'relations', label: 'Relaciones', mode: 'rectora', what: 'cada tipo de arista y cómo se lee desde ambos extremos' },
  { key: 'embeddings', label: 'Incrustaciones', mode: 'rectora', what: 'qué servidores pueden ejecutar contenido dentro de una página' },
  { key: 'service', label: 'Servicio', mode: 'rectora', what: 'con qué servicio de fuera habla el corpus' },
  { key: 'connections', label: 'Conexiones', mode: 'rectora', what: 'quién entra, por qué canal, con qué identidad y alcance' },
  { key: 'publication', label: 'Publicación', mode: 'superficie', what: 'administra el sitio guardado en el registro' },
  { key: 'activity', label: 'Actividad', mode: 'derivada', what: 'proyecta operaciones y eliminaciones registradas' },
  { key: 'governance', label: 'Gobierno', mode: 'derivada', what: 'reúne todas las páginas especiales declaradas en el corpus' },
  { key: 'presentation', label: 'Presentación', mode: 'documentación', what: 'describe el diseño; los ajustes efectivos viven por participante' },
  { key: 'instructions', label: 'Instrucciones', mode: 'documentación', what: 'referencia histórica; todavía no alimenta a los agentes' },
];

/** Cómo se lee una clase de gobierno, cuando este cliente la conoce. */
export function kindSays(value: string): { label: string; mode: SpecialPageMode; what: string } | null {
  return GOVERNING_KINDS.find((one) => one.key === value.trim().toLowerCase()) ?? null;
}

/** Las tres caras del mismo gobierno ontológico. */
export type GoverningKind = 'objects' | 'properties' | 'relations';

/**
 * Qué gobierna esta página, de las que esta tabla sabe dibujar.
 *
 * Se lee de la propiedad y no de una lista de títulos. @invariant
 * SpecialityIsDeclaredNotGuessed.
 */
export function governingKind(
  properties: readonly { key: string; value: string }[],
): GoverningKind | null {
  const said = properties
    .find((one) => one.key === 'special-kind')
    ?.value.trim()
    .toLowerCase();
  return said === 'objects' || said === 'properties' || said === 'relations' ? said : null;
}

/** Escribe un cambio y devuelve si se aplicó. Lo pone el outliner, que ya sabe. */
export type Write = (change: Change) => Promise<boolean>;

/** Abre la página rectora real de una faceta; nunca una copia del visor. */
export type OpenFacet = (page: string) => void;

/**
 * Los papeles que el código conoce.
 *
 * Salen de `DEFAULT_PROPERTY_NAMES`, que es donde el dominio los enumera: una
 * lista escrita aquí se quedaría atrás el día que aparezca uno nuevo, y nadie se
 * enteraría hasta que alguien buscara en el menú algo que sí existe.
 */
const ROLES = Object.keys(DEFAULT_PROPERTY_NAMES);

/**
 * Cómo se lee una clase de campo con lo que la matiza.
 *
 * Vacío cuando no se declaró nada de las tres cosas, para que la celda ponga su
 * propio texto de hueco: «sin decir» escrito aquí sería un valor más y se leería
 * como si alguien lo hubiera puesto.
 */
function fieldSays(field: string | null, many: boolean, values: readonly string[]): string {
  const parts: string[] = [];
  if (field !== null) parts.push(field);
  if (many) parts.push('varios');
  if (parts.length === 0 && values.length === 0) return '';
  const said = parts.join(' · ');
  return values.length === 0 ? said : `${said}: ${values.join(', ')}`;
}

/** Los rótulos lingüísticos, en una forma breve que también se puede corregir. */
function labelsSays(labels: Readonly<Record<string, string>>): string {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([language, label]) => `${language}: ${label}`)
    .join(' · ');
}

/**
 * Dibuja la tabla de una página que gobierna.
 *
 * Devuelve además qué bloques quedaron dentro, para que quien dibuja la página no
 * los repita debajo. Null cuando no se pudo leer la ontología: entonces la página
 * se dibuja como cualquier otra, con sus bloques, que es lo que era antes de que
 * esto existiera y sigue siendo verdad.
 */
export async function renderGoverning(
  kind: GoverningKind,
  write: Write,
  openFacet?: OpenFacet,
): Promise<{ element: HTMLElement; declaring: Set<string> } | null> {
  let said: OntologyView;
  try {
    said = await api.ontology();
  } catch {
    return null;
  }

  const declaring = new Set<string>();
  const nameEditors = new Map<string, EditableCellController>();
  const element = document.createElement('div');
  element.className = 'governing-tables';

  /*
   * Un gobierno, tres páginas canónicas.
   *
   * La banda no inventa una cuarta portada ni cambia la fuente de verdad. Cada
   * faceta abre la página especial que ya declara esos bloques; por eso atrás,
   * enlaces, historial y permisos continúan hablando de las páginas reales.
   */
  const facets = document.createElement('nav');
  facets.className = 'governing-facets';
  facets.setAttribute('aria-label', 'facetas del gobierno ontológico');
  const facetKinds: { kind: GoverningKind; label: string }[] = [
    { kind: 'objects', label: 'Objetos' },
    { kind: 'properties', label: 'Propiedades' },
    { kind: 'relations', label: 'Relaciones' },
  ];
  const knownPages = openFacet === undefined
    ? []
    : await api.specialPages().catch(() => [] as { id: string; title: string; kind: string }[]);
  for (const facet of facetKinds) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = facet.kind === kind
      ? `governing-facet facet-${facet.kind} selected`
      : `governing-facet facet-${facet.kind}`;
    button.textContent = facet.label;
    button.setAttribute('aria-current', facet.kind === kind ? 'page' : 'false');
    const destination = knownPages.find((page) => page.kind === facet.kind);
    button.disabled = destination === undefined && facet.kind !== kind;
    if (destination !== undefined && facet.kind !== kind) {
      button.addEventListener('click', () => openFacet?.(destination.id));
    }
    facets.append(button);
  }
  element.append(facets);

  const mobileMirror = document.createElement('nav');
  mobileMirror.className = 'ontology-mobile-switch ontology-mobile-switch-text';
  mobileMirror.setAttribute('aria-label', 'inscripción del gobierno ontológico');
  const declaration = document.createElement('button');
  declaration.type = 'button';
  declaration.className = 'selected';
  declaration.textContent = 'Declaración';
  declaration.setAttribute('aria-pressed', 'true');
  const scheme = document.createElement('button');
  scheme.type = 'button';
  scheme.textContent = 'Esquema';
  scheme.setAttribute('aria-pressed', 'false');
  scheme.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('vera:ontology-layout', {
      detail: { layout: 'graph_only' },
    }));
  });
  mobileMirror.append(declaration, scheme);
  element.append(mobileMirror);

  const sectionIn = (
    title: string | null,
    note: string | null,
    headers: readonly string[],
  ): TableBody =>
    // `governing-properties` marca las que se visten como declaraciones: la mono
    // atenuada en las columnas de estructura. Ver `section` y la hoja de estilos.
    section(element, { title, note, headers, className: 'governing-properties' });

  /** Las propiedades declaradas, ofrecidas para constituir un objeto. */
  const declaredChoices: Choice[] = said.properties.map((one) => ({
    value: one.name,
    hint: one.field ?? 'sin decir',
  }));

  const rowFor = (table: TableBody, block: string): HTMLTableRowElement => {
    declaring.add(block);
    return rowIn(table, block);
  };

  /** Escribir una propiedad del bloque que declara, o quitarla si queda vacía. */
  const put = (block: string, key: string) => async (next: string): Promise<boolean> =>
    write(
      next.trim() === ''
        ? { kind: 'remove_property', block, propertyKey: key }
        : { kind: 'set_property', block, propertyKey: key, propertyValue: next.trim() },
    );

  /**
   * Renombrar una propiedad es una migración, no una edición de texto aislada.
   * La identidad es el bloque; antes de enviar el lote se enseña cuántas
   * asignaciones y plantillas cambiarían y se detiene ante cualquier colisión.
   */
  const renameProperty = (block: string) => async (next: string): Promise<boolean> => {
    let impact: Awaited<ReturnType<typeof api.propertyRenameImpact>>;
    try {
      impact = await api.propertyRenameImpact(block, next.trim(), 'es');
    } catch {
      window.alert('No se pudo calcular el impacto del renombrado. No se cambió nada.');
      return false;
    }
    if (impact.conflicts.length > 0) {
      window.alert(
        `No se puede renombrar «${impact.from}» como «${impact.to}»: ` +
        `${impact.conflicts.length} ${impact.conflicts.length === 1 ? 'página o bloque ya usa' : 'páginas o bloques ya usan'} ambas claves.`,
      );
      return false;
    }
    const assignments = impact.assignments.pages + impact.assignments.blocks;
    const accepted = window.confirm(
      `Renombrar «${impact.from}» como «${impact.to}» cambiará ` +
      `${assignments} ${assignments === 1 ? 'asignación' : 'asignaciones'} y ` +
      `${impact.templates} ${impact.templates === 1 ? 'plantilla' : 'plantillas'}. ` +
      'La prosa y la historia anterior permanecerán intactas. ¿Aplicar el lote?',
    );
    if (!accepted) return false;
    const applied = await api.submitCanonicalBatch(
      impact.changes.map((change) => ({ change })),
      undefined,
      impact.ifRevisions,
    );
    if (applied.status === 'rejected') {
      window.alert(`No se aplicó el renombrado: ${applied.reason}`);
      return false;
    }
    return true;
  };

  /**
   * Corrige los nombres visibles sin tocar la identidad estable del bloque.
   *
   * La celda acepta `es: Persona · en: Person`. Conservamos la clave exacta que
   * ya estaba escrita (`rótulo es`, `label en`, etc.) al quitar un idioma; al
   * crear uno nuevo usamos la forma canónica española del metamodelo.
   */
  const editLabels = (
    block: string,
    current: Readonly<Record<string, string>>,
    currentKeys: Readonly<Record<string, string>>,
  ) => async (next: string): Promise<boolean> => {
    const parsed: Record<string, string> = {};
    for (const part of next.split(/[·;]/u).map((one) => one.trim()).filter(Boolean)) {
      const match = /^([a-z]{2,3}(?:-[A-Za-z0-9]+)*)\s*:\s*(.+)$/u.exec(part);
      if (match === null) {
        window.alert('Escribe cada rótulo como «es: nombre · en: name». No se cambió nada.');
        return false;
      }
      const language = match[1]!.toLowerCase();
      if (parsed[language] !== undefined) {
        window.alert(`El idioma «${language}» aparece más de una vez. No se cambió nada.`);
        return false;
      }
      parsed[language] = match[2]!.trim();
    }

    const changes: Change[] = [];
    for (const language of Object.keys(current)) {
      if (parsed[language] === undefined) {
        changes.push({
          kind: 'remove_property',
          block,
          propertyKey: currentKeys[language] ?? `rótulo ${language}`,
        });
      }
    }
    for (const [language, label] of Object.entries(parsed)) {
      if (current[language] !== label) {
        changes.push({
          kind: 'set_property',
          block,
          propertyKey: currentKeys[language] ?? `rótulo ${language}`,
          propertyValue: label,
        });
      }
    }
    if (changes.length === 0) return true;
    const applied = await api.submitCanonicalBatch(changes.map((change) => ({ change })));
    if (applied.status === 'rejected') {
      window.alert(`No se cambiaron los rótulos: ${applied.reason}`);
      return false;
    }
    return true;
  };

  if (kind === 'objects') {
    /*
     * La columna del papel sólo si alguna clase cumple uno.
     *
     * Una clase puede cumplirlo —`day` nombra la clase con que nace un día— y
     * eso gobierna a VERA: tiene que verse donde está escrito, o es gobierno
     * invisible. Pero en un corpus donde ninguna lo cumpla, la columna estaría
     * vacía en todas las filas, y una columna vacía se lee como si faltara algo.
     */
    const withRole = said.objects.some((one) => one.role !== null);
    const roles: Choice[] = ROLES.map((one) => ({ value: one, hint: 'papel del código' }));
    const headers = withRole
      ? ['Objeto', 'Rótulos', 'Propiedades', 'Papel', 'Descripción']
      : ['Objeto', 'Rótulos', 'Propiedades', 'Descripción'];
    const body = sectionIn(null, null, headers);

    for (const object of said.objects) {
      const row = rowFor(body, object.block);
      let at = 0;

      nameEditors.set(object.block, editableCell(
        cellIn(row, at++),
        { shows: object.name, label: 'el nombre de la clase', placeholder: 'sin nombre' },
        (next) => write({ kind: 'edit_block', block: object.block, content: next.trim() }),
      ));

      editableCell(
        cellIn(row, at++),
        {
          shows: labelsSays(object.labels),
          label: 'los rótulos por idioma',
          placeholder: 'sin rótulos',
        },
        editLabels(object.block, object.labels, object.labelKeys),
      );

      chipsCell(
        cellIn(row, at++),
        object.properties,
        { offered: declaredChoices, label: 'nombre de la propiedad', add: '+ propiedad' },
        (next) => put(object.block, 'propiedades')(next.join(', ')),
      );

      if (withRole) {
        editableCell(
          cellIn(row, at++),
          { shows: object.role ?? '', label: 'qué papel del código cumple', placeholder: '—' },
          put(object.block, 'papel'),
          roles,
        );
      }

      editableCell(
        cellIn(row, at++),
        {
          shows: object.says ?? '',
          label: 'qué es esta clase de cosa',
          placeholder: 'sin descripción',
        },
        put(object.block, 'qué'),
      );
    }
  } else if (kind === 'properties') {
    const fields: Choice[] = said.fields.map((one) => ({ value: one }));
    const roles: Choice[] = ROLES.map((one) => ({ value: one, hint: 'papel del código' }));
    const subjects: Choice[] = [
      { value: 'página', hint: 'la página entera' },
      { value: 'bloque', hint: 'un bloque suelto' },
    ];

    /*
     * Dos tablas, y el corte es por quién necesita la propiedad.
     *
     * Arriba las que el código lee por su papel: quitar una no borra nada de lo
     * escrito, pero Vera deja de saber leerlo —sin `tipo` no hay clases, sin
     * `explica` no hay relaciones explicadas—. Abajo el vocabulario del corpus,
     * que Vera guarda y enseña sin entender, y que es de quien escribe.
     *
     * El otro corte posible —de qué cuelga— no se perdió: es una columna. Es más
     * fino de lo que parece, porque `tipo` es tan interna como `término` y una
     * cuelga de la página mientras la otra cuelga de un bloque, así que ninguna
     * de las dos cosas se deduce de la otra y las dos hacen falta.
     */
    const written = (property: (typeof said.properties)[number], body: TableBody, withRole: boolean): void => {
      const row = rowFor(body, property.block);
      let at = 0;

      nameEditors.set(property.block, editableCell(
        cellIn(row, at++),
        { shows: property.name, label: 'el nombre de la propiedad', placeholder: 'sin nombre' },
        renameProperty(property.block),
      ));

      editableCell(
        cellIn(row, at++),
        {
          shows: labelsSays(property.labels),
          label: 'los rótulos por idioma',
          placeholder: 'sin rótulos',
        },
        editLabels(property.block, property.labels, property.labelKeys),
      );

      editableCell(
        cellIn(row, at++),
        { shows: property.subject, label: 'de qué cuelga', placeholder: 'página' },
        put(property.block, 'sujeto'),
        subjects,
      );

      /*
       * El tipo de dato con lo que lo matiza dentro.
       *
       * `varios` y `valores` hablan del tipo y no son columnas suyas: si admite
       * varias respuestas y cuáles son las conocidas es cómo se responde a esa
       * clase de campo. Se lee entero y se corrige la clase, que es lo que se
       * cambia; los otros dos siguen editándose en el bloque, que sigue estando.
       */
      editableCell(
        cellIn(row, at++),
        {
          shows: fieldSays(property.field, property.many, property.values),
          edits: property.field ?? '',
          label: 'de qué clase es el campo',
          placeholder: 'sin decir',
          reflects: (next) => fieldSays(next === '' ? null : next, property.many, property.values),
        },
        put(property.block, 'campo'),
        fields,
      );

      // La columna del papel sólo donde hay papeles. En la tabla de abajo
      // estaría vacía en las veinticinco filas, y una columna vacía se lee como
      // si faltara algo.
      if (withRole) {
        editableCell(
          cellIn(row, at++),
          { shows: property.role ?? '', label: 'qué papel del código cumple', placeholder: '—' },
          put(property.block, 'papel'),
          roles,
        );
      }

      editableCell(
        cellIn(row, at++),
        { shows: property.says ?? '', label: 'para qué se usa', placeholder: 'sin descripción' },
        put(property.block, 'qué'),
      );
    };

    const machinery = said.properties.filter((one) => one.role !== null);
    const vocabulary = said.properties.filter((one) => one.role === null);

    if (machinery.length > 0) {
      const body = sectionIn(
        'Lo que Vera necesita',
        'Cada una cumple un papel que el código lee por su nombre. Cambiarles el nombre está bien —el papel viaja con ellas—; quitarlas deja a Vera sin saber leer lo que ya está escrito.',
        ['Nombre', 'Rótulos', 'Cuelga de', 'Tipo de dato', 'Papel', 'Descripción'],
      );
      for (const property of machinery) written(property, body, true);
    }

    if (vocabulary.length > 0) {
      const body = sectionIn(
        'El vocabulario de este corpus',
        'Las que pusiste tú. Vera las guarda, las enseña y deja consultarlas, y no las entiende: lo que significan lo dice esta página.',
        ['Nombre', 'Rótulos', 'Cuelga de', 'Tipo de dato', 'Descripción'],
      );
      for (const property of vocabulary) written(property, body, false);
    }
  } else {
    const objectChoices: Choice[] = said.objects.map((one) => ({
      value: one.name,
      hint: one.says ?? 'objeto declarado',
    }));
    const relationChoices: Choice[] = said.relations.map((one) => ({
      value: one.name,
      hint: one.says ?? 'relación declarada',
    }));
    const states: Choice[] = [
      { value: 'borrador' },
      { value: 'aprobada' },
      { value: 'obsoleta' },
    ];
    const body = sectionIn(
      null,
      'Cada fila declara una arista del corpus: cómo se llama desde ambos extremos, qué puede unir y qué comportamiento tiene.',
      [
        'Relación', 'Rótulos', 'Inversa', 'Dominio', 'Rango', 'Función', 'Alcance',
        'Hereda por', 'Verifica con', 'Simétrica', 'Transitiva', 'Estado', 'Descripción',
      ],
    );

    for (const relation of said.relations) {
      const row = rowFor(body, relation.block);
      let at = 0;
      nameEditors.set(relation.block, editableCell(
        cellIn(row, at++),
        { shows: relation.name, label: 'el nombre de la relación', placeholder: 'sin nombre' },
        (next) => write({ kind: 'edit_block', block: relation.block, content: next.trim() }),
      ));
      editableCell(
        cellIn(row, at++),
        {
          shows: labelsSays(relation.labels),
          label: 'los rótulos por idioma',
          placeholder: 'sin rótulos',
        },
        editLabels(relation.block, relation.labels, relation.labelKeys),
      );
      editableCell(
        cellIn(row, at++),
        { shows: relation.inverse, label: 'cómo se lee en sentido inverso', placeholder: 'sin inversa' },
        put(relation.block, 'inversa'),
        relationChoices,
      );
      chipsCell(
        cellIn(row, at++),
        relation.domain,
        { offered: objectChoices, label: 'objeto de origen', add: '+ objeto' },
        (next) => put(relation.block, 'dominio')(next.join(', ')),
      );
      chipsCell(
        cellIn(row, at++),
        relation.range,
        { offered: objectChoices, label: 'objeto de destino', add: '+ objeto' },
        (next) => put(relation.block, 'rango')(next.join(', ')),
      );
      editableCell(
        cellIn(row, at++),
        { shows: relation.function, label: 'qué función cumple', placeholder: 'descriptiva' },
        put(relation.block, 'función'),
        [{ value: 'descriptiva' }, { value: 'normativa' }, { value: 'probatoria' }],
      );
      editableCell(
        cellIn(row, at++),
        { shows: relation.scope, label: 'qué alcance tiene', placeholder: 'directo' },
        put(relation.block, 'alcance'),
        [{ value: 'directo' }, { value: 'heredado' }],
      );
      editableCell(
        cellIn(row, at++),
        {
          shows: relation.inheritedThrough ?? '',
          label: 'por qué relación hereda su alcance',
          placeholder: '—',
        },
        put(relation.block, 'hereda por'),
        relationChoices,
      );
      editableCell(
        cellIn(row, at++),
        {
          shows: relation.verifiedBy ?? '',
          label: 'qué relación aporta evidencia',
          placeholder: '—',
        },
        put(relation.block, 'verifica con'),
        relationChoices,
      );
      editableCell(
        cellIn(row, at++),
        { shows: relation.symmetric === true ? 'sí' : relation.symmetric === false ? 'no' : '', label: 'si es simétrica', placeholder: '—' },
        put(relation.block, 'simétrica'),
        [{ value: 'sí' }, { value: 'no' }],
      );
      editableCell(
        cellIn(row, at++),
        { shows: relation.transitive === true ? 'sí' : relation.transitive === false ? 'no' : '', label: 'si es transitiva', placeholder: '—' },
        put(relation.block, 'transitiva'),
        [{ value: 'sí' }, { value: 'no' }],
      );
      editableCell(
        cellIn(row, at++),
        { shows: relation.status ?? '', label: 'estado de la relación', placeholder: 'sin estado' },
        put(relation.block, 'estado'),
        states,
      );
      editableCell(
        cellIn(row, at++),
        { shows: relation.says ?? '', label: 'qué afirma esta relación', placeholder: 'sin descripción' },
        put(relation.block, 'qué'),
      );
    }
  }

  if (declaring.size === 0) return null;
  const mirrorFocus = (event: Event): void => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('tr[data-block]');
    const block = row?.dataset['block'];
    if (block === undefined) return;
    document.dispatchEvent(new CustomEvent('vera:ontology-focus', { detail: { block } }));
  };
  element.addEventListener('click', mirrorFocus);
  element.addEventListener('focusin', mirrorFocus);
  element.addEventListener('vera:ontology-local-change', (event) => {
    const change = (event as CustomEvent<{ change?: Change }>).detail?.change;
    if (change?.kind !== 'edit_block') return;
    nameEditors.get(change.block)?.reflect(change.content.trim());
  });
  return { element, declaring };
}
