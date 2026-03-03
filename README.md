# Baize Monorepo

Baize is a music player monorepo built with `pnpm workspace + turbo`.

It includes:

-   Backend service (`Node.js + Express`)
-   Web frontend (`React + Vite`)
-   Desktop app (`Tauri 2 + React`)
-   Shared packages (`types`, `utils`, `ui`, etc.)

## Repository Layout

```txt
apps/
  backend/server
  frontend/website
  frontend/destop   # keep current folder name: "destop"
packages/
doc/
music/              # sample local music directory
```

## Requirements

-   Node.js 18+
-   pnpm 10+
-   Rust toolchain (required for desktop)
-   Windows (desktop flow is primarily verified on Windows)

## Install

```bash
pnpm install --no-frozen-lockfile
```

## Run

### Start services separately

```bash
# backend
pnpm --filter @baize/server dev

# web
pnpm --filter @baize/website dev

# desktop (Tauri)
pnpm --filter @baize/destop tauri:dev
```

### Combined scripts

```bash
# server + website
pnpm dev

# server + website + desktop (vite)
pnpm dev:all

# server + desktop (vite)
pnpm dev:desktop

# server + desktop (tauri)
pnpm dev:tauri
```

## Main Features

### Shared player features (Web + Desktop)

-   Track list loading
-   Play/pause, previous/next
-   Seek and volume control
-   Lyric display
-   Cover display with blur background
-   Play modes: sequential / random / single loop
-   Track context menu: play, add to playlist, download (rule-based visibility)

### Desktop-specific features (Tauri)

-   Custom title bar and window controls
-   Close action defaults to hide-to-tray
-   Tray controls: show window, prev, play/pause, next, quit
-   Local music directory management (multiple directories)
-   Local scan for audio, lyric, and cover
-   Embedded cover fallback parsing for local files
-   Download to local directory (defaults to first configured directory)
-   Download list popup with task status, progress, and saved path
-   Refresh button for track list with playback-preserving behavior

## Local Filename Rule

Recommended local file naming:

```txt
Artist - Title.ext
```

Desktop local parsing follows this rule:

-   `artist` and `title` are parsed from filename
-   if separator is missing, `artist` falls back to `Unknown Artist`

## Validation Commands

```bash
# workspace typecheck
pnpm typecheck

# desktop frontend typecheck
pnpm --filter @baize/destop typecheck

# desktop rust check
cargo check --manifest-path apps/frontend/destop/src-tauri/Cargo.toml
```

## Documents

-   `doc/website-to-tauri-migration.md`
-   `doc/latest-feature-updates.md`
-   `doc/desktop-latest-updates.md`
