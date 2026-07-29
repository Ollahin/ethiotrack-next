# Sanitized Parser Failure Report

Derived mechanically from `tests/corpus/production-baseline.json` and the
sanitized golden fixtures in `tests/corpus/fixtures/`. Every number below is a
measured evaluator output. Nothing here is estimated, and no claim is made
beyond what the evaluator recorded.

All agent values shown are synthetic corpus values. No original screenshot,
account label, reference, phone number or personal name appears in this report.

## Two different measurements

- **Historical screenshot recall** counted how many rows the parser emitted
  from the original private screenshots. It made no correctness claim about
  agent, amount, sign or date.
- **Sanitized exact-match metrics** (this report) count full-row identity
  matches — normalized agent, signed minor amount and date — against synthetic
  fixtures.

These are different inputs and different definitions. They are **not
interchangeable**, and neither supersedes the other.

## Baseline summary

| Metric               | Value |
| -------------------- | ----: |
| fixtures             |     9 |
| expected rows        |    56 |
| actual rows          |    43 |
| exact row matches    |    36 |
| missing rows         |    20 |
| unexpected rows      |     7 |
| expected negative    |     2 |
| actual negative      |     0 |
| forbidden-agent hits |     3 |
| invented dates       |     0 |
| exact fixtures       |     3 |

### Sign analysis

| Metric                       | Value |
| ---------------------------- | ----: |
| expectedNegativeRows         |     2 |
| matchedExpectedNegativeRows  |     0 |
| missedExpectedNegativeRows   |     2 |
| unexpectedActualNegativeRows |     0 |

Both expected reversals belong to `ocr.mj.sent.photo-4`. Neither is matched:
the parser emitted no negative row anywhere in the corpus. It also emitted no
false negative row, so OCR sign noise is not currently being misread as a
reversal — the sign channel is simply absent.

## Results by source family

| Family         | Fixtures | Expected | Actual | Exact | Missing | Unexpected | Forbidden | Invented dates | Exact fixtures |
| -------------- | -------: | -------: | -----: | ----: | ------: | ---------: | --------: | -------------: | -------------: |
| MJ Transfers   |        6 |       30 |     17 |    10 |      20 |          7 |         3 |              0 |              0 |
| Refill History |        3 |       26 |     26 |    26 |       0 |          0 |         0 |              0 |              3 |

Refill History is fully exact and ordered. Every failing fixture is MJ.

## Failing MJ fixtures (6 of 6)

### ocr.mj.sent.photo-5

Expected 5 · actual 2 · exact 1 · missing 4 · unexpected 1 · forbidden 0 ·
invented dates 0 · exact ordered sequence: no.

Emitted rows:

| #   | agentText              | signedAmountMinor | date |
| --- | ---------------------- | ----------------: | ---- |
| 0   | Sample Agent Alpha     |         2,100,000 | null |
| 1   | E Sample Agent Epsilon |           465,000 | null |

Measured: three of five visible rows were never emitted. Row 1 carries a
leading stray token (`E `) attached to the agent, which prevents an exact match
even though its amount is present in the amount multiset (2 of 2 amounts
matched).

### ocr.mj.sent.photo-38

Expected 5 · actual 3 · exact 2 · missing 3 · unexpected 1 · forbidden 1 ·
invented dates 0 · exact ordered sequence: no.

| #   | agentText         | signedAmountMinor | date |
| --- | ----------------- | ----------------: | ---- |
| 0   | Sample Agent Eta  |           475,000 | null |
| 1   | Sample Agent Iota |         1,950,000 | null |
| 2   | wl                |           360,000 | null |

Measured: row 2 placed the forbidden candidate `wl` in the agent slot while
carrying a real amount, so an existing amount was bound to noise instead of an
agent.

### ocr.mj.sent.photo-2

Expected 5 · actual 3 · exact 1 · missing 4 · unexpected 2 · forbidden 0 ·
invented dates 0 · exact ordered sequence: no.

| #   | agentText       | signedAmountMinor | date |
| --- | --------------- | ----------------: | ---- |
| 0   | null            |              null | null |
| 1   | null            |              null | null |
| 2   | Sample Agent Mu |         2,240,000 | null |

Measured: two emitted rows carry neither an agent nor an amount. The parser
produced row objects with no usable content — the lowest-quality output in the
corpus.

### ocr.mj.sent.photo-9

Expected 5 · actual 3 · exact 2 · missing 3 · unexpected 1 · forbidden 1 ·
invented dates 0 · exact ordered sequence: no.

| #   | agentText          | signedAmountMinor | date |
| --- | ------------------ | ----------------: | ---- |
| 0   | fo                 |         1,364,000 | null |
| 1   | Sample Agent Sigma |         1,225,000 | null |
| 2   | Sample Agent Rho   |         1,489,000 | null |

Measured: the forbidden candidate `fo` occupies the agent slot of the first
emitted row; two legitimate rows follow and match exactly.

### ocr.mj.sent.photo-4

Expected 5 (2 confirmed reversals) · actual 3 · exact 1 · missing 4 ·
unexpected 2 · forbidden 1 · invented dates 0 · exact ordered sequence: no.

| #   | agentText                   | signedAmountMinor | date |
| --- | --------------------------- | ----------------: | ---- |
| 0   | null                        |              null | null |
| 1   | Sample Agent Psi            |         1,575,000 | null |
| 2   | samplewallet - samplewallet |        30,250,000 | null |

Measured: both confirmed reversals are lost — no negative row was emitted. Row
2 binds a repeated account-label handle (`samplewallet - samplewallet`, a
forbidden candidate) to a large amount, and row 0 is empty.

### ocr.mj.sent.photo-6

Expected 5 · actual 3 · exact 3 · missing 2 · unexpected 0 · forbidden 0 ·
invented dates 0 · exact ordered sequence: no.

| #   | agentText        | signedAmountMinor | date |
| --- | ---------------- | ----------------: | ---- |
| 0   | Sample Agent Tau |           387,500 | null |
| 1   | Sample Agent Chi |         2,390,000 | null |
| 2   | Sample Agent Tau |           273,500 | null |

Measured: the best MJ fixture. Every emitted row matches exactly, including the
repeated agent `Sample Agent Tau` across two different amounts, which is
preserved and not netted. It still fails only because two visible rows were
never emitted.

## Likely failure categories

Each category below is supported by the measured output above; no further cause
is inferred.

1. **Repeated account-label / handle noise accepted as an agent** — 3 forbidden
   hits on `photo-38`, `photo-9`, `photo-4`.
2. **Amount-to-agent association loss** — emitted rows whose amount is present
   in the expected multiset but whose agent is not (`photo-5` row 1,
   `photo-38` row 2, `photo-9` row 0).
3. **Row loss** — 20 of 30 MJ expected rows never appear; every MJ fixture
   emits fewer rows than the five visible ones.
4. **Empty row emission** — `photo-2` and `photo-4` emit rows with null agent
   and null amount.
5. **Reversal sign loss** — 2 expected negative rows, 0 matched, 0 emitted.
   Sign is dropped, not misapplied.
6. **No MJ date channel** — every MJ emitted row has a null date, so no MJ
   fixture can reach an exact ordered sequence. Zero dates are invented.
7. **Refill History is unaffected** — 26 / 26 exact, ordered, with repeated
   agents, repeated amounts and same-minute rows all preserved.

## Recommended repair order

1. Reject repeated account-label noise as an agent.
2. Reconstruct MJ amount-to-agent row relationships.
3. Preserve all five visible MJ rows.
4. Distinguish confirmed reversals from OCR sign noise.
5. Preserve repeated legitimate agents and row order.
6. Keep Refill History behavior unchanged.

Every step must keep the non-regression gate green
(`tests/corpus/acceptance-gates.ts`); the release gate is the completion
criterion for this repair sequence.

## Resolution status (Task 0.3B-d)

Production MJ parsing was routed through the deterministic amount-anchored
reconstruction. Re-measured on the same sanitized corpus:

- C1 (fragile repeated-sender anchor): resolved. Rows anchor on defensible
  amounts, not on the account label.
- C2 (list-index rejection in `looksLikeName`): resolved. Decoration prefixes
  and suffixes are stripped before the name-substance test.
- C6 (reversal sign lost through row discard): resolved. Both confirmed
  reversals are emitted with the correct negative sign, and spaced-minus OCR
  noise still yields a positive row.
- Forbidden-agent leakage: resolved, 0 hits. Account labels, chrome words and
  bottom-navigation strips can never be promoted to the agent slot.

MJ is now 30 / 30 exact rows and the corpus total is 56 / 56. The remaining
open item is surfacing unresolved windows in the import UI (Task 0.3B-e).
