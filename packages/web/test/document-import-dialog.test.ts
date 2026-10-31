import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const dialog = readFileSync(new URL('../src/document-import-dialog.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('preparación de documentos en Biblioteca', () => {
  it('acepta varios archivos, carpetas y arrastre antes de escribir', () => {
    assert.match(dialog, /filesInput\.multiple = true/);
    assert.match(dialog, /folderInput\.setAttribute\('webkitdirectory', ''\)/);
    assert.match(dialog, /drop\.addEventListener\('drop'/);
    for (const format of ['.md', '.txt', '.docx', '.pdf', '.rtf']) assert.match(dialog, new RegExp(format.replace('.', '\\.')));
    assert.match(dialog, /api\.previewDocument\(file\)/);
    assert.match(dialog, /commit\.addEventListener\('click'/);
  });

  it('distingue documentos propios de fuentes y exige autoría a estas últimas', () => {
    assert.match(dialog, /Documentos propios/);
    assert.match(dialog, /Fuentes de otras personas/);
    assert.match(dialog, /invalidExternal/);
    assert.match(dialog, /falta autoría en fuentes externas/);
    assert.match(dialog, /author: candidate\.author\.value\.trim\(\)/);
  });

  it('declara páginas y adjuntos y hace visible el ámbito compartido', () => {
    assert.match(dialog, /página[^`]*adjunto/);
    assert.match(dialog, /quedará dentro de «\$\{options\.sharedSpace\.name\}»/);
    assert.match(dialog, /visible para sus participantes/);
    assert.match(main, /sharedSpace: corpus\?\.sharedSpace \?\? null/);
  });

  it('deja en una superficie compartida sólo la importación que la participante puede ejercer', () => {
    assert.match(settings, /shared === null[\s\S]*destination\('Archivos'/);
    assert.match(settings, /Crear páginas dentro de «\$\{shared\.name\}»/);
    assert.match(main, /corpus\?\.canEdit === true \? 'biblioteca' : 'apariencia'/);
  });
});
