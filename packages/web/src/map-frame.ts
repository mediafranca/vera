import './styles.css';

import type { EmbeddedMapConfig } from '@vera/core';
import { renderGraph } from './graph/render.ts';
import { renderGraph3D } from './graph/render3d.ts';
import { renderGraphD4 } from './graph/renderD4.ts';
import type { GraphData } from './graph/types.ts';

function configuration(): EmbeddedMapConfig | null {
  try {
    const value = JSON.parse(decodeURIComponent(location.hash.slice(1))) as Partial<EmbeddedMapConfig>;
    if (typeof value.page !== 'string' || value.page.trim() === '') return null;
    if (value.view !== '2d' && value.view !== '3d' && value.view !== 'd4') return null;
    if (value.reach !== 1 && value.reach !== 2 && value.reach !== 3) return null;
    if (typeof value.rotate !== 'boolean') return null;
    if (!Number.isInteger(value.height) || (value.height ?? 0) < 640 || (value.height ?? 0) > 2400) return null;
    return value as EmbeddedMapConfig;
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
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  let turn = 0;
  const identity = pageIdentity(config.page);

  const draw = async (reach: number): Promise<void> => {
    const current = ++turn;
    try {
      const data = await neighbourhood(await identity, reach);
      if (current !== turn) return;
      const settings = {
        dark,
        showEdges: true,
        showTitles: true,
        nodeStyle: 'title' as const,
        autoRotate: config.view === '3d' && config.rotate,
        preserveDirection: reach > 1,
      };
      if (config.view === '3d') renderGraph3D(map, data, open, settings);
      else if (config.view === 'd4') renderGraphD4(map, data, open, settings);
      else renderGraph(map, data, open, settings);
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
