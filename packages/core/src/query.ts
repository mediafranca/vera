// Expresiones de consulta, desde specs/query-language.allium.
//
// El vocabulario está enumerado: se puede descubrir qué es preguntable sin leer
// una gramática ni adivinar un dialecto.

export type QueryExpression =
  | { readonly kind: 'TitleTerm'; readonly text: string }
  | { readonly kind: 'ContentTerm'; readonly text: string }
  | { readonly kind: 'TagTerm'; readonly tag: string }
  | { readonly kind: 'PropertyTerm'; readonly key: string; readonly value: string | null }
  | { readonly kind: 'LinksToTerm'; readonly targetTitle: string }
  | { readonly kind: 'LinkedFromTerm'; readonly originTitle: string }
  | { readonly kind: 'RelatesToTerm'; readonly relation: string; readonly targetTitle: string }
  | { readonly kind: 'RelatedFromTerm'; readonly relation: string; readonly originTitle: string }
  | { readonly kind: 'AndTerm'; readonly operands: readonly QueryExpression[] }
  | { readonly kind: 'OrTerm'; readonly operands: readonly QueryExpression[] }
  | { readonly kind: 'NotTerm'; readonly operand: QueryExpression };

export function titleTerm(text: string): QueryExpression {
  return { kind: 'TitleTerm', text };
}

export function contentTerm(text: string): QueryExpression {
  return { kind: 'ContentTerm', text };
}

export function tagTerm(tag: string): QueryExpression {
  return { kind: 'TagTerm', tag };
}

/** Sin valor, selecciona las páginas que llevan la propiedad, cualquiera sea su valor. */
export function propertyTerm(key: string, value?: string): QueryExpression {
  return { kind: 'PropertyTerm', key, value: value ?? null };
}

/*
 * Los dos términos de enlace nombran un título y no una página.
 *
 * Lo que se escribe es `->[[Ciudad Abierta]]`, y un título no es todavía una
 * página: puede no existir —el corpus está lleno de enlaces a páginas que nadie
 * ha escrito— y puede renombrarse. Además, un enlace en Vera guarda el título tal
 * como se escribió aunque no resuelva, así que preguntar por el título pregunta
 * por lo que los bloques dicen, que es más que lo que el grafo resolvió.
 */
export function linksTo(targetTitle: string): QueryExpression {
  return { kind: 'LinksToTerm', targetTitle };
}

export function linkedFrom(originTitle: string): QueryExpression {
  return { kind: 'LinkedFromTerm', originTitle };
}

export function relatesTo(relation: string, targetTitle: string): QueryExpression {
  return { kind: 'RelatesToTerm', relation, targetTitle };
}

export function relatedFrom(relation: string, originTitle: string): QueryExpression {
  return { kind: 'RelatedFromTerm', relation, originTitle };
}

// invariant CombiningTermsNeedTwoOperands
export function and(...operands: QueryExpression[]): QueryExpression {
  if (operands.length < 2) {
    throw new Error('an AndTerm needs at least two operands');
  }
  return { kind: 'AndTerm', operands };
}

export function or(...operands: QueryExpression[]): QueryExpression {
  if (operands.length < 2) {
    throw new Error('an OrTerm needs at least two operands');
  }
  return { kind: 'OrTerm', operands };
}

export function not(operand: QueryExpression): QueryExpression {
  return { kind: 'NotTerm', operand };
}
