// run-tracker.js — Generic run history tracker with pluggable storage
// Used for both escape mode and hex-vs-hex mode

export class RunTracker {
    /**
     * @param {string} storageKey - localStorage key for persistence
     * @param {string} outcomeField - name of the outcome field (e.g. 'escaped' or 'winner')
     * @param {function} getStats - callback that receives the run history array and returns stats object
     * @param {object} [storage] - storage adapter with getItem/setItem (defaults to localStorage)
     */
    constructor(storageKey, outcomeField, getStats, storage = null) {
        this.storageKey = storageKey;
        this.outcomeField = outcomeField;
        this._getStats = getStats;
        this.storage = storage;
        this.history = [];
        this.currentRunId = null;
    }

    load() {
        const store = this._store();
        try {
            const saved = store.getItem(this.storageKey);
            if (saved) {
                this.history = JSON.parse(saved);
                for (const run of this.history) {
                    if (run.inProgress) {
                        run.inProgress = false;
                        run.interrupted = true;
                    }
                }
                this.save();
            }
        } catch (e) {
            console.error(`Failed to load ${this.storageKey}:`, e);
            this.history = [];
        }
    }

    save() {
        const store = this._store();
        try {
            store.setItem(this.storageKey, JSON.stringify(this.history));
        } catch (e) {
            console.error(`Failed to save ${this.storageKey}:`, e);
        }
    }

    startRun() {
        this.currentRunId = this.history.length;
        const run = {
            [this.outcomeField]: null,
            distance: 0,
            hexCount: 0,
            timestamp: Date.now(),
            interrupted: false,
            inProgress: true,
        };
        this.history.push(run);
        this.save();
    }

    endRun(outcome, distance, hexCount) {
        if (this.currentRunId === null || !this.history[this.currentRunId]) return;
        const run = this.history[this.currentRunId];
        run[this.outcomeField] = outcome;
        run.distance = distance;
        run.hexCount = hexCount;
        run.inProgress = false;
        this.save();
        this.currentRunId = null;
    }

    interruptRun(distance, hexCount) {
        if (this.currentRunId === null || !this.history[this.currentRunId]) return;
        const run = this.history[this.currentRunId];
        run.distance = distance;
        run.hexCount = hexCount;
        run.interrupted = true;
        run.inProgress = false;
        this.save();
        this.currentRunId = null;
    }

    getStats() {
        return this._getStats(this.history);
    }

    _store() {
        if (this.storage) return this.storage;
        return localStorage;
    }
}
