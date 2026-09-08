// La máquina de estados del autocompletado.
//
// Lógica pura: entra el texto y el cursor, sale qué está abierto y qué se está
// buscando. Quién resuelve la búsqueda y cómo se dibuja la lista es cosa del
// outliner.
//
// @invariant SearchRegionFollowsTheCaret: lo que hay abierto es dueño del texto
// entre su disparador y el cursor. Salir de esa región lo cierra.

export type Trigger = 'pagina' | 'etiqueta' | 'bloque' | 'comando';

export interface Open {
  trigger: Trigger;
  /** Dónde empieza la consulta dentro del buffer, después del disparador. */
  queryStart: number;
}

/**
 * Qué disparador acaba de quedar a la izquierda del cursor.
 *
 * Se mira el texto y no la tecla, porque pegar `[[` tiene que abrir lo mismo que
 * escribirlo, y porque el autopar ya metió el cierre cuando llega el segundo
 * corchete.
 */
export function detectTrigger(buffer: string, cursor: number): Open | null {
  const before = buffer.slice(0, cursor);

  // `#[[` es una etiqueta con espacios; se comprueba antes que `[[` a secas.
  if (before.endsWith('#[[')) return { trigger: 'etiqueta', queryStart: cursor };
  if (before.endsWith('[[')) return { trigger: 'pagina', queryStart: cursor };
  if (before.endsWith('((')) return { trigger: 'bloque', queryStart: cursor };

  // Una almohadilla sólo abre etiqueta al principio o tras un espacio: si no,
  // `C#3` y cualquier ancla de URL abrirían una búsqueda.
  if (before.endsWith('#')) {
    const previous = before.at(-2);
    if (previous === undefined || /\s/.test(previous)) {
      return { trigger: 'etiqueta', queryStart: cursor };
    }
  }

  // La barra abre comandos sólo donde podría empezar uno, por la misma razón:
  // una fecha o una ruta llevan barras y no son comandos.
  if (before.endsWith('/')) {
    const previous = before.at(-2);
    if (previous === undefined || /\s/.test(previous)) {
      return { trigger: 'comando', queryStart: cursor };
    }
  }

  /*
   * Estar dentro de una referencia ya escrita cuenta como estar buscando.
   *
   * Los casos de arriba sólo reconocen el instante en que se acaba de teclear el
   * disparador. Eso deja fuera lo más frecuente cuando se corrige: volver sobre
   * un `[[Casiopea]]` que quedó mal escrito, poner el cursor dentro y esperar
   * que ofrezca. Se mira hacia atrás desde el cursor y, si hay una apertura sin
   * su cierre por medio, la región es suya.
   *
   * El límite es la línea: un corchete abierto tres párrafos más arriba no está
   * buscando nada, y sin este tope cualquier `[[` huérfano del corpus convertiría
   * el resto del bloque en una consulta abierta.
   */
  const line = before.slice(before.lastIndexOf('\n') + 1);
  const dentroDe = (abre: string, cierra: string): number => {
    const at = line.lastIndexOf(abre);
    if (at < 0) return -1;
    return line.slice(at + abre.length).includes(cierra) ? -1 : at + abre.length;
  };

  const enEtiqueta = dentroDe('#[[', ']]');
  if (enEtiqueta >= 0) {
    return { trigger: 'etiqueta', queryStart: cursor - (line.length - enEtiqueta) };
  }
  const enPagina = dentroDe('[[', ']]');
  if (enPagina >= 0) {
    return { trigger: 'pagina', queryStart: cursor - (line.length - enPagina) };
  }
  const enBloque = dentroDe('((', '))');
  if (enBloque >= 0) {
    return { trigger: 'bloque', queryStart: cursor - (line.length - enBloque) };
  }

  return null;
}

/**
 * Lo que se está buscando, o `null` si el cursor salió de la región.
 *
 * La consulta muere al llegar un espacio en las que no lo admiten, y al salir
 * el cursor por delante del disparador.
 */
export function queryOf(open: Open, buffer: string, cursor: number): string | null {
  if (cursor < open.queryStart) return null;

  const query = buffer.slice(open.queryStart, cursor);

  // Un corchete de cierre termina la referencia aunque el cursor siga dentro.
  if (query.includes(']') || query.includes(')')) return null;
  if (query.includes('\n')) return null;

  // Etiquetas y comandos no llevan espacios; páginas y bloques sí.
  if ((open.trigger === 'etiqueta' || open.trigger === 'comando') && query.includes(' ')) {
    return null;
  }

  return query;
}

/** Qué se escribe al elegir, y dónde queda el cursor después. */
export function completionFor(
  open: Open,
  choice: string,
  buffer: string,
  cursor: number,
): { buffer: string; cursor: number } {
  const head = buffer.slice(0, open.queryStart);
  const tail = buffer.slice(cursor);

  if (open.trigger === 'pagina' || open.trigger === 'bloque') {
    // El autopar ya dejó el cierre delante del cursor, así que sólo hay que
    // saltarlo en vez de escribir otro.
    //
    // Y si el cursor estaba en medio de una referencia ya escrita, lo que queda
    // entre él y ese cierre es el resto del título viejo: se reemplaza también,
    // o corregir `[[Casi|opea]]` dejaría `[[Casiopea]]opea]]`. Sólo hasta el
    // primer cierre, y sólo si por medio no empieza otra referencia, que sería
    // de alguien más.
    const closing = open.trigger === 'pagina' ? ']]' : '))';
    const opening = open.trigger === 'pagina' ? '[[' : '((';
    const upTo = tail.indexOf(closing);
    const between = upTo < 0 ? '' : tail.slice(0, upTo);
    const ours = upTo >= 0 && !between.includes(opening) && !between.includes('\n');
    const skip = ours ? upTo + closing.length : 0;
    return {
      buffer: head + choice + closing + tail.slice(skip),
      cursor: head.length + choice.length + closing.length,
    };
  }

  if (open.trigger === 'etiqueta') {
    // Una etiqueta con espacios necesita corchetes; sin ellos no lo parece.
    const written = choice.includes(' ') ? `[[${choice}]]` : choice;
    return { buffer: head + written + tail, cursor: head.length + written.length };
  }

  const command = COMMANDS.find((entry) => entry.name === choice);
  if (command === undefined) return { buffer, cursor };

  const written = typeof command.inserts === 'function' ? command.inserts() : command.inserts;
  // El comando se come su propia barra: `/cita` deja una cita, no `/> `.
  const withoutSlash = head.slice(0, -1);
  return {
    buffer: withoutSlash + written + tail,
    cursor: withoutSlash.length + (command.caret ?? written.length),
  };
}

/**
 * La fecha de hoy tal como la escribe el calendario.
 *
 * El reloj es el de esta máquina, no el del servidor: quien escribe está aquí, y
 * si son las once de la noche del lunes para él, es lunes, aunque el servidor
 * viva en otro huso. daily-log.allium deja abierto qué pasa cuando esos dos
 * relojes no son el mismo; mientras la instancia sea de una persona en una
 * máquina, la pregunta no se hace.
 */
export function today(): string {
  return calendarDate(new Date());
}

/**
 * Si un título nombra un día.
 *
 * @invariant ADayIsNamedByItsDate, de daily-log.allium: el título de un día es
 * su fecha y nada más — no es una etiqueta puesta sobre el día, es su identidad.
 * Por eso la pregunta se contesta mirando el título y no una propiedad: una
 * página titulada como una fecha es un día, la haya hecho quien la haya hecho.
 */
export function isDay(title: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(title);
}

/** `YYYY-MM-DD` en horario local, que es como se titula un día. */
export function calendarDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface Command {
  name: string;
  hint: string;
  /**
   * Lo que deja escrito.
   *
   * Casi siempre un literal. Es una función cuando lo que escribe depende de
   * cuándo se escribe: `/hoy` no puede ser una constante porque mañana sería
   * mentira.
   */
  inserts: string | (() => string);
  /**
   * Dónde cae el cursor dentro de lo insertado. Omitido, al final — que es lo
   * que quiere un comando que deja algo terminado en vez de algo que rellenar.
   */
  caret?: number;
  /**
   * Lo que el comando hace además de escribir.
   *
   * Casi todos sólo dejan Markdown. `hablar` es el que no: abre una grabación en
   * ese punto de la escritura, y quien atiende el comando es el outliner, porque
   * el hecho ocurre en el grafo y no en el texto.
   */
  acts?:
    | 'hablar'
    | 'elegir-fecha'
    | 'poner-plazo'
    | 'importar'
    | 'adjuntar'
    | 'zotero'
    | 'dibujar'
    | 'formato';
  /** Se oculta de la portada del menú, pero sigue disponible por su nombre. */
  group?: 'formato';
}

/**
 * Los comandos de barra.
 *
 * Todos escriben Markdown y nada más. Vera no modela tipos de bloque ni
 * encabezados como estado —eso vive en el texto—, así que un comando que
 * pusiera un atributo estaría inventando un modelo que la spec no tiene.
 */
export const COMMANDS: Command[] = [
  { name: 'formato', hint: 'negrita, títulos, cita, código y enlace', inserts: '', caret: 0, acts: 'formato' },
  { name: 'titulo', hint: 'encabezado de primer nivel', inserts: '# ', caret: 2, group: 'formato' },
  { name: 'subtitulo', hint: 'encabezado de segundo nivel', inserts: '## ', caret: 3, group: 'formato' },
  { name: 'cita', hint: 'cita', inserts: '> ', caret: 2, group: 'formato' },
  { name: 'codigo', hint: 'bloque de código', inserts: '```\n\n```', caret: 4, group: 'formato' },
  { name: 'html', hint: 'HTML ejecutable y aislado', inserts: '```html-live\n\n```', caret: 13 },
  { name: 'iframe', hint: 'Incrustación externa autorizada', inserts: '```iframe\n\n```', caret: 10 },
  { name: 'svg', hint: 'SVG aislado para ilustraciones', inserts: '```svg\n<svg viewBox="0 0 800 600" role="img" aria-label="">\n\n</svg>\n```', caret: 67 },
  {
    name: 'p5js',
    hint: 'sketch p5.js local y aislado',
    inserts: '```p5js\nfunction setup() {\n  createCanvas(400, 400);\n}\n\nfunction draw() {\n  background(240);\n}\n```',
    caret: 52,
  },
  { name: 'mermaid', hint: 'diagrama', inserts: '```mermaid\n\n```', caret: 11 },
  { name: 'mediawiki', hint: 'wikitext', inserts: '```mediawiki\n\n```', caret: 13 },
  { name: 'tabla', hint: 'tabla de dos columnas', inserts: '| a | b |\n| --- | --- |\n|  |  |', caret: 2 },
  { name: 'linea', hint: 'línea horizontal', inserts: '---', caret: 3, group: 'formato' },
  { name: 'lista', hint: 'lista con viñetas', inserts: '- ', caret: 2, group: 'formato' },
  { name: 'numerada', hint: 'lista numerada', inserts: '1. ', caret: 3, group: 'formato' },
  { name: 'tarea', hint: 'casilla por hacer', inserts: '- [ ] ', caret: 6, group: 'formato' },
  { name: 'nota', hint: 'referencia a nota al pie', inserts: '[^1]', caret: 3, group: 'formato' },
  { name: 'pagina', hint: 'enlace a otra página', inserts: '[[]]', caret: 2, group: 'formato' },
  /*
   * Preguntarle al grafo.
   *
   * El comando no hace nada que no se pueda hacer escribiendo `? ` a mano: pone
   * la marca y deja el cursor detrás. Existe porque es donde uno va a buscar qué
   * se puede hacer desde el teclado, y porque ahorra recordar la sintaxis sin
   * inventar una segunda forma de crear lo mismo.
   */
  { name: '?', hint: 'consulta: preguntarle al grafo', inserts: '? ', caret: 2 },
  { name: 'audio', hint: 'hablar aquí mismo', inserts: '', caret: 0, acts: 'hablar' },
  /*
   * Dibujar a mano.
   *
   * No deja texto aquí: abre el lienzo a pantalla completa y lo que salga ocupa
   * el bloque. Está en esta lista porque es donde uno va a buscar qué puede
   * hacer, aunque lo que haga no sea escribir. Ver specs/hand-drawing.allium.
   */
  { name: 'dibujo', hint: 'dibujar a mano, a pantalla completa', inserts: '', caret: 0, acts: 'dibujar' },
  // Importar no escribe aquí: crea una página aparte y lleva a ella. Está en
  // esta lista porque es donde uno va a buscar «qué puedo hacer desde el
  // teclado», y no porque deje texto en el bloque.
  {
    name: 'import',
    hint: 'traer un .md o un .docx como página nueva',
    inserts: '',
    caret: 0,
    acts: 'importar',
  },
  {
    name: 'adjuntar',
    hint: 'subir una imagen, un audio o un PDF a este bloque',
    inserts: '',
    caret: 0,
    acts: 'adjuntar',
  },
  /*
   * Citar algo de la bibliografía.
   *
   * Busca por autor, título o año en Zotero y deja el enlace a la página del
   * ítem, que nace si no estaba. Citar y traer son el mismo gesto: separarlos
   * obligaría a irse de la frase que uno estaba escribiendo —que era, justamente,
   * la que cita— para volver después.
   */
  {
    name: 'zotero',
    hint: 'citar algo de la bibliografía: buscar por autor o título',
    inserts: '',
    caret: 0,
    acts: 'zotero',
  },
  /*
   * Una cosa por hacer.
   *
   * Deja la marca puesta y el cursor detrás, que es todo lo que hace falta: lo
   * que sigue se teclea. Sin formulario y sin campos que rellenar antes de decir
   * de qué se trata, que es lo único que uno sabe cuando se acuerda de que hay
   * algo que hacer. Ver specs/tasks.allium.
   */
  { name: 'tarea', hint: 'algo por hacer, con su casilla', inserts: '[ ] ' },
  // El mismo comando con el nombre que tiene en la cabeza de quien viene de
  // Logseq. No es un alias escondido: está en la lista, porque la lista es donde
  // uno mira qué puede hacer.
  { name: 'todo', hint: 'lo mismo que /tarea', inserts: '[ ] ' },
  {
    name: 'plazo',
    hint: 'cuándo hay que tenerlo hecho: elegir el día',
    inserts: '',
    caret: 0,
    acts: 'poner-plazo',
  },
  // Fechas. Un día es una página, así que fechar algo es enlazarlo: escribir
  // «hoy» como texto deja una palabra que dentro de un mes será falsa, y
  // escribir el enlace deja algo que sigue llevando al día en que se dijo.
  { name: 'hoy', hint: 'el día de hoy, enlazado a su diario', inserts: () => `[[${today()}]]` },
  {
    name: 'fecha',
    hint: 'elegir un día en el calendario',
    inserts: '',
    caret: 0,
    acts: 'elegir-fecha',
  },
];

/** Lo que un comando hace además de escribir, si hace algo. */
export function actionOf(name: string): Command['acts'] | undefined {
  return COMMANDS.find((command) => command.name === name)?.acts;
}

/** Filtra por lo escrito. Sin consulta se ofrecen todos. */
export function matchingCommands(query: string): Command[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return COMMANDS.filter((command) => command.group === undefined);
  return COMMANDS.filter(
    (command) =>
      command.name.toLowerCase().includes(needle) || command.hint.toLowerCase().includes(needle),
  );
}
