// Cabecera del argumento mientras madura en la mesa de trabajo.
//
// No reemplaza al outliner: hace visible en qué estado se encuentra el trabajo
// y deja debajo los bloques ordinarios, que siguen siendo la materia editable.

import {
  ARGUMENT_MATURITY_KEY,
  argumentMaturity,
  isArgumentWork,
  type ArgumentMaturity,
} from '@vera/core';
import type { PageView } from './api.ts';

const labelOf = (value: string): string =>
  value === '' ? value : `${value[0]!.toLocaleUpperCase('es')}${value.slice(1)}`;

/** La escala, en el orden que `VERA: Propiedades` declara. */
export function governedArgumentMaturities(page: Pick<PageView, 'domains'>): string[] {
  return (page.domains[ARGUMENT_MATURITY_KEY] ?? [])
    .filter((one) => one.declared === true)
    .map((one) => one.value);
}

export function renderArgumentWorkbenchBand(
  page: PageView,
  kindKey: string,
  readOnly: boolean,
  choose: (phase: ArgumentMaturity | null) => Promise<boolean>,
): HTMLElement | null {
  if (!isArgumentWork(page.properties, kindKey)) return null;
  const phases = governedArgumentMaturities(page);
  const current = argumentMaturity(page.properties, kindKey, phases);
  const terminal = phases.at(-1) ?? null;
  const finished = terminal !== null && current?.toLocaleLowerCase('es') === terminal.toLocaleLowerCase('es');

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
  if (readOnly || phases.length === 0) {
    const value = document.createElement('span');
    value.className = 'argument-workbench-phase';
    value.textContent = current === null
      ? (phases.length === 0 ? 'Escala sin declarar' : 'Sin declarar')
      : labelOf(current);
    maturity.append(label, value);
  } else {
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Madurez argumental');
    const undecided = document.createElement('option');
    undecided.value = '';
    undecided.textContent = 'Sin declarar';
    select.append(undecided);
    for (const phase of phases) {
      const option = document.createElement('option');
      option.value = phase;
      option.textContent = labelOf(phase);
      select.append(option);
    }
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
