# Cover Read Fix Notes

## Issue
Music cover images could not be displayed for many tracks.

## Root Cause
- Backend only tried same-name external image files (for example `song.jpg`).
- Embedded cover art inside audio files (ID3/FLAC picture) was not supported.
- External cover matching was strict and case-sensitive.

## Fix Applied
- Added embedded cover extraction with `music-metadata`.
- Extended external cover filename matching to include:
  - same-name image (`<songname>.jpg/.jpeg/.png/.webp`)
  - common names (`cover.*`, `folder.*`, `front.*`, `album.*`)
- Made sibling-file matching case-insensitive.
- Updated `/api/tracks/:id/cover` behavior:
  1. return external cover file if found
  2. otherwise return embedded cover binary if available
  3. otherwise return `404`
- Added short-lived scan cache to reduce repeated filesystem scanning.

## Files Changed
- `apps/backend/server/src/music/scanTracks.ts`
- `apps/backend/server/src/index.ts`
- `apps/backend/server/package.json`
- `pnpm-lock.yaml`

## Verification
- Backend typecheck passed:
  - `pnpm --filter @baize/server typecheck`
