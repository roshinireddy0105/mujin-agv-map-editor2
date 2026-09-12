import type { AgvMap } from '@agv/shared';

export interface SnapResult {
  x: number;
  y: number;
  /** x was pulled onto an existing column. */
  snappedX: boolean;
  /** y was pulled onto an existing row. */
  snappedY: boolean;
}

/**
 * Pull a dragged position onto an existing row or column.
 *
 * Two nodes are only connectable when an axis matches *exactly*, so a drag that
 * lands 3mm off is not a near miss — it silently destroys a lane. Snapping the
 * axes independently is what makes dragging safe: you can slide a node along
 * its own aisle while staying aligned with it.
 *
 * Tolerance is supplied in millimetres by the caller, derived from the current
 * zoom, so the pull feels the same at every scale.
 */
export function snapToAlignment(
  raw: { x: number; y: number },
  map: AgvMap,
  excludeIndex: number | null,
  toleranceMm: number,
): SnapResult {
  let x = Math.round(raw.x);
  let y = Math.round(raw.y);
  let snappedX = false;
  let snappedY = false;

  let bestX = toleranceMm;
  let bestY = toleranceMm;

  map.nodes.forEach((node, index) => {
    if (index === excludeIndex) return;
    const dx = Math.abs(node.x - raw.x);
    if (dx <= bestX) {
      bestX = dx;
      x = node.x;
      snappedX = true;
    }
    const dy = Math.abs(node.y - raw.y);
    if (dy <= bestY) {
      bestY = dy;
      y = node.y;
      snappedY = true;
    }
  });

  return { x, y, snappedX, snappedY };
}

/** True when a position is already taken, which validation treats as an error. */
export function isPositionTaken(
  map: AgvMap,
  position: { x: number; y: number },
  excludeIndex: number | null,
): boolean {
  return map.nodes.some(
    (node, index) =>
      index !== excludeIndex && node.x === position.x && node.y === position.y,
  );
}
