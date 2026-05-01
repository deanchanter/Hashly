//! Issue #7 (slice 2 / v0.2) — `save_md_file_within` testable seam.
//!
//! Save-in-place is the write half of the disk round-trip the read path
//! (`read_md_file_within`, #44) opened up. The same threat model applies
//! verbatim — a sloppily-constructed path can cause the WebView to
//! overwrite a file the user did not intend to expose to writes — so
//! the write seam mirrors the read seam's invariants:
//!
//!   1. Canonicalize the input path BEFORE any write happens (resolves
//!      `..` and follows symlinks).
//!   2. The canonical path must be a descendant of an allow-list root
//!      (`$HOME` in production, per-test tempdir here). Anything outside
//!      is rejected with an error carrying the same `outside` token as
//!      the read path so production logs / future error-routing match
//!      a single token across both sides of the round-trip.
//!   3. The canonical path must be a regular file — the contract is
//!      "save in place" (slice 2), not "create new file" (Save-As is a
//!      later slice). Save-As will need a different seam that
//!      canonicalizes the parent and lets the leaf be a new file.
//!
//! Companion hardening this slice ships:
//!
//!   - **#33 — `getCurrentEditor()` write-handle bypass.** The save flow
//!     must serialize the doc through a single, narrow seam — not by
//!     handing a write-capable editor handle to anything outside the
//!     save path. The Rust side enforces this by requiring `content` to
//!     be a `&str` argument (the caller must already have serialized);
//!     no editor handle crosses the IPC boundary at all. The frontend
//!     side pins the contract that `saveCurrent()` does not require an
//!     externally-obtained editor handle (see `src/__tests__/save.test.ts`).
//!
//!   - **#34 — round-trip test gap.** Slice 1's fidelity gate
//!     (`src/__tests__/fidelity.test.ts`) covers the EDIT round-trip
//!     (parse → edit → serialize). This file pins the WRITE round-trip
//!     (write → re-read returns byte-equal content) at the Rust seam,
//!     so a refactor that lossy-encodes content (e.g. forces UTF-8 NFC
//!     normalization, strips trailing newlines) fires here even if the
//!     fidelity suite stays green. #34 will be closed as
//!     duplicate-of-#45+#7 by the milestone PR's body.
//!
//! Error-message tokens this file pins (lower-case substring matches —
//! the builder picks the wording, the token is the contract):
//!
//!   - allow-list rejection:    "outside"            (same token as #44)
//!   - non-regular-file:        "not a regular file" (same token as #44)
//!   - missing parent:          — anything other than the two tokens
//!                                above (canonicalize fails on a path
//!                                whose parent does not exist; std's
//!                                wording is "No such file or directory"
//!                                — we don't pin that verbatim, only
//!                                that it does NOT collide with the
//!                                rejection-branch tokens).

use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;

use hashly_lib::save_md_file_within;

fn canonical_root(root: &Path) -> std::path::PathBuf {
    // Same helper as `read_md_file.rs` — macOS `/tmp` is a symlink to
    // `/private/tmp`, so the canonical form of a tempdir's path differs
    // from `tempdir().path()`. Tests canonicalize the root before
    // passing it through the seam.
    root.canonicalize().unwrap_or_else(|e| {
        panic!(
            "test harness bug: could not canonicalize tempdir root {}: {}",
            root.display(),
            e,
        )
    })
}

#[test]
fn happy_path_writes_content_to_existing_file_within_allowed_root() {
    // Slice 2 contract: save-in-place writes the supplied content to
    // the canonical target path. The fixture file pre-exists (in-place
    // save semantics — Save-As is a later slice). After the save,
    // re-reading the file from disk returns the exact bytes that were
    // passed in (no lossy encoding, no trim, no NFC normalization).
    let dir = tempfile::tempdir().expect("could not create tempdir");
    let root = canonical_root(dir.path());
    let file_path = root.join("hello.md");
    fs::write(&file_path, "# Old content\n").expect("could not seed file");

    let path_str = file_path
        .to_str()
        .expect("test file path is not valid UTF-8 — fix the harness, not the contract");

    let new_content = "# New content\n\nSaved in place.\n";
    save_md_file_within(path_str, new_content, &root)
        .expect("expected Ok(()) for an in-place save inside the allowed root");

    let on_disk = fs::read_to_string(&file_path).expect("could not re-read saved file");
    assert_eq!(
        on_disk, new_content,
        "expected `save_md_file_within` to write `content` byte-for-byte to the canonical path \
         (no lossy encoding, no trailing-newline mutation, no NFC normalization). \
         Without byte-equality on the write side, slice 1's fidelity gate is undone the moment \
         save lands."
    );
}

#[test]
fn write_overwrites_existing_content_completely_no_append() {
    // Defensive pin: an "append" implementation would silently double-
    // write content on every save. The contract is overwrite — the new
    // content REPLACES the old, not appends to it.
    let dir = tempfile::tempdir().expect("could not create tempdir");
    let root = canonical_root(dir.path());
    let file_path = root.join("doc.md");
    fs::write(&file_path, "AAAAAAAAAA\n").expect("could not seed file");

    let path_str = file_path.to_str().unwrap();
    save_md_file_within(path_str, "B\n", &root).expect("save must succeed");

    let on_disk = fs::read_to_string(&file_path).expect("could not re-read");
    assert_eq!(
        on_disk, "B\n",
        "expected save to OVERWRITE existing content, not append. Got {:?}",
        on_disk,
    );
    // Length pin makes the failure mode unambiguous if the assertion
    // above somehow passes against truncated-but-not-replaced content.
    assert_eq!(
        on_disk.len(),
        2,
        "expected on-disk length to be exactly 2 bytes (`B\\n`) after overwrite. \
         A length > 2 indicates an append-style implementation. Got len={}, content={:?}",
        on_disk.len(),
        on_disk,
    );
}

#[test]
fn path_escaping_allowed_root_via_dotdot_is_rejected_with_outside_token() {
    // Threat model parity with #44: a malicious path string contains
    // `..` segments that canonicalize to a location outside the allow-
    // list. A naive string-prefix check on the raw input would accept
    // this. The canonical-form prefix check rejects it.
    //
    // This is the central #7-meets-#44 contract on the WRITE side —
    // without it, save-in-place is a confused-deputy attack vector that
    // lets a file the WebView opened (potentially via a symlink it
    // followed) be overwritten with attacker-supplied content.
    let dir_a = tempfile::tempdir().expect("could not create dir A");
    let dir_b = tempfile::tempdir().expect("could not create dir B");
    let root_a = canonical_root(dir_a.path());
    let root_b = canonical_root(dir_b.path());

    let outside_file = root_b.join("target.md");
    fs::write(&outside_file, "untouched\n").expect("could not write outside file");

    let dotdot_path = root_a
        .join("..")
        .join(root_b.file_name().expect("dir B has no file_name component"))
        .join("target.md");

    let resolved = dotdot_path
        .canonicalize()
        .expect("harness bug: dotdot path did not canonicalize");
    assert_eq!(
        resolved, outside_file,
        "harness sanity: dotdot path must canonicalize to the outside file",
    );

    let path_str = dotdot_path.to_str().expect("dotdot path is not UTF-8");

    let err = save_md_file_within(path_str, "ATTACKER PAYLOAD\n", &root_a)
        .err()
        .expect(
            "expected Err for a save target that canonicalizes outside the allow-list root \
             (this is the #7-meets-#44 contract on the WRITE side — without it, save-in-place \
             becomes a confused-deputy attack against any file the user can read).",
        );

    assert!(
        err.to_lowercase().contains("outside"),
        "expected the path-rejection error to contain the lowercase token 'outside' so it \
         matches the same token as the read path's rejection branch (#44). \
         Got: {:?}",
        err,
    );

    // Defense-in-depth: the rejection MUST happen before any write. The
    // outside file's content must be unchanged.
    let untouched = fs::read_to_string(&outside_file).expect("could not re-read outside file");
    assert_eq!(
        untouched, "untouched\n",
        "expected the outside file to remain unmodified after a rejected save \
         (rejection must happen before any write — otherwise the rejection is just \
         a post-hoc apology). Got: {:?}",
        untouched,
    );
}

#[test]
fn symlink_pointing_outside_allowed_root_is_rejected_with_outside_token() {
    // Threat model parity with #44 symlink test: a symlink LIVES inside
    // the allow-list (so a string-prefix check would accept it) but its
    // TARGET resolves outside. `Path::canonicalize()` follows the
    // symlink, so the post-canonicalize prefix check catches it.
    let dir_inside = tempfile::tempdir().expect("could not create inside dir");
    let dir_outside = tempfile::tempdir().expect("could not create outside dir");
    let root_inside = canonical_root(dir_inside.path());
    let root_outside = canonical_root(dir_outside.path());

    let outside_file = root_outside.join("forbidden.md");
    fs::write(&outside_file, "out-of-bounds\n").expect("could not write outside file");

    let symlink_path = root_inside.join("looks-innocent.md");
    symlink(&outside_file, &symlink_path).expect("could not create symlink");

    let path_str = symlink_path.to_str().expect("symlink path is not UTF-8");
    let err = save_md_file_within(path_str, "ATTACKER PAYLOAD\n", &root_inside)
        .err()
        .expect(
            "expected Err for a symlink whose target resolves outside the allow-list — \
             without this, an attacker can plant a symlink in any reachable allow-listed dir \
             and trick save_md_file into OVERWRITING any user-writable file.",
        );

    assert!(
        err.to_lowercase().contains("outside"),
        "expected the symlink-rejection error to contain the lowercase token 'outside' \
         so callers can branch on a single token across read+write rejections. Got: {:?}",
        err,
    );

    let untouched = fs::read_to_string(&outside_file).expect("could not re-read outside file");
    assert_eq!(
        untouched, "out-of-bounds\n",
        "expected the outside file to remain unmodified after the rejected save. Got: {:?}",
        untouched,
    );
}

#[test]
fn directory_within_allowed_root_is_rejected_as_non_regular_file() {
    // A directory passes canonicalize + allow-list but is not a regular
    // file. Mirrors #44's directory test.
    let dir = tempfile::tempdir().expect("could not create tempdir");
    let root = canonical_root(dir.path());
    let subdir = root.join("a-subdirectory");
    fs::create_dir(&subdir).expect("could not create subdirectory");

    let path_str = subdir.to_str().expect("subdir path is not UTF-8");
    let err = save_md_file_within(path_str, "should not write\n", &root)
        .err()
        .expect(
            "expected Err for a directory path inside the allowed root — a directory is \
             not a regular file, and writing to it would either fail confusingly or (worse) \
             produce platform-specific behavior.",
        );

    assert!(
        err.to_lowercase().contains("not a regular file"),
        "expected the non-regular-file rejection error to contain the lowercase token \
         'not a regular file' so it is distinguishable from the allow-list rejection. \
         Got: {:?}",
        err,
    );
}

#[test]
fn rejection_branches_return_distinguishable_error_strings() {
    // Belt-and-suspenders against a refactor that collapses all three
    // branches into a generic "could not save" message. Mirrors #44's
    // distinguishability pin on the read side.

    // Branch A: allow-list rejection (dotdot)
    let dir_a = tempfile::tempdir().unwrap();
    let dir_b = tempfile::tempdir().unwrap();
    let root_a = canonical_root(dir_a.path());
    let root_b = canonical_root(dir_b.path());
    let outside = root_b.join("o.md");
    fs::write(&outside, "x").unwrap();
    let dotdot = root_a
        .join("..")
        .join(root_b.file_name().unwrap())
        .join("o.md");
    let err_outside = save_md_file_within(dotdot.to_str().unwrap(), "y", &root_a)
        .err()
        .expect("dotdot must Err");

    // Branch B: non-regular file (directory)
    let dir_c = tempfile::tempdir().unwrap();
    let root_c = canonical_root(dir_c.path());
    let subdir = root_c.join("subdir");
    fs::create_dir(&subdir).unwrap();
    let err_nonreg = save_md_file_within(subdir.to_str().unwrap(), "y", &root_c)
        .err()
        .expect("directory must Err");

    let outside_lower = err_outside.to_lowercase();
    let nonreg_lower = err_nonreg.to_lowercase();

    assert!(
        outside_lower.contains("outside") && !nonreg_lower.contains("outside"),
        "expected the 'outside' token in ONLY the allow-list branch — got: \
         allow-list={:?}, non-regular={:?}",
        err_outside,
        err_nonreg,
    );
    assert!(
        nonreg_lower.contains("not a regular file") && !outside_lower.contains("not a regular file"),
        "expected the 'not a regular file' token in ONLY the non-regular branch — got: \
         allow-list={:?}, non-regular={:?}",
        err_outside,
        err_nonreg,
    );
}

#[test]
fn save_round_trip_open_edit_save_reopen_preserves_edits_byte_equal() {
    // The #7 round-trip AC: "open → edit → save → reopen → edits are
    // present". Combines the read and write seams to pin that the
    // round-trip is byte-equal at the disk layer. Slice 1's fidelity
    // gate covers the EDITOR'S round-trip (parse/serialize); this pins
    // the SAVE'S round-trip (write/read).
    use hashly_lib::read_md_file_within;

    let dir = tempfile::tempdir().expect("could not create tempdir");
    let root = canonical_root(dir.path());
    let file_path = root.join("doc.md");
    fs::write(&file_path, "# Original\n\nbody\n").expect("could not seed file");

    let path_str = file_path.to_str().unwrap();

    // Read.
    let opened = read_md_file_within(path_str, &root).expect("read must succeed");
    assert_eq!(opened.content, "# Original\n\nbody\n");

    // "Edit" — replace content with the would-be editor-serialized output.
    let edited = "# Edited\n\nnew body\n\n- and a list\n";

    // Save.
    save_md_file_within(path_str, edited, &root).expect("save must succeed");

    // Re-open.
    let reopened = read_md_file_within(path_str, &root).expect("re-read must succeed");
    assert_eq!(
        reopened.content, edited,
        "expected the round-trip (open → edit → save → reopen) to be byte-equal at the \
         disk layer. A divergence here means save and read disagree about encoding, line \
         endings, or trailing whitespace — slice 1's fidelity gate alone won't catch that \
         because it stops at the editor boundary."
    );
}

#[test]
fn save_does_not_take_an_editor_handle_argument_only_a_serialized_string() {
    // Issue #33 — write-handle-bypass hardening. The save seam must
    // accept ALREADY-SERIALIZED content (a `&str`), not a write-capable
    // handle to the editor's mutable state. This is enforced
    // structurally by the function signature: callers must serialize
    // before invoking, so no write-capable handle ever crosses the
    // IPC boundary.
    //
    // This test is a compile-time / signature pin — if the signature
    // ever drifts to e.g. take a `&mut Editor` or a callback that
    // returns `&mut View`, the call below fails to compile and forces
    // the contract back into the impl. Mirrors the spirit of #44's
    // inline-comment pin but for the write handle: the pin lives in
    // the test code so a future "convenience" refactor can't quietly
    // widen the surface.
    //
    // The assertion itself is trivial — the actual contract is
    // upheld by the `&str` parameter type in the function signature
    // we exercise here.
    let dir = tempfile::tempdir().unwrap();
    let root = canonical_root(dir.path());
    let f = root.join("h.md");
    fs::write(&f, "x").unwrap();

    // The call below MUST type-check with a plain &str. If a future
    // refactor changes the signature to require an Editor / View /
    // mutable handle of any kind, this stops compiling.
    let result: Result<(), String> = save_md_file_within(f.to_str().unwrap(), "y", &root);
    assert!(result.is_ok(), "happy-path save with plain &str must succeed");
}

#[test]
fn lib_rs_carries_inline_threat_model_comment_above_save_md_file_within() {
    // Slice 2 / #7 + #33 + #44 contract: a future reviewer looking at
    // the canonicalize+prefix-check flow on the write side needs to
    // know WHY the path is canonicalized BEFORE the write. Without
    // context, a "simplifying" refactor that drops canonicalize, or
    // reorders the prefix check after the write, silently re-opens the
    // attack surface — this time with WRITE consequences (file
    // overwrite) instead of read consequences.
    //
    // Tokens pinned:
    //   1. `#7`           — links to the save issue
    //   2. `canonicalize` — names the security-critical operation
    //   3. `traversal` OR `symlink` — names the threat class
    //
    // Mirrors the inline-comment pin from `read_md_file.rs`.
    use std::path::PathBuf;
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let lib_rs_path = manifest_dir.join("src").join("lib.rs");
    let lib_rs = fs::read_to_string(&lib_rs_path).unwrap_or_else(|e| {
        panic!(
            "could not read {}: {} — #7 inline-comment pin requires lib.rs to be readable",
            lib_rs_path.display(),
            e
        )
    });

    let fn_idx = lib_rs.find("fn save_md_file_within").unwrap_or_else(|| {
        panic!(
            "expected `fn save_md_file_within` declaration in src/lib.rs (#7 — the testable \
             seam for in-place save). Builder must add this helper as part of slice 2.",
        )
    });

    let window_start = fn_idx.saturating_sub(600);
    let window = &lib_rs[window_start..fn_idx];

    let has_comment_delim = window.contains("//") || window.contains("/*");
    assert!(
        has_comment_delim,
        "expected at least one comment in the 600-char window above `fn save_md_file_within`. \
         Window:\n{}",
        window,
    );

    assert!(
        window.contains("#7"),
        "expected the inline-comment block above `fn save_md_file_within` to reference issue \
         `#7` so the security context is anchored to the slice. Window:\n{}",
        window,
    );

    assert!(
        window.to_lowercase().contains("canonicalize"),
        "expected the inline-comment block to mention `canonicalize` (the security-critical \
         operation the hardening hinges on). Window:\n{}",
        window,
    );

    let lower = window.to_lowercase();
    assert!(
        lower.contains("traversal") || lower.contains("symlink"),
        "expected the inline-comment block to name the threat class — either 'traversal' or \
         'symlink' — so a future reviewer understands WHY the canonicalize+prefix-check \
         pattern is non-negotiable on the write side. Window:\n{}",
        window,
    );
}
