# EthioTrack Validation Baseline

## Repository baseline
- Branch: `production-v3` (Lovable working ref `edit/edt-*`)
- Commit: not captured (Lovable manages git state)
- Package manager: **bun** (bun 1.3.3)
- Lockfile: `bun.lock` (text lockfile per `bunfig.toml`)
- Node version: not pinned in repo (no `.nvmrc`, no `engines.node`, no `.node-version`)
- Package-manager version: `bun@1.3.3` (confirmed via `bun --version`)

## Existing scripts (pre-task)
- `dev`: `vite dev`
- `build`: `vite build`
- `build:dev`: `vite build --mode development`
- `preview`: `vite preview`
- `lint`: `eslint .`
- `format`: `prettier --write .`
- `test`: `vitest run`
- `test:visual`: `python tests/visual/responsive.py`

No `typecheck`, `format:check`, or `verify` script existed prior to this task.

## Commands executed

### `bun install --frozen-lockfile`
- Result: **pass** (exit 0)
- Notes: lockfile satisfied, no drift.

### `bunx tsc --noEmit`
- Result: **fail** (exit 2)
- Output:
  ```
  src/lib/ocr-parser.ts(193,17): error TS18048: 'r.date' is possibly 'undefined'.
  src/lib/ocr-parser.ts(223,48): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
    Type 'undefined' is not assignable to type 'string'.
  ```

### `bun run lint` (`eslint .`)
- Result: **fail** (exit 1)
- Notes: numerous `prettier/prettier` violations across `src/routes/*.tsx`, `src/components/*.tsx`, and `src/lib/*.ts`. All are formatting-only diagnostics surfaced through `eslint-plugin-prettier`. No functional or type rules were violated.

### `bunx prettier --check .`
- Result: **fail** (exit 1)
- Notes: same underlying formatting drift as the ESLint prettier plugin reports. No code behavior implications.

### `bun run test` (`vitest run`)
- Result: **pass** (exit 0)
- Summary: 2 test files, 35 tests passed.

### `bun run build` (`vite build`)
- Result: **pass** (exit 0)
- Notes: production bundle builds successfully; Vite/TanStack Start build does not gate on `tsc`, so pre-existing type errors do not block the build.

## Confirmed existing failures

TypeScript (`tsc --noEmit`):

- `src/lib/ocr-parser.ts(193,17)` — **TS18048**: `'r.date' is possibly 'undefined'.`
- `src/lib/ocr-parser.ts(223,48)` — **TS2345**: `Argument of type 'string | undefined' is not assignable to parameter of type 'string'.`

Formatting (`prettier --check` / `eslint prettier/prettier`): widespread drift in application source. Enumerated by the tools; not itemized here because Task 0.1A does not fix formatting.

## Existing test inventory

Test files (unchanged):
- `src/lib/parser.test.ts`
- `src/lib/distributor-parser.test.ts`

Visual test harness (unchanged, Python-based, out of scope for `verify`):
- `tests/visual/responsive.py` invoked via `bun run test:visual`

Test command: `bun run test` → `vitest run`.

## Configuration gaps

- No Node.js version is pinned (`.nvmrc`, `.node-version`, or `engines.node`). `engines.node` was **not** added because the supported version is not documented anywhere in the repo.
- No CI configuration was inspected or changed.
- Prettier is configured (`.prettierrc`, `.prettierignore`) and a dev dependency exists, so `format:check` is included in `verify`.
- Pre-existing formatting drift means `lint`, `format:check`, and therefore `verify` will fail until a separate formatting pass is run. This task does not perform that pass.

## Changes made in this task

- `package.json`
  - Added script `"typecheck": "tsc --noEmit"`.
  - Added script `"format:check": "prettier --check ."`.
  - Added script `"verify": "bun run typecheck && bun run lint && bun run format:check && bun run test && bun run build"`.
  - Added `"packageManager": "bun@1.3.3"` (exact version confirmed via `bun --version`).
- `docs/baseline-report.md` — this file.

No source, configuration, dependency, lockfile, or generated file was modified. No dependency was added or removed.

## Next step

Task 0.1B will fix only the two confirmed TypeScript failures in `src/lib/ocr-parser.ts` (lines 193 and 223) without changing parser or OCR behavior.