# Latest Feature Updates

## Scope

This document summarizes the latest implementation updates in the music player.

## Backend Updates

-   Added track download endpoint:
    -   `GET /api/tracks/:id/download`
    -   Returns audio file as attachment with proper content type.
-   Existing cover handling remains:
    -   external cover file support
    -   embedded cover extraction support

## Frontend Updates

### 1. Download Feature

-   Added current-track download button in the bottom dock.
-   Added download action in track right-click context menu.

### 2. Track Right-Click Context Menu

-   Added context menu on track list items.
-   Menu actions:
    -   `播放当前歌曲`
    -   `添加到播放列表`
    -   `下载歌曲`
-   Context menu stability improvements:
    -   rendered via portal to `document.body`
    -   high z-index to avoid overlay/cropping issues
    -   click-outside close behavior

### 3. Custom Playlist Panel

-   Added playlist button next to volume controls.
-   Clicking opens a popover panel showing current custom playlist.
-   Playlist panel supports click-to-play immediately.
-   Playlist title shows track count:
    -   `当前播放列表（N 首）`

### 4. Queue Behavior (Prev/Next/Auto Next)

-   Prev/Next are now queue-driven (playlist-first).
-   If custom playlist exists:
    -   switching follows playlist order
    -   supports circular navigation:
        -   next from last -> first
        -   prev from first -> last
-   If current track is not inside custom playlist:
    -   next -> playlist first
    -   prev -> playlist last
-   If custom playlist is empty:
    -   fallback queue is the full track list.

### 5. UI/Interaction Polishing

-   Bottom player dock remains fixed.
-   Lyric area keeps frosted cover background and scroll-safe content container.
-   Volume uses hover/focus popover with vertical slider.
-   Vinyl record animation remains active while playing, with reduced rotation speed.

## Main Files Updated

-   `apps/backend/server/src/index.ts`
-   `apps/frontend/website/src/App.tsx`
-   `apps/frontend/website/src/styles.css`

## Verification

-   Frontend typecheck passed:
    -   `pnpm --filter @baize/website typecheck`
-   Backend typecheck passed in earlier steps for related endpoint changes.

## 2026-03-03 Incremental Update (Playlist UX)

### New Features

-   Added a small search button in the track list header.
-   Search panel can be toggled to filter tracks by title/artist/album keywords.
-   Added delete button for each item in the custom playlist popover.
-   Playlist item can now be removed directly from the popover without opening context menu.

### Fixes

-   Fixed playlist popover button style conflict with `.volume-wrap button`.
-   Scoped playlist button styles under `.playlist-popover` to avoid global dock button styles overriding height/size.

### Files Updated

-   `apps/frontend/website/src/App.tsx`
-   `apps/frontend/website/src/styles.css`

## 2026-03-03 Incremental Update (Mobile Lyric + Play Mode)

### Mobile Sync

-   Synced desktop lyric display capability to mobile (`React Native + Expo`):
    -   load `lyricUrl`
    -   parse LRC
    -   active-line highlight
    -   auto-scroll to active line
-   Synced desktop play mode behavior to mobile:
    -   sequential
    -   random
    -   single loop
-   Mobile playback end and prev/next now respect current play mode.

### Files Updated

-   `apps/frontend/mobile/App.tsx`
-   `doc/mobile-latest-updates.md`

## 2026-03-03 Incremental Update (Mobile Queue Sync)

### Mobile Sync

-   Synced desktop custom queue behavior to mobile:
    -   queue-first playback (`custom queue -> full list fallback`)
    -   queue-based prev/next and auto-next
    -   sequential/random/single modes now work on effective queue
-   Added mobile queue management actions:
    -   add to queue from track list
    -   play queue item
    -   remove queue item
    -   clear queue

### Files Updated

-   `apps/frontend/mobile/App.tsx`
-   `doc/mobile-latest-updates.md`

## 2026-03-03 Incremental Update (Android Build Stability)

### Mobile Fix

-   Fixed Android native build failure in `expo-av` on Windows:
    -   failure signature: `ninja: error: manifest 'build.ninja' still dirty after 100 tries`
-   Applied persistent pnpm patch to `expo-av@15.0.2`:
    -   `patches/expo-av@15.0.2.patch`
    -   adds `set(CMAKE_SUPPRESS_REGENERATION ON)` in `expo-av/android/CMakeLists.txt`
-   Registered patch in root `package.json` under `pnpm.patchedDependencies`.

### Verification

-   Re-ran full Android build with the same parameters as failing command and confirmed `BUILD SUCCESSFUL`.

## 2026-03-04 Incremental Update (Root Build Integration)

### Monorepo Scripts

-   Added root-level build entrypoints for desktop and Android packaging:
    -   `pnpm build` (parallel: desktop + Android)
    -   `pnpm build:desktop` (`@baize/destop` -> `tauri:build`)
    -   `pnpm build:android` (`@baize/mobile` -> `android:release`)
-   Added usage section in README for root build commands.

### Files Updated

-   `package.json`
-   `README.md`
