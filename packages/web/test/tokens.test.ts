import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_TOKENS,
  TOKEN_LABELS,
  createDesign,
  importDesign,
  clearTokenImportBackup,
  loadDesignLibrary,
  loadTokens,
  loadTokenImportBackup,
  parseDesignTokenPackage,
  planDesignTokenImport,
  reachForGraphViewChange,
  removeActiveDesign,
  renameActiveDesign,
  saveTokenImportBackup,
  selectDesign,
  serialiseDesignTokenPackage,
  session,
} from '../src/tokens.ts';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
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

describe('entrada segura a D4', () => {
  it('baja a un salto al entrar desde 2D o 3D', () => {
    assert.equal(reachForGraphViewChange('graph_2d', 'graph_d4', 3), 1);
    assert.equal(reachForGraphViewChange('graph_3d', 'graph_d4', 2), 1);
  });

  it('no impide que dentro de D4 se amplíe ni altera las otras transiciones', () => {
    assert.equal(reachForGraphViewChange('graph_d4', 'graph_d4', 3), 3);
    assert.equal(reachForGraphViewChange('graph_d4', 'graph_2d', 2), 2);
    assert.equal(reachForGraphViewChange('graph_2d', 'graph_3d', 3), 3);
  });
});

describe('despliegue del front matter', () => {
  it('nace cerrado y conserva como preferencia del cliente la última elección', () => {
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

  it('parte las direcciones largas sin añadir desplazamiento horizontal', () => {
    assert.match(styles, /\.property-external\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow-wrap:\s*anywhere[^}]*word-break:\s*break-word/s);
    assert.match(styles, /\.property-value:has\(\.property-external\)\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/s);
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

describe('rotación automática del mapa 3D', () => {
  it('nace apagada y el interruptor recuerda exactamente su estado', () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage as unknown as Storage;

    assert.equal(session.graphAutoRotate(), false);
    session.setGraphAutoRotate(true);
    assert.equal(session.graphAutoRotate(), true);
    session.setGraphAutoRotate(false);
    assert.equal(session.graphAutoRotate(), false);
  });
});

describe('superficies del sistema de diseño', () => {
  it('cada token canónico explica su función con un nombre humano', () => {
    assert.deepEqual(
      Object.keys(TOKEN_LABELS).sort(),
      DEFAULT_TOKENS.map((token) => token.name).sort(),
    );
    assert.equal(TOKEN_LABELS['--node-text'], 'páginas del mapa');
    assert.equal(TOKEN_LABELS['--link-stroke'], 'aristas neutras del mapa');
  });

  it('restablece la apariencia canónica vigente en claro y oscuro', () => {
    const defaults = new Map(DEFAULT_TOKENS.map((token) => [token.name, token]));

    assert.deepEqual(defaults.get('--bg-raised'), {
      name: '--bg-raised', light: '#e8ebf1', dark: '#390e30',
    });
    assert.deepEqual(defaults.get('--rule'), {
      name: '--rule', light: '#454f6e21', dark: '#5220606e',
    });
    assert.deepEqual(defaults.get('--text-size'), {
      name: '--text-size', light: '15px', dark: '16px',
    });
    assert.deepEqual(defaults.get('--line-height'), {
      name: '--line-height', light: '1.744', dark: '1.744',
    });
    assert.deepEqual(defaults.get('--content-width'), {
      name: '--content-width', light: '45em', dark: '40em',
    });
    assert.equal(defaults.has('--node-fill'), false);
    assert.deepEqual(defaults.get('--node-text'), {
      name: '--node-text', light: '#393a3c', dark: '#acc8af',
    });
  });

  it('mantiene visibles las aristas canónicas contra ambos fondos', () => {
    const defaults = new Map(DEFAULT_TOKENS.map((token) => [token.name, token]));
    const luminance = (hex: string): number => {
      const channels = hex.slice(1, 7).match(/../g)!.map((part) => Number.parseInt(part, 16) / 255)
        .map((part) => part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };
    const contrast = (a: string, b: string): number => {
      const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (bright! + 0.05) / (dark! + 0.05);
    };
    const edge = defaults.get('--link-stroke')!;
    const background = defaults.get('--bg')!;
    assert.ok(contrast(edge.light, background.light) >= 3);
    assert.ok(contrast(edge.dark, background.dark) >= 3);
  });

  it('cada superficie elevada usa el token gobernado que Vera realmente define', () => {
    assert.ok(DEFAULT_TOKENS.some((token) => token.name === '--bg-raised'));
    assert.doesNotMatch(styles, /var\(--surface\b/);
  });

  it('exporta un paquete legible y versionado sin preferencias del aparato', () => {
    const source = serialiseDesignTokenPackage(DEFAULT_TOKENS, new Date('2026-10-21T20:00:00.000Z'));
    const parsed = JSON.parse(source) as Record<string, unknown>;

    assert.equal(parsed['format'], 'vera.design-tokens');
    assert.equal(parsed['version'], 1);
    assert.equal(parsed['exportedAt'], '2026-10-21T20:00:00.000Z');
    assert.equal(parsed['name'], 'Vera');
    assert.deepEqual(parsed['tokens'], DEFAULT_TOKENS);
    assert.equal('scheme' in parsed, false);
    assert.equal('layout' in parsed, false);
    assert.equal('credentials' in parsed, false);
  });

  it('previsualiza la diferencia entre fusionar y reemplazar antes de importar', () => {
    const current = DEFAULT_TOKENS.map((token) => ({ ...token }));
    current.find((token) => token.name === '--accent')!.light = '#010203';
    current.find((token) => token.name === '--text-size')!.dark = '22px';
    const packageText = JSON.stringify({
      format: 'vera.design-tokens',
      version: 1,
      exportedAt: '2026-10-21T20:00:00.000Z',
      tokens: [{ name: '--accent', light: '#abcdef', dark: '#123456' }],
    });
    const imported = parseDesignTokenPackage(packageText);
    const merge = planDesignTokenImport(current, imported, 'merge');
    const replace = planDesignTokenImport(current, imported, 'replace');

    assert.equal(merge.changes.length, 1);
    assert.equal(merge.tokens.find((token) => token.name === '--text-size')!.dark, '22px');
    assert.equal(replace.changes.length, 1);
    assert.equal(
      replace.tokens.find((token) => token.name === '--text-size')!.dark,
      '22px',
    );
  });

  it('omite tokens futuros, pero rechaza duplicados y valores que cargan recursos', () => {
    const packageOf = (tokens: unknown[]) => JSON.stringify({
      format: 'vera.design-tokens', version: 1,
      exportedAt: '2026-10-21T20:00:00.000Z', tokens,
    });
    const future = parseDesignTokenPackage(packageOf([
      { name: '--accent', light: '#abcdef', dark: '#123456' },
      { name: '--future-token', light: '1', dark: '2' },
    ]));
    assert.deepEqual(future.unsupported, ['--future-token']);
    assert.throws(
      () => parseDesignTokenPackage(packageOf([
        { name: '--accent', light: '#abcdef', dark: '#123456' },
        { name: '--accent', light: '#fedcba', dark: '#654321' },
      ])),
      /más de una vez/,
    );
    assert.throws(
      () => parseDesignTokenPackage(packageOf([
        { name: '--font-body', light: 'url(https://tracker.example/font)', dark: 'system-ui' },
      ])),
      /inválido/,
    );
  });

  it('respalda automáticamente el estado anterior y permite retirarlo al deshacer', () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage as unknown as Storage;
    const current = DEFAULT_TOKENS.map((token) => ({ ...token }));
    current[0]!.light = '#010203';

    saveTokenImportBackup(current);
    assert.deepEqual(loadTokenImportBackup(), current);
    clearTokenImportBackup();
    assert.equal(loadTokenImportBackup(), null);
  });

  it('hace encontrables exportación, vista previa, modos y deshacer', () => {
    assert.match(settings, /Exportar tema…/);
    assert.match(settings, /Importar tema…/);
    assert.match(settings, /Añadir como un tema nuevo/);
    assert.match(settings, /Vista previa de la importación/);
    assert.match(settings, /Fusionar con los colores del tema actual/);
    assert.match(settings, /Reemplazar los colores del tema actual/);
    assert.match(settings, /Deshacer la última importación/);
  });

  it('migra el texto de nodos y sólo reemplaza la reserva antigua de aristas', () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage as unknown as Storage;
    const legacy = DEFAULT_TOKENS
      .filter((token) => !['--node-text', '--link-stroke'].includes(token.name))
      .concat([
        { name: '--node-fill', light: '#112233', dark: '#ddeeff' },
        { name: '--link-stroke', light: '#c5c8c1', dark: '#54273c' },
      ]);
    storage.setItem('vera.tokens', JSON.stringify(legacy));

    const migrated = new Map(loadTokens().map((token) => [token.name, token]));
    assert.deepEqual(migrated.get('--node-text'), {
      name: '--node-text', light: '#112233', dark: '#ddeeff',
    });
    assert.deepEqual(migrated.get('--link-stroke'), {
      name: '--link-stroke', light: '#767c7a', dark: '#7b767a',
    });
    assert.equal(migrated.has('--node-fill'), false);

    const imported = parseDesignTokenPackage(JSON.stringify({
      format: 'vera.design-tokens', version: 1,
      exportedAt: '2026-10-21T20:00:00.000Z',
      tokens: [{ name: '--node-fill', light: '#112233', dark: '#ddeeff' }],
    }));
    assert.equal(imported.supported[0]!.name, '--node-text');
  });

  it('migra el juego único a una biblioteca y permite operar diseños con nombre', () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage as unknown as Storage;
    const legacy = DEFAULT_TOKENS.map((token) => ({ ...token }));
    legacy[0]!.light = '#010203';
    storage.setItem('vera.tokens', JSON.stringify(legacy));

    assert.equal(loadDesignLibrary().designs.length, 1);
    assert.ok(loadDesignLibrary().common.some((token) => token.name === '--text-size'));
    assert.ok(loadDesignLibrary().common.some((token) => token.name === '--font-body'));
    assert.ok(loadDesignLibrary().designs[0]!.tokens.every((token) => token.name !== '--text-size' && token.name !== '--font-body'));
    assert.equal(loadTokens()[0]!.light, '#010203');

    createDesign(true);
    let library = loadDesignLibrary();
    assert.equal(library.designs.length, 2);
    assert.match(library.designs.find((one) => one.id === library.active)!.name, /^Copia de Vera/);

    const copied = library.active;
    assert.equal(renameActiveDesign('Lectura'), 'Lectura');
    importDesign('Portátil', DEFAULT_TOKENS);
    assert.equal(loadDesignLibrary().designs.length, 3);
    const imported = loadDesignLibrary().active;
    selectDesign('design:vera');
    assert.equal(loadDesignLibrary().active, 'design:vera');
    selectDesign(copied);
    assert.ok(removeActiveDesign());
    selectDesign(imported);
    assert.ok(removeActiveDesign());
    library = loadDesignLibrary();
    assert.equal(library.designs.length, 1);
    assert.equal(removeActiveDesign(), null);
  });
});
