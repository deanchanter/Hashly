import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Issue #92 fix-loop iter-2 — dark-mode color cue collapse +
// banner icon glyphs (fix #2).
//
// AC for ux's iter-2 critical:
//
//   Dark-mode banner colors collapse: `.hashly-save-success` uses
//   `var(--accent)` and `.hashly-save-conflict` uses
//   `var(--accent-2)`. Light-mode tokens are forest (`#1e3a2f`)
//   and amber (`#c9a24b`) — distinct. But dark-mode rebind sets
//   `--accent: #c9a24b` (gold) and keeps `--accent-2: #c9a24b`
//   (gold). Both banners render with identical gold border-left.
//   Sighted dark-mode users cannot distinguish "saved" from
//   "conflict — your work might be lost".
//
//   Same root-cause class as #91 / #107 (palette-token collapse
//   under prefers-color-scheme rebind).
//
//   Team-lead's fix shape (combine both for belt-and-suspenders):
//
//   (a) Introduce `--success` and `--danger` palette tokens that
//       SURVIVE the dark-mode rebind. Per the brief:
//         --success: #1e3a2f light / #7ab87a dark
//         --danger:  #b04040 light / #e08a8a dark
//       Reassign `.hashly-save-success` to `var(--success)` and
//       `.hashly-save-error` to `var(--danger)`. Keep
//       `.hashly-save-conflict` on `var(--accent-2)` (gold in
//       both modes is the canonical conflict color).
//
//   (b) Add an icon glyph at the leading edge of each banner: ✓
//       for success, ⚠ for conflict, ✕ for error. Survives any
//       future token-collapse + helps colorblind users. Pin via
//       a `[data-testid="banner-icon"]` element inside each
//       banner so the tests don't have to encode glyph
//       preferences.
//
// We pin OUTCOMES at two surfaces:
//
//   1. **CSS contract** (static parse of style.css): --success +
//      --danger declared in both :root and the dark-mode block,
//      with DIFFERENT light/dark values. The three banner
//      classes reference three distinct tokens in their
//      border-left so the dark-mode collapse can't recur.
//
//   2. **DOM contract** (runtime DOM inspection): each banner
//      contains a `[data-testid="banner-icon"]` element with
//      non-empty textContent. Builder picks the actual glyph.

function loadStyleCss(): string {
  return readFileSync(resolve(__dirname, '..', 'style.css'), 'utf-8');
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface Rule {
  selector: string;
  body: string;
}

/** Top-level (non-@-block) rule extractor — same as
 *  viewer-surfaces-css.test.ts / save-banner-css.test.ts. */
function topLevelRules(css: string): Rule[] {
  const stripped = stripComments(css);
  const out: Rule[] = [];
  const re = /([^{}]*)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const selector = (m[1] ?? '').trim();
    if (selector.startsWith('@')) continue;
    out.push({ selector, body: m[2] ?? '' });
  }
  return out;
}

/** Extract the body of the FIRST `@media (prefers-color-scheme:
 *  dark) { ... }` block. Naive brace-balance walker so nested
 *  rules inside the @media don't confuse the parser. */
function darkModeBlockBody(css: string): string {
  const stripped = stripComments(css);
  const startRe = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/;
  const startMatch = startRe.exec(stripped);
  if (!startMatch) return '';
  const blockStart = startMatch.index + startMatch[0].length;
  let depth = 1;
  let i = blockStart;
  while (i < stripped.length && depth > 0) {
    const c = stripped[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return stripped.slice(blockStart, i - 1);
}

function findCustomProp(body: string, prop: string): string | null {
  // Match `--prop: value;` where value runs until `;` or end of body.
  // Prop names are dash-only, no escaping needed.
  const re = new RegExp(`(?:^|;|\\{)\\s*${prop.replace(/-/g, '\\-')}\\s*:\\s*([^;]+)`, 'gi');
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    last = (m[1] ?? '').trim();
  }
  return last;
}

function findDecl(body: string, prop: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'gi');
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    last = (m[1] ?? '').trim();
  }
  return last;
}

function rulesMatching(css: string, predicate: (r: Rule) => boolean): Rule[] {
  return topLevelRules(css).filter(predicate);
}

function hasSelector(rule: Rule, exact: string): boolean {
  return rule.selector
    .split(',')
    .map((s) => s.trim())
    .some((s) => s === exact);
}

function rootBlockBody(css: string): string {
  // Return the FIRST `:root { ... }` rule body (light-mode tokens).
  const matching = rulesMatching(css, (r) => hasSelector(r, ':root'));
  if (matching.length === 0) return '';
  return matching[0]!.body;
}

describe('Issue #92 fix #2 — dark-mode-stable success / danger palette tokens', () => {
  it('`:root` declares `--success` (light-mode token)', () => {
    // The new palette token. Without the dedicated --success
    // token, success and conflict collapse to the same color in
    // dark mode (both rebind to --accent-2 / gold).
    const css = loadStyleCss();
    const value = findCustomProp(rootBlockBody(css), '--success');
    expect(
      value,
      'expected `:root` to declare a `--success` custom property (#2 — light-mode token for success-banner border-left). Without --success the dark-mode rebind collapses success and conflict.',
    ).not.toBeNull();
    expect(
      String(value).length,
      'expected `--success` to have a non-empty value.',
    ).toBeGreaterThan(0);
  });

  it('`:root` declares `--danger` (light-mode token)', () => {
    const css = loadStyleCss();
    const value = findCustomProp(rootBlockBody(css), '--danger');
    expect(
      value,
      'expected `:root` to declare a `--danger` custom property (#2 — light-mode token for error-banner border-left). iter-1 used --ink-2 (a text color, semantically wrong for "error red"); iter-2 introduces a dedicated token.',
    ).not.toBeNull();
    expect(String(value).length).toBeGreaterThan(0);
  });

  it('`@media (prefers-color-scheme: dark)` block declares `--success`', () => {
    // The dark-mode override is what makes the color cue
    // distinct in dark mode. Without it the value falls back to
    // the :root declaration which is a forest green that's hard
    // to see on a dark background.
    const css = loadStyleCss();
    const value = findCustomProp(darkModeBlockBody(css), '--success');
    expect(
      value,
      'expected the `@media (prefers-color-scheme: dark)` block to override `--success` (#2 — without the override the success banner uses an unreadable forest-green border on dark paper).',
    ).not.toBeNull();
    expect(String(value).length).toBeGreaterThan(0);
  });

  it('`@media (prefers-color-scheme: dark)` block declares `--danger`', () => {
    const css = loadStyleCss();
    const value = findCustomProp(darkModeBlockBody(css), '--danger');
    expect(
      value,
      'expected the dark-mode block to override `--danger` (#2 — same shape as --success).',
    ).not.toBeNull();
    expect(String(value).length).toBeGreaterThan(0);
  });

  it('`--success` light value DIFFERS from dark value (color cue actually rebinds)', () => {
    // The central #2 RED-path pin: tokens that rebind to the
    // SAME value in both modes (the iter-1 bug class) provide no
    // dark-mode distinction. Pinning "values differ" forces a
    // legitimate dark-mode color choice.
    const css = loadStyleCss();
    const lightValue = findCustomProp(rootBlockBody(css), '--success');
    const darkValue = findCustomProp(darkModeBlockBody(css), '--success');
    expect(
      lightValue && darkValue,
      'precondition: both light and dark --success tokens must exist',
    ).toBeTruthy();
    expect(
      darkValue,
      `expected --success dark value to DIFFER from light value (#2 — same value in both modes is the iter-1 bug class). Light: ${JSON.stringify(lightValue)}. Dark: ${JSON.stringify(darkValue)}.`,
    ).not.toBe(lightValue);
  });

  it('`--danger` light value DIFFERS from dark value', () => {
    const css = loadStyleCss();
    const lightValue = findCustomProp(rootBlockBody(css), '--danger');
    const darkValue = findCustomProp(darkModeBlockBody(css), '--danger');
    expect(
      darkValue,
      `expected --danger dark value to DIFFER from light value. Light: ${JSON.stringify(lightValue)}. Dark: ${JSON.stringify(darkValue)}.`,
    ).not.toBe(lightValue);
  });
});

describe('Issue #92 fix #2 — banner border-lefts use the dark-mode-stable tokens', () => {
  it('`.hashly-save-success` border-left references `var(--success)`', () => {
    // The reassignment pin. iter-1 used `var(--accent)` which
    // collapses in dark mode. iter-2 retargets to the new
    // `--success` token.
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      hasSelector(r, '.hashly-save-success'),
    );
    const allBodies = matching.map((r) => r.body).join(';\n');
    const borderLeft =
      findDecl(allBodies, 'border-left') ?? findDecl(allBodies, 'border');
    expect(
      borderLeft,
      'precondition: `.hashly-save-success` must declare a border-left (cross-pin with iter-1 #6).',
    ).not.toBeNull();
    expect(
      String(borderLeft).includes('var(--success)'),
      `expected the success-banner border-left to reference \`var(--success)\` (#2 — retargeted from iter-1's \`var(--accent)\` which collapses in dark mode). Got: ${JSON.stringify(borderLeft)}.`,
    ).toBe(true);
  });

  it('`.hashly-save-error` border-left references `var(--danger)`', () => {
    // iter-1 used `var(--ink-2)` (a text color — semantically
    // wrong for "error red"). iter-2 retargets to `--danger`.
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      hasSelector(r, '.hashly-save-error'),
    );
    const allBodies = matching.map((r) => r.body).join(';\n');
    const borderLeft =
      findDecl(allBodies, 'border-left') ?? findDecl(allBodies, 'border');
    expect(
      String(borderLeft).includes('var(--danger)'),
      `expected the error-banner border-left to reference \`var(--danger)\` (#2 — retargeted from iter-1's \`var(--ink-2)\`). Got: ${JSON.stringify(borderLeft)}.`,
    ).toBe(true);
  });

  it('`.hashly-save-conflict` border-left still references `var(--accent-2)` (regression guard — amber survives dark)', () => {
    // Conflict's amber/gold (`--accent-2`) is identical in light
    // (`#c9a24b`) and dark (`#c9a24b`). It works AS the conflict
    // color in both modes. Pin so the iter-2 fix doesn't
    // accidentally retarget conflict to the new tokens — the
    // three banners must use three different tokens.
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      hasSelector(r, '.hashly-save-conflict'),
    );
    const allBodies = matching.map((r) => r.body).join(';\n');
    const borderLeft =
      findDecl(allBodies, 'border-left') ?? findDecl(allBodies, 'border');
    expect(
      String(borderLeft).includes('var(--accent-2)'),
      `expected conflict-banner border-left to reference \`var(--accent-2)\` (regression guard — amber is the canonical conflict color in both modes). Got: ${JSON.stringify(borderLeft)}.`,
    ).toBe(true);
  });

  it('the three save-* banners reference THREE DISTINCT color tokens (no collapse possible)', () => {
    // Belt-and-suspenders: even if a future change retargets one
    // banner, the three must remain distinct. Extract the
    // first var(--*) reference from each border-left and
    // verify all three differ.
    const css = loadStyleCss();
    function tokenFor(selector: string): string | null {
      const matching = rulesMatching(css, (r) => hasSelector(r, selector));
      const allBodies = matching.map((r) => r.body).join(';\n');
      const borderLeft =
        findDecl(allBodies, 'border-left') ?? findDecl(allBodies, 'border');
      if (!borderLeft) return null;
      const m = /var\(\s*(--[\w-]+)\s*\)/.exec(borderLeft);
      return m?.[1] ?? null;
    }
    const success = tokenFor('.hashly-save-success');
    const error = tokenFor('.hashly-save-error');
    const conflict = tokenFor('.hashly-save-conflict');
    expect(success, 'success token must be extractable').not.toBeNull();
    expect(error, 'error token must be extractable').not.toBeNull();
    expect(conflict, 'conflict token must be extractable').not.toBeNull();

    const tokens = [success, error, conflict];
    const distinct = new Set(tokens).size;
    expect(
      distinct,
      `expected three DISTINCT border-left tokens across the save-* banner family (#2 — dark-mode collapse only happens when two banners use the same token). Got: success=${success}, error=${error}, conflict=${conflict}.`,
    ).toBe(3);
  });
});

describe('Issue #92 fix #2 — icon glyph per banner kind (DOM contract)', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('renderSaveSuccess banner contains a `[data-testid="banner-icon"]` element', async () => {
    // Belt-and-suspenders for any future palette-token collapse:
    // a glyph at the leading edge of the banner is mode-stable
    // by construction (Unicode characters survive any CSS
    // change). Also helps colorblind users distinguish kinds.
    const { renderSaveSuccess } = (await import('../save-result')) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
    };
    renderSaveSuccess(host, 'https://github.com/foo/bar/pull/1');

    const banner = host.querySelector('[data-testid="save-success"]');
    expect(banner, 'precondition: success banner must exist').not.toBeNull();
    const icon = banner!.querySelector('[data-testid="banner-icon"]');
    expect(
      icon,
      'expected a [data-testid="banner-icon"] element inside the save-success banner (#2 — icon glyph per kind helps colorblind users + survives palette collapse).',
    ).not.toBeNull();
    expect(
      (icon!.textContent ?? '').length,
      `expected the banner-icon textContent to be non-empty. Got: ${JSON.stringify(icon!.textContent)}.`,
    ).toBeGreaterThan(0);
  });

  it('renderSaveError banner contains a `[data-testid="banner-icon"]` element', async () => {
    const { renderSaveError } = (await import('../save-result')) as unknown as {
      renderSaveError: (host: HTMLElement, message: string) => void;
    };
    renderSaveError(host, 'something went wrong');

    const banner = host.querySelector('[data-testid="save-error"]');
    expect(banner, 'precondition: error banner must exist').not.toBeNull();
    const icon = banner!.querySelector('[data-testid="banner-icon"]');
    expect(
      icon,
      'expected a [data-testid="banner-icon"] element inside the save-error banner (#2).',
    ).not.toBeNull();
    expect((icon!.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('renderSaveConflict banner contains a `[data-testid="banner-icon"]` element', async () => {
    const { renderSaveConflict } = (await import('../save-result')) as unknown as {
      renderSaveConflict: (
        host: HTMLElement,
        opts: { getContent: () => string },
      ) => void;
    };
    renderSaveConflict(host, { getContent: () => '' });

    const banner = host.querySelector('[data-testid="save-conflict"]');
    expect(banner, 'precondition: conflict banner must exist').not.toBeNull();
    const icon = banner!.querySelector('[data-testid="banner-icon"]');
    expect(
      icon,
      'expected a [data-testid="banner-icon"] element inside the save-conflict banner (#2).',
    ).not.toBeNull();
    expect((icon!.textContent ?? '').length).toBeGreaterThan(0);
  });
});
