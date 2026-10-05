import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('prioridad móvil', () => {
  it('ofrece un cierre explícito que cancela la búsqueda expandida', () => {
    assert.match(html, /id="search-close"[^>]+aria-label="Cerrar búsqueda"/);
    assert.match(main, /#search-close'\)\.addEventListener\('click', \(\) => closeSearch\(true\)\)/);
  });

  it('recoge y limpia el buscador al salir de él en un teléfono', () => {
    assert.match(
      main,
      /search\.addEventListener\('blur',[\s\S]+closeSearch\(window\.matchMedia\('\(max-width: 640px\)'\)\.matches\)/,
    );
  });

  it('Ajustes bloquea el documento y queda contenido por la ventana', () => {
    assert.match(main, /document\.body\.classList\.add\('settings-open'\)/);
    assert.match(main, /document\.body\.classList\.remove\('settings-open'\)/);
    assert.match(styles, /body\.settings-open #text\s*\{[^}]*overflow:\s*hidden/);
    assert.match(styles, /#tokens\s*\{[^}]*box-sizing:\s*border-box[^}]*overflow-x:\s*hidden/s);
  });

  it('los títulos largos ceden espacio a sus controles sin ensanchar la página', () => {
    assert.match(styles, /\.page-heading\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
    assert.match(styles, /\.page-heading \.page-title\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/s);
  });

  it('alinea frontmatter, presentación y menú en una sola hilera', () => {
    assert.match(outliner, /heading\.append\(title, headingActions\)/);
    assert.match(outliner, /headingActions\.append\(propertiesToggle\)/);
    assert.match(outliner, /headingActions\.append\(present\)/);
    assert.match(outliner, /headingActions\.append\(more\)/);
    assert.doesNotMatch(outliner, /header\.append\(more\)/);
    assert.match(styles, /\.page-heading-actions\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center/s);
    assert.match(styles, /\.page-more\s*\{[^}]*position:\s*static[^}]*width:\s*1\.75rem[^}]*height:\s*1\.75rem/s);
  });
});
