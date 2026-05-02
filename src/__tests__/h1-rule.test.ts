import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Issue #79 — H1 GitHub-style underline rule.
//
// Static-contract pattern (read style.css from disk + regex). Matches
// the v0.2.1 polish slices in table-rendering.test.ts, fenced-code.test.ts,
// and list-rhythm.test.ts.

function loadStyleCss(): string {
  return readFileSync(resolve(__dirname, '..', 'style.css'), 'utf-8');
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function joinedBodyFor(css: string, selector: string): string {
  const stripped = stripComments(css);
  const bodies: string[] = [];
  const ruleRegex = /([^{}]*)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRegex.exec(stripped)) !== null) {
    const selectorList = (m[1] ?? '').trim();
    if (selectorList.startsWith('@')) continue;
    const selectors = selectorList.split(',').map((s) => s.trim());
    if (selectors.some((s) => s === selector)) {
      bodies.push(m[2] ?? '');
    }
  }
  return bodies.join('\n');
}

function rulesTargetingSelector(
  css: string,
  selector: string,
): { selectorList: string; body: string }[] {
  const stripped = stripComments(css);
  const out: { selectorList: string; body: string }[] = [];
  const ruleRegex = /([^{}]*)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRegex.exec(stripped)) !== null) {
    const selectorList = (m[1] ?? '').trim();
    if (selectorList.startsWith('@')) continue;
    const selectors = selectorList.split(',').map((s) => s.trim());
    if (selectors.some((s) => s === selector)) {
      out.push({ selectorList, body: m[2] ?? '' });
    }
  }
  return out;
}

describe('Issue #79 — H1 GitHub-style underline rule', () => {
  it('AC1: `.ProseMirror h1` has `border-bottom: 1px solid var(--rule)`', () => {
    const body = joinedBodyFor(loadStyleCss(), '.ProseMirror h1');
    expect(
      body,
      'expected a CSS rule whose selector list includes `.ProseMirror h1` (issue #79: H1 needs a thin rule underneath, GitHub-style).',
    ).not.toBe('');
    expect(
      body,
      `expected the .ProseMirror h1 rule to declare \`border-bottom: 1px solid var(--rule)\` so the rule re-binds in dark mode through the brand palette. Joined rule body was:\n${body}`,
    ).toMatch(/border-bottom\s*:\s*1px\s+solid\s+var\(\s*--rule\s*\)/);
  });

  it('AC2: `.ProseMirror h1` has a `padding-bottom` declaration', () => {
    // Spec ranges 0.3rem with "tune in PR" — assert any non-zero rem
    // padding-bottom rather than pinning a magic number, so reviewers
    // can tune the value without breaking the test.
    const body = joinedBodyFor(loadStyleCss(), '.ProseMirror h1');
    expect(
      body,
      `expected the .ProseMirror h1 rule to declare a non-zero \`padding-bottom\` so the rule has breathing room beneath the heading text. Joined rule body was:\n${body}`,
    ).toMatch(/padding-bottom\s*:\s*0?\.[0-9]+rem\b/);
  });

  it('AC3: H2 and H3 are NOT given a border-bottom by this slice', () => {
    // Spec: "H2 / H3 are unchanged." Translate that into a contract:
    // no rule whose selector list targets `.ProseMirror h2` or
    // `.ProseMirror h3` declares a `border-bottom`.
    for (const heading of ['.ProseMirror h2', '.ProseMirror h3']) {
      const body = joinedBodyFor(loadStyleCss(), heading);
      expect(
        body,
        `expected NO border-bottom declaration in any rule targeting ${heading} (issue #79 spec: only H1 gets the line; H2/H3 unchanged so the heading hierarchy stays legible). Joined rule body was:\n${body}`,
      ).not.toMatch(/border-bottom\s*:/);
    }
  });

  it('AC4: the H1 underline rule lives in its own selector, not grouped with h2/h3', () => {
    // Defense-in-depth for AC3. If the H1 rules were grouped with h2/h3
    // (e.g. `.ProseMirror h1, .ProseMirror h2, .ProseMirror h3 { border-bottom: ... }`),
    // AC3 would also fail — but this assertion gives a clearer error
    // message about the grouping mistake. We assert: no rule whose
    // selector list contains BOTH `.ProseMirror h1` and `.ProseMirror h2`
    // declares a border-bottom.
    const h1Rules = rulesTargetingSelector(loadStyleCss(), '.ProseMirror h1');
    for (const { selectorList, body } of h1Rules) {
      const selectors = selectorList.split(',').map((s) => s.trim());
      if (
        selectors.includes('.ProseMirror h2') ||
        selectors.includes('.ProseMirror h3')
      ) {
        expect(
          body,
          `the rule \`${selectorList} { ... }\` groups h1 with h2 or h3 — must NOT declare border-bottom (issue #79 spec: only H1 gets the line). Body was:\n${body}`,
        ).not.toMatch(/border-bottom\s*:/);
      }
    }
  });

  it('AC5: no hardcoded hex colors in the .ProseMirror h1 rules', () => {
    const body = joinedBodyFor(loadStyleCss(), '.ProseMirror h1');
    const hex = body.match(/#[0-9a-fA-F]{3,8}\b/g);
    expect(
      hex,
      `expected NO hardcoded hex colors in any .ProseMirror h1 rule body (spec: "no new hardcoded hex values"). Found ${JSON.stringify(hex)} in joined bodies:\n${body}`,
    ).toBeNull();
  });
});
