import type { GraphNode } from './types.ts';

type Axis = 'x' | 'y' | 'z';
type Velocity = 'vx' | 'vy' | 'vz';
type SpatialGraphNode = GraphNode & { z?: number; vz?: number };

export interface ConceptGroup {
  key: string;
  label: string;
  members: SpatialGraphNode[];
  /** Pull per member before the simulation alpha and distance are applied. */
  attraction: number;
}

export interface ConceptGravityForce {
  (alpha: number): void;
  initialize(nodes: SpatialGraphNode[]): void;
}

// A shared rare concept remains an order of magnitude weaker than an explicit
// d3 link (roughly 0.04 versus 0.3–1), but is strong enough to be legible after
// the map settles rather than merely mathematically present.
const ATTRACTION = 0.06;
const CENTRE_REPULSION = 900;
const MIN_CENTRE_DISTANCE = 18;

const conceptKey = (value: string): string => value.trim().toLocaleLowerCase('es');

/**
 * Builds the conceptual centres that exist in this visible neighbourhood.
 * Singletons exert no force: without another visible page there is no spatial
 * relation to express. Broad concepts pull less strongly than rare ones.
 *
 * @guarantee ConceptsShapeSpaceWithoutInventingConnections
 * @guarantee ConceptualCentresResistCollapse
 */
export function conceptGroups(nodes: SpatialGraphNode[]): ConceptGroup[] {
  const grouped = new Map<string, { label: string; members: SpatialGraphNode[] }>();
  for (const node of nodes) {
    const own = new Set<string>();
    for (const raw of node.concepts ?? []) {
      const key = conceptKey(raw);
      if (key === '' || own.has(key)) continue;
      own.add(key);
      const held = grouped.get(key) ?? { label: raw.trim(), members: [] };
      held.members.push(node);
      grouped.set(key, held);
    }
  }
  return [...grouped]
    .filter(([, group]) => group.members.length >= 2)
    .map(([key, group]) => ({
      key,
      label: group.label,
      members: group.members,
      attraction: ATTRACTION / Math.sqrt(group.members.length),
    }));
}

const stableDirection = (left: string, right: string, dimensions: 2 | 3): number[] => {
  let hash = 2166136261;
  for (const char of `${left}\u0000${right}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  const angle = ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
  if (dimensions === 2) return [Math.cos(angle), Math.sin(angle)];
  const elevation = ((((hash >>> 8) & 0xffff) / 0xffff) - 0.5) * Math.PI;
  return [
    Math.cos(angle) * Math.cos(elevation),
    Math.sin(angle) * Math.cos(elevation),
    Math.sin(elevation),
  ];
};

const coordinate = (node: SpatialGraphNode, axis: Axis): number => {
  const value = node[axis];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const addVelocity = (node: SpatialGraphNode, axis: Velocity, amount: number): void => {
  const held = node[axis];
  node[axis] = (typeof held === 'number' && Number.isFinite(held) ? held : 0) + amount;
};

/**
 * A dimension-independent force shared by the 2D and 3D maps. Conceptual
 * centres are centroids, not graph nodes: nothing invented here can be opened,
 * traversed or persisted. Their mutual repulsion is applied back to the pages
 * that constitute them.
 */
export function conceptGravity(dimensions: 2 | 3, intensity = 1): ConceptGravityForce {
  let groups: ConceptGroup[] = [];
  let memberships = new Map<string, number>();
  const axes: Axis[] = dimensions === 2 ? ['x', 'y'] : ['x', 'y', 'z'];
  const velocities: Velocity[] = dimensions === 2 ? ['vx', 'vy'] : ['vx', 'vy', 'vz'];

  const force = ((alpha: number): void => {
    if (groups.length === 0 || alpha <= 0) return;
    const centres = groups.map((group) => axes.map((axis) =>
      group.members.reduce((sum, node) => sum + coordinate(node, axis), 0) /
        group.members.length,
    ));

    // Pages approach each shared conceptual centre. Dividing by the square root
    // of a page's memberships makes two concepts matter more than one without
    // letting a long property list dominate every explicit link.
    groups.forEach((group, groupIndex) => {
      for (const node of group.members) {
        const diminishing = Math.sqrt(memberships.get(node.id) ?? 1);
        axes.forEach((axis, axisIndex) => {
          const delta = centres[groupIndex]![axisIndex]! - coordinate(node, axis);
          addVelocity(node, velocities[axisIndex]!, delta * group.attraction * intensity * alpha / diminishing);
        });
      }
    });

    // Conceptual centres repel one another. Rarity weights the separation too:
    // a term shared by half the visible corpus must not shove every other concern
    // to the perimeter merely because it is broad.
    for (let left = 0; left < groups.length; left += 1) {
      for (let right = left + 1; right < groups.length; right += 1) {
        let delta = axes.map((_, axis) => centres[right]![axis]! - centres[left]![axis]!);
        let distanceSquared = delta.reduce((sum, value) => sum + value * value, 0);
        if (distanceSquared < 1e-6) {
          delta = stableDirection(groups[left]!.key, groups[right]!.key, dimensions)
            .map((value) => value * MIN_CENTRE_DISTANCE);
          distanceSquared = MIN_CENTRE_DISTANCE * MIN_CENTRE_DISTANCE;
        }
        const distance = Math.sqrt(distanceSquared);
        const rarity = 1 / Math.sqrt(
          groups[left]!.members.length * groups[right]!.members.length,
        );
        const impulse = CENTRE_REPULSION * rarity * intensity * alpha /
          Math.max(distanceSquared, MIN_CENTRE_DISTANCE * MIN_CENTRE_DISTANCE);
        axes.forEach((_, axisIndex) => {
          const amount = delta[axisIndex]! / distance * impulse;
          for (const node of groups[left]!.members) {
            addVelocity(node, velocities[axisIndex]!, -amount);
          }
          for (const node of groups[right]!.members) {
            addVelocity(node, velocities[axisIndex]!, amount);
          }
        });
      }
    }
  }) as ConceptGravityForce;

  force.initialize = (nodes: SpatialGraphNode[]): void => {
    groups = conceptGroups(nodes);
    memberships = new Map();
    for (const group of groups) {
      for (const member of group.members) {
        memberships.set(member.id, (memberships.get(member.id) ?? 0) + 1);
      }
    }
  };

  return force;
}
