import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createVoiceOutbox,
  identityOf,
  inMemoryVoiceStore,
  type PendingRecording,
} from '../src/voice-outbox.ts';

const pending = (id: string, at: number, status: PendingRecording['status'] = 'local'): PendingRecording => ({
  id,
  hash: id.padEnd(64, '0').slice(0, 64),
  audio: new Blob([id], { type: 'audio/webm' }),
  mediaType: 'audio/webm',
  durationMs: 1000,
  placedInBlock: 'block:voice',
  placedInPage: 'page:day:2026-11-18',
  capturedAt: at,
  status,
});

describe('identidad local de una grabación', () => {
  it('sale de los bytes y coincide al repetirlos', async () => {
    const first = await identityOf(new Blob(['lo dicho']));
    const second = await identityOf(new Blob(['lo dicho']));
    assert.deepEqual(first, second);
    assert.match(first.id, /^recording:[0-9a-f]{16}$/);
    assert.equal(first.hash.length, 64);
  });
});

describe('bandeja durable de voz', () => {
  it('restaura los bytes y el lugar donde se habló', async () => {
    const store = inMemoryVoiceStore();
    const one = createVoiceOutbox(store);
    await one.remember(pending('recording:a', 1));

    const again = createVoiceOutbox(store);
    const restored = await again.restore();
    assert.equal(await restored[0]?.audio.text(), 'recording:a');
    assert.equal(restored[0]?.placedInPage, 'page:day:2026-11-18');
  });

  it('devuelve a local lo interrumpido durante una subida', async () => {
    const store = inMemoryVoiceStore();
    await store.put(pending('recording:a', 1, 'sending'));
    const restored = await createVoiceOutbox(store).restore();
    assert.equal(restored[0]?.status, 'local');
    assert.equal((await store.all())[0]?.status, 'local');
  });

  it('sale por fecha de captura y sólo se retira tras confirmación', async () => {
    const box = createVoiceOutbox(inMemoryVoiceStore());
    await box.remember(pending('recording:b', 2));
    await box.remember(pending('recording:a', 1));
    assert.deepEqual(box.pending().map((one) => one.id), ['recording:a', 'recording:b']);
    await box.settle('recording:a');
    assert.deepEqual(box.pending().map((one) => one.id), ['recording:b']);
  });
});
