import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const administration = readFileSync(new URL('../src/agent-administration.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('administración del bibliotecario embebido', () => {
  it('vive como superficie de sistema y no como página duplicada', () => {
    assert.match(main, /window\.location\.pathname === '\/agentes'/);
    assert.match(main, /classList\.add\('special-surface'\)/);
    assert.match(settings, /Bibliotecarios y agentes/);
  });

  it('compone una constitución desde páginas canónicas y no desde texto paralelo', () => {
    assert.match(administration, /api\.pages\(\)/);
    assert.match(administration, /setAgentConstitution/);
    assert.match(administration, /Páginas constitutivas/);
  });

  it('hace visibles revisión activa, rollback y separación del runtime', () => {
    assert.match(administration, /Construir borrador/);
    assert.match(administration, /Volver a esta versión/);
    assert.match(administration, /el modelo y el runtime pueden cambiar/);
  });

  it('mantiene blancos táctiles y una composición legible en móvil', () => {
    assert.match(styles, /\.agent-administration :is\(button, select, input\)[\s\S]*?min-height: 2\.75rem/);
    assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.agent-source-row/);
  });

  it('no multiplica todo el corpus por cada agente', () => {
    assert.match(administration, /document\.createElement\('details'\)/);
    assert.match(administration, /card\.addEventListener\('toggle'/);
    assert.match(administration, /slice\(0, 12\)/);
    assert.doesNotMatch(administration, /for \(const page of choices\) \{/);
  });
});
