# Tasks: Hashly v0.2.2 — `.dmg` Packaging + Homebrew Cask

Source: [spec.md](./spec.md). Three GitHub issues drive this milestone: **#12** (.dmg + cask + workflow), **#68** (icon rasterization), **#73** (version bump). #12 depends on #68; #73 is independent.

Sequencing: #68 first (icons must exist before bundle.icon can reference them), then #73 (cheap), then #12 (the bulk of the work). All slices land in a single milestone PR.

- [ ] 1. [Rasterize icon-primary.svg + populate src-tauri/icons/](https://github.com/deanchanter/Hashly/issues/68)
- [ ] 2. [Bump version to 0.2.2 across tauri.conf.json + package.json + Cargo.toml](https://github.com/deanchanter/Hashly/issues/73)
- [ ] 3. [Flip bundle.active=true + wire bundle.icon + bundle.targets=["dmg"]](https://github.com/deanchanter/Hashly/issues/12)
- [ ] 4. [Add release-tag GitHub Actions workflow](https://github.com/deanchanter/Hashly/issues/12)
- [ ] 5. [Update README with install paths + librsvg note](https://github.com/deanchanter/Hashly/issues/12)
- [ ] 6. [Extend brand tests to pin icon set + bundle config](https://github.com/deanchanter/Hashly/issues/12)
- [ ] 7. [Local validation: cargo test + npm test + cargo tauri build → .dmg](https://github.com/deanchanter/Hashly/issues/12)

User-actions outside this PR (documented in spec § Out of scope):
- Create `deanchanter/homebrew-hashly` tap repo + cask formula
- Add `HOMEBREW_TAP_GITHUB_TOKEN` secret to the Hashly repo
- Push `v0.2.2` tag to trigger the release workflow

---

### 1. Rasterize icon-primary.svg + populate src-tauri/icons/

**User value:** A real Hashly icon ships in the bundle — no more placeholder. Required for `bundle.active=true` to produce a valid `.dmg`.

**Acceptance criteria:**
- [ ] `src/brand/raster/icon-1024.png` exists, committed, 1024×1024, generated from `src/brand/icon-primary.svg` via `rsvg-convert -w 1024 -h 1024`.
- [ ] `cargo tauri icon src/brand/raster/icon-1024.png` populates `src-tauri/icons/` with macOS-needed assets: `icon.icns`, `icon.png`, `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`.
- [ ] iOS / Android subdirectories under `src-tauri/icons/` are pruned (Hashly is macOS-only in v0.2.2).
- [ ] All committed icon files non-empty + readable.

**Notes:** Closes #68. librsvg installed once via `brew install librsvg` (documented in README Develop section). Re-rasterization is needed only when the SVG changes.

### 2. Bump version to 0.2.2

**User value:** The release artifact name (`Hashly_0.2.2_aarch64.dmg`) reflects the actual product version. Eliminates the v0.2 PRD's outstanding "version still 0.1.0" follow-up.

**Acceptance criteria:**
- [ ] `src-tauri/tauri.conf.json` `version` reads `0.2.2`.
- [ ] `package.json` `version` reads `0.2.2`.
- [ ] `src-tauri/Cargo.toml` `version` reads `0.2.2`.
- [ ] `cargo build` still succeeds.

**Notes:** Closes #73. Three-file source-of-truth split is preserved (a unified pipeline is a v0.3 candidate).

### 3. Flip bundle.active + wire bundle.icon + bundle.targets

**User value:** `cargo tauri build` produces a real macOS bundle instead of bailing.

**Acceptance criteria:**
- [ ] `src-tauri/tauri.conf.json` `bundle.active` is `true`.
- [ ] `bundle.icon` lists the macOS icon set: `["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns"]` (the `cargo tauri icon`-generated paths).
- [ ] `bundle.targets` is `["dmg"]` explicitly (not `"all"`) — only ship the `.dmg`, not the standalone `.app`.
- [ ] Existing `fileAssociations` block preserved as-is (Finder double-click for `.md` / `.markdown`).

**Notes:** Slice 16 / part of #12.

### 4. Add release-tag GitHub Actions workflow

**User value:** Pushing a `vX.Y.Z` tag produces a GitHub release with the `.dmg` attached, no manual steps from the maintainer.

**Acceptance criteria:**
- [ ] `.github/workflows/release.yml` exists.
- [ ] Triggers on `push` of tags matching `v*`.
- [ ] Runs on `macos-14` (Apple Silicon).
- [ ] Sets up Node 22 + Rust stable + tauri-cli + librsvg (the librsvg install is defensive — committed icons mean it's not strictly needed, but having it lets future contributors regenerate the icon set in CI if needed).
- [ ] Runs `npm ci` + `cargo tauri build --target aarch64-apple-darwin`.
- [ ] Uses `softprops/action-gh-release` (pinned to a commit SHA per the existing CI workflow's security pattern) to upload `target/aarch64-apple-darwin/release/bundle/dmg/*.dmg` to the release matching the tag.
- [ ] Tap-bump step (`dawidd6/action-homebrew-bump-formula` or hand-rolled `gh pr create` against `deanchanter/homebrew-hashly`) is scaffolded in the workflow file but commented out — labelled with a clear `# TODO: uncomment after creating the tap repo + adding HOMEBREW_TAP_GITHUB_TOKEN secret`.

**Notes:** Slice 16 / part of #12. The workflow file is dormant until the maintainer pushes a `v*` tag — it costs nothing to land it ahead of the actual release.

### 5. Update README with install paths + librsvg note

**User value:** A first-time visitor knows how to install Hashly and how to (re)build the bundle locally if they want to.

**Acceptance criteria:**
- [ ] README has an `## Install` section with two subsections: "Homebrew (recommended)" and "Direct .dmg download". Homebrew commands listed first; the .dmg subsection documents the Gatekeeper right-click → Open workaround.
- [ ] README `## Develop` section adds a one-line note about `brew install librsvg` being needed *only* if a contributor wants to regenerate the icon set after editing `src/brand/icon-primary.svg`.
- [ ] The summary line at the top of the README is updated to remove the "unsigned `.dmg` release is deferred" sentence (now shipped).

**Notes:** Slice 16 / part of #12. Keep the README terse — it's not a manual.

### 6. Extend brand tests to pin icon set + bundle config

**User value:** The build cannot silently regress the icon assets or `bundle.active` without a test failure caught in CI.

**Acceptance criteria:**
- [ ] `src-tauri/tests/brand.rs` extends with: `src/brand/raster/icon-1024.png` exists + is non-empty.
- [ ] `src-tauri/icons/icon.icns` exists + is non-empty.
- [ ] `src-tauri/icons/128x128@2x.png` exists + is non-empty.
- [ ] `src-tauri/tests/config.rs` (or a new `bundle.rs` in the same dir) extends to assert: `tauri.conf.json` has `bundle.active = true` and `bundle.icon` is a non-empty array.
- [ ] All existing brand tests still pass.

**Notes:** Slice 16 / part of #12. Catches the failure mode where someone flips `bundle.active = false` to "speed up local builds" and forgets to flip it back.

### 7. Local validation

**User value:** Confidence that the milestone PR actually produces a working `.dmg`, not just config that *looks* right.

**Acceptance criteria:**
- [ ] `cargo test` passes (entire workspace).
- [ ] `npm test` passes (Vitest + jsdom).
- [ ] `cargo tauri build` produces a `.dmg` at `target/release/bundle/dmg/Hashly_0.2.2_aarch64.dmg` (workspace target dir; `--target aarch64-apple-darwin` lands at `target/aarch64-apple-darwin/release/bundle/dmg/`).
- [ ] `.dmg` opens (mounts) when double-clicked. Drag-to-Applications works. First launch via right-click → Open shows a window titled "Hashly".

**Notes:** Slice 16 / part of #12. The `.dmg` itself is a build artifact and is *not* committed to git (covered by `target/` being gitignored).
