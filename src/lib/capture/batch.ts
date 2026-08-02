// Canonical capture batch.
//
// A paste, a clipboard read or an Android share produces exactly ONE batch.
// The batch is built once — segmented, parsed, ordered — and everything
// downstream (review cards, readiness badges, summary counts, the Import
// button and the save itself) reads that same batch. Nothing reparses the
// textarea, so a malformed message can never truncate or drop its siblings.

import type { ParsedRow } from "../parser";
import { parseSourceRecords } from "./parse-records";

/** Where a candidate's transaction date came from. Never invented. */
export type DateProvenance = "message" | "metadata" | "batch" | "manual" | "none";

export const DATE_PROVENANCE_LABEL: Record<DateProvenance, string> = {
  message: "From message",
  metadata: "From SMS metadata",
  batch: "Added for batch",
  manual: "Added manually",
  none: "No date yet",
};

export interface BatchCandidate {
  /** Stable within the batch; survives removal of siblings. */
  id: string;
  /** Position in the source paste — never reordered. */
  index: number;
  /** The candidate's own source span, footers included. */
  raw: string;
  /** Parsed once. Serialized as-is so a refresh never reparses. */
  row: ParsedRow;
  /** Genuine timestamp handed over by the sharing application, if any. */
  metadataDateIso?: string;
}

/** A date choice: day is required, time is always optional. */
export interface DateChoice {
  date: string;
  time?: string;
}

/** Reviewer decisions, keyed by candidate id, persisted with the batch. */
export interface BatchDecisions {
  purposes?: Record<string, string>;
  partyActions?: Record<string, string>;
  bankActions?: Record<string, string>;
  distActions?: Record<string, string>;
  remember?: Record<string, boolean>;
}

export interface CaptureBatch {
  id: string;
  createdAt: string;
  /** The exact text the operator supplied — kept as evidence only. */
  text: string;
  candidates: BatchCandidate[];
  /** Reviewer-selected date applied to candidates with no genuine date. */
  batchDate?: DateChoice;
  /** Per-candidate manual overrides, keyed by candidate id. */
  overrides: Record<string, DateChoice>;
  /** Everything the reviewer chose, so a refresh loses no work. */
  decisions: BatchDecisions;
}

function batchId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build the one canonical batch for a capture. Every segmented candidate is
 * kept, in source order, with its own raw span — including the ones the
 * parser could not read.
 */
export function buildBatch(
  text: string,
  opts: { metadataDateIso?: string } = {},
): CaptureBatch | null {
  if (!text.trim()) return null;
  const rows = parseSourceRecords(text);
  const id = batchId();
  return {
    id,
    createdAt: new Date().toISOString(),
    text,
    candidates: rows.map((row, index) => ({
      id: `${id}:${index}`,
      index,
      raw: row.raw,
      row,
      metadataDateIso: opts.metadataDateIso,
    })),
    overrides: {},
    decisions: {},
  };
}

/** Merge a second capture into the pending batch, preserving source order. */
export function appendToBatch(batch: CaptureBatch, text: string): CaptureBatch {
  const next = buildBatch(text);
  if (!next) return batch;
  const base = batch.candidates.length;
  return {
    ...batch,
    text: batch.text ? `${batch.text}\n\n${text}` : text,
    candidates: [
      ...batch.candidates,
      ...next.candidates.map((c, k) => ({
        ...c,
        id: `${batch.id}:${base + k}`,
        index: base + k,
      })),
    ],
  };
}

/** True when the message itself stated a date — never overwritten. */
export function hasGenuineDate(c: BatchCandidate): boolean {
  return Boolean((c.row.ok && c.row.date) || c.metadataDateIso);
}

export function undatedCandidates(batch: CaptureBatch): BatchCandidate[] {
  return batch.candidates.filter((c) => c.row.ok && !hasGenuineDate(c));
}

export interface ResolvedDate {
  iso: string;
  dayOnly: boolean;
  provenance: DateProvenance;
}

function isoFromChoice(choice: DateChoice, provenance: DateProvenance): ResolvedDate | null {
  if (!choice.date) return null;
  const d = new Date(`${choice.date}T${choice.time || "00:00"}:00Z`);
  if (isNaN(d.getTime())) return null;
  return { iso: d.toISOString(), dayOnly: !choice.time, provenance };
}

/**
 * Date provenance order, strictly: the message itself, then genuine sharing
 * metadata, then the reviewer's batch date, then a per-row correction. The
 * current clock, the share time and the screenshot time are never used.
 */
export function resolveCandidateDate(batch: CaptureBatch, c: BatchCandidate): ResolvedDate | null {
  const override = batch.overrides[c.id];
  if (override?.date) return isoFromChoice(override, "manual");
  if (c.row.ok && c.row.date) {
    return { iso: c.row.date, dayOnly: c.row.dateIsDayOnly ?? false, provenance: "message" };
  }
  if (c.metadataDateIso) return { iso: c.metadataDateIso, dayOnly: false, provenance: "metadata" };
  if (batch.batchDate?.date) return isoFromChoice(batch.batchDate, "batch");
  return null;
}

/** Apply one reviewer date to every currently undated candidate. */
export function applyBatchDate(batch: CaptureBatch, choice: DateChoice): CaptureBatch {
  return { ...batch, batchDate: choice.date ? choice : undefined };
}

export function setRowDate(
  batch: CaptureBatch,
  candidateId: string,
  choice: DateChoice | null,
): CaptureBatch {
  const overrides = { ...batch.overrides };
  if (choice && choice.date) overrides[candidateId] = choice;
  else delete overrides[candidateId];
  return { ...batch, overrides };
}

/** Drop imported candidates; everything unresolved stays pending. */
export function removeCandidates(batch: CaptureBatch, ids: string[]): CaptureBatch | null {
  const drop = new Set(ids);
  const candidates = batch.candidates.filter((c) => !drop.has(c.id));
  if (candidates.length === 0) return null;
  const overrides: Record<string, DateChoice> = {};
  for (const c of candidates) if (batch.overrides[c.id]) overrides[c.id] = batch.overrides[c.id];
  return {
    ...batch,
    text: candidates.map((c) => c.raw).join("\n\n"),
    candidates,
    overrides,
  };
}

/** Local calendar day as YYYY-MM-DD — used by the Today/Yesterday shortcuts. */
export function localDayString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayString(now: Date = new Date()): string {
  return localDayString(now);
}

export function yesterdayString(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() - 1);
  return localDayString(d);
}

const BATCH_KEY = "ethiotrack.capture.batch.v1";

/** The pending batch — decisions included — survives refresh and lock/unlock. */
export function saveBatch(batch: CaptureBatch | null): void {
  if (typeof window === "undefined") return;
  try {
    if (batch && batch.candidates.length > 0)
      window.localStorage.setItem(BATCH_KEY, JSON.stringify(batch));
    else window.localStorage.removeItem(BATCH_KEY);
  } catch {
    /* storage unavailable — the batch simply won't survive a refresh */
  }
}

export function loadBatch(): CaptureBatch | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BATCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CaptureBatch;
    if (!parsed?.candidates?.length) return null;
    return { ...parsed, overrides: parsed.overrides ?? {}, decisions: parsed.decisions ?? {} };
  } catch {
    return null;
  }
}