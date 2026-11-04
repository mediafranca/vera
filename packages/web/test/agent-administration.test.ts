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
    assert.match(settings, /label: 'Bibliotecaria'/);
  });

  it('compone una constitución desde páginas canónicas y no desde texto paralelo', () => {
    assert.match(administration, /api\.pages\(\)/);
    assert.match(administration, /setAgentConstitution/);
    assert.match(administration, /Páginas constitutivas/);
    assert.match(administration, /Páginas canónicas y editables que constituyen/);
    assert.match(administration, /Abrir y editar/);
    assert.doesNotMatch(administration, /page\.visibility === 'private'/);
  });

  it('hace visibles revisión activa, rollback y separación del runtime', () => {
    assert.match(administration, /Construir borrador/);
    assert.match(administration, /Volver a esta versión/);
    assert.match(administration, /el modelo y el runtime pueden cambiar/);
    assert.match(administration, /Runtime efectivo/);
    assert.match(administration, /Sin recibo del runtime/);
    assert.match(administration, /divergente/);
    assert.match(administration, /Vera no confunde activación con ejecución/);
  });

  it('expone el catálogo del harness y gobierna territorios sin prometer autoridad nueva', () => {
    assert.match(administration, /Herramientas ·/);
    assert.match(administration, /no contiene herramientas destructivas/);
    assert.match(administration, /Territorio de \$\{participantName\}/);
    assert.match(administration, /Una exclusión domina cualquier inclusión/);
    assert.match(administration, /api\.updateTerritory/);
    assert.match(administration, /Incluir páginas de la biblioteca general/);
    assert.match(administration, /view\.policies\.filter\(\(policy\) => policy\.participant === participant\)/);
    assert.match(styles, /\.librarian-tool-catalogue/);
    assert.match(styles, /\.territory-surface/);
  });

  it('muestra la dialéctica como control operativo y no como prosa disfrazada de configuración', () => {
    assert.match(administration, /Dialéctica bibliotecaria activa/);
    assert.match(administration, /dialectic: \{ enabled: dialectic\.checked \}/);
    assert.match(administration, /pide primero una tentativa/);
  });

  it('mantiene blancos táctiles y una composición legible en móvil', () => {
    assert.match(styles, /\.agent-administration :is\(button, select, input\)[\s\S]*?min-height: 2\.75rem/);
    assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.agent-source-row/);
    assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.agent-runtime-list li/);
  });

  it('resuelve una sola identidad y no convierte Bibliotecaria en directorio de agentes', () => {
    assert.match(administration, /requested \?\? runtime\.librarian\?\.agent/);
    assert.match(administration, /agents\.find\(\(one\) => one\.agent\.id === participant\)/);
    assert.doesNotMatch(administration, /for \(const agent of agents\)/);
    assert.match(administration, /slice\(0, 12\)/);
    assert.doesNotMatch(administration, /for \(const page of choices\) \{/);
  });
});
