import { describe, it, expect, beforeEach } from 'vitest';
import { RunTracker } from '../run-tracker.js';

// In-memory storage adapter for testing (no localStorage needed)
function createMemoryStorage() {
    const data = {};
    return {
        getItem(key) { return data[key] ?? null; },
        setItem(key, value) { data[key] = value; },
        _data: data,
    };
}

function escapeStats(history) {
    const completed = history.filter(r => !r.interrupted);
    const escaped = completed.filter(r => r.escaped).length;
    const encircled = completed.filter(r => r.escaped === false).length;
    const interrupted = history.filter(r => r.interrupted).length;
    return { total: history.length, escaped, encircled, interrupted };
}

function hvhStats(history) {
    const completed = history.filter(r => !r.interrupted);
    const whiteWins = completed.filter(r => r.winner === 'white').length;
    const blackWins = completed.filter(r => r.winner === 'black').length;
    const unresolved = completed.filter(r => r.winner === 'unresolved').length;
    const interrupted = history.filter(r => r.interrupted).length;
    return { total: history.length, whiteWins, blackWins, unresolved, interrupted };
}

describe('RunTracker', () => {
    let storage;
    let tracker;

    beforeEach(() => {
        storage = createMemoryStorage();
        tracker = new RunTracker('test-runs', 'escaped', escapeStats, storage);
    });

    it('starts with empty state', () => {
        const stats = tracker.getStats();
        expect(stats.total).toBe(0);
        expect(stats.escaped).toBe(0);
        expect(stats.encircled).toBe(0);
        expect(stats.interrupted).toBe(0);
    });

    it('tracks a complete run', () => {
        tracker.startRun();
        expect(tracker.history.length).toBe(1);
        expect(tracker.history[0].inProgress).toBe(true);

        tracker.endRun(true, 500, 1200);

        const stats = tracker.getStats();
        expect(stats.total).toBe(1);
        expect(stats.escaped).toBe(1);
        expect(stats.encircled).toBe(0);
        expect(tracker.history[0].distance).toBe(500);
        expect(tracker.history[0].hexCount).toBe(1200);
        expect(tracker.history[0].inProgress).toBe(false);
    });

    it('tracks an encircled run', () => {
        tracker.startRun();
        tracker.endRun(false, 42, 300);

        const stats = tracker.getStats();
        expect(stats.encircled).toBe(1);
        expect(stats.escaped).toBe(0);
    });

    it('tracks an interrupted run', () => {
        tracker.startRun();
        tracker.interruptRun(77, 500);

        const stats = tracker.getStats();
        expect(stats.interrupted).toBe(1);
        expect(stats.escaped).toBe(0);
        expect(stats.encircled).toBe(0);
        expect(tracker.history[0].distance).toBe(77);
        expect(tracker.history[0].hexCount).toBe(500);
    });

    it('persists data via storage adapter', () => {
        tracker.startRun();
        tracker.endRun(true, 100, 50);

        // Create a new tracker with same storage
        const tracker2 = new RunTracker('test-runs', 'escaped', escapeStats, storage);
        tracker2.load();

        expect(tracker2.history.length).toBe(1);
        expect(tracker2.history[0].escaped).toBe(true);
        expect(tracker2.history[0].distance).toBe(100);
    });

    it('marks in-progress runs as interrupted on reload', () => {
        tracker.startRun();
        // Don't call endRun — simulate crash/reload

        const tracker2 = new RunTracker('test-runs', 'escaped', escapeStats, storage);
        tracker2.load();

        expect(tracker2.history[0].interrupted).toBe(true);
        expect(tracker2.history[0].inProgress).toBe(false);
    });

    it('no-op on endRun when no active run', () => {
        tracker.endRun(true, 100, 50);
        expect(tracker.history.length).toBe(0);
    });

    it('no-op on interruptRun when no active run', () => {
        tracker.interruptRun(100, 50);
        expect(tracker.history.length).toBe(0);
    });

    it('tracks multiple runs', () => {
        tracker.startRun();
        tracker.endRun(true, 100, 50);
        tracker.startRun();
        tracker.endRun(false, 30, 20);
        tracker.startRun();
        tracker.interruptRun(15, 10);

        const stats = tracker.getStats();
        expect(stats.total).toBe(3);
        expect(stats.escaped).toBe(1);
        expect(stats.encircled).toBe(1);
        expect(stats.interrupted).toBe(1);
    });
});

describe('RunTracker with HvH outcome field', () => {
    let storage;
    let tracker;

    beforeEach(() => {
        storage = createMemoryStorage();
        tracker = new RunTracker('test-hvh', 'winner', hvhStats, storage);
    });

    it('tracks HvH outcomes using winner field', () => {
        tracker.startRun();
        tracker.endRun('white', 200, 800);

        tracker.startRun();
        tracker.endRun('black', 150, 600);

        tracker.startRun();
        tracker.endRun('unresolved', 10000, 50000);

        const stats = tracker.getStats();
        expect(stats.total).toBe(3);
        expect(stats.whiteWins).toBe(1);
        expect(stats.blackWins).toBe(1);
        expect(stats.unresolved).toBe(1);
        expect(stats.interrupted).toBe(0);
    });

    it('correctly uses outcomeField for run records', () => {
        tracker.startRun();
        tracker.endRun('white', 100, 50);

        expect(tracker.history[0].winner).toBe('white');
        expect(tracker.history[0]).not.toHaveProperty('escaped');
    });
});
