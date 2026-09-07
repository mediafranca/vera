import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  TRACE_LIMIT,
  clearTrace,
  dropped,
  loadTrace,
  movedTo,
  retainingPages,
  saveTrace,
  walked,
  type TraceStep,
} from '../src/trace.ts';

const originalStorage = globalThis.localStorage;

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

const steps: TraceStep[] = [
  { page: 'a', from: null, gesture: 'opened_directly', at: 1 },
  { page: 'b', from: 'a', gesture: 'followed_reference', at: 2 },
  { page: 'c', from: 'b', gesture: 'followed_reference', at: 3 },
];

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
});

describe('rastro durable y componible', () => {
  it('sobrevive completo cuando cada página aparece una sola vez', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() });
    saveTrace(steps);
    assert.deepEqual(loadTrace(), steps);
  });

  it('conserva la identidad y revisión de la conectiva realmente pulsada', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() });
    const cited: TraceStep[] = [steps[0]!, {
      ...steps[1]!,
      crossing: { id: 'crossing:ab', revision: 'operation:9', content: 'entre ambas' },
    }];
    saveTrace(cited);
    assert.deepEqual(loadTrace(), cited);
  });

  it('al volver a abrir migra duplicados conservando sólo la llegada más reciente', () => {
    const storage = memoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    storage.setItem('vera.navigationTrace', JSON.stringify([
      steps[0]!,
      { ...steps[0]!, at: 2 },
      steps[1]!,
      { page: 'a', from: 'b', gesture: 'returned', at: 4 },
    ]));
    const loaded = loadTrace();
    assert.deepEqual(loaded.map((step) => step.page), ['b', 'a']);
    assert.equal(loaded.at(-1)?.gesture, 'returned');
    assert.deepEqual(JSON.parse(storage.getItem('vera.navigationTrace') ?? '[]').map((step: TraceStep) => step.page), ['b', 'a']);
  });

  it('conserva el gesto al reordenar y permite podar una llegada', () => {
    const arranged = movedTo(steps, 2, 0);
    assert.equal(arranged[0]?.page, 'c');
    assert.deepEqual(dropped(arranged, 1).map((step) => step.page), ['c', 'b']);
  });

  it('retira identidades huérfanas sin alterar el orden de las páginas vivas', () => {
    assert.deepEqual(
      retainingPages(steps, new Set(['a', 'c'])).map((step) => step.page),
      ['a', 'c'],
    );
  });

  it('un valor local roto no impide abrir Vera', () => {
    const storage = memoryStorage();
    storage.setItem('vera.navigationTrace', '{no');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    assert.deepEqual(loadTrace(), []);
  });

  it('conserva sólo las últimas cincuenta llegadas, también al migrar un rastro antiguo', () => {
    const storage = memoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    const long = Array.from({ length: TRACE_LIMIT + 7 }, (_, at): TraceStep => ({
      page: `page:${at}`,
      from: at === 0 ? null : `page:${at - 1}`,
      gesture: 'followed_reference',
      at,
    }));
    storage.setItem('vera.navigationTrace', JSON.stringify(long));
    const loaded = loadTrace();
    assert.equal(loaded.length, TRACE_LIMIT);
    assert.equal(loaded[0]?.page, 'page:7');
    assert.equal(JSON.parse(storage.getItem('vera.navigationTrace') ?? '[]').length, TRACE_LIMIT);
  });

  it('puede limpiarse por completo', () => {
    const storage = memoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    saveTrace(steps);
    clearTrace();
    assert.deepEqual(loadTrace(), []);
    assert.equal(storage.getItem('vera.navigationTrace'), null);
  });
});

describe('lo que es andar y lo que no', () => {
  it('revisitar una página la mueve al final sin repetirla', () => {
    const walking = walked(steps, { page: 'a', from: 'c', gesture: 'returned', at: 4 });
    assert.deepEqual(walking.map((step) => step.page), ['b', 'c', 'a']);
    assert.equal(walking.length, steps.length);
    assert.equal(walking.at(-1)?.gesture, 'returned');
  });

  it('pero llegar donde ya se estaba no es llegar', () => {
    /*
     * @invariant RedrawingAPageIsNotWalkingToIt. Estaba sostenido por convención
     * —quien redibuja no pasa gesto— y bastó un camino que sí lo pasara para
     * romperlo: pulsar un enlace a un ancla movía el fragmento de la dirección,
     * el enrutador lo leía como una llegada, y el rastro terminaba con la misma
     * página repetida una vez por clic.
     */
    const still = walked(steps, { page: 'c', from: 'c', gesture: 'followed_reference', at: 4 });
    assert.deepEqual(still, steps);
  });

  it('ni volver a abrir por la dirección la que ya estaba abierta', () => {
    // Sin `from` no hay de dónde venir, así que lo dice el rastro: si el último
    // paso ya estaba ahí, nadie anduvo.
    const same = walked(steps, { page: 'c', from: null, gesture: 'opened_directly', at: 4 });
    assert.deepEqual(same, steps);
  });

  it('y llegar de fuera a otra página sigue siendo llegar', () => {
    const arrived = walked(steps, { page: 'd', from: null, gesture: 'opened_directly', at: 4 });
    assert.equal(arrived.length, 4);
  });

  it('al seguir andando descarta primero la llegada más antigua', () => {
    const full = Array.from({ length: TRACE_LIMIT }, (_, at): TraceStep => ({
      page: `page:${at}`,
      from: at === 0 ? null : `page:${at - 1}`,
      gesture: 'followed_reference',
      at,
    }));
    const next = walked(full, {
      page: 'page:nueva',
      from: `page:${TRACE_LIMIT - 1}`,
      gesture: 'followed_reference',
      at: TRACE_LIMIT,
    });
    assert.equal(next.length, TRACE_LIMIT);
    assert.equal(next[0]?.page, 'page:1');
    assert.equal(next.at(-1)?.page, 'page:nueva');
  });
});
