// Proyecta una publicación deliberada a un Pod Solid.
//   npm run project:solid -- data/vera.sqlite http://127.0.0.1:3000/pod/ \
//     https://vera.mediafranca.net "Título publicado"

import { loadGraph, openStore } from './store.ts';
import { projectPublicationToSolid, publishSolidProjection } from './solid-projection.ts';

const [database = 'data/vera.sqlite', destination, canonicalDomain, title] = process.argv.slice(2);
if (destination === undefined || canonicalDomain === undefined || title === undefined) {
  throw new Error('uso: project:solid <base.sqlite> <pod-base-url> <dominio-publico> <titulo>');
}

const store = openStore({ path: database, graphName: 'mind' });
try {
  const graph = loadGraph(store, 'mind');
  const site = graph.siteByDomain(canonicalDomain);
  if (site === undefined) throw new Error(`no existe un sitio para ${canonicalDomain}`);
  const page = graph.pageTitled(title);
  if (page === undefined) throw new Error(`no existe la página ${title}`);
  const publication = graph.publicationsOf(site.id).find((candidate) => candidate.page === page.id);
  if (publication === undefined) throw new Error(`${title} no es una publicación de ${canonicalDomain}`);
  const projection = projectPublicationToSolid(graph, { destination, site, publication });
  const token = process.env['SOLID_BEARER_TOKEN'];
  const result = await publishSolidProjection(
    projection,
    token === undefined ? {} : { bearerToken: token },
  );
  console.log(JSON.stringify({
    page: page.title,
    destination,
    resources: projection.resources.map((resource) => ({
      kind: resource.kind,
      current: resource.currentUrl,
      revision: resource.revisionUrl,
      digest: resource.digest,
    })),
    deliveries: result.deliveries,
    verified: result.verified,
  }, null, 2));
} finally {
  store.close();
}
