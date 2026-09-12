import sampleDocument from './__fixtures__/sample-map.json';
import { AgvMap, MapDocument } from './types';

export const SAMPLE_MAP_DOCUMENT = sampleDocument as MapDocument;

/** A fresh, mutable copy of the map supplied with the assignment. */
export function sampleMap(): AgvMap {
  return JSON.parse(JSON.stringify(SAMPLE_MAP_DOCUMENT.map)) as AgvMap;
}
