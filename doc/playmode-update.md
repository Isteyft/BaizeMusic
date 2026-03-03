# Play Mode Update

## Scope

This update adds a play mode switch to the player controls and wires queue behavior to the selected mode.

## New Feature

-   Added a play mode button next to `Next`.
-   Clicking the button cycles through:
    -   `顺序` (sequential)
    -   `随机` (random)
    -   `单曲` (single loop)

## Behavior

-   `Next` button now follows selected play mode.
-   Auto-next on track end also follows selected play mode.
-   Mode behavior works with the existing queue logic:
    -   custom playlist queue first
    -   full track list fallback when custom playlist is empty

## Mode Rules

-   顺序:
    -   next track follows queue order with wrap-around.
-   随机:
    -   next track is randomly selected from queue.
    -   tries to avoid immediately repeating current track when possible.
-   单曲:
    -   next track remains the current track (single track loop).

## UI Changes

-   Added mode button styling (`.mode-btn`) in controls.
-   Mode button label updates in real time (`顺序 / 随机 / 单曲`).

## Files Updated

-   `apps/frontend/website/src/App.tsx`
-   `apps/frontend/website/src/styles.css`

## Verification

-   `pnpm --filter @baize/website typecheck` passed.
