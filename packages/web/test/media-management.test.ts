import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const dialog = readFileSync(new URL('../src/media-dialog.ts', import.meta.url), 'utf8');
const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');

describe('gestión de archivos desde su incrustación y su catálogo', () => {
  it('abre la misma ficha al pulsar un archivo incrustado', () => {
    assert.match(outliner, /wireCataloguedMedia[\s\S]*?openMediaDetails\(asset\)/);
  });

  it('no secuestra los controles nativos de audio y video', () => {
    assert.match(outliner, /element instanceof HTMLAudioElement \|\| element instanceof HTMLVideoElement/);
    assert.match(outliner, /addEventListener\(playable \? 'dblclick' : 'click'/);
  });

  it('ofrece renombrar, reemplazar y eliminar desde la ficha', () => {
    assert.match(dialog, /Nombre del archivo/);
    assert.match(dialog, /api\.renameMedia\(hash, name\.value\)/);
    assert.match(dialog, /replace\.textContent = 'Reemplazar'/);
    assert.match(dialog, /api\.replaceMedia\(hash, file\)/);
    assert.match(dialog, /remove\.textContent = 'Eliminar'/);
    assert.match(dialog, /api\.deleteMedia\(hash\)/);
    assert.match(dialog, /También desaparecerá de/);
  });

  it('permite eliminar archivos usados desde el catálogo y declara el alcance', () => {
    assert.doesNotMatch(settings, /remove\.disabled = file\.usages\.length > 0/);
    assert.match(settings, /También desaparecerá de/);
    assert.match(settings, /Vera mantiene juntas sus referencias en las páginas/);
  });

  it('administra los documentos originales sin llamarlos PDF', () => {
    assert.match(settings, /file\.mediaType === 'application\/pdf' \? 'Previsualizar PDF' : 'Abrir archivo'/);
    assert.match(dialog, /asset\.mediaType\.split\(';'\)\[0\]/);
  });
});
