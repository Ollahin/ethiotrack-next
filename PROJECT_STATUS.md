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

## Current task

Task 0.4B-a — Distributor payment and EVD fulfillment functional flow

## Next task

Task 0.4B-b — Agent distribution and settlement functional flow

## Execution contract

`docs/ai/EXECUTION_CONTRACT.md` is the permanent execution contract for this
repository. Future tasks reference it instead of repeating its rules.

## Important rule

Do not begin parser, OCR, database, reconciliation or UI restructuring until the validation baseline and corpus evaluator are complete.

## Task 0.4B-a2 — real screenshot capture audit

- Real-browser run: 5 generated screenshots imported in one batch through the live Tesseract OCR engine; raw import persisted before OCR, each tile parsed independently (MJ clean, MJ reversal, Refill, rotated -> 270 correction, cropped).
- Blocker fixed: importer no longer auto-creates agents; unmatched rows must be linked explicitly before saving.
- Blocker fixed: importer no longer stamps `new Date()`; the captured row date is used, otherwise the reviewer must enter a capture date.
- New pure helper `rowDateIso` with tests. Tests: 578 passing.

## Task 0.4B-a2d — screenshot sends and reversals propagate correctly

- Agents overview now reads "Net airtime delivered", shows reversed value, floors open credit at zero and surfaces `excessReversal` as a review signal (per agent and in totals).
- Screenshot import requires an explicitly chosen, form-compatible distributor; no fuzzy linking, no save without one.
- Reversals larger than the agent's recorded delivered balance with that distributor require a written explanation plus confirmation; the explanation is persisted on the saved rows (`overrideReason`) and on the import record, and those rows are flagged for review.
- Reconciliation shows Received / Sent / Reversed / Expected. Proof case: 200,000 received, 61,500 sent, 104,000 reversed → expected 242,500.
- Day-only captured dates render without a fabricated clock time via `formatTxnDate`.
- Verification: 594 tests passing, lint clean (warnings only), production build succeeds.

## Task 0.4C-a — backup, reset and recovery proven

- Backup format v3 (`src/lib/backup-format.ts`): versioned, Zod-validated, with
  per-table counts and referential-integrity checks. Covers agents,
  distributors, banks, daily/period openings and closings, transactions
  (including `isReversal`, `overrideReason`, `airtimeDirection`,
  `dateIsDayOnly`, `needsReview`, `telecom`, `principalSantim`), statement
  imports with base64 screenshot evidence, fulfillment entries and portable
  user settings.
- Device credentials (daily PIN, master PIN, license) are never exported and
  never overwritten on restore.
- `importBackup` is atomic: validate, then clear and write inside one Dexie
  transaction. A rejected or corrupt file changes nothing. Restoring into a
  non-empty account requires explicit replacement confirmation; records are
  never merged or deduplicated. Legacy v2 files migrate on import.
- Automated tests: `src/lib/backup-format.test.ts` (15) and
  `src/lib/backup-roundtrip.test.ts` (8, real IndexedDB via `fake-indexeddb`)
  covering full round trip, malformed rejection, atomic failure, replacement
  confirmation, duplicate ids, empty fulfillments and credential exclusion.
- Real-browser journey: baseline seeded → exported v3 JSON (counts 1 agent,
  2 distributors, 4 transactions, 1 statement import, 2 settings) → account
  cleared from Account → restored from file → refreshed. Recovered state is
  identical: 4 transactions, references MJ-0001/MJ-0002/FL-0001/FL-0002,
  1 review flag, 1 day-only date, 1 override reason.
- Post-restore ledger proof: Moderntech EVD sent 61,500, reversed 104,000,
  expected stock 42,500; Moderntech Float received 151,500, sent 20,200,
  expected stock 131,300; agent net delivered −22,300 with 22,300 excess
  reversal flagged.
- Verification: 624 tests passing, lint clean, production build succeeds.
