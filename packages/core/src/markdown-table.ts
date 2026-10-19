// Una tabla de Vera sigue siendo Markdown. Este módulo sólo hace explícita la
// forma rectangular que comparten el renderizador y el editor visual.

export type TableAlignment = 'left' | 'center' | 'right';

export interface MarkdownTable {
  header: string[];
  alignments: TableAlignment[];
  rows: string[][];
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER_CELL = /^:?-+:?$/;

/** Parte una fila sin confundir `\|`, usado dentro de una celda, con un borde. */
export function markdownTableCells(row: string): string[] | null {
  if (!TABLE_ROW.test(row)) return null;
  const inner = row.trim().slice(1, -1);
  const cells: string[] = [];
  let current = '';
  let slashes = 0;
  for (const character of inner) {
    if (character === '|' && slashes % 2 === 0) {
      cells.push(current.trim());
      current = '';
      slashes = 0;
      continue;
    }
    current += character;
    slashes = character === '\\' ? slashes + 1 : 0;
  }
  cells.push(current.trim());
  return cells;
}

function alignmentOf(cell: string): TableAlignment | null {
  const clean = cell.replace(/\s/g, '');
  if (!TABLE_DIVIDER_CELL.test(clean)) return null;
  if (clean.startsWith(':') && clean.endsWith(':')) return 'center';
  if (clean.endsWith(':')) return 'right';
  return 'left';
}

/** Sólo reconoce un bloque que sea entero una tabla rectangular portable. */
export function readMarkdownTable(source: string): MarkdownTable | null {
  const lines = source.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = markdownTableCells(lines[0] ?? '');
  const divider = markdownTableCells(lines[1] ?? '');
  if (header === null || divider === null || header.length === 0 || divider.length !== header.length) {
    return null;
  }
  const alignments = divider.map(alignmentOf);
  if (alignments.some((alignment) => alignment === null)) return null;

  const rows: string[][] = [];
  for (const line of lines.slice(2)) {
    const row = markdownTableCells(line);
    if (row === null || row.length !== header.length) return null;
    rows.push(row);
  }
  return { header, alignments: alignments as TableAlignment[], rows };
}

function safeCell(source: string): string {
  let escaped = '';
  let slashes = 0;
  for (const character of source.trim().replace(/[\r\n]+/g, ' ')) {
    if (character === '|' && slashes % 2 === 0) escaped += '\\';
    escaped += character;
    slashes = character === '\\' ? slashes + 1 : 0;
  }
  return escaped;
}

function dividerFor(alignment: TableAlignment): string {
  if (alignment === 'center') return ':---:';
  if (alignment === 'right') return '---:';
  return '---';
}

/** Serializa una forma rectangular sin guardar estado privado del editor. */
export function writeMarkdownTable(table: MarkdownTable): string {
  const columns = Math.max(1, table.header.length);
  const fit = (row: readonly string[]): string[] => Array.from(
    { length: columns },
    (_, index) => safeCell(row[index] ?? ''),
  );
  const header = fit(table.header);
  const alignments = Array.from(
    { length: columns },
    (_, index) => table.alignments[index] ?? 'left',
  );
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${alignments.map(dividerFor).join(' | ')} |`,
    ...table.rows.map((row) => `| ${fit(row).join(' | ')} |`),
  ];
  return lines.join('\n');
}
