import type { AgvMap, Issue, MapResource, OrientationId, ValidationResult } from '@agv/shared';

const BASE = '/api';

export interface SaveResult extends MapResource {
  warnings: Issue[];
}

export interface ValidationReport extends ValidationResult {
  stats: {
    orientation: string;
    nodeCount: number;
    laneCount: number;
    isolatedNodeCount: number;
    errorCount: number;
    warningCount: number;
  };
}

/**
 * Carries the server's own issue list so the editor can point at the offending
 * nodes instead of showing a bare "save failed".
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: Issue[] = [],
    readonly currentRevision?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

async function toError(response: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON error body; the status alone will have to do.
  }
  const message =
    typeof body.message === 'string' ? body.message : `Request failed (${response.status}).`;
  const issues = Array.isArray(body.errors) ? (body.errors as Issue[]) : [];
  const currentRevision =
    typeof body.currentRevision === 'string' ? body.currentRevision : undefined;
  return new ApiError(message, response.status, issues, currentRevision);
}

export async function fetchMap(): Promise<MapResource> {
  const response = await fetch(`${BASE}/map`);
  if (!response.ok) throw await toError(response);
  return (await response.json()) as MapResource;
}

export async function saveMap(
  map: AgvMap,
  revision: string | null,
  orientationId: OrientationId,
): Promise<SaveResult> {
  const response = await fetch(`${BASE}/map?orientation=${orientationId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(revision ? { 'If-Match': `"${revision}"` } : {}),
    },
    body: JSON.stringify({ map }),
  });
  if (!response.ok) throw await toError(response);
  return (await response.json()) as SaveResult;
}

export async function validateOnServer(
  map: AgvMap,
  orientationId: OrientationId,
): Promise<ValidationReport> {
  const response = await fetch(`${BASE}/map/validate?orientation=${orientationId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ map }),
  });
  if (!response.ok) throw await toError(response);
  return (await response.json()) as ValidationReport;
}

export async function resetMap(): Promise<MapResource> {
  const response = await fetch(`${BASE}/map/reset`, { method: 'POST' });
  if (!response.ok) throw await toError(response);
  return (await response.json()) as MapResource;
}

export const downloadUrl = `${BASE}/map/download`;
