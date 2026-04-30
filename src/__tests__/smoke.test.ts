import { describe, it, expect } from 'vitest';

// Issue #18 — AC #2: `npm test` runs Vitest and exits 0 on a green suite.
//
// This smoke test exists for one purpose: prove that the `npm test` script,
// once wired to Vitest, actually discovers and runs files under
// `src/__tests__/`. The assertion is intentionally trivial — meaningful
// behavioral coverage lives in `src/__tests__/main.test.ts` (AC #3).
describe('vitest harness smoke', () => {
  it('runs a test file colocated under src/__tests__/', () => {
    expect(true).toBe(true);
  });
});
