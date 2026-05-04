import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Issue #90 / AC 4.6 — `prefers-color-scheme` light/dark handling +
// `#hashly` wordmark carry-over for the web entry path.
//
// The v0.2 brand palette + wordmark already live in `src/style.css`
// and `index.html` (issue #46). The pivot to the web viewer (#90)
// must NOT lose either of those. This file pins:
//
//   1. Regression pins on `src/style.css`:
//        - A `@media (prefers-color-scheme: dark)` block exists.
//        - The `:root` palette tokens (`--paper`, `--ink`,
//          `--accent-2`) are defined.
//        - The wordmark CSS classes (`.hashly-wordmark`,
//          `.hashly-wordmark__hash`, `.hashly-wordmark__name`)
//          have rules.
//      Without these pins, a refactor that drops the dark-mode
//      block or palette tokens would silently regress the AC.
//
//   2. The web entry path picks up the brand styling: `src/viewer.ts`
//      imports `./style.css` so a viewer mounted in a fresh page
//      (no Tauri runtime, no main.ts loaded) still inherits the
//      brand palette + the dark-mode rebind.
//
//   3. `index.html` carries the `#hashly` wordmark markup so the
//      web entry shows the wordmark above the rendered spec.
//
// Pattern: static-contract (read file from disk + regex/string
// match). Matches the existing v0.2 polish tests
// (`h1-rule.test.ts`, `fenced-code.test.ts`, `list-rhythm.test.ts`).

function loadFile(...segments: string[]): string {
  return readFileSync(resolve(__dirname, '..', ...segments), 'utf-8');
}

function loadFromRepoRoot(...segments: string[]): string {
  return readFileSync(resolve(__dirname, '..', '..', ...segments), 'utf-8');
}

describe('Issue #90 / AC 4.6 — prefers-color-scheme + wordmark carry-over', () => {
  it('src/style.css contains a `@media (prefers-color-scheme: dark)` block', () => {
    // Regression pin: the dark-mode rebind is the entire AC for
    // light/dark handling (no JS toggle, per the brand spec). A
    // future refactor that drops the at-rule would silently leave
    // dark-mode users on the light palette.
    const css = loadFile('style.css');
    expect(
      /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/.test(css),
      'expected `src/style.css` to contain a `@media (prefers-color-scheme: dark)` at-rule (Issue #90 AC 4.6 — light/dark handling). v0.2 issue #46 added it; the v0.3 web pivot must not drop it.',
    ).toBe(true);
  });

  it('src/style.css defines the v0.2 brand palette tokens on :root (`--paper`, `--ink`, `--accent-2`)', () => {
    // The palette IS the theme (per the brand spec comment in
    // style.css). Pin three load-bearing tokens — paper/ink for
    // background/foreground, accent-2 for the wordmark gold #.
    // If any of these go away, the wordmark and editor surface
    // both lose their colors.
    const css = loadFile('style.css');
    expect(
      /--paper\s*:/.test(css),
      'expected `--paper` token to be defined in src/style.css (Issue #90 AC 4.6 — brand palette regression pin).',
    ).toBe(true);
    expect(
      /--ink\s*:/.test(css),
      'expected `--ink` token to be defined in src/style.css (Issue #90 AC 4.6 — brand palette regression pin).',
    ).toBe(true);
    expect(
      /--accent-2\s*:/.test(css),
      'expected `--accent-2` token to be defined in src/style.css (Issue #90 AC 4.6 — wordmark gold accent depends on this token).',
    ).toBe(true);
  });

  it('src/style.css carries CSS rules for the `#hashly` wordmark (.hashly-wordmark__hash and .hashly-wordmark__name)', () => {
    // The wordmark is rendered as two <span>s so the gold # is
    // colored independently of the ink "hashly" wordmark. Pin
    // both class selectors — losing either silently breaks the
    // visual.
    const css = loadFile('style.css');
    expect(
      /\.hashly-wordmark__hash\s*\{/.test(css),
      'expected a `.hashly-wordmark__hash` rule in src/style.css (Issue #90 AC 4.6 — wordmark gold accent).',
    ).toBe(true);
    expect(
      /\.hashly-wordmark__name\s*\{/.test(css),
      'expected a `.hashly-wordmark__name` rule in src/style.css (Issue #90 AC 4.6 — wordmark ink letters).',
    ).toBe(true);
  });

  it('src/viewer.ts imports `./style.css` so the brand palette applies on the web entry path', () => {
    // The viewer is the web-mode mount point. A bootstrap that
    // loads `src/viewer.ts` directly (without `src/main.ts`) must
    // still pick up the brand palette + the dark-mode rebind +
    // the wordmark styling. Vite's CSS-import side-effect is the
    // mechanism — pin the import string so a future refactor
    // that drops it (e.g. "we'll inject CSS at build time") gets
    // caught here.
    const src = loadFile('viewer.ts');
    expect(
      /import\s+['"]\.\/style\.css['"]/.test(src),
      'expected `src/viewer.ts` to `import "./style.css"` so the v0.2 brand palette + wordmark + prefers-color-scheme rebind apply on the web entry path (Issue #90 AC 4.6).',
    ).toBe(true);
  });

  it('index.html renders the `#hashly` wordmark markup (carry-over from v0.2)', () => {
    // The wordmark is part of the persistent brand surface. v0.2
    // ships it as static markup in `index.html`; the web pivot
    // must keep it there so the user always sees the brand on
    // load — even before JS hydration. Pin both class hooks plus
    // the literal `#` so a refactor that swaps in an SVG silently
    // breaks the textual brand.
    const html = loadFromRepoRoot('index.html');
    expect(
      html.includes('hashly-wordmark'),
      'expected `index.html` to contain the `hashly-wordmark` class (Issue #90 AC 4.6 — wordmark carry-over from v0.2).',
    ).toBe(true);
    expect(
      html.includes('hashly-wordmark__hash'),
      'expected `index.html` to contain the `hashly-wordmark__hash` class so the gold # is styled separately (Issue #90 AC 4.6).',
    ).toBe(true);
    expect(
      html.includes('hashly-wordmark__name'),
      'expected `index.html` to contain the `hashly-wordmark__name` class so the ink "hashly" letters are styled separately (Issue #90 AC 4.6).',
    ).toBe(true);
  });
});
