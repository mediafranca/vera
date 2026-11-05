import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const manifest = JSON.parse(
  readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'),
) as { background_color: string; theme_color: string };

describe('color de arranque de la PWA', () => {
  it('usa un gris neutro mientras todavía no conoce el diseño local', () => {
    assert.match(index, /name="theme-color" content="#202224"/);
    assert.equal(manifest.background_color, '#202224');
    assert.equal(manifest.theme_color, '#202224');
  });

  it('no confunde el respaldo instalable con el morado del tema Vera', () => {
    assert.doesNotMatch(index, /#2e0024/);
    assert.notEqual(manifest.theme_color, '#2e0024');
  });
});
