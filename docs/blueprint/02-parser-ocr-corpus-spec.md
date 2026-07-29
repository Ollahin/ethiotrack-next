# EthioTrack Parser, OCR and Corpus Specification

**Document ID:** ET-BP-002  
**Version:** 1.0  
**Status:** Approved technical specification  
**Prepared:** 28 July 2026  
**Applies to:** `production-v3` rebuild derived from `ethiotrack-next2.0`

---

## 1. Mission

The parser and OCR system must be robust against wording, spacing, line wrapping, OCR noise, and layout differences without silently fabricating financial facts.

“Grenade-proof” has a precise engineering meaning:

> The system produces a confirmed result only when the evidence is sufficient. Otherwise it preserves the raw input, returns an incomplete or low-confidence candidate, and asks the user to review it. It never silently invents an amount, sign, direction, date, party, reference, distributor, or duplicate decision.

The system is not expected to correctly guess every future unknown message format. It is expected to fail safely and visibly.

---

## 2. Supported input channels

| Input | Initial support | Notes |
|---|---|---|
| Android share-target text | Required | Samsung Messages, Truecaller, built-in SMS apps. |
| Timestamped SMS export | Required | Preserves message timestamps where available. |
| Manual pasted text | Required | User supplies date/time when absent. |
| Screenshot image | Required | English OCR only. |
| PDF statement | Preserve current support | Parser profiles must be explicit. |
| Manual entry | Required | Bypasses parser but uses the same validation schemas. |
| Direct SMS inbox access | Not supported | Requires native/default-SMS privileges. |
| Amharic OCR | Not supported now | Amharic text may remain as raw evidence/noise. |

---

## 3. Current parser architecture and baseline problems

### 3.1 Current modules

- `parser.ts`: SMS templates, generic rules, batch parser, and a Transfers/Sent OCR parser.
- `ocr-parser.ts`: date-anchor parsing for Refill History and Transfers/Sent OCR text.
- `distributor-parser.ts`: template detection and distributor statement parsing.
- `ocr.ts`: Tesseract call returning flattened text and mean confidence.
- `brain/fuzzy.ts`: Levenshtein and substring-based agent matching.

### 3.2 Structural problems

- Multiple parsers overlap and can disagree.
- Dispatch behavior depends on fragile gates.
- OCR geometry is discarded.
- Current import screens can auto-create agents.
- Missing dates may be replaced by the current time.
- Heuristic deduplication can remove legitimate same-party/same-amount movements.
- Overall OCR confidence hides field-specific uncertainty.

---

## 4. Corpus inventory and measured baseline

### 4.1 Annotated screenshot corpus

`Parser corpus.docx` contains nine fully annotated image fixtures:

| Layout | Fixtures | Expected rows | Current rows parsed | Current row recall |
|---|---:|---:|---:|---:|
| MJ Transfers/Sent | 6 | 30 | 14 | 46.7% |
| Yunus/Alami Refill History | 3 | 26 | 26 | 100.0% |
| Total | 9 | 56 | 40 | 71.4% |

The Refill History 100% figure measures row extraction only. It does not mean agent linking is correct; examples such as `SampleZ → SampleY` and `SampleMB → SampleMA` violate the strict-linking rule.

### 4.2 Confirmed MJ failure classes

- Missing full rows.
- Wrong amount-to-agent pairing.
- OCR icons/symbol fragments treated as names (`wl`, `fo`).
- `sampleagent - sampleagent` treated as the agent.
- Negative signs lost or ignored.
- Reversals omitted.
- Visible dates not reliably extracted.
- Duplicate legitimate transactions at the same amount/day at risk of suppression.

### 4.3 SMS corpus

The available Word corpus covers at least these source families:

- Commercial Bank of Ethiopia.
- Bank of Abyssinia.
- Telebirr.
- Cooperative Bank of Ethiopia.
- Coop eBirr.
- Dashen Bank.

It includes hundreds of alerts with:

- Credit and debit wording variants.
- Named and unnamed counterparties.
- Principal, service charge, VAT, disaster-recovery charge, and total.
- Current balance.
- Receipt links and reference IDs.
- Mixed punctuation and spacing.
- Duplicate alerts.
- Missing URLs or dates.
- Airtime, merchant, wallet, and bank transfer messages.
- Amharic boilerplate mixed with English transaction text.

The corpus conversion task must assign a stable fixture ID to each logical message. A line count is not sufficient because some messages contain multiple lines beginning with “You have”.

---

## 5. Target ingestion pipeline

```text
Input acquisition
  → durable raw evidence
  → normalization (non-destructive)
  → format/profile detection
  → source-specific extraction
  → candidate field generation
  → invariant validation
  → identity resolution suggestions
  → duplicate/overlap analysis
  → persisted review candidates
  → user confirmation
  → domain event creation
```

### 5.1 Separation of responsibilities

- OCR recognizes text and geometry.
- Layout reconstruction groups recognized tokens into rows/columns.
- Source parsers interpret the reconstructed content.
- Validators test financial and structural invariants.
- Identity resolution links exact configured entities.
- Review UI owns user decisions.
- Domain use cases create ledger events.

No parser may write directly to the transaction database.

---

## 6. Canonical ingestion types

```ts
type InputKind =
  | "sms_share"
  | "sms_export"
  | "paste"
  | "image"
  | "pdf"
  | "manual";

type IngestionStatus =
  | "saved"
  | "processing"
  | "ready_for_review"
  | "committed"
  | "failed";

interface IngestionJob {
  id: string;
  inputKind: InputKind;
  status: IngestionStatus;
  evidenceId: string;
  requestedProfile?: string;
  detectedProfile?: string;
  parserVersion?: string;
  createdAt: string;
  updatedAt: string;
  error?: StructuredError;
}
```

### 6.1 OCR structures

```ts
interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OcrToken {
  text: string;
  confidence: number;
  box: OcrBox;
  lineId: string;
  blockId: string;
}

interface OcrLine {
  id: string;
  text: string;
  confidence: number;
  box: OcrBox;
  tokens: OcrToken[];
}

interface OcrDocument {
  imageWidth: number;
  imageHeight: number;
  meanConfidence: number;
  lines: OcrLine[];
  engine: string;
  engineVersion: string;
}
```

### 6.2 Field-level provenance

```ts
type FieldSource =
  | "exact_template"
  | "layout"
  | "ocr"
  | "source_metadata"
  | "inferred"
  | "user";

interface ParsedField<T> {
  value?: T;
  confidence: number;
  source: FieldSource;
  evidenceText?: string;
  box?: OcrBox;
  warnings: string[];
}
```

### 6.3 Candidate

```ts
interface ParsedCandidate {
  id: string;
  ingestionJobId: string;
  profile: string;
  completeness: "complete" | "partial";
  kind:
    | "bank_in"
    | "bank_out"
    | "evd_sent"
    | "evd_reversal"
    | "evd_receipt"
    | "unknown";
  amount: ParsedField<number>;
  principal?: ParsedField<number>;
  serviceCharge?: ParsedField<number>;
  vat?: ParsedField<number>;
  otherCharge?: ParsedField<number>;
  totalDebit?: ParsedField<number>;
  party: ParsedField<string>;
  date: ParsedField<string>;
  reference?: ParsedField<string>;
  accountTail?: ParsedField<string>;
  distributor?: ParsedField<string>;
  signedAmountSantim?: number;
  warnings: string[];
  needsReview: boolean;
  selectedForImport: boolean;
  rawSegment: string;
}
```

---

## 7. Parser registry

Each parser profile implements:

```ts
interface ParserProfile {
  id: string;
  version: string;
  inputKinds: InputKind[];
  detect(input: NormalizedInput): DetectionScore;
  parse(input: NormalizedInput): ParsedCandidate[];
  validate(candidate: ParsedCandidate): ValidationResult;
}
```

The registry returns ranked detection results. The user can override the detected profile before commit.

Initial profile families:

```text
sms.cbe.credit.basic.v1
sms.cbe.credit.by-party.v1
sms.cbe.received-account-parentheses.v1
sms.cbe.credit.explicit-date-ref.v1
sms.cbe.debit.basic.v1
sms.cbe.debit.fees.v1
sms.cbe.debit.for-party.v1
sms.cbe.transferred.out.v1

sms.abyssinia.credit.v1
sms.abyssinia.debit.v1
sms.telebirr.received.v1
sms.telebirr.sent.v1
sms.telebirr.bank-transfer.v1
sms.telebirr.merchant.v1
sms.telebirr.airtime.v1
sms.coop.credit.v1
sms.coop.debit.v1
sms.coop-ebirr.transfer.v1
sms.dashen.debit.v1

ocr.mj.transfers-sent.v1
ocr.refill-history.v1
pdf.distributor.generic.v1
```

Unknown inputs return `unknown` candidates or a parse failure with suggestions. They never fall through to a permissive rule that invents direction.

---

## 8. Text normalization

Normalization produces a derived representation while preserving the original.

Allowed transformations:

- Normalize Unicode whitespace.
- Normalize line endings.
- Collapse redundant spaces within a derived line.
- Preserve negative signs.
- Preserve decimal separators and commas.
- Preserve parentheses and reference/URL characters.
- Record removed UI/noise lines separately.

Prohibited transformations:

- Removing a negative sign.
- Converting malformed money text into a positive number.
- Dropping a date because it is not in the preferred format.
- Replacing an unknown character inside a reference without marking uncertainty.
- Mutating the stored raw evidence.

---

## 9. Money extraction

### 9.1 General rules

- Parse to integer santim.
- Require a syntactically valid amount token.
- Keep sign when present.
- Identify the role of every money token.
- Never select “largest number” without source-specific context.
- Reject years/status-bar values as amounts.

### 9.2 Role examples

For:

```text
Debited with ETB 3,700.00.
Service charge ETB 10.
VAT ETB 1.50.
Total ETB 3,711.50.
Current Balance ETB 27,520.42.
```

Expected roles:

| Value | Role |
|---:|---|
| 3,700.00 | Principal |
| 10.00 | Service charge |
| 1.50 | VAT |
| 3,711.50 | Final debit |
| 27,520.42 | Balance, never transaction amount |

### 9.3 Inconsistency

If the stated total does not equal the components:

- Preserve each value.
- Mark an invariant warning.
- Use the bank's explicit total as final debit only after review or when the profile declares it authoritative.

---

## 10. Date extraction

Supported date examples include:

- `25/07/2026 at 09:42:27`
- `20 Jul 2026`
- `2026-07-22 4:51 PM`
- ISO timestamps from export metadata.

Rules:

- Validate real calendar dates.
- Convert exact local timestamps to UTC with an explicit source timezone when known.
- Store date-only values without an invented time.
- Pasted messages without a body date require a user-selected date/time unless a share/export timestamp exists.
- A parser fallback must not call `new Date()` and present that as the original transaction date.

---

## 11. MJ Transfers/Sent layout profile

### 11.1 Business meaning

- Platform family: MJ.
- Positive amount: EVD sent to an agent.
- Negative amount: EVD reversal.
- `sampleagent - sampleagent` is the source/subdistributor account label, not the agent.

### 11.2 Visual pattern

The screen represents one transaction across a repeated visual structure:

```text
source account label              signed amount
optional/visible date
agent name
```

Flattened OCR may interleave icons and may omit the visible date. Geometry is therefore required.

### 11.3 Layout algorithm

1. Crop the top status bar and bottom navigation bar using normalized image coordinates.
2. Group OCR tokens into visual lines.
3. Identify the repeated source account label column/region.
4. Identify signed amounts in the right-side region.
5. Associate each amount with the nearest transaction container/row.
6. Find the agent name immediately below or within the same visual card, excluding account label and UI text.
7. Attach a date when recognized inside the same card or a clearly shared date group.
8. Preserve source row order.
9. Emit partial candidate when one field is missing.

### 11.4 Reversal rules

- Preserve `-5,000.00`, `-8,650.00`, and other negative values exactly.
- Set kind to `evd_reversal`.
- Do not calculate absolute value as the stored movement.
- Review UI shows current MJ net and resulting MJ net.

### 11.5 Known corpus examples

The golden corpus includes:

- Same agent with positive and negative amounts.
- Repeated names.
- Repeated amounts.
- OCR fragments before names.
- Long names.
- Missing/uncertain dates.

---

## 12. Yunus/Alami Refill History profile

### 12.1 Business meaning

- Positive row: EVD sent to an agent.
- Negative row, if present: reversal/correction requiring the same signed treatment.
- Layout family is shared by Yunus and Alami.
- User selects Yunus or Alami for the batch.

### 12.2 Visual pattern

```text
agent name                  amount Birr
YYYY-MM-DD h:mm AM/PM
```

### 12.3 Extraction

1. Identify a line containing a name and amount followed by `Birr`.
2. Associate the next valid timestamp line.
3. Preserve exact row order.
4. Allow names with spaces.
5. Do not auto-link misspelled variants.
6. Keep a partial candidate when date or amount is clipped.

---

## 13. Screenshot preprocessing and OCR

### 13.1 Processing target

- English language model only.
- No more than 5 seconds per standard screenshot after initial asset load.
- One persistent worker reused across images.
- Sequential processing.
- Save source and intermediate result after each stage.

### 13.2 Preprocessing pipeline

Candidate steps, measured rather than assumed:

1. Read orientation.
2. Downscale to an OCR-appropriate maximum dimension while preserving legibility.
3. Crop predictable status/navigation bars.
4. Improve contrast/grayscale only when it improves corpus accuracy.
5. Avoid destructive thresholding that removes negative signs or decimal points.
6. Run one primary OCR pass.
7. Run a targeted secondary crop only for low-confidence amount/name regions when necessary.

Multiple full-image OCR passes should be avoided on low-end devices.

### 13.3 Offline assets

Tesseract worker code and the English language data must be cached for offline use. The first online setup should display asset-download progress and completion state.

---

## 14. Agent identity resolution

### 14.1 Automatic match key

```ts
function normalizeExactName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}
```

Only an exact normalized canonical name or approved alias may auto-link.

### 14.2 User decision

For unmatched names, review provides:

- Editable detected name.
- Search existing agents.
- Create new agent.
- Leave unassigned.
- Optional “remember this exact alias” checkbox after explicit confirmation.

### 14.3 Prohibited automatic matches

- Substring matching.
- Levenshtein threshold matching.
- Removing repeated characters to force a match.
- Phonetic matching.
- Matching based solely on amount or transaction history.

---

## 15. Distributor recognition

Use strict configured signals.

Example Moderntech Safaricom configuration:

```json
{
  "platform": "Moderntech Safaricom",
  "officialNames": [
    "Moderntech Technologies PLC"
  ],
  "approvedAliases": [
    "ModerntechTechnologies PLC",
    "Gutema Edao",
    "Nuri Edao"
  ],
  "bankAccounts": [
    { "channel": "CBE", "tail": "4278" }
  ]
}
```

An outgoing bank message matching this configuration defaults to `airtime_purchase`, subject to the Personal toggle.

---

## 16. CBE parser requirements

### 16.1 Incoming account transfer

Example structure:

```text
You have received ETB 18,500.00 from account 1**2276
(Boki Degefa Geleta) to your account 1**5058.
Your current balance is ETB147,633.77.
```

Extract:

- Direction: in.
- Amount: 18,500 ETB.
- Party: name inside parentheses.
- Source/destination account tails where supported.
- Balance as balance, not amount.
- Receipt URL identifier as reference when no explicit reference exists.

### 16.2 Outgoing transferred message

```text
You have successfully transferred ETB206000.00
from account 1**5058 to account 1**4278
(Moderntech Technologies Plc).
...
with total of ETB206000.00.
```

Extract:

- Direction: out.
- Principal: 206,000 ETB.
- Party/distributor: Moderntech Technologies PLC.
- Source account tail: 5058.
- Destination account tail: 4278.
- Total debit: explicit total.
- Must not become incoming merely because the phrase “from account” follows the amount.

### 16.3 Explicit date/reference credit

```text
Account ... has been Credited with ETB 12,950.00
from Misganaw Mersha, on 25/07/2026 at 09:42:27
with Ref No FT...
```

Extract exact party, date/time, reference, and amount.

### 16.4 Branch debit for named party

Extract named recipient, principal, all charge components, final debit, balance, account tail, and receipt reference.

---

## 17. Other SMS source requirements

Each source profile requires fixture-driven rules for:

- Direction phrase.
- Transaction amount phrase.
- Principal/fee/total roles.
- Party phrase.
- Account/wallet tail.
- Reference/receipt URL.
- Balance phrase.
- Date source.
- Success/pending/failed/reversed status.

Initial source families:

- Bank of Abyssinia.
- Telebirr.
- Cooperative Bank of Ethiopia.
- Coop eBirr.
- Dashen Bank.

No profile should be marked production-ready until its corpus fixtures and mutations pass.

---

## 18. Status handling

Recommended parser outputs:

| Source status | Behavior |
|---|---|
| Successful/completed | Importable after review. |
| Pending | Persist candidate; exclude from confirmed totals; allow later status update. |
| Failed/declined | Do not create a financial event; retain evidence and report ignored status. |
| Reversed | Create/link a reversal only when evidence is sufficient; otherwise review. |
| Unknown | Review required. |

Real examples for all status classes are not yet available. Build the state model now; add source-specific templates only when real samples arrive.

---

## 19. Partial candidates

A partial candidate is a first-class result, not a parser failure to hide.

```ts
interface PartialCandidateInfo {
  missingFields: Array<"amount" | "party" | "date" | "direction" | "reference">;
  clippedAt: "top" | "bottom" | "unknown";
}
```

Partial rows are visible, unselected by default, and may be manually completed.

---

## 20. Duplicate and overlap analysis

### 20.1 Text/SMS

- Exact channel + reference is a strong duplicate signal.
- Exact normalized message content hash is a strong duplicate signal.
- Same party, amount, and date is not sufficient.

### 20.2 Screenshots

Detect overlap using consecutive row sequences:

```text
normalized agent + signed amount + timestamp/date + relative row order
```

Require at least two or more consecutive matching complete rows before proposing automatic batch overlap. Exact thresholds must be tuned against the corpus.

A probable overlap is presented to the user; the app does not destroy evidence.

---

## 21. Fixture format

Use JSONL manifests.

```json
{
  "id": "sms.cbe.debit-fees.001",
  "inputKind": "sms",
  "profile": "sms.cbe.debit.fees.v1",
  "rawFile": "sms/cbe/debit-fees-001.txt",
  "expected": {
    "kind": "bank_out",
    "principalSantim": 370000,
    "serviceChargeSantim": 1000,
    "vatSantim": 150,
    "totalDebitSantim": 371150,
    "party": null,
    "needsReview": false
  },
  "tags": ["fees", "vat", "no-party", "spacing-variation"]
}
```

Screenshot fixture:

```json
{
  "id": "ocr.mj.sent.005",
  "inputKind": "image",
  "profile": "ocr.mj.transfers-sent.v1",
  "imageFile": "screenshots/mj/photo_5.jpg",
  "expectedRows": [
    {
      "order": 1,
      "agent": "SampleAgentA",
      "signedAmountSantim": 2000000,
      "datePrecision": "day",
      "complete": true
    }
  ],
  "partialRowCount": 0,
  "overlapGroup": null
}
```

Real names, phone numbers, account numbers, references, and URLs in public repository fixtures must be sanitized while preserving structure and relationships.

---

## 22. Mutation testing

For each text fixture, generate deterministic mutations:

- Whitespace added/removed.
- Newline changes.
- Case changes.
- Punctuation deletion.
- Comma deletion.
- `ETB`/`Birr` deletion where the source remains identifiable.
- `O ↔ 0`, `I ↔ l ↔ 1` substitutions.
- Random UI/status-bar noise.
- URL moved to another line.
- Name split across lines.
- Amount split from currency.
- Truncated beginning.
- Truncated end.
- Duplicate message repeated.

Expected outcome is either:

- Same correct result, or
- Explicit incomplete/needs-review/abstention.

A wrong confident result is a critical failure.

---

## 23. Corpus evaluator metrics

The evaluator command should report:

- Fixture count.
- Candidate recall.
- False positive count.
- Amount accuracy.
- Sign accuracy.
- Direction accuracy.
- Principal accuracy.
- Total debit accuracy.
- Party accuracy.
- Date accuracy and precision accuracy.
- Reference accuracy.
- Correct strict agent links.
- Unauthorized auto-links.
- Duplicate preservation.
- True duplicate removal.
- Overlap detection precision/recall.
- Partial-row detection.
- Abstention count.
- Median and p95 processing time.
- Unrecognized fixture IDs.

Command:

```text
bun run corpus:evaluate
```

---

## 24. Release gates

### 24.1 Annotated screenshot corpus

Required before replacing the old parser in production:

```text
Expected complete rows detected:       56/56
False transaction rows:                0
Signed amount accuracy:                100%
Reversal preservation:                 100%
Row-order preservation:                100%
Account label used as agent:           0
OCR symbol used as agent:              0
Unauthorized fuzzy links:              0
Invented dates:                        0
```

### 24.2 SMS corpus

- 100% direction and primary amount accuracy for supported production fixtures.
- 100% principal/final-debit role accuracy for fee-bearing supported fixtures.
- No balance value used as a transaction amount.
- No outgoing distributor transfer classified as incoming.
- No unsupported message imported confidently.

### 24.3 Performance

- Median processing under the 5-second target on the test Android set.
- No input loss during reload, process interruption, or service-worker update.

---

## 25. Review UI acceptance criteria

- Every candidate can be included/excluded.
- Every parsed field can be corrected.
- Confidence is shown at field level.
- Raw evidence is viewable.
- Agent matching is never silently fuzzy.
- Distributor match explains exact account/name/alias signal.
- Signed amount is visually obvious.
- Reversal impact is shown before save.
- Partial rows are visible and unselected by default.
- User-selected date/time is distinguishable from source-derived date/time.
- Commit creates domain events atomically.

---

## 26. Source register

- `Parser corpus.docx` — nine annotated screenshot fixtures and expected results.
- `sms samples.docx` — multi-source SMS corpus.
- `Beriso Haji Fejo Samples.docx` — additional CBE samples and exact duplicates.
- Uploaded MJ and Refill History screenshots.
- Repository parser/OCR/import files from `ethiotrack-next2.0`.

