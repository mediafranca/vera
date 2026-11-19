import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { openStore, saveParticipant } from '@vera/store';
import { createLibrarianConversation, librarianConversations } from '../src/librarian.ts';

describe('identidad efectiva de las conversaciones bibliotecarias', () => {
  it('repara sólo el título de fábrica heredado y conserva títulos elegidos', () => {
    const store = openStore({ path: ':memory:', graphName: 'mind' });
    const human = 'participant:paul';
    const agent = 'participant:apolonia';
    saveParticipant(store, { id: human, name: 'Paul', kind: 'human' });
    saveParticipant(store, { id: agent, name: 'Apolonia', kind: 'agent' });
    try {
      const legacy = createLibrarianConversation(store, {
        human, agent, title: 'Herbert y el bibliotecario', now: 1,
      });
      assert.equal(librarianConversations(store, human, agent)[0]?.title, 'Paul y Apolonia');
      const persisted = store.db.prepare('SELECT title FROM agent_conversations WHERE id=?')
        .get(legacy.id) as { title: string };
      assert.equal(persisted.title, 'Paul y Apolonia');

      createLibrarianConversation(store, { human, agent, title: 'Artículo sobre accesibilidad', now: 2 });
      assert.equal(librarianConversations(store, human, agent)[0]?.title, 'Artículo sobre accesibilidad');
    } finally {
      store.close();
    }
  });
});
