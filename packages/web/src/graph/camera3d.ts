/**
 * La cámara del mapa en tres dimensiones: dónde está, y dónde cae en la pantalla
 * cada punto del grafo.
 *
 * Vive aparte del dibujo y sin tocar el DOM porque es la parte que se ha roto
 * una y otra vez, y la única que se puede comprobar sin un navegador: dadas unas
 * coordenadas y una lente, salen unos píxeles. Todo lo de aquí son funciones
 * puras y todo lo de aquí tiene prueba.
 *
 * Sustituye a la cámara que traía la librería de WebGL. Escribirla a mano cuesta
 * cien líneas de trigonometría; no escribirla costaba no poder mirar dentro de
 * ella, que salió mucho más caro.
 *
 * Convenios, que conviene tener a la vista:
 *
 * - El mundo es diestro y la Y sube. La pantalla es SVG y su Y baja: la vuelta
 *   se da una sola vez, en `project`, y en ningún otro sitio.
 * - Con azimut y elevación en cero la cámara está en `centro + (0, 0, distancia)`
 *   mirando hacia −Z. Es la misma posición de partida que tenía el mapa anterior,
 *   para que un grafo ya colocado se vea igual que antes.
 *
 * @guarantee TheMapArrivesFramed
 */

/** Un punto del espacio del grafo. */
export type Point = { x: number; y: number; z: number };

/** Una caja alineada con los ejes, en coordenadas del grafo. */
export type Box = { min: Point; max: Point };

/**
 * Dónde está la cámara, dicho como se la mueve y no como se la sitúa.
 *
 * Se guarda en coordenadas de órbita —en torno a qué, a qué distancia, desde qué
 * ángulo— y no en x/y/z, porque es lo que la mano manipula: arrastrar cambia dos
 * ángulos y la rueda cambia una distancia. Guardar la posición cartesiana
 * obligaba a deducir el ángulo de vuelta en cada arrastre, y ahí es donde el
 * mapa anterior perdía el centro de giro.
 */
export type Orbit = {
  /** En torno a qué se gira, y qué se mira. */
  centre: Point;
  /** Cuán lejos del centro está el ojo. */
  distance: number;
  /** Giro alrededor del eje vertical, en radianes. */
  azimuth: number;
  /** Cuánto se mira desde arriba o desde abajo, en radianes. */
  elevation: number;
};

/** La lente y el papel: cuánto abarca y de qué tamaño es. */
export type Lens = {
  /** Campo de visión vertical, en grados. */
  fov: number;
  /** Ancho del panel, en píxeles. */
  width: number;
  /** Alto del panel, en píxeles. */
  height: number;
};

/** Dónde cae un punto en la pantalla, y a cuánto quedó. */
export type Screen = {
  /** Píxeles desde el borde izquierdo. */
  x: number;
  /** Píxeles desde el borde de arriba. */
  y: number;
  /** Distancia a la cámara a lo largo de la vista. Nunca menor que `NEAR`. */
  depth: number;
  /**
   * Cuántos píxeles mide una unidad del grafo a esa profundidad.
   *
   * Es lo que hace que un nombre lejano se lea más pequeño sin que nadie tenga
   * que decidir una tabla de tamaños: el tamaño es una consecuencia de estar
   * lejos, igual que en el mundo.
   */
  scale: number;
};

/**
 * Cuánto aire se deja alrededor de lo encuadrado.
 *
 * La caja ya trae el tamaño real de los nombres, así que esto es holgura y no
 * corrección: sirve para que el borde del grafo no muera contra el canto del
 * panel, no para compensar una medida que se quedó corta.
 */
export const MARGIN = 1.08;

/**
 * Lo más cerca que se deja llegar a la cámara.
 *
 * Un punto a profundidad cero está en el plano del ojo: la escala sería infinita
 * y el punto caería en cualquier sitio. Se acota, y quien dibuja decide qué hacer
 * con lo que quedó detrás mirando `depth`.
 */
export const NEAR = 1e-3;

/**
 * Lo más cerca que se deja quedar al nodo más adelantado del grafo.
 *
 * Sin este suelo, un grafo casi plano —una sola página, o dos que la simulación
 * dejó a la misma altura— pide una distancia casi cero, y a esa distancia la
 * escala se dispara y el mapa sale como una letra ocupando el panel entero. Era
 * el fallo de siempre, y lo atrapó la prueba de propiedad con una caja de ocho
 * cienmilésimas de fondo antes de que llegara a verse.
 *
 * Una unidad del grafo: nada, pero nada medible.
 */
export const MIN_DEPTH = 1;

/**
 * Lo más arriba y lo más abajo que se puede mirar.
 *
 * Justo en el polo la vertical de la cámara y su dirección de vista son la misma
 * recta, y no hay manera de decir hacia dónde queda la derecha: el mapa daría un
 * tumbo. Un grado antes del polo no se nota y no hay tumbo.
 */
export const MAX_ELEVATION = Math.PI / 2 - Math.PI / 180;

/** Dos minutos por vuelta: movimiento perceptible sin convertir el mapa en carrusel. */
export const AUTO_ROTATION_PERIOD_MS = 120_000;

/**
 * Avanza una órbita alrededor del eje vertical sin tocar encuadre ni inclinación.
 */
export function advanceAutoRotation(orbit: Orbit, elapsedMs: number): Orbit {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  return {
    ...orbit,
    azimuth: orbit.azimuth + (elapsed / AUTO_ROTATION_PERIOD_MS) * Math.PI * 2,
  };
}

/** Deja la elevación dentro de lo que la cámara sabe representar. */
export function clampElevation(elevation: number): number {
  if (!Number.isFinite(elevation)) return 0;
  return Math.min(Math.max(elevation, -MAX_ELEVATION), MAX_ELEVATION);
}

/**
 * El panel, en píxeles, acotado a algo que sea un panel.
 *
 * Un lado de cero —o de una millonésima, que es lo mismo pero pasa el «mayor que
 * cero»— hace que la escala salga cero o infinita y el mapa se vuelve un punto o
 * una letra gigante. Un píxel es el suelo: por debajo no hay dónde dibujar, y
 * quien llame ya se enterará por otra vía de que el panel no tiene tamaño.
 */
function panelOf(lens: Lens): { width: number; height: number } {
  const sane = (value: number): number => (Number.isFinite(value) && value >= 1 ? value : 1);
  return { width: sane(lens.width), height: sane(lens.height) };
}

/** Los dos semiángulos de la lente, en radianes, acotados a algo verosímil. */
export function halfAngles(lens: Lens): { halfV: number; halfH: number } {
  // Una lente inverosímil —cero grados, o ciento ochenta— daría una tangente de
  // cero o de infinito, y la cámara se iría al centro del grafo o fuera del
  // mundo. Se acota antes de que la trigonometría opine.
  const fov = Math.min(Math.max(Number.isFinite(lens.fov) ? lens.fov : 50, 1), 179);
  const { width, height } = panelOf(lens);
  const halfV = ((fov * Math.PI) / 180) / 2;
  return { halfV, halfH: Math.atan(Math.tan(halfV) * (width / height)) };
}

/** Los tres ejes de la cámara: derecha, arriba, y hacia dónde mira. */
export type Basis = { right: Point; up: Point; forward: Point };

/**
 * Hacia dónde apunta la cámara, y qué es la derecha desde ahí.
 *
 * `forward` va del ojo al centro, así que la profundidad de un punto es
 * simplemente cuánto avanza en esa dirección. La vertical del mundo es el eje Y
 * y no se negocia: un mapa que se ladea al girarlo deja de poder leerse.
 */
export function basisOf(orbit: Orbit): Basis {
  const el = clampElevation(orbit.elevation);
  const az = Number.isFinite(orbit.azimuth) ? orbit.azimuth : 0;
  const cosEl = Math.cos(el);

  // Del centro hacia el ojo. Con los dos ángulos en cero da (0, 0, 1), o sea el
  // ojo delante del grafo mirando hacia −Z.
  const away = { x: cosEl * Math.sin(az), y: Math.sin(el), z: cosEl * Math.cos(az) };
  const forward = { x: -away.x, y: -away.y, z: -away.z };

  // La derecha es perpendicular a la vista y a la vertical del mundo. Con la
  // elevación acotada nunca son paralelas, así que esto nunca degenera.
  const WORLD_UP = { x: 0, y: 1, z: 0 };
  const right = normalise(cross(forward, WORLD_UP));
  const up = cross(right, forward);

  return { right, up, forward };
}

/** Dónde está el ojo, en coordenadas del grafo. */
export function eyeOf(orbit: Orbit): Point {
  const { forward } = basisOf(orbit);
  const distance = Number.isFinite(orbit.distance) ? Math.max(orbit.distance, NEAR) : NEAR;
  return {
    x: orbit.centre.x - forward.x * distance,
    y: orbit.centre.y - forward.y * distance,
    z: orbit.centre.z - forward.z * distance,
  };
}

/**
 * Dónde cae un punto del grafo en el panel.
 *
 * Devuelve siempre algo: un punto que quedó detrás de la cámara sale con
 * `depth` en `NEAR`, y es quien dibuja el que decide no pintarlo. Devolver
 * `null` obligaba a cada llamada a repetir la misma comprobación, y una de ellas
 * se olvidaba.
 */
export function project(point: Point, orbit: Orbit, lens: Lens): Screen {
  const { right, up, forward } = basisOf(orbit);
  const eye = eyeOf(orbit);
  const v = { x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z };

  const depth = Math.max(dot(v, forward), NEAR);
  const a = dot(v, right);
  const b = dot(v, up);

  const { halfV } = halfAngles(lens);
  const { width, height } = panelOf(lens);

  // Cuántos píxeles mide una unidad del grafo a esta profundidad. Sale de que el
  // semialto visible a distancia `depth` es `tan(halfV)·depth`, y ése ocupa medio
  // panel.
  const scale = height / 2 / (Math.tan(halfV) * depth);

  return {
    x: width / 2 + a * scale,
    // La Y del mundo sube y la del SVG baja. Aquí, y sólo aquí.
    y: height / 2 - b * scale,
    depth,
    scale,
  };
}

/** Las ocho esquinas de una caja. */
export function cornersOf(box: Box): Point[] {
  const out: Point[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) out.push({ x, y, z });
    }
  }
  return out;
}

/** El centro de una caja. */
export function centreOf(box: Box): Point {
  return {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
}

/**
 * A qué distancia hay que ponerse, desde este ángulo, para que la caja quepa.
 *
 * Se resuelve la desigualdad en vez de estimarla. Una esquina se ve si su
 * desplazamiento lateral cabe dentro del cono a su propia profundidad:
 *
 *     |lateral| ≤ tan(semiángulo) · (distancia + fondo de la esquina)
 *
 * y despejando la distancia sale, para cada esquina y cada eje, un mínimo. El
 * mayor de todos es la distancia que las mete a todas.
 *
 * Aquí estuvo el fallo que este mapa arrastró desde el principio, y por eso se
 * escribe así de explícito: la esfera envolvente de una caja es hasta √3 más
 * grande que la caja, y encuadrar la esfera deja el grafo dibujado a la mitad de
 * su tamaño en medio de un panel vacío. Encuadrado, sí, pero ilegible.
 */
export function distanceToFit(box: Box, lens: Lens, azimuth: number, elevation: number): number {
  const centre = centreOf(box);
  const { right, up, forward } = basisOf({ centre, distance: 1, azimuth, elevation });
  const { halfV, halfH } = halfAngles(lens);
  const tanV = Math.tan(halfV);
  const tanH = Math.tan(halfH);

  let distance = NEAR;
  // Cuánto sobresale hacia el ojo la esquina más adelantada.
  let nearest = 0;
  for (const corner of cornersOf(box)) {
    const v = { x: corner.x - centre.x, y: corner.y - centre.y, z: corner.z - centre.z };
    // Cuánto se aleja esta esquina del centro en la dirección de la vista. Si es
    // negativo la esquina está más cerca del ojo, y exige más distancia.
    const behind = dot(v, forward);
    const needH = Math.abs(dot(v, right)) / tanH - behind;
    const needV = Math.abs(dot(v, up)) / tanV - behind;
    distance = Math.max(distance, needH, needV);
    nearest = Math.max(nearest, -behind);
  }
  // Y por delante de todo eso, el suelo: ninguna esquina puede quedar pegada al
  // ojo por muy fina que sea la caja.
  return Math.max(distance, nearest + MIN_DEPTH);
}

/**
 * La órbita que hace caber la caja entera, sin cambiar desde dónde se mira.
 *
 * El ángulo se conserva a propósito: encuadrar es acercarse o alejarse, no
 * girar. Quien estaba mirando el grafo desde arriba lo sigue mirando desde
 * arriba después de pulsar «centrar», que es lo que esa palabra quiere decir.
 */
export function frameBox(
  box: Box,
  lens: Lens,
  azimuth = 0,
  elevation = 0,
  margin = MARGIN,
): Orbit {
  const safeMargin = Number.isFinite(margin) && margin > 0 ? margin : MARGIN;
  return {
    centre: centreOf(box),
    distance: Math.max(distanceToFit(box, lens, azimuth, elevation) * safeMargin, NEAR),
    azimuth: Number.isFinite(azimuth) ? azimuth : 0,
    elevation: clampElevation(elevation),
  };
}

/**
 * La caja más pequeña con el mismo contenido y centrada donde se le diga.
 *
 * Sirve para encuadrar en torno a algo que no es el centro geométrico de lo que
 * hay: se estira la caja por el lado corto hasta que el punto pedido quede en
 * medio. Lo que sobra es aire, y aire de más nunca deja nada fuera.
 */
export function expandAround(box: Box, centre: Point): Box {
  const half = (lo: number, hi: number, c: number): number =>
    Math.max(Math.abs(c - lo), Math.abs(hi - c));
  const hx = half(box.min.x, box.max.x, centre.x);
  const hy = half(box.min.y, box.max.y, centre.y);
  const hz = half(box.min.z, box.max.z, centre.z);
  return {
    min: { x: centre.x - hx, y: centre.y - hy, z: centre.z - hz },
    max: { x: centre.x + hx, y: centre.y + hy, z: centre.z + hz },
  };
}

/**
 * La órbita que hace caber la caja entera girando en torno a un punto dado.
 *
 * El punto es la página que se está leyendo. Un mapa contesta «dónde estoy», y
 * la respuesta no puede depender de dónde caiga el centro de masa del
 * vecindario: girar el mapa tiene que girar alrededor de uno mismo.
 */
export function frameAround(
  box: Box,
  centre: Point,
  lens: Lens,
  azimuth = 0,
  elevation = 0,
  margin = MARGIN,
): Orbit {
  return frameBox(expandAround(box, centre), lens, azimuth, elevation, margin);
}

/**
 * Cuántas unidades del grafo mide un píxel a la distancia de la órbita.
 *
 * Es lo que hace que arrastrar con dos dedos mueva el mapa exactamente lo que
 * se movieron los dedos: sin esta conversión el desplazamiento va en unidades
 * del mundo y a un grafo lejano le sabe a poco, a uno cercano a demasiado, y en
 * los dos casos el mapa se despega de la mano.
 */
export function worldPerPixel(orbit: Orbit, lens: Lens): number {
  const { halfV } = halfAngles(lens);
  const { height } = panelOf(lens);
  const distance = Number.isFinite(orbit.distance) ? Math.max(orbit.distance, NEAR) : NEAR;
  return (Math.tan(halfV) * distance) / (height / 2);
}

/**
 * Correr el mapa lo que se corrieron los dedos, sin girarlo.
 *
 * Se mueve el centro de la órbita por el plano de la pantalla —los ejes derecha
 * y arriba de la cámara—, así que el mapa acompaña a la mano se mire desde donde
 * se mire. En sentido contrario al centro, porque mover el mapa a la derecha es
 * mirar más a la izquierda.
 */
export function panBy(orbit: Orbit, dxPixels: number, dyPixels: number, lens: Lens): Orbit {
  if (!Number.isFinite(dxPixels) || !Number.isFinite(dyPixels)) return orbit;
  const { right, up } = basisOf(orbit);
  const k = worldPerPixel(orbit, lens);
  const dx = dxPixels * k;
  // La Y de la pantalla baja y la del mundo sube: bajar los dedos sube el centro.
  const dy = dyPixels * k;
  return {
    ...orbit,
    centre: {
      x: orbit.centre.x - right.x * dx + up.x * dy,
      y: orbit.centre.y - right.y * dx + up.y * dy,
      z: orbit.centre.z - right.z * dx + up.z * dy,
    },
  };
}

/**
 * Acercar o alejar por un factor, sin dejar que la cámara atraviese lo que mira.
 *
 * Un factor menor que uno acerca. El suelo no es cosmético: con la distancia en
 * cero la escala se dispara y el mapa se convierte en una letra a pantalla
 * completa, que es exactamente cómo se rompía el mapa anterior.
 */
export function zoomBy(orbit: Orbit, factor: number): Orbit {
  if (!Number.isFinite(factor) || factor <= 0) return orbit;
  return { ...orbit, distance: Math.max(orbit.distance * factor, MIN_DEPTH) };
}

/**
 * Si la caja cabe entera en el panel desde esta órbita.
 *
 * Es la garantía escrita al derecho, para poder comprobarla: cada esquina tiene
 * que caer dentro del panel y por delante del ojo. Que la cuenta de `frameBox`
 * sea correcta se demuestra aquí y no leyéndola.
 */
export function fits(box: Box, orbit: Orbit, lens: Lens): boolean {
  // Un pelo de tolerancia: la caja encuadrada al ras cae justo sobre el borde, y
  // en coma flotante «justo» a veces es un ulp por fuera.
  const slack = 1e-6;
  for (const corner of cornersOf(box)) {
    const at = project(corner, orbit, lens);
    if (at.depth <= NEAR) return false;
    if (at.x < -slack || at.x > lens.width + slack) return false;
    if (at.y < -slack || at.y > lens.height + slack) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Vectores. Tres operaciones y ninguna librería: importar uno de esos paquetes
// habría traído una dependencia entera para esto.
// ---------------------------------------------------------------------------

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Point, b: Point): Point {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalise(v: Point): Point {
  const length = Math.hypot(v.x, v.y, v.z);
  if (!(length > 0)) return { x: 1, y: 0, z: 0 };
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}
