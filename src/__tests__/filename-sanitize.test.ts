import { describe, it, expect, beforeEach, vi } from 'vitest';

// Issue #43 — Sanitize `document.title` against Unicode RTL / zero-
// width / control codepoints in opened filenames (slice 4 / v0.2;
// originally surfaced by the v0.1 final cross-slice review of #4 and
// deferred as non-critical UX-spoofing risk).
//
// Threat model:
//   A malicious `.md` file with a Unicode bidi override (e.g. U+202E
//   RTL Override) or zero-width chars in its basename will render
//   visibly weird in the title bar. Not an XSS path (titles aren't
//   HTML-parsed) but a UX-spoofing concern: a file named
//   `safe<U+202E>gnp.md` could appear as `safe.dgn` in the title,
//   tricking a user into thinking they opened a different file.
//
// Codepoints stripped (per the issue body's verbatim list, in order):
//   - U+0000..U+001F  — C0 control codes
//   - U+007F..U+009F  — DEL + C1 control codes
//   - U+200B..U+200F  — zero-width chars + LRM/RLM bidi marks
//   - U+202A..U+202E  — bidi embedding/override codepoints (LRE,
//                       RLE, PDF, LRO, RLO)
//   - U+2066..U+2069  — bidi isolate codepoints (LRI, RLI, FSI, PDI)
//
// Codepoints PRESERVED (no false positives):
//   - U+0020..U+007E  — printable ASCII
//   - U+00A1..      — accented Latin / European punctuation
//   - U+4E00..U+9FFF — CJK Unified Ideographs (used in legitimate
//                       filenames worldwide)
//
// Pinned testable seam: `sanitizeFilename(name: string): string`,
// named export of `src/main.ts`. The function is the contract; the
// handleFileOpened call site uses it to derive the displayed title
// from `payload.name`.

describe('Issue #43 — `sanitizeFilename` named export', () => {
  it('exports a `sanitizeFilename` function', async () => {
    const mod = (await import('../main')) as unknown as { sanitizeFilename?: unknown };
    expect(
      typeof mod.sanitizeFilename,
      'expected `sanitizeFilename` to be exported from src/main.ts (Issue #43).',
    ).toBe('function');
  });

  it('strips U+202E (RTL Override) — the central spoofing codepoint', async () => {
    const { sanitizeFilename } = (await import('../main')) as unknown as {
      sanitizeFilename: (name: string) => string;
    };
    // The classic spoof: `safe<U+202E>gnp.md` renders as `safe.dgn`.
    const malicious = 'safe‮gnp.md';
    const sanitized = sanitizeFilename(malicious);
    expect(
      sanitized.includes('‮'),
      `expected sanitizeFilename to strip U+202E (RTL Override). Got: ${JSON.stringify(sanitized)} (codepoints: ${[...sanitized].map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(',')})`,
    ).toBe(false);
    expect(
      sanitized,
      'expected the visible/legible portion to remain after stripping the override codepoint.',
    ).toBe('safegnp.md');
  });

  it('strips the entire bidi-embedding/override range U+202A..U+202E', async () => {
    const { sanitizeFilename } = (await import('../main')) as unknown as {
      sanitizeFilename: (name: string) => string;
    };
    for (let cp = 0x202a; cp <= 0x202e; cp++) {
      const ch = String.fromCodePoint(cp);
      const input = `pre${ch}post.md`;
      const out = sanitizeFilename(input);
      expect(
        out,
        `expected sanitizeFilename to strip U+${cp.toString(16).toUpperCase().padStart(4, '0')} from ${JSON.stringify(input)}. Got: ${JSON.stringify(out)}`,
      ).toBe('prepost.md');
    }
  });

  it('strips the bidi isolate range U+2066..U+2069', async () => {
    const { sanitizeFilename } = (await import('../main')) as unknown as {
      sanitizeFilename: (name: string) => string;
    };
    for (let cp = 0x2066; cp <= 0x2069; cp++) {
      const ch = String.fromCodePoint(cp);
      const out = sanitizeFilename(`a${ch}b.md`);
      expect(
        out,
        `expected sanitizeFilename to strip U+${cp.toString(16).toUpperCase().padStart(4, '0')}.`,
      ).toBe('ab.md');
    }
  });

  it('strips the zero-width / LRM / RLM range U+200B..U+200F', async () => {
    const { sanitizeFilename } = (await import('../main')) as unknown as {
      sanitizeFilename: (name: string) => string;
    };
    for (let cp = 0x200b; cp <= 0x200f; cp++) {
      const ch = String.fromCodePoint(cp);
      const out = sanitizeFilename(`x${ch}y.md`);
      expect(
        out,
        `expected sanitizeFilename to strip U+${cp.toString(16).toUpperCase().padStart(4, '0')}.`,
      ).toBe('xy.md');
    }
  });

  it('strips C0 control codes U+0000..U+001F', async () => {
    // C0 controls in a filename are unusual but the C0 block includes
    // BEL, NUL, ESC, etc. — none of which belong in a title bar.
    const { sanitizeFilename } = (await import('../main')) as unknown as {
      sanitizeFilename: (name: string) => string;
    };
    for (const cp of [0x00, 0x07, 0x09, 0x1b, 0x1f]) {
      const ch = String.fromCodePoint(cp);
      const out = sanitizeFilename(`p${ch}q.md`);
      expect(
        out,
        `expected sanitizeFilename to strip C0 control U+${cp.toString(16).toUpperCase().padStart(4, '0')}.`,
      ).toBe('pq.md');
    }
  });

  it('strips DEL (U+007F) and C1 control codes U+0080..U+009F', async () => {
    const { sanitizeFilename } = (await import('../main')) as unknown as {
      sanitizeFilename: (name: string) => string;
    };
    for (const cp of [0x7f, 0x80, 0x90, 0x9f]) {
      const ch = String.fromCodePoint(cp);
      const out = sanitizeFilename(`a${ch}b.md`);
      expect(out).toBe('ab.md');
    }
  });

  it('preserves plain ASCII printable filenames unchanged', async () => {
    const { sanitizeFilename } = (await import('../main')) as unknown as {
      sanitizeFilename: (name: string) => string;
    };
    for (const name of [
      'spec.md',
      'README.md',
      'notes-2026-05-01.md',
      'A & B.md',
      'file (1).md',
      'snake_case_filename.md',
      'doc.with.dots.md',
    ]) {
      expect(
        sanitizeFilename(name),
        `expected ${JSON.stringify(name)} to pass through unchanged (no false positives on plain ASCII).`,
      ).toBe(name);
    }
  });

  it('preserves accented Latin and European punctuation', async () => {
    const { sanitizeFilename } = (await import('../main')) as unknown as {
      sanitizeFilename: (name: string) => string;
    };
    for (const name of ['café.md', 'piñata.md', 'naïve.md', 'résumé.md', 'über.md']) {
      expect(sanitizeFilename(name)).toBe(name);
    }
  });

  it('preserves CJK Unified Ideographs', async () => {
    const { sanitizeFilename } = (await import('../main')) as unknown as {
      sanitizeFilename: (name: string) => string;
    };
    for (const name of ['仕様書.md', '設計.md', '提案.md', '中文文档.md', '한글파일.md']) {
      expect(
        sanitizeFilename(name),
        `expected ${JSON.stringify(name)} to pass through unchanged (CJK is legitimate filename content, not control).`,
      ).toBe(name);
    }
  });

  it('handles an empty input by returning an empty string (no throw)', async () => {
    const { sanitizeFilename } = (await import('../main')) as unknown as {
      sanitizeFilename: (name: string) => string;
    };
    expect(sanitizeFilename('')).toBe('');
  });
});

describe('Issue #43 — handleFileOpened sanitizes filename before setting document.title', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('after opening a malicious filename containing U+202E, document.title does NOT contain U+202E', async () => {
    // Integration pin: the central #43 contract — the title bar
    // never exposes a bidi-override codepoint to the user, even if
    // the file picker handed us one.
    const { handleFileOpened } = (await import('../main')) as unknown as {
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };

    await handleFileOpened(
      { path: '/tmp/x', name: 'safe‮gnp.md', content: '# Hello\n' },
      host,
    );

    expect(
      document.title.includes('‮'),
      `expected document.title to NOT contain U+202E (RTL Override) after handleFileOpened. Got title=${JSON.stringify(document.title)}, codepoints=[${[...document.title].map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(', ')}]`,
    ).toBe(false);
    expect(
      document.title,
      'expected the visible portion of the filename to remain in the title.',
    ).toContain('safegnp.md');
  });

  it('a CJK filename passes through to document.title unchanged', async () => {
    const { handleFileOpened } = (await import('../main')) as unknown as {
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };

    await handleFileOpened(
      { path: '/tmp/y', name: '仕様書.md', content: '# テスト\n' },
      host,
    );

    expect(
      document.title,
      'expected CJK filename to render in document.title unchanged (no false-positive sanitization on legitimate non-Latin scripts).',
    ).toContain('仕様書.md');
  });
});
