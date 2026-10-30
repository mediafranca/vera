import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listen } from '../src/server.ts';
import { issueSession } from '../src/human-auth.ts';

const PORT = 4317;
const OWNER = 'participant:herbert';
let running: ReturnType<typeof listen>;
let base: string;

before(() => {
  running = listen({
    port: PORT,
    databasePath: ':memory:',
    owner: { id: OWNER, name: 'Herbert' },
    instanceProfile: 'collective',
    webRoot: new URL('../../web/dist', import.meta.url).pathname,
  });
  base = `http://localhost:${PORT}`;
});
after(async () => running.close());

async function call(path: string, method = 'GET', body?: unknown, cookie?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      ...(cookie === undefined ? {} : { cookie }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json: Record<string, any> = {};
  if ((response.headers.get('content-type') ?? '').includes('application/json') && text !== '') {
    json = JSON.parse(text) as Record<string, any>;
  }
  return {
    status: response.status,
    location: response.headers.get('location'),
    cookie: response.headers.get('set-cookie'),
    json,
  };
}

const sessionCookie = (participant: string): string => {
  const session = issueSession(running.vera.store, participant);
  return `vera_session=${encodeURIComponent(session.secret)}`;
};

async function inviteAndRedeem(ownerCookie: string, role: string, name: string) {
  const declared = await call('/participants', 'POST', { name, kind: 'human' }, ownerCookie);
  assert.equal(declared.status, 201, JSON.stringify(declared.json));
  const issued = await call('/collective-invitations', 'POST', {
    participant: declared.json['participant'].id,
    role,
  }, ownerCookie);
  assert.equal(issued.status, 201, JSON.stringify(issued.json));
  const redeemed = await call(`/collective-invitations/${encodeURIComponent(issued.json['id'])}/redeem`,
    'POST', { secret: issued.json['secret'] });
  assert.equal(redeemed.status, 201, JSON.stringify(redeemed.json));
  return {
    participant: redeemed.json['participant'] as string,
    cookie: (redeemed.cookie ?? '').split(';')[0] ?? '',
    invitation: issued.json,
  };
}

describe('autenticación de una instancia colectiva', () => {
  it('persiste el perfil y separa custodia de la autoridad inicial', () => {
    const instance = running.vera.store.db.prepare('SELECT profile,owner_id FROM instances').get() as any;
    assert.equal(instance.profile, 'collective');
    assert.equal(instance.owner_id, OWNER);
    const roles = running.vera.store.db.prepare(`SELECT role FROM instance_governance_grants
      WHERE participant_id=? AND status='active' ORDER BY role`).all(OWNER) as Array<{ role: string }>;
    assert.deepEqual(roles.map((one) => one.role), ['administrator', 'root_custodian']);
  });

  it('sin sesión no entrega corpus ni acepta escritura y conduce al ingreso', async () => {
    assert.equal((await call('/pages')).status, 401);
    const write = await call('/operations', 'POST', {
      originId: 'collective:anonymous',
      change: { kind: 'create_page', title: 'No debe nacer', visibility: 'private' },
    });
    assert.equal(write.status, 401);
    const root = await call('/');
    assert.equal(root.status, 302);
    assert.equal(root.location, '/login');
    assert.equal((await call('/login')).status, 200);
  });

  it('una sesión del administrador lee, escribe e invita una sola vez', async () => {
    const ownerCookie = sessionCookie(OWNER);
    assert.equal((await call('/pages', 'GET', undefined, ownerCookie)).status, 200);
    const write = await call('/operations', 'POST', {
      originId: 'collective:owner',
      change: { kind: 'create_page', title: 'Página colectiva', visibility: 'private' },
    }, ownerCookie);
    assert.equal(write.status, 201, JSON.stringify(write.json));

    const reader = await inviteAndRedeem(ownerCookie, 'reader', 'Lectora');
    assert.match(reader.cookie, /^vera_session=/);
    const repeated = await call(`/collective-invitations/${encodeURIComponent(reader.invitation.id)}/redeem`,
      'POST', { secret: reader.invitation.secret, name: 'Otra' });
    assert.equal(repeated.status, 409);
  });

  it('autenticación y autoridad son distintas: lector lee pero no edita', async () => {
    const ownerCookie = sessionCookie(OWNER);
    const reader = await inviteAndRedeem(ownerCookie, 'reader', 'Segunda lectora');
    assert.equal((await call('/pages', 'GET', undefined, reader.cookie)).status, 200);
    const denied = await call('/operations', 'POST', {
      originId: 'collective:reader-write',
      change: { kind: 'create_page', title: 'Intrusión', visibility: 'private' },
    }, reader.cookie);
    assert.equal(denied.status, 403);
    assert.equal((await call('/collective-governance', 'GET', undefined, reader.cookie)).status, 403);
  });

  it('un editor invitado escribe con su propia autoría', async () => {
    const ownerCookie = sessionCookie(OWNER);
    const editor = await inviteAndRedeem(ownerCookie, 'editor', 'Editora');
    const made = await call('/operations', 'POST', {
      originId: 'collective:editor-write',
      change: { kind: 'create_page', title: 'Página de la editora', visibility: 'private' },
    }, editor.cookie);
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const operation = running.vera.graph.operations().find((one) => one.originId === 'collective:editor-write');
    assert.equal(operation?.submission.submittedBy, editor.participant);
  });

  it('revocar la sesión corta el acceso futuro', async () => {
    const ownerCookie = sessionCookie(OWNER);
    const editor = await inviteAndRedeem(ownerCookie, 'editor', 'Editora revocable');
    assert.equal((await call('/pages', 'GET', undefined, editor.cookie)).status, 200);
    assert.equal((await call('/human-auth/logout', 'POST', undefined, editor.cookie)).status, 200);
    assert.equal((await call('/pages', 'GET', undefined, editor.cookie)).status, 401);
  });

  it('el administrador ve el gobierno y revoca invitaciones pendientes', async () => {
    const ownerCookie = sessionCookie(OWNER);
    const declared = await call('/participants', 'POST', {
      name: 'Persona pendiente', kind: 'human',
    }, ownerCookie);
    const issued = await call('/collective-invitations', 'POST', {
      participant: declared.json['participant'].id,
      role: 'reader', intendedContact: 'persona@example.net',
    }, ownerCookie);
    assert.equal(issued.status, 201);
    const view = await call('/collective-governance', 'GET', undefined, ownerCookie);
    assert.equal(view.status, 200);
    assert.equal(view.json['profile'], 'collective');
    assert.ok((view.json['people'] as any[]).some((person) => person.participant === OWNER &&
      person.roles.includes('administrator') && person.roles.includes('root_custodian')));
    assert.ok((view.json['invitations'] as any[]).some((invitation) => invitation.id === issued.json['id'] &&
      invitation.intendedContact === 'persona@example.net'));
    assert.equal((await call(`/collective-invitations/${encodeURIComponent(issued.json['id'])}`,
      'DELETE', undefined, ownerCookie)).status, 200);
    const denied = await call(`/collective-invitations/${encodeURIComponent(issued.json['id'])}/redeem`,
      'POST', { secret: issued.json['secret'], name: 'Llegó tarde' });
    assert.equal(denied.status, 409);
  });

  it('revocar el último rol editorial cierra las sesiones y el último administrador se conserva', async () => {
    const ownerCookie = sessionCookie(OWNER);
    const editor = await inviteAndRedeem(ownerCookie, 'editor', 'Editora despedida');
    assert.equal((await call(`/collective-participants/${encodeURIComponent(editor.participant)}/roles/editor`,
      'DELETE', undefined, ownerCookie)).status, 200);
    assert.equal((await call('/pages', 'GET', undefined, editor.cookie)).status, 401);
    const lastAdministrator = await call(`/collective-participants/${encodeURIComponent(OWNER)}/roles/administrator`,
      'DELETE', undefined, ownerCookie);
    assert.equal(lastAdministrator.status, 409);
    assert.match(String(lastAdministrator.json['error']), /último administrador/);
  });
});
