import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  measurePull,
  PULL_REFRESH_MAX,
  PULL_REFRESH_THRESHOLD,
} from '../src/pull-to-refresh.ts';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('arrastrar hacia abajo para actualizar', () => {
  it('ignora subidas e intenciones laterales', () => {
    assert.equal(measurePull(20, 100, 20, 80), null);
    assert.equal(measurePull(20, 100, 80, 120), null);
  });

  it('ofrece resistencia, un umbral claro y un recorrido acotado', () => {
    const beginning = measurePull(20, 100, 22, 140);
    const ready = measurePull(20, 100, 22, 100 + PULL_REFRESH_THRESHOLD * 2);
    const far = measurePull(20, 100, 22, 1000);

    assert.deepEqual(beginning, { offset: 20, ready: false, turn: 300 * 20 / PULL_REFRESH_THRESHOLD });
    assert.equal(ready?.ready, true);
    assert.equal(ready?.offset, PULL_REFRESH_THRESHOLD);
    assert.equal(far?.offset, PULL_REFRESH_MAX);
    assert.equal(far?.turn, 300);
  });

  it('vive fuera del documento y sólo reclama una bajada iniciada arriba', () => {
    assert.match(html, /id="pull-refresh" role="status" hidden/);
    assert.match(main, /container: \$\('#text'\)/);
    assert.match(main, /canonicalPage\(target\)/);
    assert.match(main, /delivered: canonical/);
    assert.match(styles, /#pull-refresh\s*\{[^}]*grid-area:\s*text/s);
  });
});
