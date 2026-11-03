// La administración de todas las formas de compartir, dentro de
// VERA:Publicación.
//
// La página especial y Configuración → Compartir son dos entradas a una sola
// administración. El componente vive en settings.ts para impedir que una
// entrada avance mientras la otra conserva una versión parcial del gobierno.

import { drawPageDestinationBadges, drawPageSharing, drawSharing } from './settings.ts';

export function isPublicationPage(
  properties: readonly { key: string; value: string }[],
): boolean {
  return properties.some(
    (one) => one.key === 'special-kind' && one.value.trim().toLowerCase() === 'publication',
  );
}

/** Dibuja el gobierno público y autenticado que Vera comparte. */
export async function renderPublicationPage(): Promise<HTMLElement> {
  const panel = document.createElement('section');
  panel.className = 'publication-page settings-sharing';
  await drawSharing(panel);
  return panel;
}

export async function renderPageSharing(page: string, title: string,
  onChange?: () => void): Promise<HTMLDialogElement> {
  document.querySelector<HTMLDialogElement>('.page-sharing[open]')?.close();
  const dialog = document.createElement('dialog');
  dialog.className = 'page-sharing settings-sharing';
  dialog.setAttribute('aria-label', `Compartir · ${title}`);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  void drawPageSharing(dialog, page, title, onChange);
  return dialog;
}

export { drawPageDestinationBadges };
