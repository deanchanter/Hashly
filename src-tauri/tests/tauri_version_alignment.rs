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

/// Extract the major + minor numbers from a SemVer-ish string like
/// `2.11.0` or `2.11.0-beta.1`. Panics with a descriptive message if
/// the input doesn't look like `MAJOR.MINOR.…`.
fn major_minor(version: &str, source: &str) -> (u32, u32) {
    let mut parts = version.split('.');
    let major = parts
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or_else(|| panic!("could not parse major version from {source} = {version:?}"));
    let minor_raw = parts
        .next()
        .unwrap_or_else(|| panic!("could not find minor version in {source} = {version:?}"));
    // Strip any pre-release / build suffix (e.g. `0-beta.1`) before parsing.
    let minor_digits: String = minor_raw.chars().take_while(|c| c.is_ascii_digit()).collect();
    let minor = minor_digits.parse::<u32>().unwrap_or_else(|_| {
        panic!("could not parse minor version from {source} = {version:?}")
    });
    (major, minor)
}

/// Pull the resolved `version = "…"` for the `[[package]] name = "tauri"`
/// entry out of Cargo.lock. The lockfile is small, so a flat text scan
/// is sufficient and avoids adding a TOML parser dev-dep just for this.
fn cargo_lock_tauri_version() -> String {
    let lock = read_repo_file("Cargo.lock");
    let needle = "name = \"tauri\"\n";
    let idx = lock.find(needle).unwrap_or_else(|| {
        panic!(
            "expected `name = \"tauri\"` package entry in Cargo.lock; \
             without it, the version-alignment check has nothing to compare against"
        )
    });
    let after = &lock[idx + needle.len()..];
    let version_line = after
        .lines()
        .find(|l| l.trim_start().starts_with("version = "))
        .unwrap_or_else(|| {
            panic!(
                "expected a `version = …` line under [[package]] name = \"tauri\" in Cargo.lock; \
                 lockfile shape changed?"
            )
        });
    let version = version_line
        .trim_start()
        .trim_start_matches("version = ")
        .trim()
        .trim_matches('"');
    version.to_string()
}

/// Pull the resolved `version` for `node_modules/@tauri-apps/api` out
/// of package-lock.json (npm lockfile v2/v3 schema).
fn package_lock_tauri_api_version() -> String {
    let raw = read_repo_file("package-lock.json");
    let lock: serde_json::Value =
        serde_json::from_str(&raw).expect("package-lock.json is not valid JSON");
    let packages = lock
        .get("packages")
        .and_then(|p| p.as_object())
        .expect(
            "expected `packages` object in package-lock.json (npm lockfile v2/v3); \
             on v1 lockfiles this test would need to read `dependencies` instead",
        );
    let entry = packages
        .get("node_modules/@tauri-apps/api")
        .and_then(|v| v.as_object())
        .unwrap_or_else(|| {
            panic!(
                "expected `packages[\"node_modules/@tauri-apps/api\"]` entry in package-lock.json; \
                 if @tauri-apps/api was hoisted somewhere unusual, update this test to find it"
            )
        });
    let version = entry
        .get("version")
        .and_then(|v| v.as_str())
        .expect("expected `version` string under packages[\"node_modules/@tauri-apps/api\"]");
    version.to_string()
}

#[test]
fn tauri_rust_crate_and_npm_api_share_major_minor() {
    // Tauri warns at app boot when the Rust `tauri` crate's major/minor
    // doesn't match the JS `@tauri-apps/api` package's major/minor:
    //
    //   "Found version mismatched Tauri packages. Make sure the NPM
    //    package and Rust crate versions are on the same major/minor
    //    releases:
    //      tauri (v2.10.3) : @tauri-apps/api (v2.11.0)"
    //
    // The two halves talk over an IPC surface (`window.__TAURI_INTERNALS__`,
    // `invoke`, event channels) that evolves between minors. A drift means
    // commands silently misbehave or stop working entirely at runtime.
    //
    // Both manifest ranges are `^2`, so a plain `cargo update` or
    // `npm install` can drag one side to a new minor while the other
    // stays put. This test pins the RESOLVED lockfile versions, not the
    // manifest ranges, so the drift surfaces in CI rather than at app
    // launch.
    //
    // Fix when this test fires: bump whichever side is behind, e.g.
    //   cargo update -p tauri -p tauri-build -p tauri-plugin-dialog
    //   # or
    //   npm install @tauri-apps/api@latest @tauri-apps/plugin-dialog@latest
    let rust_version = cargo_lock_tauri_version();
    let npm_version = package_lock_tauri_api_version();

    let rust_mm = major_minor(&rust_version, "Cargo.lock tauri");
    let npm_mm = major_minor(&npm_version, "package-lock.json @tauri-apps/api");

    assert_eq!(
        rust_mm, npm_mm,
        "Tauri Rust crate and @tauri-apps/api NPM package must share major/minor — \
         got tauri (v{rust_version}) : @tauri-apps/api (v{npm_version}). \
         Bump the lagging side: `cargo update -p tauri -p tauri-build -p tauri-plugin-dialog` \
         (Rust) or `npm install @tauri-apps/api@latest @tauri-apps/plugin-dialog@latest` (NPM)."
    );
}
