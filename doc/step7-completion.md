# Step 7 Completion Notes (Tests + Hardening + Validation)

## Goal
Finalize the project with core utility tests, shared utility extraction, and verification records.

## What Was Completed
- Extracted reusable utility logic into `@baize/utils`:
  - `formatTime`
  - `parseLrc`
- Refactored frontend to consume shared utilities instead of local duplicated logic.
- Added utility test runner for critical functions:
  - time formatting behavior
  - `.lrc` parsing behavior
  - invalid-input fallback behavior
- Added workspace test orchestration support:
  - root `test` script (`turbo test`)
  - `turbo.json` `test` task

## Validation Executed
- `pnpm --filter @baize/utils test` -> passed
- `pnpm --filter @baize/utils typecheck` -> passed
- `pnpm --filter @baize/website typecheck` -> passed

## Files Involved
- `packages/utils/package.json` (updated)
- `packages/utils/tsconfig.json` (new)
- `packages/utils/tsconfig.test.json` (new)
- `packages/utils/src/index.ts` (new)
- `packages/utils/src/time.ts` (new)
- `packages/utils/src/lyric.ts` (new)
- `packages/utils/src/run-tests.ts` (new)
- `apps/frontend/website/package.json` (updated)
- `apps/frontend/website/src/App.tsx` (updated)
- `package.json` (updated)
- `turbo.json` (updated)
