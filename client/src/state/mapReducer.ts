import {
  AgvMap,
  Direction,
  MapNode,
  OrientationId,
  canonicalMapJson,
} from '@agv/shared';

export interface EditorState {
  map: AgvMap;
  /** Undo stack, most recent last. */
  past: AgvMap[];
  future: AgvMap[];
  selectedIndex: number | null;
  /** Revision the server last confirmed, or null before the first load. */
  savedRevision: string | null;
  /** Canonical JSON of the last saved map, used to decide `isDirty`. */
  savedJson: string | null;
  orientationId: OrientationId;
}

export type EditorAction =
  | { type: 'loaded'; map: AgvMap; revision: string }
  | { type: 'saved'; revision: string }
  | { type: 'select'; index: number | null }
  | { type: 'addNode'; x: number; y: number }
  | { type: 'moveNode'; index: number; x: number; y: number; coalesce?: boolean }
  | { type: 'updateNode'; index: number; patch: Partial<MapNode> }
  | { type: 'toggleDirection'; index: number; direction: Direction }
  | {
      type: 'setFeature';
      index: number;
      feature: 'charger' | 'chute';
      direction: Direction | null;
    }
  | { type: 'deleteNode'; index: number }
  | { type: 'setMaxNeighborDistance'; value: number }
  | { type: 'replaceMap'; map: AgvMap }
  | { type: 'setOrientation'; orientationId: OrientationId }
  | { type: 'undo' }
  | { type: 'redo' };

const HISTORY_LIMIT = 100;

export const emptyMap: AgvMap = { maxNeighborDistance: 1500, nodes: [] };

export const initialState: EditorState = {
  map: emptyMap,
  past: [],
  future: [],
  selectedIndex: null,
  savedRevision: null,
  savedJson: null,
  orientationId: 'mapData',
};

export function isDirty(state: EditorState): boolean {
  if (state.savedJson === null) return false;
  return canonicalMapJson(state.map) !== state.savedJson;
}

export function selectedNode(state: EditorState): MapNode | null {
  if (state.selectedIndex === null) return null;
  return state.map.nodes[state.selectedIndex] ?? null;
}

/** Next unused QR code, stepping by 10 the way the sample map does. */
export function suggestCode(map: AgvMap): number {
  const highest = map.nodes.reduce((max, node) => Math.max(max, node.code), 0);
  return highest === 0 ? 10001000 : highest + 10;
}

/**
 * Push a new map onto the history.
 *
 * `coalesce` merges the change into the previous entry, which is what a drag
 * needs: a pointer move fires dozens of times and each one must not become its
 * own undo step.
 */
function commit(state: EditorState, map: AgvMap, coalesce = false): EditorState {
  const past = coalesce ? state.past : [...state.past, state.map].slice(-HISTORY_LIMIT);
  return { ...state, map, past, future: [] };
}

function withNodes(map: AgvMap, nodes: MapNode[]): AgvMap {
  return { ...map, nodes };
}

function patchNode(map: AgvMap, index: number, patch: Partial<MapNode>): AgvMap {
  return withNodes(
    map,
    map.nodes.map((node, i) => (i === index ? { ...node, ...patch } : node)),
  );
}

export function mapReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'loaded':
      return {
        ...state,
        map: action.map,
        past: [],
        future: [],
        selectedIndex: null,
        savedRevision: action.revision,
        savedJson: canonicalMapJson(action.map),
      };

    case 'saved':
      return {
        ...state,
        savedRevision: action.revision,
        savedJson: canonicalMapJson(state.map),
      };

    case 'select':
      return { ...state, selectedIndex: action.index };

    case 'addNode': {
      const node: MapNode = {
        x: Math.round(action.x),
        y: Math.round(action.y),
        code: suggestCode(state.map),
      };
      const next = commit(state, withNodes(state.map, [...state.map.nodes, node]));
      return { ...next, selectedIndex: next.map.nodes.length - 1 };
    }

    case 'moveNode': {
      const current = state.map.nodes[action.index];
      if (!current) return state;
      if (current.x === Math.round(action.x) && current.y === Math.round(action.y)) {
        return state;
      }
      return commit(
        state,
        patchNode(state.map, action.index, {
          x: Math.round(action.x),
          y: Math.round(action.y),
        }),
        action.coalesce,
      );
    }

    case 'updateNode': {
      if (!state.map.nodes[action.index]) return state;
      // An empty name is an absent name, not a node called "".
      const patch = { ...action.patch };
      if ('name' in patch && !patch.name) delete (patch as { name?: string }).name;
      const nodes = state.map.nodes.map((node, i) => {
        if (i !== action.index) return node;
        const merged = { ...node, ...patch };
        if ('name' in action.patch && !action.patch.name) delete merged.name;
        return merged;
      });
      return commit(state, withNodes(state.map, nodes));
    }

    case 'toggleDirection': {
      const node = state.map.nodes[action.index];
      if (!node) return state;
      const current = node.directions ?? [];
      const next = current.includes(action.direction)
        ? current.filter((direction) => direction !== action.direction)
        : [...current, action.direction];
      const nodes = state.map.nodes.map((candidate, i) => {
        if (i !== action.index) return candidate;
        const updated: MapNode = { ...candidate, directions: next };
        if (next.length === 0) delete updated.directions;
        return updated;
      });
      return commit(state, withNodes(state.map, nodes));
    }

    case 'setFeature': {
      const node = state.map.nodes[action.index];
      if (!node) return state;
      const nodes = state.map.nodes.map((candidate, i) => {
        if (i !== action.index) return candidate;
        const updated: MapNode = { ...candidate };
        if (action.direction === null) delete updated[action.feature];
        else updated[action.feature] = { direction: action.direction };
        return updated;
      });
      return commit(state, withNodes(state.map, nodes));
    }

    case 'deleteNode': {
      if (!state.map.nodes[action.index]) return state;
      const nodes = state.map.nodes.filter((_, i) => i !== action.index);
      const next = commit(state, withNodes(state.map, nodes));
      return { ...next, selectedIndex: null };
    }

    case 'setMaxNeighborDistance': {
      if (!Number.isFinite(action.value)) return state;
      return commit(state, { ...state.map, maxNeighborDistance: Math.round(action.value) });
    }

    case 'replaceMap':
      return { ...commit(state, action.map), selectedIndex: null };

    case 'setOrientation':
      return { ...state, orientationId: action.orientationId };

    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        ...state,
        map: previous,
        past: state.past.slice(0, -1),
        future: [state.map, ...state.future].slice(0, HISTORY_LIMIT),
        selectedIndex:
          state.selectedIndex !== null && state.selectedIndex < previous.nodes.length
            ? state.selectedIndex
            : null,
      };
    }

    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return {
        ...state,
        map: next,
        past: [...state.past, state.map].slice(-HISTORY_LIMIT),
        future: rest,
        selectedIndex:
          state.selectedIndex !== null && state.selectedIndex < next.nodes.length
            ? state.selectedIndex
            : null,
      };
    }

    default:
      return state;
  }
}
