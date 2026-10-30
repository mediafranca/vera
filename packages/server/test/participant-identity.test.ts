import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listen } from '../src/server.ts';
import {
  canonicalParticipant,
  reconcileParticipants,
} from '../src/participant-identities.ts';

const PORT = 4321;
const OWNER = 'participant:herbert';
let running: ReturnType<typeof listen>;
let base: string;

before(() => {
  running = listen({
    port: PORT,
    databasePath: ':memory:',
    owner: { id: OWNER, name: 'Herbert' },
    webRoot: new URL('../../web/dist', import.meta.url).pathname,
  });
  base = `http://localhost:${PORT}`;
});
after(async () => running.close());

async function call(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json() as Record<string, any> };
}

describe('identidad estable de participantes', () => {
  it('declara la persona antes del acceso y el canje no crea otra identidad', async () => {
    const declared = await call('/participants', 'POST', { name: 'Arturo Chicano', kind: 'human' });
    assert.equal(declared.status, 201, JSON.stringify(declared.json));
    const participant = declared.json['participant'].id as string;

    const made = await call('/shared-spaces', 'POST', {
      name: 'Postgrado', slug: 'postgrado', selectorKey: 'espacio', selectorValue: 'postgrado',
    });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const before = Number((running.vera.store.db.prepare('SELECT count(*) AS n FROM participants')
      .get() as { n: number }).n);
    const invitation = await call('/shared-spaces/postgrado/invitations', 'POST', {
      participant,
      permissions: ['read'],
    });
    assert.equal(invitation.status, 201, JSON.stringify(invitation.json));
    const redeemed = await call(`/invitations/${encodeURIComponent(invitation.json['id'])}/redeem`,
      'POST', { secret: invitation.json['secret'] });
    assert.equal(redeemed.status, 201, JSON.stringify(redeemed.json));
    assert.equal(redeemed.json['participant'], participant);
    assert.equal(Number((running.vera.store.db.prepare('SELECT count(*) AS n FROM participants')
      .get() as { n: number }).n), before);
  });

  it('rechaza una invitación sin identidad destinataria', async () => {
    const invitation = await call('/shared-spaces/postgrado/invitations', 'POST', {
      permissions: ['read'],
      intendedContact: 'otro-arturo@example.net',
    });
    assert.equal(invitation.status, 400);
    assert.match(String(invitation.json['error']), /persona activa ya declarada/);
  });

  it('reconcilia un duplicado sin borrar su credencial ni su historia', async () => {
    const canonical = await call('/participants', 'POST', { name: 'Arturo Chicano', kind: 'human' });
    const duplicate = await call('/participants', 'POST', { name: 'Arturo Chicano Jiménez', kind: 'human' });
    const canonicalId = canonical.json['participant'].id as string;
    const duplicateId = duplicate.json['participant'].id as string;
    running.vera.store.db.prepare(`INSERT INTO human_authenticators
      (credential_id,participant_id,public_key,counter,transports,device_type,backed_up,registered_at,status)
      VALUES (?,?,X'01',0,'internal','singleDevice',0,?,'active')`)
      .run('credential:historical-arturo', duplicateId, Date.now());

    reconcileParticipants(running.vera.store, OWNER, duplicateId, canonicalId,
      'Dos accesos creados para la misma persona');

    assert.equal(canonicalParticipant(running.vera.store, duplicateId), canonicalId);
    const credential = running.vera.store.db.prepare(`SELECT participant_id,status FROM human_authenticators
      WHERE credential_id='credential:historical-arturo'`).get() as { participant_id: string; status: string };
    assert.equal(credential.participant_id, duplicateId);
    assert.equal(credential.status, 'active');
    assert.equal((running.vera.store.db.prepare('SELECT status FROM participants WHERE id=?')
      .get(duplicateId) as { status: string }).status, 'suspended');
    assert.equal((running.vera.store.db.prepare(`SELECT reason FROM participant_reconciliations
      WHERE duplicate_id=?`).get(duplicateId) as { reason: string }).reason,
    'Dos accesos creados para la misma persona');
  });
});
