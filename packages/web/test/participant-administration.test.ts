import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const surface = readFileSync(new URL('../src/participant-administration.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('gobierno de participantes', () => {
  it('tiene una superficie de sistema y una dirección propia', () => {
    assert.match(main, /pathname === '\/participantes'/);
    assert.match(main, /renderParticipantAdministration/);
    assert.match(surface, /Padrón de identidades humanas y agentes/);
  });

  it('distingue fusionar, suspender y eliminar una identidad vacía', () => {
    assert.match(surface, /Fusionar…/);
    assert.match(surface, /Suspender accesos/);
    assert.match(surface, /Eliminar identidad vacía/);
    assert.match(surface, /esta eliminación es definitiva/i);
    assert.match(surface, /canErase/);
  });

  it('expone resumen, roles, perfiles y causas que impiden borrar', () => {
    assert.match(surface, /one\.roles/);
    assert.match(surface, /participantProfilePath/);
    assert.match(surface, /operaciones ·/);
    assert.match(surface, /retainedBy/);
  });
});
