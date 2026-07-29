# Parser Corpus

## Why this exists

The parser and OCR pipeline must be evaluated against a stable, versioned set
of fixtures before any behavior change is made. This directory holds the
machine-readable catalog of fixtures and, in later tasks, the sanitized golden
inputs and expected outputs used by the evaluator.

## What is not committed

- The original `Parser corpus.docx` reference document.
- Original screenshots or SMS exports.
- Personal names, account-holder names, account numbers, references, receipt
  IDs and URLs from real customer data.

`Parser corpus.docx` is used only as reference material during authoring.

## Sanitization rules for future fixtures

Committed fixtures must be sanitized. Sanitization must **preserve**:

- Wording structure.
- Line order.
- Punctuation.
- Spacing variations.
- OCR noise, including symbol fragments and stray tokens.
- Repeated-row relationships.
- Sign information (positive vs negative amounts).
- Date formats as they appeared in the source.
- Amount formats (commas, decimals, currency tokens).

Sanitization must **replace**:

- Personal names.
- Account-holder names.
- Account numbers.
- References.
- Receipt IDs.
- URLs.

Agent names used in future fixtures must be **synthetic**. Similar synthetic
names must remain distinct unless an explicit alias fixture states that two
names should resolve to the same agent.

## Parser safety rule

Extract with defensible evidence, or abstain and mark the row for review.
Never invent a financial field.

## Terminology

- **MJ** — the Transfers → Sent screen family.
- **Refill History** — the Yunus or Alami refill listing family.
- The correct platform name is **Moderntech Safaricom**.

## Activation

A fixture is `catalogued` when only its metadata exists. A fixture becomes
`active` only when both a sanitized raw fixture and an expected-output fixture
are committed and referenced from `catalog.json`.

## Active OCR fixtures

- Active OCR fixtures contain **sanitized OCR text only**, never screenshot
  image data. No original screenshot is committed to this repository.
- All names and amounts in active fixtures are **synthetic**. They do not
  correspond to any real agent, account or transaction.
- Formatting, row ordering, repeated values, signs and OCR noise are preserved
  so that each fixture reproduces the same _type_ of parsing challenge as the
  original screen.
- Synthetic values must never be treated as real customer data, exported to
  reports, or used to justify a financial conclusion.
- Every active fixture requires an expected JSON file that validates against
  `GoldenOcrExpectationSchema` in `schema.ts`.
