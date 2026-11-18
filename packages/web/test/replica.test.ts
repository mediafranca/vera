// La réplica local: que un gesto se aplique en casa y dé el mismo árbol.
//
// Ver specs/offline-reconciliation.allium. Lo que se prueba aquí no es que el
// dominio funcione —de eso hay 900 pruebas en @vera/core— sino que sembrar la
// réplica con lo que el servidor entregó reconstruya exactamente esa página, y
// que aplicar un cambio aquí conteste lo que habría contestado el servidor.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyLocally, blockPropertiesOf, blocksOf, empty, pagePropertiesOf, seed } from '../src/replica.ts';
import type { PageView } from '../src/api.ts';

const view = (overrides: Partial<PageView> = {}): PageView =>
  ({
    id: 'page:1',
    title: 'Amereida',
    visibility: 'private',
    createdAt: 1,
    originCreatedAt: null,
    lastEditedAt: null,
    properties: [],
    domains: {},
    blocks: [
      { stableId: 'block:a', parent: null, position: 0, content: 'uno' },
      { stableId: 'block:b', parent: null, position: 1, content: 'dos' },
      { stableId: 'block:a1', parent: 'block:a', position: 0, content: 'uno coma uno' },
    ],
    assets: [],
    blockRefs: [],
    folded: [],
    spokenOrigins: [],
    authorship: {},
    backlinks: [],
    references: [],
    crossingsOut: [],
    crossingsIn: [],
    ...overrides,
  }) as PageView;

describe('sembrar la réplica', () => {
  it('reconstruye la página que el servidor entregó, con sus identidades', () => {
    const replica = seed(view());
    const blocks = blocksOf(replica);
    assert.equal(blocks.length, 3);
    assert.deepEqual(
      blocks.map((one) => one.stableId).sort(),
      ['block:a', 'block:a1', 'block:b'],
    );
    // La identidad no se reinventa: es la que hace que aplicar aquí y aplicar
    // allá den el mismo árbol.
    assert.equal(blocks.find((one) => one.stableId === 'block:a1')?.parent, 'block:a');
  });

  it('planta a un hijo aunque su padre venga después', () => {
    // El servidor manda los bloques en el orden del árbol y nada lo promete.
    // Sin recorrer por niveles, un hijo antes que su padre se perdía en silencio.
    const replica = seed(
      view({
        blocks: [
          { stableId: 'block:hijo', parent: 'block:padre', position: 0, content: 'debajo' },
          { stableId: 'block:padre', parent: null, position: 0, content: 'encima' },
        ],
      }),
    );
    assert.equal(blocksOf(replica).length, 2);
    assert.equal(blocksOf(replica).find((one) => one.stableId === 'block:hijo')?.parent, 'block:padre');
  });

  it('conserva el orden de los hermanos', () => {
    /*
     * La que faltaba, y no por descuido inocente: la prueba de arriba compara los
     * identificadores **ordenados**, así que pasaba en verde con la réplica
     * entregando la página en otro orden del que el servidor mandó.
     *
     * Sentar un bloque acota su índice al número de hermanos que ya hay —no se
     * puede entrar cuarto en una fila de uno—, así que plantarlos al revés los
     * dejaba barajados: el manual de Vera, de 197 bloques, se leía en un orden
     * que nadie escribió.
     */
    const replica = seed(
      view({
        blocks: [
          { stableId: 'block:1', parent: null, position: 0, content: 'primero' },
          { stableId: 'block:2', parent: null, position: 1, content: 'segundo' },
          { stableId: 'block:3', parent: null, position: 2, content: 'tercero' },
          { stableId: 'block:4', parent: null, position: 3, content: 'cuarto' },
          { stableId: 'block:5', parent: null, position: 4, content: 'quinto' },
        ],
      }),
    );
    assert.deepEqual(
      blocksOf(replica).map((one) => one.content),
      ['primero', 'segundo', 'tercero', 'cuarto', 'quinto'],
    );
  });

  it('y lo conserva aunque el servidor los mande en cualquier orden', () => {
    // No se supone nada de cómo vengan: lo que manda es la posición que traen.
    const replica = seed(
      view({
        blocks: [
          { stableId: 'block:3', parent: null, position: 2, content: 'tercero' },
          { stableId: 'block:1', parent: null, position: 0, content: 'primero' },
          { stableId: 'block:2', parent: null, position: 1, content: 'segundo' },
        ],
      }),
    );
    assert.deepEqual(
      blocksOf(replica).map((one) => one.content),
      ['primero', 'segundo', 'tercero'],
    );
  });

  it('y también entre hermanos que cuelgan de un padre', () => {
    const replica = seed(
      view({
        blocks: [
          { stableId: 'block:p', parent: null, position: 0, content: 'padre' },
          { stableId: 'block:c', parent: 'block:p', position: 2, content: 'tercero' },
          { stableId: 'block:a', parent: 'block:p', position: 0, content: 'primero' },
          { stableId: 'block:b', parent: 'block:p', position: 1, content: 'segundo' },
        ],
      }),
    );
    assert.deepEqual(
      blocksOf(replica)
        .filter((one) => one.parent === 'block:p')
        .sort((a, b) => a.position - b.position)
        .map((one) => one.content),
      ['primero', 'segundo', 'tercero'],
    );
  });

  it('trae lo que cuelga de cada bloque', () => {
    const replica = seed(
      view({ blockProperties: { 'block:a': [{ key: 'plazo', value: 'mañana' }] } }),
    );
    assert.deepEqual(blockPropertiesOf(replica)['block:a'], [{ key: 'plazo', value: 'mañana' }]);
  });
});

describe('aplicar en casa', () => {
  it('un día puede nacer en una réplica sin entrega del servidor', () => {
    const replica = empty('page:day:2026-11-18');
    const page = applyLocally(replica, {
      kind: 'create_page', title: '2026-11-18', visibility: 'private', stableId: replica.page,
    }, 'local:day');
    assert.equal(page.kind, 'applied');
    const block = applyLocally(replica, {
      kind: 'create_block', page: replica.page, parent: null, position: 0,
      content: 'Alexei está caído y esto queda aquí', stableId: 'block:offline',
    }, 'local:block');
    assert.equal(block.kind, 'applied');
    assert.equal(blocksOf(replica)[0]?.content, 'Alexei está caído y esto queda aquí');
  });

  it('tabular un padre lleva el mismo subárbol plegado o desplegado', () => {
    const blocks: PageView['blocks'] = [
      { stableId: 'block:a', parent: null, position: 0, content: 'encima' },
      { stableId: 'block:b', parent: null, position: 1, content: 'padre' },
      { stableId: 'block:b1', parent: 'block:b', position: 0, content: 'hijo' },
      { stableId: 'block:b1a', parent: 'block:b1', position: 0, content: 'nieto' },
    ];
    const indent = (folded: string[]) => {
      const replica = seed(view({ blocks, folded }));
      const said = applyLocally(
        replica,
        { kind: 'move_block', block: 'block:b', page: 'page:1', parent: 'block:a', position: 0 },
        'local:tab',
      );
      assert.equal(said.kind, 'applied');
      return said.kind === 'applied' ? said.blocks : [];
    };

    const open = indent([]);
    const folded = indent(['block:b']);
    assert.deepEqual(folded, open);
    assert.equal(open.find((one) => one.stableId === 'block:b')?.parent, 'block:a');
    assert.equal(open.find((one) => one.stableId === 'block:b1')?.parent, 'block:b');
    assert.equal(open.find((one) => one.stableId === 'block:b1a')?.parent, 'block:b1');
  });

  it('un bloque nuevo nace con el nombre que se le dio, sin preguntar', () => {
    const replica = seed(view());
    const said = applyLocally(
      replica,
      {
        kind: 'create_block',
        page: 'page:1',
        parent: null,
        position: 2,
        content: 'tres',
        stableId: 'block:c',
      },
      'local:1',
    );
    assert.equal(said.kind, 'applied');
    assert.equal(said.kind === 'applied' && said.subjectId, 'block:c');
    assert.equal(said.kind === 'applied' && said.blocks.length, 4);
  });

  it('editar cambia el texto y nada más', () => {
    const replica = seed(view());
    const said = applyLocally(
      replica,
      { kind: 'edit_block', block: 'block:a', content: 'uno corregido' },
      'local:1',
    );
    assert.equal(said.kind, 'applied');
    const blocks = said.kind === 'applied' ? said.blocks : [];
    assert.equal(blocks.find((one) => one.stableId === 'block:a')?.content, 'uno corregido');
    // La identidad sobrevive a editar: es la promesa central de Vera.
    assert.equal(blocks.length, 3);
  });

  it('una propiedad de página aplicada aquí se proyecta de inmediato', () => {
    const replica = seed(view());
    const said = applyLocally(
      replica,
      { kind: 'set_property', page: 'page:1', propertyKey: 'concepto', propertyValue: 'Vera' },
      'local:property',
    );
    assert.equal(said.kind, 'applied');
    assert.deepEqual(pagePropertiesOf(replica), [{ key: 'concepto', value: 'Vera' }]);
  });

  it('la visibilidad de la página cambia en la réplica antes de repintar', () => {
    const replica = seed(view());
    const said = applyLocally(
      replica,
      { kind: 'set_page_visibility', page: 'page:1', visibility: 'public' },
      'local:visibility',
    );
    assert.equal(said.kind, 'applied');
    assert.equal(replica.graph.page('page:1')?.visibility, 'public');
  });

  it('la negativa es la del dominio, y llega sin salir de casa', () => {
    // Las mismas palabras que habría contestado el servidor. Si el cliente
    // decidiera por su cuenta, diría que sí donde el servidor dice que no y el
    // bloque se movería y volvería.
    const replica = seed(view());
    const said = applyLocally(
      replica,
      { kind: 'move_block', block: 'block:a', page: 'page:1', parent: 'block:a1', position: 0 },
      'local:1',
    );
    assert.equal(said.kind, 'rejected');
    assert.match(said.kind === 'rejected' ? said.reason : '', /beneath itself/);
  });

  it('un bloque desconocido no se rechaza: no se distingue de uno de otra página', () => {
    // Esta prueba decía lo contrario y estaba mal. Desde aquí, «no lo tengo» y
    // «no existe» son la misma observación, y sólo una de las dos es motivo para
    // negarse. Contestar que no existe algo que sí existe en otra página es
    // inventar una negativa, así que se difiere y lo contesta quien lo sabe.
    const replica = seed(view());
    const said = applyLocally(
      replica,
      { kind: 'edit_block', block: 'block:fantasma', content: 'x' },
      'local:1',
    );
    assert.equal(said.kind, 'defer');
  });

  it('una página nueva nace aquí, con el nombre que se le dio', () => {
    /*
     * Esto difería, y era el único gesto que obligaba a esperar a la red. Se
     * notaba en el peor sitio: pulsar un `[[nombre]]` recién escrito para ir a
     * escribir ahí, que es el gesto más local-first que hay.
     *
     * Lo que la réplica no puede contestar es si el título está libre en el corpus
     * entero. Lo contesta el índice retenido antes de llegar aquí, y si el corpus
     * dice que no, lo dice al enviarlo y el rechazo se queda con su motivo.
     */
    const replica = seed(view());
    const said = applyLocally(
      replica,
      { kind: 'create_page', title: 'Otra', visibility: 'private', stableId: 'page:2' },
      'local:1',
    );
    assert.equal(said.kind, 'applied');
    assert.equal(said.kind === 'applied' && said.subjectId, 'page:2');
    // Y lo que se ve no cambia: la página abierta sigue siendo la que era.
    assert.equal(said.kind === 'applied' && said.blocks.length, 3);
  });

  it('y lo que cuelga de ella también, aunque no sea la página abierta', () => {
    // Al crear una página se le pone cuándo nació. Si eso esperara a la red, el
    // gesto seguiría teniendo una espera dentro.
    const replica = seed(view());
    applyLocally(
      replica,
      { kind: 'create_page', title: 'Otra', visibility: 'private', stableId: 'page:2' },
      'local:1',
    );
    assert.equal(
      applyLocally(
        replica,
        { kind: 'set_property', page: 'page:2', propertyKey: 'creación', propertyValue: '2026-08-11' },
        'local:2',
      ).kind,
      'applied',
    );
  });

  it('crear una página deja lo derivado por rehacer', () => {
    // Los `[[nombres]]` que la esperaban dejan de estar pendientes, y eso no lo
    // sabe esta réplica: lo sabe el corpus. @invariant RenderingFollowsChangedMeaning.
    const replica = seed(view());
    const said = applyLocally(
      replica,
      { kind: 'create_page', title: 'Otra', visibility: 'private', stableId: 'page:2' },
      'local:1',
    );
    assert.equal(said.kind === 'applied' && said.staleDerived, true);
  });

  it('renombrar una página sí se difiere: toca enlaces que ésta no tiene', () => {
    const replica = seed(view());
    assert.equal(
      applyLocally(replica, { kind: 'rename_page', page: 'page:1', title: 'Otra' }, 'local:1').kind,
      'defer',
    );
  });

  it('sólo lo que cambia el texto ensucia lo derivado', () => {
    // @invariant RenderingFollowsChangedMeaning: mover un bloque no cambia a
    // quién nombra la página, así que los retroenlaces que trajo el servidor
    // siguen siendo ciertos y no hay que ir a buscarlos otra vez.
    const replica = seed(view());
    const moved = applyLocally(
      replica,
      { kind: 'move_block', block: 'block:b', page: 'page:1', parent: 'block:a', position: 1 },
      'local:1',
    );
    assert.equal(moved.kind === 'applied' && moved.staleDerived, false);

    const edited = applyLocally(
      replica,
      { kind: 'edit_block', block: 'block:b', content: 'ahora nombra [[Otra]]' },
      'local:2',
    );
    assert.equal(edited.kind === 'applied' && edited.staleDerived, true);
  });

  it('reenviar el mismo origen no aplica dos veces', () => {
    // @invariant OriginIdentityIsTheIdempotencyKey, aquí también: es lo que hace
    // seguro reintentar sin saber si lo anterior llegó.
    const replica = seed(view());
    const change = {
      kind: 'create_block' as const,
      page: 'page:1',
      parent: null,
      position: 2,
      content: 'tres',
      stableId: 'block:c',
    };
    applyLocally(replica, change, 'local:1');
    const again = applyLocally(replica, change, 'local:1');
    assert.equal(again.kind, 'applied');
    assert.equal(again.kind === 'applied' && again.blocks.length, 4);
  });
});

/*
 * Lo que no vive aquí no se contesta aquí.
 *
 * Es una condición de corrección y no una optimización: media docena de sitios
 * escriben en páginas que no son la abierta —la tabla de la puerta MCP, la de una
 * conexión de servicio, promover un rastro— y rechazarlas con «no such block»
 * sería inventar una negativa sobre algo que existe.
 */
describe('lo que la réplica no sostiene', () => {
  it('un bloque de otra página se difiere, no se rechaza', () => {
    const replica = seed(view());
    const said = applyLocally(
      replica,
      { kind: 'edit_block', block: 'block:de-otra-pagina', content: 'x' },
      'local:1',
    );
    assert.equal(said.kind, 'defer');
  });

  it('crear un bloque en otra página se difiere', () => {
    const replica = seed(view());
    assert.equal(
      applyLocally(
        replica,
        { kind: 'create_block', page: 'page:otra', parent: null, position: 0, content: 'x' },
        'local:1',
      ).kind,
      'defer',
    );
  });

  it('mover un bloque fuera de esta página se difiere', () => {
    // Sacarlo de aquí es lo que esta réplica no puede representar: el bloque deja
    // de estar en el único árbol que sostiene.
    const replica = seed(view());
    assert.equal(
      applyLocally(
        replica,
        { kind: 'move_block', block: 'block:a', page: 'page:otra', parent: null, position: 0 },
        'local:1',
      ).kind,
      'defer',
    );
  });

  it('una propiedad de otra página se difiere', () => {
    const replica = seed(view());
    assert.equal(
      applyLocally(
        replica,
        { kind: 'set_property', page: 'page:otra', propertyKey: 'tipo', propertyValue: 'x' },
        'local:1',
      ).kind,
      'defer',
    );
  });

  it('pero una propiedad de esta página sí se aplica', () => {
    const replica = seed(view());
    assert.equal(
      applyLocally(
        replica,
        { kind: 'set_property', page: 'page:1', propertyKey: 'tipo', propertyValue: 'Nota' },
        'local:1',
      ).kind,
      'applied',
    );
  });
});
