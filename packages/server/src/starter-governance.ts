/**
 * El vocabulario universal con que una Vera nueva puede empezar a gobernarse.
 *
 * No es una copia del corpus de Herbert. Reúne las declaraciones generales que
 * el propio programa ya sabe leer y que son útiles antes de que exista un
 * corpus situado. Cada instalación puede editarlas y ampliarlas en sus páginas
 * rectoras; la distribución sólo proporciona un piso habitable.
 */

export interface StarterPropertyDefinition {
  readonly id: string;
  readonly name: string;
  readonly subject?: 'página' | 'bloque';
  readonly field?: 'texto' | 'número' | 'fecha' | 'enlace' | 'sí/no' | 'una de';
  readonly many?: boolean;
  readonly role?: string;
  readonly values?: readonly string[];
  readonly says: string;
}

export interface StarterObjectDefinition {
  readonly id: string;
  readonly name: string;
  readonly properties?: readonly string[];
  readonly role?: string;
  readonly says: string;
}

export interface StarterRelationDefinition {
  readonly id: string;
  readonly name: string;
  readonly inverse: string;
  readonly domain?: readonly string[];
  readonly range?: readonly string[];
  readonly symmetric?: boolean;
  readonly transitive?: boolean;
  readonly role?: string;
  readonly says?: string;
}

export const STARTER_PROPERTY_DEFINITIONS: readonly StarterPropertyDefinition[] = [
  { id: 'kind', name: 'tipo', field: 'una de', role: 'kind', says: 'qué clase de cosa es esta página' },
  { id: 'topic', name: 'concepto', field: 'enlace', many: true, role: 'topic', says: 'de qué trata' },
  { id: 'explains', name: 'explica', subject: 'bloque', field: 'enlace', role: 'explains', says: 'a qué página apunta una relación explicada' },
  { id: 'term', name: 'término', subject: 'bloque', field: 'una de', role: 'term', says: 'con qué palabra se lee esa relación' },
  { id: 'sense', name: 'sentido', subject: 'bloque', field: 'una de', role: 'sense', values: ['directo', 'mutua'], says: 'si vale en un sentido o en los dos' },
  { id: 'discard-request', name: 'por borrar', field: 'texto', role: 'discard_request', says: 'por qué una página se propone para descarte; marcar no borra' },
  { id: 'created', name: 'creación', field: 'fecha', role: 'created', says: 'cuándo nació la página; se deriva del registro' },
  { id: 'updated', name: 'actualización', field: 'fecha', role: 'updated', says: 'cuándo cambió por última vez; se deriva del registro' },
  { id: 'visible', name: 'público', field: 'sí/no', role: 'visible', says: 'si la página está publicada; se deriva de su estado de publicación' },
  { id: 'publication-barrier', name: 'publicación prohibida', field: 'sí/no', role: 'publication_barrier', says: 'impide publicar una página y aquello que pertenece a su ámbito' },
  { id: 'status', name: 'estado', field: 'una de', says: 'en qué punto está lo que la página nombra' },
  { id: 'language', name: 'idioma', field: 'una de', says: 'en qué lengua está escrita; usa un código BCP 47' },
  { id: 'date', name: 'fecha', field: 'fecha', says: 'la fecha de la cosa, cuando tiene una propia' },
  { id: 'url', name: 'url', says: 'dónde vive eso fuera de Vera' },
  { id: 'alias', name: 'alias', field: 'texto', many: true, says: 'otros nombres de la misma cosa' },
  { id: 'organization', name: 'org', field: 'enlace', many: true, says: 'a qué organización pertenece' },
  { id: 'position', name: 'cargo', field: 'texto', says: 'qué hace allí una persona' },
  { id: 'degree', name: 'grado', field: 'texto', says: 'qué estudió una persona' },
  { id: 'email', name: 'email', field: 'texto', says: 'dirección de correo' },
  { id: 'role', name: 'rol', field: 'texto', says: 'qué papel cumple en lo que se está contando' },
  { id: 'source', name: 'fuente', field: 'una de', says: 'de qué servicio o procedencia llegó la página' },
  { id: 'zotero', name: 'zotero', field: 'texto', says: 'clave estable del ítem en Zotero' },
  { id: 'zotero-version', name: 'zotero-versión', field: 'número', says: 'versión del ítem traído desde Zotero' },
  { id: 'zotero-library', name: 'zotero-biblioteca', field: 'texto', says: 'biblioteca de Zotero de la que vino' },
  { id: 'class', name: 'clase', field: 'una de', says: 'clase bibliográfica: libro, artículo, tesis u otra' },
  { id: 'author', name: 'autor', field: 'enlace', many: true, says: 'quién lo escribió' },
  { id: 'publication', name: 'publicación', field: 'texto', says: 'revista, libro o actas donde apareció' },
  { id: 'publisher', name: 'editorial', field: 'texto', says: 'quién lo publicó' },
  { id: 'doi', name: 'doi', field: 'texto', says: 'identificador de objeto digital' },
  { id: 'isbn', name: 'isbn', field: 'texto', says: 'identificador ISBN' },
  { id: 'presence', name: 'presencia', field: 'una de', values: ['en Zotero', 'huérfana'], says: 'si el ítem continúa presente en el servicio de origen' },
  { id: 'service', name: 'servicio', field: 'una de', says: 'con qué servicio externo habla una página de servicio' },
  { id: 'library', name: 'biblioteca', field: 'texto', says: 'con qué biblioteca o cuenta de ese servicio' },
  { id: 'collections', name: 'colecciones', field: 'texto', many: true, says: 'qué colecciones del servicio se sincronizan' },
  { id: 'theme', name: 'tema', field: 'enlace', says: 'hoja de estilo gobernada que aplica una presentación' },
  { id: 'epistemic-role', name: 'rol epistémico', field: 'una de', values: ['fuente', 'testimonio', 'análisis', 'síntesis', 'pregunta', 'afirmación'], says: 'función principal que cumple una página en el conocimiento' },
];

export const STARTER_OBJECT_DEFINITIONS: readonly StarterObjectDefinition[] = [
  { id: 'person', name: 'Persona', properties: ['org', 'cargo', 'grado', 'email', 'url', 'alias'], says: 'alguien' },
  { id: 'organization', name: 'Organización', properties: ['url', 'alias'], says: 'una institución, empresa o colectivo' },
  { id: 'place', name: 'Lugar', properties: ['url'], says: 'un sitio del mundo' },
  { id: 'idea', name: 'Idea', properties: ['concepto', 'estado'], says: 'algo que se está pensando' },
  { id: 'question', name: 'Pregunta', properties: ['concepto', 'estado'], says: 'algo que se quiere saber' },
  { id: 'claim', name: 'Afirmación', properties: ['concepto'], says: 'algo que se sostiene' },
  { id: 'note', name: 'Nota', properties: ['concepto'], says: 'lo que todavía no es ninguna otra cosa' },
  { id: 'project', name: 'Proyecto', properties: ['estado', 'fecha', 'concepto', 'url'], says: 'algo que se está haciendo' },
  { id: 'task', name: 'Tarea', properties: ['estado', 'fecha'], says: 'algo que hay que hacer' },
  { id: 'procedure', name: 'Trámite', properties: ['estado', 'fecha', 'org'], says: 'algo que hay que hacer con alguien más' },
  { id: 'reference', name: 'Referencia', properties: ['autor', 'fecha', 'publicación', 'editorial', 'doi', 'isbn', 'url', 'clase', 'fuente', 'zotero'], says: 'algo que alguien escribió y que aquí se cita' },
  { id: 'daily-log', name: 'Bitácora', properties: ['fecha'], role: 'day', says: 'un día; su título es su identidad' },
  { id: 'special-page', name: 'Página especial', says: 'una página que Vera lee para gobernarse' },
  { id: 'service', name: 'Servicio', properties: ['servicio', 'biblioteca', 'colecciones'], says: 'una conexión con algo de fuera' },
  { id: 'stylesheet', name: 'Hoja de estilo', properties: ['concepto', 'idioma'], says: 'una página cuyo CSS es fuente versionada y confinada de apariencia' },
  { id: 'work', name: 'Obra', properties: ['estado', 'concepto', 'url'], says: 'un horizonte duradero que reúne proyectos y otras piezas relacionadas' },
];

export const STARTER_RELATION_DEFINITIONS: readonly StarterRelationDefinition[] = [
  { id: 'deepens', name: 'profundiza', inverse: 'es profundizada por' },
  { id: 'contradicts', name: 'contradice', inverse: 'es contradicha por' },
  { id: 'supports', name: 'respalda', inverse: 'es respaldada por' },
  { id: 'exemplifies', name: 'ejemplifica', inverse: 'es ejemplificada por' },
  { id: 'generalizes', name: 'generaliza', inverse: 'es un caso de' },
  { id: 'precedes', name: 'precede a', inverse: 'sigue a' },
  { id: 'born-from', name: 'nace de', inverse: 'da lugar a' },
  { id: 'opposes', name: 'se opone a', inverse: 'se opone a', symmetric: true },
  { id: 'dialogues', name: 'dialoga con', inverse: 'dialoga con', symmetric: true },
  { id: 'same-as', name: 'es lo mismo que', inverse: 'es lo mismo que', symmetric: true },
  {
    id: 'membership', name: 'forma parte de', inverse: 'comprende', role: 'membership',
    domain: ['Persona', 'Organización', 'Lugar', 'Idea', 'Pregunta', 'Afirmación', 'Nota', 'Proyecto', 'Tarea', 'Trámite', 'Referencia', 'Bitácora', 'Obra'],
    range: ['Obra', 'Organización'],
    says: 'pertenencia estructural; puede transmitir políticas del ámbito',
  },
  {
    id: 'contributes', name: 'contribuye a', inverse: 'recibe contribución de',
    domain: ['Persona', 'Organización', 'Lugar', 'Idea', 'Pregunta', 'Afirmación', 'Nota', 'Proyecto', 'Tarea', 'Trámite', 'Referencia', 'Bitácora', 'Obra'],
    range: ['Proyecto', 'Obra'],
  },
  { id: 'custodied', name: 'es custodiado por', inverse: 'custodia', domain: ['Proyecto'], range: ['Obra', 'Organización'] },
];
