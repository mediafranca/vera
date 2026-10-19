// El argumento tiende a la recta.
//
// Ver specs/trail.allium, @guarantee TheThreadStraightensWhileItIsRead. Un
// recorrido de doce paradas cae, con las fuerzas del mapa solas, en una madeja:
// las paradas se colocan por sus enlaces con el vecindario y el hilo las cose en
// el orden del argumento, que no tiene por qué parecerse a ese reparto. Lo que se
// ve entonces es un enredo, y un enredo no se lee como un recorrido.
//
// Esto añade dos resortes flojos, y sólo entre las paradas del recorrido abierto:
//
//   - **el codo**, que tira de cada parada hacia el punto medio de sus dos
//     vecinas en el hilo. Es lo que endereza.
//   - **el paso**, que lleva cada tramo hacia la longitud media de todos. Es lo
//     que hace que los trazos queden parejos.
//
// Los dos acompañan a los enlaces y a la repulsión en vez de ganarles, y eso está
// medido y no supuesto: el argumento sigue ocupando lo mismo de punta a punta.
// Un recorrido que se enderezara del todo dibujaría todos los recorridos iguales,
// y la forma —un rodeo que vuelve, una estrella desde un solo sitio— es justo lo
// que el mapa de un argumento tiene que decir. @guarantee TheWholeShapeAtOnce.
//
// Nada de esto importa mientras no haya un recorrido abierto: la fuerza no está
// puesta, y el mapa es el de siempre.
//
// Vive aparte de quien dibuja porque es aritmética y se prueba como tal, y porque
// las dos vistas —la plana y la de tres dimensiones— usan la misma: la única
// diferencia es si hay tercera coordenada.

/** Un punto de la simulación: dónde está y hacia dónde va. */
export interface Moving {
  x: number;
  y: number;
  z?: number | undefined;
  vx: number;
  vy: number;
  vz?: number | undefined;
}

/** Cuánto tira cada resorte. */
export interface Stiffness {
  /** El codo: hacia el punto medio de las dos vecinas. */
  bend: number;
  /** El paso: hacia la longitud media de los tramos. */
  even: number;
}

/**
 * Cuánto tira cada uno, y por qué tan distinto.
 *
 * Salieron de medir sobre el mapa de verdad, no de estimar, y no coinciden con lo
 * que decía un modelo aparte de las mismas fuerzas: hizo falta el dibujo real,
 * con sus nombres y su separación de cajas, para dar con ellos.
 *
 * Un recorrido de ocho paradas que el corpus tiene encadenadas y el argumento
 * visita salteadas —la forma en que un argumento cae enredado, porque su propia
 * página las enlaza a todas y las pone en corro—:
 *
 * |          | ángulo más agudo | codos agudos | cruces | desigualdad | envergadura |
 * | -------- | ---------------: | -----------: | -----: | ----------: | ----------: |
 * | sin nada |             17°  |         5,75 |   9,06 |       0,203 |         204 |
 * | esto     |            126°  |         0,00 |   0,00 |       0,058 |         244 |
 *
 * **El ángulo más agudo es la medida que manda**, y costó descubrirlo: es la que
 * distingue un recorrido legible de uno que se dobla sobre sí mismo, y es la que
 * no estaba mirándose. Ningún codo por debajo de 60° y ningún cruce del hilo
 * consigo mismo: ésa es la diferencia entre una madeja y un recorrido.
 *
 * 126° y no 180°: sigue siendo una forma y no una raya. Un recorrido que se
 * enderezara del todo dibujaría todos los recorridos iguales, y el rodeo que
 * vuelve y la estrella desde un solo sitio dejarían de distinguirse.
 *
 * **Y el argumento no encoge**: de punta a punta ocupa más que antes. Es lo que
 * quiere decir que estos resortes acompañan a las fuerzas del mapa en vez de
 * ganarles: si dos paradas están lejos porque el corpus las tiene lejos, lejos se
 * quedan. Lo que se acorta es el camino, que era el zigzag que sobraba.
 */
export const SPINE: Stiffness = { bend: 0.8, even: 0.7 };

/**
 * Los tramos seguidos de una cadena, partiendo por cada hueco.
 *
 * Un puente cortado no se dibuja —no hay adónde—, así que tampoco tira: el hilo
 * se endereza a cada lado del corte por su cuenta. Enderezar por encima del hueco
 * sería afirmar que las dos mitades van en línea, y de eso el recorrido no dice
 * nada. @guarantee ABrokenBridgeIsDrawnBroken.
 */
export function runs<T>(stops: readonly (T | null | undefined)[]): T[][] {
  const all: T[][] = [];
  let current: T[] = [];
  for (const one of stops) {
    if (one === null || one === undefined) {
      if (current.length > 0) all.push(current);
      current = [];
      continue;
    }
    current.push(one);
  }
  if (current.length > 0) all.push(current);
  return all;
}

/**
 * Los tramos que admiten una columna vertebral sin contradecir su recorrido.
 *
 * Volver a una página es una forma del argumento, no un dato que haya que
 * borrar. En el mapa, sin embargo, esa página es un solo nodo: pedirle al mismo
 * objeto que ocupe dos lugares de una fila hace que los resortes tiren contra
 * sí mismos y estiren el vecindario entero. Ese tramo conserva su hilo y su
 * orden visibles, pero se queda en la disposición orgánica del mapa.
 */
export function straightenableRuns<T>(chains: readonly (readonly T[])[]): T[][] {
  return chains
    .filter((chain) => new Set(chain).size === chain.length)
    .map((chain) => [...chain]);
}

/** Si toda la cadena tiene tercera coordenada. Una a medias se trata como plana. */
function deep(chain: readonly Moving[]): boolean {
  return chain.every((one) => typeof one.z === "number" && typeof one.vz === "number");
}

/**
 * Un paso de los dos resortes sobre una cadena de paradas.
 *
 * Menos de tres no tiene codo que enderezar, y con un solo tramo la longitud
 * media es la suya: no hay nada que hacer y se sale sin tocar nada.
 */
export function straighten(
  chain: readonly Moving[],
  alpha: number,
  how: Stiffness = SPINE,
): void {
  if (chain.length < 3 || alpha <= 0) return;
  const withZ = deep(chain);
  even(chain, alpha * how.even, withZ);
  bend(chain, alpha * how.bend, withZ);
}

/**
 * El codo: cada parada hacia el punto medio de sus dos vecinas.
 *
 * Entero, sin quitarle nada, y esto tiene historia. Hubo una versión que le
 * descartaba la componente paralela a la cuerda —«así es un resorte angular puro
 * y no encoge la cadena»— y parecía razonable. **Se dobla sobre sí misma.** Una
 * horquilla, que es el caso feo de verdad, tiene la parada casi *encima* de la
 * cuerda pero fuera del tramo entre sus vecinas, así que la parte de través es
 * casi cero y lo que hace falta para devolverla a su sitio es justo la paralela.
 * Enderezaba lo que ya estaba casi recto y dejaba intacto el codo agudo.
 *
 * Se ve midiendo el ángulo más agudo de la cadena, que es la medida que faltaba:
 * la curvatura tomada como distancia al punto medio da un número bueno en una
 * horquilla, porque en una horquilla el punto medio queda cerca. El dibujo estaba
 * mal y el número decía que estaba bien.
 *
 * |                  | ángulo más agudo | codos agudos | cruces |
 * | ---------------- | ---------------: | -----------: | -----: |
 * | sin nada         |             17°  |         5,75 |   9,06 |
 * | sólo de través   |             81°  |         0,31 |   0,19 |
 * | esto             |            126°  |         0,00 |   0,00 |
 *
 * Lo de encoger, que era el motivo de aquel apaño, no era del tirón: era que el
 * paso iba flojo y no daba abasto para sostener las longitudes. Con el paso firme
 * el tirón entero no encoge nada —la envergadura crece de 204 a 244— y sale mejor
 * en todo lo demás.
 *
 * La mitad de lo que recibe el codo se les devuelve a las vecinas en contra. Sin
 * eso la cadena entera se arrastraría hacia un lado en cada paso —el centro de
 * masa se movería solo— y un recorrido abierto tiraría del mapa hacia una
 * esquina, que es lo contrario de acompañar a las fuerzas que ya están.
 */
function bend(chain: readonly Moving[], push: number, withZ: boolean): void {
  for (let at = 1; at < chain.length - 1; at += 1) {
    const before = chain[at - 1] as Moving;
    const here = chain[at] as Moving;
    const after = chain[at + 1] as Moving;

    const dx = ((before.x + after.x) / 2 - here.x) * push;
    const dy = ((before.y + after.y) / 2 - here.y) * push;

    here.vx += dx;
    here.vy += dy;
    before.vx -= dx / 2;
    before.vy -= dy / 2;
    after.vx -= dx / 2;
    after.vy -= dy / 2;

    if (!withZ) continue;
    const dz = (((before.z as number) + (after.z as number)) / 2 - (here.z as number)) * push;
    here.vz = (here.vz as number) + dz;
    before.vz = (before.vz as number) - dz / 2;
    after.vz = (after.vz as number) - dz / 2;
  }
}

/**
 * El paso: cada tramo hacia la longitud media de la cadena.
 *
 * La media y no una medida fija, porque una medida fija sería decidir desde fuera
 * cuánto ocupa un argumento en el mapa. Con la media, un recorrido corto queda
 * corto y uno que cruza el corpus queda largo; lo que se iguala es el ritmo, no
 * el tamaño.
 */
function even(chain: readonly Moving[], pull: number, withZ: boolean): void {
  const spans: number[] = [];
  let total = 0;
  for (let at = 0; at < chain.length - 1; at += 1) {
    const from = chain[at] as Moving;
    const to = chain[at + 1] as Moving;
    const dz = withZ ? (to.z as number) - (from.z as number) : 0;
    const span = Math.hypot(to.x - from.x, to.y - from.y, dz);
    spans.push(span);
    total += span;
  }
  const rest = total / spans.length;

  for (let at = 0; at < chain.length - 1; at += 1) {
    const span = spans[at] as number;
    // Dos paradas exactamente encima no tienen dirección en la que separarse.
    // Las deja quietas la repulsión, que para eso está.
    if (span < 1e-6) continue;
    const from = chain[at] as Moving;
    const to = chain[at + 1] as Moving;
    const share = ((span - rest) / span) * pull * 0.5;

    from.vx += (to.x - from.x) * share;
    from.vy += (to.y - from.y) * share;
    to.vx -= (to.x - from.x) * share;
    to.vy -= (to.y - from.y) * share;

    if (!withZ) continue;
    const dz = ((to.z as number) - (from.z as number)) * share;
    from.vz = (from.vz as number) + dz;
    to.vz = (to.vz as number) - dz;
  }
}

/** Lo que d3 espera de una fuerza: se la llama con el alpha del paso. */
export interface Force {
  (alpha: number): void;
  initialize(nodes: readonly unknown[]): void;
}

/**
 * Los dos resortes, con la cara que d3 sabe llamar.
 *
 * Las cadenas se dan hechas y no se buscan aquí: los objetos que d3 mueve son los
 * mismos que se le pasaron, así que quedarse con ellos basta. `initialize` no
 * hace nada a propósito —esta fuerza no actúa sobre todos los nodos sino sobre
 * los del recorrido—, y es lo que la distingue de las demás.
 */
export function spineForce(chains: readonly (readonly Moving[])[], how: Stiffness = SPINE): Force {
  const force = (alpha: number): void => {
    for (const chain of chains) straighten(chain, alpha, how);
  };
  force.initialize = (): void => {};
  return force;
}
