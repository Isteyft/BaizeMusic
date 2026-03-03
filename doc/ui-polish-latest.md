# UI Polish Latest Update

## Scope
This document records the latest frontend layout and interaction refinements for the music player UI.

## Main Updates
- Player dock is fixed at the bottom.
- Main page layout:
  - left panel: playlist
  - right panel: lyrics area
- Control buttons are icon-first style and placed above the progress bar.
- Progress time labels are placed on the left and right sides of the progress slider.
- Vinyl disc added next to track title:
  - outer record style ring
  - center cover image
  - rotates while playing
  - rotation speed reduced for smoother visual effect

## Lyric Area Improvements
- Frosted background now uses the track cover image and is clipped with rounded corners.
- Backdrop coverage was expanded to remove visible 1-2px top/bottom gaps.
- Lyric container was refactored to:
  - scroll on overflow
  - keep content centered in normal cases
  - avoid long lyrics visually filling and breaking the full area
- Visible scrollbars are hidden while keeping scroll behavior.

## Volume Interaction Changes
- Replaced persistent horizontal volume bar with hover/focus popover near volume button.
- Popover uses a vertical slider for volume adjustment.
- Popover bounds were fixed so the slider stays fully inside the element.

## Files Updated In This Round
- `apps/frontend/website/src/App.tsx`
- `apps/frontend/website/src/styles.css`

## Validation
- Frontend typecheck passed:
  - `pnpm --filter @baize/website typecheck`
