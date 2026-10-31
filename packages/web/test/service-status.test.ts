import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { serviceStatusPresentation, type ServiceCondition } from '../src/service-status.ts';

const source = readFileSync(new URL('../src/service-status.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('visor de estado de un servicio', () => {
  it('nombra todos los estados sin depender sólo del color', () => {
    const expected: Record<ServiceCondition, string> = {
      checking: 'Comprobando',
      available: 'Disponible',
      degraded: 'Disponible con problemas',
      unavailable: 'No disponible',
      unknown: 'Sin comprobar',
    };
    for (const [condition, label] of Object.entries(expected)) {
      assert.equal(serviceStatusPresentation(condition as ServiceCondition).label, label);
    }
  });

  it('ofrece señal compacta y ficha completa sin decidir su ubicación', () => {
    assert.match(source, /createServiceStatusIndicator/);
    assert.match(source, /createServiceStatusViewer/);
    assert.doesNotMatch(source, /renderSettings|drawConnections|drawSystem/);
  });

  it('reserva el check verde al estado disponible y conserva texto accesible', () => {
    assert.match(styles, /service-status-indicator\[data-state='available'\][\s\S]*--service-status-colour:\s*#2f7d4f/);
    assert.match(source, /role', 'status'/);
    assert.match(source, /aria-label', `\$\{status\.service\}: \$\{presentation\.label\}`/);
  });

  it('no sondea ninguna dirección ni filtra logs o credenciales', () => {
    assert.doesNotMatch(source, /fetch\(|https?:\/\//);
    assert.doesNotMatch(source, /(?:token|credential|authorization)\s*[:=]/i);
    assert.doesNotMatch(source, /console\.(?:log|error|warn)/);
  });
});
