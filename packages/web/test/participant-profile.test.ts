import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { participantProfilePath } from '../src/activity-page.ts';
import { participantProfileTitle } from '../src/participant-profile.ts';

const source = readFileSync(new URL('../src/participant-profile.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('perfil de participante', () => {
  it('tiene una dirección estable por identidad y un nombre de sistema legible', () => {
    assert.equal(participantProfilePath('participant:herbert'), '/participantes/participant%3Aherbert');
    assert.equal(participantProfileTitle('Herbert Spencer'), 'Participante:Herbert Spencer');
  });

  it('se abre como superficie derivada y no como página editable', () => {
    assert.match(main, /\/\^\\\/participantes\\\/\(\[\^\/\]\+\)\$\//);
    assert.match(main, /api\.participantProfile\(participant\)/);
    assert.match(source, /Identidad operativa de Vera/);
    assert.match(source, /identidad participante:: \$\{view\.participant\.id\}/);
    assert.match(source, /participantActivityPath\(view\.participant\.id\)/);
  });

  it('queda fuera del mapa sin abandonar el lenguaje visual de Vera', () => {
    assert.match(main, /classList\.add\('special-surface'\)/);
    assert.match(styles, /#vera-root\.special-surface #view-switch \{ display: none; \}/);
    assert.match(styles, /\.participant-profile-header[\s\S]*?var\(--rule\)/);
    assert.match(styles, /\.participant-profile-explanation,[\s\S]*?var\(--text-dim\)/);
    assert.match(styles, /\.participant-profile a \{[\s\S]*?color: var\(--accent\)/);
    const profileRules = styles.slice(styles.indexOf('.participant-profile {'), styles.indexOf('.settings-head {'));
    assert.doesNotMatch(profileRules, /var\(--(?:line|muted)\)/);
  });

  it('distingue la autorización humana de las credenciales del agente', () => {
    assert.match(source, /Autoridad humana/);
    assert.match(source, /participantProfilePath\(person\.id\)/);
    assert.match(source, /credentials\.active/);
    assert.match(source, /credentials\.revoked/);
  });
});
