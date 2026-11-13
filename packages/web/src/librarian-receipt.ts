import type { LibrarianSelectionReceipt } from './api.ts';

export interface LibrarianReceiptRow {
  kind: 'source' | 'block' | 'page';
  label: string;
  id: string;
  revision: string | null;
  reasons: string[];
}

const amount = new Intl.NumberFormat('es-CL');

export function librarianReceiptSummary(receipt: LibrarianSelectionReceipt): string {
  if (!receipt.available) return 'Contexto heredado · recibo detallado no disponible';
  const selected = receipt.selections.length;
  const omissions = receipt.omitted.pageBlocks + receipt.omitted.libraryPages + receipt.omitted.degreeEdges;
  return [
    `Contexto recibido · ${amount.format(selected)} selección${selected === 1 ? '' : 'es'}`,
    `${amount.format(receipt.cost.characters)} caracteres`,
    omissions === 0 ? 'sin omisiones' : `${amount.format(omissions)} omisión${omissions === 1 ? '' : 'es'}`,
  ].join(' · ');
}

export function librarianReceiptRows(receipt: LibrarianSelectionReceipt): LibrarianReceiptRow[] {
  return [{
    kind: 'source',
    label: receipt.source.focus === null
      ? receipt.source.title
      : `${receipt.source.title} · foco ${receipt.source.focus}`,
    id: receipt.source.page,
    revision: receipt.source.revision,
    reasons: [receipt.selectionReason],
  }, ...receipt.selections.map((selection) => ({
    kind: selection.kind,
    label: selection.kind === 'page' ? selection.title ?? selection.id : selection.id,
    id: selection.id,
    revision: selection.revision,
    reasons: [...selection.reasons],
  }))];
}

