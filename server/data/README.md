# Map storage

`map.json` is created here the first time the server reads a map, seeded from
the example file in the assignment (`shared/src/__fixtures__/sample-map.json`).
It is git-ignored because it is runtime state, not source.

In the Docker image this path is overridden by `MAP_FILE=/data/map.json`, which
is a volume, so edits survive the container.

Delete the file to start again from the sample map, or call
`POST /api/map/reset`.
