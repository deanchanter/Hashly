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
fn frontend_main_ts_wires_default_value_from_showcase_fixture() {
    // AC #2 (originally pinned the `# Hello` literal under issue #18; updated
    // for issue #3): the editor's default content is now sourced from the
    // bundled CommonMark + GFM showcase fixture at
    // `src/fixtures/commonmark-showcase.md`, loaded via Vite's `?raw`
    // import. The contract is therefore:
    //   1. main.ts imports the fixture as a named binding from `?raw`
    //      (so a contributor can't drop the fixture without the type-check
    //      catching it).
    //   2. main.ts still wires `defaultValueCtx` (so the import is
    //      actually used, not orphaned).
    let main_ts = read_repo_file("src/main.ts");
    let stripped = common::strip_comments(&main_ts);

    assert!(
        stripped.contains("./fixtures/commonmark-showcase.md?raw"),
        "expected src/main.ts to import the showcase fixture via `import … from './fixtures/commonmark-showcase.md?raw'` (Issue #3 AC #2). After comment-strip:\n{}",
        stripped
    );
    assert!(
        stripped.contains("defaultValueCtx"),
        "expected src/main.ts to wire the default value via `defaultValueCtx` (Issue #3 AC #2 — the showcase fixture must reach the editor through the same channel as the previous `# Hello` literal). After comment-strip:\n{}",
        stripped
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
fn frontend_style_css_sets_cursor_default_on_prosemirror_root() {
    // Issue #15 AC #1: the read-only editor must show the arrow cursor on hover,
    // not the I-beam (text caret) the WebView falls back to for a content area.
    // We pin a CSS rule scoped to `.ProseMirror` (the ProseMirror content DOM)
    // or `#editor` (the Milkdown mount host) whose body sets `cursor: default`.
    //
    // Defense-in-depth (matching the pattern of the aria-readonly contract test
    // above): comments are stripped first so a commented-out ghost rule like
    //   /* .ProseMirror { cursor: default; } */
    // does NOT satisfy the assertion. CSS only has `/* ... */` block comments
    // (no `//` line comments per spec — most preprocessors strip those before
    // emit), but the shared `common::strip_comments` helper handles both
    // styles safely so it is the right tool here.
    //
    // We then walk the stripped CSS as a sequence of `selector { body }` rules.
    // For each rule, we normalize whitespace in BOTH the selector and the body,
    // then assert that at least one rule has a selector mentioning
    // `.ProseMirror` or `#editor` AND a body containing `cursor:default`. This
    // is a structural check — a stray `cursor: default` somewhere ELSE in the
    // file (say, a `body { cursor: default; }` rule) won't satisfy the
    // contract; the rule must actually be scoped to the editor root.
    let css = read_repo_file("src/style.css");
    let stripped = common::strip_comments(&css);

    let chars: Vec<char> = stripped.chars().collect();
    let mut i = 0usize;
    let mut block_start = 0usize;
    let mut found = false;
    while i < chars.len() {
        if chars[i] == '{' {
            let selector: String = chars[block_start..i].iter().collect();
            // Find matching '}'. We don't use nested at-rules in this file,
            // so a flat scan is sufficient.
            let mut j = i + 1;
            while j < chars.len() && chars[j] != '}' {
                j += 1;
            }
            let body: String = if j < chars.len() {
                chars[i + 1..j].iter().collect()
            } else {
                chars[i + 1..].iter().collect()
            };
            let sel_norm: String = selector.chars().filter(|c| !c.is_whitespace()).collect();
            let body_norm: String = body.chars().filter(|c| !c.is_whitespace()).collect();
            let sel_matches = sel_norm.contains(".ProseMirror") || sel_norm.contains("#editor");
            if sel_matches && body_norm.contains("cursor:default") {
                found = true;
                break;
            }
            i = j + 1;
            block_start = i;
        } else {
            i += 1;
        }
    }

    assert!(
        found,
        "expected src/style.css to contain a rule scoped to `.ProseMirror` or `#editor` whose body sets `cursor: default` (Issue #15 AC #1) so hovering the read-only editor shows the arrow cursor, not the I-beam. After comment-strip, src/style.css was:\n{}",
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

#[test]
fn frontend_main_ts_overrides_heading_id_generator_for_collision_suffix() {
    // Issue #17 — Heading id collisions. Milkdown's `@milkdown/preset-commonmark`
    // disambiguates duplicate heading text via `syncHeadingIdPlugin` using a
    // NON-STANDARD `-#2`/`-#3` suffix format. Readers expect the GitHub /
    // remark-slug convention (`hello`, `hello-1`, `hello-2`) so in-doc anchor
    // links like `[name](#hello-1)` resolve. The fix is to override
    // `ctx.set(headingIdGenerator.key, customGenerator)` inside
    // `mountEditor`'s config block, where `customGenerator` is a closure that
    // tracks a base-slug → next-counter map.
    //
    // This static-contract test pins the wiring so a future refactor can't
    // silently drop the override and regress to Milkdown's default output.
    // The dynamic vitest test in src/__tests__/main.test.ts asserts the
    // rendered DOM; this catches a contributor who deletes the override even
    // when vitest is unavailable in CI.
    //
    // Comments are stripped first (matching the aria-readonly defense
    // pattern above) so a commented-out `ctx.set(headingIdGenerator.key, ...)`
    // ghost cannot satisfy the assertion.
    let main_ts = read_repo_file("src/main.ts");
    let stripped = common::strip_comments(&main_ts);

    assert!(
        stripped.contains("headingIdGenerator"),
        "expected src/main.ts to import / reference `headingIdGenerator` from `@milkdown/preset-commonmark` (Issue #17). After comment-strip:\n{}",
        stripped
    );

    // Whitespace-insensitive check that the override-call is real (not just
    // an unused import). Accept either `ctx.set(headingIdGenerator.key,` or
    // the same call with arbitrary spacing around the parens / dot.
    let normalized: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();
    assert!(
        normalized.contains("ctx.set(headingIdGenerator.key,"),
        "expected src/main.ts to call `ctx.set(headingIdGenerator.key, ...)` inside the editor's config block to install a custom slug-counter generator (Issue #17 AC #2). After comment-strip:\n{}",
        stripped
    );
}

#[test]
fn frontend_main_ts_installs_window_level_dragover_drop_preventdefault_guard() {
    // Issue #16 — Window-level dragover/drop guard.
    //
    // Background: ProseMirror only `preventDefault`s drag events when the
    // editor is editable. In our read-only mode (`editable: () => false`)
    // it ignores them, so a file dropped onto the editor lets the WebView
    // navigate to `file://...`, replacing the page entirely. Tauri's
    // `dragDropEnabled: true` (default) currently masks this by
    // intercepting native OS drag-drop before it reaches the WebView, but
    // Issue #4 will flip that flag to `false` so HTML5 drop reaches the
    // DOM (we want the future Markdown-image drop UX). The window-level
    // guard MUST land before #4, otherwise a single mis-aimed file drop
    // blanks the app.
    //
    // The dynamic vitest tests in `src/__tests__/main.test.ts` already
    // assert the runtime behavior (defaultPrevented + idempotency). This
    // static-contract test is the cargo-side belt to vitest's suspenders:
    // it catches a contributor who deletes the listener wiring even when
    // vitest is unavailable in CI (e.g. the npm job is broken / disabled).
    //
    // The contract pinned here:
    //   - A real (not commented-out) `addEventListener('dragover', ...)`
    //     call in `src/main.ts`. Both quote styles (`'dragover'` and
    //     `"dragover"`) are accepted because TypeScript permits both.
    //   - Same for `addEventListener('drop', ...)`.
    //   - A real `preventDefault()` call. This is the half that actually
    //     stops the file:// navigation; without it, even a registered
    //     listener is a no-op.
    //
    // Comments are stripped first (matching the aria-readonly defense
    // pattern above) so a commented-out ghost like
    //   // window.addEventListener('dragover', ...)
    // does NOT satisfy the assertion.
    let main_ts = read_repo_file("src/main.ts");
    let stripped = common::strip_comments(&main_ts);
    let normalized: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();

    let has_dragover_single = normalized.contains("addEventListener('dragover'");
    let has_dragover_double = normalized.contains("addEventListener(\"dragover\"");
    assert!(
        has_dragover_single || has_dragover_double,
        "expected src/main.ts to register a `dragover` listener via `addEventListener('dragover', ...)` \
         (Issue #16 AC #1) so a file dragged over the read-only editor cannot trigger a WebView \
         navigation to file://... After comment-strip:\n{}",
        stripped
    );

    let has_drop_single = normalized.contains("addEventListener('drop'");
    let has_drop_double = normalized.contains("addEventListener(\"drop\"");
    assert!(
        has_drop_single || has_drop_double,
        "expected src/main.ts to register a `drop` listener via `addEventListener('drop', ...)` \
         (Issue #16 AC #1). Both `dragover` AND `drop` must be guarded — preventing only one \
         is the same as preventing neither for the purposes of stopping the file:// navigation. \
         After comment-strip:\n{}",
        stripped
    );

    assert!(
        normalized.contains("preventDefault()"),
        "expected src/main.ts to call `preventDefault()` inside the dragover/drop guard \
         (Issue #16 AC #1). Registering a listener without calling preventDefault is a no-op \
         — the WebView still navigates to file://... After comment-strip:\n{}",
        stripped
    );
}

#[test]
fn fixture_commonmark_showcase_exists_and_covers_all_required_elements() {
    // Issue #3 AC #1 — A fixture markdown file/string bundled in the repo
    // must cover: headings h1–h6, ordered + unordered + nested lists, fenced
    // code blocks, inline code, GFM tables, links, images, blockquotes,
    // bold/italic, and horizontal rules.
    //
    // We pin the file path AND a substring-token contract for every required
    // element so the contract is checkable from the cargo job alone (the
    // dynamic vitest tests in src/__tests__/main.test.ts handle DOM-level
    // rendering correctness; this is the file-level belt to those suspenders).
    //
    // Rationale for substring tokens (not parsing): keeping the contract at
    // raw-bytes lets a contributor add prose around the demo blocks without
    // accidentally regressing the contract — and it's the same pattern other
    // file-level pins (vitest config / package.json) follow elsewhere in this
    // suite.
    let path = repo_root().join("src/fixtures/commonmark-showcase.md");
    assert!(
        path.exists(),
        "expected fixture `src/fixtures/commonmark-showcase.md` to exist (Issue #3 AC #1), but {} does not exist",
        path.display()
    );

    let md = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e));

    // Headings h1–h6: pin each level on its own line (anchored with \n) so a
    // stray `### ` inside a code block can't accidentally satisfy a higher
    // level. Allow the very-first line variant by also accepting a leading
    // `^`-style match via a simple OR with prefix-of-file.
    let has_heading = |level: usize| -> bool {
        let token = format!("\n{} ", "#".repeat(level));
        let prefix = format!("{} ", "#".repeat(level));
        md.contains(&token) || md.starts_with(&prefix)
    };
    for level in 1..=6 {
        assert!(
            has_heading(level),
            "expected fixture to contain an H{level} heading (line starting with `{} `) for Issue #3 AC #1; fixture was:\n{}",
            "#".repeat(level),
            md,
        );
    }

    // Ordered list: a line beginning `1. ` (anchored).
    assert!(
        md.contains("\n1. ") || md.starts_with("1. "),
        "expected fixture to contain an ordered list (line starting with `1. `) for Issue #3 AC #1; fixture was:\n{}",
        md,
    );

    // Unordered list: a line beginning `- ` (anchored).
    assert!(
        md.contains("\n- ") || md.starts_with("- "),
        "expected fixture to contain an unordered list (line starting with `- `) for Issue #3 AC #1; fixture was:\n{}",
        md,
    );

    // Nested list: a line indented by 2+ spaces and then a `- ` or `* ` bullet.
    // Pin BOTH common indent widths (2 and 4 spaces) as acceptable.
    let has_nested =
        md.contains("\n  - ") || md.contains("\n    - ") || md.contains("\n  * ") || md.contains("\n    * ");
    assert!(
        has_nested,
        "expected fixture to contain a NESTED list item (indented `- ` or `* ` bullet) for Issue #3 AC #1; fixture was:\n{}",
        md,
    );

    // Fenced code block: a triple-backtick fence must appear.
    assert!(
        md.contains("```"),
        "expected fixture to contain a fenced code block (triple backticks) for Issue #3 AC #1; fixture was:\n{}",
        md,
    );

    // Inline code: a single backtick must appear OUTSIDE the fenced block.
    // We approximate by requiring the file contain at least one backtick run
    // of length 1 (i.e. ` ` ` not preceded/followed by another backtick).
    // Simple approach: split off all triple-backtick fences and check the
    // remainder for backticks.
    let mut without_fences = String::new();
    let mut in_fence = false;
    for chunk in md.split("```") {
        if !in_fence {
            without_fences.push_str(chunk);
        }
        in_fence = !in_fence;
    }
    assert!(
        without_fences.contains('`'),
        "expected fixture to contain INLINE code (backtick-wrapped span outside fenced blocks) for Issue #3 AC #1; fixture was:\n{}",
        md,
    );

    // GFM table: a header separator line containing `|` and `---`. We
    // pin a `|---` or `| ---` substring which only appears in a table
    // separator row.
    let has_table_separator = md.contains("|---") || md.contains("| ---");
    assert!(
        has_table_separator,
        "expected fixture to contain a GFM table (separator row with `|---` or `| ---`) for Issue #3 AC #1; fixture was:\n{}",
        md,
    );
    // Table header row: at least one line with two `|` chars and non-pipe
    // content between them. The separator pin already establishes presence;
    // this ensures the body row is also there (so `mountEditor` sees a real
    // 2+ row table when rendering).
    assert!(
        md.lines().filter(|l| l.matches('|').count() >= 2).count() >= 3,
        "expected fixture to contain a GFM table with at least 3 pipe-bearing lines (header + separator + body) for Issue #3 AC #1; fixture was:\n{}",
        md,
    );

    // Link: `[...](...)` — pin the literal pattern.
    assert!(
        md.contains("](http"),
        "expected fixture to contain a Markdown link (e.g. `[text](https://...)`) for Issue #3 AC #1; fixture was:\n{}",
        md,
    );

    // Image: `![...](...)` — pin the literal pattern.
    assert!(
        md.contains("!["),
        "expected fixture to contain a Markdown image (e.g. `![alt](https://...)`) for Issue #3 AC #1; fixture was:\n{}",
        md,
    );
    assert!(
        md.contains("![") && md.contains("](http"),
        "expected fixture image to point at an absolute URL (e.g. `![alt](https://...)`) for Issue #3 AC #1; fixture was:\n{}",
        md,
    );

    // Blockquote: a line beginning `> `.
    assert!(
        md.contains("\n> ") || md.starts_with("> "),
        "expected fixture to contain a blockquote (line starting with `> `) for Issue #3 AC #1; fixture was:\n{}",
        md,
    );

    // Bold: `**text**` — pin the literal `**` token (must appear at least twice
    // for an opening + closing pair).
    assert!(
        md.matches("**").count() >= 2,
        "expected fixture to contain bold (`**text**`, requires opening + closing `**`) for Issue #3 AC #1; fixture was:\n{}",
        md,
    );

    // Italic: literal `*italic*` or `_italic_`. We pin a specific sequence
    // (`*italic*`) so a false positive from a list bullet `* ` cannot satisfy
    // the contract.
    let has_italic = md.contains("*italic*") || md.contains("_italic_");
    assert!(
        has_italic,
        "expected fixture to contain italic emphasis (literal `*italic*` or `_italic_`) for Issue #3 AC #1 — pinning the exact word so a list-bullet `* ` does not falsely satisfy the assertion; fixture was:\n{}",
        md,
    );

    // Horizontal rule: a line consisting solely of `---` (or longer). Pin
    // the line-anchored form to avoid table-separator false positives
    // (`|---|`).
    let has_hr = md
        .lines()
        .any(|l| {
            let t = l.trim();
            !t.is_empty()
                && t.chars().all(|c| c == '-')
                && t.len() >= 3
        })
        || md
            .lines()
            .any(|l| {
                let t = l.trim();
                !t.is_empty()
                    && t.chars().all(|c| c == '*')
                    && t.len() >= 3
            });
    assert!(
        has_hr,
        "expected fixture to contain a horizontal rule (a line of `---` or `***`, NOT a table separator) for Issue #3 AC #1; fixture was:\n{}",
        md,
    );
}

#[test]
fn fixture_malformed_showcase_exists_and_covers_required_pathologies() {
    // Issue #11 AC #1 — A test fixture of malformed markdown must be bundled
    // in the repo. Milkdown's CommonMark + GFM presets already handle most
    // malformed input gracefully; this fixture is the contract that pins
    // *which* pathologies we test the read-only renderer against. The
    // dynamic vitest test in `src/__tests__/main.test.ts` mounts this same
    // class of input and asserts the editor doesn't crash.
    //
    // Pathology mix pinned here (a subset of the pathologies enumerated in
    // the issue body — these are the ones a substring-token contract can
    // sanely assert without re-implementing a markdown parser):
    //
    //   - Unclosed fenced code block: a ``` fence with no matching close
    //     anywhere later in the file. Many parsers crash or hang on this
    //     so it's a high-value test input.
    //   - Broken GFM table: a header row whose separator row has fewer
    //     columns than the header. Pinned as the substring `| a | b |\n|---|`
    //     (or analogous) — a separator with strictly fewer pipe-delimited
    //     cells than the header above it.
    //   - Raw HTML mixed in: at minimum a `<div` token. Milkdown's
    //     commonmark preset escapes raw HTML by default, so this should
    //     appear as text; pinning the substring guarantees the fixture
    //     actually exercises that escape path.
    //   - Deeply nested list (10+ levels). Pinned by the deepest indent
    //     line containing 18+ leading spaces (i.e. level 10 at 2-space
    //     indents) followed by a `- ` bullet.
    //
    // We keep the contract at substring-tokens (not parsing) because the
    // whole point of the fixture is to be malformed — running it through
    // a parser to verify it would defeat the purpose.
    let path = repo_root().join("src/fixtures/malformed-showcase.md");
    assert!(
        path.exists(),
        "expected fixture `src/fixtures/malformed-showcase.md` to exist (Issue #11 AC #1), but {} does not exist",
        path.display()
    );

    let md = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e));

    assert!(
        !md.trim().is_empty(),
        "expected fixture `src/fixtures/malformed-showcase.md` to be NON-EMPTY (Issue #11 AC #1); got an empty / whitespace-only file",
    );

    // --- Unclosed fenced code block ---
    // Count occurrences of triple-backtick. An unclosed fence means an ODD
    // total — a closed fence pair contributes 2. We require the count to
    // be ≥ 1 AND odd, which is the strictest way to assert "at least one
    // fence has no closing match" using a substring-only check.
    let fence_count = md.matches("```").count();
    assert!(
        fence_count >= 1,
        "expected fixture to contain at least one ``` fence (Issue #11 AC #1 — unclosed fenced code block pathology); fixture was:\n{}",
        md,
    );
    assert!(
        fence_count % 2 == 1,
        "expected fixture to contain an UNCLOSED ``` fence — the total count of ``` runs must be ODD so at least one fence has no closing match (Issue #11 AC #1). Got {} fence runs in:\n{}",
        fence_count,
        md,
    );

    // --- Broken GFM table: separator with fewer cells than header ---
    // Walk the file line by line. For each line that looks like a
    // separator (contains `|` and `---`), find the immediately-preceding
    // non-blank line that ALSO contains `|` (the header) and assert the
    // header has MORE pipe-bounded cells than the separator. We only need
    // to find ONE such broken pair anywhere in the file.
    fn pipe_cell_count(line: &str) -> usize {
        // A line like `| a | b |` has 3 pipes → 2 cells. A line like
        // `|---|` has 2 pipes → 1 cell. We approximate "cell count" as
        // (pipe count - 1), clamped at 0, which matches GFM's convention
        // that leading and trailing pipes are optional but typically
        // present in the cases we care about.
        let p = line.matches('|').count();
        if p == 0 {
            0
        } else {
            p.saturating_sub(1)
        }
    }
    let lines: Vec<&str> = md.lines().collect();
    let mut found_broken_table = false;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if !trimmed.contains('|') || !trimmed.contains("---") {
            continue;
        }
        // This is a separator candidate. Find the previous non-blank line.
        let mut j = i;
        while j > 0 {
            j -= 1;
            let prev = lines[j].trim();
            if prev.is_empty() {
                continue;
            }
            if !prev.contains('|') {
                break;
            }
            let header_cells = pipe_cell_count(prev);
            let sep_cells = pipe_cell_count(trimmed);
            if header_cells > sep_cells && header_cells >= 2 {
                found_broken_table = true;
            }
            break;
        }
        if found_broken_table {
            break;
        }
    }
    assert!(
        found_broken_table,
        "expected fixture to contain a BROKEN GFM table — a header row with N≥2 cells followed by a separator row with strictly fewer cells (e.g. `| a | b |\\n|---|`) for Issue #11 AC #1; fixture was:\n{}",
        md,
    );

    // --- Raw HTML mixed in ---
    assert!(
        md.contains("<div"),
        "expected fixture to contain raw HTML (e.g. a `<div` tag) so the renderer's HTML-escape path is exercised (Issue #11 AC #1); fixture was:\n{}",
        md,
    );

    // --- Deeply nested list (10+ levels) ---
    // Level 10 at 2-space indents = 18 leading spaces before the bullet.
    // Accept either `- ` or `* ` bullets. Walk lines and assert at least
    // one bullet line has ≥ 18 leading spaces.
    let has_deeply_nested = md.lines().any(|l| {
        let leading_spaces = l.chars().take_while(|c| *c == ' ').count();
        if leading_spaces < 18 {
            return false;
        }
        let after_indent = &l[leading_spaces..];
        after_indent.starts_with("- ") || after_indent.starts_with("* ")
    });
    assert!(
        has_deeply_nested,
        "expected fixture to contain a DEEPLY NESTED list item — a `- ` or `* ` bullet preceded by ≥ 18 leading spaces (i.e. ≥ 10 levels at 2-space indents) for Issue #11 AC #1; fixture was:\n{}",
        md,
    );
}

#[test]
fn frontend_main_ts_imports_listen_from_tauri_apps_api_event() {
    // Issue #4 slice D: the frontend must subscribe to the
    // `menu-open-file` event emitted by the Rust menu handler (slice C)
    // via Tauri's event API. The canonical import is:
    //
    //     import { listen } from '@tauri-apps/api/event';
    //
    // Without this import, the menu emits an event no one is listening
    // for and File>Open silently does nothing in the rendered window.
    //
    // Comments are stripped first so a commented-out import (e.g.
    // `// import { listen } from '@tauri-apps/api/event'`) does NOT
    // satisfy the assertion. Both quote styles for the package path
    // are accepted (TypeScript permits either).
    let main_ts = read_repo_file("src/main.ts");
    let stripped = common::strip_comments(&main_ts);

    let has_single = stripped.contains("from '@tauri-apps/api/event'");
    let has_double = stripped.contains("from \"@tauri-apps/api/event\"");
    assert!(
        has_single || has_double,
        "expected src/main.ts to import from `@tauri-apps/api/event` (Issue #4 slice D — \
         required to subscribe to the `menu-open-file` event emitted by the Rust menu \
         handler in slice C). After comment-strip:\n{}",
        stripped
    );

    // The `listen` symbol must specifically appear in the import. We
    // accept either a named-import form (`import { listen } from …`)
    // or a destructure-after-namespace-import form
    // (`import * as event from …; const { listen } = event;`). The
    // simpler check: the substring `listen` must appear within ~120
    // chars of the @tauri-apps/api/event import statement.
    let import_idx = stripped
        .find("'@tauri-apps/api/event'")
        .or_else(|| stripped.find("\"@tauri-apps/api/event\""))
        .expect("import path was found above; should also be findable here");
    let window_start = import_idx.saturating_sub(200);
    let window_end = (import_idx + 200).min(stripped.len());
    let window = &stripped[window_start..window_end];
    assert!(
        window.contains("listen"),
        "expected `listen` to appear in or adjacent to the `@tauri-apps/api/event` \
         import (Issue #4 slice D). Window around the import was:\n{}",
        window
    );
}

#[test]
fn frontend_main_ts_exports_handle_file_opened_and_open_file_via_dialog() {
    // Issue #4 slice D: `handleFileOpened` is the helper that takes a
    // `FileOpened` payload and applies it to the DOM (re-mount + title).
    // `openFileViaDialog` is the orchestrator that opens the native
    // dialog plugin, calls `read_md_file` over IPC, and hands the
    // result to `handleFileOpened`. Both must be named exports so:
    //   - The Vitest test can drive `handleFileOpened` directly without
    //     mocking the Tauri runtime.
    //   - The `listen('menu-open-file', …)` callback in `bootstrap()`
    //     can call `openFileViaDialog` cleanly.
    //
    // We accept the three TypeScript-permitted forms: function
    // declaration, async function declaration, and const-assigned
    // expression — same set as the existing `bootstrap` export check.
    let main_ts = read_repo_file("src/main.ts");
    let stripped = common::strip_comments(&main_ts);

    let has_handle = stripped.contains("export function handleFileOpened")
        || stripped.contains("export async function handleFileOpened")
        || stripped.contains("export const handleFileOpened");
    assert!(
        has_handle,
        "expected src/main.ts to expose a named `handleFileOpened` export — \
         `export function handleFileOpened`, `export async function handleFileOpened`, \
         or `export const handleFileOpened` (Issue #4 slice D). After comment-strip:\n{}",
        stripped
    );

    let has_dialog_opener = stripped.contains("export function openFileViaDialog")
        || stripped.contains("export async function openFileViaDialog")
        || stripped.contains("export const openFileViaDialog");
    assert!(
        has_dialog_opener,
        "expected src/main.ts to expose a named `openFileViaDialog` export — \
         `export function openFileViaDialog`, `export async function openFileViaDialog`, \
         or `export const openFileViaDialog` (Issue #4 slice D). After comment-strip:\n{}",
        stripped
    );
}

#[test]
fn frontend_main_ts_assigns_to_document_title() {
    // Issue #4 slice D: the file-open path must update `document.title`
    // so the user sees which file is loaded. Without an active
    // assignment, the title stays at its `<title>Hashly</title>`
    // default and the user has no visual indication of state changes.
    //
    // Accepted forms (whitespace-insensitive, post-comment-strip):
    //   - `document.title = …`
    //   - `document.title=…`  (rare but legal)
    //
    // We do NOT accept reading `document.title` (e.g. `const t =
    // document.title`) — only assignments. The check anchors on the
    // `=` after `document.title` (whitespace-stripped) so a read is
    // rejected.
    let main_ts = read_repo_file("src/main.ts");
    let stripped = common::strip_comments(&main_ts);
    let normalized: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();

    // After whitespace-strip, an assignment becomes `document.title=…`.
    // A read becomes `document.title;` or `=document.title`. Pin the
    // assignment-side form: `document.title=` followed by a non-`=`
    // char (so we don't false-positive on `==` or `===` comparisons).
    let assignment_idx = normalized.find("document.title=");
    let is_assignment = match assignment_idx {
        Some(i) => {
            let next = normalized.as_bytes().get(i + "document.title=".len());
            // Reject `==` (would be `document.title==…`) or `===`.
            !matches!(next, Some(b'='))
        }
        None => false,
    };

    assert!(
        is_assignment,
        "expected src/main.ts to ASSIGN to `document.title` (Issue #4 slice D — \
         not just read it; the user-visible window title must update so File>Open \
         has visible feedback). After comment-strip and whitespace-strip:\n{}",
        normalized
    );
}

#[test]
fn package_json_declares_tauri_apps_api_and_plugin_dialog_runtime_deps() {
    // Issue #4 slice D: `@tauri-apps/api` provides the `listen` /
    // `invoke` runtime; `@tauri-apps/plugin-dialog` is the JS half of
    // the dialog plugin registered in slice C. Both MUST be declared
    // in `dependencies` (not `devDependencies`) so production bundles
    // include them.
    let raw = read_repo_file("package.json");
    let pkg: serde_json::Value =
        serde_json::from_str(&raw).expect("package.json is not valid JSON");

    let deps = pkg
        .get("dependencies")
        .and_then(|d| d.as_object())
        .expect("expected `dependencies` object in package.json");

    let api = deps.get("@tauri-apps/api").unwrap_or_else(|| {
        panic!(
            "expected dependencies[\"@tauri-apps/api\"] in package.json (Issue #4 slice D — \
             provides the runtime `listen`/`invoke` calls); current dependencies = {:?}",
            deps
        )
    });
    assert!(
        api.is_string(),
        "expected dependencies[\"@tauri-apps/api\"] to be a version string, got: {:?}",
        api
    );

    let dialog = deps.get("@tauri-apps/plugin-dialog").unwrap_or_else(|| {
        panic!(
            "expected dependencies[\"@tauri-apps/plugin-dialog\"] in package.json (Issue #4 \
             slice D — JS half of the dialog plugin registered on the Rust side in slice C); \
             current dependencies = {:?}",
            deps
        )
    });
    assert!(
        dialog.is_string(),
        "expected dependencies[\"@tauri-apps/plugin-dialog\"] to be a version string, got: {:?}",
        dialog
    );
}

#[test]
fn frontend_main_ts_exports_render_file_error_and_pins_friendly_message() {
    // Issue #10 — Friendly error for binary / non-UTF-8 .md.
    //
    // Background: Issue #4's `read_md_file` returns Err on non-UTF-8 input,
    // which makes the frontend's `await invoke<FileOpened>('read_md_file', ...)`
    // call reject. Slice D of #4 left that rejection uncaught, so a binary
    // file opens as an unhandled promise rejection in the WebView console
    // (with no user-visible feedback). Issue #10 fixes that by:
    //
    //   1. Exporting a `renderFileError(host, message, path?)` helper from
    //      `src/main.ts` that clears the host and renders a static
    //      `[role="alert"]` div carrying the friendly message.
    //   2. Wrapping the `invoke('read_md_file', ...)` call in
    //      `openFileViaDialog` in a try/catch that calls `renderFileError`
    //      with the verbatim friendly message string on rejection.
    //
    // The friendly message is part of the public, user-visible contract.
    // The exact wording — "Can't open this file — it doesn't look like text."
    // — is pinned here verbatim (em-dash, apostrophe, sentence-case period)
    // so a copy-edit drift surfaces in CI even when vitest is unavailable.
    // The dynamic vitest test in src/__tests__/main.test.ts asserts the
    // runtime DOM behavior; this static-contract test is the cargo-side
    // belt to vitest's suspenders.
    //
    // Comments are stripped first (matching the aria-readonly defense
    // pattern above) so a commented-out copy of the literal does NOT
    // satisfy the assertion.
    let main_ts = read_repo_file("src/main.ts");
    let stripped = common::strip_comments(&main_ts);

    // Named `renderFileError` export. Accept the three TypeScript-permitted
    // forms (function declaration, async function declaration, const-assigned
    // expression) — same set as `bootstrap` / `handleFileOpened` /
    // `openFileViaDialog`.
    let has_export = stripped.contains("export function renderFileError")
        || stripped.contains("export async function renderFileError")
        || stripped.contains("export const renderFileError");
    assert!(
        has_export,
        "expected src/main.ts to expose a named `renderFileError` export — \
         `export function renderFileError`, `export async function renderFileError`, \
         or `export const renderFileError` (Issue #10 AC #1). After comment-strip:\n{}",
        stripped
    );

    // Verbatim friendly-message pin. The em-dash (U+2014) and the
    // typographic apostrophe (curly vs straight) MUST match the user-facing
    // string. We pin the straight ASCII apostrophe form ("Can't") because
    // that's the form a developer typing on a US keyboard will produce; if
    // a future contributor swaps it for a curly U+2019, the test fires
    // and the contributor must consciously update both this pin AND the
    // vitest constant (which keeps the two in lockstep).
    let expected = "Can't open this file \u{2014} it doesn't look like text.";
    assert!(
        stripped.contains(expected),
        "expected src/main.ts to contain the verbatim friendly-error message \
         {expected:?} (Issue #10 AC #1 — copy is part of the public contract; \
         a soft-edit must update BOTH this pin AND the vitest constant in \
         src/__tests__/main.test.ts). After comment-strip:\n{stripped}",
    );

    // The role="alert" anchor is the a11y contract. Without it, the error
    // is announced (or not) inconsistently across screen readers — the
    // ARIA live-region default for an unannounced div is "off". Pin the
    // literal substring (both quote styles accepted) in real code, not a
    // comment.
    let normalized: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();
    let has_role_single = normalized.contains("'role','alert'")
        || normalized.contains("setAttribute('role','alert')");
    let has_role_double = normalized.contains("\"role\",\"alert\"")
        || normalized.contains("setAttribute(\"role\",\"alert\")");
    let has_role_literal_attr = normalized.contains("role=\"alert\"")
        || normalized.contains("role='alert'");
    assert!(
        has_role_single || has_role_double || has_role_literal_attr,
        "expected src/main.ts to set role=\"alert\" on the error element \
         (Issue #10 AC #1) — required for screen readers to announce the \
         friendly message via the ARIA live-region implicit on role=alert. \
         After comment-strip and whitespace-strip:\n{}",
        normalized
    );
}

#[test]
fn frontend_main_ts_sets_tabindex_0_on_editor_root() {
    // Issue #15 AC #2: `contenteditable="false"` strips the implicit tab-stop
    // that ProseMirror would otherwise have. Without `tabindex="0"` on the
    // editor root, keyboard users can't Tab to the read-only doc — which
    // breaks Space/PgDn/arrow-key scrolling. The fix is to extend the
    // `attributes` object on `editorViewOptionsCtx`'s `EditorProps` so the
    // ProseMirror root DOM node carries `tabindex="0"`.
    //
    // We pin the VALUE verbatim ("0") because "-1" makes the element
    // programmatically focusable but NOT Tab-reachable — that would silently
    // fail the keyboard-scroll requirement while passing a more lenient
    // "tabindex attribute exists" check. The dynamic vitest test in
    // src/__tests__/main.test.ts asserts the rendered DOM; this static-
    // contract test catches a contributor who tries to ship `tabindex: '-1'`
    // or drops the line entirely, even when vitest is unavailable in CI.
    //
    // Comments are stripped first (matching the aria-readonly defense
    // pattern above) so a commented-out `'tabindex': '0'` ghost cannot
    // satisfy the assertion.
    let main_ts = read_repo_file("src/main.ts");
    let stripped = common::strip_comments(&main_ts);
    let normalized: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();

    let has_single = normalized.contains("'tabindex':'0'");
    let has_double = normalized.contains("\"tabindex\":\"0\"");

    assert!(
        has_single || has_double,
        "expected src/main.ts to set `tabindex: '0'` on the editor root (via editorViewOptionsCtx → EditorProps.attributes) so keyboard-only users can Tab to the read-only doc and scroll it (Issue #15 AC #2). `tabindex: '-1'` is NOT acceptable — it makes the element programmatically focusable but unreachable via Tab. After comment-strip:\n{}",
        stripped
    );
}
