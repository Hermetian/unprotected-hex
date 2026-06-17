import { describe, it, expect } from 'vitest';
import { RunSession } from '../run-session.js';

describe('RunSession', () => {
    it('issues a token that is current right after begin()', () => {
        const s = new RunSession();
        const token = s.begin();
        expect(s.isCurrent(token)).toBe(true);
    });

    it('is not current for an arbitrary token before any run starts', () => {
        const s = new RunSession();
        expect(s.isCurrent(0)).toBe(false);   // the pristine generation must not match a stray 0
        expect(s.isCurrent(1)).toBe(false);
        expect(s.isCurrent(42)).toBe(false);
    });

    it('issues distinct, monotonically increasing tokens', () => {
        const s = new RunSession();
        const t1 = s.begin();
        const t2 = s.begin();
        const t3 = s.begin();
        expect(t2).toBeGreaterThan(t1);
        expect(t3).toBeGreaterThan(t2);
    });

    it('supersedes a prior run when a new one begins', () => {
        const s = new RunSession();
        const t1 = s.begin();
        const t2 = s.begin();
        expect(s.isCurrent(t1)).toBe(false);   // the first run was superseded
        expect(s.isCurrent(t2)).toBe(true);     // only the latest run is current
    });

    it('makes the active token stale after cancel()', () => {
        const s = new RunSession();
        const token = s.begin();
        s.cancel();
        expect(s.isCurrent(token)).toBe(false);
    });

    it('treats a run begun after cancel() as current again', () => {
        const s = new RunSession();
        const stale = s.begin();
        s.cancel();
        const fresh = s.begin();
        expect(s.isCurrent(fresh)).toBe(true);
        // The pre-cancel token must stay stale — i.e. cancel() must not rewind the
        // generation such that a restart reissues an old token (the supersede-after-
        // restart case the in-flight loop relies on).
        expect(s.isCurrent(stale)).toBe(false);
        expect(fresh).not.toBe(stale);
    });

    it('is harmless to cancel() repeatedly with no active run', () => {
        const s = new RunSession();
        const token = s.begin();
        s.cancel();
        s.cancel();   // double cancel must not resurrect the token
        expect(s.isCurrent(token)).toBe(false);
    });

    it('keeps tokens independent across separate sessions', () => {
        const a = new RunSession();
        const b = new RunSession();
        const ta = a.begin();
        b.begin();
        b.cancel();
        // Activity on b must not affect whether a's token is current.
        expect(a.isCurrent(ta)).toBe(true);
    });
});
