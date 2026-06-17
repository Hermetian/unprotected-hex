# Unprotected Hex — Architecture

## Purpose

A browser-based hex grid game with two modes:
- **Escape Mode**: Place a white hex, then BFS expands through randomly-colored neighbors. The hex escapes if it reaches distance 10,000; otherwise it's encircled.
- **Hex vs Hex Mode**: White and black hexes compete. Boundary hexes (touching both colors) are randomly colored. A color loses when its starting hex is completely surrounded by the opponent.

## Module Structure

```
hex-core.js      Pure logic (constants, coordinate math, BFS algorithms)
run-tracker.js   RunTracker class (game history with pluggable storage)
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
- `isHexTrapped(q, r, maxDist, hexColors)` — Can a hex's color region escape to open space?
- `findEncircledPockets(hexColors)` — Find untested regions surrounded only by black
- `sliderToSpeed(value)` / `speedToLabel(speed)` — Map the speed slider to a multiplier and its display label
- `computePacing(count, speedMultiplier)` — Per-step animation pacing (batch size + delay) from the live frontier size

### run-tracker.js
Generic run history tracker used for both game modes. Accepts a `storage` adapter (defaults to `localStorage`) for testability.

### hex.js
The main application file. Imports from `hex-core.js` and `run-tracker.js`. Handles:
- WebGL2 instanced rendering (hex geometry as triangle fan)
- Canvas overlay for start hex marker
- BFS game loops (`checkEncirclement`, `hexVsHexCheck`)
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
- `tests/hex-core.test.js` — Pure logic tests (coordinate math, BFS, pocket detection)
- `tests/run-tracker.test.js` — Run tracking with in-memory storage adapter
- Run: `npm test`
