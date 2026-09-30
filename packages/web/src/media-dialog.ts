import { api } from './api.ts';

export interface MediaDetails {
  url: string;
  path: string;
  mediaType: string;
  description?: string | null;
  alternativeText?: string | null;
  originalName?: string | null;
  usages?: { block: string; page: string; pageTitle: string }[];
}

/** La ficha permite mirar el archivo, describirlo y volver al contexto anterior. */
export function openMediaDetails(asset: MediaDetails): void {
  const hash = asset.url.split('/').pop() ?? '';
  if (hash === '') return;
  const dialog = document.createElement('dialog');
  dialog.className = 'media-metadata';
  const form = document.createElement('form');
  form.method = 'dialog';

  const head = document.createElement('header');
  head.className = 'media-metadata-head';
  const heading = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = 'Archivo';
  const filename = document.createElement('p');
  filename.className = 'media-metadata-filename';
  filename.textContent = asset.originalName ?? asset.path.split('/').pop() ?? 'Archivo';
  heading.append(title, filename);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'media-metadata-close';
  close.setAttribute('aria-label', 'Cerrar y volver');
  close.textContent = '×';
  close.addEventListener('click', () => dialog.close());
  head.append(heading, close);

  const preview = document.createElement('div');
  preview.className = 'media-detail-preview';
  if (asset.mediaType.startsWith('image/')) {
    const image = document.createElement('img');
    image.src = asset.url;
    image.alt = asset.alternativeText ?? '';
    preview.append(image);
  } else if (asset.mediaType.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = asset.url;
    audio.controls = true;
    preview.append(audio);
  } else if (asset.mediaType === 'application/pdf') {
    const frame = document.createElement('iframe');
    frame.src = asset.url;
    frame.title = filename.textContent;
    preview.append(frame);
  }

  const descriptionLabel = document.createElement('label');
  descriptionLabel.textContent = 'Descríbelo';
  const description = document.createElement('textarea');
  description.value = asset.description ?? '';
  description.rows = 4;
  description.placeholder = 'Qué contiene o por qué importa; se usa para buscarlo';
  descriptionLabel.append(description);
  const altLabel = document.createElement('label');
  altLabel.textContent = 'Texto alternativo';
  const alternativeText = document.createElement('textarea');
  alternativeText.value = asset.alternativeText ?? '';
  alternativeText.rows = 3;
  alternativeText.placeholder = 'Descripción breve de lo visible para quien no ve la imagen';
  altLabel.append(alternativeText);
  altLabel.hidden = !asset.mediaType.startsWith('image/');

  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Nombre del archivo';
  const name = document.createElement('input');
  name.type = 'text';
  name.value = asset.originalName ?? asset.path.split('/').pop() ?? '';
  name.autocomplete = 'off';
  nameLabel.append(name);

  const replacement = document.createElement('input');
  replacement.type = 'file';
  replacement.hidden = true;
  replacement.accept = asset.mediaType.startsWith('image/')
    ? 'image/*'
    : asset.mediaType.startsWith('audio/')
      ? 'audio/*'
      : 'application/pdf';

  const actions = document.createElement('div');
  actions.className = 'media-metadata-actions';
  const open = document.createElement('a');
  open.href = asset.url;
  open.target = '_blank';
  open.rel = 'noopener';
  open.textContent = 'Abrir aparte';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Volver';
  cancel.addEventListener('click', () => dialog.close());
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'media-metadata-delete';
  remove.textContent = 'Eliminar';
  remove.addEventListener('click', async () => {
    let usages = asset.usages;
    if (usages === undefined) {
      try {
        usages = (await api.media()).find((file) => file.hash === hash)?.usages ?? [];
      } catch {
        usages = [];
      }
    }
    const scope = usages.length === 0
      ? 'No está incrustado en ninguna página.'
      : `También desaparecerá de ${usages.length} ${usages.length === 1 ? 'bloque' : 'bloques'}.`;
    if (!window.confirm(`¿Eliminar definitivamente «${name.value || filename.textContent}»?\n\n${scope}`)) return;
    remove.disabled = true;
    const result = await api.deleteMedia(hash);
    if ('error' in result) {
      remove.disabled = false;
      remove.textContent = result.error;
      return;
    }
    dialog.close();
    window.location.reload();
  });
  const replace = document.createElement('button');
  replace.type = 'button';
  replace.textContent = 'Reemplazar';
  replace.addEventListener('click', () => replacement.click());
  replacement.addEventListener('change', async () => {
    const file = replacement.files?.[0];
    if (file === undefined) return;
    replace.disabled = true;
    replace.textContent = 'Reemplazando…';
    const result = await api.replaceMedia(hash, file);
    if ('error' in result) {
      replace.disabled = false;
      replace.textContent = result.error;
      replacement.value = '';
      return;
    }
    dialog.close();
    window.location.reload();
  });
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Guardar';
  actions.append(open, remove, replace, cancel, save);
  form.append(head, preview, nameLabel, descriptionLabel, altLabel, replacement, actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    const currentName = asset.originalName ?? asset.path.split('/').pop() ?? '';
    if (name.value.trim() !== currentName) {
      const renamed = await api.renameMedia(hash, name.value);
      if ('error' in renamed) {
        save.disabled = false;
        save.textContent = renamed.error;
        return;
      }
      asset.path = renamed.path;
      asset.originalName = renamed.originalName;
      filename.textContent = renamed.originalName ?? renamed.path.split('/').pop() ?? 'Archivo';
    }
    const result = await api.describeMedia(hash, {
      description: description.value,
      alternativeText: alternativeText.value,
    });
    if ('error' in result) {
      save.disabled = false;
      save.textContent = result.error;
      return;
    }
    asset.description = result.description;
    asset.alternativeText = result.alternativeText;
    dialog.close();
    if (name.value.trim() !== currentName) window.location.reload();
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  description.focus();
}
