import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  restoreViewportThroughComposition,
  viewportDelta,
  type HeldViewport,
} from '../src/viewport.ts';

const held: HeldViewport = {
  scrollTop: 900,
  seats: [
    { block: 'block:b', top: 12 },
    { block: 'block:c', top: 70 },
    { block: 'block:a', top: -40 },
  ],
};

describe('conservar el lugar al redibujar', () => {
  it('corrige lo que se movió el bloque más cercano al borde', () => {
    assert.equal(viewportDelta(held, new Map([['block:b', 42]])), 30);
  });

  it('si el bloque fue eliminado usa el siguiente testigo visible', () => {
    assert.equal(viewportDelta(held, new Map([['block:c', 40]])), -30);
  });

  it('sin ningún testigo superviviente pide conservar el scroll numérico', () => {
    assert.equal(viewportDelta(held, new Map()), null);
  });

  it('vuelve a intentarlo hasta que el testigo entra en la composición progresiva', () => {
    let composing = true;
    let frame: FrameRequestCallback | null = null;
    const oldWindow = globalThis.window;
    Object.assign(globalThis, {
      window: {
        requestAnimationFrame(callback: FrameRequestCallback): number {
          frame = callback;
          return 1;
        },
      },
    });

    const blocks: Array<{ dataset: { id: string }; getBoundingClientRect: () => DOMRect }> = [];
    const container = {
      isConnected: true,
      scrollTop: 0,
      getBoundingClientRect: () => ({ top: 0, height: 600 }) as DOMRect,
      querySelectorAll: () => blocks,
      querySelector: () => composing ? {} : null,
    } as unknown as HTMLElement;

    try {
      restoreViewportThroughComposition(container, held);
      assert.equal(container.scrollTop, 900);
      assert.notEqual(frame, null);

      blocks.push({
        dataset: { id: 'block:b' },
        getBoundingClientRect: () => ({ top: 42 }) as DOMRect,
      });
      composing = false;
      (frame as unknown as (time: number) => void)(0);
      assert.equal(container.scrollTop, 930);
    } finally {
      if (oldWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.assign(globalThis, { window: oldWindow });
    }
  });
});
