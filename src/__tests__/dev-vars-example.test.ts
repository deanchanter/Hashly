// Issue #155 / AC 1.1 — `.dev.vars.example` must list every env binding
// the worker reads at runtime. The template file is the canonical
// onboarding source for `wrangler pages dev`; missing keys here mean a
// silent local-only break the day a new dev clones the repo.
//
// This test pins the keys we expect. AC 1.1 specifically adds
// `GITHUB_APP_CLIENT_ID` (the App's OAuth-style client id used by
// /auth/start under AUTH_METHOD=app, post-#155). The other keys are
// re-asserted as a regression guard.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

function loadDevVarsExample(): string {
  return readFileSync(resolve(__dirname, '..', '..', '.dev.vars.example'), 'utf-8');
}

describe('.dev.vars.example template (issue #155 / AC 1.1)', () => {
  const REQUIRED_KEYS = [
    'GITHUB_APP_ID',
    'GITHUB_APP_SLUG',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_APP_CLIENT_ID', // ← new in #155
    'GITHUB_OAUTH_CLIENT_ID',
    'GITHUB_OAUTH_CLIENT_SECRET',
    'SESSION_HMAC_KEY',
    'AUTH_METHOD',
  ] as const;

  for (const key of REQUIRED_KEYS) {
    it(`includes a line for ${key}`, () => {
      const content = loadDevVarsExample();
      // Match `<KEY>=` at the start of a line, optionally allowing
      // a trailing value/quote/comment. This pins the *presence* of
      // the key, not the placeholder shape.
      const re = new RegExp(`^${key}=`, 'm');
      expect(
        re.test(content),
        `expected .dev.vars.example to declare ${key}= (issue #155 / AC 1.1). File contents:\n${content}`,
      ).toBe(true);
    });
  }
});
