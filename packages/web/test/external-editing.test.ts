// Sesión temporal-durable y conciliación conservadora de tres vías.
// Ver specs/external-editing.allium.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  browserExternalSessionStorage,
  createExternalSessionStore,
  externalPageBlockOrder,
  planExternalBlockEdit,
  planExternalPageEdits,
  projectExternalBlock,
  reconcileExternalText,
  type ExternalSessionSnapshot,
  type ExternalSessionStorage,
} from '../src/external-editing.ts';

const dialogSource = readFileSync(new URL('../src/external-editing-dialog.ts', import.meta.url), 'utf8');
const outlinerSource = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');

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

  it('puede llevar a atención un rechazo del servidor sin fingir una nueva base', () => {
    const store = createExternalSessionStore(memory(), () => 10, () => 'session:1');
    const session = store.open({ device: 'alexei', target, baseSequence: 7, source: 'hola' });
    store.save(session.id, 'hola, mundo');
    const attention = store.requireAttention(session.id);
    assert.equal(attention.status, 'attention_required');
    assert.equal(attention.manifest.baseSequence, 7);
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

describe('aceptación atómica de una página Markdown', () => {
  const blocks = [
    { stableId: 'block:raiz', content: 'Raíz', parent: null, position: 0 },
    { stableId: 'block:hijo', content: 'Hijo\ncon segunda línea', parent: 'block:raiz', position: 0 },
    { stableId: 'block:otro', content: 'Otro', parent: null, position: 1 },
  ];
  const base = [
    'tipo:: nota',
    '',
    '- Raíz',
    '  color:: azul',
    '\t- Hijo',
    '\t  con segunda línea',
    '- Otro',
    '',
  ].join('\n');

  it('produce sólo ediciones de contenido conservando identidades y propiedades', () => {
    const external = base.replace('- Raíz', '- Raíz corregida').replace('\t  con segunda línea', '\t  ampliado');
    assert.deepEqual(planExternalPageEdits(base, external, blocks), {
      kind: 'ready',
      edits: [
        { kind: 'edit_block', block: 'block:raiz', content: 'Raíz corregida' },
        { kind: 'edit_block', block: 'block:hijo', content: 'Hijo\nampliado' },
      ],
    });
  });

  it('lleva a conciliación una alteración estructural', () => {
    const plan = planExternalPageEdits(base, base.replace('\t- Hijo', '- Hijo'), blocks);
    assert.equal(plan.kind, 'divergent');
    if (plan.kind === 'divergent') assert.match(plan.reason, /estructura|jerarquía/);
  });

  it('lleva a conciliación propiedades alteradas en vez de volverlas texto', () => {
    const blockProperty = planExternalPageEdits(base, base.replace('color:: azul', 'color:: rojo'), blocks);
    assert.equal(blockProperty.kind, 'divergent');
    const pageProperty = planExternalPageEdits(base, base.replace('tipo:: nota', 'tipo:: ensayo'), blocks);
    assert.equal(pageProperty.kind, 'divergent');
  });

  it('respeta el orden del árbol aunque la vista plana venga desordenada', () => {
    const external = base.replace('- Otro', '- Otro editado');
    const plan = planExternalPageEdits(base, external, [blocks[2]!, blocks[1]!, blocks[0]!]);
    assert.deepEqual(plan, {
      kind: 'ready',
      edits: [{ kind: 'edit_block', block: 'block:otro', content: 'Otro editado' }],
    });
    assert.deepEqual(externalPageBlockOrder([blocks[2]!, blocks[1]!, blocks[0]!]), [
      'block:raiz', 'block:hijo', 'block:otro',
    ]);
  });
});

describe('superficie de edición externa', () => {
  it('se ofrece desde el menú de la página sólo cuando Desktop entrega el puente', () => {
    assert.match(outlinerSource, /Editar en aplicación externa/);
    assert.match(outlinerSource, /callbacks\.onExternalEditPage === undefined/);
  });

  it('se ofrece también desde el menú de cada bloque', () => {
    assert.match(outlinerSource, /onExternalEditBlock\?\.\(page, node\.block\)/);
    assert.match(outlinerSource, /callbacks\.onExternalEditBlock === undefined/);
  });

  it('guardar no escribe y Aceptar envía el plan con su secuencia base', () => {
    assert.match(dialogSource, /store\.save\(change\.sessionId, change\.content\)/);
    assert.match(dialogSource, /api\.submitCanonicalBatch\([\s\S]*session\.manifest\.baseSequence/);
    assert.match(dialogSource, /bridge\(\)\?\.close\(session\.id, 'accepted'\)/);
  });

  it('reanuda desde el archivo en disco si Luca guardó mientras Vera estaba cerrada', () => {
    assert.match(dialogSource, /opened\.content === session\.draft \? session : store\.save/);
  });
});

describe('proyección externa según el tipo de bloque', () => {
  const cases = [
    ['```mermaid\ngraph TD\nA-->B\n```', 'mermaid', 'mmd'],
    ['```svg\n<svg></svg>\n```', 'svg', 'svg'],
    ['```html-live\n<button>sí</button>\n```', 'html', 'html'],
    ['```p5js\ncreateCanvas(40, 40)\n```', 'javascript', 'js'],
    ['```proceso\ndefinición: pictos/producir\n```', 'process', 'yaml'],
    ['```mediawiki\n== Título ==\n```', 'mediawiki', 'wiki'],
    ['```typescript\nconst n: number = 1\n```', 'code', 'ts'],
  ] as const;

  for (const [content, kind, extension] of cases) {
    it(`materializa ${kind} como .${extension} y restituye su cercado`, () => {
      const projection = projectExternalBlock(content);
      assert.equal(projection.kind, kind);
      assert.equal(projection.extension, extension);
      assert.equal(projection.restore(projection.source), content);
    });
  }

  it('trata un bloque ordinario como Markdown completo', () => {
    const projection = projectExternalBlock('Texto con **énfasis**');
    assert.equal(projection.kind, 'block_markdown');
    assert.equal(projection.extension, 'md');
    assert.equal(projection.restore('Otro'), 'Otro');
  });

  it('acepta la fuente editada restituyendo el tipo y la identidad del bloque', () => {
    const content = '```svg\n<svg viewBox="0 0 10 10"></svg>\n```';
    const projection = projectExternalBlock(content);
    assert.deepEqual(
      planExternalBlockEdit(
        projection.source,
        '<svg viewBox="0 0 20 20"></svg>',
        'block:figura',
        projection,
      ),
      {
        kind: 'ready',
        edits: [{
          kind: 'edit_block',
          block: 'block:figura',
          content: '```svg\n<svg viewBox="0 0 20 20"></svg>\n```',
        }],
      },
    );
  });
});
