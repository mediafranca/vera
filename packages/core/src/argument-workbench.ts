// La preparación argumental: la página donde una posición todavía se reúne,
// ordena, compone y contrasta antes de poder llamarse argumento.
//
// El tipo nombra la cosa; «Mesa de trabajo» nombra la superficie donde se la
// manipula. Mantenerlos separados evita que una actividad de interfaz se vuelva
// accidentalmente una clase del corpus. Ver specs/argument-workbench.allium.

import type { PropertyAssignment } from './types.ts';

/** El tipo canónico de una página de preparación. */
export const ARGUMENT_PREPARATION_KIND = 'preparación argumental';

/** La propiedad explícita —y por tanto histórica— que declara su madurez. */
export const ARGUMENT_MATURITY_KEY = 'madurez argumental';

/**
 * Los estados que pertenecen todavía a la preparación.
 *
 * `argumento` no entra aquí: no es una quinta etiqueta de la mesa sino el
 * producto publicable. Falta decidir si llegar a él transforma esta página o
 * produce otra, y la interfaz no debe resolver esa ontología por accidente.
 */
export const ARGUMENT_PREPARATION_PHASES = [
  'contexto',
  'estructura',
  'composición',
  'validación',
] as const;

export type ArgumentPreparationPhase = (typeof ARGUMENT_PREPARATION_PHASES)[number];

export function argumentPreparationPhase(
  properties: readonly Pick<PropertyAssignment, 'key' | 'value'>[],
): ArgumentPreparationPhase | null {
  const raw = properties.find((one) => one.key === ARGUMENT_MATURITY_KEY)?.value.trim().toLowerCase();
  return ARGUMENT_PREPARATION_PHASES.find((phase) => phase === raw) ?? null;
}

export function isArgumentPreparation(
  properties: readonly Pick<PropertyAssignment, 'key' | 'value'>[],
  kindKey = 'tipo',
): boolean {
  return properties.some((one) =>
    one.key === kindKey && one.value.trim().toLowerCase() === ARGUMENT_PREPARATION_KIND);
}
