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
import { cellIn, chipsCell, editableCell, rowIn, section, type TableBody } from './table.ts';

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
  { key: 'ontology', label: 'Ontología anterior', mode: 'documentación', what: 'compatibilidad temporal durante la migración' },
  { key: 'properties', label: 'Propiedades', mode: 'rectora', what: 'cada propiedad y qué clase de campo es' },
  { key: 'objects', label: 'Objetos', mode: 'rectora', what: 'cada clase de cosa y qué propiedades la constituyen' },
  { key: 'relations', label: 'Relaciones', mode: 'rectora', what: 'cada tipo de arista y cómo se lee desde ambos extremos' },
  { key: 'embeddings', label: 'Incrustaciones', mode: 'rectora', what: 'qué servidores pueden ejecutar contenido dentro de una página' },
  { key: 'service', label: 'Servicio', mode: 'rectora', what: 'con qué servicio de fuera habla el corpus' },
  { key: 'mcp', label: 'Puerta MCP', mode: 'rectora', what: 'quién entra, con qué identidad y permiso declarado' },
  { key: 'publication', label: 'Publicación', mode: 'superficie', what: 'administra el sitio guardado en el registro' },
  { key: 'activity', label: 'Actividad', mode: 'derivada', what: 'proyecta operaciones y eliminaciones registradas' },
  { key: 'presentation', label: 'Presentación', mode: 'documentación', what: 'describe el diseño; los ajustes efectivos viven por participante' },
  { key: 'instructions', label: 'Instrucciones', mode: 'documentación', what: 'referencia histórica; todavía no alimenta a los agentes' },
];

/** Cómo se lee una clase de gobierno, cuando este cliente la conoce. */
export function kindSays(value: string): { label: string; mode: SpecialPageMode; what: string } | null {
  return GOVERNING_KINDS.find((one) => one.key === value.trim().toLowerCase()) ?? null;
}

/** Las dos clases de página que se leen así. */
export type GoverningKind = 'objects' | 'properties';

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
  return said === 'objects' || said === 'properties' ? said : null;
}

/** Escribe un cambio y devuelve si se aplicó. Lo pone el outliner, que ya sabe. */
export type Write = (change: Change) => Promise<boolean>;

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
): Promise<{ element: HTMLElement; declaring: Set<string> } | null> {
  let said: OntologyView;
  try {
    said = await api.ontology();
  } catch {
    return null;
  }

  const declaring = new Set<string>();
  const element = document.createElement('div');
  element.className = 'governing-tables';

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
      ? ['Objeto', 'Propiedades', 'Papel', 'Descripción']
      : ['Objeto', 'Propiedades', 'Descripción'];
    const body = sectionIn(null, null, headers);

    for (const object of said.objects) {
      const row = rowFor(body, object.block);
      let at = 0;

      editableCell(
        cellIn(row, at++),
        { shows: object.name, label: 'el nombre de la clase', placeholder: 'sin nombre' },
        (next) => write({ kind: 'edit_block', block: object.block, content: next.trim() }),
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
  } else {
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

      editableCell(
        cellIn(row, at++),
        { shows: property.name, label: 'el nombre de la propiedad', placeholder: 'sin nombre' },
        (next) => write({ kind: 'edit_block', block: property.block, content: next.trim() }),
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
        ['Nombre', 'Cuelga de', 'Tipo de dato', 'Papel', 'Descripción'],
      );
      for (const property of machinery) written(property, body, true);
    }

    if (vocabulary.length > 0) {
      const body = sectionIn(
        'El vocabulario de este corpus',
        'Las que pusiste tú. Vera las guarda, las enseña y deja consultarlas, y no las entiende: lo que significan lo dice esta página.',
        ['Nombre', 'Cuelga de', 'Tipo de dato', 'Descripción'],
      );
      for (const property of vocabulary) written(property, body, false);
    }
  }

  if (declaring.size === 0) return null;
  return { element, declaring };
}
