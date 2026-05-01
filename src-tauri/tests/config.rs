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
fn tauri_conf_app_security_csp_is_restrictive_and_set() {
    // Issue #4 — Before the app reads arbitrary user markdown via File>Open,
    // the WebView must run under a restrictive Content-Security-Policy. The
    // null-CSP that ships in the default Tauri scaffold (`"csp": null`) means
    // the WebView accepts any script source, including `'unsafe-inline'`,
    // which is exactly the threat surface raw markdown can attack
    // (script-as-data injection through Milkdown's HTML escape path or any
    // future plugin that rewrites HTML).
    //
    // Contract pinned here:
    //   1. `app.security.csp` exists and is a STRING (not null, not an array,
    //      not an object). Tauri 2 supports object-form CSP for per-source
    //      overrides, but we want the simplest auditable form: one string.
    //   2. The CSP contains a `default-src 'self'` directive. Without
    //      default-src the policy degrades to `*` for any directive not
    //      explicitly listed, which is the same as no policy.
    //   3. The CSP contains a `script-src` directive — explicit, not relying
    //      on default-src fallback — so a future contributor cannot weaken
    //      the script policy by editing only default-src.
    //   4. The script-src directive does NOT contain `'unsafe-inline'`. This
    //      is the security ask: inline scripts are the primary attack vector
    //      for script-as-data in markdown. Style-src may carry
    //      `'unsafe-inline'` (Milkdown injects inline styles); that is
    //      acceptable and is NOT what this test forbids.
    //   5. The CSP contains `script-src 'self'` (so first-party Vite-built
    //      assets are allowed to execute). Pinning the literal substring also
    //      catches a regression where someone deletes `'self'` from
    //      script-src and the WebView refuses to load main.ts entirely.
    let cfg = load_config();
    let security = cfg
        .pointer("/app/security")
        .and_then(|s| s.as_object())
        .expect("expected app.security object in tauri.conf.json (Issue #4)");

    let csp_value = security.get("csp").unwrap_or_else(|| {
        panic!(
            "expected app.security.csp key to be present in tauri.conf.json (Issue #4); \
             got app.security = {:?}",
            security
        )
    });
    let csp = csp_value.as_str().unwrap_or_else(|| {
        panic!(
            "expected app.security.csp to be a non-null STRING (Issue #4 — the default \
             scaffold ships `\"csp\": null`, which permits any script source); got: {:?}",
            csp_value
        )
    });
    assert!(
        !csp.trim().is_empty(),
        "expected app.security.csp to be a non-empty CSP string (Issue #4); got: {:?}",
        csp
    );

    // Split on `;` so we can examine individual directives without false-
    // matching `script-src` against `default-src` (or vice versa) by
    // substring alone.
    let directives: Vec<&str> = csp
        .split(';')
        .map(|d| d.trim())
        .filter(|d| !d.is_empty())
        .collect();

    let default_src = directives
        .iter()
        .find(|d| d.starts_with("default-src"))
        .copied()
        .unwrap_or_else(|| {
            panic!(
                "expected CSP to contain a `default-src` directive (Issue #4 — without it, \
                 unlisted directives fall back to `*`). CSP was: {:?}",
                csp
            )
        });
    assert!(
        default_src.contains("'self'"),
        "expected CSP `default-src` directive to include `'self'` (Issue #4). default-src was: {:?}",
        default_src
    );

    let script_src = directives
        .iter()
        .find(|d| d.starts_with("script-src"))
        .copied()
        .unwrap_or_else(|| {
            panic!(
                "expected CSP to contain an EXPLICIT `script-src` directive (Issue #4 — \
                 relying on default-src fallback is fragile; a future edit to default-src \
                 would silently widen the script policy). CSP was: {:?}",
                csp
            )
        });
    assert!(
        script_src.contains("'self'"),
        "expected CSP `script-src` directive to include `'self'` so first-party Vite-built \
         assets can execute (Issue #4). script-src was: {:?}",
        script_src
    );
    assert!(
        !script_src.contains("'unsafe-inline'"),
        "expected CSP `script-src` directive to NOT include `'unsafe-inline'` (Issue #4 — \
         this is the core security ask: inline scripts are the primary attack vector for \
         script-as-data injection through markdown). script-src was: {:?}",
        script_src
    );
    assert!(
        !script_src.contains("'unsafe-eval'"),
        "expected CSP `script-src` directive to NOT include `'unsafe-eval'` (Issue #4 — \
         eval-based script execution is just as dangerous as inline scripts for \
         script-as-data injection). script-src was: {:?}",
        script_src
    );
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
