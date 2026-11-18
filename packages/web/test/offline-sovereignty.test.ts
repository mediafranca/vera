import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const audio = readFileSync(new URL('../src/audio-block.ts', import.meta.url), 'utf8');

describe('soberanía del cliente instalado', () => {
  it('abre la bandeja durable antes de ofrecer escritura', () => {
    const start = main.slice(main.indexOf('async function start()'), main.indexOf('function boot('));
    assert.match(start, /const durable = await durableOrNot\(\)/);
    assert.match(start, /await outbox\.restore\(\)/);
  });

  it('hace nacer el día en una réplica vacía y lo retiene antes de abrirlo', () => {
    const day = main.slice(main.indexOf('async function startDay('), main.indexOf('// ---------------------------------------------------------------------------\n// Navegación'));
    assert.match(day, /pageId = dailyPageId\(date\)/);
    assert.match(day, /replica = empty\(pageId\)/);
    assert.match(day, /createPage\(date, 'private', pageId\)/);
    assert.ok(day.indexOf('await held.keepPage(local)') < day.indexOf('await openPage('));
  });

  it('guarda el blob con página y bloque antes de esperar al servidor', () => {
    assert.match(audio, /voice\.capture\(audio, durationMs, block, page\)/);
    assert.match(main, /await voice\.prepare\(\)/);
    assert.match(main, /await voice\.drain\(\)/);
  });
});
