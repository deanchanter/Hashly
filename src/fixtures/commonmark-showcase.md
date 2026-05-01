# Hashly CommonMark + GFM Showcase

This fixture exercises the full CommonMark + GFM surface that Milkdown must
render in read-only mode. It is intentionally written in a representative
SDD-spec style so the rendered output looks like real product documentation.

## Overview

Hashly renders markdown as a WYSIWYG document. The bullet points below
summarise the rendering goals for the **v0.1** milestone:

- Render every CommonMark block in read-only mode
- Render GFM tables with header separators and aligned columns
  - Including tables embedded inside list items
  - Including long cell content that should wrap gracefully
- Preserve inline emphasis, links, and `inline code` spans
- Refuse to execute raw HTML (security regression pin from issue #14)

### Ordered Workflow

1. Open a markdown file from disk
2. Mount the Milkdown editor on the `#editor` host element
3. Render the parsed document with `commonmark` + `gfm` presets active

#### Heading Level Four

The application supports up to six levels of headings, matching the
CommonMark specification. The lower levels render at progressively smaller
type sizes but remain selectable for keyboard navigation.

##### Heading Level Five

Heading five is rare in production prose but the parser must still emit
a stable slug-counter id (verified separately in issue #17).

###### Heading Level Six

Heading six is the deepest level CommonMark recognises; anything beyond
this should be treated as paragraph text.

## Code Samples

Inline configuration like `npm test` and `cargo tauri dev` should render
in a monospace span. Fenced blocks should render with a code background:

```js
import { Editor } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';

export async function mountEditor(host, content) {
  return Editor.make()
    .config((ctx) => ctx.set(rootCtx, host))
    .use(commonmark)
    .use(gfm)
    .create();
}
```

## Tables

GFM tables must render with a header row, separator, and body rows.

| Feature           | CommonMark | GFM Extension |
|-------------------|------------|---------------|
| Headings h1–h6    | Yes        | Yes           |
| Fenced code       | Yes        | Yes           |
| Tables            | No         | Yes           |
| Task list items   | No         | Yes           |

## Links and Images

External links should be clickable but follow the read-only policy:
visit the [Milkdown documentation](https://milkdown.dev) or the
[CommonMark spec](https://spec.commonmark.org) for the source of truth.

Images render with their alt text exposed for assistive tech:

![Hashly placeholder logo](https://example.com/hashly-logo.png)

## Emphasis and Quotation

Editors frequently need both **bold** and *italic* runs in the same
sentence. Mixed runs like ***bold italic*** must also survive a
round-trip through the renderer.

> "A WYSIWYG markdown reader should *show* the document, not its source."
>
> — design note, paraphrased from the v0.1 vision doc

---

## Closing Notes

The horizontal rule above separates the closing notes section from the
emphasis examples. Anything below this point is intentionally light on
content; the goal is simply to verify that the rendered DOM extends past
a horizontal rule without truncation.
