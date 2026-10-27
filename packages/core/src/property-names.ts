// Cómo llama este corpus a las propiedades que Vera necesita conocer.
//
// Hay un puñado de propiedades sobre las que el código tiene que decir algo: cuál
// dice qué clase de cosa es una página, cuál de qué trata, cuáles llevan una
// relación explicada. Hasta ahora esas palabras estaban escritas dentro del
// código —`type`, `concepto`, `explica`— y eso las convertía en decisiones de
// Vera sobre el idioma de quien escribe.
//
// No lo son. Una propiedad es del corpus: la escribió alguien, en su lengua, y
// puede llamarse `tipo`, `type` o `momo`. Lo que el código necesita no es la
// palabra sino el **papel**, y qué palabra cumple cada papel lo dice la página de
// ontología —@invariant DefaultsLiveInTheCode: lo de aquí rige mientras esa
// página no diga otra cosa, y deja de regir en cuanto lo diga.
//
// El papel se nombra en inglés porque es del programa. La palabra es del corpus
// y puede estar en cualquier idioma. La página de ontología es la bisagra:
//
//     - Nombres de propiedades
//       - kind · tipo
//       - topic · concepto
//       - explains · explica
//       - term · término
//       - sense · sentido
//       - day · bitácora
//       - discard_request · por borrar
//       - created · creación
//       - updated · actualización
//       - visible · público
//
// Una sola palabra no puede declararse así y se queda dentro del código:
// `special-kind`, la que dice cuál es la página de ontología. No cabe declararla
// en la página que sirve para encontrarla.

/** Los papeles que el código conoce. */
export type PropertyRole =
  | 'kind'
  | 'topic'
  | 'explains'
  | 'term'
  | 'sense'
  | 'day'
  /*
   * Con qué se pide que una página se vaya.
   *
   * No borra: marca. Una credencial cercada no puede dejar ausencias —ver
   * specs/confined-writing.allium—, así que lo que puede hacer con una página
   * suya que ya no sirve es decirlo, con su motivo, y esperar a que una persona
   * decida. El valor de la propiedad es ese motivo.
   */
  | 'discard_request'
  /*
   * Una barrera de publicación declarada por el corpus.
   *
   * No es la visibilidad de una página: es una política de un ámbito. Cuando
   * vale sí, la página y lo que pertenezca a ella por la relación de membresía
   * no pueden hacerse públicos. La palabra la gobierna VERA: Propiedades.
   */
  | 'publication_barrier'
  // Las tres derivadas: no se guardan en ninguna propiedad y aun así se leen y
  // se preguntan como si lo fueran. Ver DERIVED más abajo.
  | 'created'
  | 'updated'
  | 'visible';

export type PropertyNames = Readonly<Record<PropertyRole, string>>;

/**
 * Lo que Vera trae, que es un mínimo y no una verdad.
 *
 * En castellano porque es la lengua en que se escribe este corpus, y por la
 * misma razón por la que `concepto` y `término` ya lo estaban: lo que Vera
 * escribe en una página lo va a leer una persona.
 */
export const DEFAULT_PROPERTY_NAMES: PropertyNames = {
  kind: 'tipo',
  topic: 'concepto',
  explains: 'explica',
  term: 'término',
  sense: 'sentido',
  // Éste no es una clave sino un valor: la clase con que nace un día.
  day: 'bitácora',
  'discard_request': 'por borrar',
  publication_barrier: 'publicación prohibida',
  created: 'creación',
  updated: 'actualización',
  visible: 'público',
};

/*
 * Las tres que se leen y se preguntan como propiedades y no se guardan como
 * tales.
 *
 * Cuándo nació una página, cuándo se la tocó por última vez y si es pública son
 * cosas que Vera ya sabe: la primera es del propio registro de la página, la
 * segunda sale del log —cada operación trae su fecha— y la tercera tiene su
 * propia operación y su propia columna, con sus reglas.
 *
 * Guardarlas además como propiedad daría dos sitios diciendo lo mismo, y dos
 * sitios que dicen lo mismo acaban diciendo cosas distintas. Lo que sí hacen
 * falta es que se puedan preguntar, y para eso basta con que quien evalúa las
 * reconozca por su nombre antes de ir a buscarlas entre lo escrito.
 */
export const DERIVED: readonly PropertyRole[] = ['created', 'updated', 'visible'];

/** Qué papel derivado nombra una clave, si nombra alguno. */
export function derivedRole(key: string, names: PropertyNames): PropertyRole | null {
  const clean = key.trim().toLowerCase();
  return DERIVED.find((role) => names[role].toLowerCase() === clean) ?? null;
}

/** La única palabra que no se puede declarar: con ella se encuentra la ontología. */
export const SPECIAL_KIND = 'special-kind';

const ROLES: PropertyRole[] = [
  'kind',
  'topic',
  'explains',
  'term',
  'sense',
  'day',
  'discard_request',
  'publication_barrier',
  'created',
  'updated',
  'visible',
];

/**
 * Los papeles, leídos de la página de propiedades.
 *
 * Ahí cada propiedad dice qué papel cumple pegado a sí misma —`papel:: kind`
 * bajo el bloque `tipo`— y no en una lista aparte que hay que mantener en dos
 * sitios. Es donde alguien va a buscarlo: quien se pregunta qué es `tipo` mira
 * `tipo`.
 *
 * Lo de antes —una lista de renglones `papel · palabra`— se sigue leyendo, por
 * `readPropertyNames`: un corpus que ya lo escribió así no tiene por qué
 * enterarse de que Vera cambió de sitio.
 */
export function namesFromRoles(
  declared: readonly { name: string; role: string | null }[],
): PropertyNames {
  const names: Record<PropertyRole, string> = { ...DEFAULT_PROPERTY_NAMES };
  for (const one of declared) {
    if (one.role === null || one.name.trim() === '') continue;
    const held = ROLES.find((role) => role === one.role?.trim().toLowerCase());
    if (held !== undefined) names[held] = one.name.trim();
  }
  return names;
}

/**
 * Lee lo que una página declara, y deja lo demás como estaba.
 *
 * Entra una lista de renglones `papel · palabra` —tal como se escriben en la
 * ontología— y sale el juego completo: los papeles declarados con su palabra y
 * los demás con la que Vera trae. Un renglón que nombre un papel que no existe
 * se ignora en silencio: la página es de quien la escribe y puede tener dentro
 * cosas que Vera todavía no sepa leer.
 */
export function readPropertyNames(said: readonly string[]): PropertyNames {
  const names: Record<PropertyRole, string> = { ...DEFAULT_PROPERTY_NAMES };
  for (const line of said) {
    const [role, word] = line.split(/\s+[·/|]\s+/).map((one) => one.trim());
    if (role === undefined || word === undefined || word === '') continue;
    const held = ROLES.find((one) => one === role.toLowerCase());
    if (held !== undefined) names[held] = word;
  }
  return names;
}
