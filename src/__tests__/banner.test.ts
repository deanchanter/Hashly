import { describe, it, expect, beforeEach } from 'vitest';

// Issue #158 / AC 4.1 + 4.2 — Banner primitive.
//
// `src/ui/banner.ts` exports `showBanner(host, opts)` returning a handle
// with `{ element, dismiss }`. The primitive owns:
//   - ARIA semantics per kind:
//       * info / success → role="status"
//       * error / conflict / warning → role="alert"
//   - Optional action button (label + onClick).
//   - Optional dismiss control. Clicking dismiss removes the banner
//     from the DOM and returns focus to a sensible target — the
//     element that had focus before `showBanner` was called (if any),
//     otherwise the host.
//   - An icon span at the leading edge with aria-hidden="true" so the
//     glyph is decorative (the message text carries the meaning) and
//     `margin-right` so the icon visually separates from the message
//     (#117).
//
// Pinned test surface so the builder cannot reinvent the API in
// save-flow / edit-mode / viewer-error: every consumer flows through
// `showBanner`.

import { showBanner, type BannerKind } from '../ui/banner';

describe('Issue #158 / AC 4.1 — banner primitive', () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  describe('ARIA role per kind (AC 4.2)', () => {
    const statusKinds: BannerKind[] = ['info', 'success'];
    const alertKinds: BannerKind[] = ['error', 'conflict', 'warning'];

    for (const kind of statusKinds) {
      it(`kind="${kind}" carries role="status"`, () => {
        const handle = showBanner(host, { kind, message: 'hello' });
        expect(
          handle.element.getAttribute('role'),
          `kind=${kind} must use role="status" (non-interruptive). Got: ${JSON.stringify(handle.element.getAttribute('role'))}`,
        ).toBe('status');
      });
    }

    for (const kind of alertKinds) {
      it(`kind="${kind}" carries role="alert"`, () => {
        const handle = showBanner(host, { kind, message: 'hello' });
        expect(
          handle.element.getAttribute('role'),
          `kind=${kind} must use role="alert" (interrupts AT). Got: ${JSON.stringify(handle.element.getAttribute('role'))}`,
        ).toBe('alert');
      });
    }
  });

  describe('rendering basics', () => {
    it('appends the banner to the host so it is in-DOM after the call', () => {
      const handle = showBanner(host, { kind: 'info', message: 'hi' });
      expect(handle.element.isConnected, 'banner element must be in the DOM').toBe(true);
      expect(host.contains(handle.element), 'banner must be inside the host element').toBe(true);
    });

    it('renders the message text inside the banner', () => {
      const handle = showBanner(host, { kind: 'info', message: 'a precise message' });
      expect(handle.element.textContent ?? '').toContain('a precise message');
    });

    it('includes a leading icon element with aria-hidden="true" and non-empty margin-right (#117)', () => {
      const handle = showBanner(host, { kind: 'success', message: 'done' });
      const icon = handle.element.querySelector<HTMLElement>('[data-testid="banner-icon"]');
      expect(icon, 'every banner must include a [data-testid="banner-icon"] span').not.toBeNull();
      expect(
        icon!.getAttribute('aria-hidden'),
        'icon must be aria-hidden="true" (decorative; message text carries meaning)',
      ).toBe('true');
      // #117 — icon needs visual separation from the message text. We
      // pin a non-empty `margin-right` (set via inline style or CSS
      // module on `.style.marginRight`); jsdom will read inline style
      // but does not compute imported CSS, so the builder must set
      // this inline OR via element.style for the test to see it.
      expect(
        icon!.style.marginRight,
        '#117 — icon must carry a non-empty margin-right (inline style) to visually separate from message text',
      ).not.toBe('');
    });
  });

  describe('dismiss control', () => {
    it('when dismissible: true, renders a control with [data-testid="banner-dismiss"]', () => {
      const handle = showBanner(host, {
        kind: 'info',
        message: 'm',
        dismissible: true,
      });
      const dismissBtn = handle.element.querySelector<HTMLElement>(
        '[data-testid="banner-dismiss"]',
      );
      expect(dismissBtn, 'dismissible banner must expose a dismiss control').not.toBeNull();
    });

    it('when dismissible: false (or omitted), does NOT render a dismiss control', () => {
      const h1 = showBanner(host, { kind: 'info', message: 'm' });
      const h2 = showBanner(host, { kind: 'info', message: 'm', dismissible: false });
      expect(
        h1.element.querySelector('[data-testid="banner-dismiss"]'),
        'omitted dismissible must NOT render a dismiss control (default off)',
      ).toBeNull();
      expect(
        h2.element.querySelector('[data-testid="banner-dismiss"]'),
        'dismissible:false must NOT render a dismiss control',
      ).toBeNull();
    });

    it('clicking dismiss removes the banner from the DOM', () => {
      const handle = showBanner(host, {
        kind: 'info',
        message: 'm',
        dismissible: true,
      });
      const dismissBtn = handle.element.querySelector<HTMLButtonElement>(
        '[data-testid="banner-dismiss"]',
      )!;
      expect(handle.element.isConnected).toBe(true);
      dismissBtn.click();
      expect(
        handle.element.isConnected,
        'banner must be removed from the DOM after dismiss click',
      ).toBe(false);
    });

    it('handle.dismiss() (programmatic) also removes the banner', () => {
      const handle = showBanner(host, { kind: 'info', message: 'm', dismissible: true });
      handle.dismiss();
      expect(handle.element.isConnected).toBe(false);
    });

    it('dismiss is idempotent — calling twice does not throw', () => {
      const handle = showBanner(host, { kind: 'info', message: 'm', dismissible: true });
      handle.dismiss();
      expect(() => handle.dismiss()).not.toThrow();
    });

    it('dismiss returns focus to the element that had focus before showBanner was called', () => {
      // "Sensible target" — preserve the user's focus context. Without
      // this, dismissing a save-flow banner would leave focus on
      // <body>, kicking sighted-keyboard / SR users out of their
      // editor context.
      const editor = document.createElement('button');
      editor.textContent = 'editor surrogate';
      document.body.appendChild(editor);
      editor.focus();
      expect(document.activeElement).toBe(editor);

      const handle = showBanner(host, { kind: 'info', message: 'm', dismissible: true });
      handle.dismiss();
      expect(
        document.activeElement,
        'focus must return to the element that was active before showBanner — got: ' +
          ((document.activeElement as HTMLElement | null)?.tagName ?? 'null'),
      ).toBe(editor);
    });

    it('when no element had focus before showBanner, dismiss focuses the host', () => {
      // Defensive fallback. If the builder cannot identify a previous
      // target (document.activeElement === document.body), the host
      // is a reasonable destination so focus stays in the surface
      // that owns the banner.
      (document.activeElement as HTMLElement | null)?.blur();
      // host must be focusable to receive focus deterministically.
      host.tabIndex = -1;
      const handle = showBanner(host, { kind: 'info', message: 'm', dismissible: true });
      handle.dismiss();
      expect(
        document.activeElement,
        'with no prior focus, dismiss should focus the host as fallback',
      ).toBe(host);
    });
  });

  describe('action callback (AC 4.2)', () => {
    it('renders an action button with the given label when action is provided', () => {
      const handle = showBanner(host, {
        kind: 'warning',
        message: 'm',
        action: { label: 'Retry', onClick: () => {} },
      });
      const btn = handle.element.querySelector<HTMLButtonElement>(
        '[data-testid="banner-action"]',
      );
      expect(btn, 'action button must exist when action is provided').not.toBeNull();
      expect(btn!.textContent ?? '').toContain('Retry');
    });

    it('clicking the action button invokes action.onClick exactly once', () => {
      let calls = 0;
      const handle = showBanner(host, {
        kind: 'warning',
        message: 'm',
        action: { label: 'Retry', onClick: () => { calls += 1; } },
      });
      const btn = handle.element.querySelector<HTMLButtonElement>(
        '[data-testid="banner-action"]',
      )!;
      btn.click();
      expect(calls).toBe(1);
    });

    it('omitting action does NOT render an action button', () => {
      const handle = showBanner(host, { kind: 'info', message: 'm' });
      expect(
        handle.element.querySelector('[data-testid="banner-action"]'),
        'no action means no action button',
      ).toBeNull();
    });
  });
});
