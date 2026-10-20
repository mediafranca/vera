/**
 * Puente local de las sesiones temporal-durables.
 *
 * Ver specs/external-editing.allium. Desktop custodia los archivos de trabajo y
 * observa sus guardados; no acepta cambios en el grafo. Esa decisión sigue en Vera.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs';
import { basename, join } from 'node:path';

export type DesktopExternalEditManifest = {
  version: 1;
  sessionId: string;
  target: {
    graph: string;
    kind: string;
    page?: string;
    block?: string;
  };
  baseSequence: number;
  stableBlockIds: string[];
  status: 'active' | 'accepted' | 'discarded';
};

export type DesktopExternalEditInput = {
  sessionId: string;
  fileName: string;
  content: string;
  manifest: DesktopExternalEditManifest;
};

export type DesktopExternalEditView = {
  sessionId: string;
  fileName: string;
  content: string;
  manifest: DesktopExternalEditManifest;
};

type Launch = (path: string) => Promise<void>;
type Changed = (sessionId: string, content: string) => void;

const safeSegment = (value: string, label: string): string => {
  if (!/^[a-zA-Z0-9._:-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error(`${label} no es seguro`);
  }
  return value;
};

const safeFileName = (value: string): string => {
  const name = basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  if (name === '' || name === '.' || name === '..') throw new Error('el nombre del archivo no es seguro');
  return name;
};

const atomicText = (path: string, content: string): void => {
  const temporary = `${path}.vera-tmp`;
  writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
};

export class DesktopExternalEditing {
  readonly #root: string;
  readonly #launch: Launch;
  readonly #changed: Changed;
  readonly #watchers = new Map<string, FSWatcher>();
  readonly #files = new Map<string, string>();
  readonly #debounce = new Map<string, NodeJS.Timeout>();

  constructor(root: string, launch: Launch, changed: Changed) {
    this.#root = root;
    this.#launch = launch;
    this.#changed = changed;
  }

  async open(input: DesktopExternalEditInput): Promise<DesktopExternalEditView> {
    const sessionId = safeSegment(input.sessionId, 'la sesión');
    if (input.manifest.sessionId !== sessionId || input.manifest.version !== 1) {
      throw new Error('el manifiesto no corresponde a la sesión');
    }
    const folder = join(this.#root, sessionId);
    const fileName = safeFileName(input.fileName);
    const source = join(folder, fileName);
    const manifestPath = join(folder, 'manifest.json');
    mkdirSync(folder, { recursive: true, mode: 0o700 });

    // Reabrir reanuda el borrador; nunca lo pisa con una proyección más nueva.
    if (!existsSync(source)) atomicText(source, input.content);
    atomicText(manifestPath, `${JSON.stringify(input.manifest, null, 2)}\n`);
    this.#files.set(sessionId, source);
    this.#observe(sessionId, folder, source);
    await this.#launch(source);
    return this.read(sessionId);
  }

  read(rawSessionId: string): DesktopExternalEditView {
    const sessionId = safeSegment(rawSessionId, 'la sesión');
    const folder = join(this.#root, sessionId);
    const manifestPath = join(folder, 'manifest.json');
    if (!existsSync(manifestPath)) throw new Error('la sesión externa no existe');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DesktopExternalEditManifest;
    if (manifest.version !== 1 || manifest.sessionId !== sessionId) {
      throw new Error('el manifiesto de la sesión no es válido');
    }
    const source = this.#files.get(sessionId) ?? this.#sourceIn(folder);
    this.#files.set(sessionId, source);
    return {
      sessionId,
      fileName: basename(source),
      content: readFileSync(source, 'utf8'),
      manifest,
    };
  }

  close(rawSessionId: string, status: 'accepted' | 'discarded'): DesktopExternalEditView {
    const current = this.read(rawSessionId);
    const folder = join(this.#root, current.sessionId);
    const manifest = { ...current.manifest, status };
    atomicText(join(folder, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    this.#stop(current.sessionId);
    return { ...current, manifest };
  }

  stopAll(): void {
    for (const sessionId of [...this.#watchers.keys()]) this.#stop(sessionId);
  }

  #sourceIn(folder: string): string {
    const manifest = join(folder, 'manifest.json');
    // El nombre se recupera de la única fuente que no es el manifiesto. Los
    // temporales atómicos se excluyen para no observar una escritura a medias.
    const names = readdirSync(folder).filter((name) =>
      join(folder, name) !== manifest && !name.endsWith('.vera-tmp'));
    if (names.length !== 1 || names[0] === undefined) {
      throw new Error('la sesión externa no tiene una única fuente legible');
    }
    return join(folder, names[0]);
  }

  #observe(sessionId: string, folder: string, source: string): void {
    if (this.#watchers.has(sessionId)) return;
    const watcher = watch(folder, (_event, changedName) => {
      if (changedName !== basename(source) || !existsSync(source)) return;
      const previous = this.#debounce.get(sessionId);
      if (previous !== undefined) clearTimeout(previous);
      const timer = setTimeout(() => {
        this.#debounce.delete(sessionId);
        try {
          this.#changed(sessionId, readFileSync(source, 'utf8'));
        } catch {
          // Un reemplazo atómico puede dejar un intervalo mínimo sin archivo.
          // El siguiente evento vuelve a intentarlo; nunca se anuncia texto parcial.
        }
      }, 60);
      timer.unref();
      this.#debounce.set(sessionId, timer);
    });
    this.#watchers.set(sessionId, watcher);
  }

  #stop(sessionId: string): void {
    this.#watchers.get(sessionId)?.close();
    this.#watchers.delete(sessionId);
    const timer = this.#debounce.get(sessionId);
    if (timer !== undefined) clearTimeout(timer);
    this.#debounce.delete(sessionId);
  }
}
