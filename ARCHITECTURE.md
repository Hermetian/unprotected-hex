# Unprotected Hex — Architecture

## Purpose

A browser-based hex grid game with two modes:
- **Escape Mode**: Place a white hex, then BFS expands through randomly-colored neighbors. The hex escapes if it reaches distance 10,000; otherwise it's encircled.
- **Hex vs Hex Mode**: White and black hexes compete. Boundary hexes (touching both colors) are randomly colored. A color loses when its starting hex is completely surrounded by the opponent.

## Module Structure

```
hex-core.js      Pure logic (constants, coordinate math, BFS algorithms)
run-tracker.js   RunTracker class (game history with pluggable storage)
run-session.js   RunSession class (cancellation token for the in-flight run)
hex.js           Main application (WebGL rendering, DOM, game loop)
index.html       Entry point (loads hex.js as ES module)
style.css        Styles
```

### hex-core.js
Zero-dependency pure functions. No DOM, no WebGL, no side effects. All state (like `hexColors`) is passed as parameters, making functions fully testable.

Exports:
- `CONFIG` — Magic numbers (`ESCAPE_DISTANCE`, `KEY_OFFSET`, `KEY_MULTIPLIER`, `BASE_HEX_SIZE`, etc.)
- `NEIGHBOR_OFFSETS` — The 6 axial hex neighbor deltas
- `numKey(q, r)` / `decodeKey(key)` — Encode axial coords as a single numeric key for Map storage
- `axialRound(q, r)` — Round fractional axial coords to nearest hex (cube constraint)
- `hexDist(q, r)` — Hex distance from origin
- `clockwiseAngle(q, r)` — Clockwise angle from East (0 to 2π)
- `selectNextFrontierHex(frontier)` — Pick outermost, then clockwise-most frontier hex
- `pixelToAxial(px, py, hexSize)` — Convert pixel to axial coordinates
- `getTouchedColors(q, r, hexColors)` — What colors neighbor an untested hex
- `getFrontiers(hexColors)` — Categorize untested hexes into boundary/white/black frontier
- `updateBoundaryForColored(boundary, q, r, hexColors)` — Incrementally update a boundary set after one hex is colored (the hex-vs-hex loop's O(1)-per-step replacement for a full `getFrontiers` rescan)
- `isHexTrapped(q, r, maxDist, hexColors)` — Can a hex's color region escape to open space?
- `findEncircledPockets(hexColors)` — Find untested regions surrounded only by black
- `determineBattleWinner(whiteStart, blackStart, maxDist, hexColors)` — Decide a hex-vs-hex outcome (`'white'`/`'black'`/`'unresolved'`), or `null` if still undecided
- `createBattle(whiteStart, blackStart, hexColors, escapeDistance?)` / `stepBattle(sim, rng)` — Pure hex-vs-hex simulation: `createBattle` seeds the state (boundary, trackers); `stepBattle` advances it one cell using an injected RNG, owning all win/draw logic. `hex.js` drives these and handles only the GPU/render/pacing side effects.
- `createEscape(startQ, startR, hexColors, escapeDistance?)` / `stepEscape(sim, rng)` — Pure escape-mode BFS: `createEscape` seeds the flood (visited set + queue); `stepEscape` advances it one BFS node using an injected RNG, lazily coloring the node's neighbors (50/50), enqueuing the white ones, and owning the escaped/encircled decision. Each step reports the cells it colored (`sim.colored`) so the driver can mirror them to the GPU. Same `escapeDistance` guard as `createBattle` (non-finite/non-positive falls back to the default).
- `sliderToSpeed(value)` / `speedToLabel(speed)` — Map the speed slider to a multiplier and its display label
- `computePacing(count, speedMultiplier)` — Per-step animation pacing (batch size + delay) from the live frontier size

### run-tracker.js
Generic run history tracker used for both game modes. Accepts a `storage` adapter (defaults to `localStorage`) for testability.

### run-session.js
A one-class module owning a monotonic generation counter. The escape/battle loops in `hex.js` are long-running async functions that `await` between animation batches; while one is suspended the user can hit **Reset**, switch modes, or start a new run. Each run captures a token from `runSession.begin()`, and after every `await` checks `runSession.isCurrent(token)` — once a newer `begin()` or a `cancel()` (fired by `reset()`) has advanced the counter, the token is stale and the loop returns `{ cancelled: true }` instead of continuing to mutate the (now cleared) grid. This prevents a superseded loop from spawning ghost hexes onto a reset board or clobbering the status line.

### hex.js
The main application file. Imports from `hex-core.js`, `run-tracker.js`, and `run-session.js`. Handles:
- WebGL2 instanced rendering (hex geometry as triangle fan)
- Canvas overlay for start hex marker
- Game loops cancellable via the shared `runSession`. Both are now thin drivers over a pure stepper in `hex-core.js` — the simulation (cell selection, coloring, win/escape detection) lives in the core and is unit-tested, and the driver only mirrors each colored cell into the GPU buffer and handles pacing, rendering, and cancellation:
  - `checkEncirclement` — drives `createEscape`/`stepEscape`. Each `stepEscape` processes one BFS node and returns the cells it colored; the driver iterates them, keeping the original per-neighbor pacing granularity (`stepCount` ticks once per colored cell) and the exact status readout.
  - `hexVsHexCheck` — drives `createBattle`/`stepBattle`. The boundary is seeded once and maintained with `updateBoundaryForColored`, so per-step cost stays O(1) in the boundary rather than O(N) in the whole board.
- User interaction (click placement, pan, zoom, speed control)
- Two `RunTracker` instances (`escapeTracker`, `hvhTracker`)

## Coordinate System

Uses **axial coordinates** (q, r) for the hex grid:
- q axis points East
- r axis points Southeast
- The implicit s = -q - r completes the cube coordinate triple
- Hex distance = `(|q| + |r| + |s|) / 2`
- Pixel conversion: `px = hexWidth * (q + r/2)`, `py = hexHeight * 0.75 * r`

Coordinates are encoded as numeric keys via `numKey(q, r)` for fast Map lookups, using offset arithmetic to handle negative values.

## Rendering Pipeline

1. Hex geometry (pointy-top hexagon) stored as static vertex/index buffers
2. Instance data (axial coords + color) uploaded per-frame when dirty
3. Vertex shader converts axial → pixel → clip space with pan/zoom uniforms
4. Single `drawElementsInstanced` call renders all hexes
5. 2D canvas overlay draws the start hex marker

## Testing

- Framework: Vitest (ES module native, no build step)
- `tests/hex-core.test.js` — Pure logic tests (coordinate math, BFS, pocket detection, incremental-boundary equivalence with `getFrontiers`, hex-vs-hex battle outcomes via `determineBattleWinner`/`stepBattle`, and escape-mode outcomes via `createEscape`/`stepEscape` — including a faithful-reimplementation equivalence sweep that pins the extracted stepper to the original inline BFS across many seeds)
- `tests/run-tracker.test.js` — Run tracking with in-memory storage adapter
- `tests/run-session.test.js` — Run cancellation token (begin/cancel/supersede semantics)
- Run: `npm test`
