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
