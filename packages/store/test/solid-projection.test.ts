import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { VeraGraph } from '@vera/core';
import type { Change, PersonalSite, Publication } from '@vera/core';
import {
  projectPublicationToSolid,
  publishSolidProjection,
} from '../src/solid-projection.ts';

const OWNER = 'participant:herbert';
const servers: ReturnType<typeof createServer>[] = [];
after(() => servers.forEach((server) => server.close()));

function fixture(): { graph: VeraGraph; site: PersonalSite; publication: Publication } {
  const graph = VeraGraph.create({ name: 'mind' });
  graph.addParticipant({ id: OWNER, name: 'Herbert', kind: 'human' });
  graph.admit(OWNER);
  let sequence = 0;
  const write = (change: Change): string => {
    const outcome = graph.submitOperation({
      originId: `solid:${++sequence}`,
      participant: OWNER,
      change,
    });
    if (outcome.status !== 'applied') throw new Error(JSON.stringify(outcome));
    return outcome.subjectId;
  };
  const first = write({ kind: 'create_page', title: 'Primera', visibility: 'public' });
  const second = write({ kind: 'create_page', title: 'Segunda', visibility: 'public' });
  const trail = write({ kind: 'create_page', title: 'Recorrido Solid', visibility: 'public' });
  write({ kind: 'create_block', page: first, parent: null, position: 0, content: 'Uno' });
  write({ kind: 'create_block', page: second, parent: null, position: 0, content: 'Dos' });
  write({
    kind: 'create_block', page: trail, parent: null, position: 0,
    content: '[[Primera]] conduce a [[Segunda]].',
  });
  write({ kind: 'set_property', page: trail, propertyKey: 'tipo', propertyValue: 'argumento' });
  write({
    kind: 'set_property', page: trail,
    propertyKey: 'rol epistémico', propertyValue: 'análisis',
  });
  const site = graph.createSite({
    owner: OWNER,
    title: 'Vera',
    canonicalDomain: 'https://vera.example',
  });
  graph.publish({ site: site.id, page: first, path: 'primera', participant: OWNER });
  graph.publish({ site: site.id, page: second, path: 'segunda', participant: OWNER });
  const publication = graph.publish({
    site: site.id, page: trail, path: 'recorrido-solid', participant: OWNER,
  });
  return { graph, site, publication };
}

describe('proyección Solid', () => {
  it('produce página y recorrido deterministas con direcciones estables y revisiones inmutables', () => {
    const { graph, site, publication } = fixture();
    const options = { destination: 'https://pod.example/herbert/', site, publication };
    const a = projectPublicationToSolid(graph, options);
    const b = projectPublicationToSolid(graph, options);
    assert.deepEqual(a, b);
    assert.equal(a.resources.length, 2);
    assert.deepEqual(a.resources.map((one) => one.kind), ['page', 'trail']);
    for (const resource of a.resources) {
      assert.match(resource.currentUrl, /^https:\/\/pod\.example\/herbert\/vera\//);
      assert.match(resource.revisionUrl, new RegExp(resource.digest));
      assert.match(resource.body, /"canonical": "https:\/\/vera\.example\//);
      assert.match(resource.body, /"attributedTo":|"route":/);
    }
    assert.match(a.resources[0]!.body, /"epistemicRole": "análisis"/);
  });

  it('rechaza un recorrido que abriría una página no publicada', () => {
    const { graph, site, publication } = fixture();
    const second = graph.pageTitled('Segunda');
    assert.ok(second);
    const held = graph.publicationsOf(site.id).find((one) => one.page === second.id);
    assert.ok(held);
    graph.unpublish({ site: site.id, path: held.path, participant: OWNER });
    assert.throws(
      () => projectPublicationToSolid(graph, {
        destination: 'https://pod.example/herbert/', site, publication,
      }),
      /unpublished route nodes: Segunda/,
    );
  });

  it('escribe, relee y repite los mismos bytes de forma idempotente', async () => {
    const held = new Map<string, string>();
    const server = createServer(async (request, response) => {
      const path = request.url ?? '/';
      if (request.method === 'HEAD') {
        response.statusCode = held.has(path) || path === '/pod/' ? 200 : 404;
        response.end();
        return;
      }
      if (request.method === 'PUT') {
        let body = '';
        for await (const chunk of request) body += chunk;
        const existed = held.has(path);
        held.set(path, body);
        response.statusCode = existed ? 204 : 201;
        response.end();
        return;
      }
      if (request.method === 'GET') {
        const body = held.get(path);
        response.statusCode = body === undefined ? 404 : 200;
        response.end(body);
        return;
      }
      response.statusCode = 405;
      response.end();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address === 'object');
    const { graph, site, publication } = fixture();
    const projection = projectPublicationToSolid(graph, {
      destination: `http://127.0.0.1:${address.port}/pod/`, site, publication,
    });
    const first = await publishSolidProjection(projection);
    const snapshot = new Map(held);
    const second = await publishSolidProjection(projection);
    assert.equal(first.verified, true);
    assert.equal(second.verified, true);
    assert.deepEqual(held, snapshot);
    assert.equal(first.deliveries.length, 4);
    assert.equal(second.deliveries.length, 4);
  });

  it('interopera con Community Solid Server cuando se declara su URL', {
    skip: process.env['VERA_SOLID_CSS_URL'] === undefined,
  }, async () => {
    const destination = process.env['VERA_SOLID_CSS_URL'];
    assert.ok(destination);
    const { graph, site, publication } = fixture();
    const projection = projectPublicationToSolid(graph, { destination, site, publication });
    assert.deepEqual(projection.resources.map((one) => one.kind), ['page', 'trail']);
    const first = await publishSolidProjection(projection);
    const second = await publishSolidProjection(projection);
    assert.equal(first.verified, true);
    assert.equal(second.verified, true);
    assert.equal(first.deliveries.length, 4);
    assert.equal(second.deliveries.length, 4);
    assert.deepEqual(
      first.deliveries.map((one) => one.digest),
      second.deliveries.map((one) => one.digest),
    );
  });
});
