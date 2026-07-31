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
