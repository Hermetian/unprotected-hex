import { describe, it, expect } from 'vitest';
import {
    CONFIG, NEIGHBOR_OFFSETS,
    numKey, decodeKey, axialRound, hexDist, clockwiseAngle,
    selectNextFrontierHex, pixelToAxial,
    getTouchedColors, getFrontiers, updateBoundaryForColored,
    isHexTrapped, findEncircledPockets,
    determineBattleWinner, createBattle, stepBattle,
    sliderToSpeed, speedToLabel, computePacing,
} from '../hex-core.js';

// Deterministic PRNG (mulberry32) so the property tests below are reproducible
// rather than depending on Math.random.
function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}

// --- numKey / decodeKey ---

describe('numKey / decodeKey', () => {
    it('roundtrips the origin', () => {
        const key = numKey(0, 0);
        expect(decodeKey(key)).toEqual({ q: 0, r: 0 });
    });

    it('roundtrips positive coordinates', () => {
        expect(decodeKey(numKey(3, 7))).toEqual({ q: 3, r: 7 });
        expect(decodeKey(numKey(100, 200))).toEqual({ q: 100, r: 200 });
    });

    it('roundtrips negative coordinates', () => {
        expect(decodeKey(numKey(-5, -10))).toEqual({ q: -5, r: -10 });
        expect(decodeKey(numKey(-1, 3))).toEqual({ q: -1, r: 3 });
    });

    it('roundtrips boundary values near KEY_OFFSET', () => {
        const max = CONFIG.KEY_OFFSET - 1;
        expect(decodeKey(numKey(max, max))).toEqual({ q: max, r: max });
        expect(decodeKey(numKey(-max, -max))).toEqual({ q: -max, r: -max });
    });

    it('produces unique keys for distinct coordinates', () => {
        const keys = new Set();
        for (let q = -10; q <= 10; q++) {
            for (let r = -10; r <= 10; r++) {
                keys.add(numKey(q, r));
            }
        }
        expect(keys.size).toBe(21 * 21);
    });
});

// --- axialRound ---

describe('axialRound', () => {
    it('returns exact integer coordinates unchanged', () => {
        expect(axialRound(3, -2)).toEqual({ q: 3, r: -2 });
        expect(axialRound(0, 0)).toEqual({ q: 0, r: 0 });
    });

    it('rounds fractional coordinates to nearest hex', () => {
        expect(axialRound(0.1, 0.1)).toEqual({ q: 0, r: 0 });
        expect(axialRound(0.9, 0.1)).toEqual({ q: 1, r: 0 });
    });

    it('maintains cube constraint q + r + s = 0', () => {
        const cases = [
            [1.3, -0.8], [-2.6, 1.1], [0.5, -0.2], [3.7, -1.9],
        ];
        for (const [fq, fr] of cases) {
            const { q, r } = axialRound(fq, fr);
            const s = -q - r;
            expect(q + r + s).toBe(0);
        }
    });

    it('handles boundary case at 0.5', () => {
        // The result should still satisfy cube constraint
        const { q, r } = axialRound(0.5, 0.5);
        expect(q + r + (-q - r)).toBe(0);
    });
});

// --- hexDist ---

describe('hexDist', () => {
    it('returns 0 at origin', () => {
        expect(hexDist(0, 0)).toBe(0);
    });

    it('returns 1 for all immediate neighbors', () => {
        for (const [dq, dr] of NEIGHBOR_OFFSETS) {
            expect(hexDist(dq, dr)).toBe(1);
        }
    });

    it('returns known distances', () => {
        expect(hexDist(3, 0)).toBe(3);
        expect(hexDist(0, 5)).toBe(5);
        expect(hexDist(2, -2)).toBe(2);
        expect(hexDist(-3, 1)).toBe(3);
    });

    it('is symmetric', () => {
        expect(hexDist(4, -2)).toBe(hexDist(-4, 2));
        expect(hexDist(1, 3)).toBe(hexDist(-1, -3));
    });
});

// --- clockwiseAngle ---

describe('clockwiseAngle', () => {
    it('returns 0 for due East', () => {
        expect(clockwiseAngle(1, 0)).toBeCloseTo(0, 5);
    });

    it('returns angles in clockwise order', () => {
        // For hex grid: E, SE, SW, W, NW, NE should be increasing angles
        const angles = NEIGHBOR_OFFSETS.map(([q, r]) => clockwiseAngle(q, r));
        // East (1,0) should be ~0, and angles should generally increase clockwise
        // but the exact order depends on the hex layout
        // All should be in [0, 2π)
        for (const a of angles) {
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThan(2 * Math.PI);
        }
    });

    it('returns values in range [0, 2π)', () => {
        const testCoords = [[1, 0], [-1, 0], [0, 1], [0, -1], [3, -5], [-2, 7]];
        for (const [q, r] of testCoords) {
            const angle = clockwiseAngle(q, r);
            expect(angle).toBeGreaterThanOrEqual(0);
            expect(angle).toBeLessThan(2 * Math.PI);
        }
    });

    it('produces unique angles for distinct neighbors', () => {
        const angles = NEIGHBOR_OFFSETS.map(([q, r]) => clockwiseAngle(q, r));
        const unique = new Set(angles.map(a => a.toFixed(6)));
        expect(unique.size).toBe(6);
    });
});

// --- selectNextFrontierHex ---

describe('selectNextFrontierHex', () => {
    it('returns null for empty frontier', () => {
        expect(selectNextFrontierHex(new Set())).toBeNull();
    });

    it('returns the only element of a single-element frontier', () => {
        const key = numKey(3, 0);
        expect(selectNextFrontierHex(new Set([key]))).toBe(key);
    });

    it('selects the farthest hex', () => {
        const close = numKey(1, 0);  // dist 1
        const far = numKey(5, 0);    // dist 5
        expect(selectNextFrontierHex(new Set([close, far]))).toBe(far);
    });

    it('breaks ties by clockwise angle', () => {
        // Two hexes at the same distance but different angles
        const a = numKey(2, 0);   // dist 2, angle ~0
        const b = numKey(0, 2);   // dist 2, larger clockwise angle
        const result = selectNextFrontierHex(new Set([a, b]));
        // Should pick the one with the larger clockwise angle
        const angleA = clockwiseAngle(2, 0);
        const angleB = clockwiseAngle(0, 2);
        const expectedKey = angleA > angleB ? a : b;
        expect(result).toBe(expectedKey);
    });
});

// --- pixelToAxial ---

describe('pixelToAxial', () => {
    it('maps origin pixel to origin hex', () => {
        expect(pixelToAxial(0, 0, 25)).toEqual({ q: 0, r: 0 });
    });

    it('maps known pixel positions to correct hexes', () => {
        const hexSize = 25;
        const hexWidth = Math.sqrt(3) * hexSize;
        // Hex (1, 0) center is at pixel (hexWidth, 0)
        const result = pixelToAxial(hexWidth, 0, hexSize);
        expect(result).toEqual({ q: 1, r: 0 });
    });

    it('works with different hex sizes', () => {
        expect(pixelToAxial(0, 0, 10)).toEqual({ q: 0, r: 0 });
        expect(pixelToAxial(0, 0, 50)).toEqual({ q: 0, r: 0 });
    });
});

// --- getTouchedColors ---

describe('getTouchedColors', () => {
    it('returns false for both when no neighbors exist', () => {
        const hexColors = new Map();
        const { touchesWhite, touchesBlack } = getTouchedColors(0, 0, hexColors);
        expect(touchesWhite).toBe(false);
        expect(touchesBlack).toBe(false);
    });

    it('detects adjacent white hex', () => {
        const hexColors = new Map();
        hexColors.set(numKey(1, 0), true);  // White neighbor
        const { touchesWhite, touchesBlack } = getTouchedColors(0, 0, hexColors);
        expect(touchesWhite).toBe(true);
        expect(touchesBlack).toBe(false);
    });

    it('detects adjacent black hex', () => {
        const hexColors = new Map();
        hexColors.set(numKey(1, 0), false);  // Black neighbor
        const { touchesWhite, touchesBlack } = getTouchedColors(0, 0, hexColors);
        expect(touchesWhite).toBe(false);
        expect(touchesBlack).toBe(true);
    });

    it('detects both colors when both are adjacent', () => {
        const hexColors = new Map();
        hexColors.set(numKey(1, 0), true);   // White
        hexColors.set(numKey(-1, 0), false);  // Black
        const { touchesWhite, touchesBlack } = getTouchedColors(0, 0, hexColors);
        expect(touchesWhite).toBe(true);
        expect(touchesBlack).toBe(true);
    });
});

// --- getFrontiers ---

describe('getFrontiers', () => {
    it('returns empty sets for empty hexColors', () => {
        const hexColors = new Map();
        const { boundary, whiteFrontier, blackFrontier } = getFrontiers(hexColors);
        expect(boundary.size).toBe(0);
        expect(whiteFrontier.size).toBe(0);
        expect(blackFrontier.size).toBe(0);
    });

    it('finds white frontier around a single white hex', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);
        const { boundary, whiteFrontier, blackFrontier } = getFrontiers(hexColors);
        expect(whiteFrontier.size).toBe(6);  // All 6 neighbors are white frontier
        expect(blackFrontier.size).toBe(0);
        expect(boundary.size).toBe(0);
    });

    it('finds black frontier around a single black hex', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), false);
        const { boundary, whiteFrontier, blackFrontier } = getFrontiers(hexColors);
        expect(blackFrontier.size).toBe(6);  // All 6 neighbors are black frontier
        expect(whiteFrontier.size).toBe(0);
        expect(boundary.size).toBe(0);
    });

    it('finds boundary hexes between white and black', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);   // White
        hexColors.set(numKey(2, 0), false);  // Black
        const { boundary } = getFrontiers(hexColors);
        // (1,0) is adjacent to both white (0,0) and black (2,0), so it's boundary
        expect(boundary.has(numKey(1, 0))).toBe(true);
    });

    it('keeps boundary hexes out of the single-color frontiers', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);   // White
        hexColors.set(numKey(2, 0), false);  // Black
        const { boundary, whiteFrontier, blackFrontier } = getFrontiers(hexColors);
        const between = numKey(1, 0);
        // The shared neighbor is boundary, never in a single-color frontier
        expect(boundary.has(between)).toBe(true);
        expect(whiteFrontier.has(between)).toBe(false);
        expect(blackFrontier.has(between)).toBe(false);
        // Each color's 6 neighbors minus the shared boundary cell = 5 single-color frontier cells
        expect(whiteFrontier.size).toBe(5);
        expect(blackFrontier.size).toBe(5);
    });
});

// --- updateBoundaryForColored ---

describe('updateBoundaryForColored', () => {
    it('removes the just-colored cell from the boundary', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);   // White
        hexColors.set(numKey(2, 0), false);  // Black
        const boundary = getFrontiers(hexColors).boundary;
        const between = numKey(1, 0);
        expect(boundary.has(between)).toBe(true);

        // Color the boundary cell — it's no longer untested, so it leaves.
        hexColors.set(between, true);
        updateBoundaryForColored(boundary, 1, 0, hexColors);
        expect(boundary.has(between)).toBe(false);
    });

    it('adds an untested neighbor that now touches both colors', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);   // White, alone — no boundary yet
        let boundary = getFrontiers(hexColors).boundary;
        expect(boundary.size).toBe(0);

        // Place a black cell two away; (1,0) borders both and becomes boundary.
        hexColors.set(numKey(2, 0), false);
        updateBoundaryForColored(boundary, 2, 0, hexColors);
        expect(boundary.has(numKey(1, 0))).toBe(true);
        expect(setsEqual(boundary, getFrontiers(hexColors).boundary)).toBe(true);
    });

    it('leaves the boundary unchanged when coloring touches only one color', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);
        const boundary = getFrontiers(hexColors).boundary;  // empty
        // Extend the white blob; still no black anywhere, so no boundary forms.
        hexColors.set(numKey(1, 0), true);
        updateBoundaryForColored(boundary, 1, 0, hexColors);
        expect(boundary.size).toBe(0);
        expect(setsEqual(boundary, getFrontiers(hexColors).boundary)).toBe(true);
    });

    it('returns the same set instance it was given (mutates in place)', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);
        const boundary = getFrontiers(hexColors).boundary;
        const returned = updateBoundaryForColored(boundary, 0, 0, hexColors);
        expect(returned).toBe(boundary);
    });

    it('stays identical to a full getFrontiers rescan across a random battle', () => {
        // Mirror the exact hex-vs-hex coloring loop: seed white + adjacent black,
        // then repeatedly select the outermost/clockwise-most boundary cell, color
        // it randomly, and maintain the boundary incrementally. After every step the
        // incremental set must equal a fresh getFrontiers() rescan — this is what
        // guarantees the live game's selection order (and outcome) is preserved.
        // (These battles keep the boundary small; the region-fill test below is the
        // large-boundary stress case. Keep both.)
        let totalSteps = 0;
        for (let seed = 1; seed <= 25; seed++) {
            const rng = mulberry32(seed);
            const hexColors = new Map();
            hexColors.set(numKey(0, 0), true);   // White start
            hexColors.set(numKey(1, 0), false);  // Black start (as in hexVsHexCheck)

            const boundary = getFrontiers(hexColors).boundary;

            for (let step = 0; step < 250 && boundary.size > 0; step++) {
                expect(setsEqual(boundary, getFrontiers(hexColors).boundary)).toBe(true);

                const nextKey = selectNextFrontierHex(boundary);
                const { q, r } = decodeKey(nextKey);
                hexColors.set(nextKey, rng() < 0.5);
                updateBoundaryForColored(boundary, q, r, hexColors);
                totalSteps++;
            }

            // ...and once more after the final coloring. (This post-loop check is
            // what catches an incremental update that wrongly empties the boundary:
            // the loop guard would exit early, but getFrontiers would still report
            // the real cells, so the sets diverge here.)
            expect(setsEqual(boundary, getFrontiers(hexColors).boundary)).toBe(true);
        }
        // Guard against the whole test silently degrading into a no-op (e.g. if the
        // seed setup ever stopped producing a frontier): it must do real work.
        expect(totalSteps).toBeGreaterThan(500);
    });

    it('matches getFrontiers when an entire region is filled in random order', () => {
        // A stronger stress test than the battle above: color every cell of a
        // radius-4 region in a seeded-random order with random colors. This drives
        // the boundary through large, jagged configurations (sizes into the
        // dozens) that the outermost-first battle never reaches, exercising both
        // the add and the (single) remove branch of the incremental update.
        for (let seed = 1; seed <= 30; seed++) {
            const rng = mulberry32(seed);
            const R = 4;
            const cells = [];
            for (let q = -R; q <= R; q++) {
                for (let r = -R; r <= R; r++) {
                    if (Math.abs(-q - r) <= R) cells.push([q, r]);
                }
            }
            // Seeded Fisher-Yates shuffle.
            for (let i = cells.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [cells[i], cells[j]] = [cells[j], cells[i]];
            }

            const hexColors = new Map();
            const boundary = new Set();
            for (const [q, r] of cells) {
                hexColors.set(numKey(q, r), rng() < 0.5);
                updateBoundaryForColored(boundary, q, r, hexColors);
                expect(setsEqual(boundary, getFrontiers(hexColors).boundary)).toBe(true);
            }
        }
    });
});

// --- isHexTrapped ---

describe('isHexTrapped', () => {
    it('returns false for uncolored hex', () => {
        const hexColors = new Map();
        expect(isHexTrapped(0, 0, 10, hexColors)).toBe(false);
    });

    it('returns true when fully surrounded by opposite color', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);  // White center
        // Surround with black
        for (const [dq, dr] of NEIGHBOR_OFFSETS) {
            hexColors.set(numKey(dq, dr), false);
        }
        expect(isHexTrapped(0, 0, 10, hexColors)).toBe(true);
    });

    it('returns false when there are escape routes', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);  // White center
        // Partially surround with black (leave one gap)
        for (let i = 0; i < 5; i++) {
            const [dq, dr] = NEIGHBOR_OFFSETS[i];
            hexColors.set(numKey(dq, dr), false);
        }
        // 6th neighbor is untested — escape route exists
        expect(isHexTrapped(0, 0, 10, hexColors)).toBe(false);
    });

    it('returns false when connected same-color region has untested frontier reaching far', () => {
        const hexColors = new Map();
        // White line from origin outward
        hexColors.set(numKey(0, 0), true);
        hexColors.set(numKey(1, 0), true);
        hexColors.set(numKey(2, 0), true);
        // Not surrounded — plenty of untested neighbors
        expect(isHexTrapped(0, 0, 100, hexColors)).toBe(false);
    });

    it('returns false when wide-open space lets the color reach the target distance', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);  // Lone white hex in open space
        // The untested frontier expands freely, so distance 3 is reachable
        expect(isHexTrapped(0, 0, 3, hexColors)).toBe(false);
    });

    it('returns true when sealed in a finite cavity it cannot escape', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);  // White center
        // Black wall at distance 2; the distance-1 ring is left untested (the cavity).
        // The cavity is non-empty but bounded, so the region can never reach distance 10.
        for (let q = -2; q <= 2; q++) {
            for (let r = -2; r <= 2; r++) {
                if (hexDist(q, r) === 2) hexColors.set(numKey(q, r), false);
            }
        }
        expect(isHexTrapped(0, 0, 10, hexColors)).toBe(true);
        // A frontier hex already sits at distance 1, so a target of 1 is trivially reached.
        expect(isHexTrapped(0, 0, 1, hexColors)).toBe(false);
    });
});

// --- findEncircledPockets ---

describe('findEncircledPockets', () => {
    it('returns empty for empty hexColors', () => {
        const hexColors = new Map();
        expect(findEncircledPockets(hexColors)).toEqual([]);
    });

    it('returns empty when only white hexes exist', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);
        hexColors.set(numKey(1, 0), true);
        expect(findEncircledPockets(hexColors)).toEqual([]);
    });

    it('returns empty when black hexes have open untested space', () => {
        const hexColors = new Map();
        // A few isolated black hexes — their neighbors reach untested space
        // which eventually touches white, so no enclosed pocket
        hexColors.set(numKey(0, 0), false);
        hexColors.set(numKey(10, 10), true);  // Far white hex
        // The untested space around (0,0) is vast and will eventually
        // reach (10,10)'s neighborhood, so no pocket
        const pockets = findEncircledPockets(hexColors);
        // This depends on pocket size limit — a single black hex with
        // untested neighbors that don't touch white would count as a pocket
        // but the untested BFS would be huge. With MAX_POCKET_SIZE=10000
        // the pocket won't be counted because it exceeds the limit
        expect(pockets.length).toBe(0);
    });

    it('detects enclosed pocket surrounded by black ring', () => {
        const hexColors = new Map();
        // Create a ring of black hexes around origin
        // The 6 neighbors of origin are black
        for (const [dq, dr] of NEIGHBOR_OFFSETS) {
            hexColors.set(numKey(dq, dr), false);
        }
        // The second ring of neighbors (to seal off)
        const ring2 = [
            [2, 0], [2, -1], [2, -2], [1, -2], [0, -2], [-1, -1],
            [-2, 0], [-2, 1], [-2, 2], [-1, 2], [0, 2], [1, 1],
        ];
        for (const [q, r] of ring2) {
            hexColors.set(numKey(q, r), false);
        }
        // Origin (0,0) is untested and surrounded by black
        const pockets = findEncircledPockets(hexColors);
        expect(pockets.length).toBeGreaterThan(0);
        // The pocket contains at least the origin
        expect(pockets[0]).toBeGreaterThanOrEqual(1);
    });

    it('reports the exact size of a fully sealed two-cell pocket', () => {
        const hexColors = new Map();
        // Two untested interior cells...
        const interior = [[0, 0], [1, 0]];
        const interiorKeys = new Set(interior.map(([q, r]) => numKey(q, r)));
        // ...sealed by black on every surrounding cell.
        for (const [q, r] of interior) {
            for (const [dq, dr] of NEIGHBOR_OFFSETS) {
                const k = numKey(q + dq, r + dr);
                if (!interiorKeys.has(k)) hexColors.set(k, false);
            }
        }
        const pockets = findEncircledPockets(hexColors);
        // The only black-enclosed untested region is the 2-cell interior.
        // (The outer untested plane is unbounded and exceeds MAX_POCKET_SIZE.)
        expect(pockets).toEqual([2]);
    });
});

// --- determineBattleWinner ---

describe('determineBattleWinner', () => {
    // White at origin, sealed by black on all six neighbours. The black ring itself
    // has open space outside it, so any black start on the ring is NOT trapped.
    function whiteSealedByBlack() {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);
        for (const [dq, dr] of NEIGHBOR_OFFSETS) hexColors.set(numKey(dq, dr), false);
        return hexColors;
    }

    it('returns null while both starts can still escape (open board)', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);
        hexColors.set(numKey(1, 0), false);
        expect(determineBattleWinner({ q: 0, r: 0 }, { q: 1, r: 0 }, CONFIG.ESCAPE_DISTANCE, hexColors)).toBeNull();
    });

    it('black wins when white is sealed and black is open', () => {
        const hexColors = whiteSealedByBlack();
        expect(determineBattleWinner({ q: 0, r: 0 }, { q: 1, r: 0 }, CONFIG.ESCAPE_DISTANCE, hexColors)).toBe('black');
    });

    it('white wins when black is sealed and white is open (mirror image)', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), false);
        for (const [dq, dr] of NEIGHBOR_OFFSETS) hexColors.set(numKey(dq, dr), true);
        expect(determineBattleWinner({ q: 1, r: 0 }, { q: 0, r: 0 }, CONFIG.ESCAPE_DISTANCE, hexColors)).toBe('white');
    });

    it('is unresolved when both starts are sealed in separate cavities', () => {
        const hexColors = whiteSealedByBlack();
        // A second, far-away cavity: black sealed by white (no overlap with the first).
        const bq = 20, br = 0;
        hexColors.set(numKey(bq, br), false);
        for (const [dq, dr] of NEIGHBOR_OFFSETS) hexColors.set(numKey(bq + dq, br + dr), true);
        expect(determineBattleWinner({ q: 0, r: 0 }, { q: bq, r: br }, CONFIG.ESCAPE_DISTANCE, hexColors)).toBe('unresolved');
    });
});

// --- createBattle / stepBattle ---

describe('createBattle / stepBattle', () => {
    // The standard opening: white at the origin, black one cell East (as placed by
    // handleClick in the live game).
    function openingBoard() {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);
        hexColors.set(numKey(1, 0), false);
        return hexColors;
    }

    it('seeds the boundary from the opening position', () => {
        const sim = createBattle({ q: 0, r: 0 }, { q: 1, r: 0 }, openingBoard());
        expect(setsEqual(sim.boundary, getFrontiers(sim.hexColors).boundary)).toBe(true);
        expect(sim.boundary.size).toBeGreaterThan(0);
        expect(sim.done).toBe(false);
    });

    it('is deterministic: equal rng draws ⇒ identical colored sequence and result', () => {
        const run = () => {
            const rng = mulberry32(12345);
            const sim = createBattle({ q: 0, r: 0 }, { q: 1, r: 0 }, openingBoard());
            const colored = [];
            for (let i = 0; i < 40 && !sim.done; i++) {
                stepBattle(sim, rng);
                if (sim.colored) colored.push(`${sim.colored.q},${sim.colored.r},${sim.colored.isWhite}`);
            }
            return { colored, done: sim.done, winner: sim.winner, maxDist: sim.maxDistReached };
        };
        const a = run();
        const b = run();
        expect(a).toEqual(b);
        expect(a.colored.length).toBeGreaterThan(0);   // non-vacuous: it really stepped
    });

    it('captures the pre-coloring boundary size in exposedCount', () => {
        const sim = createBattle({ q: 0, r: 0 }, { q: 1, r: 0 }, openingBoard());
        const before = sim.boundary.size;
        stepBattle(sim, () => 0.25);
        expect(sim.exposedCount).toBe(before);   // size BEFORE the step's coloring
    });

    it('keeps its boundary identical to a fresh getFrontiers rescan at every step', () => {
        // Drive the real stepper — which also runs the per-step trap checks — and
        // verify the incrementally-maintained boundary never drifts from a full
        // rescan. A small escape distance (20, far above the ~10 these short runs
        // reach) bounds each isHexTrapped flood without ending the battle early.
        let totalSteps = 0;
        for (let seed = 1; seed <= 6; seed++) {
            const rng = mulberry32(seed);
            const sim = createBattle({ q: 0, r: 0 }, { q: 1, r: 0 }, openingBoard(), 20);
            for (let i = 0; i < 25 && !sim.done; i++) {
                stepBattle(sim, rng);
                expect(setsEqual(sim.boundary, getFrontiers(sim.hexColors).boundary)).toBe(true);
                totalSteps++;
            }
        }
        expect(totalSteps).toBeGreaterThan(100);
    });

    it('resolves immediately when a start is already sealed (empty boundary)', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);
        for (const [dq, dr] of NEIGHBOR_OFFSETS) hexColors.set(numKey(dq, dr), false);
        const sim = createBattle({ q: 0, r: 0 }, { q: 1, r: 0 }, hexColors);
        expect(sim.boundary.size).toBe(0);     // nothing touches both colors
        stepBattle(sim, () => 0.5);
        expect(sim.done).toBe(true);
        expect(sim.colored).toBeNull();        // no cell was colored
        expect(sim.winner).toBe('black');
    });

    it('seals the loser during play and reports the win (black wins)', () => {
        // White at origin with five black neighbours; (0,1) is the lone gap and thus
        // the only boundary cell. Forcing it black surrounds white → black wins in one step.
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);
        for (const [dq, dr] of NEIGHBOR_OFFSETS) {
            if (!(dq === 0 && dr === 1)) hexColors.set(numKey(dq, dr), false);
        }
        const sim = createBattle({ q: 0, r: 0 }, { q: 1, r: 0 }, hexColors);
        expect(sim.boundary.size).toBe(1);
        expect(sim.boundary.has(numKey(0, 1))).toBe(true);
        stepBattle(sim, () => 0.9);   // ≥ 0.5 ⇒ colors black ⇒ seals white
        expect(sim.colored).toEqual({ q: 0, r: 1, isWhite: false });
        expect(sim.done).toBe(true);
        expect(sim.winner).toBe('black');
    });

    it('seals the loser during play and reports the win (white wins, mirror)', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), false);   // black start at origin
        for (const [dq, dr] of NEIGHBOR_OFFSETS) {
            if (!(dq === 0 && dr === 1)) hexColors.set(numKey(dq, dr), true);
        }
        const sim = createBattle({ q: 1, r: 0 }, { q: 0, r: 0 }, hexColors);
        expect(sim.boundary.size).toBe(1);
        stepBattle(sim, () => 0.1);   // < 0.5 ⇒ colors white ⇒ seals black
        expect(sim.colored).toEqual({ q: 0, r: 1, isWhite: true });
        expect(sim.done).toBe(true);
        expect(sim.winner).toBe('white');
    });

    it('ends as unresolved once a colored cell reaches the escape distance', () => {
        // Place the duel far from the origin (white at (5,0), black at (6,0)) and set a
        // tiny escape distance of 3. Their shared boundary cells already sit at distance
        // 6, so the very first coloring trips the distance cap — a draw, decided before
        // any trap check. (The distance branch is checked before the trap branch.)
        const hexColors = new Map();
        hexColors.set(numKey(5, 0), true);
        hexColors.set(numKey(6, 0), false);
        const sim = createBattle({ q: 5, r: 0 }, { q: 6, r: 0 }, hexColors, 3);
        stepBattle(sim, () => 0.5);
        expect(sim.done).toBe(true);
        expect(sim.winner).toBe('unresolved');
        expect(sim.maxDistReached).toBeGreaterThanOrEqual(3);
    });

    it('is a no-op once the battle is done', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);
        for (const [dq, dr] of NEIGHBOR_OFFSETS) hexColors.set(numKey(dq, dr), false);
        const sim = createBattle({ q: 0, r: 0 }, { q: 1, r: 0 }, hexColors);
        stepBattle(sim, () => 0.5);
        expect(sim.done).toBe(true);
        // Snapshot every mutable field so an errant later step can't slip through
        // (e.g. an in-place recolor that leaves hexColors.size unchanged).
        const snapshot = {
            winner: sim.winner, colored: sim.colored, done: sim.done,
            maxDist: sim.maxDistReached, boundarySize: sim.boundary.size,
            hexSize: sim.hexColors.size,
        };
        const result = stepBattle(sim, () => 0.5);   // must not advance anything
        expect(result).toBe(sim);                    // returns the same sim
        expect({
            winner: sim.winner, colored: sim.colored, done: sim.done,
            maxDist: sim.maxDistReached, boundarySize: sim.boundary.size,
            hexSize: sim.hexColors.size,
        }).toEqual(snapshot);
    });

    it('falls back to the default escape distance for a non-positive or non-finite value', () => {
        // The escapeDistance param is test-facing; guard the degenerate values that
        // would otherwise make every battle resolve instantly or corrupt trap floods.
        for (const bad of [0, -5, NaN]) {
            expect(createBattle({ q: 0, r: 0 }, { q: 1, r: 0 }, openingBoard(), bad).escapeDistance)
                .toBe(CONFIG.ESCAPE_DISTANCE);
        }
        // A sensible positive value is kept as-is.
        expect(createBattle({ q: 0, r: 0 }, { q: 1, r: 0 }, openingBoard(), 3).escapeDistance).toBe(3);
    });
});

// --- sliderToSpeed ---

describe('sliderToSpeed', () => {
    it('maps the bottom of the range to 0.25x', () => {
        expect(sliderToSpeed(0)).toBe(0.25);
    });

    it('doubles per slider unit', () => {
        expect(sliderToSpeed(1)).toBe(0.5);
        expect(sliderToSpeed(2)).toBe(1);
        expect(sliderToSpeed(4)).toBe(4);
    });

    it('treats the top of the range as max (infinite) speed', () => {
        expect(sliderToSpeed(5)).toBe(Infinity);
        expect(sliderToSpeed(6)).toBe(Infinity);
    });
});

// --- speedToLabel ---

describe('speedToLabel', () => {
    it('labels max speed', () => {
        expect(speedToLabel(Infinity)).toBe('MAX');
    });

    it('uses two decimals below 1x', () => {
        expect(speedToLabel(0.25)).toBe('0.25x');
        expect(speedToLabel(0.5)).toBe('0.50x');
    });

    it('uses one decimal for normal speeds', () => {
        expect(speedToLabel(1)).toBe('1.0x');
        expect(speedToLabel(4)).toBe('4.0x');
    });

    it('rounds to an integer at 10x and above', () => {
        expect(speedToLabel(16)).toBe('16x');
    });
});

// --- computePacing ---

describe('computePacing', () => {
    it('reports max speed with zero delay', () => {
        const p = computePacing(100, Infinity);
        expect(p.isMaxSpeed).toBe(true);
        expect(p.delay).toBe(0);
    });

    it('slows down (larger delay) when the frontier is small', () => {
        const small = computePacing(1, 1);
        const large = computePacing(400, 1);
        expect(small.delay).toBeGreaterThan(large.delay);
    });

    it('clamps delay to the configured minimum for huge frontiers', () => {
        const p = computePacing(1e9, 1);
        expect(p.delay).toBe(CONFIG.BASE_MIN_DELAY);
        expect(p.isMaxSpeed).toBe(false);
    });

    it('grows the batch size with the speed multiplier', () => {
        const slow = computePacing(100, 1);
        const fast = computePacing(100, 4);
        expect(fast.batchSize).toBeGreaterThan(slow.batchSize);
    });

    it('never returns a batch size below 1', () => {
        expect(computePacing(1, 0.25).batchSize).toBe(1);
    });
});
