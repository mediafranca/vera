// Los dos resortes del hilo, probados como lo que son: aritmética.
//
// Ver specs/trail.allium, @guarantee TheThreadStraightensWhileItIsRead. Lo que
// importa no es que las velocidades salgan con un número concreto —eso lo decide
// una constante que se puede afinar— sino tres cosas: que un codo se abra, que
// los tramos se emparejen, y que la cadena no se lleve el mapa consigo.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runs, spineForce, straighten, straightenableRuns, type Moving } from '../src/graph/spine.ts';

/** Un punto quieto en el sitio que se le da. */
const at = (x: number, y: number, z?: number): Moving =>
  z === undefined ? { x, y, vx: 0, vy: 0 } : { x, y, z, vx: 0, vy: 0, vz: 0 };

/**
 * Un paso, integrado como lo integra d3.
 *
 * La velocidad se amortigua y **se conserva** entre pasos: `v *= 0.6` y luego
 * `x += v`, que es literalmente lo que hace `simulation.tick()`. Ponerla a cero
 * en cada paso —como hacía este ayudante— es otro integrador, y uno que se vuelve
 * inestable justo donde el de verdad es estable: sin amortiguar, un resorte que
 * lleva el punto al 80% del camino se pasa de largo y oscila. Las pruebas decían
 * entonces cosas sobre una física que el mapa no usa.
 */
const DECAY = 0.6;

describe('qué tramos admiten una columna vertebral', () => {
  it('conserva orgánico un recorrido que vuelve a la misma página', () => {
    const a = at(0, 0);
    const b = at(20, 15);
    const c = at(40, 0);
    assert.deepEqual(straightenableRuns([[a, b, c], [a, b, a]]), [[a, b, c]]);
  });
});

function step(chain: Moving[], alpha = 1): void {
  straighten(chain, alpha);
  for (const one of chain) {
    one.vx *= DECAY;
    one.vy *= DECAY;
    one.x += one.vx;
    one.y += one.vy;
    if (typeof one.z === 'number' && typeof one.vz === 'number') {
      one.vz *= DECAY;
      one.z += one.vz;
    }
  }
}

/** Cuánto se aparta la parada de en medio de la recta entre sus vecinas. */
function bow(chain: readonly Moving[]): number {
  let worst = 0;
  for (let i = 1; i < chain.length - 1; i += 1) {
    const a = chain[i - 1] as Moving;
    const b = chain[i] as Moving;
    const c = chain[i + 1] as Moving;
    worst = Math.max(worst, Math.hypot((a.x + c.x) / 2 - b.x, (a.y + c.y) / 2 - b.y));
  }
  return worst;
}

/** La diferencia entre el tramo más largo y el más corto. */
function spread(chain: readonly Moving[]): number {
  const spans: number[] = [];
  for (let i = 0; i < chain.length - 1; i += 1) {
    const a = chain[i] as Moving;
    const b = chain[i + 1] as Moving;
    spans.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  return Math.max(...spans) - Math.min(...spans);
}

describe('el codo se abre', () => {
  it('una cadena doblada se endereza a lo largo de la relajación', () => {
    const chain = [at(0, 0), at(50, 60), at(100, 0)];
    const before = bow(chain);
    for (let i = 0; i < 60; i += 1) step(chain);
    assert.ok(bow(chain) < before / 2, `quedó en ${bow(chain)}, venía de ${before}`);
  });

  it('una cadena ya recta no se mueve', () => {
    const chain = [at(0, 0), at(50, 0), at(100, 0)];
    straighten(chain, 1);
    for (const one of chain) {
      assert.ok(Math.abs(one.vx) < 1e-9 && Math.abs(one.vy) < 1e-9);
    }
  });

  it('pero no le gana al corpus: una parada sostenida se queda donde la sostienen', () => {
    /*
     * «Acompaña, no manda» sólo se puede probar contra algo que tire en contra: a
     * solas, cualquier resorte acaba llevando la cadena a su mínimo, que es la
     * recta. Aquí el que tira en contra hace de enlace del corpus —un muelle que
     * sujeta la parada de en medio donde el vecindario la había puesto— y lo que
     * se comprueba es que el hilo no se la lleva.
     *
     * Si esto fallara, un recorrido dibujaría en línea dos páginas que el corpus
     * tiene lejos, que es mentir sobre el mapa para que el argumento se lea mejor.
     */
    const chain = [at(0, 0), at(50, 90), at(100, 0)];
    const anchored = { x: 50, y: 90 };
    for (let i = 0; i < 200; i += 1) {
      straighten(chain, 1);
      // El enlace que la sostiene, con la fuerza que d3 le da a un enlace.
      const held = chain[1] as Moving;
      held.vx += (anchored.x - held.x) * 1;
      held.vy += (anchored.y - held.y) * 1;
      for (const one of chain) {
        one.vx *= 0.6;
        one.vy *= 0.6;
        one.x += one.vx;
        one.y += one.vy;
      }
    }
    assert.ok(
      (chain[1] as Moving).y > 60,
      `el hilo se llevó la parada hasta ${(chain[1] as Moving).y.toFixed(0)}, y la sostenían en 90`,
    );
  });
});

/*
 * La horquilla: el caso que se veía mal y que ninguna medida cazaba.
 *
 * Un recorrido que se dobla sobre sí mismo —una parada que se devuelve por donde
 * vino y deja un ángulo agudísimo— es lo peor que le puede pasar al dibujo de un
 * argumento, y es invisible para la curvatura medida como distancia al punto
 * medio: en una horquilla el punto medio queda *cerca* de la parada, así que ese
 * número sale bueno. Lo que hay que mirar es el ángulo.
 *
 * Y es la prueba que faltaba cuando el codo tiraba sólo de través: de través no
 * deshace una horquilla, porque en una horquilla lo que sobra es paralelo.
 */
describe('la horquilla se abre', () => {
  /** El ángulo, en grados, en cada parada interior. */
  const angles = (chain: readonly Moving[]): number[] => {
    const all: number[] = [];
    for (let i = 1; i < chain.length - 1; i += 1) {
      const a = chain[i - 1] as Moving;
      const b = chain[i] as Moving;
      const c = chain[i + 1] as Moving;
      const ax = a.x - b.x;
      const ay = a.y - b.y;
      const cx = c.x - b.x;
      const cy = c.y - b.y;
      const cos = (ax * cx + ay * cy) / (Math.hypot(ax, ay) * Math.hypot(cx, cy));
      all.push((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
    }
    return all;
  };

  it('una parada que se devuelve por donde vino vuelve a su sitio', () => {
    // La parada de en medio está muy pasada de largo: los dos tramos apuntan casi
    // en la misma dirección y el ángulo entre ellos es de unos pocos grados.
    const chain = [at(0, 0), at(300, 8), at(60, 0)];
    assert.ok((angles(chain)[0] as number) < 15, 'la prueba no empieza en horquilla');
    for (let i = 0; i < 200; i += 1) step(chain);
    assert.ok(
      (angles(chain)[0] as number) > 120,
      `el codo quedó en ${(angles(chain)[0] as number).toFixed(0)}°`,
    );
  });

  it('y ninguna parada de una cadena revuelta queda en un codo agudo', () => {
    const chain = [at(0, 0), at(240, 30), at(40, 10), at(300, -20), at(80, 0), at(360, 15)];
    for (let i = 0; i < 300; i += 1) step(chain);
    const worst = Math.min(...angles(chain));
    assert.ok(worst > 60, `el codo más agudo quedó en ${worst.toFixed(0)}°`);
  });
});

describe('el paso se empareja', () => {
  it('tramos desiguales se acercan a una medida común', () => {
    const chain = [at(0, 0), at(10, 0), at(200, 0)];
    const before = spread(chain);
    for (let i = 0; i < 60; i += 1) step(chain);
    assert.ok(spread(chain) < before / 2, `quedó en ${spread(chain)}, venía de ${before}`);
  });

  it('y la medida común sale de la cadena, no de una constante', () => {
    // Un recorrido corto queda corto y uno que cruza el corpus queda largo: lo
    // que se iguala es el ritmo y no el tamaño.
    const corto = [at(0, 0), at(10, 0), at(30, 0)];
    const largo = [at(0, 0), at(1000, 0), at(3000, 0)];
    for (let i = 0; i < 200; i += 1) {
      step(corto);
      step(largo);
    }
    const span = (chain: Moving[]): number => (chain[2] as Moving).x - (chain[0] as Moving).x;
    assert.ok(span(corto) < 60);
    assert.ok(span(largo) > 2000);
  });
});

describe('la cadena no se lleva el mapa', () => {
  it('el centro de masa se queda donde estaba', () => {
    // Sin devolverles a las vecinas lo que recibe el codo, un recorrido abierto
    // arrastraría el mapa entero hacia una esquina en cada paso.
    const chain = [at(0, 0), at(50, 60), at(100, 0), at(150, 90), at(200, 0)];
    const centre = (): { x: number; y: number } => ({
      x: chain.reduce((sum, one) => sum + one.x, 0) / chain.length,
      y: chain.reduce((sum, one) => sum + one.y, 0) / chain.length,
    });
    const before = centre();
    for (let i = 0; i < 100; i += 1) step(chain);
    const after = centre();
    assert.ok(Math.abs(after.x - before.x) < 1e-6, `se corrió ${after.x - before.x} en x`);
    assert.ok(Math.abs(after.y - before.y) < 1e-6, `se corrió ${after.y - before.y} en y`);
  });
});

describe('lo que no toca', () => {
  it('con alpha cero no se mueve nada', () => {
    const chain = [at(0, 0), at(50, 60), at(100, 0)];
    straighten(chain, 0);
    assert.equal((chain[1] as Moving).vy, 0);
  });

  it('dos paradas no tienen codo ni ritmo que igualar', () => {
    const chain = [at(0, 0), at(50, 60)];
    straighten(chain, 1);
    assert.equal((chain[0] as Moving).vx, 0);
    assert.equal((chain[1] as Moving).vx, 0);
  });

  it('dos paradas exactamente encima no producen NaN', () => {
    const chain = [at(0, 0), at(0, 0), at(100, 0)];
    for (let i = 0; i < 20; i += 1) step(chain);
    for (const one of chain) {
      assert.ok(Number.isFinite(one.x) && Number.isFinite(one.y));
    }
  });
});

describe('la tercera coordenada', () => {
  it('se endereza también en el espacio', () => {
    const chain = [at(0, 0, 0), at(50, 0, 80), at(100, 0, 0)];
    const before = (chain[1] as Moving).z as number;
    for (let i = 0; i < 60; i += 1) step(chain);
    assert.ok(((chain[1] as Moving).z as number) < before / 2);
  });

  it('una cadena plana no inventa profundidad', () => {
    const chain = [at(0, 0), at(50, 60), at(100, 0)];
    straighten(chain, 1);
    for (const one of chain) assert.equal(one.vz, undefined);
  });
});

describe('un puente cortado parte la cadena', () => {
  it('cada tramo seguido se endereza por su cuenta', () => {
    // Enderezar por encima del hueco sería afirmar que las dos mitades van en
    // línea, y de eso el recorrido no dice nada.
    assert.deepEqual(runs(['a', 'b', null, 'c', 'd', 'e']), [
      ['a', 'b'],
      ['c', 'd', 'e'],
    ]);
  });

  it('un hueco al principio o al final no deja cadenas vacías', () => {
    assert.deepEqual(runs([null, 'a', 'b', null]), [['a', 'b']]);
    assert.deepEqual(runs([null, null]), []);
  });

  it('sin huecos es una sola cadena', () => {
    assert.deepEqual(runs(['a', 'b', 'c']), [['a', 'b', 'c']]);
  });
});

describe('la cara que d3 llama', () => {
  it('aplica los resortes a cada cadena y a ninguna otra cosa', () => {
    const mine = [at(0, 0), at(50, 60), at(100, 0)];
    const alien = at(500, 500);
    const force = spineForce([mine]);
    force(1);
    assert.ok((mine[1] as Moving).vy !== 0);
    assert.equal(alien.vy, 0);
  });

  it('initialize no toca los nodos: esta fuerza no es de todos', () => {
    const force = spineForce([]);
    const nodes = [at(0, 0)];
    force.initialize(nodes);
    assert.equal((nodes[0] as Moving).vx, 0);
  });
});
