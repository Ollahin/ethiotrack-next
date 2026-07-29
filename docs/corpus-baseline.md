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

## Activation status (Task 0.2C-c)

- All 9 screenshot fixtures are active and sanitized: 6 MJ Transfers → Sent
  (`ocr.mj.sent.photo-5`, `ocr.mj.sent.photo-38`, `ocr.mj.sent.photo-2`,
  `ocr.mj.sent.photo-9`, `ocr.mj.sent.photo-6`, `ocr.mj.sent.photo-4`) plus
  3 Refill History (`ocr.refill.photo-64`, `ocr.refill.photo-49`,
  `ocr.refill.photo-51`).
- 0 catalogued or metadata-only entries remain.
- All 56 expected rows are active (30 MJ + 26 Refill History).
- 2 active expected reversals, both MJ.
- 26 active Refill History rows, all positive EVD transfers.
- Strict similar-name handling is represented: `Lumen`/`Lumenn` and
  `Bramble`/`Brambel` remain distinct and unlinked under case- and
  whitespace-only normalization.
- Corpus construction is complete.
- Same-timestamp Refill History coverage is active: two different visible rows
  legitimately share one minute-level timestamp and both remain present.
- Timestamp-only deduplication is explicitly prohibited. Repeated agent names
  and repeated amounts are likewise insufficient on their own.
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

## Sanitized production-parser baseline

Frozen in `tests/corpus/production-baseline.json` (Task 0.2D-a). Produced by
`tests/corpus/evaluator.ts`, which calls the real production entry point on
each active sanitized fixture. No parser code, fixture or expectation was
changed to improve the score.

### Adapter functions used

- MJ Transfers → Sent: `parseStatementText(text, "mj")` from
  `src/lib/distributor-parser.ts` (routes to the MJ card template).
- Refill History: `parseStatementText(text, "alami")` from the same module
  (routes to the Yunus/Alami Refill History template).

Amounts are converted from the parser's documented unit (santim, absolute
`amountSantim` plus the `isReversal` flag) into `signedAmountMinor`. Dates are
converted by deterministic string arithmetic only; unparseable or absent
values become `null`.

### Measured summary

| Metric               | Value |
| -------------------- | ----: |
| fixtureCount         |     9 |
| expectedRows         |    56 |
| actualRows           |    43 |
| exactRowMatches      |    36 |
| missingRows          |    20 |
| unexpectedRows       |     7 |
| expectedNegativeRows |     2 |
| actualNegativeRows   |     0 |
| forbiddenAgentHits   |     3 |
| inventedDateRows     |     0 |
| exactFixtureCount    |     3 |

### Per fixture

| Fixture ID           | Expected | Actual | Exact rows | Missing | Unexpected | Forbidden hits | Ordered |
| -------------------- | -------: | -----: | ---------: | ------: | ---------: | -------------: | ------: |
| ocr.mj.sent.photo-5  |        5 |      2 |          1 |       4 |          1 |              0 |      no |
| ocr.mj.sent.photo-38 |        5 |      3 |          2 |       3 |          1 |              1 |      no |
| ocr.mj.sent.photo-2  |        5 |      3 |          1 |       4 |          2 |              0 |      no |
| ocr.mj.sent.photo-9  |        5 |      3 |          2 |       3 |          1 |              1 |      no |
| ocr.mj.sent.photo-4  |        5 |      3 |          1 |       4 |          2 |              1 |      no |
| ocr.mj.sent.photo-6  |        5 |      3 |          3 |       2 |          0 |              0 |      no |
| ocr.refill.photo-64  |        9 |      9 |          9 |       0 |          0 |              0 |     yes |
| ocr.refill.photo-49  |        9 |      9 |          9 |       0 |          0 |              0 |     yes |
| ocr.refill.photo-51  |        8 |      8 |          8 |       0 |          0 |              0 |     yes |

### Reversal and sign result

Two MJ reversal rows are expected. The production parser emitted **zero**
negative rows: `signedAmountMinor` was never negative in the frozen result.
Reversal sign information is therefore currently lost on the sanitized MJ
fixtures. No expected fixture was relaxed to hide this.

### Forbidden agents and invented dates

- 3 forbidden-agent hits: the parser emitted an agent value equal to a
  fixture's forbidden candidate (account-label / repeated-handle noise) on
  `photo-38`, `photo-9` and `photo-4`.
- 0 invented dates: the parser produced no date value that is absent from the
  fixture's expected dates. MJ rows emitted no usable date at all.

### Major observed failure categories

- MJ row loss: 30 expected MJ rows produced 17 emitted rows and only 10 exact
  matches; flattened OCR cards are frequently skipped.
- MJ amount-to-agent association errors, producing rows whose agent or amount
  does not match any expected row.
- Account-label and repeated-handle noise entering the agent slot.
- Reversal signs dropped entirely on MJ.
- MJ dates absent, so no MJ fixture reaches an exact ordered sequence.
- Refill History is fully exact: 26 / 26 rows, correct order, correct minute
  timestamps, repeated agents, repeated amounts and same-minute rows all
  preserved without deduplication.

### Relationship to the historical baseline

The historical **original-screenshot** baseline recorded 40 / 56 parsed rows.
That figure counted raw rows emitted from the original private screenshots and
made no correctness claim about agent, amount, sign or date.

The new **sanitized-fixture evaluator** baseline records 43 emitted rows and
36 exact full-row matches out of 56 expected rows against synthetic OCR text.

The two measurements are **not interchangeable**: different inputs (original
versus sanitized), different definitions (rows emitted versus exact full-row
identity) and different comparison rules. Neither number supersedes the other.
