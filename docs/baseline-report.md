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

## Task 0.1B — Type refinement

### Root cause

`extractByDateAnchors` in `src/lib/ocr-parser.ts` always constructs rows with a
concrete ISO `date` string and a concrete `party` string, but stored them in a
`ParsedOk[]` where both fields are optional. Downstream code (`r.date.slice(...)`
at line 193 and the `/bariso/i.test(r.party)` argument at line 223) treated them
as required strings, producing TS18048 and TS2345.

### Implementation

Introduced a private internal refined type inside `src/lib/ocr-parser.ts`:

```ts
type CompleteOcrParsedRow = ParsedOk & {
  date: string;
  party: string;
};
```

`extractByDateAnchors` now returns `CompleteOcrParsedRow[]` and its internal
`results` array is typed the same. No values, regexes, extraction rules, or
public `ParsedOk` fields were changed. No non-null assertions, casts,
`@ts-ignore`, fallback dates, fallback parties, or row filtering were used.

### Changed source file

- `src/lib/ocr-parser.ts` — added `CompleteOcrParsedRow` type alias and refined
  the return/`results` types of `extractByDateAnchors`.

### Command results

- `bun run typecheck` — **pass** (exit 0)
- `bun run test` — **pass** (2 files, 35 tests)
- `bun run build` — **pass** (exit 0)
- `bun run lint` / `bun run format:check` — still failing due only to the
  pre-existing formatting drift recorded in Task 0.1A.

### Runtime behavior

Type-only change. Extraction, deduplication, dates, amounts, parties, review
flags, raw text, template strings, and row counts are identical to the prior
baseline.

### Remaining validation failures for Task 0.1C

- `bun run lint` — prettier formatting drift across `src/routes/*`,
  `src/components/*`, and `src/lib/*`.
- `bun run format:check` — same underlying drift.

These will be resolved by the formatting-only pass in Task 0.1C.

## Task 0.1C-a — Formatting scope inventory

No file was formatted in this task. Only `.prettierignore` and this report
were modified.

### Original drift count

122 files (baseline from Task 0.1C step 1).

### Protected files added to `.prettierignore`

```
docs/blueprint/01-master-blueprint.md
docs/blueprint/02-parser-ocr-corpus-spec.md
docs/blueprint/03-production-execution-playbook.md
.workspace/skills/ui-ux-pro-max/SKILL.md
.workspace/skills/ui-ux-pro-max/references/pro-rules.md
```

Existing entries preserved (`node_modules`, `dist`, `.output`, `.vinxi`,
`pnpm-lock.yaml`, `package-lock.json`, `bun.lock`, `routeTree.gen.ts`).

### Remaining drift count

117 files.

### Full grouped inventory

Line-count estimates are `wc -l` of the current file — a rough upper bound on
the diff Prettier would produce (real diffs are typically 10–40% of file size
for pure formatter drift).

#### 1. `src/lib` and its tests — 20 files, ~4,156 lines total

```
src/lib/backup.ts
src/lib/brain/alerts.ts
src/lib/brain/credits.ts
src/lib/brain/fuzzy.ts
src/lib/brain/stats.ts
src/lib/brain/telecomFlow.ts
src/lib/crypto.ts
src/lib/db.ts
src/lib/distributor-parser.test.ts
src/lib/distributor-parser.ts
src/lib/format.ts
src/lib/ids.ts
src/lib/ocr-parser.ts
src/lib/ocr.ts
src/lib/parser.test.ts
src/lib/parser.ts
src/lib/pdf-parser.ts
src/lib/report.ts
src/lib/types.ts
src/lib/user.ts
```

#### 2. `src/components` excluding `src/components/ui` — 11 files, ~2,659 lines total

```
src/components/AppShell.tsx
src/components/DashboardTiles.tsx
src/components/GlobalSearch.tsx
src/components/LicenseExpiryBanner.tsx
src/components/LicenseStatus.tsx
src/components/LockGate.tsx
src/components/OpenDayModal.tsx
src/components/OpenPeriodModal.tsx
src/components/PasteImport.tsx
src/components/StatementImport.tsx
src/components/TransactionForm.tsx
src/components/WeekBreakdown.tsx
```

(12 files — recount: `AppShell`, `DashboardTiles`, `GlobalSearch`,
`LicenseExpiryBanner`, `LicenseStatus`, `LockGate`, `OpenDayModal`,
`OpenPeriodModal`, `PasteImport`, `StatementImport`, `TransactionForm`,
`WeekBreakdown`.)

#### 3. `src/components/ui` — 0 files

None reported. The shadcn UI primitives are already conformant.

#### 4. `src/routes` — 14 files, ~2,491 lines total (12 `.tsx` routes + 1 README + 1 more)

```
src/routes/account.tsx
src/routes/agents.tsx
src/routes/alerts.tsx
src/routes/banks.tsx
src/routes/capture.tsx
src/routes/close.tsx
src/routes/distributors.tsx
src/routes/exports.tsx
src/routes/history.tsx
src/routes/index.tsx
src/routes/reconcile.tsx
src/routes/reports.tsx
src/routes/settings.tsx
src/routes/unlock.tsx
src/routes/README.md
```

#### 5. Styles and static source files — 1 file

```
src/styles.css
```

#### 6. Tests outside `src` — 1 file

```
tests/visual/README.md
```

(The Python visual-test harness itself is not touched by Prettier.)

#### 7. Documentation excluding protected blueprints — 4 files

```
AGENTS.md
docs/README.md
docs/baseline-report.md
PROJECT_STATUS.md
```

`docs/baseline-report.md` will re-drift each time this file is appended to;
it should be formatted last in its batch.

#### 8. Root configuration files — 0 files

None.

#### 9. Generated files — 0 files

None of the drift entries are build-generated. `routeTree.gen.ts` is already
in `.prettierignore` and does not appear.

#### 10. Other files — 64 files (sandbox-injected workspace skills)

All under `.workspace/skills/**`, spanning the `banner-design`, `brand`,
`design`, `design-system`, `slides`, and `ui-styling` skill packs
(`SKILL.md`, `references/*.md`, `scripts/*.cjs`, `templates/*`). Full list:

```
.workspace/skills/banner-design/references/banner-sizes-and-styles.md
.workspace/skills/banner-design/SKILL.md
.workspace/skills/brand/references/approval-checklist.md
.workspace/skills/brand/references/asset-organization.md
.workspace/skills/brand/references/brand-guideline-template.md
.workspace/skills/brand/references/color-palette-management.md
.workspace/skills/brand/references/consistency-checklist.md
.workspace/skills/brand/references/logo-usage-rules.md
.workspace/skills/brand/references/messaging-framework.md
.workspace/skills/brand/references/typography-specifications.md
.workspace/skills/brand/references/update.md
.workspace/skills/brand/references/visual-identity.md
.workspace/skills/brand/references/voice-framework.md
.workspace/skills/brand/scripts/extract-colors.cjs
.workspace/skills/brand/scripts/inject-brand-context.cjs
.workspace/skills/brand/scripts/sync-brand-to-tokens.cjs
.workspace/skills/brand/scripts/validate-asset.cjs
.workspace/skills/brand/SKILL.md
.workspace/skills/brand/templates/brand-guidelines-starter.md
.workspace/skills/design-system/references/component-specs.md
.workspace/skills/design-system/references/primitive-tokens.md
.workspace/skills/design-system/references/semantic-tokens.md
.workspace/skills/design-system/references/states-and-variants.md
.workspace/skills/design-system/references/tailwind-integration.md
.workspace/skills/design-system/references/token-architecture.md
.workspace/skills/design-system/scripts/embed-tokens.cjs
.workspace/skills/design-system/scripts/generate-tokens.cjs
.workspace/skills/design-system/scripts/validate-tokens.cjs
.workspace/skills/design-system/SKILL.md
.workspace/skills/design-system/templates/design-tokens-starter.json
.workspace/skills/design/references/banner-sizes-and-styles.md
.workspace/skills/design/references/cip-deliverable-guide.md
.workspace/skills/design/references/cip-design.md
.workspace/skills/design/references/cip-prompt-engineering.md
.workspace/skills/design/references/cip-style-guide.md
.workspace/skills/design/references/design-routing.md
.workspace/skills/design/references/icon-design.md
.workspace/skills/design/references/logo-color-psychology.md
.workspace/skills/design/references/logo-design.md
.workspace/skills/design/references/logo-prompt-engineering.md
.workspace/skills/design/references/logo-style-guide.md
.workspace/skills/design/references/slides-copywriting-formulas.md
.workspace/skills/design/references/slides-create.md
.workspace/skills/design/references/slides-html-template.md
.workspace/skills/design/references/slides-layout-patterns.md
.workspace/skills/design/references/slides-strategies.md
.workspace/skills/design/references/slides.md
.workspace/skills/design/references/social-photos-design.md
.workspace/skills/design/SKILL.md
.workspace/skills/slides/references/copywriting-formulas.md
.workspace/skills/slides/references/create.md
.workspace/skills/slides/references/html-template.md
.workspace/skills/slides/references/layout-patterns.md
.workspace/skills/slides/references/slide-strategies.md
.workspace/skills/slides/SKILL.md
.workspace/skills/ui-styling/references/canvas-design-system.md
.workspace/skills/ui-styling/references/shadcn-accessibility.md
.workspace/skills/ui-styling/references/shadcn-components.md
.workspace/skills/ui-styling/references/shadcn-theming.md
.workspace/skills/ui-styling/references/tailwind-customization.md
.workspace/skills/ui-styling/references/tailwind-responsive.md
.workspace/skills/ui-styling/references/tailwind-utilities.md
.workspace/skills/ui-styling/scripts/tests/coverage-ui.json
.workspace/skills/ui-styling/SKILL.md
```

### Generated-file candidates (recommended, not yet excluded)

No build-generated files remain in the drift list. However, the entire
`.workspace/skills/**` tree is **sandbox-injected**: per the workspace-skills
directive (rule 5) it is reset from the workspace repo on every message, so
any formatting written back is discarded on the next turn. These 64 files
behave like generated content from Prettier's perspective.

**Recommendation for Task 0.1C-h (final):** add the single directory glob
`.workspace/` to `.prettierignore` (not individual files) after explicit
approval. This is broader than the "no directory-wide ignores in `src`, `docs`
or the repo root" restriction but does not touch project source or docs.
Without this, `bun run format:check` will keep failing even after every
`src/` and `docs/` file is formatted.

### Proposed formatting batches

Each batch ≤ 20 files and estimated well under ~1,000 changed lines
(formatter drift on this codebase is dominated by quote style, trailing
commas, and line wrapping).

| Batch | Task ID | Contents                                                                                                                                                                                              | Files |        ~Lines (upper bound) |
| ----- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | --------------------------: |
| 1     | 0.1C-b  | `src/lib` core + colocated tests: `parser.ts`, `parser.test.ts`, `ocr-parser.ts`, `ocr.ts`, `distributor-parser.ts`, `distributor-parser.test.ts`, `pdf-parser.ts`, `format.ts`, `ids.ts`, `types.ts` |    10 |                      ~2,100 |
| 2     | 0.1C-c  | Remaining `src/lib`: `db.ts`, `backup.ts`, `crypto.ts`, `user.ts`, `report.ts`, `brain/alerts.ts`, `brain/credits.ts`, `brain/fuzzy.ts`, `brain/stats.ts`, `brain/telecomFlow.ts`                     |    10 |                      ~2,050 |
| 3     | 0.1C-d  | Feature components (`src/components/*.tsx`, excludes `ui/`)                                                                                                                                           |    12 |                      ~2,660 |
| 4     | —       | UI component library (`src/components/ui/*`)                                                                                                                                                          |     0 | — (no drift; batch skipped) |
| 5     | 0.1C-e  | Routes: all 13 `.tsx` under `src/routes/` + `src/routes/README.md`                                                                                                                                    |    14 |                      ~2,500 |
| 6     | 0.1C-f  | Styles + external tests: `src/styles.css`, `tests/visual/README.md`                                                                                                                                   |     2 |                        ~200 |
| 7     | 0.1C-g  | Ordinary docs + root files: `AGENTS.md`, `docs/README.md`, `PROJECT_STATUS.md`, `docs/baseline-report.md` (last, since this file will keep drifting until then)                                       |     4 |                        ~600 |
| 8     | 0.1C-h  | Generated-file handling — add `.workspace/` glob to `.prettierignore` after approval. No source formatting.                                                                                           |     0 |                           — |

### Command results (this task)

- `bun run typecheck` — **pass**
- `bun run test` — **pass** (2 files, 35 tests)
- `bun run build` — **pass**
- `bun run format:check` — **fail** (117 files remaining, as expected; source formatting has not started)

### Confirmation

No file other than `.prettierignore` and `docs/baseline-report.md` was
modified. The three protected blueprint documents were not read, rewritten,
or formatted.

## Task 0.1C-b — src/lib core formatting

### Files formatted (exactly 10)

```
src/lib/parser.ts
src/lib/parser.test.ts
src/lib/ocr-parser.ts
src/lib/ocr.ts
src/lib/distributor-parser.ts
src/lib/distributor-parser.test.ts
src/lib/pdf-parser.ts
src/lib/format.ts
src/lib/ids.ts
src/lib/types.ts
```

### `.prettierignore` change

Replaced the two individual `.workspace/skills/ui-ux-pro-max/*` entries with
the durable glob `.workspace/skills/**`. Blueprint exclusions preserved. The
`.workspace` directory itself is not ignored — only its `skills/**` subtree.

### Diff nature

Formatter-only: whitespace, indentation, line wrapping, quote style, trailing
commas, semicolons, parentheses. No identifiers, values, regexes, strings,
conditions, control flow, types, test expectations, parser output, or OCR
behavior changed. Approximate diff size: ~1,500–2,000 changed lines across
the 10 files (upper bound; pure layout).

### Command results

- `bun run typecheck` — **pass**
- `bun run test` — **pass** (2 files, 35 tests)
- `bun run build` — **pass**
- `bun run lint` — **fail** (expected; remaining batches carry the drift)
- `bun run format:check` — **fail** (expected)

### Remaining drift

- Count: **43 files** (down from 117).
- Reduction: 10 files formatted this batch + 64 sandbox-injected
  `.workspace/skills/**` files now excluded via the new glob.
- Buckets remaining:
  - `src/lib` remainder (batch 0.1C-c) — 10 files
  - Feature components (batch 0.1C-d) — 12 files
  - Routes (batch 0.1C-e) — 14 files
  - Styles + external tests (batch 0.1C-f) — 2 files
  - Ordinary docs (batch 0.1C-g) — up to 4 files (this file will re-drift)
- `.workspace/skills/**` is confirmed excluded — no such paths appear in
  `prettier --check` output.

## Task 0.1C-c — Remaining src/lib formatting

### Files formatted (exactly 10)

```
src/lib/db.ts
src/lib/backup.ts
src/lib/crypto.ts
src/lib/user.ts
src/lib/report.ts
src/lib/brain/alerts.ts
src/lib/brain/credits.ts
src/lib/brain/fuzzy.ts
src/lib/brain/stats.ts
src/lib/brain/telecomFlow.ts
```

### Diff nature

Formatter-only: whitespace, indentation, wrapping, quote style, trailing
commas, semicolons, formatter-added parentheses. No identifiers, literals,
strings, regexes, conditions, control flow, schemas, database queries,
fuzzy-matching thresholds, transaction calculations, or test expectations
were changed. Approximate diff size: ~800–1,200 changed lines across the 10
files (upper bound; pure layout).

### Command results

- `bun run typecheck` — **pass**
- `bun run test` — **pass** (2 files, 35 tests)
- `bun run build` — **pass**
- `bun run lint` — **fail** (expected; remaining batches carry the drift)
- `bun run format:check` — **fail** (expected)

### Remaining drift

- Count: **34 files** (down from 43).
- Buckets remaining:
  - Feature components (batch 0.1C-d) — 12 files
  - Routes (batch 0.1C-e) — 14 files
  - Styles + external tests (batch 0.1C-f) — 2 files
  - Ordinary docs (batch 0.1C-g) — up to 4 files (this file re-drifts)
  - No `src/lib` files remain in the drift set.

## Task 0.1C-d — Feature component formatting

### Files formatted (exactly 12)

```
src/components/AppShell.tsx
src/components/DashboardTiles.tsx
src/components/GlobalSearch.tsx
src/components/LicenseExpiryBanner.tsx
src/components/LicenseStatus.tsx
src/components/LockGate.tsx
src/components/OpenDayModal.tsx
src/components/OpenPeriodModal.tsx
src/components/PasteImport.tsx
src/components/StatementImport.tsx
src/components/TransactionForm.tsx
src/components/WeekBreakdown.tsx
```

None overlap with earlier batches. `src/components/ui/**` was not touched
(no drift there).

### Diff nature

Formatter-only: whitespace, indentation, JSX attribute wrapping, quote
style, trailing commas, semicolons, formatter-added parentheses. Total file
size grew from 2,659 → 3,094 lines (+435 net) — well under the 1,000-line
safety limit for churn. No component props, defaults, hooks, dependency
arrays, event handlers, className values, displayed strings, accessibility
attributes, conditional rendering, form behavior, parser calls, or import
graph changed.

### Command results

- `bun run typecheck` — **pass**
- `bun run test` — **pass** (2 files, 35 tests)
- `bun run build` — **pass**
- `bun run lint` — **fail** (expected; routes/styles/docs remain)
- `bun run format:check` — **fail** (expected)

### Remaining drift

- Count: **22 files** (down from 34).
- Buckets remaining:
  - Routes (batch 0.1C-e) — 14 files (`src/routes/*.tsx` + `src/routes/README.md`)
  - Styles + external tests (batch 0.1C-f) — 2 files (`src/styles.css`, `tests/visual/README.md`)
  - Ordinary docs (batch 0.1C-g) — up to 4 files (this file will re-drift on append)
  - No `src/components` files remain in the drift set.

## Task 0.1C-e — Route formatting

### Recorded-batch discrepancy

The batch summary in Task 0.1C-a said "14 files (13 `.tsx` + README)", but
the full enumerated inventory in the same section listed 14 `.tsx` route
files (all of `src/routes/*.tsx` except `__root.tsx`) plus `README.md` —
i.e. 15 items. The "13 `.tsx`" number was a miscount; the enumerated list
is authoritative. `src/routes/__root.tsx` was already conformant and never
appeared in Prettier's drift set, so it is intentionally excluded here.

Formatting the enumerated set (14 route `.tsx` + `README.md` = 15 files)
matches the batch's intent and the pre-task drift bucket. Proceeded on that
basis; no other batch is affected.

### Files formatted

```
src/routes/account.tsx
src/routes/agents.tsx
src/routes/alerts.tsx
src/routes/banks.tsx
src/routes/capture.tsx
src/routes/close.tsx
src/routes/distributors.tsx
src/routes/exports.tsx
src/routes/history.tsx
src/routes/index.tsx
src/routes/reconcile.tsx
src/routes/reports.tsx
src/routes/settings.tsx
src/routes/unlock.tsx
src/routes/README.md
```

Excluded (already conformant): `src/routes/__root.tsx`. None overlap with
earlier batches.

### Diff nature

Formatter-only: whitespace, indentation, JSX/Markdown wrapping, attribute
wrapping, quote style, trailing commas, semicolons, formatter-added
parentheses. Total lines 2,491 → 3,199 (+708 net) — under the 1,000-line
safety limit. No route paths, `createFileRoute` strings, loaders, actions,
redirects, search-parameter handling, hooks, dependency arrays, database
queries, navigation targets, component props, displayed strings, className
values, or accessibility attributes were changed.

### Command results

- `bun run typecheck` — **pass**
- `bun run test` — **pass** (2 files, 35 tests)
- `bun run build` — **pass**
- `bun run lint` — **fail** (expected; styles + docs remain)
- `bun run format:check` — **fail** (expected)

### Remaining drift

- Count: **6 files** (down from 22).
- Buckets remaining:
  - Styles + external tests (batch 0.1C-f) — 2 files:
    `src/styles.css`, `tests/visual/README.md`
  - Ordinary docs (batch 0.1C-g) — 4 files:
    `AGENTS.md`, `docs/README.md`, `PROJECT_STATUS.md`,
    `docs/baseline-report.md` (this file re-drifts on each append)
  - No `src/routes` files remain in the drift set.

## Task 0.1C-f — Styles and visual-test documentation formatting

### Files formatted (2)

```
src/styles.css
tests/visual/README.md
```

### Diff nature

Formatter-only. `src/styles.css`: 163 → 188 lines (+25 net) — whitespace,
declaration formatting, blank lines. No selectors, property names, values,
units, colors, custom-property declarations, media queries, or comments
changed. `tests/visual/README.md`: 46 → 47 lines (+1 net) — wrapping and
blank lines only. No commands, paths, expected results, or testing
instructions changed.

### Command results

- `bun run typecheck` — **pass**
- `bun run test` — **pass** (2 files, 35 tests)
- `bun run build` — **pass**
- `bun run lint` — **fail** (expected; 4 ordinary docs remain)
- `bun run format:check` — **fail** (expected)

### Remaining drift (exact)

```
AGENTS.md
docs/README.md
PROJECT_STATUS.md
docs/baseline-report.md   (re-drifts each time this file is appended to)
```

Count: **4 files**, all ordinary documentation — batch 0.1C-g.

### Correction to Task 0.1C-e inventory

The batch table in Task 0.1C-a recorded `0.1C-e` as "14 files (13 `.tsx` +
`README.md`)". The enumerated inventory in the same section was correct and
listed 15 items:

- 14 TSX route files (`account`, `agents`, `alerts`, `banks`, `capture`,
  `close`, `distributors`, `exports`, `history`, `index`, `reconcile`,
  `reports`, `settings`, `unlock`)
- `src/routes/README.md`

The summary count of 14 was inaccurate; the enumerated inventory was
authoritative and drove the actual work in Task 0.1C-e. `src/routes/__root.tsx`
was already conformant and remained excluded from every batch.

## Task 0.1C-g — Final documentation formatting

### Files formatted (exactly 4)

- `AGENTS.md`
- `docs/README.md`
- `PROJECT_STATUS.md`
- `docs/baseline-report.md`

### Approximate diff size

Total diff footprint across the four files: roughly 45 changed hunks / ~90
lines touched (net near-zero). Changes were: blank-line normalization around
HTML comment fences (`AGENTS.md`); list continuation indentation and a
trailing-newline fix (`docs/README.md`); blank lines after headings
(`PROJECT_STATUS.md`); blank lines after headings, list-item spacing, and
GitHub-flavored table alignment padding (`docs/baseline-report.md`).

One post-format preservation was applied to `docs/baseline-report.md`: the
prose token `references/*.md, scripts/*.cjs, templates/*` was wrapped in
backticks (`` `references/*.md` ``, etc.) so Prettier's markdown-emphasis
pass does not reinterpret the `*` characters. The literal glob patterns and
their semantics are preserved; the authoritative enumerated file list in the
adjacent fenced code block was not modified.

### Formatting-only confirmation

All changes are whitespace, wrapping, indentation, blank lines, and table
alignment. No business decision, architecture requirement, branch name, task
name, command string, file path, validation result, error code, test count,
parser/OCR requirement, authority order, status/stage meaning, or link
target was altered.

### Blueprint integrity

`docs/blueprint/01-master-blueprint.md`,
`docs/blueprint/02-parser-ocr-corpus-spec.md`, and
`docs/blueprint/03-production-execution-playbook.md` were not opened,
rewritten, or reformatted. Their content hashes are unchanged from the
archive import performed earlier in Stage 0.

### Command results (this task)

- `bun install --frozen-lockfile` — **pass** (lockfile satisfied, no drift)
- `bun run typecheck` — **pass**
- `bun run lint` — **fail** (11 errors, 12 warnings; all pre-existing rule
  violations in `src/**` — `no-useless-escape`, `prefer-const`,
  `react-hooks/exhaustive-deps`, `react-refresh/only-export-components`,
  unused `eslint-disable` directives. None are `prettier/prettier`; none are
  in the four documentation files touched by this task. Fixing them requires
  source edits outside the Task 0.1C-g scope.)
- `bun run format:check` — **pass** ("All matched files use Prettier code
  style!")
- `bun run test` — **pass** (2 files, 35 tests)
- `bun run build` — **pass**
- `bun run verify` — **fail** (fails only because `lint` fails; the other
  gates in the composite command pass)

### Final formatting-drift count

**0 files.** `bunx prettier --check .` reports "All matched files use
Prettier code style!". `.workspace/skills/**` remains excluded via
`.prettierignore`.

### Validation-baseline conclusion

The Prettier formatting baseline is complete: every non-ignored file in the
repository is Prettier-clean, and `bun run format:check` passes. The
remaining lint failures are pre-existing source-code rule violations that
were surfaced (not introduced) by Task 0.1A and were previously masked in
lint output by the volume of `prettier/prettier` diagnostics. They are
in-scope for a follow-up code task, not for the documentation formatting
batch series (0.1C-b … 0.1C-g).

## Stage 0 validation summary

- Dependency installation (`bun install --frozen-lockfile`): **pass**
- Strict TypeScript (`bun run typecheck`): **pass**
- Lint (`bun run lint`): **fail** — 11 pre-existing source rule violations
  remain (`no-useless-escape`, `prefer-const`, plus warnings). No
  `prettier/prettier` violations remain. Resolving these requires source
  edits outside the Stage 0 documentation/formatting scope and is deferred
  to a dedicated follow-up task.
- Format check (`bun run format:check`): **pass**
- Unit tests (`bun run test`): **pass**, 35/35
- Production build (`bun run build`): **pass**
- Composite verify (`bun run verify`): **fail** solely because `lint` fails;
  all other gates pass.
- Parser/OCR behavior changes during Stage 0: **none**.
- Known parser-quality problems remain intentionally unresolved until the
  corpus evaluator is created.

Note: the pre-declared Stage 0 target of "lint: pass / verify: pass" is not
achievable within this task's allowed scope (four documentation files only).
A follow-up code task must clear the residual `no-useless-escape` and
`prefer-const` errors under `src/**` to close the composite `verify` gate.

## Task 0.1D — ESLint error cleanup

### Original 11 errors (grouped by file and rule)

`src/components/StatementImport.tsx` (1)

- 109:68 `no-useless-escape` — `\-` at end of character class
  `[A-Za-z\u1200-\u137F\s'.\-]`

`src/lib/crypto.ts` (1)

- 142:5 `prefer-const` — `let listeners = new Set<() => void>()` never
  reassigned

`src/lib/distributor-parser.ts` (4)

- 152:64 `no-useless-escape` — `\-` at end of char class in `NAME_RX`
- 190:69 `no-useless-escape` — `\[` inside char class in
  `stripNameTrailers` trailer strip
- 208:68 `no-useless-escape` — `\[` inside char class in `stripNameLeaders`
  leader strip
- 211:87 `no-useless-escape` — `\-` at end of char class in the
  short-leader-token match

`src/lib/ocr-parser.ts` (3)

- 113:7 `prefer-const` — `let clean = stripTrailingGarbage(line)` never
  reassigned
- 131:23 `no-useless-escape` — `\-` at end of char class in the agent-name
  allow-list
- 140:27 `no-useless-escape` — `\-` at end of char class `[=–—\-]` in the
  divider filter

`src/lib/parser.ts` (2)

- 213:29 `no-useless-escape` — `\/` inside char class `[A-Z0-9 .'\/-]` of
  the Coop credit "BY …" capture
- 227:123 `no-useless-escape` — `\/` inside char class `[A-Z0-9 .'\/-]` of
  the Coop debit "TO …" capture

### Exact source files changed (5)

- `src/components/StatementImport.tsx`
- `src/lib/crypto.ts`
- `src/lib/distributor-parser.ts`
- `src/lib/ocr-parser.ts`
- `src/lib/parser.ts`

### Fix category applied to each error

- StatementImport.tsx 109:68 — removed one useless `\` before `-` at end of
  character class (regex language unchanged; `-` at class end is literal).
- crypto.ts 142:5 — `let` → `const` for `listeners` (Set is mutated via
  `.add`/`.delete`, binding itself is never reassigned).
- distributor-parser.ts 152:64, 211:87 — removed one useless `\` before `-`
  at end of character class.
- distributor-parser.ts 190:69, 208:68 — removed one useless `\` before `[`
  inside character class (`[` is literal inside a class; closing `\]` kept).
- ocr-parser.ts 113:7 — `let` → `const` for `clean` (never reassigned; only
  read).
- ocr-parser.ts 131:23, 140:27 — removed one useless `\` before `-` at end
  of character class.
- parser.ts 213:29, 227:123 — removed one useless `\` before `/` inside
  character class (regex-literal delimiter escaping is not required inside a
  character class).

No regex flag, capture group, quantifier, anchor, alternation, or ordering
was changed. Every modified character class accepts and rejects exactly the
same code points as before.

### Warnings intentionally not addressed

The 12 warnings reported alongside the 11 errors (react-hooks/exhaustive-deps,
react-refresh/only-export-components, unused eslint-disable directives in
`PasteImport.tsx`) were left untouched, per task scope.

### Command results (this task)

- `bun run typecheck` — **pass**
- `bun run lint` — **pass** (0 errors, 12 pre-existing warnings)
- `bun run format:check` — **pass**
- `bun run test` — **pass** (2 files, 35 tests)
- `bun run build` — **pass**
- `bun run verify` — **pass**

### Runtime-behavior confirmation

No runtime behavior changed. `prefer-const` fixes are compile-time only.
`no-useless-escape` fixes remove backslashes that the ECMAScript regex
grammar already treats as identity escapes; the resulting `RegExp` objects
match the same strings. All 35 unit tests (including the parser and
distributor-parser suites that exercise these regexes) pass unchanged.

### Stage 0 validation summary — final

Superseding the interim entry above:

- Dependency installation (`bun install --frozen-lockfile`): **pass**
- Strict TypeScript (`bun run typecheck`): **pass**
- Lint (`bun run lint`): **pass** with 12 non-blocking warnings
- Format check (`bun run format:check`): **pass**
- Unit tests (`bun run test`): **pass**, 35/35
- Production build (`bun run build`): **pass**
- Composite verify (`bun run verify`): **pass**
- Parser/OCR behavior changes during Stage 0: **none**
- Known parser-quality problems remain intentionally unresolved until the
  corpus evaluator is created.

The earlier historical record showing that lint previously failed is
preserved above and is not rewritten.

## Task 0.1E — Continuous integration

### Workflow file

`.github/workflows/ci.yml`

### Workflow summary

```yaml
name: CI
on:
  pull_request:
  push:
    branches:
      - production-v3
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.3
      - run: bun install --frozen-lockfile
      - run: bun run verify
```

### Triggers

- `pull_request` (all branches)
- `push` to `production-v3`
- `workflow_dispatch`

### Permissions

`contents: read` only. No write permissions are granted.

### Tool versions

- Bun: `1.3.3`
- Install command: `bun install --frozen-lockfile`
- Validation command: `bun run verify`

### Local validation results

- `bun install --frozen-lockfile`: **pass**
- `bun run verify`: **pass**
  - `bun run typecheck`: pass
  - `bun run lint`: pass (0 errors, 12 pre-existing warnings)
  - `bun run format:check`: pass
  - `bun run test`: pass (35/35)
  - `bun run build`: pass

### YAML validation result

YAML syntax validated with the available Node.js `yaml` parser. The parsed
structure matches the intended triggers, permissions, concurrency, job, and
step configuration.

### Hosted run observation

No actual GitHub-hosted workflow run was observed inside the Lovable sandbox.
The workflow will run on the next push to `production-v3` or on any pull
request once this file is in the repository.

### Remaining non-blocking warnings

The same 12 ESLint warnings recorded in Task 0.1D remain (react-hooks
exhaustive-deps, react-refresh only-export-components, and unused
eslint-disable directives). They do not fail the `lint` script or `verify`.

### Files changed in this task

- `.github/workflows/ci.yml` — new workflow
- `docs/baseline-report.md` — this entry
- `PROJECT_STATUS.md` — status and next-task update

### Confirmations

- `packageManager` remains `bun@1.3.3`.
- No change to `package.json`, `bun.lock`, dependencies, source code, tests,
  parser/OCR behavior, database code, routes, components, ESLint/Prettier/TypeScript
  configuration, or blueprint documents.
- The local `bun run verify` gate passes and the CI workflow runs the exact
  same command.

## Task 0.2A — Corpus scaffold and inventory

### Files added

- `tests/corpus/README.md`
- `tests/corpus/schema.ts`
- `tests/corpus/catalog.json`
- `tests/corpus/catalog.test.ts`
- `tests/corpus/fixtures/ocr/mj-transfers-sent/.gitkeep`
- `tests/corpus/fixtures/ocr/refill-history/.gitkeep`
- `tests/corpus/fixtures/sms/cbe/.gitkeep`
- `tests/corpus/fixtures/sms/bank-of-abyssinia/.gitkeep`
- `tests/corpus/fixtures/sms/telebirr/.gitkeep`
- `tests/corpus/fixtures/sms/cooperative-bank/.gitkeep`
- `tests/corpus/fixtures/sms/coop-ebirr/.gitkeep`
- `tests/corpus/fixtures/sms/dashen/.gitkeep`
- `docs/corpus-baseline.md`

### Source document used

Reference material only: the private `Parser corpus.docx`. The document itself
and its original screenshots were not committed. No agent names,
account-holder labels, account numbers, references, receipt IDs, URLs, raw
OCR text or transaction amounts were copied into any committed file.

### Privacy restrictions

All catalog entries use `privacyStatus: metadata_only` and `status: catalogued`.
`catalog.test.ts` enforces a deny-list of private substrings and patterns
(URLs, `FT…` reference IDs, masked account tails, raw currency amounts) and
asserts that no such tokens appear in `catalog.json`.

### Catalog totals

- 9 fixtures.
- 56 expected complete rows.
- 0 expected partial rows.
- 2 expected reversal rows.
- 40 currently parsed rows.
- MJ Transfers → Sent: 6 fixtures, 30 expected rows, 14 parsed rows.
- Refill History: 3 fixtures, 26 expected rows, 26 parsed rows.

### Tests added

`tests/corpus/catalog.test.ts` — 8 assertions covering schema validation,
entry count, ID and filename uniqueness, corpus totals, per-source totals,
status/privacy invariants, absence of fixture paths and the privacy
deny-list.

### Command results

- `bun run typecheck`: pass
- `bun run lint`: pass
- `bun run format:check`: pass
- `bun run test`: pass (test count increased by the new `catalog.test.ts` file)
- `bun run build`: pass
- `bun run verify`: pass

### Behavior confirmation

No parser, OCR, database or application code changed. Only `tests/corpus/**`,
`docs/corpus-baseline.md`, `docs/baseline-report.md` and `PROJECT_STATUS.md`
were touched.

## Task 0.2A-1 — Remove original corpus identifiers from committed test

### Summary

Task 0.2A initially used plaintext private values from the original
`Parser corpus.docx` inside the privacy deny-list in
`tests/corpus/catalog.test.ts` (original agent names and account-label
tokens). Task 0.2A-1 removes those plaintext values from the committed test
and replaces the deny-list with structural privacy validation. No sensitive
value is reproduced anywhere in the current tree, including this report.

### Structural privacy checks now used

`tests/corpus/catalog.test.ts` recursively walks every string in
`catalog.json` and enforces:

- fixture IDs match the sanitized ID structure
  (`ocr.(mj.sent|refill).photo-<n>`);
- source filenames match the sanitized screenshot filename pattern
  (`photo_<n>_YYYY-MM-DD_HH-MM-SS.jpg`);
- tags are lowercase kebab-case and bounded in length;
- no string contains a URL, masked bank-account pattern, receipt/reference
  identifier, `ETB`/`Birr` followed by an amount, a raw-message opening such
  as `Dear `, or multiline raw content;
- no string is unusually long (bounded at 120 characters);
- string values only appear in the approved metadata fields (ID, filename,
  enum-valued fields, optional notes and fixture paths) or inside `tags`.

### Current-tree private-data scan

A repository-wide scan for the original identifying tokens returned matches
only inside files that this task is not allowed to modify:

- `docs/blueprint/01-master-blueprint.md`
- `docs/blueprint/02-parser-ocr-corpus-spec.md`
- `docs/blueprint/CHANGELOG.md`
- `src/lib/parser.ts`
- `src/lib/ocr-parser.ts`
- `src/lib/distributor-parser.ts`
- `src/lib/distributor-parser.test.ts`

Categories observed in those files: original agent-name tokens and
account-label tokens used as parser noise-filter constants and blueprint
examples. These files are in the "do not change" scope for Task 0.2A-1 and
require a separate approved task to address.

### Command results

- `bun run typecheck`: pass
- `bun run lint`: pass
- `bun run format:check`: pass
- `bun run test`: pass (48 tests)
- `bun run build`: pass
- `bun run verify`: pass

### Behavior confirmation

No application, parser or OCR behavior changed. Only
`tests/corpus/catalog.test.ts` and `docs/baseline-report.md` were modified
in this task.

## Task 0.2A-2 — Repository corpus sanitization

### Categories of files sanitized

- Blueprint documentation (illustrative examples) —
  `docs/blueprint/01-master-blueprint.md`,
  `docs/blueprint/02-parser-ocr-corpus-spec.md`,
  `docs/blueprint/CHANGELOG.md`. Original personal names, agent names and
  subdistributor account labels replaced with clearly synthetic placeholders;
  requirements and rule structures preserved.
- Parser source (noise-filter literal + comments) — `src/lib/parser.ts`,
  `src/lib/ocr-parser.ts`, `src/lib/distributor-parser.ts`. Private
  literals removed from doc-comments; a hard-coded noise-filter literal was
  replaced with a generic structural detector.
- Parser tests (fixture strings) — `src/lib/distributor-parser.test.ts`,
  `src/lib/parser.test.ts`. Private name/label tokens replaced with
  synthetic equivalents. Amount and layout structure unchanged.

### Generic parser rule introduced

A private hard-coded sender-label literal (`bariso`/`haji`) previously
served as a noise-filter to reject the subdistributor account label as an
agent. It is replaced with a structural repeated-handle detector:

- Input line is trimmed and internal whitespace is collapsed.
- The line is split on a single hyphen or en-dash surrounded by optional
  whitespace; the split must produce exactly two non-empty sides.
- The two sides are compared case-insensitively; equality identifies the
  `<name> - <name>` account-label pattern.

Implementations: `isRepeatedHandleLabel()` in `src/lib/ocr-parser.ts` and
the equivalent `OCR_SENDER_LABEL_RX` in `src/lib/parser.ts` using a
backreference. No fuzzy matching is added. Behavior previously achieved by
the private literal is preserved. The pre-existing `REPEATED_SENDER_RX`
backreference detector in `src/lib/distributor-parser.ts` is unchanged.

### Tests added or updated

- `src/lib/distributor-parser.test.ts` — replaced private literals with
  synthetic values across all existing MJ / Refill History cases and added
  four regression tests under
  `parseStatementText — generic repeated-handle sender label`:
  - rejects a repeated-handle label as an agent (case- and whitespace-
    insensitive);
  - retains a real agent immediately after a repeated-handle label;
  - does not reject ordinary hyphenated names as repeated-handle labels;
  - does not treat `<A> - <B>` with different sides as a repeated-handle
    label.
- `src/lib/parser.test.ts` — one illustrative example name replaced with a
  synthetic equivalent; no assertion changes.

Test count: 44 before Task 0.2A-2, 52 after (three test files, three
passing).

### Current-tree privacy scan

Repository-wide search (via a temporary local list, not committed) for the
identifiers previously present in the tree returned zero matches in tracked
files. Structural scans for URLs, receipt/reference identifiers, masked
account numbers and raw SMS paragraphs also returned zero matches outside
the fixtures gitkeep directories.

### Remote-history assessment

Unable to determine from within this environment whether commits containing
the identifiers have already reached the remote `production-v3` branch. Git
state is managed by the platform and remote refs are not directly
inspectable here. Current-tree sanitization does not remove old Git history;
if any such commit has already been pushed to the remote branch, a
separately approved history-cleanup task will be required. The protected
`ethiotrack-next2.0` branch is not to be rewritten under any circumstance.

### Behavior confirmation

No database schema, financial rule, transaction model, dependency,
lockfile, package.json, build/lint configuration, CI workflow or unrelated
application behavior was changed. Parser output contracts (row fields and
their meanings) are unchanged. The full validation suite (`bun run
typecheck`, `bun run lint`, `bun run format:check`, `bun run test`,
`bun run build`, `bun run verify`) passes.

## Task 0.2B-a — First sanitized MJ golden fixtures

### Activated fixture IDs

- `ocr.mj.sent.photo-5`
- `ocr.mj.sent.photo-38`

Both moved from `catalogued`/`metadata_only` to `active`/`sanitized`. The
remaining seven catalog entries stay `catalogued`/`metadata_only`.

### Files added

- `tests/corpus/fixtures/ocr/mj-transfers-sent/photo-5.raw.txt`
- `tests/corpus/fixtures/ocr/mj-transfers-sent/photo-5.expected.json`
- `tests/corpus/fixtures/ocr/mj-transfers-sent/photo-38.raw.txt`
- `tests/corpus/fixtures/ocr/mj-transfers-sent/photo-38.expected.json`
- `tests/corpus/golden-fixtures.test.ts`

The now-unnecessary `.gitkeep` in the MJ fixture directory was removed.
`tests/corpus/schema.ts`, `tests/corpus/catalog.json`,
`tests/corpus/catalog.test.ts` and `tests/corpus/README.md` were updated.

### Synthetic-data policy

Active OCR fixtures contain sanitized OCR **text**, never screenshot image
data. Every agent name is synthetic (`Sample Agent <Greek letter>`), every
account label is the synthetic repeated handle `samplewallet - samplewallet`,
and every amount is synthetic. Layout, row ordering, repeated agent
occurrences, punctuation, OCR noise tokens and status-bar garbage are
preserved so each fixture reproduces the same class of parsing challenge as
the original screen. No original name, account label, account number, amount,
reference, receipt identifier, URL or complete original OCR passage was
copied.

### Expected active row count

10 expected rows (5 per fixture), 0 reversals. The full catalog totals are
unchanged: 56 expected complete rows, 0 partial rows, 2 known reversals, 40
currently parsed rows.

### Tests added

- `tests/corpus/golden-fixtures.test.ts` (8 tests): path safety
  (repository-relative, no absolute paths, no `..` traversal), file existence,
  schema validation via `GoldenOcrExpectationSchema`, fixture/catalog
  agreement (fixtureId, sourceFamily, row count, reversal count), contiguous
  `sourceOrder`, exact `rawAmountText` → `signedAmountMinor` conversion,
  MJ row invariants (null date, `unknown` precision, `unassigned` resolution),
  `Sample Agent ` name prefix, forbidden agent candidates present in raw text
  but never as an expected agent, presence of `Transfers` and `Sent`, presence
  of the synthetic repeated label, and privacy scans (no HTTP URL, masked
  account, phone-like value, receipt/reference pattern or raw SMS opening),
  plus a check that no screenshot image file is committed under
  `tests/corpus/fixtures/`.
- `tests/corpus/catalog.test.ts` gained 4 status/path assertions replacing the
  two outdated "all catalogued / no paths" assertions.

Test totals: 62 tests across 4 files (previously 52 across 3).

### Validation results

`bun run typecheck` ✓, `bun run lint` ✓, `bun run format:check` ✓,
`bun run test` ✓ (62/62), `bun run build` ✓, `bun run verify` ✓.

### Behavior confirmation

Production parsing was **not** executed and **not** changed. No file under
`src/**` was touched. No parser or OCR expectation, database schema, financial
rule, dependency, lockfile, `package.json`, build/lint configuration, CI
workflow or blueprint document was modified. Parser accuracy against these
fixtures is deliberately not measured in this task.

## Task 0.2B-b — Additional positive-only MJ golden fixtures

### Activated fixture IDs

- `ocr.mj.sent.photo-2`
- `ocr.mj.sent.photo-9`

### Files added

- `tests/corpus/fixtures/ocr/mj-transfers-sent/photo-2.raw.txt`
- `tests/corpus/fixtures/ocr/mj-transfers-sent/photo-2.expected.json`
- `tests/corpus/fixtures/ocr/mj-transfers-sent/photo-9.raw.txt`
- `tests/corpus/fixtures/ocr/mj-transfers-sent/photo-9.expected.json`

### Files changed

- `tests/corpus/catalog.json`
- `tests/corpus/catalog.test.ts`
- `tests/corpus/golden-fixtures.test.ts`
- `tests/corpus/README.md`
- `docs/corpus-baseline.md`
- `docs/baseline-report.md`
- `PROJECT_STATUS.md`

### Synthetic-data policy

All agent names, wallet labels and amounts in both fixtures are synthetic. No
original personal name, account-holder label, account number, reference,
receipt identifier, URL, amount or complete OCR passage was committed. No
screenshot image is committed. Privacy validation remains structural: pattern
checks for HTTP URLs, masked accounts, phone-like values, receipt/reference
identifiers and raw SMS openings, plus the `Sample Agent ` prefix rule and the
synthetic repeated sender label. No plaintext private deny list was added.

### Active fixture and row totals

- 4 active sanitized fixtures, 5 metadata-only fixtures.
- 20 active expected rows, 0 active reversal rows.
- Full catalog unchanged: 9 fixtures, 56 expected rows, 0 partial rows,
  2 reversal rows, 40 currently parsed rows.

### Focused fixture assertions added

`ocr.mj.sent.photo-2`: exactly 5 expected rows; five distinct agents;
`Sample Agent Lambda Meridian` preserved as one complete value; punctuation
noise present adjacent to an amount in the raw fixture; all expected signed
amounts positive.

`ocr.mj.sent.photo-9`: exactly 5 expected rows; the `fo` token appears in raw
OCR; `fo` is a forbidden agent candidate; `fo` never appears as expected
`agentText`; `Sample Agent Rho` occurs exactly twice with different amounts;
both repeated-agent rows remain present; all expected signed amounts positive.

No production parser, OCR engine or `parseMany` call is made by these tests.

### Command results

- `bun run typecheck` — pass
- `bun run lint` — pass
- `bun run format:check` — pass
- `bun run test` — pass (80 tests, up from 62)
- `bun run build` — pass
- `bun run verify` — pass

### Confirmation

Production parsing was neither executed nor changed. No file under `src/`,
no database code, dependency, lockfile, configuration, CI workflow or
blueprint document was modified.

## Task 0.2B-c — MJ OCR sign-noise golden fixture

### Activated fixture ID

- `ocr.mj.sent.photo-6`

### Files added

- `tests/corpus/fixtures/ocr/mj-transfers-sent/photo-6.raw.txt`
- `tests/corpus/fixtures/ocr/mj-transfers-sent/photo-6.expected.json`

### Files changed

- `tests/corpus/schema.ts`
- `tests/corpus/catalog.json`
- `tests/corpus/catalog.test.ts`
- `tests/corpus/golden-fixtures.test.ts`
- `tests/corpus/README.md`
- `docs/corpus-baseline.md`
- `docs/baseline-report.md`
- `PROJECT_STATUS.md`

### AmountEvidence schema extension

`AmountPrefixDisposition` (`ocr_noise` | `confirmed_reversal`) and a strict
`AmountEvidence` object (`observedText`, `prefixDisposition`) were added.
`ExpectedOcrRow` gained an optional `amountEvidence` field with two cross-field
rules: `ocr_noise` requires a positive, non-reversal `evd_sent_to_agent` row;
`confirmed_reversal` requires a negative `evd_reversal` row. The field is
optional, so existing fixtures are unaffected. It records how a human author
interpreted punctuation visible in flattened OCR; it does not authorize the
production parser to guess a sign without evidence.

### Synthetic-data policy

All names, wallet labels and amounts are synthetic. No original personal name,
account-holder label, account number, reference, receipt identifier, URL,
amount or complete OCR passage was committed, and no screenshot image exists in
the corpus. Privacy validation remains structural, with no plaintext private
deny list.

### Active fixture and row totals

- 5 active sanitized fixtures, 4 metadata-only fixtures.
- 25 active expected rows, 0 active expected reversal rows.
- Full catalog unchanged: 9 fixtures, 56 expected rows, 0 partial rows,
  2 reversal rows, 40 currently parsed rows.

### Focused sign-noise and repeated-agent assertions

Generic (all active fixtures): `observedText` appears verbatim in the raw
fixture, the numeric amount inside `observedText` normalizes to
`rawAmountText`, and each disposition agrees with sign, `isReversal` and
`eventKind`.

`ocr.mj.sent.photo-6`: exactly 5 expected rows; exactly 2 rows carry
`amountEvidence`; both use `ocr_noise`; no row uses `confirmed_reversal`; the
raw fixture contains `- 3,875.00` and `: 2,735.00`; those normalized amounts
remain positive; all five rows are `evd_sent_to_agent` with positive signed
amounts; reversal count is zero; `Sample Agent Tau` occurs exactly twice with
different amounts and both rows remain present; the repeated synthetic sender
label is forbidden as an agent.

No production parser, OCR engine or `parseMany` call is made by these tests.

### Command results

- `bun run typecheck` — pass
- `bun run lint` — pass (0 errors, 12 pre-existing warnings)
- `bun run format:check` — pass
- `bun run test` — pass (96 tests, up from 80)
- `bun run build` — pass
- `bun run verify` — pass

### Confirmation

Production parsing was neither executed nor changed. No file under `src/`, no
database code, dependency, lockfile, configuration, CI workflow or blueprint
document was modified. Production accuracy is still not recalculated because
the evaluator does not execute production parsing.

## Task 0.2B-d — MJ reversal golden fixture

- Activated fixture: `ocr.mj.sent.photo-4` (status `active`, privacy
  `sanitized`).
- Files added:
  - `tests/corpus/fixtures/ocr/mj-transfers-sent/photo-4.raw.txt`
  - `tests/corpus/fixtures/ocr/mj-transfers-sent/photo-4.expected.json`
- Confirmed reversals: 2 (source orders 0 and 3), both with
  `amountEvidence.prefixDisposition = confirmed_reversal`, negative
  `rawAmountText` and negative `signedAmountMinor`.
- OCR noise versus reversal: source order 2 carries the observed text
  `- 302,500.00` but is annotated `ocr_noise` and stays a positive
  `evd_sent_to_agent` row. A visible dash alone is not evidence of a reversal.
- Repeated-agent coverage: `Sample Agent Psi` appears twice — once as a
  reversal and once as a positive transfer, with different signed amounts.
  Both rows remain present; fixture validation never nets or deduplicates them.
- Completed MJ totals: 6 active MJ fixtures, 30 active expected rows, 2 active
  expected reversals. Catalog aggregates unchanged (9 fixtures, 56 expected
  rows, 0 partial, 2 reversals, 40 currently parsed).
- Focused signed-amount assertions added:
  - `rawAmountText` parses exactly to `signedAmountMinor`;
  - negative `rawAmountText` and negative `signedAmountMinor` only on reversal
    rows;
  - positive rows are positive and `evd_sent_to_agent`;
  - `confirmed_reversal` evidence agrees with both the raw amount text and the
    signed amount;
  - `ocr_noise` evidence cannot turn a positive authoritative amount into a
    reversal;
  - source ordering is contiguous and unchanged; no netting or deduplication.
- Commands: `bun run typecheck`, `bun run lint`, `bun run format:check`,
  `bun run test`, `bun run build` and `bun run verify` all pass.
- Production parsing was neither executed nor changed. No file under `src/`,
  no dependency, configuration, CI workflow or blueprint was modified.

## Task 0.2C-a — First Refill History golden fixture

**Activated fixture:** `ocr.refill.photo-64` (Refill History, `yunus_or_alami`).

**Files added**

- `tests/corpus/fixtures/ocr/refill-history/photo-64.raw.txt`
- `tests/corpus/fixtures/ocr/refill-history/photo-64.expected.json`
- Removed the now-unnecessary `tests/corpus/fixtures/ocr/refill-history/.gitkeep`.

**Schema family/platform extension**

`GoldenOcrExpectationSchema` now accepts `sourceFamily` of `mj_transfers_sent`
or `refill_history`, with a cross-field refinement pinning
`mj_transfers_sent` → `mj` and `refill_history` → `yunus_or_alami`. Mismatched
combinations are rejected.

**Local timestamp representation**

`ExpectedOcrRow` now validates the date shape against `datePrecision`:
`unknown` → `null`, `day` → `YYYY-MM-DD`, `minute` → `YYYY-MM-DDTHH:mm`,
`second` → `YYYY-MM-DDTHH:mm:ss`. No timezone suffix is permitted. Values are
source-local wall-clock strings; no `Date` parsing, UTC conversion or machine
timezone is used anywhere in validation. A corpus-only helper,
`refillTimestampToLocalMinute`, performs deterministic string-based 12→24 hour
conversion (12 AM → 00, 12 PM → 12) and is used to confirm each expected date
matches the raw line immediately below its row.

**Repeated-agent and repeated-amount coverage**

Cedar ×5, Maple ×2, Juniper ×1, River Stone ×1 (multiword name preserved). The
two Maple rows, the two 32,500 Cedar rows and the two 205,000 Cedar rows are
each asserted to share an amount while remaining separate rows with distinct
timestamps/dates. No fixture validation nets, merges or deduplicates rows.

**Totals**

- 7 active / 2 catalogued fixtures; 7 sanitized / 2 metadata_only.
- 39 active expected rows (30 MJ + 9 Refill History).
- 2 active expected reversals; 0 Refill History reversals.
- Full catalog unchanged: 9 fixtures, 56 expected rows, 0 partial, 2 reversals,
  40 currently parsed rows.

**Tests:** 96 → 105 corpus tests (17 catalog + 88 golden). Added the timestamp
helper suite, family-branched generic validation and focused `photo-64`
assertions.

**Privacy:** structural checks only — every expected agent begins with
`Sample Agent `, all names/amounts/dates are synthetic, and the raw fixture is
rejected for HTTP URLs, masked accounts, phone-like values, receipt references
and raw SMS openings. No screenshot image is committed and no plaintext deny
list exists.

**Commands:** `typecheck`, `lint`, `format:check`, `test`, `build`, `verify` —
all pass.

**Production parsing was neither executed nor changed.** No file under `src/`,
no production parser/OCR/database code, dependency, lockfile, configuration or
CI workflow was modified.

## Task 0.2C-b — Refill History same-timestamp golden fixture

Activated fixture: `ocr.refill.photo-49` (Refill History, `yunus_or_alami`).

Files added:

- `tests/corpus/fixtures/ocr/refill-history/photo-49.raw.txt`
- `tests/corpus/fixtures/ocr/refill-history/photo-49.expected.json`

Files updated: `tests/corpus/catalog.json`, `tests/corpus/catalog.test.ts`,
`tests/corpus/golden-fixtures.test.ts`, `tests/corpus/README.md`,
`docs/corpus-baseline.md`, `docs/baseline-report.md`, `PROJECT_STATUS.md`.

Totals:

- 8 active sanitized fixtures, 1 metadata-only catalogued fixture.
- 48 active expected rows (30 MJ + 18 Refill History).
- 2 active reversal rows, all MJ; Refill History reversals remain 0.
- Full catalog unchanged: 9 fixtures, 56 expected rows, 40 currently parsed
  rows, 2 reversal rows.

Same-timestamp coverage: rows 7 and 8 share `2026-08-09T16:50` with different
agents and different amounts. Both remain present; they are not merged,
netted or treated as duplicates. Equal adjacent timestamps do not violate
newest-to-oldest ordering. Timestamp-only deduplication is prohibited.

Repeated-agent coverage: `Sample Agent Aspen` appears twice with different
amounts and timestamps; `Sample Agent Copper Field` appears twice with
different amounts and times and remains one complete multiword value.

Strict agent linking: every expected row remains `agentResolution:
unassigned`. No alias or existing-agent link is inferred and the layout is not
classified specifically as Yunus or Alami.

Test additions: focused `ocr.refill.photo-49` assertions (row/timestamp
counts, ordering, positivity, unassigned agents, same-timestamp pair,
repeated-agent pairs, single-occurrence agents, chrome-label noise) plus a
cross-fixture "active Refill History fixture set" suite asserting 18 rows,
zero reversals, minute precision, platform hint and the prohibition on
single-dimension deduplication.

Command results: `typecheck`, `lint`, `format:check`, `test`, `build` and
`verify` all pass. Test count moved from 144 to 168.

No production parser or OCR code was executed or changed. No original private
corpus value, screenshot or raw OCR passage was committed.

## Task 0.2C-c — Final Refill History golden fixture and execution contract

Activated `ocr.refill.photo-51`, the last catalogued screenshot fixture. Added
`docs/ai/EXECUTION_CONTRACT.md` as the permanent, compact execution contract
for all future AI-assisted work on `production-v3`.

### Changes

- `docs/ai/EXECUTION_CONTRACT.md` (new) — 14 permanent rules plus the compact
  completion format.
- `tests/corpus/fixtures/ocr/refill-history/photo-51.raw.txt` (new) —
  sanitized Refill History OCR text, 8 rows over 2 calendar dates.
- `tests/corpus/fixtures/ocr/refill-history/photo-51.expected.json` (new) —
  8 positive `evd_sent_to_agent` rows, minute precision, all `unassigned`.
- `tests/corpus/catalog.json` — photo-51 promoted to `active` / `sanitized`
  with both fixture paths; all other metadata preserved.
- `tests/corpus/catalog.test.ts`, `tests/corpus/golden-fixtures.test.ts` —
  totals updated to 9 active fixtures / 56 active rows / 30 MJ / 26 Refill
  History / 2 MJ reversals, plus focused photo-51 assertions.
- `tests/corpus/README.md`, `docs/corpus-baseline.md`, `PROJECT_STATUS.md` —
  documentation and status updated.

### Coverage added

OCR name variation: `Sample Agent Lumen` vs `Sample Agent Lumenn` and
`Sample Agent Bramble` vs `Sample Agent Brambel` remain distinct and unlinked
under case- and whitespace-only normalization. `Sample Agent Granite Hill`
stays one multiword agent. The amount `52,000` appears on three rows and all
three rows remain.

### Corpus totals

- 9 active sanitized fixtures, 0 catalogued.
- 56 active expected rows (30 MJ + 26 Refill History).
- 2 reversals, both MJ.

### Validation

`bun run verify` — pass (typecheck, lint, format:check, test, build).

Production parser accuracy has **not** been recalculated. No production
parser, OCR engine, database, dependency, configuration or CI file changed.
No original private data or screenshot was committed.
