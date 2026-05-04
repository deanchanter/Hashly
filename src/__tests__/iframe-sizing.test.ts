import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Issue #90 / AC 4.8 — iframe-friendly rendering at viewport ≤600px.
//
// Per the team-lead: "the actual iframe test goes in the manual e2e
// checklist (issue #93 / 7.7); this AC is mostly a manual check —
// write a Vitest assertion that the body has no `min-width` greater
// than 600px and no horizontal overflow at viewport ≤600px".
//
// jsdom doesn't do real layout — `getBoundingClientRect` returns
// zeros and `scrollWidth` is unreliable — so we lean on
// static-contract analysis of `src/style.css`. The two pins:
//
//   1. No CSS rule on a top-level page container (`:root`, `html`,
//      `body`) sets `min-width` greater than 600px. Such a rule
//      would force a horizontal scrollbar inside any iframe sized
//      narrower than that minimum.
//
//   2. No CSS rule on a top-level page container OR on the visible
//      web-mode surfaces (`.viewer-landing`, `.viewer-header`,
//      `.viewer-error`) sets a fixed pixel `width` greater than
//      600px. Fixed widths break iframe embedding in the same way
//      as min-widths — the box can't shrink to the iframe's
//      column.
//
//   3. `#editor` uses `max-width` (which scales down) and NOT a
//      fixed `width`. The existing v0.2 `max-width: 720px` is fine
//      because content boxes shrink below the cap when the parent
//      is narrower; a fixed `width: 720px` would not.
//
// Pattern: same `loadStyleCss` + comment-stripping + selector-body
// extraction used in `h1-rule.test.ts` / `color-scheme.test.ts`.

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
    if (selector.startsWith('@')) continue; // skip @media wrappers — their inner rules will be picked up next iteration
    out.push({ selector, body: m[2] ?? '' });
  }
  return out;
}

// Convert a CSS length (px or rem) to a number of CSS pixels.
// Treats `1rem === 16px` (the browser default — the app does NOT
// override `font-size` on :root). Returns null for any value we
// can't statically reduce (e.g. percentages, calc()).
function lengthToPx(value: string): number | null {
  const trimmed = value.trim();
  const px = /^([\d.]+)\s*px$/.exec(trimmed);
  if (px) return parseFloat(px[1]!);
  const rem = /^([\d.]+)\s*rem$/.exec(trimmed);
  if (rem) return parseFloat(rem[1]!) * 16;
  return null;
}

function findDecl(body: string, prop: string): string | null {
  // Naïve declaration scanner — the v0.2 polish tests use the same
  // shape and have been stable. Returns the LAST declaration value
  // (cascade-equivalent within a single rule body).
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'gi');
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    last = (m[1] ?? '').trim();
  }
  return last;
}

const TOP_LEVEL_SELECTORS = [
  ':root',
  'html',
  'body',
  'html, body',
  'body, html',
];

const VIEWER_SURFACE_SELECTORS = [
  '.viewer-landing',
  '.viewer-header',
  '.viewer-error',
];

describe('Issue #90 / AC 4.8 — iframe-friendly rendering at viewport ≤600px', () => {
  it('no CSS rule on a top-level page container (:root / html / body) sets `min-width` > 600px', () => {
    // Pinned for regression: if a future CSS edit drops a
    // `min-width: 800px` on `body` (e.g. for "desktop comfort"),
    // every iframe embed at the v0.3 spec's 600px column would
    // start showing a horizontal scrollbar.
    const offenders: string[] = [];
    for (const r of rules(loadStyleCss())) {
      if (!TOP_LEVEL_SELECTORS.includes(r.selector)) continue;
      const minW = findDecl(r.body, 'min-width');
      if (minW === null) continue;
      const px = lengthToPx(minW);
      if (px !== null && px > 600) {
        offenders.push(`\`${r.selector} { min-width: ${minW}; }\` (= ${px}px)`);
      }
    }
    expect(
      offenders,
      `expected NO top-level container to have min-width > 600px (Issue #90 AC 4.8 — iframe at 600px would scrollbar). Found: ${offenders.join('; ')}`,
    ).toEqual([]);
  });

  it('no CSS rule on a top-level page container sets a fixed `width: <N>px` (or rem) > 600px', () => {
    // Fixed widths on body/html have the same iframe-breaking
    // effect as min-width, AND they prevent shrinking in WIDER
    // viewports too. Top-level containers should be `width: auto`
    // (default) or use `max-width`.
    const offenders: string[] = [];
    for (const r of rules(loadStyleCss())) {
      if (!TOP_LEVEL_SELECTORS.includes(r.selector)) continue;
      const w = findDecl(r.body, 'width');
      if (w === null) continue;
      const px = lengthToPx(w);
      if (px !== null && px > 600) {
        offenders.push(`\`${r.selector} { width: ${w}; }\` (= ${px}px)`);
      }
    }
    expect(
      offenders,
      `expected NO top-level container to have a fixed width > 600px (Issue #90 AC 4.8). Found: ${offenders.join('; ')}`,
    ).toEqual([]);
  });

  it('viewer surfaces (.viewer-landing, .viewer-header, .viewer-error) do not set a fixed `width: <N>px` > 600px', () => {
    // The web-mode surfaces ship with this issue. They must adapt
    // to a 600px iframe column from day one. A `max-width` cap is
    // fine (and encouraged for readable line length) — only fixed
    // pixel widths fail.
    const offenders: string[] = [];
    for (const r of rules(loadStyleCss())) {
      if (!VIEWER_SURFACE_SELECTORS.includes(r.selector)) continue;
      const w = findDecl(r.body, 'width');
      if (w === null) continue;
      const px = lengthToPx(w);
      if (px !== null && px > 600) {
        offenders.push(`\`${r.selector} { width: ${w}; }\` (= ${px}px)`);
      }
      const minW = findDecl(r.body, 'min-width');
      if (minW !== null) {
        const minPx = lengthToPx(minW);
        if (minPx !== null && minPx > 600) {
          offenders.push(`\`${r.selector} { min-width: ${minW}; }\` (= ${minPx}px)`);
        }
      }
    }
    expect(
      offenders,
      `expected viewer surfaces to NOT use width / min-width > 600px (Issue #90 AC 4.8 — must shrink to fit a 600px iframe). Found: ${offenders.join('; ')}`,
    ).toEqual([]);
  });

  it('`#editor` uses `max-width` (not a fixed `width`) so the editor column shrinks below its cap at narrow viewports', () => {
    // The v0.2 rule `#editor { max-width: 720px; ... }` is fine —
    // max-width clamps the cap but lets the box shrink below it.
    // A regression to `width: 720px` would force the editor to
    // 720px regardless of viewport, breaking the 600px iframe.
    // Pin the absence of a fixed width here so a misguided
    // refactor that "stops the editor from being too narrow"
    // can't ship.
    const editorRules = rules(loadStyleCss()).filter((r) => r.selector === '#editor');
    expect(
      editorRules.length,
      'expected at least one `#editor { ... }` rule in src/style.css',
    ).toBeGreaterThan(0);
    for (const r of editorRules) {
      const w = findDecl(r.body, 'width');
      if (w === null) continue;
      const px = lengthToPx(w);
      // A `width: 100%` (or auto) is fine — only fixed pixel widths
      // > 600px would prevent shrinking.
      if (px !== null && px > 600) {
        throw new Error(
          `\`#editor\` has a fixed width of ${w} (=${px}px); use \`max-width\` instead so the editor shrinks at narrow viewports (Issue #90 AC 4.8).`,
        );
      }
    }
  });

  it('rendering the viewer header and error surfaces in a 600px-wide container does not exceed the container width via inline styles', async () => {
    // A weak-but-real behavioral test: render the AC 4.5 header
    // and the AC 4.7 error surface inside a 600px container, then
    // verify NO descendant of either has an inline style setting
    // a fixed `width` greater than 600px. jsdom doesn't compute
    // real layout, but it does parse inline `style` attributes —
    // so a regression that hardcodes `style="width: 800px"` on
    // any element gets caught here.
    const { renderViewerHeader } = await import('../viewer-header');
    const { renderViewerError } = await import('../viewer-error');

    const container = document.createElement('div');
    container.style.width = '600px';
    document.body.innerHTML = '';
    document.body.appendChild(container);

    const headerHost = document.createElement('div');
    const errorHost = document.createElement('div');
    container.appendChild(headerHost);
    container.appendChild(errorHost);

    renderViewerHeader(headerHost, {
      repo: 'deanchanter/Hashly',
      path: 'specs/v0.3-web-pivot/spec.md',
      ref: 'main',
    });
    renderViewerError(errorHost, { ok: false, kind: 'not-found' });

    const allElements = container.querySelectorAll<HTMLElement>('*');
    const offenders: string[] = [];
    for (const el of Array.from(allElements)) {
      const w = el.style.width;
      if (!w) continue;
      const m = /^([\d.]+)\s*px$/.exec(w.trim());
      if (!m) continue;
      const px = parseFloat(m[1]!);
      if (px > 600) {
        offenders.push(
          `${el.tagName.toLowerCase()}.${el.className}[style="width:${w}"]`,
        );
      }
    }
    expect(
      offenders,
      `expected NO viewer-rendered element to carry an inline width > 600px (Issue #90 AC 4.8). Inline-style fixed widths break iframe embedding the same way CSS-rule widths do — neither is allowed. Found: ${offenders.join('; ')}`,
    ).toEqual([]);
  });
});
