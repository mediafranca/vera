// El índice vivo de las páginas que gobiernan Vera.
//
// La página existe en el corpus y por eso puede enlazarse, citarse y leerse como
// cualquier otra. La lista no existe como bloques duplicados: se deriva de las
// declaraciones `special-kind` que también alimentan Configuración.
// @guarantee TheIndexIsDerivedAndFollowable
// @guarantee ConfigurationAndThePageReadTheSameDeclarations

import { api } from './api.ts';
import { GOVERNING_KINDS, kindSays } from './governing-table.ts';

export function isGovernancePage(
  properties: readonly { key: string; value: string }[],
): boolean {
  return properties.some(
    (one) => one.key === 'special-kind' && one.value.trim().toLowerCase() === 'governance',
  );
}

export async function renderGovernanceIndex(
  current: string,
  open: (title: string) => void,
): Promise<HTMLElement> {
  const special = await api.specialPages();
  const rank = (kind: string): number => {
    const at = GOVERNING_KINDS.findIndex((one) => one.key === kind);
    return at === -1 ? GOVERNING_KINDS.length : at;
  };
  special.sort((a, b) => rank(a.kind) - rank(b.kind) || a.title.localeCompare(b.title, 'es'));

  const section = document.createElement('section');
  section.className = 'governance-index';
  section.setAttribute('aria-label', 'Páginas de gobierno');

  const heading = document.createElement('h2');
  heading.textContent = 'Páginas de gobierno';
  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent = `${special.length} páginas declaradas. La lista se actualiza desde el corpus.`;
  const list = document.createElement('div');
  list.className = 'settings-destinations governance-index-list';

  for (const page of special) {
    const known = kindSays(page.kind);
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'settings-destination governance-index-item';
    item.disabled = page.id === current;

    const name = document.createElement('strong');
    name.textContent = page.title;
    const mode = document.createElement('small');
    mode.textContent = known?.mode ?? 'clase desconocida';
    const effect = document.createElement('span');
    effect.textContent = known?.what ?? `Clase de sistema no reconocida: ${page.kind}`;
    item.append(name, mode, effect);
    item.addEventListener('click', () => open(page.title));
    list.append(item);
  }

  section.append(heading, note, list);
  return section;
}
