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
    assert.match(settings, /label: 'Agente de biblioteca'/);
  });

  it('compone una constitución desde páginas canónicas y no desde texto paralelo', () => {
    assert.match(administration, /api\.pages\(\)/);
    assert.match(administration, /setAgentConstitution/);
    assert.match(administration, /Páginas constitutivas/);
    assert.match(administration, /Páginas canónicas y editables que constituyen/);
    assert.match(administration, /className = 'agent-source-title'/);
    assert.doesNotMatch(administration, /Abrir y editar/);
    assert.doesNotMatch(administration, /page\.visibility === 'private'/);
  });

  it('hace visibles revisión activa, rollback y separación del runtime', () => {
    assert.match(administration, /Construir borrador/);
    assert.match(administration, /Volver a esta versión/);
    assert.match(administration, /el modelo y el runtime pueden cambiar/);
    assert.match(administration, /Ejecuciones observadas · sólo lectura/);
    assert.match(administration, /Sin recibo del runtime/);
    assert.match(administration, /divergente/);
    assert.match(administration, /Vera no confunde activación con ejecución/);
    assert.match(administration, /compilación versionada e inmutable/);
    assert.match(administration, /manifest\.sources/);
  });

  it('expone el catálogo del harness y gobierna territorios sin prometer autoridad nueva', () => {
    assert.match(administration, /Catálogo del harness · sólo lectura/);
    assert.match(administration, /una nueva revisión del harness/);
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
    assert.match(administration, /view\.librarian\.name.*pide primero una tentativa/);
  });

  it('elige runtime y proveedor sin fallback implícito', () => {
    assert.match(administration, /OpenClaw · harness Codex/);
    assert.match(administration, /Vera · modelo embebido/);
    assert.match(administration, /adapter: adapter\.value === 'external_agent'/);
    assert.match(administration, /Agente de OpenClaw/);
    assert.match(administration, /Proveedor y modelo/);
    assert.match(administration, /openai:gpt-5\.6-sol/);
    assert.match(administration, /No existe fallback implícito/);
  });

  it('permite cambiar el nombre efectivo sin convertir una página en configuración', () => {
    assert.match(administration, /participantName\.value = view\.librarian\.name/);
    assert.match(administration, /api\.renameParticipant\(view\.librarian!\.agent/);
    assert.match(administration, /Lucienne es sólo el nombre inicial/);
    assert.match(administration, /conserva el oficio, la constitución, el harness, el territorio y la historia/);
    assert.match(administration, /className = 'agent-name-input'/);
    assert.match(administration, /announceLibrarianIdentity\(\{ agent: renamed\.participant\.id, name: renamed\.participant\.name \}\)/);
    assert.match(main, /addEventListener\('vera:librarian-identity'/);
    assert.match(main, /useCorpus\(\{ \.\.\.corpus, librarian: \{ id: detail\.id, name: detail\.name \} \}\)/);
  });

  it('separa el cambio de nombre de la designación de otro agente', () => {
    assert.match(administration, /Designación/);
    assert.match(administration, /api\.designateLibrarianRuntime\(candidate\.agent\)/);
    assert.match(administration, /No transfiere conversaciones, manifiestos, autoría, credenciales ni territorio/);
    assert.match(administration, /Ocupantes anteriores/);
    assert.match(administration, /run\.agent\.name/);
    assert.match(administration, /confirm\(`/);
    assert.match(styles, /\.agent-runtime-identity-form select/);
  });

  it('mantiene blancos táctiles y una composición legible en móvil', () => {
    assert.match(styles, /\.agent-administration :is\(button, select, input\)[\s\S]*?min-height: 2\.75rem/);
    assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.agent-source-row/);
    assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.agent-runtime-list li/);
  });

  it('explica la superficie sin mapa y muestra carga visible y accesible', () => {
    assert.match(administration, /no es una página del corpus ni tiene un nodo focal/);
    assert.match(administration, /className = 'agent-administration-loading'/);
    assert.match(administration, /setAttribute\('role', 'status'\)/);
    assert.match(administration, /setAttribute\('aria-live', 'polite'\)/);
    assert.match(styles, /\.agent-administration-loading::before/);
    assert.match(styles, /@keyframes agent-administration-spin/);
  });

  it('nombra los dos caminos de ejecución como evidencia de sólo lectura', () => {
    assert.match(administration, /Ejecuciones observadas · sólo lectura/);
    assert.match(administration, /dos caminos de ejecución de/);
    assert.match(administration, /Cotito no es un runtime de \$\{agent\.agent\.name\}/);
  });

  it('resuelve una sola identidad y no convierte el oficio en directorio de agentes', () => {
    assert.match(administration, /requested \?\? runtime\.librarian\?\.agent/);
    assert.match(administration, /agents\.find\(\(one\) => one\.agent\.id === participant\)/);
    assert.doesNotMatch(administration, /for \(const agent of agents\)/);
    assert.match(administration, /slice\(0, 12\)/);
    assert.doesNotMatch(administration, /for \(const page of choices\) \{/);
  });
});
