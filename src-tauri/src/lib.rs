pub fn greeting() -> &'static str {
    "Hello Hashly"
}

pub fn run() {
    tauri::Builder::default()
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
