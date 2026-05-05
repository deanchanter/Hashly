import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Issue #92 fix-loop iter-1 — banner CSS (fix #6).
//
// AC for adversarial-reviewer's #6:
//
//   Zero CSS rules for any save banner. They render unstyled (system
//   fonts, no padding, no color cue). Users can't tell success from
//   conflict from error at a glance.
//
//   Fix: mirror the existing `.hashly-view-only-lock` /
//   `.hashly-post-auth-prompt` / `.hashly-auth-cancelled` patterns.
//   Use brand tokens (--paper-2, --accent, --rule). Distinct color
//   cues per kind: success=green/forest accent, conflict=amber/
//   warning accent, error=red/auburn accent. Dark-mode tokens.
//   `:focus-visible` for the Copy/Reload buttons.
//
// Pattern: static-contract test (read `src/style.css` from disk +
// regex parse) — same approach as `viewer-surfaces-css.test.ts`
// (Issue #90 fix #6). jsdom doesn't reliably parse external
// stylesheets in vitest, so static parsing is the only stable seam.
//
// What this slice pins:
//
//   1. Each of `.hashly-save-success`, `.hashly-save-error`,
//      `.hashly-save-conflict` has a rule with `padding`,
//      `border` (or `border-left`), and at least one `var(--*)`
//      brand-token reference (no hardcoded colors).
//   2. `.hashly-save-conflict__copy` rule exists for the
//      Copy-your-edit button.
//   3. `.hashly-save-conflict__copy:focus-visible` rule exists
//      (a11y — keyboard focus indication is non-negotiable for an
//      action button at a high-stakes recovery moment).
//   4. The `.hashly-save-conflict__copy` class is APPLIED to the
//      Copy button DOM in `renderSaveConflict` (otherwise the CSS
//      rule has no effect).
//   5. NO raw hex literals (`#xxxxxx`) in any `.hashly-save-*`
//      rule body — palette-token-only so dark-mode rebind works.
//
// We do NOT pin specific colors per kind (success=green, error=
// red, conflict=amber). The team-lead's spec says "distinct
// cues" but doesn't lock specific palette token names; pinning
// only `var(--*)` presence keeps the builder free to pick.

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

function rules(css: string): Rule[] {
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

function rulesMatching(
  css: string,
  predicate: (r: Rule) => boolean,
): Rule[] {
  return rules(css).filter(predicate);
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

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const VAR_RE = /var\(\s*--[\w-]+\s*\)/;

function hasSelector(rule: Rule, exact: string): boolean {
  return rule.selector
    .split(',')
    .map((s) => s.trim())
    .some((s) => s === exact);
}

function hasSelectorWithSuffix(rule: Rule, exact: string, suffix: string): boolean {
  return rule.selector
    .split(',')
    .map((s) => s.trim())
    .some((s) => s === `${exact}${suffix}`);
}

describe('Issue #92 fix #6 — save-banner CSS', () => {
  it('`.hashly-save-success` has a rule with `padding` AND a brand `var(--*)` reference', () => {
    // Mirrors the .hashly-view-only-lock / .hashly-post-auth-prompt
    // / .hashly-auth-cancelled patterns. Without `padding`, the
    // banner is flush with the viewport edge; without var(--*),
    // the banner can't rebind for dark mode.
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) => hasSelector(r, '.hashly-save-success'));
    expect(
      matching.length,
      'expected at least one rule with selector `.hashly-save-success` in src/style.css (fix #6).',
    ).toBeGreaterThan(0);

    const hasPadding = matching.some((r) => findDecl(r.body, 'padding') !== null);
    expect(
      hasPadding,
      'expected `.hashly-save-success` to declare `padding` so the banner is not flush with the viewport edge.',
    ).toBe(true);

    const hasVar = matching.some((r) => VAR_RE.test(r.body));
    expect(
      hasVar,
      'expected `.hashly-save-success` to reference at least one `var(--*)` brand token (so dark-mode rebind works automatically).',
    ).toBe(true);
  });

  it('`.hashly-save-success` has a `border` (or `border-left`) so the banner has a visible color cue', () => {
    // The existing .hashly-view-only-lock pattern uses
    // `border-left: 4px solid var(--accent-2)` as the color cue.
    // We pin "border or border-left" so the builder can pick
    // either; a regression that has padding + var() but no border
    // would render an invisible banner against the editor body.
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) => hasSelector(r, '.hashly-save-success'));
    const hasBorder = matching.some(
      (r) =>
        findDecl(r.body, 'border') !== null ||
        findDecl(r.body, 'border-left') !== null,
    );
    expect(
      hasBorder,
      'expected `.hashly-save-success` to declare `border` or `border-left` so the banner has a distinct color cue (mirrors .hashly-view-only-lock pattern).',
    ).toBe(true);
  });

  it('`.hashly-save-error` has a rule with `padding` AND a brand `var(--*)` reference', () => {
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) => hasSelector(r, '.hashly-save-error'));
    expect(
      matching.length,
      'expected at least one `.hashly-save-error` rule in src/style.css (fix #6).',
    ).toBeGreaterThan(0);

    const hasPadding = matching.some((r) => findDecl(r.body, 'padding') !== null);
    expect(
      hasPadding,
      'expected `.hashly-save-error` to declare `padding`.',
    ).toBe(true);

    const hasVar = matching.some((r) => VAR_RE.test(r.body));
    expect(
      hasVar,
      'expected `.hashly-save-error` to reference at least one `var(--*)` brand token.',
    ).toBe(true);
  });

  it('`.hashly-save-error` has a `border` (or `border-left`)', () => {
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) => hasSelector(r, '.hashly-save-error'));
    const hasBorder = matching.some(
      (r) =>
        findDecl(r.body, 'border') !== null ||
        findDecl(r.body, 'border-left') !== null,
    );
    expect(
      hasBorder,
      'expected `.hashly-save-error` to declare `border` or `border-left` (color cue).',
    ).toBe(true);
  });

  it('`.hashly-save-conflict` has a rule with `padding` AND a brand `var(--*)` reference', () => {
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) => hasSelector(r, '.hashly-save-conflict'));
    expect(
      matching.length,
      'expected at least one `.hashly-save-conflict` rule in src/style.css (fix #6).',
    ).toBeGreaterThan(0);

    const hasPadding = matching.some((r) => findDecl(r.body, 'padding') !== null);
    expect(hasPadding, 'expected `.hashly-save-conflict` to declare `padding`.').toBe(true);

    const hasVar = matching.some((r) => VAR_RE.test(r.body));
    expect(
      hasVar,
      'expected `.hashly-save-conflict` to reference at least one `var(--*)` brand token.',
    ).toBe(true);
  });

  it('`.hashly-save-conflict` has a `border` (or `border-left`)', () => {
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) => hasSelector(r, '.hashly-save-conflict'));
    const hasBorder = matching.some(
      (r) =>
        findDecl(r.body, 'border') !== null ||
        findDecl(r.body, 'border-left') !== null,
    );
    expect(
      hasBorder,
      'expected `.hashly-save-conflict` to declare `border` or `border-left` (color cue).',
    ).toBe(true);
  });

  it('`.hashly-save-conflict__copy` rule exists (Copy button styling)', () => {
    // The team-lead's brief listed `.hashly-save-conflict__copy`
    // alongside the banner classes. The Copy button at a high-
    // stakes recovery moment needs a discoverable affordance —
    // unstyled <button> in browser UA chrome is unprofessional
    // and a11y-hostile.
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      hasSelector(r, '.hashly-save-conflict__copy'),
    );
    expect(
      matching.length,
      'expected at least one `.hashly-save-conflict__copy` rule in src/style.css (fix #6 — the Copy-your-edit button).',
    ).toBeGreaterThan(0);
  });

  it('`.hashly-save-conflict__copy:focus-visible` rule exists (a11y — keyboard focus indication)', () => {
    // The team-lead's brief mandates `:focus-visible` for the
    // Copy/Reload buttons. Keyboard users need a visible focus
    // ring to know which button is active. The `:focus-visible`
    // pseudo (vs `:focus`) shows the ring only on keyboard nav,
    // not on mouse click — best-practice a11y.
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      hasSelectorWithSuffix(r, '.hashly-save-conflict__copy', ':focus-visible'),
    );
    expect(
      matching.length,
      'expected a `.hashly-save-conflict__copy:focus-visible` rule (fix #6 — keyboard focus indication on the Copy button is non-negotiable for the AC 6.5 high-stakes recovery moment).',
    ).toBeGreaterThan(0);
  });

  it('NO raw hex literals (`#xxxxxx`) in any `.hashly-save-*` rule body', () => {
    // Cross-cutting pin: brand tokens only, no hardcoded colors.
    // Mirrors the equivalent pin in viewer-surfaces-css.test.ts.
    // Without this, dark-mode rebind silently breaks for these
    // banners while the rest of the app rebinds correctly.
    const css = loadStyleCss();
    const saveRules = rulesMatching(css, (r) =>
      r.selector.split(',').some((s) => s.trim().startsWith('.hashly-save-')),
    );

    const offenders: { selector: string; hex: string[] }[] = [];
    for (const r of saveRules) {
      const hits = r.body.match(HEX_RE);
      if (hits && hits.length > 0) {
        offenders.push({ selector: r.selector, hex: hits });
      }
    }
    expect(
      offenders,
      `expected NO raw hex colors in any .hashly-save-* rule body — use var(--*) brand tokens instead so dark-mode rebind works. Found: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});

describe('Issue #92 fix #6 — Copy button has the `.hashly-save-conflict__copy` class applied', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('the Copy-your-edit button created by renderSaveConflict carries the `hashly-save-conflict__copy` class (so the CSS rule applies)', async () => {
    // Without this, the CSS rules pinned above have no element
    // to bind to and the button stays UA-styled. The CSS contract
    // and the DOM contract MUST match — pinning both ends.
    const { renderSaveConflict } = (await import('../save-result')) as unknown as {
      renderSaveConflict: (
        host: HTMLElement,
        opts: { getContent: () => string },
      ) => void;
    };
    renderSaveConflict(host, { getContent: () => '' });

    const banner = host.querySelector<HTMLElement>(
      '[data-testid="save-conflict"]',
    );
    expect(banner, 'precondition: conflict banner must exist').not.toBeNull();

    const copyBtn = Array.from(
      banner!.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => {
      const t = (b.textContent ?? '').toLowerCase();
      return t.includes('copy') && t.includes('edit');
    });
    expect(copyBtn, 'precondition: Copy button must exist').toBeDefined();

    expect(
      copyBtn!.classList.contains('hashly-save-conflict__copy'),
      `expected the Copy button to have class "hashly-save-conflict__copy" (fix #6 — without the class, the matching CSS rules don't apply and the button stays UA-styled). Got classList: ${JSON.stringify(Array.from(copyBtn!.classList))}.`,
    ).toBe(true);
  });
});

describe('Issue #92 iter-2 fix #3 — Reload button CSS', () => {
  // Iter-1 added the `.hashly-save-conflict__reload` class on the
  // button DOM (slice 7) but never added a CSS rule for it. Copy
  // and Reload sit adjacent in the conflict banner; Copy is fully
  // styled while Reload uses browser default. At the highest-
  // stakes UX moment (the user is recovering from a stale-SHA
  // conflict), the recovery affordances looked half-finished.
  //
  // Fix per team-lead: copy `.hashly-save-conflict__copy` rules
  // verbatim into `.hashly-save-conflict__reload`. Add some
  // `margin-left` to separate the buttons visually. Add the
  // matching `:focus-visible` rule for keyboard focus indication.

  it('`.hashly-save-conflict__reload` rule exists with `padding`', () => {
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      hasSelector(r, '.hashly-save-conflict__reload'),
    );
    expect(
      matching.length,
      'expected at least one `.hashly-save-conflict__reload` rule in src/style.css (iter-2 fix #3 — Reload button styling, mirrors `.hashly-save-conflict__copy` from iter-1).',
    ).toBeGreaterThan(0);

    const hasPadding = matching.some((r) => findDecl(r.body, 'padding') !== null);
    expect(
      hasPadding,
      'expected `.hashly-save-conflict__reload` to declare `padding` (UA-default is unstyled; padding is the load-bearing button affordance).',
    ).toBe(true);
  });

  it('`.hashly-save-conflict__reload` has a `border` declaration', () => {
    // Belt with the Copy-button parallel: a styled button has a
    // visible border, not just text. Pin both padding and border
    // so a regression that drops one but keeps the other doesn't
    // slip through.
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      hasSelector(r, '.hashly-save-conflict__reload'),
    );
    const hasBorder = matching.some((r) => findDecl(r.body, 'border') !== null);
    expect(
      hasBorder,
      'expected `.hashly-save-conflict__reload` to declare `border` (visual button affordance; mirrors Copy button styling).',
    ).toBe(true);
  });

  it('`.hashly-save-conflict__reload` references at least one `var(--*)` brand token', () => {
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      hasSelector(r, '.hashly-save-conflict__reload'),
    );
    const hasVar = matching.some((r) => VAR_RE.test(r.body));
    expect(
      hasVar,
      'expected `.hashly-save-conflict__reload` rule body to reference at least one `var(--*)` brand token (so dark-mode rebind works automatically + no raw hex).',
    ).toBe(true);
  });

  it('`.hashly-save-conflict__reload:focus-visible` rule exists (a11y — keyboard focus indication)', () => {
    // Same a11y mandate as `.hashly-save-conflict__copy:focus-
    // visible` from iter-1 fix #6. Keyboard users navigating
    // the conflict banner with Tab need a visible focus ring on
    // BOTH buttons (Copy AND Reload); without this rule, only
    // Copy gets the ring and Reload uses UA-default focus
    // styling (or none, depending on browser).
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      hasSelectorWithSuffix(r, '.hashly-save-conflict__reload', ':focus-visible'),
    );
    expect(
      matching.length,
      'expected a `.hashly-save-conflict__reload:focus-visible` rule (iter-2 fix #3 — keyboard focus indication parity with Copy button; pinned by team-lead in original iter-1 brief: "`:focus-visible` for the Copy/Reload buttons").',
    ).toBeGreaterThan(0);
  });
});
