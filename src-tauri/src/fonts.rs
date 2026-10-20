//! Installed-font discovery, reading and installation.

use morpho_core::font::FontData;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::ipc::{InvokeBody, Request, Response};

#[derive(Clone, Serialize)]
pub struct SystemFont {
    family: String,
    style: String,
    path: String,
    index: u32,
}

const EXTENSIONS: [&str; 5] = ["ttf", "otf", "ttc", "otc", "woff"];

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

/// Folders the OS loads fonts from.
fn font_dirs() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        v.push("/System/Library/Fonts".into());
        v.push("/Library/Fonts".into());
        if let Some(h) = home() {
            v.push(h.join("Library/Fonts"));
        }
    } else if cfg!(target_os = "windows") {
        v.push(PathBuf::from(std::env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into())).join("Fonts"));
        if let Some(l) = std::env::var_os("LOCALAPPDATA") {
            v.push(PathBuf::from(l).join("Microsoft\\Windows\\Fonts"));
        }
    } else {
        v.push("/usr/share/fonts".into());
        v.push("/usr/local/share/fonts".into());
        if let Some(h) = home() {
            v.push(h.join(".local/share/fonts"));
            v.push(h.join(".fonts"));
        }
    }
    v
}

/// Where user-installed fonts go.
fn user_font_dir() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        home().map(|h| h.join("Library/Fonts"))
    } else if cfg!(target_os = "windows") {
        std::env::var_os("LOCALAPPDATA").map(|l| PathBuf::from(l).join("Microsoft\\Windows\\Fonts"))
    } else {
        home().map(|h| h.join(".local/share/fonts"))
    }
}

fn is_font(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if depth > 5 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, depth + 1, out);
        } else if is_font(&p) {
            out.push(p);
        }
    }
}

fn scan() -> Vec<SystemFont> {
    let mut files = Vec::new();
    for d in font_dirs() {
        walk(&d, 0, &mut files);
    }
    let mut out = Vec::new();
    for path in files {
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let Ok(first) = FontData::load(&bytes, 0) else { continue };
        let faces = first.info.faces.max(1);
        let path_str = path.to_string_lossy().into_owned();
        out.push(SystemFont { family: first.info.family.clone(), style: first.info.style.clone(), path: path_str.clone(), index: 0 });
        for i in 1..faces.min(64) {
            if let Ok(f) = FontData::load(&bytes, i) {
                out.push(SystemFont { family: f.info.family, style: f.info.style, path: path_str.clone(), index: i });
            }
        }
    }
    out.sort_by(|a, b| a.family.to_lowercase().cmp(&b.family.to_lowercase()).then(a.style.cmp(&b.style)));
    out.dedup_by(|a, b| a.family == b.family && a.style == b.style);
    out
}

static CACHE: OnceLock<Vec<SystemFont>> = OnceLock::new();

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    if let Some(c) = CACHE.get() {
        return Ok(c.clone());
    }
    let list = tauri::async_runtime::spawn_blocking(scan).await.map_err(|e| e.to_string())?;
    Ok(CACHE.get_or_init(|| list).clone())
}

/// Read a font file. Only font files inside the OS font folders are allowed.
#[tauri::command]
pub fn read_font_file(path: String) -> Result<Response, String> {
    let p = PathBuf::from(&path).canonicalize().map_err(|e| e.to_string())?;
    let allowed = font_dirs().iter().filter_map(|d| d.canonicalize().ok()).any(|d| p.starts_with(d));
    if !allowed || !is_font(&p) {
        return Err("That file isn't in a system font folder.".into());
    }
    std::fs::read(&p).map(Response::new).map_err(|e| e.to_string())
}

/// Install a font into the user's font folder. Body: raw font bytes;
/// header `x-file-name`: URI-encoded file name.
#[tauri::command]
pub fn install_font(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw font bytes.".into());
    };
    #[cfg_attr(not(windows), allow(unused_variables))]
    let font = FontData::load(bytes, 0).map_err(|e| format!("Not a valid font: {e}"))?;
    let raw_name = request.headers().get("x-file-name").and_then(|v| v.to_str().ok()).unwrap_or("Morphotype.ttf");
    let decoded = percent_decode(raw_name);
    let stem: String = Path::new(&decoded)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Morphotype")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(80)
        .collect();
    let stem = if stem.is_empty() { "Morphotype".to_string() } else { stem };
    let dir = user_font_dir().ok_or("Couldn't find your font folder.")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut dest = dir.join(format!("{stem}.ttf"));
    if let Err(e) = std::fs::write(&dest, bytes) {
        // Windows keeps fonts open while apps use them: install beside the old file.
        if !cfg!(windows) {
            return Err(e.to_string());
        }
        dest = (2..100).map(|n| dir.join(format!("{stem}-{n}.ttf"))).find(|p| std::fs::write(p, bytes).is_ok()).ok_or_else(|| e.to_string())?;
    }
    #[cfg(windows)]
    register_windows_font(&dest, &font.info.full_name)?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Per-user fonts on Windows are listed in the registry (so they load at
/// sign-in) and added to the session, then running apps are told.
#[cfg(windows)]
fn register_windows_font(path: &Path, name: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Graphics::Gdi::AddFontResourceW;
    use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_FONTCHANGE};
    let wide = |s: &OsStr| s.encode_wide().chain([0]).collect::<Vec<u16>>();
    let file = wide(path.as_os_str());
    let key = wide(OsStr::new("Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"));
    let value = wide(OsStr::new(&format!("{name} (TrueType)")));
    // SAFETY: every pointer is a NUL-terminated UTF-16 buffer that outlives the call.
    let status = unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), value.as_ptr(), REG_SZ, file.as_ptr().cast(), (file.len() * 2) as u32) };
    if status != 0 {
        return Err(format!("Couldn't register the font with Windows (error {status})."));
    }
    // SAFETY: as above; the broadcast result isn't needed.
    unsafe {
        AddFontResourceW(file.as_ptr());
        SendMessageTimeoutW(HWND_BROADCAST, WM_FONTCHANGE, 0, 0, SMTO_ABORTIFHUNG, 1000, std::ptr::null_mut());
    }
    Ok(())
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h << 4 | l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::{percent_decode, scan};

    #[test]
    fn scanning_never_panics() {
        for f in scan() {
            assert!(!f.family.is_empty());
        }
    }

    #[test]
    fn decodes_names() {
        assert_eq!(percent_decode("My%20Font-Regular.ttf"), "My Font-Regular.ttf");
        assert_eq!(percent_decode("bad%2"), "bad%2");
        assert_eq!(percent_decode("%"), "%");
        assert_eq!(percent_decode("caf%C3%A9%é"), "café%é");
    }
}
