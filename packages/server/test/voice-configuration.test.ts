import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { VoiceConfiguration } from '../src/voice-configuration.ts';

describe('configuración de voz', () => {
  it('distingue solicitud, instalación y activación efectiva', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vera-voice-config-'));
    const path = join(root, 'voice.json');
    const voice = new VoiceConfiguration({
      path,
      diagnoseSpeechToText: async () => ({
        ready: false, engine: 'whisper.cpp', language: 'es',
        paths: { engine: null, model: null }, missing: ['whisper.cpp', 'modelo'],
      }),
      diagnoseTextToSpeech: () => ({
        ready: true, engine: 'Kokoro', voice: 'em_alex',
        paths: { model: '/models/kokoro' }, missing: [],
      }),
      transcribe: async () => ({ text: 'hola' }),
      speak: async () => ({ bytes: Buffer.from('voz'), mediaType: 'audio/wav', cached: false }),
      close: () => undefined,
    });
    try {
      const initial = await voice.view();
      assert.equal(initial.speechToText.effective, false);
      assert.equal(initial.textToSpeech.effective, true);
      const changed = await voice.update({ enabled: false });
      assert.equal(changed.textToSpeech.effective, false);
      assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
        enabled: false, speechToText: true, textToSpeech: true,
      });
      await assert.rejects(voice.speak('hola'), /habla está desactivada/);
      assert.deepEqual(await voice.transcribe(new Uint8Array([1])), {
        error: 'la escucha está desactivada en Centro de Vera → Conexiones → Voz',
      });
    } finally {
      voice.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
