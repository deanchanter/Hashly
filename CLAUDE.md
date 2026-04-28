# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repository is **Hashly** — a markdown reader. The codebase is currently empty (only `.gitattributes` and an initial commit). Language, framework, and structure have not been chosen yet.

## Guidance for future Claude Code instances

- Before assuming any conventions, re-check the working tree — once code is added, this file should be replaced with real architecture and command notes (re-run `/init`).
- If the user asks you to start building, confirm the target stack (CLI vs. desktop/Electron vs. web vs. TUI, language, framework) before scaffolding. "Markdown reader" is broad — clarify whether it's a viewer/renderer, a reading-focused editor, a TUI pager, etc.
- The repo was previously named `pomodoro`; the GitHub remote and local folder have been renamed to `Hashly`. If you encounter stale references to "pomodoro", update them.
