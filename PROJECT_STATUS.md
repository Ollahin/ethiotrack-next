# EthioTrack Project Status

## Active branch

production-v3

## Protected baseline

ethiotrack-next2.0

## Current stage

Stage 0.4C — Release execution

## Browser-accepted milestones

- Documentation archive, validation baseline and continuous integration
- Sanitized golden corpus: 9 screenshot fixtures, 56 rows, 2 reversals
- Deterministic production parser evaluator, frozen baseline and release gate
- Deterministic MJ row reconstruction with 56/56 exact sanitized matches
- Explicit reversal semantics across agents, distributors, homepage and
  weekly reconciliation
- CBE bank SMS capture through a deterministic grammar
- Orientation-aware end-to-end screenshot OCR import with explicit linking
- Agent, distributor and global history with week navigation
- Backup v3 export, account reset and restore proven in the browser

## Implemented and test-covered, awaiting browser proof

- One `SmsInbox` capture surface serving both `/capture` and `/inbox`
- Paste, clipboard and Android shared text on one persisted ingestion path
- Canonical candidate batches with stable candidate IDs, no reparsing
- Bulk date assignment with optional, hidden time
- Purpose-specific agent and distributor linking with intelligent defaults
- Source-first SMS classification and grammatical direction rules
- Partial atomic FIFO settlement allocations
- Dexie v7 `settlementAllocations` store
- Allocation-aware agent ledgers and open credit
- Reference-less duplicate-risk handling on true collisions only
- Generic position-aware OCR evidence reconstruction
- Float/EVD SMS parsing, pairing and alias-based distributor resolution
- Backup coverage for every currently persisted record type

## Current release blockers

- Agent settlement browser proof: 50,000 credit → 15,000 receipt → 35,000
  open credit after refresh
- Persisted SMS inbox and bulk workflow browser proof
- Refill screenshot OCR browser proof through save and refresh
- PWA offline behaviour and installability not completed
- Deployment not completed

## Current task

0.4C-bR7 — Close Capture and settlement browser acceptance

## Next tasks

1. 0.4C-c1 — Fresh-account guided setup
2. 0.4C-c2 — Installable offline app shell
3. 0.4C-c3 — Offline OCR preparation
4. 0.4C-c4 — Android/iOS device acceptance
5. 0.4C-c5 — Vercel private-beta deployment
6. 0.4C-c6 — Stable-origin migration/update safety
7. 0.4C-c7 — Release-candidate acceptance

## Deferred until after MVP

- Many-to-many fulfilment
- Advanced analytics
- Cross-device sync
- Large nonblocking OCR expansion
- Unrelated visual redesign

## Validation snapshot

Recorded from an actual `bun run verify` run:

- Typecheck: pass
- Lint: pass (0 errors, 7 warnings)
- Format check: pass
- Tests: 747 passed across 31 test files
- Build: pass

## Repository truth

`docs/ai/CURRENT_HANDOFF.md` is the authoritative statement of what is
completed and browser-accepted, implemented but awaiting browser acceptance,
blocking, and deferred. Nothing here is production-ready without browser
evidence.

## Execution contract

`docs/ai/EXECUTION_CONTRACT.md` is the permanent execution contract for this
repository. Future tasks reference it instead of repeating its rules.

## Important rule

Tests are necessary but never sufficient. A milestone is accepted only with a
real browser journey; a passing test count alone never accepts a milestone.
