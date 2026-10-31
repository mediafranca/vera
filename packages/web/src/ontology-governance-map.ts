// El segundo lado de las páginas rectoras de la ontología.
//
// No es otro mapa del corpus ni otra fuente de verdad. Lee exactamente la
// proyección que alimenta las tablas de Objetos, Propiedades y Relaciones y la
// dispone con geometría de esquema. ELK decide posiciones; Vera conserva el
// significado, los bloques y las operaciones.

import { fieldKindOf } from '@vera/core';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import type { OntologyView } from './api.ts';
import type { Change } from './api.ts';
import type { GoverningKind } from './governing-table.ts';

export interface GovernanceNode {
  id: string;
  block: string;
  kind: GoverningKind;
  title: string;
  details: string[];
}

export interface GovernanceEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface GovernanceDiagram {
  nodes: GovernanceNode[];
  edges: GovernanceEdge[];
}

const key = (kind: GoverningKind, name: string): string => `${kind}:${name}`;

const listed = (value: string | null): string[] =>
  (value ?? '').split(',').map((one) => one.trim()).filter((one) => one !== '');

const truth = (value: string | null): boolean | null => {
  if (value === null) return null;
  if (/^(sí|si|yes|true)$/i.test(value.trim())) return true;
  if (/^(no|false)$/i.test(value.trim())) return false;
  return null;
};

/**
 * Aplica a la proyección visual el mismo cambio que la réplica ya aceptó.
 *
 * El mapa conserva una lectura de `/ontology` para disponer las tres páginas
 * rectoras juntas. Cuando se edita la página abierta, esperar otra lectura del
 * servidor haría reaparecer por un instante el estado anterior. Este pliegue es
 * deliberadamente pequeño: refleja las operaciones que la superficie ofrece y
 * deja la reconciliación canónica al transporte local-first.
 */
export function reflectOntologyChange(said: OntologyView, change: Change): boolean {
  if (change.kind === 'edit_block') {
    const declaration = [...said.objects, ...said.properties, ...said.relations]
      .find((one) => one.block === change.block);
    if (declaration === undefined) return false;
    declaration.name = change.content.trim();
    return true;
  }

  if (change.kind !== 'set_property' && change.kind !== 'remove_property') return false;
  if (change.block === undefined) return false;
  const value = change.kind === 'set_property' ? change.propertyValue : null;
  const property = change.propertyKey.trim().toLocaleLowerCase('es');

  const object = said.objects.find((one) => one.block === change.block);
  if (object !== undefined) {
    if (property === 'propiedades') object.properties = listed(value);
    else if (property === 'papel') object.role = value;
    else if (property === 'qué' || property === 'nota') object.says = value;
    else return false;
    return true;
  }

  const declared = said.properties.find((one) => one.block === change.block);
  if (declared !== undefined) {
    if (property === 'campo') declared.field = fieldKindOf(value ?? '');
    else if (property === 'papel') declared.role = value;
    else if (property === 'sujeto') declared.subject = /^(bloque|block)$/i.test(value ?? '') ? 'bloque' : 'página';
    else if (property === 'varios') declared.many = truth(value) === true;
    else if (property === 'valores') declared.values = listed(value);
    else if (property === 'qué' || property === 'nota') declared.says = value;
    else return false;
    return true;
  }

  const relation = said.relations.find((one) => one.block === change.block);
  if (relation === undefined) return false;
  if (property === 'inversa') relation.inverse = value ?? relation.name;
  else if (property === 'dominio') relation.domain = listed(value);
  else if (property === 'rango') relation.range = listed(value);
  else if (property === 'simétrica' || property === 'simetrica') relation.symmetric = truth(value);
  else if (property === 'transitiva') relation.transitive = truth(value);
  else if (property === 'estado') relation.status = value;
  else if (property === 'qué' || property === 'nota') relation.says = value;
  else if (property === 'equivalente externo') relation.external = listed(value);
  else return false;
  return true;
}

/** La figura pertinente a cada faceta, derivada de una sola lectura canónica. */
export function governanceDiagram(said: OntologyView, facet: GoverningKind): GovernanceDiagram {
  const nodes: GovernanceNode[] = [];
  const edges: GovernanceEdge[] = [];

  if (facet === 'objects') {
    for (const object of said.objects) {
      nodes.push({
        id: key('objects', object.name),
        block: object.block,
        kind: 'objects',
        title: object.name,
        details: object.properties.length === 0 ? ['sin propiedades declaradas'] : object.properties,
      });
    }
    return { nodes, edges };
  }

  if (facet === 'properties') {
    for (const property of said.properties) {
      nodes.push({
        id: key('properties', property.name),
        block: property.block,
        kind: 'properties',
        title: property.name,
        details: [property.field ?? 'tipo de dato sin declarar', property.subject],
      });
    }
    for (const object of said.objects) {
      nodes.push({
        id: key('objects', object.name),
        block: object.block,
        kind: 'objects',
        title: object.name,
        details: ['objeto'],
      });
      for (const property of object.properties) {
        if (!said.properties.some((one) => one.name === property)) continue;
        edges.push({
          id: `uses:${object.name}:${property}`,
          source: key('objects', object.name),
          target: key('properties', property),
          label: 'usa',
        });
      }
    }
    return { nodes, edges };
  }

  for (const object of said.objects) {
    nodes.push({
      id: key('objects', object.name),
      block: object.block,
      kind: 'objects',
      title: object.name,
      details: ['objeto'],
    });
  }
  for (const relation of said.relations) {
    const relationId = key('relations', relation.name);
    nodes.push({
      id: relationId,
      block: relation.block,
      kind: 'relations',
      title: relation.name,
      details: [
        relation.inverse === '' ? 'sin inversa' : `↔ ${relation.inverse}`,
        relation.status ?? 'estado sin declarar',
      ],
    });
    for (const domain of relation.domain) {
      if (!said.objects.some((one) => one.name === domain)) continue;
      edges.push({
        id: `domain:${relation.name}:${domain}`,
        source: key('objects', domain),
        target: relationId,
        label: 'dominio',
      });
    }
    for (const range of relation.range) {
      if (!said.objects.some((one) => one.name === range)) continue;
      edges.push({
        id: `range:${relation.name}:${range}`,
        source: relationId,
        target: key('objects', range),
        label: 'rango',
      });
    }
  }
  return { nodes, edges };
}

const elk = new ELK();

function wrappedLines(value: string, columns: number): number {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const length = Math.max(1, word.length);
    if (used === 0) {
      lines += Math.floor((length - 1) / columns);
      used = ((length - 1) % columns) + 1;
      continue;
    }
    if (used + 1 + length <= columns) {
      used += 1 + length;
      continue;
    }
    lines += 1 + Math.floor((length - 1) / columns);
    used = ((length - 1) % columns) + 1;
  }
  return lines;
}

/** Reserva en ELK la geometría completa que después ocupa la tarjeta HTML. */
export function governanceNodeSize(
  node: GovernanceNode,
  editable = false,
  interfaceScale = 1,
): { width: number; height: number } {
  const detail = node.details.join(' · ');
  const longest = Math.max(node.title.length, detail.length);
  const width = Math.min(304, Math.max(190, 58 + longest * 6.2));
  const innerWidth = width - 30;
  const titleLines = wrappedLines(node.title, Math.max(12, Math.floor(innerWidth / 7.2)));
  const detailLines = wrappedLines(detail, Math.max(14, Math.floor(innerWidth / 6.2)));
  const height = 34 + titleLines * 18 + detailLines * 16 + (editable ? 31 * interfaceScale + 10 : 0);
  return { width, height };
}

/**
 * Dibuja el esquema en el panel que normalmente contiene el mapa del corpus.
 * La tabla sigue viva al lado; pulsar una figura revela la fila del bloque del
 * que salió. Esa correspondencia es la primera mitad verificable del round trip.
 */
export async function renderOntologyGovernanceMap(
  container: HTMLElement,
  said: OntologyView,
  facet: GoverningKind,
  write?: (change: Change) => Promise<boolean>,
): Promise<void> {
  const diagram = governanceDiagram(said, facet);
  const interfaceScale = Math.max(
    1,
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) / 16,
  );
  const graph: ElkNode = {
    id: 'ontology-government',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '48',
      'elk.spacing.edgeEdge': '14',
      'elk.layered.spacing.nodeNodeBetweenLayers': '112',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
      'elk.padding': '[top=48,left=48,bottom=48,right=48]',
    },
    children: diagram.nodes.map((node) => ({
      id: node.id,
      ...governanceNodeSize(node, node.kind === facet && write !== undefined, interfaceScale),
    })),
    edges: diagram.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };
  const laid = await elk.layout(graph);
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(diagram.edges.map((edge) => [edge.id, edge]));

  const controls = container.querySelector<HTMLElement>('#map-controls');
  const trail = container.querySelector<HTMLElement>('#map-trail');
  controls?.remove();
  trail?.remove();
  container.replaceChildren();
  container.classList.add('ontology-government-map');

  const heading = document.createElement('header');
  heading.className = 'ontology-government-map-header';
  const title = document.createElement('strong');
  title.textContent = facet === 'objects' ? 'Estructura de objetos' : facet === 'properties' ? 'Uso de propiedades' : 'Esquema de relaciones';
  const note = document.createElement('span');
  note.textContent = 'proyección de la página rectora · seleccionar revela su declaración';
  heading.append(title, note);

  const nodeKinds = [...new Set(diagram.nodes.map((node) => node.kind))];
  const edgeKinds = [...new Set(diagram.edges.map((edge) => edge.label))];
  if (nodeKinds.length > 0 || edgeKinds.length > 0) {
    const legend = document.createElement('div');
    legend.className = 'ontology-government-legend';
    legend.setAttribute('aria-label', 'convenciones del esquema');
    const kindNames: Record<GoverningKind, string> = {
      objects: 'objeto',
      properties: 'propiedad',
      relations: 'relación',
    };
    for (const nodeKind of nodeKinds) {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.className = `ontology-government-legend-kind ${nodeKind}`;
      swatch.setAttribute('aria-hidden', 'true');
      item.append(swatch, kindNames[nodeKind]);
      legend.append(item);
    }
    for (const edgeKind of edgeKinds) {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.className = `ontology-government-legend-line edge-${edgeKind}`;
      swatch.setAttribute('aria-hidden', 'true');
      item.append(swatch, edgeKind);
      legend.append(item);
    }
    heading.append(legend);
  }

  const mobileMirror = document.createElement('nav');
  mobileMirror.className = 'ontology-mobile-switch ontology-mobile-switch-graph';
  mobileMirror.setAttribute('aria-label', 'inscripción del gobierno ontológico');
  const declaration = document.createElement('button');
  declaration.type = 'button';
  declaration.textContent = 'Declaración';
  declaration.setAttribute('aria-pressed', 'false');
  declaration.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('vera:ontology-layout', {
      detail: { layout: 'text_only' },
    }));
  });
  const scheme = document.createElement('button');
  scheme.type = 'button';
  scheme.className = 'selected';
  scheme.textContent = 'Esquema';
  scheme.setAttribute('aria-pressed', 'true');
  mobileMirror.append(declaration, scheme);
  heading.append(mobileMirror);

  const viewport = document.createElement('div');
  viewport.className = 'ontology-government-viewport';
  const stage = document.createElement('div');
  stage.className = 'ontology-government-stage';
  const width = Math.max(laid.width ?? 0, container.clientWidth - 24, 320);
  const height = Math.max(laid.height ?? 0, container.clientHeight - 96, 320);
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('ontology-government-edges');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');
  for (const edge of laid.edges ?? []) {
    const section = edge.sections?.[0];
    if (section === undefined) continue;
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', points.map((point, at) => `${at === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '));
    const source = edgeById.get(edge.id);
    if (source !== undefined) path.classList.add(`edge-${source.label}`);
    svg.append(path);
  }
  stage.append(svg);

  const selectBlock = (block: string, revealText: boolean): void => {
    stage.querySelectorAll('.ontology-government-node.selected').forEach((one) => one.classList.remove('selected'));
    const card = stage.querySelector<HTMLElement>(`.ontology-government-node[data-block="${CSS.escape(block)}"]`);
    card?.classList.add('selected');
    card?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    if (!revealText) return;
    const row = document.querySelector<HTMLElement>(`.governing [data-block="${CSS.escape(block)}"]`);
    row?.classList.add('governing-row-revealed');
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => row?.classList.remove('governing-row-revealed'), 1800);
  };

  for (const placed of laid.children ?? []) {
    const node = byId.get(placed.id);
    if (node === undefined) continue;
    const card = document.createElement('div');
    card.className = `ontology-government-node ${node.kind}`;
    card.dataset['block'] = node.block;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${node.title}: ${node.details.join(', ')}`);
    card.style.left = `${placed.x ?? 0}px`;
    card.style.top = `${placed.y ?? 0}px`;
    card.style.width = `${placed.width ?? 160}px`;
    card.style.height = `${placed.height ?? 72}px`;
    const name = document.createElement('strong');
    name.textContent = node.title;
    const details = document.createElement('span');
    details.textContent = node.details.join(' · ');
    card.append(name, details);
    card.addEventListener('click', () => {
      selectBlock(node.block, true);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectBlock(node.block, true);
    });

    if (write !== undefined && node.kind === facet) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ontology-government-node-edit';
      edit.textContent = 'Editar nombre';
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        if (card.querySelector('input') !== null) return;
        const input = document.createElement('input');
        input.className = 'ontology-government-node-input';
        input.value = node.title;
        input.setAttribute('aria-label', `nombre de ${node.title}`);
        name.replaceWith(input);
        edit.hidden = true;
        input.focus();
        input.select();
        let settled = false;
        const settle = async (commit: boolean): Promise<void> => {
          if (settled) return;
          settled = true;
          const next = input.value.trim();
          if (!commit || next === '' || next === node.title) {
            input.replaceWith(name);
            edit.hidden = false;
            return;
          }
          input.disabled = true;
          const applied = await write({ kind: 'edit_block', block: node.block, content: next });
          if (!applied && input.isConnected) {
            input.disabled = false;
            input.replaceWith(name);
            edit.hidden = false;
          }
        };
        input.addEventListener('keydown', (key) => {
          if (key.key === 'Enter') {
            key.preventDefault();
            void settle(true);
          } else if (key.key === 'Escape') {
            key.preventDefault();
            void settle(false);
          }
        });
        input.addEventListener('blur', () => void settle(true));
      });
      card.append(edit);
    }
    stage.append(card);
  }

  const focusController = new AbortController();
  const prior = (container as HTMLElement & { ontologyFocus?: AbortController }).ontologyFocus;
  prior?.abort();
  (container as HTMLElement & { ontologyFocus?: AbortController }).ontologyFocus = focusController;
  document.addEventListener('vera:ontology-focus', (event) => {
    const block = (event as CustomEvent<{ block?: string }>).detail?.block;
    if (block !== undefined) selectBlock(block, false);
  }, { signal: focusController.signal });
  document.addEventListener('vera:ontology-local-change', (event) => {
    const change = (event as CustomEvent<{ change?: Change }>).detail?.change;
    if (change === undefined || !reflectOntologyChange(said, change)) return;
    void renderOntologyGovernanceMap(container, said, facet, write);
  }, { signal: focusController.signal });

  viewport.append(stage);
  container.append(heading, viewport);
  if (controls !== null) {
    controls.hidden = true;
    container.append(controls);
  }
  if (trail !== null) {
    trail.hidden = true;
    container.append(trail);
  }
}

/** Devuelve el panel a su régimen ordinario antes de dibujar el mapa del corpus. */
export function leaveOntologyGovernanceMap(container: HTMLElement): void {
  container.classList.remove('ontology-government-map');
  container.querySelector<HTMLElement>('#map-controls')?.removeAttribute('hidden');
  container.querySelector<HTMLElement>('#map-trail')?.removeAttribute('hidden');
}
