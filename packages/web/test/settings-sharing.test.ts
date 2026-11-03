import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
const publicationPage = readFileSync(new URL('../src/publication-page.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

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

  it('crea desde la página un enlace privado dirigido a una identidad con passkey', () => {
    assert.match(settings, /Enviar enlace privado/);
    assert.match(settings, /private-invitations/);
    assert.match(settings, /persona elegida debe confirmar su propia passkey/);
    assert.match(settings, /Reenviar el enlace no concede acceso/);
  });
});

describe('destinos de una página', () => {
  it('reemplaza el interruptor binario por fichas y un signo más', () => {
    assert.match(outliner, /destinationsKey\.textContent = 'compartida en'/);
    assert.match(outliner, /add\.textContent = '\+'/);
    assert.match(outliner, /drawPageDestinationBadges\(badges, page\.id\)/);
    assert.doesNotMatch(outliner, /badge\.className = `visibility/);
    assert.match(styles, /\.page-destination-add::before,[\s\S]*top: 50%;[\s\S]*left: 50%/);
  });

  it('abre los destinos en un modal compacto sin desplazar la página', () => {
    assert.match(publicationPage, /document\.createElement\('dialog'\)/);
    assert.match(publicationPage, /dialog\.showModal\(\)/);
    assert.doesNotMatch(outliner, /renderPageSharing\(page\.id, page\.title[^;]*\.then/);
    assert.match(styles, /\.page-sharing \{[\s\S]*width: min\(32rem,[\s\S]*max-height:/);
  });

  it('ofrece varios espacios y reserva la ruta para el destino público', () => {
    assert.match(settings, /for \(const space of spaces\)/);
    assert.match(settings, /path\.placeholder = 'ruta-pública'/);
    assert.match(settings, /publish\.disabled = !site\.publicReady/);
  });

  it('crea capacidades privadas, muestra el secreto una vez y permite revocarlas', () => {
    assert.match(settings, /El secreto se muestra una sola vez/);
    assert.match(settings, /`\/pages\/\$\{encodeURIComponent\(page\)\}\/shares`/);
    assert.match(settings, /`\/page-shares\/\$\{encodeURIComponent\(share\.id\)\}`/);
    assert.doesNotMatch(settings, /vera-page-share-url/);
  });
});
