import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  Issue,
  OrientationId,
  ValidationResult,
  buildAdjacency,
  computeEdges,
  formatMapDocument,
  orientationById,
  parseMapDocument,
  validateMap,
} from '@agv/shared';
import { MapStore, RevisionConflictError } from './store';

export interface AppOptions {
  store: MapStore;
  /** Directory holding the built client. Omit to run API-only. */
  clientDir?: string;
}

/** `?orientation=mapData|specText`, defaulting to the assignment's North = +X, West = +Y convention. */
function readOrientation(request: Request) {
  const raw = request.query.orientation;
  return orientationById(typeof raw === 'string' ? (raw as OrientationId) : undefined);
}

function summarise(
  map: Parameters<typeof computeEdges>[0],
  result: ValidationResult,
  orientation: ReturnType<typeof orientationById>,
) {
  const edges = computeEdges(map, orientation);
  const adjacency = buildAdjacency(map.nodes.length, edges);
  return {
    orientation: orientation.id,
    nodeCount: map.nodes.length,
    laneCount: edges.length,
    isolatedNodeCount: adjacency.filter((list) => list.length === 0).length,
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
  };
}

function sendIssues(response: Response, status: number, message: string, errors: Issue[]) {
  response.status(status).json({ message, errors });
}

export function createApp({ store, clientDir }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  // ETags are the map revision, not a hash of the HTTP body, so Express must
  // not generate its own and overwrite ours.
  app.set('etag', false);
  app.use(express.json({ limit: '8mb' }));

  const api = express.Router();

  api.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  api.get('/map', async (_request, response, next) => {
    try {
      const resource = await store.load();
      response.set('ETag', `"${resource.revision}"`);
      response.set('Cache-Control', 'no-store');
      response.json(resource);
    } catch (error) {
      next(error);
    }
  });

  /** The whole map as a downloadable file, matching the assignment's format. */
  api.get('/map/download', async (_request, response, next) => {
    try {
      const { map } = await store.load();
      response.set('Content-Type', 'application/json');
      response.set('Content-Disposition', 'attachment; filename="map.json"');
      response.send(formatMapDocument(map));
    } catch (error) {
      next(error);
    }
  });

  api.post('/map/validate', (request, response) => {
    const parsed = parseMapDocument(request.body);
    if ('errors' in parsed) {
      response.status(422).json({ errors: parsed.errors, warnings: [] });
      return;
    }
    const orientation = readOrientation(request);
    const result = validateMap(parsed.map, orientation);
    response.json({ ...result, stats: summarise(parsed.map, result, orientation) });
  });

  /**
   * Full-document replacement.
   *
   * PUT rather than PATCH because a map is edited as a whole: moving one node
   * changes which lanes exist elsewhere, so there is no coherent single-node
   * update. Concurrency is opt-in via `If-Match` or a `revision` in the body —
   * send neither and the write is unconditional, which is what a first-time
   * import wants.
   */
  api.put('/map', async (request, response, next) => {
    const parsed = parseMapDocument(request.body);
    if ('errors' in parsed) {
      sendIssues(response, 422, 'The map could not be saved.', parsed.errors);
      return;
    }

    const orientation = readOrientation(request);
    const result = validateMap(parsed.map, orientation);
    if (result.errors.length > 0) {
      response.status(422).json({
        message: 'The map is not physically coherent, so it was not saved.',
        errors: result.errors,
        warnings: result.warnings,
      });
      return;
    }

    const ifMatch = request.header('If-Match')?.replace(/^W\//, '').replace(/"/g, '');
    const bodyRevision =
      typeof (request.body as { revision?: unknown }).revision === 'string'
        ? ((request.body as { revision: string }).revision)
        : undefined;
    const expectedRevision = ifMatch ?? bodyRevision;

    try {
      const saved = await store.save(parsed.map, expectedRevision);
      response.set('ETag', `"${saved.revision}"`);
      response.json({ ...saved, warnings: result.warnings });
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        const current = await store.load();
        response.status(409).json({
          message: error.message,
          expectedRevision: error.expected,
          currentRevision: current.revision,
        });
        return;
      }
      next(error);
    }
  });

  /** Restore the map supplied with the assignment. Useful for demos and tests. */
  api.post('/map/reset', async (_request, response, next) => {
    try {
      const resource = await store.reset();
      response.set('ETag', `"${resource.revision}"`);
      response.json(resource);
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', api);

  app.use('/api', (_request, response) => {
    response.status(404).json({ message: 'No such endpoint.' });
  });

  if (clientDir && existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false }));
    // Single-page app: anything not matched above renders the editor shell.
    app.get('*', (_request, response) => {
      response.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  const onError: ErrorRequestHandler = (error, _request, response, _next) => {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    if (error instanceof SyntaxError) {
      response.status(400).json({ message: 'Request body is not valid JSON.' });
      return;
    }
    // eslint-disable-next-line no-console
    console.error(error);
    response.status(500).json({ message });
  };
  app.use(onError);

  return app;
}
