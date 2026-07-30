# EthioTrack Current Handoff

## Branch

`production-v3` (protected baseline: `ethiotrack-next2.0`)

## Current corpus and parser metrics

- 9 active sanitized screenshot fixtures (6 MJ Transfers → Sent, 3 Refill
  History).
- 56 active golden rows: 30 MJ (including 2 confirmed reversals) and 26 Refill
  History.
- Production parser evaluator: 56/56 exact matches.
- Non-regression gate: passing at the ratcheted floor.
- Release gate: passing (100% exact on the sanitized corpus).
- `tests/corpus/production-baseline.json` is the frozen reference baseline.
- Sanitized SMS corpus: 14 active fixtures, 17 expected events, 3 review rows
  (8 float_distribution, 4 evd_receipt, 2 float_receipt). The 14-case plan is
  complete. Meaning-only; no production SMS parser exists yet.

## MJ milestone completion

MJ row reconstruction is complete. Production MJ parsing runs through the
deterministic `adaptMjTransfersSent` pipeline in
`src/lib/mj-row-reconstruction.ts`. Legacy MJ-only extraction helpers were
removed, the unresolved-window diagnostics contract is defined and tested, and
a boundary regression suite is in place.

## Awaiting sanitization

- 20 additional private screenshots are held outside the repository and await
  sanitization before any can become fixtures.
- A private `Float Distribution.docx` awaits conversion into a sanitized SMS
  corpus. It is reference material only and is never committed.

## Authoritative project files

- `docs/ai/EXECUTION_CONTRACT.md` — permanent execution rules.
- `PROJECT_STATUS.md` — stage, completed work, current and next task.
- `docs/blueprint/01-master-blueprint.md`
- `docs/blueprint/02-parser-ocr-corpus-spec.md`
- `docs/blueprint/03-production-execution-playbook.md`
- `docs/mj-row-reconstruction-design.md`
- `docs/float-evd-sms-corpus-design.md`
- `docs/corpus-baseline.md`, `docs/parser-failure-report.md`
- `tests/corpus/catalog.json`, `tests/corpus/schema.ts`,
  `tests/corpus/production-baseline.json`
- `tests/corpus/sms-schema.ts`, `tests/corpus/sms-catalog.json`

## Current task

Task 0.3C-c — Complete the 14-case sanitized SMS corpus

## Next task

Task 0.3C-d — Deterministic Float and EVD SMS parser design
