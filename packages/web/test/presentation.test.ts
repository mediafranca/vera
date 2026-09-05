import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
