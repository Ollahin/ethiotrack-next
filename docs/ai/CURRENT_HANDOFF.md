# EthioTrack Current Handoff

## Branch

`production-v3` (protected baseline: `ethiotrack-next2.0`)

## Compact execution mode (permanent)

- Default to delta-only responses. No restating of finished work.
- One coherent journey per task; do not widen scope.
- Inspect only task-relevant files. No broad unsolicited refactors.
- Tests are necessary but never sufficient. Browser proof is mandatory before
  a milestone may be called accepted.
- No milestone acceptance from a passing test count alone.
- `bun run verify` must pass before completion.
- Never commit private screenshots, real names, account numbers, references,
  phone numbers or raw private messages.

## Validation snapshot (recorded from an actual run)

- Typecheck: pass (`tsc --noEmit`)
- Lint: pass — 7 problems, 0 errors, 7 warnings
- Format check: pass (`prettier --check .`)
- Tests: 747 passed in 31 test files
- Build: pass (`vite build`, Nitro worker output generated)

## Repository truth

### Completed and browser-accepted

- Engineering baseline and CI (`bun run verify` in GitHub Actions on
  `production-v3` and pull requests).
- CBE bank SMS capture through the deterministic grammar in
  `src/lib/cbe-transfer-parser.ts`, including strict arithmetic matching and
  manual date entry for undated messages.
- Real screenshot OCR import end to end (`src/lib/screenshot-import.ts`,
  `src/components/StatementImport.tsx`): orientation correction, raw image
  persisted before OCR, per-tile parsing, explicit linking before save.
- MJ Transfers → Sent and Refill History parsing with 56/56 exact matches on
  the frozen sanitized corpus (`tests/corpus/production-baseline.json`).
- Explicit MJ reversal semantics and their propagation through agents,
  distributors, homepage totals and reconciliation.
- Strict agent and distributor linking (no auto-creation, no fuzzy linking).
- Global History, Agent History, Distributor History, homepage airtime totals
  and weekly Reconciliation, all reading the shared reversal-aware ledgers.
- Backup v3 export, account reset and restore, proven by a full browser
  journey (export → clear → restore → identical ledger).

### Implemented and test-covered, awaiting browser proof

- One capture surface: `src/components/SmsInbox.tsx` renders both `/capture`
  and `/inbox`. The retired `PasteImport.tsx` and `SmartCapture.tsx`
  components and the old parser-toggle Smart Capture architecture no longer
  exist.
- Unified ingestion: paste, clipboard and Android shared text all pass through
  `src/lib/capture/inbox-ingest.ts` and are persisted as ordered Dexie
  `sharedInputs` rows (`seq`, `origin`) before anything is parsed.
- Canonical candidate batches with stable candidate IDs
  (`src/lib/capture/batch.ts`, `src/lib/capture/candidate.ts`): one batch is
  carried from detection through review to import, with no reparsing.
- Bulk date assignment across selected undated rows; time stays optional and
  hidden by default.
- Purpose-specific agent and distributor linking
  (`src/lib/capture/purpose.ts`, `src/lib/capture/defaults.ts`): exact account
  tail selects the configured bank, an agent link on incoming money selects
  agent settlement, an exact distributor match selects distributor payment.
- Source-first SMS classification and grammatical direction rules
  (`src/lib/capture/source-fingerprint.ts`, `src/lib/capture/segmentation.ts`,
  `src/lib/capture/direction.ts`, `src/lib/capture/apply-direction.ts`).
- Partial atomic FIFO settlement allocations (`src/lib/settlement.ts`,
  `recordAgentSettlement` / `importInboxSms` in `src/lib/db.ts`): a receipt,
  its allocations, the agent link and the inbox row removal succeed or roll
  back together; retries are idempotent.
- Dexie v7 with the `settlementAllocations` store.
- Allocation-aware agent ledgers (`src/lib/agent-ledger.ts`) reporting open
  credit from allocations rather than whole-transaction matching.
- Reference-less duplicate-risk handling (`src/lib/capture/identity.ts`):
  reference identity when the source states one, otherwise a canonical
  fingerprint; confirmation is raised only on a genuine collision, and the old
  mandatory "no reference" checkbox is gone.
- Generic, position-aware OCR evidence reconstruction
  (`src/lib/ocr-row-reconstruction.ts`) behind `src/lib/ocr-parser.ts` and
  `parseRefillHistory`; incomplete rows stay visible, unselected and PARTIAL.
- Float/EVD SMS parsing, pairing, reference deduplication and adapter
  (`src/lib/float-evd-sms-parser.ts`, `src/lib/float-evd-sms-adapter.ts`,
  `src/components/SmsFloatEvdImport.tsx`) with alias-based distributor
  resolution. Corpus: 14 sanitized fixtures, 17 expected events, 3 review rows.
- Backup coverage for all currently persisted records, including
  `settlementAllocations`, `sharedInputs` (with `seq`/`origin`) and
  `approvedMappings`, with migration of older backup files.

### Current release blockers

1. Agent settlement browser proof is outstanding: 50,000 open credit →
   15,000 receipt imported through the inbox → 35,000 open credit still shown
   after a refresh.
2. Persisted SMS inbox and bulk workflow browser proof is outstanding: paste a
   real multi-message capture, confirm one persisted row per message in source
   order, apply one bulk date, import, refresh, and confirm the unimported
   rows are still pending.
3. Refill screenshot OCR browser proof is outstanding: real screenshot →
   complete/incomplete rows → explicit agent linking → save → refresh →
   History totals match the source.
4. PWA offline behaviour and installability are not completed. Manifest,
   icons and a guarded service worker exist, but the worker caches nothing, so
   there is no offline app shell and no install/offline proof on a device.
5. Deployment is not completed. No private-beta origin is live and no
   update/migration safety has been exercised on a stable origin.

### Deferred until after MVP

- Many-to-many fulfilment.
- Advanced analytics.
- Cross-device sync.
- Large nonblocking OCR expansion.
- Unrelated visual redesign.

### Known limitations

- All data is local to one browser profile; clearing site data destroys it
  unless a backup file exists.
- OCR runs on the main thread; large batches block the UI.
- 20 additional private screenshots and a private `Float Distribution.docx`
  remain outside the repository awaiting sanitization.

## Accounting rules (binding)

- Bank principal = expected EVD value; the final bank debit is the cash-out.
- No invented date or time. An undated source requires operator entry, and a
  day-only date renders without a fabricated clock time.
- No fuzzy entity linking; case and whitespace normalization only.
- No automatic entity creation during import.
- MJ reversal is stored as `airtimeDirection: "sent"` with `isReversal: true`.
- Reversals restore distributor stock, reduce agent delivery, and never count
  as receipts.
- Excess reversals require a warning, a second confirmation and a written
  explanation persisted on the rows and on the import record.
- Open credit is floored at zero; excess appears as `excessReversal`.
- Repeated legitimate transactions remain separate rows.
- Financial history is append-only.

## Canonical remaining order

Current task:

- 0.4C-bR7 — Close Capture and settlement browser acceptance

Next tasks, in order:

- 0.4C-c1 — Fresh-account guided setup
- 0.4C-c2 — Installable offline app shell
- 0.4C-c3 — Offline OCR preparation
- 0.4C-c4 — Android/iOS device acceptance
- 0.4C-c5 — Vercel private-beta deployment
- 0.4C-c6 — Stable-origin migration/update safety
- 0.4C-c7 — Release-candidate acceptance
