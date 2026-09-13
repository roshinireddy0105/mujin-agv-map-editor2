# AGV Map Editor

A warehouse AGV map editor built with React, TypeScript, and an Express REST API. The frontend and backend run in a single Docker container built on `debian:bullseye`.

## Submission links

- Source repository: https://github.com/roshinireddy0105/mujin-agv-map-editor2
- Docker Hub: https://hub.docker.com/r/roshinireddy0105/agv-map-editor
- Image tag used by these instructions: `roshinireddy0105/agv-map-editor:1.0`

The source repository should be private, with access granted to the assessment reviewer. The published image must be accessible to the reviewer and rebuilt after application changes.

## Run the published Docker image

Install and start Docker Desktop, using Linux containers. Port 8080 must be available. Run:

```bat
docker pull roshinireddy0105/agv-map-editor:1.0
docker run -d --name agv-editor-review -p 127.0.0.1:8080:8080 -v agv-review-data:/data roshinireddy0105/agv-map-editor:1.0
```

Open http://localhost:8080 in a browser. Node.js is not required on the host when running the Docker image.

Inspect the container:

```bat
docker ps
docker logs agv-editor-review
curl http://localhost:8080/api/health
```

Stop or start the existing container:

```bat
docker stop agv-editor-review
docker start agv-editor-review
```

Run the `docker run` command only when creating a new container. If the name already exists, start that container or use a different name. If port 8080 is occupied, use `-p 127.0.0.1:8081:8080` and open http://localhost:8081 instead.

### Saved map data

The backend saves map JSON to `/data/map.json` inside the container. The named volume `agv-review-data` preserves that file across container restarts and can be reused by a replacement container. The sample map is seeded when the store is first created.

Saved map data is stored by the server, not in browser session storage. Refreshing reloads the saved map; save edits before refreshing. The Dockerfile declares `/data` as a volume. Omitting `-v` creates an anonymous volume, which is not automatically reused by a new container. Use the named volume command above for predictable persistence. Do not remove the volume if you need its saved map.

## Run from source

Install Git and Node.js 20 with npm. Clone the repository using an account with access:

```bat
git clone https://github.com/roshinireddy0105/mujin-agv-map-editor2.git
cd mujin-agv-map-editor2
npm ci
npm run dev
```

These commands assume `package-lock.json` is committed. The API uses port 8080 and Vite uses port 5173, forwarding `/api` requests to the backend. Open http://localhost:5173. Stop any Docker container occupying port 8080 before starting the development server.

All npm commands below run from the project root, containing the root `package.json`. In Windows PowerShell, use `npm.cmd` instead of `npm` if script execution is blocked.

## Automated tests, type checking, and build

Run these commands individually, stopping if any command fails:

```bat
npm test
npm run typecheck
npm run build
```

Run an individual test suite:

```bat
npm run test --workspace shared
npm run test --workspace server
npm run test --workspace client
```

Run backend tests in watch mode:

```bat
npm run test:watch --workspace server
```

Verification of this updated source reported:

| Suite | Passing tests | Coverage areas |
| --- | ---: | --- |
| Shared | 49 | Geometry and map validation |
| Server | 26 | REST endpoints, validation, revision conflicts, and file persistence |
| Client | 63 | Inspector, reducer, snapping, and viewport calculations |
| Total | 138 | Frontend, backend, and shared logic |

Type checking and the frontend/backend production builds also passed. Docker is not available in the editing environment, so the container build and final browser checks must be performed locally. Rerun checks after source changes. These automated results do not replace checking the rendered editor and the final published container.

## Build and publish the Docker image

From the project root with Docker Desktop running:

```bat
docker build -t roshinireddy0105/agv-map-editor:1.0 .
```

The Dockerfile runs type checking, automated tests, and production builds in the build stage. The runtime uses an unprivileged user, exposes port 8080, and has an HTTP health check.

Test the newly built image on port 8081, allowing an existing editor on 8080 to keep running:

```bat
docker run -d --name agv-editor-final-check -p 127.0.0.1:8081:8080 -v agv-final-check-data:/data roshinireddy0105/agv-map-editor:1.0
curl http://localhost:8081/api/health
docker logs agv-editor-final-check
```

Open http://localhost:8081. Complete the manual checks below before publishing. If this test container name already exists, use a new name for the new image; starting an old container does not switch it to a newly built image.

After successful checks, sign in to the Docker Hub account `roshinireddy0105` and publish:

```bat
docker login
docker push roshinireddy0105/agv-map-editor:1.0
docker buildx imagetools inspect roshinireddy0105/agv-map-editor:1.0
```

The last command inspects the published manifest and its supported platforms. A normal build publishes the platform built locally; these instructions do not claim a multi-platform image. Rebuilding or pushing a tag does not update containers already running from the older image.

## Manual verification

1. Open the editor and click **Fit map**. Confirm nodes can be selected and read; zoom in where labels overlap.
2. Confirm the default assignment orientation in the **Compass** dropdown: North = +X and West = +Y. See the orientation note below.
3. Edit a node name, save, and refresh. Confirm the saved name remains.
4. Edit coordinates, QR code, directions, charger, and chute fields. Confirm invalid values receive useful feedback.
5. Confirm lanes only connect nodes with equal x or equal y; no diagonal lanes are allowed.
6. Exercise adding/deleting nodes, undo/redo, zoom, rotation, and node dragging.
7. In browser developer tools, open **Network > Fetch/XHR**. Refresh and save; inspect successful `GET /api/map` and `PUT /api/map` requests.
8. Restart the test container with `docker restart agv-editor-final-check`, then reload http://localhost:8081 and confirm saved data remains.
9. Restore any test edits you do not want to keep, and save again.

## Map format and movement

The document contains `map.maxNeighborDistance` and a `map.nodes` array. The sample is included at `shared/src/__fixtures__/sample-map.json`.

| Field | Meaning |
| --- | --- |
| `x`, `y` | Integer coordinates in millimeters |
| `code` | Integer floor QR code |
| `directions` | Optional list of outbound travel directions |
| `name` | Optional readable node name |
| `charger.direction` | Charger plug direction; an AGV backs in by moving in the opposite direction |
| `chute.direction` | Payload ejection travel direction |

The implementation derives neighboring lanes from aligned nodes within `maxNeighborDistance`, with intervening nodes preventing direct connections across them. Snapping helps dragged nodes stay aligned with nearby rows and columns.

### Orientation

The frontend and API default to the assessment convention: **North = +X and West = +Y** (`specText`). North renders upward on screen. The alternate **North = +Y and East = +X** interpretation (`mapData`) remains available through the Compass dropdown for comparison.

Under the required convention, some directions in the supplied sample do not point to neighboring nodes. The editor reports these as warnings; it preserves the sample data and allows saving. Warnings do not redefine the required axes.

Validating endpoints accept `?orientation=specText` or `?orientation=mapData`. When omitted, the orientation is `specText`.

## REST API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| GET | `/api/map` | Load the map and revision; ETag contains the revision |
| PUT | `/api/map` | Validate and replace the saved map |
| POST | `/api/map/validate` | Validate without saving |
| GET | `/api/map/download` | Download map JSON |
| POST | `/api/map/reset` | Replace saved data with the sample map |

Read-only examples for Windows CMD:

```bat
curl http://localhost:8080/api/health
curl http://localhost:8080/api/map
```

Saves use the whole map document because changing a node can affect neighboring lanes. Revision values can be sent using `If-Match` or a `revision` body field. A stale revision produces `409`; omitting a revision allows an unconditional save. Malformed JSON produces `400`, and invalid map data produces `422`. Successful reads and saves produce `200`. Unknown API routes return `404`.

Map validation is shared between client and server. Structural problems, invalid integer fields, duplicate coordinates, and disallowed duplicate QR codes block saving. Connectivity and docking concerns can produce warnings. File writes use a temporary file followed by rename to avoid partially written map JSON.

## Project layout

| Folder | Purpose |
| --- | --- |
| `shared/` | Map types, orientation, geometry, validation, and sample data |
| `server/` | Express API and map persistence |
| `client/` | React editor, state, and SVG map rendering |

## Other limitations

- Concurrent edits are detected through revision checks but are not merged automatically.
- Saves replace the complete map; large maps may require more incremental processing.
- There is no authentication; anyone with network access to the API can edit the map. The provided Docker commands bind to the local host.
- Rotation changes the view rather than the stored map coordinates.
- Labels may overlap when zoomed out; use zoom and pan to inspect dense areas.
- There is no floor-plan image underlay.

## Submission checklist

- Confirm the editor opens with North = +X and West = +Y.
- Commit all source files, tests, the lockfile, Dockerfile, and this README to the private repository.
- Grant the assessment reviewer repository access using their confirmed GitHub identity.
- Run tests, type checking, and production build on the final source.
- Build and manually check the final Docker image, then push it to Docker Hub.
- Include the private repository link, Docker Hub link, exact image tag, and this README in the assessment email reply.
- A separately hosted public website is not required; reviewers can run the supplied Docker image locally.

## Commit and push the updated files

In the existing repository checkout, review the changes first:

```bat
git status
git diff --stat
git remote -v
```

For this update, stage the replacement files:

```bat
git add README.md Dockerfile shared/src/orientation.ts shared/src/__tests__/geometry.test.ts shared/src/__tests__/validate.test.ts client/src/state/mapReducer.ts client/src/__tests__/mapReducer.test.ts server/src/app.ts server/src/__tests__/api.test.ts
git diff --cached --stat
git commit -m "Follow assessment compass convention and update submission instructions"
git push assessment main
```

The push command uses the previously reported `assessment` remote and `main` branch. Confirm `git remote -v` points to the intended private repository before pushing. If the remote name differs, use the actual remote name. Keep the existing `.git` directory when replacing files; do not initialize a second repository.
