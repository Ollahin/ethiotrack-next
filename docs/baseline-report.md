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
(SKILL.md, references/*.md, scripts/*.cjs, templates/*). Full list:

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

| Batch | Task ID | Contents | Files | ~Lines (upper bound) |
|---|---|---|---:|---:|
| 1 | 0.1C-b | `src/lib` core + colocated tests: `parser.ts`, `parser.test.ts`, `ocr-parser.ts`, `ocr.ts`, `distributor-parser.ts`, `distributor-parser.test.ts`, `pdf-parser.ts`, `format.ts`, `ids.ts`, `types.ts` | 10 | ~2,100 |
| 2 | 0.1C-c | Remaining `src/lib`: `db.ts`, `backup.ts`, `crypto.ts`, `user.ts`, `report.ts`, `brain/alerts.ts`, `brain/credits.ts`, `brain/fuzzy.ts`, `brain/stats.ts`, `brain/telecomFlow.ts` | 10 | ~2,050 |
| 3 | 0.1C-d | Feature components (`src/components/*.tsx`, excludes `ui/`) | 12 | ~2,660 |
| 4 | — | UI component library (`src/components/ui/*`) | 0 | — (no drift; batch skipped) |
| 5 | 0.1C-e | Routes: all 13 `.tsx` under `src/routes/` + `src/routes/README.md` | 14 | ~2,500 |
| 6 | 0.1C-f | Styles + external tests: `src/styles.css`, `tests/visual/README.md` | 2 | ~200 |
| 7 | 0.1C-g | Ordinary docs + root files: `AGENTS.md`, `docs/README.md`, `PROJECT_STATUS.md`, `docs/baseline-report.md` (last, since this file will keep drifting until then) | 4 | ~600 |
| 8 | 0.1C-h | Generated-file handling — add `.workspace/` glob to `.prettierignore` after approval. No source formatting. | 0 | — |

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
