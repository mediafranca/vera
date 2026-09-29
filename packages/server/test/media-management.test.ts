import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listen } from '../src/server.ts';

const OWNER = 'participant:media-owner';
const PORT = 4294;
let root = '';
let running: ReturnType<typeof listen>;
let counter = 0;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'vera-media-management-'));
  running = listen({
    port: PORT,
    databasePath: ':memory:',
    objectsRoot: join(root, 'objects'),
    owner: { id: OWNER, name: 'Dueña' },
  });
});

after(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

const base = `http://localhost:${PORT}`;

async function write(change: unknown): Promise<string> {
  counter += 1;
  const response = await fetch(`${base}/operations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ originId: `media:${counter}`, participant: OWNER, channel: 'typed_text', change }),
  });
  const body = await response.json() as { subjectId?: string; reason?: string };
  assert.equal(response.status, 201, body.reason);
  return body.subjectId as string;
}

describe('gestión coherente de archivos', () => {
  it('renombra, reemplaza y elimina el archivo junto con todas sus incrustaciones', async () => {
    const page = await write({ kind: 'create_page', title: 'Archivos vivos', visibility: 'private' });
    const originalBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const upload = await fetch(`${base}/media`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'x-filename': encodeURIComponent('imagen inicial.png') },
      body: originalBytes,
    });
    assert.equal(upload.status, 201);
    const original = await upload.json() as { path: string; url: string };
    const originalHash = original.url.split('/').pop() as string;
    const encoded = original.path.replace(/ /g, '%20');
    await write({
      kind: 'create_block', page, parent: null, position: 0,
      content: `antes ![primera](${encoded}) después`,
    });
    await write({
      kind: 'create_block', page, parent: null, position: 1,
      content: `![segunda](${original.path})`,
    });

    const renamedResponse = await fetch(`${base}/media/${originalHash}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'imagen definitiva.png' }),
    });
    assert.equal(renamedResponse.status, 200);
    const renamed = await renamedResponse.json() as { hash: string; path: string; originalName: string; usages: unknown[] };
    assert.equal(renamed.path, '../assets/imagen definitiva.png');
    assert.equal(renamed.originalName, 'imagen definitiva.png');
    assert.equal(renamed.usages.length, 2);

    const afterRename = await fetch(`${base}/pages/${encodeURIComponent(page)}`).then((response) => response.json()) as {
      blocks: { content: string }[];
    };
    assert.ok(afterRename.blocks.every((block) => block.content.includes('../assets/imagen%20definitiva.png')));
    assert.ok(afterRename.blocks.every((block) => !block.content.includes('imagen%20inicial.png')));

    const wrongKind = await fetch(`${base}/media/${originalHash}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf', 'x-filename': 'otro.pdf' },
      body: Buffer.from('%PDF-1.7'),
    });
    assert.equal(wrongKind.status, 409);

    const replacementBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6]);
    const replacementResponse = await fetch(`${base}/media/${originalHash}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'x-filename': 'otra.png' },
      body: replacementBytes,
    });
    assert.equal(replacementResponse.status, 200);
    const replacement = await replacementResponse.json() as {
      hash: string; path: string; url: string; originalName: string; usages: unknown[];
    };
    assert.notEqual(replacement.hash, originalHash);
    assert.equal(replacement.path, '../assets/imagen definitiva.png');
    assert.equal(replacement.originalName, 'imagen definitiva.png');
    assert.equal(replacement.usages.length, 2);
    const served = await fetch(`${base}${replacement.url}`);
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), replacementBytes);
    assert.equal((await fetch(`${base}${original.url}`)).status, 404);

    const removedResponse = await fetch(`${base}/media/${replacement.hash}`, { method: 'DELETE' });
    const removed = await removedResponse.json() as { deleted?: true; detached?: number; error?: string };
    assert.equal(removedResponse.status, 200, removed.error);
    assert.equal(removed.deleted, true);
    assert.equal(removed.detached, 2);

    const afterDelete = await fetch(`${base}/pages/${encodeURIComponent(page)}`).then((response) => response.json()) as {
      blocks: { content: string }[];
      assets: unknown[];
    };
    assert.ok(afterDelete.blocks.every((block) => !block.content.includes('imagen%20definitiva.png')));
    assert.ok(afterDelete.blocks.every((block) => !block.content.includes('![')));
    assert.deepEqual(afterDelete.assets, []);
    assert.deepEqual(await fetch(`${base}/media`).then((response) => response.json()), []);
  });
});
