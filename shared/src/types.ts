/**
 * Wire format for the AGV map, matching the supplied example file exactly.
 *
 * Orientation note that drives the whole app: North points along +X and West
 * points along +Y. See geometry.ts for the screen mapping.
 */

export const DIRECTIONS = ['North', 'East', 'South', 'West'] as const;

export type Direction = (typeof DIRECTIONS)[number];

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value);
}

/** Charger plug orientation. The AGV reverses along the opposite heading to dock. */
export interface Charger {
  direction: Direction;
}

/** Gravity conveyor. `direction` is the payload's travel direction on ejection. */
export interface Chute {
  direction: Direction;
}

export interface MapNode {
  /** Millimetres. North is +X. */
  x: number;
  /** Millimetres. West is +Y. */
  y: number;
  /** QR code painted on the floor. 0 means "not yet assigned". */
  code: number;
  /** Headings an AGV may leave this node on. Absent means the node is a sink. */
  directions?: Direction[];
  charger?: Charger;
  chute?: Chute;
  name?: string;
}

export interface AgvMap {
  /** Two aligned nodes further apart than this are not neighbours. Millimetres. */
  maxNeighborDistance: number;
  nodes: MapNode[];
}

/** The on-disk / on-the-wire document shape: `{ "map": { ... } }`. */
export interface MapDocument {
  map: AgvMap;
}

/**
 * A map plus a content-derived revision, used for optimistic concurrency.
 * Being content-derived rather than a counter means it survives a server
 * restart and two clients that save identical content don't conflict.
 */
export interface MapResource {
  revision: string;
  map: AgvMap;
}
