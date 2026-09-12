import { AgvMap, Direction, MapNode } from './types';
import {
  DEFAULT_ORIENTATION,
  OPPOSITE,
  Orientation,
  ScreenPoint,
  SCREEN_DIRECTION_VECTORS,
} from './orientation';

export { OPPOSITE, SCREEN_DIRECTION_VECTORS };
export type { ScreenPoint };

/**
 * The heading to travel from `a` to `b`, or null when the two are not exactly
 * axis-aligned. Near-alignment is not alignment: an AGV cannot travel
 * diagonally, so a 1mm offset means no connection at all rather than a
 * slightly crooked one. This is why the editor snaps while dragging.
 */
export function directionBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
  orientation: Orientation = DEFAULT_ORIENTATION,
): Direction | null {
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  if (dx === 0 && dy === 0) return null;
  if (dx !== 0 && dy !== 0) return null;
  const found = (Object.keys(orientation.vectors) as Direction[]).find((key) => {
    const v = orientation.vectors[key];
    return v.dx === dx && v.dy === dy;
  });
  return found ?? null;
}

/** Axis-aligned distance in millimetres, or null if the pair is not aligned. */
export function alignedDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number | null {
  if (a.x === b.x) return Math.abs(b.y - a.y);
  if (a.y === b.y) return Math.abs(b.x - a.x);
  return null;
}

export interface Edge {
  /** Stable key from the endpoint indices, lower index first. */
  id: string;
  a: number;
  b: number;
  /** The coordinate the two endpoints share. */
  sharedAxis: 'x' | 'y';
  distanceMm: number;
  /** Heading from a to b under the active orientation. */
  headingAB: Direction;
  /** An AGV may drive a -> b, i.e. node a permits that heading. */
  passableAB: boolean;
  /** An AGV may drive b -> a. */
  passableBA: boolean;
}

function permits(node: MapNode, direction: Direction): boolean {
  return node.directions?.includes(direction) ?? false;
}

/**
 * Neighbour set for the map.
 *
 * Two nodes are neighbours when they share an x or a y value exactly, sit no
 * further apart than `maxNeighborDistance`, and have no third node between
 * them on that line.
 *
 * That last rule earns its keep. In the sample map the column at x=1000 holds
 * nodes at y=2700 and y=4110 — 1410mm apart, inside the 1500mm limit — but
 * y=3405 sits between them. Without the occlusion rule the editor would draw a
 * phantom lane straight through an existing node. Sorting each line and
 * keeping only consecutive pairs enforces it for free.
 */
export function computeEdges(
  map: AgvMap,
  orientation: Orientation = DEFAULT_ORIENTATION,
): Edge[] {
  const limit = map.maxNeighborDistance;
  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (const sharedAxis of ['x', 'y'] as const) {
    const varyingAxis = sharedAxis === 'x' ? 'y' : 'x';
    const lines = new Map<number, number[]>();

    map.nodes.forEach((node, index) => {
      const key = node[sharedAxis];
      const bucket = lines.get(key);
      if (bucket) bucket.push(index);
      else lines.set(key, [index]);
    });

    for (const indices of lines.values()) {
      if (indices.length < 2) continue;
      const sorted = [...indices].sort(
        (i, j) => map.nodes[i][varyingAxis] - map.nodes[j][varyingAxis],
      );

      for (let k = 0; k + 1 < sorted.length; k += 1) {
        const a = sorted[k];
        const b = sorted[k + 1];
        const nodeA = map.nodes[a];
        const nodeB = map.nodes[b];

        const distanceMm = alignedDistance(nodeA, nodeB);
        if (distanceMm === null || distanceMm === 0 || distanceMm > limit) continue;

        const id = `${Math.min(a, b)}-${Math.max(a, b)}`;
        if (seen.has(id)) continue; // co-located duplicates appear on both axes
        seen.add(id);

        const headingAB = directionBetween(nodeA, nodeB, orientation);
        if (!headingAB) continue;

        edges.push({
          id,
          a,
          b,
          sharedAxis,
          distanceMm,
          headingAB,
          passableAB: permits(nodeA, headingAB),
          passableBA: permits(nodeB, OPPOSITE[headingAB]),
        });
      }
    }
  }

  return edges;
}

/** Neighbour indices per node. */
export function buildAdjacency(nodeCount: number, edges: Edge[]): number[][] {
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const edge of edges) {
    adjacency[edge.a].push(edge.b);
    adjacency[edge.b].push(edge.a);
  }
  return adjacency;
}

/** The neighbour reachable from `index` on the given heading, if any. */
export function neighbourInDirection(
  index: number,
  direction: Direction,
  edges: Edge[],
): number | null {
  for (const edge of edges) {
    if (edge.a === index && edge.headingAB === direction) return edge.b;
    if (edge.b === index && OPPOSITE[edge.headingAB] === direction) return edge.a;
  }
  return null;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Bounding box in drawing units, padded by a millimetre margin. */
export function screenBounds(
  nodes: MapNode[],
  orientation: Orientation = DEFAULT_ORIENTATION,
  marginMm = 800,
): Bounds | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const { sx, sy } = orientation.toScreen(node);
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  return {
    minX: minX - marginMm,
    maxX: maxX + marginMm,
    minY: minY - marginMm,
    maxY: maxY + marginMm,
  };
}
