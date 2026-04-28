use std::fs;
use std::path::PathBuf;

fn load_config() -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e));
    serde_json::from_str(&raw).expect("tauri.conf.json is not valid JSON")
}

#[test]
fn window_is_titled_hashly() {
    let cfg = load_config();
    let windows = cfg
        .pointer("/app/windows")
        .and_then(|w| w.as_array())
        .expect("expected app.windows array in tauri.conf.json");
    assert!(!windows.is_empty(), "expected at least one window definition");
    let title = windows[0]
        .get("title")
        .and_then(|t| t.as_str())
        .expect("first window must have a title");
    assert_eq!(title, "Hashly");
}
