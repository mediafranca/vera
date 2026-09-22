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
    assert.match(styles, /\.vera-presentation \.reveal \{[^}]*--content-width: min\(44em, 100%\);/);
    assert.match(styles, /max-height: calc\(100dvh - clamp\(5\.5rem, 11vh, 7\.5rem\)\);/);
    assert.doesNotMatch(styles, /\.vera-presentation \.body svg \{[^}]*max-height: 64vh;/);
    assert.match(source, /classifySpatialSlides\(slides\)/);
    assert.match(styles, /section\.presentation-spatial \{[\s\S]*?overflow: hidden;/);
    assert.match(styles, /width: calc\(100vw - var\(--presentation-slide-inline\) - var\(--presentation-slide-inline\)\) !important;/);
    assert.match(styles, /height: calc\(100dvh - var\(--presentation-slide-top\) - var\(--presentation-slide-bottom\)\) !important;/);
    assert.match(styles, /\.presentation-spatial \.body :is\(img, video\) \{[\s\S]*?width: auto !important;[\s\S]*?height: auto !important;[\s\S]*?max-width: calc\(100vw[\s\S]*?max-height: calc\(100dvh/);
    assert.match(styles, /\.presentation-spatial \.body \.executable iframe \{[\s\S]*?height: 100% !important;/);
    assert.match(styles, /\.presentation-spatial > \.presentation-block > \.body:hover \{\s*background: transparent !important;/);
    assert.match(styles, /\.presentation-spatial \.body \.executable iframe \{[\s\S]*?border: 0 !important;[\s\S]*?box-shadow: none !important;/);
  });

  it('la presentación ya es el modo maximizado y no ofrece otro fullscreen', () => {
    const source = readFileSync(new URL('../src/presentation.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /requestFullscreen|exitFullscreen|Pantalla completa/);
    assert.doesNotMatch(source, /control\('Pantalla completa', 'maximize'\)/);
  });

  it('trata imágenes, dibujos, diagramas y ejecutables como láminas espaciales', () => {
    const source = readFileSync(new URL('../src/presentation.ts', import.meta.url), 'utf8');
    for (const kind of ['executable', 'drawn', 'mermaid-figure']) {
      assert.match(source, new RegExp(`only\\.matches\\('\\.${kind}'\\)`));
    }
    assert.match(source, /only\.matches\('\.table-scroll, table'\)/);
    assert.match(source, /only\.matches\('img, svg'\)/);
    assert.match(
      readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8'),
      /presentation-medium="table"[\s\S]*?overflow: auto;[\s\S]*?\.body table \{[\s\S]*?font-size: clamp\(0\.9rem, 1\.5vw, 1\.2rem\) !important;[\s\S]*?word-break: normal !important;[\s\S]*?min-width: clamp\(8rem, 12vw, 10rem\);/,
    );
  });

  it('convierte cada bloque raíz en una lámina y conserva dentro sus descendientes', () => {
    const source = readFileSync(new URL('../src/presentation.ts', import.meta.url), 'utf8');
    assert.match(source, /slide\.append\(renderNode\(root, options\)\)/);
    assert.doesNotMatch(source, /dataset\['presentationColumn'\]/);
    assert.match(source, /deck\.on\('overviewshown'/);
    assert.match(source, /frame\.loading = 'eager'/);
    assert.doesNotMatch(source, /viewDistance: 1_000/);
  });

  it('vuelve a resolver la hoja gobernada al actualizar y detecta sus cambios', () => {
    const source = readFileSync(new URL('../src/presentation.ts', import.meta.url), 'utf8');
    assert.match(source, /governedStyle = await presentationStyles\(newer\)/);
    assert.match(source, /style\.textContent = scopedPresentationStylesheet\(heldStyle\)/);
    assert.match(source, /newerStyle\.css === heldStyle/);
  });

  it('da ancho útil a tablas y reserva un pie legible para medios', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(styles, /\.vera-presentation \.body-text table \{[^}]*width: 100%;[^}]*max-width: none;/);
    assert.match(styles, /\.vera-presentation \.body figure:has\(iframe\) \{[^}]*width: 100%;/);
    assert.match(styles, /\.vera-presentation \.body figure:has\(iframe\) iframe \{[^}]*width: 100%;/);
    assert.match(styles, /\.vera-presentation \.body figcaption \{[^}]*font: 0\.72rem\/1\.35 var\(--font-ui\);/);
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
    for (const name of ['chevron-left', 'chevron-right', 'grid', 'feather', 'refresh-cw']) {
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

  it('deja la base en una capa inferior y la hoja gobernada fuera de ella', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(styles, /@layer vera-presentation-base \{[\s\S]*?\.vera-presentation \.reveal \{/);
    assert.doesNotMatch(scopedPresentationStylesheet('.reveal { font-size: 1rem; }'), /@layer/);
  });
});
