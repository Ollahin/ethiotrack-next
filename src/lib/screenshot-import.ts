// Pure screenshot-import pipeline logic.
//
// This module contains ZERO browser or OCR-engine dependencies so the whole
// decision layer (orientation choice, layout classification, row
// completeness, selection defaults, failure handling) is unit-testable with
// injected recognizers and sanitized fixture text.
//
// The text parsers themselves are NOT reimplemented here: classification and
// row extraction are delegated wholesale to `detectStatementTemplate`, which
// already routes MJ "Transfers → Sent" through the frozen deterministic
// reconstruction and Refill History through its own template.

import {
  detectStatementTemplate,
  type StatementRow,
  type TemplateMatch,
} from "./distributor-parser";
import type { DistributorStatementFormat } from "./types";

/** Orientations we probe when a screenshot may have been captured rotated. */
export const ORIENTATIONS = [0, 90, 180, 270] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export interface OcrCandidate {
  orientation: Orientation;
  text: string;
  /** 0..1 mean recognition confidence reported by the OCR engine. */
  confidence: number;
}

export interface ScoredCandidate {
  candidate: OcrCandidate;
  match: TemplateMatch;
  score: number;
}

/** A candidate at or above this score is accepted without probing rotations. */
export const ORIENTATION_EARLY_ACCEPT = 12;

/**
 * Score an OCR candidate by how much *defensible structure* the production
 * parsers can recover from it — not by raw OCR confidence, which stays high
 * on upside-down text that yields no rows at all.
 */
export function scoreCandidate(
  candidate: OcrCandidate,
  format: DistributorStatementFormat = "generic",
): ScoredCandidate {
  const match = detectStatementTemplate(candidate.text, format);
  const okRows = match.rows.filter((r) => r.ok);
  const complete = okRows.filter(isRowComplete).length;
  const unresolved = match.rows.length - okRows.length;
  const layoutBonus = match.kind === "generic" ? 0 : 3;
  const score =
    complete * 10 +
    (okRows.length - complete) * 4 +
    layoutBonus +
    candidate.confidence * 2 -
    unresolved;
  return { candidate, match, score: Number(score.toFixed(4)) };
}

/**
 * Choose the best orientation. Ties resolve to the smallest rotation so an
 * un-rotated screenshot is never needlessly re-interpreted.
 */
export function pickOrientation(
  candidates: OcrCandidate[],
  format: DistributorStatementFormat = "generic",
): ScoredCandidate | null {
  if (candidates.length === 0) return null;
  const scored = candidates.map((c) => scoreCandidate(c, format));
  return scored.reduce((best, cur) =>
    cur.score > best.score ||
    (cur.score === best.score && cur.candidate.orientation < best.candidate.orientation)
      ? cur
      : best,
  );
}

export type Recognize = (orientation: Orientation) => Promise<OcrCandidate>;

/**
 * Probe orientations in order, stopping early once a candidate is clearly
 * good. A recognizer failure on one orientation never aborts the run — the
 * remaining orientations still get a chance, and only a total failure throws.
 */
export async function runOrientedOcr(
  recognize: Recognize,
  format: DistributorStatementFormat = "generic",
  orientations: readonly Orientation[] = ORIENTATIONS,
): Promise<{ best: ScoredCandidate; tried: Orientation[] }> {
  const tried: Orientation[] = [];
  const scored: ScoredCandidate[] = [];
  let lastError: unknown = null;
  for (const orientation of orientations) {
    tried.push(orientation);
    let candidate: OcrCandidate;
    try {
      candidate = await recognize(orientation);
    } catch (e) {
      lastError = e;
      continue;
    }
    const s = scoreCandidate(candidate, format);
    scored.push(s);
    if (s.score >= ORIENTATION_EARLY_ACCEPT && s.match.kind !== "generic") {
      return { best: s, tried };
    }
  }
  if (scored.length === 0) {
    throw lastError instanceof Error ? lastError : new Error("OCR produced no candidates");
  }
  const best = scored.reduce((b, c) =>
    c.score > b.score || (c.score === b.score && c.candidate.orientation < b.candidate.orientation)
      ? c
      : b,
  );
  return { best, tried };
}

/**
 * A row is complete only when every field we would persist was actually read
 * off the screen. Cropped or obstructed rows stay incomplete — the pipeline
 * never invents an agent, amount, sign, date or time.
 */
export function isRowComplete(row: StatementRow): boolean {
  if (!row.ok) return false;
  if (!row.agentName || row.agentName.trim().length < 2) return false;
  if (typeof row.amountSantim !== "number" || !Number.isFinite(row.amountSantim)) return false;
  if (row.amountSantim <= 0) return false;
  if (!row.airtimeType) return false;
  return true;
}

/**
 * Rows pre-ticked for saving: complete rows only. Incomplete (cropped /
 * partial) rows and unresolved diagnostics stay unselected so a reviewer must
 * make an explicit decision.
 */
export function defaultSelection(rows: StatementRow[]): boolean[] {
  return rows.map((row) => isRowComplete(row));
}

export interface ScreenshotSummary {
  total: number;
  complete: number;
  incomplete: number;
  reversals: number;
  needsReview: number;
  totalSantim: number;
}

export function summarizeRows(rows: StatementRow[]): ScreenshotSummary {
  const complete = rows.filter(isRowComplete);
  return {
    total: rows.length,
    complete: complete.length,
    incomplete: rows.length - complete.length,
    reversals: rows.filter((r) => r.isReversal).length,
    needsReview: rows.filter((r) => r.needsReview).length,
    totalSantim: complete.reduce((s, r) => s + (r.amountSantim ?? 0), 0),
  };
}

export type ScreenshotStatus = "pending" | "parsed" | "empty" | "failed";

export interface ScreenshotOutcome {
  status: ScreenshotStatus;
  orientation: Orientation | null;
  text: string;
  confidence: number | null;
  match: TemplateMatch | null;
  rows: StatementRow[];
  selected: boolean[];
  summary: ScreenshotSummary;
  error?: string;
}

export function failedOutcome(error: unknown): ScreenshotOutcome {
  return {
    status: "failed",
    orientation: null,
    text: "",
    confidence: null,
    match: null,
    rows: [],
    selected: [],
    summary: summarizeRows([]),
    error: error instanceof Error ? error.message : String(error),
  };
}

export function outcomeFrom(best: ScoredCandidate): ScreenshotOutcome {
  const rows = best.match.rows;
  const summary = summarizeRows(rows);
  return {
    status: summary.complete > 0 ? "parsed" : "empty",
    orientation: best.candidate.orientation,
    text: best.candidate.text,
    confidence: best.candidate.confidence,
    match: best.match,
    rows,
    selected: defaultSelection(rows),
    summary,
  };
}

/** Month names accepted in day-only statement dates ("25 Jul 2026"). */
const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export interface RowDate {
  iso: string;
  /** True when the source carried a calendar day but no clock time. */
  dayOnly: boolean;
}

/**
 * Parse a statement row's captured date text, reporting whether the source
 * carried a time. Only source-faithful shapes are accepted; nothing is
 * inferred or defaulted.
 */
export function rowDateParts(dateText: string | undefined): RowDate | null {
  if (!dateText) return null;
  const text = dateText.trim();
  const dayMonth = /^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{4})$/.exec(text);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = MONTHS[dayMonth[2].slice(0, 3).toLowerCase()];
    const year = Number(dayMonth[3]);
    if (!month || day < 1 || day > 31) return null;
    const dt = new Date(year, month - 1, day, 0, 0, 0, 0);
    if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day)
      return null;
    return { iso: dt.toISOString(), dayOnly: true };
  }
  const iso = isoFromNumericDate(text);
  return iso;
}

/**
 * Parse a statement row's captured date text into an ISO timestamp.
 *
 * Only source-faithful shapes are accepted (`YYYY-MM-DD` with an optional
 * 12-hour or 24-hour clock). Anything else returns null so the importer asks
 * the reviewer for a date instead of inventing one.
 */
export function rowDateIso(dateText: string | undefined): string | null {
  return rowDateParts(dateText)?.iso ?? null;
}

function isoFromNumericDate(text: string): RowDate | null {
  const m = /(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i.exec(text);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ap] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let hour = hh === undefined ? 0 : Number(hh);
  const minute = mi === undefined ? 0 : Number(mi);
  if (ap) {
    if (hour < 1 || hour > 12) return null;
    const upper = ap.toUpperCase();
    if (upper === "PM" && hour !== 12) hour += 12;
    if (upper === "AM" && hour === 12) hour = 0;
  } else if (hour > 23) return null;
  if (minute > 59) return null;
  const dt = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return { iso: dt.toISOString(), dayOnly: hh === undefined };
}

/** Minimal distributor shape needed to judge screenshot-row compatibility. */
export interface ScreenshotDistributorInput {
  forms?: ("evd" | "float")[];
  telecoms?: unknown[];
}

/**
 * Whether a screenshot row's airtime form is supplied by the chosen
 * distributor. A distributor with no declared forms supplies both. Matching is
 * strictly by declared form — never by name similarity.
 */
export function isScreenshotDistributorCompatible(
  airtimeType: "airtime_evd" | "airtime_float" | undefined,
  distributor: ScreenshotDistributorInput | null | undefined,
): boolean {
  if (!distributor) return false;
  if (!airtimeType) return false;
  const form = airtimeType === "airtime_evd" ? "evd" : "float";
  const forms = distributor.forms ?? [];
  return forms.length === 0 || forms.includes(form);
}

/**
 * Reversal value that exceeds the agent's recorded delivered balance with the
 * same distributor. Anything above zero is an override that must be warned
 * about, confirmed and explained before it can be saved.
 */
export function reversalOverrun(reversalSantim: number, deliveredBalanceSantim: number): number {
  return Math.max(0, reversalSantim - Math.max(0, deliveredBalanceSantim));
}
