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

// Tests for handleFileOpened, saveCurrent, and frontmatter-panel-survives-toggle covered
// Tauri-only desktop behaviors and were removed in remove-tauri-legacy.
