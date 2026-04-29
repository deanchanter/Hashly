use std::fs;
use std::path::PathBuf;

fn read_readme() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("README.md");
    fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e))
}

#[test]
fn readme_documents_cargo_tauri_dev() {
    let readme = read_readme();
    assert!(
        readme.contains("cargo tauri dev"),
        "expected README.md to mention `cargo tauri dev`"
    );
}

#[test]
fn readme_documents_npm_install() {
    // Issue #2: the JS toolkit is now part of the dev workflow — README must say so.
    let readme = read_readme();
    assert!(
        readme.contains("npm install"),
        "expected README.md to mention `npm install` so contributors know to set up the JS toolkit"
    );
}

#[test]
fn readme_documents_npm_test_command() {
    // Issue #18 AC #5: README must mention `npm test` alongside `cargo test`
    // so contributors know the frontend Vitest suite is part of the standard
    // verification flow. Mirrors `readme_documents_npm_install` (Issue #2).
    let readme = read_readme();
    assert!(
        readme.contains("npm test"),
        "expected README.md to mention `npm test` alongside `cargo test` (Issue #18 AC #5)"
    );
}

#[test]
fn readme_documents_frontend_test_location_convention() {
    // Issue #18 AC #4: test files are colocated under `src/__tests__/` and that
    // choice is documented so a future contributor doesn't sprinkle Vitest files
    // elsewhere. The README is the canonical home for "where tests live"
    // alongside the existing `cargo test` / `npm test` lines.
    let readme = read_readme();
    assert!(
        readme.contains("src/__tests__/"),
        "expected README.md to mention `src/__tests__/` so the frontend-test location convention is documented (Issue #18 AC #4)"
    );
}
