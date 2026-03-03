# Website Player to Tauri Desktop Migration

## Goal

Migrate the existing `apps/frontend/website` music player UI/logic into `apps/frontend/destop` (Tauri 2 desktop frontend).

## What Was Migrated

-   Copied music player page implementation from website to desktop app:
    -   player controls
    -   lyric panel
    -   playlist features
    -   context menu actions
    -   download action
    -   play mode behavior

## Dependency Updates

-   Added workspace dependencies to desktop app:
    -   `@baize/types`
    -   `@baize/utils`

## Dev Proxy Updates

-   Updated desktop Vite config to proxy backend APIs:
    -   `/api` -> `http://localhost:3000`

## Files Updated

-   `apps/frontend/destop/src/App.tsx`
-   `apps/frontend/destop/src/styles.css`
-   `apps/frontend/destop/package.json`
-   `apps/frontend/destop/vite.config.ts`

## Validation

-   Ran dependency install:
    -   `pnpm install --no-frozen-lockfile`
-   Typecheck passed:
    -   `pnpm --filter @baize/destop typecheck`

## Run Instructions

1. Start backend:
    - `pnpm --filter @baize/server dev`
2. Start Tauri desktop app:
    - `pnpm --filter @baize/destop tauri:dev`

---

## 2026-03-03 Desktop Native Integration Update

### 1. Hidden Native Windows Title Bar

-   Updated Tauri window config to hide native title bar:
    -   `apps/frontend/destop/src-tauri/tauri.conf.json`
    -   window option added: `"decorations": false`

### 2. Added Custom In-App Title Bar

-   Implemented a custom title bar in React page:
    -   app title
    -   music directory management entry
    -   minimize / maximize / close controls (via Tauri window API)
-   Main file:
    -   `apps/frontend/destop/src/App.tsx`

### 3. Added Download Music Directory Management Menu

-   Added path management panel in title bar menu:
    -   add local music directory path
    -   remove single path
    -   clear all paths
    -   auto close on outside click
-   Storage:
    -   localStorage key: `baize_desktop_music_dirs`

### 4. Desktop Reads Local Paths and Builds Player List

-   Desktop now scans configured local directories recursively for music files.
-   Supported audio extensions:
    -   `mp3`, `wav`, `flac`, `ogg`, `m4a`, `aac`
-   For each track, it also auto-detects:
    -   lyric file (`same_name.lrc` / `same_name.txt`)
    -   cover file (same-name image or folder cover file)
-   Rust command:
    -   `scan_music_dirs(music_dirs: Vec<String>)`
-   Rust file:
    -   `apps/frontend/destop/src-tauri/src/main.rs`

### 5. Frontend Integration Details

-   React side invokes Tauri command:
    -   `invoke("scan_music_dirs", { musicDirs })`
-   Converts local file paths to WebView URLs:
    -   `convertFileSrc(...)`
-   Scanned tracks are mapped into existing player list and queue logic.

### 6. Style Updates

-   Added styles for:
    -   `.titlebar`
    -   `.titlebar-btn`
    -   `.path-panel`
    -   `.path-list`
-   Updated app layout height calculations to work with fixed title bar + fixed bottom dock.
-   File:
    -   `apps/frontend/destop/src/styles.css`

### 7. Validation

-   Rust check passed:
    -   `cargo check` in `apps/frontend/destop/src-tauri`
-   TypeScript check passed:
    -   `pnpm --filter @baize/destop typecheck`

---

## 2026-03-03 Titlebar Control and Icon Refresh Update

### 1. Window Capability Fixes

-   Added missing Tauri v2 permissions in capability config:
    -   `core:window:allow-minimize`
    -   `core:window:allow-toggle-maximize`
    -   `core:window:allow-close`
    -   `core:window:allow-start-dragging`
-   File:
    -   `apps/frontend/destop/src-tauri/capabilities/default.json`

### 2. Titlebar Drag and Window Action Binding

-   Custom titlebar now supports dragging the whole window.
-   Window control buttons are bound to:
    -   `minimize`
    -   `toggleMaximize`
    -   `close`
-   Added error handling for window API calls to prevent uncaught promise errors.
-   File:
    -   `apps/frontend/destop/src/App.tsx`

### 3. Icon Library Integration

-   Added `lucide-react` and replaced text/Unicode icons with SVG icons.
-   Updated icon usage for:
    -   titlebar controls
    -   previous/play/pause/next
    -   download/playlist/volume
    -   play mode button
-   Files:
    -   `apps/frontend/destop/package.json`
    -   `apps/frontend/destop/src/App.tsx`
    -   `apps/frontend/destop/src/styles.css`

### 4. Minimize and Maximize/Restore Icon Corrections

-   Minimize icon changed to standard minus icon.
-   Maximize button now reflects real window state:
    -   not maximized -> maximize icon
    -   maximized -> restore icon
-   State synchronization implemented via Tauri window resize listener.
-   File:
    -   `apps/frontend/destop/src/App.tsx`

### 5. Text Encoding Fix

-   Fixed garbled Chinese text in player UI labels and messages.
-   Corrected:
    -   song list title
    -   context menu labels
    -   loading/error messages
    -   accessibility labels (`aria-label`)
-   File:
    -   `apps/frontend/destop/src/App.tsx`

### 6. Validation

-   TypeScript check passed:
    -   `pnpm --filter @baize/destop typecheck`
