// Selector deliberado de una posición geográfica portable.
//
// OpenStreetMap aporta sólo las teselas y se carga al abrir este diálogo. Vera
// no envía títulos, páginas ni contenido del corpus; el valor canónico sigue
// siendo un URI `geo:` legible sin el mapa y exportable sin Leaflet.

import type * as Leaflet from 'leaflet';

import { canonicalGeographicPosition, geographicPosition } from '@vera/core';

export async function pickGeographicPosition(
  original: string,
  onPick: (value: string) => void,
): Promise<void> {
  const L = await import('leaflet');
  const dialog = document.createElement('dialog');
  dialog.className = 'geo-picker-dialog';

  const form = document.createElement('form');
  form.method = 'dialog';

  const heading = document.createElement('h2');
  heading.textContent = 'Posición geográfica';
  const note = document.createElement('p');
  note.textContent = 'El mapa ayuda a elegir. Vera guarda sólo geo:latitud,longitud.';

  const mapHost = document.createElement('div');
  mapHost.className = 'geo-picker-map';
  mapHost.setAttribute('aria-label', 'mapa de OpenStreetMap para elegir una posición');

  const coordinates = document.createElement('div');
  coordinates.className = 'geo-picker-coordinates';
  const field = (labelText: string, minimum: string, maximum: string): HTMLInputElement => {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.min = minimum;
    input.max = maximum;
    input.inputMode = 'decimal';
    label.append(input);
    coordinates.append(label);
    return input;
  };
  const latitude = field('Latitud', '-90', '90');
  const longitude = field('Longitud', '-180', '180');

  const current = document.createElement('button');
  current.type = 'button';
  current.textContent = 'Usar mi ubicación';

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancelar';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'dialog-primary-action';
  save.textContent = 'Guardar posición';
  save.disabled = true;
  actions.append(cancel, save);

  form.append(heading, note, mapHost, coordinates, current, actions);
  dialog.append(form);
  document.body.append(dialog);

  const initial = geographicPosition(original);
  if (initial !== null) {
    latitude.value = String(initial.latitude);
    longitude.value = String(initial.longitude);
  }

  const map = L.map(mapHost, {
    center: initial === null ? [0, 0] : [initial.latitude, initial.longitude],
    zoom: initial === null ? 2 : 14,
    zoomControl: true,
  });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  let point: Leaflet.CircleMarker | null = initial === null
    ? null
    : L.circleMarker([initial.latitude, initial.longitude], {
        radius: 7,
        color: '#b64626',
        fillColor: '#ffffff',
        fillOpacity: 1,
        weight: 3,
      }).addTo(map);

  const chosen = (): string | null =>
    canonicalGeographicPosition(Number(latitude.value), Number(longitude.value));

  const show = (lat: number, lon: number, centre: boolean): void => {
    latitude.value = String(Number(lat.toFixed(7)));
    longitude.value = String(Number(lon.toFixed(7)));
    if (point === null) {
      point = L.circleMarker([lat, lon], {
        radius: 7,
        color: '#b64626',
        fillColor: '#ffffff',
        fillOpacity: 1,
        weight: 3,
      }).addTo(map);
    } else {
      point.setLatLng([lat, lon]);
    }
    if (centre) map.setView([lat, lon], Math.max(map.getZoom(), 14));
    save.disabled = chosen() === null;
  };

  const fromFields = (): void => {
    const value = chosen();
    if (value === null) {
      save.disabled = true;
      return;
    }
    const parsed = geographicPosition(value);
    if (parsed !== null) show(parsed.latitude, parsed.longitude, false);
  };
  latitude.addEventListener('input', fromFields);
  longitude.addEventListener('input', fromFields);
  map.on('click', (event: Leaflet.LeafletMouseEvent) => show(event.latlng.lat, event.latlng.lng, false));

  current.addEventListener('click', () => {
    if (navigator.geolocation === undefined) return;
    current.disabled = true;
    current.textContent = 'Buscando ubicación…';
    navigator.geolocation.getCurrentPosition(
      (position) => {
        current.disabled = false;
        current.textContent = 'Usar mi ubicación';
        show(position.coords.latitude, position.coords.longitude, true);
      },
      () => {
        current.disabled = false;
        current.textContent = 'Ubicación no disponible';
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });

  cancel.addEventListener('click', () => dialog.close('cancel'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = chosen();
    if (value === null) return;
    onPick(value);
    dialog.close('saved');
  });
  dialog.addEventListener('close', () => {
    map.remove();
    dialog.remove();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dialog.close('cancel');
  });

  save.disabled = chosen() === null;
  dialog.showModal();
  // Leaflet mide al nacer; el diálogo sólo adquiere su caja al abrirse.
  requestAnimationFrame(() => map.invalidateSize());
}
