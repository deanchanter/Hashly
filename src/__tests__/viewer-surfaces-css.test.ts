import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Issue #90 / Critical fix #6 — CSS for viewer surfaces.
//
// The AC 4.1–4.7 surfaces (`.viewer-landing`, `.viewer-header`,
// `.viewer-error` and modifiers) were shipped as class hooks only
// — zero rules in `src/style.css` referenced them. The reviewer
// flagged: landing renders with default UA fonts; header has no
// border / padding / contrast; error states have no warning
// iconography or color cue.
//
// Pattern: static-contract (read `src/style.css` from disk + regex)
// — same approach the v0.2 polish suite uses (`h1-rule.test.ts`,
// `fenced-code.test.ts`, `list-rhythm.test.ts`,
// `iframe-sizing.test.ts`).
//
// Per the team-lead's brief: "Don't over-pin colors; pin the
// existence of brand-token-derived rules." So the tests below
// pin:
//   - the rule EXISTS for each class hook
//   - the rule body has a `padding` (or in some cases `border`)
//     declaration (proves the surface is styled at all)
//   - the rule body references at least one `var(--*)` brand
//     token (no hardcoded colors)
//   - NO raw hex literals (`#xxxxxx` / `#xxx`) appear in the new
//     rule bodies — palette tokens are the only source of truth
// Plus the one specific 600px-iframe pin from team-lead:
//   - `.viewer-header__coords` has `text-overflow: ellipsis;
//     overflow: hidden; white-space: nowrap;` so a long
//     `repo · path @ ref` doesn't blow out a 600px iframe column.

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

function rulesMatching(css: string, predicate: (r: Rule) => boolean): Rule[] {
  return rules(css).filter(predicate);
}

function selectorContains(selector: string, hook: string): boolean {
  // Treat the selector list (`.foo, .bar`) as discrete selectors.
  // A rule with selector `.viewer-header, .viewer-landing { ... }`
  // counts as having both hooks.
  return selector
    .split(',')
    .map((s) => s.trim())
    .some((s) => s === hook || s.startsWith(`${hook} `) || s.includes(`${hook}:`));
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

describe('Issue #90 / Critical fix #6 — CSS for viewer surfaces', () => {
  it('`.viewer-landing` has a styled rule with `padding` AND a brand `var(--*)` reference', () => {
    // The cold-landing surface must look like part of the app, not
    // a default-styled `<div>`. Pinning `padding` + a brand token
    // proves the rule exists AND uses the palette (so it works in
    // dark mode automatically).
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      r.selector.split(',').some((s) => s.trim() === '.viewer-landing'),
    );
    expect(
      matching.length,
      'expected at least one rule with selector `.viewer-landing` in src/style.css (Issue #90 fix #6 — landing surface needs styling).',
    ).toBeGreaterThan(0);

    // At least one of the matching rules must have padding.
    const hasPadding = matching.some((r) => findDecl(r.body, 'padding') !== null);
    expect(
      hasPadding,
      'expected `.viewer-landing` to have a `padding` declaration so the surface is not flush with the viewport edge.',
    ).toBe(true);

    // At least one of the matching rules must reference a brand token.
    const hasVar = matching.some((r) => VAR_RE.test(r.body));
    expect(
      hasVar,
      'expected `.viewer-landing` rule body to reference a `var(--*)` brand token (so dark-mode rebind works automatically).',
    ).toBe(true);
  });

  it('`.viewer-header` has a styled rule with `padding`, `border` (or `border-bottom`), AND a brand `var(--*)` reference', () => {
    // The header is the persistent top strip. Padding + a bottom
    // border are the load-bearing visual cues that distinguish
    // it from the viewer body below.
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      r.selector.split(',').some((s) => s.trim() === '.viewer-header'),
    );
    expect(
      matching.length,
      'expected at least one `.viewer-header` rule in src/style.css.',
    ).toBeGreaterThan(0);

    const hasPadding = matching.some((r) => findDecl(r.body, 'padding') !== null);
    expect(hasPadding, 'expected `.viewer-header` to have a `padding` declaration.').toBe(true);

    const hasBorder = matching.some(
      (r) =>
        findDecl(r.body, 'border') !== null ||
        findDecl(r.body, 'border-bottom') !== null,
    );
    expect(
      hasBorder,
      'expected `.viewer-header` to have a `border` or `border-bottom` declaration so it visually separates from the viewer body.',
    ).toBe(true);

    const hasVar = matching.some((r) => VAR_RE.test(r.body));
    expect(
      hasVar,
      'expected `.viewer-header` rule body to reference a `var(--*)` brand token.',
    ).toBe(true);
  });

  it('`.viewer-header__coords` has `text-overflow: ellipsis` + `overflow: hidden` + `white-space: nowrap` (600px-iframe contract)', () => {
    // The coords text (`<repo> · <path> @ <ref>`) can be 60+ chars
    // and easily exceeds a 600px iframe column. Pin all three
    // declarations together — any one alone is insufficient
    // (ellipsis without overflow:hidden does nothing; nowrap
    // without ellipsis just clips). Builder also needs to add
    // `.viewer-header__coords` to the rendered span so the
    // selector matches.
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      r.selector.split(',').some((s) => s.trim() === '.viewer-header__coords'),
    );
    expect(
      matching.length,
      'expected at least one `.viewer-header__coords` rule in src/style.css. The builder must also apply the class to the rendered <span> in `src/viewer-header.ts`.',
    ).toBeGreaterThan(0);

    // All three declarations should appear on the SAME rule (or
    // collectively across matching rules — we union the bodies).
    const unionBody = matching.map((r) => r.body).join(';\n');
    expect(
      findDecl(unionBody, 'text-overflow'),
      'expected `.viewer-header__coords` to declare `text-overflow: ellipsis` so a long repo/path/ref string truncates with `…` in a narrow column.',
    ).toMatch(/ellipsis/);
    expect(
      findDecl(unionBody, 'overflow'),
      'expected `.viewer-header__coords` to declare `overflow: hidden` so the truncated text actually clips.',
    ).toMatch(/hidden/);
    expect(
      findDecl(unionBody, 'white-space'),
      'expected `.viewer-header__coords` to declare `white-space: nowrap` so the coords text stays on a single line.',
    ).toMatch(/nowrap/);
  });

  it('`.viewer-header__github-link` has a `color` rule sourced from a `var(--*)` brand token (NOT the default link blue)', () => {
    // Default UA link color is `rgb(0,0,238)` — clashes with the
    // forest-and-paper brand palette. Pin that the github
    // out-link uses a brand token, AND that the rule body has no
    // raw hex (which would imply a hardcoded color).
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      r.selector.split(',').some((s) => s.trim() === '.viewer-header__github-link'),
    );
    expect(
      matching.length,
      'expected at least one `.viewer-header__github-link` rule.',
    ).toBeGreaterThan(0);

    const hasColor = matching.some((r) => findDecl(r.body, 'color') !== null);
    expect(
      hasColor,
      'expected `.viewer-header__github-link` to have a `color` declaration so it does not use the default UA link color.',
    ).toBe(true);

    const hasVar = matching.some((r) => VAR_RE.test(r.body));
    expect(
      hasVar,
      'expected `.viewer-header__github-link` rule body to reference a `var(--*)` brand token.',
    ).toBe(true);
  });

  it('`.viewer-error` has a styled rule with `padding` AND a brand `var(--*)` reference', () => {
    // The error surface (404 / 403 / network / other) needs a
    // visible card-like treatment so the user immediately
    // distinguishes it from the viewer body.
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      r.selector.split(',').some((s) => s.trim() === '.viewer-error'),
    );
    expect(
      matching.length,
      'expected at least one `.viewer-error` rule.',
    ).toBeGreaterThan(0);

    const hasPadding = matching.some((r) => findDecl(r.body, 'padding') !== null);
    expect(hasPadding, 'expected `.viewer-error` to have a `padding` declaration.').toBe(true);

    const hasVar = matching.some((r) => VAR_RE.test(r.body));
    expect(
      hasVar,
      'expected `.viewer-error` rule body to reference a `var(--*)` brand token.',
    ).toBe(true);
  });

  it('at least one `.viewer-error--<kind>` modifier rule exists (distinct color cue per failure kind)', () => {
    // Per the team-lead's spec: "warning yellow for not-found /
    // forbidden, neutral for network, etc." — distinct color cues
    // per kind so the user can distinguish the error surface at
    // a glance. We pin only the existence of at least one
    // modifier rule (don't over-pin specific colors), so the
    // builder is free to choose the per-kind palette.
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      r.selector.split(',').some((s) => /^\.viewer-error--[a-z-]+$/.test(s.trim())),
    );
    expect(
      matching.length,
      'expected at least one `.viewer-error--<kind>` modifier rule (e.g. `.viewer-error--not-found`) so failure kinds have distinct visual cues.',
    ).toBeGreaterThan(0);
  });

  it('`.viewer-landing__error` has a rule (small inline error pill for invalid params)', () => {
    // The team-lead's spec calls out a "small inline error pill"
    // for the landing-page error case. The rule already exists
    // implicitly via the AC 4.2 `landing.ts` markup; pin it
    // explicitly so the builder grows the brand surface here too.
    const css = loadStyleCss();
    const matching = rulesMatching(css, (r) =>
      r.selector.split(',').some((s) => s.trim() === '.viewer-landing__error'),
    );
    expect(
      matching.length,
      'expected at least one `.viewer-landing__error` rule (small inline error pill on the landing page when parseSpecUrl returns an error).',
    ).toBeGreaterThan(0);
  });

  it('NONE of the new viewer-surface rules use raw hex literals (palette tokens only — required for dark-mode rebind)', () => {
    // Cross-cutting pin: every `.viewer-*` rule body must use
    // `var(--*)` tokens, never `#xxxxxx`. The brand palette
    // re-binds via `prefers-color-scheme: dark`; a hardcoded hex
    // bypasses the rebind and breaks dark mode. Pattern matches
    // the v0.2 broken-image AC4 test.
    const css = loadStyleCss();
    const viewerRules = rulesMatching(css, (r) =>
      r.selector.split(',').some((s) => /^\.viewer-/.test(s.trim())),
    );

    const offenders: { selector: string; hex: string[] }[] = [];
    for (const r of viewerRules) {
      const hits = r.body.match(HEX_RE);
      if (hits && hits.length > 0) {
        offenders.push({ selector: r.selector, hex: hits });
      }
    }
    expect(
      offenders,
      `expected NO raw hex colors in any .viewer-* rule body — use var(--*) brand tokens instead so dark-mode rebind works. Found: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});
