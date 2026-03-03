# Step 6 Completion Notes (Cover + Lyric Sync)

## Goal
Implement music cover rendering and lyric display with time-based highlighting.

## What Was Completed
- Added cover rendering in player area:
  - Uses `track.coverUrl` when available.
  - Falls back to placeholder block when missing or load fails.
- Added lyric loading flow:
  - Fetches lyric text from `track.lyricUrl`.
  - Handles loading/error/empty states.
- Added `.lrc` parser in frontend:
  - Parses `[mm:ss.xx]` timeline tags.
  - Supports multi-tag lines.
  - Sorts lines by timeline.
- Added lyric sync and highlight:
  - Computes active lyric line by `currentTime`.
  - Highlights current line.
  - Auto-scrolls active line into view.
- Updated responsive player layout and styles for cover/lyric panel.

## Files Involved
- `apps/frontend/website/src/App.tsx` (updated)
- `apps/frontend/website/src/styles.css` (updated)
