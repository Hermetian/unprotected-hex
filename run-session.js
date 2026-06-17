// run-session.js — tracks which simulation run is "current"
//
// The escape/battle loops in hex.js are long-running async functions that yield
// (await) between animation batches. While one is suspended the user can hit
// Reset, switch modes, or start a new run. Without a way to tell the suspended
// loop "you've been superseded," it resumes and keeps mutating the shared grid
// in the background — re-spawning ghost hexes onto the cleared board and
// clobbering the status line.
//
// RunSession hands out an opaque token per run. A loop captures its token, and
// after every await checks isCurrent(token); once a newer begin() or a cancel()
// has happened the token is stale and the loop returns instead of touching state.
// Pure and dependency-free — see tests/run-session.test.js.

export class RunSession {
    constructor() {
        // Monotonic counter. Every begin()/cancel() advances it, so any token
        // handed out before that point no longer matches the current value.
        this._generation = 0;
    }

    // Start a new run, invalidating any previous one. Returns the run's token.
    begin() {
        return ++this._generation;
    }

    // Invalidate the current run (if any). After this, every previously issued
    // token is stale until the next begin().
    cancel() {
        this._generation++;
    }

    // True iff `token` identifies the run that is current right now. Generation 0
    // is the pristine "no run has started" state, so nothing is current then —
    // this guards against a stray isCurrent(0) before the first begin(). The
    // counter is never reset back to 0 (cancel() also advances it), so once a run
    // has begun every previously issued token stays distinguishable.
    isCurrent(token) {
        return this._generation !== 0 && token === this._generation;
    }
}
