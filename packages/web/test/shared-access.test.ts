import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const invitation = readFileSync(new URL('../src/shared-access.ts', import.meta.url), 'utf8');

describe('entrada por invitación', () => {
  it('lleva consigo el estilo crítico aunque falle la hoja del armazón', () => {
    assert.match(invitation, /invitation-critical-style/);
    assert.match(invitation, /#vera-root\[data-layout='invitation'\]/);
  });

  it('entra antes de ofrecer guardar el acceso con una passkey', () => {
    assert.match(invitation, /accept\.textContent = 'Entrar a Vera'/);
    assert.match(invitation, /vera-passkey-enrollment/);
    assert.match(invitation, /export function offerPasskeyEnrollment/);
  });

  it('anticipa la ventana propia del sistema y permite postergarla', () => {
    assert.match(invitation, /rostro, huella o PIN/);
    assert.match(invitation, /Apple, Google o Windows/);
    assert.match(invitation, /Vera no recibe ninguno de esos datos/);
    assert.match(invitation, /Ahora no/);
    assert.match(invitation, /necesitarás otra invitación/);
  });
});
