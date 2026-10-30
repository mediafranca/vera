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

  it('resume el padrón canónico y permite renombrar con historia', async () => {
    const declared = await call('/participants', 'POST', { name: 'Nombre provisional', kind: 'human' });
    const participant = declared.json['participant'].id as string;
    const renamed = await call(`/participants/${encodeURIComponent(participant)}`, 'PATCH', { name: 'Nombre definitivo' });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    const directory = await call('/participants');
    const row = (directory.json['participants'] as any[]).find((one) => one.id === participant);
    assert.equal(row.name, 'Nombre definitivo');
    assert.deepEqual(row.roles, []);
    assert.equal(row.canErase, false, 'la historia del nombre impide borrar la identidad');
    assert.ok(row.retainedBy.includes('historia de nombres'));
  });

  it('borra sólo identidades realmente vacías', async () => {
    const empty = await call('/participants', 'POST', { name: 'Prueba fallida', kind: 'agent' });
    const emptyId = empty.json['participant'].id as string;
    const erased = await call(`/participants/${encodeURIComponent(emptyId)}`, 'DELETE');
    assert.equal(erased.status, 200, JSON.stringify(erased.json));
    assert.equal(running.vera.graph.participant(emptyId), undefined);

    const residue = await call('/participants', 'POST', { name: 'Agente con credencial fallida', kind: 'agent' });
    const residueId = residue.json['participant'].id as string;
    running.vera.store.db.prepare(`INSERT INTO access_tokens
      (id,graph_id,participant_id,secret_digest,scopes,status,label,issued_by,issued_at)
      VALUES (?,?,?,?,?,'active',?,?,?)`)
      .run('token:empty-participant', running.vera.store.graphId, residueId, 'digest-empty', '["read"]',
        'prueba', OWNER, Date.now());
    const erasedResidue = await call(`/participants/${encodeURIComponent(residueId)}`, 'DELETE');
    assert.equal(erasedResidue.status, 200, JSON.stringify(erasedResidue.json));
    assert.equal(running.vera.store.db.prepare(`SELECT 1 FROM access_tokens WHERE id='token:empty-participant'`).get(), undefined);

    const held = await call('/participants', 'POST', { name: 'Agente con exposición', kind: 'agent' });
    const heldId = held.json['participant'].id as string;
    running.vera.store.db.prepare(`INSERT INTO exposures
      (id,graph_id,participant_id,credential_id,client,surface,subject,outcome,volume,delivered_count,at)
      VALUES (?,?,?,NULL,NULL,'prueba','directorio','served',1,1,?)`)
      .run('exposure:held-participant', running.vera.store.graphId, heldId, Date.now());
    const refused = await call(`/participants/${encodeURIComponent(heldId)}`, 'DELETE');
    assert.equal(refused.status, 409);
    assert.match(String(refused.json['error']), /exposiciones/);
  });

  it('fusiona desde la superficie y conserva un solo renglón canónico', async () => {
    const canonical = await call('/participants', 'POST', { name: 'Cristián Mella', kind: 'human' });
    const duplicate = await call('/participants', 'POST', { name: 'Cristian Mella', kind: 'human' });
    const canonicalId = canonical.json['participant'].id as string;
    const duplicateId = duplicate.json['participant'].id as string;
    const merged = await call(`/participants/${encodeURIComponent(duplicateId)}/reconcile`, 'POST', {
      canonical: canonicalId, reason: 'La misma persona fue declarada dos veces',
    });
    assert.equal(merged.status, 200, JSON.stringify(merged.json));
    const directory = await call('/participants');
    const rows = (directory.json['participants'] as any[]).filter((one) =>
      one.id === canonicalId || one.id === duplicateId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, canonicalId);
    assert.equal(rows[0].aliases[0].id, duplicateId);
  });
});
