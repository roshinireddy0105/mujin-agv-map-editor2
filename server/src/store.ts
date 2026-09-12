import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AgvMap,
  MapResource,
  canonicalMapJson,
  formatMapDocument,
  normaliseMap,
  parseMapDocument,
  sampleMap,
} from '@agv/shared';

/**
 * Revision of a map, derived from its content rather than kept as a counter.
 *
 * Content-derived means it survives a server restart, and two clients that
 * happen to save byte-identical maps do not fight over a conflict that would
 * have no effect. It is the ETag the API hands out.
 */
export function revisionOf(map: AgvMap): string {
  return createHash('sha256').update(canonicalMapJson(map)).digest('hex').slice(0, 12);
}

export function resourceOf(map: AgvMap): MapResource {
  return { revision: revisionOf(map), map };
}

/** Raised when a caller's revision no longer matches what is stored. */
export class RevisionConflictError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Map has changed on the server. Expected revision ${expected}, found ${actual}.`);
    this.name = 'RevisionConflictError';
  }
}

export interface MapStore {
  load(): Promise<MapResource>;
  /** Pass `expectedRevision` to make the write conditional. */
  save(map: AgvMap, expectedRevision?: string): Promise<MapResource>;
  reset(): Promise<MapResource>;
}

/** In-memory store. Used by the tests and by `npm run dev` when asked. */
export class MemoryMapStore implements MapStore {
  private map: AgvMap;

  constructor(initial: AgvMap = sampleMap()) {
    this.map = normaliseMap(initial);
  }

  async load(): Promise<MapResource> {
    return resourceOf(this.map);
  }

  async save(map: AgvMap, expectedRevision?: string): Promise<MapResource> {
    const current = revisionOf(this.map);
    if (expectedRevision !== undefined && expectedRevision !== current) {
      throw new RevisionConflictError(expectedRevision, current);
    }
    this.map = normaliseMap(map);
    return resourceOf(this.map);
  }

  async reset(): Promise<MapResource> {
    this.map = normaliseMap(sampleMap());
    return resourceOf(this.map);
  }
}

/**
 * JSON-file store.
 *
 * Writes go to a temporary file and are then renamed over the target, so a
 * crash mid-write cannot leave a truncated map on disk — the map is the only
 * copy of the operator's work, so a half-written file is the worst outcome
 * available.
 */
export class FileMapStore implements MapStore {
  constructor(private readonly filePath: string) {}

  private async readOrSeed(): Promise<AgvMap> {
    try {
      const text = await readFile(this.filePath, 'utf8');
      const parsed = parseMapDocument(JSON.parse(text) as unknown);
      if ('errors' in parsed) {
        const detail = parsed.errors.map((issue) => issue.message).join(' ');
        throw new Error(`Stored map at ${this.filePath} is not valid: ${detail}`);
      }
      return normaliseMap(parsed.map);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const seeded = normaliseMap(sampleMap());
      await this.write(seeded);
      return seeded;
    }
  }

  private async write(map: AgvMap): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, formatMapDocument(map), 'utf8');
    await rename(temporary, this.filePath);
  }

  async load(): Promise<MapResource> {
    return resourceOf(await this.readOrSeed());
  }

  async save(map: AgvMap, expectedRevision?: string): Promise<MapResource> {
    const current = await this.readOrSeed();
    const currentRevision = revisionOf(current);
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new RevisionConflictError(expectedRevision, currentRevision);
    }
    const next = normaliseMap(map);
    await this.write(next);
    return resourceOf(next);
  }

  async reset(): Promise<MapResource> {
    const seeded = normaliseMap(sampleMap());
    await this.write(seeded);
    return resourceOf(seeded);
  }
}
