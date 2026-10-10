import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLocalSpeech, type SpeechSynthesizer } from '../src/speech.ts';

const roots: string[] = [];
const running: SpeechSynthesizer[] = [];

afterEach(async () => {
  for (const speech of running.splice(0)) speech.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('voz local', () => {
  it('mantiene un proceso y reutiliza el audio exacto desde la caché', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vera-speech-'));
    roots.push(root);
    const fake = join(root, 'fake-worker.mjs');
    const worker = join(root, 'worker.py');
    const prompt = join(root, 'voice.wav');
    const counter = join(root, 'jobs.txt');
    await writeFile(worker, 'worker');
    await writeFile(prompt, 'voice');
    await writeFile(fake, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
process.stdout.write(JSON.stringify({ ready: true }) + '\\n');
for await (const line of createInterface({ input: process.stdin })) {
  const job = JSON.parse(line);
  appendFileSync(${JSON.stringify(counter)}, job.text + '\\n');
  writeFileSync(job.output, Buffer.from('RIFF-voz-' + job.text));
  process.stdout.write(JSON.stringify({ id: job.id, ok: true }) + '\\n');
}
`);
    await chmod(fake, 0o755);

    const speech = createLocalSpeech({
      cacheRoot: join(root, 'cache'),
      python: fake,
      worker,
      source: root,
      prompt,
    });
    running.push(speech);

    const first = await speech.speak('La misma frase.');
    const second = await speech.speak('  La   misma frase.  ');

    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.deepEqual(second.bytes, first.bytes);
    assert.equal(await readFile(counter, 'utf8'), 'La misma frase.\n');
  });
});
