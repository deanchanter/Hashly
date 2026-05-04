// Issue #78 slice 1 — broken-image alt-text fallback. Extracted from
// `src/main.ts` so the web-mode `mountViewer` (Issue #90 fix #5) can
// reuse it without dragging in the Tauri-coupled module surface.
//
// CSS has no broken-image pseudo-class. The state is observable only
// from JS via the <img>'s `error` event (or `img.complete &&
// img.naturalWidth === 0` for already-failed loads). We attach an
// `error` listener to every <img> Milkdown inserts into the editor's
// .ProseMirror tree; on failure we replace the <img> with a
// <span class="hashly-broken-image">{alt}</span> so the OS "?" glyph
// is gone and the alt text becomes the visible (and a11y-readable)
// fallback. The class is the stable hook for the CSS surface.
//
// Observers are tracked per host so each `mountEditor` / `mountViewer`
// call disconnects the previous one (otherwise every remount leaks one
// MutationObserver, flagged by the adversarial review).

const HASHLY_BROKEN_IMAGE_OBSERVERS = new WeakMap<
  HTMLElement,
  MutationObserver
>();

export function installBrokenImageFallback(host: HTMLElement): void {
  // Disconnect any observer left over from a previous mountEditor call
  // on the same host so the observer count stays bounded across edit
  // toggles, file opens, and template inserts.
  HASHLY_BROKEN_IMAGE_OBSERVERS.get(host)?.disconnect();

  const replaceWithFallback = (img: HTMLImageElement): void => {
    const parent = img.parentNode;
    if (!parent) return;
    const alt = img.getAttribute('alt') ?? '';
    // Empty-alt is the markdown decorative-image idiom (`![](src)`).
    // The image is intentionally invisible to assistive tech, so the
    // fallback should be invisible too — no empty pill, no semantic
    // signal. Just drop the broken <img>.
    if (alt === '') {
      parent.removeChild(img);
      return;
    }
    const span = document.createElement('span');
    span.className = 'hashly-broken-image';
    span.textContent = alt;
    // Accessibility: the fallback stands in for an <img alt="...">, so
    // it must be announced as a graphic with the alt as the accessible
    // name. Without these attributes, a screen reader treats the alt
    // text as inline body prose.
    span.setAttribute('role', 'img');
    span.setAttribute('aria-label', alt);
    // Edit-mode safety: the swap happens outside ProseMirror's awareness,
    // so making the span editable would let user keystrokes mutate the
    // DOM in a region PM does not track — those edits would vanish on
    // save (serializer reads from `state.doc`, not the DOM).
    span.setAttribute('contenteditable', 'false');
    parent.replaceChild(span, img);
  };
  // After we replace a broken `<img>` with our `<span>`, ProseMirror's
  // view layer notices the inline-atom node was removed from the
  // paragraph and re-inserts an `<img class="ProseMirror-separator">`
  // synthetic cursor anchor next to the span. AC2 ("OS '?' glyph cannot
  // appear") requires NO `<img>` to remain adjacent to our fallback.
  // We strip ONLY the separators that sit immediately next to a
  // `.hashly-broken-image` span — separators next to working images
  // elsewhere in the same paragraph must survive (mixed paragraphs
  // were previously losing cursor anchors on unrelated images).
  const cleanScopedSeparators = (parent: ParentNode): void => {
    parent.querySelectorAll(':scope > .ProseMirror-separator').forEach((node) => {
      const prev = node.previousElementSibling;
      const next = node.nextElementSibling;
      const adjacentToFallback =
        (prev !== null &&
          (prev as Element).classList?.contains('hashly-broken-image')) ||
        (next !== null &&
          (next as Element).classList?.contains('hashly-broken-image'));
      if (adjacentToFallback) {
        node.remove();
      }
    });
  };
  const replaceWithFallbackAndCleanup = (img: HTMLImageElement): void => {
    const parent = img.parentNode;
    if (!parent) return;
    replaceWithFallback(img);
    if ((parent as ParentNode).querySelectorAll) {
      cleanScopedSeparators(parent as ParentNode);
    }
  };
  const handleImg = (img: HTMLImageElement): void => {
    // Skip ProseMirror's own separator imgs — they're view-layer
    // artifacts, not user content. We'll prune them post-replacement
    // (scoped to the broken-image's parent) when they appear there.
    if (img.classList.contains('ProseMirror-separator')) return;
    // Synchronously broken (image already failed before we wired it).
    if (img.complete && img.naturalWidth === 0 && img.src) {
      replaceWithFallbackAndCleanup(img);
      return;
    }
    img.addEventListener(
      'error',
      () => replaceWithFallbackAndCleanup(img),
      { once: true },
    );
  };
  host.querySelectorAll('img').forEach((img) => handleImg(img as HTMLImageElement));
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
        const el = node as Element;
        if (el.tagName === 'IMG') {
          handleImg(el as HTMLImageElement);
        } else {
          el.querySelectorAll('img').forEach((img) =>
            handleImg(img as HTMLImageElement),
          );
        }
      });
      // Also clean separators that ProseMirror re-inserts as siblings
      // to our fallback span after the initial replacement. The
      // adjacency filter inside `cleanScopedSeparators` keeps anchors
      // around unrelated working images intact.
      m.target.parentElement
        ?.querySelectorAll('.hashly-broken-image')
        .forEach((span) => {
          const p = span.parentNode as ParentNode | null;
          if (p) cleanScopedSeparators(p);
        });
    }
  });
  observer.observe(host, { childList: true, subtree: true });
  HASHLY_BROKEN_IMAGE_OBSERVERS.set(host, observer);
}
