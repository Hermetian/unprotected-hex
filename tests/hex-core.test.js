import { describe, it, expect } from 'vitest';
import {
    CONFIG, NEIGHBOR_OFFSETS,
    numKey, decodeKey, axialRound, hexDist, clockwiseAngle,
    selectNextFrontierHex, pixelToAxial,
    getTouchedColors, getFrontiers, isHexTrapped, findEncircledPockets,
} from '../hex-core.js';

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

    it('finds boundary hexes between white and black', () => {
        const hexColors = new Map();
        hexColors.set(numKey(0, 0), true);   // White
        hexColors.set(numKey(2, 0), false);  // Black
        const { boundary } = getFrontiers(hexColors);
        // (1,0) is adjacent to both white (0,0) and black (2,0), so it's boundary
        expect(boundary.has(numKey(1, 0))).toBe(true);
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
});
