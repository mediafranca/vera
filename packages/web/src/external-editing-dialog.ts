import { api, type PageView } from './api.ts';
import {
  browserExternalSessionStorage,
  createExternalSessionStore,
  externalPageBlockOrder,
  planExternalPageEdits,
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

export const canEditExternally = (): boolean => bridge() !== null;

const store = createExternalSessionStore(browserExternalSessionStorage(localStorage));
const pages = new Map<string, PageView>();
const dialogs = new Map<string, HTMLDialogElement>();
let listening = false;

const safeFileName = (title: string): string =>
  `${title.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'Página'}.md`;

async function pageMarkdown(page: string): Promise<string> {
  const response = await fetch(`/pages/${encodeURIComponent(page)}/markdown`);
  if (!response.ok) throw new Error(`el servidor respondió ${response.status}`);
  return response.text();
}

function draw(session: ExternalEditSession): void {
  const page = pages.get(session.id);
  if (page === undefined) return;
  const prior = dialogs.get(session.id);
  const dialog = prior ?? document.createElement('dialog');
  dialog.className = 'external-editing-dialog';
  dialog.dataset['session'] = session.id;
  dialog.innerHTML = '';

  const title = document.createElement('h2');
  title.textContent = `Edición externa · ${page.title}`;
  const status = document.createElement('p');
  status.className = 'external-editing-status';
  const plan = planExternalPageEdits(session.base, session.draft, page.blocks);
  const changed = plan.kind === 'ready' ? plan.edits.length : 0;
  status.textContent = plan.kind === 'divergent'
    ? `Requiere atención: ${plan.reason}`
    : changed === 0
      ? 'El editor puede guardar este archivo. Vera todavía no tiene cambios que aceptar.'
      : `${changed} ${changed === 1 ? 'bloque cambiado' : 'bloques cambiados'} · listo para aceptar como un lote.`;

  const actions = document.createElement('div');
  actions.className = 'external-editing-actions';
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
    pages.delete(session.id);
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
      pages.delete(session.id);
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
  if (desktop === null) {
    toast('la edición vinculada requiere Vera Desktop; en la PWA usa Descargar como .md');
    return;
  }
  listen();
  let source: string;
  try {
    source = await pageMarkdown(page.id);
  } catch {
    toast('no se pudo preparar el Markdown de la página');
    return;
  }
  const session = store.open({
    device: 'desktop',
    target: { graph, kind: 'page_markdown', page: page.id },
    baseSequence,
    source,
    stableBlockIds: externalPageBlockOrder(page.blocks) ?? page.blocks.map((block) => block.stableId),
  });
  pages.set(session.id, page);
  try {
    const opened = await desktop.open({
      sessionId: session.id,
      fileName: safeFileName(page.title),
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
