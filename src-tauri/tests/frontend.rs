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

#[test]
fn frontend_main_ts_configures_editor_as_read_only() {
    // AC #3: editor is read-only — no caret, can't type. Milkdown does this via
    // editorViewOptionsCtx { editable: () => false }.
    let main_ts = read_repo_file("src/main.ts");

    assert!(
        main_ts.contains("editorViewOptionsCtx"),
        "expected src/main.ts to reference `editorViewOptionsCtx` to configure read-only mode, got:\n{}",
        main_ts
    );

    // Allow whitespace flexibility: `editable: () => false`, `editable : ( ) => false`, etc.
    let normalized: String = main_ts.chars().filter(|c| !c.is_whitespace()).collect();
    assert!(
        normalized.contains("editable:()=>false"),
        "expected src/main.ts to set `editable: () => false` (whitespace-insensitive) so the editor is read-only, got:\n{}",
        main_ts
    );
}
