// El Argumento conserva una sola identidad mientras una posición se reúne,
// ordena, compone, contrasta y llega a ser publicable.
//
// El tipo nombra la cosa; «Mesa de trabajo» nombra la superficie donde se la
// manipula. Mantenerlos separados evita que una actividad de interfaz se vuelva
// accidentalmente una clase del corpus. Ver specs/argument-workbench.allium.

import type { ObjectDeclaration } from './ontology.ts';
import type { PageId, PropertyAssignment } from './types.ts';
import { answersIn } from './vocabulary.ts';

/** El valor legado que distinguía la preparación como otra clase de página. */
export const ARGUMENT_PREPARATION_KIND = 'preparación argumental';

/** El objeto canónico que conserva la misma identidad durante todo el trabajo. */
export const ARGUMENT_KIND = 'argumento';

/** La propiedad explícita —y por tanto histórica— que declara su madurez. */
export const ARGUMENT_MATURITY_KEY = 'madurez argumental';

/**
 * La madurez es vocabulario del corpus, no una unión cerrada del programa.
 * `VERA: Propiedades` decide sus valores y su orden; el último es el estado
 * publicable. El tipo sólo expresa que la operación transporta una de esas
 * palabras gobernadas.
 */
export type ArgumentMaturity = string;
export type ArgumentMaturityChange =
  | {
      readonly kind: 'set_property'; readonly page: PageId;
      readonly propertyKey: string; readonly propertyValue: string;
    }
  | {
      readonly kind: 'remove_property'; readonly page: PageId;
      readonly propertyKey: string;
    };

/** La plantilla compuesta que una instancia declara mediante su tipo. */
export function compositionTemplateFor(
  properties: readonly Pick<PropertyAssignment, 'key' | 'value'>[],
  objects: readonly ObjectDeclaration[],
  kindKey = 'tipo',
): ObjectDeclaration | null {
  const kinds = properties
    .filter((one) => one.key.trim().toLowerCase() === kindKey.trim().toLowerCase())
    .flatMap((one) => answersIn(one.value))
    .map((one) => one.trim().toLocaleLowerCase('es'));
  return objects.find((object) =>
    object.composition !== null && kinds.includes(object.name.trim().toLocaleLowerCase('es')),
  ) ?? null;
}

/** La etapa actual de cualquier composición cuya plantilla declare una. */
export function compositionStage(
  properties: readonly Pick<PropertyAssignment, 'key' | 'value'>[],
  template: Pick<ObjectDeclaration, 'stageProperty'>,
  governed: readonly string[] = [],
): string | null {
  const key = template.stageProperty?.trim() ?? '';
  if (key === '') return null;
  const raw = properties.find((one) =>
    one.key.trim().toLowerCase() === key.toLowerCase())?.value.trim() ?? '';
  if (raw === '') return null;
  return governed.find((one) => one.trim().toLowerCase() === raw.toLowerCase()) ?? raw;
}

/** Cambia la etapa sin tocar el tipo ni la identidad de la composición. */
export function compositionStageChanges(
  page: PageId,
  properties: readonly Pick<PropertyAssignment, 'key' | 'value'>[],
  template: Pick<ObjectDeclaration, 'stageProperty'>,
  stage: string | null,
): ArgumentMaturityChange[] {
  const key = template.stageProperty?.trim() ?? '';
  if (key === '') return [];
  const current = properties.find((one) =>
    one.key.trim().toLowerCase() === key.toLowerCase())?.value.trim() ?? null;
  if (stage === null) {
    return current === null ? [] : [{ kind: 'remove_property', page, propertyKey: key }];
  }
  return current?.toLowerCase() === stage.trim().toLowerCase()
    ? []
    : [{ kind: 'set_property', page, propertyKey: key, propertyValue: stage }];
}

export function isArgumentPreparation(
  properties: readonly Pick<PropertyAssignment, 'key' | 'value'>[],
  kindKey = 'tipo',
): boolean {
  if (!isArgumentWork(properties, kindKey)) return false;
  const maturity = properties.find((one) =>
    one.key.trim().toLowerCase() === ARGUMENT_MATURITY_KEY)?.value.trim().toLowerCase();
  return maturity !== ARGUMENT_KIND;
}

/** ¿La página es la misma obra argumental, esté preparándose o ya publicable? */
export function isArgumentWork(
  properties: readonly Pick<PropertyAssignment, 'key' | 'value'>[],
  kindKey = 'tipo',
): boolean {
  return properties.some((one) => {
    if (one.key.trim().toLowerCase() !== kindKey.trim().toLowerCase()) return false;
    const kind = one.value.trim().toLowerCase();
    return kind === ARGUMENT_PREPARATION_KIND || kind === ARGUMENT_KIND;
  });
}

/**
 * El estado que se muestra en la cabecera.
 *
 * `tipo` permanece en `argumento`; la madurez completa vive en la propiedad
 * gobernada. La lista recibida conserva la grafía y el orden declarados.
 */
export function argumentMaturity(
  properties: readonly Pick<PropertyAssignment, 'key' | 'value'>[],
  kindKey = 'tipo',
  governed: readonly string[] = [],
): ArgumentMaturity | null {
  if (!isArgumentWork(properties, kindKey)) return null;
  const raw = properties.find((one) =>
    one.key.trim().toLowerCase() === ARGUMENT_MATURITY_KEY)?.value.trim() ?? '';
  if (raw === '') return null;
  return governed.find((one) => one.trim().toLowerCase() === raw.toLowerCase()) ?? raw;
}

/** Los cambios atómicos que llevan la misma página a otra madurez. */
export function argumentMaturityChanges(
  page: PageId,
  properties: readonly Pick<PropertyAssignment, 'key' | 'value'>[],
  maturity: ArgumentMaturity | null,
  kindKey = 'tipo',
): ArgumentMaturityChange[] {
  const currentKind = properties.find((one) =>
    one.key.trim().toLowerCase() === kindKey.trim().toLowerCase())?.value.trim().toLowerCase();
  const currentMaturity = properties.find((one) =>
    one.key.trim().toLowerCase() === ARGUMENT_MATURITY_KEY)?.value.trim() ?? null;
  const hasMaturity = properties.some((one) =>
    one.key.trim().toLowerCase() === ARGUMENT_MATURITY_KEY);
  return [
    ...(currentKind === ARGUMENT_KIND
      ? []
      : [{
          kind: 'set_property' as const,
          page,
          propertyKey: kindKey,
          propertyValue: ARGUMENT_KIND,
        }]),
    ...(maturity === null
      ? (hasMaturity
          ? [{
              kind: 'remove_property' as const,
              page,
              propertyKey: ARGUMENT_MATURITY_KEY,
            }]
          : [])
      : (currentMaturity?.toLowerCase() === maturity.trim().toLowerCase()
        ? []
        : [{
          kind: 'set_property' as const,
          page,
          propertyKey: ARGUMENT_MATURITY_KEY,
          propertyValue: maturity,
        }])),
  ];
}
