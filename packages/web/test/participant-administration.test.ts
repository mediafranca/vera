import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const surface = readFileSync(new URL('../src/participant-administration.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('gobierno de participantes', () => {
  it('tiene una superficie de sistema y una dirección propia', () => {
    assert.match(main, /pathname === '\/participantes'/);
    assert.match(main, /renderParticipantAdministration/);
    assert.match(surface, /Las personas gobiernan su presencia y su trabajo/);
    assert.match(surface, /\['human', 'Personas'\], \['agent', 'Agentes'\]/);
    assert.match(surface, /Principal humano ·/);
  });

  it('distingue fusionar, suspender y eliminar una identidad vacía', () => {
    assert.match(surface, /Fusionar…/);
    assert.match(surface, /Suspender accesos/);
    assert.match(surface, /Eliminar identidad vacía/);
    assert.match(surface, /Eliminar definitivamente/);
    assert.match(surface, /canErase/);
  });

  it('expone resumen, roles, perfiles y causas que impiden borrar', () => {
    assert.match(surface, /one\.roles/);
    assert.match(surface, /participantProfilePath/);
    assert.match(surface, /said\(one\.activity, 'operación', 'operaciones'\)/);
    assert.match(surface, /retainedBy/);
  });

  it('proyecta cada gesto localmente y concilia en segundo plano sin reconstruir la página', () => {
    assert.match(surface, /apply\(\); redraw\(focusParticipant, focusAction\);[\s\S]*void request\(\)\.then/);
    assert.match(surface, /focus\(\{ preventScroll: true \}\)/);
    assert.match(surface, /window\.scrollTo\(\{ top: scroll \}\)/);
    assert.doesNotMatch(surface, /await renderParticipantAdministration\(host\)/);
  });

  it('explica la continuidad humana y reserva el QR para la sesión de esa persona', () => {
    assert.match(surface, /su sesión puede abrir el QR para añadir otro dispositivo/);
    assert.match(surface, /el QR aparece dentro de su propia sesión humana/);
  });
});
