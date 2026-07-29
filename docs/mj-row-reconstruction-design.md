# MJ Row-Reconstruction Design and Implementation Plan

Task 0.3A — design only. No `src/**`, test, fixture, baseline, dependency or
behavior change is made by this document.

Evidence sources: `docs/parser-failure-report.md`,
`tests/corpus/production-baseline.json`, `tests/corpus/evaluator.ts`, the six
active MJ fixtures under `tests/corpus/fixtures/ocr/mj-transfers-sent/`, and
the production code reached by `parseStatementText(text, "mj")`.

All examples below use sanitized corpus values only.

---

## 1. Current production flow

### 1.1 Functions and files

Entry point: `parseStatementText(text, "mj")` in `src/lib/distributor-parser.ts`.

```
parseStatementText(text, "mj")
  └─ detectStatementTemplate(text, "mj")
       └─ APP_TEMPLATES["mj"] === parseMj(text)          // forced by format
            ├─ cleanLines(text)
            │    ├─ zero-width / bidi / NBSP normalization
            │    ├─ EDGE_NOISE_RX  (edge glyph strip)
            │    ├─ NOISE_RX       (whole-line UI chrome)
            │    ├─ PURE_SYMBOL_RX (no alphanumerics)
            │    └─ TOO_SHORT_RX   (single alphanumeric)
            ├─ Pass 1 — "date card" loop
            │    ├─ looksLikeMjDateAmountLine  → parseRightAmount + DATE_DDMMMYYYY
            │    ├─ findMjAgentAfter           → looksLikeName / normalizeName
            │    └─ findMjSenderBefore         → REPEATED_SENDER_RX
            └─ Pass 2 — "sender card" loop  (runs only when pass 1 emits nothing)
                 ├─ stripTransferOrdinal
                 ├─ REPEATED_SENDER_RX         → card anchor
                 ├─ 6-line forward window      → amount, dateText, agentName
                 ├─ looksLikeName / normalizeName
                 │    ├─ stripNameLeaders
                 │    └─ stripNameTrailers
                 └─ toSantim → { amountSantim: abs, isReversal: santim < 0 }
```

`parseGeneric` and `parseRefillHistory` are never reached for `format === "mj"`.

### 1.2 How each field is extracted today

| Field    | Mechanism                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| Lines    | `cleanLines` — normalize, edge-strip, drop chrome/symbol/1-char lines. Order preserved, indexes not retained.            |
| Anchor   | Pass 2 anchors a card on a **sender** line matching `REPEATED_SENDER_RX` = `^([A-Za-z0-9._-]{3,})\s*[-–]\s*\1\b`.        |
| Amount   | `parseRightAmount` (right-anchored `AMOUNT_DOTTED`) or a whole-line `^AMOUNT_DOTTED$` inside a 6-line forward window.    |
| Agent    | First line in the window where `looksLikeName` is true, after `stripTransferOrdinal` / leaders / trailers.              |
| Date     | `DATE_DDMMMYYYY` only. The six MJ fixtures contain no such token, so `dateText` is always `undefined`.                   |
| Sign     | `toSantim(amountStr)`; the row stores `amountSantim: Math.abs(...)` plus `isReversal: santim < 0`. `needsReview` mirrors it. |

The evaluator (`tests/corpus/evaluator.ts`) recombines sign as
`isReversal ? -abs : +abs`, so a dropped row loses its sign entirely.

### 1.3 Actual MJ card shape in the corpus

Every MJ fixture is a repetition of exactly this three-to-five line card, with
no date anywhere in the screen:

```text
<leading OCR glyph> samplewallet - samplewallet     ← account label (never an agent)
<amount>                                            ← e.g. 21,000.00 | -5,250.00 | - 302,500.00
<optional junk line>                                ← "[]", "[wl", "fo)", "[1] . Ir . oe", "M-BM-."
<optional list index><agent name>                   ← "2 Sample Agent Alpha", "E 5 Sample Agent Psi"
```

### 1.4 Evidence-backed causes of the six MJ failures

Each cause below is traceable to a specific fixture line and the frozen
baseline output.

**C1 — Card anchor is too fragile (dominant cause of the 20 missing rows).**
`REPEATED_SENDER_RX` is applied to the line after `stripTransferOrdinal`, which
only removes a leading `\d{1,2} `. `EDGE_NOISE_RX` does not include `&`, `[`,
`(` or stray letter runs, so account-label lines such as
`& samplewallet - samplewallet`, `oo samplewallet - samplewallet`,
`i 3 samplewallet - samplewallet`, `Ek · samplewallet - samplewallet`,
`p 8 samplewallet - samplewallet` and `b 3 …` never match. Those whole cards
are skipped silently. photo-5 has 5 cards and only 2 anchor-matching sender
lines → 2 emitted rows, exactly the frozen `actualRowCount`.

**C2 — Agent lines carrying an OCR list index are rejected.**
`looksLikeName` returns false for any line containing a digit. Agent lines such
as `E 5 Sample Agent Psi` and `E 3 Sample Agent Omega` therefore fail, the card
falls through to `{ ok: false, reason: "no agent" }`, and the evaluator records
`agentText: null, signedAmountMinor: null`. This is exactly baseline
`photo-2` rows 0–1 and `photo-4` row 0.

**C3 — A leading stray letter survives on multi-word names.**
`stripNameLeaders` only removes a 1–2 letter prefix when the remainder is a
single token. `E Sample Agent Epsilon` (photo-5) keeps the `E `, so the row is
emitted with a wrong agent and cannot match exactly, even though its amount
(465,000) is present in the expected amount multiset.

**C4 — Junk tokens pass the name test (2 of 3 forbidden-agent hits).**
After leader/trailer stripping, `[wl` → `wl` (photo-38) and `fo)` → `fo`
(photo-9) satisfy `NAME_RX`, so noise is bound to a real amount
(360,000 and 1,364,000 respectively).

**C5 — The repeated account label leaks into the agent slot (3rd forbidden hit).**
In photo-4 the window guard `REPEATED_SENDER_RX.test(ln)` is evaluated on the
*unstripped* line `& samplewallet - samplewallet`, which does not match, while
`looksLikeName` accepts `samplewallet - samplewallet`. The result is the frozen
row `samplewallet - samplewallet / 30,250,000`.

**C6 — Reversal signs are lost as collateral of C2, not by sign logic.**
photo-4 carries an attached-minus reversal `-5,250.00`. `toSantim` reads it
correctly, but the card is discarded at C2 before the row is built, so
`isReversal` never reaches the evaluator. Measured sign analysis:
expected 2 · matched 0 · missed 2 · **unexpected 0**. There is no evidence of
false negatives — the sign channel is absent, not wrong.

**C7 — Spaced-minus OCR noise is currently handled correctly and must stay so.**
`- 302,500.00` (photo-4) and `- 3,875.00` (photo-6) are expected positives.
`AMOUNT_DOTTED` only captures an *attached* minus, so both are already read as
positive. Any redesign must preserve this exact behavior.

**C8 — No MJ date exists in the source.**
All 30 expected MJ rows have `date: null` and the parser emits 0 dates and 0
invented dates. Correct behavior; must be preserved.

**C9 — Ordering is never exact for MJ purely as a consequence of C1/C2.**
Emitted rows are in source order, but because rows are missing, no MJ fixture
reaches `exactOrderedSequence`. No reordering bug was observed.

Cause-to-fixture matrix:

| Fixture   | C1 | C2 | C3 | C4 | C5 | C6 |
| --------- | -- | -- | -- | -- | -- | -- |
| photo-5   | ✔  |    | ✔  |    |    |    |
| photo-38  | ✔  |    |    | ✔  |    |    |
| photo-2   | ✔  | ✔  |    |    |    |    |
| photo-9   | ✔  |    |    | ✔  |    |    |
| photo-4   | ✔  | ✔  |    |    | ✔  | ✔  |
| photo-6   | ✔  |    |    |    |    |    |

---

## 2. Proposed deterministic pipeline

A single forward pass over indexed, order-preserving lines. Every stage is a
pure function of its input; no global state, no fixture-specific branch, no
scoring model, no fuzzy string matching.

```text
raw text
  → normalizeLines()        keep original index for every surviving line
  → classifyLine()          one label per line, no reordering
  → findAmountAnchors()     each amount line anchors exactly one candidate row
  → reconstructRows()       bind at most one defensible agent per anchor
  → emit rows in anchor order, with warnings/evidence
```

### Rules

1. **Order is preserved end to end.** Lines keep their original index;
   reconstruction never sorts, and rows are emitted in ascending anchor index.
2. **Classification precedes reconstruction.** Every line receives exactly one
   of: `chrome`, `account_label`, `amount`, `agent_candidate`, `date`, `noise`.
3. **The amount is the anchor.** A card exists only where a defensible amount
   line exists. Amount count therefore bounds row count, which directly targets
   C1 without loosening the name rules.
4. **Only a defensible nearby agent is attached.** Search a bounded forward
   window (next `agent_candidate` before the next `amount` anchor). If none is
   defensible, the row is emitted with `agentName: undefined` and a warning —
   never with a guessed or borrowed name.
5. **No fuzzy matching, ever.** Comparison and normalization are limited to
   trimming, whitespace collapsing and case folding, per contract rule 7.
6. **Duplicates are preserved.** Two cards with the same agent and amount stay
   two rows (photo-6 `Sample Agent Tau` twice). No netting, no keying, no
   deduplication.
7. **Nothing is invented.** A missing agent, amount, date or sign stays absent.
   Absence is reported as evidence, never filled in.
8. **Attached minus is authoritative; spaced/punctuation minus is noise.**
   `-5,250.00` → confirmed reversal. `- 302,500.00`, `: 2,735.00`, `— 4,000.00`
   → positive amount with `signEvidence: "spaced_prefix_ignored"`.
9. **Ambiguous sign produces review evidence, not a guess.** Anything that is
   neither cleanly attached nor cleanly spaced (e.g. a minus glyph split across
   the line boundary) yields a positive amount plus
   `warnings: ["ambiguous_sign"]` and `needsReview: true`. A reversal is never
   inferred.
10. **MJ dates stay null** unless a `DATE_DDMMMYYYY` / `DATE_ISO` token exists
    on the anchor line or its immediate neighbor. The current corpus has none,
    so MJ must continue to emit zero dates and zero invented dates.
11. **Account labels can never become agents.** The `account_label` class is
    decided before agent candidacy and is checked on the *stripped* line, which
    closes C5.

---

## 3. Pure helper boundaries

All helpers are pure, side-effect free and independently testable. Proposed
location: a new internal module imported by `distributor-parser.ts` (no public
API change; `parseStatementText` keeps its signature and `StatementRow` shape).

### 3.1 Line classification

```ts
export type MjLineKind =
  | "chrome"          // status bar, "Transfers", "Sent", page footer
  | "account_label"   // repeated "<handle> - <handle>" sender label
  | "amount"          // defensible money token
  | "agent_candidate" // possible agent name line
  | "date"            // date/time token
  | "noise";          // everything else, including short junk like "wl", "fo"

export interface MjLine {
  /** Index in the original text, after normalization but before filtering. */
  sourceIndex: number;
  /** Normalized text (zero-width removed, whitespace collapsed). */
  text: string;
  /** Text after ordinal/leader/trailer stripping — used for classification. */
  stripped: string;
  kind: MjLineKind;
  /** Stable reason code for why this kind was chosen. Never free text. */
  reason: string;
}

export function classifyMjLines(text: string): MjLine[];
```

Classification is total (every surviving line gets a kind) and deterministic.
`noise` must absorb `[wl`, `fo)`, `[]`, `[1] . Ir . oe`, `M-BM-.`, `-`, `:`
(C4) via an explicit minimum-substance rule: an `agent_candidate` requires at
least two alphabetic tokens **or** one alphabetic token of length ≥ 3 that is
not a known label word. This rule is stated positively so it is testable
without referencing any fixture.

### 3.2 Amount parsing with sign evidence

```ts
export type MjSignEvidence =
  | "attached_minus"          // "-5,250.00"      → confirmed reversal
  | "spaced_prefix_ignored"   // "- 302,500.00"   → positive, noise
  | "punctuation_prefix_ignored" // ": 2,735.00"  → positive, noise
  | "none"                    // "21,000.00"      → positive
  | "ambiguous";              // neither shape    → positive + review

export interface MjAmount {
  /** Always non-negative. */
  amountSantim: number;
  isReversal: boolean;      // true only for "attached_minus"
  signEvidence: MjSignEvidence;
  rawAmountText: string;
}

export function parseMjAmount(strippedLine: string): MjAmount | null;
```

Returns `null` when the line is not a defensible amount. Never returns a
negative `amountSantim`; the sign lives in `isReversal` exactly as the existing
`StatementRow` contract expects.

### 3.3 Agent-candidate filtering

```ts
export interface MjAgentCandidate {
  sourceIndex: number;
  /** Canonical name after ordinal/leader/trailer stripping. */
  agentName: string;
  /** Codes such as "ordinal_stripped", "leader_letter_stripped". */
  transforms: string[];
}

export function toMjAgentCandidate(line: MjLine): MjAgentCandidate | null;
```

Must reject `account_label` lines (C5) and accept a leading list index whether
it is numeric (`2 Sample Agent Alpha`), letter+digit (`E 5 Sample Agent Psi`,
C2) or a bare stray letter before a multi-word name (`E Sample Agent Epsilon`,
C3). Stripping is prefix-only and never touches interior characters.

### 3.4 Amount-to-agent row reconstruction

```ts
export interface MjReconstructedRow {
  anchorIndex: number;             // amount line index — defines emission order
  amount: MjAmount;
  agent: MjAgentCandidate | null;  // null is allowed and reported, never guessed
  accountLabel?: string;           // nearest preceding account_label, if any
  dateText?: string;               // only when a real date token exists
  warnings: string[];
}

export function reconstructMjRows(lines: MjLine[]): MjReconstructedRow[];
```

Binding rule: for anchor *a*, take the first `agent_candidate` with
`sourceIndex > a` and `sourceIndex < nextAnchorIndex`. Never look backwards for
an agent, never reuse an agent already bound to another anchor, never skip past
the next anchor.

### 3.5 Warning / evidence output

```ts
export type MjWarningCode =
  | "missing_agent"
  | "ambiguous_sign"
  | "account_label_rejected"
  | "agent_candidate_rejected"
  | "no_date_in_source";
```

Warnings map onto the existing `StatementRow.needsReview` and `reason` fields
so the UI contract does not change. `needsReview` becomes true for
`missing_agent`, `ambiguous_sign` and every confirmed reversal.

---

## 4. Test plan

### 4.1 Per-fixture required assertions

All six MJ fixtures currently fail. Each row below states the assertions the
implementation must satisfy, expressed against evaluator output.

| Fixture   | Required assertions                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| photo-5   | 5 emitted rows (C1). `Sample Agent Epsilon` emitted without the stray `E ` leader (C3). All 5 amounts positive, 0 reversals. All dates null.                                       |
| photo-38  | 5 emitted rows. `wl` never appears as an agent; forbidden hits = 0 (C4). `Sample Agent Eta` appears twice, on two different amounts, and is not deduplicated.                       |
| photo-2   | 5 emitted rows, none with a null agent or null amount (C2). Long agent `Sample Agent Lambda Meridian` retained whole. Leading `E 5 ` / `E 3 ` list indexes stripped, not rejected.  |
| photo-9   | 5 emitted rows. `fo` never appears as an agent (C4). `Sample Agent Rho` appears twice on two different amounts, both retained, in source order.                                     |
| photo-4   | 5 emitted rows. Exactly 2 negative rows, both matching the expected reversals (C6). `- 302,500.00` stays **positive** (C7). `samplewallet - samplewallet` never an agent (C5).      |
| photo-6   | 5 emitted rows. `- 3,875.00` and `: 2,735.00` stay positive (C7). `Sample Agent Tau` appears twice with different amounts, both retained, no netting.                               |

Cross-cutting MJ assertions: 30/30 exact rows, 30 actual rows, 0 missing,
0 unexpected, 0 forbidden-agent hits, 0 invented dates, 0 emitted dates,
`exactOrderedSequence === true` for all six, sign analysis
`matched 2 / missed 0 / unexpected 0`.

### 4.2 Refill History protection

Every batch must re-assert, unchanged:

- 26 expected rows, 26 actual rows, 26 exact matches, 0 missing, 0 unexpected;
- 3 exact fixtures with `exactOrderedSequence === true`;
- 0 negative rows, 0 forbidden-agent hits, 0 invented dates;
- `photo-49`'s two rows sharing `2026-08-09T16:50` both present;
- `Lumen`/`Lumenn` and `Bramble`/`Brambel` remain distinct.

Mechanically: `evaluateNonRegressionGate` must stay green after every batch,
and `tests/corpus/golden-fixtures.test.ts` must not be relaxed. `parseMj` must
not share mutable helpers with `parseRefillHistory`; changes to
`cleanLines`, `looksLikeName` or `normalizeName` are **out of scope** for the MJ
work unless a batch explicitly proves Refill History invariance first.

### 4.3 Implementation batches

Each batch is independently reviewable, independently revertable, and must
leave the non-regression gate green.

| Batch  | Scope                                                                | Gate expectation                                   |
| ------ | -------------------------------------------------------------------- | -------------------------------------------------- |
| 0.3B-a | `classifyMjLines` + `parseMjAmount` as new pure helpers, **unused** by production. Unit tests only. | No behavior change; baseline byte-identical.        |
| 0.3B-b | `toMjAgentCandidate` + rejection rules. Still unused.                 | No behavior change.                                 |
| 0.3B-c | `reconstructMjRows`; unit-tested against synthetic line arrays.       | No behavior change.                                 |
| 0.3B-d | Switch `parseMj` to the amount-anchored pipeline behind the same signature. | Non-regression green; MJ metrics improve; baseline JSON re-frozen in a dedicated step. |
| 0.3B-e | Sign evidence and warning surfacing (`needsReview`, `reason`).        | Sign analysis reaches matched 2 / missed 0 / unexpected 0. |
| 0.3B-f | Release-gate closure: ordering and remaining exact matches.           | Release gate green.                                 |

The frozen `tests/corpus/production-baseline.json` is re-generated only in
batch 0.3B-d and later, as an explicit, separately reviewed step — never as a
side effect.

---

## 5. Recommended implementation order

Smallest first, ordered by measured impact per unit of risk.

1. **Amount-anchored card detection (C1).** Replaces the fragile
   `REPEATED_SENDER_RX` anchor. This is the single change with the largest
   measured effect: 20 of 20 missing MJ rows trace to cards whose account-label
   line failed to match. It touches no name rule, no sign rule and no Refill
   History path.
2. **Accept list-index prefixes on agent lines (C2, C3).** Prefix-only
   stripping of `<digits>`, `<letter> <digits>` and a single stray letter before
   a multi-word name. Converts the null-agent rows in photo-2 and photo-4 into
   real rows.
3. **Harden agent candidacy (C4, C5).** Minimum-substance rule plus an explicit
   `account_label` rejection on the stripped line. Drives forbidden-agent hits
   from 3 to 0.
4. **Sign evidence (C6, C7).** Attached minus → reversal; spaced/punctuation
   prefix → positive; anything else → positive + `ambiguous_sign` review. Only
   after steps 1–2, because the two reversals are currently lost to row loss,
   not to sign logic.
5. **Ordering and exactness closure (C9).** With rows restored, verify
   `exactOrderedSequence` for all six fixtures and close the release gate.
6. **Refill History untouched throughout.** No step may modify
   `parseRefillHistory` or the shared helpers it depends on.

Privacy, sign safety, ordering and Refill History behavior are preconditions at
every step: any batch that improves MJ recall while breaking one of them is
rejected by the non-regression gate and must not be merged.