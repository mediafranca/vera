// Genera el sitio HTML estático desde sus publicaciones persistidas.
//   npm run project:public -- data/vera.sqlite ../vera-public https://vera.mediafranca.net

import { fileURLToPath } from 'node:url';

import { loadGraph, openStore, workspaceOf } from './store.ts';
import { projectPublicSiteAtomically } from './public-projection.ts';

const database = process.argv[2] ?? 'data/vera.sqlite';
const target = process.argv[3] ?? '../vera-public';
const canonicalDomain = process.argv[4] ?? 'https://vera.mediafranca.net';

const store = openStore({ path: database, graphName: 'mind' });
try {
  const graph = loadGraph(store, 'mind');
  const site = graph.siteByDomain(canonicalDomain);
  if (site === undefined) throw new Error(`no existe un sitio para ${canonicalDomain}`);
  const summary = projectPublicSiteAtomically(graph, target, {
    site,
    publications: graph.publicationsOf(site.id),
    ownerDesignLibrary: workspaceOf(store, site.owner).designTokens,
    brandingAssets: fileURLToPath(new URL('../../web/public/', import.meta.url)),
  });
  console.log(`sitio público proyectado a ${target}`);
  console.log(`  páginas ${summary.pages}`);
  console.log(`  archivos ${summary.files.length}`);
} finally {
  store.close();
}
