import { Direction } from './types';

/**
 * Follow the assessment's North = +X, West = +Y convention by default.
 * The alternate sample-data interpretation remains available for comparison.
 */
export type OrientationId = 'mapData' | 'specText';

export interface ScreenPoint {
  sx: number;
  sy: number;
}

export interface Orientation {
  id: OrientationId;
  label: string;
  /** One-line explanation shown next to the toggle in the editor. */
  note: string;
  /** Unit step per heading, in map millimetres. */
  vectors: Record<Direction, { dx: number; dy: number }>;
  /** Map millimetres to drawing units, compass upright. */
  toScreen(point: { x: number; y: number }): ScreenPoint;
  /** Inverse of toScreen. */
  fromScreen(point: ScreenPoint): { x: number; y: number };
}

/**
 * Step per heading in *drawing* units. Identical for every orientation by
 * construction: each `toScreen` is chosen so North renders up and East renders
 * right. That invariant means no rendering code has to know which convention
 * is active, and it is asserted in geometry.test.ts.
 */
export const SCREEN_DIRECTION_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  North: { dx: 0, dy: -1 },
  East: { dx: 1, dy: 0 },
  South: { dx: 0, dy: 1 },
  West: { dx: -1, dy: 0 },
};

export const OPPOSITE: Record<Direction, Direction> = {
  North: 'South',
  South: 'North',
  East: 'West',
  West: 'East',
};

/** North = +Y, East = +X. Matches the sample map. */
const mapData: Orientation = {
  id: 'mapData',
  label: 'North = +Y',
  note: 'Alternate convention: North = +Y, East = +X.',
  vectors: {
    North: { dx: 0, dy: 1 },
    South: { dx: 0, dy: -1 },
    East: { dx: 1, dy: 0 },
    West: { dx: -1, dy: 0 },
  },
  toScreen: ({ x, y }) => ({ sx: x, sy: -y }),
  fromScreen: ({ sx, sy }) => ({ x: sx, y: -sy }),
};

/** North = +X, West = +Y. The literal wording of the brief. */
const specText: Orientation = {
  id: 'specText',
  label: 'North = +X',
  note: 'Assignment convention: North = +X, West = +Y. North is shown upward.',
  vectors: {
    North: { dx: 1, dy: 0 },
    South: { dx: -1, dy: 0 },
    West: { dx: 0, dy: 1 },
    East: { dx: 0, dy: -1 },
  },
  toScreen: ({ x, y }) => ({ sx: -y, sy: -x }),
  fromScreen: ({ sx, sy }) => ({ x: -sy, y: -sx }),
};

export const ORIENTATIONS: Record<OrientationId, Orientation> = { mapData, specText };

export const DEFAULT_ORIENTATION: Orientation = specText;

export function orientationById(id: OrientationId | undefined): Orientation {
  return (id && ORIENTATIONS[id]) || DEFAULT_ORIENTATION;
}
