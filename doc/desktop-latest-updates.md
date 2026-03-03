# Desktop Latest Updates

## Scope

This document summarizes the recent desktop-side updates in `apps/frontend/destop`.

## Icon And Window Behavior

-   Web favicon unified to `.ico` (`/favicon.ico`) for desktop webview entry.
-   Tauri close behavior changed to "hide to tray" by default:
    -   close-confirmation logic is kept as comments for future restore.
    -   current behavior on close is `window.hide()`.

## Music List And Playback UX

-   Added refresh button next to the track list title.
-   Refresh now preserves current playing track when possible:
    -   keep current track by `track.id` after reload.
    -   avoid reloading `audio.src` if track identity did not change.
-   Added explicit audio error handling for local/remote source load failures.

## Download Workflow (Desktop)

-   Download now requires local music directories.
-   Default save target is the first configured directory (`musicDirs[0]`).
-   Local tracks hide download actions (context menu + dock button).
-   If no local target directory is configured, download entry is hidden.

## Download List Panel

-   Added "下载列表" button next to refresh in track list header.
-   Added floating download panel:
    -   shows task list
    -   shows status (`pending/downloading/completed/failed`)
    -   shows progress percentage and progress bar
    -   shows final saved file path when completed
-   Implemented download progress events from Tauri backend (`download-progress`).

## Local Metadata / Cover Improvements

-   Desktop local scan now parses artist/title from filename pattern:
    -   `artist - title`
    -   fallback artist: `Unknown Artist`
-   Download naming adjusted to prefer:
    -   `${artist} - ${title}`
-   `Content-Disposition` filename decoding improved:
    -   supports `filename*=` and percent-encoded values.
-   If external cover file is missing for local tracks:
    -   parse embedded cover from audio tags.
    -   write extracted cover into local temp cache:
        -   `%TEMP%/baize-desktop-cover-cache`
    -   return cached image path as `coverPath`.
-   Downloaded tracks also try to save server cover to sibling `*.cover.*` file.

## Tauri / Config Changes

-   Enabled local asset protocol in `tauri.conf.json`:
    -   `app.security.assetProtocol.enable = true`
    -   `app.security.assetProtocol.scope = ["**"]`
-   Added/updated Rust dependencies:
    -   `reqwest` (`rustls-tls`, `stream`)
    -   `futures-util`
    -   `lofty`

## Single Instance (Desktop)

-   Desktop app is now limited to a single running instance.
-   Added Tauri single-instance plugin:
    -   `tauri-plugin-single-instance`
-   When a second launch is attempted:
    -   no new process window is created
    -   existing `main` window is shown and focused

## Files Updated

-   `apps/frontend/destop/index.html`
-   `apps/frontend/destop/public/favicon.ico`
-   `apps/frontend/destop/src/App.tsx`
-   `apps/frontend/destop/src/styles.css`
-   `apps/frontend/destop/src-tauri/tauri.conf.json`
-   `apps/frontend/destop/src-tauri/Cargo.toml`
-   `apps/frontend/destop/src-tauri/Cargo.lock`
-   `apps/frontend/destop/src-tauri/src/main.rs`

## Validation

-   `pnpm --filter @baize/destop typecheck`
-   `cargo check --manifest-path apps/frontend/destop/src-tauri/Cargo.toml`
