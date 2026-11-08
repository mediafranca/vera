// El texto que todavía está bajo la mano no es una revisión del corpus.
//
// Se conserva en el dispositivo para que un cierre accidental no lo pierda,
// pero sólo al dejar el bloque se convierte en una operación canónica. Así el
// historial cuenta jugadas editoriales, no pausas para pensar.

interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredDraft {
  base: string;
  content: string;
  keptAt: number;
}

const PREFIX = 'vera.editing-draft:';

function key(block: string): string {
  return `${PREFIX}${block}`;
}

function parsed(raw: string | null): StoredDraft | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredDraft>;
    return typeof value.base === 'string' && typeof value.content === 'string' &&
      typeof value.keptAt === 'number'
      ? { base: value.base, content: value.content, keptAt: value.keptAt }
      : null;
  } catch {
    return null;
  }
}

/** Conserva lo que aún no constituye una revisión del corpus. */
export function keepEditingDraft(
  block: string,
  base: string,
  content: string,
  storage: DraftStorage = localStorage,
): void {
  try {
    if (content.trim() === base.trim()) {
      storage.removeItem(key(block));
      return;
    }
    storage.setItem(key(block), JSON.stringify({ base, content, keptAt: Date.now() }));
  } catch {
    // El campo sigue conteniendo el texto. La falta de depósito no convierte un
    // borrador en operación ni interrumpe la escritura.
  }
}

/** Recupera sólo sobre la misma revisión base; nunca pisa una edición ajena. */
export function recoverEditingDraft(
  block: string,
  base: string,
  storage: DraftStorage = localStorage,
): string | null {
  try {
    const draft = parsed(storage.getItem(key(block)));
    if (draft === null) {
      storage.removeItem(key(block));
      return null;
    }
    if (draft.base !== base) {
      storage.removeItem(key(block));
      return null;
    }
    return draft.content;
  } catch {
    return null;
  }
}

/** Retira sólo el borrador que corresponde al contenido ya confirmado. */
export function discardEditingDraft(
  block: string,
  committed: string,
  storage: DraftStorage = localStorage,
): void {
  try {
    const draft = parsed(storage.getItem(key(block)));
    if (draft === null || draft.content === committed) storage.removeItem(key(block));
  } catch {
    // Confirmar el corpus es lo decisivo; un residuo local no invalida el acto.
  }
}
