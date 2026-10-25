import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { taskToggle } from '../src/task-toggle.ts';

class Classes {
  readonly names = new Set<string>();
  add(...names: string[]): void { for (const name of names) this.names.add(name); }
  remove(...names: string[]): void { for (const name of names) this.names.delete(name); }
  contains(name: string): boolean { return this.names.has(name); }
}

function fakeButton(): {
  button: HTMLButtonElement;
  click: () => void;
  attributes: Map<string, string>;
} {
  const attributes = new Map<string, string>();
  let listener: ((event: { stopPropagation(): void }) => void) | undefined;
  const button = {
    type: '',
    className: '',
    title: '',
    classList: new Classes(),
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    removeAttribute(name: string) { attributes.delete(name); },
    addEventListener(name: string, said: (event: { stopPropagation(): void }) => void) {
      if (name === 'click') listener = said;
    },
  } as unknown as HTMLButtonElement;
  return {
    button,
    click: () => listener?.({ stopPropagation() {} }),
    attributes,
  };
}

describe('marcar una tarea', () => {
  it('enseña el estado siguiente de inmediato y vuelve si no se guardó', async () => {
    const original = globalThis.document;
    const fake = fakeButton();
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => fake.button },
    });

    try {
      const classes = new Classes();
      let settle: ((saved: boolean) => void) | undefined;
      const saved = new Promise<boolean>((resolve) => { settle = resolve; });
      taskToggle(
        { classList: classes } as unknown as HTMLElement,
        { state: 'por hacer', said: 'probar la interacción' },
        () => saved,
      );

      fake.click();
      assert.equal(classes.contains('task-doing'), true);
      assert.equal(fake.attributes.get('aria-checked'), 'mixed');
      assert.equal(fake.attributes.get('aria-busy'), 'true');

      settle?.(false);
      await saved;
      await Promise.resolve();
      assert.equal(classes.contains('task-todo'), true);
      assert.equal(fake.attributes.get('aria-checked'), 'false');
      assert.equal(fake.attributes.has('aria-busy'), false);
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: original });
    }
  });

  it('conserva el mismo control y confirma la nueva fuente al guardar', async () => {
    const original = globalThis.document;
    const fake = fakeButton();
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => fake.button },
    });

    try {
      const classes = new Classes();
      let written = '';
      let applied = '';
      taskToggle(
        { classList: classes } as unknown as HTMLElement,
        { state: 'haciendo', said: 'probar la interacción' },
        async (content) => { written = content; return true; },
        (_state, content) => { applied = content; },
      );
      fake.click();
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(classes.contains('task-done'), true);
      assert.equal(written, '[x] probar la interacción');
      assert.equal(applied, written);
      assert.equal(fake.attributes.get('aria-checked'), 'true');
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: original });
    }
  });
});

describe('volver de editar una tarea', () => {
  const source = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
  const render = source.slice(source.indexOf('const render = (content: string)'), source.indexOf('let timer:'));

  it('reconstruye la casilla y no deja la marca fuente en lectura', () => {
    assert.match(render, /const task = readTask\(content\)/);
    assert.match(render, /body\.append\(taskToggle\(/);
    assert.match(render, /renderMarkdown\(task === null \? content : task\.said/);
  });
});

describe('la casilla no depende del aspecto nativo del navegador', () => {
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const start = styles.indexOf('.task-box {');
  const rule = styles.slice(start, styles.indexOf('}', start));
  it('neutraliza la apariencia de botón de cada plataforma', () => {
    assert.match(rule, /appearance: none/);
    assert.match(rule, /-webkit-appearance: none/);
  });

  it('cada estado alcanza sólo la casilla de ese bloque y no sus hijas', () => {
    assert.match(styles, /\.task-doing > \.body > \.task-box \{/);
    assert.match(styles, /\.task-done > \.body > \.task-box \{/);
    assert.doesNotMatch(styles, /\.task-doing \.task-box/);
    assert.doesNotMatch(styles, /\.task-done \.task-box/);
  });
});
