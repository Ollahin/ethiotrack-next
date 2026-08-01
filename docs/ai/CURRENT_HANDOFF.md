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

## Validation snapshot (recorded from an actual `bun run verify` run)

- Typecheck: pass (`tsc --noEmit`)
- Lint: pass — 8 problems, 0 errors, 8 warnings
- Format check: pass (`prettier --check .`)
- Tests: 636 passed in 21 test files
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

### Implemented and test-covered, awaiting browser acceptance

- Float/EVD SMS parsing, pairing, reference deduplication, adapter and import
  UI (`src/lib/float-evd-sms-parser.ts`, `src/lib/float-evd-sms-adapter.ts`,
  `src/components/SmsFloatEvdImport.tsx`), including alias-based distributor
  resolution. Corpus: 14 sanitized fixtures, 17 expected events, 3 review rows.
- Smart Capture classification and routing (`src/lib/smart-capture.ts`,
  `src/components/SmartCapture.tsx`).
- Shared-input inbox and share handoff (`src/routes/inbox.tsx`,
  `src/lib/share-inbox.ts`, `src/lib/share-handoff.ts`).
- Backup v4 (adds `approvedMappings`, migrates v2 and v3 files).

### Partially implemented

- Approved mappings: the pure rules (`src/lib/approved-mappings.ts`), the
  Dexie table and backup coverage exist, but no import or review screen reads
  or writes mappings yet, so approvals are never captured or reused.
- Android share target: manifest entry, `public/sw.js` interception and the
  `/share-target` server fallback exist; the inbox cannot yet continue from a
  stored image Blob.
- PWA installability: manifest and guarded service-worker registration exist,
  but the referenced icons are absent from `public/`.

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

## Smart Capture — current state

Present in code:

- Single capture entry point `src/components/SmartCapture.tsx`, used by
  `/capture` and `/inbox`.
- Deterministic text classification with per-family evidence, tie detection
  and manual override (`src/lib/smart-capture.ts`).
- Shared-input inbox with pending/handled lists, dismiss and delete.
- Android manifest `share_target` (`public/manifest.webmanifest`),
  `public/sw.js` multipart interception into a standalone store, and the
  `/share-target` route as a server-side fallback.
- Backup v4 persistence of approved mappings and Dexie tables for
  `approvedMappings` and `sharedInputs`.

Remaining blockers (verified against current code):

1. A shared image lands in the inbox with its Blob, but review renders a bare
   `StatementImport`, so the operator must re-upload the same file.
2. Inbox items are marked `reviewed` when handed to a parser, not when a row
   is actually saved or dismissed.
3. No clipboard action in the inbox or capture box.
4. Text that no parser recognises yields no candidates, so the override select
   is hidden and the operator cannot force a family.
5. Approved mappings are stored and backed up but never read or written by any
   import path, so nothing is learned from an approval.
6. `public/` has no `icon-192.png`, `icon-512.png` or `icon-maskable-512.png`,
   so the manifest icons 404 and installability is unproven.
7. No browser proof of Android install, lock/unlock and refresh-resume of a
   shared item.

## Current task

Task 0.4C-bR — Complete Smart Capture and Android Share Target

## Next task (after acceptance)

Task 0.4C-c — Fresh-account setup, offline PWA and deployment readiness
