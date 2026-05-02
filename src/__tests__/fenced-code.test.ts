import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Issue #78 slice 3 — fenced code block surface.
//
// Static-contract pattern (read style.css from disk + regex). See
// table-rendering.test.ts for the rationale; jsdom + Vite-imported CSS
// don't agree on computed styles.

function loadStyleCss(): string {
  return readFileSync(resolve(__dirname, '..', 'style.css'), 'utf-8');
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function collectRuleBodiesForSelector(
  css: string,
  selector: string,
): string[] {
  const stripped = stripComments(css);
  // Concatenate the bodies of every rule whose selector list includes
  // `selector` as a top-level entry. Multiple rules can target the
  // same selector (existing groupings + a dedicated rule); slice 3
  // adds a dedicated `.ProseMirror pre { ... }` rule alongside the
  // pre-existing `.ProseMirror code, .ProseMirror pre { font-family }`.
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
  return bodies;
}

function joinedBodyFor(css: string, selector: string): string {
  const bodies = collectRuleBodiesForSelector(css, selector);
  return bodies.join('\n');
}

describe('Issue #78 slice 3 — fenced code block surface (background + border)', () => {
  it('AC1: `.ProseMirror pre` renders on `var(--paper-2)` background', () => {
    const body = joinedBodyFor(loadStyleCss(), '.ProseMirror pre');
    expect(
      body,
      'expected at least one CSS rule whose selector list includes `.ProseMirror pre` (slice 3 AC: fenced code blocks need a distinct surface against the page).',
    ).not.toBe('');
    expect(
      body!,
      `expected the .ProseMirror pre rule to declare \`background: var(--paper-2)\`. Rule body was:\n${body}`,
    ).toMatch(/background\s*:\s*var\(\s*--paper-2\s*\)/);
  });

  it('AC2: `.ProseMirror pre` has `border: 1px solid var(--rule)`', () => {
    const body = joinedBodyFor(loadStyleCss(), '.ProseMirror pre');
    expect(body, 'expected a `.ProseMirror pre` rule').not.toBe('');
    expect(
      body,
      `expected the .ProseMirror pre rule to declare \`border: 1px solid var(--rule)\` so the surface is delimited from the page in both light and dark modes. Rule body was:\n${body}`,
    ).toMatch(/border\s*:\s*1px\s+solid\s+var\(\s*--rule\s*\)/);
  });

  it('AC3: `.ProseMirror pre` has `border-radius: 6px`', () => {
    const body = joinedBodyFor(loadStyleCss(), '.ProseMirror pre');
    expect(body, 'expected a `.ProseMirror pre` rule').not.toBe('');
    expect(
      body,
      `expected the .ProseMirror pre rule to declare \`border-radius: 6px\` (slice 3 spec). Rule body was:\n${body}`,
    ).toMatch(/border-radius\s*:\s*6px\b/);
  });

  it('AC4: `.ProseMirror pre` has `padding: 0.75rem 1rem`', () => {
    const body = joinedBodyFor(loadStyleCss(), '.ProseMirror pre');
    expect(body, 'expected a `.ProseMirror pre` rule').not.toBe('');
    expect(
      body,
      `expected the .ProseMirror pre rule to declare \`padding: 0.75rem 1rem\` (slice 3 spec). Rule body was:\n${body}`,
    ).toMatch(/padding\s*:\s*0\.75rem\s+1rem\b/);
  });

  it('AC5: no hardcoded hex colors in the .ProseMirror pre rules', () => {
    const body = joinedBodyFor(loadStyleCss(), '.ProseMirror pre');
    expect(body, 'expected a `.ProseMirror pre` rule').not.toBe('');
    const hex = body.match(/#[0-9a-fA-F]{3,8}\b/g);
    expect(
      hex,
      `expected NO hardcoded hex colors in any .ProseMirror pre rule body (spec: "no new hardcoded hex values"). Found ${JSON.stringify(hex)} in joined bodies:\n${body}`,
    ).toBeNull();
  });

  it('AC6: inline `.ProseMirror code` keeps its existing treatment (only the fenced surface changes)', () => {
    // Spec: "Inline code retains current treatment — only the fenced
    // surface changes." Inline code lives at `.ProseMirror code` — and
    // the v0.2 stylesheet groups it with `.ProseMirror pre` for
    // `font-family: var(--font-mono)`. Slice 3 must NOT introduce a
    // standalone `.ProseMirror code` rule that adds a background or
    // border to inline code. We assert that any rule matching the
    // exact selector `.ProseMirror code` (NOT grouped with `pre`)
    // contains no background-color or border declarations.
    const css = stripComments(loadStyleCss());
    const ruleRegex = /([^{}]*)\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRegex.exec(css)) !== null) {
      const selectorList = (m[1] ?? '').trim();
      if (selectorList.startsWith('@')) continue;
      const selectors = selectorList.split(',').map((s) => s.trim());
      // Match an inline-code-only rule: contains `.ProseMirror code`
      // and does NOT also contain `.ProseMirror pre`.
      const hasInlineCode = selectors.includes('.ProseMirror code');
      const hasPre = selectors.includes('.ProseMirror pre');
      if (hasInlineCode && !hasPre) {
        const body = m[2] ?? '';
        expect(
          body,
          `the standalone .ProseMirror code rule must not introduce inline-code styling (slice 3 spec: only the fenced surface changes). Rule body was:\n${body}`,
        ).not.toMatch(/background|border\s*:/);
      }
    }
  });
});
