# Tasks: Hashly v0.2.3 — Bundle Ad-Hoc Signing Fix

Source: [spec.md](./spec.md). One slice, one PR.

- [ ] 1. Add `bundle.macOS.signingIdentity = "-"` to `tauri.conf.json` + regression pin in `tests/config.rs`
- [ ] 2. Bump version to 0.2.3 across `tauri.conf.json` + `package.json` + `src-tauri/Cargo.toml`
- [ ] 3. Update README — replace the broken `right-click → Open` `.dmg` workaround with `xattr -cr` (the actual modern-macOS escape hatch); lead more clearly with Homebrew
- [ ] 4. Local validation: `cargo test`, `npm test`, `cargo tauri build`, then mount the `.dmg` and verify `codesign --verify --strict /Volumes/Hashly/Hashly.app` exits 0 and `Contents/_CodeSignature/CodeResources` exists

User-actions outside this PR:
- Push `v0.2.3` git tag to trigger the release workflow
- Bump the cask formula in `deanchanter/homebrew-hashly` to `version "0.2.3"` + the new SHA256

---

### 1. `bundle.macOS.signingIdentity = "-"` + regression pin

**User value:** `cargo tauri build` produces a `.app` bundle whose ad-hoc signature `codesign --verify --strict` will accept, eliminating the Sequoia "is damaged" dialog without changing any signing-policy decision.

**Acceptance criteria:**
- [ ] `tauri.conf.json` has a `bundle.macOS` object containing `"signingIdentity": "-"`.
- [ ] `src-tauri/tests/config.rs` has a test asserting `bundle.macOS.signingIdentity == "-"` with a comment explaining why (the v0.2.2 build defect, the Sequoia-specific dialog, the *not* a substitute for proper signing) so future contributors don't "clean it up."
- [ ] All existing config tests still pass.

### 2. Version bump to 0.2.3

**Acceptance criteria:**
- [ ] `tauri.conf.json` `version = "0.2.3"`.
- [ ] `package.json` `version = "0.2.3"`.
- [ ] `src-tauri/Cargo.toml` `version = "0.2.3"`.

### 3. README correction

**User value:** The documented workaround for the `.dmg`-direct path actually works on the macOS version users are running today.

**Acceptance criteria:**
- [ ] README's `.dmg` install subsection replaces the three-step `right-click → Open` instructions with a `xattr -cr /Applications/Hashly.app` snippet (the real Sequoia-compatible escape hatch).
- [ ] Homebrew remains the recommended path; the prose makes it clearer that the cask path avoids the friction entirely.

### 4. Local validation

**Acceptance criteria:**
- [ ] `cargo test` — all suites green (config.rs has one new test).
- [ ] `npm test` — Vitest + jsdom green.
- [ ] `cargo tauri build` — produces `target/release/bundle/dmg/Hashly_0.2.3_aarch64.dmg`.
- [ ] Mount the `.dmg`, confirm `Hashly.app/Contents/_CodeSignature/CodeResources` exists.
- [ ] `codesign --verify --strict /Volumes/Hashly/Hashly.app` exits 0 + reports `valid on disk` + `satisfies its Designated Requirement`.
- [ ] `spctl --assess --verbose=4 /Volumes/Hashly/Hashly.app` returns the expected `rejected (the code is valid but does not seem to be an app)` *or* an unsigned-developer rejection (NOT the "code has no resources" error from v0.2.2 — that's the bug).
