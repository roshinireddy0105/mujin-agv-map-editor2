# AGV map editor

An editor for AGV floor maps: React and TypeScript front end, Express API,
shipped as a single Docker image built on `debian:bullseye`.

The map format is the one from the assignment. The example file is included as
`shared/src/__fixtures__/sample-map.json` and is what the server seeds on first
start.

---

## Run it

### From Docker Hub

```bash
docker run --rm -p 8080:8080 -v agv-map:/data <your-dockerhub-user>/agv-map-editor:1.0.0
```

Then open <http://localhost:8080>.

The `-v` is optional. Without it the editor works fine, but edits live in the
container's writable layer and disappear with the container. With it the map
persists across restarts.

### From source

```bash
npm install
npm run dev
```

`npm run dev` starts the API on `:8080` and Vite on `:5173` with `/api` proxied
across. Open <http://localhost:5173>.

### Build the image yourself

```bash
docker build -t agv-map-editor:local .
docker run --rm -p 8080:8080 agv-map-editor:local
```

Or `docker compose up --build`, which wires up the volume for you.

The typecheck and the full test suite run inside the image build. A build that
succeeds is a build whose tests passed.

### Publish the image

```bash
docker login
docker build -t <your-dockerhub-user>/agv-map-editor:1.0.0 .
docker tag <your-dockerhub-user>/agv-map-editor:1.0.0 <your-dockerhub-user>/agv-map-editor:latest
docker push <your-dockerhub-user>/agv-map-editor:1.0.0
docker push <your-dockerhub-user>/agv-map-editor:latest
```

---

## Test it

```bash
npm test              # shared, server and client
npm run test:shared   # domain rules: geometry, orientation, validation
npm run test:server   # API integration tests over supertest
npm run test:client   # reducer, viewport maths, snapping, Inspector
npm run typecheck     # tsc --noEmit across all three packages
```

Watch mode is `npm run test:watch --workspace <shared|server|client>`.

What the suites cover:

| Suite | Focus |
| --- | --- |
| `shared` | Edge/neighbour rules including lane occlusion, every validation rule, and the orientation question below |
| `server` | Each endpoint, 422 on an incoherent map, 409 on a stale revision, atomic file writes, seeding, corrupt-file handling |
| `client` | Reducer (undo/redo, drag coalescing, dirty tracking), pan/zoom/rotate maths, axis snapping, Inspector interactions |

---

## The orientation discrepancy

**The assignment text and the sample map disagree about which way the compass
points, and the editor follows the data.**

The brief says North is +X and West is +Y. Scoring all eight possible
compass-to-axis mappings against the sample map's 73 direction annotations:

| Mapping | Directions pointing at nothing | Undrivable lanes | Mean nodes reachable |
| --- | --- | --- | --- |
| North = +X, West = +Y (as written) | 20 | 31 | 2.7 / 58 |
| **North = +Y, East = +X** | **0** | 15 | **42.8 / 58** |

Two further checks agree independently:

- Both chargers (`CHRG1`, plug West; `CHRG2`, plug South) have a neighbour on
  the plug side — which is where an AGV must reverse in from. Under the literal
  reading neither does.
- The one chute ejects its payload onto empty floor rather than into an
  occupied node.

So `North = +Y` is the default. The literal reading is still available in the
**Compass** dropdown in the header and is covered by tests, so if the brief's
wording is authoritative for a given fleet, it is one click away and nothing
else in the codebase changes. `shared/src/orientation.ts` holds both, and every
rendering component is written against a screen-space invariant (North is
always up) so none of them know which is active.

If this is a deliberate part of the exercise, the answer is: the data wins, but
say so out loud rather than silently picking one.

---

## Editor

| Action | How |
| --- | --- |
| Pan | Drag the background |
| Zoom | Scroll or trackpad pinch, anchored at the cursor |
| Rotate | `↺` / `↻` in the header, 15° a step |
| Frame everything | <kbd>F</kbd> |
| Move a node | Drag it; it snaps onto nearby rows and columns |
| Add a node | **Add node**, then click the floor |
| Delete | Select, then <kbd>Delete</kbd> |
| Undo / redo | <kbd>Cmd/Ctrl</kbd>+<kbd>Z</kbd>, <kbd>Shift</kbd> to redo |
| Save | <kbd>Cmd/Ctrl</kbd>+<kbd>S</kbd> |

**Snapping is a correctness feature, not a convenience.** Two nodes are only
connectable when an axis matches *exactly*, so a drag that lands 3mm off does
not create a slightly crooked lane — it silently destroys the lane. Each axis
snaps independently, which is what lets you slide a node along its own aisle
while staying aligned to it. The pull radius is a constant 12 screen pixels
converted to millimetres at the current zoom, so it feels the same however far
out you are.

**Lane rendering encodes drivability.** A lane drivable both ways is solid, a
one-way lane is drawn darker, and a lane no AGV can drive in either direction
is faint and dashed — it is adjacency without being a route. The sample map has
15 of those, which is why they are a warning rather than an error.

---

## API

Base path `/api`. All bodies are JSON. `?orientation=mapData|specText` is
accepted on the validating endpoints and defaults to `mapData`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness, used by the container healthcheck |
| `GET` | `/map` | Current map plus its revision; `ETag` carries the revision |
| `PUT` | `/map` | Replace the map |
| `POST` | `/map/validate` | Check a map without saving; returns issues and lane statistics |
| `GET` | `/map/download` | The map as an attachment, in the assignment's file format |
| `POST` | `/map/reset` | Restore the map supplied with the assignment |

```bash
curl -s localhost:8080/api/map | head -c 200
curl -s -X PUT localhost:8080/api/map \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "<revision>"' \
  -d '{"map":{"maxNeighborDistance":1500,"nodes":[{"x":0,"y":0,"code":1}]}}'
```

### Why `PUT` on the whole document

A map is edited as a whole. Moving one node changes which lanes exist
*elsewhere* — its old neighbours may now be within range of each other, and its
new position may occlude a lane it has nothing to do with. There is no coherent
single-node patch, so `PATCH /map/nodes/:id` would be an API that lies about its
own blast radius. One `PUT`, validated as a unit.

### Concurrency

`revision` is a SHA-256 of the canonical map JSON, truncated to 12 hex
characters — not a counter. Content-derived means it survives a server restart,
and two clients that save byte-identical maps never conflict over a write with
no effect.

Send it back as `If-Match` or as `revision` in the body and the write becomes
conditional: `409` with both revisions if the map moved underneath you, and the
editor offers to load the server's version. Send neither and the write is
unconditional, which is what a first-time import wants.

### Status codes

| Code | When |
| --- | --- |
| `200` | Read or save succeeded. A save also returns any warnings |
| `400` | Body was not JSON |
| `409` | Supplied revision no longer matches |
| `422` | Map failed validation; nothing was written |

Errors always carry the shared issue list, so the editor can point at the
offending node rather than showing a bare "save failed".

---

## Validation

`shared/src/validate.ts` is the single source of truth. The client runs it on
every edit and the server enforces it on save, so the editor can never show a
map as clean that the API would then reject.

**Errors** block a save:

| Code | Rule |
| --- | --- |
| `E000`–`E006` | Structural: shape, types, unknown compass headings, malformed charger/chute |
| `E010` | `maxNeighborDistance` must be a positive whole number |
| `E011`, `E012` | Coordinates and codes must be whole numbers |
| `E013` | Two nodes in the same place |
| `E014` | A QR code reused (0 may repeat — the sample map uses it for "unassigned") |

**Warnings** never block a save, because a half-built map legitimately has
dangling lanes while you work on it:

| Code | Rule |
| --- | --- |
| `W010` | Repeated entries in `directions` |
| `W011` | A name used by more than one node |
| `W012` | A node with no neighbour within range on either axis |
| `W013` | A node with no exit directions — an AGV that arrives cannot leave |
| `W014` | A direction pointing where there is no neighbour |
| `W015` | A lane no AGV can drive in either direction |
| `W016` | A charger with no neighbour on the plug side, so nothing can dock |

### Two rules deliberately *not* implemented

- **Charger departure headings.** `CHRG1` reverses in from the West and leaves
  to the South. Requiring the outbound heading to mirror the plug direction
  would flag a charger that works perfectly well.
- **Anything inferring a chute's surroundings.** One sample is not a convention.

---

## Layout

```
shared/    Map types, orientation, edge geometry, validation, serialisation
server/    Express API and the map store
client/    React editor
```

`shared/` is imported by both sides at its TypeScript source rather than through
a build artefact, so the domain layer needs no separate compile step and a
change to a validation rule hot-reloads in the editor.

### Notes on the implementation

**Lane occlusion.** Two aligned nodes within `maxNeighborDistance` are only
neighbours if no third node sits between them. This is load-bearing: the sample
map's `x=1000` column has nodes at `y=2700` and `y=4110`, 1410mm apart and so
inside the 1500mm limit, with `y=3405` between them. Without the rule the editor
draws a phantom lane straight through an existing node. Sorting each line and
keeping consecutive pairs enforces it for free.

**SVG, not canvas.** Nodes are real DOM elements, so hit-testing, hover,
focus and accessible labels come for free, and pan/zoom/rotate is one transform
on a group. At 58 nodes and 75 lanes there is no reason to reach for canvas.

**Interaction maths is pure.** `client/src/lib/viewport.ts` implements the
affine transform with plain arithmetic rather than `getScreenCTM`, so cursor-
anchored zoom and fixed-point rotation are unit-tested without a browser.

**Drags are one undo step.** A pointer move fires dozens of times; the reducer
coalesces after the first, so one drag is one entry in the history.

**Numeric fields commit on blur or Enter, never per keystroke.** Typing "1000"
passes through 1 and 10, each a legal position that would relocate the node and
rebuild the lane graph mid-edit.

**File writes are atomic.** The store writes to a temporary file and renames it
over the target. The map is the only copy of the operator's work, so a
half-written file is the worst available outcome.

**No webfont.** The deliverable must render correctly on a machine with no
internet access, and a blocked font request would drop the coordinate readout
into a fallback with proportional digits. A system stack with tabular numerals
is the part that actually matters.

---

## Requirements checklist

| Requirement | Status |
| --- | --- |
| 1. Built on `debian:bullseye` | Yes. Node 20 from the official tarball, checksum verified |
| 2. React + TypeScript editor for the format | Yes. All properties editable: `x`, `y`, `code`, `directions`, `charger`, `chute`, `name` |
| 3. HTTP server with a well-designed API | Yes. REST over Express, `ETag`/`If-Match` concurrency, validation on write |
| 4. Automated tests, front and back | Yes. Three suites, run in the image build |
| 5. Bonus: zoom, rotate, drag-and-drop | Yes. Cursor-anchored zoom, arbitrary rotation with upright labels, snapping node drag |

---

## Known limitations

- **Single-writer assumption.** `ETag`/`If-Match` catches a conflict but does
  not merge; the loser reloads. Real collaboration needs per-node operations
  and a CRDT or a lock, which is a different design.
- **Whole-document saves.** Fine at this size. A map of 50,000 nodes would want
  a diff-based endpoint and a spatial index for the neighbour computation, which
  is currently `O(n log n)` per line but recomputed on every edit.
- **No authentication.** There is no user model, so anyone who can reach the
  port can rewrite the map.
- **Rotation is view-only.** It turns the camera, not the map data. Rotating
  coordinates would change which nodes are axis-aligned and so destroy lanes.
- **No image underlay.** A real floor map would be traced over a site plan.
##end here 
