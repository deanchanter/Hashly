# Hashly

A WYSIWYG markdown reader for macOS, built with [Tauri](https://tauri.app/) v2.

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
