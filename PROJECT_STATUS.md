# EthioTrack Project Status

## Active branch

production-v3

## Protected baseline

ethiotrack-next2.0

## Current stage

Stage 1 — Corpus and ingestion baseline

## Completed

- Documentation archive
- Validation baseline
- Continuous integration
- Corpus scaffold and metadata inventory
- Repository corpus sanitization
- Golden-fixture schema
- First two sanitized MJ fixtures
- Four active sanitized MJ golden fixtures
- Repeated-agent fixture coverage
- False-agent-token fixture coverage
- Five active sanitized MJ golden fixtures
- OCR amount-prefix evidence contract
- MJ OCR sign-noise fixture coverage
- All six sanitized MJ golden fixtures
- MJ reversal fixture coverage
- Signed-amount fixture validation
- Confirmed-reversal versus OCR-noise distinction
- First sanitized Refill History golden fixture
- Source-local minute timestamp contract
- Refill History repeated-row coverage
- Two active sanitized Refill History fixtures
- Same-timestamp transaction coverage
- Timestamp-only deduplication prohibition
- Compact execution contract
- All nine sanitized screenshot fixtures
- Full 56-row golden corpus
- Refill History OCR-name-variation coverage
- Deterministic production parser evaluator
- Frozen sanitized-corpus parser baseline
- Parser non-regression gate
- Parser release gate
- Deterministic sign diagnostics
- Sanitized parser failure report
- MJ row-reconstruction design and test plan
- Isolated MJ line classifier and amount-anchor helpers (not yet integrated)
- Pure MJ agent filtering and row reconstruction helpers (not yet integrated)
- MJ production-shape adapter with golden-row tests
- Production MJ parsing routed through deterministic reconstruction
- Refrozen 56/56 exact sanitized-corpus baseline
- Ratcheted non-regression floor and passing release gate
- Ordered MJ unresolved-window diagnostics contract
- MJ boundary regression suite and legacy-path removal
- Float and EVD SMS corpus design
- Sanitized SMS fixture schema and first representative fixtures
- Complete 14-case sanitized SMS corpus
- Deterministic Float and EVD SMS parser design
- Pure SMS classification and field-extraction primitives (not yet integrated)
- Source-structure faithful SMS primitives and representative fixtures
- Bilingual SMS pairing and reference-based deduplication
- Safe sent-versus-received airtime semantics
- SMS review, distributor linking and safe persistence
- Enforced SMS distributor form and telecom compatibility
- Direction-aware airtime history display and receipt review semantics
- Reconciliation week navigation and per-distributor airtime history
- Agent history route and pure agent ledger
- Orientation-aware end-to-end screenshot OCR import
- Distributor payments as trackable EVD purchase intents
- Backup v3 export, reset and restore proven in the browser
- Smart Capture classification, shared inbox and Android share target (awaiting browser acceptance)

## Current task

Task 0.4C-bR — Complete Smart Capture and Android Share Target

## Next task

Task 0.4C-c — Fresh-account setup, offline PWA and deployment readiness

## Deferred until after MVP

- Many-to-many fulfilment
- Advanced analytics
- Cross-device sync
- Large nonblocking OCR expansion
- Unrelated visual redesign

## Validation snapshot

Recorded from an actual `bun run verify` run:

- Typecheck: pass
- Lint: pass (0 errors, 8 warnings)
- Format check: pass
- Tests: 636 passed across 21 test files
- Build: pass

## Repository truth

`docs/ai/CURRENT_HANDOFF.md` is the authoritative statement of what is
completed and browser-accepted, implemented but awaiting browser acceptance,
partially implemented, deferred, and known-limited. Nothing here is
production-ready without browser evidence.

## Execution contract

`docs/ai/EXECUTION_CONTRACT.md` is the permanent execution contract for this
repository. Future tasks reference it instead of repeating its rules.

## Important rule

Tests are necessary but never sufficient. A milestone is accepted only with a
real browser journey; a passing test count alone never accepts a milestone.

## TASK 0.4C-bR1P — OCR list-row reconstruction replaced (current release blocker)

The legacy date-backtracking + party/amount/day deduplication scraper is
DELETED. Screenshot list parsing now runs through the generic, position-aware
evidence engine `src/lib/ocr-row-reconstruction.ts`:

- OCR text becomes ordered evidence tokens (amount/sign, date/time, candidate
  party) carrying source line index, in-line column, raw text and optional
  bounding coordinates.
- Rows are anchored on defensible amounts; the dominant party/date offset is
  measured per image, so party→amount→date, date→party→amount, party+amount and
  date+amount layouts and adjacent line reordering all reconstruct.
- Every evidence token is consumed at most once, evidence never crosses a
  neighbouring anchor boundary, source order is preserved and repeated
  legitimate rows are never deduplicated.
- A defensible amount with a missing party or date stays a visible, unselected
  incomplete row; the image is reported as PARTIAL.

Wired through `src/lib/ocr-parser.ts` and `parseRefillHistory` in
`src/lib/distributor-parser.ts`. `bun run verify` green: 667 tests, 23 files.

STATUS: **Refill screenshot OCR is NOT claimed complete.** Mandatory browser
acceptance (real screenshot → complete/incomplete rows → explicit agent linking
→ save → refresh → History totals match the source) is still OUTSTANDING and is
the current release blocker. The scripted journey reaches setup, distributor and
agent creation; the upload → link → save → refresh leg has not yet been proven.
