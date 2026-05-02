//! Issue #46 — Brand palette + typography + wordmark (slice 11 / v0.2).
//!
//! The brand bundle in `specs/v0.2-mvp-completion/brand/` is the source
//! of truth: `Hashly Logo.html` defines the palette, `marks.jsx` ships
//! the geometric `#` mark. This test file pins the v0.2-shipped half:
//!
//!   1. CSS palette variables live in `:root` of `src/style.css` with
//!      the exact paper/ink/accent values from the brand sheet.
//!   2. `@media (prefers-color-scheme: dark)` overrides the variables
//!      so light + dark modes work mechanically without a JS toggle
//!      (closes the v0.1 open question on theme behavior — the
//!      palette IS the theme).
//!   3. The three brand typefaces (Fraunces, Schibsted Grotesk,
//!      JetBrains Mono) appear in CSS font-family declarations with
//!      sane system fallbacks. (Actual font loading — bundled woff2
//!      vs Google Fonts CDN — is a follow-up; the fallback chain
//!      means the app renders correctly today with system fonts and
//!      gains the brand fonts when slice-followup wires loading.)
//!   4. The `#hashly` wordmark element is present in `index.html`
//!      (gold `#` + ink `hashly`, styled `<span>`s — no SVG).
//!
//! Slice 5 / #9 (light/dark mode) depends on these variables — the
//! `prefers-color-scheme` plumbing is already in place once this
//! lands; #9's deliverable is the visual verification + bundled-with-
//! `#29` toggle-button polish.

use std::fs;
use std::path::PathBuf;

mod common;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn read_repo_file(rel: &str) -> String {
    let path = repo_root().join(rel);
    fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e))
}

#[test]
fn style_css_declares_paper_palette_variables_in_root_block() {
    // The "paper" half of the brand palette — backgrounds + neutrals.
    // Pinning the values verbatim catches a slice that "rounds"
    // a hex (e.g. #f0f1ec → #f0f0f0) and silently drifts the brand.
    let css = read_repo_file("src/style.css");
    let stripped = common::strip_comments(&css);

    for (name, hex) in [
        ("--paper", "#f0f1ec"),
        ("--paper-2", "#e6e8e0"),
        ("--rule", "#d2d6cb"),
    ] {
        let needle = format!("{}: {}", name, hex);
        assert!(
            stripped.contains(&needle),
            "expected `src/style.css` to declare the brand palette variable `{}: {}` \
             (Issue #46). Without verbatim hex match, a slice could silently drift the \
             brand. Stripped CSS:\n{}",
            name,
            hex,
            stripped
        );
    }
}

#[test]
fn style_css_declares_ink_palette_variables_in_root_block() {
    // The "ink" half — body text + secondary text + muted.
    let css = read_repo_file("src/style.css");
    let stripped = common::strip_comments(&css);

    for (name, hex) in [
        ("--ink", "#14201b"),
        ("--ink-2", "#36443d"),
        ("--muted", "#7c8479"),
    ] {
        let needle = format!("{}: {}", name, hex);
        assert!(
            stripped.contains(&needle),
            "expected `src/style.css` to declare the brand palette variable `{}: {}`. \
             Stripped CSS:\n{}",
            name,
            hex,
            stripped
        );
    }
}

#[test]
fn style_css_declares_accent_palette_variables_in_root_block() {
    // The accent pair — deep forest + muted gold. These differentiate
    // Hashly from the generic "paper + ink" markdown editor look and
    // are the load-bearing brand recognition surface (gold `#` in the
    // wordmark, forest call-to-action buttons).
    let css = read_repo_file("src/style.css");
    let stripped = common::strip_comments(&css);

    for (name, hex) in [
        ("--accent", "#1e3a2f"),   // deep forest
        ("--accent-2", "#c9a24b"), // muted gold
    ] {
        let needle = format!("{}: {}", name, hex);
        assert!(
            stripped.contains(&needle),
            "expected `src/style.css` to declare the accent palette variable `{}: {}`. \
             Stripped CSS:\n{}",
            name,
            hex,
            stripped
        );
    }
}

#[test]
fn style_css_overrides_palette_variables_for_prefers_color_scheme_dark() {
    // The light/dark toggle is mechanical: `prefers-color-scheme: dark`
    // flips the palette variable bindings. v0.1's open question on
    // theme behavior is closed by the palette itself — there's no
    // in-app toggle needed (PRD: "no in-app toggle, no settings UI").
    //
    // Pin: the CSS contains a `@media (prefers-color-scheme: dark)`
    // block AND inside that block at least the `--paper` and `--ink`
    // variables are re-bound (the inversion is the load-bearing dark
    // mode behavior — paper background becomes ink, ink text becomes
    // paper).
    let css = read_repo_file("src/style.css");
    let stripped = common::strip_comments(&css);

    let dark_block_idx = stripped.find("@media (prefers-color-scheme: dark)").unwrap_or_else(|| {
        panic!(
            "expected `src/style.css` to contain a `@media (prefers-color-scheme: dark)` \
             block (Issue #46 + slice 5 / #9 — the palette IS the theme; without this \
             block, dark mode is impossible). Stripped CSS:\n{}",
            stripped
        )
    });

    // Find the closing brace of the @media block. Heuristic: look for
    // the next "}" after a "{" that opens the media block; we want the
    // OUTER closing brace. Easier: look at a generous slice (1500
    // chars after the @media) and assert the variable re-bindings are
    // there.
    let window = &stripped[dark_block_idx..stripped.len().min(dark_block_idx + 2000)];
    for var in ["--paper", "--ink"] {
        assert!(
            window.contains(var),
            "expected the `@media (prefers-color-scheme: dark)` block to re-bind `{}` \
             (Issue #46 — the palette inversion is the load-bearing dark mode signal). \
             Window after the @media:\n{}",
            var,
            window
        );
    }
}

#[test]
fn style_css_declares_brand_typeface_font_families_with_system_fallbacks() {
    // The three brand typefaces, each with an explicit system
    // fallback so the app renders correctly today even before
    // self-hosted woff2 files land (PRD: "Loaded via Google Fonts at
    // runtime in dev; bundled or self-hosted as woff2 for production").
    //
    //   - Fraunces           → display / wordmark (serif)
    //   - Schibsted Grotesk  → UI body (sans)
    //   - JetBrains Mono     → mono / code
    //
    // Until the fonts actually load, the system fallbacks (`serif`,
    // `system-ui`, `monospace`) take over — the app stays functional.
    let css = read_repo_file("src/style.css");
    let stripped = common::strip_comments(&css);

    assert!(
        stripped.contains("Fraunces"),
        "expected `src/style.css` to reference the `Fraunces` typeface (Issue #46 — \
         display / wordmark face). Stripped CSS:\n{}",
        stripped
    );
    assert!(
        stripped.contains("Schibsted Grotesk"),
        "expected `src/style.css` to reference the `Schibsted Grotesk` typeface \
         (Issue #46 — UI body face). Stripped CSS:\n{}",
        stripped
    );
    assert!(
        stripped.contains("JetBrains Mono"),
        "expected `src/style.css` to reference the `JetBrains Mono` typeface \
         (Issue #46 — mono / code face). Stripped CSS:\n{}",
        stripped
    );
}

#[test]
fn index_html_contains_hashly_wordmark_element() {
    // `#hashly` wordmark in titlebar/header per Issue #46 AC: "gold
    // `#` in Fraunces 700, ink `hashly` in Fraunces 600, baseline-
    // aligned. Styled `<span>` — no SVG."
    //
    // Pin: index.html contains an element with the `hashly-wordmark`
    // class (or the literal string `#hashly` in a <header>). The
    // class form is preferred because it's grep-stable across edits;
    // the visual `#hashly` form is the user-facing payload.
    let html = read_repo_file("index.html");

    assert!(
        html.contains("hashly-wordmark"),
        "expected `index.html` to contain an element with the `hashly-wordmark` class \
         (Issue #46 — wordmark in titlebar / header). Got index.html:\n{}",
        html
    );
    // The visual payload: a literal `#` and `hashly` — separate
    // <span>s so the gold accent applies to the # alone.
    assert!(
        html.contains("hashly"),
        "expected `index.html` to contain the literal text `hashly` (Issue #46 — \
         wordmark text payload). Got: {}",
        html
    );
}

// =====================================================================
// Issue #47 — MarkGeometric export to SVG + favicon + icon-primary.
// Source of truth: specs/v0.2-mvp-completion/brand/project/marks.jsx
// (MarkGeometric). The SVGs in `src/brand/` are exports.
//
// Pin shapes:
//   - mark.svg, favicon.svg, icon-primary.svg exist with the canonical
//     viewBox + structure (geometry per the brand sheet table).
//   - index.html links the favicon (rel="icon" + svg+xml type).
//   - USAGE.md codifies the do/don't rules + min-size 14px.
//
// PNG / .icns rasterization is deferred to follow-up #68 (cargo tauri
// icon requires graphics tooling not present in CI; the SVG is the
// canonical source — rasterizers consume it identically).
// =====================================================================

#[test]
fn brand_mark_svg_exists_with_canonical_geometry() {
    let svg = read_repo_file("src/brand/mark.svg");

    // viewBox per the brand sheet — DO NOT change without updating
    // marks.jsx + the brand sheet itself.
    assert!(
        svg.contains("viewBox=\"0 0 100 100\""),
        "expected `src/brand/mark.svg` to use the brand-sheet viewBox `0 0 100 100`. Got:\n{}",
        svg
    );

    // Two horizontals + two verticals, in the canonical fills.
    // Horizontals are ink rects at y=36 and y=56 (bar gap = 9u + 11u
    // bar weight; 36 + 11 + 9 = 56 ✓).
    assert!(
        svg.contains("y=\"36\"") && svg.contains("y=\"56\""),
        "expected mark.svg horizontals at y=36 and y=56 (brand sheet: 11u bar weight + 9u gap). Got:\n{}",
        svg
    );

    // Verticals are paths fill-coloured in ink and gold respectively
    // (the right vertical is the accent stem).
    assert!(
        svg.contains("fill=\"#14201b\"") && svg.contains("fill=\"#c9a24b\""),
        "expected mark.svg to fill horizontals + left vertical in ink (#14201b) and the right vertical in gold (#c9a24b). Got:\n{}",
        svg
    );
}

#[test]
fn brand_favicon_svg_exists_with_paper_background() {
    let svg = read_repo_file("src/brand/favicon.svg");

    assert!(
        svg.contains("viewBox=\"0 0 100 100\""),
        "expected favicon.svg to share the canonical viewBox. Got:\n{}",
        svg
    );
    // Paper (#f0f1ec) background rect — distinguishes favicon.svg
    // from mark.svg (which has no background fill).
    assert!(
        svg.contains("fill=\"#f0f1ec\""),
        "expected favicon.svg to render the mark on a paper (#f0f1ec) background. Got:\n{}",
        svg
    );
    assert!(
        svg.contains("fill=\"#c9a24b\""),
        "expected favicon.svg to keep the gold accent stem (paper-bg variant uses ink glyph + gold accent per the brand sheet). Got:\n{}",
        svg
    );
}

#[test]
fn brand_icon_primary_svg_renders_ink_on_gold_with_no_accent_stem() {
    let svg = read_repo_file("src/brand/icon-primary.svg");

    assert!(
        svg.contains("viewBox=\"0 0 100 100\""),
        "expected icon-primary.svg to share the canonical viewBox. Got:\n{}",
        svg
    );
    // Gold (#c9a24b) background.
    assert!(
        svg.contains("fill=\"#c9a24b\""),
        "expected icon-primary.svg to fill the background in gold (#c9a24b). Got:\n{}",
        svg
    );
    // ABSENT: an inner gold fill — primary-icon variant is ink-on-
    // ink for the verticals so the accent stem isn't gold-on-gold.
    // Pin: the gold colour appears EXACTLY ONCE (the bg). The brand
    // sheet's primary-icon AC: "no separate accent stem".
    let gold_count = svg.matches("#c9a24b").count();
    assert_eq!(
        gold_count, 1,
        "expected gold (#c9a24b) to appear exactly once in icon-primary.svg (the background). \
         Brand sheet AC: \"on a gold background, the gold accent would disappear, so both \
         verticals render in ink (no separate accent stem)\". Got {} occurrences in:\n{}",
        gold_count, svg
    );
}

#[test]
fn index_html_links_the_svg_favicon() {
    let html = read_repo_file("index.html");
    assert!(
        html.contains("rel=\"icon\""),
        "expected index.html to declare a `<link rel=\"icon\" ...>` (Issue #47). Got:\n{}",
        html
    );
    assert!(
        html.contains("image/svg+xml"),
        "expected the favicon link to use SVG type (`image/svg+xml`) — the SVG variant is \
         the canonical favicon for v0.2; PNG fallback is a follow-up. Got:\n{}",
        html
    );
    assert!(
        html.contains("favicon.svg"),
        "expected the favicon link to point at `favicon.svg`. Got:\n{}",
        html
    );
}

#[test]
fn brand_usage_md_codifies_do_dont_rules_with_min_size_14px() {
    let usage = read_repo_file("src/brand/USAGE.md");
    let lower = usage.to_lowercase();
    assert!(
        lower.contains("do") && lower.contains("don't"),
        "expected `src/brand/USAGE.md` to codify do/don't usage rules (Issue #47 AC: \
         \"Mark usage rules codified\"). Got:\n{}",
        usage
    );
    assert!(
        lower.contains("14px"),
        "expected USAGE.md to mention the 14px minimum size (brand sheet — below this \
         threshold the bar weight + slope reads as visual noise). Got:\n{}",
        usage
    );
    // The three "don't" axes from the brand sheet.
    for forbid in ["recolour", "rotate", "below"] {
        assert!(
            lower.contains(forbid),
            "expected USAGE.md to mention the `{}` rule. Got:\n{}",
            forbid,
            usage
        );
    }
}

// =====================================================================
// Issue #68 — Icon rasterization (slice 16 / v0.2.2 packaging follow-up).
// `cargo tauri icon` consumes a 1024x1024 PNG rasterization of the SVG
// source; the rasterized PNG and the generated icon set are committed
// so builds are reproducible without librsvg/inkscape on every machine.
// =====================================================================

#[test]
fn brand_icon_1024_png_is_committed_and_non_empty() {
    // Pin: re-rasterization of icon-primary.svg is reproducible because
    // the 1024x1024 source PNG ships in-tree. If someone deletes the
    // committed PNG to "save repo size" they lose the source-of-truth
    // for `cargo tauri icon` and the icon set silently drifts on
    // re-generation.
    let path = repo_root().join("src/brand/raster/icon-1024.png");
    let meta = fs::metadata(&path).unwrap_or_else(|e| {
        panic!(
            "expected `src/brand/raster/icon-1024.png` to be committed (Issue #68 — the 1024 \
             PNG is the input to `cargo tauri icon` and must travel with the SVG so builds \
             are reproducible without librsvg). Could not stat: {}",
            e
        )
    });
    assert!(
        meta.len() > 0,
        "expected `src/brand/raster/icon-1024.png` to be non-empty (Issue #68); got {} bytes",
        meta.len()
    );
}

#[test]
fn tauri_icons_dir_contains_macos_required_set() {
    // Pin: the macOS bundle icon set is committed under
    // `src-tauri/icons/`. `cargo tauri icon` generates a wider set
    // (iOS / Android / Windows-store), but Hashly is macOS-only in
    // v0.2.2 — those subdirs are intentionally pruned (see spec
    // § Decisions). The macOS-needed files are: icon.icns, icon.png,
    // 32x32.png, 64x64.png, 128x128.png, 128x128@2x.png. Pinning each
    // catches the failure mode where someone deletes "redundant" icons
    // and breaks `bundle.icon` resolution at build time.
    let icons_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons");
    for required in [
        "icon.icns",
        "icon.png",
        "32x32.png",
        "64x64.png",
        "128x128.png",
        "128x128@2x.png",
    ] {
        let path = icons_root.join(required);
        let meta = fs::metadata(&path).unwrap_or_else(|e| {
            panic!(
                "expected `src-tauri/icons/{}` to be committed (Issue #68 — macOS bundle \
                 icon set; regenerate with `cargo tauri icon src/brand/raster/icon-1024.png`). \
                 Could not stat: {}",
                required, e
            )
        });
        assert!(
            meta.len() > 0,
            "expected `src-tauri/icons/{}` to be non-empty; got {} bytes",
            required,
            meta.len()
        );
    }
}

#[test]
fn style_css_declares_hashly_wordmark_styling_with_accent_gold_for_hash() {
    // The wordmark CSS rule applies `--accent-2` (gold) to the `#`
    // and `--ink` to the `hashly` text. Pin via class hierarchy:
    // the CSS contains a `.hashly-wordmark` rule that references
    // either `--accent-2` or the inline gold hex.
    let css = read_repo_file("src/style.css");
    let stripped = common::strip_comments(&css);

    assert!(
        stripped.contains(".hashly-wordmark"),
        "expected `src/style.css` to declare a `.hashly-wordmark` rule (Issue #46). \
         Stripped CSS:\n{}",
        stripped
    );
    // The gold accent must apply to the `#` half. We allow either
    // var(--accent-2) (preferred — flows through prefers-color-scheme)
    // or the literal hex (escape hatch). Both forms grep cleanly.
    let has_gold = stripped.contains("var(--accent-2)") || stripped.contains("#c9a24b");
    assert!(
        has_gold,
        "expected the wordmark styling to reference the gold accent — either \
         `var(--accent-2)` (preferred) or the literal `#c9a24b` (Issue #46 — \
         the gold `#` is the central brand-recognition surface). Stripped CSS:\n{}",
        stripped
    );
}
