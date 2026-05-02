# Hashly

A WYSIWYG markdown reader and editor for macOS, built with [Tauri](https://tauri.app/) v2. v0.2 ships save in place (Cmd+S), unsaved-changes-on-close dialog, Finder double-click wireup, light/dark mode (follows OS), the Hashly brand identity (palette + `#hashly` wordmark + mark), YAML frontmatter recognition, and a *File > New From Template* menu with baked-in PRD / Vision / Task templates. v0.2.2 ships the unsigned `.dmg` + Homebrew cask install paths.

## Install

### Homebrew (recommended)

```sh
brew tap deanchanter/hashly
brew install --cask hashly
```

The cask auto-strips the macOS quarantine flag, so first launch works without a Gatekeeper warning.

### Direct .dmg download

Grab `Hashly_<version>_aarch64.dmg` from the [latest release](https://github.com/deanchanter/Hashly/releases/latest), double-click, drag `Hashly.app` to `/Applications`.

The `.dmg` is **unsigned** (no Apple Developer ID — see the v0.2 PRD for the rationale), so first launch shows a Gatekeeper warning ("cannot check for malicious software"). Workaround:

1. Right-click `Hashly.app` in `/Applications`.
2. Choose **Open**.
3. Confirm in the dialog. macOS records the approval and subsequent launches behave normally.

## Prerequisites (development)

- [Rust](https://rustup.rs/) (stable)
- [`tauri-cli`](https://v2.tauri.app/reference/cli/) v2: `cargo install tauri-cli --version "^2.0" --locked`
- macOS Xcode command line tools: `xcode-select --install`
- [Node.js](https://nodejs.org/) (`^20.19 || >=22.12`) and `npm`
- [`librsvg`](https://wiki.gnome.org/Projects/LibRsvg) — *only* if you intend to regenerate the icon set after editing `src/brand/icon-primary.svg`: `brew install librsvg`. The committed `src-tauri/icons/` set means routine builds do not need it.

## Develop

From the repo root, install the JS toolkit once:

```sh
npm install
```

Then start the app:

```sh
cargo tauri dev
```

This builds the Rust core, runs Vite (`npm run dev`) for the frontend via Tauri's `beforeDevCommand`, and opens a native window titled "Hashly".

## Test

```sh
cargo test
npm test
```

Frontend unit tests live in `src/__tests__/` and run via Vitest + jsdom.

## Build the bundle locally

```sh
cargo tauri build
```

Produces `Hashly_<version>_aarch64.dmg` under `target/release/bundle/dmg/` (workspace target dir; the workflow uses `--target aarch64-apple-darwin` and lands the same `.dmg` under `target/aarch64-apple-darwin/release/bundle/dmg/`). Pushing a `vX.Y.Z` git tag triggers `.github/workflows/release.yml`, which runs the same build on `macos-14` and uploads the `.dmg` to the matching GitHub release.
