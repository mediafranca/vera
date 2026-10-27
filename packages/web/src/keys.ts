// Qué hace cada tecla estructural del outliner.
//
// Aquí no se toca el DOM ni se envía nada: entran el texto, el cursor y la
// vecindad del bloque, y sale la decisión. El outliner la ejecuta. Así el
// comportamiento que decide si se pierde texto o identidad se prueba entero
// sin un navegador.
//
// Traducido de ~/Sites/logseq/specs/block-structure.allium al vocabulario de
// Vera y a lo que su dominio ya sabe hacer.

/** Lo que hace falta saber del entorno de un bloque para resolver una tecla. */
export interface Neighbourhood {
  /** El bloque que se está editando. */
  block: string;
  parent: string | null;
  /** Su lugar entre sus hermanos. */
  index: number;
  hasChildren: boolean;
  /** El hermano inmediatamente anterior, si lo hay. */
  previousSibling: string | null;
  /** El bloque anterior en el orden en que se leen, sea hermano o no. */
  previousVisible: { block: string; content: string; hasChildren: boolean } | null;
  /** El siguiente en el orden en que se leen. */
  nextVisible: string | null;
  /** El padre del padre, para desindentar. */
  grandparent: string | null;
  /** Dónde queda el padre entre SUS hermanos, para colocar lo desindentado. */
  parentIndex: number;
}

export type KeyOutcome =
  | { kind: 'ninguno' }
  /** Partir el bloque: éste conserva `head` y su identidad; nace otro con `tail`. */
  | { kind: 'partir'; head: string; tail: string; parent: string | null; position: number }
  /** Un bloque vacío por encima; el editado no se toca. */
  | { kind: 'insertar-encima'; parent: string | null; position: number }
  | { kind: 'indentar'; parent: string; position: number }
  | { kind: 'desindentar'; parent: string | null; position: number }
  /** Fusionar con el anterior: su texto absorbe éste, y éste desaparece. */
  | { kind: 'fusionar'; into: string; content: string; caret: number }
  /** El de arriba estaba vacío: desaparece él y no éste. */
  | { kind: 'quitar-encima'; target: string }
  | { kind: 'mover-foco'; block: string; at: 'inicio' | 'final' }
  | { kind: 'rechazo'; reason: string };

export interface FormatOutcome {
  buffer: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Alterna un delimitador Markdown conservando el texto escogido. */
export function resolveFormat(
  marker: string,
  buffer: string,
  selectionStart: number,
  selectionEnd: number,
): FormatOutcome {
  const width = marker.length;
  const selected = buffer.slice(selectionStart, selectionEnd);

  if (
    selectionStart >= width &&
    buffer.slice(selectionStart - width, selectionStart) === marker &&
    buffer.slice(selectionEnd, selectionEnd + width) === marker
  ) {
    return {
      buffer: buffer.slice(0, selectionStart - width) + selected + buffer.slice(selectionEnd + width),
      selectionStart: selectionStart - width,
      selectionEnd: selectionEnd - width,
    };
  }

  if (selected.length >= width * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(width, -width);
    return {
      buffer: buffer.slice(0, selectionStart) + inner + buffer.slice(selectionEnd),
      selectionStart,
      selectionEnd: selectionEnd - width * 2,
    };
  }

  return {
    buffer: buffer.slice(0, selectionStart) + marker + selected + marker + buffer.slice(selectionEnd),
    selectionStart: selectionStart + width,
    selectionEnd: selectionEnd + width,
  };
}

/** Alterna un prefijo de bloque; los encabezados se sustituyen entre sí. */
export function resolveBlockFormat(
  prefix: '# ' | '## ' | '### ' | '#### ' | '##### ' | '###### ' | '> ',
  buffer: string,
): FormatOutcome {
  const heading = /^#{1,6} /.exec(buffer)?.[0] ?? '';
  const current = prefix.startsWith('#') ? heading : buffer.startsWith(prefix) ? prefix : '';
  const next = current === prefix ? buffer.slice(current.length) : prefix + buffer.slice(current.length);
  return { buffer: next, selectionStart: 0, selectionEnd: next.length };
}

/** Convierte la selección en un enlace a otra página de Vera. */
export function resolveInternalLink(
  buffer: string,
  selectionStart: number,
  selectionEnd: number,
): FormatOutcome {
  const selected = buffer.slice(selectionStart, selectionEnd);
  const written = `[[${selected}]]`;
  return {
    buffer: buffer.slice(0, selectionStart) + written + buffer.slice(selectionEnd),
    selectionStart: selectionStart + 2,
    selectionEnd: selectionStart + 2 + selected.length,
  };
}

/** Convierte la selección en un enlace Markdown portable. */
export function resolveLink(
  buffer: string,
  selectionStart: number,
  selectionEnd: number,
): FormatOutcome {
  const selected = buffer.slice(selectionStart, selectionEnd) || 'texto';
  const written = `[${selected}](https://)`;
  return {
    buffer: buffer.slice(0, selectionStart) + written + buffer.slice(selectionEnd),
    selectionStart: selectionStart + 1,
    selectionEnd: selectionStart + 1 + selected.length,
  };
}

/**
 * Enter parte el bloque por el cursor.
 *
 * Un bloque con hijos gana un primer hijo, porque ahí es donde va la línea
 * siguiente cuando se escribe dentro de una lista. Cualquier otro gana un
 * hermano detrás.
 */
export function resolveEnter(
  buffer: string,
  selectionStart: number,
  selectionEnd: number,
  near: Neighbourhood,
): KeyOutcome {
  const head = buffer.slice(0, selectionStart);
  const tail = buffer.slice(selectionEnd);

  // Con el cursor al principio y texto detrás, se empuja un bloque vacío encima
  // en vez de partir: así el texto conserva su identidad, sus hijos y sus
  // referencias, que es justo lo que una partición le quitaría.
  if (head === '' && tail !== '') {
    return { kind: 'insertar-encima', parent: near.parent, position: near.index };
  }

  return near.hasChildren
    ? { kind: 'partir', head, tail, parent: near.block, position: 0 }
    : { kind: 'partir', head, tail, parent: near.parent, position: near.index + 1 };
}

/**
 * Los teclados virtuales no siempre emiten `keydown` para Retorno.
 *
 * Safari/iOS y algunos IME expresan el gesto fiable en `beforeinput`, unas
 * veces como `insertParagraph` y otras como `insertLineBreak`. En ambos casos
 * es el Enter estructural de Vera, salvo cuando un teclado físico acaba de
 * declarar explícitamente Shift-Enter para escribir un salto dentro del mismo
 * bloque.
 */
export function beforeInputSplitsBlock(inputType: string, physicalNewline: boolean): boolean {
  if (physicalNewline) return false;
  return inputType === 'insertParagraph' || inputType === 'insertLineBreak';
}

/**
 * Lo que puede pasar sobre un dibujo enfocado, que es poco y a propósito.
 *
 * No comparte `KeyOutcome` porque no comparte ninguno de sus casos: un dibujo no
 * se parte, no se fusiona y no se indenta desde el teclado. Lo único que hace
 * `abrir-debajo` y que no hace ningún otro es nacer un bloque sin tocar el que
 * está enfocado, que es la diferencia entera entre un dibujo y una frase.
 */
export type DrawingOutcome =
  | { kind: 'ninguno' }
  | { kind: 'mover-foco'; block: string; at: 'inicio' | 'final' }
  /** Un bloque vacío detrás; el dibujo no se toca. */
  | { kind: 'abrir-debajo'; parent: string | null; position: number };

/**
 * Las teclas de un dibujo enfocado.
 *
 * Sus trazos son el texto del bloque, así que no hay cursor dentro y no hay nada
 * que escribir: lo que queda es recorrer la página y abrir un bloque detrás. Sin
 * esto, un dibujo al final de una página era el final de la página.
 * Ver specs/hand-drawing.allium.
 *
 * Una letra suelta no hace nada. Podría nacer un bloque debajo y aterrizar en
 * él, que ahorra un gesto; a cambio dejaría que una tecla sin querer escribiera
 * en el grafo desde un sitio donde nadie estaba escribiendo.
 * @invariant TheCursorRestsOnItAndWritesNothing.
 */
export function resolveDrawingKey(key: string, near: Neighbourhood): DrawingOutcome {
  // @invariant TheFourArrowsCross: un dibujo no tiene renglones que recorrer,
  // así que las cuatro flechas significan lo que significan en el borde de un
  // bloque de texto — salir por ese lado.
  if (key === 'ArrowDown' || key === 'ArrowRight') {
    if (near.nextVisible === null) return { kind: 'ninguno' };
    return { kind: 'mover-foco', block: near.nextVisible, at: 'inicio' };
  }
  if (key === 'ArrowUp' || key === 'ArrowLeft') {
    if (near.previousVisible === null) return { kind: 'ninguno' };
    return { kind: 'mover-foco', block: near.previousVisible.block, at: 'final' };
  }

  // Enter abre y no parte. Dónde cae el bloque nuevo es lo que decide
  // `resolveEnter` para cualquier otro: con hijos, un primer hijo; sin hijos, un
  // hermano detrás. @invariant ItOpensAndDoesNotSplit.
  if (key === 'Enter') {
    return near.hasChildren
      ? { kind: 'abrir-debajo', parent: near.block, position: 0 }
      : { kind: 'abrir-debajo', parent: near.parent, position: near.index + 1 };
  }

  return { kind: 'ninguno' };
}

/** Tab hace del bloque un hijo del hermano de arriba. Sin hermano arriba, nada. */
export function resolveTab(forward: boolean, near: Neighbourhood): KeyOutcome {
  if (forward) {
    if (near.previousSibling === null) {
      return { kind: 'rechazo', reason: 'no hay un hermano encima al que entrar' };
    }
    // Al final de los hijos del hermano: es donde cae lo que se acaba de indentar.
    return { kind: 'indentar', parent: near.previousSibling, position: Number.MAX_SAFE_INTEGER };
  }

  if (near.parent === null) {
    return { kind: 'rechazo', reason: 'el bloque ya está en el primer nivel' };
  }
  // Justo detrás de su antiguo padre, que es donde se lo espera al salir.
  return { kind: 'desindentar', parent: near.grandparent, position: near.parentIndex + 1 };
}

/**
 * Backspace con el cursor en cero deja de editar texto y pasa a editar
 * estructura. Las negativas van primero: cada una protege algo que la fusión
 * destruiría o dejaría ambiguo.
 */
export function resolveBackspaceAtStart(buffer: string, near: Neighbourhood): KeyOutcome {
  const target = near.previousVisible;

  if (target === null) {
    // Sin nada encima no hay dónde fusionar. Si el bloque está vacío tampoco se
    // quita aquí: para eso está el borrado explícito, que sí puede decir por qué.
    return buffer === ''
      ? { kind: 'ninguno' }
      : { kind: 'rechazo', reason: 'no hay ningún bloque encima con el que fusionar' };
  }

  // Fusionar dos bloques que ambos tienen hijos obligaría a decidir de quién son
  // los hijos primero. En vez de adivinar, se rechaza.
  if (near.hasChildren && target.hasChildren) {
    return { kind: 'rechazo', reason: 'ambos bloques tienen hijos y el orden sería ambiguo' };
  }

  // Cuando el de arriba está vacío, es él quien desaparece. El que se edita
  // conserva su identidad, y con ella sus referencias y sus hijos.
  if (target.content === '' && !target.hasChildren && target.block !== near.parent) {
    return { kind: 'quitar-encima', target: target.block };
  }

  if (target.content === '') {
    return { kind: 'rechazo', reason: 'el bloque de encima no se puede quitar' };
  }

  return {
    kind: 'fusionar',
    into: target.block,
    content: target.content + buffer,
    caret: target.content.length,
  };
}

/** ¿El cursor está en la primera línea del texto? Decide si la flecha sale del bloque. */
export function onFirstLine(buffer: string, cursor: number): boolean {
  return !buffer.slice(0, cursor).includes('\n');
}

export function onLastLine(buffer: string, cursor: number): boolean {
  return !buffer.slice(cursor).includes('\n');
}

export function resolveArrow(
  up: boolean,
  buffer: string,
  cursor: number,
  near: Neighbourhood,
): KeyOutcome {
  if (up) {
    if (!onFirstLine(buffer, cursor) || near.previousVisible === null) return { kind: 'ninguno' };
    return { kind: 'mover-foco', block: near.previousVisible.block, at: 'final' };
  }
  if (!onLastLine(buffer, cursor) || near.nextVisible === null) return { kind: 'ninguno' };
  return { kind: 'mover-foco', block: near.nextVisible, at: 'inicio' };
}

// ---------------------------------------------------------------------------
// Autopar
// ---------------------------------------------------------------------------

const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  '`': '`',
};

const CLOSERS = new Set(Object.values(PAIRS));

export interface TypedText {
  buffer: string;
  cursor: number;
}

/**
 * Qué deja escribir un delimitador.
 *
 * Con texto seleccionado lo envuelve, que es cómo una palabra marcada se vuelve
 * código o cita. Con el cursor suelto trae su pareja y se queda en medio. Y si
 * el cierre ya está bajo el cursor, lo salta: un par nunca se vuelve tres.
 */
export function resolveDelimiter(
  character: string,
  buffer: string,
  selectionStart: number,
  selectionEnd: number,
): TypedText | null {
  const closing = PAIRS[character];

  if (selectionStart !== selectionEnd) {
    if (closing === undefined) return null;
    const selected = buffer.slice(selectionStart, selectionEnd);
    return {
      buffer:
        buffer.slice(0, selectionStart) +
        character +
        selected +
        closing +
        buffer.slice(selectionEnd),
      cursor: selectionEnd + 1,
    };
  }

  if (CLOSERS.has(character) && buffer[selectionStart] === character) {
    return { buffer, cursor: selectionStart + 1 };
  }

  if (closing === undefined) return null;

  return {
    buffer: buffer.slice(0, selectionStart) + character + closing + buffer.slice(selectionStart),
    cursor: selectionStart + 1,
  };
}
