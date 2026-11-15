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

export interface RecoveredEditingDraft {
  base: string;
  content: string;
  keptAt: number;
  /** El corpus cambió desde que comenzó esta jugada; ambas versiones importan. */
  baseChanged: boolean;
}

const PREFIX = 'vera.editing-draft:';

function key(block: string): string {
  return `${PREFIX}${block}`;
}

function parsed(raw: string | null): Omit<RecoveredEditingDraft, 'baseChanged'> | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<RecoveredEditingDraft>;
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

/**
 * Recupera siempre el borrador local.
 *
 * Si la base canónica cambió, conservar ambas versiones es precisamente lo que
 * permite resolver el desacuerdo. Borrar la local en ese caso convertía una
 * sincronización en pérdida de texto: la situación más importante era la única
 * en que el depósito se vaciaba.
 */
export function recoverEditingDraft(
  block: string,
  base: string,
  storage: DraftStorage = localStorage,
): RecoveredEditingDraft | null {
  try {
    const draft = parsed(storage.getItem(key(block)));
    if (draft === null) {
      storage.removeItem(key(block));
      return null;
    }
    return { ...draft, baseChanged: draft.base !== base };
  } catch {
    return null;
  }
}

/** Retira un borrador sólo por una decisión explícita de tomar el corpus. */
export function forgetEditingDraft(
  block: string,
  storage: DraftStorage = localStorage,
): void {
  try {
    storage.removeItem(key(block));
  } catch {
    // La decisión ya se tomó; un residuo local sólo podrá volver a ofrecerse.
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
