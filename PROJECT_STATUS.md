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
- Complete 14-case sanitized SMS corpus

## Current task

Task 0.3C-d — Deterministic Float and EVD SMS parser design

## Next task

Task 0.3C-e — SMS classification and field-extraction primitives

## Execution contract

`docs/ai/EXECUTION_CONTRACT.md` is the permanent execution contract for this
repository. Future tasks reference it instead of repeating its rules.

## Important rule

Do not begin parser, OCR, database, reconciliation or UI restructuring until the validation baseline and corpus evaluator are complete.
