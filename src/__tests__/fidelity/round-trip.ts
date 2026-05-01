import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  serializerCtx,
  parserCtx,
} from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import type { Node as ProseNode } from '@milkdown/prose/model';

// Issue #45 — Round-trip fidelity oracle.
//
// `roundTrip(host, source)` mounts a Milkdown editor (commonmark + gfm
// presets, matching the production wiring in `src/main.ts`), serializes
// the parsed document back to markdown via `serializerCtx`, then parses
// BOTH the source and the serialized output through Milkdown's own
// `parserCtx` to ProseMirror documents. The two ProseMirror docs are
// compared via `Node.eq()`.
//
// `Node.eq()` is structural — it compares node type, attributes, marks,
// and text content recursively. Two markdown sources that differ in
// surface form (`*foo*` vs `_foo_`, `1)` vs `1.`, `***` vs `---` HR,
// `*` vs `-` list bullets) but parse to the same ProseMirror AST will
// compare equal. That's the AST-equality oracle the slice 1 spec asks
// for: byte-equality would drown the report in normalisation noise.
//
// The presets are pinned to match `mountEditor` in `src/main.ts`. If the
// production wiring ever diverges, this harness should diverge with it
// — a fidelity gate that runs against a different plugin chain than
// production tells us nothing useful.

export interface RoundTripResult {
  /** The unmodified input string. */
  source: string;
  /** Markdown produced by Milkdown's serializer after mounting `source`. */
  serialized: string;
  /** Whether `source` and `serialized` parse to identical ProseMirror docs. */
  equal: boolean;
  /** Source parsed via `parserCtx`. */
  sourceDoc: ProseNode | null;
  /** Serialized output parsed via `parserCtx`. */
  roundTripDoc: ProseNode | null;
}

export async function roundTrip(host: HTMLElement, source: string): Promise<RoundTripResult> {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, source);
    })
    .use(commonmark)
    .use(gfm)
    .create();

  try {
    const serialized = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const serializer = ctx.get(serializerCtx);
      return serializer(view.state.doc);
    });

    const { sourceDoc, roundTripDoc } = editor.action((ctx) => {
      const parser = ctx.get(parserCtx);
      return {
        sourceDoc: parser(source) ?? null,
        roundTripDoc: parser(serialized) ?? null,
      };
    });

    const equal =
      sourceDoc !== null && roundTripDoc !== null && sourceDoc.eq(roundTripDoc);

    return { source, serialized, equal, sourceDoc, roundTripDoc };
  } finally {
    try {
      await editor.destroy();
    } catch {
      /* swallow — destroy can reject if mount failed; we still want to
         return a result so the harness reports clearly. */
    }
  }
}
