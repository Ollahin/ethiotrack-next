# Float and EVD SMS Corpus Design

Design-only document. No `src/**`, test, fixture, schema, dependency or
behavior change is authorized by this task. Governed by
`docs/ai/EXECUTION_CONTRACT.md`.

## 1. Scope

Three sanitized SMS families enter the corpus:

| Family | Meaning | Canonical direction |
| --- | --- | --- |
| `float_distribution` | Float removed from our M-PESA float and sent out | outbound (stock decrease) |
| `evd_receipt` | Our account credited with an ETB EVD amount | inbound (stock increase) |
| `float_receipt` | Float added to our M-PESA float | inbound (stock increase) |

Proposed event kinds (fixture-level vocabulary only, not production types):

- `float_sent_to_agent`
- `evd_received_from_distributor`
- `float_received_from_distributor`

## 2. Family definitions

### 2.1 float_distribution

English half carries: amount removed from M-PESA float, administrator or shop
identity, timestamp, transaction reference, and resulting float balance.

Amharic companion half carries: the same amount, time and reference, plus
sender code and recipient code.

Rules:

- The English and Amharic halves represent **one financial event**. One
  bilingual pair creates one event, not two.
- The **primary pairing key is the transaction reference**.
- Amount and time alone never prove identity. Two halves with equal amount and
  equal minute but different references are two different events.
- **Reference mismatch prevents automatic pairing.** Unpaired halves stay
  unpaired and are marked for review.
- **Recipient code must not be invented from English text.** If only the
  English half exists, `recipientCode` is absent, never derived from the
  administrator or shop name.

### 2.2 evd_receipt

Text states the account was successfully credited with an ETB amount and ends
with a trailing distributor label.

Rules:

- The message may lack an embedded reference and an embedded date.
- When the SMS-app timestamp is available it is preserved exactly as
  source-local wall-clock, minute precision, no timezone invented.
- When no timestamp exists, the fixture requires a **user-selected date** and
  the parser must **never invent a time**. Time precision is then `date`.
- The trailing distributor label is evidence of the counterparty but does not
  auto-link to a stored distributor unless the strict match in §7 succeeds.

### 2.3 float_receipt

Text states an amount was added to the M-PESA float and carries administrator
or shop identity, timestamp, transaction reference and resulting balance.

Rules:

- Structurally the mirror of `float_distribution` with inbound direction.
- A bilingual companion may exist; the same reference-first pairing rule
  applies.

## 3. Field-level evidence and confidence

Every extracted field carries an evidence record:

| Field | Evidence source | Confidence when present | Abstain when |
| --- | --- | --- | --- |
| `amountMinor` | explicit amount token with currency/format | high | more than one candidate amount and no balance keyword to disambiguate |
| `resultingBalanceMinor` | amount adjacent to a balance keyword | high | keyword absent |
| `transactionReference` | explicit reference token | high | token absent or truncated |
| `occurredAt` | in-message timestamp, else SMS-app timestamp | high / medium | neither present → require user-selected date |
| `counterpartyLabel` | administrator, shop or trailing distributor label | medium | label is UI chrome or generic |
| `senderCode` / `recipientCode` | Amharic half only | high | English-only message |
| `direction` | family-level wording (`removed from` vs `added to`, `credited`) | high | wording ambiguous → review |

Confidence values: `high`, `medium`, `low`. Any `low` field forces the row to
`needs_review`.

## 4. Transaction amount versus resulting balance

- **Current balance is never the transaction amount.**
- The balance figure is stored separately as `resultingBalanceMinor` and is
  informational only.
- If only a balance-keyworded amount can be found, the parser abstains on
  `amountMinor` rather than reusing the balance.
- Balance figures never participate in duplicate keys, totals or reconciliation
  sums.

## 5. Unmatched bilingual halves

- An English half with no Amharic companion yields one event with
  `pairing: english_only` and no codes.
- An Amharic half with no English companion yields one event with
  `pairing: amharic_only`; extraction may be partial.
- **Amharic content may be retained as evidence even when extraction is
  partial.** Raw sanitized Amharic text is kept in the fixture so later parser
  work can improve without recollecting data.
- Halves whose references differ are never merged. Halves missing a reference
  are never merged on amount+time.

## 6. Duplicates and same-minute transactions

- Duplicate identity requires an **equal transaction reference** on the same
  family.
- Same amount, same minute, same counterparty is **not** duplication.
- Timestamp-only deduplication is prohibited, matching the MJ/Refill rule.
- Where no reference exists (`evd_receipt`), separate visible messages remain
  separate events; deduplication is not attempted.

## 7. Strict distributor, agent and code matching

- Matching normalizes case and whitespace only.
- No fuzzy matching, edit distance, phonetic matching or alias inference.
- Similar labels remain distinct entities.
- Sender and recipient codes match only on exact normalized equality.
- Unmatched labels stay `unassigned`; the raw label is preserved for review.

## 8. Privacy and sanitization

- **Raw private SMS and screenshots are never committed.**
- `Float Distribution.docx` is reference material only and stays out of the
  repository.
- Sanitization preserves: wording structure, line order, punctuation, spacing,
  Amharic script and diacritics, OCR/SMS noise, repetition, signs, date and
  amount formats.
- Sanitization replaces: personal names, shop and administrator names, phone
  numbers, account numbers, sender/recipient codes, transaction references,
  receipt IDs and URLs.
- Replacements are synthetic and internally consistent within a fixture; two
  synthetic values that must pair share one synthetic reference.
- Synthetic values are never exported to reports or used to justify a financial
  conclusion.

## 9. Deterministic parser abstention rules

The parser abstains and emits a review row instead of guessing when:

1. No amount token is defensible, or the only candidate is balance-keyworded.
2. Direction wording is missing or contradictory.
3. A reference is expected by family but absent or truncated.
4. Two halves collide on amount and minute with mismatched references.
5. A date is absent and no user-selected date is supplied.
6. A counterparty candidate is UI chrome, a bare code fragment or shorter than
   the minimum label length.
7. Amharic extraction yields codes that conflict with the paired English half.

Abstention never invents an agent, distributor, code, date, sign or amount.

## 10. Fixture schema proposal

```text
SmsGoldenFixture
  id                 string   e.g. sms.float.dist.case-01
  family             "float_distribution" | "evd_receipt" | "float_receipt"
  platformHint       "mpesa" | "evd_shortcode" | "unknown"
  languageHalves     Array<"en" | "am">
  rawFile            path to sanitized raw text
  expectedFile       path to expected JSON
  status             "catalogued" | "active"

SmsGoldenExpectation
  fixtureId          string
  events             SmsExpectedEvent[]     // one per financial event
  reviewRows         SmsExpectedReview[]    // abstentions, ordered by source

SmsExpectedEvent
  eventKind          "float_sent_to_agent" | "evd_received_from_distributor"
                     | "float_received_from_distributor"
  direction          "inbound" | "outbound"
  amountMinor        integer (santim, signed)
  rawAmountText      string
  resultingBalanceMinor  integer | null
  transactionReference   string | null
  occurredAt         string | null    // YYYY-MM-DD or YYYY-MM-DDTHH:mm
  datePrecision      "minute" | "date" | "none"
  dateSource         "in_message" | "sms_app" | "user_selected" | "absent"
  counterpartyLabel  string | null
  counterpartyMatch  "unassigned" | "exact"
  senderCode         string | null
  recipientCode      string | null
  pairing            "paired" | "english_only" | "amharic_only"
  evidence           Record<field, { observedText, confidence }>

SmsExpectedReview
  reason  "missing_amount" | "ambiguous_direction" | "missing_reference"
          | "reference_mismatch" | "missing_date" | "ambiguous_counterparty"
          | "code_conflict"
  observedText  string
  sourceIndex   integer
```

## 11. Evaluator metrics

Reported per family and overall:

- `exactEventMatches / expectedEvents`
- `amountExact`, `signExact`, `referenceExact`, `dateExact`
- `balanceNeverUsedAsAmount` (must be 100%)
- `pairingPrecision` and `pairingRecall` (reference-keyed)
- `falsePairs` (must be 0)
- `inventedFields` (must be 0)
- `abstentionPrecision` — review rows that genuinely lacked evidence
- Gates mirror MJ: a **non-regression gate** (ratcheted floor) and a
  **release gate** (100% exact, 0 false pairs, 0 invented fields).

## 12. Initial minimal representative corpus (14 logical cases)

| # | Id | Family | Covers |
| --- | --- | --- | --- |
| 1 | `sms.float.dist.case-01` | float_distribution | clean bilingual pair, matching reference |
| 2 | `sms.float.dist.case-02` | float_distribution | English-only half, no recipient code |
| 3 | `sms.float.dist.case-03` | float_distribution | Amharic-only half, partial extraction retained |
| 4 | `sms.float.dist.case-04` | float_distribution | two halves, mismatched references → no pairing |
| 5 | `sms.float.dist.case-05` | float_distribution | same amount and same minute, different references |
| 6 | `sms.float.dist.case-06` | float_distribution | balance figure larger than amount, adjacency trap |
| 7 | `sms.float.dist.case-07` | float_distribution | truncated reference → abstention |
| 8 | `sms.float.dist.case-08` | float_distribution | similar administrator labels remain distinct |
| 9 | `sms.evd.case-01` | evd_receipt | credited amount with trailing distributor label |
| 10 | `sms.evd.case-02` | evd_receipt | no embedded reference or date, SMS-app timestamp present |
| 11 | `sms.evd.case-03` | evd_receipt | no timestamp at all → user-selected date, no invented time |
| 12 | `sms.evd.case-04` | evd_receipt | two identical-looking receipts, no dedup |
| 13 | `sms.float.recv.case-01` | float_receipt | clean inbound with reference and balance |
| 14 | `sms.float.recv.case-02` | float_receipt | inbound bilingual pair, codes present |

## 13. Implementation batches

- **0.3C-b** — Sanitized SMS fixture schema plus the first representative
  fixtures (cases 1, 9, 13).
- **0.3C-c** — Bilingual pairing fixtures and rules (cases 2–5).
- **0.3C-d** — Balance/abstention fixtures (cases 6, 7, 8).
- **0.3C-e** — EVD date-provenance fixtures (cases 10–12) and case 14.
- **0.3C-f** — SMS evaluator, baseline freeze and acceptance gates.
- **0.3C-g** — Production parser routing for SMS families, only after the
  baseline and gates exist.

## 14. Non-negotiable statements

- One bilingual pair creates one event, not two.
- Reference mismatch prevents automatic pairing.
- Current balance is never the transaction amount.
- Recipient code must not be invented from English text.
- Raw private SMS and screenshots are never committed.
- Amharic content may be retained as evidence even when extraction is partial.