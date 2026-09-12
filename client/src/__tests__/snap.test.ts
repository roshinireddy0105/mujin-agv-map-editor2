import { describe, expect, it } from 'vitest';
import type { AgvMap } from '@agv/shared';
import { isPositionTaken, snapToAlignment } from '../lib/snap';

const map: AgvMap = {
  maxNeighborDistance: 1500,
  nodes: [
    { x: 1000, y: 1000, code: 1 },
    { x: 1000, y: 1900, code: 2 },
    { x: 1800, y: 1000, code: 3 },
  ],
};

describe('snapToAlignment', () => {
  it('rounds to whole millimetres', () => {
    const result = snapToAlignment({ x: 5000.6, y: 4999.4 }, map, null, 0);
    expect(result.x).toBe(5001);
    expect(result.y).toBe(4999);
  });

  it('pulls onto an existing column and row independently', () => {
    // Near the x=1000 column and the y=1900 row, but not on either exactly.
    const result = snapToAlignment({ x: 1004, y: 1893 }, map, null, 20);
    expect(result).toMatchObject({ x: 1000, y: 1900, snappedX: true, snappedY: true });
  });

  it('snaps one axis while leaving the other free', () => {
    // This is the case that matters: sliding a node along its own aisle.
    const result = snapToAlignment({ x: 1002, y: 6400 }, map, null, 20);
    expect(result.x).toBe(1000);
    expect(result.snappedX).toBe(true);
    expect(result.y).toBe(6400);
    expect(result.snappedY).toBe(false);
  });

  it('ignores a candidate outside the tolerance', () => {
    const result = snapToAlignment({ x: 1400, y: 1400 }, map, null, 20);
    expect(result).toMatchObject({ x: 1400, y: 1400, snappedX: false, snappedY: false });
  });

  it('does not snap a node to itself', () => {
    // Node 0 nudged 4mm; without the exclusion it would never be able to leave
    // its own column.
    const result = snapToAlignment({ x: 1004, y: 1004 }, map, 0, 20);
    expect(result.x).toBe(1000); // still pulled by node 1's column
    const alone = snapToAlignment({ x: 1004, y: 1004 }, { ...map, nodes: [map.nodes[0]] }, 0, 20);
    expect(alone).toMatchObject({ x: 1004, y: 1004, snappedX: false, snappedY: false });
  });

  it('prefers the nearest candidate on each axis', () => {
    const crowded: AgvMap = {
      maxNeighborDistance: 1500,
      nodes: [
        { x: 990, y: 0, code: 1 },
        { x: 1010, y: 0, code: 2 },
      ],
    };
    expect(snapToAlignment({ x: 1008, y: 500 }, crowded, null, 50).x).toBe(1010);
    expect(snapToAlignment({ x: 992, y: 500 }, crowded, null, 50).x).toBe(990);
  });
});

describe('isPositionTaken', () => {
  it('detects a collision, excluding the node being moved', () => {
    expect(isPositionTaken(map, { x: 1000, y: 1900 }, null)).toBe(true);
    expect(isPositionTaken(map, { x: 1000, y: 1900 }, 1)).toBe(false);
    expect(isPositionTaken(map, { x: 4000, y: 4000 }, null)).toBe(false);
  });
});
