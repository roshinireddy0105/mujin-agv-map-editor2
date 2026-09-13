import { describe, expect, it } from 'vitest';
import sample from '../__fixtures__/sample-map.json';
import {
  DIRECTIONS,
  Direction,
  AgvMap,
  ORIENTATIONS,
  SCREEN_DIRECTION_VECTORS,
  OPPOSITE,
  alignedDistance,
  buildAdjacency,
  computeEdges,
  directionBetween,
  neighbourInDirection,
  screenBounds,
} from '../index';

const sampleMap = sample.map as AgvMap;

describe('orientation', () => {
  it('uses the written assignment headings when no orientation is supplied', () => {
    expect(directionBetween({ x: 0, y: 0 }, { x: 800, y: 0 })).toBe('North');
    expect(directionBetween({ x: 0, y: 0 }, { x: 0, y: 800 })).toBe('West');
    expect(directionBetween({ x: 0, y: 0 }, { x: -800, y: 0 })).toBe('South');
    expect(directionBetween({ x: 0, y: 0 }, { x: 0, y: -800 })).toBe('East');
  });
  it('renders the compass upright whichever convention is active', () => {
    // The invariant the whole rendering layer depends on: no component needs to
    // know which convention is in use, because North is always screen-up.
    for (const orientation of Object.values(ORIENTATIONS)) {
      for (const direction of DIRECTIONS) {
        const from = { x: 0, y: 0 };
        const step = orientation.vectors[direction];
        const to = { x: from.x + step.dx * 100, y: from.y + step.dy * 100 };
        const a = orientation.toScreen(from);
        const b = orientation.toScreen(to);
        const expected = SCREEN_DIRECTION_VECTORS[direction];
        expect(Math.sign(b.sx - a.sx)).toBe(expected.dx);
        expect(Math.sign(b.sy - a.sy)).toBe(expected.dy);
      }
    }
  });

  it('round-trips map coordinates through screen space', () => {
    for (const orientation of Object.values(ORIENTATIONS)) {
      const point = { x: 4778, y: 12910 };
      expect(orientation.fromScreen(orientation.toScreen(point))).toEqual(point);
    }
  });

  it('pairs opposite headings', () => {
    for (const direction of DIRECTIONS) {
      expect(OPPOSITE[OPPOSITE[direction]]).toBe(direction);
    }
  });
});

/**
 * The brief states North = +X, West = +Y. The sample map disagrees. These two
 * tests are the evidence, kept executable so the choice of default cannot
 * silently rot.
 */
describe('which orientation the sample map actually uses', () => {
  function danglingDirectionCount(map: AgvMap, orientationId: 'mapData' | 'specText'): number {
    const orientation = ORIENTATIONS[orientationId];
    const edges = computeEdges(map, orientation);
    let count = 0;
    map.nodes.forEach((node, index) => {
      for (const direction of node.directions ?? []) {
        if (neighbourInDirection(index, direction, edges) === null) count += 1;
      }
    });
    return count;
  }

  it('resolves every direction annotation under North = +Y', () => {
    const total = sampleMap.nodes.reduce((sum, n) => sum + (n.directions?.length ?? 0), 0);
    expect(total).toBe(73);
    expect(danglingDirectionCount(sampleMap, 'mapData')).toBe(0);
  });

  it('leaves directions pointing at empty floor under the brief’s literal North = +X', () => {
    expect(danglingDirectionCount(sampleMap, 'specText')).toBe(20);
  });

  it('places a neighbour on the plug side of every charger under North = +Y', () => {
    const edges = computeEdges(sampleMap, ORIENTATIONS.mapData);
    const chargers = sampleMap.nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.charger);

    expect(chargers).toHaveLength(2);
    for (const { node, index } of chargers) {
      const plug = node.charger!.direction;
      expect(neighbourInDirection(index, plug, edges)).not.toBeNull();
    }
  });
});

describe('directionBetween', () => {
  const orientation = ORIENTATIONS.mapData;

  it('reads headings off the active convention', () => {
    expect(directionBetween({ x: 0, y: 0 }, { x: 0, y: 800 }, orientation)).toBe('North');
    expect(directionBetween({ x: 0, y: 0 }, { x: 0, y: -800 }, orientation)).toBe('South');
    expect(directionBetween({ x: 0, y: 0 }, { x: 800, y: 0 }, orientation)).toBe('East');
    expect(directionBetween({ x: 0, y: 0 }, { x: -800, y: 0 }, orientation)).toBe('West');
  });

  it('refuses diagonals, however slight', () => {
    expect(directionBetween({ x: 0, y: 0 }, { x: 800, y: 800 }, orientation)).toBeNull();
    // One millimetre off axis is still off axis. An AGV cannot drive it.
    expect(directionBetween({ x: 0, y: 0 }, { x: 1, y: 800 }, orientation)).toBeNull();
  });

  it('returns null for a node against itself', () => {
    expect(directionBetween({ x: 10, y: 10 }, { x: 10, y: 10 }, orientation)).toBeNull();
  });

  it('flips with the convention', () => {
    const step = { x: 0, y: 800 };
    expect(directionBetween({ x: 0, y: 0 }, step, ORIENTATIONS.mapData)).toBe('North');
    expect(directionBetween({ x: 0, y: 0 }, step, ORIENTATIONS.specText)).toBe('West');
  });
});

describe('alignedDistance', () => {
  it('measures along whichever axis is shared', () => {
    expect(alignedDistance({ x: 100, y: 0 }, { x: 100, y: 900 })).toBe(900);
    expect(alignedDistance({ x: 0, y: 100 }, { x: 900, y: 100 })).toBe(900);
  });

  it('is null when nothing is shared', () => {
    expect(alignedDistance({ x: 0, y: 0 }, { x: 5, y: 5 })).toBeNull();
  });
});

describe('computeEdges', () => {
  const map = (nodes: AgvMap['nodes'], maxNeighborDistance = 1500): AgvMap => ({
    maxNeighborDistance,
    nodes,
  });

  it('connects aligned nodes inside the distance limit', () => {
    const edges = computeEdges(
      map([
        { x: 0, y: 0, code: 1, directions: ['North'] },
        { x: 800, y: 0, code: 2, directions: ['South'] },
      ]),
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].distanceMm).toBe(800);
    expect(edges[0].headingAB).toBe('North');
    expect(edges[0].passableAB).toBe(true);
    expect(edges[0].passableBA).toBe(true);
  });

  it('drops pairs beyond maxNeighborDistance', () => {
    const edges = computeEdges(
      map([
        { x: 0, y: 0, code: 1 },
        { x: 0, y: 1501, code: 2 },
      ]),
    );
    expect(edges).toHaveLength(0);
  });

  it('never connects nodes that are not exactly aligned', () => {
    const edges = computeEdges(
      map([
        { x: 0, y: 0, code: 1 },
        { x: 1, y: 800, code: 2 },
      ]),
    );
    expect(edges).toHaveLength(0);
  });

  it('does not tunnel a lane through an occluding node', () => {
    // 0 -> 1410 is inside the 1500 limit, but 705 sits between them.
    const edges = computeEdges(
      map([
        { x: 0, y: 0, code: 1 },
        { x: 0, y: 705, code: 2 },
        { x: 0, y: 1410, code: 3 },
      ]),
    );
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.distanceMm)).toEqual([705, 705]);
    expect(edges.some((e) => e.a === 0 && e.b === 2)).toBe(false);
  });

  it('reproduces the occlusion case from the sample map', () => {
    const column = sampleMap.nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.x === 1000);
    const edges = computeEdges(sampleMap, ORIENTATIONS.mapData);
    const y2700 = column.find(({ node }) => node.y === 2700)!.index;
    const y4110 = column.find(({ node }) => node.y === 4110)!.index;
    const direct = edges.find(
      (e) =>
        (e.a === y2700 && e.b === y4110) || (e.a === y4110 && e.b === y2700),
    );
    expect(direct).toBeUndefined();
  });

  it('marks one-way lanes asymmetrically', () => {
    const edges = computeEdges(
      map([
        { x: 0, y: 0, code: 1, directions: ['North'] },
        { x: 800, y: 0, code: 2 },
      ]),
    );
    expect(edges[0].passableAB).toBe(true);
    expect(edges[0].passableBA).toBe(false);
  });

  it('finds 75 lanes and no isolated node in the sample map', () => {
    const edges = computeEdges(sampleMap, ORIENTATIONS.mapData);
    expect(edges).toHaveLength(75);
    const adjacency = buildAdjacency(sampleMap.nodes.length, edges);
    expect(adjacency.filter((list) => list.length === 0)).toHaveLength(0);
  });

  it('gives every edge a stable id with the lower index first', () => {
    const edges = computeEdges(sampleMap, ORIENTATIONS.mapData);
    for (const edge of edges) {
      expect(edge.id).toBe(`${Math.min(edge.a, edge.b)}-${Math.max(edge.a, edge.b)}`);
    }
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
  });
});

describe('neighbourInDirection', () => {
  it('looks both ways along an edge', () => {
    const map: AgvMap = {
      maxNeighborDistance: 1500,
      nodes: [
        { x: 0, y: 0, code: 1 },
        { x: 0, y: 800, code: 2 },
      ],
    };
    const edges = computeEdges(map, ORIENTATIONS.mapData);
    expect(neighbourInDirection(0, 'North', edges)).toBe(1);
    expect(neighbourInDirection(1, 'South', edges)).toBe(0);
    expect(neighbourInDirection(0, 'East' as Direction, edges)).toBeNull();
  });
});

describe('screenBounds', () => {
  it('is null for an empty map', () => {
    expect(screenBounds([], ORIENTATIONS.mapData)).toBeNull();
  });

  it('pads the extent by the margin', () => {
    const bounds = screenBounds(
      [
        { x: 0, y: 0, code: 1 },
        { x: 1000, y: 2000, code: 2 },
      ],
      ORIENTATIONS.mapData,
      100,
    )!;
    expect(bounds.minX).toBe(-100);
    expect(bounds.maxX).toBe(1100);
    // North is +Y and screen y grows downward, so y=2000 is the *top*.
    expect(bounds.minY).toBe(-2100);
    expect(bounds.maxY).toBe(100);
  });
});
