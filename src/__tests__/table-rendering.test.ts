import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Issue #78 slice 2 — GFM table rendering polish.
//
// Pattern: static-contract assertions against src/style.css. jsdom does
// not apply Vite-imported CSS to computed styles (verified during slice
// 1 discovery), so the broken-image suite uses runtime DOM, but the
// remaining v0.2.1 slices (2–4 here, 5 in h1-rule.test.ts) only change
// CSS and have no JS impl, so a regex-against-style.css assertion is
// the right fit. Same pattern that edit-toggle.test.ts established.

function loadStyleCss(): string {
  return readFileSync(resolve(__dirname, '..', 'style.css'), 'utf-8');
}

// Strip CSS comments so example values inside `/* ... */` don't trip
// regex matches against rule bodies.
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Find the body of the FIRST rule whose selector list (whatever appears
// before `{`) contains `selector` as a substring. Returns null if no
// such rule exists. Substring match keeps the assertion tolerant to
// `.ProseMirror th, .ProseMirror td { ... }` style grouping.
function findRuleBodyContaining(css: string, selector: string): string | null {
  const stripped = stripComments(css);
  // Walk character by character to handle nested braces correctly.
  // CSS rules don't actually nest in the v0.2.1 stylesheet, but @media
  // does — and we explicitly want to match BOTH the :root rule and the
  // @media block's rules without falling into the @media block as a
  // single rule body.
  let i = 0;
  while (i < stripped.length) {
    const open = stripped.indexOf('{', i);
    if (open === -1) return null;
    const selectorList = stripped.slice(i, open);
    // Skip @media / @supports etc — they introduce a nested context.
    if (selectorList.trim().startsWith('@')) {
      // Step inside the @-rule and continue scanning rules within.
      i = open + 1;
      continue;
    }
    const close = stripped.indexOf('}', open);
    if (close === -1) return null;
    if (selectorList.includes(selector)) {
      return stripped.slice(open + 1, close);
    }
    i = close + 1;
  }
  return null;
}

describe('Issue #78 slice 2 — GFM table header borders + cell padding', () => {
  it('AC1: `.ProseMirror th` has a `border-bottom: 1px solid var(--rule)`', () => {
    const css = loadStyleCss();
    const body = findRuleBodyContaining(css, '.ProseMirror th');
    expect(
      body,
      'expected a CSS rule whose selector list includes `.ProseMirror th` (slice 2 AC: header columns must be unambiguously delimited).',
    ).not.toBeNull();
    expect(
      body!,
      `expected the .ProseMirror th rule to declare \`border-bottom: 1px solid var(--rule)\` so header columns get a visible separator that re-binds in dark mode. Rule body was:\n${body}`,
    ).toMatch(/border-bottom\s*:\s*1px\s+solid\s+var\(\s*--rule\s*\)/);
  });

  it('AC2: `.ProseMirror th, .ProseMirror td` share `padding: 0.5rem 0.75rem`', () => {
    const css = loadStyleCss();
    // Look for a rule that styles both th AND td. Most natural form is
    // `.ProseMirror th, .ProseMirror td { padding: ... }`. We accept
    // either ordering; what matters is one rule body covers both
    // selectors and declares the shared padding.
    const stripped = stripComments(css);
    const ruleMatch = stripped.match(
      /([^{}]*\.ProseMirror\s+t[hd][^{}]*\.ProseMirror\s+t[hd][^{}]*)\{([^}]*)\}/,
    );
    expect(
      ruleMatch,
      'expected a single rule whose selector list includes BOTH `.ProseMirror th` and `.ProseMirror td` (slice 2 AC: cells share padding so columns align).',
    ).not.toBeNull();
    const body = ruleMatch![2] ?? '';
    expect(
      body,
      `expected the shared th/td rule to declare \`padding: 0.5rem 0.75rem\`. Rule body was:\n${body}`,
    ).toMatch(/padding\s*:\s*0\.5rem\s+0\.75rem/);
  });

  it('AC3: `.ProseMirror td > p` and `.ProseMirror th > p` collapse paragraph margins to 0', () => {
    const css = loadStyleCss();
    const stripped = stripComments(css);
    // Match a rule whose selector list includes `td > p` and `th > p`
    // both nested under .ProseMirror. As with AC2, accept either ordering.
    const ruleMatch = stripped.match(
      /([^{}]*\.ProseMirror\s+t[hd]\s*>\s*p[^{}]*\.ProseMirror\s+t[hd]\s*>\s*p[^{}]*)\{([^}]*)\}/,
    );
    expect(
      ruleMatch,
      'expected a rule whose selector list includes BOTH `.ProseMirror td > p` and `.ProseMirror th > p` (slice 2 AC: paragraph margins inside cells collapse to 0 so row height tracks content).',
    ).not.toBeNull();
    const body = ruleMatch![2] ?? '';
    expect(
      body,
      `expected the td>p, th>p rule to declare \`margin: 0\`. Rule body was:\n${body}`,
    ).toMatch(/margin\s*:\s*0\b/);
  });

  it('AC4: no new hardcoded hex colors land in the table-rendering rules', () => {
    const css = loadStyleCss();
    const stripped = stripComments(css);
    // Pull every rule whose selector list mentions table elements under
    // .ProseMirror, then assert no hex colors anywhere in their bodies.
    const tableRules = [
      ...stripped.matchAll(
        /([^{}]*\.ProseMirror\s+(?:th|td)(?:\s*>\s*p)?[^{}]*)\{([^}]*)\}/g,
      ),
    ];
    expect(
      tableRules.length,
      'expected at least one rule targeting `.ProseMirror th` or `.ProseMirror td` (or their child `> p` variants) — without these, slice 2 has no impl.',
    ).toBeGreaterThan(0);
    for (const m of tableRules) {
      const body = m[2] ?? '';
      const hex = body.match(/#[0-9a-fA-F]{3,8}\b/g);
      expect(
        hex,
        `expected NO hardcoded hex colors in a .ProseMirror th/td rule body (spec: "no new hardcoded hex values"). Found ${JSON.stringify(hex)} in body:\n${body}`,
      ).toBeNull();
    }
  });
});
