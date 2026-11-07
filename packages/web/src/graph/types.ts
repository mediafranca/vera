// Forma del grafo. Es exactamente lo que devuelve GET /graph/:id del servidor,
// y exactamente lo que consumen renderGraph y renderGraph3D, trasplantados de
// logseq-constel sin adaptación.

import type { SimulationNodeDatum } from 'd3';

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  name: string;
  central: boolean;
  /** La página declara que el orden de sus bloques es un argumento. */
  trail?: boolean;
  degree: number;
  properties?: Record<string, unknown>;
  blockCount?: number;
  /** Conceptos declarados por la página; sólo informan la física espacial. */
  concepts?: string[];
  /** Saltos desde la página foco; D4 lo convierte en columnas. */
  distance?: number;
  /** Líneas legibles de la página para el recinto dendrítico. */
  lines?: { block: string; content: string; gloss?: string | null }[];
  matched?: boolean;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  /** Bloque/frase que origina la referencia cuando se conoce. */
  block?: string | null;
  kind?: 'reference' | 'gloss' | 'crossing';
  /** Título mencionado: permite anclar en la frase exacta y no sólo en el bloque. */
  targetTitle?: string;
  /** Las relaciones explicadas conservan su término y su outline legible. */
  label?: string | null;
  explanation?: string;
  /** Identidad y árbol canónico de una conectiva explicada. */
  crossing?: string;
  blocks?: { stableId: string; parent: string | null; position: number; content: string }[];
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
