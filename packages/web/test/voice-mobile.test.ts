import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const voice = readFileSync(new URL('../src/voice.ts', import.meta.url), 'utf8');
const block = readFileSync(new URL('../src/audio-block.ts', import.meta.url), 'utf8');
const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');

describe('grabación móvil', () => {
  it('instala las fronteras de cierre antes de iniciar MediaRecorder', () => {
    assert.ok(voice.indexOf("recorder.addEventListener('stop', finish)") < voice.indexOf('recorder.start(1000)'));
    assert.ok(voice.indexOf("track.addEventListener('ended', requestFinish)") < voice.indexOf('recorder.start(1000)'));
  });

  it('espera el vaciado final cuando el teléfono retira la pista', () => {
    assert.match(voice, /track\.addEventListener\('ended', requestFinish\)/);
    assert.match(voice, /setTimeout\(finish, 2_000\);[\s\S]*recorder\.stop\(\)/);
    assert.doesNotMatch(voice, /track\.addEventListener\('ended', finish\)/);
  });

  it('nunca intenta registrar un blob móvil vacío', () => {
    assert.match(block, /if \(audio\.size === 0\)[\s\S]*handlers\.onSettled\(\)/);
    assert.match(outliner, /if \(audio\.size === 0\) throw new Error/);
  });
});
