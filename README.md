# Unprotected Hex

A browser-based hex-grid simulation that visualizes percolation-style escape and
territory battles on an effectively infinite hexagonal lattice. Hexes are colored
lazily as the simulation explores them, and everything is drawn with a single
WebGL2 instanced draw call so the grid stays smooth into the hundreds of thousands
of cells.

## Modes

- **Escape Mode** — Place a white hex. A breadth-first search expands outward through
  neighbors that are *randomly* colored white (50/50). The region "escapes" if it
  reaches distance 10,000 from the start; otherwise it is encircled. After a run,
  any fully black-enclosed pockets are measured and reported. (At p = 0.5 the
  triangular-lattice site-percolation threshold, escapes sit right at criticality —
  which is what makes the outcome interesting.)
- **Hex vs Hex** — A white hex and an adjacent black hex compete. Cells on the
  boundary (touching both colors) are randomly colored, advancing the frontier. A
  color loses when its starting hex is completely surrounded by the opponent.

## Running it

The app is a static site that loads `hex.js` as an ES module, so it must be served
over HTTP (opening `index.html` directly via `file://` will not work — browsers
block module imports from the filesystem). Any static server works:

```sh
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed URL (e.g. <http://localhost:8000>). WebGL2 is required.

## Controls

| Action            | How                                             |
| ----------------- | ----------------------------------------------- |
| Choose mode       | Mode dropdown (top-left)                        |
| Place start hex   | Click anywhere on the grid                      |
| Run               | **Check Encirclement** / **Start Battle** button|
| Reset             | **Reset** button                                |
| Pan               | Left-click and drag                             |
| Zoom              | Zoom slider, or mouse wheel                     |
| Animation speed   | Speed slider (0.25× … MAX)                      |

Run history (wins/losses/interruptions) is persisted in `localStorage` and shown in
the status line; full history is also logged to the browser console.

## Development

```sh
npm install   # install dev dependencies (vitest)
npm test      # run the test suite once
npm run test:watch
```

The pure game logic lives in `hex-core.js` and is fully unit-tested; the DOM/WebGL
layer in `hex.js` imports from it. See [ARCHITECTURE.md](ARCHITECTURE.md) for the
module breakdown, coordinate system, and rendering pipeline.
