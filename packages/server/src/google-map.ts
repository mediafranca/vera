export interface GoogleMapPoint {
  latitude: number;
  longitude: number;
  zoom: number | null;
}

type FetchLike = (
  input: string | URL,
  init?: { method?: string; redirect?: 'manual' },
) => Promise<{ status: number; headers: { get(name: string): string | null } }>;

const shortHost = (host: string): boolean =>
  host === 'maps.app.goo.gl' || host === 'goo.gl';

const mapsHost = (host: string): boolean =>
  host === 'google.com' || host.endsWith('.google.com');

const coordinate = (value: string | undefined, limit: number): number | null => {
  if (value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
};

/** Extrae el punto que una dirección completa de Google Maps está mirando. */
export function googleMapPoint(source: string): GoogleMapPoint | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !mapsHost(url.hostname.toLowerCase()) || !url.pathname.startsWith('/maps')) {
    return null;
  }

  // `!3d…!4d…` nombra el lugar, mientras `@…,…` puede ser sólo el centro de
  // cámara. Si existe, el lugar manda. Se toma la última pareja porque algunas
  // direcciones llevan más de una geometría en `data`.
  const places = [...url.href.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
  const place = places.at(-1);
  const camera = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,([\d.]+)z|,([\d.]+)m)?/.exec(url.href);
  const query = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(
    url.searchParams.get('q') ?? url.searchParams.get('query') ?? '',
  );
  const found = place ?? camera ?? query;
  if (found === null || found === undefined) return null;
  const latitude = coordinate(found[1], 90);
  const longitude = coordinate(found[2], 180);
  if (latitude === null || longitude === null) return null;

  const saidZoom = place === undefined || place === null ? camera?.[3] : undefined;
  const zoom = saidZoom === undefined ? null : Math.min(21, Math.max(2, Math.round(Number(saidZoom))));
  return { latitude, longitude, zoom: Number.isFinite(zoom) ? zoom : null };
}

/**
 * Resuelve sólo el acortador de Google y nunca sigue un salto fuera de Google.
 * Esa frontera evita que la comodidad del mapa se convierta en un proxy SSRF.
 */
export async function resolveGoogleMapPoint(
  source: string,
  request: FetchLike = fetch,
): Promise<GoogleMapPoint | null> {
  let current: URL;
  try {
    current = new URL(source);
  } catch {
    return null;
  }
  if (current.protocol !== 'https:') return null;

  const direct = googleMapPoint(current.href);
  if (direct !== null) return direct;
  if (!shortHost(current.hostname.toLowerCase())) return null;

  for (let hops = 0; hops < 5; hops += 1) {
    const host = current.hostname.toLowerCase();
    if (!shortHost(host) && !mapsHost(host)) return null;
    const response = await request(current, { method: 'HEAD', redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || location === null) return null;
    current = new URL(location, current);
    const point = googleMapPoint(current.href);
    if (point !== null) return point;
  }
  return null;
}

/** Visor oficial sin clave de API: Google lo redirige a `/maps/embed`. */
export function googleMapEmbedUrl(point: GoogleMapPoint): string {
  const target = new URL('https://www.google.com/maps');
  target.searchParams.set('q', `${point.latitude},${point.longitude}`);
  if (point.zoom !== null) target.searchParams.set('z', String(point.zoom));
  target.searchParams.set('output', 'embed');
  return target.href;
}
