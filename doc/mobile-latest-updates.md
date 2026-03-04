# Mobile Latest Updates

## Scope

This document summarizes the initial mobile app setup in `apps/frontend/mobile`.

## Tech Stack

-   React Native
-   Expo SDK 52
-   TypeScript
-   Workspace shared packages:
    -   `@baize/types`
    -   `@baize/utils`

## What Was Added

### 1. Mobile App Bootstrap

-   Created Expo app entry and runtime config:
    -   `app.json`
    -   `babel.config.cjs`
    -   `metro.config.cjs`
    -   `tsconfig.json`
    -   `expo-env.d.ts`

### 2. Player UI And Data Flow

-   Implemented track list loading from backend:
    -   `GET /api/tracks`
-   Implemented basic playback with `expo-av`:
    -   play / pause
    -   previous / next
    -   current time / duration display
-   Added Android emulator compatibility for local backend:
    -   default API base is `http://10.0.2.2:3000` on Android
    -   default API base is `http://localhost:3000` on iOS/web

### 3. Environment Configuration

-   Added `.env.example`:
    -   `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3000`
-   Supports overriding backend API endpoint by environment variable.

### 4. Monorepo Script Integration

-   Added root script:
    -   `pnpm dev:mobile`
-   Runs server + mobile app in parallel through Turbo.

## Main Files Added/Updated

-   `apps/frontend/mobile/App.tsx`
-   `apps/frontend/mobile/package.json`
-   `apps/frontend/mobile/app.json`
-   `apps/frontend/mobile/babel.config.cjs`
-   `apps/frontend/mobile/metro.config.cjs`
-   `apps/frontend/mobile/tsconfig.json`
-   `apps/frontend/mobile/expo-env.d.ts`
-   `apps/frontend/mobile/.env.example`
-   `package.json`
-   `README.md`

## Validation

-   `pnpm --filter @baize/mobile typecheck`
-   `pnpm --filter @baize/mobile dev -- --help`

## 2026-03-03 Incremental Update (Lyric + Play Mode Sync)

### New Features

-   Synced lyric display behavior from desktop to mobile:
    -   load lyric from `track.lyricUrl`
    -   parse LRC via `parseLrc`
    -   highlight active line by playback position
    -   auto-scroll lyric panel to active line
-   Synced play mode logic from desktop to mobile:
    -   `sequential`
    -   `random`
    -   `single` (single-track loop)
-   Added play mode switch button in player controls:
    -   cycles as `sequential -> random -> single -> sequential`

### Playback Behavior

-   `didJustFinish` now respects current play mode.
-   `prev/next` actions also respect current play mode.
-   Random mode avoids selecting the same track repeatedly when possible.

## 2026-03-03 Incremental Update (Custom Queue Sync)

### New Features

-   Synced desktop custom playlist (queue) logic to mobile:
    -   custom queue IDs state (`playlistTrackIds`)
    -   queue-first playback (`effectiveQueueIds`)
    -   queue cursor calculation by current track
-   Added queue management UI on mobile:
    -   add track to custom queue from track list
    -   play queue item directly
    -   remove single queue item
    -   clear full queue

### Queue Behavior

-   Prev/next and auto-next now follow the same queue strategy as desktop:
    -   when custom queue is not empty, queue is custom queue
    -   when custom queue is empty, queue falls back to full track list
-   Sequential mode in queue:
    -   wrap-around next/prev
    -   if current track is outside queue, next starts from queue head, prev from queue tail
-   Random mode in queue:
    -   random pick within effective queue only
    -   avoids current track when alternatives exist
-   Single mode in queue:
    -   repeats current track

## Run Commands

```bash
# run backend + mobile
pnpm dev:mobile

# run only mobile (Expo)
pnpm --filter @baize/mobile dev
```

## 2026-03-03 Incremental Update (Android Build Fix)

### Problem

-   Android build failed at:
    -   `:expo-av:buildCMakeDebug[x86_64]`
    -   `ninja: error: manifest 'build.ninja' still dirty after 100 tries`

### Fix

-   Added a persistent pnpm patch for `expo-av@15.0.2`:
    -   file: `patches/expo-av@15.0.2.patch`
    -   change: set `CMAKE_SUPPRESS_REGENERATION ON` in `expo-av/android/CMakeLists.txt`
-   Registered patch in root `package.json`:
    -   `pnpm.patchedDependencies["expo-av@15.0.2"]`

### Validation

-   Verified command succeeds:
    -   `apps/frontend/mobile/android/gradlew.bat app:assembleDebug -x lint -x test --configure-on-demand --build-cache -PreactNativeDevServerPort=8281 -PreactNativeArchitectures=x86_64,arm64-v8a`

## 2026-03-04 Incremental Update (UI Refactor + Local Import + Seek)

### Player UI Refactor

-   Rebuilt mobile player layout in `apps/frontend/mobile/App.tsx`:
    -   top menu button
    -   middle vinyl record area
    -   top 2-3 lines lyric preview
    -   song title + artist above progress bar
    -   progress time below progress bar
    -   bottom control order:
        -   mode
        -   previous
        -   play/pause
        -   next
        -   playlist
-   Control button sizing updated to small on both sides and larger center play button.

### Record And Cover Tuning

-   Vinyl record and cover size increased:
    -   record ring: `308 x 308`
    -   cover image: `204 x 204`
-   Record rotation behavior:
    -   rotates continuously only while playing
    -   pauses at current angle when playback pauses
    -   speed tuned to `36s` per full circle.

### Progress Bar Interaction

-   Progress bar now supports drag-seek:
    -   press and drag horizontally to preview target position
    -   release to commit seek using `Audio.Sound.setPositionAsync`.

### Song Menu And Playlist Interaction

-   Left slide-out song list (from top menu) updated:
    -   left side tap on track: play immediately
    -   right side `+` button: add to custom playlist.
-   Playlist bottom sheet retained:
    -   remove single track
    -   clear all tracks.

### Android Local Media Import

-   Added import actions at the top of the song menu:
    -   `添加目录` (Android SAF directory picker)
    -   `添加歌曲` (Android document picker, supports multi-select)
-   Supported audio extensions for directory scan:
    -   `mp3`, `m4a`, `aac`, `wav`, `flac`, `ogg`, `opus`
-   Imported files are appended as local tracks and can be played/queued directly.

### Dependency Updates

-   Added mobile dependencies for local file import:
    -   `expo-document-picker`
    -   `expo-file-system`
-   Added/locked web preview dependencies for Expo SDK 52 compatibility:
    -   `@expo/metro-runtime@~4.0.1`
    -   `react-dom@18.3.1`
    -   `react-native-web@~0.19.13`
-   Added script:
    -   `pnpm --filter @baize/mobile web:offline`

### Validation

-   `pnpm --filter @baize/mobile typecheck` passed after the refactor and follow-up tuning.

## 2026-03-04 Incremental Update (Build Fixes + Branding + Cover Parsing + Encoding)

### Android Build / Packaging Fixes

-   Fixed release bundle root resolution issue in monorepo:
    -   root cause: Expo embed bundling resolved project root to repo root.
    -   workaround used during build:
        -   `EXPO_NO_METRO_WORKSPACE_ROOT=1`
        -   `NODE_ENV=production`
-   Fixed module path error:
    -   replaced `expo-file-system/legacy` with `expo-file-system`.
-   Fixed multiple syntax issues in `App.tsx` introduced by broken string encoding.

### App Branding Sync

-   Synced mobile launcher icon source with desktop icon:
    -   source: `apps/frontend/destop/src-tauri/icons/icon.png`
    -   generated Android launcher assets:
        -   `mipmap-mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi`
        -   `baize_launcher.png`
        -   `baize_launcher_round.png`
-   Updated app name to `白泽音乐`:
    -   `apps/frontend/mobile/app.json`
    -   `apps/frontend/mobile/android/app/src/main/res/values/strings.xml`
    -   `apps/frontend/mobile/android/app/src/main/AndroidManifest.xml`

### Local Cover Parsing (Mobile)

-   Added local cover inference when importing directory:
    -   same-name image: `<trackName>.(jpg|jpeg|png|webp)`
    -   `.cover` variant: `<trackName>.cover.(jpg|jpeg|png|webp)`
    -   shared folder cover names:
        -   `cover`, `folder`, `front`, `album`, `albumartsmall`
-   Added embedded cover parsing from audio metadata (ID3 APIC):
    -   read first `512KB` of audio file.
    -   parse ID3 frame and extract APIC image as `data:` URI.
    -   if SAF/content URI read fails, copy to cache and retry parsing.
-   Cover priority on import:
    1. embedded cover (ID3 APIC)
    2. inferred local image cover in same directory
-   Duplicate local-track merge behavior improved:
    -   when track already exists by `streamUrl`, cover can be backfilled if old record has no `coverUrl`.

### Text Encoding Cleanup

-   Replaced visible mojibake/garbled Chinese strings in mobile UI text.
-   Unified runtime UI labels to readable Chinese in main screens and import panels.

### Files Updated In This Round

-   `apps/frontend/mobile/App.tsx`
-   `apps/frontend/mobile/app.json`
-   `apps/frontend/mobile/android/app/src/main/AndroidManifest.xml`
-   `apps/frontend/mobile/android/app/src/main/res/values/strings.xml`
-   `apps/frontend/mobile/android/app/src/main/res/mipmap-*/baize_launcher*.png`
-   `doc/mobile-latest-updates.md`

## 2026-03-04 Incremental Update (Build/Network Error Logs + Fix Record)

### Build Error Log Snapshot (Before Fix)

-   Command sequence used (problematic order):
    -   `.\gradlew clean assembleRelease`
    -   then set:
        -   `$env:NODE_ENV='production'`
        -   `$env:EXPO_NO_METRO_WORKSPACE_ROOT='1'`
-   Key logs:
    -   `The NODE_ENV environment variable is required but was not specified.`
    -   `Error: Unable to resolve module ./index.js from E:\Projs\monorepo-dev-starter\.:`
    -   `Task :app:createBundleReleaseJsAndAssets FAILED`

### Build Fix Applied

-   Root cause:
    -   env vars were set after Gradle invocation, so Expo embed bundling still resolved from monorepo root.
-   Fix:
    -   set env vars before Gradle build:
        -   `NODE_ENV=production`
        -   `EXPO_NO_METRO_WORKSPACE_ROOT=1`
-   Added fixed script:
    -   `apps/frontend/mobile/scripts/build-release.ps1`
-   Added npm script:
    -   `pnpm --filter @baize/mobile android:release`

### Runtime Streaming Error Log Snapshot (Before Fix)

-   Playback error on Android:
    -   `com.google.android.exoplayer2.upstream.HttpDataSource$HttpDataSourceException`
    -   `java.net.UnknownServiceException: CLEARTEXT communication to m801.music.126.net not permitted by network security policy`

### Network Security Fix Applied

-   Added Android network security whitelist for NetEase music domain:
    -   `apps/frontend/mobile/android/app/src/main/res/xml/network_security_config.xml`
    -   allows cleartext only for:
        -   `music.126.net` (`includeSubdomains="true"`)
-   Wired config in manifest:
    -   `apps/frontend/mobile/android/app/src/main/AndroidManifest.xml`
    -   `<application ... android:networkSecurityConfig="@xml/network_security_config" ...>`

## 2026-03-04 Incremental Update (Search + Network Track Persistence + App Name Fix)

### Song Search (Mobile Side Menu)

-   Added song search input in slide-out song panel.
-   Search supports:
    -   track title
    -   artist
    -   album
-   Empty-state text for search:
    -   `未找到匹配歌曲`
-   Fixed filtered-list playback/index behavior:
    -   active row highlight now matches by `track.id`
    -   play action resolves real index via `trackMap` to avoid wrong track playback after filtering.

### Network Music Import Persistence

-   Added persistent storage for network track URLs in mobile settings:
    -   `networkTrackUrls`
-   Import flow:
    -   when adding network music URL, it appends both:
        -   runtime track list
        -   persisted `networkTrackUrls`
-   App startup restore flow:
    -   read persisted `networkTrackUrls`
    -   regenerate `network-*` tracks into current list
-   Delete flow sync:
    -   deleting a network track removes its URL from persisted settings.
-   Fixed data merge behavior on backend track reload:
    -   previously only `local-*` tracks were preserved
    -   now preserves all user-imported tracks:
        -   `local-*`
        -   `network-*`

### App Name Garbled Text Fix

-   Fixed Android app name mojibake:
    -   `apps/frontend/mobile/android/app/src/main/res/values/strings.xml`
        -   `app_name` -> `白泽音乐`
    -   `apps/frontend/mobile/android/app/src/main/AndroidManifest.xml`
        -   `android:label` changed to `@string/app_name` for stable source-of-truth.

### Files Updated In This Round

-   `apps/frontend/mobile/App.tsx`
-   `apps/frontend/mobile/android/app/src/main/res/values/strings.xml`
-   `apps/frontend/mobile/android/app/src/main/AndroidManifest.xml`
-   `doc/mobile-latest-updates.md`

## 2026-03-04 Incremental Update (Network Music Form + Rich Persistence)

### Network Music Add Flow (UI)

-   Changed `添加网络音乐` from inline input to modal form.
-   Form fields:
    -   music URL (required)
    -   song title (optional)
    -   artist (optional)
    -   lyric URL (optional)
-   Validation:
    -   music URL must start with `http://` or `https://`
    -   lyric URL (if filled) must start with `http://` or `https://`

### Network Music Persistence (Data Model Upgrade)

-   Upgraded mobile settings schema from URL-only list to structured list:
    -   from: `networkTrackUrls: string[]`
    -   to: `networkTracks: Array<{ url; title?; artist?; lyricUrl? }>`
-   Startup restore now reconstructs network tracks with custom title/artist/lyric URL.
-   Delete network track now syncs back to persisted `networkTracks`.

### Backward Compatibility

-   Added migration compatibility on settings load:
    -   if old `networkTrackUrls` exists and new `networkTracks` is empty,
        it auto-converts old URLs into new structured items.

### Files Updated In This Round

-   `apps/frontend/mobile/App.tsx`
-   `doc/mobile-latest-updates.md`
