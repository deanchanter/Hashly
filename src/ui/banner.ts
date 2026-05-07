// Issue #158 / AC 4.1 + 4.2 — Banner primitive.

export type BannerKind = 'info' | 'success' | 'warning' | 'error' | 'conflict';

export interface BannerAction {
  label: string;
  onClick: () => void;
}

export interface ShowBannerOpts {
  kind: BannerKind;
  message: string;
  action?: BannerAction;
  dismissible?: boolean;
}

export interface BannerHandle {
  element: HTMLElement;
  dismiss: () => void;
}

const ICON_BY_KIND: Record<BannerKind, string> = {
  info: 'i',
  success: '✓',
  warning: '!',
  error: '×',
  conflict: '!',
};

function roleFor(kind: BannerKind): 'status' | 'alert' {
  return kind === 'info' || kind === 'success' ? 'status' : 'alert';
}

export function showBanner(host: HTMLElement, opts: ShowBannerOpts): BannerHandle {
  const previouslyFocused =
    document.activeElement && document.activeElement !== document.body
      ? (document.activeElement as HTMLElement)
      : null;

  const el = document.createElement('div');
  el.setAttribute('role', roleFor(opts.kind));
  el.dataset.bannerKind = opts.kind;

  const icon = document.createElement('span');
  icon.setAttribute('data-testid', 'banner-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.style.marginRight = '0.5rem';
  icon.textContent = ICON_BY_KIND[opts.kind];
  el.appendChild(icon);

  const messageSpan = document.createElement('span');
  messageSpan.setAttribute('data-testid', 'banner-message');
  messageSpan.textContent = opts.message;
  el.appendChild(messageSpan);

  if (opts.action) {
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.setAttribute('data-testid', 'banner-action');
    actionBtn.textContent = opts.action.label;
    actionBtn.addEventListener('click', () => {
      opts.action!.onClick();
    });
    el.appendChild(actionBtn);
  }

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
    if (previouslyFocused && document.contains(previouslyFocused)) {
      try {
        previouslyFocused.focus();
      } catch {
        /* noop */
      }
    } else {
      try {
        host.focus();
      } catch {
        /* noop */
      }
    }
  };

  if (opts.dismissible) {
    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.setAttribute('data-testid', 'banner-dismiss');
    dismissBtn.setAttribute('aria-label', 'Dismiss');
    dismissBtn.textContent = '×';
    dismissBtn.addEventListener('click', () => {
      dismiss();
    });
    el.appendChild(dismissBtn);
  }

  host.appendChild(el);

  return {
    element: el,
    dismiss,
  };
}
