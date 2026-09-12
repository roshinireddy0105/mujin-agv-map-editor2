import { AgvMap, DIRECTIONS, Direction, MapDocument, isDirection } from './types';
import { DEFAULT_ORIENTATION, OPPOSITE, Orientation } from './orientation';
import { buildAdjacency, computeEdges, neighbourInDirection } from './geometry';

export type IssueSeverity = 'error' | 'warning';

export interface Issue {
  code: string;
  severity: IssueSeverity;
  message: string;
  /** Index into `map.nodes`, when the issue concerns one node. */
  nodeIndex?: number;
}

export interface ValidationResult {
  errors: Issue[];
  warnings: Issue[];
}

export function isValid(result: ValidationResult): boolean {
  return result.errors.length === 0;
}

function label(map: AgvMap, index: number): string {
  const node = map.nodes[index];
  const name = node.name ? `${node.name} ` : '';
  return `${name}(${node.x}, ${node.y})`;
}

/**
 * Structural parse of untrusted input, run before the semantic rules so a
 * malformed payload produces a readable message instead of a type error deep
 * in the graph code.
 */
export function parseMapDocument(input: unknown): { map: AgvMap } | { errors: Issue[] } {
  const errors: Issue[] = [];
  const fail = (code: string, message: string) =>
    errors.push({ code, severity: 'error', message });

  if (typeof input !== 'object' || input === null) {
    return {
      errors: [{ code: 'E000', severity: 'error', message: 'Body must be a JSON object.' }],
    };
  }

  const raw = (input as Partial<MapDocument>).map;
  if (typeof raw !== 'object' || raw === null) {
    return {
      errors: [
        { code: 'E000', severity: 'error', message: 'Body must contain a "map" object.' },
      ],
    };
  }

  const candidate = raw as Partial<AgvMap>;
  if (!Number.isFinite(candidate.maxNeighborDistance)) {
    fail('E001', 'maxNeighborDistance must be a number.');
  }
  if (!Array.isArray(candidate.nodes)) {
    fail('E002', 'map.nodes must be an array.');
    return { errors };
  }

  candidate.nodes.forEach((node, index) => {
    if (typeof node !== 'object' || node === null) {
      fail('E003', `Node ${index} is not an object.`);
      return;
    }
    const n = node as unknown as Record<string, unknown>;

    for (const key of ['x', 'y', 'code'] as const) {
      if (!Number.isFinite(n[key])) {
        fail('E003', `Node ${index}: "${key}" must be a number.`);
      }
    }

    if (n.directions !== undefined) {
      if (!Array.isArray(n.directions)) {
        fail('E004', `Node ${index}: "directions" must be an array.`);
      } else if (!n.directions.every(isDirection)) {
        fail('E004', `Node ${index}: "directions" may only contain ${DIRECTIONS.join(', ')}.`);
      }
    }

    for (const key of ['charger', 'chute'] as const) {
      const feature = n[key];
      if (feature === undefined) continue;
      if (typeof feature !== 'object' || feature === null) {
        fail('E005', `Node ${index}: "${key}" must be an object.`);
        continue;
      }
      if (!isDirection((feature as Record<string, unknown>).direction)) {
        fail(
          'E005',
          `Node ${index}: "${key}.direction" must be one of ${DIRECTIONS.join(', ')}.`,
        );
      }
    }

    if (n.name !== undefined && typeof n.name !== 'string') {
      fail('E006', `Node ${index}: "name" must be a string.`);
    }
  });

  if (errors.length > 0) return { errors };
  return { map: candidate as AgvMap };
}

/**
 * Semantic rules.
 *
 * Errors mean the map is not physically coherent and are rejected on save.
 * Warnings are surfaced in the editor but never block a save, because a
 * half-built map legitimately has dangling lanes while you are working on it —
 * refusing to persist work in progress would make the editor hostile.
 */
export function validateMap(
  map: AgvMap,
  orientation: Orientation = DEFAULT_ORIENTATION,
): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const error = (code: string, message: string, nodeIndex?: number) =>
    errors.push({ code, severity: 'error', message, nodeIndex });
  const warn = (code: string, message: string, nodeIndex?: number) =>
    warnings.push({ code, severity: 'warning', message, nodeIndex });

  if (!Number.isInteger(map.maxNeighborDistance) || map.maxNeighborDistance <= 0) {
    error('E010', 'maxNeighborDistance must be a positive whole number of millimetres.');
  }

  const byPosition = new Map<string, number[]>();
  const byCode = new Map<number, number[]>();
  const byName = new Map<string, number[]>();

  map.nodes.forEach((node, index) => {
    if (!Number.isInteger(node.x) || !Number.isInteger(node.y)) {
      error('E011', `${label(map, index)}: coordinates must be whole millimetres.`, index);
    }
    if (!Number.isInteger(node.code)) {
      error('E012', `${label(map, index)}: code must be a whole number.`, index);
    }

    const positionKey = `${node.x}:${node.y}`;
    (byPosition.get(positionKey) ?? byPosition.set(positionKey, []).get(positionKey)!).push(
      index,
    );

    // Code 0 is the sample map's "not yet assigned" marker, so it may repeat.
    if (node.code !== 0) {
      (byCode.get(node.code) ?? byCode.set(node.code, []).get(node.code)!).push(index);
    }
    if (node.name) {
      (byName.get(node.name) ?? byName.set(node.name, []).get(node.name)!).push(index);
    }

    const directions = node.directions ?? [];
    if (new Set<Direction>(directions).size !== directions.length) {
      warn('W010', `${label(map, index)}: repeated entries in directions.`, index);
    }
  });

  for (const [key, indices] of byPosition) {
    if (indices.length > 1) {
      const [x, y] = key.split(':');
      error(
        'E013',
        `${indices.length} nodes share the position (${x}, ${y}). Positions must be unique.`,
        indices[0],
      );
    }
  }
  for (const [code, indices] of byCode) {
    if (indices.length > 1) {
      error(
        'E014',
        `QR code ${code} is on ${indices.length} nodes. Codes must be unique, or 0 when unassigned.`,
        indices[0],
      );
    }
  }
  for (const [name, indices] of byName) {
    if (indices.length > 1) {
      warn('W011', `The name "${name}" is on ${indices.length} nodes.`, indices[0]);
    }
  }

  // Everything below assumes unique, whole-millimetre positions.
  if (errors.length > 0) return { errors, warnings };

  const edges = computeEdges(map, orientation);
  const adjacency = buildAdjacency(map.nodes.length, edges);

  map.nodes.forEach((node, index) => {
    if (map.nodes.length > 1 && adjacency[index].length === 0) {
      warn(
        'W012',
        `${label(map, index)} has no neighbour within ${map.maxNeighborDistance}mm on either axis.`,
        index,
      );
    }

    const directions = node.directions ?? [];
    if (directions.length === 0) {
      warn(
        'W013',
        `${label(map, index)} has no exit directions, so an AGV that arrives cannot leave.`,
        index,
      );
    }
    for (const direction of directions) {
      if (neighbourInDirection(index, direction, edges) === null) {
        warn(
          'W014',
          `${label(map, index)} allows travel ${direction} but there is no neighbour that way.`,
          index,
        );
      }
    }

    // The plug points one way and the AGV reverses in along the opposite
    // heading, so it must approach from the plug side. Both chargers in the
    // sample map satisfy this.
    if (node.charger) {
      const approach = node.charger.direction;
      if (neighbourInDirection(index, approach, edges) === null) {
        warn(
          'W016',
          `${label(map, index)} has a charger with its plug facing ${approach}, so an AGV must reverse in from the ${approach} side, but there is no neighbour there.`,
          index,
        );
      }
      // Deliberately not checked: whether the node also permits travel back out
      // along the plug direction. CHRG1 in the sample map reverses in from the
      // West and then departs South, which is perfectly drivable, so requiring
      // the outbound heading to mirror the plug would flag a valid charger.
    }
  });

  for (const edge of edges) {
    if (!edge.passableAB && !edge.passableBA) {
      warn(
        'W015',
        `The lane between ${label(map, edge.a)} and ${label(map, edge.b)} cannot be driven either way.`,
        edge.a,
      );
    }
  }

  return { errors, warnings };
}

/** Headings that would reach a real neighbour from the given node. */
export function availableDirections(
  map: AgvMap,
  index: number,
  orientation: Orientation = DEFAULT_ORIENTATION,
): Direction[] {
  const edges = computeEdges(map, orientation);
  return DIRECTIONS.filter(
    (direction) => neighbourInDirection(index, direction, edges) !== null,
  );
}

export { OPPOSITE };
