import { AgvMap, MapNode } from './types';

/**
 * Deterministic serialisation.
 *
 * Node key order follows the order the properties are introduced in the
 * assignment, so a saved file reads like the sample one and diffs stay small.
 * Node *order* is preserved rather than sorted, because the order a map author
 * added nodes in is information the editor should not quietly discard.
 */
function orderNode(node: MapNode): Record<string, unknown> {
  const ordered: Record<string, unknown> = { x: node.x, y: node.y, code: node.code };
  if (node.directions?.length) ordered.directions = [...node.directions];
  if (node.charger) ordered.charger = { direction: node.charger.direction };
  if (node.chute) ordered.chute = { direction: node.chute.direction };
  if (node.name) ordered.name = node.name;
  return ordered;
}

/** Compact, stable JSON. Used as the input to the revision hash. */
export function canonicalMapJson(map: AgvMap): string {
  return JSON.stringify({
    map: {
      maxNeighborDistance: map.maxNeighborDistance,
      nodes: map.nodes.map(orderNode),
    },
  });
}

/** Pretty-printed document, for the file on disk and for export. */
export function formatMapDocument(map: AgvMap): string {
  return `${JSON.stringify(
    { map: { maxNeighborDistance: map.maxNeighborDistance, nodes: map.nodes.map(orderNode) } },
    null,
    2,
  )}\n`;
}

/** Drops undefined optionals and empty direction lists. */
export function normaliseMap(map: AgvMap): AgvMap {
  return JSON.parse(canonicalMapJson(map)).map as AgvMap;
}
