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
