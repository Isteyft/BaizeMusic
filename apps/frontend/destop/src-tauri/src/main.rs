#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

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

fn infer_cover_path(audio_path: &Path) -> Option<String> {
    let parent = audio_path.parent()?;
    let stem = audio_path.file_stem()?.to_str()?;
    let ext_candidates = ["jpg", "jpeg", "png", "webp"];

    let mut candidates: Vec<PathBuf> = Vec::new();
    for ext in ext_candidates {
        candidates.push(parent.join(format!("{stem}.{ext}")));
        candidates.push(parent.join(format!("{stem}.cover.{ext}")));
    }

    let cover_names = ["cover", "folder", "front", "album", "AlbumArtSmall"];
    for name in cover_names {
        for ext in ext_candidates {
            candidates.push(parent.join(format!("{name}.{ext}")));
        }
    }

    first_existing_path(&candidates)
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
            let title = absolute
                .file_stem()
                .and_then(|name| name.to_str())
                .map(|name| name.to_string())
                .unwrap_or_else(|| "未知歌曲".to_string());

            Some(DesktopScannedTrack {
                id: make_track_id(&absolute_str),
                title,
                artist: "未知歌手".to_string(),
                album: "未知专辑".to_string(),
                duration: 0.0,
                file_path: absolute_str.clone(),
                cover_path: infer_cover_path(&absolute),
                lyric_path: infer_lyric_path(&absolute),
            })
        })
        .collect();

    Ok(tracks)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![scan_music_dirs])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
