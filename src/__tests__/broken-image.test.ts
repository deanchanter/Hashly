import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  // Adversarial-review fixes (post-merge of slice 1, before milestone PR).
  // The slice 1 hook had four critical defects flagged by the reviewer pass:
  //   - Observer leak: each mountEditor call installed a fresh observer
  //     and never disconnected the previous one.
  //   - Empty-alt: `![](src)` decorative-image idiom rendered an empty
  //     pill (visible bordered surface with no text), worse than the OS
  //     glyph it replaced.
  //   - A11y: the fallback `<span>` carried no `role`/`aria-label`, so
  //     screen readers announced the alt text as if it were body prose.
  //   - Edit-mode: the swap happened outside ProseMirror's awareness, so
  //     in edit mode a user could type into the `<span>` and lose those
  //     keystrokes silently on save.
  // And one critical correctness defect:
  //   - Mixed-paragraph cleanup over-removed ProseMirror cursor anchors
  //     for unrelated working images sharing the same parent.
  // The tests below pin the fixes for each.

  it('AC5 (review fix — observer leak): re-mounting on the same host disconnects the previous broken-image observer', async () => {
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect');
    try {
      await mountEditor(host, '![first](/__one__.png)');
      const firstCount = disconnectSpy.mock.calls.length;
      await mountEditor(host, '![second](/__two__.png)');
      const secondCount = disconnectSpy.mock.calls.length;
      expect(
        secondCount,
        'expected `disconnect()` to be called at least once more on the second mountEditor call (the previous broken-image observer should be torn down to prevent leaks). Adversarial-review finding: every mountEditor call leaked a MutationObserver.',
      ).toBeGreaterThan(firstCount);
    } finally {
      disconnectSpy.mockRestore();
    }
  });

  it('AC6 (review fix — empty alt): `![](src)` decorative-image idiom does NOT render an empty fallback pill', async () => {
    const md = '![](/__broken__.png)';
    await mountEditor(host, md);

    const img = host.querySelector<HTMLImageElement>(
      '.ProseMirror img[src*="__broken__"]',
    );
    expect(
      img,
      'precondition: Milkdown rendered the empty-alt image as an <img>.',
    ).not.toBeNull();

    img!.dispatchEvent(new Event('error', { cancelable: false }));
    await Promise.resolve();
    await Promise.resolve();

    const span = host.querySelector('.hashly-broken-image');
    expect(
      span,
      'expected NO `.hashly-broken-image` element when the original alt is empty (review fix: empty alt = decorative image; surface no fallback pill). Found a span — the empty-alt path is rendering an empty bordered rectangle, the regression the reviewer flagged.',
    ).toBeNull();

    const lingering = host.querySelector(
      '.ProseMirror img[src*="__broken__"]',
    );
    expect(
      lingering,
      'expected the broken <img> with the empty alt to be removed entirely (no OS "?" glyph, no fallback pill — the image disappears).',
    ).toBeNull();
  });

  it('AC7 (review fix — a11y): the fallback span carries `role="img"` and `aria-label` with the alt text', async () => {
    await mountEditor(host, '![rocket diagram](/__broken__.png)');

    const img = host.querySelector<HTMLImageElement>('.ProseMirror img');
    img!.dispatchEvent(new Event('error', { cancelable: false }));
    await Promise.resolve();
    await Promise.resolve();

    const span = host.querySelector('.hashly-broken-image');
    expect(
      span,
      'precondition: the fallback span exists for non-empty alt.',
    ).not.toBeNull();
    expect(
      span!.getAttribute('role'),
      'expected `role="img"` on the fallback so assistive tech announces it as a graphic, not as inline body prose. Review finding: bare span lost the original <img alt> semantic.',
    ).toBe('img');
    expect(
      span!.getAttribute('aria-label'),
      'expected `aria-label` to carry the alt text so screen readers can announce the image\'s description even though the visual surface is the alt text itself.',
    ).toBe('rocket diagram');
  });

  it('AC8 (review fix — edit-mode): the fallback span is `contenteditable="false"` so keystrokes do not silently mutate it', async () => {
    await mountEditor(host, '![rocket diagram](/__broken__.png)');

    const img = host.querySelector<HTMLImageElement>('.ProseMirror img');
    img!.dispatchEvent(new Event('error', { cancelable: false }));
    await Promise.resolve();
    await Promise.resolve();

    const span = host.querySelector('.hashly-broken-image');
    expect(
      span!.getAttribute('contenteditable'),
      'expected `contenteditable="false"` on the fallback so the user cannot type into a span ProseMirror does not know about. Review finding: in edit mode the swap leaked outside PM\'s state, so user keystrokes inside the pill vanished on save with no warning.',
    ).toBe('false');
  });

  it('AC9 (review fix — mixed paragraph): cleanup preserves cursor separators adjacent to a WORKING <img> while removing those adjacent to the broken-image fallback', async () => {
    await mountEditor(host, '![bad](/__broken__.png)');

    const brokenImg = host.querySelector<HTMLImageElement>(
      '.ProseMirror img[src*="__broken__"]',
    );
    expect(
      brokenImg,
      'precondition: the broken image rendered.',
    ).not.toBeNull();

    const para = brokenImg!.parentElement!;

    // Simulate ProseMirror's runtime structure: a working image and its
    // cursor-anchor separator inserted into the same paragraph as the
    // broken image. jsdom does not run the ProseMirror view layer, so we
    // construct the structure manually — mirrors the runtime DOM the
    // reviewer's probe observed.
    const okImg = document.createElement('img');
    okImg.src = '/__ok__.png';
    okImg.alt = 'ok';
    const okSep = document.createElement('img');
    okSep.className = 'ProseMirror-separator';
    // Layout: <broken-img>, <ok-sep>, <ok-img>
    // okSep is adjacent to the working <img>, NOT to a broken-image span
    // (yet). After the swap, okSep should still survive because it is
    // not next to the new fallback span.
    para.appendChild(okSep);
    para.appendChild(okImg);

    brokenImg!.dispatchEvent(new Event('error', { cancelable: false }));
    await Promise.resolve();
    await Promise.resolve();

    const fallbackSpan = para.querySelector('.hashly-broken-image');
    expect(
      fallbackSpan,
      'precondition: the broken-image fallback span replaced the broken <img>.',
    ).not.toBeNull();

    const okImgAfter = para.querySelector('img[src="/__ok__.png"]');
    expect(
      okImgAfter,
      'expected the working <img> to survive the broken-image cleanup. Review finding: cleanScopedSeparators over-removed nodes adjacent to unrelated working images sharing the parent.',
    ).not.toBeNull();

    const survivingSeparators = Array.from(
      para.querySelectorAll<HTMLImageElement>(
        ':scope > .ProseMirror-separator',
      ),
    );
    // The separator next to the WORKING image must survive.
    const separatorAdjacentToWorkingImg = survivingSeparators.some((sep) => {
      const prev = sep.previousElementSibling;
      const next = sep.nextElementSibling;
      const isAdjacentToWorking =
        (prev && prev.tagName === 'IMG' && prev.getAttribute('src') === '/__ok__.png') ||
        (next && next.tagName === 'IMG' && next.getAttribute('src') === '/__ok__.png');
      return Boolean(isAdjacentToWorking);
    });
    expect(
      separatorAdjacentToWorkingImg,
      `expected at least one .ProseMirror-separator to survive next to the working <img>. Review finding: the cleanup currently strips every separator under the parent, breaking cursor handling for unrelated images. Surviving separators were: ${JSON.stringify(
        survivingSeparators.map((s) => ({
          prev: s.previousElementSibling?.tagName,
          next: s.nextElementSibling?.tagName,
        })),
      )}.`,
    ).toBe(true);
  });
});
