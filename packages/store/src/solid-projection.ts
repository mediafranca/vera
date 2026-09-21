import { createHash } from 'node:crypto';

import {
  TESTIMONY_KEY,
  canonicalUrl,
  isTrail,
  readTrail,
} from '@vera/core';
import type {
  PersonalSite,
  Publication,
  Trail,
  VeraGraph,
} from '@vera/core';

export interface SolidProjectionOptions {
  destination: string;
  site: PersonalSite;
  publication: Publication;
}

export interface SolidResource {
  kind: 'page' | 'trail';
  currentUrl: string;
  revisionUrl: string;
  digest: string;
  mediaType: 'application/ld+json';
  body: string;
}

export interface SolidProjection {
  page: string;
  publication: string;
  resources: SolidResource[];
}

export interface SolidDelivery {
  url: string;
  status: number;
  verified: boolean;
  digest: string;
}

export interface SolidPublicationResult {
  deliveries: SolidDelivery[];
  verified: boolean;
}

const context = {
  dcterms: 'http://purl.org/dc/terms/',
  prov: 'http://www.w3.org/ns/prov#',
  schema: 'https://schema.org/',
  vera: 'https://vera.mediafranca.net/ns#',
  title: 'dcterms:title',
  modified: { '@id': 'dcterms:modified', '@type': 'http://www.w3.org/2001/XMLSchema#dateTime' },
  published: { '@id': 'dcterms:issued', '@type': 'http://www.w3.org/2001/XMLSchema#dateTime' },
  canonical: { '@id': 'schema:url', '@type': '@id' },
  derivedFrom: { '@id': 'prov:wasDerivedFrom', '@type': '@id' },
  attributedTo: { '@id': 'prov:wasAttributedTo', '@type': '@id' },
  epistemicRole: 'vera:epistemicRole',
  stableId: 'vera:stableId',
  revision: 'vera:revision',
  blocks: 'vera:blocks',
  route: 'vera:route',
  crossings: 'vera:crossings',
} as const;

const iso = (time: number): string => new Date(time).toISOString();
const digestOf = (body: string): string => createHash('sha256').update(body).digest('hex');
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function rootUrl(destination: string): URL {
  const withSlash = destination.endsWith('/') ? destination : `${destination}/`;
  return new URL(withSlash);
}

function resource(
  kind: SolidResource['kind'],
  destination: string,
  slug: string,
  value: unknown,
): SolidResource {
  const body = json(value);
  const digest = digestOf(body);
  const root = rootUrl(destination);
  return {
    kind,
    currentUrl: new URL(`vera/${slug}.jsonld`, root).href,
    revisionUrl: new URL(`vera/revisions/${slug}.${digest}.jsonld`, root).href,
    digest,
    mediaType: 'application/ld+json',
    body,
  };
}

function slugOf(publication: Publication): string {
  return publication.path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('--') || encodeURIComponent(publication.page);
}

function epistemicRole(graph: VeraGraph, page: string): string | null {
  return graph.propertiesOf(page).find((property) => {
    const key = property.key.trim().toLocaleLowerCase('es');
    return key === 'rol epistémico' || key === 'epistemic role';
  })?.value.trim() ?? null;
}

function trailOf(graph: VeraGraph, page: string): Trail | null {
  if (!isTrail(graph.propertiesOf(page), graph.propertyNames)) return null;
  const intent = graph.propertiesOf(page)
    .find((property) => property.key.trim().toLocaleLowerCase('es') === 'propósito');
  return readTrail({
    page,
    intent: intent?.value.trim() ?? null,
    blocks: graph.blocksOf(page).map((block) => ({
      stableId: block.stableId,
      parent: block.parent,
      position: block.position,
      content: block.content,
      testimony: graph.propertiesOf(block.stableId)
        .find((property) => property.key.trim().toLocaleLowerCase('es') === TESTIMONY_KEY)
        ?.value ?? null,
      citedCrossing: graph.propertiesOf(block.stableId)
        .find((property) => property.key.trim().toLocaleLowerCase('es') === 'conectiva')
        ?.value ?? null,
      citedRevision: graph.propertiesOf(block.stableId)
        .find((property) => property.key.trim().toLocaleLowerCase('es') === 'revisión de conectiva')
        ?.value ?? null,
    })),
    resolve: (title) => graph.pageTitled(title)?.id ?? null,
    linked: (a, b) =>
      graph.backlinks(b).some((link) => link.sourcePage === a && link.sourcePage !== page) ||
      graph.backlinks(a).some((link) => link.sourcePage === b && link.sourcePage !== page),
    relation: (from, to) => {
      const crossing = graph.crossingsOut(from).find((candidate) => candidate.toPage === to);
      if (crossing === undefined) return null;
      const revision = graph.revisions()
        .filter((candidate) => candidate.crossing === crossing.stableId)
        .at(-1)?.operation;
      return revision === undefined
        ? null
        : { id: crossing.stableId, revision, content: crossing.said };
    },
  });
}

/**
 * Proyecta una publicación deliberada; nunca una página meramente visible.
 * La salida no es una copia editable de Vera y no contiene credenciales.
 */
export function projectPublicationToSolid(
  graph: VeraGraph,
  options: SolidProjectionOptions,
): SolidProjection {
  const { publication, site } = options;
  if (publication.site !== site.id || !graph.publicationsOf(site.id).some((one) => one.id === publication.id)) {
    throw new Error('Solid projection requires an explicit publication in the selected site');
  }
  const page = graph.page(publication.page);
  if (page === undefined || page.visibility !== 'public') {
    throw new Error('Solid projection requires a public page');
  }

  const slug = slugOf(publication);
  const humanUrl = canonicalUrl(site.canonicalDomain, publication.path);
  const updatedAt = graph.lastEditedAt(page.id) ?? page.createdAt;
  const blocks = [...graph.blocksOf(page.id)]
    .sort((a, b) => a.position - b.position || a.stableId.localeCompare(b.stableId))
    .map((block) => {
      const hand = graph.authorship(block.stableId);
      const participant = hand === undefined ? undefined : graph.participant(hand.participant);
      return {
        '@id': `urn:vera:${encodeURIComponent(block.stableId)}`,
        stableId: block.stableId,
        parent: block.parent,
        position: block.position,
        text: block.content,
        ...(hand === undefined ? {} : {
          attributedTo: `urn:vera:${encodeURIComponent(hand.participant)}`,
          attribution: {
            name: participant?.name ?? hand.participant,
            channel: hand.channel,
            writtenAt: iso(hand.writtenAt),
          },
        }),
      };
    });
  const role = epistemicRole(graph, page.id);
  const pageDocument = {
    '@context': context,
    '@id': `urn:vera:${encodeURIComponent(page.id)}`,
    '@type': 'schema:DigitalDocument',
    stableId: page.id,
    title: page.title,
    canonical: humanUrl,
    derivedFrom: humanUrl,
    published: iso(publication.publishedAt),
    modified: iso(updatedAt),
    attributedTo: `urn:vera:${encodeURIComponent(publication.publishedBy)}`,
    ...(role === null ? {} : { epistemicRole: role }),
    blocks,
  };
  const pageResource = resource('page', options.destination, slug, pageDocument);
  (pageDocument as Record<string, unknown>).revision = pageResource.digest;
  const finalPage = resource('page', options.destination, slug, pageDocument);

  const resources = [finalPage];
  const trail = trailOf(graph, page.id);
  if (trail !== null) {
    const sitePublications = new Map(
      graph.publicationsOf(site.id).map((one) => [one.page, one]),
    );
    const unavailable = trail.route.filter((node) => {
      if (node.page === null) return true;
      const target = graph.page(node.page);
      return target?.visibility !== 'public' || !sitePublications.has(node.page);
    });
    if (unavailable.length > 0) {
      throw new Error(`trail contains unpublished route nodes: ${unavailable.map((one) => one.title).join(', ')}`);
    }
    const trailDocument = {
      '@context': context,
      '@id': `urn:vera:${encodeURIComponent(page.id)}:trail`,
      '@type': 'vera:Trail',
      title: page.title,
      canonical: humanUrl,
      derivedFrom: humanUrl,
      route: trail.route.map((node) => {
        const target = node.page === null ? undefined : sitePublications.get(node.page);
        if (target === undefined) throw new Error(`unpublished trail node ${node.title}`);
        return {
          ordinal: node.ordinal,
          title: node.title,
          page: `urn:vera:${encodeURIComponent(node.page!)}`,
          canonical: canonicalUrl(site.canonicalDomain, target.path),
        };
      }),
      crossings: trail.crossings.map((crossing) => ({
        from: crossing.from.ordinal,
        to: crossing.to.ordinal,
        connective: crossing.connective,
        kind: crossing.kind,
        testimony: crossing.testimony,
      })),
      opening: trail.opening,
      conclusion: trail.conclusion,
      argues: trail.argues,
    };
    const firstTrail = resource('trail', options.destination, `${slug}.trail`, trailDocument);
    (trailDocument as Record<string, unknown>).revision = firstTrail.digest;
    resources.push(resource('trail', options.destination, `${slug}.trail`, trailDocument));
  }
  return { page: page.id, publication: publication.id, resources };
}

async function ensureContainer(
  url: URL,
  fetcher: typeof fetch,
  headers: Record<string, string>,
): Promise<void> {
  const present = await fetcher(url, { method: 'HEAD', headers });
  if (present.ok) return;
  const response = await fetcher(url, {
    method: 'PUT',
    headers: {
      ...headers,
      'content-type': 'text/turtle',
      link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
    },
    // CSS and the Solid protocol derive a container's representation; the
    // Link header names the requested kind and the request body stays empty.
    body: '',
  });
  if (!response.ok && response.status !== 409 && response.status !== 412) {
    throw new Error(`cannot prepare Solid container ${url.href}: HTTP ${response.status}`);
  }
}

export async function publishSolidProjection(
  projection: SolidProjection,
  options: { fetch?: typeof fetch; bearerToken?: string } = {},
): Promise<SolidPublicationResult> {
  const fetcher = options.fetch ?? fetch;
  const headers: Record<string, string> = options.bearerToken === undefined
    ? {}
    : { authorization: `Bearer ${options.bearerToken}` };
  const first = new URL(projection.resources[0]?.currentUrl ?? '');
  const root = new URL('./', first);
  await ensureContainer(root, fetcher, headers);
  await ensureContainer(new URL('revisions/', root), fetcher, headers);

  const deliveries: SolidDelivery[] = [];
  for (const item of projection.resources) {
    for (const url of [item.revisionUrl, item.currentUrl]) {
      const response = await fetcher(url, {
        method: 'PUT',
        headers: { ...headers, 'content-type': item.mediaType },
        body: item.body,
      });
      if (!response.ok) throw new Error(`Solid PUT ${url} failed: HTTP ${response.status}`);
      const read = await fetcher(url, { headers });
      const body = await read.text();
      const verified = read.ok && body === item.body;
      deliveries.push({ url, status: response.status, verified, digest: digestOf(body) });
      if (!verified) throw new Error(`Solid verification failed for ${url}: HTTP ${read.status}`);
    }
  }
  return { deliveries, verified: deliveries.every((delivery) => delivery.verified) };
}
