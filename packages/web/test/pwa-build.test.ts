import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import config from '../vite.config.ts';

const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

describe('actualizaciones de la PWA', () => {
  it('conserva los assets con huella que todavía puede pedir un armazón anterior', () => {
    assert.equal(typeof config, 'object');
    if (typeof config !== 'object') return;
    assert.equal(config.build?.emptyOutDir, false);
  });

  it('sólo precarga rutas que el servidor entrega y renueva el caché roto', () => {
    const assets = worker.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1] ?? '';
    assert.doesNotMatch(assets, /['"]\/index\.html['"]/);
    assert.match(assets, /['"]\/map-frame\.html['"]/);
    assert.match(worker, /const SHELL = ['"]vera-shell-v11['"]/);
    assert.match(worker, /url\.pathname === ['"]\/map-frame\.html['"] \? ['"]\/map-frame\.html['"] : ['"]\/index\.html['"]/);
  });
});
