# Step 3 Completion Notes (Stream + Lyric + Cover APIs)

## Goal
Implement backend media asset endpoints so the frontend can play audio and request lyric/cover resources by track id.

## What Was Completed
- Added track-asset lookup support based on scanned track id.
- Implemented `GET /api/tracks/:id/stream`:
  - Supports byte-range requests (`206 Partial Content`).
  - Supports full-file streaming when `Range` header is absent.
  - Handles `404`, `416`, and `500` cases.
- Implemented `GET /api/tracks/:id/lyric`:
  - Returns same-name `.lrc` file as plain text.
  - Returns `404` if lyric is missing.
- Implemented `GET /api/tracks/:id/cover`:
  - Returns same-name cover image (`jpg/jpeg/png/webp`).
  - Returns `404` if cover is missing.

## Files Involved
- `apps/backend/server/src/music/scanTracks.ts` (updated)
- `apps/backend/server/src/index.ts` (updated)
