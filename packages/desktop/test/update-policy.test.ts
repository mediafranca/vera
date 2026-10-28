import assert from 'node:assert/strict';
import test from 'node:test';
import { supportsAutomaticUpdates, UPDATE_CHECK_INTERVAL_MS } from '../src/update-policy.ts';

test('la instalación normal de Windows y macOS admite actualización', () => {
  assert.equal(supportsAutomaticUpdates({ isPackaged: true, platform: 'win32' }), true);
  assert.equal(supportsAutomaticUpdates({ isPackaged: true, platform: 'darwin' }), true);
});

test('desarrollo, portable y plataformas aún no distribuidas no se actualizan solas', () => {
  assert.equal(supportsAutomaticUpdates({ isPackaged: false, platform: 'win32' }), false);
  assert.equal(supportsAutomaticUpdates({ isPackaged: true, platform: 'win32', portableRoot: 'D:\\Vera' }), false);
  assert.equal(supportsAutomaticUpdates({ isPackaged: true, platform: 'linux' }), false);
});

test('la edición legacy no se reemplaza por una release incompatible', () => {
  assert.equal(supportsAutomaticUpdates({
    isPackaged: true,
    platform: 'darwin',
    releaseChannel: 'legacy',
  }), false);
});

test('la comprobación periódica no martilla el proveedor', () => {
  assert.equal(UPDATE_CHECK_INTERVAL_MS, 21_600_000);
});
