import * as d3 from 'd3';
import { renderMarkdown } from '@vera/core';
import type { GraphData, GraphLink, GraphNode } from './types.ts';
import type { ThreadSettings } from './render.ts';

type Side = -1 | 0 | 1;

const held = new Map<string, { x: number; y: number }>();
const openRelations = new Set<string>();
let focusedRelation: string | null = null;

interface RelationActions {
  editBlock?: (block: string, content: string) => Promise<boolean>;
  createBlock?: (
    crossing: string,
    page: string,
    parent: string | null,
    position: number,
    content?: string,
  ) => Promise<boolean>;
  createRelation?: (fromPage: string, toPage: string) => Promise<string | null>;
  refresh?: () => Promise<void>;
}

function endpoint(value: string | GraphNode): string {
  return typeof value === 'string' ? value : value.id;
}

function sentences(node: GraphNode): { block: string; text: string; gloss: boolean }[] {
  const result: { block: string; text: string; gloss: boolean }[] = [];
  for (const line of node.lines ?? []) {
    const pieces = line.content.split(/(?<=[.!?;:])\s+/u).filter(Boolean);
    for (const text of pieces) result.push({ block: line.block, text, gloss: false });
    if (line.gloss?.trim()) result.push({ block: line.block, text: line.gloss.trim(), gloss: true });
  }
  return result.length > 0 ? result : [{ block: '', text: node.name, gloss: false }];
}

function projectedSentences(
  node: GraphNode,
  data: GraphData,
): { shown: { block: string; text: string; gloss: boolean }[]; hidden: number } {
  const all = sentences(node);
  const relevant: typeof all = [];
  const seen = new Set<string>();
  for (const link of data.links) {
    if (endpoint(link.source) !== node.id || link.block == null || link.kind === 'crossing') continue;
    const candidates = all.filter((line) =>
      line.block === link.block &&
      (link.kind !== 'gloss' || line.gloss) &&
      (link.targetTitle === undefined || line.text.toLocaleLowerCase().includes(link.targetTitle.toLocaleLowerCase())),
    );
    const chosen = candidates.length > 0
      ? candidates
      : all.filter((line) => line.block === link.block && (link.kind !== 'gloss' || line.gloss));
    for (const line of chosen) {
      const key = `${line.block}\u0000${line.gloss ? 'g' : 'b'}\u0000${line.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relevant.push(line);
    }
  }
  return { shown: relevant, hidden: Math.max(0, all.length - relevant.length) };
}

const foldedLineHeight = 11;
const branchHitWidth = 30;
const nodeGap = branchHitWidth + 8;

function sides(data: GraphData, focus: string): Map<string, Side> {
  const side = new Map<string, Side>([[focus, 0]]);
  for (const link of data.links) {
    const source = endpoint(link.source);
    const target = endpoint(link.target);
    if (target === focus) side.set(source, -1);
    if (source === focus) side.set(target, 1);
  }
  for (let pass = 0; pass < data.nodes.length; pass += 1) {
    for (const link of data.links) {
      const source = endpoint(link.source);
      const target = endpoint(link.target);
      if (!side.has(source) && side.has(target)) side.set(source, side.get(target)! || -1);
      if (!side.has(target) && side.has(source)) side.set(target, side.get(source)! || 1);
    }
  }
  for (const node of data.nodes) if (!side.has(node.id)) side.set(node.id, 1);
  return side;
}

export function renderGraphD4(
  container: HTMLElement,
  data: GraphData,
  onClickPage: (page: string) => void,
  options: {
    dark?: boolean;
    fontFamily?: string;
    relations?: RelationActions;
    thread?: ThreadSettings | null;
  } = {},
): void {
  container.innerHTML = '';
  const focus = data.nodes.find((node) => node.central)?.id ?? data.nodes[0]?.id;
  if (focus === undefined) return;

  const width = Math.max(container.clientWidth, 960);
  const height = Math.max(container.clientHeight, 640);
  const centreX = width / 2;
  // El vacío entre páginas no es desperdicio: es donde viven las relaciones.
  const columnGap = Math.max(680, Math.min(980, width * 0.62));
  const boxWidth = Math.max(300, Math.min(440, columnGap - 300));
  const thread = options.thread ?? null;
  const focusedLink = focusedRelation === null
    ? undefined
    : data.links.find((link) => link.kind === 'crossing' && link.crossing === focusedRelation);
  if (focusedRelation !== null && focusedLink === undefined) focusedRelation = null;
  const threadOrder = new Map<string, number>();
  for (const stop of thread?.stops ?? []) {
    if (stop.page !== null && !threadOrder.has(stop.page)) threadOrder.set(stop.page, stop.ordinal);
  }
  const side = sides(data, focus);
  const projections = new Map(data.nodes.map((node) => [node.id, projectedSentences(node, data)]));
  const dims = new Map<string, { w: number; h: number }>();
  for (const node of data.nodes) {
    const projection = projections.get(node.id)!;
    dims.set(node.id, {
      w: boxWidth,
      h: 48 + projection.shown.length * foldedLineHeight + (projection.hidden > 0 ? 18 : 0),
    });
  }

  const columns = new Map<number, GraphNode[]>();
  for (const node of data.nodes) {
    const degree = Math.max(0, node.distance ?? (node.central ? 0 : 1));
    const column = side.get(node.id)! * degree;
    const list = columns.get(column) ?? [];
    list.push(node);
    columns.set(column, list);
  }
  for (const [column, nodes] of columns) {
    nodes.sort((a, b) => {
      const ao = threadOrder.get(a.id);
      const bo = threadOrder.get(b.id);
      if (ao !== undefined || bo !== undefined) return (ao ?? Number.MAX_SAFE_INTEGER) - (bo ?? Number.MAX_SAFE_INTEGER);
      return (held.get(a.id)?.y ?? 0) - (held.get(b.id)?.y ?? 0) || a.name.localeCompare(b.name);
    });
    // El blanco táctil del cable mide 44 px. Dejar menos aire entre páginas
    // produce zonas interactivas superpuestas aunque los trazos aún parezcan
    // distintos; el layout debe responder a la interacción, no a una altura
    // incidental del viewport.
    const total = nodes.reduce((sum, node) => sum + dims.get(node.id)!.h, 0) + Math.max(0, nodes.length - 1) * nodeGap;
    // También cuando la pila es más alta que la pantalla se compone alrededor
    // del foco. Antes se sujetaba su borde superior a y=30: en vecindarios
    // grandes el foco quedaba, literalmente, arriba de toda la red.
    let y = (height - total) / 2;
    for (const node of nodes) {
      const dim = dims.get(node.id)!;
      held.set(node.id, { x: centreX + column * columnGap, y: y + dim.h / 2 });
      y += dim.h + nodeGap;
    }
  }

  // Las columnas son la semilla semántica del dibujo, no rieles rígidos. Una
  // relajación determinista separa las tarjetas en ambas dimensiones y luego
  // las atrae suavemente hacia su grado original. Así el mapa conserva la
  // dirección general sin apilar cajas ni depender de una simulación animada.
  const anchors = new Map([...held].map(([id, position]) => [id, { ...position }]));
  const movable = data.nodes.filter((node) => !node.central);
  const columnOf = new Map<string, number>();
  for (const [column, nodes] of columns) for (const node of nodes) columnOf.set(node.id, column);
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  // Los enlaces operan como resortes, pero no deciden por sí solos el orden de
  // lectura. Acercan verticalmente aquello que se relaciona y corrigen sólo una
  // fracción de la distancia horizontal; las anclas de grado mantienen el flujo
  // de izquierda a derecha. La simulación es finita y determinista: no deja un
  // `requestAnimationFrame` vivo en mapas grandes.
  for (let pass = 0; pass < 144; pass += 1) {
    for (const link of data.links) {
      const sourceNode = nodeById.get(endpoint(link.source));
      const targetNode = nodeById.get(endpoint(link.target));
      if (sourceNode === undefined || targetNode === undefined) continue;
      const source = held.get(sourceNode.id)!;
      const target = held.get(targetNode.id)!;
      const sourceColumn = columnOf.get(sourceNode.id) ?? 0;
      const targetColumn = columnOf.get(targetNode.id) ?? sourceColumn + 1;
      const direction = Math.sign(targetColumn - sourceColumn) || 1;
      const desiredX = Math.max(1, Math.abs(targetColumn - sourceColumn)) * columnGap * direction;
      const xError = (target.x - source.x) - desiredX;
      const yError = target.y - source.y;
      const spring = link.kind === 'crossing' ? 0.018 : 0.009;
      if (!sourceNode.central) {
        source.x += xError * spring * 0.22;
        source.y += yError * spring;
      }
      if (!targetNode.central) {
        target.x -= xError * spring * 0.22;
        target.y -= yError * spring;
      }
    }
    for (let left = 0; left < data.nodes.length; left += 1) {
      const aNode = data.nodes[left]!;
      const a = held.get(aNode.id)!;
      const ad = dims.get(aNode.id)!;
      for (let right = left + 1; right < data.nodes.length; right += 1) {
        const bNode = data.nodes[right]!;
        const b = held.get(bNode.id)!;
        const bd = dims.get(bNode.id)!;
        const overlapX = (ad.w + bd.w) / 2 + 34 - Math.abs(b.x - a.x);
        const overlapY = (ad.h + bd.h) / 2 + nodeGap - Math.abs(b.y - a.y);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const separateX = overlapX < overlapY;
        const amount = (separateX ? overlapX : overlapY) / 2 + 0.5;
        const sign = separateX
          ? (b.x === a.x ? (bNode.name.localeCompare(aNode.name) || 1) : Math.sign(b.x - a.x))
          : (b.y === a.y ? (bNode.name.localeCompare(aNode.name) || 1) : Math.sign(b.y - a.y));
        if (!aNode.central) {
          if (separateX) a.x -= sign * amount;
          else a.y -= sign * amount;
        }
        if (!bNode.central) {
          if (separateX) b.x += sign * amount;
          else b.y += sign * amount;
        }
      }
    }
    for (const node of movable) {
      const position = held.get(node.id)!;
      const anchor = anchors.get(node.id)!;
      position.x += (anchor.x - position.x) * 0.048;
      position.y += (anchor.y - position.y) * 0.012;
    }
  }

  // Al trabajar una relación, sus páginas dejan de obedecer temporalmente al
  // stack de su grado y se enfrentan alrededor del editor. No cambia el grafo ni
  // se guardan estas posiciones: es el equivalente espacial de enfocar un campo.
  if (focusedLink !== undefined) {
    const source = endpoint(focusedLink.source);
    const target = endpoint(focusedLink.target);
    const sourceDim = dims.get(source);
    const targetDim = dims.get(target);
    if (sourceDim !== undefined && targetDim !== undefined) {
      const editorHalfWidth = Math.max(
        150,
        Math.min(210, (width - sourceDim.w - targetDim.w - 72) / 2),
      );
      held.set(source, { x: centreX - editorHalfWidth - sourceDim.w / 2 - 18, y: height / 2 });
      held.set(target, { x: centreX + editorHalfWidth + targetDim.w / 2 + 18, y: height / 2 });
    }
  }

  const svg = d3.select(container).append('svg')
    .attr('class', `d4-map${focusedLink === undefined ? '' : ' relation-focused'}`)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('role', 'img')
    .attr('aria-label', 'D4: mapa dendrítico por grados');
  const iosWebKit = /iP(?:ad|hone|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // En iOS la cámara será el viewBox: una sola transformación nativa mueve
  // geometría y foreignObject. El escritorio conserva su ruta SVG ya probada.
  const world = svg.append('g').attr('class', 'd4-geometry');
  const defs = svg.append('defs');
  defs.append('marker')
    .attr('id', 'd4-relation-arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 9)
    .attr('refY', 0)
    .attr('markerWidth', 7)
    .attr('markerHeight', 7)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5Z');
  let viewport = d3.zoomIdentity;
  const viewportCards: Array<{
    foreign: d3.Selection<SVGForeignObjectElement, unknown, null, undefined>;
    x: number;
    y: number;
    width: number;
    height: number;
    card: d3.Selection<HTMLElement, unknown, null, undefined>;
  }> = [];
  const positionViewportCards = (): void => {
    if (iosWebKit) return;
    for (const entry of viewportCards) {
      entry.foreign.attr('transform', viewport.toString());
    }
  };
  const positionViewportGeometry = (): void => {
    if (iosWebKit) return;
    // No confiar tampoco en el repintado de un transform heredado por el <g>:
    // Safari móvil puede conservar sus hijos en la posición anterior.
    world.selectAll<SVGGraphicsElement, unknown>('.d4-branch, .d4-branch-hit, .d4-thread, .d4-thread-stop')
      .attr('transform', viewport.toString());
  };
  const touchStarts = new Map<number, { x: number; y: number }>();
  const movedSince = (event: PointerEvent): boolean => {
    const start = touchStarts.get(event.pointerId);
    touchStarts.delete(event.pointerId);
    return start !== undefined && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8;
  };
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    // El mínimo fijo anterior hacía imposible encuadrar vecindarios grandes.
    // Un límite pequeño sigue evitando singularidades sin imponer el tamaño
    // máximo del mapa que Herbert puede mirar.
    .scaleExtent([0.025, 2.5])
    // Safari sintetiza un click al terminar un paneo táctil. Por debajo de este
    // umbral es un toque; por encima, D4 lo conserva exclusivamente como gesto
    // espacial y no deja que navegue al elemento que quedó bajo el dedo.
    .clickDistance(8)
    .on('zoom', (event) => {
      viewport = event.transform;
      if (iosWebKit) {
        // `transform` sobre foreignObject y CSS sobre su HTML forman dos capas
        // de composición en WebKit. Cambiar la cámara evita ese parallax: nada
        // dentro del dibujo recibe una segunda transformación.
        svg.attr(
          'viewBox',
          `${-viewport.x / viewport.k} ${-viewport.y / viewport.k} ` +
          `${width / viewport.k} ${height / viewport.k}`,
        );
      }
      positionViewportGeometry();
      positionViewportCards();
    });
  svg.call(zoom);

  const foldedLines: HTMLElement[] = [];
  const raiseReadingCards = (last?: SVGForeignObjectElement | null): void => {
    const reading = new Set<SVGForeignObjectElement>();
    for (const line of foldedLines) {
      if (!line.classList.contains('hovered') && !line.classList.contains('expanded') &&
          !line.matches(':focus-within')) continue;
      const foreign = line.closest('.d4-card') as SVGForeignObjectElement | null;
      if (foreign !== null && foreign !== last) reading.add(foreign);
    }
    // Primero toda página que esté proyectando texto; al final, la activa. Así
    // ninguna página corriente puede pintar encima de un bloque desplegado.
    for (const foreign of reading) d3.select(foreign).raise();
    if (last !== undefined && last !== null) d3.select(last).raise();
  };
  const clearHoveredLine = (): void => {
    for (const line of foldedLines) line.classList.remove('hovered');
    raiseReadingCards();
  };
  // La caja desplegada es sólo una proyección para leer. El bloque señalado se
  // decide siempre contra las franjas de 11 px que constituyen el mapa, de modo
  // que leer de arriba abajo no queda detenido por la proyección anterior.
  svg.on('pointermove.d4-reading', (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    let pointed: HTMLElement | undefined;
    for (const line of foldedLines) {
      const box = line.getBoundingClientRect();
      if (event.clientX >= box.left && event.clientX <= box.right &&
          event.clientY >= box.top && event.clientY <= box.bottom) pointed = line;
    }
    clearHoveredLine();
    if (pointed === undefined) return;
    pointed.classList.add('hovered');
    const foreign = pointed.closest('.d4-card') as SVGForeignObjectElement | null;
    raiseReadingCards(foreign);
  }).on('pointerleave.d4-reading', clearHoveredLine);

  const lineY = (node: GraphNode, link: GraphLink): number => {
    const pos = held.get(node.id)!;
    const dim = dims.get(node.id)!;
    const lines = projections.get(node.id)!.shown;
    let index = lines.findIndex((line) =>
      line.block === link.block &&
      (link.targetTitle === undefined || line.text.toLocaleLowerCase().includes(link.targetTitle.toLocaleLowerCase())),
    );
    if (index < 0) index = Math.max(0, lines.findIndex((line) => line.block === link.block));
    return pos.y - dim.h / 2 + 48 + index * foldedLineHeight + foldedLineHeight / 2;
  };
  const incoming = new Map<string, GraphLink[]>();
  for (const link of data.links) {
    const target = endpoint(link.target);
    const links = incoming.get(target) ?? [];
    links.push(link);
    incoming.set(target, links);
  }
  // Varias ramas ya no desembocan en el mismo píxel. Los puertos se reparten
  // en una franja estable de la tarjeta de destino y conservan su orden por la
  // altura de las fuentes, de modo que el abanico reduce cruces al hacer zoom.
  const targetY = (node: GraphNode, link: GraphLink): number => {
    const links = incoming.get(node.id) ?? [link];
    links.sort((a, b) => {
      const ay = held.get(endpoint(a.source))?.y ?? 0;
      const by = held.get(endpoint(b.source))?.y ?? 0;
      return ay - by || endpoint(a.source).localeCompare(endpoint(b.source));
    });
    const index = Math.max(0, links.indexOf(link));
    const pos = held.get(node.id)!;
    const dim = dims.get(node.id)!;
    const span = Math.max(0, Math.min(dim.h - 24, (links.length - 1) * 18));
    return links.length < 2 ? pos.y : pos.y - span / 2 + span * index / (links.length - 1);
  };
  const relationCards: Array<{
    link: GraphLink;
    source: GraphNode;
    x: number;
    y: number;
  }> = [];
  for (const link of data.links) {
    const source = data.nodes.find((node) => node.id === endpoint(link.source));
    const target = data.nodes.find((node) => node.id === endpoint(link.target));
    if (source === undefined || target === undefined) continue;
    if (thread !== null && (source.id === thread.page || target.id === thread.page)) continue;
    const a = held.get(source.id)!;
    const b = held.get(target.id)!;
    const ad = dims.get(source.id)!;
    const bd = dims.get(target.id)!;
    const isFocused = link.crossing !== undefined && link.crossing === focusedRelation;
    const forward = a.x <= b.x;
    const x1 = a.x + (forward ? ad.w / 2 : -ad.w / 2);
    const x2 = b.x + (forward ? -bd.w / 2 : bd.w / 2);
    const y1 = lineY(source, link);
    const y2 = targetY(target, link);
    const tension = Math.max(90, Math.abs(x2 - x1) * 0.46);
    const route = isFocused
      ? `M${x1},${height / 2} L${x2},${height / 2}`
      : `M${x1},${y1} C${x1 + (forward ? tension : -tension)},${y1} ${x2 - (forward ? tension : -tension)},${y2} ${x2},${y2}`;
    const path = world.append('path')
      .attr('class', `d4-branch ${link.kind ?? 'reference'}${isFocused ? ' focused' : focusedLink === undefined ? '' : ' context'}`)
      .attr('d', route);
    path.attr('marker-end', 'url(#d4-relation-arrow)');
    if (link.explanation !== undefined) path.append('title').text(link.explanation);
    const openRelation = async (): Promise<void> => {
      let crossing = link.crossing;
      if (crossing === undefined && options.relations?.createRelation !== undefined) {
        crossing = await options.relations.createRelation(source.id, target.id) ?? undefined;
        if (crossing === undefined) return;
        focusedRelation = crossing;
        openRelations.clear();
        openRelations.add(crossing);
        await options.relations.refresh?.();
        return;
      }
      if (crossing === undefined) return;
      openRelations.clear();
      openRelations.add(crossing);
      focusedRelation = crossing;
      renderGraphD4(container, data, onClickPage, options);
    };
    const hit = world.append('path')
      .attr('class', 'd4-branch-hit')
      .attr('d', route)
      .attr('role', 'button')
      .attr('tabindex', 0)
      .attr('aria-label', link.crossing === undefined
        ? `Crear relación hacia ${target.name}`
        : `Abrir relación${link.label?.trim() ? `: ${link.label}` : ''}`)
      .on('click', (event: MouseEvent) => {
        event.stopPropagation();
        void openRelation();
      })
      .on('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        void openRelation();
      });
    // Toda arista es una relación editable, aunque todavía no tenga una
    // conectiva naranja. Hacer visible el mismo affordance evita que el color
    // se interprete como permiso.
    hit.on('pointerenter', () => path.classed('editable-hover', true))
      .on('pointerleave', () => path.classed('editable-hover', false));
    if (link.kind === 'crossing' && link.crossing !== undefined) {
      relationCards.push({
        link,
        source,
        x: (x1 + x2) / 2,
        y: isFocused ? height / 2 : (y1 + y2) / 2,
      });
    }
  }

  // D4 ordena el vecindario en columnas, pero el argumento no nace de esa
  // geometría: conserva la secuencia que declaró su texto. El hilo se superpone
  // sin entrar a `data.links`, de modo que no altera grados ni distancias.
  // @guarantee TheKnotsKeepTheArgumentsOrder.
  if (thread !== null) {
    thread.kinds.forEach((kind, index) => {
      const from = thread.stops[index]?.page;
      const to = thread.stops[index + 1]?.page;
      const a = from === null || from === undefined ? undefined : held.get(from);
      const b = to === null || to === undefined ? undefined : held.get(to);
      if (a === undefined || b === undefined) return;
      world.append('path')
        .attr('class', `d4-thread ${kind === 'by_path' ? 'by-path' : 'open-ground'}`)
        .attr('d', `M${a.x},${a.y} L${b.x},${b.y}`);
    });
    const ordinalsByPage = new Map<string, number[]>();
    for (const stop of thread.stops) {
      if (stop.page === null) continue;
      const ordinals = ordinalsByPage.get(stop.page) ?? [];
      ordinals.push(stop.ordinal);
      ordinalsByPage.set(stop.page, ordinals);
    }
    for (const [page, ordinals] of ordinalsByPage) {
      const at = held.get(page);
      if (at === undefined) continue;
      world.append('text')
        .attr('class', 'd4-thread-stop')
        .attr('x', at.x)
        .attr('y', at.y - dims.get(page)!.h / 2 - 8)
        .attr('text-anchor', 'middle')
        .text(ordinals.join(' · '));
    }
  }

  const nodesToDraw = [...data.nodes].sort((a, b) => {
    if (focusedLink === undefined) return 0;
    const endpoints = new Set([endpoint(focusedLink.source), endpoint(focusedLink.target)]);
    return Number(endpoints.has(a.id)) - Number(endpoints.has(b.id));
  });
  for (const node of nodesToDraw) {
    if (thread !== null && node.id === thread.page) continue;
    const pos = held.get(node.id)!;
    const dim = dims.get(node.id)!;
    const foreign = svg.append('foreignObject')
      .attr('class', 'd4-card')
      .attr('x', pos.x - dim.w / 2).attr('y', pos.y - dim.h / 2)
      .attr('width', dim.w).attr('height', dim.h);
    foreign.style('overflow', 'visible');
    const card = foreign.append<HTMLElement>('xhtml:article')
      .attr('class', `d4-page${node.central ? ' focus' : ''}${
        focusedLink === undefined || node.id === endpoint(focusedLink.source) || node.id === endpoint(focusedLink.target)
          ? ''
          : ' relation-context'
      }`)
      .style('width', `${dim.w}px`)
      // El foreignObject crece para alojar la tarjeta escalada, pero el HTML
      // debe conservar su caja de layout original. Con `height: 100%`, Safari
      // resolvía primero la altura contra el viewport ya ampliado y luego
      // volvía a aplicar `scale(k)`: la tarjeta crecía k² sólo en vertical.
      .style('height', `${dim.h}px`)
      .style('transform-origin', '0 0')
      .style('font-family', options.fontFamily ?? 'system-ui, sans-serif');
    viewportCards.push({
      foreign,
      x: pos.x - dim.w / 2,
      y: pos.y - dim.h / 2,
      width: dim.w,
      height: dim.h,
      card,
    });
    positionViewportCards();
    const focusNow = (): void => {
      // La navegación trae después el nuevo vecindario, pero el gesto no debe
      // esperar dos lecturas de red para acusar recibo. Marcamos el nuevo foco
      // sobre el mapa que ya está en la mano; drawGraph lo sustituirá por el
      // vecindario canónico cuando llegue.
      svg.selectAll<HTMLElement, unknown>('.d4-page').classed('focus', false);
      card.classed('focus', true);
    };
    card.append('h2')
      .attr('role', 'button')
      .attr('tabindex', 0)
      .on('click', (event: MouseEvent) => {
        if (!event.defaultPrevented) {
          focusNow();
          onClickPage(node.id);
        }
      })
      .on('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          focusNow();
          onClickPage(node.id);
        }
      })
      .text(node.name);
    const body = card.append('div').attr('class', 'd4-lines');
    const projection = projections.get(node.id)!;
    for (const line of projection.shown) {
      const leaf = body.append('div')
        .attr('class', line.gloss ? 'd4-line gloss' : 'd4-line')
        .attr('data-block', line.block)
        .attr('tabindex', 0)
        .attr('aria-label', `Ampliar: ${line.text}`);
      foldedLines.push(leaf.node()!);
      leaf.on('focusin', () => raiseReadingCards(foreign.node()));
      const content = leaf.append('div')
        .attr('class', 'd4-line-content')
        .html(renderMarkdown(line.text));
      let readingGesture: { pointer: number; y: number; scrollTop: number } | undefined;
      content.on('pointerdown', (event: PointerEvent) => {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        event.stopPropagation();
        const element = event.currentTarget as HTMLElement;
        readingGesture = { pointer: event.pointerId, y: event.clientY, scrollTop: element.scrollTop };
        element.setPointerCapture(event.pointerId);
      });
      content.on('pointermove', (event: PointerEvent) => {
        if (readingGesture?.pointer !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const element = event.currentTarget as HTMLElement;
        // El SVG debe conservar `touch-action: none` para que D4 pueda
        // desplazarse libremente. Dentro de una lectura abierta, por tanto,
        // reproducimos el scroll de manera explícita: un píxel del dedo es un
        // píxel de texto, en ambas direcciones, sin el salto del zoom al soltar.
        element.scrollTop = readingGesture.scrollTop + readingGesture.y - event.clientY;
      });
      const finishReadingGesture = (event: PointerEvent): void => {
        if (readingGesture?.pointer !== event.pointerId) return;
        event.stopPropagation();
        const element = event.currentTarget as HTMLElement;
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
        readingGesture = undefined;
      };
      content.on('pointerup', finishReadingGesture);
      content.on('pointercancel', finishReadingGesture);
      content.on('wheel', (event: WheelEvent) => event.stopPropagation());
      leaf.on('pointerdown', (event: PointerEvent) => {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        touchStarts.set(event.pointerId, { x: event.clientX, y: event.clientY });
      });
      leaf.on('pointerup', (event: PointerEvent) => {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        if (movedSince(event)) return;
        event.preventDefault();
        const element = event.currentTarget as HTMLElement;
        const open = element.classList.toggle('expanded');
        if (open) {
          for (const sibling of foldedLines) {
            if (sibling !== element) sibling.classList.remove('expanded');
          }
          raiseReadingCards(foreign.node());
        } else {
          element.blur();
          raiseReadingCards();
        }
      });
      leaf.on('pointercancel', (event: PointerEvent) => {
        touchStarts.delete(event.pointerId);
      });
    }
    if (projection.hidden > 0) {
      body.append('button')
        .attr('class', 'd4-hidden-count')
        .attr('type', 'button')
        .attr('aria-label', `Abrir ${node.name}; ${projection.hidden} frases no participan en este grado`)
        .on('click', (event: MouseEvent) => {
          if (!event.defaultPrevented) {
            focusNow();
            onClickPage(node.id);
          }
        })
        .text(`${projection.hidden} frase${projection.hidden === 1 ? '' : 's'} fuera de este grado`);
    }
  }

  // Las conectivas se pintan al final: son contenido situado entre páginas y,
  // cuando se abren, deben quedar delante de ambas sin cambiar su layout.
  for (const relation of relationCards) {
    const { link, source, x, y } = relation;
    const crossing = link.crossing!;
    if (focusedLink !== undefined && crossing !== focusedRelation) continue;
    const expanded = openRelations.has(crossing);
    const blocks = link.blocks ?? [];
    const relationWidth = expanded
      ? (focusedLink === undefined ? 360 : Math.max(300, Math.min(420, width - boxWidth * 2 - 72)))
      : 190;
    const relationHeight = expanded ? Math.min(height * 0.8, Math.max(118, 76 + blocks.length * 48)) : 36;
    const foreign = svg.append('foreignObject')
      .attr('class', `d4-relation-card${expanded ? ' expanded' : ''}`)
      .attr('x', x - relationWidth / 2)
      .attr('y', y - relationHeight / 2)
      .attr('width', relationWidth)
      .attr('height', relationHeight)
      .style('overflow', 'visible');
    const card = foreign.append<HTMLElement>('xhtml:article')
      .attr('class', `d4-relation${expanded ? ' expanded' : ''}`)
      .style('width', `${relationWidth}px`)
      .style('height', `${relationHeight}px`)
      .style('transform-origin', '0 0')
      .style('font-family', options.fontFamily ?? 'system-ui, sans-serif');
    const viewportEntry = {
      foreign,
      x: x - relationWidth / 2,
      y: y - relationHeight / 2,
      width: relationWidth,
      height: relationHeight,
      card,
    };
    viewportCards.push(viewportEntry);
    positionViewportCards();
    const resizeRelation = (): void => {
      if (!expanded) return;
      const maximum = height * 0.8;
      const required = Math.max(118, card.node()?.scrollHeight ?? relationHeight);
      const nextHeight = Math.min(maximum, required);
      viewportEntry.y = y - nextHeight / 2;
      viewportEntry.height = nextHeight;
      foreign.attr('y', viewportEntry.y).attr('height', viewportEntry.height);
      positionViewportCards();
      card.style('height', `${nextHeight}px`);
    };
    const stopMapGesture = (event: Event): void => event.stopPropagation();
    card.on('pointerdown', stopMapGesture).on('wheel', stopMapGesture);
    const head = card.append('header');
    head.append('button')
      .attr('type', 'button')
      .attr('class', 'd4-relation-title')
      .attr('aria-expanded', String(expanded))
      .on('click', (event: MouseEvent) => {
        event.stopPropagation();
        if (expanded) {
          openRelations.delete(crossing);
          if (focusedRelation === crossing) focusedRelation = null;
        } else {
          openRelations.clear();
          openRelations.add(crossing);
          focusedRelation = crossing;
        }
        renderGraphD4(container, data, onClickPage, options);
      })
      .text(link.label?.trim() || 'relación');
    if (!expanded) continue;
    head.append('span').attr('class', 'd4-relation-direction').text(`${source.name} → ${link.targetTitle ?? ''}`);
    const outline = card.append('div').attr('class', 'd4-relation-outline');
    const byParent = new Map<string | null, typeof blocks>();
    for (const block of blocks) {
      const siblings = byParent.get(block.parent) ?? [];
      siblings.push(block);
      byParent.set(block.parent, siblings);
    }
    for (const siblings of byParent.values()) siblings.sort((a, b) => a.position - b.position);
    const drawBlocks = (parent: string | null, depth: number): void => {
      for (const block of byParent.get(parent) ?? []) {
        const row = outline.append('div')
          .attr('class', 'd4-relation-block')
          .style('--d4-relation-depth', String(depth));
        row.append('span').attr('class', 'd4-relation-bullet').text('•');
        const editor = row.append<HTMLTextAreaElement>('textarea')
          .attr('aria-label', 'Bloque de la relación')
          .attr('rows', 1)
          .property('value', block.content);
        editor.on('input', (event: Event) => {
          const field = event.currentTarget as HTMLTextAreaElement;
          field.style.height = 'auto';
          field.style.height = `${field.scrollHeight}px`;
          resizeRelation();
        });
        editor.dispatch('input');
        editor.on('blur', async (event: FocusEvent) => {
          const content = (event.currentTarget as HTMLTextAreaElement).value;
          if (content === block.content || options.relations?.editBlock === undefined) return;
          if (await options.relations.editBlock(block.stableId, content)) block.content = content;
        });
        drawBlocks(block.stableId, depth + 1);
      }
    };
    drawBlocks(null, 0);
    if (blocks.length === 0 && options.relations?.createBlock !== undefined) {
      const empty = outline.append<HTMLTextAreaElement>('textarea')
        .attr('class', 'd4-relation-empty')
        .attr('aria-label', 'Escribir la relación')
        .attr('placeholder', 'Escribe qué relación hay entre estas páginas…')
        .attr('rows', 3);
      let saving = false;
      const saveFirstBlock = async (): Promise<void> => {
        const content = empty.property('value').trim();
        if (saving || content === '') return;
        saving = true;
        empty.property('disabled', true);
        const saved = await options.relations!.createBlock!(crossing, source.id, null, 0, content);
        if (!saved) {
          saving = false;
          empty.property('disabled', false).node()?.focus();
        }
      };
      empty.on('blur', () => void saveFirstBlock());
      // El editor aparece como consecuencia directa del toque en el cable. El
      // foco diferido espera a que el foreignObject entre al árbol de WebKit.
      window.setTimeout(() => empty.node()?.focus(), 0);
      resizeRelation();
    }
    if (options.relations?.createBlock !== undefined) {
      card.append('button')
        .attr('type', 'button')
        .attr('class', 'd4-relation-add')
        .on('click', async (event: MouseEvent) => {
          event.stopPropagation();
          const roots = blocks.filter((block) => block.parent === null);
          await options.relations!.createBlock!(crossing, source.id, null, roots.length);
        })
        .text('Añadir bloque');
    }
    resizeRelation();
  }
  positionViewportCards();

  // Primer encuadre: incluye tarjetas completas y conserva el centro semántico
  // del layout. El margen deja respiración para puertos, flechas y rótulos.
  // No se restringe a 0.25: el botón/rueda aún puede alejarse si el dibujo crece.
  const visibleNodes = data.nodes.filter((node) => thread === null || node.id !== thread.page);
  const boxes = visibleNodes.map((node) => {
    const at = held.get(node.id)!;
    const dim = dims.get(node.id)!;
    return { left: at.x - dim.w / 2, right: at.x + dim.w / 2,
      top: at.y - dim.h / 2, bottom: at.y + dim.h / 2 };
  });
  if (boxes.length > 0 && focusedLink === undefined) {
    const left = Math.min(...boxes.map((box) => box.left));
    const right = Math.max(...boxes.map((box) => box.right));
    const top = Math.min(...boxes.map((box) => box.top));
    const bottom = Math.max(...boxes.map((box) => box.bottom));
    const margin = 72;
    const scale = Math.min(1, width / (right - left + margin * 2), height / (bottom - top + margin * 2));
    const framed = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-(left + right) / 2, -(top + bottom) / 2);
    svg.call(zoom.transform, framed);
  }
}
