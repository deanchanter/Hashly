// Issue #48 — Frontmatter recognition. Extracted from `src/main.ts` so
// the web-mode `mountViewer` (Issue #90 AC 4.4) can reuse the parser
// without importing the Tauri-coupled module surface.
//
// Strict detection per the spec.md AC: byte offset 0 must be `---\n`;
// the closing fence is the first subsequent line of exactly `---`
// (optional trailing whitespace). YAML between the fences is parsed via
// js-yaml; any parse error → pass through (the doc renders as a plain
// markdown doc, no panel).
//
// `frontmatter` is the RAW block including both fences — so re-emit is
// byte-equal (no YAML serialization round-trip; we never re-emit from
// the parsed object). `parsed` is the YAML-parsed object for read-view
// metadata-panel rendering only.

import * as yaml from 'js-yaml';

export interface FrontmatterParse {
  frontmatter: string | null;
  body: string;
  parsed: Record<string, unknown> | null;
}

export function parseFrontmatter(text: string): FrontmatterParse {
  const passthrough: FrontmatterParse = { frontmatter: null, body: text, parsed: null };
  if (!text.startsWith('---\n')) return passthrough;

  // Search for the closing fence: a line that is exactly `---`
  // (optionally with trailing whitespace), terminated by `\n`.
  // The line must NOT be the opening fence itself, so start scanning
  // from index 4 (past the leading `---\n`).
  const closingFenceRe = /\n---[ \t]*\n/;
  const match = closingFenceRe.exec(text);
  if (!match || match.index < 4) return passthrough;

  // The closing fence's match starts with `\n`. The fence itself is
  // from `match.index + 1` (the `---`) through `match.index + match[0].length`.
  const fenceEnd = match.index + match[0].length;
  const block = text.slice(0, fenceEnd);
  const body = text.slice(fenceEnd);

  // YAML-parse the content between the fences (excluding the fences
  // themselves).
  const yamlContent = text.slice(4, match.index + 1); // skip leading "---\n", up to the "\n" before the closing fence
  let parsed: Record<string, unknown> | null = null;
  try {
    const parsedRaw = yaml.load(yamlContent);
    if (parsedRaw && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)) {
      parsed = parsedRaw as Record<string, unknown>;
    } else {
      // Non-object YAML (scalar, array, etc.) — pass through as plain
      // markdown. The frontmatter contract is "key/value metadata".
      return passthrough;
    }
  } catch {
    // Malformed YAML — pass through.
    return passthrough;
  }

  return { frontmatter: block, body, parsed };
}
