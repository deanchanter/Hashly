import { describe, it, expect, beforeEach, vi } from 'vitest';

// Issue #22 — Guard src/main.ts auto-mount against test-time side effects.
//
// These tests pin three contracts on the new `bootstrap()` extraction:
//
//   - AC #3 (Slice A): Importing `../main` under Vitest must NOT auto-mount
//     a Milkdown editor — even if a `#editor` element is already in the DOM
//     when the module is first evaluated. A test runner cannot reliably
//     bootstrap behavioral tests against `mountEditor` if the module
//     side-effect-mounts on import (the editor would already be there with
//     stale config, and re-mounts would compete for the same DOM node).
//
//   - AC #1 (Slice B): When `bootstrap()` is invoked but no `#editor` host
//     exists, it must log a `console.warn` with the exact contract string
//     so missing-mount-point regressions are visible at runtime instead of
//     silently no-oping (the previous behavior).
//
//   - AC #2 (covered statically by `src-tauri/tests/frontend.rs`): the
//     module must expose `bootstrap` as a named export and gate the
//     auto-call on `import.meta.env.MODE !== 'test'`. The named-export half
//     is also exercised here as a sanity check (a test cannot import a
//     non-existent symbol).
//
// Why a separate file (not extending main.test.ts):
//   `main.test.ts` imports `../main` at the top of the file with an empty
//   `document.body`, so the existing import-time side effect is a no-op
//   there. We need a clean module-graph slot where we can pre-seed
//   `#editor` BEFORE the module is first evaluated, which means
//   `vi.resetModules()` + `await import('../main')` per test.

describe('Issue #22 / AC #3 — module-import side-effect gate', () => {
  beforeEach(() => {
    // Force a fresh evaluation of `../main` per test so the module's
    // top-level gate executes against the DOM we set up here, not against
    // whatever state a previous test left in the cache.
    vi.resetModules();
    document.body.innerHTML = '<div id="editor"></div>';
  });

  it('does not auto-mount Milkdown into a pre-seeded #editor when imported under Vitest', async () => {
    // RED until src/main.ts gates the auto-call on MODE !== 'test'.
    // Currently the module's top-level `if (host) { void mountEditor(...) }`
    // fires unconditionally, so importing this file under jsdom with an
    // `#editor` present produces a real ProseMirror node inside the host.
    await import('../main');

    // Wait long enough that, absent the gate, Milkdown's async
    // `Editor.make()...create()` chain — fired inside a `void` at module
    // top-level — would have completed and inserted a `.ProseMirror`
    // node into `#editor`. Microtask flushes alone (`await
    // Promise.resolve()`) are NOT sufficient: Milkdown's plugin loader
    // and ProseMirror's view init enqueue across multiple macrotask
    // boundaries in jsdom, and a too-short wait yields a false PASS even
    // when the gate is missing. 50ms is empirically enough for the
    // existing `main.test.ts` mount test (which awaits mountEditor
    // directly and sees `.ProseMirror`); we use 2× that as a safety
    // margin without making the suite noticeably slower.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const host = document.getElementById('editor');
    expect(host, 'pre-seeded #editor must still be in the DOM').not.toBeNull();

    // If the gate is in place, the host stays empty (no Milkdown children).
    const proseMirror = host!.querySelector('.ProseMirror');
    expect(
      proseMirror,
      'expected NO `.ProseMirror` node inside #editor after import (test-mode auto-mount must be gated off)',
    ).toBeNull();

    const editable = host!.querySelector('[contenteditable]');
    expect(
      editable,
      'expected NO `[contenteditable]` element inside #editor after import (test-mode auto-mount must be gated off)',
    ).toBeNull();
  });

  it('exposes a named `bootstrap` export so tests can drive the auto-mount path explicitly', async () => {
    // RED until src/main.ts adds `export function bootstrap()` (or
    // equivalent named binding). This is the seam the AC #1 warn-test
    // hangs off of — without it the auto-mount path is unreachable from
    // userland test code.
    const mod = await import('../main');
    expect(
      typeof (mod as { bootstrap?: unknown }).bootstrap,
      'expected `bootstrap` to be exported as a function from src/main.ts',
    ).toBe('function');
  });
});

describe('Issue #22 / AC #1 — bootstrap() warns when #editor host is missing', () => {
  beforeEach(() => {
    vi.resetModules();
    // Explicitly NO #editor — the failure mode we're locking in is
    // "module loaded, no mount point present".
    document.body.innerHTML = '';
  });

  it('logs the contracted console.warn message when document.getElementById("editor") returns null', async () => {
    // RED until bootstrap() exists AND emits the exact warn string.
    // The string is asserted verbatim because the issue spec quotes it
    // verbatim — a future contributor must not silently soften the
    // wording (e.g. drop the "[hashly]" prefix or change the verb), or
    // log filters / dashboards keyed on this string break.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { bootstrap } = (await import('../main')) as unknown as {
        bootstrap: () => void;
      };
      expect(typeof bootstrap, 'bootstrap must be a callable export').toBe('function');

      bootstrap();

      expect(
        warnSpy,
        'expected exactly one console.warn call when #editor is missing',
      ).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        '[hashly] #editor host element not found; mountEditor not auto-invoked',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not warn when #editor IS present (warn is reserved for the missing-host failure mode)', async () => {
    // Negative test: bootstrap() with a real host should mount silently —
    // no spurious warn. Pins the asymmetry: warn is a signal, not noise.
    document.body.innerHTML = '<div id="editor"></div>';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { bootstrap } = (await import('../main')) as unknown as {
        bootstrap: () => void;
      };
      bootstrap();

      // Allow microtasks to settle — `mountEditor` is async; if the
      // implementation accidentally warns from inside the promise chain
      // we want that to surface here.
      await Promise.resolve();
      await Promise.resolve();

      expect(
        warnSpy,
        'expected NO console.warn when #editor is present (warn must be missing-host-only)',
      ).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
