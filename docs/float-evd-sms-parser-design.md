# Deterministic Float and EVD SMS Parser — Implementation Design

Design-only document. No `src/**`, test, fixture, schema, dependency or
behavior change is authorized by this task. Governed by
`docs/ai/EXECUTION_CONTRACT.md` and
`docs/float-evd-sms-corpus-design.md`.

## 1. Integration points

Existing surfaces the SMS parser must fit without changing current behavior:

| Surface                          | Role today                                     | Planned relation                                                    |
| -------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| `src/lib/parser.ts`              | Bank/telecom SMS + notification text parsing   | Gains a routing branch only in the final batch                      |
| `src/lib/distributor-parser.ts`  | Distributor statement/OCR routing              | Untouched; SMS is a separate family                                 |
| `src/lib/mj-row-reconstruction.ts` | Reference pattern: pure pipeline + adapter   | Structural model to copy (pure core, thin adapter, ordered windows) |
| `src/lib/types.ts`               | `Transaction`, `StatementRow`, `needsReview`   | SMS adapter emits the same production shapes                        |
| `src/lib/db.ts`                  | Integer santim storage, `duplicateKey`         | Reference-keyed SMS identity feeds the same duplicate helper        |
| `src/components/PasteImport.tsx` | Paste-based ingestion UI                       | Eventual entry point; unchanged until integration batch             |
| `tests/corpus/sms-schema.ts`     | Fixture meaning contract (14 fixtures)         | The parser's expected-output contract; never imported by `src/**`   |

New module: `src/lib/sms-float-evd.ts` (pure), plus
`src/lib/sms-float-evd.test.ts`. The adapter into production shapes lives at
the bottom of the same module, mirroring `adaptMjTransfersSent`.

## 2. Pure pipeline

Five ordered stages. Every stage is a pure function; no clock, locale,
timezone or storage access.

```text
raw text
  → segment()      split into delivery blocks + optional metadata header
  → normalize()    evidence-preserving normalization
  → classify()     family per block
  → extract()      per-block field extraction, nulls for absent evidence
  → resolve()      pairing, deduplication, review rows, ordering
```

### 2.1 normalize (never destroys evidence)

Allowed: strip zero-width characters, normalize NBSP to space, collapse runs
of spaces/tabs, trim per-line, normalize CRLF to LF, Unicode NFC.

Forbidden: lowercasing stored text, removing Amharic punctuation (`።`),
removing thousands separators from the observed text, stripping currency
tokens, dropping repeated lines, reordering lines, digit transliteration.

Every extracted field keeps `observedText` taken from the normalized (not
mutated) source, so evidence survives into the review UI.

### 2.2 classify

Deterministic keyword evidence, evaluated per block, first decisive match wins:

| Family               | Decisive evidence                                                   |
| -------------------- | -------------------------------------------------------------------- |
| `float_distribution` | `removed from` + `float`, or Amharic `ተቀንሶ` + `ፍሎት`                  |
| `float_receipt`      | `added to` + `float`, or Amharic `ተጨምሯል` + `ፍሎት`                     |
| `evd_receipt`        | `credited with` + `ETB`, shortcode-style single-line receipt         |
| `unknown`            | none of the above, or two families both decisive (contradiction)     |

`unknown` and contradictory direction wording both produce a review row with
reason `ambiguous_direction`. Classification never falls back to a default
family.

### 2.3 extract

Each field is `T | null`. Absent evidence is `null`, never guessed.

| Field                   | Evidence rule                                                          |
| ----------------------- | ---------------------------------------------------------------------- |
| `amountMinor`           | Amount token NOT adjacent to a balance keyword; converted to santim     |
| `rawAmountText`         | Verbatim token as observed                                              |
| `direction`             | From family wording only (`removed`→outbound, `added`/`credited`→inbound) |
| `resultingBalanceMinor` | Amount token adjacent to `balance` / `ቀሪ ሂሳብ`; informational only       |
| `transactionReference`  | `Ref:`/`ማጣቀሻ` token matching the full reference shape; truncated → null |
| `occurredAt` (in-msg)   | `on <date> <time>` / `ቀን <date> <time>`, source-local wall clock        |
| SMS-metadata date       | Bracketed delivery header, used only when no in-message timestamp       |
| `counterpartyLabel`     | `by <administrator>` or trailing distributor label                      |
| `shopLabel`             | `at <shop>`                                                             |
| `senderCode`            | Amharic `ላኪ ኮድ <code>` only                                            |
| `recipientCode`         | Amharic `ወደ <code>` / `ተቀባይ ኮድ <code>` only                            |

Amount → santim conversion is integer-only: strip grouping separators, require
at most two decimals, multiply by 100 with exact integer arithmetic. A token
that cannot convert exactly yields `null` plus `missing_amount`.

Sign follows direction: outbound negative, inbound positive.

## 3. Pairing and deduplication

Resolution operates on extracted blocks in source order.

1. **Reference is the primary key.** Blocks with an equal normalized reference
   and equal family belong to one identity bucket.
2. **English + Amharic with matching reference → one event**, `pairing: paired`,
   `pairingStatus: complete`. The English half supplies labels; the Amharic half
   supplies codes. Field conflicts between halves (amount, date, direction)
   produce `code_conflict` / `ambiguous_direction` review rows, never a merge of
   conflicting values.
3. **Repeated delivery of the same proven reference → one event**, regardless of
   how many blocks or which language carried it (fixture case-06: three blocks,
   one event). The first block in source order defines `sourceOrder`.
4. **Mismatched references never pair.** Two halves with different references
   become two pending events plus a `reference_mismatch` review row.
5. **Different references always remain separate**, even with identical amount,
   minute and counterparty.
6. **Amount and time alone never deduplicate.** Reference-less families
   (`evd_receipt`) keep every visible block as its own event.
7. **Unmatched halves stay pending and visible**: `english_only` or
   `amharic_only` with `pairingStatus: pending`, never silently dropped.

## 4. Safety invariants

- A balance-keyworded amount is never promoted to `amountMinor`; if it is the
  only candidate the parser abstains with `missing_amount`.
- Balances never enter duplicate keys, totals or reconciliation sums.
- English text never yields `senderCode` or `recipientCode`; codes exist only
  where an Amharic half exists.
- Counterparty matching normalizes case and whitespace only. No fuzzy, phonetic
  or alias matching. Unmatched → `counterpartyMatch: "unassigned"` with the raw
  label preserved.
- Malformed input abstains and emits a review row from the fixed reason set:
  `missing_amount`, `ambiguous_direction`, `missing_reference`,
  `reference_mismatch`, `missing_date`, `ambiguous_counterparty`,
  `code_conflict`.
- Timestamps are stored as source-local wall-clock strings
  (`YYYY-MM-DDTHH:mm`). No `Date` construction, no UTC conversion, no timezone
  inference.
- `datePrecision: "date"` with `dateSource: "user_selected"` is permitted only
  when no in-message and no SMS-metadata time exists. A user-selected date never
  carries a time.
- Raw sanitized Amharic text is retained in `amharicEvidenceText` even when only
  codes and a reference could be parsed.
- No invented recipient, distributor, reference, amount, balance, sign or
  timestamp — anywhere, ever.

## 5. Proposed pure helpers and shapes

```ts
// --- stage outputs -------------------------------------------------------
export type SmsBlock = {
  sourceOrder: number;
  language: "en" | "am" | "unknown";
  metadataStamp: string | null;   // from the bracketed delivery header
  metadataStampMissing: boolean;  // explicit "TIMESTAMP UNAVAILABLE"
  lines: string[];
  text: string;                   // normalized, evidence-preserving
};

export type SmsClassification = {
  family: "float_distribution" | "evd_receipt" | "float_receipt" | "unknown";
  direction: "inbound" | "outbound" | null;
  evidenceText: string | null;
};

export type SmsFieldEvidence = { observedText: string; confidence: "high" | "medium" | "low" };

export type SmsExtraction = {
  block: SmsBlock;
  classification: SmsClassification;
  amountMinor: number | null;
  rawAmountText: string | null;
  resultingBalanceMinor: number | null;
  rawBalanceText: string | null;
  transactionReference: string | null;
  referenceLooksTruncated: boolean;
  inMessageStamp: string | null;      // YYYY-MM-DDTHH:mm
  counterpartyLabel: string | null;
  shopLabel: string | null;
  senderCode: string | null;
  recipientCode: string | null;
  amharicEvidenceText: string | null;
  evidence: Record<string, SmsFieldEvidence>;
  reviewReasons: SmsReviewReason[];
};

export type SmsResolvedEvent = { /* mirrors tests/corpus/sms-schema.ts SmsExpectedEvent */ };
export type SmsReviewRow = { sourceOrder: number; reason: SmsReviewReason; observedText: string };

export type SmsParseResult = {
  events: SmsResolvedEvent[];
  reviewRows: SmsReviewRow[];
  ordered: Array<{ sourceOrder: number; kind: "event" | "review"; index: number }>;
};

// --- pure helpers --------------------------------------------------------
export function segmentSmsBlocks(text: string): SmsBlock[];
export function normalizeSmsText(text: string): string;
export function classifySmsBlock(block: SmsBlock): SmsClassification;
export function parseSantim(token: string): number | null;
export function extractAmountAndBalance(block, cls): Pick<SmsExtraction, "amountMinor" | "rawAmountText" | "resultingBalanceMinor" | "rawBalanceText">;
export function extractReference(block: SmsBlock): { reference: string | null; truncated: boolean };
export function extractLocalStamp(block: SmsBlock): string | null;
export function extractLabels(block: SmsBlock): { counterpartyLabel: string | null; shopLabel: string | null };
export function extractCodes(block: SmsBlock): { senderCode: string | null; recipientCode: string | null };
export function extractSmsFields(block: SmsBlock): SmsExtraction;
export function resolveSmsEvents(items: SmsExtraction[], opts?: { userSelectedDate?: string }): SmsParseResult;

// --- production adapter (final batch only) -------------------------------
export function adaptFloatEvdSms(text: string, opts?: { userSelectedDate?: string }): {
  transactions: Transaction[];
  reviewRows: StatementRow[];
  ordered: SmsParseResult["ordered"];
};
```

`resolveSmsEvents` is the only stage allowed to merge; all earlier stages are
strictly per-block.

## 6. Test mapping — all 14 fixtures

| Fixture                  | Events / Reviews | Behaviour the parser must prove                       |
| ------------------------ | ---------------- | ------------------------------------------------------ |
| `sms.float.dist.case-01` | 1 / 0            | Bilingual pair on one reference → one paired event      |
| `sms.float.dist.case-02` | 2 / 0            | Same minute, same amount, distinct refs → two events    |
| `sms.float.dist.case-03` | 1 / 0            | English-only, pending, no invented recipient code       |
| `sms.float.dist.case-04` | 2 / 1            | Reference mismatch → no pairing + `reference_mismatch`  |
| `sms.float.dist.case-05` | 1 / 0            | Amharic-only, codes present, Amharic evidence retained  |
| `sms.float.dist.case-06` | 1 / 0            | Triple redelivery of one reference → one event          |
| `sms.float.dist.case-07` | 1 / 1            | Truncated ref → `null` reference + `missing_reference`  |
| `sms.float.dist.case-08` | 0 / 1            | Malformed, no amount → abstain, no invented fields      |
| `sms.evd.case-01`        | 1 / 0            | SMS-app timestamp, trailing distributor label           |
| `sms.evd.case-02`        | 2 / 0            | Identical amounts, distinct stamps → no deduplication   |
| `sms.evd.case-03`        | 1 / 0            | No timestamp → user-selected date, precision `date`     |
| `sms.evd.case-04`        | 1 / 0            | Unrecognized distributor stays `unassigned`             |
| `sms.float.recv.case-01` | 1 / 0            | Inbound float, reference + balance kept separate        |
| `sms.float.recv.case-02` | 2 / 0            | Bilingual pair + distinct-reference receipt → 2 events  |

Corpus-level assertions: 17 events, 3 review rows, 14 active fixtures, balance
never used as amount (100%), invented fields 0, false pairs 0.

## 7. Implementation batches

- **0.3C-e** — Segmentation, normalization, classification and `parseSantim`
  with isolated unit tests. No extraction, no production wiring.
- **0.3C-f** — Field extraction primitives (amount vs balance, reference,
  timestamps, labels, codes) with abstention tests. Still isolated.
- **0.3C-g** — `resolveSmsEvents`: pairing, redelivery collapse, mismatch
  review rows, ordering. Tested against all 14 fixture expectations, still
  without touching `src/**` production paths.
- **0.3C-h** — SMS evaluator, frozen SMS baseline and acceptance gates mirroring
  the screenshot corpus gates.
- **0.3C-i** — `adaptFloatEvdSms` production-shape adapter with shape tests.
- **0.3C-j** — Route paste ingestion through the adapter, refreeze baselines,
  update documentation.

No production behavior changes before batch 0.3C-i.
