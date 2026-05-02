import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Issue #78 slice 4 — list item rhythm.
//
// Static-contract pattern (read style.css from disk + regex). Same
// rationale as table-rendering.test.ts and fenced-code.test.ts.

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

describe('Issue #78 slice 4 — list item rhythm', () => {
  it('AC1: `.ProseMirror li > p` collapses paragraph margins to 0', () => {
    const body = joinedBodyFor(loadStyleCss(), '.ProseMirror li > p');
    expect(
      body,
      'expected a CSS rule whose selector list includes `.ProseMirror li > p` (slice 4 AC: list items must have paragraph-equivalent rhythm, not double).',
    ).not.toBe('');
    expect(
      body,
      `expected the .ProseMirror li > p rule to declare \`margin: 0\`. Rule body was:\n${body}`,
    ).toMatch(/margin\s*:\s*0\b/);
  });

  it('AC2: `.ProseMirror li` has `margin: 0.25rem 0`', () => {
    const body = joinedBodyFor(loadStyleCss(), '.ProseMirror li');
    expect(
      body,
      'expected a CSS rule whose selector list includes `.ProseMirror li` (slice 4 AC: tune item spacing to match paragraph rhythm).',
    ).not.toBe('');
    expect(
      body,
      `expected the .ProseMirror li rule to declare \`margin: 0.25rem 0\`. Rule body was:\n${body}`,
    ).toMatch(/margin\s*:\s*0\.25rem\s+0\b/);
  });

  it('AC3: no hardcoded hex colors in the list rules', () => {
    const liBody = joinedBodyFor(loadStyleCss(), '.ProseMirror li');
    const liPBody = joinedBodyFor(loadStyleCss(), '.ProseMirror li > p');
    const combined = `${liBody}\n${liPBody}`;
    const hex = combined.match(/#[0-9a-fA-F]{3,8}\b/g);
    expect(
      hex,
      `expected NO hardcoded hex colors in the list rules (spec: "no new hardcoded hex values"). Found ${JSON.stringify(hex)} in joined bodies:\n${combined}`,
    ).toBeNull();
  });
});
