import './styles.css';

import {
  embeddedMapCamera,
  embeddedMapHeight,
  type EmbeddedMapConfig,
  type Trail,
} from '@vera/core';
import { renderGraph } from './graph/render.ts';
import { renderGraph3D } from './graph/render3d.ts';
import { renderGraphD4 } from './graph/renderD4.ts';
import { graphOfThread, threadSettings } from './graph/thread.ts';
import type { ThreadSettings } from './graph/render.ts';
import type { GraphData } from './graph/types.ts';

const APPEARANCE = 'vera-embedded-map-appearance';

function configuration(): EmbeddedMapConfig | null {
  try {
    const value = JSON.parse(decodeURIComponent(location.hash.slice(1))) as Partial<EmbeddedMapConfig>;
    if (typeof value.page !== 'string' || value.page.trim() === '') return null;
    if (value.view !== '2d' && value.view !== '3d' && value.view !== 'd4') return null;
    if (value.reach !== 1 && value.reach !== 2 && value.reach !== 3) return null;
    if (typeof value.rotate !== 'boolean') return null;
    const height = embeddedMapHeight(Number(value.height));
    if (height === null) return null;
    const camera = value.camera === undefined ? undefined : embeddedMapCamera(value.camera, value.view);
    if (value.camera !== undefined && camera === null) return null;
    return { ...value, height, ...(camera === undefined ? {} : { camera }) } as EmbeddedMapConfig;
  } catch {
    return null;
  }
}

async function neighbourhood(page: string, reach: number): Promise<GraphData> {
  const response = await fetch(`/graph/${encodeURIComponent(page)}?depth=${reach}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as GraphData;
}

async function pageIdentity(said: string): Promise<string> {
  if (said.startsWith('page:')) return said;
  const response = await fetch('/pages');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const pages = await response.json() as { id?: unknown; title?: unknown }[];
  const wanted = said.trim().toLocaleLowerCase();
  const page = pages.find((one) => typeof one.title === 'string' && one.title.toLocaleLowerCase() === wanted);
  if (typeof page?.id !== 'string') throw new Error('página inexistente');
  return page.id;
}

/**
 * Un mapa incrustado sigue abriendo la página que declara, no una fotografía
 * empobrecida de su vecindario.
 *
 * El propio grafo avisa si la página central es un recorrido. Sólo entonces se
 * pide su derivación completa: las páginas corrientes no pagan otra lectura y
 * los recorridos no vuelven a convertirse en un nodo con muchas aristas por
 * estar dentro de un iframe.
 */
async function embeddedThread(page: string, data: GraphData): Promise<ThreadSettings | null> {
  if (!data.nodes.some((node) => node.id === page && node.trail === true)) return null;
  const response = await fetch(`/pages/${encodeURIComponent(page)}?stage=enrichment`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const delivered = await response.json() as { trail?: Trail | null };
  return threadSettings(page, delivered.trail ?? null);
}

const config = configuration();
const root = document.getElementById('vera-root');
const map = document.getElementById('map');
const status = document.getElementById('map-status');

if (config === null || root === null || map === null || status === null) {
  document.body.textContent = 'La configuración de este mapa no es válida.';
} else {
  root.style.minHeight = `${config.height}px`;
  const open = (page: string): void => {
    parent.postMessage({ type: 'vera-embedded-map-open', page }, location.origin);
  };
  let dark = matchMedia('(prefers-color-scheme: dark)').matches;
  let turn = 0;
  const identity = pageIdentity(config.page);
  let route: Promise<ThreadSettings | null> | null = null;
  let shown: { data: GraphData; reach: number; thread: ThreadSettings | null } | null = null;

  const present = (
    data: GraphData,
    reach: number,
    thread: ThreadSettings | null,
    appearanceChange = false,
  ): void => {
    const settings = {
      dark,
      showEdges: true,
      showTitles: true,
      nodeStyle: 'title' as const,
      autoRotate: config.view === '3d' && config.rotate,
      preserveDirection: reach > 1 || appearanceChange,
      thread,
      ...(config.camera === undefined ? {} : { camera: config.camera }),
    };
    if (config.view === '3d') renderGraph3D(map, data, open, settings);
    else if (config.view === 'd4') renderGraphD4(map, data, open, settings);
    else renderGraph(map, data, open, settings);
    shown = { data, reach, thread };
  };

  addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = event.data as {
      type?: unknown;
      appearance?: { scheme?: unknown; tokens?: unknown };
    } | null;
    if (event.source !== parent || event.origin !== location.origin || message?.type !== APPEARANCE) return;
    const tokens = message.appearance?.tokens;
    if (tokens === null || typeof tokens !== 'object') return;
    for (const [name, value] of Object.entries(tokens)) {
      if (/^--[a-z0-9-]+$/.test(name) && typeof value === 'string') document.documentElement.style.setProperty(name, value);
    }
    dark = message.appearance?.scheme === 'dark';
    document.documentElement.dataset.scheme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    if (shown !== null) present(shown.data, shown.reach, shown.thread, true);
  });

  const draw = async (reach: number): Promise<void> => {
    const current = ++turn;
    try {
      const page = await identity;
      const data = await neighbourhood(page, reach);
      route ??= embeddedThread(page, data);
      const thread = await route;
      if (current !== turn) return;
      present(graphOfThread(data, thread), reach, thread);
      status.textContent = reach < config.reach ? `Ampliando a alcance ${reach + 1}…` : '';
      if (reach < config.reach) requestAnimationFrame(() => void draw(reach + 1));
    } catch {
      status.textContent = reach === 1
        ? 'No se pudo cargar este mapa.'
        : `El mapa permanece disponible hasta alcance ${reach - 1}.`;
    }
  };

  void draw(1);
}
