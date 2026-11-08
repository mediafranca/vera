import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { librarianActor } from '../src/librarian-language.ts';

describe('nombre efectivo del agente de biblioteca', () => {
  it('nombra a quien ocupa el oficio en cada encuentro operativo', () => {
    assert.deepEqual(librarianActor(' Lucienne '), {
      name: 'Lucienne',
      subject: 'Lucienne',
      object: 'Lucienne',
      queueOwner: 'de Lucienne',
      requestLabel: 'Solicitar a Lucienne',
      kicker: 'Lucienne · agente de biblioteca',
    });
  });

  it('conserva el nombre del oficio cuando todavía no hay identidad efectiva', () => {
    assert.deepEqual(librarianActor(null), {
      name: 'Agente de biblioteca',
      subject: 'El agente de biblioteca',
      object: 'el agente de biblioteca',
      queueOwner: 'del agente de biblioteca',
      requestLabel: 'Solicitar al agente de biblioteca',
      kicker: 'Vera · agente de biblioteca',
    });
  });
});
