import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEFAULT_TOKENS, session } from '../src/tokens.ts';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const previous = globalThis.localStorage;
afterEach(() => { globalThis.localStorage = previous; });

describe('vista del mapa publicado', () => {
  it('nace en 3D y recuerda una elección pública sin tocar la privada', () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage as unknown as Storage;

    assert.equal(session.publicGraphView(), 'graph_3d');
    session.setPublicGraphView('graph_2d');
    assert.equal(session.publicGraphView(), 'graph_2d');
    assert.equal(session.graphView(), 'graph_2d');
    assert.equal(storage.getItem('vera.graphView'), null);
  });

  it('recuerda D4 como una dimensión del mismo mapa', () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage as unknown as Storage;

    session.setPublicGraphView('graph_d4');
    assert.equal(session.publicGraphView(), 'graph_d4');
  });
});

describe('despliegue del front matter', () => {
  it('nace cerrado y conserva exactamente la última elección del lector', () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage as unknown as Storage;

    assert.equal(session.frontMatterOpen(), false);
    session.setFrontMatterOpen(true);
    assert.equal(session.frontMatterOpen(), true);
    assert.equal(storage.getItem('vera.frontMatterOpen'), 'true');

    session.setFrontMatterOpen(false);
    assert.equal(session.frontMatterOpen(), false);
    assert.equal(storage.getItem('vera.frontMatterOpen'), 'false');
  });
});

describe('diarios en el mapa', () => {
  it('nacen apagados y el interruptor recuerda exactamente su estado', () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage as unknown as Storage;

    assert.equal(session.graphJournals(), false);
    session.setGraphJournals(true);
    assert.equal(session.graphJournals(), true);
    session.setGraphJournals(false);
    assert.equal(session.graphJournals(), false);
  });
});

describe('superficies del sistema de diseño', () => {
  it('cada superficie elevada usa el token gobernado que Vera realmente define', () => {
    assert.ok(DEFAULT_TOKENS.some((token) => token.name === '--bg-raised'));
    assert.doesNotMatch(styles, /var\(--surface\b/);
  });
});
