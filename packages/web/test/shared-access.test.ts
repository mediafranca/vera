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
    assert.match(invitation, /No tienes que crear nada antes ni buscar una opción en Chrome/);
    assert.match(invitation, /Crear y guardar mi acceso/);
    assert.match(invitation, /Chrome abrirá su propia ventana/);
    assert.match(invitation, /PIN, huella o rostro/);
    assert.match(invitation, /Vera no recibe ese dato/);
    assert.match(invitation, /Ahora no/);
    assert.match(invitation, /necesitarás otra invitación/);
  });

  it('conserva la oferta al recargar hasta completarla o rechazarla explícitamente', () => {
    const offered = invitation.slice(invitation.indexOf('export function offerPasskeyEnrollment'));
    const beforeActions = offered.slice(0, offered.indexOf("later.onclick"));
    assert.doesNotMatch(beforeActions, /removeItem\('vera-passkey-enrollment'\)/);
    assert.match(offered, /later\.onclick[\s\S]+removeItem\('vera-passkey-enrollment'\)/);
    assert.match(offered, /registration\/verify[\s\S]+removeItem\('vera-passkey-enrollment'\)/);
  });

  it('monta ambas acciones dentro del diálogo, no sólo crea sus botones', () => {
    assert.match(invitation, /actions\.append\(later, create\)/);
    const mounted = invitation.indexOf('actions.append(later, create)');
    const shown = invitation.indexOf('dialog.showModal()');
    assert.ok(mounted >= 0 && mounted < shown);
  });
});
