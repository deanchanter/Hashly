use std::fs;
use std::path::PathBuf;

mod common;

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
fn package_json_declares_vitest_dev_dependency() {
    // Issue #18 AC #1: Vitest must be added as a devDependency so the harness
    // is reproducible on a fresh `npm install`. This test pins the contract
    // independent of whether `node_modules/` happens to be populated locally.
    let raw = read_repo_file("package.json");
    let pkg: serde_json::Value =
        serde_json::from_str(&raw).expect("package.json is not valid JSON");

    let dev_deps = pkg
        .get("devDependencies")
        .and_then(|d| d.as_object())
        .expect("expected `devDependencies` object in package.json");

    let vitest = dev_deps.get("vitest").unwrap_or_else(|| {
        panic!(
            "expected devDependencies[\"vitest\"] in package.json (Issue #18 AC #1); got devDependencies = {:?}",
            dev_deps
        )
    });
    assert!(
        vitest.is_string(),
        "expected devDependencies[\"vitest\"] to be a version string, got: {:?}",
        vitest
    );
}

#[test]
fn package_json_declares_jsdom_dev_dependency() {
    // Issue #18 AC #1: jsdom is the picked DOM environment for Vitest
    // (Milkdown's ProseMirror baseline needs full DOM APIs that happy-dom
    // historically gaps on). Pin it so the choice is contractual, not implicit.
    let raw = read_repo_file("package.json");
    let pkg: serde_json::Value =
        serde_json::from_str(&raw).expect("package.json is not valid JSON");

    let dev_deps = pkg
        .get("devDependencies")
        .and_then(|d| d.as_object())
        .expect("expected `devDependencies` object in package.json");

    let jsdom = dev_deps.get("jsdom").unwrap_or_else(|| {
        panic!(
            "expected devDependencies[\"jsdom\"] in package.json (Issue #18 AC #1); got devDependencies = {:?}",
            dev_deps
        )
    });
    assert!(
        jsdom.is_string(),
        "expected devDependencies[\"jsdom\"] to be a version string, got: {:?}",
        jsdom
    );
}

#[test]
fn package_json_test_script_invokes_vitest() {
    // Issue #18 AC #2: `npm test` must run Vitest. The script must invoke
    // `vitest` (typically `vitest run` for one-shot CI-friendly mode); the
    // test asserts the binary name appears in the script value.
    let raw = read_repo_file("package.json");
    let pkg: serde_json::Value =
        serde_json::from_str(&raw).expect("package.json is not valid JSON");

    let scripts = pkg
        .get("scripts")
        .and_then(|s| s.as_object())
        .expect("expected `scripts` object in package.json");

    let test_script = scripts.get("test").and_then(|v| v.as_str()).unwrap_or_else(|| {
        panic!(
            "expected scripts[\"test\"] string in package.json so `npm test` is wired (Issue #18 AC #2); got scripts = {:?}",
            scripts
        )
    });

    assert!(
        test_script.contains("vitest"),
        "expected scripts[\"test\"] to invoke `vitest` (e.g. `vitest run`), got: {:?}",
        test_script
    );
}

#[test]
fn vitest_config_ts_exists_at_repo_root() {
    // Issue #18 AC #1: a checked-in `vitest.config.ts` is part of the
    // contract — it pins the test environment (jsdom), the include glob
    // (so `src/__tests__/*.test.ts` is discovered), and any setup files.
    // Existence + jsdom mention is asserted; details are exercised by
    // `npm test` itself.
    let path = repo_root().join("vitest.config.ts");
    assert!(
        path.exists(),
        "expected `vitest.config.ts` at repo root (Issue #18 AC #1), but {} does not exist",
        path.display()
    );

    let cfg = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e));
    assert!(
        cfg.contains("jsdom"),
        "expected `vitest.config.ts` to configure the `jsdom` test environment (Issue #18 AC #1), got:\n{}",
        cfg
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

// The TS/JS comment stripper used by the substring-defense tests below
// lives in `tests/common/mod.rs` as `common::strip_comments` (Issue #25).
// The previous local `strip_ts_comments` was a simpler, string-literal-
// UNAWARE stripper — a latent landmine if `src/main.ts` ever grew a
// `/*` inside a string literal. The shared helper is a strict superset
// of that behavior, so call sites were renamed in place and behavior
// is preserved AND hardened.

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
    let stripped = common::strip_comments(&main_ts);

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
        main_ts.contains("@milkdown/prose/view/style/prosemirror.css"),
        "expected src/main.ts to import `@milkdown/prose/view/style/prosemirror.css` so ProseMirror's baseline selection / whitespace / node-selection styles ship with the editor, got:\n{}",
        main_ts
    );
}

#[test]
fn frontend_main_ts_exposes_bootstrap_named_export_and_gates_auto_mount() {
    // Issue #22 — Guard src/main.ts auto-mount against test-time side
    // effects. Pins the static-contract half of the issue:
    //
    //   - AC #2: a named `bootstrap` export must exist (so tests and
    //     non-entry callers can drive the mount path explicitly), AND
    //     the module-top-level auto-call must be gated on a `MODE !==
    //     'test'` (or analogous) check so importing `../main` under
    //     Vitest is a no-op.
    //
    //   - AC #1: the missing-host warn string is part of the public
    //     contract (downstream log filters / dashboards key on it).
    //     We pin the verbatim string here in addition to the dynamic
    //     vitest assertion in `src/__tests__/bootstrap.test.ts` so the
    //     CI cargo job catches a copy-edit drift even if vitest is
    //     skipped (e.g. the npm job is broken / disabled).
    //
    // Comments are stripped before matching so a contributor cannot
    // satisfy the contract by leaving a `// import.meta.env.MODE` ghost
    // while the real gate is missing — same defense pattern as
    // `frontend_main_ts_configures_editor_as_read_only` above.
    let main_ts = read_repo_file("src/main.ts");
    let stripped = common::strip_comments(&main_ts);

    // Named `bootstrap` export. Accept the three forms TypeScript
    // permits: function declaration, async function declaration, and
    // const-assigned function expression / arrow.
    let has_function_export = stripped.contains("export function bootstrap")
        || stripped.contains("export async function bootstrap")
        || stripped.contains("export const bootstrap");
    assert!(
        has_function_export,
        "expected src/main.ts to expose a named `bootstrap` export — \
         `export function bootstrap`, `export async function bootstrap`, \
         or `export const bootstrap` (Issue #22 AC #2/#3). After comment-strip:\n{}",
        stripped
    );

    // Gate expression on the auto-call. The recommended gate is
    // `import.meta.env.MODE !== 'test'`; we accept either quote style
    // for the string literal but require the operator and operand
    // pairing to be exactly that (so a contributor doesn't accidentally
    // weaken it to `=== 'production'`, which would also disable the
    // dev-server auto-mount we explicitly want to keep).
    let normalized: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();
    let has_single_quoted = normalized.contains("import.meta.env.MODE!=='test'");
    let has_double_quoted = normalized.contains("import.meta.env.MODE!==\"test\"");
    assert!(
        has_single_quoted || has_double_quoted,
        "expected src/main.ts to gate the auto-mount on `import.meta.env.MODE !== 'test'` \
         (Issue #22 AC #2) — this is the only gate that lets dev AND production \
         auto-mount while suppressing it under Vitest. After comment-strip:\n{}",
        stripped
    );

    // Verbatim warn-string pinning (also exercised dynamically in
    // src/__tests__/bootstrap.test.ts). Pinned in stripped source so a
    // commented-out copy of the literal does not satisfy this.
    assert!(
        stripped.contains("[hashly] #editor host element not found; mountEditor not auto-invoked"),
        "expected src/main.ts to log the contracted warn string \
         `[hashly] #editor host element not found; mountEditor not auto-invoked` \
         when the #editor host is missing (Issue #22 AC #1). After comment-strip:\n{}",
        stripped
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
    let stripped = common::strip_comments(&main_ts);
    let normalized: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();

    let has_single = normalized.contains("'aria-readonly':'true'");
    let has_double = normalized.contains("\"aria-readonly\":\"true\"");

    assert!(
        has_single || has_double,
        "expected src/main.ts to set `aria-readonly: 'true'` on the editor root (via editorViewOptionsCtx → EditorProps.attributes) so screen readers announce read-only state, got after comment-strip:\n{}",
        stripped
    );
}
