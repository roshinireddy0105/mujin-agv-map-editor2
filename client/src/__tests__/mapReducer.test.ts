import { describe, expect, it } from 'vitest';
import { canonicalMapJson, sampleMap, type AgvMap } from '@agv/shared';
import {
  EditorState,
  initialState,
  isDirty,
  mapReducer,
  selectedNode,
  suggestCode,
} from '../state/mapReducer';

function loaded(map: AgvMap = sampleMap()): EditorState {
  return mapReducer(initialState, { type: 'loaded', map, revision: 'abc123abc123' });
}

const small: AgvMap = {
  maxNeighborDistance: 1500,
  nodes: [
    { x: 0, y: 0, code: 10, directions: ['North'] },
    { x: 0, y: 800, code: 20, directions: ['South'], name: 'DOCK' },
  ],
};

describe('loading', () => {
  it('stores the revision and starts clean with no history', () => {
    const state = loaded();
    expect(state.savedRevision).toBe('abc123abc123');
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
    expect(state.selectedIndex).toBeNull();
    expect(isDirty(state)).toBe(false);
  });

  it('is not dirty before anything has loaded', () => {
    expect(isDirty(initialState)).toBe(false);
  });
});

describe('dirty tracking', () => {
  it('goes dirty on an edit and clean again once saved', () => {
    let state = loaded(small);
    state = mapReducer(state, { type: 'moveNode', index: 0, x: 0, y: 100 });
    expect(isDirty(state)).toBe(true);

    state = mapReducer(state, { type: 'saved', revision: 'def456def456' });
    expect(isDirty(state)).toBe(false);
    expect(state.savedRevision).toBe('def456def456');
  });

  it('is clean again if an edit is undone back to the saved content', () => {
    let state = loaded(small);
    state = mapReducer(state, { type: 'moveNode', index: 0, x: 0, y: 100 });
    state = mapReducer(state, { type: 'undo' });
    expect(isDirty(state)).toBe(false);
  });
});

describe('addNode', () => {
  it('appends a node, selects it and suggests the next code', () => {
    const state = mapReducer(loaded(small), { type: 'addNode', x: 1234.6, y: 99.2 });
    expect(state.map.nodes).toHaveLength(3);
    expect(state.selectedIndex).toBe(2);
    expect(state.map.nodes[2]).toEqual({ x: 1235, y: 99, code: 30 });
  });

  it('starts codes at the sample map’s base when the map is empty', () => {
    expect(suggestCode({ maxNeighborDistance: 1500, nodes: [] })).toBe(10001000);
  });
});

describe('moveNode', () => {
  it('rounds to whole millimetres', () => {
    const state = mapReducer(loaded(small), { type: 'moveNode', index: 0, x: 10.7, y: -3.2 });
    expect(state.map.nodes[0]).toMatchObject({ x: 11, y: -3 });
  });

  it('ignores a move that changes nothing, so a click is not an undo step', () => {
    const before = loaded(small);
    const after = mapReducer(before, { type: 'moveNode', index: 0, x: 0, y: 0 });
    expect(after).toBe(before);
  });

  it('collapses a whole drag into one undo step when coalescing', () => {
    let state = loaded(small);
    state = mapReducer(state, { type: 'moveNode', index: 0, x: 0, y: 10, coalesce: false });
    state = mapReducer(state, { type: 'moveNode', index: 0, x: 0, y: 20, coalesce: true });
    state = mapReducer(state, { type: 'moveNode', index: 0, x: 0, y: 30, coalesce: true });

    expect(state.past).toHaveLength(1);
    const undone = mapReducer(state, { type: 'undo' });
    expect(undone.map.nodes[0].y).toBe(0);
  });

  it('ignores an out-of-range index', () => {
    const before = loaded(small);
    expect(mapReducer(before, { type: 'moveNode', index: 99, x: 1, y: 1 })).toBe(before);
  });
});

describe('updateNode', () => {
  it('drops the name key entirely when cleared', () => {
    const state = mapReducer(loaded(small), {
      type: 'updateNode',
      index: 1,
      patch: { name: '' },
    });
    expect('name' in state.map.nodes[1]).toBe(false);
    // And the serialised document has no empty-string name either.
    expect(canonicalMapJson(state.map)).not.toContain('"name"');
  });

  it('applies a code change', () => {
    const state = mapReducer(loaded(small), {
      type: 'updateNode',
      index: 0,
      patch: { code: 77 },
    });
    expect(state.map.nodes[0].code).toBe(77);
  });
});

describe('toggleDirection', () => {
  it('adds and removes a heading', () => {
    let state = mapReducer(loaded(small), {
      type: 'toggleDirection',
      index: 0,
      direction: 'East',
    });
    expect(state.map.nodes[0].directions).toEqual(['North', 'East']);

    state = mapReducer(state, { type: 'toggleDirection', index: 0, direction: 'North' });
    expect(state.map.nodes[0].directions).toEqual(['East']);
  });

  it('removes the key when the last heading goes, matching the file format', () => {
    const state = mapReducer(loaded(small), {
      type: 'toggleDirection',
      index: 0,
      direction: 'North',
    });
    expect('directions' in state.map.nodes[0]).toBe(false);
  });
});

describe('setFeature', () => {
  it('sets and clears a charger', () => {
    let state = mapReducer(loaded(small), {
      type: 'setFeature',
      index: 0,
      feature: 'charger',
      direction: 'West',
    });
    expect(state.map.nodes[0].charger).toEqual({ direction: 'West' });

    state = mapReducer(state, {
      type: 'setFeature',
      index: 0,
      feature: 'charger',
      direction: null,
    });
    expect('charger' in state.map.nodes[0]).toBe(false);
  });

  it('keeps a chute independent of a charger on the same node', () => {
    let state = mapReducer(loaded(small), {
      type: 'setFeature',
      index: 0,
      feature: 'charger',
      direction: 'West',
    });
    state = mapReducer(state, {
      type: 'setFeature',
      index: 0,
      feature: 'chute',
      direction: 'North',
    });
    expect(state.map.nodes[0].charger).toEqual({ direction: 'West' });
    expect(state.map.nodes[0].chute).toEqual({ direction: 'North' });
  });
});

describe('deleteNode', () => {
  it('removes the node and clears the selection', () => {
    let state = mapReducer(loaded(small), { type: 'select', index: 1 });
    state = mapReducer(state, { type: 'deleteNode', index: 1 });
    expect(state.map.nodes).toHaveLength(1);
    expect(state.selectedIndex).toBeNull();
    expect(selectedNode(state)).toBeNull();
  });
});

describe('undo and redo', () => {
  it('walks back and forward through edits', () => {
    let state = loaded(small);
    state = mapReducer(state, { type: 'addNode', x: 500, y: 500 });
    state = mapReducer(state, { type: 'addNode', x: 900, y: 900 });
    expect(state.map.nodes).toHaveLength(4);

    state = mapReducer(state, { type: 'undo' });
    expect(state.map.nodes).toHaveLength(3);
    state = mapReducer(state, { type: 'undo' });
    expect(state.map.nodes).toHaveLength(2);

    state = mapReducer(state, { type: 'redo' });
    expect(state.map.nodes).toHaveLength(3);
  });

  it('is a no-op at either end of the history', () => {
    const state = loaded(small);
    expect(mapReducer(state, { type: 'undo' })).toBe(state);
    expect(mapReducer(state, { type: 'redo' })).toBe(state);
  });

  it('discards the redo stack once a new edit lands', () => {
    let state = loaded(small);
    state = mapReducer(state, { type: 'addNode', x: 1, y: 1 });
    state = mapReducer(state, { type: 'undo' });
    expect(state.future).toHaveLength(1);

    state = mapReducer(state, { type: 'addNode', x: 2, y: 2 });
    expect(state.future).toHaveLength(0);
  });

  it('clears a selection that undo has made invalid', () => {
    let state = loaded(small);
    state = mapReducer(state, { type: 'addNode', x: 1, y: 1 });
    expect(state.selectedIndex).toBe(2);
    state = mapReducer(state, { type: 'undo' });
    expect(state.selectedIndex).toBeNull();
  });
});

describe('maxNeighborDistance', () => {
  it('rounds and records an undoable change', () => {
    const state = mapReducer(loaded(small), {
      type: 'setMaxNeighborDistance',
      value: 1800.4,
    });
    expect(state.map.maxNeighborDistance).toBe(1800);
    expect(state.past).toHaveLength(1);
  });

  it('ignores a value that is not a number', () => {
    const before = loaded(small);
    expect(mapReducer(before, { type: 'setMaxNeighborDistance', value: NaN })).toBe(before);
  });
});

describe('orientation', () => {
  it('switches without touching the map or the history', () => {
    const before = loaded(small);
    const after = mapReducer(before, { type: 'setOrientation', orientationId: 'specText' });
    expect(after.orientationId).toBe('specText');
    expect(after.map).toBe(before.map);
    expect(after.past).toEqual([]);
    expect(isDirty(after)).toBe(false);
  });
});
