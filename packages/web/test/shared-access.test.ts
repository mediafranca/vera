import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const invitation = readFileSync(new URL('../src/shared-access.ts', import.meta.url), 'utf8');

describe('entrada por invitación', () => {
  it('lleva consigo el estilo crítico aunque falle la hoja del armazón', () => {
    assert.match(invitation, /invitation-critical-style/);
    assert.match(invitation, /#vera-root\[data-layout='invitation'\]/);
    assert.match(invitation, /danger: value\('--danger'\)/);
    assert.match(invitation, /shared-notice\[data-bad='true'\].*p\.danger/s);
  });

  it('entra antes de ofrecer guardar el acceso con una passkey', () => {
    assert.match(invitation, /accept\.textContent = 'Entrar a Vera'/);
    assert.match(invitation, /vera-passkey-enrollment/);
    assert.match(invitation, /export function offerPasskeyEnrollment/);
  });

  it('anticipa la ventana propia del sistema sin enseñar la infraestructura', () => {
    assert.match(invitation, /no tienes que guardar ni recordar nada/i);
    assert.match(invitation, /Guardar mi acceso aquí/);
    assert.match(invitation, /dispositivo abrirá su propia ventana/);
    assert.match(invitation, /PIN, huella o rostro/);
    assert.match(invitation, /Vera no recibe ese dato/);
    assert.match(invitation, /Ahora no/);
    assert.match(invitation, /necesitarás otra invitación/);
  });

  it('añade otro dispositivo a la identidad que ya existe', () => {
    assert.match(invitation, /enroll-device/);
    assert.match(invitation, /Estás añadiendo este dispositivo a la identidad de/);
    assert.match(invitation, /registration\/verify/);
    assert.match(invitation, /history\.replaceState/);
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

  it('un enlace identificado exige la passkey nombrada antes del canje', () => {
    assert.match(invitation, /authenticateNamedParticipant/);
    assert.match(invitation, /preview\.proofMode === 'identified'/);
    assert.match(invitation, /Abrir con mi passkey/);
    assert.match(invitation, /reenviar esta URL no concede acceso/i);
  });
});
