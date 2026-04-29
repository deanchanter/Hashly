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

#[test]
fn tauri_conf_has_before_dev_and_build_commands() {
    // Issue #2: tauri must hand frontend lifecycle to Vite.
    let cfg = load_config();
    let build = cfg
        .get("build")
        .and_then(|b| b.as_object())
        .expect("expected `build` object in tauri.conf.json");

    let before_dev = build
        .get("beforeDevCommand")
        .and_then(|v| v.as_str())
        .expect("expected build.beforeDevCommand in tauri.conf.json");
    assert_eq!(
        before_dev, "npm run dev",
        "expected build.beforeDevCommand == \"npm run dev\""
    );

    let before_build = build
        .get("beforeBuildCommand")
        .and_then(|v| v.as_str())
        .expect("expected build.beforeBuildCommand in tauri.conf.json");
    assert_eq!(
        before_build, "npm run build",
        "expected build.beforeBuildCommand == \"npm run build\""
    );

    let dev_url = build
        .get("devUrl")
        .and_then(|v| v.as_str())
        .expect("expected build.devUrl in tauri.conf.json");
    assert_eq!(
        dev_url, "http://localhost:1420",
        "expected build.devUrl == \"http://localhost:1420\""
    );

    let frontend_dist = build
        .get("frontendDist")
        .and_then(|v| v.as_str())
        .expect("expected build.frontendDist in tauri.conf.json");
    assert_eq!(
        frontend_dist, "../dist",
        "expected build.frontendDist == \"../dist\""
    );
}
