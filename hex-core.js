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
