# Step 4 Completion Notes (Frontend Playlist + Basic Playback)

## Goal
Connect the frontend to backend tracks API and implement basic playback interactions:
- load playlist
- click to play track
- play/pause
- prev/next

## What Was Completed
- Added frontend-to-backend proxy in Vite:
  - `/api/*` -> `http://localhost:3000`
- Reworked `App.tsx` to:
  - Fetch `GET /api/tracks`
  - Render playlist UI
  - Keep current track index state
  - Handle click-to-switch track
  - Handle Play/Pause/Prev/Next controls
  - Bind HTMLAudioElement (`<audio>`) to current track stream URL
  - Auto-switch to next track on `ended`
- Updated page styles for a responsive two-column player layout.

## Files Involved
- `apps/frontend/website/vite.config.ts` (updated)
- `apps/frontend/website/src/App.tsx` (rewritten)
- `apps/frontend/website/src/styles.css` (rewritten)
