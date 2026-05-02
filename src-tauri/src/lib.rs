use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;

pub fn greeting() -> &'static str {
    "Hello Hashly"
}

#[derive(Debug, Serialize)]
pub struct FileOpened {
    pub path: String,
    pub name: String,
    pub content: String,
}

#[tauri::command]
fn read_md_file(path: &str) -> Result<FileOpened, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME environment variable is not set".to_string())?;
    read_md_file_within(path, &home)
}

// Slice 2 / #44: path-traversal + symlink hardening. We canonicalize
// the input path BEFORE any read so `..` segments and symlinks resolve
// to their real target, then prefix-check the canonical form against
// `allowed_root` so attacker-controlled paths cannot escape the
// allow-list. Finally, require the canonical target to be a regular
// file so directories, FIFOs, sockets, and `/dev/*` are rejected.
// A "simplifying" refactor that drops canonicalize, or reorders the
// prefix check after the read, silently re-opens this attack surface.
pub fn read_md_file_within(path: &str, allowed_root: &Path) -> Result<FileOpened, String> {
    let canonical_path = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
    let canonical_root = allowed_root.canonicalize().map_err(|e| e.to_string())?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err(format!(
            "path is outside the allowed root: {}",
            canonical_path.display()
        ));
    }

    let metadata = fs::metadata(&canonical_path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err(format!(
            "path is not a regular file: {}",
            canonical_path.display()
        ));
    }

    let content = fs::read_to_string(&canonical_path).map_err(|e| e.to_string())?;
    let name = canonical_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    Ok(FileOpened {
        path: path.to_string(),
        name,
        content,
    })
}

// Issue #49 — slice 14: returns the system user for template-new
// frontmatter autopopulation. Falls back to the literal "Author" if
// $USER is unavailable (sandboxed launches, headless runners). The
// frontend treats this as fire-and-forget — a failure to read the
// user is not a hard error; the literal fallback ships.
#[tauri::command]
fn get_current_user() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME")) // Windows fallback for cross-platform safety
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Author".to_string())
}

#[tauri::command]
fn save_md_file(path: &str, content: &str) -> Result<(), String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME environment variable is not set".to_string())?;
    save_md_file_within(path, content, &home)
}

// Slice 2 / #7 + #33 + #44: in-place save mirrors the read seam's
// canonicalize+allow-list+regular-file invariants on the WRITE side.
// Same threat model as the read path (path-traversal + symlink-following),
// now with overwrite consequences instead of read consequences. A
// "simplifying" refactor that drops canonicalize before the write, or
// reorders the prefix check after the write, silently re-opens this
// attack surface — and on the write side that means a confused-deputy
// vector against any user-writable file. Content arrives as `&str` (not
// a write-capable editor handle), enforcing #33's structural pin: no
// mutable editor surface ever crosses the IPC boundary. (#7 + #33 + #44.)
pub fn save_md_file_within(
    path: &str,
    content: &str,
    allowed_root: &Path,
) -> Result<(), String> {
    let canonical_root = allowed_root.canonicalize().map_err(|e| e.to_string())?;

    // Slice 2 + slice 14 / Save-As: the path may NOT exist yet (the
    // user just picked it via the save picker on a template-new
    // buffer). `Path::canonicalize()` returns ENOENT for non-existent
    // paths, which would block all Save-As writes. Resolve the leaf
    // by canonicalizing the PARENT directory + joining the file_name —
    // the parent must exist (the picker would not have returned a
    // path with a missing parent), so its canonical form is well-
    // defined, and the file_name itself doesn't need to resolve.
    //
    // For an existing file, this two-step resolve produces the same
    // canonical path as `path.canonicalize()` would, so the in-place
    // save path is unaffected. For a new file, the canonical path is
    // `<canonical_parent>/<file_name>`.
    let raw = Path::new(path);
    let canonical_path = match raw.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            let parent = raw
                .parent()
                .ok_or_else(|| format!("path has no parent directory: {}", path))?;
            let file_name = raw
                .file_name()
                .ok_or_else(|| format!("path has no file name component: {}", path))?;
            let canonical_parent = parent.canonicalize().map_err(|e| e.to_string())?;
            canonical_parent.join(file_name)
        }
    };

    if !canonical_path.starts_with(&canonical_root) {
        return Err(format!(
            "path is outside the allowed root: {}",
            canonical_path.display()
        ));
    }

    // For an existing path, require it to be a regular file (reject
    // directories, FIFOs, /dev/* etc.). For a new path, skip this
    // check (the metadata call would fail with ENOENT, but we WANT
    // to create it).
    if let Ok(metadata) = fs::metadata(&canonical_path) {
        if !metadata.is_file() {
            return Err(format!(
                "path is not a regular file: {}",
                canonical_path.display()
            ));
        }
    }

    fs::write(&canonical_path, content).map_err(|e| e.to_string())
}

pub fn run() {
    // Issue #5 — slice 4: switched from the `Builder::run()` one-shot
    // to the `Builder::build()` + `app.run(handler)` pattern so the
    // run-loop closure can match `RunEvent::Opened`. macOS sends
    // `RunEvent::Opened { urls }` when the user double-clicks a
    // registered .md in Finder, picks "Open With > Hashly", or runs
    // `open -a Hashly file.md`. The handler converts each `file://`
    // URL to a path string and emits a `file-opened-by-os` frontend
    // event; src/main.ts listens for that event and routes through
    // `read_md_file` → `handleFileOpened`.
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_md_file,
            save_md_file,
            get_current_user
        ])
        .setup(|app| {
            // Issue #49 — slice 14: File > New From Template submenu.
            // Each entry emits a `new-from-template` event with a
            // payload string identifying the template (`prd`, `vision`,
            // `task`); the frontend resolves the template raw text,
            // hydrates `{{author}}` / `{{date}}`, and mounts an
            // unsaved edit-mode buffer.
            let new_prd = MenuItemBuilder::with_id("new-prd", "PRD").build(app)?;
            let new_vision = MenuItemBuilder::with_id("new-vision", "Vision").build(app)?;
            let new_task = MenuItemBuilder::with_id("new-task", "Task").build(app)?;
            let new_from_template = SubmenuBuilder::new(app, "New From Template")
                .item(&new_prd)
                .item(&new_vision)
                .item(&new_task)
                .build()?;
            let open = MenuItemBuilder::with_id("open", "Open…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let file = SubmenuBuilder::new(app, "File")
                .item(&new_from_template)
                .item(&open)
                .build()?;
            let menu = MenuBuilder::new(app).item(&file).build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app_handle, event| {
                let id = event.id().0.as_str();
                match id {
                    "open" => {
                        let _ = app_handle.emit("menu-open-file", ());
                    }
                    "new-prd" => {
                        let _ = app_handle.emit("new-from-template", "prd".to_string());
                    }
                    "new-vision" => {
                        let _ = app_handle.emit("new-from-template", "vision".to_string());
                    }
                    "new-task" => {
                        let _ = app_handle.emit("new-from-template", "task".to_string());
                    }
                    _ => {}
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Hashly");

    app.run(|app_handle, event| {
        // `RunEvent::Opened` is macOS/iOS-only in Tauri 2 — gate the
        // match arm to keep Linux/Windows builds compiling. The
        // referenced `app_handle` is intentionally bound on all
        // platforms so the closure signature stays stable.
        let _ = app_handle;
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    if let Some(p) = path.to_str() {
                        let _ = app_handle.emit("file-opened-by-os", p.to_string());
                    }
                }
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        let _ = event;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greeting_says_hello_hashly() {
        assert_eq!(greeting(), "Hello Hashly");
    }
}
