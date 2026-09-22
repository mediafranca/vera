import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  AUTO_ROTATION_PERIOD_MS,
  MAX_ELEVATION,
  MIN_DEPTH,
  NEAR,
  basisOf,
  advanceAutoRotation,
  centreOf,
  clampElevation,
  cornersOf,
  distanceToFit,
  expandAround,
  eyeOf,
  fits,
  frameAround,
  frameBox,
  panBy,
  project,
  zoomBy,
  type Box,
  type Lens,
  type Orbit,
} from "../src/graph/camera3d.ts";

/** El panel del mapa de Vera en una ventana corriente. Más alto que ancho. */
const PANEL: Lens = { fov: 50, width: 445, height: 565 };

const boxOf = (x: number, y: number, z: number): Box => ({
  min: { x: -x, y: -y, z: -z },
  max: { x, y, z },
});

const near = (a: number, b: number, tol = 1e-9): void => {
  assert.ok(Math.abs(a - b) <= tol, `${a} debería ser ${b}`);
};

describe("la base de la cámara", () => {
  test("la rotación automática sólo cambia el azimut y tarda dos minutos por vuelta", () => {
    const orbit: Orbit = {
      centre: { x: 7, y: -2, z: 11 },
      distance: 350,
      azimuth: 0.4,
      elevation: -0.25,
    };
    const advanced = advanceAutoRotation(orbit, AUTO_ROTATION_PERIOD_MS / 4);
    assert.deepEqual(advanced.centre, orbit.centre);
    assert.equal(advanced.distance, orbit.distance);
    assert.equal(advanced.elevation, orbit.elevation);
    near(advanced.azimuth, orbit.azimuth + Math.PI / 2);
  });
  test("con los dos ángulos en cero mira hacia −Z, con la derecha en +X", () => {
    const { right, up, forward } = basisOf({
      centre: { x: 0, y: 0, z: 0 },
      distance: 10,
      azimuth: 0,
      elevation: 0,
    });
    near(forward.x, 0);
    near(forward.y, 0);
    near(forward.z, -1);
    near(right.x, 1);
    near(right.z, 0);
    near(up.y, 1);
  });

  test("los tres ejes son unitarios y perpendiculares, se mire desde donde se mire", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -1.5, max: 1.5, noNaN: true }),
        (azimuth, elevation) => {
          const { right, up, forward } = basisOf({
            centre: { x: 0, y: 0, z: 0 },
            distance: 1,
            azimuth,
            elevation,
          });
          const len = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);
          const dot = (a: typeof right, b: typeof right) => a.x * b.x + a.y * b.y + a.z * b.z;
          near(len(right), 1, 1e-9);
          near(len(up), 1, 1e-9);
          near(len(forward), 1, 1e-9);
          near(dot(right, up), 0, 1e-9);
          near(dot(right, forward), 0, 1e-9);
          near(dot(up, forward), 0, 1e-9);
        },
      ),
      { numRuns: 2_000 },
    );
  });

  test("el mapa nunca se ladea: la derecha de la cámara es siempre horizontal", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -1.5, max: 1.5, noNaN: true }),
        (azimuth, elevation) => {
          const { right } = basisOf({
            centre: { x: 0, y: 0, z: 0 },
            distance: 1,
            azimuth,
            elevation,
          });
          near(right.y, 0, 1e-12);
        },
      ),
      { numRuns: 1_000 },
    );
  });

  test("la elevación se acota antes del polo, donde la cámara daría un tumbo", () => {
    assert.equal(clampElevation(Math.PI), MAX_ELEVATION);
    assert.equal(clampElevation(-Math.PI), -MAX_ELEVATION);
    assert.equal(clampElevation(Number.NaN), 0);
    assert.equal(clampElevation(0.5), 0.5);
  });

  test("el ojo queda a la distancia pedida del centro", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 5_000, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -1.5, max: 1.5, noNaN: true }),
        (distance, azimuth, elevation) => {
          const centre = { x: 3, y: -7, z: 11 };
          const eye = eyeOf({ centre, distance, azimuth, elevation });
          near(Math.hypot(eye.x - centre.x, eye.y - centre.y, eye.z - centre.z), distance, 1e-6);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});

describe("proyectar", () => {
  test("el centro de la órbita cae en el centro del panel", () => {
    const orbit: Orbit = { centre: { x: 5, y: -3, z: 2 }, distance: 100, azimuth: 0.7, elevation: 0.3 };
    const at = project(orbit.centre, orbit, PANEL);
    near(at.x, PANEL.width / 2, 1e-9);
    near(at.y, PANEL.height / 2, 1e-9);
    near(at.depth, 100, 1e-9);
  });

  test("lo que está más arriba en el mundo se dibuja más arriba en la pantalla", () => {
    const orbit: Orbit = { centre: { x: 0, y: 0, z: 0 }, distance: 200, azimuth: 0, elevation: 0 };
    const abajo = project({ x: 0, y: -10, z: 0 }, orbit, PANEL);
    const arriba = project({ x: 0, y: 10, z: 0 }, orbit, PANEL);
    // En SVG la Y crece hacia abajo: estar arriba es tener menos Y.
    assert.ok(arriba.y < abajo.y);
  });

  test("lo lejano se dibuja más pequeño", () => {
    const orbit: Orbit = { centre: { x: 0, y: 0, z: 0 }, distance: 200, azimuth: 0, elevation: 0 };
    const cerca = project({ x: 0, y: 0, z: 50 }, orbit, PANEL);
    const lejos = project({ x: 0, y: 0, z: -50 }, orbit, PANEL);
    assert.ok(cerca.depth < lejos.depth);
    assert.ok(cerca.scale > lejos.scale);
  });

  test("un punto detrás de la cámara sale marcado y no en cualquier sitio", () => {
    const orbit: Orbit = { centre: { x: 0, y: 0, z: 0 }, distance: 10, azimuth: 0, elevation: 0 };
    const detras = project({ x: 0, y: 0, z: 1_000 }, orbit, PANEL);
    assert.equal(detras.depth, NEAR);
    assert.ok(Number.isFinite(detras.x) && Number.isFinite(detras.y));
  });

  test("nunca sale NaN, ni con un panel degenerado ni con una lente absurda", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: 0, max: 400, noNaN: true }),
        fc.double({ min: 0, max: 400, noNaN: true }),
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        (x, y, z, width, height, fov) => {
          const orbit: Orbit = {
            centre: { x: 0, y: 0, z: 0 },
            distance: 300,
            azimuth: 1,
            elevation: 0.4,
          };
          const at = project({ x, y, z }, orbit, { fov, width, height });
          assert.ok(Number.isFinite(at.x), `x salió ${at.x}`);
          assert.ok(Number.isFinite(at.y), `y salió ${at.y}`);
          assert.ok(Number.isFinite(at.depth) && at.depth >= NEAR);
          assert.ok(Number.isFinite(at.scale) && at.scale > 0);
        },
      ),
      { numRuns: 2_000 },
    );
  });
});

describe("encuadrar", () => {
  test("un solo nombre, que es una caja ancha y baja, cabe entero", () => {
    // El fallo original: se encuadraban los centros de los nodos, y un grafo de
    // un nodo tiene radio cero mientras su nombre mide treinta y dos unidades de
    // ancho. La cámara quedaba dentro del cartel.
    const box: Box = { min: { x: -16.25, y: -2, z: 0 }, max: { x: 16.25, y: 2, z: 0 } };
    const orbit = frameBox(box, PANEL);
    assert.ok(fits(box, orbit, PANEL), "el nombre tiene que caber entero");
    assert.ok(orbit.distance > 16, `la cámara quedó a ${orbit.distance}, dentro del cartel`);
  });

  test("un grafo grande llena el cuadro en vez de quedar como una mota", () => {
    const box = boxOf(200, 200, 200);
    const orbit = frameBox(box, PANEL);
    assert.ok(fits(box, orbit, PANEL));
    // Encuadrar la esfera envolvente en vez de la caja alejaría hasta √3 de más,
    // y eso es un grafo dibujado a la mitad en un panel vacío.
    const ajustado = frameBox(box, PANEL, 0, 0, 1);
    const proyectado = cornersOf(box).map((c) => project(c, ajustado, PANEL));
    const ancho = Math.max(...proyectado.map((p) => p.x)) - Math.min(...proyectado.map((p) => p.x));
    const alto = Math.max(...proyectado.map((p) => p.y)) - Math.min(...proyectado.map((p) => p.y));
    assert.ok(
      ancho >= PANEL.width - 1 || alto >= PANEL.height - 1,
      `el grafo ocupa ${Math.round(ancho)}×${Math.round(alto)} en un panel de ${PANEL.width}×${PANEL.height}`,
    );
  });

  test("cualquier caja cabe desde cualquier ángulo", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 800, noNaN: true }),
        fc.double({ min: 0, max: 800, noNaN: true }),
        fc.double({ min: 0, max: 800, noNaN: true }),
        fc.double({ min: -6.3, max: 6.3, noNaN: true }),
        fc.double({ min: -1.5, max: 1.5, noNaN: true }),
        (hx, hy, hz, azimuth, elevation) => {
          const box = boxOf(hx, hy, hz);
          const orbit = frameBox(box, PANEL, azimuth, elevation);
          assert.ok(
            fits(box, orbit, PANEL),
            `no cabe una caja de ${hx}×${hy}×${hz} desde ${azimuth}/${elevation}`,
          );
        },
      ),
      { numRuns: 2_000 },
    );
  });

  test("encuadrar no gira: se conserva desde dónde se estaba mirando", () => {
    const box = boxOf(50, 30, 20);
    const orbit = frameBox(box, PANEL, 1.2, -0.4);
    near(orbit.azimuth, 1.2);
    near(orbit.elevation, -0.4);
  });

  test("el centro del encuadre es el centro de lo que hay", () => {
    const box: Box = { min: { x: 10, y: 20, z: 30 }, max: { x: 30, y: 60, z: 90 } };
    const centre = centreOf(box);
    assert.deepEqual(centre, { x: 20, y: 40, z: 60 });
    assert.deepEqual(frameBox(box, PANEL).centre, centre);
  });

  test("una caja sin volumen no manda la cámara al infinito ni encima", () => {
    const punto = boxOf(0, 0, 0);
    const orbit = frameBox(punto, PANEL);
    assert.ok(Number.isFinite(orbit.distance));
    assert.ok(orbit.distance >= NEAR);
    assert.ok(fits(punto, orbit, PANEL));
  });

  test("hace falta más distancia para una caja más grande", () => {
    const chica = distanceToFit(boxOf(10, 10, 10), PANEL, 0, 0);
    const grande = distanceToFit(boxOf(100, 100, 100), PANEL, 0, 0);
    assert.ok(grande > chica);
  });

  test("una caja tiene ocho esquinas y no menos", () => {
    assert.equal(cornersOf(boxOf(1, 2, 3)).length, 8);
  });
});

describe("mover con dos dedos", () => {
  test("el mapa se corre exactamente lo que se corrieron los dedos", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -300, max: 300, noNaN: true }),
        fc.double({ min: -300, max: 300, noNaN: true }),
        fc.double({ min: -6.3, max: 6.3, noNaN: true }),
        fc.double({ min: -1.4, max: 1.4, noNaN: true }),
        (dx, dy, azimuth, elevation) => {
          const orbit: Orbit = {
            centre: { x: 0, y: 0, z: 0 },
            distance: 300,
            azimuth,
            elevation,
          };
          // Un punto del plano que la cámara tiene enfocado, o sea a la
          // distancia de la órbita. Con perspectiva, mover la cámara no puede
          // arrastrar por igual lo que está más cerca y lo que está más lejos
          // —eso es el paralaje, y es correcto—; el trato es con este plano.
          const { right, up } = basisOf(orbit);
          const punto = {
            x: orbit.centre.x + right.x * 30 - up.x * 20,
            y: orbit.centre.y + right.y * 30 - up.y * 20,
            z: orbit.centre.z + right.z * 30 - up.z * 20,
          };
          const antes = project(punto, orbit, PANEL);
          const despues = project(punto, panBy(orbit, dx, dy, PANEL), PANEL);
          // Tiene que haber recorrido en pantalla lo mismo que los dedos. Ni más
          // ni menos, y en el mismo sentido.
          near(despues.x - antes.x, dx, 1e-6);
          near(despues.y - antes.y, dy, 1e-6);
        },
      ),
      { numRuns: 2_000 },
    );
  });

  test("mover no gira ni acerca", () => {
    const orbit: Orbit = { centre: { x: 1, y: 2, z: 3 }, distance: 250, azimuth: 0.8, elevation: -0.2 };
    const movido = panBy(orbit, 40, -15, PANEL);
    near(movido.azimuth, orbit.azimuth);
    near(movido.elevation, orbit.elevation);
    near(movido.distance, orbit.distance);
  });

  test("un pellizco acerca y el contrario aleja, sin llegar nunca a cero", () => {
    const orbit: Orbit = { centre: { x: 0, y: 0, z: 0 }, distance: 200, azimuth: 0, elevation: 0 };
    assert.ok(zoomBy(orbit, 0.5).distance < orbit.distance);
    assert.ok(zoomBy(orbit, 2).distance > orbit.distance);
    assert.ok(zoomBy(orbit, 1e-12).distance >= MIN_DEPTH);
    assert.equal(zoomBy(orbit, 0).distance, orbit.distance);
    assert.equal(zoomBy(orbit, Number.NaN).distance, orbit.distance);
  });

  test("acercar hace las cosas más grandes", () => {
    const orbit: Orbit = { centre: { x: 0, y: 0, z: 0 }, distance: 200, azimuth: 0, elevation: 0 };
    const lejos = project({ x: 10, y: 0, z: 0 }, orbit, PANEL);
    const cerca = project({ x: 10, y: 0, z: 0 }, zoomBy(orbit, 0.5), PANEL);
    assert.ok(cerca.scale > lejos.scale);
  });
});

describe("girar en torno a la página que se lee", () => {
  test("el centro de la órbita es el punto pedido, no el centro de lo que hay", () => {
    const box: Box = { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 100, z: 100 } };
    const yo = { x: 90, y: 10, z: 50 };
    const orbit = frameAround(box, yo, PANEL);
    near(orbit.centre.x, yo.x, 1e-9);
    near(orbit.centre.y, yo.y, 1e-9);
    near(orbit.centre.z, yo.z, 1e-9);
  });

  test("y aun así no deja nada fuera de cuadro, mire desde donde mire", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 500, noNaN: true }),
        fc.double({ min: 0, max: 500, noNaN: true }),
        fc.double({ min: 0, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -6.3, max: 6.3, noNaN: true }),
        (hx, hy, hz, cx, cy, azimuth) => {
          const box = boxOf(hx, hy, hz);
          // El punto puede estar dentro de la caja o fuera: una página recién
          // abierta puede caer en cualquier parte del vecindario.
          const yo = { x: cx, y: cy, z: 0 };
          const orbit = frameAround(box, yo, PANEL, azimuth, 0.3);
          assert.ok(fits(box, orbit, PANEL), `no cabe con el centro en ${cx},${cy}`);
        },
      ),
      { numRuns: 2_000 },
    );
  });

  test("la caja estirada contiene a la original", () => {
    const box: Box = { min: { x: -5, y: -5, z: -5 }, max: { x: 10, y: 10, z: 10 } };
    const grown = expandAround(box, { x: 8, y: 0, z: -4 });
    assert.ok(grown.min.x <= box.min.x && grown.max.x >= box.max.x);
    assert.ok(grown.min.y <= box.min.y && grown.max.y >= box.max.y);
    assert.ok(grown.min.z <= box.min.z && grown.max.z >= box.max.z);
    near(centreOf(grown).x, 8);
  });
});
