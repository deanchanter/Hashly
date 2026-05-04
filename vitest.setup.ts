// Issue #90 / Critical fix #3 — global Vitest setup.
//
// The v0.2 test suite predates the web-mode bootstrap branch and
// implicitly assumed `bootstrap()` mounted the showcase. Declaring
// "v0.2 == Tauri mode" globally here is honest about the codepath
// those tests exercise (close-guard, save, file-opened-by-os, edit
// toggle, etc.) without per-file edits. Tests that explicitly want
// web mode (e.g. `web-bootstrap.test.ts`, `viewer.test.ts` family)
// opt out by deleting the flag in their own `beforeEach`.

import { beforeEach } from 'vitest';

beforeEach(() => {
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
});
