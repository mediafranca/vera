import { api, type BlockView, type PageView } from './api.ts';
import {
  browserExternalSessionStorage,
  createExternalSessionStore,
  externalPageBlockOrder,
  planExternalBlockEdit,
  planExternalPageEdits,
  projectExternalBlock,
  type ExternalBlockProjection,
  type ExternalEditSession,
} from './external-editing.ts';
import { systemNotice as toast } from './system-notice.ts';

type DesktopExternalEditingBridge = {
  open(input: {
    sessionId: string;
    fileName: string;
    content: string;
    manifest: {
      version: 1;
      sessionId: string;
      target: { graph: string; kind: string; page?: string; block?: string };
      baseSequence: number;
      stableBlockIds: string[];
      status: 'active' | 'ready' | 'attention_required';
    };
  }): Promise<{ sessionId: string; content: string }>;
  close(sessionId: string, status: 'accepted' | 'discarded'): Promise<unknown>;
  onChanged(listener: (change: { sessionId: string; content: string }) => void): void;
};

const bridge = (): DesktopExternalEditingBridge | null =>
  (window as unknown as { veraExternalEditing?: DesktopExternalEditingBridge }).veraExternalEditing ?? null;

const store = createExternalSessionStore(browserExternalSessionStorage(localStorage));
type ReviewSubject =
  | { kind: 'page'; page: PageView; fileName: string }
  | { kind: 'block'; page: PageView; block: BlockView; projection: ExternalBlockProjection; fileName: string };

const subjects = new Map<string, ReviewSubject>();
const dialogs = new Map<string, HTMLDialogElement>();
let listening = false;

const safeFileName = (title: string): string =>
  `${title.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'Página'}.md`;

function downloadWorkingFile(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

async function pageMarkdown(page: string): Promise<string> {
  const response = await fetch(`/pages/${encodeURIComponent(page)}/markdown`);
  if (!response.ok) throw new Error(`el servidor respondió ${response.status}`);
  return response.text();
}

function draw(session: ExternalEditSession): void {
  const subject = subjects.get(session.id);
  if (subject === undefined) return;
  const page = subject.page;
  const prior = dialogs.get(session.id);
  const dialog = prior ?? document.createElement('dialog');
  dialog.className = 'external-editing-dialog';
  dialog.dataset['session'] = session.id;
  dialog.innerHTML = '';

  const title = document.createElement('h2');
  title.textContent = subject.kind === 'page'
    ? `Edición externa · ${page.title}`
    : `Edición externa · bloque de ${page.title}`;
  const status = document.createElement('p');
  status.className = 'external-editing-status';
  const plan = subject.kind === 'page'
    ? planExternalPageEdits(session.base, session.draft, page.blocks)
    : planExternalBlockEdit(
        session.base,
        session.draft,
        subject.block.stableId,
        subject.projection,
      );
  const changed = plan.kind === 'ready' ? plan.edits.length : 0;
  status.textContent = plan.kind === 'divergent'
    ? `Requiere atención: ${plan.reason}`
    : changed === 0
      ? 'El editor puede guardar este archivo. Vera todavía no tiene cambios que aceptar.'
      : `${changed} ${changed === 1 ? 'bloque cambiado' : 'bloques cambiados'} · listo para aceptar como un lote.`;

  const actions = document.createElement('div');
  actions.className = 'external-editing-actions';
  if (bridge() === null) {
    const download = document.createElement('button');
    download.type = 'button';
    download.textContent = 'Descargar borrador';
    download.onclick = () => downloadWorkingFile(subject.fileName, session.draft);
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    const importResult = document.createElement('button');
    importResult.type = 'button';
    importResult.textContent = 'Importar resultado';
    importResult.onclick = () => input.click();
    input.onchange = () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      void file.text().then((content) => draw(store.save(session.id, content))).catch(() => {
        toast('no se pudo leer el archivo editado');
      });
    };
    actions.append(download, importResult, input);
  }
  const later = document.createElement('button');
  later.type = 'button';
  later.textContent = 'Cerrar por ahora';
  later.onclick = () => dialog.close();
  const discard = document.createElement('button');
  discard.type = 'button';
  discard.textContent = 'Descartar sesión';
  discard.onclick = () => {
    store.discard(session.id);
    void bridge()?.close(session.id, 'discarded');
    dialog.close();
    dialogs.delete(session.id);
    subjects.delete(session.id);
    toast('edición externa descartada; el archivo quedó conservado');
  };
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'external-editing-accept';
  accept.textContent = 'Aceptar cambios';
  accept.disabled = plan.kind !== 'ready' || plan.edits.length === 0 || session.status === 'attention_required';
  accept.onclick = () => {
    if (plan.kind !== 'ready' || plan.edits.length === 0) return;
    accept.disabled = true;
    status.textContent = 'Aceptando el lote…';
    void api.submitCanonicalBatch(
      plan.edits.map((change) => ({ change })),
      session.manifest.baseSequence,
    ).then((result) => {
      if (result.status === 'rejected') {
        store.requireAttention(session.id);
        status.textContent = `Requiere atención: ${result.reason}`;
        toast('Vera cambió: hay que conciliar antes de aceptar');
        return;
      }
      store.accept(session.id, session.manifest.baseSequence);
      void bridge()?.close(session.id, 'accepted');
      dialog.close();
      dialogs.delete(session.id);
      subjects.delete(session.id);
      toast(`aceptados ${plan.edits.length} cambios como un solo lote`);
      window.dispatchEvent(new CustomEvent('vera:external-editing-accepted', {
        detail: { page: page.id },
      }));
    }).catch(() => {
      status.textContent = 'No se pudo aceptar: Vera no respondió. La sesión sigue guardada.';
      accept.disabled = false;
    });
  };
  actions.append(later, discard, accept);
  dialog.append(title, status, actions);
  if (prior === undefined) {
    document.body.append(dialog);
    dialogs.set(session.id, dialog);
  }
  if (!dialog.open) dialog.showModal();
}

function listen(): void {
  if (listening) return;
  listening = true;
  bridge()?.onChanged((change) => {
    try {
      const session = store.save(change.sessionId, change.content);
      draw(session);
    } catch {
      // Un editor puede emitir el último evento después del cierre explícito.
    }
  });
}

export async function editPageExternally(
  page: PageView,
  graph: string,
  baseSequence: number,
): Promise<void> {
  const desktop = bridge();
  listen();
  let source: string;
  try {
    source = await pageMarkdown(page.id);
  } catch {
    toast('no se pudo preparar el Markdown de la página');
    return;
  }
  const session = store.open({
    device: desktop === null ? 'pwa' : 'desktop',
    target: { graph, kind: 'page_markdown', page: page.id },
    baseSequence,
    source,
    stableBlockIds: externalPageBlockOrder(page.blocks) ?? page.blocks.map((block) => block.stableId),
  });
  const fileName = safeFileName(page.title);
  subjects.set(session.id, { kind: 'page', page, fileName });
  if (desktop === null) {
    downloadWorkingFile(fileName, session.draft);
    draw(session);
    toast('borrador descargado; importa aquí el resultado cuando termines');
    return;
  }
  try {
    const opened = await desktop.open({
      sessionId: session.id,
      fileName,
      content: session.draft,
      manifest: {
        version: 1,
        sessionId: session.id,
        target: session.target,
        baseSequence: session.manifest.baseSequence,
        stableBlockIds: session.manifest.stableBlockIds,
        status: session.status === 'accepted' || session.status === 'discarded' ? 'active' : session.status,
      },
    });
    draw(opened.content === session.draft ? session : store.save(session.id, opened.content));
  } catch (error) {
    toast(`no se pudo abrir el editor externo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function editBlockExternally(
  page: PageView,
  block: BlockView,
  graph: string,
  baseSequence: number,
): Promise<void> {
  const desktop = bridge();
  listen();
  const projection = projectExternalBlock(block.content);
  const session = store.open({
    device: desktop === null ? 'pwa' : 'desktop',
    target: { graph, kind: projection.kind, block: block.stableId },
    baseSequence,
    source: projection.source,
    stableBlockIds: [block.stableId],
  });
  const shortId = block.stableId.replace(/^block:/, '').slice(0, 12) || 'bloque';
  const fileName = `${safeFileName(page.title).replace(/\.md$/i, '')} — ${shortId}.${projection.extension}`;
  subjects.set(session.id, { kind: 'block', page, block, projection, fileName });
  if (desktop === null) {
    downloadWorkingFile(fileName, session.draft);
    draw(session);
    toast('borrador descargado; importa aquí el resultado cuando termines');
    return;
  }
  try {
    const opened = await desktop.open({
      sessionId: session.id,
      fileName,
      content: session.draft,
      manifest: {
        version: 1,
        sessionId: session.id,
        target: session.target,
        baseSequence: session.manifest.baseSequence,
        stableBlockIds: session.manifest.stableBlockIds,
        status: session.status === 'accepted' || session.status === 'discarded' ? 'active' : session.status,
      },
    });
    draw(opened.content === session.draft ? session : store.save(session.id, opened.content));
  } catch (error) {
    toast(`no se pudo abrir el editor externo: ${error instanceof Error ? error.message : String(error)}`);
  }
}
