// Morphotype desktop shell. The editor UI and the WebAssembly engine run in the
// system web view (WKWebView on macOS); this process adds what a browser can't:
// native file dialogs, the installed-font library and font installation.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fonts;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![fonts::list_system_fonts, fonts::read_font_file, fonts::install_font])
        .run(tauri::generate_context!())
        .expect("error while running Morphotype");
}
