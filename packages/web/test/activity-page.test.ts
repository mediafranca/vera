import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupActivityDays } from '../src/activity-days.ts';

const activity = readFileSync(new URL('../src/activity-page.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('VERA: Registro de Actividad', () => {
  it('agrupa los cambios por día y cuenta las páginas creadas', () => {
    const noon = new Date(2026, 8, 21, 12).getTime();
    const yesterday = new Date(2026, 8, 20, 18).getTime();
    const days = groupActivityDays([
      { at: noon, kind: 'create_page' },
      { at: noon - 1_000, kind: 'create_block' },
      { at: yesterday, kind: 'create_page' },
    ]);
    assert.equal(days.length, 2);
    assert.deepEqual(days.map((day) => [day.createdPages, day.items.length]), [[1, 2], [1, 1]]);
  });

  it('separa cambios y eliminaciones en pestañas accesibles', () => {
    assert.match(activity, /setAttribute\('role', 'tablist'\)/);
    assert.match(activity, /textContent = 'Creaciones y ediciones'/);
    assert.match(activity, /textContent = `Eliminaciones \(\$\{view\.deletedPages\.length\}\)`/);
    assert.match(activity, /setAttribute\('role', 'tabpanel'\)/);
  });

  it('enlaza las páginas vivas y presenta el extracto recibido del registro', () => {
    assert.match(activity, /encodeURIComponent\(page\.id\)/);
    assert.match(activity, /block === null \? '' : `#\$\{encodeURIComponent\(block\)\}`/);
    assert.match(activity, /excerpt\.className = 'activity-excerpt'/);
    assert.match(activity, /excerpt\.textContent = one\.excerpt/);
  });

  it('da a cada participante una dirección durable y filtra toda la paginación', () => {
    assert.match(activity, /participantActivityPath\(participant: string\)/);
    assert.match(activity, /searchParams\.get\('participant'\)/);
    assert.match(activity, /api\.activity\(undefined, participant\)/);
    assert.match(activity, /api\.activity\(cursor, participant\)/);
    assert.match(activity, /Contribuciones de \$\{view\.participant\.name\}/);
    assert.match(activity, /participantActivityPath\(one\.participant\)/);
    assert.match(activity, /one\.participantKind === 'agent' \? 'agente '/);
    assert.match(activity, /action\.append\(author, ' '\)/);
    assert.doesNotMatch(activity, /detail\.append\(`\$\{moment\(one\.at\)\}/);
  });

  it('presenta fechas plegables y cuenta sus páginas nuevas', () => {
    assert.match(activity, /details\.className = 'activity-day'/);
    assert.match(activity, /details\.open = first/);
    assert.match(activity, /groupActivityDays\(items\)/);
    assert.match(activity, /página creada/);
    assert.match(styles, /\.activity-day > summary::before/);
    assert.match(styles, /\.activity-day\[open\] > summary::before/);
  });

  it('reserva la restauración para las tumbas sin fabricarles enlace', () => {
    const deletedRow = activity.match(/function deletedRow[\s\S]*?return row;\n}/)?.[0] ?? '';
    assert.match(activity, /deletedRow\(one, restore, refresh\)/);
    assert.match(deletedRow, /button\.textContent = 'restaurar'/);
    assert.doesNotMatch(deletedRow, /link\.href/);
  });
});
