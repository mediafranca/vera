import * as d3 from "d3";
import type { GraphData, GraphLink, GraphNode } from "./types.ts";
import { is } from "../bindings.ts";
import { icon } from "../icons.ts";
import { type Moving, runs, spineForce } from "./spine.ts";

export type NodeStyle = "circular" | "title";

/**
 * El hilo de un recorrido sobre el mapa.
 *
 * Mientras un recorrido está abierto, su propia página deja de dibujarse como un
 * nodo y se dibuja como el hilo que pasa por los suyos: un argumento no está *al
 * lado* de sus premisas sino *entre* ellas, y un nodo con doce aristas saliendo
 * hacia sus paradas dibuja lo contrario de lo que el recorrido dice.
 * @guarantee TheTrailsNodeBecomesTheThread.
 *
 * Los tramos no son aristas: no cambian distancias, ni grados, ni qué páginas
 * caen dentro de un vecindario. Afirmar algo sobre dos sitios y acercarlos son
 * dos cosas, y sólo la segunda cambiaría el mapa de quien no leyó el argumento.
 * @guarantee AThreadIsNotAnEdge.
 *
 * Con una excepción que dura lo que dura la lectura: mientras el recorrido está
 * abierto, sus paradas llevan encima dos resortes flojos que las enderezan un
 * poco —ver `spine.ts`—. Es una fuerza de la vista y no del grafo: no toca el
 * vecindario de nadie, y no está puesta cuando el recorrido no lo está.
 * @guarantee TheThreadStraightensWhileItIsRead.
 */
export interface ThreadSettings {
  /** La página del recorrido, que es la que se esconde. */
  page: string;
  /** Sus paradas en orden. `page` nulo es un puente cortado. */
  stops: { page: string | null; ordinal: number }[];
  /** De qué clase es cada tramo. Uno menos que paradas. */
  kinds: ("by_path" | "across_open_ground")[];
}

export interface RenderSettings {
  chargeStrength?: number;
  linkDistance?: number;
  history?: string[];
  dark?: boolean;
  fontFamily?: string;
  nodeStyle?: NodeStyle;
  showEdges?: boolean;
  showNodes?: boolean;
  showTitles?: boolean;
  fontSize?: number;
  thread?: ThreadSettings | null;
  /** Hace orbitar lentamente la cámara 3D alrededor del eje vertical. */
  autoRotate?: boolean;
}

// ── Title-mode constants ──
const PAD_X = 0;
const PAD_Y = 0;
const FONT_MIN = 10;
const FONT_MAX = 18;
const BLOCKS_MIN = 1;
const BLOCKS_MAX = 100;

function titleFontSize(d: GraphNode): number {
  if (d.central) return FONT_MAX;
  const count = d.blockCount ?? BLOCKS_MIN;
  const t = Math.min(1, Math.max(0, (count - BLOCKS_MIN) / (BLOCKS_MAX - BLOCKS_MIN)));
  return FONT_MIN + (FONT_MAX - FONT_MIN) * Math.sqrt(t);
}

// ── Max label width before wrapping ──
// Setenta caracteres en una sola línea era casi una frase: un nombre largo
// atravesaba el mapa y empujaba a todos los demás. Al partirse antes, la caja es
// más compacta y quedan más nombres legibles en el mismo sitio.
const MAX_LABEL_CHARS = 24;

/** El aire entre dos nombres. Sin él se tocan, y tocarse ya se lee como uno. */
const COLLISION_PAD = 6;

type NodeDimensions = Map<string, { w: number; h: number }>;

/**
 * Compone cerca los componentes sin conectarlos.
 *
 * La simulación de fuerzas no sabe que dos componentes pertenecen al mismo
 * dibujo: sin un enlace que los sujete, uno puede acabar muy lejos del otro. El
 * encuadre entonces hace lo correcto geométricamente y lo incorrecto para la
 * lectura: reduce todo hasta que los nombres del componente denso son una mota.
 *
 * Aquí no se añade ninguna arista ni se cambia la forma interior de un
 * componente. Sólo se trasladan sus cajas completas a una columna compacta,
 * con el mayor primero y los demás centrados debajo.
 */
export function compactDisconnectedComponents(
  nodes: GraphNode[],
  links: GraphLink[],
  dims: NodeDimensions,
): number {
  if (nodes.length < 2) return nodes.length;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacent = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  const endpoint = (value: string | GraphNode): string =>
    typeof value === 'string' ? value : value.id;
  for (const link of links) {
    const source = endpoint(link.source);
    const target = endpoint(link.target);
    if (!byId.has(source) || !byId.has(target)) continue;
    adjacent.get(source)?.add(target);
    adjacent.get(target)?.add(source);
  }

  const unseen = new Set(nodes.map((node) => node.id));
  const components: GraphNode[][] = [];
  while (unseen.size > 0) {
    const first = unseen.values().next().value as string;
    const pending = [first];
    const component: GraphNode[] = [];
    unseen.delete(first);
    while (pending.length > 0) {
      const id = pending.pop()!;
      const node = byId.get(id);
      if (node !== undefined) component.push(node);
      for (const neighbour of adjacent.get(id) ?? []) {
        if (!unseen.delete(neighbour)) continue;
        pending.push(neighbour);
      }
    }
    components.push(component);
  }
  if (components.length < 2) return components.length;

  const bounds = (component: GraphNode[]) => {
    const boxes = component.map((node) => {
      const box = dims.get(node.id) ?? { w: 40, h: 16 };
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      return { left: x - box.w / 2, right: x + box.w / 2,
        top: y - box.h / 2, bottom: y + box.h / 2 };
    });
    return {
      left: Math.min(...boxes.map((box) => box.left)),
      right: Math.max(...boxes.map((box) => box.right)),
      top: Math.min(...boxes.map((box) => box.top)),
      bottom: Math.max(...boxes.map((box) => box.bottom)),
    };
  };

  components.sort((a, b) => b.length - a.length);
  const measured = components.map((component) => ({ component, box: bounds(component) }));
  const widest = Math.max(...measured.map(({ box }) => box.right - box.left));
  const gap = Math.max(36, COLLISION_PAD * 6);
  let top = 0;
  for (const { component, box } of measured) {
    const width = box.right - box.left;
    const dx = (widest - width) / 2 - box.left;
    const dy = top - box.top;
    for (const node of component) {
      node.x = (node.x ?? 0) + dx;
      node.y = (node.y ?? 0) + dy;
    }
    top += box.bottom - box.top + gap;
  }

  return components.length;
}

/** Split text into lines respecting word boundaries and max char width. */
function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && (current.length + 1 + word.length) > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

// ── History ring config ──
const RING_COLOR = "#ef7a1c";

// Track listeners for cleanup on re-render
let active2dListeners: { event: string; fn: EventListener }[] = [];

/**
 * Dónde quedó cada nodo, entre un dibujo y el siguiente.
 *
 * @guarantee TheMapHoldsItsPositions. La simulación de fuerzas se corría entera
 * en cada repintado, así que colapsar el panel, redimensionarlo o volver a una
 * página vecina reordenaba el mapa completo. El costo era real —se notaba como
 * lag sobre un corpus de este tamaño— pero no es la razón principal: un mapa que
 * se reacomoda mientras uno lo mira no se puede recordar, y un mapa que no se
 * recuerda es una imagen y no un lugar. Reconocer una región por su forma es
 * para lo que sirve dibujarla.
 */
const positions = new Map<string, { x: number; y: number }>();

/** El encuadre. Se conserva por lo mismo: volver no debe reencuadrar. */
let heldTransform: d3.ZoomTransform | null = null;

/**
 * Qué acomodo está corriendo, para que sólo corra el último.
 *
 * El mapa se vacía y se vuelve a dibujar entero en cada repintado, y un bucle de
 * animación no sabe que el SVG que estaba moviendo ya no está en el documento.
 * Cada acomodo se queda con su número al empezar y se calla en cuanto deja de ser
 * el vigente.
 */
let relaxing = 0;

/**
 * Y qué recorrido quedó ya acomodado.
 *
 * Aparte de `framed`, y la distinción costó una prueba en el navegador: encuadrar
 * ocurre en el primer dibujo y acomodarse tarda un segundo y medio, durante el
 * cual el mapa se vuelve a dibujar —llega lo derivado, llega la tipografía—. Si el
 * acomodo se diera por hecho al encuadrar, el repintado siguiente lo cancelaría y
 * el que viniera después se creería que ya pasó: el hilo se quedaba tal cual y no
 * se movía nada. Se anota al terminar, así que un repintado en medio lo reanuda.
 */
let straightened: string | null = null;

/** Olvida lo colocado. Para cuando el grafo cambia de centro de verdad. */
export function forgetPositions(): void {
  positions.clear();
  heldTransform = null;
  // Y el encuadre del recorrido: si las posiciones son otras, el que había ya no
  // encuadraba nada. Ni el acomodo, por lo mismo.
  framed = null;
  straightened = null;
}

/** Señala un nodo desde fuera, para que abrir una página lo marque en el mapa. */
export function selectNode(id: string | null): void {
  selected = id;
}

/** El nodo señalado ahora mismo. Se conserva entre dibujos, como las posiciones. */
let selected: string | null = null;
/** El último que se llevó al centro, para no volver a hacerlo en cada repintado. */
let centred: string | null = null;
/** Y el último recorrido que se encuadró, por la misma razón. */
let framed: string | null = null;

export function renderGraph(
  container: HTMLElement,
  data: GraphData,
  onClickPage: (pageName: string) => void,
  settings: RenderSettings = {}
) {
  // Clean up previous listeners
  for (const { event, fn } of active2dListeners) {
    document.removeEventListener(event, fn);
  }
  active2dListeners = [];

  container.innerHTML = "";

  const width = container.clientWidth;
  const height = container.clientHeight;
  // El nodo es su nombre. Un círculo al lado no dice nada que el nombre no diga,
  // y gasta el mismo sitio diciendo menos.
  const style = settings.nodeStyle ?? "title";

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height])
    .attr("role", "img")
    .attr("aria-label", "Visualización del grafo de conocimiento");

  const showEdges = settings.showEdges ?? true;
  const showNodes = settings.showNodes ?? true;
  const showTitles = settings.showTitles ?? true;
  const fontSize = settings.fontSize ?? 12;

  const g = svg.append("g");
  const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 5])
    .on("zoom", (event) => g.attr("transform", event.transform));
  svg.call(zoomBehavior as any);

  // Listen for external zoom/center events from the controls toolbar
  const onZoom = ((e: CustomEvent) => {
    if (e.detail === "in") {
      svg.transition().duration(300).call(zoomBehavior.scaleBy as any, 1.5);
    } else {
      svg.transition().duration(300).call(zoomBehavior.scaleBy as any, 0.67);
    }
  }) as EventListener;
  let frameAll = (): void => undefined;
  const onCenter = (() => frameAll()) as EventListener;
  document.addEventListener("constel:zoom", onZoom);
  document.addEventListener("constel:center", onCenter);
  active2dListeners = [
    { event: "constel:zoom", fn: onZoom },
    { event: "constel:center", fn: onCenter },
  ];

  // Theme colors — read CSS variables from #vera-root, fall back to defaults
  const dark = settings.dark ?? false;
  const rootEl = document.getElementById("vera-root");
  const cs = rootEl ? getComputedStyle(rootEl) : null;
  const cssVar = (name: string, fallback: string) =>
    cs?.getPropertyValue(name).trim() || fallback;
  // Todo color sale de los tokens, que es lo que hace que el mapa siga al tema
  // que se elija sin tener una paleta propia escondida aquí. `--border` no
  // existe y nunca existió: la línea del tema es `--rule`.
  const colors = {
    nodeCentral: cssVar("--node-central", dark ? "#4a9ade" : "#045591"),
    nodeFill: cssVar("--node-fill", dark ? "#777" : "#999"),
    nodeBorder: cssVar("--rule", dark ? "#2b2f38" : "#e3e3de"),
    textCentral: cssVar("--node-central", dark ? "#4a9ade" : "#045591"),
    // Los nombres corrientes van atenuados a propósito: lo que se busca en un
    // mapa es lo excepcional, y si todo pesa igual no destaca nada.
    textNormal: cssVar("--node-fill", dark ? "#6d7480" : "#9aa0ab"),
    linkStroke: cssVar("--link-stroke", dark ? "#333842" : "#d5d7d2"),
    hoverAccent: cssVar("--accent", dark ? "#4a9ade" : "#045591"),
    visited: cssVar("--warm", "#ef7a1c"),
    // Las dos direcciones. Son los mismos tokens que pintan el filete de «La
    // nombran» y «Nombra a» al pie de una página: quien aprendió el código
    // leyendo lo reconoce aquí sin que nadie se lo explique.
    linkIn: cssVar("--link-in", dark ? "#6fa8d0" : "#045591"),
    linkOut: cssVar("--link-out", dark ? "#ee895d" : "#a84a0b"),
  };

  // History lookup
  const historyTail = (settings.history ?? []).slice(-5).reverse();
  const historyMap = new Map<string, number>();
  historyTail.forEach((name, i) => {
    const key = name.toLowerCase();
    if (!historyMap.has(key)) historyMap.set(key, i);
  });

  // Links (conditional on showEdges)
  const linkGroup = g.append("g")
    .attr("stroke", colors.linkStroke)
    .attr("stroke-opacity", 0.6);
  // El ternario original producía una unión de tipos que perdía .attr bajo
  // strict. Se elige el conjunto de datos en vez de la rama de la expresión.
  const link = linkGroup
    .selectAll<SVGLineElement, GraphLink>("line")
    .data(showEdges ? data.links : [])
    .join("line")
    .attr("stroke-width", 1);
  link.style("transition", "stroke-opacity 0.2s, stroke 0.2s");

  // Nodes
  const node = g
    .append("g")
    .selectAll<SVGGElement, GraphNode>("g")
    .data(data.nodes)
    .join("g")
    .attr("cursor", "pointer")
    .classed("trail-node", (d) => d.trail === true)
    .style("transition", "opacity 0.2s");

  /*
   * El hilo del recorrido abierto, si hay uno.
   *
   * Se dibuja debajo de los nombres y encima de las aristas, porque es lo que se
   * viene a ver. La página del recorrido sigue en la simulación —sus enlaces son
   * los que mantienen a sus paradas juntas— y sólo se deja de dibujar: quitarla
   * de la física dispersaría el argumento por el mapa.
   */
  const thread = settings.thread ?? null;
  if (thread !== null) {
    link.style("display", (d: any) => {
      const from = typeof d.source === "object" ? d.source.id : d.source;
      const to = typeof d.target === "object" ? d.target.id : d.target;
      return from === thread.page || to === thread.page ? "none" : null;
    });
    node.style("display", (d) => (d.id === thread.page ? "none" : null));
  }

  const threadGroup = g.append("g").attr("class", "thread-layer");
  const segment = threadGroup
    .selectAll<SVGLineElement, number>("line")
    .data(thread === null ? [] : thread.kinds.map((_, at) => at))
    .join("line")
    .attr("class", (at) =>
      thread!.stops[at]?.page === null || thread!.stops[at + 1]?.page === null
        ? "thread broken"
        : thread!.kinds[at] === "by_path"
          ? "thread"
          : "thread open-ground",
    );

  /* El número de cada parada, al lado del nombre que ya está. */
  const stopMark = threadGroup
    .selectAll<SVGTextElement, { page: string | null; ordinal: number }>("text")
    .data(thread === null ? [] : thread.stops.filter((one) => one.page !== null))
    .join("text")
    .attr("class", "thread-stop")
    .attr("text-anchor", "middle")
    .text((one) => String(one.ordinal));

  // ── Dimensions map (used for title-mode collision and both modes for history rings) ──
  const dims = new Map<string, { w: number; h: number }>();

  const fontFamily = settings.fontFamily ?? "system-ui, -apple-system, sans-serif";

  /** El color que le toca a cada nombre por su historia, para poder restaurarlo. */
  const fills = new Map<string, string>();

  if (style === "title") {
    renderTitleNodes(node, data, dims, historyMap, colors, fontFamily, fontSize, fills);
  } else {
    renderCircularNodes(node, data, dims, historyMap, colors, showNodes, showTitles, fontSize);
  }

  // Accessibility: make nodes focusable
  node
    .attr("tabindex", 0)
    .attr("role", "link")
    .attr("aria-label", (d) => d.name);

  /*
   * Un clic señala; dos abren.
   *
   * Es la convención de cualquier mapa y de cualquier escritorio: mirar algo no
   * es entrar en ello. Señalar deja ver de qué se trata sin perder la página que
   * se está leyendo, y sólo el segundo clic la cambia.
   *
   * En un teléfono no hay segundo clic, así que ahí un toque hace las dos cosas:
   * exigir un doble toque en una pantalla táctil sería pedir un gesto que el
   * aparato no enseña.
   */
  const touch = window.matchMedia("(hover: none)").matches;

  const draw = (): void => {
    node.classed("selected", (d) => d.id === selected);
    node
      .select<SVGTextElement>("text")
      .attr("fill", (d: any) =>
        d.id === selected ? colors.hoverAccent : (fills.get(d.id) ?? colors.textNormal),
      );
  };

  const open = (d: any): void => {
    selected = d.id;
    draw();
    // No se centra aquí: abrir la página trae otro grafo, y centrar sobre el
    // viejo no significa nada. Se centra al dibujar, abajo, cuando la selección
    // resulta ser distinta de la última que se llevó al centro.
    onClickPage(d.name);
  };

  node.on("click", (_event, d: any) => {
    if (touch) {
      open(d);
      return;
    }
    selected = d.id;
    draw();
  });
  node.on("dblclick", (event, d: any) => {
    // Sin esto el doble clic también dispara el zoom por defecto de d3.
    (event as Event).stopPropagation();
    open(d);
  });
  /*
   * La flecha que abre, dentro del nombre y como un carácter más.
   *
   * El doble clic seguía siendo la única puerta, y una puerta que no se ve no
   * existe: nada en el mapa decía que un nodo se pudiera abrir, y menos aún con
   * qué gesto. La flecha aparece al señalar —no antes, porque cincuenta flechas
   * quietas serían ruido— y dice las dos cosas a la vez: que ahí hay una página
   * y que se entra pulsando.
   *
   * Va pegada al final de la última línea y del alto de una versal, no aparte y
   * flotando a un lado. Separada, entre el nombre y la flecha quedaba un hueco
   * sin nada pintado: el puntero lo cruzaba, el nodo dejaba de estar señalado y
   * la flecha se apagaba justo cuando se iba a pulsar. Una puerta que se cierra
   * al acercarse no es una puerta. Como carácter no hay hueco que cruzar, y
   * además se lee por lo que es: la última letra del nombre es la que lleva
   * fuera.
   *
   * Se pone después de medir: el tamaño del nodo lo fija su nombre, y sumarle la
   * flecha lo engordaría para siempre por algo que sólo se ve un instante.
   */
  node.each(function (d: any) {
    const box = dims.get(d.id);
    if (box === undefined) return;
    const g = d3.select(this);

    /*
     * El nodo entero, hoverable.
     *
     * Un texto sólo se señala por la tinta de sus letras: entre dos palabras,
     * entre dos líneas y en el hombro de una letra no hay nada pintado, así que
     * el puntero entra y sale del nodo mientras se mueve por encima de él y la
     * flecha parpadea. Un rectángulo transparente del tamaño ya medido lo vuelve
     * una sola superficie. No se sale de su caja: la colisión garantiza que las
     * cajas no se solapan, así que no le roba el hover a nadie.
     */
    g.insert("rect", ":first-child")
      .attr("x", -box.w / 2)
      .attr("y", -box.h / 2)
      .attr("width", box.w)
      .attr("height", box.h)
      .attr("fill", "transparent");

    /*
     * Dónde termina el nombre. Con `text-anchor: middle` y varias líneas no
     * basta el ancho de la caja: la última línea puede ser la más corta, y la
     * flecha tiene que ir donde acaba ella, no donde acaba la más larga.
     */
    const text = (this as SVGGElement).querySelector("text");
    const spans = text?.querySelectorAll("tspan");
    const last = spans !== undefined && spans.length > 0 ? spans[spans.length - 1] : null;
    const fs = Number((text?.getAttribute("font-size") ?? "").replace("px", "")) || fontSize;
    let endX = box.w / 2;
    let baseline = fs * 0.35;
    if (last instanceof SVGTextContentElement && last.getNumberOfChars() > 0) {
      const start = last.getStartPositionOfChar(0);
      endX = start.x + last.getComputedTextLength();
      baseline = start.y;
    }

    /*
     * Del alto de media versal, y pegada.
     *
     * Feather dibuja dentro de un lienzo de 24 y esta flecha ocupa de 7 a 17;
     * con el trazo y sus remates redondos, la tinta llega a doce de veinticuatro
     * —justo la mitad del lienzo—, así que lo que se ve es el doble de lo que la
     * cuenta ingenua diría. Pedida del alto de una versal salía un aspa al lado
     * del nombre en vez de un signo dentro de él.
     *
     * Va a media versal y separada del texto por una nada. Es un diacrítico, no
     * una segunda palabra: lo que tiene que decir —que ahí se entra— lo dice
     * igual pequeña, y grande compite con el nombre, que es lo que de verdad hay
     * que leer.
     */
    const glyph = fs * 0.35;
    const canvas = glyph * 2.4;
    /** Media tinta: el trazo llega a seis de los veinticuatro del lienzo. */
    const ink = canvas / 4;
    /*
     * El aire entre la última letra y la tinta de la flecha, y el que el marco
     * deja alrededor de ella.
     *
     * No son independientes: el borde izquierdo del marco cae en `gap - pad`
     * desde el final del nombre, así que un marco más holgado se come la
     * separación y termina pisando la última letra. Los dos números están
     * elegidos juntos para que quede una nada visible entre el texto y el marco
     * y la flecha siga leyéndose como parte del nombre.
     */
    const gap = fs * 0.32;
    const pad = fs * 0.18;
    const cx = endX + ink + gap;
    // A media altura de la letra y no de la flecha: lo que la alinea con el
    // nombre es el ojo de las minúsculas, no su propio tamaño.
    const cy = baseline - fs * 0.3;

    const opener = g
      .append("g")
      .attr("class", "node-open")
      .attr("cursor", "pointer")
      .attr("opacity", 0)
      .style("pointer-events", "none")
      .style("transition", "opacity 0.15s");
    opener.html(icon("arrow-up-right"));
    opener
      .select("svg")
      .attr("class", "node-open-arrow")
      .attr("width", canvas)
      .attr("height", canvas)
      .attr("x", cx - canvas / 2)
      .attr("y", cy - canvas / 2)
      .attr("stroke", colors.hoverAccent);

    /*
     * El marco, encendido sólo cuando el puntero está sobre la flecha misma.
     *
     * Señalar el nombre enciende la flecha; señalar la flecha tiene que decir
     * otra cosa, porque es otro gesto con otra consecuencia —el nombre sólo
     * selecciona, la flecha abre—. Sin esto, entre estar a punto de seleccionar
     * y estar a punto de irse de la página no había ninguna diferencia visible,
     * y la única manera de saber cuál de las dos iba a pasar era pulsar.
     *
     * Va detrás del dibujo y con las esquinas apenas curvadas: lo que se
     * enciende es el sitio donde se va a pulsar, no un botón nuevo.
     */
    const side = ink * 2 + pad * 2;
    const frame = opener
      .insert("rect", ":first-child")
      .attr("class", "node-open-frame")
      .attr("x", cx - side / 2)
      .attr("y", cy - side / 2)
      .attr("width", side)
      .attr("height", side)
      .attr("rx", side * 0.22)
      .attr("fill", "none")
      .attr("stroke", colors.hoverAccent)
      .attr("stroke-width", Math.max(fs * 0.06, 0.6))
      .attr("opacity", 0)
      .style("transition", "opacity 0.12s");

    // Y encima, el blanco al que se apunta: el trazo es una línea de dos
    // píxeles, y pedir puntería sobre una línea es pedir que no se use. Empieza
    // dentro de la última letra para que no haya ni un píxel muerto entre el
    // nombre y la flecha.
    const reach = Math.max(canvas * 0.8, 16);
    opener
      .append("rect")
      .attr("x", endX - fs * 0.2)
      .attr("y", cy - reach / 2)
      .attr("width", reach)
      .attr("height", reach)
      .attr("fill", "transparent");
    opener
      .on("mouseenter", () => frame.attr("opacity", 1))
      .on("mouseleave", () => frame.attr("opacity", 0));
    opener.on("click", (event: Event) => {
      // Sin esto el clic también llega al nodo, que sólo señala, y el `select`
      // posterior pisaría lo que la flecha acaba de abrir.
      event.stopPropagation();
      open(d);
    });
  });

  node.on("keydown", (_event, d: any) => {
    // Se pregunta a `bindings`, que es de donde la pagina de configuracion saca
    // lo que enseña: asi el atajo anunciado y el atendido son el mismo.
    const e = _event as KeyboardEvent;
    if (is("open-node", e)) {
      e.preventDefault();
      open(d);
    }
  });

  // Hover highlight
  node
    .on("mouseenter", function (_event, d) {
      link.attr("stroke-opacity", 0.1);
      node.attr("opacity", 0.2);
      const connected = new Set<string>([d.id]);
      data.links.forEach((l) => {
        const src = typeof l.source === "string" ? l.source : (l.source as any).id;
        const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
        if (src === d.id) connected.add(tgt);
        if (tgt === d.id) connected.add(src);
      });
      node.filter((n) => connected.has(n.id)).attr("opacity", 1);
      /*
       * Cada arista encendida con el color de su dirección.
       *
       * Todas en el mismo acento decían que hay vecindad y callaban de qué
       * lado: no se distinguía la página que uno nombró de la que lo nombró a
       * uno, que es justamente lo que se va a mirar. Los dos tonos son los del
       * filete de «La nombran» y «Nombra a» al pie de la página.
       */
      link
        .filter((l) => {
          const src = typeof l.source === "string" ? l.source : (l.source as any).id;
          const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
          return src === d.id || tgt === d.id;
        })
        .attr("stroke-opacity", 0.9)
        .attr("stroke-width", 1.5)
        .attr("stroke", (l: any) => {
          const src = typeof l.source === "string" ? l.source : l.source.id;
          return src === d.id ? colors.linkOut : colors.linkIn;
        });
      // Y la flecha, sólo la del nodo señalado: es la puerta de éste y no la de
      // sus vecinos, que están encendidos por vecindad y no por estar mirándose.
      d3.select(this)
        .select<SVGGElement>("g.node-open")
        .attr("opacity", 1)
        .style("pointer-events", "auto");
    })
    .on("mouseleave", function () {
      link
        .attr("stroke-opacity", 0.6)
        .attr("stroke-width", 1)
        .attr("stroke", colors.linkStroke);
      node.attr("opacity", 1);
      const opener = d3.select(this).select<SVGGElement>("g.node-open");
      opener.attr("opacity", 0).style("pointer-events", "none");
      // Y su marco con ella: si el puntero salta fuera del nodo de un tirón, el
      // `mouseleave` de la flecha puede no llegar, y el marco se quedaría
      // encendido en un nodo que ya nadie está señalando.
      opener.select(".node-open-frame").attr("opacity", 0);
    });

  /*
   * Lo colocado se conserva.
   *
   * Si todos los nodos ya tienen sitio, no se corre la simulación: se dibuja
   * donde estaban. Si aparecieron nodos nuevos, se siembra a los conocidos con
   * su posición y sólo lo nuevo tiene que encontrar hueco, así que el mapa no se
   * reordena entero por haber entrado una página más.
   */
  let allPlaced = data.nodes.length > 0;
  for (const item of data.nodes as any[]) {
    const held = positions.get(item.id);
    if (held === undefined) {
      allPlaced = false;
    } else {
      item.x = held.x;
      item.y = held.y;
    }
  }

  const remember = (): void => {
    for (const item of data.nodes as any[]) {
      if (typeof item.x === "number" && typeof item.y === "number") {
        positions.set(item.id, { x: item.x, y: item.y });
      }
    }
  };

  const place = (): void => {
    link
      .attr("x1", (d: any) => d.source.x)
      .attr("y1", (d: any) => d.source.y)
      .attr("x2", (d: any) => d.target.x)
      .attr("y2", (d: any) => d.target.y);
    node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);

    if (thread !== null) {
      const at = new Map<string, GraphNode>();
      for (const one of data.nodes) at.set(one.id, one);
      segment
        .attr("x1", (index) => at.get(thread.stops[index]?.page ?? "")?.x ?? 0)
        .attr("y1", (index) => at.get(thread.stops[index]?.page ?? "")?.y ?? 0)
        .attr("x2", (index) => at.get(thread.stops[index + 1]?.page ?? "")?.x ?? 0)
        .attr("y2", (index) => at.get(thread.stops[index + 1]?.page ?? "")?.y ?? 0)
        // Un tramo con un extremo que ya no existe no se puede dibujar: no hay
        // adónde. Se deja sin pintar y el puente cortado se ve por el número que
        // falta en la cadena.
        .style("display", (index) =>
          thread.stops[index]?.page === null || thread.stops[index + 1]?.page === null
            ? "none"
            : null,
        );
      // El número va encima del nombre y midiéndolo: con un desplazamiento fijo,
      // en cuanto el encuadre acerca las paradas el número cae dentro del nombre
      // y no se lee ninguno de los dos.
      stopMark
        .attr("x", (one) => at.get(one.page ?? "")?.x ?? 0)
        .attr("y", (one) => {
          const node = at.get(one.page ?? "");
          const box = dims.get(one.page ?? "") ?? { w: 0, h: 0 };
          return (node?.y ?? 0) - box.h / 2 - 4;
        });
    }
  };

  // El encuadre también se conserva: volver a una página no debe reencuadrar.
  if (heldTransform !== null) {
    svg.call(zoomBehavior.transform as any, heldTransform);
  }
  zoomBehavior.on("zoom", (event) => {
    heldTransform = event.transform;
    g.attr("transform", event.transform);
  });

  // Simulation — title mode needs more space and stronger repulsion
  const isTitle = style === "title";
  const collisionForce = isTitle
    ? rectCollide(dims, COLLISION_PAD)
    : d3.forceCollide<GraphNode>().radius(20);

  const linkDist = settings.linkDistance ?? (isTitle ? 120 : 80);
  const charge = settings.chargeStrength ?? (isTitle ? -400 : -200);

  const sim = d3
    .forceSimulation<GraphNode>(data.nodes)
    .force(
      "link",
      d3.forceLink<GraphNode, any>(data.links)
        .id((d) => d.id)
        .distance(linkDist)
    )
    .force("charge", d3.forceManyBody().strength(charge))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", collisionForce as any);

  /*
   * Y, mientras hay un recorrido abierto, los dos resortes del hilo.
   *
   * Sólo entonces: la fuerza se pone aquí y no existe cuando `thread` es nulo, así
   * que el mapa de quien no está leyendo un argumento es exactamente el de antes.
   * @guarantee TheThreadStraightensWhileItIsRead.
   */
  const chains: Moving[][] =
    thread === null
      ? []
      : runs(thread.stops.map((one) => one.page)).map((ids) =>
          ids
            .map((id) => (data.nodes as (GraphNode & Partial<Moving>)[]).find((n) => n.id === id))
            .filter((one): one is GraphNode & Moving => one !== undefined),
        );
  if (chains.some((chain) => chain.length >= 3)) {
    sim.force("spine", spineForce(chains) as any);
  }

  /*
   * Los nombres no se traslapan. Punto.
   *
   * La simulación se detiene cuando su alpha baja, no cuando los choques están
   * resueltos, así que quedaban nombres uno encima de otro —«Postgraduate
   * Research Symposium» sobre «PICTOS.net»— y dos nombres superpuestos no son
   * ninguno de los dos. Al terminar se sigue separando, ya sin fuerzas que tiren
   * en contra, hasta que no quede ningún choque o hasta un tope: converge en
   * unas pocas pasadas y el tope está para que un caso patológico no cuelgue la
   * pestaña.
   *
   * @guarantee GraphNodesAreTheirNames.
   */
  /*
   * Vuelve a medir cada nombre.
   *
   * Las cajas se miden en cuanto se dibujan, y en ese momento la tipografía
   * puede no haber llegado todavía: `font-display: swap` enseña la de reserva
   * primero, así que se medía una letra y se dibujaba otra, más ancha. Por eso
   * había nombres pisándose aunque la separación funcionara. Se vuelve a medir
   * sobre lo que hay de verdad en la pantalla.
   */
  const remeasure = (): void => {
    node.each(function (d) {
      const box = (this as SVGGElement).getBBox();
      if (box.width > 0) dims.set(d.id, { w: box.width, h: box.height });
    });
  };

  const untangle = (): void => {
    const items = data.nodes as any[];
    for (let pass = 0; pass < 60; pass += 1) {
      let moved = false;
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i];
          const b = items[j];
          const da = dims.get(a.id) ?? { w: 40, h: 16 };
          const db = dims.get(b.id) ?? { w: 40, h: 16 };
          const halfW = (da.w + db.w) / 2 + COLLISION_PAD;
          const halfH = (da.h + db.h) / 2 + COLLISION_PAD;

          let dx = b.x - a.x;
          let dy = b.y - a.y;
          if (dx === 0 && dy === 0) {
            // Exactamente encima: hay que romper el empate de algún modo.
            dx = 0.5;
            dy = 0.5;
          }

          const overlapX = halfW - Math.abs(dx);
          const overlapY = halfH - Math.abs(dy);
          if (overlapX <= 0 || overlapY <= 0) continue;

          moved = true;
          // Se separa por donde menos cuesta, que es lo que mantiene el dibujo
          // parecido al que la simulación había encontrado.
          if (overlapX < overlapY) {
            const shift = (overlapX / 2) * (dx > 0 ? 1 : -1);
            a.x -= shift;
            b.x += shift;
          } else {
            const shift = (overlapY / 2) * (dy > 0 ? 1 : -1);
            a.y -= shift;
            b.y += shift;
          }
        }
      }
      if (!moved) break;
    }
  };

  /*
   * Se resuelve de una vez, sin animación.
   *
   * Antes se dibujaba en cada tick y la separación de nombres corría al terminar
   * la simulación, confiando en el evento `end` de d3 — que con repintados
   * encadenados no siempre llega, así que quedaban nombres pisándose. Ahora la
   * simulación se corre entera aquí, se separan los nombres y se dibuja una vez.
   *
   * Además es lo que hace falta para que el mapa se pueda recordar: sin
   * animación no hay nada que se reacomode mientras uno mira, y lo que aparece
   * ya está en su sitio.
   */
  /**
   * Deja el nodo en el centro, sin cambiar cuánto se está acercando.
   *
   * De una vez y sin animar. Una transición de d3 vive atada al elemento, y cada
   * repintado empieza vaciando el contenedor: la transición moría con el SVG que
   * la esperaba y el nodo se quedaba donde estaba, sin error ni aviso. Además, un
   * mapa que no se mueve solo es lo que el resto de esta vista ya promete.
   */
  const centre = (d: any): void => {
    const at = heldTransform ?? d3.zoomIdentity;
    const to = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(at.k)
      .translate(-d.x, -d.y);
    zoomBehavior.transform(svg as any, to);
  };

  // Si en este dibujo hay que llevar algo al centro. Local y no global: la
  // separación de nombres vuelve a correr cuando llega la tipografía y mueve los
  // nodos, así que centrar una sola vez dejaba el nodo desplazado.
  const needsCentre = selected !== null && selected !== centred;

  const settle = (): void => {
    if (isTitle) {
      remeasure();
      untangle();
      if (!allPlaced) compactDisconnectedComponents(data.nodes, data.links, dims);
    }
    place();
    remember();
    if (!allPlaced && heldTransform === null) {
      frameAll();
    } else if (needsCentre) {
      const target = (data.nodes as any[]).find((item) => item.id === selected);
      if (target !== undefined) centre(target);
    }
  };

  /* Encuadra las cajas de los nombres, no sólo sus puntos. Ésta es la diferencia
     entre ver un grafo y quedar con la cámara dentro de una palabra. */
  frameAll = (): void => {
    if (data.nodes.length === 0) return;
    const bounds = data.nodes.map((item) => {
      const box = dims.get(item.id) ?? { w: 24, h: 18 };
      return { left: (item.x ?? 0) - box.w / 2, right: (item.x ?? 0) + box.w / 2,
        top: (item.y ?? 0) - box.h / 2, bottom: (item.y ?? 0) + box.h / 2 };
    });
    const left = Math.min(...bounds.map((one) => one.left));
    const right = Math.max(...bounds.map((one) => one.right));
    const top = Math.min(...bounds.map((one) => one.top));
    const bottom = Math.max(...bounds.map((one) => one.bottom));
    const graphWidth = Math.max(1, right - left);
    const graphHeight = Math.max(1, bottom - top);
    const padding = Math.min(48, Math.max(20, Math.min(width, height) * 0.08));
    const scale = Math.max(0.2, Math.min(1.5,
      (width - padding * 2) / graphWidth, (height - padding * 2) / graphHeight));
    const transform = d3.zoomIdentity.translate(width / 2, height / 2).scale(scale)
      .translate(-(left + right) / 2, -(top + bottom) / 2);
    zoomBehavior.transform(svg as any, transform);
  };

  /**
   * El mapa se acomoda a la vista, y sólo al abrir el recorrido.
   *
   * Todo lo demás en esta vista se resuelve de una vez y sin animar, a propósito:
   * un mapa que se mueve solo no se puede recordar. Esto es la excepción, y lo es
   * porque aquí el movimiento *es* lo que hay que ver — es el argumento
   * ordenándose, y verlo ordenarse dice qué paradas tira de dónde mejor de lo que
   * lo diría el resultado ya puesto.
   *
   * Se calienta a media máquina: sobre un mapa ya asentado, los enlaces y la
   * repulsión están cerca de su equilibrio, así que lo que se mueve es lo que
   * piden los resortes nuevos y no una redistribución entera. La caída lenta no es
   * estética: acortarla dejaba el hilo sin cruces pero con los tramos desiguales
   * —el codo desenreda rápido y el paso empareja despacio—, y son unos tres
   * segundos, que es lo que tarda en verse una forma.
   */
  const relax = (): void => {
    const mine = (relaxing += 1);
    sim.alpha(0.55).alphaDecay(0.018);

    /*
     * Con la pestaña de fondo no hay animación que valga: el navegador no da
     * cuadros a lo que nadie está mirando, y esperarlos dejaba el recorrido
     * abierto y sin acomodar hasta que alguien volviera. Se resuelve de una vez,
     * como todo lo demás en esta vista, y al volver ya está puesto.
     */
    if (document.hidden) {
      while (sim.alpha() > 0.02) sim.tick();
      settle();
      straightened = thread?.page ?? null;
      return;
    }
    const frame = (): void => {
      if (mine !== relaxing || !container.isConnected) return;
      sim.tick();
      place();
      if (sim.alpha() > 0.02) {
        requestAnimationFrame(frame);
        return;
      }
      // Y al parar, los nombres se separan y el sitio queda anotado: lo que se
      // vio moverse es donde el mapa se queda.
      settle();
      straightened = thread?.page ?? null;
    };
    requestAnimationFrame(frame);
  };

  // Un dibujo nuevo deja sin efecto el acomodo que estuviera corriendo.
  relaxing += 1;

  sim.stop();
  if (!allPlaced) {
    // Trescientos pasos es lo que d3 haría por su cuenta antes de detenerse. En
    // un mapa acotado por alcance son unas decenas de nodos: se hace en un
    // suspiro y no se ve moverse nada.
    for (let step = 0; step < 300; step += 1) sim.tick();
  }
  settle();
  draw();

  /*
   * Y si el recorrido se acaba de abrir sobre un mapa que ya estaba puesto, se
   * ve acomodarse.
   *
   * Sólo entonces. Con nodos nuevos la simulación ya corrió entera con los
   * resortes dentro y el mapa llega hecho: no hay nada que mirar moverse porque
   * no había nada antes. Y en los repintados siguientes del mismo recorrido las
   * paradas ya están donde los resortes las querían, así que animar sería mover
   * el mapa por moverlo.
   */
  if (
    thread !== null &&
    straightened !== thread.page &&
    allPlaced &&
    chains.some((one) => one.length >= 3)
  ) {
    relax();
  }

  /*
   * Queda anotado que ya se centró en este nodo.
   *
   * Centrar en cada repintado desharía la panorámica que alguien hizo a mano
   * —colapsar el panel, cambiar de tamaño la ventana— y un mapa que se recoloca
   * solo deja de poder recorrerse. Se centra al llegar a una página, y después
   * el mapa es de quien lo mira.
   */
  if (selected !== null) centred = selected;
  // Y el recorrido queda encuadrado una vez: a partir de ahí el mapa es de quien
  // lo mira, y reencuadrar en cada guardado le quitaría el mapa de las manos.
  if (thread !== null) framed = thread.page;

  // Y otra vez cuando la tipografía haya llegado: las cajas se miden con la
  // letra que hay en pantalla, y `font-display: swap` enseña la de reserva
  // primero. `document.fonts.ready` resuelve de inmediato si ya estaba.
  if (isTitle) {
    void document.fonts.ready.then(() => {
      // Entretanto pudo haberse redibujado el mapa; si estos nodos ya no están
      // en el documento, no hay nada que reacomodar.
      if (!container.isConnected || svg.node()?.isConnected !== true) return;
      settle();
    });
  }

  // El arrastre sí anima: mover un nodo a mano es la única vez que uno quiere
  // ver moverse el mapa, porque lo está moviendo.
  sim.on("tick", place);

  node.call(
    drag(sim, remember, () => {
      relaxing += 1;
    }) as any,
  );
}

// ── Circular mode ──
function renderCircularNodes(
  node: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>,
  _data: GraphData,
  dims: Map<string, { w: number; h: number }>,
  historyMap: Map<string, number>,
  colors: Record<string, string>,
  showNodes: boolean,
  showTitles: boolean,
  fontSize: number
) {
  const RING_LEVELS = [
    { strokeWidth: 6, opacity: 1.0 },
    { strokeWidth: 5, opacity: 0.8 },
    { strokeWidth: 4, opacity: 0.6 },
    { strokeWidth: 4, opacity: 0.4 },
    { strokeWidth: 4, opacity: 0.2 },
  ];

  if (showNodes) {
    node
      .append("circle")
      .attr("r", (d) => (d.central ? 12 : 4 + Math.min(d.degree * 1.5, 10)))
      .attr("fill", (d) => (d.central ? colors.nodeCentral : colors.nodeFill) ?? "#999")
      .attr("fill-opacity", 0.7)
      .attr("stroke", "none")
      .attr("stroke-width", 0);

    // History rings
    node
      .filter((d) => historyMap.has(d.id.toLowerCase()))
      .append("circle")
      .attr("r", (d) => {
        const baseR = d.central ? 12 : 4 + Math.min(d.degree * 1.5, 10);
        const idx = historyMap.get(d.id.toLowerCase()) ?? 0;
        const level = RING_LEVELS[idx] ?? RING_LEVELS[0];
        return baseR + (level?.strokeWidth ?? 0) / 2 + 2;
      })
      .attr("fill", "none")
      .attr("stroke", RING_COLOR)
      .attr("stroke-width", (d) => RING_LEVELS[historyMap.get(d.id.toLowerCase()) ?? 0]?.strokeWidth ?? 1)
      .attr("stroke-opacity", (d) => RING_LEVELS[historyMap.get(d.id.toLowerCase()) ?? 0]?.opacity ?? 1);
  }

  if (showTitles) {
    // Multiline labels centered on the node
    node.each(function (d) {
      const g = d3.select(this);
      const fs = d.central ? fontSize + 2 : fontSize;
      const lines = wrapText(d.name, MAX_LABEL_CHARS);
      const lineHeight = fs * 1.2;
      const yOffset = -((lines.length - 1) * lineHeight) / 2;
      const textEl = g.append("text")
        .attr("text-anchor", "middle")
        .attr("font-size", `${fs}px`)
        .attr("font-weight", d.central ? "bold" : "normal")
        .attr("fill", colors.textNormal ?? "#333");
      lines.forEach((line, i) => {
        textEl.append("tspan")
          .attr("x", 0)
          .attr("dy", i === 0 ? `${yOffset}px` : `${lineHeight}px`)
          .text(line);
      });
    });
  } else {
    // Tooltip only (native SVG title element)
    node.append("title").text((d) => d.name);
  }

  // Store dims for collision (approximate)
  node.each((d) => {
    const r = d.central ? 12 : 4 + Math.min(d.degree * 1.5, 10);
    dims.set(d.id, { w: r * 2, h: r * 2 });
  });
}

// ── Title mode ──
function renderTitleNodes(
  node: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>,
  _data: GraphData,
  dims: Map<string, { w: number; h: number }>,
  historyMap: Map<string, number>,
  colors: Record<string, string>,
  fontFamily: string,
  fontSize: number,
  fills: Map<string, string>
) {
  void colors.nodeBorder;
  // History color: nodes in history get orange tint, fading with recency
  // Por dónde se ha pasado, desvaneciéndose con la distancia en el rastro. El
  // color es `--warm`, el mismo token que usa el resto de la interfaz para lo
  // que pide atención sin ser un error.
  const historyColor = (d: GraphNode): string | null => {
    const idx = historyMap.get(d.id.toLowerCase());
    if (idx === undefined) return null;
    const opacities = [1, 0.7, 0.5, 0.3, 0.15];
    return `color-mix(in srgb, ${colors.visited} ${(opacities[idx] ?? 0.15) * 100}%, transparent)`;
  };

  // Font size range based on user's fontSize setting
  const fMin = fontSize;
  const fMax = fontSize + 8;

  function scaledTitleFontSize(d: GraphNode): number {
    if (d.central) return fMax;
    const count = d.blockCount ?? BLOCKS_MIN;
    const t = Math.min(1, Math.max(0, (count - BLOCKS_MIN) / (BLOCKS_MAX - BLOCKS_MIN)));
    return fMin + (fMax - fMin) * Math.sqrt(t);
  }

  // Text labels with word wrap — the only visible element per node
  node.each(function (d) {
    const g = d3.select(this);
    const fs = scaledTitleFontSize(d);
    const lines = wrapText(d.name, MAX_LABEL_CHARS);
    const lineHeight = fs * 1.25;
    const yOffset = -((lines.length - 1) * lineHeight) / 2;
    const fill = historyColor(d) ?? (d.central ? colors.nodeCentral : colors.textNormal) ?? '#888';
    fills.set(d.id, fill);
    const textEl = g.append("text")
      .attr("font-size", `${fs}px`)
      .attr("font-weight", d.central ? "bold" : "normal")
      .attr("font-family", fontFamily ?? "sans-serif")
      .attr("text-anchor", "middle")
      .attr("fill", fill ?? "#333");
    lines.forEach((line, i) => {
      textEl.append("tspan")
        .attr("x", 0)
        .attr("dy", i === 0 ? `${yOffset}px` : `${lineHeight}px`)
        .text(line);
    });
  });

  // Measure bounding boxes for collision
  node.each(function (d) {
    const bbox = (this as SVGGElement).getBBox();
    dims.set(d.id, {
      w: bbox.width + PAD_X * 2,
      h: bbox.height + PAD_Y * 2,
    });
  });
}

// ── Rectangular collision force ──
// Hard constraint: text boxes must never overlap.
// Runs multiple passes per tick to fully resolve collisions.
function rectCollide(
  dims: Map<string, { w: number; h: number }>,
  padding: number
) {
  let nodes: GraphNode[] = [];
  const ITERATIONS = 4; // passes per tick for convergence

  function force(_alpha: number) {
    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i] as any;
          const b = nodes[j] as any;

          const da = dims.get(a.id) ?? { w: 40, h: 16 };
          const db = dims.get(b.id) ?? { w: 40, h: 16 };

          const halfW = (da.w + db.w) / 2 + padding;
          const halfH = (da.h + db.h) / 2 + padding;

          let dx = b.x - a.x;
          let dy = b.y - a.y;

          // Prevent exact overlap (jitter escape)
          if (dx === 0 && dy === 0) {
            dx = (Math.random() - 0.5) * 2;
            dy = (Math.random() - 0.5) * 2;
          }

          const overlapX = halfW - Math.abs(dx);
          const overlapY = halfH - Math.abs(dy);

          if (overlapX > 0 && overlapY > 0) {
            // Push along the axis with less overlap (full resolution)
            if (overlapX < overlapY) {
              const shift = overlapX * 0.5;
              const sx = dx > 0 ? shift : -shift;
              if (!a.fx) a.x -= sx;
              if (!b.fx) b.x += sx;
            } else {
              const shift = overlapY * 0.5;
              const sy = dy > 0 ? shift : -shift;
              if (!a.fy) a.y -= sy;
              if (!b.fy) b.y += sy;
            }
          }
        }
      }
    }
  }

  force.initialize = (n: GraphNode[]) => {
    nodes = n;
  };

  return force;
}

// ── Drag behavior ──
function drag(
  simulation: d3.Simulation<GraphNode, undefined>,
  remember: () => void,
  interrupt: () => void,
) {
  return d3
    .drag<SVGGElement, GraphNode>()
    .on("start", (event, d: any) => {
      // Una mano encima manda más que el hilo acomodándose: si el recorrido se
      // estaba enderezando, deja de hacerlo aquí.
      interrupt();
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event, d: any) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d: any) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
      remember();
    });
}
