# Hashly

A WYSIWYG markdown reader and editor for macOS, built with [Tauri](https://tauri.app/) v2. v0.2 ships save in place (Cmd+S), unsaved-changes-on-close dialog, Finder double-click wireup, light/dark mode (follows OS), the Hashly brand identity (palette + `#hashly` wordmark + mark), YAML frontmatter recognition, and a *File > New From Template* menu with baked-in PRD / Vision / Task templates. The unsigned `.dmg` release is deferred to a v0.2.x point release.

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [`tauri-cli`](https://v2.tauri.app/reference/cli/) v2: `cargo install tauri-cli --version "^2.0" --locked`
- macOS Xcode command line tools: `xcode-select --install`
- [Node.js](https://nodejs.org/) (`^20.19 || >=22.12`) and `npm`

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
