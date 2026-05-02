import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mountEditor } from '../main';

// Issue #78 slice 1 — broken-image alt-text fallback.
//
// DISCOVERY DECISION (CSS-only impossible; small JS hook required):
//
// There is NO native CSS pseudo-class for the broken-image state.
// `img:broken` is not part of the CSS spec; `img:not([naturalWidth])`
// only matches the absence of an HTML attribute (which `naturalWidth`
// is not — it's a runtime IDL property); attribute selectors cannot
// observe runtime image state at all. The broken-image state is
// reachable from JS only, via `img.complete && img.naturalWidth === 0`
// or the `error` event on the <img>.
//
// Therefore the implementation must be a small JS hook in src/main.ts:
//
//   - A MutationObserver on the editor root attaches an `error` listener
//     to every <img> as it's inserted into the .ProseMirror tree.
//   - On `error` (or synchronously, if the img is already broken at
//     insertion time), the hook replaces the <img> with a
//     `<span class="hashly-broken-image">{alt}</span>` so:
//       (a) the alt text is visible to the reader (AC1, this file),
//       (b) the OS "?" glyph is gone because the <img> no longer exists
//           in the rendered DOM (AC2, separate test).
//
// jsdom does NOT actually load images (no network), so these tests
// simulate the browser's failure path by dispatching an `error` event
// on the <img> after mount. That's the same DOM event a real browser
// fires when an <img> 404s — exercising the production hook exactly.

describe('Issue #78 slice 1 — broken-image alt-text fallback', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('AC1: surfaces the alt text inside the editor body after the <img> errors', async () => {
    // Mount with a markdown image whose src will fail. We manually fire
    // the `error` event below — jsdom won't do it for us.
    const md = '![rocket diagram](/__broken__.png)';
    await mountEditor(host, md);

    const img = host.querySelector<HTMLImageElement>('.ProseMirror img');
    expect(
      img,
      'precondition: Milkdown must render `![alt](src)` as an <img> inside .ProseMirror — without that, the broken-image hook has nothing to listen to.',
    ).not.toBeNull();
    expect(
      img!.getAttribute('alt'),
      'precondition: the rendered <img> must carry the alt attribute from the markdown source so the fallback has something to surface.',
    ).toBe('rocket diagram');

    // Simulate the browser's failed-load event. The hook should react
    // and replace the <img> with a visible alt-text fallback.
    img!.dispatchEvent(new Event('error', { cancelable: false }));

    // Allow microtasks (and a MutationObserver callback, which fires
    // on a microtask) to settle before assertions.
    await Promise.resolve();
    await Promise.resolve();

    // Contract: a `.hashly-broken-image` element exists in the rendered
    // DOM and contains the alt text. The class is the stable hook the
    // CSS uses (`color: var(--ink-2)`, `background: var(--paper-2)`)
    // and what reviewers grep for to find the fallback's visual surface.
    const fallback = host.querySelector('.hashly-broken-image');
    expect(
      fallback,
      'expected a `.hashly-broken-image` element after the <img> errored. Without this, the OS "?" glyph is what the reader sees — the regression Issue #78 slice 1 closes.',
    ).not.toBeNull();
    expect(
      fallback!.textContent ?? '',
      'expected the `.hashly-broken-image` element to contain the alt text "rocket diagram" so the reader (and assistive tech) can see the description of the missing image.',
    ).toContain('rocket diagram');
  });

  it('AC2: removes the original broken <img> from the rendered DOM so the OS "?" glyph cannot appear', async () => {
    // AC2 of slice 1: "OS / browser broken-image glyph does not appear."
    // The cleanest way to guarantee that across browsers is to remove the
    // <img> element from the DOM entirely once it errors — no <img>, no
    // OS '?' glyph. The fallback `<span class="hashly-broken-image">`
    // takes its place (pinned by AC1).
    //
    // Selector scope: we ignore `.ProseMirror-separator` widgets — those
    // are inline placeholder <img>s ProseMirror inserts for cursor
    // positioning, with `alt=""` and a near-empty src; they are NOT a
    // user-visible image and never trigger the OS broken glyph. The AC
    // is about the user's CONTENT image — the one the markdown source
    // wrote, with the user-supplied alt + src — surviving past its
    // error event. We pin that scope by filtering on the src attribute.
    //
    // Note: the spec lists "or sets a CSS class on the parent so a
    // ::after content-attr rule kicks in" as an alternative. That
    // alternative does NOT satisfy this AC under any browser — `<img>` is
    // an HTML void element, so `img::after` generates no content (per
    // CSS spec), and styling the surviving <img> with `display: none`
    // costs us the chance to surface the alt text on the same node.
    // The cleanest impl is the swap, and that's what we pin here.
    const md = '![rocket diagram](/__broken__.png)';
    await mountEditor(host, md);

    const img = host.querySelector<HTMLImageElement>('.ProseMirror img[src*="__broken__"]');
    expect(
      img,
      'precondition: Milkdown rendered an <img> with the broken src ("/__broken__.png"). If this fails, Milkdown changed how it renders the image node.',
    ).not.toBeNull();

    img!.dispatchEvent(new Event('error', { cancelable: false }));

    // Allow microtasks / MutationObserver callbacks to settle.
    await Promise.resolve();
    await Promise.resolve();

    const lingeringContentImg = host.querySelector(
      '.ProseMirror img[src*="__broken__"]',
    );
    expect(
      lingeringContentImg,
      'expected NO content <img> with the broken src to remain inside .ProseMirror after the error event (Issue #78 slice 1 AC2 — the OS "?" glyph must not appear). The broken-image hook must REMOVE the <img>, not just style it.',
    ).toBeNull();

    // Defense-in-depth: also assert no <img> with a non-empty alt
    // attribute remains. ProseMirror's internal separator widgets carry
    // alt="" so this filter excludes them; any user-content image that
    // survived the swap would have its alt populated.
    const lingeringWithAlt = Array.from(
      host.querySelectorAll<HTMLImageElement>('.ProseMirror img'),
    ).filter((el) => (el.getAttribute('alt') ?? '').length > 0);
    expect(
      lingeringWithAlt,
      `expected NO <img> with a non-empty alt to remain inside .ProseMirror after the error event. Found: ${JSON.stringify(
        lingeringWithAlt.map((el) => ({
          src: el.getAttribute('src'),
          alt: el.getAttribute('alt'),
        })),
      )}.`,
    ).toEqual([]);
  });

  it('AC4: the .hashly-broken-image fallback styles route through brand vars only (no new hex)', () => {
    // AC4 of slice 1: "Works in both light and dark modes (palette via
    // `var(--ink-2)` / `var(--paper-2)`)." The runtime DOM cannot easily
    // assert palette correctness (jsdom does not apply Vite-imported
    // CSS to computed styles — verified by probe). Static-contract
    // assertion against src/style.css is the established pattern in
    // this repo (see src/__tests__/edit-toggle.test.ts:812 for prior
    // art and the rationale comment).
    //
    // We assert that:
    //   1. A `.hashly-broken-image` rule exists in src/style.css.
    //   2. The rule body references `var(--ink-2)` AND `var(--paper-2)`
    //      (the two palette tokens the spec calls out).
    //   3. The rule body contains NO raw hex literals (any `#xxxxxx` or
    //      `#xxx` would mean a contributor introduced a hardcoded color
    //      instead of routing through the brand system).
    const css = readFileSync(resolve(__dirname, '..', 'style.css'), 'utf-8');

    // Strip CSS comments so a `/* #aabbcc */` example doesn't trip the
    // hex check. Pattern lifted from edit-toggle.test.ts.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

    // Find the `.hashly-broken-image { ... }` block. The selector may
    // appear bare or compounded with `.ProseMirror`, and the block may
    // span multiple lines, so scan with a non-greedy match for the
    // first `{ ... }` after the selector.
    const ruleMatch = stripped.match(/\.hashly-broken-image[^{]*\{([^}]*)\}/);
    expect(
      ruleMatch,
      'expected a `.hashly-broken-image` rule block in src/style.css (Issue #78 slice 1 AC4 — fallback must have its own styled surface). Looked for `.hashly-broken-image { ... }` (optionally compounded with .ProseMirror).',
    ).not.toBeNull();

    const body = ruleMatch![1] ?? '';

    expect(
      body,
      `expected the .hashly-broken-image rule body to reference \`var(--ink-2)\` (slice 1 AC4 — the fallback text must use a palette token that re-binds in dark mode). Rule body was:\n${body}`,
    ).toMatch(/var\(\s*--ink-2\s*\)/);

    expect(
      body,
      `expected the .hashly-broken-image rule body to reference \`var(--paper-2)\` (slice 1 AC4 — the fallback surface must use a palette token that re-binds in dark mode). Rule body was:\n${body}`,
    ).toMatch(/var\(\s*--paper-2\s*\)/);

    // No hardcoded hex colors. Match `#` followed by 3, 4, 6, or 8 hex
    // digits — covers `#fff`, `#ffff`, `#ffffff`, `#ffffffff`. Excludes
    // CSS id-selector `#editor` style bodies because we already scoped
    // to the rule body, and bodies can't contain selectors.
    const hexHits = body.match(/#[0-9a-fA-F]{3,8}\b/g);
    expect(
      hexHits,
      `expected NO hardcoded hex colors in the .hashly-broken-image rule (slice 1 AC4 + spec "no new hardcoded hex values"). Found: ${JSON.stringify(hexHits)}. Use \`var(--*)\` brand tokens instead.`,
    ).toBeNull();
  });
});
