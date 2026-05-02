# Hashly mark usage rules

Source of truth for v0.2: `specs/v0.2-mvp-completion/brand/project/marks.jsx` (`MarkGeometric`). The SVGs in this directory are exports.

## Mark spec (from the brand sheet)

| Property | Value |
|---|---|
| Grid | 100 × 100u |
| Bar weight (horizontals) | 11u |
| Bar gap (between horizontals' inner edges) | 9u |
| Vertical slope | −9° |
| Vertical width | 8u |
| Corner radius | 2.5u |
| Clear space (around the mark) | ≥ 1× cap height |
| Minimum size | 14px |

## Variants

- **`mark.svg`** — canonical mark on a transparent background. Ink glyph, gold (`#c9a24b`) accent on the right vertical. Use when the surrounding surface provides the background.
- **`favicon.svg`** — paper (`#f0f1ec`) background, ink glyph, gold accent. Wired into `index.html`. Renders cleanly down to 16px.
- **`icon-primary.svg`** — gold (`#c9a24b`) background, ink glyph, *ink-on-gold* for the right vertical (no accent stem — on a gold background the gold accent would disappear, so both verticals render in ink). This is the source for the macOS app icon set; rasterization to PNG + `.icns` is a follow-up.

## Do

- Render the mark on paper, ink, forest, or gold backgrounds with the colour pairings specified in `Hashly Logo.html`.
- Maintain ≥ 1× cap height of clear space around the mark in any composition.

## Don't

- Don't recolour the mark with off-palette colours. Use only `--ink`, `--paper`, `--accent` (forest), `--accent-2` (gold).
- Don't rotate the mark. The −9° slope is the entire italic gesture; additional rotation reads as broken layout.
- Don't render below 14px. The minimum size from the brand sheet is the cap below which the bar weight + slope reads as visual noise.
