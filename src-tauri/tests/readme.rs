use std::fs;
use std::path::PathBuf;

#[test]
fn readme_documents_cargo_tauri_dev() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("README.md");
    let readme = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e));
    assert!(
        readme.contains("cargo tauri dev"),
        "expected README.md to mention `cargo tauri dev`"
    );
}
