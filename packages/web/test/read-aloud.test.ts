import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runSpeechQueue, speechParts } from '../src/read-aloud.ts';

describe('fragmentos de lectura', () => {
  it('conserva el orden y prefiere límites de oración', () => {
    const parts = speechParts('block:uno', 'Primera frase. Segunda frase.', 18);
    assert.deepEqual(parts, [
      { key: 'block:uno:0', text: 'Primera frase.' },
      { key: 'block:uno:1', text: 'Segunda frase.' },
    ]);
  });

  it('parte una oración larga sin exceder el límite del sintetizador', () => {
    const parts = speechParts('block:dos', 'uno dos tres cuatro cinco seis', 12);
    assert.equal(parts.map((part) => part.text).join(' '), 'uno dos tres cuatro cinco seis');
    assert.equal(parts.every((part) => part.text.length <= 12), true);
  });

  it('no pierde una palabra excepcionalmente larga al partirla', () => {
    const word = 'a'.repeat(641);
    const parts = speechParts('long-word', word, 280);
    assert.ok(parts.every((part) => part.text.length <= 280));
    assert.equal(parts.map((part) => part.text).join(''), word);
  });

  it('no inventa voz para un bloque vacío', () => {
    assert.deepEqual(speechParts('block:vacio', '   '), []);
  });

  it('prepara la parte siguiente mientras todavía reproduce la actual', async () => {
    const parts = speechParts('bitacora', 'Primera parte. Segunda parte. Tercera parte.', 16);
    const events: string[] = [];
    const preparation = new Map<string, (value: string) => void>();
    const playback = new Map<string, () => void>();
    const done = runSpeechQueue(
      parts,
      (part) => new Promise<string>((resolve) => {
        events.push(`preparar:${part.key}`);
        preparation.set(part.key, resolve);
      }),
      (audio, part) => new Promise<void>((resolve) => {
        events.push(`reproducir:${part.key}:${audio}`);
        playback.set(part.key, resolve);
      }),
    );

    preparation.get('bitacora:0')?.('audio-0');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, [
      'preparar:bitacora:0',
      'preparar:bitacora:1',
      'reproducir:bitacora:0:audio-0',
    ]);

    preparation.get('bitacora:1')?.('audio-1');
    playback.get('bitacora:0')?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events.slice(-2), [
      'preparar:bitacora:2',
      'reproducir:bitacora:1:audio-1',
    ]);

    preparation.get('bitacora:2')?.('audio-2');
    playback.get('bitacora:1')?.();
    await new Promise((resolve) => setImmediate(resolve));
    playback.get('bitacora:2')?.();
    await done;
    assert.deepEqual(events.filter((event) => event.startsWith('reproducir:')), [
      'reproducir:bitacora:0:audio-0',
      'reproducir:bitacora:1:audio-1',
      'reproducir:bitacora:2:audio-2',
    ]);
  });
});
