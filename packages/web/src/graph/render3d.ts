/**
 * El mapa en tres dimensiones, dibujado en SVG.
 *
 * Antes esto era WebGL —`3d-force-graph` sobre three.js— y se rompía cada pocos
 * días de una manera nueva: el contexto se perdía sin avisar, el destructor de
 * la librería dejaba el grafo a medias mientras un cuadro seguía en vuelo, los
 * nombres eran texturas de lienzo con su espacio de color y su densidad de
 * píxeles. Y sobre todo: cuando el mapa no se veía, no había nada que mirar. Un
 * lienzo es opaco a la inspección. No se podía saber si el dibujo estaba vacío,
 * si la cámara estaba dentro de un nombre, o si el contexto había muerto —los
 * tres se ven exactamente igual, que es un rectángulo transparente—, y cada
 * arreglo era una conjetura sobre un síntoma mudo.
 *
 * En SVG cada nodo es un elemento. `querySelector` funciona. Se ve dónde está
 * cada cosa, con qué tamaño y en qué orden. La vista en 2D de Vera lleva desde
 * el principio así y no ha dado ninguno de estos problemas.
 *
 * Lo que había que escribir a mano —la cámara y la órbita— vive en `camera3d.ts`
 * y son funciones puras con pruebas. Aquí sólo queda el DOM.
 *
 * @guarantee GraphNodesAreTheirNames
 * @guarantee TheMapHoldsItsPositions
 * @guarantee TheMapArrivesFramed
 */

import * as d3 from "d3";
// @ts-expect-error d3-force-3d no publica tipos
import { forceCenter, forceLink, forceManyBody, forceSimulation } from "d3-force-3d";
import type { GraphData, GraphNode } from "./types.ts";
import type { RenderSettings } from "./render";
import { type Moving, runs, spineForce } from "./spine.ts";
import { icon } from "../icons.ts";
import {
  advanceAutoRotation,
  clampElevation,
  frameAround,
  frameBox,
  panBy,
  project,
  zoomBy,
  type Box,
  type Lens,
  type Orbit,
  type Point,
} from "./camera3d.ts";

/** El espacio de nombres de SVG, que `createElement` no adivina. */
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Cuánto mide un nombre corriente en unidades del grafo.
 *
 * El texto se dibuja con perspectiva: un nombre lejano sale más pequeño porque
 * está lejos, no porque una tabla lo diga. Para eso su tamaño tiene que estar en
 * unidades del mundo, como su posición.
 *
 * Cuatro unidades contra los sesenta que separan a dos páginas vinculadas: un
 * nombre ocupa la quinceava parte de un vínculo, que es más o menos como se ve
 * en el mapa de dos dimensiones.
 */
const WORLD_FONT = 4;
const WORLD_FONT_CENTRAL = 5.5;

/**
 * Y cuánto se le deja medir en pantalla, pase lo que pase con la cámara.
 *
 * La perspectiva es correcta pero no es negociable con la legibilidad: por
 * debajo del suelo un nombre es una mancha, y por encima del techo tapa a sus
 * vecinos. Se acota en pantalla y no en el mundo, que es donde importa.
 *
 * El par era 8 y 22, calibrado a ojo y corto: con el mapa lleno, casi todos los
 * nombres caían en el suelo y el mapa se leía como una mancha gris de la que
 * había que acercarse para sacar cualquier palabra. Después pasó a 10 y 27,5.
 * El rango vigente —11 y 31— abre un poco más ambos extremos: el suelo gana
 * legibilidad y el techo presencia, sin dejar que un nombre cercano se coma el
 * vecindario.
 */
const SCREEN_FONT_MIN = 11;
const SCREEN_FONT_MAX = 31;

/** Un nombre se parte antes de atravesar el mapa. Igual que en dos dimensiones. */
const MAX_LABEL_CHARS = 24;

/** Ancho de un carácter en emes, para estimar cuánto ocupa un nombre. */
const CHAR_EM = 0.55;
/** Alto de una línea en emes. */
const LINE_EM = 1.25;

/** Cuánto gira el mapa por píxel arrastrado. Media pantalla, media vuelta. */
const TURN_PER_PIXEL = Math.PI / 320;

// ---------------------------------------------------------------------------
// Memoria del mapa. Sobrevive entre dibujos: un mapa que se recoloca solo deja
// de poder recorrerse.
// ---------------------------------------------------------------------------

/**
 * Dónde quedó cada nodo.
 *
 * @guarantee TheMapHoldsItsPositions. Es el `positions` de dos dimensiones, y
 * está aquí por lo mismo: ir a una página vecina no debe rehacer el mapa entero.
 */
const positions = new Map<string, Point>();

/** Desde dónde se estaba mirando. */
let heldOrbit: Orbit | null = null;
/** El último recorrido que se encuadró, para no reencuadrar en cada repintado. */
let framed: string | null = null;

/**
 * De qué grafo es esa órbita.
 *
 * Unas coordenadas sólo quieren decir algo dentro del reparto de nodos para el
 * que se midieron. Sin esto, cambiar de página dejaba la cámara apuntando a
 * donde ya no había nadie.
 */
let heldFor: string | null = null;

/** El nodo señalado, que se conserva entre dibujos como las posiciones. */
let selected: string | null = null;

/** Lo vivo ahora mismo, para poder desmontarlo. */
let teardown: (() => void) | null = null;

/**
 * Si lo que gira la rueda es un trackpad y no una rueda de ratón.
 *
 * Hace falta distinguirlos porque piden cosas contrarias del mismo evento: dos
 * dedos sobre un trackpad quieren correr el mapa, y una rueda de ratón quiere
 * acercarlo. El navegador no dice cuál es, así que se deduce y se recuerda: una
 * vez visto un trackpad, sigue siéndolo mientras dure la sesión. Es preferible a
 * decidirlo evento por evento, que haría que un deslizamiento casi vertical
 * corriera el mapa y uno exactamente vertical lo acercara.
 *
 * Quien use ratón y quiera correr el mapa tiene Shift y el botón de en medio;
 * quien use trackpad y quiera acercar tiene el pellizco. Ninguno se queda sin
 * nada por culpa de la deducción.
 */
let trackpad = false;

/**
 * Las dos señales que sólo da un trackpad.
 *
 * Una rueda de ratón gira en un solo eje y en pasos enteros. Un desplazamiento
 * de dos dedos casi siempre trae algo de horizontal, y sus pasos son fracciones
 * porque vienen de medir un dedo y no de contar dientes.
 */
function looksLikeTrackpad(event: WheelEvent): boolean {
  return event.deltaX !== 0 || !Number.isInteger(event.deltaY);
}

/** Olvida la cámara y lo colocado. Para cuando el grafo cambia de veras. */
export function forgetCamera(): void {
  heldOrbit = null;
  framed = null;
  heldFor = null;
  positions.clear();
}

/** Señala un nodo desde fuera, para que abrir una página lo marque en el mapa. */
export function selectNode3D(id: string | null): void {
  selected = id;
}

/** Desmonta el mapa: quita los oyentes y para la simulación. */
export function cleanupGraph3D(): void {
  teardown?.();
  teardown = null;
}

/**
 * Qué grafo es éste, para saber si la órbita guardada sigue queriendo decir algo.
 *
 * El separador tiene que ser algo que no pueda aparecer en un identificador, o
 * dos repartos distintos darían la misma firma: pegados sin nada en medio,
 * `["ab","c"]` y `["a","bc"]` se escriben igual.
 */
function signatureOf(ids: string[]): string {
  return [...ids].sort().join("\n");
}

/** Parte un nombre por palabras, sin pasar de `maxChars` por línea. */
function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && current.length + 1 + word.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

/** Un nodo ya preparado para dibujarse, con su sitio y sus elementos. */
type Drawn = {
  node: GraphNode;
  lines: string[];
  /** Caracteres de la línea más larga, para dimensionar la zona sensible. */
  longest: number;
  /** Cuánto ocupa su nombre en unidades del grafo. */
  halfWidth: number;
  halfHeight: number;
  fontWorld: number;
  group: SVGGElement;
  texts: SVGTextElement[];
  /** La flecha que abre, al final del nombre. Null si el nodo no lleva nombre. */
  open: SVGGElement | null;
  /** Profundidad de la última proyección, para ordenar por lejanía. */
  depth: number;
  /** Dónde y de qué tamaño quedó en pantalla, para poder saber a qué se apunta. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

export function renderGraph3D(
  container: HTMLElement,
  data: GraphData,
  onClickPage: (pageName: string) => void,
  settings: RenderSettings = {},
): void {
  cleanupGraph3D();
  container.innerHTML = "";

  const dark = settings.dark ?? false;
  const showEdges = settings.showEdges ?? true;
  const showTitles = settings.showTitles ?? true;

  const rootEl = document.getElementById("vera-root");
  const cs = rootEl === null ? null : getComputedStyle(rootEl);
  const cssVar = (name: string, fallback: string): string => {
    const value = cs?.getPropertyValue(name).trim();
    return value === undefined || value === "" ? fallback : value;
  };

  /*
   * Los mismos tokens que el mapa de dos dimensiones, con los mismos nombres y
   * las mismas reservas.
   *
   * @guarantee EditableDesignSystem. Las dos vistas son el mismo mapa desde otro
   * ángulo, así que tocar `--link-stroke` en Ajustes tiene que cambiarlas a las
   * dos. Mientras esta lista fue distinta —un `#ef7a1c` a mano donde 2D usaba
   * `--warm`— cambiar el sistema de diseño dejaba el mapa en 3D hablando de
   * colores que ya no existían en ninguna otra parte.
   */
  const colors = {
    nodeCentral: cssVar("--node-central", dark ? "#4a9ade" : "#045591"),
    // Los nombres corrientes van atenuados, igual que en 2D: lo que se busca en
    // un mapa es lo excepcional, y si todo pesa igual no destaca nada.
    textNormal: cssVar("--node-fill", dark ? "#6d7480" : "#9aa0ab"),
    linkStroke: cssVar("--link-stroke", dark ? "#333842" : "#d5d7d2"),
    accent: cssVar("--accent", dark ? "#4a9ade" : "#045591"),
    visited: cssVar("--warm", "#ef7a1c"),
    // Las dos direcciones, como en 2D y como en el pie de la página: el código
    // de color de un enlace no puede cambiar según desde qué vista se mire.
    linkIn: cssVar("--link-in", dark ? "#6fa8d0" : "#045591"),
    linkOut: cssVar("--link-out", dark ? "#ee895d" : "#a84a0b"),
  };

  /**
   * Por dónde se ha pasado, desvaneciéndose con la distancia en el rastro.
   *
   * La misma escalera y el mismo `color-mix` que en dos dimensiones: lo último
   * visitado va entero y lo de hace cinco páginas apenas se insinúa.
   */
  const historyColor = (id: string): string | null => {
    const idx = historyMap.get(id.toLowerCase());
    if (idx === undefined) return null;
    const strength = [1, 0.7, 0.5, 0.3, 0.15][idx] ?? 0.15;
    return `color-mix(in srgb, ${colors.visited} ${strength * 100}%, transparent)`;
  };

  const fontFamily = settings.fontFamily ?? "system-ui, -apple-system, sans-serif";

  // Por dónde se ha pasado, para colorear el rastro.
  const historyTail = (settings.history ?? []).slice(-5).reverse();
  const historyMap = new Map<string, number>();
  historyTail.forEach((name, i) => {
    const key = name.toLowerCase();
    if (!historyMap.has(key)) historyMap.set(key, i);
  });

  /*
   * Si este grafo no es aquel, la órbita guardada no dice nada y se tira.
   *
   * Conservar la vista es conservar un lugar, y un lugar sólo existe mientras
   * exista el reparto de nodos que lo definía.
   */
  const signature = signatureOf(data.nodes.map((n) => n.id));
  if (heldFor !== null && heldFor !== signature) heldOrbit = null;
  heldFor = signature;

  // ---------------------------------------------------------------------
  // Los datos, con lo que ya se sabía de dónde estaba cada uno.
  // ---------------------------------------------------------------------
  let allPlaced = data.nodes.length > 0;
  /** Cuántos de los que hay ya tenían sitio de antes. */
  let known = 0;
  const nodes = data.nodes.map((n) => {
    const node: GraphNode & Point = { ...n, x: 0, y: 0, z: 0 };
    const held = positions.get(n.id);
    if (held === undefined) {
      allPlaced = false;
      // Sin sitio previo, que la simulación decida. `undefined` es lo que
      // d3-force espera para «colócalo tú».
      return Object.assign(node, { x: undefined, y: undefined, z: undefined }) as GraphNode & Point;
    }
    known += 1;
    /*
     * Y los que ya estaban se quedan clavados donde estaban.
     *
     * @guarantee TheMapHoldsItsPositions. Sembrar la posición no bastaba: la
     * simulación arranca con toda su energía y en dos vueltas ha movido a todo
     * el mundo, así que abrir una página vecina rehacía el mapa entero aunque
     * nueve de cada diez nodos fueran los mismos. Y un mapa que se recoloca
     * mientras uno lo mira no se puede recordar: reconocer una región por su
     * forma es para lo que sirve dibujarla.
     *
     * `fx/fy/fz` es la manera que tiene d3 de decir «éste no se toca». Los que
     * llegan nuevos buscan sitio entre los que ya estaban, que es exactamente lo
     * que pasa cuando uno se mueve un salto: el barrio no cambia, cambia dónde
     * está uno parado.
     */
    return Object.assign(node, held, { fx: held.x, fy: held.y, fz: held.z });
  });

  /*
   * Y si no quedó nada del reparto anterior, la órbita tampoco vale.
   *
   * Las dos memorias son una sola cosa: unas coordenadas sólo dicen algo dentro
   * del reparto en que se midieron. Guardar la cámara sin guardar los sitios era
   * lo que dejaba el mapa mirando el vacío al volver de la vista de dos
   * dimensiones.
   *
   * Basta con que quede algo. Antes se exigía que estuvieran *todos*, y con eso
   * cualquier página nueva en el vecindario tiraba la cámara: se perdía la vista
   * por un nodo de cincuenta. Si el sitio de los que ya estaban se conserva —y
   * ahora se conserva, van clavados—, la cámara sigue queriendo decir lo mismo.
   */
  /*
   * La camara esta anclada al nodo en foco, asi que lo que decide si sigue
   * valiendo es si sabemos donde esta *ese* nodo. Nada mas.
   *
   * Aqui pedia que siguiera conocida la mitad del vecindario, y eso hacia que
   * volver de un vecindario pequeno a uno grande tirara la camara: medido, ir de
   * 154 nodos a 21 conserva los 21 y va suave, pero volver conoce 21 de 154 —no
   * llega a la mitad— y reencuadraba de golpe. El mismo viaje, de ida bien y de
   * vuelta a tirones, por una regla que contaba lo que no habia que contar.
   *
   * Si el foco es una pagina que no habiamos visto nunca no hay donde anclar, y
   * entonces si toca encuadrar de nuevo.
   */
  const focusId = data.nodes.find((n) => n.central === true)?.id ?? null;
  const remembered = known > 0 && focusId !== null && positions.has(focusId);
  if (!remembered) heldOrbit = null;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = data.links
    .map((l) => ({
      source: typeof l.source === "string" ? l.source : l.source.id,
      target: typeof l.target === "string" ? l.target : l.target.id,
    }))
    .filter((l) => byId.has(l.source) && byId.has(l.target));

  // ---------------------------------------------------------------------
  // El armazón del SVG. Las aristas primero y los nombres después, que es lo
  // que pide poder leerlos: en SVG el orden de pintado es el orden de los
  // hermanos, así que esto no es una preferencia que haya que confiar a nadie
  // sino la estructura del documento.
  // ---------------------------------------------------------------------
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "map3d");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.display = "block";
  svg.style.touchAction = "none";
  svg.style.cursor = "grab";
  // Sin esto, el segundo pulso de un doble clic selecciona el nombre como si
  // fuera texto de un documento y lo deja resaltado en azul.
  svg.style.userSelect = "none";

  const edgeLayer = document.createElementNS(SVG_NS, "g");
  edgeLayer.setAttribute("class", "map3d-edges");
  edgeLayer.setAttribute("stroke", colors.linkStroke);
  edgeLayer.setAttribute("stroke-width", "1");
  edgeLayer.setAttribute("fill", "none");
  if (!showEdges) edgeLayer.style.display = "none";

  /*
   * El hilo del recorrido abierto, entre las aristas y los nombres.
   *
   * Debajo de los nombres para no taparlos y encima de las aristas porque es lo
   * que se viene a ver. En tres dimensiones el hilo se proyecta como todo lo
   * demás: son los mismos puntos, mirados desde donde esté la cámara.
   */
  const threadLayer = document.createElementNS(SVG_NS, "g");
  threadLayer.setAttribute("class", "thread-layer");

  const nodeLayer = document.createElementNS(SVG_NS, "g");
  nodeLayer.setAttribute("class", "map3d-nodes");
  nodeLayer.setAttribute("font-family", fontFamily);
  nodeLayer.setAttribute("text-anchor", "middle");
  /*
   * Los nombres no escuchan al puntero; escucha el mapa y decide él.
   *
   * Aquí hubo un rectángulo transparente por nombre, puesto para poder acertarle
   * a un nombre de ocho píxeles sin tener que dar en la tinta. Y fue peor: un
   * nombre de veinticuatro letras ocupa ciento catorce píxeles de ancho, así que
   * a poca densidad esos rectángulos se tapan unos a otros y el de encima —el
   * más cercano a la cámara— se quedaba con los clics de todos los de detrás.
   * Medido: apuntando al centro del rectángulo de un nombre, el clic lo recibía
   * otro. Por eso pulsar dos veces no abría nada: cada pulsación podía resolver
   * a un nodo distinto y nunca llegaban a ser dos sobre el mismo.
   *
   * Acertar es una cuenta, no una cuestión de en qué orden quedaron los hermanos.
   */
  nodeLayer.setAttribute("pointer-events", "none");

  svg.append(edgeLayer, threadLayer, nodeLayer);
  container.append(svg);

  // ---------------------------------------------------------------------
  // Un elemento por nodo y uno por arista, creados una vez. Después sólo se
  // les mueven los atributos: crear y destruir elementos en cada cuadro es lo
  // único que hace lento a SVG.
  // ---------------------------------------------------------------------
  const drawn: Drawn[] = nodes.map((node) => {
    const lines = showTitles ? wrapText(node.name, MAX_LABEL_CHARS) : [];
    const fontWorld = node.central === true ? WORLD_FONT_CENTRAL : WORLD_FONT;
    const longest = lines.reduce((most, line) => Math.max(most, line.length), 0);

    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", node.trail === true ? "map3d-node trail-node" : "map3d-node");
    /*
     * La página del recorrido abierto deja de dibujarse como nodo.
     *
     * Sigue en la simulación —sus enlaces son los que mantienen a sus paradas
     * juntas— y sólo se deja de pintar: un argumento no está *al lado* de sus
     * premisas sino *entre* ellas. @guarantee TheTrailsNodeBecomesTheThread.
     */
    if (settings.thread != null && node.id === settings.thread.page) {
      group.setAttribute("display", "none");
    }
    group.dataset["id"] = node.id;
    group.style.cursor = "pointer";

    const texts = lines.map((line, i) => {
      const text = document.createElementNS(SVG_NS, "text");
      text.textContent = line;
      // El bloque de líneas va centrado en el nodo, no colgando de él.
      text.dataset["row"] = String(i - (lines.length - 1) / 2);
      group.append(text);
      return text;
    });

    /*
     * La flecha que abre, como un carácter más al final del nombre.
     *
     * Existe desde el principio y se enseña sólo al señalar: crearla en ese
     * momento obligaría a tocar el DOM en mitad de un gesto, que es justo lo que
     * este dibujo evita en todas partes. Escondida no cuesta nada.
     */
    const open = lines.length > 0 ? document.createElementNS(SVG_NS, "g") : null;
    if (open !== null) {
      open.setAttribute("class", "map3d-open");
      open.setAttribute("display", "none");
      /*
       * La única excepción a la capa sorda de arriba, y por la razón que la hizo
       * sorda: lo que estorbaba era que ochenta rectángulos transparentes se
       * taparan unos a otros y el de delante se quedara con los clics de los de
       * detrás. Aquí no hay ochenta: hay uno, el del nombre señalado, y los
       * demás están en `display:none`, que no recibe nada. Con un solo blanco en
       * pie el navegador acierta mejor que ninguna cuenta.
       */
      open.setAttribute("pointer-events", "auto");
      open.innerHTML = icon("arrow-up-right");
      const glyph = open.firstElementChild;
      if (glyph !== null) {
        glyph.setAttribute("class", "map3d-open-arrow");
        glyph.setAttribute("stroke", colors.accent);
      }

      /*
       * El marco, encendido sólo con el puntero sobre la flecha misma.
       *
       * Señalar el nombre enciende la flecha; señalar la flecha tiene que decir
       * otra cosa, porque es otro gesto con otra consecuencia —el nombre sólo
       * selecciona, la flecha abre—. Sin esto, entre estar a punto de
       * seleccionar y estar a punto de irse de la página no había ninguna
       * diferencia visible, y la única forma de saber cuál de las dos iba a
       * pasar era pulsar.
       */
      const frame = document.createElementNS(SVG_NS, "rect");
      frame.setAttribute("class", "map3d-open-frame");
      frame.setAttribute("fill", "none");
      frame.setAttribute("stroke", colors.accent);
      frame.setAttribute("opacity", "0");
      frame.style.transition = "opacity 0.12s";
      open.insertBefore(frame, open.firstChild);

      // El blanco al que se apunta: el trazo es una línea de dos píxeles, y
      // pedir puntería sobre una línea es pedir que no se use.
      const target = document.createElementNS(SVG_NS, "rect");
      target.setAttribute("fill", "transparent");
      open.append(target);

      open.addEventListener("mouseenter", () => frame.setAttribute("opacity", "1"));
      open.addEventListener("mouseleave", () => frame.setAttribute("opacity", "0"));
      group.append(open);
    }

    // El halo de las páginas por las que se acaba de pasar. Va detrás del texto
    // y con el mismo texto, engordado: en SVG un contorno es un `stroke` bajo el
    // relleno, y así el nombre se despega del fondo sin caja ninguna.
    const hist = historyMap.get(node.id.toLowerCase());
    if (hist !== undefined) {
      group.dataset["hist"] = String(hist);
    }

    nodeLayer.append(group);
    return {
      node,
      lines,
      longest,
      halfWidth: (longest * CHAR_EM * fontWorld) / 2,
      halfHeight: (lines.length * LINE_EM * fontWorld) / 2,
      fontWorld,
      group,
      texts,
      open,
      depth: 0,
      sx: 0,
      sy: 0,
      sw: 0,
      sh: 0,
    };
  });

  const drawnById = new Map(drawn.map((d) => [d.node.id, d]));

  /*
   * Con quien se nombra cada pagina, para poder encenderlo al pasar por encima.
   *
   * Se arma una vez y no en cada movimiento del raton: recorrer las novecientas
   * aristas por cada pixel que se mueve el puntero es lo unico que podria hacer
   * lento a esto.
   */
  const neighbours = new Map<string, Set<string>>();
  for (const l of links) {
    if (!neighbours.has(l.source)) neighbours.set(l.source, new Set());
    if (!neighbours.has(l.target)) neighbours.set(l.target, new Set());
    (neighbours.get(l.source) as Set<string>).add(l.target);
    (neighbours.get(l.target) as Set<string>).add(l.source);
  }

  /*
   * Los tramos del recorrido, si hay uno abierto.
   *
   * Un tramo cuyo extremo no está en este vecindario no se puede dibujar: no hay
   * adónde. Se deja fuera en vez de dibujarlo hacia el vacío, y el número que
   * falta en la cadena dice que faltaba.
   */
  const thread = settings.thread ?? null;
  /*
   * Si es la primera vez que se dibuja este recorrido.
   *
   * Se mira aquí y no abajo, junto a las fuerzas, porque `framed` lo escribe
   * `fit()` en cuanto encuadra, y para entonces la respuesta ya sería que no.
   */
  const opening = thread !== null && thread.page !== framed;
  const threads: { line: SVGLineElement; a: Point; b: Point }[] = [];
  /*
   * El número va sobre el nombre y no sobre el punto donde está.
   *
   * Con un desplazamiento fijo, en cuanto el encuadre acerca las paradas el
   * número queda dentro del nombre y no se lee ninguno de los dos. Se guarda el
   * nodo dibujado, que en cada cuadro sabe cuánto mide en pantalla.
   */
  const stopMarks: { text: SVGTextElement; of: string }[] = [];

  if (thread !== null) {
    thread.kinds.forEach((kind, at) => {
      const from = thread.stops[at]?.page;
      const to = thread.stops[at + 1]?.page;
      const a = from == null ? undefined : byId.get(from);
      const b = to == null ? undefined : byId.get(to);
      if (a === undefined || b === undefined) return;
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("class", kind === "by_path" ? "thread" : "thread open-ground");
      threadLayer.append(line);
      threads.push({ line, a, b });
    });
    for (const stop of thread.stops) {
      if (stop.page == null || byId.get(stop.page) === undefined) continue;
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("class", "thread-stop");
      text.setAttribute("text-anchor", "middle");
      text.textContent = String(stop.ordinal);
      threadLayer.append(text);
      stopMarks.push({ text, of: stop.page });
    }
  }

  const edges = links.map((l) => {
    const line = document.createElementNS(SVG_NS, "line");
    edgeLayer.append(line);
    return {
      line,
      a: l.source,
      b: l.target,
      source: byId.get(l.source) as Point,
      target: byId.get(l.target) as Point,
    };
  });

  // ---------------------------------------------------------------------
  // La cámara.
  // ---------------------------------------------------------------------
  const lensNow = (): Lens => ({
    fov: 50,
    width: container.clientWidth,
    height: container.clientHeight,
  });

  let orbit: Orbit = heldOrbit ?? {
    centre: { x: 0, y: 0, z: 0 },
    distance: 400,
    azimuth: 0,
    elevation: 0,
  };
  /** Si alguien ya decidió desde dónde mira. Encuadrar por encima sería quitarle el mapa. */
  let moved = heldOrbit !== null;

  /**
   * Sobre que nombre esta el puntero, y con quien se nombra ese nombre.
   *
   * @guarantee GraphNodesAreTheirNames. Pasar por encima de una pagina apaga
   * todo lo demas y enciende lo que ella nombra: es la manera de leer una arista
   * en un dibujo donde hay novecientas. En dos dimensiones esto existe desde el
   * principio; aqui faltaba, y sin ello las aristas eran una maraña que no se
   * podia interrogar.
   */
  let hovered: string | null = null;
  let lit: Set<string> = new Set();

  /** La caja que ocupa el grafo, midiendo los nombres y no sólo sus centros. */
  const graphBox = (): Box | null => {
    let any = false;
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const d of drawn) {
      const { x, y, z } = d.node as GraphNode & Partial<Point>;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      // Aquí estuvo el fallo que este mapa arrastró meses: encuadrar los centros
      // de los nodos. Un nodo es su nombre, y un nombre de diez letras mide
      // treinta unidades: un grafo de un solo nodo tiene radio cero medido entre
      // centros, y encuadrar ese cero deja la cámara dentro del nombre.
      min.x = Math.min(min.x, (x as number) - d.halfWidth);
      max.x = Math.max(max.x, (x as number) + d.halfWidth);
      min.y = Math.min(min.y, (y as number) - d.halfHeight);
      max.y = Math.max(max.y, (y as number) + d.halfHeight);
      min.z = Math.min(min.z, z as number);
      max.z = Math.max(max.z, z as number);
      any = true;
    }
    return any ? { min, max } : null;
  };

  /**
   * La caja de un recorrido: sólo sus paradas, y no el vecindario entero.
   *
   * @guarantee TheWholeShapeAtOnce. Un hilo con la primera parada fuera de
   * cuadro no enseña una forma, enseña un trozo, y la forma del argumento —un
   * tramo recto, un rodeo que vuelve, una estrella desde un solo sitio— es lo
   * que hace que un recorrido se recuerde: por su dibujo, como se recuerda una
   * región del mapa.
   */
  const threadBox = (): { box: Box; centre: Point } | null => {
    if (thread === null) return null;
    const wanted = new Set(thread.stops.map((one) => one.page).filter((one) => one !== null));
    let any = false;
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const d of drawn) {
      if (!wanted.has(d.node.id)) continue;
      const { x, y, z } = d.node as GraphNode & Partial<Point>;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      min.x = Math.min(min.x, (x as number) - d.halfWidth);
      max.x = Math.max(max.x, (x as number) + d.halfWidth);
      min.y = Math.min(min.y, (y as number) - d.halfHeight);
      max.y = Math.max(max.y, (y as number) + d.halfHeight);
      min.z = Math.min(min.z, z as number);
      max.z = Math.max(max.z, z as number);
      any = true;
    }
    if (!any) return null;
    /*
     * Se gira en torno al medio del recorrido y no a la página abierta.
     *
     * La página abierta es la del recorrido, y es justo la que no se dibuja: un
     * argumento no está al lado de sus premisas sino entre ellas, así que girar
     * en torno a ella sería girar en torno a un sitio vacío.
     */
    return {
      box: { min, max },
      centre: {
        x: (min.x + max.x) / 2,
        y: (min.y + max.y) / 2,
        z: (min.z + max.z) / 2,
      },
    };
  };

  /**
   * La página que se está leyendo, que es en torno a lo que gira el mapa.
   *
   * El servidor marca como `central` el centro del vecindario, que es la página
   * en foco. Si por lo que sea no viniera marcada, se cae al nodo señalado.
   */
  const focus = (): (GraphNode & Partial<Point>) | null => {
    const central = nodes.find((n) => n.central === true);
    if (central !== undefined) return central;
    if (selected === null) return null;
    return (byId.get(selected) as (GraphNode & Partial<Point>) | undefined) ?? null;
  };

  /**
   * Poner la cámara donde el grafo entero se vea, girando en torno a la página
   * que se lee y sin cambiar desde dónde se mira.
   *
   * El centro de la órbita no es el centro de masa del vecindario sino uno
   * mismo: un mapa contesta «dónde estoy», y arrastrar tiene que dar vueltas
   * alrededor de la página en foco, no alrededor de un punto que se desplaza
   * cada vez que entra o sale un vecino. Encuadrar sigue siendo meter el
   * vecindario entero en cuadro; lo que cambia es en torno a qué.
   *
   * @guarantee TheMapArrivesFramed
   */
  const fit = (): void => {
    /*
     * Un recorrido recién abierto se encuadra aunque alguien haya movido la
     * cámara antes, y una sola vez. Abrir un argumento es pedir verlo entero; si
     * el encuadre no llegara, el hilo estaría dibujado en una esquina y lo que
     * se prometió —la forma— no se vería.
     */
    if (thread !== null && thread.page !== framed) {
      const mine = threadBox();
      if (mine !== null) {
        orbit = frameAround(mine.box, mine.centre, lensNow(), orbit.azimuth, orbit.elevation);
        framed = thread.page;
        moved = true;
        return;
      }
    }
    if (moved) return;
    const box = graphBox();
    if (box === null) return;
    const lens = lensNow();
    const yo = focus();
    orbit =
      yo === null || !Number.isFinite(yo.x) || !Number.isFinite(yo.y) || !Number.isFinite(yo.z)
        ? frameBox(box, lens, orbit.azimuth, orbit.elevation)
        : frameAround(
            box,
            { x: yo.x as number, y: yo.y as number, z: yo.z as number },
            lens,
            orbit.azimuth,
            orbit.elevation,
          );
  };

  /**
   * Lleva el centro de la orbita a otro punto moviendose, no de un cuadro al otro.
   *
   * Es la diferencia entre que el mapa se desplace y que parpadee. Un salto
   * instantaneo obliga a quien mira a reconocer de nuevo donde esta —nada le dice
   * que lo de antes y lo de ahora son el mismo dibujo— mientras que trescientos
   * milisegundos de recorrido lo dicen solos. El resto de la camara no se toca:
   * el angulo y la distancia son de quien mira.
   *
   * La suavizacion es la de siempre, mas rapida al principio y frenando al
   * final, que es como se para algo que tiene peso.
   */
  let gliding: number | null = null;
  const glideTo = (to: Point, ms = 320): void => {
    if (gliding !== null) cancelAnimationFrame(gliding);
    const from = orbit.centre;
    const spans = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    // Un salto de nada no merece recorrido: se pone y ya.
    if (Math.hypot(spans.x, spans.y, spans.z) < 1e-3 || ms <= 0) {
      orbit = { ...orbit, centre: to };
      heldOrbit = orbit;
      paint();
      sortByDepth();
      return;
    }
    const started = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - started) / ms);
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      orbit = {
        ...orbit,
        centre: {
          x: from.x + spans.x * eased,
          y: from.y + spans.y * eased,
          z: from.z + spans.z * eased,
        },
      };
      heldOrbit = orbit;
      paint();
      if (t < 1) {
        gliding = requestAnimationFrame(step);
        return;
      }
      gliding = null;
      sortByDepth();
    };
    gliding = requestAnimationFrame(step);
  };

  // ---------------------------------------------------------------------
  // Pintar. Es lo único que corre por cuadro, así que va escrito para no
  // reservar memoria ni tocar el DOM más de lo necesario.
  // ---------------------------------------------------------------------
  const paint = (): void => {
    const lens = lensNow();
    if (lens.width < 1 || lens.height < 1) return;

    for (const d of drawn) {
      const n = d.node as GraphNode & Partial<Point>;
      const at = project(
        { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 },
        orbit,
        lens,
      );
      d.depth = at.depth;

      const px = Math.min(
        Math.max(d.fontWorld * at.scale, SCREEN_FONT_MIN),
        SCREEN_FONT_MAX,
      );
      d.group.setAttribute("transform", `translate(${at.x.toFixed(1)},${at.y.toFixed(1)})`);
      d.group.setAttribute("font-size", px.toFixed(2));

      /*
       * El mismo orden de precedencia que en dos dimensiones: lo señalado gana
       * al rastro, y el rastro gana a la página en foco y a lo corriente.
       */
      const central = d.node.central === true;
      const isSelected = selected !== null && d.node.id === selected;
      const visited = historyColor(d.node.id);
      let fill = colors.textNormal;
      if (isSelected) fill = colors.accent;
      else if (visited !== null) fill = visited;
      else if (central) fill = colors.nodeCentral;
      d.group.setAttribute("fill", fill);
      d.group.setAttribute("font-weight", central || isSelected ? "bold" : "normal");

      // La lejanía se lee también en la tinta: lo de atrás se desvanece, que es
      // lo que da profundidad a un dibujo plano. Sin esto el mapa se ve como una
      // maraña de nombres del mismo peso.
      //
      // Lo señalado, lo visitado y la página en foco se desvanecen menos: son
      // respuestas a «dónde estoy» y quedarían ilegibles justo cuando la órbita
      // las manda al fondo, que es cuando más falta hace no perderlas de vista.
      const floor = isSelected || central || visited !== null ? 0.55 : 0.28;
      let alpha = lejania(at.depth, orbit.distance, floor);

      /*
       * Y con el puntero sobre un nombre, todo lo demas se aparta.
       *
       * Los mismos valores que en dos dimensiones —dos decimas lo ajeno, uno
       * entero lo vinculado— porque es el mismo gesto contestando la misma
       * pregunta: con quien se nombra esta pagina. La profundidad deja de pesar
       * mientras dura: lo que se esta preguntando es quien esta conectado con
       * quien, no quien esta delante.
       */
      if (hovered !== null) alpha = lit.has(d.node.id) ? 1 : 0.2;
      d.group.setAttribute("opacity", alpha.toFixed(2));

      for (let i = 0; i < d.texts.length; i++) {
        const text = d.texts[i] as SVGTextElement;
        const row = Number(text.dataset["row"] ?? 0);
        text.setAttribute("y", (row * px * LINE_EM).toFixed(1));
      }

      /*
       * Y la flecha, pegada al final de la última línea del nombre.
       *
       * Sólo la del nombre señalado: cincuenta flechas quietas serían ruido, y
       * lo que se está preguntando al señalar es por una página, no por todas.
       * Va al final de la última línea y no al borde de la caja porque la última
       * puede ser la más corta, y una flecha flotando lejos del texto no se lee
       * como parte de él.
       *
       * Del alto de media versal y pegada al nombre, como en dos dimensiones.
       * Feather dibuja esta flecha entre 7 y 17 de un lienzo de 24, y con el
       * trazo y sus remates la tinta llega a doce de veinticuatro: lo que se ve
       * es la mitad del lienzo. Es un diacrítico y no una segunda palabra —lo
       * que dice lo dice igual pequeña, y grande compite con el nombre.
       */
      if (d.open !== null) {
        if (hovered === d.node.id) {
          const last = d.lines[d.lines.length - 1] ?? '';
          const width = last.length * CHAR_EM * px;
          const baseline = ((d.lines.length - 1) / 2) * px * LINE_EM;
          const glyph = px * 0.35;
          const canvas = glyph * 2.4;
          /** Media tinta: el trazo llega a seis de los veinticuatro del lienzo. */
          const ink = canvas / 4;
          // El aire hasta la flecha y el que el marco deja alrededor de ella.
          // Van juntos: el borde izquierdo del marco cae en `gap - pad` desde el
          // final del nombre, así que holgar el marco se come la separación y
          // termina pisando la última letra. Los mismos que en dos dimensiones.
          const gap = px * 0.32;
          const pad = px * 0.18;
          const cx = width / 2 + ink + gap;
          // A media altura de la letra y no de la flecha: lo que la alinea con
          // el nombre es el ojo de las minúsculas, no su propio tamaño.
          const cy = baseline - px * 0.3;
          const art = d.open.querySelector(".map3d-open-arrow");
          if (art !== null) {
            art.setAttribute("x", (cx - canvas / 2).toFixed(1));
            art.setAttribute("y", (cy - canvas / 2).toFixed(1));
            art.setAttribute("width", canvas.toFixed(1));
            art.setAttribute("height", canvas.toFixed(1));
          }
          const frame = d.open.querySelector(".map3d-open-frame");
          if (frame !== null) {
            const side = ink * 2 + pad * 2;
            frame.setAttribute("x", (cx - side / 2).toFixed(1));
            frame.setAttribute("y", (cy - side / 2).toFixed(1));
            frame.setAttribute("width", side.toFixed(1));
            frame.setAttribute("height", side.toFixed(1));
            frame.setAttribute("rx", (side * 0.22).toFixed(1));
            frame.setAttribute("stroke-width", Math.max(px * 0.06, 0.6).toFixed(2));
          }
          const target = d.open.lastElementChild;
          if (target !== null) {
            // Nunca menor que un dedo torpe. Un nombre lejano se dibuja a ocho
            // píxeles y su flecha mide once: se ve, y aun así no se acierta.
            // Debajo de ese suelo el blanco deja de encoger aunque el dibujo
            // siga haciéndolo.
            const reach = Math.max(canvas * 0.8, 16);
            target.setAttribute("x", (cx - reach / 2).toFixed(1));
            target.setAttribute("y", (cy - reach / 2).toFixed(1));
            target.setAttribute("width", reach.toFixed(1));
            target.setAttribute("height", reach.toFixed(1));
          }
          d.open.removeAttribute("display");
        } else if (!d.open.hasAttribute("display")) {
          d.open.setAttribute("display", "none");
          // Y su marco con ella: si el puntero salta de un nombre a otro de un
          // tirón, el `mouseleave` de la flecha puede no llegar, y el marco se
          // quedaría encendido en un nodo que ya nadie está señalando.
          d.open.querySelector(".map3d-open-frame")?.setAttribute("opacity", "0");
        }
      }

      // Dónde quedó el nombre en pantalla. No se dibuja nada con esto: sirve
      // para saber a qué se está apuntando cuando alguien pulsa.
      d.sx = at.x;
      d.sy = at.y;
      d.sw = d.longest * CHAR_EM * px;
      d.sh = d.lines.length * LINE_EM * px;
    }

    /** Los nodos dibujados por su identidad, para poner cada número sobre el suyo. */
    const shown = new Map<string, Drawn>();
    for (const d of drawn) shown.set(d.node.id, d);

    for (const one of threads) {
      const a = project(one.a, orbit, lens);
      const b = project(one.b, orbit, lens);
      one.line.setAttribute("x1", a.x.toFixed(1));
      one.line.setAttribute("y1", a.y.toFixed(1));
      one.line.setAttribute("x2", b.x.toFixed(1));
      one.line.setAttribute("y2", b.y.toFixed(1));
    }
    for (const one of stopMarks) {
      const d = shown.get(one.of);
      if (d === undefined) continue;
      one.text.setAttribute("x", d.sx.toFixed(1));
      // Justo encima del nombre, midiéndolo: un número dentro del nombre no se
      // lee, y el nombre con un número encima deja de leerse también.
      one.text.setAttribute("y", (d.sy - d.sh / 2 - 4).toFixed(1));
    }

    for (const e of edges) {
      const a = project(e.source, orbit, lens);
      const b = project(e.target, orbit, lens);
      e.line.setAttribute("x1", a.x.toFixed(1));
      e.line.setAttribute("y1", a.y.toFixed(1));
      e.line.setAttribute("x2", b.x.toFixed(1));
      e.line.setAttribute("y2", b.y.toFixed(1));

      if (hovered === null) {
        // Seis decimas, como en dos dimensiones, atenuadas ademas por la lejania.
        e.line.setAttribute("opacity", (0.6 * lejania((a.depth + b.depth) / 2, orbit.distance)).toFixed(2));
        e.line.removeAttribute("stroke");
        continue;
      }
      // Una arista se lee si se ve entera y sola. Las que tocan al nombre bajo
      // el puntero se encienden con el color de su dirección —lo que esta
      // página nombra y lo que la nombra a ella son dos hechos distintos— y las
      // demás se apagan hasta insinuarse.
      const mine = e.a === hovered || e.b === hovered;
      e.line.setAttribute("opacity", mine ? "0.8" : "0.1");
      if (mine) e.line.setAttribute("stroke", e.a === hovered ? colors.linkOut : colors.linkIn);
      else e.line.removeAttribute("stroke");
    }
  };

  /*
   * Ordenar por lejanía: lo de más atrás se pinta primero.
   *
   * Es el algoritmo del pintor, y en SVG se hace moviendo hermanos. Cuesta más
   * que mover atributos, así que no se hace en cada cuadro de la simulación —los
   * nodos se mueven poco entre dos cuadros y el orden aguanta— sino cuando la
   * cámara gira, que es cuando el orden cambia de veras.
   */
  const sortByDepth = (): void => {
    const order = [...drawn].sort((a, b) => b.depth - a.depth);
    for (const d of order) nodeLayer.append(d.group);
  };

  /*
   * Cambiar de página mueve el mapa; no lo rehace.
   *
   * Es la diferencia entre un mapa y una imagen. Abrir una página vecina traía
   * antes un reparto nuevo, una simulación nueva y un encuadre nuevo: todo se
   * recolocaba aunque nueve de cada diez nodos fueran los mismos, y llegar a
   * alguna parte se sentía como aterrizar en otro sitio. Ahora los nodos que ya
   * estaban se quedan clavados donde estaban, y lo único que cambia es el punto
   * en torno al cual se gira. El ángulo y la distancia son de quien mira, y no
   * los toca nadie.
   *
   * Sólo cuando no queda nada del reparto anterior —la primera vez, o tras
   * cambiar el alcance— vuelve a encuadrarse desde cero, que es lo que hace
   * `fit`.
   *
   * Va aquí abajo y no donde se decide `remembered`, que es donde estaba: mover
   * el centro dibuja, y dibujar necesita `paint` y `sortByDepth`, que se definen
   * más arriba pero *después* de aquel punto. Llamarlo antes reventaba con un
   * ReferenceError en cada dibujo que viniera del mapa —la zona muerta de un
   * `const`— y el mapa entero desaparecía. TypeScript no lo ve porque la llamada
   * pasa por dentro de otra función.
   */
  if (remembered && heldOrbit !== null) {
    const yo = focus();
    if (
      yo !== null &&
      Number.isFinite(yo.x) &&
      Number.isFinite(yo.y) &&
      Number.isFinite(yo.z)
    ) {
      glideTo({ x: yo.x as number, y: yo.y as number, z: yo.z as number });
    }
  }

  // ---------------------------------------------------------------------
  // Las fuerzas. Las mismas medidas que tenía el mapa anterior.
  // ---------------------------------------------------------------------
  const LINK_DISTANCE = settings.linkDistance ?? 60;
  const sim = forceSimulation(nodes, 3)
    .force(
      "link",
      forceLink(links)
        .id((d: { id: string }) => d.id)
        .distance(LINK_DISTANCE),
    )
    .force("charge", forceManyBody().strength(settings.chargeStrength ?? -260));

  /*
   * Y los dos resortes del hilo, mientras el recorrido está abierto.
   *
   * Ver `spine.ts`. @guarantee TheThreadStraightensWhileItIsRead.
   *
   * Aquí hay que hacer algo que la vista plana no necesita: **soltar las paradas**.
   * Un nodo que ya tenía sitio va clavado con `fx/fy/fz` para que abrir una página
   * vecina no rehaga el mapa, y un nodo clavado no lo mueve ninguna fuerza. Se
   * sueltan las del recorrido y sólo ésas: el barrio se queda donde estaba, y lo
   * que se acomoda es el argumento.
   */
  const chains: Moving[][] =
    thread === null
      ? []
      : runs(thread.stops.map((one) => one.page)).map((ids) =>
          ids
            .map((id) => nodes.find((one) => one.id === id))
            .filter((one): one is (typeof nodes)[number] => one !== undefined)
            .map((one) => one as unknown as Moving),
        );
  if (chains.some((chain) => chain.length >= 3)) {
    for (const chain of chains) {
      for (const one of chain as unknown as Record<string, unknown>[]) {
        one["fx"] = null;
        one["fy"] = null;
        one["fz"] = null;
      }
    }
    sim.force("spine", spineForce(chains) as never);
  }

  /*
   * La fuerza de centrado, solo cuando no hay nada que recordar.
   *
   * Tira de todos los nodos hacia el origen del mundo, y eso esta bien para un
   * grafo que nace: lo junta en torno a un punto conocido. Pero cuando hay
   * posiciones conservadas, el dibujo ya no vive en el origen —vive donde lo
   * dejo la simulacion anterior— y los nodos clavados no ceden. Entonces la
   * fuerza solo actua sobre los nuevos, y se los lleva al origen, lejos de los
   * vecinos entre los que tenian que colocarse. El grafo se desgarra en dos.
   *
   * Sin ella, un nodo nuevo lo colocan sus vinculos y la repulsion de quienes ya
   * estan, que es exactamente donde deberia caer.
   */
  if (!remembered) sim.force("centre", forceCenter(0, 0, 0));

  /*
   * Si todo venía colocado no hay nada que reordenar.
   *
   * @guarantee TheMapHoldsItsPositions. Recalentar un grafo ya acomodado era lo
   * que lo hacía crecer un poco más en cada dibujo, hasta dejarlo del tamaño de
   * una mancha tras unas cuantas idas y vueltas.
   */
  /*
   * Salvo cuando el recorrido acaba de abrirse: entonces se calienta poco y se ve
   * el argumento acomodarse. 0,35 sobre un mapa ya asentado deja a los enlaces y a
   * la repulsión cerca de su equilibrio, así que lo que se mueve es lo que piden
   * los resortes nuevos y no una redistribución entera.
   */
  const settling = allPlaced && opening && chains.some((chain) => chain.length >= 3);
  if (!settling) {
    if (allPlaced) sim.alpha(0).stop();
  } else if (document.hidden) {
    /*
     * Con la pestaña de fondo no hay animación que valga, y aquí además no hay
     * *nada*: el reloj de d3 pide cuadros al navegador, y a lo que nadie mira no
     * se los dan. Sin esto el mapa se quedaba sin pintar hasta que alguien
     * volviera. Se resuelve de una vez y al volver ya está puesto.
     */
    sim.alpha(0.55).alphaDecay(0.018);
    while (sim.alpha() > 0.02) sim.tick();
    sim.alpha(0).stop();
  } else {
    sim.alpha(0.55).alphaDecay(0.018).restart();
  }

  const rememberPlaces = (): void => {
    for (const n of nodes as (GraphNode & Partial<Point>)[]) {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z)) continue;
      positions.set(n.id, { x: n.x as number, y: n.y as number, z: n.z as number });
    }
  };

  sim.on("tick", () => {
    fit();
    paint();
  });
  sim.on("end", () => {
    rememberPlaces();
    fit();
    paint();
    sortByDepth();
  });

  /*
   * Con todo colocado la simulación no va a emitir nada: se dibuja aquí.
   *
   * También cuando se está acomodando un recorrido, aunque parezca que sobra: si
   * el reloj no llega a arrancar —la pestaña de fondo, un acomodo que se resolvió
   * de una vez— nadie más pinta, y el mapa se quedaba en blanco. Un cuadro de más
   * no se ve; ninguno, sí.
   */
  if (allPlaced) {
    fit();
    paint();
    sortByDepth();
  }

  /*
   * Una órbita optativa y lenta alrededor de Y. Se mide por tiempo y no por
   * cuadros, para que una pantalla de 144 Hz no gire más rápido que una de 60.
   * La preferencia de reducir movimiento manda incluso si quedó encendido el
   * interruptor en otra sesión.
   */
  let autoRotating: number | null = null;
  if (settings.autoRotate === true && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let previous: number | null = null;
    let lastSorted = 0;
    const rotate = (now: number): void => {
      if (previous !== null) {
        // Una pestaña suspendida no recupera de golpe todo el tiempo perdido.
        orbit = advanceAutoRotation(orbit, Math.min(64, now - previous));
        heldOrbit = orbit;
        paint();
        // Reordenar hermanos SVG es más caro que proyectarlos. A esta velocidad,
        // dos veces por segundo mantiene correcto el orden sin trabajo inútil.
        if (now - lastSorted >= 500) {
          sortByDepth();
          lastSorted = now;
        }
      }
      previous = now;
      autoRotating = requestAnimationFrame(rotate);
    };
    autoRotating = requestAnimationFrame(rotate);
  }

  // ---------------------------------------------------------------------
  // La mano. Un dedo gira; dos dedos acercan y corren; la rueda acerca.
  //
  // El reparto es el de cualquier mapa de teléfono, y por eso no hay nada que
  // aprender: un dedo manipula el objeto, dos dedos manipulan la vista.
  // ---------------------------------------------------------------------

  /**
   * El gesto en curso: un dedo que gira, o dos que acercan y corren.
   *
   * El tacto se atiende aqui entero y no se le deja nada a `d3.drag`, que queda
   * solo para el raton. Dos motivos: `d3.drag` engancha el tacto unicamente si
   * detecta una pantalla tactil, asi que en un escritorio con pantalla tactil
   * dudosa el giro no llegaba; y con dos dedos abre dos arrastres a la vez, de
   * modo que el mapa giraba mientras se acercaba, que es un revoltijo del que no
   * se sale.
   */
  let spin: { x: number; y: number; travelled: number } | null = null;
  let pinch: { spread: number; x: number; y: number } | null = null;
  /** Cuanto lleva recorrido el arrastre de raton en curso. */
  let travelled = 0;

  /**
   * Cuanto se le permite temblar a un dedo antes de dejar de ser un toque.
   *
   * Por debajo de esto no se llama a `preventDefault`, y sin `preventDefault` el
   * navegador emite el `click` con que se señala y se abre una pagina. Cortarlo
   * de raiz en `touchstart` —que es lo comodo— deja el mapa imposible de usar
   * con el dedo: se puede girar y no se puede abrir nada.
   */
  const TAP_SLOP = 8;

  /** La separacion entre dos dedos y el punto medio entre ellos. */
  const measure = (touches: TouchList): { spread: number; x: number; y: number } => {
    const a = touches[0] as Touch;
    const b = touches[1] as Touch;
    return {
      spread: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    };
  };

  const turn = (dx: number, dy: number): void => {
    orbit = {
      ...orbit,
      azimuth: orbit.azimuth - dx * TURN_PER_PIXEL,
      // Arrastrar hacia abajo mira desde arriba: la mano empuja el grafo, no la
      // camara. Es el convenio de cualquier visor y no hace falta pensarlo.
      elevation: clampElevation(orbit.elevation + dy * TURN_PER_PIXEL),
    };
    heldOrbit = orbit;
  };

  const onTouchStart = (event: TouchEvent): void => {
    if (event.touches.length >= 2) {
      // Dos dedos no son un toque: aqui si se corta, y de paso no queda un giro
      // a medias por debajo.
      event.preventDefault();
      pinch = measure(event.touches);
      spin = null;
      moved = true;
      return;
    }
    const finger = event.touches[0] as Touch;
    spin = { x: finger.clientX, y: finger.clientY, travelled: 0 };
    // Sin `preventDefault`: todavia puede ser un toque, y un toque tiene que
    // llegar como `click`.
  };

  const onTouchMove = (event: TouchEvent): void => {
    if (event.touches.length >= 2 && pinch !== null) {
      event.preventDefault();
      const now = measure(event.touches);
      // Separar los dedos acerca: la distancia de la orbita se divide por cuanto
      // se abrio el pellizco. Con la separacion en cero —dos dedos exactamente
      // encima— no hay razon que valga y se deja como estaba.
      if (pinch.spread > 0 && now.spread > 0) orbit = zoomBy(orbit, pinch.spread / now.spread);
      // Y el punto medio arrastra el mapa, asi que pellizcar y correr es un solo
      // gesto y no dos que haya que hacer por turnos.
      orbit = panBy(orbit, now.x - pinch.x, now.y - pinch.y, lensNow());
      pinch = now;
      heldOrbit = orbit;
      moved = true;
      paint();
      sortByDepth();
      return;
    }

    if (spin === null || event.touches.length !== 1) return;
    const finger = event.touches[0] as Touch;
    const dx = finger.clientX - spin.x;
    const dy = finger.clientY - spin.y;
    spin.x = finger.clientX;
    spin.y = finger.clientY;
    spin.travelled += Math.hypot(dx, dy);
    // Pasado el temblor esto ya es un arrastre: se corta el desplazamiento de la
    // pagina, y con el, el `click` que ya no toca.
    if (spin.travelled >= TAP_SLOP) event.preventDefault();
    moved = true;
    turn(dx, dy);
    paint();
    sortByDepth();
  };

  const onTouchEnd = (event: TouchEvent): void => {
    if (event.touches.length >= 2) {
      pinch = measure(event.touches);
      return;
    }
    pinch = null;
    // Levantar un dedo de un pellizco deja el otro girando, sin saltos: el gesto
    // continua desde donde esta ese dedo y no desde donde empezo el pellizco.
    spin =
      event.touches.length === 1
        ? {
            x: (event.touches[0] as Touch).clientX,
            y: (event.touches[0] as Touch).clientY,
            travelled: TAP_SLOP,
          }
        : null;
  };

  svg.addEventListener("touchstart", onTouchStart, { passive: false });
  svg.addEventListener("touchmove", onTouchMove, { passive: false });
  svg.addEventListener("touchend", onTouchEnd);
  svg.addEventListener("touchcancel", onTouchEnd);

  const drag = d3
    .drag<SVGSVGElement, unknown>()
    // Solo raton: el tacto lo lleva entero el bloque de arriba.
    .touchable(false)
    // El filtro de fábrica es `!event.button`, que deja fuera el botón de en
    // medio. Aquí ese botón corre el mapa, así que se admite.
    .filter((event: MouseEvent) => !event.ctrlKey && (event.button === 0 || event.button === 1))
    /*
     * Un pulso con la mano tiembla, y con el umbral en cero d3 lo llama arrastre.
     *
     * `d3.drag` se traga el `click` que sigue a un arrastre —para que soltar el
     * ratón después de mover no abra lo que hay debajo—, y el umbral por defecto
     * es cero píxeles: cualquier temblor entre pulsar y soltar contaba como
     * arrastre y el clic no llegaba nunca. Por eso pulsar un nombre no hacía
     * nada. Seis píxeles es el margen de una mano.
     */
    .clickDistance(6)
    .on("start", () => {
      svg.style.cursor = "grabbing";
      travelled = 0;
    })
    .on("drag", (event: { dx: number; dy: number; sourceEvent: MouseEvent }) => {
      /*
       * Un pulso tiembla, y hasta ahora ese temblor giraba el mapa.
       *
       * `d3.drag` emite arrastre en cuanto el raton se mueve un pixel, asi que
       * pulsar dos veces sobre un nombre movia el grafo por debajo entre una
       * pulsacion y la otra. El mismo margen que ya se le da al dedo, por el
       * mismo motivo: nadie apunta con precision de pixel.
       */
      travelled += Math.hypot(event.dx, event.dy);
      if (travelled < TAP_SLOP) return;
      // Girando no se senala: lo encendido se apaga, y vuelve al soltar.
      if (hovered !== null) { hovered = null; lit = new Set(); }
      moved = true;
      /*
       * Con Shift, o con el botón de en medio, arrastrar corre el mapa en vez de
       * girarlo.
       *
       * Es lo que hace falta en un portátil: pellizcar y arrastrar con dos dedos
       * es un gesto de pantalla táctil, y en un trackpad los dos dedos ya están
       * ocupados en otra cosa. Shift y el botón de en medio son el convenio de
       * cualquier programa que muestre algo en tres dimensiones, así que no hay
       * nada que aprender.
       */
      const source = event.sourceEvent;
      if (source?.shiftKey === true || source?.buttons === 4) {
        orbit = panBy(orbit, event.dx, event.dy, lensNow());
        heldOrbit = orbit;
      } else {
        turn(event.dx, event.dy);
      }
      paint();
      sortByDepth();
    })
    .on("end", () => {
      svg.style.cursor = "grab";
    });
  d3.select(svg).call(drag);

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    moved = true;

    /*
     * El pellizco de un trackpad llega como rueda con Ctrl pulsado.
     *
     * No es una tecla que nadie tenga que apretar: es lo que el navegador emite
     * cuando se juntan o se separan dos dedos sobre el trackpad, en todos los
     * sistemas. Atenderlo es hacer que el pellizco funcione igual en el portátil
     * que en el teléfono, gratis.
     */
    if (event.ctrlKey || event.metaKey) {
      orbit = zoomBy(orbit, Math.exp(event.deltaY * 0.01));
    } else {
      if (!trackpad && looksLikeTrackpad(event)) trackpad = true;
      if (trackpad) {
        // Deslizar dos dedos hacia abajo lleva el mapa hacia arriba, como se
        // desplaza cualquier documento. De ahí el signo.
        orbit = panBy(orbit, -event.deltaX, -event.deltaY, lensNow());
      } else {
        // Una rueda de ratón no tiene con qué correr el mapa, así que acerca:
        // es lo que hace en cualquier visor y lo que ya hacía aquí.
        orbit = zoomBy(orbit, event.deltaY > 0 ? 1.12 : 1 / 1.12);
      }
    }

    heldOrbit = orbit;
    paint();
    sortByDepth();
  };
  svg.addEventListener("wheel", onWheel, { passive: false });

  // ---------------------------------------------------------------------
  // Pulsar. Uno señala, dos abren. Igual que en 2D: mirar algo no es entrar.
  // ---------------------------------------------------------------------
  /**
   * A qué nombre se está apuntando.
   *
   * Se resuelve con una cuenta sobre las cajas que `paint` dejó apuntadas, y no
   * preguntándole al DOM quién está debajo del puntero. La diferencia importa:
   * los nombres se solapan —dos páginas vecinas caen casi en el mismo sitio— y
   * el que el DOM devuelve es el que quedó de último hermano, que es el más
   * cercano a la cámara y no el que se está señalando.
   *
   * Gana aquel a cuyo centro se apuntó más de lleno, medido en fracciones de su
   * propia caja: cero en mitad del nombre, uno en su borde. Así un nombre largo
   * no se queda con los clics de un nombre corto que cae dentro de él, que es lo
   * que pasaba midiendo sólo quién está más cerca de la cámara. Se empata por
   * cercanía, que es lo que decide cuál se ve encima.
   *
   * Se admite hasta un poco más allá del borde —de ahí que el margen pase de
   * uno—: apuntar a un nombre de ocho píxeles no debería exigir puntería de
   * cirujano.
   */
  const AIM_SLACK = 1.6;
  const pick = (clientX: number, clientY: number): Drawn | null => {
    const box = svg.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;

    let best: Drawn | null = null;
    let bestAim = Infinity;

    for (const d of drawn) {
      // Media caja, nunca menor que unos pocos píxeles: un nombre lejano se
      // dibuja diminuto y aun así hay que poder señalarlo.
      const halfW = Math.max(d.sw / 2, 6);
      const halfH = Math.max(d.sh / 2, 6);
      const aim = Math.max(Math.abs(x - d.sx) / halfW, Math.abs(y - d.sy) / halfH);
      if (aim > AIM_SLACK) continue;
      if (aim < bestAim || (aim === bestAim && best !== null && d.depth < best.depth)) {
        bestAim = aim;
        best = d;
      }
    }
    return best;
  };

  /** Llevar la órbita a un nodo, conservando desde dónde y a qué distancia se mira. */
  const orbitAround = (d: Drawn): void => {
    const n = d.node as GraphNode & Partial<Point>;
    moved = true;
    glideTo({ x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 });
  };

  /*
   * Pulsar la flecha abre, y de una sola vez.
   *
   * El doble clic sigue estando y sigue valiendo sobre el nombre entero; lo que
   * faltaba era que algo dijera que el nodo se puede abrir y con qué gesto. Va
   * en el elemento y no en la geometría como el resto de los aciertos de este
   * dibujo, porque aquí el blanco es un rectángulo que ya está en el DOM: el
   * navegador acierta mejor que una cuenta, y `stopPropagation` impide que el
   * mismo clic llegue además al lienzo, donde sólo señalaría.
   */
  for (const d of drawn) {
    d.open?.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      selected = d.node.id;
      orbitAround(d);
      onClickPage(d.node.name);
    });
  }

  const onClick = (event: MouseEvent): void => {
    const d = pick(event.clientX, event.clientY);
    if (d === null) return;
    selected = d.node.id;

    /*
     * En una pantalla táctil un toque hace las dos cosas, porque no hay segundo
     * toque que enseñar. Con ratón, uno señala y dos abren.
     */
    if (window.matchMedia("(hover: none)").matches) {
      orbitAround(d);
      onClickPage(d.node.name);
      return;
    }
    paint();
  };

  /*
   * Abrir cuelga de `dblclick` y no de contar dos `click` seguidos.
   *
   * Contarlos era frágil por partida doble: exigía que las dos pulsaciones
   * resolvieran al mismo nodo —y con los nombres solapados podían resolver a dos
   * distintos, con lo cual no se abría nunca— y exigía además que el reloj
   * cuadrara. El navegador ya sabe qué es un doble clic, incluida la
   * preferencia de quien lo configuró en su sistema.
   */
  const onDoubleClick = (event: MouseEvent): void => {
    const d = pick(event.clientX, event.clientY);
    if (d === null) return;
    event.preventDefault();
    selected = d.node.id;
    // El nodo pasa a ser el centro de la órbita: no sólo se mira hacia él, se
    // gira en torno a él. Se conserva la distancia y el ángulo, porque acercarse
    // es decisión de quien mira y saltar de página no lo es.
    orbitAround(d);
    onClickPage(d.node.name);
  };

  /*
   * Pasar por encima de un nombre enciende con quien se nombra.
   *
   * @guarantee GraphNodesAreTheirNames. Es como se interroga un dibujo con
   * novecientas aristas: apagando todo menos una pagina y sus vinculos. En dos
   * dimensiones existe desde el principio y aqui faltaba.
   *
   * Se repinta solo cuando cambia el nombre senalado, no en cada pixel. Acertar
   * es una cuenta sobre las cajas que el pintado ya conoce —barata— y repintar
   * son mil cuatrocientos atributos —no tanto—, asi que la diferencia entre
   * preguntar y actuar es la que hace que esto no se note.
   *
   * Mientras la mano arrastra no hay hover: se esta girando el mapa, no
   * senalando nada, y encender un nombre distinto por cuadro seria un parpadeo.
   */
  const onMove = (event: MouseEvent): void => {
    if (pinch !== null || (event.buttons & 1) !== 0) return;
    const d = pick(event.clientX, event.clientY);
    const id = d?.node.id ?? null;
    if (id === hovered) return;
    hovered = id;
    lit = id === null ? new Set() : new Set([id, ...(neighbours.get(id) ?? [])]);
    svg.style.cursor = id === null ? "grab" : "pointer";
    paint();
  };

  const onLeave = (): void => {
    if (hovered === null) return;
    hovered = null;
    lit = new Set();
    svg.style.cursor = "grab";
    paint();
  };

  svg.addEventListener("mousemove", onMove);
  svg.addEventListener("mouseleave", onLeave);
  svg.addEventListener("click", onClick);
  svg.addEventListener("dblclick", onDoubleClick);

  // ---------------------------------------------------------------------
  // Los controles de fuera: acercar, alejar, centrar.
  // ---------------------------------------------------------------------
  const onZoom = ((event: CustomEvent<"in" | "out">) => {
    moved = true;
    orbit = zoomBy(orbit, event.detail === "in" ? 0.67 : 1.5);
    heldOrbit = orbit;
    paint();
  }) as EventListener;

  // Centrar es olvidar lo que la mano hizo y dejar que el encuadre vuelva a
  // decidir, sin cambiar desde dónde se está mirando.
  const onCentre = (() => {
    moved = false;
    heldOrbit = null;
    fit();
    paint();
    sortByDepth();
  }) as EventListener;

  document.addEventListener("constel:zoom", onZoom);
  document.addEventListener("constel:center", onCentre);

  // El panel cambia de tamaño al plegar la columna de texto, y entonces el
  // encuadre de antes ya no encuadra. Repintar es barato; rehacer el mapa no.
  const onResize = (): void => {
    fit();
    paint();
  };
  window.addEventListener("resize", onResize);

  teardown = (): void => {
    sim.stop();
    if (gliding !== null) cancelAnimationFrame(gliding);
    if (autoRotating !== null) cancelAnimationFrame(autoRotating);
    document.removeEventListener("constel:zoom", onZoom);
    document.removeEventListener("constel:center", onCentre);
    window.removeEventListener("resize", onResize);
    svg.removeEventListener("wheel", onWheel);
    svg.removeEventListener("click", onClick);
    svg.removeEventListener("dblclick", onDoubleClick);
    svg.removeEventListener("mousemove", onMove);
    svg.removeEventListener("mouseleave", onLeave);
    svg.removeEventListener("touchstart", onTouchStart);
    svg.removeEventListener("touchmove", onTouchMove);
    svg.removeEventListener("touchend", onTouchEnd);
    svg.removeEventListener("touchcancel", onTouchEnd);
    // Lo colocado se anota también al desmontar: cambiar a dos dimensiones antes
    // de que la simulación acabe no debe perder el sitio de los nodos.
    rememberPlaces();
  };
}

/**
 * Cuánto se desvanece algo por estar lejos.
 *
 * Uno a la distancia de la órbita, y va bajando hacia atrás sin llegar a
 * desaparecer: un nombre invisible es un nombre que no está, y el mapa dejaría
 * de decir lo que hay.
 */
function lejania(depth: number, reference: number, floor = 0.28): number {
  if (!Number.isFinite(depth) || !Number.isFinite(reference) || reference <= 0) return 1;
  const t = depth / reference;
  return Math.min(1, Math.max(floor, 1.35 - t * 0.6));
}
