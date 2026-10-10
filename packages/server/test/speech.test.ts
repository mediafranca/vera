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
    const counter = join(root, 'jobs.txt');
    await writeFile(worker, 'worker');
    await writeFile(fake, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
process.stdout.write(JSON.stringify({ ready: true }) + '\\n');
for await (const line of createInterface({ input: process.stdin })) {
  const job = JSON.parse(line);
  appendFileSync(${JSON.stringify(counter)}, job.text + '\\n');
  await new Promise((resolve) => setTimeout(resolve, 60));
  writeFileSync(job.output, Buffer.from('RIFF-voz-' + job.text));
  process.stdout.write(JSON.stringify({ id: job.id, ok: true }) + '\\n');
}
`);
    await chmod(fake, 0o755);

    const speech = createLocalSpeech({
      cacheRoot: join(root, 'cache'),
      python: fake,
      worker,
      modelRoot: root,
    });
    running.push(speech);

    const first = await speech.speak('La misma frase.');
    const second = await speech.speak('  La   misma frase.  ');

    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.deepEqual(second.bytes, first.bytes);
    assert.equal(await readFile(counter, 'utf8'), 'La misma frase.\n');
    const stopped = new AbortController();
    stopped.abort();
    await assert.rejects(speech.speak('La misma frase.', stopped.signal), { name: 'AbortError' });
  });

  it('no acumula una cola de clics cancelados y conserva sólo el último', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vera-speech-queue-'));
    roots.push(root);
    const fake = join(root, 'fake-worker.mjs');
    const worker = join(root, 'worker.py');
    const counter = join(root, 'jobs.txt');
    await writeFile(worker, 'worker');
    await writeFile(fake, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
process.stdout.write(JSON.stringify({ ready: true }) + '\\n');
for await (const line of createInterface({ input: process.stdin })) {
  const job = JSON.parse(line);
  appendFileSync(${JSON.stringify(counter)}, job.text + '\\n');
  await new Promise((resolve) => setTimeout(resolve, 90));
  writeFileSync(job.output, Buffer.from('RIFF-voz-' + job.text));
  process.stdout.write(JSON.stringify({ id: job.id, ok: true }) + '\\n');
}
`);
    await chmod(fake, 0o755);
    const speech = createLocalSpeech({
      cacheRoot: join(root, 'cache'), python: fake, worker, modelRoot: root,
    });
    running.push(speech);

    const firstController = new AbortController();
    const first = speech.speak('primera', firstController.signal);
    const firstRejected = assert.rejects(first, { name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    firstController.abort();
    const middle = speech.speak('intermedia');
    const middleRejected = assert.rejects(middle, { name: 'AbortError' });
    const last = speech.speak('última');

    await firstRejected;
    await middleRejected;
    assert.equal((await last).cached, false);
    const jobs = (await readFile(counter, 'utf8')).trim().split('\n');
    assert.equal(jobs.includes('intermedia'), false);
    assert.equal(jobs.at(-1), 'última');
    assert.ok(jobs.length <= 2);
  });
});
