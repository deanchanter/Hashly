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
