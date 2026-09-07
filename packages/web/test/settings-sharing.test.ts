import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');

describe('administración de invitaciones', () => {
  it('abre los espacios en el origen público y conserva el slug', () => {
    assert.match(settings,
      /new URL\(`\/s\/\$\{encodeURIComponent\(space\.slug\)\}`,[\s\S]*publicOrigin\)\.toString\(\)/);
    assert.match(settings,
      /spaceAdministration\(host, space, pages, publicSite\.canonicalDomain\)/);
  });

  it('permite eliminar definitivamente invitaciones de cualquier estado con confirmación', () => {
    assert.match(settings, /remove\.textContent = 'Eliminar'/);
    assert.match(settings, /¿Eliminar definitivamente esta invitación\?/);
    assert.match(settings, /también se revocará el acceso/);
    assert.match(settings, /invitations\/\$\{encodeURIComponent\(invitation\.id\)\}\/permanent/);
  });

  it('no deja que un enlace anterior se confunda con el recién creado', () => {
    assert.match(settings, /Invitación nueva · \$\{String\(made\.id\)\}/);
    assert.match(settings, /result\.replaceChildren\(issued\)/);
    assert.match(settings, /No se pudo copiar; el enlace quedó seleccionado/);
  });

  it('conserva visibles los enlaces pendientes y no colapsa al eliminar', () => {
    assert.match(settings, /localStorage\.setItem\(invitationUrlKey\(id\), url\)/);
    assert.match(settings, /rememberedInvitationUrl\(invitation\.id\)/);
    assert.match(settings, /row\.remove\(\)/);
  });

  it('permite retirar una superficie sin borrar sus páginas', () => {
    assert.match(settings, /Eliminar superficie compartida/);
    assert.match(settings, /No elimina ninguna página de VERA/);
    assert.match(settings, /sharingRequest\(`\/shared-spaces\/\$\{encodeURIComponent\(space\.slug\)\}`, 'DELETE'\)/);
  });

  it('oculta por defecto los accesos revocados pero conserva su historial', () => {
    assert.match(settings, /space\.participants\.filter\(\(person\) => person\.status === 'active'\)/);
    assert.match(settings, /space\.participants\.filter\(\(one\) => one\.status === 'active'\)/);
    assert.match(settings, /Accesos revocados · \$\{revoked\.length\}/);
    assert.match(settings, /sharing-revoked-history/);
  });
});
