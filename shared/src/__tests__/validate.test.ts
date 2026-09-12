import { describe, expect, it } from 'vitest';
import sample from '../__fixtures__/sample-map.json';
import {
  AgvMap,
  Issue,
  ORIENTATIONS,
  availableDirections,
  isValid,
  parseMapDocument,
  validateMap,
} from '../index';

const sampleMap = sample.map as AgvMap;

const codes = (issues: Issue[]) => issues.map((issue) => issue.code).sort();
const has = (issues: Issue[], code: string) => issues.some((issue) => issue.code === code);

describe('parseMapDocument', () => {
  it('accepts the sample document', () => {
    const result = parseMapDocument(sample);
    expect('map' in result).toBe(true);
  });

  it('rejects a non-object body', () => {
    expect(codes((parseMapDocument('nope') as { errors: Issue[] }).errors)).toEqual(['E000']);
    expect(codes((parseMapDocument(null) as { errors: Issue[] }).errors)).toEqual(['E000']);
  });

  it('requires a map key', () => {
    expect(codes((parseMapDocument({ nodes: [] }) as { errors: Issue[] }).errors)).toEqual([
      'E000',
    ]);
  });

  it('requires nodes to be an array', () => {
    const result = parseMapDocument({ map: { maxNeighborDistance: 1500, nodes: {} } });
    expect(has((result as { errors: Issue[] }).errors, 'E002')).toBe(true);
  });

  it('rejects non-numeric coordinates and codes', () => {
    const result = parseMapDocument({
      map: { maxNeighborDistance: 1500, nodes: [{ x: '1000', y: 1000, code: 1 }] },
    });
    expect(has((result as { errors: Issue[] }).errors, 'E003')).toBe(true);
  });

  it('rejects an unknown compass heading', () => {
    const result = parseMapDocument({
      map: {
        maxNeighborDistance: 1500,
        nodes: [{ x: 0, y: 0, code: 1, directions: ['Northwest'] }],
      },
    });
    expect(has((result as { errors: Issue[] }).errors, 'E004')).toBe(true);
  });

  it('rejects a charger or chute without a valid direction', () => {
    const charger = parseMapDocument({
      map: { maxNeighborDistance: 1500, nodes: [{ x: 0, y: 0, code: 1, charger: {} }] },
    });
    expect(has((charger as { errors: Issue[] }).errors, 'E005')).toBe(true);

    const chute = parseMapDocument({
      map: {
        maxNeighborDistance: 1500,
        nodes: [{ x: 0, y: 0, code: 1, chute: { direction: 'Up' } }],
      },
    });
    expect(has((chute as { errors: Issue[] }).errors, 'E005')).toBe(true);
  });

  it('rejects a non-string name', () => {
    const result = parseMapDocument({
      map: { maxNeighborDistance: 1500, nodes: [{ x: 0, y: 0, code: 1, name: 7 }] },
    });
    expect(has((result as { errors: Issue[] }).errors, 'E006')).toBe(true);
  });
});

describe('validateMap errors', () => {
  const wrap = (nodes: AgvMap['nodes'], maxNeighborDistance = 1500): AgvMap => ({
    maxNeighborDistance,
    nodes,
  });

  it('requires a positive whole maxNeighborDistance', () => {
    expect(has(validateMap(wrap([], 0)).errors, 'E010')).toBe(true);
    expect(has(validateMap(wrap([], -5)).errors, 'E010')).toBe(true);
    expect(has(validateMap(wrap([], 1500.5)).errors, 'E010')).toBe(true);
  });

  it('requires whole-millimetre coordinates', () => {
    const result = validateMap(wrap([{ x: 10.5, y: 0, code: 1 }]));
    expect(has(result.errors, 'E011')).toBe(true);
    expect(result.errors[0].nodeIndex).toBe(0);
  });

  it('rejects two nodes in the same place', () => {
    const result = validateMap(
      wrap([
        { x: 100, y: 100, code: 1 },
        { x: 100, y: 100, code: 2 },
      ]),
    );
    expect(has(result.errors, 'E013')).toBe(true);
  });

  it('rejects a duplicated QR code', () => {
    const result = validateMap(
      wrap([
        { x: 0, y: 0, code: 500 },
        { x: 0, y: 800, code: 500 },
      ]),
    );
    expect(has(result.errors, 'E014')).toBe(true);
  });

  it('allows code 0 to repeat, since the sample map uses it as unassigned', () => {
    const result = validateMap(
      wrap([
        { x: 0, y: 0, code: 0, directions: ['North'] },
        { x: 0, y: 800, code: 0, directions: ['South'] },
      ]),
    );
    expect(has(result.errors, 'E014')).toBe(false);
    expect(isValid(result)).toBe(true);
  });
});

describe('validateMap warnings', () => {
  const wrap = (nodes: AgvMap['nodes'], maxNeighborDistance = 1500): AgvMap => ({
    maxNeighborDistance,
    nodes,
  });

  it('flags an isolated node', () => {
    const result = validateMap(
      wrap([
        { x: 0, y: 0, code: 1, directions: ['North'] },
        { x: 0, y: 800, code: 2, directions: ['South'] },
        { x: 90000, y: 90000, code: 3, directions: ['North'] },
      ]),
    );
    const isolated = result.warnings.filter((issue) => issue.code === 'W012');
    expect(isolated).toHaveLength(1);
    expect(isolated[0].nodeIndex).toBe(2);
  });

  it('flags a node an AGV cannot leave', () => {
    const result = validateMap(
      wrap([
        { x: 0, y: 0, code: 1, directions: ['North'] },
        { x: 0, y: 800, code: 2 },
      ]),
    );
    expect(has(result.warnings, 'W013')).toBe(true);
  });

  it('flags a direction pointing at empty floor', () => {
    const result = validateMap(
      wrap([
        { x: 0, y: 0, code: 1, directions: ['North', 'East'] },
        { x: 0, y: 800, code: 2, directions: ['South'] },
      ]),
    );
    const dangling = result.warnings.filter((issue) => issue.code === 'W014');
    expect(dangling).toHaveLength(1);
    expect(dangling[0].message).toContain('East');
  });

  it('flags repeated directions', () => {
    const result = validateMap(
      wrap([
        { x: 0, y: 0, code: 1, directions: ['North', 'North'] },
        { x: 0, y: 800, code: 2, directions: ['South'] },
      ]),
    );
    expect(has(result.warnings, 'W010')).toBe(true);
  });

  it('flags a reused name without blocking the save', () => {
    const result = validateMap(
      wrap([
        { x: 0, y: 0, code: 1, directions: ['North'], name: 'DOCK' },
        { x: 0, y: 800, code: 2, directions: ['South'], name: 'DOCK' },
      ]),
    );
    expect(has(result.warnings, 'W011')).toBe(true);
    expect(isValid(result)).toBe(true);
  });

  it('flags a lane no AGV can drive in either direction', () => {
    const result = validateMap(
      wrap([
        { x: 0, y: 0, code: 1, directions: ['East'] },
        { x: 0, y: 800, code: 2, directions: ['East'] },
      ]),
    );
    expect(has(result.warnings, 'W015')).toBe(true);
  });

  it('flags a charger with no neighbour on the plug side', () => {
    // Plug faces North, so the AGV must reverse in from the North. Its only
    // neighbour is South, so nothing can dock here.
    const result = validateMap(
      wrap([
        { x: 0, y: 0, code: 1, directions: ['South'], charger: { direction: 'North' } },
        { x: 0, y: -800, code: 2, directions: ['North'] },
      ]),
    );
    expect(has(result.warnings, 'W016')).toBe(true);
  });

  it('accepts a charger that reverses in from one side and departs another', () => {
    // This is CHRG1's arrangement: plug West, approach from the West, leave South.
    const result = validateMap(
      wrap([
        { x: 0, y: 0, code: 1, directions: ['South'], charger: { direction: 'West' } },
        { x: -800, y: 0, code: 2, directions: ['East'] },
        { x: 0, y: -800, code: 3, directions: ['North'] },
      ]),
    );
    expect(has(result.warnings, 'W016')).toBe(false);
  });
});

describe('the sample map', () => {
  it('has no errors under the default orientation', () => {
    const result = validateMap(sampleMap, ORIENTATIONS.mapData);
    expect(result.errors).toEqual([]);
    expect(isValid(result)).toBe(true);
  });

  it('warns only about lanes that are adjacency without being a usable route', () => {
    const result = validateMap(sampleMap, ORIENTATIONS.mapData);
    expect(new Set(codes(result.warnings))).toEqual(new Set(['W015']));
    expect(result.warnings).toHaveLength(15);
  });

  it('produces dangling-direction warnings under the brief’s literal orientation', () => {
    const result = validateMap(sampleMap, ORIENTATIONS.specText);
    expect(result.warnings.filter((issue) => issue.code === 'W014')).toHaveLength(20);
  });
});

describe('availableDirections', () => {
  it('lists only headings that reach a real neighbour', () => {
    const map: AgvMap = {
      maxNeighborDistance: 1500,
      nodes: [
        { x: 0, y: 0, code: 1 },
        { x: 0, y: 800, code: 2 },
        { x: 800, y: 0, code: 3 },
      ],
    };
    expect(availableDirections(map, 0, ORIENTATIONS.mapData)).toEqual(['North', 'East']);
  });
});
