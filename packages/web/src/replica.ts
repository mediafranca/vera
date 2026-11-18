// La réplica local de la página abierta.
//
// Ver specs/offline-reconciliation.allium. @invariant TheHandNeverWaitsForTheNetwork:
// un gesto se aplica aquí y se dibuja desde aquí; la red viene después a poner de
// acuerdo lo ya hecho.
//
// No hay una segunda implementación del dominio. La réplica es un `VeraGraph` de
// verdad —el mismo que corre en el servidor— sembrado con lo que el servidor
// entregó de esta página. Eso importa más de lo que parece: si el cliente
// decidiera por su cuenta qué es un `move_block` válido, tarde o temprano diría
// que sí donde el servidor dice que no, y el participante vería su bloque moverse
// y volver. Aquí las negativas son literalmente las mismas, porque son el mismo
// código.
//
// `@vera/core` no tiene una sola dependencia de `node:`, así que esto no cuesta
// nada: el dominio ya corría en un navegador, sólo que nadie lo había puesto.
//
// Lo que la réplica NO sabe es lo derivado de todo el corpus: retroenlaces,
// referencias, cruces, medios. Eso sigue viniendo del servidor y se pone al día
// aparte, fuera del camino del gesto. Ver `staleAfter`.

import { VeraGraph, type Change } from '@vera/core';
import type { BlockView, PageView } from './api.ts';

/** Quién escribe, mientras las personas no se autentiquen ante Vera. */
const LOCAL = 'participant:local';

export interface Replica {
  /** La página que sostiene. Una réplica no sobrevive a cambiar de página. */
  readonly page: string;
  readonly graph: VeraGraph;
}

/**
 * Una página que todavía sólo existe como intención local.
 *
 * La bitácora de hoy puede empezar mientras el servidor está caído. En ese
 * instante no hay una PageView canónica con la cual sembrar, pero sí una
 * identidad estable que este aparato acaba de acuñar. La réplica vacía permite
 * aplicar `create_page` y todo lo que nace debajo por el mismo camino durable
 * que una edición ordinaria.
 */
export function empty(page: string): Replica {
  const graph = VeraGraph.create({ name: 'local' });
  graph.addParticipant({ id: LOCAL, name: 'quien escribe', kind: 'human' });
  graph.admit(LOCAL);
  return { page, graph };
}

/**
 * Siembra una réplica con la página que el servidor entregó.
 *
 * Se replantan los bloques con la identidad que ya tienen, que es lo que hace
 * que aplicar un cambio aquí y aplicarlo allá den el mismo árbol. Y en el orden
 * en que el servidor los mandó: `position` viaja con cada bloque, así que el
 * orden se conserva aunque la siembra no lo respetara.
 */
export function seed(page: PageView): Replica {
  const replica = empty(page.id);
  const { graph } = replica;

  let at = 0;
  const submit = (change: Change): void => {
    at += 1;
    graph.submitOperation({
      originId: `seed:${at}`,
      participant: LOCAL,
      channel: 'typed_text',
      change,
    });
  };

  submit({ kind: 'create_page', title: page.title, visibility: page.visibility, stableId: page.id });

  /*
   * Los padres antes que los hijos, y cada hermano después del que va antes.
   *
   * `create_block` rechaza un padre que todavía no existe, y el servidor manda
   * los bloques en el orden del árbol pero nada lo promete. Se recorre por
   * niveles: primero los que cuelgan de la página, después los que cuelgan de
   * los ya plantados, hasta que no quede ninguno que se pueda plantar.
   *
   * Y **por posición ascendente**, que no es un detalle de estilo. Sentar un
   * bloque acota su índice al número de hermanos que ya hay —no se puede entrar
   * cuarto en una fila de uno—, así que plantarlos al revés los deja en un orden
   * que no es el que traían: la página que se lee deja de ser la que se escribió.
   * Plantados de menor a mayor, cada bloque llega cuando su sitio existe y la
   * acotación no hace nada.
   *
   * Se ordena aquí en vez de confiar en cómo vengan: dentro de un mismo padre lo
   * único que importa es su orden relativo, y ordenar la lista entera por
   * posición lo garantiza sin suponer nada del servidor.
   */
  const pending = [...page.blocks].sort((a, b) => a.position - b.position);
  const planted = new Set<string>();
  let growing = true;
  while (growing && pending.length > 0) {
    growing = false;
    const later: BlockView[] = [];
    for (const block of pending) {
      if (block.parent !== null && !planted.has(block.parent)) {
        later.push(block);
        continue;
      }
      submit({
        kind: 'create_block',
        page: page.id,
        parent: block.parent,
        position: block.position,
        content: block.content,
        stableId: block.stableId,
      });
      planted.add(block.stableId);
      growing = true;
    }
    pending.length = 0;
    pending.push(...later);
  }

  // Lo que cuelga de cada bloque, que el corpus trae de Logseq y sostiene el
  // plazo de una tarea y el testimonio de un cruce.
  for (const [block, said] of Object.entries(page.blockProperties ?? {})) {
    for (const one of said) {
      submit({ kind: 'set_property', block, propertyKey: one.key, propertyValue: one.value });
    }
  }
  for (const one of page.properties) {
    submit({ kind: 'set_property', page: page.id, propertyKey: one.key, propertyValue: one.value });
  }

  return replica;
}

/** Lo que sale de aplicar un cambio en casa. */
export type LocalOutcome =
  | { kind: 'applied'; subjectId: string; blocks: BlockView[]; staleDerived: boolean }
  /** El dominio dijo que no, y lo dijo aquí: no hubo viaje. */
  | { kind: 'rejected'; reason: string }
  /** Esto no se sabe aplicar en casa; que lo conteste el servidor. */
  | { kind: 'defer' };

/**
 * Qué cambios sabe aplicar la réplica de una sola página.
 *
 * Los que empiezan y terminan dentro de ella. Crear una página, renombrarla o
 * borrarla tocan cosas que esta réplica no tiene —los enlaces que la nombran
 * desde otras páginas, la lista de títulos— y por eso se difieren en vez de
 * fingirse: una respuesta local que no puede ser correcta es peor que esperar.
 */
const AT_HOME = new Set([
  'create_page',
  'set_page_visibility',
  'create_block',
  'edit_block',
  'move_block',
  'remove_block',
  'set_property',
  'remove_property',
]);

/**
 * Lo derivado que el cambio pudo mover, y que la réplica no puede recalcular.
 *
 * Sólo el texto de un bloque produce enlaces, etiquetas y cruces. Mover, plegar
 * o reordenar no cambian a quién nombra la página, así que no ensucian nada de
 * lo que vino del servidor. @invariant RenderingFollowsChangedMeaning: lo
 * derivado se recalcula cuando cambiaron sus entradas, y no porque algo pasara.
 */
function touchesDerived(change: Change): boolean {
  return (
    change.kind === 'edit_block' ||
    change.kind === 'create_block' ||
    change.kind === 'remove_block' ||
    // Crear una página resuelve los `[[nombres]]` que la esperaban: lo que la
    // página abierta dice sobre ella deja de estar pendiente.
    change.kind === 'create_page'
  );
}

/**
 * ¿El sujeto de este cambio vive en esta réplica?
 *
 * Es una condición de corrección y no una optimización. La réplica sostiene una
 * página; un cambio sobre un bloque de otra se rechazaría aquí con «no such
 * block» —que es verdad en esta réplica y mentira en el corpus— y quien escribió
 * vería una negativa inventada sobre algo que existe. Media docena de sitios
 * escriben en páginas que no son la abierta: la tabla de la puerta MCP, la de
 * una conexión de servicio, promover un rastro.
 *
 * Lo que no se pueda contestar con lo que hay aquí se difiere, y lo contesta
 * quien lo sabe.
 */
function holds(replica: Replica, change: Change): boolean {
  const { graph, page } = replica;
  switch (change.kind) {
    /*
     * Una página nueva no necesita nada de lo que ya hay: nace vacía.
     *
     * Era el único gesto que obligaba a esperar a la red, y se notaba en el peor
     * sitio: pulsar un `[[nombre]]` recién escrito en la bitácora para ir a
     * escribir ahí. Ir a escribir es el gesto más local-first que existe y era el
     * más lento de todos.
     *
     * Lo que esta réplica no puede contestar es si el título está libre en el
     * corpus entero —sólo tiene lo suyo— y lo contesta el índice retenido antes de
     * llegar aquí, que es lo mejor que este aparato sabe. Si el corpus dice que no
     * porque alguien lo tomó hace un minuto en otro aparato, lo dice al enviarlo y
     * el rechazo se queda a la vista con su motivo.
     * @invariant PreserveRejectedLocalChange.
     */
    case 'create_page':
      return true;
    case 'set_page_visibility':
      return change.page === page;
    case 'create_block':
      return change.page === page && (change.parent === null || graph.block(change.parent) !== undefined);
    case 'edit_block':
    case 'remove_block':
      return graph.block(change.block) !== undefined;
    case 'move_block':
      // Y el destino también: mover a otra página saca el bloque de esta réplica,
      // que es justamente lo que ella no puede representar.
      return graph.block(change.block) !== undefined && change.page === page;
    case 'set_property':
    case 'remove_property':
      // Cualquier página que esta réplica sostenga, no sólo la abierta: al crear
      // una, la propiedad que dice cuándo nació cuelga de la recién nacida.
      return change.block !== undefined
        ? graph.block(change.block) !== undefined
        : change.page !== undefined && graph.page(change.page) !== undefined;
    default:
      return false;
  }
}

/**
 * Aplica un cambio a la réplica y devuelve el árbol que queda.
 *
 * Las negativas salen del dominio y no de una comprobación paralela: son las
 * mismas palabras que habría contestado el servidor, dichas sin salir de casa.
 */
export function applyLocally(replica: Replica, change: Change, originId: string): LocalOutcome {
  if (!AT_HOME.has(change.kind)) return { kind: 'defer' };
  if (!holds(replica, change)) return { kind: 'defer' };

  const outcome = replica.graph.submitOperation({
    originId,
    participant: LOCAL,
    channel: 'typed_text',
    change,
  });

  if (outcome.status === 'rejected') return { kind: 'rejected', reason: outcome.reason };
  // Reenviar el mismo origen no aplica dos veces, aquí como allá.
  const subjectId = outcome.status === 'duplicate' ? outcome.operation.subjectId : outcome.subjectId;

  return {
    kind: 'applied',
    subjectId,
    blocks: blocksOf(replica),
    staleDerived: touchesDerived(change),
  };
}

/** El árbol de la réplica, en la forma en que la vista lo espera. */
export function blocksOf(replica: Replica): BlockView[] {
  return replica.graph.blocksOf(replica.page).map((block) => ({
    stableId: block.stableId,
    parent: block.parent,
    position: block.position,
    content: block.content,
  }));
}

/** Y lo que cuelga de cada bloque, para que la vista no se quede atrás. */
export function blockPropertiesOf(replica: Replica): Record<string, { key: string; value: string }[]> {
  const said: Record<string, { key: string; value: string }[]> = {};
  for (const block of replica.graph.blocksOf(replica.page)) {
    const properties = replica.graph
      .propertiesOf(block.stableId)
      .map((one) => ({ key: one.key, value: one.value }));
    if (properties.length > 0) said[block.stableId] = properties;
  }
  return said;
}

/** Y las propiedades de la página, para que un visto bueno se vea al instante. */
export function pagePropertiesOf(replica: Replica): { key: string; value: string }[] {
  return replica.graph
    .propertiesOf(replica.page)
    .map((one) => ({ key: one.key, value: one.value }));
}
