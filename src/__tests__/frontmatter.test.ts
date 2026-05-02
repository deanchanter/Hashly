import { describe, it, expect, beforeEach, vi } from 'vitest';

// Issue #48 — Frontmatter recognition end-to-end (slice 13 / v0.2).
//
// Strict detection (per the spec.md AC):
//   - byte offset 0 must be `---\n`.
//   - first subsequent line of exactly `---` (optional trailing
//     whitespace, `\n`-terminated) closes the block.
//   - YAML between fences must parse cleanly.
//   - any parse error → pass through to Milkdown unchanged. Never
//     throws on user input.
//
// Pinned testable seam: `parseFrontmatter(text): { frontmatter: string
// | null; body: string; parsed: Record<string, unknown> | null }`.
// `frontmatter` is the RAW block including the `---\n…---\n` fences
// (so byte-equal round-trip is mechanical — we re-emit verbatim, no
// YAML serializer involved). `body` is everything after the closing
// fence. `parsed` is the YAML-parsed object for read-view rendering;
// `null` when there's no frontmatter OR YAML parsing failed.

describe('Issue #48 — `parseFrontmatter` named export', () => {
  it('exports a `parseFrontmatter` function', async () => {
    const mod = (await import('../main')) as unknown as { parseFrontmatter?: unknown };
    expect(typeof mod.parseFrontmatter, 'expected `parseFrontmatter` named export').toBe('function');
  });

  it('parses a clean frontmatter block at byte offset 0', async () => {
    const { parseFrontmatter } = (await import('../main')) as unknown as {
      parseFrontmatter: (text: string) => {
        frontmatter: string | null;
        body: string;
        parsed: Record<string, unknown> | null;
      };
    };
    const input = '---\ntitle: Hello\nauthor: dean\n---\n# Body\n\ntext\n';
    const out = parseFrontmatter(input);

    expect(
      out.frontmatter,
      'expected frontmatter to be the raw block including fences (byte-equal round-trip).',
    ).toBe('---\ntitle: Hello\nauthor: dean\n---\n');
    expect(out.body).toBe('# Body\n\ntext\n');
    expect(out.parsed).toEqual({ title: 'Hello', author: 'dean' });
  });

  it('returns frontmatter:null + body:original when there is no frontmatter', async () => {
    const { parseFrontmatter } = (await import('../main')) as unknown as {
      parseFrontmatter: (text: string) => {
        frontmatter: string | null;
        body: string;
        parsed: Record<string, unknown> | null;
      };
    };
    const input = '# Hello\n\nNo frontmatter here.\n';
    const out = parseFrontmatter(input);
    expect(out.frontmatter).toBeNull();
    expect(out.body, 'body must be the original input verbatim').toBe(input);
    expect(out.parsed).toBeNull();
  });

  it('returns frontmatter:null when --- is NOT at byte offset 0 (leading whitespace)', async () => {
    const { parseFrontmatter } = (await import('../main')) as unknown as {
      parseFrontmatter: (text: string) => {
        frontmatter: string | null;
        body: string;
        parsed: Record<string, unknown> | null;
      };
    };
    const input = ' ---\ntitle: x\n---\n# body\n';
    const out = parseFrontmatter(input);
    expect(
      out.frontmatter,
      'strict detection: a leading space defeats the offset-0 anchor.',
    ).toBeNull();
    expect(out.body).toBe(input);
  });

  it('passes through unchanged when YAML parsing fails (malformed body)', async () => {
    const { parseFrontmatter } = (await import('../main')) as unknown as {
      parseFrontmatter: (text: string) => {
        frontmatter: string | null;
        body: string;
        parsed: Record<string, unknown> | null;
      };
    };
    // Unclosed bracket → js-yaml throws. We must catch and pass through.
    const input = '---\ntitle: [unclosed\n---\n# body\n';
    expect(() => parseFrontmatter(input), 'must NOT throw on user input').not.toThrow();
    const out = parseFrontmatter(input);
    expect(
      out.frontmatter,
      'malformed YAML → pass-through (frontmatter:null, body:original).',
    ).toBeNull();
    expect(out.body).toBe(input);
    expect(out.parsed).toBeNull();
  });

  it('handles a frontmatter-only document (closing fence at end)', async () => {
    const { parseFrontmatter } = (await import('../main')) as unknown as {
      parseFrontmatter: (text: string) => {
        frontmatter: string | null;
        body: string;
        parsed: Record<string, unknown> | null;
      };
    };
    const input = '---\ntitle: Lonely\n---\n';
    const out = parseFrontmatter(input);
    expect(out.frontmatter).toBe('---\ntitle: Lonely\n---\n');
    expect(out.body).toBe('');
    expect(out.parsed).toEqual({ title: 'Lonely' });
  });

  it('returns frontmatter:null for an unterminated block (no closing ---)', async () => {
    const { parseFrontmatter } = (await import('../main')) as unknown as {
      parseFrontmatter: (text: string) => {
        frontmatter: string | null;
        body: string;
        parsed: Record<string, unknown> | null;
      };
    };
    const input = '---\ntitle: Open\nthis line never closes\n# heading\n';
    const out = parseFrontmatter(input);
    expect(out.frontmatter, 'no closing fence → not frontmatter, pass through').toBeNull();
    expect(out.body).toBe(input);
  });

  it('handles a closing fence with optional trailing whitespace', async () => {
    const { parseFrontmatter } = (await import('../main')) as unknown as {
      parseFrontmatter: (text: string) => {
        frontmatter: string | null;
        body: string;
        parsed: Record<string, unknown> | null;
      };
    };
    // Trailing spaces on the closing line are allowed.
    const input = '---\ntitle: x\n---   \n# body\n';
    const out = parseFrontmatter(input);
    expect(
      out.frontmatter,
      'AC: closing line is exactly `---` with optional trailing whitespace.',
    ).toBe('---\ntitle: x\n---   \n');
    expect(out.body).toBe('# body\n');
  });

  it('round-trip preserves frontmatter byte-equal when concatenated with body', async () => {
    const { parseFrontmatter } = (await import('../main')) as unknown as {
      parseFrontmatter: (text: string) => {
        frontmatter: string | null;
        body: string;
        parsed: Record<string, unknown> | null;
      };
    };
    const original =
      '---\ntitle: Spec\nauthor: dean\ndate: 2026-05-02\n---\n# Spec\n\nbody body body\n';
    const { frontmatter, body } = parseFrontmatter(original);
    const reassembled = (frontmatter ?? '') + body;
    expect(
      reassembled,
      'AC: re-emit frontmatter at byte offset 0 ahead of editor body; the result must be byte-equal to the original.',
    ).toBe(original);
  });
});

describe('Issue #48 — handleFileOpened renders metadata panel for frontmatter docs', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('a doc with frontmatter renders a [data-testid="frontmatter-panel"] above the editor', async () => {
    const { handleFileOpened } = (await import('../main')) as unknown as {
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };
    await handleFileOpened(
      {
        path: '/tmp/spec.md',
        name: 'spec.md',
        content: '---\ntitle: Spec\nauthor: dean\n---\n# Spec body\n',
      },
      host,
    );

    const panel = host.querySelector<HTMLElement>('[data-testid="frontmatter-panel"]');
    expect(
      panel,
      'expected a [data-testid="frontmatter-panel"] inside the host when the doc has frontmatter (Issue #48).',
    ).not.toBeNull();
    // The panel renders the parsed key/value pairs (read mode minimum).
    const text = panel!.textContent ?? '';
    expect(text).toContain('title');
    expect(text).toContain('Spec');
    expect(text).toContain('author');
    expect(text).toContain('dean');

    // Editor body must contain the body content but NOT the frontmatter.
    const editor = host.querySelector('.ProseMirror');
    expect(editor, 'editor must mount').not.toBeNull();
    const editorText = editor!.textContent ?? '';
    expect(editorText).toContain('Spec body');
    expect(
      editorText.includes('---') || editorText.includes('title: Spec'),
      'editor body must NOT contain the frontmatter (it lives in the panel).',
    ).toBe(false);
  });

  it('a doc WITHOUT frontmatter does NOT render a metadata panel', async () => {
    const { handleFileOpened } = (await import('../main')) as unknown as {
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };
    await handleFileOpened(
      { path: '/tmp/x', name: 'x.md', content: '# Just body\n' },
      host,
    );
    expect(
      host.querySelector('[data-testid="frontmatter-panel"]'),
      'expected NO panel when the doc has no frontmatter.',
    ).toBeNull();
  });

  it('a doc with malformed YAML in the frontmatter passes through (no panel, body is the verbatim source)', async () => {
    const { handleFileOpened } = (await import('../main')) as unknown as {
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };
    const malformed = '---\ntitle: [unclosed\n---\n# body\n';
    await handleFileOpened(
      { path: '/tmp/y', name: 'y.md', content: malformed },
      host,
    );
    expect(
      host.querySelector('[data-testid="frontmatter-panel"]'),
      'malformed YAML → pass-through; no panel.',
    ).toBeNull();
    // Editor mounted, no crash.
    expect(host.querySelector('.ProseMirror')).not.toBeNull();
  });
});

describe('Issue #48 — saveCurrent re-emits frontmatter byte-equal ahead of editor body', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('saveCurrent invokes save_md_file with frontmatter prepended to the editor-serialized body', async () => {
    const invokeMock = vi.fn(async () => undefined);
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { bootstrap, handleFileOpened, saveCurrent } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
      saveCurrent: () => Promise<void>;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));

    const original = '---\ntitle: Spec\n---\n# Body\n\ntext\n';
    await handleFileOpened(
      { path: '/tmp/hashly-tests/spec.md', name: 'spec.md', content: original },
      host,
    );

    // Toggle to edit mode so saveCurrent's mode guard passes.
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    toggle.click();
    await new Promise((r) => setTimeout(r, 80));

    await saveCurrent();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const call = invokeMock.mock.calls[0] as unknown as [string, { path: string; content: string }];
    const args = call[1];
    expect(args, 'save_md_file invoke must carry args').toBeDefined();
    expect(
      args.content.startsWith('---\ntitle: Spec\n---\n'),
      `expected saved content to START with the verbatim frontmatter block (byte-equal round-trip per Issue #48 AC). Got: ${JSON.stringify(args.content)}`,
    ).toBe(true);
    expect(
      args.content,
      'saved content must include the body after the frontmatter.',
    ).toContain('Body');

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
  });
});

describe('Issue #48 — frontmatter panel survives read↔edit toggle', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('toggling read→edit re-renders the frontmatter panel above the editor', async () => {
    // Cross-slice critical surfaced by the final adversarial review:
    // toggleEditMode does `host.innerHTML = ''` which wiped the panel
    // appended by handleFileOpened. Spec.md AC says reading view
    // shows the metadata panel above the body — that contract has
    // to survive mode toggles.
    const { bootstrap, handleFileOpened } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await handleFileOpened(
      {
        path: '/tmp/x',
        name: 'x.md',
        content: '---\ntitle: Persists\nauthor: jane\n---\n# Body\n',
      },
      host,
    );

    expect(host.querySelector('[data-testid="frontmatter-panel"]'), 'precondition: panel renders on open').not.toBeNull();

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    toggle.click();
    await new Promise((r) => setTimeout(r, 80));

    const panelAfterEdit = host.querySelector<HTMLElement>('[data-testid="frontmatter-panel"]');
    expect(
      panelAfterEdit,
      'expected the frontmatter panel to STILL render after toggling read→edit (cross-slice fix: toggleEditMode must re-render the panel after wiping host.innerHTML).',
    ).not.toBeNull();
    expect(panelAfterEdit!.textContent ?? '').toContain('Persists');
    expect(panelAfterEdit!.textContent ?? '').toContain('jane');

    // And toggle back: panel still there.
    toggle.click();
    await new Promise((r) => setTimeout(r, 80));
    const panelAfterRead = host.querySelector<HTMLElement>('[data-testid="frontmatter-panel"]');
    expect(
      panelAfterRead,
      'expected the panel to STILL render after toggling edit→read.',
    ).not.toBeNull();
    expect(panelAfterRead!.textContent ?? '').toContain('Persists');
  });
});
