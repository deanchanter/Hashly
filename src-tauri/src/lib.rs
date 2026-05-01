use serde::Serialize;
use std::fs;
use std::path::Path;
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
    let p = Path::new(path);
    let content = fs::read_to_string(p).map_err(|e| e.to_string())?;
    let name = p
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_md_file])
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

    // Issue #4 — slice B: `read_md_file` is the Rust core that File>Open
    // will eventually drive over IPC. Slice B keeps it as a plain Rust
    // function so it stays headless-testable; slice C will annotate it
    // with `#[tauri::command]` and wire it into `invoke_handler!`.
    //
    // Contract pinned by these tests:
    //   1. Happy path: given a readable UTF-8 file, returns
    //      `Ok(FileOpened { path, name, content })` where
    //      `content` is byte-equal to the file contents,
    //      `path`    is the input path string verbatim,
    //      `name`    is the file_name component (basename) of that path.
    //   2. Missing file: returns `Err` (the variant carries a String;
    //      we don't pin the exact wording — that's #10's territory —
    //      but we DO pin the Err shape).
    //   3. Non-UTF-8 bytes: returns `Err`. The friendly UI for "this
    //      file isn't UTF-8" is #10; for slice B we just lock down
    //      that the function refuses non-UTF-8 input rather than
    //      silently lossily-converting it (which `String::from_utf8_lossy`
    //      would do — that would be a serious bug since the editor
    //      would render content that doesn't match the bytes on disk).

    #[test]
    fn read_md_file_happy_path_returns_file_opened_with_path_name_and_content() {
        use std::io::Write;
        let mut tmp = tempfile::Builder::new()
            .prefix("hashly-test-")
            .suffix(".md")
            .tempfile()
            .expect("could not create tempfile for happy-path test");
        write!(tmp, "# Hello\n\nworld\n").expect("could not write to tempfile");
        tmp.flush().expect("could not flush tempfile");

        let path_buf = tmp.path().to_path_buf();
        let path_str = path_buf
            .to_str()
            .expect("tempfile path is not valid UTF-8 — fix the test harness, not the contract")
            .to_string();
        let expected_name = path_buf
            .file_name()
            .and_then(|n| n.to_str())
            .expect("tempfile path has a file_name component")
            .to_string();

        let opened = read_md_file(&path_str)
            .expect("expected Ok(FileOpened) on a readable UTF-8 .md file");

        assert_eq!(
            opened.content, "# Hello\n\nworld\n",
            "expected `content` to be byte-equal to the file's contents (no lossy conversion, no trim)"
        );
        assert_eq!(
            opened.path, path_str,
            "expected `path` to be the input path verbatim (no canonicalization, no normalization)"
        );
        assert_eq!(
            opened.name, expected_name,
            "expected `name` to be the file_name (basename) component of the input path"
        );
    }

    #[test]
    fn read_md_file_missing_file_returns_err() {
        // A path that almost certainly does not exist on any test
        // machine. We use a long random-ish prefix to avoid colliding
        // with any real file a CI runner might happen to have.
        let result = read_md_file(
            "/nonexistent-hashly-test-path-9f3c2a/missing-file-do-not-create.md",
        );
        assert!(
            result.is_err(),
            "expected Err for a path that does not exist; got Ok({:?})",
            result.ok()
        );
    }

    #[test]
    fn read_md_file_rejects_non_utf8_bytes_with_err() {
        use std::io::Write;
        let mut tmp = tempfile::Builder::new()
            .prefix("hashly-test-non-utf8-")
            .suffix(".md")
            .tempfile()
            .expect("could not create tempfile for non-UTF-8 test");
        // 0xff 0xfe is a UTF-16 BOM — not valid UTF-8 (a leading byte of
        // 0xff is illegal in UTF-8 entirely). Followed by 0x00 to
        // ensure the file is non-empty even if the implementation tries
        // to be clever about empty files.
        tmp.write_all(&[0xff, 0xfe, 0x00])
            .expect("could not write non-UTF-8 bytes to tempfile");
        tmp.flush().expect("could not flush tempfile");

        let path_str = tmp
            .path()
            .to_str()
            .expect("tempfile path is not valid UTF-8")
            .to_string();
        let result = read_md_file(&path_str);

        assert!(
            result.is_err(),
            "expected Err for a file containing non-UTF-8 bytes (0xff 0xfe 0x00) — \
             a successful Ok would mean the implementation lossily converted invalid \
             bytes, which would render content that doesn't match the bytes on disk; \
             got Ok({:?})",
            result.ok()
        );
    }
}
