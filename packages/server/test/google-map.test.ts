import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  googleMapEmbedUrl,
  googleMapPoint,
  resolveGoogleMapPoint,
} from '../src/google-map.ts';

describe('Google Maps', () => {
  it('prefiere el lugar exacto sobre el centro de cámara', () => {
    assert.deepEqual(
      googleMapPoint(
        'https://www.google.com/maps/place/x/@-32.9687163,-71.4074258,14z/' +
          'data=!4m4!3m3!8m2!3d-32.970034!4d-71.38445',
      ),
      { latitude: -32.970034, longitude: -71.38445, zoom: null },
    );
  });

  it('lee el centro de cámara cuando el enlace no nombra otro lugar', () => {
    assert.deepEqual(
      googleMapPoint('https://www.google.com/maps/place//@-32.9696873,-71.3848611,14z/data=!3m1!1e3'),
      { latitude: -32.9696873, longitude: -71.3848611, zoom: 14 },
    );
  });

  it('resuelve el acortador sin seguir ningún salto fuera de Google', async () => {
    const seen: string[] = [];
    const point = await resolveGoogleMapPoint(
      'https://maps.app.goo.gl/c3QtQWekv2Uu6CxYA',
      async (input) => {
        seen.push(String(input));
        return {
          status: 302,
          headers: {
            get: (name: string) => name.toLowerCase() === 'location'
              ? 'https://www.google.com/maps/place//@-32.9696873,-71.3848611,14z/data=!3m1!1e3'
              : null,
          },
        };
      },
    );
    assert.deepEqual(point, { latitude: -32.9696873, longitude: -71.3848611, zoom: 14 });
    assert.deepEqual(seen, ['https://maps.app.goo.gl/c3QtQWekv2Uu6CxYA']);
  });

  it('rechaza un acortador que intente salir de Google', async () => {
    let requests = 0;
    const point = await resolveGoogleMapPoint(
      'https://maps.app.goo.gl/afuera',
      async () => {
        requests += 1;
        return {
          status: 302,
          headers: { get: () => 'http://127.0.0.1:4173/private' },
        };
      },
    );
    assert.equal(point, null);
    assert.equal(requests, 1);
  });

  it('compone el visor sin clave de API', () => {
    const url = new URL(googleMapEmbedUrl({ latitude: -32.97, longitude: -71.38, zoom: 15 }));
    assert.equal(url.origin + url.pathname, 'https://www.google.com/maps');
    assert.equal(url.searchParams.get('q'), '-32.97,-71.38');
    assert.equal(url.searchParams.get('z'), '15');
    assert.equal(url.searchParams.get('output'), 'embed');
    assert.equal(url.searchParams.has('key'), false);
  });
});
