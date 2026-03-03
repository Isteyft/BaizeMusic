# Step 2 Completion Notes (Music Scan + Tracks API)

## Goal
Implement backend scanning for the local `./music` directory and expose a real `GET /api/tracks` response.

## What Was Completed
- Added recursive scanning for `./music` (or `MUSIC_DIR` override).
- Added supported audio format filtering:
  - `.mp3`, `.flac`, `.wav`, `.m4a`, `.ogg`
- Built basic track metadata per file:
  - `id` (hash from relative path)
  - `title`, `artist`, `album`
  - `duration` (currently placeholder `0`)
  - `streamUrl`, `lyricUrl` (if `.lrc` exists), `coverUrl` (if same-name cover exists)
- Added fallback behavior:
  - If `./music` does not exist or cannot be read, return empty list.
- Connected scan logic to `GET /api/tracks` with error handling.

## Files Involved
- `apps/backend/server/src/music/scanTracks.ts` (new)
- `apps/backend/server/src/index.ts` (updated)
