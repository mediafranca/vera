import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  discardEditingDraft,
  keepEditingDraft,
  recoverEditingDraft,
} from '../src/editing-draft.ts';

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('borrador de una jugada editorial', () => {
  it('la pausa conserva localmente y nunca envía una revisión intermedia', () => {
    const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
    assert.match(outliner, /const preserveDraft = \(\): void =>/);
    assert.match(outliner, /keepEditingDraft\(block\.stableId, block\.content, session\.buffer\(\)\)/);
    assert.doesNotMatch(outliner, /setTimeout\(\(\) => void flush\(session\.pending\(\)\)/);
  });

  it('sobrevive localmente sin convertirse en otro estado canónico', () => {
    const storage = new MemoryStorage();
    keepEditingDraft('block:1', 'antes', 'después', storage);
    assert.equal(recoverEditingDraft('block:1', 'antes', storage), 'después');
  });

  it('no pisa una revisión base que cambió entretanto', () => {
    const storage = new MemoryStorage();
    keepEditingDraft('block:1', 'antes', 'mi cambio', storage);
    assert.equal(recoverEditingDraft('block:1', 'cambio ajeno', storage), null);
    assert.equal(storage.values.size, 0);
  });

  it('se retira al confirmar exactamente el resultado de la jugada', () => {
    const storage = new MemoryStorage();
    keepEditingDraft('block:1', 'antes', 'resultado', storage);
    discardEditingDraft('block:1', 'resultado', storage);
    assert.equal(recoverEditingDraft('block:1', 'antes', storage), null);
  });

  it('conserva un borrador posterior cuando termina un guardado anterior', () => {
    const storage = new MemoryStorage();
    keepEditingDraft('block:1', 'antes', 'posterior', storage);
    discardEditingDraft('block:1', 'intermedio', storage);
    assert.equal(recoverEditingDraft('block:1', 'antes', storage), 'posterior');
  });
});
