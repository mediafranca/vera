// Lo que este aparato guardó de lo que leyó.
//
// Lo que se fija aquí es que retener no cambie lo que se lee —una página retenida
// es la misma página—, que el límite no suelte lo que se está usando, y que un
// almacén que falla no rompa nada: retener es una mejora de lectura, y una mejora
// que rompe al fallar es peor que no tenerla.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RETAINED,
  heldOn,
  holdsNothing,
  inMemoryKeeps,
  type Keeps,
  type KeptPage,
} from '../src/held.ts';
import type { PageView } from '../src/api.ts';

/** Una página del tamaño mínimo que la vista acepta. */
function page(id: string, title = id): PageView {
  return {
    id,
    title,
    visibility: 'private',
    blocks: [],
    properties: [],
    references: [],
    backlinks: [],
  } as unknown as PageView;
}

/** Un reloj que sólo avanza cuando se le dice. */
function clock(): { now: () => number; tick: (ms: number) => void } {
  let at = 1_000;
  return { now: () => at, tick: (ms) => void (at += ms) };
}

describe('retener lo leído', () => {
  it('lo leído se vuelve a leer, y es lo mismo que se leyó', async () => {
    const held = heldOn(inMemoryKeeps());
    await held.keepPage(page('page:1', 'Un día'));
    assert.deepEqual(await held.page('page:1'), page('page:1', 'Un día'));
  });

  it('y también por su título, que es como la dirección la nombra', async () => {
    // Sin servidor no hay quien resuelva un título a una identidad, así que si
    // esto no funcionara, abrir /Un%20día sin red no encontraría nada aunque la
    // página estuviera ahí.
    const held = heldOn(inMemoryKeeps());
    await held.keepPage(page('page:1', 'Un Día'));
    assert.equal((await held.page('un día'))?.id, 'page:1');
  });

  it('lo que nunca se leyó no está, y lo dice sin inventar nada', async () => {
    const held = heldOn(inMemoryKeeps());
    assert.equal(await held.page('page:nunca'), null);
  });
});

describe('el límite', () => {
  it('no suelta nada mientras quepa', async () => {
    const held = heldOn(inMemoryKeeps());
    for (let n = 0; n < RETAINED; n += 1) await held.keepPage(page(`page:${n}`));
    assert.equal(await held.count(), RETAINED);
    assert.notEqual(await held.page('page:0'), null);
  });

  it('y cuando no cabe, suelta lo que hace más que no se lee', async () => {
    const time = clock();
    const held = heldOn(inMemoryKeeps(), time.now);
    for (let n = 0; n <= RETAINED; n += 1) {
      time.tick(1_000);
      await held.keepPage(page(`page:${n}`));
    }
    assert.equal(await held.count(), RETAINED);
    // La primera se fue; la última sigue.
    assert.equal(await held.page('page:0'), null);
    assert.notEqual(await held.page(`page:${RETAINED}`), null);
  });

  it('leer una retenida la aleja de ser soltada', async () => {
    /*
     * Es la diferencia entre un límite y un olvido: sin esto, la página que se
     * abre todas las mañanas se soltaría por vieja mientras sobreviven doscientas
     * que se abrieron una vez.
     */
    const time = clock();
    const held = heldOn(inMemoryKeeps(), time.now);
    for (let n = 0; n < RETAINED; n += 1) {
      time.tick(1_000);
      await held.keepPage(page(`page:${n}`));
    }
    time.tick(1_000);
    await held.page('page:0');

    time.tick(1_000);
    await held.keepPage(page('page:nueva'));

    assert.notEqual(await held.page('page:0'), null);
    assert.equal(await held.page('page:1'), null);
  });
});

describe('la lista y el estado del corpus', () => {
  it('se retienen, porque sin ellos no se sabe qué páginas existen', async () => {
    const held = heldOn(inMemoryKeeps());
    await held.keepIndex([{ id: 'page:1', title: 'Un día' } as never]);
    assert.equal((await held.index())?.length, 1);
    assert.equal(await held.corpus(), null);
  });
});

describe('búsqueda en lo retenido', () => {
  it('encuentra bloques, propiedades y glosas sin servidor y pliega acentos', async () => {
    const held = heldOn(inMemoryKeeps());
    const view = page('page:sur', 'Cuaderno austral');
    view.blocks = [{ stableId: 'block:1', parent: null, position: 0, content: 'Navegación hospitalaria' }];
    view.properties = [{ key: 'territorio', value: 'Magallanes profundo' }];
    view.glosses = { 'block:1': { content: 'observación marítima', createdAt: 1, updatedAt: 1 } };
    await held.keepPage(view);

    assert.equal((await held.search('nave hosp')).hits[0]?.field, 'block_content');
    assert.equal((await held.search('magall')).hits[0]?.field, 'property_value');
    assert.equal((await held.search('observacion marit')).hits[0]?.field, 'gloss_content');
    assert.equal((await held.search('nada')).pages, 1);
  });

  it('suelta también la proyección de una página olvidada', async () => {
    const keeps = inMemoryKeeps();
    const held = heldOn(keeps);
    await held.keepPage(page('page:1', 'Encontrable'));
    await held.forgetPage('page:1');
    assert.deepEqual(await held.search('encontrable'), { hits: [], pages: 0 });
  });
});

describe('olvidarlo todo', () => {
  it('deja el aparato como si nunca hubiera leído', async () => {
    const held = heldOn(inMemoryKeeps());
    await held.keepPage(page('page:1'));
    await held.keepIndex([]);
    await held.forget();
    assert.equal(await held.page('page:1'), null);
    assert.equal(await held.index(), null);
    assert.equal(await held.count(), 0);
  });
});

describe('cuando el almacén falla', () => {
  /** Uno que dice que no a todo, como un permiso denegado o un disco lleno. */
  const broken: Keeps = {
    put: async () => {
      throw new Error('no hay sitio');
    },
    get: async () => {
      throw new Error('no se puede leer');
    },
    byTitle: async () => {
      throw new Error('no se puede leer');
    },
    count: async () => {
      throw new Error('no se puede leer');
    },
    oldest: async () => {
      throw new Error('no se puede leer');
    },
    drop: async () => {
      throw new Error('no se puede borrar');
    },
    clear: async () => {
      throw new Error('no se puede borrar');
    },
    putSearch: async () => {
      throw new Error('no hay sitio');
    },
    searchDocuments: async () => {
      throw new Error('no se puede leer');
    },
    meta: async () => {
      throw new Error('no se puede leer');
    },
    setMeta: async () => {
      throw new Error('no hay sitio');
    },
  };

  it('no se nota: retener falla en silencio y leer contesta que no tiene', async () => {
    const held = heldOn(broken);
    await assert.doesNotReject(() => held.keepPage(page('page:1')));
    assert.equal(await held.page('page:1'), null);
    assert.equal(await held.index(), null);
    assert.equal(await held.count(), 0);
  });

  it('y un fallo al soltar no se lleva por delante lo que se acababa de guardar', async () => {
    /*
     * `keepPage` guarda y después recorta. Si el recorte lanza y el fallo saliera,
     * quien llamó creería que no se guardó nada — y sí se guardó.
     */
    let held: KeptPage | null = null;
    const store: Keeps = {
      ...inMemoryKeeps(),
      put: async (kept) => void (held = kept),
      get: async () => held,
      count: async () => RETAINED + 1,
      oldest: async () => {
        throw new Error('no se puede recorrer');
      },
    };
    const memory = heldOn(store);
    await assert.doesNotReject(() => memory.keepPage(page('page:1')));
    assert.notEqual(await memory.page('page:1'), null);
  });
});

describe('la que no retiene nada', () => {
  it('acepta todo y no tiene nada, que es como estaba Vera antes de esto', async () => {
    const held = holdsNothing();
    await held.keepPage(page('page:1'));
    assert.equal(await held.page('page:1'), null);
    assert.equal(await held.count(), 0);
  });
});
