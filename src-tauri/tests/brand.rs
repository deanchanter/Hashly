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
