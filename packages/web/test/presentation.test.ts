import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

import { isPresentation, presentationLocation, presentationRevision } from '../src/presentation.ts';
import {
  presentationThemeTitle,
  scopedPresentationStylesheet,
  validateStylesheetSource,
} from '../src/presentation-style.ts';

describe('páginas que se pueden presentar', () => {
  it('reconoce el tipo gobernado aunque cambien mayúsculas o acentos', () => {
    assert.equal(isPresentation([{ key: 'tipo', value: 'Presentación' }], 'tipo'), true);
    assert.equal(isPresentation([{ key: 'TIPO', value: 'presentacion' }], 'tipo'), true);
  });

  it('no convierte una página ordinaria en presentación', () => {
    assert.equal(isPresentation([{ key: 'tipo', value: 'Concepto' }], 'tipo'), false);
    assert.equal(isPresentation([], 'tipo'), false);
  });

  it('da a cada lámina una dirección estable y vuelve a la fuente señalada', () => {
    const source = new URL('https://vera.example/p/Una?focus=block%3A1#block%3Aold');
    assert.equal(
      presentationLocation(source, 'block:2', true),
      '/p/Una?focus=block%3A1&present=block%3A2',
    );
    assert.equal(
      presentationLocation(source, 'block:2', false),
      '/p/Una?focus=block%3A1#block%3A2',
    );
  });

  it('distingue una revisión nueva aunque conserve el mismo número de bloques', () => {
    const blocks = [{ stableId: 'block:1' }] as never[];
    assert.notEqual(
      presentationRevision({ lastEditedAt: 1, blocks }),
      presentationRevision({ lastEditedAt: 2, blocks }),
    );
  });

  it('alinea arriba y deja desplazar verticalmente una lámina que no cabe', () => {
    const source = readFileSync(new URL('../src/presentation.ts', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(source, /center: false/);
    assert.match(styles, /\.vera-presentation \.reveal \.slides section \{[\s\S]*?overflow-y: auto;[\s\S]*?touch-action: pan-y;/);
  });

  it('usa todo el escenario y deja que los medios crezcan sin márgenes heredados', () => {
    const source = readFileSync(new URL('../src/presentation.ts', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(source, /width: '100%',\s*\n\s*height: '100%',\s*\n\s*margin: 0,/);
    assert.match(styles, /\.vera-presentation \.reveal \{[^}]*--content-width: 34em;/);
    assert.match(styles, /max-height: calc\(100dvh - clamp\(7rem, 15vh, 10rem\)\);/);
    assert.doesNotMatch(styles, /\.vera-presentation \.body svg \{[^}]*max-height: 64vh;/);
  });

  it('conserva el outline como columnas verticales y activa sus miniaturas a demanda', () => {
    const source = readFileSync(new URL('../src/presentation.ts', import.meta.url), 'utf8');
    assert.match(source, /dataset\['presentationColumn'\] = 'true'/);
    assert.match(source, /deck\.on\('overviewshown'/);
    assert.match(source, /frame\.loading = 'eager'/);
    assert.doesNotMatch(source, /viewDistance: 1_000/);
  });

  it('lleva el cambio claro y oscuro a la barra superior', () => {
    const source = readFileSync(new URL('../src/presentation.ts', import.meta.url), 'utf8');
    assert.match(source, /toolbar\.append\([^\n]*scheme/);
    assert.match(source, /Cambiar a modo claro/);
    assert.match(source, /Cambiar a modo oscuro/);
  });

  it('usa la familia de iconos de Vera en vez de píldoras de texto', () => {
    const source = readFileSync(new URL('../src/presentation.ts', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    for (const name of ['chevron-left', 'chevron-right', 'grid', 'feather', 'maximize', 'refresh-cw']) {
      assert.match(source, new RegExp(`['"]${name}['"]`));
    }
    assert.match(source, /icon\(dark \? 'sun' : 'moon'\)/);
    assert.match(styles, /\.presentation-toolbar button \{[^}]*width: 2\.15rem;[^}]*border-radius: 0\.45rem;/);
    assert.doesNotMatch(styles, /\.presentation-toolbar button \{[^}]*border-radius: 999px;/);
  });
});

describe('hojas gobernadas de presentación', () => {
  it('lee el tema enlazado sin convertir Reveal en ontología', () => {
    assert.equal(presentationThemeTitle([{ key: 'tema', value: '[[Mi tema.css]]' }]), 'Mi tema.css');
    assert.equal(presentationThemeTitle([]), null);
  });

  it('rechaza dependencias remotas y reglas capaces de importar otra hoja', () => {
    assert.equal(validateStylesheetSource('@import "fuera.css";').valid, false);
    assert.equal(validateStylesheetSource('.reveal { background: url(https://example.test/x); }').valid, false);
    assert.equal(validateStylesheetSource('@keyframes fuera { to { opacity: 0 } }').valid, false);
    assert.equal(validateStylesheetSource('.reveal { color: var(--text); }').valid, true);
  });

  it('confina la hoja al escenario de la presentación', () => {
    assert.equal(
      scopedPresentationStylesheet('* { color: red; }'),
      '@scope (.vera-presentation .presentation-stage) {\n* { color: red; }\n}',
    );
  });
});
