use std::fs;
use std::path::PathBuf;

fn dist_index() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("dist")
        .join("index.html");
    fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e))
}

#[test]
fn index_html_renders_hello_hashly_heading() {
    let html = dist_index();
    assert!(
        html.contains("<h1>Hello Hashly</h1>"),
        "expected dist/index.html to contain `<h1>Hello Hashly</h1>`, got:\n{}",
        html
    );
}
