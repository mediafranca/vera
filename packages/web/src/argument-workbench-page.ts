// Cabecera de la preparación argumental.
//
// No reemplaza al outliner: hace visible en qué estado se encuentra el trabajo
// y deja debajo los bloques ordinarios, que siguen siendo la materia editable.

import {
  ARGUMENT_KIND,
  ARGUMENT_PREPARATION_PHASES,
  argumentMaturity,
  isArgumentWork,
  type ArgumentMaturity,
} from '@vera/core';
import type { PageView } from './api.ts';

const LABELS: Record<ArgumentMaturity, string> = {
  contexto: 'Contexto',
  estructura: 'Estructura',
  composición: 'Composición',
  validación: 'Validación',
  argumento: 'Argumento',
};

export function renderArgumentWorkbenchBand(
  page: PageView,
  kindKey: string,
  readOnly: boolean,
  choose: (phase: ArgumentMaturity | null) => Promise<boolean>,
): HTMLElement | null {
  if (!isArgumentWork(page.properties, kindKey)) return null;
  const current = argumentMaturity(page.properties, kindKey);
  const finished = current === ARGUMENT_KIND;

  const band = document.createElement('section');
  band.className = 'argument-workbench-band';
  band.setAttribute('aria-label', 'Mesa de trabajo argumental');

  const heading = document.createElement('div');
  heading.className = 'argument-workbench-heading';
  const what = document.createElement('span');
  what.className = 'argument-workbench-what';
  what.textContent = finished ? 'Argumento' : 'Mesa de trabajo';
  const explanation = document.createElement('span');
  explanation.className = 'argument-workbench-explanation';
  explanation.textContent = finished
    ? 'Estado publicable; puede reabrirse si algo vuelve a ponerse en cuestión.'
    : 'La materia aún puede reunirse, podarse y reordenarse.';
  heading.append(what, explanation);

  const maturity = document.createElement('label');
  maturity.className = 'argument-workbench-maturity';
  const label = document.createElement('span');
  label.textContent = 'Madurez';
  if (readOnly) {
    const value = document.createElement('span');
    value.className = 'argument-workbench-phase';
    value.textContent = current === null ? 'Sin declarar' : LABELS[current];
    maturity.append(label, value);
  } else {
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Madurez argumental');
    const undecided = document.createElement('option');
    undecided.value = '';
    undecided.textContent = 'Sin declarar';
    select.append(undecided);
    for (const phase of ARGUMENT_PREPARATION_PHASES) {
      const option = document.createElement('option');
      option.value = phase;
      option.textContent = LABELS[phase];
      select.append(option);
    }
    const publishable = document.createElement('option');
    publishable.value = ARGUMENT_KIND;
    publishable.textContent = LABELS[ARGUMENT_KIND];
    select.append(publishable);
    select.value = current ?? '';
    select.addEventListener('change', () => {
      const before = current ?? '';
      const next = select.value === '' ? null : select.value as ArgumentMaturity;
      select.disabled = true;
      void choose(next).then((saved) => {
        if (!saved) {
          select.value = before;
          select.disabled = false;
        }
      });
    });
    maturity.append(label, select);
  }

  band.append(heading, maturity);
  return band;
}
