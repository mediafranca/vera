// La sesión de edición de un bloque.
//
// Es lógica pura: no toca el DOM ni la red. El outliner le cuenta lo que pasa y
// ella dice qué hay que guardar. Así el comportamiento que decide si se pierde
// texto se puede probar sin un navegador.
//
// @invariant TypingIsNeverLost: mientras se escribe, el outliner conserva este
// buffer como borrador durable local. La sesión entrega una sola forma final al
// grafo cuando termina la jugada.

/** Qué toca hacer ahora. `nada` cuando el buffer coincide con lo ya guardado. */
export type SaveIntent = { action: 'nada' } | { action: 'guardar'; content: string };

export interface EditSession {
  /** El texto que el participante está viendo. */
  buffer(): string;
  /** Lo último que llegó al grafo canónico. */
  saved(): string;
  dirty(): boolean;

  /** Registra lo escrito. Devuelve si el buffer cambió respecto de lo guardado. */
  type(next: string): void;

  /**
   * Lo que corresponde confirmar al terminar esta jugada.
   *
   * Un cierre sin nada que decir no escribe.
   */
  pending(): SaveIntent;

  /** Confirma que ese contenido llegó al grafo. */
  settled(content: string): void;

  /**
   * Salir del bloque, por Escape o por clic fuera.
   *
   * Guarda lo que quede pendiente. El borrador local se retira sólo después de
   * que el resultado haya sido confirmado.
   */
  leave(): SaveIntent;

  /** Un guardado que falló devuelve el texto al participante sin perderlo. */
  failed(): void;
}

/** Comparar sin los espacios de los extremos: un espacio final no es un cambio. */
function same(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

export function createSession(original: string): EditSession {
  let buffer = original;
  let saved = original;

  /*
   * Y lo que no es un cambio tampoco se guarda.
   *
   * Estaba a medias: comparar ya ignoraba el blanco de los extremos, pero lo que
   * viajaba al grafo era el buffer entero. Un bloque acababa guardado con su
   * salto de línea final, y como el campo de edición enseña el fuente exacto
   * —@invariant EditingRevealsTheSource— ese salto se dibujaba: al abrir el
   * bloque le crecían dos renglones vacíos por debajo que no estaban al leerlo.
   * En el corpus hay 55 bloques así, todos de páginas traídas de documentos.
   *
   * Sólo el final. Un blanco al principio de una línea puede significar algo en
   * Markdown —una sangría de código—, y el del final no significa nada en
   * ninguna parte.
   *
   * Escribir no se entera: el campo sigue conteniendo lo que se tecleó, incluido
   * el Enter que se acaba de pulsar, y lo que se escriba después se guarda
   * entero. Y no hay reenvíos, porque la comparación ya ignoraba ese blanco.
   */
  const intent = (): SaveIntent =>
    same(buffer, saved) ? { action: 'nada' } : { action: 'guardar', content: buffer.trimEnd() };

  return {
    buffer: () => buffer,
    saved: () => saved,
    dirty: () => !same(buffer, saved),

    type(next: string): void {
      buffer = next;
    },

    pending: intent,
    leave: intent,

    settled(content: string): void {
      saved = content;
    },

    failed(): void {
      // `saved` no se toca: lo que no llegó al grafo sigue pendiente, y el
      // siguiente intento —otra pausa, o salir del bloque— vuelve a mandarlo.
    },
  };
}
