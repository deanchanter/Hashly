# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Hashly** — a WYSIWYG markdown reader for macOS, built with [Tauri](https://tauri.app/) v2. Rust core + Vite/TypeScript frontend wiring up [Milkdown](https://milkdown.dev/). The repo was previously named `pomodoro`; update any stale references.

Specs live in `specs/`. Product direction: `specs/hashly-vision.md`. Current milestone: `specs/v0.1-wysiwyg-editor/` — contains `spec.md` (PRD) and `tasks.md` (task breakdown).

## Commands

Run from the repo root (workspace root is `Cargo.toml`; the Tauri crate is `src-tauri/`):

- `npm install` — one-time install of the JS toolkit (Vite, TypeScript, Milkdown). Required before the first `cargo tauri dev`.
- `cargo tauri dev` — usual entry point. Boots the Rust core and runs `npm run dev` automatically via `beforeDevCommand`, then opens a native window titled "Hashly". Requires `cargo install tauri-cli --version "^2.0" --locked` and Xcode CLT (`xcode-select --install`).
- `npm run dev` / `npm run build` — Vite dev server / production build. You rarely need to run these directly; `cargo tauri dev` and `cargo tauri build` invoke them via the Tauri config.
- `cargo test` — runs all Rust tests (workspace).
- `cargo test -p hashly <name>` — single test by name (e.g. `window_is_titled_hashly`).
- `npm test` — runs the Vitest frontend suite (lands with [#18](https://github.com/deanchanter/Hashly/issues/18); not wired yet).
- `cargo build` / `cargo build --release` — Rust-only build; no app bundle is produced (`bundle.active = false` in `tauri.conf.json`).

## Architecture

- **Workspace** (`/Cargo.toml`): single member `src-tauri`. The frontend sources live at the repo root (`package.json`, `index.html`, `src/main.ts`, `src/style.css`). `tauri.conf.json` points `frontendDist` at `../dist`, which is Vite's build output.
- **`src-tauri/src/lib.rs`** holds `run()`, which boots `tauri::Builder` via `generate_context!()`. The crate exposes `staticlib`, `cdylib`, and `rlib` so logic stays library-testable; `src/main.rs` is a thin binary that calls `hashly_lib::run()`. Keep app logic in `lib.rs` and reserve `main.rs` for the entry shim.
- **Tests** under `src-tauri/tests/` are integration-style and treat docs/config as part of the contract — `readme.rs` asserts the README documents `cargo tauri dev`, and `config.rs` parses `tauri.conf.json` to enforce window-title invariants. When changing window config or developer-facing docs, update/extend these tests rather than working around them. **Frontend tests** are Vitest, colocated with `src/` (planned via [#18](https://github.com/deanchanter/Hashly/issues/18)) — once wired, behavior tests for Milkdown mounting, read-only/edit toggle, and fixture rendering belong here rather than in the Rust integration suite.
- **JS toolchain: Vite + TypeScript at the repo root.** Entry HTML is `/index.html`, app code is `/src/main.ts`, styles are `/src/style.css`. `dist/` is Vite build output and is gitignored — don't edit files there. `cargo tauri dev` runs `npm run dev` automatically via `beforeDevCommand` (`devUrl: http://localhost:1420`); `cargo tauri build` runs `npm run build` via `beforeBuildCommand`.
- **Bundling is intentionally disabled** (`bundle.active = false`) until a later milestone; don't flip it casually.
