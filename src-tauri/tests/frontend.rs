use std::fs;
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn read_repo_file(rel: &str) -> String {
    let path = repo_root().join(rel);
    fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e))
}

#[test]
fn frontend_index_html_mounts_milkdown_editor_root() {
    // AC #1: window contents replaced by a Milkdown instance (no more raw <h1>Hello Hashly</h1>).
    // The Vite-owned entry HTML lives at the repo root after this slice.
    let html = read_repo_file("index.html");

    assert!(
        html.contains(r#"id="editor""#),
        "expected /index.html to contain a Milkdown mount point with id=\"editor\", got:\n{}",
        html
    );
    assert!(
        html.contains(r#"<script type="module""#),
        "expected /index.html to contain a `<script type=\"module\"` tag, got:\n{}",
        html
    );
    assert!(
        html.contains("/src/main.ts"),
        "expected /index.html's module script to point at `/src/main.ts`, got:\n{}",
        html
    );
    assert!(
        !html.contains("<h1>Hello Hashly</h1>"),
        "expected /index.html to NO LONGER contain the hello-world heading `<h1>Hello Hashly</h1>`, got:\n{}",
        html
    );
}

#[test]
fn frontend_main_ts_imports_milkdown_core_and_commonmark() {
    // AC #1 + #2: Milkdown core is wired up with the commonmark preset so `# Hello` renders as H1.
    let main_ts = read_repo_file("src/main.ts");

    assert!(
        main_ts.contains("@milkdown/core"),
        "expected src/main.ts to import from `@milkdown/core`, got:\n{}",
        main_ts
    );
    assert!(
        main_ts.contains("@milkdown/preset-commonmark"),
        "expected src/main.ts to import from `@milkdown/preset-commonmark`, got:\n{}",
        main_ts
    );
    assert!(
        main_ts.contains("Editor.make()"),
        "expected src/main.ts to contain `Editor.make()`, got:\n{}",
        main_ts
    );
    assert!(
        main_ts.contains(".create()"),
        "expected src/main.ts to contain `.create()`, got:\n{}",
        main_ts
    );
}

#[test]
fn package_json_declares_milkdown_dependencies() {
    // AC #1 + #2: the JS toolkit declares Milkdown so `npm install` actually pulls it in.
    let raw = read_repo_file("package.json");
    let pkg: serde_json::Value =
        serde_json::from_str(&raw).expect("package.json is not valid JSON");

    let deps = pkg
        .get("dependencies")
        .and_then(|d| d.as_object())
        .expect("expected `dependencies` object in package.json");

    let core = deps
        .get("@milkdown/core")
        .unwrap_or_else(|| panic!("expected dependencies[\"@milkdown/core\"] in package.json"));
    assert!(
        core.is_string(),
        "expected dependencies[\"@milkdown/core\"] to be a version string, got: {:?}",
        core
    );

    let commonmark = deps.get("@milkdown/preset-commonmark").unwrap_or_else(|| {
        panic!("expected dependencies[\"@milkdown/preset-commonmark\"] in package.json")
    });
    assert!(
        commonmark.is_string(),
        "expected dependencies[\"@milkdown/preset-commonmark\"] to be a version string, got: {:?}",
        commonmark
    );
}

#[test]
fn frontend_main_ts_uses_hello_h1_default_value() {
    // AC #2: Milkdown renders the literal `# Hello` string as a styled H1.
    let main_ts = read_repo_file("src/main.ts");

    let has_hello_literal = main_ts.contains("'# Hello'") || main_ts.contains("\"# Hello\"");
    assert!(
        has_hello_literal,
        "expected src/main.ts to contain the string literal `# Hello` (single- or double-quoted), got:\n{}",
        main_ts
    );
    assert!(
        main_ts.contains("defaultValueCtx"),
        "expected src/main.ts to wire the default value via `defaultValueCtx`, got:\n{}",
        main_ts
    );
}

/// Strip `//` line comments and `/* ... */` block comments from a TS/JS source string.
///
/// This is intentionally a hand-rolled, stdlib-only stripper (no `regex` dep on
/// `src-tauri/Cargo.toml`). It is purposely conservative — it does NOT try to be a
/// full TS parser. In particular it ignores the possibility of `//` or `/*` appearing
/// inside string literals or regexes; that's fine for our use case because the tests
/// that consume this only assert literal substrings of TS we ourselves write.
///
/// The point of stripping comments before doing substring assertions is to defend
/// against a contributor "preserving" a contractual literal in a comment while
/// deleting the real call — e.g. leaving `// editable: () => false` after removing
/// the actual `ctx.update(...)` line. Without stripping, that bypass would silently
/// pass the read-only test.
fn strip_ts_comments(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut chars = src.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '/' {
            match chars.peek() {
                Some('/') => {
                    // Line comment — consume up to (but not including) the newline,
                    // so line breaks are preserved for any downstream line-based logic.
                    chars.next(); // consume the second '/'
                    while let Some(&nc) = chars.peek() {
                        if nc == '\n' {
                            break;
                        }
                        chars.next();
                    }
                    continue;
                }
                Some('*') => {
                    // Block comment — consume up to and including the closing `*/`.
                    chars.next(); // consume the '*'
                    while let Some(nc) = chars.next() {
                        if nc == '*' {
                            if let Some(&'/') = chars.peek() {
                                chars.next(); // consume the '/'
                                break;
                            }
                        }
                    }
                    continue;
                }
                _ => {}
            }
        }
        out.push(c);
    }
    out
}

#[test]
fn frontend_main_ts_configures_editor_as_read_only() {
    // AC #3: editor is read-only — no caret, can't type. Milkdown does this via
    // editorViewOptionsCtx { editable: () => false }.
    //
    // Tightening (P1 #1 from the verify pass on Issue #2): the previous version of
    // this test whitespace-stripped the entire file and substring-matched
    // `editable:()=>false`. That meant a contributor could DELETE the real
    // `ctx.update(editorViewOptionsCtx, ...)` call, leave a comment like
    // `// editable: () => false  TODO restore`, and the test would still pass —
    // defending nothing. We now strip `//` and `/* ... */` comments before
    // normalizing, so a comment-only "ghost" of the literal will not satisfy the
    // assertion.
    let main_ts = read_repo_file("src/main.ts");
    let stripped = strip_ts_comments(&main_ts);

    assert!(
        stripped.contains("editorViewOptionsCtx"),
        "expected src/main.ts to reference `editorViewOptionsCtx` (in real code, not a comment) to configure read-only mode, got after comment-strip:\n{}",
        stripped
    );

    // Allow whitespace flexibility: `editable: () => false`, `editable : ( ) => false`, etc.
    let normalized: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();
    assert!(
        normalized.contains("editable:()=>false"),
        "expected src/main.ts to set `editable: () => false` (whitespace-insensitive, in real code not a comment) so the editor is read-only, got after comment-strip:\n{}",
        stripped
    );
}

#[test]
fn frontend_main_ts_imports_prosemirror_baseline_css() {
    // P1 #2 from the verify pass on Issue #2:
    // ProseMirror baseline CSS — selection styling, whitespace handling (white-space:
    // pre-wrap on `.ProseMirror`), node-selection outlines — must be present, or
    // read-mode will visibly break the moment Issue #3 lands a real CommonMark
    // fixture (e.g. multi-paragraph content collapses, selection has no visual).
    //
    // The exact import path is part of the contract — it's the only entry point
    // Milkdown re-exports for the upstream ProseMirror stylesheet — so we pin it
    // verbatim. This is brittle on purpose: if upstream renames the path, we WANT
    // to be told.
    let main_ts = read_repo_file("src/main.ts");

    assert!(
        main_ts.contains("@milkdown/prose/lib/style/prosemirror.css"),
        "expected src/main.ts to import `@milkdown/prose/lib/style/prosemirror.css` so ProseMirror's baseline selection / whitespace / node-selection styles ship with the editor, got:\n{}",
        main_ts
    );
}

#[test]
fn frontend_main_ts_sets_aria_readonly_on_editor_root() {
    // P1 #3 from the verify pass on Issue #2:
    // Milkdown sets `role="textbox"` on the ProseMirror root unconditionally.
    // ProseMirror's `editable: () => false` only flips the `contenteditable`
    // attribute — it does NOT touch ARIA. As a result a screen reader (VoiceOver
    // on macOS, in particular) will announce a read-only doc as an editable
    // textbox, which is a serious a11y regression for AC #3.
    //
    // The fix is to wire `EditorProps.attributes` on `editorViewOptionsCtx` so
    // the root DOM node carries `aria-readonly="true"`. ProseMirror's
    // `attributes` field maps DOM attribute names to string values; either
    // `attributes: { 'aria-readonly': 'true' }` or
    // `attributes: () => ({ 'aria-readonly': 'true' })` is acceptable. After
    // whitespace stripping, both forms produce the substring
    // `'aria-readonly':'true'` (or its double-quoted equivalent).
    let main_ts = read_repo_file("src/main.ts");
    let stripped = strip_ts_comments(&main_ts);
    let normalized: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();

    let has_single = normalized.contains("'aria-readonly':'true'");
    let has_double = normalized.contains("\"aria-readonly\":\"true\"");

    assert!(
        has_single || has_double,
        "expected src/main.ts to set `aria-readonly: 'true'` on the editor root (via editorViewOptionsCtx → EditorProps.attributes) so screen readers announce read-only state, got after comment-strip:\n{}",
        stripped
    );
}
