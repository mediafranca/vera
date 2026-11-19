import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { executableNames, transcribeAudio } from '../src/transcribe.ts';

describe('transcripción completa', () => {
  // @guarantee TheWholeRecordingIsTranscribed
  it('lee el texto completo que whisper escribe, no un stdout truncado', async () => {
    const work = await mkdtemp(join(tmpdir(), 'vera-transcribe-test-'));
    const ffmpeg = join(work, 'ffmpeg');
    const whisper = join(work, 'whisper-cli');
    const model = join(work, 'model.bin');

    await writeFile(
      ffmpeg,
      '#!/bin/sh\nout=""\nfor arg in "$@"; do out="$arg"; done\nprintf audio > "$out"\n',
    );
    await writeFile(
      whisper,
      '#!/bin/sh\nif [ "$1" = "--help" ]; then echo "whisper.cpp -otxt [-m model]"; exit 0; fi\nout=""\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "-of" ]; then shift; out="$1"; fi\n  shift\ndone\nprintf "primera parte\\nsegunda parte\\n" > "${out}.txt"\nprintf "primera parte\\n"\n',
    );
    await writeFile(model, 'modelo');
    await chmod(ffmpeg, 0o755);
    await chmod(whisper, 0o755);

    try {
      const result = await transcribeAudio(new Uint8Array([1, 2, 3]), {
        ffmpeg,
        command: whisper,
        model,
      });
      assert.deepEqual(result, { text: 'primera parte segunda parte' });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('usa la interfaz de OpenAI Whisper cuando es la instalación encontrada', async () => {
    const work = await mkdtemp(join(tmpdir(), 'vera-openai-whisper-test-'));
    const ffmpeg = join(work, 'ffmpeg');
    const whisper = join(work, 'whisper');
    await writeFile(ffmpeg, '#!/bin/sh\nout=""\nfor arg in "$@"; do out="$arg"; done\nprintf audio > "$out"\n');
    await writeFile(whisper, '#!/bin/sh\nif [ "$1" = "--help" ]; then echo "--output_dir --output_format"; exit 0; fi\nout=""\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--output_dir" ]; then shift; out="$1"; fi\n  shift\ndone\nprintf "texto desde Python" > "$out/audio.txt"\n');
    await chmod(ffmpeg, 0o755); await chmod(whisper, 0o755);
    try {
      const result = await transcribeAudio(new Uint8Array([1]), { ffmpeg, command: whisper, model: 'small' });
      assert.deepEqual(result, { text: 'texto desde Python' });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('resuelve los nombres ejecutables que Windows añade mediante PATHEXT', () => {
    assert.deepEqual(executableNames(['whisper-cli'], 'win32', '.EXE;.CMD'), [
      'whisper-cli', 'whisper-cli.exe', 'whisper-cli.cmd',
    ]);
  });

  it('conserva la invocación por módulo cuando pip no creó whisper.exe', () => {
    const source = readFileSync(new URL('../src/transcribe.ts', import.meta.url), 'utf8');
    assert.match(source, /helpFor\(command, \['-m', 'whisper'\]\)/);
    assert.match(source, /prefix: \['-m', 'whisper'\]/);
  });
});
