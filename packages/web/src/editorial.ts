import {
  markdownHeadings,
  uniqueAnchors,
  type RenderOptions,
} from '@vera/core';

export interface EditorialEdit {
  buffer: string;
  selectionStart: number;
  selectionEnd: number;
}

/** El primer número positivo que ninguna referencia ni definición ocupa. */
export function nextFootnoteId(sources: readonly string[]): string {
  const used = new Set<number>();
  for (const source of sources) {
    for (const match of source.matchAll(/\[\^(\d+)\](?::)?/g)) {
      const value = Number(match[1]);
      if (Number.isSafeInteger(value) && value > 0) used.add(value);
    }
  }
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return String(candidate);
}

/**
 * Crea el par completo: referencia donde se escribe y definición al pie del
 * mismo bloque. La selección se conserva como prosa y la nota se pone después.
 */
export function insertFootnote(
  buffer: string,
  selectionStart: number,
  selectionEnd: number,
  pageSources: readonly string[],
): EditorialEdit {
  const id = nextFootnoteId(pageSources);
  const at = Math.max(selectionStart, selectionEnd);
  const reference = `[^${id}]`;
  const withReference = buffer.slice(0, at) + reference + buffer.slice(at);
  const separator = withReference === '' || withReference.endsWith('\n\n')
    ? ''
    : withReference.endsWith('\n') ? '\n' : '\n\n';
  const definition = `[^${id}]: `;
  const completed = withReference + separator + definition;
  return {
    buffer: completed,
    selectionStart: completed.length,
    selectionEnd: completed.length,
  };
}

function linkLabel(text: string): string {
  return text.replace(/([\\\[\]])/g, '\\$1');
}

/**
 * Índice portable de una página: una lista Markdown corriente, no un widget.
 * Devuelve `null` cuando la página no tiene encabezados que indexar.
 */
export function pageTableOfContents(
  sources: readonly string[],
  options: RenderOptions = {},
): string | null {
  const headings = sources.flatMap((source) => markdownHeadings(source, options));
  if (headings.length === 0) return null;
  const anchors = uniqueAnchors(headings.map((heading) => heading.text));
  const firstLevel = Math.min(...headings.map((heading) => heading.level));
  return headings.map((heading, index) => {
    const indent = '  '.repeat(Math.max(0, heading.level - firstLevel));
    return `${indent}- [${linkLabel(heading.text)}](#${anchors[index] ?? ''})`;
  }).join('\n');
}

/** Inserta un fragmento de bloque sin pegarlo a la prosa vecina. */
export function insertMarkdownFragment(
  buffer: string,
  at: number,
  fragment: string,
): EditorialEdit {
  const before = buffer.slice(0, at);
  const after = buffer.slice(at);
  const lead = before === '' || before.endsWith('\n') ? '' : '\n';
  const tail = after === '' || after.startsWith('\n') ? '' : '\n';
  const written = before + lead + fragment + tail + after;
  const cursor = before.length + lead.length + fragment.length;
  return { buffer: written, selectionStart: cursor, selectionEnd: cursor };
}
