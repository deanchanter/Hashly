import { describe, it, expect, beforeEach, vi } from 'vitest';
import prdRaw from '../templates/prd.md?raw';
import visionRaw from '../templates/vision.md?raw';
import taskRaw from '../templates/task.md?raw';

// Issue #49 — File > New From Template (slice 14 / v0.2).
//
// Three baked-in templates at `src/templates/`. Each is imported via
// Vite's `?raw` suffix so it ships in the bundle, not as a runtime
// fetch. The shape pinned here:
//
//   - frontmatter at byte offset 0 with `status: Draft`,
//     `author: {{author}}`, `date: {{date}}` placeholders.
//   - a top-level `# ` heading right after the frontmatter so the
//     user has somewhere to type the title without scrolling past
//     scaffold.
//
// Hydration replaces `{{author}}` with the system user (via the
// Tauri `get_current_user` command — falls back to literal "Author"
// when the command isn't reachable) and `{{date}}` with today in
// `YYYY-MM-DD`.

describe('Issue #49 — template files exist with the canonical frontmatter shape', () => {
  for (const [name, raw] of [
    ['prd', prdRaw],
    ['vision', visionRaw],
    ['task', taskRaw],
  ] as const) {
    it(`${name}.md starts with frontmatter and has {{author}} + {{date}} placeholders`, () => {
      expect(
        raw.startsWith('---\n'),
        `expected ${name}.md to start with a frontmatter fence at byte offset 0.`,
      ).toBe(true);
      expect(raw, `${name}.md must declare status: Draft`).toContain('status: Draft');
      expect(raw, `${name}.md must contain {{author}} placeholder`).toContain('{{author}}');
      expect(raw, `${name}.md must contain {{date}} placeholder`).toContain('{{date}}');
    });

    it(`${name}.md has a closing frontmatter fence and a body section`, () => {
      const closingIdx = raw.indexOf('\n---\n', 4);
      expect(closingIdx, `${name}.md missing closing frontmatter fence`).toBeGreaterThan(0);
      const body = raw.slice(closingIdx + 5);
      expect(
        body.includes('#'),
        `${name}.md body must contain at least one heading`,
      ).toBe(true);
    });
  }
});

describe('Issue #49 — `newFromTemplate` hydrates placeholders + opens edit-mode dirty buffer', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('newFromTemplate("prd", host) hydrates {{author}} via invoke(get_current_user) and {{date}} with today', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'get_current_user') return 'jane';
        return undefined;
      }),
    }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      open: vi.fn(async () => null),
      save: vi.fn(async () => null),
    }));

    const { bootstrap, newFromTemplate, isDirty } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      newFromTemplate: (kind: 'prd' | 'vision' | 'task', host: HTMLElement) => Promise<void>;
      isDirty: () => boolean;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));

    await newFromTemplate('prd', host);

    // Frontmatter panel renders with hydrated values.
    const panel = host.querySelector<HTMLElement>('[data-testid="frontmatter-panel"]');
    expect(panel, 'expected the frontmatter panel to render for a template-new buffer').not.toBeNull();
    const text = panel!.textContent ?? '';
    expect(
      text,
      'expected hydrated `author` to appear in the metadata panel (Issue #49 — autopopulation).',
    ).toContain('jane');
    const today = new Date().toISOString().slice(0, 10);
    expect(
      text,
      `expected today's date (${today}) in the panel.`,
    ).toContain(today);

    // Dirty from frame zero.
    expect(
      isDirty(),
      'expected isDirty()===true on a template-new buffer (Issue #49 — dirty indicator on from frame zero).',
    ).toBe(true);

    // Edit mode mounted.
    const editor = host.querySelector<HTMLElement>('.ProseMirror');
    expect(editor?.getAttribute('contenteditable')).toBe('true');

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
  });

  it('newFromTemplate falls back to literal "Author" when invoke(get_current_user) rejects', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'get_current_user') {
          throw new Error('not in tauri');
        }
        return undefined;
      }),
    }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      open: vi.fn(async () => null),
      save: vi.fn(async () => null),
    }));

    const { bootstrap, newFromTemplate } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      newFromTemplate: (kind: 'prd' | 'vision' | 'task', host: HTMLElement) => Promise<void>;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await newFromTemplate('vision', host);

    const panel = host.querySelector<HTMLElement>('[data-testid="frontmatter-panel"]')!;
    expect(
      panel.textContent ?? '',
      'expected the literal fallback "Author" when invoke fails (Issue #49 AC).',
    ).toContain('Author');

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
  });
});

describe('Issue #49 — Save-As routing for template-new (path-less) buffers', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('saveCurrent() on a template-new buffer opens the save picker and invokes save_md_file with the chosen path', async () => {
    const invokeMock = vi.fn(async (cmd: string) => {
      if (cmd === 'get_current_user') return 'jane';
      return undefined;
    });
    const saveDialogMock = vi.fn(async () => '/tmp/picked.md');
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      open: vi.fn(async () => null),
      save: saveDialogMock,
    }));

    const { bootstrap, newFromTemplate, saveCurrent, isDirty } = (await import(
      '../main'
    )) as unknown as {
      bootstrap: () => void;
      newFromTemplate: (kind: 'prd' | 'vision' | 'task', host: HTMLElement) => Promise<void>;
      saveCurrent: () => Promise<void>;
      isDirty: () => boolean;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await newFromTemplate('task', host);
    expect(isDirty()).toBe(true);

    await saveCurrent();

    expect(
      saveDialogMock,
      'expected the save picker to open when saveCurrent runs on a path-less buffer (Issue #49 Save-As routing).',
    ).toHaveBeenCalledTimes(1);
    const saveCalls = invokeMock.mock.calls.filter((c) => c[0] === 'save_md_file');
    expect(saveCalls.length, 'expected exactly one save_md_file invoke after the picker resolved').toBe(1);
    const saveCallArgs = saveCalls[0] as unknown as [string, { path: string; content: string }];
    expect(saveCallArgs[1].path).toBe('/tmp/picked.md');

    expect(
      isDirty(),
      'expected dirty to clear after a successful Save-As + save invoke.',
    ).toBe(false);

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
  });

  it('saveCurrent() leaves dirty sticky-true when the user cancels the save picker', async () => {
    const invokeMock = vi.fn(async (cmd: string) => {
      if (cmd === 'get_current_user') return 'jane';
      return undefined;
    });
    const saveDialogMock = vi.fn(async () => null); // user cancelled
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      open: vi.fn(async () => null),
      save: saveDialogMock,
    }));

    const { bootstrap, newFromTemplate, saveCurrent, isDirty } = (await import(
      '../main'
    )) as unknown as {
      bootstrap: () => void;
      newFromTemplate: (kind: 'prd' | 'vision' | 'task', host: HTMLElement) => Promise<void>;
      saveCurrent: () => Promise<void>;
      isDirty: () => boolean;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await newFromTemplate('prd', host);

    await saveCurrent();

    expect(saveDialogMock).toHaveBeenCalledTimes(1);
    const saveCalls = invokeMock.mock.calls.filter((c) => c[0] === 'save_md_file');
    expect(
      saveCalls.length,
      'expected NO save_md_file invoke when the user cancels the picker (Issue #49 AC: cancelling leaves buffer dirty + unsaved).',
    ).toBe(0);
    expect(
      isDirty(),
      'expected dirty to remain true after a cancelled Save-As.',
    ).toBe(true);

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
  });
});
