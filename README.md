# Hashly

A WYSIWYG markdown reader for macOS, built with [Tauri](https://tauri.app/) v2.

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [`tauri-cli`](https://v2.tauri.app/reference/cli/) v2: `cargo install tauri-cli --version "^2.0" --locked`
- macOS Xcode command line tools: `xcode-select --install`

## Develop

From the repo root:

```sh
cargo tauri dev
```

This builds the Rust core, loads the static frontend from `dist/`, and opens a native window titled "Hashly".

## Test

```sh
cargo test
```
