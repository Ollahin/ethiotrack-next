# EthioTrack Parser Corpus Baseline

## Purpose

Establish a stable, machine-readable inventory of parser and OCR fixtures and
their current measured behavior, so that future parser changes can be
evaluated against a fixed baseline rather than anecdotal impressions.

## Privacy policy

No personal names, account-holder labels, account numbers, receipt or
reference identifiers, URLs, transaction amounts, raw OCR text or original
screenshot data are committed. The catalog contains only fixture identifiers,
source filenames, structural counts and failure tags. The original
`Parser corpus.docx` and its screenshots are treated as private reference
material and are not committed.

## Current OCR catalog

| Fixture ID           | Screen family       | OCR confidence | Expected rows | Parsed rows | Reversals | Failure tags                                                                  |
| -------------------- | ------------------- | -------------: | ------------: | ----------: | --------: | ----------------------------------------------------------------------------- |
| ocr.mj.sent.photo-5  | MJ Transfers → Sent |           0.66 |             5 |           2 |         0 | flattened-layout, missing-middle-rows, account-label-noise, agent-association |
| ocr.mj.sent.photo-38 | MJ Transfers → Sent |           0.66 |             5 |           3 |         0 | flattened-layout, false-agent-token, missing-rows, repeated-agent             |
| ocr.mj.sent.photo-2  | MJ Transfers → Sent |           0.57 |             5 |           1 |         0 | low-ocr-confidence, missing-rows, punctuation-noise, long-agent-name          |
| ocr.mj.sent.photo-9  | MJ Transfers → Sent |           0.71 |             5 |           3 |         0 | false-agent-token, repeated-agent, missing-rows, layout-association           |
| ocr.mj.sent.photo-4  | MJ Transfers → Sent |           0.60 |             5 |           2 |         2 | reversal, signed-amount, account-label-as-agent, missing-rows                 |
| ocr.mj.sent.photo-6  | MJ Transfers → Sent |           0.61 |             5 |           3 |         0 | ocr-sign-noise, missing-rows, layout-association, repeated-agent              |
| ocr.refill.photo-64  | Refill History      |           0.87 |             9 |           9 |         0 | inline-row, repeated-agent, exact-timestamp, strict-agent-linking             |
| ocr.refill.photo-49  | Refill History      |           0.88 |             9 |           9 |         0 | inline-row, repeated-agent, same-timestamp, strict-agent-linking              |
| ocr.refill.photo-51  | Refill History      |           0.82 |             8 |           8 |         0 | inline-row, ocr-name-variation, strict-agent-linking, repeated-layout         |

## Baseline totals

- 9 catalogued screenshot fixtures.
- 56 expected complete rows.
- 40 currently parsed rows.
- Overall raw row recall: 40 / 56, approximately 71.4%.
- MJ row recall: 14 / 30, approximately 46.7%.
- Refill History row recall: 26 / 26, 100%.
- 2 known reversal rows in the current catalog.

## Activation status (Task 0.2C-a)

- 7 active sanitized fixtures: all 6 MJ Transfers → Sent fixtures
  (`ocr.mj.sent.photo-5`, `ocr.mj.sent.photo-38`, `ocr.mj.sent.photo-2`,
  `ocr.mj.sent.photo-9`, `ocr.mj.sent.photo-6`, `ocr.mj.sent.photo-4`) plus
  1 Refill History fixture (`ocr.refill.photo-64`).
- 2 metadata-only Refill History catalog entries remain
  (`ocr.refill.photo-49`, `ocr.refill.photo-51`).
- 39 active expected rows (30 MJ + 9 Refill History).
- 2 active expected reversals.
- 9 active Refill History rows, all positive EVD transfers.
- Exact source-local minute timestamps (`YYYY-MM-DDTHH:mm`) are now
  represented, with no timezone suffix and no UTC conversion.
- Strict agent-linking expectations remain `unassigned` for every row.
- Repeated legitimate Refill History rows (same agent, same amount, different
  timestamps) remain separate expected events.
- All catalogued MJ screenshots now have sanitized golden fixtures.
- Active MJ coverage includes: missed rows, amount-to-agent association,
  account-label noise, false OCR agent tokens, repeated legitimate agents,
  punctuation noise, misleading OCR signs, confirmed reversals and missing
  dates.
- The full catalog remains 9 fixtures, 56 expected rows, 40 currently parsed
  rows and 2 known reversals.
- Production parser accuracy is **not** recalculated in this task: the
  evaluator does not execute production parsing yet. No claim is made that the
  current parser passes these fixtures.

Refill History's 100% row recall measures raw row extraction only. It does not
imply correct strict agent linking; known fixtures include OCR name variations
that the current parser has been observed to link too permissively.

## Known failure classes

- Flattened OCR loses visual relationships between amount, agent and date.
- Missed MJ rows within a single screen.
- Wrong amount-to-agent association.
- Account labels treated as agents.
- OCR symbol fragments treated as agents.
- Reversal signs lost.
- OCR sign noise creating false negative signs on positive amounts.
- Strict agent matching violations (near-miss names auto-linked).
- Repeated legitimate transactions at risk of incorrect deduplication.
- Missing dates.
- Clipped and overlapping screenshots not yet represented in this nine-item
  catalog.

## Release principle

Parser behavior must not be changed until sanitized golden fixtures and an
evaluator that reads them exist. The current file is a metadata-only baseline;
it does not authorize changes to `src/lib/parser.ts`, `src/lib/ocr-parser.ts`
or `src/lib/distributor-parser.ts`.
