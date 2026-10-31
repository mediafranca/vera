import { api } from './api.ts';

const ACCEPTED = '.md,.markdown,.txt,.docx,.pdf,.rtf,text/markdown,text/plain,application/pdf,application/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type Preview = {
  filename: string;
  title: string;
  blocks: number;
  format: string;
  losses: string[];
  excerpt: string;
};

type Candidate = {
  file: File;
  preview: Preview | null;
  error: string | null;
  title: HTMLInputElement;
  author: HTMLInputElement;
  date: HTMLInputElement;
  tags: HTMLInputElement;
  state: HTMLElement;
};

export interface DocumentImportDialogOptions {
  sharedSpace?: { slug: string; name: string } | null;
  onOpen(title: string): void;
}

const field = (label: string, input: HTMLInputElement): HTMLLabelElement => {
  const wrapped = document.createElement('label');
  const named = document.createElement('span'); named.textContent = label;
  wrapped.append(named, input);
  return wrapped;
};

const compatible = (file: File): boolean =>
  /\.(?:md|markdown|txt|docx|pdf|rtf)$/i.test(file.name);

const defaultDate = (file: File): string => {
  if (!Number.isFinite(file.lastModified) || file.lastModified <= 0) return '';
  return new Date(file.lastModified).toISOString().slice(0, 10);
};

/**
 * Prepara varios documentos antes de escribir uno solo.
 *
 * La lectura ocurre al elegir; la escritura empieza únicamente al confirmar el
 * resumen. Cada documento conserva su fila durante la sincronización para que
 * un fallo no borre qué archivo fue ni obligue a repetir los demás.
 */
export function openDocumentImportDialog(options: DocumentImportDialogOptions): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'document-import-dialog';
  const form = document.createElement('form'); form.method = 'dialog';
  const head = document.createElement('header');
  const title = document.createElement('h2'); title.textContent = 'Importar documentos';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'dialog-close'; close.textContent = 'Cerrar';
  close.addEventListener('click', () => dialog.close());
  head.append(title, close);
  const intro = document.createElement('p');
  intro.textContent = options.sharedSpace === null || options.sharedSpace === undefined
    ? 'Cada archivo se convertirá en una página privada y conservará su original.'
    : `Cada página quedará dentro de «${options.sharedSpace.name}» y será visible para sus participantes.`;

  const provenance = document.createElement('fieldset');
  const provenanceLegend = document.createElement('legend'); provenanceLegend.textContent = 'Procedencia del lote';
  const own = document.createElement('input'); own.type = 'radio'; own.name = 'document-provenance'; own.value = 'own'; own.checked = true;
  const ownLabel = document.createElement('label'); ownLabel.append(own, ' Documentos propios');
  const external = document.createElement('input'); external.type = 'radio'; external.name = 'document-provenance'; external.value = 'external';
  const externalLabel = document.createElement('label'); externalLabel.append(external, ' Fuentes de otras personas');
  provenance.append(provenanceLegend, ownLabel, externalLabel);

  const common = document.createElement('section'); common.className = 'document-import-common';
  const commonTitle = document.createElement('h3'); commonTitle.textContent = 'Datos comunes';
  const commonAuthor = document.createElement('input'); commonAuthor.type = 'text'; commonAuthor.placeholder = 'Autor o autora'; commonAuthor.disabled = true;
  const commonDate = document.createElement('input'); commonDate.type = 'date';
  const commonTags = document.createElement('input'); commonTags.type = 'text'; commonTags.placeholder = 'etiqueta, otra etiqueta';
  const applyCommon = document.createElement('button'); applyCommon.type = 'button'; applyCommon.textContent = 'Aplicar al lote';
  common.append(commonTitle, field('Autoría', commonAuthor), field('Fecha', commonDate), field('Etiquetas', commonTags), applyCommon);

  const pickers = document.createElement('div'); pickers.className = 'document-import-pickers';
  const filesButton = document.createElement('button'); filesButton.type = 'button'; filesButton.textContent = 'Elegir archivos';
  const folderButton = document.createElement('button'); folderButton.type = 'button'; folderButton.textContent = 'Elegir carpeta';
  const filesInput = document.createElement('input'); filesInput.type = 'file'; filesInput.multiple = true; filesInput.accept = ACCEPTED; filesInput.hidden = true;
  const folderInput = document.createElement('input'); folderInput.type = 'file'; folderInput.multiple = true; folderInput.accept = ACCEPTED; folderInput.hidden = true;
  folderInput.setAttribute('webkitdirectory', '');
  pickers.append(filesButton, folderButton, filesInput, folderInput);

  const drop = document.createElement('div'); drop.className = 'document-import-drop'; drop.tabIndex = 0;
  drop.textContent = 'Arrastra aquí documentos o una carpeta';
  const summary = document.createElement('p'); summary.className = 'document-import-summary'; summary.setAttribute('aria-live', 'polite');
  summary.textContent = 'Todavía no hay documentos preparados.';
  const scroll = document.createElement('div'); scroll.className = 'document-import-table-scroll';
  const table = document.createElement('table'); table.className = 'document-import-table';
  table.innerHTML = '<thead><tr><th>Documento</th><th>Título de página</th><th>Autoría</th><th>Fecha</th><th>Etiquetas</th><th>Estado</th></tr></thead>';
  const rows = document.createElement('tbody'); table.append(rows); scroll.append(table);

  const actions = document.createElement('div'); actions.className = 'dialog-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancelar'; cancel.addEventListener('click', () => dialog.close());
  const commit = document.createElement('button'); commit.type = 'button'; commit.className = 'dialog-primary-action'; commit.textContent = 'Importar'; commit.disabled = true;
  actions.append(cancel, commit);
  form.append(head, intro, provenance, common, pickers, drop, summary, scroll, actions);
  dialog.append(form); document.body.append(dialog);

  const candidates: Candidate[] = [];
  const provenanceValue = (): 'own' | 'external' => external.checked ? 'external' : 'own';
  const updateAuthorMode = (): void => {
    const ownDocuments = provenanceValue() === 'own';
    commonAuthor.disabled = ownDocuments;
    commonAuthor.placeholder = ownDocuments ? 'Quien importa' : 'Autor o autora';
    for (const candidate of candidates) {
      candidate.author.disabled = ownDocuments;
      candidate.author.placeholder = ownDocuments ? 'Quien importa' : 'Autor o autora';
    }
  };
  const updateSummary = (): void => {
    const ready = candidates.filter((candidate) => candidate.preview !== null && candidate.error === null);
    const invalidExternal = provenanceValue() === 'external' && ready.some((candidate) => candidate.author.value.trim() === '');
    summary.textContent = candidates.length === 0
      ? 'Todavía no hay documentos preparados.'
      : `${ready.length} ${ready.length === 1 ? 'página' : 'páginas'} y ${ready.length} ${ready.length === 1 ? 'adjunto' : 'adjuntos'} preparados` +
        (candidates.length > ready.length ? ` · ${candidates.length - ready.length} con problemas` : '') +
        (invalidExternal ? ' · falta autoría en fuentes externas' : '');
    commit.disabled = ready.length === 0 || invalidExternal;
  };

  const updateProvenance = (): void => {
    updateAuthorMode();
    updateSummary();
  };
  own.addEventListener('change', updateProvenance);
  external.addEventListener('change', updateProvenance);

  const addFiles = (incoming: FileList | File[]): void => {
    const known = new Set(candidates.map((candidate) => `${candidate.file.name}:${candidate.file.size}:${candidate.file.lastModified}`));
    for (const file of Array.from(incoming).filter(compatible)) {
      const identity = `${file.name}:${file.size}:${file.lastModified}`;
      if (known.has(identity)) continue;
      known.add(identity);
      const row = document.createElement('tr');
      const named = document.createElement('td');
      const fileName = document.createElement('strong'); fileName.textContent = file.name;
      const facts = document.createElement('small'); facts.textContent = `${Math.max(1, Math.round(file.size / 1024))} KB`;
      named.append(fileName, facts);
      const titleInput = document.createElement('input'); titleInput.type = 'text'; titleInput.value = file.name.replace(/\.[^.]+$/, '');
      const authorInput = document.createElement('input'); authorInput.type = 'text'; authorInput.disabled = provenanceValue() === 'own'; authorInput.placeholder = authorInput.disabled ? 'Quien importa' : 'Autor o autora';
      const dateInput = document.createElement('input'); dateInput.type = 'date'; dateInput.value = defaultDate(file);
      const tagsInput = document.createElement('input'); tagsInput.type = 'text'; tagsInput.placeholder = 'etiquetas';
      const state = document.createElement('td'); state.textContent = 'Leyendo…';
      for (const input of [titleInput, authorInput, dateInput, tagsInput]) input.addEventListener('input', updateSummary);
      const candidate: Candidate = { file, preview: null, error: null, title: titleInput, author: authorInput, date: dateInput, tags: tagsInput, state };
      candidates.push(candidate);
      const titleCell = document.createElement('td'); titleCell.append(titleInput);
      const authorCell = document.createElement('td'); authorCell.append(authorInput);
      const dateCell = document.createElement('td'); dateCell.append(dateInput);
      const tagsCell = document.createElement('td'); tagsCell.append(tagsInput);
      row.append(named, titleCell, authorCell, dateCell, tagsCell, state); rows.append(row);
      void api.previewDocument(file).then((preview) => {
        if ('error' in preview) {
          candidate.error = preview.error; state.textContent = preview.error; state.dataset['bad'] = 'true';
        } else {
          candidate.preview = preview;
          candidate.title.value = preview.title;
          state.textContent = `${preview.format.toUpperCase()} · ${preview.blocks} bloques` +
            (preview.losses.length === 0 ? '' : ` · ${preview.losses.join('; ')}`);
          state.title = preview.excerpt;
        }
        updateSummary();
      });
    }
    updateSummary();
  };

  applyCommon.addEventListener('click', () => {
    for (const candidate of candidates) {
      if (provenanceValue() === 'external' && commonAuthor.value.trim() !== '') candidate.author.value = commonAuthor.value.trim();
      if (commonDate.value !== '') candidate.date.value = commonDate.value;
      if (commonTags.value.trim() !== '') candidate.tags.value = commonTags.value.trim();
    }
    updateSummary();
  });
  filesButton.addEventListener('click', () => filesInput.click());
  folderButton.addEventListener('click', () => folderInput.click());
  filesInput.addEventListener('change', () => { if (filesInput.files !== null) addFiles(filesInput.files); });
  folderInput.addEventListener('change', () => { if (folderInput.files !== null) addFiles(folderInput.files); });
  for (const event of ['dragenter', 'dragover']) drop.addEventListener(event, (value) => { value.preventDefault(); drop.dataset['over'] = 'true'; });
  for (const event of ['dragleave', 'drop']) drop.addEventListener(event, (value) => { value.preventDefault(); delete drop.dataset['over']; });
  drop.addEventListener('drop', (event) => { if (event.dataTransfer?.files !== undefined) addFiles(event.dataTransfer.files); });

  commit.addEventListener('click', () => void (async () => {
    commit.disabled = true; cancel.disabled = true;
    const ready = candidates.filter((candidate) => candidate.preview !== null && candidate.error === null);
    let imported = 0;
    for (const candidate of ready) {
      candidate.state.textContent = 'Importando…'; delete candidate.state.dataset['bad'];
      const result = await api.importDocument(candidate.file, {
        title: candidate.title.value.trim(), provenance: provenanceValue(),
        author: candidate.author.value.trim(), date: candidate.date.value, tags: candidate.tags.value.trim(),
      });
      if ('error' in result) {
        candidate.error = result.error; candidate.state.textContent = result.error; candidate.state.dataset['bad'] = 'true';
      } else {
        imported += 1;
        const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Abrir';
        open.addEventListener('click', () => { dialog.close(); options.onOpen(result.title); });
        candidate.state.replaceChildren(document.createTextNode('Importado · '), open);
      }
    }
    summary.textContent = `${imported} ${imported === 1 ? 'página importada' : 'páginas importadas'}` +
      (options.sharedSpace === null || options.sharedSpace === undefined ? '' : ` en «${options.sharedSpace.name}»`);
    cancel.disabled = false; cancel.textContent = 'Cerrar';
    commit.textContent = 'Importación terminada'; commit.disabled = true;
  })());

  dialog.addEventListener('close', () => dialog.remove());
  updateAuthorMode(); dialog.showModal(); filesButton.focus();
}
