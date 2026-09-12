import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgvMap, sampleMap } from '@agv/shared';
import { createApp } from '../app';
import { FileMapStore, MemoryMapStore, revisionOf } from '../store';

function build(store = new MemoryMapStore()) {
  return { app: createApp({ store }), store };
}

/** A tiny, valid two-node map. */
function smallMap(): AgvMap {
  return {
    maxNeighborDistance: 1500,
    nodes: [
      { x: 0, y: 0, code: 1, directions: ['North'] },
      { x: 0, y: 800, code: 2, directions: ['South'] },
    ],
  };
}

describe('GET /api/health', () => {
  it('reports ok', async () => {
    const { app } = build();
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('GET /api/map', () => {
  it('returns the seeded sample map with a revision and matching ETag', async () => {
    const { app } = build();
    const response = await request(app).get('/api/map').expect(200);

    expect(response.body.map.nodes).toHaveLength(58);
    expect(response.body.map.maxNeighborDistance).toBe(1500);
    expect(response.body.revision).toMatch(/^[0-9a-f]{12}$/);
    expect(response.headers.etag).toBe(`"${response.body.revision}"`);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('gives the same revision for the same content', async () => {
    const { app } = build();
    const first = await request(app).get('/api/map').expect(200);
    const second = await request(app).get('/api/map').expect(200);
    expect(second.body.revision).toBe(first.body.revision);
  });
});

describe('GET /api/map/download', () => {
  it('serves the assignment file format as an attachment', async () => {
    const { app } = build();
    const response = await request(app).get('/api/map/download').expect(200);

    expect(response.headers['content-disposition']).toContain('map.json');
    const parsed = JSON.parse(response.text);
    expect(Object.keys(parsed)).toEqual(['map']);
    expect(Object.keys(parsed.map)).toEqual(['maxNeighborDistance', 'nodes']);
    // Key order follows the assignment's own example file.
    expect(Object.keys(parsed.map.nodes[0])).toEqual(['x', 'y', 'code', 'directions']);
  });
});

describe('PUT /api/map', () => {
  it('saves a valid map and returns the new revision', async () => {
    const { app } = build();
    const map = smallMap();

    const response = await request(app).put('/api/map').send({ map }).expect(200);

    expect(response.body.revision).toBe(revisionOf(map));
    expect(response.body.map.nodes).toHaveLength(2);
    expect(response.headers.etag).toBe(`"${response.body.revision}"`);

    const reread = await request(app).get('/api/map').expect(200);
    expect(reread.body.revision).toBe(response.body.revision);
  });

  it('returns any warnings alongside a successful save', async () => {
    const { app } = build();
    const map: AgvMap = {
      maxNeighborDistance: 1500,
      nodes: [
        { x: 0, y: 0, code: 1, directions: ['North', 'East'] },
        { x: 0, y: 800, code: 2, directions: ['South'] },
      ],
    };
    const response = await request(app).put('/api/map').send({ map }).expect(200);
    expect(response.body.warnings.some((issue: { code: string }) => issue.code === 'W014')).toBe(
      true,
    );
  });

  it('rejects a structurally broken payload with 422', async () => {
    const { app } = build();
    const response = await request(app)
      .put('/api/map')
      .send({ map: { maxNeighborDistance: 1500, nodes: [{ x: 'left', y: 0, code: 1 }] } })
      .expect(422);
    expect(response.body.errors.some((issue: { code: string }) => issue.code === 'E003')).toBe(
      true,
    );
  });

  it('rejects a physically incoherent map with 422 and leaves the stored map alone', async () => {
    const { app } = build();
    const before = await request(app).get('/api/map').expect(200);

    const response = await request(app)
      .put('/api/map')
      .send({
        map: {
          maxNeighborDistance: 1500,
          nodes: [
            { x: 0, y: 0, code: 7 },
            { x: 0, y: 0, code: 8 },
          ],
        },
      })
      .expect(422);

    expect(response.body.errors.some((issue: { code: string }) => issue.code === 'E013')).toBe(
      true,
    );

    const after = await request(app).get('/api/map').expect(200);
    expect(after.body.revision).toBe(before.body.revision);
  });

  it('rejects a body that is not JSON with 400', async () => {
    const { app } = build();
    await request(app)
      .put('/api/map')
      .set('Content-Type', 'application/json')
      .send('{ not json')
      .expect(400);
  });

  it('rejects a missing map key with 422', async () => {
    const { app } = build();
    const response = await request(app).put('/api/map').send({ nodes: [] }).expect(422);
    expect(response.body.errors[0].code).toBe('E000');
  });
});

describe('PUT /api/map concurrency', () => {
  it('accepts a matching revision in the body', async () => {
    const { app } = build();
    const current = await request(app).get('/api/map').expect(200);
    await request(app)
      .put('/api/map')
      .send({ revision: current.body.revision, map: smallMap() })
      .expect(200);
  });

  it('accepts a matching If-Match header', async () => {
    const { app } = build();
    const current = await request(app).get('/api/map').expect(200);
    await request(app)
      .put('/api/map')
      .set('If-Match', current.headers.etag)
      .send({ map: smallMap() })
      .expect(200);
  });

  it('returns 409 when the map moved under the caller', async () => {
    const { app } = build();
    const stale = (await request(app).get('/api/map').expect(200)).body.revision;

    // Someone else saves first.
    await request(app).put('/api/map').send({ map: smallMap() }).expect(200);

    const response = await request(app)
      .put('/api/map')
      .send({ revision: stale, map: { maxNeighborDistance: 2000, nodes: [] } })
      .expect(409);

    expect(response.body.expectedRevision).toBe(stale);
    expect(response.body.currentRevision).not.toBe(stale);
  });

  it('writes unconditionally when no revision is supplied', async () => {
    const { app } = build();
    await request(app).put('/api/map').send({ map: smallMap() }).expect(200);
    await request(app).put('/api/map').send({ map: sampleMap() }).expect(200);
  });
});

describe('POST /api/map/validate', () => {
  it('reports the sample map as clean with lane statistics', async () => {
    const { app } = build();
    const response = await request(app)
      .post('/api/map/validate')
      .send({ map: sampleMap() })
      .expect(200);

    expect(response.body.errors).toEqual([]);
    expect(response.body.stats).toMatchObject({
      orientation: 'mapData',
      nodeCount: 58,
      laneCount: 75,
      isolatedNodeCount: 0,
      errorCount: 0,
    });
  });

  it('honours the orientation query parameter', async () => {
    const { app } = build();
    const response = await request(app)
      .post('/api/map/validate?orientation=specText')
      .send({ map: sampleMap() })
      .expect(200);

    expect(response.body.stats.orientation).toBe('specText');
    expect(
      response.body.warnings.filter((issue: { code: string }) => issue.code === 'W014'),
    ).toHaveLength(20);
  });

  it('does not persist anything', async () => {
    const { app } = build();
    const before = await request(app).get('/api/map').expect(200);
    await request(app).post('/api/map/validate').send({ map: smallMap() }).expect(200);
    const after = await request(app).get('/api/map').expect(200);
    expect(after.body.revision).toBe(before.body.revision);
  });

  it('returns 422 for an unparseable map', async () => {
    const { app } = build();
    await request(app).post('/api/map/validate').send({ map: null }).expect(422);
  });
});

describe('POST /api/map/reset', () => {
  it('restores the map supplied with the assignment', async () => {
    const { app } = build();
    const pristine = (await request(app).get('/api/map').expect(200)).body.revision;

    await request(app).put('/api/map').send({ map: smallMap() }).expect(200);
    const reset = await request(app).post('/api/map/reset').expect(200);

    expect(reset.body.revision).toBe(pristine);
    expect(reset.body.map.nodes).toHaveLength(58);
  });
});

describe('unknown API routes', () => {
  it('return a JSON 404 rather than HTML', async () => {
    const { app } = build();
    const response = await request(app).get('/api/nope').expect(404);
    expect(response.body.message).toBe('No such endpoint.');
  });
});

describe('FileMapStore', () => {
  let directory: string;
  let file: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'agv-map-'));
    file = path.join(directory, 'nested', 'map.json');
  });

  it('seeds the sample map on first read and creates missing directories', async () => {
    const store = new FileMapStore(file);
    const resource = await store.load();
    expect(resource.map.nodes).toHaveLength(58);

    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    expect(onDisk.map.nodes).toHaveLength(58);
  });

  it('persists a save across store instances', async () => {
    await new FileMapStore(file).save(smallMap());
    const reloaded = await new FileMapStore(file).load();
    expect(reloaded.map.nodes).toHaveLength(2);
  });

  it('leaves no temporary files behind', async () => {
    const store = new FileMapStore(file);
    await store.save(smallMap());
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(path.dirname(file));
    expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses to start from a corrupt map file', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ map: { nodes: 'not an array' } }), 'utf8');
    await expect(new FileMapStore(file).load()).rejects.toThrow(/not valid/);
  });

  it('enforces the same revision check as the memory store', async () => {
    const store = new FileMapStore(file);
    await store.load();
    await expect(store.save(smallMap(), 'deadbeefcafe')).rejects.toThrow(/has changed/);
  });

  it('serves the API end to end from disk', async () => {
    const app = createApp({ store: new FileMapStore(file) });
    await request(app).put('/api/map').send({ map: smallMap() }).expect(200);
    const response = await request(app).get('/api/map').expect(200);
    expect(response.body.map.nodes).toHaveLength(2);
  });
});
