//! Issue #44 — `read_md_file` path-traversal hardening (slice 2 / v0.2).
//!
//! Once #7 lands save-in-place, the read path becomes one half of a disk
//! round-trip and any sloppy path handling becomes a real attack surface
//! (a malicious or sloppily-constructed path can cause the WebView to read
//! a file the user did not intend to expose). v0.1 shipped a path-string
//! pass-through `read_md_file` (acceptable while the only consumer was
//! File > Open's native picker, which already constrains the result to
//! files the OS user agreed to expose). For v0.2 the bar rises:
//!
//!   1. The input path canonicalizes via `Path::canonicalize()` (resolves
//!      `..` and follows symlinks) BEFORE any read happens.
//!   2. The canonical path must be a descendant of an allow-list root —
//!      typically `$HOME` for the production command, or a per-test
//!      tempdir for these tests. Anything outside is rejected with an
//!      error distinguishable from the "not a regular file" branch and
//!      from the "not valid UTF-8" branch.
//!   3. The resolved path must be a regular file — directories, FIFOs,
//!      sockets, character devices like `/dev/*` are rejected with their
//!      own typed-distinguishable error.
//!
//! The contract is testable through a builder-introduced helper:
//!
//!     pub fn read_md_file_within(path: &str, allowed_root: &Path)
//!         -> Result<FileOpened, String>;
//!
//! `read_md_file_within` is the testable seam; the `#[tauri::command]`
//! `read_md_file` is a thin wrapper that resolves `allowed_root` from
//! the user's home directory in production. The wrapper-and-helper
//! split keeps the IPC entry point API-stable while making the
//! security-critical branches unit-testable against a tempdir root.
//!
//! The pre-existing in-file `mod tests` in `src/lib.rs` (slice 1's
//! happy/missing/non-utf-8 trio) is REPLACED by the equivalent
//! integration tests below — same contract, exercised against the
//! testable seam. The builder is expected to drop the in-file tests
//! when adding the helper, since they would now fail (they read from
//! `/tmp` tempfiles, which are NOT under `$HOME`).
//!
//! Error-message tokens this file pins (each rejection branch must
//! contain one or more of these substrings so the branches are
//! distinguishable in production logs and in this suite):
//!
//!   - allow-list rejection:    "outside" (e.g. "outside the allowed root")
//!   - non-regular-file:        "not a regular file"
//!   - non-UTF-8:                — anything OTHER than the two tokens above
//!                                  (Rust's std `read_to_string` produces
//!                                  "stream did not contain valid UTF-8";
//!                                  we don't pin that wording verbatim,
//!                                  only that it does NOT collide with
//!                                  the rejection-branch tokens).
//!
//! Tokens are intentionally lower-case-substring matches — the builder
//! can pick any wording that contains the token. A future copy-edit
//! that drops the token (e.g. renaming "outside" to "escapes") fires
//! these tests and forces the rename to land in the test alongside
//! the impl.

use std::fs;
use std::io::Write;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

use hashly_lib::{read_md_file_within, FileOpened};

/// Canonicalize a tempdir's path so prefix comparisons against canonical
/// child paths land cleanly on macOS, where `/tmp` is a symlink to
/// `/private/tmp` (so `tempdir().path()` is `/tmp/...` but the canonical
/// form is `/private/tmp/...`). All test sites canonicalize their root
/// before passing it into `read_md_file_within`.
fn canonical_root(root: &Path) -> std::path::PathBuf {
    root.canonicalize().unwrap_or_else(|e| {
        panic!(
            "test harness bug: could not canonicalize tempdir root {}: {}",
            root.display(),
            e,
        )
    })
}

#[test]
fn happy_path_within_allowed_root_returns_file_opened_with_path_name_and_content() {
    // Slice 1's happy-path contract, ported to run inside an allow-list
    // tempdir. `read_md_file_within` must accept the path verbatim, return
    // the file_name component as `name`, and the bytes verbatim (not lossy)
    // as `content`.
    let dir = tempfile::tempdir().expect("could not create tempdir");
    let root = canonical_root(dir.path());
    let file_path = root.join("hello.md");
    let mut f = fs::File::create(&file_path).expect("could not create test file");
    write!(f, "# Hello\n\nworld\n").expect("could not write test file");
    f.flush().expect("could not flush test file");

    let path_str = file_path
        .to_str()
        .expect("test file path is not valid UTF-8 — fix the harness, not the contract");

    let opened: FileOpened = read_md_file_within(path_str, &root)
        .expect("expected Ok(FileOpened) for a UTF-8 file inside the allowed root");

    assert_eq!(
        opened.content, "# Hello\n\nworld\n",
        "expected `content` to be byte-equal to the file contents (no lossy conversion, no trim)"
    );
    assert_eq!(
        opened.name, "hello.md",
        "expected `name` to be the file_name (basename) component of the input path"
    );
    // Path field: pinned only as "non-empty and points at the same file"
    // — we don't pin verbatim because canonicalization may rewrite the
    // input path (e.g. resolve symlinks, strip `..`), and either choice
    // (return the input verbatim vs the canonicalized form) is defensible.
    assert!(
        !opened.path.is_empty(),
        "expected `path` field to be non-empty",
    );
}

#[test]
fn missing_file_within_allowed_root_returns_err() {
    // Slice 1 contract: a non-existent path inside the allowed root must
    // return Err. With #44 hardening, the failure mode is canonicalize()
    // returning ENOENT BEFORE the read attempts — the visible behavior
    // (returns Err) is identical to slice 1's pin.
    let dir = tempfile::tempdir().expect("could not create tempdir");
    let root = canonical_root(dir.path());
    let missing = root.join("does-not-exist.md");
    let path_str = missing.to_str().expect("path is not UTF-8");

    let result = read_md_file_within(path_str, &root);
    assert!(
        result.is_err(),
        "expected Err for a path that does not exist inside the allowed root; got Ok({:?})",
        result.ok()
    );
}

#[test]
fn non_utf8_bytes_within_allowed_root_returns_err_distinguishable_from_path_rejection() {
    // Slice 1's non-UTF-8 contract, plus an explicit assertion that the
    // error string is NOT confused with the new #44 path-rejection or
    // non-regular-file branches. This is the "typed error distinguishable
    // from not UTF-8" requirement from the slice 2 spec, viewed from the
    // not-UTF-8 side: the not-UTF-8 error must NOT carry the rejection-
    // branch tokens.
    let dir = tempfile::tempdir().expect("could not create tempdir");
    let root = canonical_root(dir.path());
    let file_path = root.join("non-utf8.md");
    let mut f = fs::File::create(&file_path).expect("could not create test file");
    f.write_all(&[0xff, 0xfe, 0x00])
        .expect("could not write non-UTF-8 bytes");
    f.flush().expect("could not flush test file");

    let path_str = file_path.to_str().expect("path is not UTF-8");
    let err = read_md_file_within(path_str, &root)
        .err()
        .expect("expected Err for a file containing non-UTF-8 bytes");

    let lower = err.to_lowercase();
    assert!(
        !lower.contains("outside"),
        "expected non-UTF-8 error to NOT carry the path-allow-list rejection token \
         'outside' — that would conflate the two branches and defeat the typed-error \
         distinguishability requirement (#44 + slice 2 spec). Got: {:?}",
        err,
    );
    assert!(
        !lower.contains("not a regular file"),
        "expected non-UTF-8 error to NOT carry the non-regular-file rejection token \
         'not a regular file'. Got: {:?}",
        err,
    );
}

#[test]
fn path_escaping_allowed_root_via_dotdot_is_rejected_with_outside_token() {
    // Threat model: a malicious path string contains `..` segments that
    // canonicalize to a location outside the allow-list. The canonical
    // form (after `..` resolution and symlink-following) must be the
    // basis of the prefix check — NOT the literal input string. A naive
    // string-prefix check on the raw input would accept this attack.
    //
    // Fixture: two sibling tempdirs, A (allowed) and B (outside). A file
    // `target.md` lives in B. The attack path is `<A>/../<B-basename>/target.md`
    // — it textually starts inside A but canonicalizes to a location
    // strictly under B.
    let dir_a = tempfile::tempdir().expect("could not create dir A");
    let dir_b = tempfile::tempdir().expect("could not create dir B");
    let root_a = canonical_root(dir_a.path());
    let root_b = canonical_root(dir_b.path());

    let outside_file = root_b.join("target.md");
    fs::write(&outside_file, "secret\n").expect("could not write outside file");

    // Build the dotdot path. Both roots live under the same parent
    // directory (the system temp root), so `<A>/../<B-name>/target.md`
    // resolves to `<B>/target.md`.
    let parent = root_a
        .parent()
        .expect("tempdir root has no parent — harness bug");
    let dotdot_path = root_a
        .join("..")
        .join(root_b.file_name().expect("dir B has no file_name component"))
        .join("target.md");
    // Sanity check the harness: the dotdot path must canonicalize to the
    // outside file. If this fails the test environment is wrong, not the
    // contract.
    let resolved = dotdot_path
        .canonicalize()
        .expect("harness bug: dotdot path did not canonicalize");
    assert_eq!(
        resolved, outside_file,
        "harness sanity: dotdot path {} should canonicalize to outside file {} (parent={})",
        dotdot_path.display(),
        outside_file.display(),
        parent.display(),
    );

    let path_str = dotdot_path
        .to_str()
        .expect("dotdot path is not UTF-8");

    let err = read_md_file_within(path_str, &root_a)
        .err()
        .expect(
            "expected Err for a path that canonicalizes outside the allow-list root \
             (this is THE central #44 contract — without it, save-in-place becomes a \
             confused-deputy attack vector against any user who ever opens a doc)",
        );

    assert!(
        err.to_lowercase().contains("outside"),
        "expected the path-rejection error to contain the lowercase token 'outside' \
         (e.g. 'outside the allowed root') so it is distinguishable from the non-UTF-8 \
         and non-regular-file branches. The exact wording is the builder's call; the \
         token is the contract. Got: {:?}",
        err,
    );

    // Negative pin: the file in B was never read — its content does NOT
    // appear in the error message (defense-in-depth: even an error string
    // shouldn't leak data the caller wasn't allowed to see).
    assert!(
        !err.contains("secret"),
        "expected the error string to NOT echo the contents of the outside file \
         (defense-in-depth — error messages must not leak data the caller wasn't \
         allowed to see). Got: {:?}",
        err,
    );
}

#[test]
fn symlink_pointing_outside_allowed_root_is_rejected_with_outside_token() {
    // Threat model: a symlink LIVES inside the allow-list (so a string-
    // prefix check would accept it) but its TARGET resolves to a file
    // outside. `Path::canonicalize()` follows the symlink, so the
    // post-canonicalize prefix check catches it. Without this rejection,
    // `read_md_file` is a symlink-traversal vulnerability the moment
    // save lands.
    //
    // Linux + macOS: `std::os::unix::fs::symlink(target, link)` is the
    // portable way to create a symlink. Skipped on Windows (Hashly is
    // mac-only per CLAUDE.md, so this is fine).
    let dir_inside = tempfile::tempdir().expect("could not create inside dir");
    let dir_outside = tempfile::tempdir().expect("could not create outside dir");
    let root_inside = canonical_root(dir_inside.path());
    let root_outside = canonical_root(dir_outside.path());

    let outside_file = root_outside.join("forbidden.md");
    fs::write(&outside_file, "out-of-bounds bytes\n").expect("could not write outside file");

    let symlink_path = root_inside.join("looks-innocent.md");
    symlink(&outside_file, &symlink_path).expect("could not create symlink");

    let path_str = symlink_path
        .to_str()
        .expect("symlink path is not UTF-8");

    let err = read_md_file_within(path_str, &root_inside)
        .err()
        .expect(
            "expected Err for a symlink whose target resolves outside the allow-list \
             — without this, an attacker can plant a symlink in any reachable \
             allow-listed dir and trick read_md_file into opening (and, post-#7, \
             potentially overwriting) any user-readable file (#44 threat model).",
        );

    assert!(
        err.to_lowercase().contains("outside"),
        "expected the symlink-rejection error to contain the same lowercase token \
         'outside' as the dotdot rejection so callers can branch on a single token \
         for 'allow-list violation'. Got: {:?}",
        err,
    );
}

#[test]
fn directory_within_allowed_root_is_rejected_as_non_regular_file() {
    // A directory passes the canonicalize + allow-list check but is not
    // a regular file. `fs::read_to_string` on a directory returns an
    // OS-level error like "Is a directory", but that wording is platform-
    // dependent and shares no common token with the other two branches.
    // The slice 2 spec asks for a typed-distinguishable error — we pin
    // the lowercase substring "not a regular file" as that token.
    //
    // Why a directory and not a FIFO: creating a FIFO requires
    // `libc::mkfifo` (or the `nix` crate), neither of which is currently
    // pulled in. A directory is a non-regular-file fixture that is
    // creatable from `std` alone, and the allow-list check + regular-
    // file check have to handle it the same way they handle FIFOs and
    // sockets (i.e. by rejecting based on `metadata.file_type().is_file()`
    // returning false). If the impl uses `is_file()`, this test pins the
    // contract for ALL non-regular file types, including FIFOs and
    // `/dev/*` — they all fail `is_file()`.
    let dir = tempfile::tempdir().expect("could not create tempdir");
    let root = canonical_root(dir.path());
    let subdir = root.join("a-subdirectory");
    fs::create_dir(&subdir).expect("could not create subdirectory");

    let path_str = subdir.to_str().expect("subdir path is not UTF-8");
    let err = read_md_file_within(path_str, &root)
        .err()
        .expect(
            "expected Err for a directory path inside the allowed root — \
             a directory is not a regular file, and reading it would either \
             fail with a confusing OS error or (worse) return a synthesized \
             listing as text. #44 requires explicit non-regular-file rejection.",
        );

    assert!(
        err.to_lowercase().contains("not a regular file"),
        "expected the non-regular-file rejection error to contain the lowercase \
         token 'not a regular file' so it is distinguishable from the allow-list \
         rejection ('outside') and from the non-UTF-8 branch (which carries neither \
         token). Got: {:?}",
        err,
    );
}

#[test]
fn rejection_branches_return_distinguishable_error_strings() {
    // The slice 2 spec: "with a typed error distinguishable from 'not UTF-8'".
    // This test composes the three rejection branches in one place and
    // asserts they pairwise differ in their token presence. It's the
    // belt to the per-branch tests' suspenders — if a contributor
    // refactors all three branches to share a generic "could not read
    // file" message, this test fires even if the per-branch tests would
    // accidentally pass against the looser-than-intended wording.

    // ── branch A: allow-list rejection (dotdot)
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
    let err_outside = read_md_file_within(dotdot.to_str().unwrap(), &root_a)
        .err()
        .expect("dotdot must Err");

    // ── branch B: non-regular file (directory)
    let dir_c = tempfile::tempdir().unwrap();
    let root_c = canonical_root(dir_c.path());
    let subdir = root_c.join("subdir");
    fs::create_dir(&subdir).unwrap();
    let err_nonreg = read_md_file_within(subdir.to_str().unwrap(), &root_c)
        .err()
        .expect("directory must Err");

    // ── branch C: non-UTF-8
    let dir_d = tempfile::tempdir().unwrap();
    let root_d = canonical_root(dir_d.path());
    let f = root_d.join("bin.md");
    fs::write(&f, [0xff, 0xfe, 0x00]).unwrap();
    let err_nonutf8 = read_md_file_within(f.to_str().unwrap(), &root_d)
        .err()
        .expect("non-utf-8 must Err");

    let outside_lower = err_outside.to_lowercase();
    let nonreg_lower = err_nonreg.to_lowercase();
    let nonutf8_lower = err_nonutf8.to_lowercase();

    // Each token appears in exactly one branch.
    assert!(
        outside_lower.contains("outside")
            && !nonreg_lower.contains("outside")
            && !nonutf8_lower.contains("outside"),
        "expected the 'outside' token in ONLY the allow-list branch — got: \
         allow-list={:?}, non-regular={:?}, non-utf-8={:?}",
        err_outside,
        err_nonreg,
        err_nonutf8,
    );
    assert!(
        nonreg_lower.contains("not a regular file")
            && !outside_lower.contains("not a regular file")
            && !nonutf8_lower.contains("not a regular file"),
        "expected the 'not a regular file' token in ONLY the non-regular branch \
         — got: allow-list={:?}, non-regular={:?}, non-utf-8={:?}",
        err_outside,
        err_nonreg,
        err_nonutf8,
    );
    // Non-UTF-8 has no positive token of its own pinned (Rust std
    // wording varies by platform / version). The pin is that it carries
    // NEITHER of the rejection-branch tokens.
    assert!(
        !nonutf8_lower.contains("outside")
            && !nonutf8_lower.contains("not a regular file"),
        "expected the non-UTF-8 branch to carry NEITHER rejection-branch token \
         (so production logs / future error-routing can match on the tokens \
         exclusively). Got: {:?}",
        err_nonutf8,
    );
}

#[test]
fn lib_rs_carries_inline_threat_model_comment_above_read_md_file() {
    // Slice 2 spec, #44 AC #4: "Inline comment in `lib.rs` documenting the
    // hardening so the next reviewer doesn't undo it." A future reviewer
    // looking at the canonicalize + prefix-check flow needs to know WHY
    // the path is being canonicalized BEFORE the read — without context,
    // a "simplifying" refactor that drops the canonicalize step (or
    // reorders the prefix check after the read) silently re-opens the
    // attack surface.
    //
    // The contract: the comment lives in the same lexical region as
    // `fn read_md_file_within` (within a 600-char window above its
    // declaration — generous enough to fit a multi-line block comment
    // describing the threat model). We pin three tokens so a one-liner
    // boilerplate comment doesn't satisfy the contract:
    //
    //   1. `#44`             — links the comment to the issue
    //   2. `canonicalize`    — names the security-critical step
    //   3. `traversal` OR `symlink` — names the specific threat class
    //
    // The pin is run after `common::strip_comments` is applied INVERSELY:
    // we DO want comments here (the assertion is FOR a comment), so we
    // read the raw source and assert the tokens appear inside the
    // window. To distinguish "real comment" from "string literal", we
    // require the tokens to appear on lines that begin (after whitespace)
    // with `//` or appear inside a `/* ... */` block.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let lib_rs_path = manifest_dir.join("src").join("lib.rs");
    let lib_rs = fs::read_to_string(&lib_rs_path).unwrap_or_else(|e| {
        panic!(
            "could not read {}: {} — #44 inline-comment pin requires lib.rs to be \
             readable from the test runner",
            lib_rs_path.display(),
            e
        )
    });

    // Locate `fn read_md_file_within` (or `pub fn read_md_file_within`).
    let fn_idx = lib_rs.find("fn read_md_file_within").unwrap_or_else(|| {
        panic!(
            "expected `fn read_md_file_within` declaration in src/lib.rs \
             (#44 — the testable seam for path-traversal hardening). \
             Builder must add this helper as part of the slice 2 impl. lib.rs:\n{}",
            lib_rs
        )
    });

    let window_start = fn_idx.saturating_sub(600);
    let window = &lib_rs[window_start..fn_idx];

    // The window must contain at least one comment line OR block. A
    // simple-enough check: the substring `//` or `/*` must appear in
    // the window. A bare assertion against the tokens (without comment-
    // delimiter context) would false-pass against accidentally-named
    // identifiers like `let canonicalize_idx = ...`.
    let has_comment_delim = window.contains("//") || window.contains("/*");
    assert!(
        has_comment_delim,
        "expected `src/lib.rs` to contain at least one comment (`//` or `/*`) \
         in the 600-char window directly above `fn read_md_file_within` (#44 \
         AC: \"Inline comment in lib.rs documenting the hardening\"). Window:\n{}",
        window
    );

    // Token 1: issue reference. `#44` anchors the comment to the slice 2
    // hardening work specifically — without it the comment is generic
    // prose that a future "cleanup" pass might delete without realizing
    // it documents a security invariant.
    assert!(
        window.contains("#44"),
        "expected the inline-comment block above `fn read_md_file_within` to \
         reference issue `#44` so the security context is anchored to the \
         specific hardening work it documents (slice 2 spec / #44 AC). Window:\n{}",
        window
    );

    // Token 2: name the operation. A reviewer scanning for `canonicalize`
    // should land in the comment block.
    assert!(
        window.to_lowercase().contains("canonicalize"),
        "expected the inline-comment block to mention `canonicalize` (the \
         security-critical operation the hardening hinges on) so a `simplifying' \
         refactor that drops the canonicalize step lands a reviewer in the \
         comment block. Window:\n{}",
        window
    );

    // Token 3: name the threat class. Either `traversal` (path-traversal)
    // or `symlink` is acceptable — both are the attack vectors #44 closes,
    // and either is a meaningful keyword for grep-based threat-model
    // discovery.
    let lower = window.to_lowercase();
    assert!(
        lower.contains("traversal") || lower.contains("symlink"),
        "expected the inline-comment block to name the threat class — either \
         'traversal' (path-traversal) or 'symlink' — so a future reviewer \
         understands WHY the canonicalize+prefix-check pattern is non-negotiable. \
         Window:\n{}",
        window
    );
}
