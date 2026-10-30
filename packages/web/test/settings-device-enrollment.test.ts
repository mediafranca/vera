import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('continuidad de la identidad entre dispositivos', () => {
  it('saluda a la persona y ofrece el QR como control accesible', () => {
    assert.match(settings, /title\.textContent = `Hola, \$\{familiar\}`/);
    assert.match(settings, /aria-label', 'Abrir Vera en otro dispositivo'/);
    assert.match(settings, /icon\('qrcode'\)/);
  });

  it('crea la matrícula sólo al abrir el modal y ofrece QR y enlace', () => {
    const modal = settings.slice(settings.indexOf('async function openDeviceEnrollment'));
    assert.match(modal, /human-auth\/device-enrollments/);
    assert.match(modal, /toDataURL/);
    assert.match(modal, /Copiar enlace/);
    assert.match(modal, /código vence/);
    assert.match(styles, /\.device-enrollment-dialog/);
  });
});
