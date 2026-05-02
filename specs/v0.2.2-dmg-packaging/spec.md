# Hashly v0.2.2 — `.dmg` Packaging + Homebrew Cask

**Status:** In progress (2026-05-02)
**Author:** deanchanter
**Date:** 2026-05-02

## Summary

v0.2.2 closes the deferred Slice 16 / #12 packaging work: produce an unsigned `.dmg` from `cargo tauri build`, publish it as a GitHub release, and stand up a `deanchanter/homebrew-hashly` tap so engineers can `brew install --cask deanchanter/hashly/hashly`. Bundles the icon-rasterization follow-up (#68) and the version bump (#73), since both are load-bearing for a real release.

## Problem & motivation

v0.2 and v0.2.1 shipped the editor surface but kept `bundle.active = false` and `bundle.icon = []`. Today there is no way for a non-builder to install Hashly: no `.dmg`, no Homebrew formula, no GitHub release. The vision's distribution premise (SDD tutorials recommending Hashly) is impossible to execute against an artifact that requires `cargo tauri dev` to launch.

This release closes that gap and *only* that gap. Signing/notarization stays deferred (no $99/yr Apple Developer ID; revisit triggers documented in v0.2 spec § Decisions).

## Users & primary use case

Same persona as v0.2 — a PM (or other non-engineer) working with `.md` SDD docs. v0.2.2 changes how the persona *acquires* Hashly, not what they do with it.

**Primary scenarios:**

1. **Engineer install via Homebrew:** `brew tap deanchanter/hashly && brew install --cask hashly` lands `Hashly.app` in `/Applications` with no Gatekeeper warning (cask auto-strips quarantine). `open -a Hashly path/to/spec.md` works.
2. **Non-engineer install via .dmg:** Downloads `Hashly_0.2.2_aarch64.dmg` from the GitHub release page, double-clicks, drags `Hashly.app` to `/Applications`. First launch shows Gatekeeper "cannot check for malicious software" warning; right-click → Open clears the quarantine. Documented in the README.
3. **Finder double-click on a `.md`:** Already wired in v0.2 (#5). v0.2.2 makes this *actually testable* end-to-end because `bundle.active=true` is what lets macOS register the app as a `.md` handler.

## Scope

### In scope — acceptance criteria

- [ ] **#68 Icon rasterization** — `src/brand/icon-primary.svg` rasterized to `src/brand/raster/icon-1024.png` (committed alongside the SVG so re-rasterization is reproducible). `cargo tauri icon` populates `src-tauri/icons/` with the macOS-needed PNG set + `icon.icns`. `tauri.conf.json` `bundle.icon` lists the macOS icon paths.
- [ ] **#73 Version bump** — `tauri.conf.json`, `package.json`, and `src-tauri/Cargo.toml` all read `0.2.2`. Single source of truth would be nice; out of scope for this release.
- [ ] **`bundle.active = true`** in `tauri.conf.json`. Bundle targets restricted to `dmg` for macOS (no `.app` standalone, no `.deb`, no Linux/Windows artifacts in v0.2.2).
- [ ] **`cargo tauri build` produces a `.dmg`** under `target/release/bundle/dmg/` (workspace target dir, not `src-tauri/target/`). Verified locally on the maintainer's machine before tagging the release.
- [ ] **GitHub Actions release workflow** at `.github/workflows/release.yml`: triggers on `v*` tag push, runs on `macos-14`, installs librsvg + tauri-cli + Node 22, runs `cargo tauri build --target aarch64-apple-darwin`, uploads the `.dmg` to the GitHub release as a build artifact via `softprops/action-gh-release`. Tap-bump step is scaffolded but commented out (waits on the tap repo + `HOMEBREW_TAP_GITHUB_TOKEN` secret existing — those are user-actions outside this PR).
- [ ] **README documents both install paths** — Homebrew cask first (auto-strips quarantine, no Gatekeeper warning); `.dmg` second with right-click → Open workaround. Develop section notes the librsvg dependency for icon rasterization.
- [ ] **Brand test pin extension** — `src-tauri/tests/brand.rs` extends to: (a) the 1024 source PNG is committed at `src/brand/raster/icon-1024.png`; (b) `src-tauri/icons/icon.icns` exists and is non-empty; (c) `src-tauri/icons/128x128@2x.png` exists; (d) `tauri.conf.json` has `bundle.active = true` and `bundle.icon` non-empty. Catches regressions where someone flips `bundle.active = false` or deletes the rasterized assets.

### Out of scope

- **Apple Developer ID signing + notarization.** Deferred per v0.2 PRD § Decisions until one of the three trigger signals fires (first SDD-tutorial mention, first non-circle install, first Gatekeeper-friction report).
- **Universal binary (x86_64 + aarch64).** v0.2.2 ships aarch64-only since the maintainer + early users are on Apple Silicon. Intel build is a follow-up if signal warrants.
- **Auto-update channel** (Tauri updater). Not wired in v0.2; not wired in v0.2.2. Users update by re-running `brew upgrade --cask hashly` or downloading the new `.dmg`.
- **Creating the `deanchanter/homebrew-hashly` tap repo + the cask formula PR.** Out of scope for *this* PR (requires creating a separate GitHub repo + storing a `HOMEBREW_TAP_GITHUB_TOKEN` secret, both of which are user-actions). The release workflow is scaffolded with the tap-bump step commented in, ready to enable once the tap exists.
- **Cutting the actual GitHub release** (pushing the `v0.2.2` tag). User-action, not bot-action — the maintainer pushes the tag, the workflow runs on it.
- **Final-review follow-ups from v0.2 (#66, #71, #72, #74, #75, #76).** Same as v0.2.1 — narrow scope to packaging.

## Risks

- **`cargo tauri build` may surface bundle-config issues invisible in `cargo tauri dev`** (icon path resolution, `.icns` format validation, codesign-empty signing). Mitigation: validate locally on the maintainer's machine before tagging; the local build is the gate.
- **librsvg in CI may render the SVG differently from local librsvg** (different version, different rendering backend). Mitigation: commit the rasterized 1024 PNG directly (`src/brand/raster/icon-1024.png`) — the CI workflow uses the *committed* PNG, not a freshly rasterized one. librsvg is only needed for the *first* rasterization (and re-rasterization when the SVG changes). The icon set under `src-tauri/icons/` is also committed, so CI doesn't even rasterize at all.
- **`macos-14` runner is aarch64, but historical Tauri docs reference `macos-latest` (x86_64).** Mitigation: pin to `macos-14` explicitly so the artifact arch matches the maintainer's Apple Silicon machine, and so the `aarch64` suffix in the artifact name matches what `brew install --cask` will look for.
- **Gatekeeper friction on the `.dmg` path** is real — non-engineers will see a scary warning. Mitigation: README documents the right-click → Open workaround. The Homebrew path avoids it entirely. Trigger to revisit signing is the first filed friction report (per v0.2 PRD § Decisions).

## Decisions

- **Commit the rasterized PNG and the generated icon set into git.** Reasoning: librsvg + `cargo tauri icon` are not always available in CI / on contributor machines, and the icon is brand-stable (changes when MarkGeometric changes, which is rare). Committing makes builds reproducible and unblocks contributors who don't want to install librsvg. The 1024 PNG is small (~22KB) and the icon set is ~few hundred KB.
- **Strip the iOS / Android subdirectories from `src-tauri/icons/`.** `cargo tauri icon` generates them by default but Hashly is macOS-only in v0.2.2. Keeping them inflates the repo and confuses contributors. The macOS-relevant outputs are: `icon.icns`, `icon.png`, `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`. (`icon.ico` is Windows; keep it cheap, doesn't hurt.)
- **`bundle.targets` set to `["dmg"]`** explicitly rather than the default `"all"`. Reasoning: `"all"` on macOS means `["app", "dmg"]` which doubles the build time and produces a bare `Hashly.app` we don't ship. The `.dmg` is the only delivered artifact in v0.2.2.
- **Release workflow uses `softprops/action-gh-release`** rather than `tauri-apps/tauri-action`. Reasoning: tauri-action is heavier (cross-platform matrix, signing assumptions), and we want a tight macOS-only flow with explicit control over the upload step. Pin to a specific commit SHA (security per the existing CI workflow's pattern).
- **Tap-bump step left commented in the workflow** rather than deleted. Reasoning: it documents the intended end-state and reduces friction when the maintainer creates the tap repo — they uncomment two blocks, add the secret, done.

## Open questions

- None. This release is mechanical follow-through on v0.2 PRD § Decisions.
