// Generic, position-aware OCR row-reconstruction engine for list screenshots.
//
// This module replaces date-backtracking + party/amount/day deduplication with
// a two-stage pipeline:
//
//   1. Evidence extraction — every cleaned OCR line is converted into ordered
//      evidence tokens (amount / date / candidate party) that keep their
//      source line index, in-line column, raw text and optional bounding box.
//   2. Non-overlapping reconstruction — rows are built around AMOUNT anchors.
//      The dominant relative position of party and date evidence is measured
//      across the whole image (so `party → amount → date`,
//      `date → party → amount`, `party+amount` and `date+amount` layouts all
//      work), and each evidence token is consumed by at most one row.
//
// Invariants:
//   • one row per defensible amount anchor, in source order
//   • a party/date token belongs to at most one row
//   • evidence never crosses a neighbouring anchor's line boundary
//   • repeated legitimate rows are preserved (no deduplication at all)
//   • missing fields are reported, never invented or borrowed
//
// The engine contains no screenshot-specific names, values, line numbers or
// offsets: every rule is structural.

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrLineInput {
  text: string;
  bbox?: BoundingBox;
}

export type EvidenceKind = "amount" | "date" | "party";

export interface EvidenceToken {
  kind: EvidenceKind;
  /** Index into the cleaned line list — source order. */
  lineIndex: number;
  /** Left-to-right position of this token inside its line. */
  column: number;
  /** Token text exactly as printed. */
  text: string;
  /** The whole cleaned source line the token came from. */
  raw: string;
  bbox?: BoundingBox;
  /** amount tokens only — absolute value in minor units. */
  amountSantim?: number;
  /** amount tokens only — printed as a negative / parenthesised value. */
  isReversal?: boolean;
}

export type MissingField = "party" | "date";

export interface ReconstructedRow {
  /** Position of the amount anchor in the source image. */
  sourceOrder: number;
  amountSantim: number;
  isReversal: boolean;
  agentName?: string;
  dateText?: string;
  /** True only when every persisted field was actually read off the screen. */
  complete: boolean;
  missing: MissingField[];
  raw: string;
  evidence: {
    amount: EvidenceToken;
    party?: EvidenceToken;
    date?: EvidenceToken;
  };
}

export interface LayoutHypothesis {
  /** Dominant line offset of the party token relative to its amount anchor. */
  party: number | null;
  /** Dominant line offset of the date token relative to its amount anchor. */
  date: number | null;
}

export interface Reconstruction {
  lines: string[];
  tokens: EvidenceToken[];
  rows: ReconstructedRow[];
  /** Party/date evidence that no row could legitimately claim. */
  unresolved: EvidenceToken[];
  /** complete rows ÷ detected amount anchors (1 when there are no anchors). */
  coverage: number;
  /** True when unresolved evidence exists or coverage is materially short. */
  partial: boolean;
  layout: LayoutHypothesis;
}

// ── Structural vocabulary ──────────────────────────────────────────────────

const CURRENCY = "(?:Birr|ETB|Br\\.?|ብር)";
const MONTHS_SHORT = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

const DATE_PATTERNS: RegExp[] = [
  // 2026-08-02 4:51 PM  /  2026-08-02 16:51  /  2026-08-02
  new RegExp(String.raw`\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?`, "gi"),
  // 24 Jul 2026 (optionally with a clock)
  new RegExp(
    String.raw`\b\d{1,2}\s+(?:${MONTHS_SHORT})[a-z]*\.?\s+\d{4}(?:\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?`,
    "gi",
  ),
];

// Amount candidates. Acceptance is decided in `readAmount`, not by the regex:
// a bare integer only counts when a currency word sits next to it.
const AMOUNT_RX = new RegExp(
  String.raw`(\()?\s*([-−–])?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*\)?\s*(${CURRENCY})?`,
  "gi",
);

// App chrome that is never a party. Structural UI vocabulary only.
const CHROME_RX =
  /^(?:<|>)?\s*(transfers?|received|sent|refill history|refill|agents?|add agent|balance|home|amount|date|name|status|success(?:ful)?|pending|failed|completed|details|close|cancel|ok|back|next|previous|filter|search|total|subtotal|today|yesterday|history|export|share|print|download|menu|settings|logout|sign out|login|copy|copied|review|link to agent)\s*$/i;
const CHROME_WORDS_RX = /\b(refill history|add agent|link to agent)\b/i;
const PURE_SYMBOL_RX = /^[^A-Za-z0-9\u1200-\u137F]+$/;
const NAME_RX = /^[A-Za-z\u1200-\u137F][A-Za-z\u1200-\u137F\s'.-]{0,58}$/;
const MONTH_ONLY_RX = new RegExp(String.raw`^(?:${MONTHS_SHORT})[a-z]*\.?$`, "i");
const EDGE_NOISE_RX =
  /^[\s\u00A0\u2000-\u200F•·●◦▪■◆★✓✔✕✗»›▸▶→←↩⇒©®™§¶†‡¤¬~`^|\\_<>&*+=/,.;:!?@#$%(){}[\]'"-]+|[\s\u00A0\u2000-\u200F•·●◦▪■◆★✓✔✕✗»›▸▶→←↩⇒©®™§¶†‡¤¬~`^|\\_<>&*+=/,.;:!?@#$%(){}[\]'"-]+$/g;

/** Normalize OCR quirks that would otherwise hide a date token. */
export function normalizeOcrText(text: string): string {
  return (
    text
      .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, "")
      .replace(/[\u00A0\u2007]/g, " ")
      // OCR frequently drops the colon in a clock: "4 51 PM" → "4:51 PM".
      .replace(/(\d{1,2})\s+(\d{2})\s*([AP]M)\b/gi, "$1:$2 $3")
      // ...and sometimes glues the clock onto the day: "2026-08-0212:19 PM".
      .replace(/(\d{4}-\d{2}-\d{2})(\d{1,2}:\d{2})/g, "$1 $2")
  );
}

/** Cleaned, non-empty source lines in original order. */
export function cleanOcrLines(input: string | OcrLineInput[]): OcrLineInput[] {
  const rows: OcrLineInput[] =
    typeof input === "string"
      ? normalizeOcrText(input)
          .split(/\r?\n/)
          .map((text) => ({ text }))
      : input.map((l) => ({ ...l, text: normalizeOcrText(l.text) }));
  return rows
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text.length > 0 && !PURE_SYMBOL_RX.test(l.text));
}

function readAmount(
  match: RegExpExecArray,
): { amountSantim: number; isReversal: boolean; text: string } | null {
  const [, paren, sign, digits, currency] = match;
  const hasGroup = digits.includes(",");
  const hasCents = /\.\d{1,2}$/.test(digits);
  if (!hasGroup && !hasCents && !currency) return null;
  const value = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  // A bare 4-digit integer with no separator/decimal is a year, not money.
  if (!hasGroup && !hasCents && /^\d{4}$/.test(digits)) return null;
  return {
    amountSantim: Math.round(value * 100),
    isReversal: Boolean(paren) || Boolean(sign),
    text: match[0].trim(),
  };
}

const TRAILING_CURRENCY_RX = new RegExp(String.raw`\s*${CURRENCY}\s*$`, "i");

function stripEdges(value: string): string {
  // A dangling currency word (the amount beside it may have failed to OCR) is
  // never part of a party label.
  return value
    .replace(EDGE_NOISE_RX, "")
    .replace(TRAILING_CURRENCY_RX, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Structural party test — alphabetic label, not app chrome, not a month. */
export function looksLikeParty(value: string): boolean {
  const cleaned = stripEdges(value);
  if (cleaned.length < 2) return false;
  if (/\d/.test(cleaned)) return false;
  if ((cleaned.match(/[A-Za-z\u1200-\u137F]/g) ?? []).length < 2) return false;
  if (CHROME_RX.test(cleaned) || CHROME_WORDS_RX.test(cleaned)) return false;
  if (MONTH_ONLY_RX.test(cleaned)) return false;
  return NAME_RX.test(cleaned);
}

function maskRange(chars: string[], start: number, end: number): void {
  for (let i = start; i < end && i < chars.length; i++) chars[i] = " ";
}

/** Convert one cleaned line into ordered evidence tokens. */
export function tokenizeOcrLine(line: OcrLineInput, lineIndex: number): EvidenceToken[] {
  const raw = line.text;
  const chars = raw.split("");
  const found: Array<Omit<EvidenceToken, "column">> = [];

  for (const pattern of DATE_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(raw)) !== null) {
      if (
        chars
          .slice(m.index, m.index + m[0].length)
          .join("")
          .trim() === ""
      )
        continue;
      found.push({
        kind: "date",
        lineIndex,
        text: m[0].replace(/\s+/g, " ").trim(),
        raw,
        bbox: line.bbox,
      });
      maskRange(chars, m.index, m.index + m[0].length);
    }
  }

  const afterDates = chars.join("");
  AMOUNT_RX.lastIndex = 0;
  let am: RegExpExecArray | null;
  while ((am = AMOUNT_RX.exec(afterDates)) !== null) {
    if (am[0].trim() === "") continue;
    const parsed = readAmount(am);
    if (!parsed) continue;
    found.push({
      kind: "amount",
      lineIndex,
      text: parsed.text,
      raw,
      bbox: line.bbox,
      amountSantim: parsed.amountSantim,
      isReversal: parsed.isReversal,
    });
    maskRange(chars, am.index, am.index + am[0].length);
  }

  const remainder = stripEdges(chars.join(""));
  if (looksLikeParty(remainder)) {
    found.push({ kind: "party", lineIndex, text: remainder, raw, bbox: line.bbox });
  }

  // Column = left-to-right order of the token inside the line.
  return found
    .map((t) => ({ ...t, start: raw.indexOf(t.text) }))
    .sort((a, b) => a.start - b.start)
    .map(({ start: _start, ...t }, column) => ({ ...t, column }));
}

export function collectEvidence(input: string | OcrLineInput[]): {
  lines: string[];
  tokens: EvidenceToken[];
} {
  const cleaned = cleanOcrLines(input);
  const tokens = cleaned.flatMap((line, i) => tokenizeOcrLine(line, i));
  return { lines: cleaned.map((l) => l.text), tokens };
}

const OFFSET_CANDIDATES = [0, 1, -1, 2, -2];

interface Window {
  lower: number;
  upper: number;
  lineIndex: number;
}

function inWindow(token: EvidenceToken, w: Window): boolean {
  if (token.lineIndex === w.lineIndex) return true;
  return token.lineIndex > w.lower && token.lineIndex < w.upper;
}

/**
 * Measure the dominant line offset of `kind` evidence relative to the amount
 * anchors — this is what makes the engine position-aware instead of
 * direction-guessing per row.
 */
export function chooseOffset(
  kind: EvidenceKind,
  anchors: EvidenceToken[],
  tokens: EvidenceToken[],
  windows: Window[],
): number | null {
  let best: { offset: number; score: number } | null = null;
  for (const offset of OFFSET_CANDIDATES) {
    let score = 0;
    anchors.forEach((anchor, i) => {
      const hit = tokens.some(
        (t) =>
          t.kind === kind && t.lineIndex === anchor.lineIndex + offset && inWindow(t, windows[i]),
      );
      if (hit) score++;
    });
    if (score > 0 && (best === null || score > best.score)) best = { offset, score };
  }
  return best?.offset ?? null;
}

function nearestAnchorIndex(anchors: EvidenceToken[], lineIndex: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  anchors.forEach((a, i) => {
    const d = Math.abs(a.lineIndex - lineIndex);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  });
  return bestIndex;
}

export function reconstructRows(input: string | OcrLineInput[]): Reconstruction {
  const { lines, tokens } = collectEvidence(input);
  const anchors = tokens.filter((t) => t.kind === "amount");
  const windows: Window[] = anchors.map((a, i) => ({
    lineIndex: a.lineIndex,
    lower: i > 0 ? anchors[i - 1].lineIndex : Number.NEGATIVE_INFINITY,
    upper: i < anchors.length - 1 ? anchors[i + 1].lineIndex : Number.POSITIVE_INFINITY,
  }));

  const layout: LayoutHypothesis = {
    party: chooseOffset("party", anchors, tokens, windows),
    date: chooseOffset("date", anchors, tokens, windows),
  };

  const claimed = new Set<EvidenceToken>();

  const offsetsFor = (hypothesis: number | null): Array<{ offset: number; primary: boolean }> => {
    const base = hypothesis === null ? [0, 1, -1] : [hypothesis, hypothesis + 1, hypothesis - 1, 0];
    const seen = new Set<number>();
    const out: Array<{ offset: number; primary: boolean }> = [];
    for (const offset of base) {
      if (Math.abs(offset) > 2 || seen.has(offset)) continue;
      seen.add(offset);
      out.push({ offset, primary: hypothesis !== null && offset === hypothesis });
    }
    return out;
  };

  const claim = (
    kind: EvidenceKind,
    anchorIndex: number,
    hypothesis: number | null,
  ): EvidenceToken | undefined => {
    const anchor = anchors[anchorIndex];
    for (const { offset, primary } of offsetsFor(hypothesis)) {
      const line = anchor.lineIndex + offset;
      const candidate = tokens.find(
        (t) =>
          t.kind === kind &&
          t.lineIndex === line &&
          !claimed.has(t) &&
          inWindow(t, windows[anchorIndex]),
      );
      if (!candidate) continue;
      // Fallback positions may never steal evidence that structurally belongs
      // to a neighbouring row; the measured layout offset always may not.
      if (!primary && nearestAnchorIndex(anchors, line) !== anchorIndex) continue;
      claimed.add(candidate);
      return candidate;
    }
    return undefined;
  };

  const rows: ReconstructedRow[] = anchors.map((anchor, i) => {
    const party = claim("party", i, layout.party);
    const date = claim("date", i, layout.date);
    const missing: MissingField[] = [];
    if (!party) missing.push("party");
    if (!date) missing.push("date");
    const raw = [party?.raw, anchor.raw, date?.raw]
      .filter((v, idx, arr): v is string => Boolean(v) && arr.indexOf(v) === idx)
      .join(" | ");
    return {
      sourceOrder: i,
      amountSantim: anchor.amountSantim as number,
      isReversal: Boolean(anchor.isReversal),
      agentName: party?.text,
      dateText: date?.text,
      complete: missing.length === 0,
      missing,
      raw,
      evidence: { amount: anchor, party, date },
    };
  });

  const unresolved = tokens.filter((t) => t.kind !== "amount" && !claimed.has(t));
  const completeRows = rows.filter((r) => r.complete).length;
  const coverage = anchors.length === 0 ? 1 : completeRows / anchors.length;
  return {
    lines,
    tokens,
    rows,
    unresolved,
    coverage: Number(coverage.toFixed(4)),
    partial: unresolved.length > 0 || completeRows < anchors.length,
    layout,
  };
}
