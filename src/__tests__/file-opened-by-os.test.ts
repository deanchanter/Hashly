import { describe, it, expect, beforeEach, vi } from 'vitest';

// Issue #5 — Finder double-click → reading view (slice 4 / v0.2).
//
// Rust emits a `file-opened-by-os` event with the file path string when
// macOS hands an `NSApplication openURLs:` to the Tauri run-loop (see
// src-tauri/tests/run_event_opened.rs for the Rust-side pin). The
// frontend listens for that event in `bootstrap()` and routes each
// path through `invoke('read_md_file', { path })` → `handleFileOpened`,
// landing the user in the reading view (same flow as File > Open).
//
// Event-name pin: the literal `file-opened-by-os` is the contract
// between Rust and main.ts; the Rust test pins the same string.
//
// Tests pin:
//   1. bootstrap() registers a listener for `file-opened-by-os`.
//   2. The listener calls invoke('read_md_file', { path }) with the
//      payload's path.
//   3. On invoke success, handleFileOpened is invoked → editor mounts.
//   4. On invoke rejection (e.g. bidi-unsafe / non-UTF-8 path), the
//      error path renders the friendly file-error surface (no crash).

describe('Issue #5 — `file-opened-by-os` event listener routes through read_md_file', () => {
  let host: HTMLDivElement;
  let listenHandlers: Record<string, (event: { payload: unknown }) => void>;

  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/api/window');
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
    listenHandlers = {};
  });

  it('bootstrap() registers a `file-opened-by-os` listener', async () => {
    // The pin is on the literal event name. A regression that renames
    // either side without updating the other (Rust emits "X", frontend
    // listens for "Y") would result in a silent no-op at runtime.
    const listenMock = vi.fn(async (eventName: string, handler: (e: { payload: unknown }) => void) => {
      listenHandlers[eventName] = handler;
      return () => {};
    });
    vi.doMock('@tauri-apps/api/event', () => ({ listen: listenMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));

    const { bootstrap } = (await import('../main')) as unknown as { bootstrap: () => void };
    bootstrap();
    await new Promise((r) => setTimeout(r, 50));

    expect(
      Object.keys(listenHandlers),
      `expected bootstrap() to register a listener for the literal event name "file-opened-by-os" (Issue #5 — Rust emits this string from RunEvent::Opened). Listeners installed: ${JSON.stringify(Object.keys(listenHandlers))}`,
    ).toContain('file-opened-by-os');

    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/core');
  });

  it('receiving a `file-opened-by-os` event with a path string invokes read_md_file with that path', async () => {
    const invokeMock = vi.fn(async (cmd: string, args: unknown) => {
      if (cmd === 'read_md_file') {
        return {
          path: (args as { path: string }).path,
          name: 'opened.md',
          content: '# Opened from Finder\n',
        };
      }
      return undefined;
    });
    const listenMock = vi.fn(async (eventName: string, handler: (e: { payload: unknown }) => void) => {
      listenHandlers[eventName] = handler;
      return () => {};
    });
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: listenMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));

    const { bootstrap } = (await import('../main')) as unknown as { bootstrap: () => void };
    bootstrap();
    await new Promise((r) => setTimeout(r, 80));

    const handler = listenHandlers['file-opened-by-os'];
    expect(handler, 'precondition: the file-opened-by-os listener must have been registered').toBeDefined();

    handler!({ payload: '/tmp/hashly-tests/opened.md' });
    // Wait for invoke + handleFileOpened (which awaits an editor mount).
    await new Promise((r) => setTimeout(r, 250));

    const readCalls = invokeMock.mock.calls.filter((c) => c[0] === 'read_md_file');
    expect(
      readCalls.length,
      `expected exactly one read_md_file invoke from the file-opened-by-os handler. Got: ${JSON.stringify(readCalls)}`,
    ).toBe(1);
    expect(
      (readCalls[0]![1] as { path: string }).path,
      'expected the path passed to invoke to match the event payload.',
    ).toBe('/tmp/hashly-tests/opened.md');

    // Editor must have mounted (handleFileOpened path).
    expect(
      host.querySelector('.ProseMirror'),
      'expected a Milkdown editor to mount in the host after the file-opened-by-os flow resolved.',
    ).not.toBeNull();
    expect(document.title).toContain('opened.md');

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
  });

  it('a file-opened-by-os event with a rejecting invoke renders the friendly file-error surface (no crash)', async () => {
    // Mirrors openFileViaDialog's error path: a non-UTF-8 / outside-
    // allow-list / non-regular-file payload causes invoke to reject;
    // the frontend renders the [role="alert"] error surface and does
    // not throw.
    const invokeMock = vi.fn(async () => {
      throw new Error('read_md_file failed: invalid utf-8');
    });
    const listenMock = vi.fn(async (eventName: string, handler: (e: { payload: unknown }) => void) => {
      listenHandlers[eventName] = handler;
      return () => {};
    });
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: listenMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));

    const { bootstrap } = (await import('../main')) as unknown as { bootstrap: () => void };
    bootstrap();
    await new Promise((r) => setTimeout(r, 80));

    const handler = listenHandlers['file-opened-by-os']!;
    handler({ payload: '/tmp/hashly-tests/binary.bin' });
    await new Promise((r) => setTimeout(r, 80));

    const alert = host.querySelector('[role="alert"]');
    expect(
      alert,
      'expected a [role="alert"] error surface in the host after a rejecting invoke from the file-opened-by-os flow (Issue #5 — error path mirrors File > Open #4 / #10).',
    ).not.toBeNull();

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
  });
});
