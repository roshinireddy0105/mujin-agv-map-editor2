import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { FileMapStore } from './store';

const here = path.dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

/**
 * MAP_FILE is a volume mount point in the container, so edits outlive the
 * container. See docker-compose.yml.
 */
const mapFile = process.env.MAP_FILE ?? path.resolve(here, '../data/map.json');
const clientDir = process.env.CLIENT_DIR ?? path.resolve(here, '../../client/dist');

const app = createApp({ store: new FileMapStore(mapFile), clientDir });

app.listen(port, host, () => {
  console.log(`AGV map editor listening on http://${host}:${port}`);
  console.log(`  map file:   ${mapFile}`);
  console.log(`  client dir: ${clientDir}`);
});
