// hex-core.js — Pure logic ES module for hex grid operations
// No DOM, no WebGL, no side effects — fully testable

export const CONFIG = {
    ESCAPE_DISTANCE: 10000,
    KEY_OFFSET: 50000,
    KEY_MULTIPLIER: 100000,
    BASE_HEX_SIZE: 25,
    MAX_POCKET_SIZE: 10000,
    MAX_UNTESTED_SEARCH: 10000,
    BASE_MAX_DELAY: 50,
    BASE_MIN_DELAY: 1,
};

export const NEIGHBOR_OFFSETS = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]
];

// Numeric key encoding for axial hex coordinates
export function numKey(q, r) {
    return (q + CONFIG.KEY_OFFSET) * CONFIG.KEY_MULTIPLIER + (r + CONFIG.KEY_OFFSET);
}

export function decodeKey(key) {
    const q = Math.floor(key / CONFIG.KEY_MULTIPLIER) - CONFIG.KEY_OFFSET;
    const r = (key % CONFIG.KEY_MULTIPLIER) - CONFIG.KEY_OFFSET;
    return { q, r };
}

// Round fractional axial coordinates to nearest hex (cube constraint)
export function axialRound(q, r) {
    const s = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    let rs = Math.round(s);

    const qDiff = Math.abs(rq - q);
    const rDiff = Math.abs(rr - r);
    const sDiff = Math.abs(rs - s);

    if (qDiff > rDiff && qDiff > sDiff) {
        rq = -rr - rs;
    } else if (rDiff > sDiff) {
        rr = -rq - rs;
    }

    return { q: rq, r: rr };
}

// Hex distance from origin (in hex steps)
export function hexDist(q, r) {
    return (Math.abs(q) + Math.abs(r) + Math.abs(-q - r)) / 2;
}

// Clockwise angle from East (0 to 2π)
export function clockwiseAngle(q, r) {
    const x = q + r / 2;
    const y = r * Math.sqrt(3) / 2;
    const ccw = Math.atan2(y, x);
    return (2 * Math.PI - ccw + 2 * Math.PI) % (2 * Math.PI);
}

// Select next frontier hex: outermost, then clockwise-most
export function selectNextFrontierHex(frontier) {
    let bestKey = null;
    let bestDist = -1;
    let bestAngle = -1;

    for (const key of frontier) {
        const { q, r } = decodeKey(key);
        const dist = hexDist(q, r);
        const angle = clockwiseAngle(q, r);

        if (dist > bestDist || (dist === bestDist && angle > bestAngle)) {
            bestKey = key;
            bestDist = dist;
            bestAngle = angle;
        }
    }

    return bestKey;
}

// Convert pixel coordinates to axial hex coordinates
export function pixelToAxial(px, py, hexSize) {
    const q = (px * Math.sqrt(3) / 3 - py / 3) / hexSize;
    const r = (py * 2 / 3) / hexSize;
    return axialRound(q, r);
}

// Get what colors an untested hex touches
export function getTouchedColors(q, r, hexColors) {
    let touchesWhite = false;
    let touchesBlack = false;

    for (let i = 0; i < 6; i++) {
        const nq = q + NEIGHBOR_OFFSETS[i][0];
        const nr = r + NEIGHBOR_OFFSETS[i][1];
        const nk = numKey(nq, nr);
        const color = hexColors.get(nk);
        if (color === true) touchesWhite = true;
        if (color === false) touchesBlack = true;
    }

    return { touchesWhite, touchesBlack };
}

// Get combined frontier (untested hexes adjacent to either color)
export function getFrontiers(hexColors) {
    const boundary = new Set();
    const whiteFrontier = new Set();
    const blackFrontier = new Set();
    const seen = new Set();

    for (const [key] of hexColors) {
        const { q, r } = decodeKey(key);
        for (let i = 0; i < 6; i++) {
            const nq = q + NEIGHBOR_OFFSETS[i][0];
            const nr = r + NEIGHBOR_OFFSETS[i][1];
            const nk = numKey(nq, nr);

            if (hexColors.has(nk) || seen.has(nk)) continue;
            seen.add(nk);

            const { touchesWhite, touchesBlack } = getTouchedColors(nq, nr, hexColors);

            if (touchesWhite && touchesBlack) {
                boundary.add(nk);
            } else if (touchesWhite) {
                whiteFrontier.add(nk);
            } else if (touchesBlack) {
                blackFrontier.add(nk);
            }
        }
    }

    return { boundary, whiteFrontier, blackFrontier };
}

// Incrementally update a boundary set after a single hex at (q, r) is colored.
//
// The hex-vs-hex loop colors one boundary cell per step and only needs the
// `boundary` set (untested cells touching both colors). Re-deriving it with a
// full getFrontiers() rescan every step is O(total colored cells); but coloring
// one cell can only change the boundary status of that cell and its 6 immediate
// neighbors — every other cell's neighborhood is untouched. So we re-evaluate
// just those seven cells, turning an O(N) per-step rescan into O(1).
//
// Coloring is monotonic: it adds a color to the board, never removes one, so a
// cell that already touched both colors still does. The only cell that can ever
// LEAVE the boundary is the one just colored (it is no longer untested); every
// other change is a cell newly touching both colors and thus joining. Given the
// same board, this leaves `boundary` identical to getFrontiers(hexColors).boundary.
// Mutates `boundary` in place and returns it.
export function updateBoundaryForColored(boundary, q, r, hexColors) {
    // The just-colored cell is no longer an untested boundary cell.
    boundary.delete(numKey(q, r));

    // Any untested neighbor that now touches both colors joins the boundary.
    for (let i = 0; i < 6; i++) {
        const nq = q + NEIGHBOR_OFFSETS[i][0];
        const nr = r + NEIGHBOR_OFFSETS[i][1];
        const nk = numKey(nq, nr);
        if (hexColors.has(nk)) continue;

        const { touchesWhite, touchesBlack } = getTouchedColors(nq, nr, hexColors);
        if (touchesWhite && touchesBlack) boundary.add(nk);
    }

    return boundary;
}

// Check if a specific hex is trapped (can't reach distance D through untested hexes)
export function isHexTrapped(startQ, startR, maxDist, hexColors) {
    const startKey = numKey(startQ, startR);
    const startColor = hexColors.get(startKey);
    if (startColor === undefined) return false;

    // Step 1: Find all connected same-color hexes
    const sameColorRegion = new Set([startKey]);
    const sameColorQueue = [startKey];
    let head = 0;

    while (head < sameColorQueue.length) {
        const key = sameColorQueue[head++];
        const { q, r } = decodeKey(key);

        for (let i = 0; i < 6; i++) {
            const nq = q + NEIGHBOR_OFFSETS[i][0];
            const nr = r + NEIGHBOR_OFFSETS[i][1];
            const nk = numKey(nq, nr);

            if (sameColorRegion.has(nk)) continue;
            if (hexColors.get(nk) === startColor) {
                sameColorRegion.add(nk);
                sameColorQueue.push(nk);
            }
        }
    }

    // Step 2: Find all untested hexes adjacent to this region
    const untestedFrontier = new Set();
    for (const key of sameColorRegion) {
        const { q, r } = decodeKey(key);
        for (let i = 0; i < 6; i++) {
            const nq = q + NEIGHBOR_OFFSETS[i][0];
            const nr = r + NEIGHBOR_OFFSETS[i][1];
            const nk = numKey(nq, nr);
            if (!hexColors.has(nk)) {
                untestedFrontier.add(nk);
            }
        }
    }

    // If no untested frontier, we're completely surrounded by opposite color
    if (untestedFrontier.size === 0) {
        return true;
    }

    // Step 3: Check if any untested frontier hex can reach distance D
    const visited = new Set();
    const queue = [];

    for (const key of untestedFrontier) {
        visited.add(key);
        queue.push(key);
    }

    head = 0;
    while (head < queue.length && head < CONFIG.MAX_UNTESTED_SEARCH) {
        const key = queue[head++];
        const { q, r } = decodeKey(key);

        if (hexDist(q, r) >= maxDist) {
            return false;
        }

        for (let i = 0; i < 6; i++) {
            const nq = q + NEIGHBOR_OFFSETS[i][0];
            const nr = r + NEIGHBOR_OFFSETS[i][1];
            const nk = numKey(nq, nr);

            if (visited.has(nk)) continue;

            const neighborColor = hexColors.get(nk);
            if (neighborColor === undefined) {
                visited.add(nk);
                queue.push(nk);
            }
        }
    }

    if (head >= CONFIG.MAX_UNTESTED_SEARCH) {
        return false;
    }

    return true;
}

// Find encircled pockets (untested regions surrounded only by black)
export function findEncircledPockets(hexColors) {
    const pocketSizes = [];
    const checkedUntested = new Set();
    const candidates = [];
    const candidateSet = new Set();

    for (const [key, isWhite] of hexColors) {
        if (isWhite) continue;
        const { q, r } = decodeKey(key);

        for (let i = 0; i < 6; i++) {
            const nq = q + NEIGHBOR_OFFSETS[i][0];
            const nr = r + NEIGHBOR_OFFSETS[i][1];
            const nk = numKey(nq, nr);

            if (!hexColors.has(nk) && !candidateSet.has(nk)) {
                candidateSet.add(nk);
                candidates.push(nk);
            }
        }
    }

    for (const startNk of candidates) {
        if (checkedUntested.has(startNk)) continue;

        const { q: startQ, r: startR } = decodeKey(startNk);
        const queueQ = [startQ];
        const queueR = [startR];
        let queueHead = 0;
        let pocketSize = 0;

        const visited = new Set([startNk]);
        let touchesWhite = false;

        while (queueHead < queueQ.length) {
            const q = queueQ[queueHead];
            const r = queueR[queueHead++];
            pocketSize++;
            checkedUntested.add(numKey(q, r));

            if (pocketSize > CONFIG.MAX_POCKET_SIZE) break;

            for (let i = 0; i < 6; i++) {
                const nq = q + NEIGHBOR_OFFSETS[i][0];
                const nr = r + NEIGHBOR_OFFSETS[i][1];
                const nk = numKey(nq, nr);

                if (visited.has(nk)) continue;
                visited.add(nk);

                const colorValue = hexColors.get(nk);
                if (colorValue !== undefined) {
                    if (colorValue) touchesWhite = true;
                } else {
                    queueQ.push(nq);
                    queueR.push(nr);
                }
            }
        }

        if (!touchesWhite && pocketSize <= CONFIG.MAX_POCKET_SIZE && pocketSize > 0) {
            pocketSizes.push(pocketSize);
        }
    }

    return pocketSizes;
}

// --- Hex-vs-Hex battle (pure simulation) ---
// The battle's *outcome* (who wins, at what distance) is decided entirely by the
// coloring sequence and the trap checks — none of it needs the DOM or WebGL. These
// functions own that logic so it is unit-testable; hex.js drives them and handles
// only the side effects (pushing geometry to the GPU, pacing, rendering).

// Decide the battle outcome from the current board, or return null if undecided.
// A start hex loses once it is completely sealed off from open space by the
// opponent (see isHexTrapped). Used both per-step (null ⇒ keep playing) and at the
// end when the colors have separated (callers treat null there as a draw).
export function determineBattleWinner(whiteStart, blackStart, maxDist, hexColors) {
    const whiteTrapped = isHexTrapped(whiteStart.q, whiteStart.r, maxDist, hexColors);
    const blackTrapped = isHexTrapped(blackStart.q, blackStart.r, maxDist, hexColors);
    if (whiteTrapped && !blackTrapped) return 'black';
    if (blackTrapped && !whiteTrapped) return 'white';
    if (whiteTrapped && blackTrapped) return 'unresolved';
    return null;
}

// Create the mutable state for a hex-vs-hex battle. `hexColors` must already hold
// the two adjacent start hexes (white at whiteStart, black at blackStart); it is
// mutated in place as the battle colors cells. The boundary (untested cells
// touching both colors) is seeded once and then maintained incrementally by
// stepBattle — see updateBoundaryForColored for why that stays exact. The battle
// is declared an unresolved draw once a colored cell reaches `escapeDistance` from
// the origin (defaults to the game's escape radius; a smaller positive value is
// handy in tests). A non-positive or non-finite escapeDistance is meaningless — 0 or a
// negative resolves every battle instantly, +Infinity never trips the cap, and NaN
// corrupts the trap floods (since `hexDist >= NaN` is always false) — so any such value
// falls back to the default.
export function createBattle(whiteStart, blackStart, hexColors, escapeDistance = CONFIG.ESCAPE_DISTANCE) {
    if (!Number.isFinite(escapeDistance) || escapeDistance <= 0) escapeDistance = CONFIG.ESCAPE_DISTANCE;
    return {
        whiteStart,
        blackStart,
        hexColors,
        escapeDistance,
        boundary: getFrontiers(hexColors).boundary,
        maxDistReached: 0,
        // Per-step scratch the driver reads after each step():
        exposedCount: 0,           // boundary size BEFORE this step (drives pacing/status)
        colored: null,             // { q, r, isWhite } colored this step, or null
        // Terminal state:
        winner: null,              // 'white' | 'black' | 'unresolved' once done
        done: false,
    };
}

// Advance a battle by one cell, mutating `sim` (and its hexColors/boundary). `rng`
// is a function returning a float in [0, 1) — inject Math.random in the app, a
// seeded PRNG in tests. After the call:
//   - sim.colored is the cell colored this step (null if none — boundary was empty)
//   - sim.exposedCount is the boundary size *before* this step's coloring
//   - sim.done / sim.winner are set once the outcome is decided
// The selection→color→win-check order matches the original in-place loop exactly,
// so given the same rng draws the outcome is identical.
export function stepBattle(sim, rng) {
    if (sim.done) return sim;
    const { boundary, hexColors, whiteStart, blackStart, escapeDistance } = sim;

    // Boundary exhausted (empty, or — defensively — no selectable cell): the colors
    // have separated, so the battle is over. A decisive trap wins; otherwise
    // (neither start sealed) it's a draw.
    const nextKey = selectNextFrontierHex(boundary);
    if (nextKey === null) {
        sim.exposedCount = boundary.size;
        sim.colored = null;
        sim.winner = determineBattleWinner(whiteStart, blackStart, escapeDistance, hexColors) || 'unresolved';
        sim.done = true;
        return sim;
    }

    // Frontier size BEFORE coloring — drives the driver's pacing and status line.
    sim.exposedCount = boundary.size;

    const { q, r } = decodeKey(nextKey);
    const isWhite = rng() < 0.5;
    hexColors.set(nextKey, isWhite);
    updateBoundaryForColored(boundary, q, r, hexColors);
    sim.colored = { q, r, isWhite };

    const dist = hexDist(q, r);
    if (dist > sim.maxDistReached) sim.maxDistReached = dist;

    // Ran past the escape radius without anyone being sealed in — call it a draw.
    if (sim.maxDistReached >= escapeDistance) {
        sim.winner = 'unresolved';
        sim.done = true;
        return sim;
    }

    // A start now fully surrounded by the opponent loses.
    const winner = determineBattleWinner(whiteStart, blackStart, escapeDistance, hexColors);
    if (winner) {
        sim.winner = winner;
        sim.done = true;
    }
    return sim;
}

// --- Escape-mode BFS (pure simulation) ---
// Escape mode floods outward from a start hex through neighbors that are *randomly*
// colored white (50/50); the region "escapes" if any cell reaches escapeDistance and
// is "encircled" if the flood dies out first. As with the hex-vs-hex battle, the
// outcome (escaped vs encircled, the distance reached, the exact final coloring) is
// pure — it depends only on the start position and the rng draw sequence, not on the
// DOM or WebGL. These functions own that logic so it is unit-testable; hex.js drives
// them and handles only the side effects (GPU push, pacing, rendering, cancellation).

// Create the mutable state for an escape-mode run. `hexColors` should already hold
// the white start hex at (startQ, startR); it is mutated in place as the BFS colors
// cells. The region escapes once a *dequeued* cell sits at or beyond `escapeDistance`
// from the origin (defaults to the game's escape radius; a smaller positive value is
// handy in tests). A non-positive or non-finite escapeDistance is meaningless — 0 or a
// negative escapes from the start cell, +Infinity never escapes, and NaN never escapes
// either (since `dist >= NaN` is always false) — so any such value falls back to the
// default, matching createBattle's guard.
export function createEscape(startQ, startR, hexColors, escapeDistance = CONFIG.ESCAPE_DISTANCE) {
    if (!Number.isFinite(escapeDistance) || escapeDistance <= 0) escapeDistance = CONFIG.ESCAPE_DISTANCE;
    return {
        hexColors,
        escapeDistance,
        visited: new Set([numKey(startQ, startR)]),
        // Parallel-array BFS queue (q, r, dist), consumed via a moving head index.
        queueQ: [startQ],
        queueR: [startR],
        queueDist: [0],
        queueHead: 0,
        maxDistReached: 0,
        // Per-step scratch the driver reads after each step():
        exposedCount: 0,    // BFS frontier size BEFORE this step's expansion (pacing/status)
        colored: [],    // cells colored this step: [{ q, r, isWhite }, ...] in neighbor order
        // Terminal state:
        escaped: null,    // true once a cell reaches escapeDistance, false once encircled
        distance: 0,    // distance reported at termination
        done: false,
    };
}

// Advance an escape run by one BFS node, mutating `sim` (and its hexColors). `rng`
// is a function returning a float in [0, 1) — inject Math.random in the app, a
// seeded PRNG in tests. After the call:
//   - sim.colored lists the cells colored this step (the dequeued node's not-yet-
//     visited neighbors, in NEIGHBOR_OFFSETS order; empty on a terminal step)
//   - sim.maxDistReached is this node's distance and sim.exposedCount the pre-expansion
//     frontier size — the driver's status line and pacing read both
//   - sim.done / sim.escaped / sim.distance are set once the outcome is decided
// The dequeue → escape-check → expand order matches the original inline loop exactly,
// and exactly one rng draw is spent per newly-colored cell, so given the same draws
// the escaped/encircled outcome and the final board are identical.
export function stepEscape(sim, rng) {
    if (sim.done) return sim;
    const { hexColors, visited, queueQ, queueR, queueDist, escapeDistance } = sim;

    sim.colored = [];

    // Queue exhausted before reaching the escape distance: the region is encircled.
    if (sim.queueHead >= queueQ.length) {
        sim.escaped = false;
        sim.distance = sim.maxDistReached;
        sim.done = true;
        return sim;
    }

    const q = queueQ[sim.queueHead];
    const r = queueR[sim.queueHead];
    const dist = queueDist[sim.queueHead++];
    // BFS dequeues in nondecreasing distance order, so each node's distance is the new
    // maximum; the driver reads sim.maxDistReached for its status line (as the HvH
    // driver does), which is therefore exactly this node's distance.
    if (dist > sim.maxDistReached) sim.maxDistReached = dist;

    // Frontier size used by the driver for pacing/status — the remaining queued
    // nodes plus this one. Matches the old inline `queueQ.length - queueHead + 1`,
    // captured BEFORE this node's children are enqueued.
    sim.exposedCount = queueQ.length - sim.queueHead + 1;

    // Reached the escape radius: the region broke out into open space. No neighbors
    // are colored on this terminal step (the original returned before expanding).
    if (dist >= escapeDistance) {
        sim.escaped = true;
        sim.distance = dist;
        sim.done = true;
        return sim;
    }

    for (let i = 0; i < 6; i++) {
        const nq = q + NEIGHBOR_OFFSETS[i][0];
        const nr = r + NEIGHBOR_OFFSETS[i][1];
        const nk = numKey(nq, nr);
        if (visited.has(nk)) continue;
        visited.add(nk);

        // Lazy random coloring (50/50), exactly as the live game's getHexColor: a
        // cell keeps any pre-existing color, otherwise a fresh draw decides it. Only a
        // freshly-colored cell is reported in `colored` (and thus pushed to the GPU),
        // mirroring getHexColor's push-only-when-new behavior. In a real escape run
        // every visited neighbor is in fact new — the sole pre-colored cell is the
        // start hex, which begins in `visited` and is never revisited — so this branch
        // matters only for seeded boards (e.g. tests).
        let isWhite = hexColors.get(nk);
        if (isWhite === undefined) {
            isWhite = rng() < 0.5;
            hexColors.set(nk, isWhite);
            sim.colored.push({ q: nq, r: nr, isWhite });
        }

        // Only white cells continue the flood; black cells are colored but dead ends.
        if (isWhite) {
            queueQ.push(nq);
            queueR.push(nr);
            queueDist.push(dist + 1);
        }
    }

    return sim;
}

// --- Animation pacing (pure) ---
// These drive how fast the BFS/boundary loops animate. Kept here, free of DOM
// state, so the speed mapping and per-step throttling are independently testable.

// Map a speed-slider value (0..5) to a speed multiplier.
// Exponential 0.25x..8x, with the top of the range meaning "max speed" (no delay).
export function sliderToSpeed(value) {
    if (value >= 5) return Infinity;
    return 0.25 * Math.pow(2, value);
}

// Human-readable label for a speed multiplier.
export function speedToLabel(speed) {
    if (speed === Infinity) return 'MAX';
    if (speed < 1) return speed.toFixed(2) + 'x';
    if (speed >= 10) return Math.round(speed) + 'x';
    return speed.toFixed(1) + 'x';
}

// Compute per-step animation pacing from the live frontier size and speed multiplier.
// `count` is the number of "exposed" hexes driving the animation (BFS frontier or
// boundary set) and must be >= 1. Returns:
//   - isMaxSpeed: whether to skip delays entirely
//   - delay:      milliseconds to sleep between rendered batches
//   - batchSize:  how many steps to process between renders (larger = faster/coarser)
export function computePacing(count, speedMultiplier) {
    const isMaxSpeed = speedMultiplier === Infinity;
    const baseDelay = Math.max(CONFIG.BASE_MIN_DELAY, CONFIG.BASE_MAX_DELAY / Math.sqrt(count));
    const delay = isMaxSpeed ? 0 : baseDelay / speedMultiplier;
    const batchSize = Math.max(1, Math.floor(count / 5 * speedMultiplier));
    return { isMaxSpeed, delay, batchSize };
}
