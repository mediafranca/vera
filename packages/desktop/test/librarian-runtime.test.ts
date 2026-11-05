import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('custodia Desktop del secreto de Lucienne', () => {
  it('cifra el valor y sólo expone estado y reemplazo al cliente', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../src/preload.ts', import.meta.url), 'utf8');
    assert.match(main, /safeStorage\.encryptString\(JSON\.stringify\(state\)\)/);
    assert.match(main, /VERA_LIBRARIAN_API_KEY/);
    assert.match(preload, /veraLibrarianSecret/);
    assert.doesNotMatch(preload, /readLibrarianSecret|apiKey:\s*\(\)/);
  });

  it('puede recibir la clave durante la constitución sin entregarla al corpus', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    assert.match(main, /writeLibrarianSecret\(\{ apiKey, endpoint, model \}\)/);
    assert.match(main, /installation: \{ inference, voice, inferenceEndpoint, inferenceModel \}/);
    assert.doesNotMatch(main, /installation:\s*\{[^}]*apiKey/);
  });

  it('entrega al servidor Desktop una configuración de voz persistente y diagnosticable', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    assert.match(main, /voiceConfiguration: desktopVoiceConfiguration\(\)/);
    assert.match(main, /path: voiceConfigurationPath/);
    assert.match(main, /diagnoseSpeechToText/);
    assert.match(main, /diagnoseTextToSpeech/);
    assert.match(main, /process\.platform === 'win32'\) voice = 'unavailable'/);
  });

  it('abre una biblioteca nueva en su recibo inaugural', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    assert.match(main, /startVera\('\/p\/page:starter-installation-day'\)/);
  });
});
