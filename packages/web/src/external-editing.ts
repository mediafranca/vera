/**
 * Sesiones de edición externa temporal-durables.
 *
 * Ver specs/external-editing.allium. Este módulo no abre aplicaciones ni escribe
 * el grafo: modela el estado durable que ambas superficies necesitan y calcula
 * una conciliación conservadora de tres vías. El botón «Aceptar cambios» podrá
 * convertir un plan listo en un lote canónico; guardar el archivo jamás lo hace.
 */

export type ExternalEditableKind =
  | 'page_markdown'
  | 'block_markdown'
  | 'svg'
  | 'mermaid'
  | 'html'
  | 'javascript'
  | 'code'
  | 'process'
  | 'mediawiki';

export type ExternalBlockProjection = {
  kind: Exclude<ExternalEditableKind, 'page_markdown'>;
  extension: string;
  source: string;
  restore(source: string): string;
};

const CODE_EXTENSIONS: Readonly<Record<string, string>> = {
  bash: 'sh',
  c: 'c',
  cpp: 'cpp',
  css: 'css',
  go: 'go',
  javascript: 'js',
  js: 'js',
  json: 'json',
  jsx: 'jsx',
  python: 'py',
  py: 'py',
  rust: 'rs',
  rs: 'rs',
  sh: 'sh',
  sql: 'sql',
  ts: 'ts',
  tsx: 'tsx',
  typescript: 'ts',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yml',
};

/**
 * Materializa la fuente que corresponde al tipo real de un bloque.
 *
 * El editor externo no necesita cargar el cercado Markdown para trabajar sobre
 * un SVG o un programa. `restore` vuelve a poner exactamente el prefijo y el
 * cierre originales, de modo que aceptar conserva el lenguaje y el blanco que
 * pertenecen al bloque.
 */
export function projectExternalBlock(content: string): ExternalBlockProjection {
  const fenced = /^(\s*```([^\n`]*)\n)([\s\S]*?)(\n```\s*)$/.exec(content);
  if (fenced === null) {
    return {
      kind: 'block_markdown',
      extension: 'md',
      source: content,
      restore: (source) => source,
    };
  }

  const language = (fenced[2] ?? '').trim().toLowerCase();
  const source = fenced[3] ?? '';
  const prefix = fenced[1] ?? '```\n';
  const suffix = fenced[4] ?? '\n```';
  const restore = (next: string): string => `${prefix}${next}${suffix}`;

  if (language === 'mermaid') return { kind: 'mermaid', extension: 'mmd', source, restore };
  if (language === 'svg') return { kind: 'svg', extension: 'svg', source, restore };
  if (language === 'html-live' || language === 'html') {
    return { kind: 'html', extension: 'html', source, restore };
  }
  if (language === 'p5js') return { kind: 'javascript', extension: 'js', source, restore };
  if (language === 'proceso') return { kind: 'process', extension: 'yaml', source, restore };
  if (language === 'mediawiki') return { kind: 'mediawiki', extension: 'wiki', source, restore };

  return {
    kind: 'code',
    extension: CODE_EXTENSIONS[language] ?? 'txt',
    source,
    restore,
  };
}

export type ExternalEditTarget = {
  graph: string;
  kind: ExternalEditableKind;
  page?: string;
  block?: string;
};

export type ExternalEditManifest = {
  target: ExternalEditTarget;
  baseSequence: number;
  stableBlockIds: string[];
};

export type ExternalEditStatus =
  | 'active'
  | 'attention_required'
  | 'ready'
  | 'accepted'
  | 'discarded';

export type ExternalEditSession = {
  id: string;
  device: string;
  target: ExternalEditTarget;
  manifest: ExternalEditManifest;
  base: string;
  canonical: string;
  draft: string;
  dirty: boolean;
  status: ExternalEditStatus;
  openedAt: number;
  updatedAt: number;
  divergence: ExternalDivergence | null;
};

export type ExternalDivergence = {
  base: string;
  canonical: string;
  external: string;
};

export type ThreeWayResult =
  | { kind: 'unchanged'; content: string }
  | { kind: 'canonical_only'; content: string }
  | { kind: 'external_only'; content: string }
  | { kind: 'combined'; content: string }
  | { kind: 'divergent'; divergence: ExternalDivergence };

export type ExternalSessionSnapshot = {
  version: 1;
  sessions: ExternalEditSession[];
};

export type ExternalPageBlock = {
  stableId: string;
  content: string;
  parent: string | null;
  position: number;
};

export type ExternalPageEditPlan =
  | { kind: 'ready'; edits: { kind: 'edit_block'; block: string; content: string }[] }
  | { kind: 'divergent'; reason: string };

export function planExternalBlockEdit(
  base: string,
  draft: string,
  block: string,
  projection: ExternalBlockProjection,
): ExternalPageEditPlan {
  return {
    kind: 'ready',
    edits: draft === base
      ? []
      : [{ kind: 'edit_block', block, content: projection.restore(draft) }],
  };
}

export type ExternalSessionStorage = {
  load(): ExternalSessionSnapshot | null;
  save(snapshot: ExternalSessionSnapshot): void;
};

export type StringStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Persistencia local para PWA y para el renderer de Desktop. */
export function browserExternalSessionStorage(
  storage: StringStorage,
  key = 'vera.external-editing.v1',
): ExternalSessionStorage {
  return {
    load() {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<ExternalSessionSnapshot>;
        if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) return null;
        return parsed as ExternalSessionSnapshot;
      } catch {
        // Un estado local roto no impide abrir Vera; se conserva el archivo de
        // trabajo en disco y la superficie puede ofrecer recuperación aparte.
        return null;
      }
    },
    save(snapshot) {
      storage.setItem(key, JSON.stringify(snapshot));
    },
  };
}

type TextEdit = {
  start: number;
  deleteCount: number;
  inserted: string[];
};

const targetKey = (device: string, target: ExternalEditTarget): string =>
  [device, target.graph, target.kind, target.page ?? '', target.block ?? ''].join('\u001f');

const terminal = (status: ExternalEditStatus): boolean =>
  status === 'accepted' || status === 'discarded';

const sameTarget = (left: ExternalEditTarget, right: ExternalEditTarget): boolean =>
  left.graph === right.graph
  && left.kind === right.kind
  && left.page === right.page
  && left.block === right.block;

/**
 * Extrae una única transformación contigua respecto de la base.
 *
 * Es deliberadamente conservadora: dos islas editadas por una misma mano se
 * tratan como un tramo mayor. Puede producir un falso conflicto, nunca una
 * combinación que mezcle intenciones solapadas.
 */
function contiguousEdit(base: readonly string[], changed: readonly string[]): TextEdit | null {
  if (base.length === changed.length && base.every((line, index) => line === changed[index])) {
    return null;
  }

  let prefix = 0;
  while (prefix < base.length && prefix < changed.length && base[prefix] === changed[prefix]) {
    prefix += 1;
  }

  let baseSuffix = base.length;
  let changedSuffix = changed.length;
  while (
    baseSuffix > prefix
    && changedSuffix > prefix
    && base[baseSuffix - 1] === changed[changedSuffix - 1]
  ) {
    baseSuffix -= 1;
    changedSuffix -= 1;
  }

  return {
    start: prefix,
    deleteCount: baseSuffix - prefix,
    inserted: changed.slice(prefix, changedSuffix),
  };
}

function editsCross(left: TextEdit, right: TextEdit): boolean {
  const leftEnd = left.start + left.deleteCount;
  const rightEnd = right.start + right.deleteCount;

  // Dos inserciones en el mismo límite expresan orden concurrente, no independencia.
  if (left.deleteCount === 0 && right.deleteCount === 0) return left.start === right.start;
  if (left.deleteCount === 0) return left.start >= right.start && left.start <= rightEnd;
  if (right.deleteCount === 0) return right.start >= left.start && right.start <= leftEnd;
  return left.start < rightEnd && right.start < leftEnd;
}

function applyEdits(base: readonly string[], edits: readonly TextEdit[]): string[] {
  const result = [...base];
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result.splice(edit.start, edit.deleteCount, ...edit.inserted);
  }
  return result;
}

/**
 * Concilia base, versión canónica y borrador externo.
 *
 * Sólo combina automáticamente cuando puede demostrar que los tramos no se
 * cruzan. «La versión más nueva» no aparece aquí: un reloj no conoce la intención.
 */
export function reconcileExternalText(
  base: string,
  canonical: string,
  external: string,
): ThreeWayResult {
  if (canonical === external) return { kind: 'unchanged', content: canonical };
  if (external === base) return { kind: 'canonical_only', content: canonical };
  if (canonical === base) return { kind: 'external_only', content: external };

  const baseLines = base.split('\n');
  const canonicalEdit = contiguousEdit(baseLines, canonical.split('\n'));
  const externalEdit = contiguousEdit(baseLines, external.split('\n'));

  if (canonicalEdit !== null && externalEdit !== null && !editsCross(canonicalEdit, externalEdit)) {
    return {
      kind: 'combined',
      content: applyEdits(baseLines, [canonicalEdit, externalEdit]).join('\n'),
    };
  }

  return {
    kind: 'divergent',
    divergence: { base, canonical, external },
  };
}

export function createExternalSessionStore(
  storage: ExternalSessionStorage,
  clock: () => number = Date.now,
  identify: () => string = () => crypto.randomUUID(),
): {
  sessions(): readonly ExternalEditSession[];
  open(input: {
    device: string;
    target: ExternalEditTarget;
    baseSequence: number;
    source: string;
    stableBlockIds?: string[];
  }): ExternalEditSession;
  save(id: string, draft: string): ExternalEditSession;
  advance(id: string, canonical: string, sequence: number): ExternalEditSession;
  requireAttention(id: string): ExternalEditSession;
  accept(id: string, currentSequence: number): ExternalEditSession;
  discard(id: string): ExternalEditSession;
} {
  const restored = storage.load();
  const held = new Map<string, ExternalEditSession>();
  for (const session of restored?.version === 1 ? restored.sessions : []) held.set(session.id, session);

  const persist = (): void => storage.save({ version: 1, sessions: [...held.values()] });
  const get = (id: string): ExternalEditSession => {
    const session = held.get(id);
    if (session === undefined) throw new Error(`Sesión externa desconocida: ${id}`);
    return session;
  };
  const replace = (session: ExternalEditSession): ExternalEditSession => {
    held.set(session.id, session);
    persist();
    return session;
  };

  return {
    sessions: () => [...held.values()],

    open(input) {
      const existing = [...held.values()].find((session) =>
        !terminal(session.status)
        && targetKey(session.device, session.target) === targetKey(input.device, input.target));
      if (existing !== undefined) return existing;

      const at = clock();
      return replace({
        id: identify(),
        device: input.device,
        target: input.target,
        manifest: {
          target: input.target,
          baseSequence: input.baseSequence,
          stableBlockIds: [...(input.stableBlockIds ?? [])],
        },
        base: input.source,
        canonical: input.source,
        draft: input.source,
        dirty: false,
        status: 'active',
        openedAt: at,
        updatedAt: at,
        divergence: null,
      });
    },

    save(id, draft) {
      const session = get(id);
      if (terminal(session.status)) throw new Error('La sesión externa ya está cerrada');
      const stillDivergent = session.divergence !== null;
      return replace({
        ...session,
        draft,
        dirty: draft !== session.canonical,
        status: stillDivergent
          ? 'attention_required'
          : draft === session.canonical ? 'active' : 'ready',
        updatedAt: clock(),
        divergence: session.divergence,
      });
    },

    advance(id, canonical, sequence) {
      const session = get(id);
      if (terminal(session.status)) throw new Error('La sesión externa ya está cerrada');
      if (sequence <= session.manifest.baseSequence) return session;

      const reconciled = reconcileExternalText(session.base, canonical, session.draft);
      if (reconciled.kind === 'divergent') {
        return replace({
          ...session,
          canonical,
          status: 'attention_required',
          updatedAt: clock(),
          divergence: reconciled.divergence,
        });
      }

      const content = reconciled.content;
      return replace({
        ...session,
        manifest: { ...session.manifest, baseSequence: sequence },
        base: canonical,
        canonical,
        draft: content,
        dirty: content !== canonical,
        status: content === canonical ? 'active' : 'ready',
        updatedAt: clock(),
        divergence: null,
      });
    },

    requireAttention(id) {
      const session = get(id);
      if (terminal(session.status)) throw new Error('La sesión externa ya está cerrada');
      return replace({ ...session, status: 'attention_required', updatedAt: clock() });
    },

    accept(id, currentSequence) {
      const session = get(id);
      if (session.status !== 'ready' || session.divergence !== null) {
        throw new Error('La sesión externa no está lista para aceptar');
      }
      if (currentSequence !== session.manifest.baseSequence) {
        return replace({ ...session, status: 'attention_required', updatedAt: clock() });
      }
      return replace({ ...session, status: 'accepted', updatedAt: clock() });
    },

    discard(id) {
      const session = get(id);
      if (terminal(session.status)) return session;
      return replace({ ...session, status: 'discarded', updatedAt: clock() });
    },
  };
}

export function targetsMatch(left: ExternalEditTarget, right: ExternalEditTarget): boolean {
  return sameTarget(left, right);
}

type ProjectedBlock = { depth: number; lines: string[] };

function projectedBlocks(source: string): { preamble: string[]; blocks: ProjectedBlock[] } | null {
  const lines = source.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n');
  const preamble: string[] = [];
  const blocks: ProjectedBlock[] = [];
  let current: ProjectedBlock | null = null;

  for (const line of lines) {
    const head = /^(\t*)- (.*)$/.exec(line);
    if (head !== null) {
      current = { depth: (head[1] ?? '').length, lines: [head[2] ?? ''] };
      blocks.push(current);
      continue;
    }
    if (current === null) {
      preamble.push(line);
      continue;
    }
    const continuation = `${'\t'.repeat(current.depth)}  `;
    if (!line.startsWith(continuation)) return null;
    current.lines.push(line.slice(continuation.length));
  }
  return { preamble, blocks };
}

/** Orden de la proyección: profundidad primero, hermanos por posición. */
function projectedOrder(blocks: readonly ExternalPageBlock[]): ExternalPageBlock[] | null {
  const children = new Map<string | null, ExternalPageBlock[]>();
  const known = new Set(blocks.map((block) => block.stableId));
  for (const block of blocks) {
    if (block.parent !== null && !known.has(block.parent)) return null;
    const siblings = children.get(block.parent) ?? [];
    siblings.push(block);
    children.set(block.parent, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) =>
      left.position - right.position || left.stableId.localeCompare(right.stableId));
  }

  const ordered: ExternalPageBlock[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null): void => {
    for (const block of children.get(parent) ?? []) {
      if (seen.has(block.stableId)) continue;
      seen.add(block.stableId);
      ordered.push(block);
      walk(block.stableId);
    }
  };
  walk(null);
  return ordered.length === blocks.length ? ordered : null;
}

export function externalPageBlockOrder(blocks: readonly ExternalPageBlock[]): string[] | null {
  return projectedOrder(blocks)?.map((block) => block.stableId) ?? null;
}

/**
 * Traduce una página Markdown aceptada al primer lote seguro de edición.
 *
 * Este corte sólo cambia el texto de bloques existentes. Estructura,
 * propiedades y número de bloques deben permanecer byte por byte; si no, el
 * cambio se lleva a conciliación en vez de adivinar identidades.
 */
export function planExternalPageEdits(
  baseMarkdown: string,
  externalMarkdown: string,
  pageBlocks: readonly ExternalPageBlock[],
): ExternalPageEditPlan {
  const base = projectedBlocks(baseMarkdown);
  const external = projectedBlocks(externalMarkdown);
  const ordered = projectedOrder(pageBlocks);
  if (base === null || external === null || ordered === null) {
    return { kind: 'divergent', reason: 'la estructura Markdown no se puede relacionar con el árbol de Vera' };
  }
  if (base.preamble.join('\n') !== external.preamble.join('\n')) {
    return { kind: 'divergent', reason: 'cambiaron propiedades de la página; este corte sólo acepta texto de bloques' };
  }
  if (base.blocks.length !== ordered.length || external.blocks.length !== ordered.length) {
    return { kind: 'divergent', reason: 'se agregaron o quitaron bloques; hace falta conciliar la estructura' };
  }

  const edits: { kind: 'edit_block'; block: string; content: string }[] = [];
  for (let at = 0; at < ordered.length; at += 1) {
    const block = ordered[at];
    const before = base.blocks[at];
    const after = external.blocks[at];
    if (block === undefined || before === undefined || after === undefined) {
      return { kind: 'divergent', reason: 'la correspondencia de bloques está incompleta' };
    }
    if (before.depth !== after.depth) {
      return { kind: 'divergent', reason: 'cambió la jerarquía de los bloques' };
    }

    const original = block.content.split('\n');
    if (!original.every((line, lineAt) => before.lines[lineAt] === line)) {
      return { kind: 'divergent', reason: `la base ya no corresponde a ${block.stableId}` };
    }
    const metadata = before.lines.slice(original.length);
    if (
      metadata.length > after.lines.length
      || metadata.some((line, offset) => after.lines[after.lines.length - metadata.length + offset] !== line)
    ) {
      return { kind: 'divergent', reason: `cambiaron propiedades de ${block.stableId}` };
    }
    const contentLines = metadata.length === 0 ? after.lines : after.lines.slice(0, -metadata.length);
    const content = contentLines.join('\n');
    if (content !== block.content) edits.push({ kind: 'edit_block', block: block.stableId, content });
  }
  return { kind: 'ready', edits };
}
