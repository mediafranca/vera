// Sesión temporal-durable y conciliación conservadora de tres vías.
// Ver specs/external-editing.allium.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  browserExternalSessionStorage,
  createExternalSessionStore,
  reconcileExternalText,
  type ExternalSessionSnapshot,
  type ExternalSessionStorage,
} from '../src/external-editing.ts';

const memory = (initial: ExternalSessionSnapshot | null = null): ExternalSessionStorage & {
  snapshot(): ExternalSessionSnapshot | null;
} => {
  let current = initial;
  return {
    load: () => current,
    save: (snapshot) => { current = structuredClone(snapshot); },
    snapshot: () => current,
  };
};

const target = {
  graph: 'graph:vera',
  kind: 'page_markdown' as const,
  page: 'page:cero',
};

describe('conciliación externa de tres vías', () => {
  it('adopta el cambio externo cuando Vera no cambió', () => {
    assert.deepEqual(reconcileExternalText('uno', 'uno', 'dos'), {
      kind: 'external_only',
      content: 'dos',
    });
  });

  it('actualiza un borrador limpio cuando sólo Vera cambió', () => {
    assert.deepEqual(reconcileExternalText('uno', 'dos', 'uno'), {
      kind: 'canonical_only',
      content: 'dos',
    });
  });

  it('combina automáticamente cambios en tramos independientes', () => {
    const result = reconcileExternalText(
      ['a', 'b', 'c', 'd'].join('\n'),
      ['A', 'b', 'c', 'd'].join('\n'),
      ['a', 'b', 'c', 'D'].join('\n'),
    );
    assert.deepEqual(result, {
      kind: 'combined',
      content: ['A', 'b', 'c', 'D'].join('\n'),
    });
  });

  it('lleva a la superficie dos intenciones sobre el mismo tramo', () => {
    const result = reconcileExternalText('a\nb\nc', 'a\nB de Vera\nc', 'a\nB externa\nc');
    assert.equal(result.kind, 'divergent');
    if (result.kind !== 'divergent') return;
    assert.equal(result.divergence.base, 'a\nb\nc');
    assert.equal(result.divergence.canonical, 'a\nB de Vera\nc');
    assert.equal(result.divergence.external, 'a\nB externa\nc');
  });

  it('no inventa un orden para dos inserciones en el mismo punto', () => {
    assert.equal(reconcileExternalText('a\nb', 'a\nVera\nb', 'a\nLuca\nb').kind, 'divergent');
  });
});

describe('sesión temporal-durable', () => {
  it('persiste un snapshot portable en almacenamiento del dispositivo', () => {
    const values = new Map<string, string>();
    const strings = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const storage = browserExternalSessionStorage(strings);
    const store = createExternalSessionStore(storage, () => 10, () => 'session:1');
    store.open({ device: 'alexei', target, baseSequence: 7, source: 'hola' });
    assert.equal(browserExternalSessionStorage(strings).load()?.sessions[0]?.id, 'session:1');

    values.set('vera.external-editing.v1', '{roto');
    assert.equal(browserExternalSessionStorage(strings).load(), null);
  });

  it('reabrir el mismo objeto y dispositivo reutiliza la sesión', () => {
    const storage = memory();
    const store = createExternalSessionStore(storage, () => 10, () => 'session:1');
    const first = store.open({ device: 'alexei', target, baseSequence: 7, source: 'hola' });
    const second = store.open({ device: 'alexei', target, baseSequence: 8, source: 'otro' });
    assert.equal(second.id, first.id);
    assert.equal(store.sessions().length, 1);
  });

  it('otro dispositivo puede sostener su propia sesión del mismo objeto', () => {
    let next = 0;
    const store = createExternalSessionStore(memory(), () => 10, () => `session:${++next}`);
    store.open({ device: 'alexei', target, baseSequence: 7, source: 'hola' });
    store.open({ device: 'andrei', target, baseSequence: 7, source: 'hola' });
    assert.equal(store.sessions().length, 2);
  });

  it('guardar sólo vuelve listo el borrador: no lo acepta', () => {
    const store = createExternalSessionStore(memory(), () => 10, () => 'session:1');
    const session = store.open({ device: 'alexei', target, baseSequence: 7, source: 'hola' });
    const saved = store.save(session.id, 'hola, mundo');
    assert.equal(saved.status, 'ready');
    assert.equal(saved.dirty, true);
  });

  it('sobrevive al reinicio usando el estado durable', () => {
    const storage = memory();
    const first = createExternalSessionStore(storage, () => 10, () => 'session:1');
    const session = first.open({ device: 'alexei', target, baseSequence: 7, source: 'hola' });
    first.save(session.id, 'borrador que no se pierde');

    const restored = createExternalSessionStore(storage, () => 20, () => 'unused');
    assert.equal(restored.sessions()[0]?.draft, 'borrador que no se pierde');
    assert.equal(restored.sessions()[0]?.status, 'ready');
  });

  it('rebasa cambios independientes y conserva la aceptación pendiente', () => {
    const store = createExternalSessionStore(memory(), () => 10, () => 'session:1');
    const session = store.open({
      device: 'alexei',
      target,
      baseSequence: 7,
      source: 'a\nb\nc\nd',
    });
    store.save(session.id, 'a\nb\nc\nD');
    const rebased = store.advance(session.id, 'A\nb\nc\nd', 8);
    assert.equal(rebased.draft, 'A\nb\nc\nD');
    assert.equal(rebased.status, 'ready');
    assert.equal(rebased.manifest.baseSequence, 8);
  });

  it('una divergencia exige atención y no puede aceptarse', () => {
    const store = createExternalSessionStore(memory(), () => 10, () => 'session:1');
    const session = store.open({ device: 'alexei', target, baseSequence: 7, source: 'a\nb\nc' });
    store.save(session.id, 'a\nB externa\nc');
    const conflicted = store.advance(session.id, 'a\nB de Vera\nc', 8);
    assert.equal(conflicted.status, 'attention_required');
    assert.throws(() => store.accept(session.id, 8), /no está lista/);
    assert.equal(store.save(session.id, 'a\ntercera versión\nc').status, 'attention_required');
  });

  it('aceptar con una revisión nueva vuelve a requerir atención', () => {
    const store = createExternalSessionStore(memory(), () => 10, () => 'session:1');
    const session = store.open({ device: 'alexei', target, baseSequence: 7, source: 'hola' });
    store.save(session.id, 'hola, mundo');
    const stale = store.accept(session.id, 8);
    assert.equal(stale.status, 'attention_required');
  });

  it('aceptar y descartar son cierres explícitos', () => {
    let next = 0;
    const store = createExternalSessionStore(memory(), () => 10, () => `session:${++next}`);
    const accepted = store.open({ device: 'alexei', target, baseSequence: 7, source: 'hola' });
    store.save(accepted.id, 'hola, mundo');
    assert.equal(store.accept(accepted.id, 7).status, 'accepted');

    const reopened = store.open({ device: 'alexei', target, baseSequence: 8, source: 'nuevo' });
    assert.notEqual(reopened.id, accepted.id);
    assert.equal(store.discard(reopened.id).status, 'discarded');
  });
});
