// La preparación argumental: la página donde una posición todavía se reúne,
// ordena, compone y contrasta antes de poder llamarse argumento.
//
// El tipo nombra la cosa; «Mesa de trabajo» nombra la superficie donde se la
// manipula. Mantenerlos separados evita que una actividad de interfaz se vuelva
// accidentalmente una clase del corpus. Ver specs/argument-workbench.allium.

import type { PageId, PropertyAssignment } from './types.ts';

/** El tipo canónico de una página de preparación. */
export const ARGUMENT_PREPARATION_KIND = 'preparación argumental';

/** El tipo canónico que declara que la misma obra ya es publicable. */
export const ARGUMENT_KIND = 'argumento';

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
export type ArgumentMaturity = ArgumentPreparationPhase | typeof ARGUMENT_KIND;
export type ArgumentMaturityChange =
  | {
      readonly kind: 'set_property'; readonly page: PageId;
      readonly propertyKey: string; readonly propertyValue: string;
    }
  | {
      readonly kind: 'remove_property'; readonly page: PageId;
      readonly propertyKey: string;
    };

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

/** ¿La página es la misma obra argumental, esté preparándose o ya publicable? */
export function isArgumentWork(
  properties: readonly Pick<PropertyAssignment, 'key' | 'value'>[],
  kindKey = 'tipo',
): boolean {
  return properties.some((one) => {
    if (one.key !== kindKey) return false;
    const kind = one.value.trim().toLowerCase();
    return kind === ARGUMENT_PREPARATION_KIND || kind === ARGUMENT_KIND;
  });
}

/**
 * El estado que se muestra en la cabecera.
 *
 * `argumento` vive en el tipo de la página, no como una segunda propiedad
 * redundante. Los estados anteriores sí viven en `madurez argumental` mientras
 * la página siga siendo una preparación.
 */
export function argumentMaturity(
  properties: readonly Pick<PropertyAssignment, 'key' | 'value'>[],
  kindKey = 'tipo',
): ArgumentMaturity | null {
  const kind = properties.find((one) => one.key === kindKey)?.value.trim().toLowerCase();
  if (kind === ARGUMENT_KIND) return ARGUMENT_KIND;
  if (kind !== ARGUMENT_PREPARATION_KIND) return null;
  return argumentPreparationPhase(properties);
}

/** Los cambios atómicos que llevan la misma página a otra madurez. */
export function argumentMaturityChanges(
  page: PageId,
  properties: readonly Pick<PropertyAssignment, 'key' | 'value'>[],
  maturity: ArgumentMaturity | null,
  kindKey = 'tipo',
): ArgumentMaturityChange[] {
  const hasMaturity = properties.some((one) => one.key === ARGUMENT_MATURITY_KEY);
  return [
    {
      kind: 'set_property',
      page,
      propertyKey: kindKey,
      propertyValue: maturity === ARGUMENT_KIND ? ARGUMENT_KIND : ARGUMENT_PREPARATION_KIND,
    },
    ...(maturity === ARGUMENT_KIND || maturity === null
      ? (hasMaturity
          ? [{
              kind: 'remove_property' as const,
              page,
              propertyKey: ARGUMENT_MATURITY_KEY,
            }]
          : [])
      : [{
          kind: 'set_property' as const,
          page,
          propertyKey: ARGUMENT_MATURITY_KEY,
          propertyValue: maturity,
        }]),
  ];
}
