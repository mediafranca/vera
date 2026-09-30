// Pruebas de specs/agent-participation.allium contra HTTP real.
//
// Lo que se comprueba aquí no es que la ruta responda, sino que las dos
// promesas del contrato se sostengan bajo intento: que la identidad salga de la
// credencial y no de lo que el cuerpo afirme, y que lo generado quede siempre
// distinguible de lo escrito.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { listen } from '../src/server.ts';

const PORT = 4277;
const OWNER = 'participant:herbert';
const COTITO = 'participant:cotito';

let base: string;
let running: ReturnType<typeof listen>;

before(() => {
  running = listen({ port: PORT, databasePath: ':memory:', owner: { id: OWNER, name: 'Dueña' } });
  base = `http://localhost:${PORT}`;
});

after(async () => {
  await running.close();
});

let counter = 0;

interface Reply {
  status: number;
  json: Record<string, unknown>;
}

async function call(
  path: string,
  options: { method?: string; body?: unknown; secret?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.secret !== undefined) headers['authorization'] = `Bearer ${options.secret}`;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

/** Una escritura, con o sin credencial. */
async function submit(
  change: unknown,
  options: { secret?: string; participant?: string; channel?: string } = {},
): Promise<Reply> {
  counter += 1;
  return call('/operations', {
    method: 'POST',
    ...(options.secret === undefined ? {} : { secret: options.secret }),
    body: {
      originId: `agent-test:${counter}`,
      ...(options.participant === undefined ? {} : { participant: options.participant }),
      ...(options.channel === undefined ? {} : { channel: options.channel }),
      change,
    },
  });
}

async function makePage(title: string): Promise<string> {
  const reply = await submit({ kind: 'create_page', title, visibility: 'private' });
  assert.equal(reply.status, 201, JSON.stringify(reply.json));
  return reply.json['subjectId'] as string;
}

describe('admisión de un agente', () => {
  it('el dueño admite a Cotito como participante agente', async () => {
    const reply = await call('/agents', {
      method: 'POST',
      body: { id: COTITO, name: 'Cotito' },
    });
    assert.equal(reply.status, 201, JSON.stringify(reply.json));
    assert.equal(reply.json['kind'], 'agent');
  });

  it('no se admite dos veces al mismo agente', async () => {
    const reply = await call('/agents', { method: 'POST', body: { id: COTITO, name: 'Cotito' } });
    assert.equal(reply.status, 409);
  });
});

describe('credenciales', () => {
  it('emitir devuelve el secreto una sola vez', async () => {
    const issued = await call('/agents/credentials', {
      method: 'POST',
      body: { participant: COTITO, scopes: ['read', 'write'], label: 'bibliotecario' },
    });
    assert.equal(issued.status, 201, JSON.stringify(issued.json));
    assert.match(issued.json['secret'] as string, /^vera_ag_/);

    // @guarantee TheSecretIsShownOnce: al listarlas no vuelve a aparecer.
    const listed = await call('/agents/credentials');
    const rows = listed.json as unknown as Record<string, unknown>[];
    const mine = rows.find((row) => row['id'] === issued.json['id']);
    assert.ok(mine !== undefined, 'la credencial debería estar listada');
    assert.equal(mine['secret'], undefined, 'el secreto no puede volver a leerse');
  });

  it('capture deposita por su puerta pero no abre páginas ni operaciones', async () => {
    const issued = await call('/agents/credentials', {
      method: 'POST',
      body: { participant: COTITO, scopes: ['capture'], label: 'clipper' },
    });
    assert.equal(issued.status, 201, JSON.stringify(issued.json));
    const secret = issued.json['secret'] as string;
    const captured = await call('/captures', {
      method: 'POST', secret,
      body: {
        kind: 'selection', title: 'Fuente capturada', url: 'https://example.com/capture',
        content: 'Texto capturado', capturedAt: '2026-09-16T12:00:00Z', idempotencyKey: 'capture-authority-test',
      },
    });
    assert.equal(captured.status, 202, JSON.stringify(captured.json));
    assert.equal((await call('/pages', { secret })).status, 403);
    assert.equal((await submit(
      { kind: 'create_page', title: 'No autorizada por capture', visibility: 'private' },
      { secret, participant: COTITO },
    )).status, 403);
  });

  it('una persona no recibe credencial: no se autentica con un token', async () => {
    const reply = await call('/agents/credentials', {
      method: 'POST',
      body: { participant: OWNER, scopes: ['read'] },
    });
    assert.equal(reply.status, 400);
  });

  it('un alcance inventado no se acepta en silencio', async () => {
    const reply = await call('/agents/credentials', {
      method: 'POST',
      body: { participant: COTITO, scopes: ['read', 'publicar'] },
    });
    assert.equal(reply.status, 400);
  });

  // @invariant SovereignOwnerCredentials: el consentimiento del dueño no es
  // transitivo. Si un agente pudiera emitir credenciales, no significaría nada.
  it('un agente no puede emitirse otra credencial', async () => {
    const issued = await call('/agents/credentials', {
      method: 'POST',
      body: { participant: COTITO, scopes: ['read', 'write'] },
    });
    const secret = issued.json['secret'] as string;

    const reply = await call('/agents/credentials', {
      method: 'POST',
      secret,
      body: { participant: COTITO, scopes: ['read', 'write', 'discard'] },
    });
    assert.equal(reply.status, 403);
  });
});

describe('la identidad sale de la credencial', () => {
  let secret: string;

  before(async () => {
    const issued = await call('/agents/credentials', {
      method: 'POST',
      body: { participant: COTITO, scopes: ['read', 'write'], label: 'para escribir' },
    });
    secret = issued.json['secret'] as string;
  });

  it('quien presenta la credencial es quien ella nombra', async () => {
    const reply = await call('/agents/whoami', { secret });
    assert.equal(reply.json['participant'], COTITO);
    assert.equal(reply.json['kind'], 'agent');
    assert.deepEqual(reply.json['scopes'], ['read', 'write']);
  });

  // El agujero que esto cierra: antes, el cuerpo declaraba su participante.
  it('una credencial no puede escribir como otro participante', async () => {
    const reply = await submit(
      { kind: 'create_page', title: 'Suplantada', visibility: 'private' },
      { secret, participant: OWNER },
    );
    assert.equal(reply.status, 403, JSON.stringify(reply.json));
    assert.match(reply.json['reason'] as string, /no como/);
  });

  it('sin credencial tampoco se puede escribir como el agente', async () => {
    const reply = await submit(
      { kind: 'create_page', title: 'Falsa autoría', visibility: 'private' },
      { participant: COTITO },
    );
    assert.equal(reply.status, 403, JSON.stringify(reply.json));
  });

  it('un secreto que no existe no escribe', async () => {
    const reply = await submit(
      { kind: 'create_page', title: 'Sin credencial', visibility: 'private' },
      { secret: 'vera_ag_inventado' },
    );
    assert.equal(reply.status, 401);
  });

  // @invariant ChannelFollowsParticipantKind: la procedencia no se elige.
  it('un agente no puede presentar su generación como texto tecleado', async () => {
    const page = await makePage('Canal del agente');
    const reply = await submit(
      { kind: 'create_block', page, parent: null, position: 0, content: 'generado' },
      { secret, channel: 'typed_text' },
    );
    assert.equal(reply.status, 201, JSON.stringify(reply.json));

    // No se rechaza: se corrige. El canal lo decide qué es quien escribe.
    const ops = (await call('/ops')) as Reply;
    const rows = ops.json as unknown as Record<string, unknown>[];
    const mine = rows.find((row) => row['subjectId'] === reply.json['subjectId']);
    assert.equal(mine?.['channel'], 'agent_generation');
  });
});

describe('el alcance se comprueba en cada cambio', () => {
  let sinBorrar: string;
  let conBorrar: string;
  let page: string;

  before(async () => {
    page = await makePage('Alcances');
    sinBorrar = (
      await call('/agents/credentials', {
        method: 'POST',
        body: { participant: COTITO, scopes: ['read', 'write'], label: 'sin borrar' },
      })
    ).json['secret'] as string;
    conBorrar = (
      await call('/agents/credentials', {
        method: 'POST',
        body: { participant: COTITO, scopes: ['read', 'write', 'discard'], label: 'con borrar' },
      })
    ).json['secret'] as string;
  });

  it('escribir no implica borrar', async () => {
    const created = await submit(
      { kind: 'create_block', page, parent: null, position: 0, content: 'efímero' },
      { secret: sinBorrar },
    );
    const block = created.json['subjectId'] as string;

    const refused = await submit({ kind: 'remove_block', block }, { secret: sinBorrar });
    assert.equal(refused.status, 403, JSON.stringify(refused.json));
    assert.match(refused.json['reason'] as string, /discard/);

    // @guarantee RefusalsSayWhy: la misma credencial con alcance sí puede.
    const allowed = await submit({ kind: 'remove_block', block }, { secret: conBorrar });
    assert.equal(allowed.status, 201, JSON.stringify(allowed.json));
  });

  it('una credencial sin write no escribe', async () => {
    const soloLeer = (
      await call('/agents/credentials', {
        method: 'POST',
        body: { participant: COTITO, scopes: ['read'], label: 'sólo lectura' },
      })
    ).json['secret'] as string;

    const reply = await submit(
      { kind: 'create_block', page, parent: null, position: 0, content: 'no' },
      { secret: soloLeer },
    );
    assert.equal(reply.status, 403);
    assert.match(reply.json['reason'] as string, /write/);
  });
});

describe('retirar una credencial', () => {
  it('la primera escritura posterior ya no pasa, y lo escrito antes sigue', async () => {
    const issued = await call('/agents/credentials', {
      method: 'POST',
      body: { participant: COTITO, scopes: ['read', 'write'], label: 'a retirar' },
    });
    const secret = issued.json['secret'] as string;
    const page = await makePage('Retirada');

    const before = await submit(
      { kind: 'create_block', page, parent: null, position: 0, content: 'escrito antes' },
      { secret },
    );
    assert.equal(before.status, 201);

    const revoked = await call(`/agents/credentials/${issued.json['id'] as string}/revoke`, {
      method: 'POST',
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.json['status'], 'revoked');

    // @invariant RevocationTakesEffectAtOnce
    const after = await submit(
      { kind: 'create_block', page, parent: null, position: 1, content: 'escrito después' },
      { secret },
    );
    assert.equal(after.status, 401, JSON.stringify(after.json));

    // @invariant WithdrawalLeavesTheWorkStanding: lo aplicado no se retracta.
    const view = await call(`/pages/${encodeURIComponent(page)}`);
    const blocks = view.json['blocks'] as Record<string, unknown>[];
    assert.ok(
      blocks.some((block) => block['content'] === 'escrito antes'),
      'retirar el acceso no deshace lo que ya se escribió',
    );

    /*
     * Y tampoco lee.
     *
     * Retirar una credencial no reducía nada: la lectura caía al dueño cuando el
     * secreto no resolvía, así que el cliente retirado seguía leyendo el corpus
     * entero, y el registro de exposición atribuía esas lecturas al dueño. La
     * revocación era una operación sin efecto sobre lo único que esa credencial
     * podía hacer.
     */
    const read = await call(`/pages/${encodeURIComponent(page)}`, { secret });
    assert.equal(read.status, 401, JSON.stringify(read.json));
  });
});

describe('una credencial que no vale se rechaza, no asciende', () => {
  // El agujero era éste: presentar una llave que no abre daba lo mismo que no
  // presentar ninguna, y no presentar ninguna es el dueño. Leer se pone al día
  // con escribir, que devuelve 401 desde el primer día.
  it('un secreto inventado no lee como el dueño', async () => {
    const answer = await call('/pages', { secret: 'vera_ag_esto_no_existe' });
    assert.equal(answer.status, 401, JSON.stringify(answer.json));
  });

  it('sin credencial se sigue leyendo, que es lo que hoy es cierto en casa', async () => {
    const answer = await call('/pages');
    assert.equal(answer.status, 200);
  });

  it('con una credencial buena se lee', async () => {
    const issued = await call('/agents/credentials', {
      method: 'POST',
      body: { participant: COTITO, scopes: ['read'], label: 'para leer' },
    });
    const answer = await call('/pages', { secret: issued.json['secret'] as string });
    assert.equal(answer.status, 200, JSON.stringify(answer.json));
  });
});

describe('lo generado se distingue de lo escrito', () => {
  let secret: string;
  let page: string;

  before(async () => {
    secret = (
      await call('/agents/credentials', {
        method: 'POST',
        body: { participant: COTITO, scopes: ['read', 'write'], label: 'autoría' },
      })
    ).json['secret'] as string;
    page = await makePage('Autoría');
  });

  // @invariant GeneratedContentIsAlwaysDistinguishable
  it('cada bloque dice de qué mano salió', async () => {
    const mine = await submit(
      { kind: 'create_block', page, parent: null, position: 0, content: 'lo escribí yo' },
      {},
    );
    const theirs = await submit(
      { kind: 'create_block', page, parent: null, position: 1, content: 'lo generó Cotito' },
      { secret },
    );

    const view = await call(`/pages/${encodeURIComponent(page)}`);
    const hands = view.json['authorship'] as Record<string, { participant: string; channel: string }>;

    assert.equal(hands[mine.json['subjectId'] as string]?.participant, OWNER);
    assert.equal(hands[mine.json['subjectId'] as string]?.channel, 'typed_text');
    assert.equal(hands[theirs.json['subjectId'] as string]?.participant, COTITO);
    assert.equal(hands[theirs.json['subjectId'] as string]?.channel, 'agent_generation');
  });

  // @invariant AuthorshipFollowsTheLastWord
  it('reescribir traspasa la mano a quien reescribió', async () => {
    const created = await submit(
      { kind: 'create_block', page, parent: null, position: 2, content: 'mío al nacer' },
      {},
    );
    const block = created.json['subjectId'] as string;

    await submit({ kind: 'edit_block', block, content: 'reescrito por el bibliotecario' }, { secret });

    const view = await call(`/pages/${encodeURIComponent(page)}`);
    const hands = view.json['authorship'] as Record<string, { participant: string }>;
    assert.equal(
      hands[block]?.participant,
      COTITO,
      'esas ya son palabras de Cotito, y el bloque tiene que decirlo',
    );
  });

  // rule MovingLeavesTheHandAlone: ordenar no es escribir.
  it('mover un bloque no cambia de quién son las palabras', async () => {
    const created = await submit(
      { kind: 'create_block', page, parent: null, position: 3, content: 'ordenable' },
      {},
    );
    const block = created.json['subjectId'] as string;

    const moved = await submit({ kind: 'move_block', block, page, parent: null, position: 0 }, { secret });
    assert.equal(moved.status, 201, JSON.stringify(moved.json));

    const view = await call(`/pages/${encodeURIComponent(page)}`);
    const hands = view.json['authorship'] as Record<string, { participant: string }>;
    assert.equal(
      hands[block]?.participant,
      OWNER,
      'un bibliotecario que archiva no ha escrito una palabra',
    );
  });
});
