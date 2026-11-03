import { randomUUID } from 'node:crypto';

import type { VeraGraph } from '@vera/core';
import type { Store } from '@vera/store';
import { pageBelongsToSharedSpace, sharedSpaces } from './shared-spaces.ts';

export type TerritoryMode = 'selected' | 'all';
export type SurfaceKind = 'shared' | 'public';
export type ClearanceAction = 'read' | 'contribute' | 'edit' | 'publish' | 'administer';
export type SurfacePermission = ClearanceAction;
export type SurfaceDisposition = 'included' | 'excluded';

export interface TerritorySurface {
  kind: SurfaceKind;
  id: string;
  name: string;
  pages: string[];
  stewards: { participant: string; name: string }[];
}

export interface TerritoryRule {
  id: string;
  kind: SurfaceKind;
  surface: string;
  disposition: SurfaceDisposition;
  permissions: SurfacePermission[];
  governedBy: string;
  createdAt: number;
}

export interface TerritoryPolicy {
  id: string;
  participant: string;
  participantName: string;
  participantKind: 'human' | 'agent';
  mode: TerritoryMode;
  includeGeneral: boolean;
  rules: TerritoryRule[];
  changedBy: string;
  changedAt: number;
}

export interface ClearanceDecision {
  outcome: 'granted' | 'refused';
  action: ClearanceAction;
  page: string;
  surfaces: { kind: SurfaceKind; id: string; name: string }[];
  failed: 'surface_exclusion' | 'surface_inclusion' | 'general' | null;
  explanation: string;
  correctionPath: string | null;
}

const PERMISSIONS = new Set<SurfacePermission>(['read', 'contribute', 'edit', 'publish', 'administer']);

function parsePermissions(value: string): SurfacePermission[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((one): one is SurfacePermission =>
          typeof one === 'string' && PERMISSIONS.has(one as SurfacePermission))
      : [];
  } catch {
    return [];
  }
}

function instance(store: Store): { id: string; owner: string } {
  const row = store.db.prepare('SELECT id,owner_id FROM instances WHERE graph_id=?').get(store.graphId) as
    { id: string; owner_id: string } | undefined;
  if (row === undefined) throw new Error('esta biblioteca no tiene una instancia gobernada');
  return { id: row.id, owner: row.owner_id };
}

export function ensureTerritoryPolicy(store: Store, participant: string, changedBy: string,
  initial: { mode: TerritoryMode; includeGeneral: boolean } = { mode: 'selected', includeGeneral: true }): TerritoryPolicy {
  const held = territoryPolicy(store, participant);
  if (held !== null) return held;
  const library = instance(store);
  const person = store.db.prepare('SELECT name,kind FROM participants WHERE id=?').get(participant) as
    { name: string; kind: 'human' | 'agent' } | undefined;
  if (person === undefined) throw new Error('el participante no existe');
  const id = `territory:${randomUUID()}`;
  const now = Date.now();
  store.db.prepare(`INSERT INTO territory_policies
    (id,instance_id,participant_id,mode,include_general,changed_by,changed_at)
    VALUES (?,?,?,?,?,?,?)`).run(
      id, library.id, participant, initial.mode, initial.includeGeneral ? 1 : 0, changedBy, now,
    );
  return territoryPolicy(store, participant)!;
}

export function territoryPolicy(store: Store, participant: string): TerritoryPolicy | null {
  const row = store.db.prepare(`SELECT t.id,t.participant_id,p.name,p.kind,t.mode,t.include_general,
      t.changed_by,t.changed_at
    FROM territory_policies t JOIN instances i ON i.id=t.instance_id
    JOIN participants p ON p.id=t.participant_id
    WHERE i.graph_id=? AND t.participant_id=?`).get(store.graphId, participant) as {
      id: string; participant_id: string; name: string; kind: 'human' | 'agent'; mode: TerritoryMode;
      include_general: number; changed_by: string; changed_at: number;
    } | undefined;
  if (row === undefined) return null;
  const rules = (store.db.prepare(`SELECT id,surface_kind,surface_id,disposition,permissions_json,
      governed_by,created_at FROM territory_surface_rules
    WHERE policy_id=? AND status='active' ORDER BY created_at,id`).all(row.id) as Array<{
      id: string; surface_kind: SurfaceKind; surface_id: string; disposition: SurfaceDisposition;
      permissions_json: string; governed_by: string; created_at: number;
    }>).map((one) => ({
      id: one.id, kind: one.surface_kind, surface: one.surface_id, disposition: one.disposition,
      permissions: parsePermissions(one.permissions_json), governedBy: one.governed_by, createdAt: one.created_at,
    }));
  return {
    id: row.id, participant: row.participant_id, participantName: row.name, participantKind: row.kind,
    mode: row.mode, includeGeneral: row.include_general === 1, rules,
    changedBy: row.changed_by, changedAt: row.changed_at,
  };
}

export function updateTerritoryPolicy(store: Store, input: {
  administrator: string;
  participant: string;
  mode: TerritoryMode;
  includeGeneral: boolean;
  rules: { kind: SurfaceKind; surface: string; disposition: SurfaceDisposition;
    permissions?: SurfacePermission[] }[];
}): TerritoryPolicy {
  const library = instance(store);
  if (input.administrator !== library.owner) throw new Error('sólo la persona dueña gobierna territorios');
  const policy = ensureTerritoryPolicy(store, input.participant, input.administrator);
  const available = new Set(librarySurfaces(store, null).map((surface) => `${surface.kind}:${surface.id}`));
  const seen = new Set<string>();
  for (const rule of input.rules) {
    const key = `${rule.kind}:${rule.surface}`;
    if (!available.has(key)) throw new Error('la superficie ya no está activa');
    if (seen.has(key)) throw new Error('una superficie sólo puede tener una regla activa');
    seen.add(key);
    const permissions = [...new Set(rule.permissions ?? [])].filter((one) => PERMISSIONS.has(one));
    if (rule.disposition === 'included' && permissions.length === 0) {
      throw new Error('una inclusión necesita al menos un permiso');
    }
    if (rule.disposition === 'excluded' && input.participant === library.owner) {
      const other = store.db.prepare(`SELECT 1 FROM surface_stewards s JOIN participants p ON p.id=s.human_id
        WHERE s.instance_id=? AND s.surface_kind=? AND s.surface_id=? AND s.status='active'
          AND s.human_id<>? AND p.kind='human' AND p.status='active' LIMIT 1`)
        .get(library.id, rule.kind, rule.surface, input.participant);
      if (other === undefined) throw new Error('la persona dueña no puede dejar una superficie sin otra custodia humana');
    }
  }
  const now = Date.now();
  store.db.exec('BEGIN');
  try {
    store.db.prepare(`UPDATE territory_policies SET mode=?,include_general=?,changed_by=?,changed_at=?
      WHERE id=?`).run(input.mode, input.includeGeneral ? 1 : 0, input.administrator, now, policy.id);
    store.db.prepare(`UPDATE territory_surface_rules SET status='removed',removed_at=?
      WHERE policy_id=? AND status='active'`).run(now, policy.id);
    const insert = store.db.prepare(`INSERT INTO territory_surface_rules
      (id,policy_id,surface_kind,surface_id,disposition,permissions_json,status,governed_by,created_at)
      VALUES (?,?,?,?,?,?,'active',?,?)`);
    for (const rule of input.rules) {
      insert.run(`surface-rule:${randomUUID()}`, policy.id, rule.kind, rule.surface, rule.disposition,
        JSON.stringify(rule.disposition === 'included' ? [...new Set(rule.permissions ?? [])] : []),
        input.administrator, now);
    }
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  return territoryPolicy(store, input.participant)!;
}

function stewardRows(store: Store, kind: SurfaceKind, surface: string): { participant: string; name: string }[] {
  return store.db.prepare(`SELECT s.human_id AS participant,p.name FROM surface_stewards s
    JOIN participants p ON p.id=s.human_id
    WHERE s.instance_id=(SELECT id FROM instances WHERE graph_id=?)
      AND s.surface_kind=? AND s.surface_id=? AND s.status='active'
    ORDER BY lower(p.name),p.id`).all(store.graphId, kind, surface) as { participant: string; name: string }[];
}

export function librarySurfaces(store: Store, graph: VeraGraph | null): TerritorySurface[] {
  const shared = sharedSpaces(store).filter((space) => space.status === 'active').map((space) => ({
    kind: 'shared' as const,
    id: space.id,
    name: space.name,
    pages: graph === null ? [] : graph.pages()
      .filter((page) => pageBelongsToSharedSpace(graph, space, page.id)).map((page) => page.id),
    stewards: stewardRows(store, 'shared', space.id),
  }));
  const publicSites = store.db.prepare(`SELECT p.id,p.title FROM personal_sites p
    JOIN instances i ON i.graph_id=p.graph_id WHERE i.graph_id=?`).all(store.graphId) as
    { id: string; title: string }[];
  const published = graph === null ? new Map<string, string[]>() : new Map(publicSites.map((site) => [
    site.id, graph.publicationsOf(site.id).map((publication) => publication.page),
  ]));
  return [...shared, ...publicSites.map((site) => ({
    kind: 'public' as const, id: site.id, name: site.title, pages: published.get(site.id) ?? [],
    stewards: stewardRows(store, 'public', site.id),
  }))];
}

export function territoryAdministration(store: Store, graph: VeraGraph): {
  surfaces: TerritorySurface[];
  policies: TerritoryPolicy[];
} {
  const participants = store.db.prepare(`SELECT m.participant_id FROM memberships m
    WHERE m.graph_id=? ORDER BY m.participant_id`).all(store.graphId) as { participant_id: string }[];
  const library = instance(store);
  const policies = participants.map((one) => ensureTerritoryPolicy(
    store, one.participant_id, library.owner,
    one.participant_id === library.owner ? { mode: 'all', includeGeneral: true } : undefined,
  ));
  return { surfaces: librarySurfaces(store, graph), policies };
}

function surfacesOfPage(store: Store, graph: VeraGraph, page: string): TerritorySurface[] {
  return librarySurfaces(store, graph).filter((surface) => surface.pages.includes(page));
}

function decide(policy: TerritoryPolicy, participant: string, page: string, action: ClearanceAction,
  surfaces: TerritorySurface[]): ClearanceDecision {
  const named = surfaces.map(({ kind, id, name }) => ({ kind, id, name }));
  const rules = policy.rules.filter((rule) => surfaces.some((surface) =>
    surface.kind === rule.kind && surface.id === rule.surface));
  const excluded = rules.find((rule) => rule.disposition === 'excluded');
  if (excluded !== undefined) {
    const surface = surfaces.find((one) => one.kind === excluded.kind && one.id === excluded.surface);
    return { outcome: 'refused', action, page, surfaces: named, failed: 'surface_exclusion',
      explanation: `la superficie «${surface?.name ?? excluded.surface}» está excluida del territorio`,
      correctionPath: `/administracion/bibliotecario#territorio-${encodeURIComponent(participant)}` };
  }
  if (policy.mode === 'all') {
    return { outcome: 'granted', action, page, surfaces: named, failed: null,
      explanation: 'la política incluye toda la biblioteca y no hay exclusiones aplicables', correctionPath: null };
  }
  if (surfaces.length === 0) {
    return policy.includeGeneral
      ? { outcome: 'granted', action, page, surfaces: [], failed: null,
          explanation: 'la biblioteca general está incluida', correctionPath: null }
      : { outcome: 'refused', action, page, surfaces: [], failed: 'general',
          explanation: 'la biblioteca general no está incluida en este territorio',
          correctionPath: `/administracion/bibliotecario#territorio-${encodeURIComponent(participant)}` };
  }
  const included = rules.find((rule) => rule.disposition === 'included' && rule.permissions.includes(action));
  return included !== undefined
    ? { outcome: 'granted', action, page, surfaces: named, failed: null,
        explanation: 'una superficie incluida concede esta acción', correctionPath: null }
    : { outcome: 'refused', action, page, surfaces: named, failed: 'surface_inclusion',
        explanation: `ninguna superficie incluida concede ${action}`,
        correctionPath: `/administracion/bibliotecario#territorio-${encodeURIComponent(participant)}` };
}

export function clearanceForPage(store: Store, graph: VeraGraph, participant: string,
  page: string, action: ClearanceAction): ClearanceDecision {
  const found = graph.page(page);
  if (found === undefined) {
    return { outcome: 'refused', action, page, surfaces: [], failed: 'general',
      explanation: 'la página no existe', correctionPath: null };
  }
  const library = instance(store);
  const policy = ensureTerritoryPolicy(store, participant, library.owner,
    participant === library.owner ? { mode: 'all', includeGeneral: true } : undefined);
  return decide(policy, participant, page, action, surfacesOfPage(store, graph, page));
}

/** Decide una acción que todavía no tiene página —por ejemplo, crear una en la
 * biblioteca general— sin fingir que pertenece a una superficie existente. */
export function clearanceForGeneral(store: Store, participant: string,
  action: ClearanceAction): ClearanceDecision {
  const library = instance(store);
  const policy = ensureTerritoryPolicy(store, participant, library.owner,
    participant === library.owner ? { mode: 'all', includeGeneral: true } : undefined);
  const granted = policy.mode === 'all' || policy.includeGeneral;
  return granted
    ? { outcome: 'granted', action, page: '', surfaces: [], failed: null,
        explanation: 'la política incluye la biblioteca general', correctionPath: null }
    : { outcome: 'refused', action, page: '', surfaces: [], failed: 'general',
        explanation: 'la biblioteca general no está incluida en este territorio',
        correctionPath: `/administracion/bibliotecario#territorio-${encodeURIComponent(participant)}` };
}

export function pagesWithinClearance(store: Store, graph: VeraGraph, participant: string,
  action: ClearanceAction): Set<string> {
  const library = instance(store);
  const policy = ensureTerritoryPolicy(store, participant, library.owner,
    participant === library.owner ? { mode: 'all', includeGeneral: true } : undefined);
  const surfaces = librarySurfaces(store, graph);
  return new Set(graph.pages().filter((page) => decide(
    policy,
    participant,
    page.id,
    action,
    surfaces.filter((surface) => surface.pages.includes(page.id)),
  ).outcome === 'granted').map((page) => page.id));
}
