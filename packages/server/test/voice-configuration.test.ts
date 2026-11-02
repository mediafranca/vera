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
    const defaultPaths = {
      ffmpeg: '', speechToTextEngine: '', speechToTextModel: '/models/whisper.bin',
      speechToTextLanguage: 'es', textToSpeechPython: '/tts/python',
      textToSpeechWorker: '/tts/worker.py', textToSpeechModelRoot: '/models/kokoro',
      textToSpeechVoice: 'em_alex', textToSpeechCacheRoot: '/cache/voice',
    };
    const voice = new VoiceConfiguration({
      path,
      defaultPaths,
      diagnoseSpeechToText: async (paths) => ({
        ready: false, engine: 'whisper.cpp', language: 'es',
        paths: { engine: null, model: paths.speechToTextModel }, missing: ['whisper.cpp'],
      }),
      diagnoseTextToSpeech: (paths) => ({
        ready: true, engine: 'Kokoro', voice: 'em_alex',
        paths: { model: paths.textToSpeechModelRoot }, missing: [],
      }),
      transcribe: async () => ({ text: 'hola' }),
      speak: async () => ({ bytes: Buffer.from('voz'), mediaType: 'audio/wav', cached: false }),
      close: () => undefined,
    });
    try {
      const initial = await voice.view();
      assert.equal(initial.speechToText.effective, false);
      assert.equal(initial.textToSpeech.effective, true);
      const changed = await voice.update({
        enabled: false,
        paths: { speechToTextModel: '/data/models/whisper.bin', textToSpeechVoice: 'ef_dora' },
      });
      assert.equal(changed.textToSpeech.effective, false);
      assert.equal(changed.paths.speechToTextModel, '/data/models/whisper.bin');
      assert.equal(changed.paths.textToSpeechVoice, 'ef_dora');
      assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
        enabled: false, speechToText: true, textToSpeech: true,
        paths: { ...defaultPaths, speechToTextModel: '/data/models/whisper.bin', textToSpeechVoice: 'ef_dora' },
      });
      await assert.rejects(voice.speak('hola'), /habla está desactivada/);
      assert.deepEqual(await voice.transcribe(new Uint8Array([1])), {
        error: 'la escucha está desactivada en Centro de Vera → Bibliotecario → Voz',
      });
    } finally {
      voice.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
