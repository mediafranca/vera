import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { serviceStatusPresentation, type ServiceCondition } from '../src/service-status.ts';

const source = readFileSync(new URL('../src/service-status.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');

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

  it('sitúa MCP y Conecta en la cabecera y deja el detalle detrás de cada señal', () => {
    const title = settings.indexOf("title.textContent = 'Centro de Vera'");
    const status = settings.indexOf('head.append(serviceStatusBar())');
    const close = settings.indexOf("close.className = 'settings-close'");
    assert.ok(title >= 0 && status > title && close > status);
    assert.match(settings, /\['mcp', 'conecta'\] as const/);
    assert.match(settings, /createServiceStatusViewer/);
    assert.match(styles, /\.settings-service > \.service-status-viewer/);
  });
});
