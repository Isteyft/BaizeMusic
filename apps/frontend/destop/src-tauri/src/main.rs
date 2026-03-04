#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures_util::StreamExt;
use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use reqwest::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopScannedTrack {
    id: String,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    file_path: String,
    cover_path: Option<String>,
    lyric_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressPayload {
    task_id: String,
    progress: f64,
    status: String,
    file_path: Option<String>,
    error: Option<String>,
}

fn is_audio_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("mp3") | Some("wav") | Some("flac") | Some("ogg") | Some("m4a") | Some("aac")
    )
}

fn first_existing_path(candidates: &[PathBuf]) -> Option<String> {
    candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .and_then(|candidate| candidate.to_str())
        .map(|path| path.to_string())
}

fn infer_track_cover_path(audio_path: &Path) -> Option<String> {
    let parent = audio_path.parent()?;
    let stem = audio_path.file_stem()?.to_str()?;
    let ext_candidates = ["jpg", "jpeg", "png", "webp"];

    let mut candidates: Vec<PathBuf> = Vec::new();
    for ext in ext_candidates {
        candidates.push(parent.join(format!("{stem}.{ext}")));
        candidates.push(parent.join(format!("{stem}.cover.{ext}")));
    }

    first_existing_path(&candidates)
}

fn infer_shared_cover_path(audio_path: &Path) -> Option<String> {
    let parent = audio_path.parent()?;
    let ext_candidates = ["jpg", "jpeg", "png", "webp"];
    let cover_names = ["cover", "folder", "front", "album", "AlbumArtSmall"];
    let mut candidates: Vec<PathBuf> = Vec::new();

    for name in cover_names {
        for ext in ext_candidates {
            candidates.push(parent.join(format!("{name}.{ext}")));
        }
    }

    first_existing_path(&candidates)
}

fn cover_ext_from_mime(mime: &str) -> &'static str {
    let normalized = mime.to_ascii_lowercase();
    if normalized.contains("jpeg") || normalized.contains("jpg") {
        return "jpg";
    }
    if normalized.contains("png") {
        return "png";
    }
    if normalized.contains("webp") {
        return "webp";
    }
    if normalized.contains("gif") {
        return "gif";
    }
    "jpg"
}

fn infer_embedded_cover_path(audio_path: &Path) -> Option<String> {
    let tagged_file = Probe::open(audio_path).ok()?.read().ok()?;
    let mut picture_data: Option<(&[u8], &str)> = None;

    for tag in tagged_file.tags() {
        if let Some(picture) = tag.pictures().first() {
            let mime = picture
                .mime_type()
                .map(|item| item.as_str())
                .unwrap_or("image/jpeg");
            picture_data = Some((picture.data(), mime));
            break;
        }
    }

    let (data, mime) = picture_data?;
    let cache_dir = std::env::temp_dir().join("baize-desktop-cover-cache");
    if fs::create_dir_all(&cache_dir).is_err() {
        return None;
    }

    let audio_path_str = audio_path.to_string_lossy();
    let cache_name = format!("{}.{}", make_track_id(&audio_path_str), cover_ext_from_mime(mime));
    let cache_path = cache_dir.join(cache_name);

    if !cache_path.exists() && fs::write(&cache_path, data).is_err() {
        return None;
    }

    cache_path.to_str().map(|path| path.to_string())
}

fn infer_lyric_path(audio_path: &Path) -> Option<String> {
    let parent = audio_path.parent()?;
    let stem = audio_path.file_stem()?.to_str()?;
    let candidates = [parent.join(format!("{stem}.lrc")), parent.join(format!("{stem}.txt"))];
    first_existing_path(&candidates)
}

fn collect_audio_files(root: &Path, output: &mut Vec<PathBuf>) {
    let read_dir = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_audio_files(&path, output);
            continue;
        }
        if is_audio_file(&path) {
            output.push(path);
        }
    }
}

fn make_track_id(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("local-{:x}", hasher.finish())
}

fn parse_artist_and_title(base_name: &str) -> (String, String) {
    const SEPARATOR: &str = " - ";
    if let Some((artist, title)) = base_name.split_once(SEPARATOR) {
        let artist = artist.trim();
        let title = title.trim();
        return (
            if artist.is_empty() {
                "Unknown Artist".to_string()
            } else {
                artist.to_string()
            },
            if title.is_empty() {
                base_name.to_string()
            } else {
                title.to_string()
            },
        );
    }
    ("Unknown Artist".to_string(), base_name.to_string())
}

fn decode_percent_encoded(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h1 = bytes[i + 1] as char;
            let h2 = bytes[i + 2] as char;
            if h1.is_ascii_hexdigit() && h2.is_ascii_hexdigit() {
                let hex = [h1, h2].iter().collect::<String>();
                if let Ok(value) = u8::from_str_radix(&hex, 16) {
                    out.push(value);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| input.to_string())
}

fn sanitize_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => ch,
        })
        .collect();
    sanitized.trim().trim_matches('.').to_string()
}

fn unique_destination_path(target_dir: &Path, file_name: &str) -> PathBuf {
    let base_path = Path::new(file_name);
    let stem = base_path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("track");
    let ext = base_path.extension().and_then(|e| e.to_str()).unwrap_or("");

    let mut candidate = target_dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let mut index: u32 = 1;
    loop {
        let next_name = if ext.is_empty() {
            format!("{stem} ({index})")
        } else {
            format!("{stem} ({index}).{ext}")
        };
        candidate = target_dir.join(next_name);
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

fn filename_from_content_disposition(value: &str) -> Option<String> {
    for part in value.split(';') {
        let trimmed = part.trim();
        if let Some(rest) = trimmed.strip_prefix("filename*=") {
            let raw = rest.trim().trim_matches('"');
            let encoded = raw
                .split_once("''")
                .map(|(_, tail)| tail)
                .unwrap_or(raw);
            if !encoded.is_empty() {
                return Some(decode_percent_encoded(encoded));
            }
        }
        if let Some(rest) = trimmed.strip_prefix("filename=") {
            let raw = rest.trim().trim_matches('"');
            if !raw.is_empty() {
                return Some(decode_percent_encoded(raw));
            }
        }
    }
    None
}

fn image_ext_from_content_type(content_type: &str) -> Option<&'static str> {
    if content_type.starts_with("image/jpeg") {
        return Some("jpg");
    }
    if content_type.starts_with("image/png") {
        return Some("png");
    }
    if content_type.starts_with("image/webp") {
        return Some("webp");
    }
    if content_type.starts_with("image/gif") {
        return Some("gif");
    }
    None
}

#[tauri::command]
async fn download_track_to_dir(
    app: tauri::AppHandle,
    task_id: String,
    download_url: String,
    target_dir: String,
    preferred_file_name: Option<String>,
    cover_url: Option<String>,
) -> Result<String, String> {
    let target_dir_path = PathBuf::from(target_dir.trim());
    if target_dir_path.as_os_str().is_empty() {
        return Err("target directory is empty".to_string());
    }

    fs::create_dir_all(&target_dir_path).map_err(|err| format!("failed to create target dir: {err}"))?;

    let response = reqwest::get(&download_url)
        .await
        .map_err(|err| format!("failed to request download url: {err}"))?;
    if !response.status().is_success() {
        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                task_id,
                progress: 0.0,
                status: "failed".to_string(),
                file_path: None,
                error: Some(format!("download failed with status: {}", response.status())),
            },
        );
        return Err(format!("download failed with status: {}", response.status()));
    }

    let header_file_name = response
        .headers()
        .get(CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())
        .and_then(filename_from_content_disposition);

    let mut file_name = match header_file_name {
        Some(name) => sanitize_filename(&name),
        None => sanitize_filename(preferred_file_name.as_deref().unwrap_or("track.mp3")),
    };
    if file_name.is_empty() {
        file_name = "track.mp3".to_string();
    }

    let destination = unique_destination_path(&target_dir_path, &file_name);
    let mut file = fs::File::create(&destination).map_err(|err| format!("failed to create file: {err}"))?;
    let total = response.content_length();
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    let _ = app.emit(
        "download-progress",
        DownloadProgressPayload {
            task_id: task_id.clone(),
            progress: 0.0,
            status: "downloading".to_string(),
            file_path: None,
            error: None,
        },
    );

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|err| format!("failed to read download body: {err}"))?;
        file.write_all(&chunk)
            .map_err(|err| format!("failed to write download file: {err}"))?;

        downloaded += chunk.len() as u64;
        let progress = match total {
            Some(size) if size > 0 => (downloaded as f64 / size as f64) * 100.0,
            _ => 0.0,
        };

        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                task_id: task_id.clone(),
                progress: progress.min(100.0),
                status: "downloading".to_string(),
                file_path: None,
                error: None,
            },
        );
    }

    file.flush()
        .map_err(|err| format!("failed to flush download file: {err}"))?;

    let final_path = destination.to_string_lossy().to_string();
    let _ = app.emit(
        "download-progress",
        DownloadProgressPayload {
            task_id,
            progress: 100.0,
            status: "completed".to_string(),
            file_path: Some(final_path.clone()),
            error: None,
        },
    );

    if let Some(url) = cover_url {
        let cover_url_trimmed = url.trim();
        if !cover_url_trimmed.is_empty() {
            if let Ok(cover_response) = reqwest::get(cover_url_trimmed).await {
                if cover_response.status().is_success() {
                    let ext = cover_response
                        .headers()
                        .get(CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .and_then(image_ext_from_content_type)
                        .unwrap_or("jpg");

                    if let Ok(cover_bytes) = cover_response.bytes().await {
                        let stem = destination
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .filter(|s| !s.is_empty())
                            .unwrap_or("track");
                        let cover_name = format!("{stem}.cover.{ext}");
                        let cover_path = target_dir_path.join(cover_name);
                        let _ = fs::write(cover_path, &cover_bytes);
                    }
                }
            }
        }
    }

    Ok(final_path)
}

fn emit_tray_control(app: &tauri::AppHandle, action: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("tray-control", action.to_string());
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn scan_music_dirs(music_dirs: Vec<String>) -> Result<Vec<DesktopScannedTrack>, String> {
    if music_dirs.is_empty() {
        return Ok(Vec::new());
    }

    let mut audio_files: Vec<PathBuf> = Vec::new();
    for dir in music_dirs {
        let trimmed = dir.trim();
        if trimmed.is_empty() {
            continue;
        }
        let root = Path::new(trimmed);
        if root.is_dir() {
            collect_audio_files(root, &mut audio_files);
        }
    }

    audio_files.sort();
    audio_files.dedup();

    let tracks = audio_files
        .into_iter()
        .filter_map(|file_path| {
            let absolute = file_path.canonicalize().unwrap_or(file_path);
            let absolute_str = absolute.to_str()?.to_string();
            let base_name = absolute
                .file_stem()
                .and_then(|name| name.to_str())
                .map(|name| name.to_string())
                .unwrap_or_else(|| "Unknown Track".to_string());
            let (artist, title) = parse_artist_and_title(&base_name);

            Some(DesktopScannedTrack {
                id: make_track_id(&absolute_str),
                title,
                artist,
                album: "Unknown Album".to_string(),
                duration: 0.0,
                file_path: absolute_str.clone(),
                cover_path: infer_track_cover_path(&absolute)
                    .or_else(|| infer_embedded_cover_path(&absolute))
                    .or_else(|| infer_shared_cover_path(&absolute)),
                lyric_path: infer_lyric_path(&absolute),
            })
        })
        .collect();

    Ok(tracks)
}

#[tauri::command]
fn pick_music_dir() -> Result<Option<String>, String> {
    let selected = rfd::FileDialog::new()
        .set_title("选择音乐目录")
        .pick_folder();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .setup(|app| {
            let show_item = MenuItemBuilder::new("显示主窗口")
                .id("show")
                .build(app)?;
            let open_music_dir_item = MenuItemBuilder::new("打开音乐目录管理")
                .id("open-music-dir")
                .build(app)?;
            let prev_item = MenuItemBuilder::new("上一首")
                .id("prev")
                .build(app)?;
            let play_pause_item = MenuItemBuilder::new("播放/暂停")
                .id("toggle-play")
                .build(app)?;
            let next_item = MenuItemBuilder::new("下一首")
                .id("next")
                .build(app)?;
            let quit_item = MenuItemBuilder::new("退出")
                .id("quit")
                .build(app)?;

            let menu = MenuBuilder::new(app)
                .items(&[
                    &show_item,
                    &open_music_dir_item,
                    &prev_item,
                    &play_pause_item,
                    &next_item,
                    &quit_item,
                ])
                .build()?;

            let mut tray_builder = TrayIconBuilder::new().menu(&menu).show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "open-music-dir" => {
                        show_main_window(app);
                        emit_tray_control(app, "open-music-dir");
                    }
                    "prev" => emit_tray_control(app, "prev"),
                    "toggle-play" => emit_tray_control(app, "toggle-play"),
                    "next" => emit_tray_control(app, "next"),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                // NOTE: 暂时注释关闭确认，后续可能恢复“是否真正关闭”的分支逻辑。
                // let result = MessageDialog::new()
                //     .set_level(MessageLevel::Info)
                //     .set_title("退出确认")
                //     .set_description("是否直接关闭应用？\n选择“否”将最小化到系统托盘。")
                //     .set_buttons(MessageButtons::YesNo)
                //     .show();
                //
                // if matches!(result, MessageDialogResult::Yes) {
                //     window.app_handle().exit(0);
                // } else {
                //     let _ = window.hide();
                // }

                // 默认行为：点击关闭仅隐藏到系统托盘，不退出进程。
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            scan_music_dirs,
            pick_music_dir,
            download_track_to_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


