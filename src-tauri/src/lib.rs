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

    fs::write(&canonical_path, content).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_md_file, save_md_file])
        .setup(|app| {
            let open = MenuItemBuilder::with_id("open", "Open…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let file = SubmenuBuilder::new(app, "File").item(&open).build()?;
            let menu = MenuBuilder::new(app).item(&file).build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app_handle, event| {
                if event.id().0 == "open" {
                    let _ = app_handle.emit("menu-open-file", ());
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Hashly");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greeting_says_hello_hashly() {
        assert_eq!(greeting(), "Hello Hashly");
    }
}
