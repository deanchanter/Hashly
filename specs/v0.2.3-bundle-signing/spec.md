# Hashly v0.2.3 — Bundle Ad-Hoc Signing Fix

**Status:** In progress (2026-05-03)
**Author:** deanchanter
**Date:** 2026-05-03

## Summary

v0.2.2 shipped the unsigned `.dmg` and the Homebrew cask. First-install attempts on macOS Sequoia hit "Hashly is damaged and can't be opened" — both via direct `.dmg` download AND via `brew install --cask hashly`. v0.2.3 is a single-line `tauri.conf.json` fix that resolves the *build defect* underlying the dialog. Apple Developer ID signing/notarization stays deferred.

## Problem & motivation

Diagnostics on the v0.2.2 install:

- The `hashly` Mach-O binary inside `Hashly.app/Contents/MacOS/` was linker-signed ad-hoc (`flags=0x20002(adhoc,linker-signed)`). Required on Apple Silicon to even load — Tauri does this correctly.
- The `Hashly.app` *bundle* had no `Contents/_CodeSignature/CodeResources` catalog. The Mach-O signature claimed the bundle had sealed resources, but the on-disk bundle disagreed.
- `codesign --verify --strict` reported: *"code has no resources but signature indicates they must be present"*.
- `spctl --assess` correspondingly refused to bless the bundle.
- On Sonoma this *often* slid by because Gatekeeper was lenient about ad-hoc-only bundles. On Sequoia (15.x) the same defect produces the "is damaged and can't be opened" dialog regardless of quarantine state — which is why neither the `xattr -cr` workaround nor the Homebrew cask install (which strips quarantine for the user) helped.

This is a build-time bug, not a Gatekeeper policy issue. The PRD's "first Gatekeeper friction" trigger for revisiting the Apple Developer ID is *not* yet decisive — this incident was a defect masquerading as a signing-policy event. Real signing-policy friction (a properly-built unsigned app being rejected on a stranger's machine) hasn't happened yet.

## Users & primary use case

Same persona as v0.2.x. v0.2.3 doesn't change *what* the persona does — it changes whether Hashly *launches* on first install. After v0.2.3:

- `brew install --cask hashly && open -a Hashly` works on Sequoia with no manual intervention (cask install strips quarantine; bundle now has a verifiable ad-hoc signature).
- The direct `.dmg` path still has unsigned-app friction (right-click → Open or `xattr -cr`) — that's the real signing question, deferred.

## Scope

### In scope — acceptance criteria

- [ ] **`tauri.conf.json` `bundle.macOS.signingIdentity = "-"`** added. With this, `cargo tauri build` runs `codesign --sign -` on the assembled `.app`, producing `Contents/_CodeSignature/CodeResources` and a verifiable bundle signature.
- [ ] **`src-tauri/tests/config.rs`** extended with a pin asserting `bundle.macOS.signingIdentity == "-"` so this never regresses unnoticed.
- [ ] **Version bumped to 0.2.3** in `tauri.conf.json` + `package.json` + `src-tauri/Cargo.toml`.
- [ ] **`cargo tauri build` produces a `.dmg`** whose `Hashly.app/Contents/_CodeSignature/CodeResources` exists AND `codesign --verify --strict /path/to/Hashly.app` exits 0. Verified locally before tagging.
- [ ] **README updated** — replace the wrong "right-click → Open" workaround in the `.dmg` install section with the actual workaround on modern macOS (`xattr -cr /Applications/Hashly.app`), and lead more clearly with the Homebrew install path.

### Out of scope

- **Apple Developer ID signing + notarization.** Still deferred. The v0.2 PRD's revisit triggers stand: SDD-tutorial mention, non-circle install, or *real* friction report on a properly-built artifact. v0.2.2's incident was a build defect, not a signing-policy event — it does not advance the trigger.
- **Universal binary, x86_64 build, auto-update channel.** Same as v0.2.2.
- **Re-publishing v0.2.2.** v0.2.2 stays as-is on the GitHub release page; users on it can run the unblock commands documented in the README. v0.2.3 is a fresh release with a working bundle.
- **Cask formula auto-bump wiring.** `HOMEBREW_TAP_GITHUB_TOKEN` setup is still a user-action; v0.2.3's cask bump can be hand-rolled or done in the same window as enabling the auto-bump.

## Risks

- **Tauri's `signingIdentity = "-"` directive may behave differently than expected on the `macos-14` runner vs. local.** Mitigation: validate locally first with `codesign --verify --strict`; if the workflow-built artifact differs, add a CI step that runs `codesign --verify` against the built `.dmg`-mounted `.app` before upload.
- **The cask formula in `homebrew-hashly` still points at v0.2.2's broken `.dmg`.** Until the cask is bumped to v0.2.3, `brew install --cask hashly` continues to fail. Mitigation: the v0.2.3 release plus a manual cask PR (or auto-bump if enabled) are the same window of work.

## Decisions

- **Single-line config change over a workaround in the cask postflight.** A `postflight do ... codesign ... end` block in the cask would fix the install symptom but leave the `.dmg`-direct path broken AND ship a defect we know about. Fix at the source.
- **Ad-hoc, not Developer ID.** Ad-hoc satisfies Sequoia's "must verify or refuse" policy; it does not satisfy the "trusted developer" policy that would skip Gatekeeper entirely. The first-launch unsigned-app friction (right-click → Open or `xattr -cr`) is still there for the `.dmg` path. That's the real cost of staying off Apple's $99/yr program — and is documented honestly in the README.

## Open questions

- None. Mechanical fix.
